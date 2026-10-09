import { describe, it, expect } from 'vitest';
import { globalRecoveryDraft, validateRetainedGlobalRecovery, validateGlobalRecoveryAcknowledgement } from '@/shared/utils/globalAccountingDraft.js';
const reason = 'reviewed', evidence = 'independent evidence';
const gap = { kind: 'gap', row: { id: 'global-a', scope: 'global', generation: 4 } };
const maintenance = { kind: 'maintenance', row: { generation: 7 } };
const receipt = (kind, operationId = 'operation') => kind === 'gap'
  ? { version: 1, kind, action: 'coverage_waiver', apiKeyId: null, targetId: 'global-a', generation: 4, operationId }
  : { version: 1, kind, action: 'maintenance_release', generation: 7, operationId, releasedAt: '2026-10-03T00:00:00.000Z' };
describe('global recovery immutable draft and acknowledgement', () => {
  it.each([gap, maintenance])('retains exact target for $kind with isolated frozen input', target => {
    const input = globalRecoveryDraft(target, { reason, evidence }, 'operation');
    expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen(input.payload)).toBe(true);
    const restored = validateRetainedGlobalRecovery(JSON.parse(JSON.stringify(input))); expect(restored).toEqual(input);
    expect(validateGlobalRecoveryAcknowledgement({ recoveryReceipt: receipt(target.kind), maintenance: { generation: 99 }, gaps: [{ generation: 100 }] }, restored)).toEqual(receipt(target.kind));
  });
  it('rejects key scope, resolved global targets, missing generation and unbounded text', () => {
    for (const target of [{ ...gap, row: { ...gap.row, scope: 'key' } }, { ...gap, row: { ...gap.row, resolvedAt: 'now' } }, { ...maintenance, row: {} }]) expect(() => globalRecoveryDraft(target, { reason, evidence }, 'operation')).toThrow();
    expect(() => globalRecoveryDraft(gap, { reason, evidence: 'x'.repeat(4001) }, 'operation')).toThrow();
  });
  it.each([gap, maintenance])('denies retained tampering $kind before dispatch', target => {
    const original = globalRecoveryDraft(target, { reason, evidence }, 'operation');
    for (const mutate of [value => value.url = 'https://attacker.example', value => value.url += '?activate=true', value => value.payload.actor = 'forged', value => value.payload.expectedGeneration = 0, value => value.payload.reason = '', value => value.extra = true]) {
      const bad = structuredClone(original); mutate(bad); expect(() => validateRetainedGlobalRecovery(bad)).toThrow();
    }
  });
  it.each([gap, maintenance])('denies echo-only or mismatched receipt $kind before cleanup', target => {
    const retained = globalRecoveryDraft(target, { reason, evidence }, 'operation');
    expect(() => validateGlobalRecoveryAcknowledgement({ maintenance: null, operationId: 'operation' }, retained)).toThrow();
    for (const mutate of [r => r.operationId = 'other', r => r.generation++, r => r.action = 'activate', r => r.actor = 'private', r => r.kind = 'attempt']) {
      const bad = receipt(target.kind); mutate(bad); expect(() => validateGlobalRecoveryAcknowledgement({ recoveryReceipt: bad }, retained)).toThrow();
    }
  });
  it('denies wrong gap/key scope and malformed maintenance timestamp', () => {
    const a = globalRecoveryDraft(gap, { reason, evidence }, 'operation'), b = globalRecoveryDraft(maintenance, { reason, evidence }, 'operation');
    for (const r of [{ ...receipt('gap'), apiKeyId: 'key' }, { ...receipt('gap'), targetId: 'different' }]) expect(() => validateGlobalRecoveryAcknowledgement({ recoveryReceipt: r }, a)).toThrow();
    for (const value of ['now', '2026-10-03', null]) expect(() => validateGlobalRecoveryAcknowledgement({ recoveryReceipt: { ...receipt('maintenance'), releasedAt: value } }, b)).toThrow();
  });
});
