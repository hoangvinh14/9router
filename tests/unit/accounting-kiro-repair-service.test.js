import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingKiroConfig } from 'open-sse/config/accountedKiroDispatch.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from 'open-sse/config/accountedBaseDispatch.js';
import { captureKiroEllipsisRepairConversion } from 'open-sse/config/accountedKiroRepairConversion.js';
import { observeAccountingKiroRepairGeneration } from 'open-sse/utils/accountedKiroRepairGeneration.js';
import { concatFixtureBytes, fixtureKiroEvent } from '../helpers/accountingKiroFrames.js';

let db, directory, createAccounting;
const previous = process.env.DATA_DIR, model = 'claude-sonnet-4.5';
const original = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const prepared = () => {
  const invocationId = '22222222-2222-4222-8222-222222222222', headers = new Headers(PROVIDERS.kiro.headers);
  for (const [key, value] of Object.entries({ 'Amz-Sdk-Request': 'attempt=1; max=3', 'Amz-Sdk-Invocation-Id': invocationId,
    Authorization: 'Bearer dummy-api-key', TokenType: 'API_KEY', 'x-amz-sso-bearer': 'dummy-api-key',
    'x-amzn-kiro-agent-mode': 'spec', 'x-amzn-codewhisperer-machine-id': 'kiro-desktop' })) headers.set(key, value);
  return snapshotAccountingPreparedData({ protocol: 'native-kiro', url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    headers: Object.fromEntries(headers), credentials: { apiKey: null, accessToken: 'dummy-api-key', connectionId: 'c', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } },
    providerOverrides: null, proxyOptions: null, proxyEnvironment: captureAccountingProxyEnvironment(),
    kiroTransport: { model, mode: 'native-kiro-eventstream', kiroConfig: captureAccountingKiroConfig(PROVIDERS.kiro), invocationId, serializedBody: JSON.stringify(original()) } });
};
const repairWire = () => {
  const wire = structuredClone(prepared()), body = original(), actual = structuredClone(body);
  actual.conversationState.currentMessage.userInputMessage.content += '\n\nRetry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
  wire.kiroRepairCapture = captureKiroEllipsisRepairConversion({ model, original: body, actual });
  wire.kiroTransport.serializedBody = JSON.stringify(actual);
  wire.kiroTransport.invocationId = '33333333-3333-4333-8333-333333333333';
  wire.headers['amz-sdk-invocation-id'] = wire.kiroTransport.invocationId;
  return snapshotAccountingPreparedData(wire);
};
const raw = () => concatFixtureBytes([fixtureKiroEvent('assistantResponseEvent', { content: '...' }),
  fixtureKiroEvent('metricsEvent', { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, reasoningTokens: 0 }),
  fixtureKiroEvent('messageStopEvent', { stopReason: 'end_turn' })]);
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-kiro-repair-service-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'kiro', authType: 'apikey', apiKey: null, accessToken: 'dummy-api-key', providerSpecificData: { authMethod: 'api_key', region: 'us-east-1' } }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','kiro',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });

