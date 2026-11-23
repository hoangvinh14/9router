import {pathToFileURL} from 'node:url';
// Only session's unrelated settings dependency replaced. Real JWT and bcrypt
// packages plus actual dashboardSession/management auth/route remain unmodified.
export function resolve(specifier,context,nextResolve){
 if(context.parentURL==='file:///app/src/lib/auth/dashboardSession.js'){
  if(specifier==='@/lib/dataDir')return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href,context);
  if(specifier==='@/lib/localDb')return nextResolve(pathToFileURL('/app/tests/fixtures/budget/jwt-settings-stub.mjs').href,context);
 }
 if(context.parentURL==='file:///app/src/app/api/pricing/route.js'){
  if(specifier==='next/server')return nextResolve('data:text/javascript,export const NextResponse=Response;',context);
  if(specifier==='open-sse/providers/pricing.js')return nextResolve('data:text/javascript,export const getDefaultPricing=()=>({});',context);
  if(specifier==='@/lib/localDb.js')return nextResolve('/app/tests/fixtures/budget/jwt-settings-stub.mjs',context);
  if(specifier.startsWith('@/lib/'))return nextResolve('/app/src/'+specifier.slice(2),context);
 }
 return nextResolve(specifier,context);
}
