import { randomUUID } from 'node:crypto';
import { BUDGET_TIMEZONE } from './budget-windows.js';

const trusted = new WeakSet();
const messages = Object.freeze({api_key_budget_exceeded:'API key recorded-spend budget exceeded',
  api_key_accounting_unresolved:'API key has unresolved accounting; recovery required',
  api_key_accounting_unavailable:'API key accounting unavailable',
  model_pricing_unavailable:'Exact reference model pricing unavailable',
  model_accounting_unsupported:'Model accounting profile unsupported'});
export function budgetError(code, {requestId = randomUUID(), reason, blockedWindows, now} = {}) {
  if (!Object.hasOwn(messages,code)) throw new Error('Unknown local accounting error');
  const metadata = {requestId,timezone:BUDGET_TIMEZONE};
  if (reason) metadata.reason = reason;
  let retryAfter;
  if (code === 'api_key_budget_exceeded') {
    metadata.blockedWindows = blockedWindows.map(window=>Object.freeze({...window}));
    metadata.resetAt = blockedWindows.reduce((latest,window)=>window.resetAt>latest?window.resetAt:latest,'');
    metadata.requiresPolicyChange = blockedWindows.some(window=>window.limitUsd === '0');
    retryAfter = Math.max(1,Math.ceil((Date.parse(metadata.resetAt)-Date.parse(now))/1000));
  }
  const error = Object.assign(new Error(messages[code]),{code,status:code==='api_key_budget_exceeded'?429:503,metadata:Object.freeze(metadata),...(retryAfter?{retryAfter}:{})});
  trusted.add(error);return error;
}
export const isBudgetError = error => !!error && typeof error === 'object' && trusted.has(error);

// Only private object identity is authority; upstream JSON/code/header lookalikes
// cannot select a local terminal response or expose internal exception messages.
export function budgetErrorResponse(error) {
  if (!isBudgetError(error)) error = budgetError('api_key_accounting_unavailable');
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','X-Request-Id':error.metadata.requestId,
    'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-Request-Id, Retry-After'};
  if(error.retryAfter)headers['Retry-After']=String(error.retryAfter);
  return new Response(JSON.stringify({error:{message:error.message,type:'invalid_request_error',code:error.code,param:null,...error.metadata}}),{status:error.status,headers});
}
