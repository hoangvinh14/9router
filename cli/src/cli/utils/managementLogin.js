// Explicit UI actions only; background status refresh must never call this.
const api = require('../api/client');
async function withManagementLogin(operation) {
  const first=await operation();
  if(first.success||first.statusCode!==401)return first;
  if(!process.stdin.isTTY)return {...first,error:'Dashboard authentication required; use the authenticated connect command or dashboard.'};
  const {Password}=require('enquirer');
  let password;
  try{password=await new Password({message:'Dashboard password for API key management'}).run();}
  catch{return {success:false,error:'Management login cancelled'};}
  const login=await api.loginManagement(password);password=null;
  if(!login.success)return login;
  return operation();
}
module.exports={withManagementLogin};
