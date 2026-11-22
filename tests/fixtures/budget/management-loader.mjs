import {pathToFileURL} from 'node:url';
export function resolve(specifier,context,nextResolve){
 if(context.parentURL==='file:///app/src/lib/accounting/management-auth.js'&&specifier==='../auth/dashboardSession.js')
  return nextResolve(pathToFileURL('/app/tests/fixtures/budget/management-session-stub.mjs').href,context);
 return nextResolve(specifier,context);
}
