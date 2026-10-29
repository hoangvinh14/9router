import { describe, expect, it } from 'vitest';
import { budgetError, budgetErrorResponse, isBudgetError } from '../../src/lib/accounting/budget-errors.js';

describe('trusted local budget envelopes',()=>{
  it('uses latest reset of both blocked windows; zero header is advisory',async()=>{
    const error=budgetError('api_key_budget_exceeded',{requestId:'server-request',now:'2026-10-25T16:00:00.000Z',blockedWindows:[
      {dimension:'weekly',resetAt:'2026-10-25T17:00:00.000Z',limitUsd:'0',spentUsd:'0'},
      {dimension:'monthly',resetAt:'2026-10-31T17:00:00.000Z',limitUsd:'1',spentUsd:'2'},
    ]});
    expect(error.retryAfter).toBe(522000);const response=budgetErrorResponse(error);
    expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('522000');expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-request-id')).toBe('server-request');
    expect((await response.json()).error).toMatchObject({code:'api_key_budget_exceeded',requestId:'server-request',requiresPolicyChange:true,resetAt:'2026-10-31T17:00:00.000Z',timezone:'Asia/Ho_Chi_Minh'});
  });
  it('copied/upstream code and internal error text are not authority',async()=>{
    const original=budgetError('api_key_accounting_unresolved');expect(isBudgetError(original)).toBe(true);expect(isBudgetError({...original})).toBe(false);
    const response=budgetErrorResponse(Object.assign(new Error('SQL secret details'),{status:429,code:'api_key_budget_exceeded',metadata:{requestId:'client-request'}}));
    expect(response.status).toBe(503);const text=await response.text();expect(text).toContain('api_key_accounting_unavailable');expect(text).not.toContain('SQL');expect(text).not.toContain('client-request');expect(response.headers.get('retry-after')).toBeNull();
  });
  it.each(['api_key_accounting_unresolved','api_key_accounting_unavailable','model_pricing_unavailable','model_accounting_unsupported'])('%s does not invent Retry-After',code=>{
    const response=budgetErrorResponse(budgetError(code));expect(response.status).toBe(503);expect(response.headers.get('retry-after')).toBeNull();expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});
