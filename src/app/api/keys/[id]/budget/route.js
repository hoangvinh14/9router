import { NextResponse } from 'next/server';
import { authorizeManagement } from '@/lib/auth/managementGuard.js';
import { captureBudgetManagement, getBudgetManagement, putBudgetManagement } from '@/lib/accounting/budget-management.js';

export const dynamic = 'force-dynamic';
const json=(body,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const idFrom=async params=>{const {id}=await params;if(typeof id!=='string'||!id.trim()||id.length>200)throw new Error('Invalid key ID');return id;};
function failure(error){
  const known={api_key_not_found:[404,'Key not found'],api_key_inactive:[409,'API key is inactive or retired'],budget_policy_conflict:[409,'Budget policy conflict'],accounting_not_ready:[409,'Production accounting is not ready']};
  const selected=known[error?.code];
  return selected?json({error:selected[1],code:error.code},selected[0]):json({error:'Budget accounting unavailable',code:'api_key_accounting_unavailable'},503);
}
export async function GET(request,{params}){
  const auth=await authorizeManagement(request);if(auth.response)return auth.response;
  let id;try{id=await idFrom(params);}catch{return json({error:'Invalid key ID'},400);}
  try{return json(getBudgetManagement(await captureBudgetManagement(request),id));}catch(error){return failure(error);}
}
export async function PUT(request,{params}){
  const auth=await authorizeManagement(request,{mutation:true});if(auth.response)return auth.response;
  let id,body;
  try{
    id=await idFrom(params);
    if(request.headers.get('content-length')&&(!/^\d+$/.test(request.headers.get('content-length'))||Number(request.headers.get('content-length'))>4096))throw new Error('Invalid body length');
    const reader=request.body?.getReader();if(!reader)throw new Error('Body required');
    const chunks=[];let bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)throw new Error('Budget body too large');chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    const {parseBudgetPolicy}=await import('@/lib/accounting/budget-policy.js');parseBudgetPolicy(body);
  }catch{return json({error:'Complete bounded decimal-string budget policy required',code:'invalid_budget_policy'},400);}
  try{return json(putBudgetManagement(await captureBudgetManagement(request),id,body));}catch(error){return failure(error);}
}
