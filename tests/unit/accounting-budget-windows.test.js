import { describe, expect, it } from 'vitest';
import { budgetWindows, budgetInstant, BUDGET_TIMEZONE } from '../../src/lib/accounting/budget-windows.js';

describe('fixed HCM calendar windows',()=>{
  it.each([
    ['2026-10-25T16:59:59.999Z','2026-10-18T17:00:00.000Z','2026-10-25T17:00:00.000Z','2026-09-30T17:00:00.000Z','2026-10-31T17:00:00.000Z'],
    ['2026-10-25T17:00:00.000Z','2026-10-25T17:00:00.000Z','2026-11-01T17:00:00.000Z','2026-09-30T17:00:00.000Z','2026-10-31T17:00:00.000Z'],
    ['2026-10-25T17:00:00.001Z','2026-10-25T17:00:00.000Z','2026-11-01T17:00:00.000Z','2026-09-30T17:00:00.000Z','2026-10-31T17:00:00.000Z'],
    ['2026-10-31T16:59:59.999Z','2026-10-25T17:00:00.000Z','2026-11-01T17:00:00.000Z','2026-09-30T17:00:00.000Z','2026-10-31T17:00:00.000Z'],
    ['2026-10-31T17:00:00.000Z','2026-10-25T17:00:00.000Z','2026-11-01T17:00:00.000Z','2026-10-31T17:00:00.000Z','2026-11-30T17:00:00.000Z'],
    ['2026-10-31T17:00:00.001Z','2026-10-25T17:00:00.000Z','2026-11-01T17:00:00.000Z','2026-10-31T17:00:00.000Z','2026-11-30T17:00:00.000Z'],
    ['2027-01-31T17:00:00.000Z','2027-01-31T17:00:00.000Z','2027-02-07T17:00:00.000Z','2027-01-31T17:00:00.000Z','2027-02-28T17:00:00.000Z'],
    ['2024-02-28T17:00:00.000Z','2024-02-25T17:00:00.000Z','2024-03-03T17:00:00.000Z','2024-01-31T17:00:00.000Z','2024-02-29T17:00:00.000Z'],
    ['2024-02-29T17:00:00.000Z','2024-02-25T17:00:00.000Z','2024-03-03T17:00:00.000Z','2024-02-29T17:00:00.000Z','2024-03-31T17:00:00.000Z'],
    ['2026-12-31T17:00:00.000Z','2026-12-27T17:00:00.000Z','2027-01-03T17:00:00.000Z','2026-12-31T17:00:00.000Z','2027-01-31T17:00:00.000Z'],
  ])('%s selects exact UTC half-open windows',(now,ws,we,ms,me)=>{
    const result=budgetWindows(now);expect(result.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(result.weekly).toEqual({startAt:ws,resetAt:we});expect(result.monthly).toEqual({startAt:ms,resetAt:me});
    for(const dimension of ['weekly','monthly']){
      expect(result.previousWindows[dimension].resetAt).toBe(result[dimension].startAt);
      expect(result.previousWindows[dimension].startAt<result[dimension].startAt).toBe(true);
    }
  });
  it('is independent of host timezone',()=>{
    const prior=process.env.TZ;try{const results=[];for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){process.env.TZ=zone;results.push(budgetWindows('2026-10-25T17:00:00.000Z'));}expect(results[1]).toEqual(results[0]);expect(results[2]).toEqual(results[0]);}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
  });
  it.each([null,undefined,NaN,0,new Date(),'bad','2026-02-30T00:00:00.000Z','2026-10-28T00:00:00Z'])('rejects noncanonical clock %s',value=>{expect(()=>budgetWindows(value)).toThrow();});
  it('validates synchronous clock and fixed timezone',()=>{
    expect(budgetInstant(()=> '2026-10-28T00:00:00.000Z')).toBe('2026-10-28T00:00:00.000Z');
    expect(()=>budgetInstant(async()=> '2026-10-28T00:00:00.000Z')).toThrow();
    expect(()=>budgetWindows('2026-10-28T00:00:00.000Z','UTC')).toThrow();expect(BUDGET_TIMEZONE).toBe('Asia/Ho_Chi_Minh');
  });
});
