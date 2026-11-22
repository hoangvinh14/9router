import { pathToFileURL } from 'node:url';
export function resolve(specifier,context,nextResolve){
 if(specifier==='@/lib/usageDb.js')return nextResolve(pathToFileURL('/app/src/lib/usageDb.js').href,context);
 return nextResolve(specifier,context);
}
