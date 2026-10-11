import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { captureAccountingCommandCodeConfig } from 'open-sse/config/accountedCommandCodeDispatch.js';
import { captureCommandCodeChatConversion } from 'open-sse/config/accountedCommandCodeChatCapture.js';
import { captureAccountingProxyEnvironment } from 'open-sse/config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from 'open-sse/config/accountedBaseDispatch.js';
import { observeCommandCodeInitialFailure } from 'open-sse/utils/accountedCommandCodeInitialFailure.js';
import { routeAccountingCommandCodeResponse } from 'open-sse/utils/accountingCommandCodeResponseRoute.js';
import { createAccountedOpenaiStream } from 'open-sse/utils/accountedOpenaiStream.js';
import { createAccountingCommandCodeNdjsonParser } from 'open-sse/utils/accountingCommandCodeNdjsonParser.js';

let db, directory, createAccounting;
const previous = process.env.DATA_DIR, model = 'deepseek/deepseek-v4-pro';
const prepared = (chat = false) => {
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const body = { threadId: '11111111-1111-4111-8111-111111111111', memory: '',
    config: { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } };
  const capture = chat ? captureCommandCodeChatConversion({ body: { model, stream: true, max_tokens: 64, temperature: 0.3,
    messages: [{ role: 'user', content: 'fixture prompt' }] }, model, stream: true,
    credentials: { apiKey: 'dummy-api-key', accessToken: null, connectionId: 'c', providerSpecificData: {} },
    config: structuredClone(PROVIDERS.commandcode), providerOverrides: null, proxyOptions: null,
    runtime: { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux' } }, () => body) : null;
  return snapshotAccountingPreparedData({ ...(chat ? { commandCodeChatCapture: capture } : {}), protocol: 'native-commandcode', url: 'https://api.commandcode.ai/alpha/generate',
    headers: { ...PROVIDERS.commandcode.headers, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer dummy-api-key', 'x-session-id': sessionId },
    credentials: { apiKey: 'dummy-api-key', accessToken: null, connectionId: 'c', providerSpecificData: {} }, providerOverrides: null, proxyOptions: null,
    proxyEnvironment: captureAccountingProxyEnvironment(), commandCodeTransport: { model, mode: 'native-commandcode-ndjson',
      commandCodeConfig: captureAccountingCommandCodeConfig(PROVIDERS.commandcode), sessionId, serializedBody: JSON.stringify(body) } });
};
beforeEach(async () => {
  vi.resetModules(); directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-commandcode-failure-service-')); process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }], settings: { requireApiKey: true },
    providerConnections: [{ id: 'c', provider: 'commandcode', authType: 'apikey', apiKey: 'dummy-api-key', providerSpecificData: {} }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','commandcode',?)", [JSON.stringify({ [model]: { input: '1', output: '2' } })]);
  });
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/chat/completions', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(() => { vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });

describe('posted failure observer with actual queued service (manual admitted seam, not executor/socket)', { timeout: 20000 }, () => {
  it.each(['clean-eof', 'trailing-event'])('routed error retains raw EOF ownership through actual completion: %s', async mode => {
    const context = await createAccounting(), wire = prepared(true);
    const attempt = await context.beforeAttempt({ provider: 'commandcode', model, endpoint: 'chat', connectionId: 'c' }, true, wire);
    let controller, entered; const awaitingTail = new Promise(resolve => { entered = resolve; });
    const raw = JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture error' } }) + '\n';
    const post = vi.fn(() => new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(new TextEncoder().encode(raw)); }, pull() { entered(); } }, { highWaterMark: 0 })));
    const upstream = post(), reader = vi.spyOn(upstream.body, 'getReader'), selected = await routeAccountingCommandCodeResponse(upstream);
    expect(selected.kind).toBe('initial-error');
    const complete = vi.fn((...args) => context.completeAttempt(...args)), gate = vi.fn(() => context.gate());
    const work = observeCommandCodeInitialFailure(selected.response, { attempt, accounting: { ...context, completeAttempt: complete, gate } }).then(value => ({ value }), error => ({ error }));
    try {
      await awaitingTail; expect(complete).not.toHaveBeenCalled(); expect(gate).not.toHaveBeenCalled();
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      if (mode === 'trailing-event') controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'start' }) + '\n'));
    } finally { controller.close(); }
    const result = await work;
    if (mode === 'clean-eof') expect(result.value).toEqual({ statusCode: 503, usage: null });
    else expect(result.error).toBeInstanceOf(Error);
    expect(complete).toHaveBeenCalledTimes(1); expect(gate).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledTimes(1); expect(upstream.body.locked).toBe(false);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: mode === 'clean-eof' ? 'failed' : 'network_unknown', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it('routed success preserves raw bytes and original price while own completion ACK withholds terminal', async () => {
    const context = await createAccounting(), wire = prepared(true);
    const attempt = await context.beforeAttempt({ provider: 'commandcode', model, endpoint: 'chat', connectionId: 'c' }, true, wire);
    db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='commandcode'", [JSON.stringify({ [model]: { input: '9', output: '9' } })]));
    const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, reasoningTokens: 0 };
    const raw = [{ type: 'start' }, { type: 'start-step' }, { type: 'text-start', id: 'fixture' }, { type: 'text-delta', id: 'fixture', text: 'fixture text' },
      { type: 'text-end', id: 'fixture' }, { type: 'finish-step', finishReason: 'stop', usage }, { type: 'finish', finishReason: 'stop', totalUsage: usage }].map(event => JSON.stringify(event) + '\n').join('');
    const post = vi.fn(() => new Response(raw)), upstream = post(), reader = vi.spyOn(upstream.body, 'getReader');
    const selected = await routeAccountingCommandCodeResponse(upstream); expect(selected.kind).toBe('success');
    let enter, release; const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const complete = vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); enter(); await held; return terminal; });
    const authorize = vi.fn(terminal => context.assertSuccessfulTerminal(terminal));
    const body = createAccountedOpenaiStream(selected.response, { attempt, accounting: { ...context, completeAttempt: complete, assertSuccessfulTerminal: authorize }, parserFactory: createAccountingCommandCodeNdjsonParser });
    let ended = false; const consumed = new Response(body).text().then(text => { ended = true; return text; });
    try {
      await installed; expect(ended).toBe(false); expect(authorize).not.toHaveBeenCalled();
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 140000 }]);
    } finally { release(); }
    expect(await consumed).toBe(raw); expect(authorize).toHaveBeenCalledTimes(1); expect(complete).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1); expect(upstream.body.locked).toBe(false);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['key-rotation', 'capture-drift'])('captured Chat admission refuses %s before intent/mock POST', async kind => {
    const context = await createAccounting(), wire = structuredClone(prepared(true)), post = vi.fn();
    if (kind === 'capture-drift') {
      wire.commandCodeChatCapture.original.body.messages[0].content = 'changed';
      await expect(context.beforeAttempt({ provider: 'commandcode', model, endpoint: 'chat', connectionId: 'c' }, true, wire).then(post)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    } else {
      const admission = context.beforeAttempt({ provider: 'commandcode', model, endpoint: 'chat', connectionId: 'c' }, true, wire);
      db.durableTransaction(() => {
        const row = db.get('SELECT data FROM providerConnections WHERE id=?', ['c']);
        db.run('UPDATE providerConnections SET data=? WHERE id=?', [JSON.stringify({ ...JSON.parse(row.data), apiKey: 'dummy-rotated' }), 'c']);
      });
      await expect(admission.then(post)).rejects.toMatchObject({ code: 'api_key_accounting_unavailable' });
    }
    expect(post).not.toHaveBeenCalled(); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each([
    ['native', 'deliver'], ['native', 'lost-delivery'], ['native', 'budgeted'],
    ['captured-chat', 'deliver'], ['captured-chat', 'lost-delivery'], ['captured-chat', 'budgeted'],
  ])('%s own unresolved ledger ACK/gate: %s', async (format, mode) => {
    if (mode === 'budgeted') {
      const context = await (await import('@/lib/apiKeyBudget/service.js')).createBudgetContext('a', { adapter: async () => db });
      context.updatePolicy({ weeklyLimitUsd: '100', monthlyLimitUsd: '100', expectedVersion: 0 });
    }
    const context = await createAccounting(), wire = prepared(format === 'captured-chat');
    const attempt = await context.beforeAttempt({ provider: 'commandcode', model, endpoint: 'chat', connectionId: 'c' }, true, wire);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'pending', costNanoUsd: null }]);
    const post = vi.fn(() => {
      expect(db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      return new Response(`${JSON.stringify({ type: 'error', error: { statusCode: 503, message: 'fixture posted failure' } })}\n`);
    });
    const upstream = post(wire); // Independent manual admitted POST mock, not legacy execute integration.
    let enter, release;
    const installed = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const lost = new Error('fixture lost actual failure completion handle');
    const complete = vi.fn(async (...input) => {
      const terminal = await context.completeAttempt(...input); enter(); await held;
      if (mode === 'lost-delivery') throw lost;
      return terminal;
    });
    const gate = vi.fn(() => context.gate());
    let returned = false;
    const work = observeCommandCodeInitialFailure(upstream, { attempt, accounting: { ...context, completeAttempt: complete, gate } })
      .then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      await installed; expect(returned).toBe(false); expect(gate).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(1);
      expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    } finally { release(); }
    const result = await work;
    if (mode === 'deliver') expect(result.value).toEqual({ statusCode: 503, usage: null });
    else if (mode === 'lost-delivery') { expect(result.error).toBe(lost); expect(gate).not.toHaveBeenCalled(); }
    else expect(result.error).toMatchObject({ code: 'api_key_accounting_unresolved' });
    expect(complete).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1);
    expect(db.all('SELECT state,outcome,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'unresolved', outcome: 'failed', costNanoUsd: null }]);
    expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
});
