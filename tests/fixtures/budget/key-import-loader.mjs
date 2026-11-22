import {pathToFileURL} from 'node:url';
// Exact actual key repository acquisition. Creation/generator never admitted.
export function resolve(specifier, context, nextResolve) {
 if(context.parentURL==='file:///app/src/lib/db/repos/apiKeysRepo.js') {
  if(specifier==='../driver.js')return {url:'data:text/javascript,export async function getAdapter(){if(!globalThis.__keyImportDb)throw new Error("fixture adapter unavailable");return globalThis.__keyImportDb}',shortCircuit:true};
  if(specifier==='uuid')return {url:'data:text/javascript,export function v4(){throw new Error("creation not admitted")}',shortCircuit:true};
 }
 const aliases={'@/lib/dataDir.js':'src/lib/dataDir.js','@/shared/utils/keyAccess.js':'src/shared/utils/keyAccess.js','@/shared/constants/keyAccess.js':'src/shared/constants/keyAccess.js'};
 if(Object.hasOwn(aliases,specifier))return nextResolve(pathToFileURL('/app/'+aliases[specifier]).href,context);
 return nextResolve(specifier,context);
}
