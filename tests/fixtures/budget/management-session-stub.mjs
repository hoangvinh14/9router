// Control-flow fixture only, not JWT cryptography/session validation evidence.
export async function getDashboardAuthSession(token) {
 if(token==='fixture-admin')return {authenticated:true};
 if(token==='fixture-change-password')return {authenticated:true,mustChangePassword:true};
 if(token==='fixture-wrong-claim')return {authenticated:false};
 return null;
}
