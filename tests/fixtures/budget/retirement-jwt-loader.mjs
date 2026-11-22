import {resolve as jwtResolve} from './jwt-loader.mjs';
import {resolve as mutationResolve} from './mutation-loader.mjs';
// Actual session crypto/settings-only failfast seam plus exact repository aliases.
// No management-session stub, installed-service replacement or driver spoof.
export function resolve(specifier,context,nextResolve){
 return jwtResolve(specifier,context,(s,c)=>mutationResolve(s,c,nextResolve));
}
