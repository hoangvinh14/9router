import {pathToFileURL} from 'node:url';
// Actual pool read/update only; exact acquisition seam, unused create refuses.
export function resolve(specifier, context, nextResolve) {
 if(context.parentURL==='file:///app/src/lib/db/repos/proxyPoolsRepo.js') {
  if(specifier==='../driver.js')return {url:'data:text/javascript,export async function getAdapter(){if(!globalThis.__poolImportDb)throw new Error("fixture adapter unavailable");return globalThis.__poolImportDb}',shortCircuit:true};
  if(specifier==='uuid')return {url:'data:text/javascript,export function v4(){throw new Error("creation not admitted")}',shortCircuit:true};
 }
 if(specifier==='@/lib/dataDir.js')return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href,context);
 if(specifier==='@/shared/constants/keyAccess.js')return nextResolve(pathToFileURL('/app/src/shared/constants/keyAccess.js').href,context);
 return nextResolve(specifier,context);
}
