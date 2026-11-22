import { pathToFileURL } from 'node:url';
const unrelated=new Set(['@/sse/handlers/chat.js','open-sse/translator/index.js','@/sse/services/auth.js',
 '@/lib/localDb','@/shared/constants/models','open-sse/config/runtimeConfig.js','@/sse/services/keyAccess.js']);
export function resolve(specifier,context,nextResolve){
 if(specifier==='@/shared/constants/keyAccess.js')return nextResolve(pathToFileURL('/app/src/shared/constants/keyAccess.js').href,context);
 if(specifier==='@/lib/dataDir.js')return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href,context);
 if(specifier==='@/lib/accounting/request-boundary.js')return nextResolve(pathToFileURL('/app/src/lib/accounting/request-boundary.js').href,context);
 if(context.parentURL?.startsWith('file:///app/src/app/api/')&&unrelated.has(specifier))return nextResolve(pathToFileURL('/app/tests/fixtures/budget/reconstruction-stubs.mjs').href,context);
 return nextResolve(specifier,context);
}
