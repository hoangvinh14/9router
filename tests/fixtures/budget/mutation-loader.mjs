import {pathToFileURL} from 'node:url';
const unrelated=new Set(['./repos/connectionsRepo.js','./repos/nodesRepo.js','./repos/proxyPoolsRepo.js','./repos/combosRepo.js',
 './repos/aliasRepo.js','./repos/pricingRepo.js','./repos/disabledModelsRepo.js','./repos/usageRepo.js','./repos/requestDetailsRepo.js']);
const aliases={
 '@/lib/dataDir.js':'src/lib/dataDir.js','@/shared/utils/keyAccess.js':'src/shared/utils/keyAccess.js',
 '@/shared/constants/keyAccess.js':'src/shared/constants/keyAccess.js',
};
export function resolve(specifier,context,nextResolve){
 if(Object.hasOwn(aliases,specifier))return nextResolve(pathToFileURL('/app/'+aliases[specifier]).href,context);
 if(context.parentURL==='file:///app/src/lib/db/index.js'&&unrelated.has(specifier))return nextResolve(pathToFileURL('/app/tests/fixtures/budget/mutation-barrel-stub.mjs').href,context);
 // createApiKey is not exercised; generate/id permission is not manufactured.
 if(context.parentURL==='file:///app/src/lib/db/repos/apiKeysRepo.js'&&specifier==='uuid')return {url:'data:text/javascript,export function v4(){throw new Error("create not admitted")}',shortCircuit:true};
 return nextResolve(specifier,context);
}
