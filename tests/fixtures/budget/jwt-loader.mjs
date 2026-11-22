import {pathToFileURL} from 'node:url';
// Only session's unrelated settings dependency replaced. Real JWT and bcrypt
// packages plus actual dashboardSession/management auth/route remain unmodified.
export function resolve(specifier,context,nextResolve){
 if(context.parentURL==='file:///app/src/lib/auth/dashboardSession.js'){
  if(specifier==='@/lib/dataDir')return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href,context);
  if(specifier==='@/lib/localDb')return nextResolve(pathToFileURL('/app/tests/fixtures/budget/jwt-settings-stub.mjs').href,context);
 }
 return nextResolve(specifier,context);
}
