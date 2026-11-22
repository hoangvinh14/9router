// Resolve package metadata only; do not import/execute lint or application code.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const repo=process.cwd();
const queue=['eslint','eslint-config-next','next','react','typescript'].map(name=>({from:repo+'/package.json',name,required:true}));
const seen=new Set();
const modules=path.join(repo,'node_modules');
function inside(candidate){const relative=path.relative(modules,candidate);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
function noSymlink(candidate){for(let p=candidate;p!==path.dirname(p);p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error('Symlink metadata input');}
function manifest(from,name){
 if(!/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name))throw Error('Invalid dependency name');
 for(const root of createRequire(from).resolve.paths(name+'/package.json')??[]){
  const dir=path.join(root,name);if(!inside(dir))continue;
  try{fs.lstatSync(dir);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  noSymlink(dir);if(!fs.lstatSync(dir).isDirectory())throw Error('Package path not directory');
  const file=path.join(dir,'package.json');noSymlink(file);
  if(!fs.lstatSync(file).isFile())throw Error('Manifest not regular');
  const info=JSON.parse(fs.readFileSync(file,'utf8'));
  if(info.name!==name)throw Error('Package manifest name mismatch');
  return {entry:file,dir,info};
 }
 return null;
}
for(const name of ['punycode','@eslint/core','eslint']){
 const found=manifest(repo+'/package.json',name);
 if(found?.dir!==path.join(modules,name))throw Error('Metadata lookup control failed: '+name);
 console.log('LOOKUP_CONTROL',name,path.relative(repo,found.entry));
}
while(queue.length){
 const {from,name,required}=queue.shift();
 const found=manifest(from,name);
 if(!found){if(required)throw Error('Required package metadata missing: '+name);console.log('OPTIONAL_OR_PEER_ABSENT',name);continue;}
 const {entry,dir,info}=found;
 if(seen.has(dir))continue;seen.add(dir);
 console.log('PACKAGE',JSON.stringify({dir:path.relative(repo,dir),name:info.name,version:info.version}));
 for(const [type,required] of [['dependencies',true],['optionalDependencies',false],['peerDependencies',false]])for(const dep of Object.keys(info[type]??{}))queue.push({from:entry,name:dep,required:required&&!Object.hasOwn(info.optionalDependencies??{},dep)});
}
console.log('DEPENDENCY_METADATA_COMPLETE',seen.size);