describe('Kiro raw repair observer actual queued ledger (manual admission/mock POST, not legacy loop)', { timeout: 20000 }, () => {
  it('manual successor repair admission retains full capture and takes fresh price without rewriting predecessor', async () => {
    const context = await createAccounting(), meta = { provider: 'kiro', model, endpoint: 'chat', connectionId: 'c' };
    const predecessor = await context.beforeAttempt(meta, true, prepared());
    const first = await observeAccountingKiroRepairGeneration(new Response(raw()), { accounting: context, attempt: predecessor });
    expect(first.repairKind).toBe('ellipsis');
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='kiro'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
    const wire = repairWire(), successor = await context.beforeAttempt(meta, true, wire);
    expect(successor.unrecorded).toBeFalsy(); expect(successor.attemptId).not.toBe(predecessor.attemptId);
    expect(wire.kiroRepairCapture.actual).toEqual(JSON.parse(wire.kiroTransport.serializedBody));
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [successor.attemptId])).toEqual({ state: 'pending', costNanoUsd: null });
    const post = vi.fn(() => new Response(raw()));
    await observeAccountingKiroRepairGeneration(post(wire), { accounting: context, attempt: successor });
    expect(post).toHaveBeenCalledTimes(1);
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [predecessor.attemptId])).toEqual({ state: 'settled', costNanoUsd: 140000 });
    expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting WHERE attemptId=?', [successor.attemptId])).toEqual({ state: 'settled', costNanoUsd: 1080000 });
    expect(db.all('SELECT attemptId FROM apiKeyAccounting')).toHaveLength(2); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['capture-drift', 'dequeue-token-rotation'])('accepted repair capture then %s refuses actual queued admission before mock POST', async mode => {
    const context = await createAccounting(), meta = { provider: 'kiro', model, endpoint: 'chat', connectionId: 'c' }, post = vi.fn();
    const positive = await context.beforeAttempt(meta, true, repairWire());
    expect(positive.unrecorded).toBeFalsy(); await observeAccountingKiroRepairGeneration(new Response(raw()), { accounting: context, attempt: positive });
    const wire = structuredClone(repairWire());
    if (mode === 'capture-drift') wire.kiroRepairCapture.original.inferenceConfig.maxTokens = 101;
    const admission = context.beforeAttempt(meta, true, wire).then(post);
    if (mode === 'dequeue-token-rotation') db.durableTransaction(() => {
      const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
      db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), accessToken: 'dummy-rotated' }), 'c']);
    });
    await expect(admission).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    expect(post).not.toHaveBeenCalled();
    expect(db.all('SELECT attemptId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ attemptId: positive.attemptId, state: 'settled', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['deliver', 'lost-delivery', 'budgeted', 'abort-after-settlement'])('own exact settlement ACK before ellipsis repair disposition: %s', async mode => {
    if (mode === 'budgeted') {
      const policy = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
      policy.updatePolicy({ weeklyLimitUsd: '0.00014', monthlyLimitUsd: '0.00014', expectedVersion: 0 });
    }
    const context = await createAccounting(), wire = prepared();
    const attempt = await context.beforeAttempt({ provider: 'kiro', model, endpoint: 'chat', connectionId: 'c' }, true, wire);
    expect(attempt.unrecorded).toBeFalsy();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='kiro'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
    const post = vi.fn(() => new Response(raw()));
    const upstream = post(wire), reader = vi.spyOn(upstream.body, 'getReader'), signal = new AbortController();
    let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('fixture lost actual Kiro repair completion handle');
    const complete = vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter(); await held;
      if (mode === 'lost-delivery') throw lost;
      return terminal;
    });
    const gate = vi.fn(() => context.gate()), authorize = vi.fn(value => context.assertSuccessfulTerminal(value));
    let returned = false;
    const work = observeAccountingKiroRepairGeneration(upstream, { attempt, signal: signal.signal,
      accounting: { ...context, completeAttempt: complete, gate, assertSuccessfulTerminal: authorize } })
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(gate).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', outcome: 'success', costNanoUsd: 140000 }]);
      if (mode === 'abort-after-settlement') signal.abort(false);
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') { expect(result.value.repairKind).toBe('ellipsis'); expect(result.value.bytes).toEqual(raw()); expect(gate).toHaveBeenCalledTimes(1); expect(authorize).toHaveBeenCalledTimes(1); }
    if (mode === 'lost-delivery') { expect(result.error).toBe(lost); expect(gate).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled(); }
    if (mode === 'budgeted') { expect(result.error).toMatchObject({ code: 'api_key_budget_exceeded' }); expect(gate).toHaveBeenCalledTimes(1); expect(authorize).toHaveBeenCalledTimes(1); }
    if (mode === 'abort-after-settlement') { expect(result.error).toBe(false); expect(gate).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled(); }
    expect(complete).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1); expect(reader).toHaveBeenCalledTimes(1); expect(upstream.body.locked).toBe(false);
    expect(db.all('SELECT attemptId,state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ attemptId: attempt.attemptId, state: 'settled', outcome: 'success', costNanoUsd: 140000 }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
