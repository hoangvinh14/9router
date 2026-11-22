import {pathToFileURL} from 'node:url';
const owners=new Set(['/app/src/lib/db/repos/aliasRepo.js','/app/src/lib/db/repos/pricingRepo.js','/app/src/lib/db/repos/disabledModelsRepo.js','/app/src/lib/db/repos/usageRepo.js','/app/src/lib/db/helpers/kvStore.js'].map(path=>pathToFileURL(path).href));
export function resolve(specifier,context,nextResolve){
 if(specifier==='../driver.js'&&owners.has(context.parentURL))return {url:'data:text/javascript,export async function getAdapter(){if(!globalThis.__mapImportDb)throw new Error("fixture map adapter unavailable");return globalThis.__mapImportDb}',shortCircuit:true};
 if(specifier==='@/lib/dataDir.js')return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href,context);
 if(specifier==='@/shared/constants/keyAccess.js')return nextResolve(pathToFileURL('/app/src/shared/constants/keyAccess.js').href,context);
 return nextResolve(specifier,context);
}
