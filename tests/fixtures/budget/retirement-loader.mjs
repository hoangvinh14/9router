import {pathToFileURL} from 'node:url';
import {resolve as resolveMutation} from './mutation-loader.mjs';
export function resolve(specifier,context,nextResolve){
 if(context.parentURL==='file:///app/src/lib/accounting/management-auth.js'&&specifier==='../auth/dashboardSession.js')
  return nextResolve(pathToFileURL('/app/tests/fixtures/budget/management-session-stub.mjs').href,context);
 return resolveMutation(specifier,context,nextResolve);
}
