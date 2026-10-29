const http = require('node:http');
const https = require('node:https');

// No CLI/inference token bypass. Session cookie is memory-only and tied to the
// exact canonical server origin; HTTP requests never follow redirects.
let origin = null, cookie = null, generation = 0;
function configure(config) {
  if(!['http:','https:'].includes(config.protocol)){clear();origin=null;throw new Error('Unsupported management protocol');}
  let url;
  try{url=new URL(`${config.protocol}//${config.host}:${config.port}`);}catch{clear();origin=null;throw new Error('Invalid management origin');}
  if(url.username||url.password){clear();origin=null;throw new Error('Invalid management origin');}
  if(url.origin!==origin){origin=url.origin;cookie=null;generation++;}
}
function clear(){cookie=null;generation++;}
function request(method,target,body=null) {
  const base=origin,epoch=generation,session=cookie;
  if(!base)return Promise.resolve({success:false,error:'Management server not configured'});
  let url;
  try{url=new URL(target,base);}catch{return Promise.resolve({success:false,error:'Invalid management request target'});}
  if(url.origin!==base||url.username||url.password)return Promise.resolve({success:false,error:'Cross-origin management request refused'});
  return new Promise(resolve=>{
    const text=body===null?null:JSON.stringify(body);
    const req=(url.protocol==='https:'?https:http).request(url,{method,headers:{Accept:'application/json',...(text?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}:{}),...(!['GET','HEAD'].includes(method)?{Origin:base}:{}),...(session?{Cookie:session}:{})}},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();resolve({success:false,error:'Management redirect refused',statusCode:res.statusCode});return;}
      const chunks=[];let bytes=0;
      const failed=()=>resolve({success:false,error:'Management response interrupted'});
      res.on('aborted',failed);res.on('error',failed);
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)req.destroy(new Error('Management response too large'));else chunks.push(chunk);});
      res.on('end',()=>{
        if(base!==origin||epoch!==generation){resolve({success:false,error:'Management origin changed during request'});return;}
        let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{resolve({success:false,error:'Invalid management response',statusCode:res.statusCode});return;}
        if(res.statusCode===401)cookie=null;
        if(res.statusCode>=400||parsed.error){resolve({success:false,error:typeof parsed.error==='string'?parsed.error:`HTTP ${res.statusCode}`,statusCode:res.statusCode});return;}
        if(target==='/api/auth/login'){
          const issued=(res.headers['set-cookie']||[]).map(value=>/^auth_token=([^;]+);/.exec(value)).find(Boolean);
          if(parsed.success!==true||!issued){resolve({success:false,error:'Login did not issue a management session'});return;}
          cookie=`auth_token=${issued[1]}`;
        }
        resolve({success:true,data:parsed,statusCode:res.statusCode});
      });
    });
    req.on('error',()=>resolve({success:false,error:'Management network request failed'}));
    req.setTimeout(30000,()=>req.destroy(new Error('Management request timeout')));
    if(text)req.write(text);req.end();
  });
}
async function login(password){if(typeof password!=='string'||!password)return {success:false,error:'Dashboard password required'};clear();return request('POST','/api/auth/login',{password});}
module.exports={configure,request,login,clear};
