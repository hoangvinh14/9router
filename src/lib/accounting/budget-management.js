import { getAdapter } from '../db/driver.js';
import { verifyAccountingPolicySchema, readAccountingPolicy, updateAccountingPolicyMutation } from '../db/helpers/accounting-policy.js';
import { validateKeyBindings } from '../db/helpers/api-key-bindings.js';
import { verifyAccountingSchemaRows } from '../db/migrations/002-accounting-foundation.js';
import { budgetInstant, serverBudgetClock } from './budget-windows.js';
import { parseBudgetPolicy } from './budget-policy.js';
import { projectBudget } from './budget-projection.js';
import { unavailable, timestamp } from './attempt-payload.js';

const fixtures = new WeakMap();
const fail = (status,code,message) => Object.assign(new Error(message),{status,code});

// No production caller. Test composition owns the exact Next-delivered Request;
// headers/body/env/settings/timestamps cannot manufacture this private capability.
export function associateBudgetManagementFixture(request, db, {clock=serverBudgetClock,coverageStartedAt}={}) {
  if(fixtures.has(request)||!db?.ownerInstanceId||!db.coverage)throw unavailable('Invalid budget fixture association');
  timestamp(coverageStartedAt);budgetInstant(clock);
  fixtures.set(request,Object.freeze({db,clock,coverageStartedAt,lifetime:db.ownerInstanceId}));
}
export async function captureBudgetManagement(request) {
  const fixture=fixtures.get(request);
  if(fixture){fixtures.delete(request);return fixture;}
  return {db:await getAdapter(),clock:serverBudgetClock,coverageStartedAt:null,lifetime:null};
}
function identity(db,id,{write=false}={}) {
  const health=db.health();
  if(!health.healthy||!health.owned||health.closed||!db.ownerInstanceId||!db.coverage)throw unavailable();
  verifyAccountingPolicySchema(db);
  verifyAccountingSchemaRows(db.all("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')"));
  const key=db.get('SELECT * FROM apiKeys WHERE id=?',[id]),binding=db.get('SELECT * FROM apiKeyBindings WHERE apiKeyId=?',[id]);
  if(!binding){if(!key)throw fail(404,'api_key_not_found','Key not found');throw unavailable('Retained binding unavailable');}
  const coverage=db.coverage.status(id);
  if(binding.retiredAt){
    const retired=db.coverage.retiredBindings().find(entry=>entry.apiKeyId===id);
    if(!retired||retired.fingerprint!==binding.fingerprint||key&&db.coverage.fingerprint(key.key)!==binding.fingerprint)throw unavailable('Retired identity mismatch');
  }else if(key)validateKeyBindings(db,db.coverage,[key]);
  else throw unavailable('Retained identity unavailable');
  const policy=readAccountingPolicy(db,id);
  const active=!!key&&key.isActive===1&&!binding.retiredAt;
  if(write&&!active)throw fail(409,'api_key_inactive','API key is inactive or retired');
  if(write&&coverage.maintenance)throw unavailable('Accounting maintenance active');
  return {active,retired:!!binding.retiredAt,policy,coverage};
}
function project(capability,id,view,now) {
  const {db}=capability;
  if(capability.lifetime!==null&&capability.lifetime!==db.ownerInstanceId)throw unavailable('Fixture lifetime changed');
  const projection=projectBudget(db,id,view.policy,now);
  const gapCount=view.coverage.gaps.filter(gap=>!gap.resolvedAt).length;
  const healthy=db.health().healthy;
  const enforcementActive=capability.lifetime!==null;
  let blockReason=null;
  if(!view.active)blockReason='api_key_inactive';
  else if(!healthy||view.coverage.maintenance||gapCount)blockReason='api_key_accounting_unavailable';
  else if(!view.policy.unlimited&&projection.unresolvedCount)blockReason='api_key_accounting_unresolved';
  else if(projection.weekly.exhausted||projection.monthly.exhausted)blockReason='api_key_budget_exceeded';
  return {apiKeyId:id,active:view.active,retired:view.retired,version:view.policy.version,updatedAt:view.policy.updatedAt,
    ...projection,health:{healthy,gapCount,maintenance:!!view.coverage.maintenance},
    ledgerStartedAt:db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")?.value??null,
    coverageStartedAt:capability.coverageStartedAt,enforcementActive,canSetFinite:enforcementActive&&view.active&&healthy&&!gapCount&&!view.coverage.maintenance,
    scope:enforcementActive?'selected compatible chat fixture':'inactive; no production accounting coverage',
    referenceLabel:'Virtual reference cost, not an invoice',softThreshold:true,
    accountingPolicy:'durable-evidence-recorded-spend',mayUndercount:true,
    eligibility:{eligible:enforcementActive&&!blockReason,blockReason:!enforcementActive?'accounting_not_ready':blockReason}};
}
export function getBudgetManagement(capability,id) {
  const {db}=capability;
  // Read a coherent published snapshot; never silently repair missing authority.
  return db.durableTransaction(()=>{const view=identity(db,id);return project(capability,id,view,budgetInstant(capability.clock));});
}
export function putBudgetManagement(capability,id,body) {
  const parsed=parseBudgetPolicy(body),{db}=capability;
  return db.durableTransaction(()=>{
    const view=identity(db,id,{write:true}),now=budgetInstant(capability.clock);
    if(capability.lifetime!==null&&capability.lifetime!==db.ownerInstanceId)throw unavailable('Fixture lifetime changed');
    // Explicit precedence: authority/identity, version, readiness, CAS mutation.
    if(view.policy.version!==parsed.expectedVersion)throw fail(409,'budget_policy_conflict','Budget policy conflict');
    const finite=parsed.weeklyLimitNanoUsd!==null||parsed.monthlyLimitNanoUsd!==null;
    if(finite){
      if(capability.lifetime===null)throw fail(409,'accounting_not_ready','Production accounting is not ready');
      if(view.coverage.maintenance||view.coverage.gaps.some(gap=>!gap.resolvedAt))throw unavailable('Accounting coverage unavailable');
    }
    updateAccountingPolicyMutation(db,id,parsed,now);
    return project(capability,id,identity(db,id),now);
  });
}
