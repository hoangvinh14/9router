import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { once } from 'node:events';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { POST as postResponses } from '../../src/app/api/v1/responses/route.js';
import { handleAccountedChatCandidate } from '../../src/sse/handlers/chat.js';
import { createNodeSqliteAdapter } from '../../src/lib/db/adapters/nodeSqliteAdapter.js';
import { TABLES, buildCreateTableSql } from '../../src/lib/db/schema.js';
import { bindAccountingIdentity } from '../../src/lib/accounting/installed-service.js';
import { createNodeAttemptLedger, initializeNodeAttemptLedger } from '../../src/lib/accounting/node-attempt-ledger.js';
import { createNodeKeyPolicy, initializeNodeKeyPolicy } from '../../src/lib/accounting/node-key-policy.js';
import { createAnthropicDispatchContext } from '../../src/lib/accounting/anthropic-dispatch-context.js';
import { handleChatCore } from '../../open-sse/handlers/chatCore.js';
import { CodexExecutor } from '../../open-sse/executors/codex.js';
import { handleStreamingResponse } from '../../open-sse/handlers/chatCore/streamingHandler.js';
import { FORMATS } from '../../open-sse/translator/formats.js';
import { createStreamController } from '../../open-sse/utils/streamHandler.js';
import { isAccountingResponse } from '../../open-sse/utils/accountingResponse.js';

const restartCases = {
  clean: { attempts: 1, terminals: 1 },
  'before-intent-commit': { attempts: 0, terminals: 0 },
  'after-intent-ack': { attempts: 1, terminals: 0 },
  'before-response-read': { attempts: 1, terminals: 0 },
  'during-response-read': { attempts: 1, terminals: 0 },
  'before-terminal-commit': { attempts: 1, terminals: 0 },
  'after-terminal-commit': { attempts: 1, terminals: 1 },
  'after-response': { attempts: 1, terminals: 1 },
};
const [stage, stageDir, checkpoint] = process.argv.slice(2);
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.ok(process.env.BUDGET_OUTER_NET);
if (stage !== undefined) {
  assert.equal(process.argv.length, 5);
  assert.ok(['--restart-write', '--restart-read'].includes(stage));
  assert.ok(checkpoint === 'codex' || Object.hasOwn(restartCases, checkpoint));
  assert.match(stageDir, /^\/tmp\/budget-restart-[A-Za-z0-9]+$/);
  assert.equal(fs.realpathSync(stageDir), stageDir);
  assert.equal(fs.statSync(stageDir).isDirectory(), true);
}
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
const tls = process.env.BUDGET_COMPOSED_TLS === '1';
if (tls) {
  assert.notEqual(fs.readlinkSync('/proc/self/ns/user'), process.env.BUDGET_OUTER_USER);
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    assert.match(status, new RegExp(`^${key}:\\s+0+$`, 'm'));
  }
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  assert.equal(process.env.NODE_EXTRA_CA_CERTS, '/tmp/composed-cert.pem');
}
const model = 'claude-sonnet-4-6';
const now = '2026-11-16T10:00:00.000Z';
const body = { stream: false, inference_geo: 'global', service_tier: 'standard_only', max_tokens: 123,
  messages: [{ role: 'user', content: 'fixture prompt' }] };
const workspaceBinding = { scope: 'single-workspace', workspaceId: 'wrkspc_fixture', connectionId: 'fixture-account',
  keyDigest: createHash('sha256').update('fixture-upstream').digest('hex') };
const usage = {
  input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 9,
  cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 5 },
};

const partialJson = '{"type":"message",';

async function startLoopback(state, reply, interrupted, partialResponse, {
  pathname = '/v1/messages', headerNames = ['anthropic-version', 'content-type', 'x-api-key'],
} = {}) {
  const server = https.createServer({ key: fs.readFileSync('/tmp/composed-key.pem'), cert: fs.readFileSync('/tmp/composed-cert.pem') });
  server.on('request', (req, res) => {
    // Count at actual HTTP ingress, even if the body is malformed or cut short.
    const wire = { headers: Object.fromEntries(headerNames.map(name => [name, req.headers[name]])), body: null };
    state.wire.push(wire);
    (async () => {
      assert.equal(req.socket.encrypted, true);
      assert.equal(req.socket.remoteAddress, '127.0.0.1');
      assert.equal(req.method, 'POST');
      assert.equal(req.url, pathname);
      assert.equal(req.headers['anthropic-beta'], undefined);
      assert.equal(req.headers['anthropic-workspace-id'], undefined);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      wire.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (partialResponse) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write(partialJson);
        return; // Leave the response open until the writer process is killed.
      }
      if (interrupted) {
        res.writeHead(401, { 'content-type': 'application/json', 'content-length': 100 });
        state.interrupt = () => res.destroy();
        res.write('{'); // Deliver real response headers and truncated JSON.
        return;
      }
      const response = reply();
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    })().catch(error => { state.serverError = error; res.destroy(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  state.endpoint = `https://127.0.0.1:${server.address().port}${pathname}`;
  return async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  };
}

async function fixture(run, { weekly = null, monthly = null, reply, interrupted = false, prepareDb, beforeFinalBegin,
  sharedDir, existing = false, stream = false, onCheckpoint = () => {}, partialResponse = false, clock = () => now, profile = null } = {}) {
  const dir = sharedDir ?? fs.mkdtempSync('/tmp/budget-composed-');
  const path = `${dir}/budget.sqlite`;
  let db, closeLoopback, peer, atFinal = false;
  let accounts = 0, poolReads = 0, finalChanges = 0;
  async function openObservedAdapter() {
    const adapter = await createNodeSqliteAdapter(path);
    const { all, get, exec, run } = adapter;
    let pendingWrite;
    adapter.run = (sql, params) => {
      const result = run(sql, params);
      if (sql.startsWith('INSERT INTO accounting_attempts_v1 ')) pendingWrite = 'intent';
      if (sql.startsWith('INSERT INTO accounting_terminals_v1 ')) pendingWrite = 'terminal';
      return result;
    };
    adapter.all = (sql, params) => {
      if (sql === 'SELECT * FROM providerConnections WHERE provider = ? AND isActive = ?') {
        assert.deepEqual(params, [profile?.provider ?? 'anthropic', 1]);
        accounts++;
      }
      return all(sql, params);
    };
    adapter.get = (sql, params) => {
      const row = get(sql, params);
      if (sql === 'SELECT * FROM proxyPools WHERE id = ?') {
        assert.equal(row?.id, 'fixture-pool');
        poolReads++;
      }
      return row;
    };
    adapter.exec = sql => {
      if (atFinal && sql === 'BEGIN IMMEDIATE' && beforeFinalBegin) {
        beforeFinalBegin(peer);
        finalChanges++;
      }
      const writing = sql === 'COMMIT' ? pendingWrite : undefined;
      if (writing) onCheckpoint(`before-${writing}-commit`);
      const result = exec(sql);
      if (writing) onCheckpoint(`after-${writing}-commit`);
      if (sql === 'COMMIT' || sql === 'ROLLBACK') pendingWrite = undefined;
      return result;
    };
    return adapter;
  }
  function openOwner(presentedSecret = 'fixture-client') {
    const policy = createNodeKeyPolicy(db);
    const ledger = createNodeAttemptLedger(db, { requireAccount: true });
    const bound = bindAccountingIdentity({ ledger, policy }, presentedSecret);
    assert.ok(bound);
    const identity = { ...bound,
      prepare(...args) {
        const attempt = bound.prepare(...args);
        onCheckpoint('after-intent-ack');
        return attempt;
      },
      dispatch(...args) {
        atFinal = true;
        try { return bound.dispatch(...args); }
        finally { atFinal = false; }
      },
    };
    return { policy, ledger, identity };
  }
  try {
    if (existing) {
      assert.equal(fs.realpathSync(path), path);
      assert.equal(fs.statSync(path).isFile(), true);
    }
    db = await openObservedAdapter();
    if (!existing) seedDatabase();
    if (beforeFinalBegin) peer = new DatabaseSync(path);
    let owner = openOwner();
    function seedDatabase() {
      db.exec(`CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT UNIQUE, isActive INTEGER, accessRestricted INTEGER, accessAllow TEXT);
      CREATE TABLE combos(name TEXT PRIMARY KEY, models TEXT);
      CREATE TABLE kv(scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope,key));
      CREATE TABLE providerNodes(id TEXT PRIMARY KEY, type TEXT, data TEXT);
      CREATE TABLE settings(id INTEGER PRIMARY KEY, data TEXT);
      INSERT INTO settings VALUES(1,'{"rtkEnabled":false}');
      INSERT INTO apiKeys VALUES('fixture-key','fixture-client',1,1,'["Root"]');
      INSERT INTO combos VALUES('Root','["Nested","anthropic/unused"]'),('Nested','["fast"]');
      INSERT INTO kv VALUES('modelAliases','fast','"anthropic/${model}"');`);
      for (const name of ['providerConnections', 'proxyPools']) db.exec(buildCreateTableSql(name, TABLES[name]));
      for (const [id, priority, isActive, data] of [
        ['fixture-other', 5, 1, { apiKey: 'fixture-other-key' }],
        ['fixture-disabled', 1, 0, { apiKey: 'fixture-disabled-key' }],
        ['fixture-locked', 2, 1, { apiKey: 'fixture-locked-key', [`modelLock_${model}`]: '2999-01-01T00:00:00.000Z' }],
        ['fixture-account', 4, 1, { apiKey: 'fixture-upstream' }],
      ]) {
        db.run(`INSERT INTO providerConnections (id, provider, authType, priority, isActive, data, createdAt, updatedAt)
          VALUES (?, 'anthropic', 'apikey', ?, ?, ?, ?, ?)`, [id, priority, isActive, JSON.stringify(data), now, now]);
      }
      prepareDb?.(db);
      initializeNodeKeyPolicy(db);
      initializeNodeAttemptLedger(db);
      createNodeKeyPolicy(db).save('fixture-key', 0, { weekly, monthly });
    }
    const state = { db, profile, preparations: 0, contexts: 0, selected: [], wire: [], reads: 0,
      get accounts() { return accounts; },
      get poolReads() { return poolReads; },
      get finalChanges() { return finalChanges; },
      trackRead(response) {
        const text = response.text.bind(response);
        response.text = async () => {
          state.reads++;
          onCheckpoint('before-response-read');
          if (partialResponse) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let received = '';
            while (received.length < partialJson.length) {
              const { done, value } = await reader.read();
              assert.equal(done, false, 'response ended before the partial body arrived');
              received += decoder.decode(value, { stream: true });
            }
            assert.equal(received, partialJson);
            onCheckpoint('during-response-read');
            assert.fail('writer survived the requested checkpoint');
          }
          if (tls && interrupted) state.interrupt();
          return text();
        };
        return response;
      },
      invoke(wire) {
        state.wire.push(wire);
        return state.trackRead(reply());
      },
    };
    if (tls) closeLoopback = await startLoopback(state, reply, interrupted, partialResponse, profile?.provider === 'codex'
      ? { pathname: '/backend-api/codex/responses', headerNames: ['authorization', 'chatgpt-account-id', 'content-type'] }
      : undefined);
    globalThis.routeFixture = state;
    globalThis.__budgetCore = { helpers: 0, peeks: 0, refresh: 0 };
    const chat = (target = 'Root', overrides = {}, headers = {}, pathname = '/v1/messages') => handleAccountedChatCandidate(new Request(`https://fixture.invalid${pathname}`, {
      method: 'POST', headers: { authorization: 'Bearer fixture-client', 'user-agent': 'claude-code fixture', ...headers },
      body: JSON.stringify({ ...body, ...overrides, model: target }),
    }), { identity: owner.identity, createContext({ routeProof, credentials, settings }) {
      state.contexts++;
      state.selected.push(credentials.connectionId);
      assert.equal(settings.rtkEnabled, false);
      return createAnthropicDispatchContext({ identity: owner.identity, routeProof, credentials, clock, stream,
        profile: { enabled: true, producerAdmitted: true, provider: 'anthropic', auth: 'api-key', model, inferenceGeo: 'global',
          serviceTier: 'standard_only', workspaceBinding } });
    } });
    const rows = (reader = db) => ({
      attempts: reader.all('SELECT original FROM accounting_attempts_v1').map(row => JSON.parse(row.original)),
      terminals: reader.all('SELECT amount, evidence FROM accounting_terminals_v1').map(row => ({ amount: row.amount, ...JSON.parse(row.evidence) })),
    });
    async function reopen() {
      assert.equal(peer, undefined, 'fixture must close its only DB connection');
      const closed = db.raw;
      db.close();
      assert.equal(closed.isOpen, false);
      db = await openObservedAdapter();
      assert.notEqual(db.raw, closed);
      state.db = db; // Repository facade uses the reopened adapter as well.
      owner = openOwner(); // No schema initialization or re-seeding on reopen.
    }
    await run({ chat, state, rows, reopen, path,
      rebind: presentedSecret => { owner = openOwner(presentedSecret); },
      inspectPolicy: () => owner.policy.inspect('fixture-key'),
      setMonthly: (version, monthly) => owner.policy.save('fixture-key', version, { weekly: null, monthly }),
      totals: (instant = clock()) => owner.ledger.totals('fixture-key', instant),
    });
    assert.equal(state.serverError, undefined);
    assert.equal(globalThis.__budgetCore.peeks, 0);
    assert.equal(globalThis.__budgetCore.refresh, 0);
  } finally {
    delete globalThis.routeFixture;
    delete globalThis.__budgetCore;
    try {
      await closeLoopback?.();
    } finally {
      peer?.close();
      try {
        db?.close();
        if (db && sharedDir) assert.equal(db.raw.isOpen, false);
      } finally {
        if (sharedDir === undefined) fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}

if (!stage) test('credential committed by a peer before final BEGIN prevents POST without trying the next account', () => fixture(async ({ chat, state, rows, totals }) => {
  const response = await chat();
  assert.equal(response.status, 503);
  assert.equal(isAccountingResponse(response), true);
  assert.deepEqual(state.selected, ['fixture-account']);
  assert.deepEqual([state.accounts, state.preparations, state.finalChanges, state.wire.length, state.reads], [1, 1, 1, 0, 0]);
  assert.equal(rows().attempts.length, 1, 'intent already existed at the final recheck');
  assert.deepEqual(rows().terminals, []);
  assert.equal(totals().monthly, '0');
}, { reply: success, beforeFinalBegin(peer) {
  const result = peer.prepare('UPDATE providerConnections SET data = ? WHERE id = ?').run(
    JSON.stringify({ apiKey: 'fixture-rotated' }), 'fixture-account');
  assert.equal(result.changes, 1);
} }));

if (!stage) test('selected strict proxy pool cannot silently fall through to a direct POST or successor', () => fixture(async ({ chat, state, rows }) => {
  const response = await chat();
  assert.equal(response.status, 503);
  assert.equal(isAccountingResponse(response), true);
  assert.deepEqual(state.selected, ['fixture-account']);
  assert.deepEqual([state.accounts, state.poolReads, state.preparations, state.wire.length], [1, 1, 0, 0]);
  assert.deepEqual(rows(), { attempts: [], terminals: [] });
}, { reply: success, prepareDb(db) {
  db.run('INSERT INTO proxyPools (id, isActive, data, createdAt, updatedAt) VALUES (?, 0, ?, ?, ?)', [
    'fixture-pool', JSON.stringify({ strictProxy: true }), now, now,
  ]);
  db.run('UPDATE providerConnections SET data = ? WHERE id = ?', [
    JSON.stringify({ apiKey: 'fixture-upstream', providerSpecificData: { proxyPoolId: 'fixture-pool' } }), 'fixture-account',
  ]);
} }));

function success() {
  return Response.json({ type: 'message', model, content: [{ type: 'text', text: 'fixture answer' }], usage });
}

if (!stage) test('client workspace header and non-Standard inputs cannot reach TLS or create an intent', () => fixture(async ({ chat, state, rows }) => {
  const workspace = await chat('Root', {}, { 'Anthropic-Workspace-Id': workspaceBinding.workspaceId });
  assert.equal(workspace.status, 503);
  assert.equal(isAccountingResponse(workspace), true);
  assert.deepEqual([state.accounts, state.contexts], [0, 0]);
  for (const tier of [undefined, 'auto', 'priority']) {
    const response = await chat('Root', { service_tier: tier });
    assert.equal(response.status, 503);
    assert.equal(isAccountingResponse(response), true);
  }
  assert.deepEqual([state.preparations, state.wire.length, state.reads], [0, 0, 0]);
  assert.deepEqual(rows(), { attempts: [], terminals: [] });
}, { reply: success }));

const limit = '105900';
if (!stage) test('late response uses the original HCM window and each limit resets independently', () => {
  const dispatchAt = '2026-11-30T16:59:59.999Z';
  const monthReset = '2026-11-30T17:00:00.000Z';
  let instant = dispatchAt;
  return fixture(async ({ chat, state, rows, totals }) => {
    const first = await chat();
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).usage, usage);
    assert.equal(instant, monthReset);
    const original = rows().attempts[0];
    assert.equal(original.startedAt, dispatchAt);
    assert.equal(original.keyId, 'fixture-key');
    assert.equal(original.price.revision, 'anthropic-messages-sonnet-4-6-2026-11-16-global-v1');
    assert.deepEqual(totals(dispatchAt), { weekly: limit, monthly: limit, unknown: 0 });
    assert.deepEqual(totals(), { weekly: limit, monthly: '0', unknown: 0 });
    assert.equal((await chat()).status, 503, 'the weekly limit still blocks after the monthly reset');
    assert.deepEqual([state.wire.length, rows().terminals.length], [1, 1]);

    instant = '2026-12-06T17:00:00.000Z';
    assert.deepEqual(totals(), { weekly: '0', monthly: '0', unknown: 0 });
    const next = await chat();
    assert.equal(next.status, 200);
    assert.deepEqual((await next.json()).usage, usage);
    assert.deepEqual(totals(), { weekly: limit, monthly: limit, unknown: 0 });

    instant = '2026-12-13T17:00:00.000Z';
    assert.deepEqual(totals(), { weekly: '0', monthly: limit, unknown: 0 });
    assert.equal((await chat()).status, 503, 'the monthly limit still blocks after the weekly reset');
    assert.deepEqual([state.wire.length, rows().terminals.length], [2, 2]);
    assert.deepEqual(totals(dispatchAt), { weekly: limit, monthly: limit, unknown: 0 });
  }, { weekly: limit, monthly: limit, clock: () => instant, reply: success,
    onCheckpoint(point) {
      if (point === 'before-response-read' && instant === dispatchAt) instant = monthReset;
    },
  });
});

if (!stage) test('late response settles against its original binding after a peer changes policy and rotates the key', () => {
  const replacement = 'fixture-client-rotated';
  let changePolicy;
  return fixture(async ({ chat, state, rows, path, inspectPolicy, totals, rebind }) => {
    const peer = await createNodeSqliteAdapter(path);
    try {
      const peerPolicy = createNodeKeyPolicy(peer);
      changePolicy = () => {
        assert.deepEqual([state.wire.length, rows(peer).attempts.length, rows(peer).terminals.length], [1, 1, 0]);
        const saved = peerPolicy.save('fixture-key', inspectPolicy().version, { weekly: null, monthly: limit });
        peerPolicy.rotate('fixture-key', saved.version, 'fixture-client', replacement);
      };
      const response = await chat();
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).usage, usage);
      const { attempts, terminals } = rows(peer);
      assert.equal(attempts.length, 1);
      assert.equal(terminals.length, 1);
      const [original] = attempts;
      assert.equal(original.keyId, 'fixture-key');
      assert.equal(original.bindingGeneration, '1');
      assert.equal(original.price.revision, 'anthropic-messages-sonnet-4-6-2026-11-16-global-v1');
      assert.equal(original.startedAt, now);
      assert.equal(original.windows.weekly.startAt, '2026-11-15T17:00:00.000Z');
      assert.equal(original.windows.monthly.startAt, '2026-10-31T17:00:00.000Z');
      assert.equal(peer.get('SELECT attempt_id FROM accounting_terminals_v1').attempt_id, original.attemptId);
      assert.equal(terminals[0].amount, limit);
      assert.deepEqual(totals(now), { weekly: limit, monthly: limit, unknown: 0 });
      assert.deepEqual(inspectPolicy(), {
        keyId: 'fixture-key', bindingGeneration: '2', version: 3, lifecycle: 'active',
        limits: { weekly: null, monthly: limit },
      });

      const revoked = await chat();
      assert.equal(revoked.status, 503);
      assert.equal(isAccountingResponse(revoked), true);
      rebind(replacement);
      const atLimit = await chat('Root', {}, { authorization: `Bearer ${replacement}` });
      assert.equal(atLimit.status, 503);
      assert.equal(isAccountingResponse(atLimit), true);
      assert.equal(state.wire.length, 1);
      assert.deepEqual(rows(peer).terminals, terminals);
    } finally {
      peer.close();
    }
  }, { reply: success, onCheckpoint(point) {
    if (point === 'before-response-read') changePolicy();
  } });
});

const sseFrame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const sseReply = frames => () => new Response(frames.join(''), {
  headers: { 'content-type': 'text/event-stream' },
});

if (!stage) test('native Anthropic SSE publishes the stop frame after the durable debit and blocks at the exact limit', () => {
  const { output_tokens, ...inputUsage } = usage;
  const events = [
    { type: 'message_start', message: { type: 'message', role: 'assistant', model, content: [], usage: { ...inputUsage, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture answer' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens } },
    { type: 'message_stop' },
  ];
  const frames = events.map(sseFrame);
  return fixture(async ({ chat, state, rows, totals, path }) => {
    const first = await chat('Root', { stream: true });
    assert.equal(first.status, 200);
    assert.equal(isAccountingResponse(first), true);
    assert.match(first.headers.get('content-type'), /^text\/event-stream\b/);
    assert.equal(state.wire.length, 1);
    assert.deepEqual(state.wire[0].body, { ...body, stream: true, model });
    assert.deepEqual(state.wire[0].headers, {
      'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-api-key': 'fixture-upstream',
    });

    const reader = first.body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes(frames.at(-1))) {
      const { value, done } = await reader.read();
      assert.equal(done, false, 'client reached EOF before message_stop');
      received += decoder.decode(value, { stream: true });
    }
    const observer = new DatabaseSync(path, { readOnly: true });
    let recorded;
    try {
      recorded = rows({ all: sql => observer.prepare(sql).all() });
      assert.equal(recorded.attempts.length, 1);
      assert.equal(recorded.attempts[0].keyId, 'fixture-key');
      assert.equal(recorded.terminals.length, 1);
      assert.equal(recorded.terminals[0].amount, limit);
      assert.equal(recorded.terminals[0].provenance, 'provider-reported');
    } finally {
      observer.close();
    }
    assert.equal(received, frames.join(''));
    assert.equal((await reader.read()).done, true);
    assert.equal(state.reads, 0, 'native SSE did not consume the JSON body reader');
    assert.equal(totals().monthly, limit);

    const next = await chat('Root', { stream: true });
    assert.equal(next.status, 503);
    assert.equal(isAccountingResponse(next), true);
    assert.equal(state.wire.length, 1);
    assert.equal(rows().attempts.length, 2, 'the second intent reached the final budget gate');
    assert.deepEqual(rows().terminals, recorded.terminals);
  }, { monthly: limit, stream: true, reply: sseReply(frames) });
});

if (!stage) test('accounted SSE returns signed thinking and tool history unchanged on native continuation', () => {
  const { output_tokens, ...inputUsage } = usage;
  const frames = [
    { type: 'message_start', message: { type: 'message', role: 'assistant', model, content: [], usage: inputUsage } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'fixture reasoning' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'Zml4dHVyZS1zaWduYXR1cmU=' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'Zml4dHVyZS1yZWRhY3RlZA==' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_fixture', name: 'lookup', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"term":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"example"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens } },
    { type: 'message_stop' },
  ].map(sseFrame);
  const completion = [
    { type: 'message_start', message: { type: 'message', role: 'assistant', model, content: [], usage: inputUsage } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Tool failed.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens } },
    { type: 'message_stop' },
  ].map(sseFrame);
  let responses = 0;
  return fixture(async ({ chat, state, rows, totals }) => {
    const toolRequest = {
      stream: true,
      thinking: { type: 'adaptive' },
      tools: [{ name: 'lookup', input_schema: { type: 'object', properties: { term: { type: 'string' } } } }],
    };
    const reply = await chat('Root', toolRequest);
    assert.equal(reply.status, 200);
    assert.equal(isAccountingResponse(reply), true);
    const raw = await reply.text();
    assert.equal(raw, frames.join(''));
    assert.deepEqual(state.wire[0].body, { ...body, ...toolRequest, model });
    assert.deepEqual([state.wire.length, state.reads, rows().attempts.length], [1, 0, 1]);
    assert.deepEqual(rows().terminals.map(({ amount, provenance }) => ({ amount, provenance })),
      [{ amount: limit, provenance: 'provider-reported' }]);
    assert.equal(totals().monthly, limit);

    const events = raw.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const blocks = events.filter(event => event.type === 'content_block_start').map(event => event.content_block);
    const delta = type => events.filter(event => event.delta?.type === type).map(event => event.delta);
    const messages = [
      ...body.messages,
      { role: 'assistant', content: [
        { ...blocks[0], thinking: delta('thinking_delta').map(value => value.thinking).join(''),
          signature: delta('signature_delta')[0].signature },
        blocks[1],
        { ...blocks[2], input: JSON.parse(delta('input_json_delta').map(value => value.partial_json).join('')) },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: blocks[2].id, content: [{ type: 'text', text: 'fixture failure' }], is_error: true },
      ] },
    ];
    const next = await chat('Root', { ...toolRequest, messages }, { 'user-agent': 'generic fixture client' });
    assert.equal(next.status, 200);
    assert.equal(await next.text(), completion.join(''));
    assert.deepEqual(state.wire[1].body, { ...body, ...toolRequest, messages, model });
    assert.deepEqual([state.wire.length, state.reads, rows().attempts.length], [2, 0, 2]);
    assert.deepEqual(rows().terminals.map(({ amount, provenance }) => ({ amount, provenance })),
      Array.from({ length: 2 }, () => ({ amount: limit, provenance: 'provider-reported' })));
    assert.equal(totals().monthly, String(2n * BigInt(limit)));
  }, { stream: true, reply: () => sseReply(responses++ === 0 ? frames : completion)() });
});

if (!stage) test('accounted SSE forwards HTTP 200 provider error and does not try the next combo member', () => {
  const frames = [
    { type: 'message_start', message: { type: 'message', role: 'assistant', model, content: [], usage } },
    { type: 'error', error: { type: 'overloaded_error', message: 'fixture overload' } },
  ].map(sseFrame);
  return fixture(async ({ chat, state, rows, totals }) => {
    const reply = await chat('Root', { stream: true });
    assert.equal(reply.status, 200);
    assert.equal(isAccountingResponse(reply), true);
    assert.equal(await reply.text(), frames.join(''));
    assert.deepEqual([state.wire.length, state.preparations, state.contexts, state.reads], [1, 1, 1, 0]);
    assert.equal(rows().attempts.length, 1);
    assert.deepEqual(rows().terminals, []);
    assert.equal(totals().monthly, '0');
  }, { stream: true, reply: sseReply(frames) });
});

if (!stage) test('trusted SSE rejects paid tools, unsupported thinking and unsafe content blocks before transport', () => {
  return fixture(async ({ chat, state, rows }) => {
    for (const input of [
      { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
      { thinking: { type: 'enabled', budget_tokens: 1024 } },
      { messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'unsigned' }] }] },
      { messages: [{ role: 'user', content: [{
        type: 'tool_result', tool_use_id: 'toolu_fixture',
        content: [{ type: 'image', source: { type: 'url', url: 'https://fixture.invalid/image' } }],
      }] }] },
    ]) {
      const reply = await chat('Root', { ...input, stream: true });
      assert.equal(reply.status, 503);
      assert.equal(isAccountingResponse(reply), true);
    }
    assert.deepEqual([state.wire.length, state.preparations], [0, 0]);
    assert.deepEqual(rows(), { attempts: [], terminals: [] });
  }, { stream: true, reply: () => assert.fail('structured request reached upstream') });
});

if (!stage) test('request SSE flag and headers cannot opt a JSON profile into SSE', () => fixture(async ({ chat, state, rows }) => {
  const response = await chat('Root', { stream: true }, { accept: 'text/event-stream' });
  assert.equal(response.status, 503);
  assert.equal(isAccountingResponse(response), true);
  assert.equal(state.preparations, 0);
  assert.equal(state.wire.length, 0);
  assert.deepEqual(rows(), { attempts: [], terminals: [] });
}, { reply: success }));

if (!stage) test('native SSE candidate refuses Chat and Responses ingress before routing', () => fixture(async ({ chat, state, rows }) => {
  const native = { stream: true, system: 'fixture system prompt' };
  for (const [path, request] of [
    ['/v1/chat/completions', native],
    ['/v1/chat/completions', { stream: true, messages: [{ role: 'assistant', content: null, reasoning_content: 'fixture' }] }],
    ['/v1/responses', native],
    ['/v1/responses', { stream: true, input: [{ type: 'reasoning', encrypted_content: 'fixture' }] }],
  ]) {
    const response = await chat('Root', request, {}, path);
    assert.equal(response.status, 503);
    assert.equal(isAccountingResponse(response), true);
  }
  assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length], [0, 0, 0, 0]);
  assert.deepEqual(rows(), { attempts: [], terminals: [] });
}, { stream: true, reply: () => assert.fail('foreign ingress reached upstream') }));

if (!stage) test('selected nested route settles five categories, then the same route at the exact limit invokes zero times', () => fixture(async ({chat, state, rows, totals}) => {
  assert.equal((await chat('fast')).status, 503, 'direct alias cannot inherit combo access');
  assert.equal(state.accounts, 0);
  assert.deepEqual(rows(), { attempts: [], terminals: [] });
  const first = await chat();
  assert.equal(first.status, 200);
  assert.equal(isAccountingResponse(first), true);
  assert.deepEqual((await first.json()).usage, usage);
  assert.deepEqual(state.wire, [{
    headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-api-key': 'fixture-upstream' },
    body: { ...body, model },
  }]);
  const original = rows();
  assert.equal(original.attempts.length, 1);
  assert.equal(original.attempts[0].keyId, 'fixture-key');
  assert.equal(original.attempts[0].model, model);
  assert.equal(original.attempts[0].price.revision, 'anthropic-messages-sonnet-4-6-2026-11-16-global-v1');
  assert.equal(original.terminals.length, 1);
  assert.equal(original.terminals[0].amount, limit);
  assert.equal(original.terminals[0].provenance, 'provider-reported');
  assert.equal(totals().monthly, limit);
  const next = await chat();
  assert.equal(next.status, 503);
  assert.equal(isAccountingResponse(next), true);
  assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length, state.reads], [2, 2, 2, 1, 1]);
  assert.deepEqual(state.selected, ['fixture-account', 'fixture-account']);
  assert.equal(state.poolReads, 0);
  assert.equal(rows().attempts.length, 2, 'the follow-up reached the final gate with its own intent');
  assert.deepEqual(rows().terminals, original.terminals, 'no synthetic terminal or duplicate debit');
}, { monthly: limit, reply: success }));

if (!stage) test('a new owner of reopened SQLite blocks at the persisted limit but admits below it', () => fixture(async ({
  chat, state, rows, reopen, inspectPolicy, setMonthly, totals,
}) => {
  assert.equal((await chat()).status, 200);
  assert.equal(state.wire.length, 1);
  assert.equal(totals().monthly, limit);
  const saved = rows();
  const policy = inspectPolicy();
  assert.equal(saved.attempts.length, 1);
  assert.equal(saved.terminals.length, 1);
  assert.equal(policy.limits.monthly, limit);

  await reopen();
  assert.deepEqual(rows(), saved);
  assert.deepEqual(inspectPolicy(), policy);
  assert.equal(totals().monthly, limit);
  const blocked = await chat();
  assert.equal(blocked.status, 503);
  assert.equal(isAccountingResponse(blocked), true);
  assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length, state.reads], [2, 2, 2, 1, 1]);
  assert.equal(rows().attempts.length, 2, 'reopened request reached the final gate');
  assert.deepEqual(rows().terminals, saved.terminals);
  assert.equal(totals().monthly, limit);

  // Control: the reopened owner and network path are healthy; only change the
  // budget so recorded spend is now 1 nanoUSD below the threshold.
  setMonthly(policy.version, (BigInt(limit) + 1n).toString());
  assert.equal((await chat()).status, 200);
  assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length, state.reads], [3, 3, 3, 2, 2]);
  assert.equal(rows().attempts.length, 3);
  assert.equal(rows().terminals.length, 2);
  assert.equal(totals().monthly, (2n * BigInt(limit)).toString());
}, { monthly: limit, reply: success }));

function codexFixture(run, options) {
  const model = 'gpt-6.2-sol';
  const profile = { provider: 'codex', auth: 'oauth', producerAdmitted: true, connectionId: 'fixture-codex',
    model, price: { currency: 'USD', unit: 'USD/1M tokens', revision: 'fixture', rates: { input: '2', output: '10' } } };
  const reply = () => new Response('data: {"type":"response.completed","response":{"id":"fixture","status":"completed","usage":{"output_tokens":25}}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
  const request = (overrides = {}) => new Request('https://fixture.invalid/v1/responses', {
    method: 'POST', headers: { authorization: 'Bearer fixture-client' },
    body: JSON.stringify({ model: `codex/${model}`, input: 'fixture prompt', stream: true, ...overrides }),
  });
  function prepareDb(db) {
    db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify([`codex/${model}`]), 'fixture-key']);
    db.run(`INSERT INTO providerConnections (id, provider, authType, priority, isActive, data, createdAt, updatedAt)
      VALUES ('fixture-codex','codex','oauth',1,1,?,?,?)`, [
      JSON.stringify({ accessToken: 'fixture-token', providerSpecificData: { chatgptAccountId: 'fixture-account' } }), now, now,
    ]);
  }
  return fixture(context => run({ ...context, request }), {
    monthly: '250000', profile, reply, prepareDb, ...options,
  });
}

if (checkpoint === 'codex') {
  const writing = stage === '--restart-write';
  await codexFixture(async ({ state, rows, totals, request }) => {
    assert.equal(totals().monthly, writing ? '0' : '250000');
    const saved = rows();
    assert.equal(saved.terminals.length, writing ? 0 : 1);
    const response = await postResponses(request());
    assert.equal(response.status, writing ? 200 : 503);
    assert.equal(isAccountingResponse(response), true);
    if (writing) assert.match(await response.text(), /response.completed/);
    assert.equal(state.wire.length, writing ? 1 : 0);
    assert.equal(totals().monthly, '250000');
    const result = rows();
    assert.equal(result.terminals.length, 1);
    assert.equal(result.attempts[0].keyId, 'fixture-key');
    if (!writing) assert.deepEqual(result.terminals, saved.terminals);
  }, { sharedDir: stageDir, existing: !writing });
}

for (const point of stage ? [] : [...Object.keys(restartCases), 'codex']) {
  test(`a fresh Node process restores accounting for checkpoint ${point}`, () => {
    const dir = fs.mkdtempSync('/tmp/budget-restart-');
    try {
      for (const phase of ['--restart-write', '--restart-read']) {
        // Only the disposable database and its SQLite journal files carry over.
        const child = spawnSync('/runtime/node', ['--unhandled-rejections=strict', '--experimental-loader',
          '/app/tests/fixtures/budget/composed-loader.mjs', import.meta.filename, phase, dir, point], {
          env: process.env, encoding: 'utf8', timeout: 6000,
        });
        const output = `${phase}\n${child.stdout}\n${child.stderr}`;
        assert.ifError(child.error);
        const expectedSignal = phase === '--restart-write' && point !== 'clean' && point !== 'codex' ? 'SIGKILL' : null;
        assert.equal(child.signal, expectedSignal, output);
        assert.equal(child.status, expectedSignal ? null : 0, output);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

if (stage === '--restart-write' && checkpoint !== 'codex') {
  const partialResponse = checkpoint === 'during-response-read';
  let writerState;
  function killAt(point) {
    if (point !== checkpoint) return;
    const sent = !point.includes('intent');
    assert.deepEqual([writerState.wire.length, writerState.reads], sent ? [1, 1] : [0, 0]);
    process.kill(process.pid, 'SIGKILL');
  }
  await fixture(async ({ chat, state, rows, totals, inspectPolicy }) => {
    writerState = state;
    const response = await chat();
    assert.equal(response.status, 200);
    assert.equal(isAccountingResponse(response), true);
    assert.deepEqual((await response.json()).usage, usage);
    assert.deepEqual([state.preparations, state.wire.length, state.reads], [1, 1, 1]);
    assert.equal(rows().attempts.length, 1);
    assert.equal(rows().terminals.length, 1);
    assert.equal(totals().monthly, limit);
    assert.equal(inspectPolicy().limits.monthly, limit);
    killAt('after-response');
    assert.equal(checkpoint, 'clean', 'writer missed the requested checkpoint');
  }, { sharedDir: stageDir, monthly: limit, onCheckpoint: killAt, partialResponse,
    reply: partialResponse ? () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(partialJson)); },
    }), { headers: { 'content-type': 'application/json' } }) : success,
  });
}

if (stage === '--restart-read' && checkpoint !== 'codex') {
  await fixture(async ({ chat, state, rows, totals, inspectPolicy, setMonthly }) => {
    const saved = rows();
    const policy = inspectPolicy();
    const expected = restartCases[checkpoint];
    assert.equal(saved.attempts.length, expected.attempts);
    for (const attempt of saved.attempts) assert.equal(attempt.keyId, 'fixture-key');
    assert.deepEqual(saved.terminals.map(terminal => terminal.amount), expected.terminals ? [limit] : []);
    assert.equal(policy.limits.monthly, limit);
    if (!expected.terminals) {
      assert.equal(totals().monthly, '0');
      assert.equal(totals().unknown, 0);
      const resumed = await chat();
      assert.equal(resumed.status, 200);
      assert.equal(isAccountingResponse(resumed), true);
      assert.deepEqual((await resumed.json()).usage, usage);
      assert.equal((await chat()).status, 503);
      assert.equal(state.wire.length, 1);
      assert.equal(rows().attempts.length, expected.attempts + 2);
      assert.deepEqual(rows().terminals.map(terminal => terminal.amount), [limit]);
      return;
    }
    assert.equal(totals().monthly, limit);
    const blocked = await chat();
    assert.equal(blocked.status, 503);
    assert.equal(isAccountingResponse(blocked), true);
    assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length, state.reads], [1, 1, 1, 0, 0]);
    assert.equal(rows().attempts.length, 2);
    assert.deepEqual(rows().terminals, saved.terminals);
    assert.equal(totals().monthly, limit);

    setMonthly(policy.version, (BigInt(limit) + 1n).toString());
    assert.equal((await chat()).status, 200);
    assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length, state.reads], [2, 2, 2, 1, 1]);
    assert.equal(rows().attempts.length, 3);
    assert.equal(rows().terminals.length, 2);
    assert.equal(totals().monthly, (2n * BigInt(limit)).toString());
  }, { sharedDir: stageDir, existing: true, reply: success });
}

for (const mode of stage ? [] : ['complete-error', 'interrupted-error']) {
  test(`${mode} reads once and never retries; only completed evidence settles`, () => fixture(async ({ chat, state, rows, totals }) => {
    const response = await chat();
    assert.equal(response.status, mode === 'complete-error' ? 401 : 503);
    assert.equal(isAccountingResponse(response), true);
    assert.deepEqual([state.accounts, state.contexts, state.preparations, state.wire.length, state.reads], [1, 1, 1, 1, 1]);
    assert.equal(rows().attempts.length, 1);
    if (mode === 'complete-error') {
      assert.equal(rows().terminals.length, 1);
      assert.equal(rows().terminals[0].provenance, 'unknown/defaulted');
      assert.equal(rows().terminals[0].amount, '30000');
      assert.equal(totals().monthly, '30000');
    } else {
      assert.deepEqual(rows().terminals, []);
      assert.equal(totals().unknown, 0);
    }
  }, { interrupted: mode === 'interrupted-error', reply: () => mode === 'complete-error'
    ? Response.json({ type: 'error', error: { message: 'fixture denied' }, usage: { input_tokens: 10 } }, { status: 401 })
    : new Response(new ReadableStream({ start(controller) { controller.error(new Error('fixture interrupted')); } }), { status: 401 }),
  }));
}


if (stage === undefined) {
  test('accounted Responses handler admits only native streaming and keeps its failure terminal', async () => {
    const terminal = {
      type: 'response.completed',
      response: { id: 'fixture-response', status: 'completed', usage: { output_tokens: 25 } },
    };
    const bytes = `data: ${JSON.stringify(terminal)}\n\n`;
    let acknowledgements = 0;
    const call = (sourceFormat, settleResponses) => handleStreamingResponse({
      provider: 'codex', model: 'fixture-model', sourceFormat, targetFormat: FORMATS.OPENAI_RESPONSES,
      providerResponse: new Response(bytes, { headers: { 'content-type': 'text/event-stream' } }),
      streamController: createStreamController({ log: { errorLine() {} } }),
      accountingAttempt: { settleResponses },
    });

    const complete = await call(FORMATS.OPENAI_RESPONSES, evidence => {
      acknowledgements++;
      assert.deepEqual(evidence.components.map(({ category, count }) => [category, count]), [['output', 25]]);
    });
    assert.equal(await complete.response.text(), bytes);
    assert.equal(acknowledgements, 1);
    const refused = await call(FORMATS.OPENAI, () => assert.fail('Unexpected settlement'));
    assert.equal(refused.response.status, 502);
    const failed = await call(FORMATS.OPENAI_RESPONSES, () => { throw new Error('Fixture settlement failure'); });
    const output = await failed.response.text();
    assert.match(output, /response.failed/);
    assert.doesNotMatch(output, /event: response\.completed/);
  });


  test('accounted Codex executor hands the original SSE response to its owner and dispatches once', async () => {
    const executor = new CodexExecutor();
    executor._isCompact = true;
    executor.prefetchImages = () => assert.fail('Unexpected prefetch');
    executor._peekSseTransientError = () => assert.fail('Unexpected SSE peek');
    const response = new Response('event: error\ndata: {"type":"error","code":"server_is_overloaded"}\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
    let preparations = 0;
    let sends = 0;
    const args = {
      model: 'gpt-6.2-sol', stream: true,
      body: { model: 'gpt-6.2-sol', stream: true, input: 'fixture input' },
      credentials: { accessToken: 'fixture-token' },
      accounting: {
        async prepare({ url, options, provider, model, stream }) {
          preparations++;
          assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
          assert.equal(provider, 'codex');
          assert.equal(model, 'gpt-6.2-sol');
          assert.equal(stream, true);
          assert.equal(options.method, 'POST');
          assert.equal(JSON.parse(options.body).model, model);
          return { dispatch: async () => { sends++; return response; } };
        },
      },
    };
    const result = await executor.execute(args);
    assert.equal(result.response, response);
    assert.equal(result.response.bodyUsed, false);
    assert.equal(preparations, 1);
    assert.equal(sends, 1);
    await assert.rejects(executor.execute({ ...args, providerOverrides: { headers: {} } }), /native Codex/);
    await assert.rejects(executor.execute({ ...args, body: { ...args.body, _compact: true } }), /native Codex/);
    assert.equal(sends, 1);
  });


  test('Responses HTTP handler binds the selected Codex account and persists spend', () => {
    let rotateAfterIntent;
    return codexFixture(async ({ state, rows, reopen, path, request }) => {
      assert.equal((await postResponses(request({ service_tier: 'priority' }))).status, 503);
      assert.equal(state.preparations, 0);
      assert.deepEqual(rows(), { attempts: [], terminals: [] });

      const peer = new DatabaseSync(path);
      const updateToken = accessToken => peer.prepare("UPDATE providerConnections SET data = ? WHERE id = 'fixture-codex'")
        .run(JSON.stringify({ accessToken, providerSpecificData: { chatgptAccountId: 'fixture-account' } }));
      try {
        rotateAfterIntent = () => updateToken('fixture-replacement');
        assert.equal((await postResponses(request())).status, 503);
        assert.equal(state.wire.length, 0);
        assert.equal(rows().attempts.length, 1);
        assert.equal(rows().terminals.length, 0);
        updateToken('fixture-token');
      } finally { peer.close(); }

      const first = await postResponses(request());
      assert.equal(first.status, 200);
      assert.match(await first.text(), /response.completed/);
      assert.equal(rows().terminals[0].amount, '250000');
      assert.equal(rows().attempts[0].keyId, 'fixture-key');
      await reopen();
      assert.equal((await postResponses(request())).status, 503);
      assert.equal(state.wire.length, 1);
      assert.equal(rows().terminals.length, 1);
      assert.equal(state.wire[0].headers['chatgpt-account-id'], 'fixture-account');
      assert.equal(state.wire[0].headers.authorization, 'Bearer fixture-token');
    }, {
      onCheckpoint(point) {
        if (point !== 'after-intent-commit' || !rotateAfterIntent) return;
        const rotate = rotateAfterIntent;
        rotateAfterIntent = null;
        rotate();
      },
    });
  });

  test('native Codex core settles once and reopened SQLite blocks another upstream POST', async () => {
    globalThis.__budgetCore = { helpers: 0 };
    const dir = fs.mkdtempSync('/tmp/codex-accounting-');
    const path = dir + '/budget.sqlite';
    let db = await createNodeSqliteAdapter(path);
    let closeLoopback;
    const upstream = { wire: [] };
    const reply = () => new Response('data: {"type":"response.completed","response":{"id":"fixture","status":"completed","usage":{"output_tokens":25}}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
    try {
      db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
      db.run("INSERT INTO apiKeys VALUES ('fixture-key','fixture-client',1)");
      initializeNodeKeyPolicy(db);
      initializeNodeAttemptLedger(db);
      createNodeKeyPolicy(db).save('fixture-key', 0, { weekly: null, monthly: '250000' });
      let ledger = createNodeAttemptLedger(db);
      let prepared = 0;
      let posts = 0;
      if (tls) {
        closeLoopback = await startLoopback(upstream, reply, false, false, {
          pathname: '/backend-api/codex/responses',
          headerNames: ['authorization', 'chatgpt-account-id', 'content-type'],
        });
      }
      const accounting = {
        provider: 'codex', stream: true, validateInput: body => assert.equal(typeof body.input, 'string'),
        async prepare({ url, options, proxyOptions, provider, model }) {
          assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
          let send = async () => reply();
          if (tls) {
            const { prepareAccountedDirectPost } = await import('../../open-sse/utils/proxyFetch.js');
            send = await prepareAccountedDirectPost(upstream.endpoint, options, proxyOptions);
          }
          const attempt = ledger.prepare({ attemptId: 'codex-' + (++prepared), keyId: 'fixture-key',
            bindingGeneration: '1', provider, model, startedAt: now,
            price: { currency: 'USD', unit: 'USD/1M tokens', revision: 'fixture', rates: { input: '2', output: '10' } } });
          return {
            dispatch: () => ledger.dispatch(attempt.ack, { presentedSecret: 'fixture-client', now }, () => {
              posts++;
              return send();
            }),
            settleResponses: attempt.settle,
          };
        },
      };
      const request = (endpoint, format) => handleChatCore({
        modelInfo: { provider: 'codex', model: 'gpt-6.2-sol' },
        credentials: { accessToken: 'fixture-token', providerSpecificData: { chatgptAccountId: 'fixture-account' } },
        body: { stream: true, input: 'fixture input' }, clientRawRequest: { endpoint },
        sourceFormatOverride: format, accounting,
      });
      assert.equal(ledger.totals('fixture-key', now).monthly, '0');
      const first = await request('/v1/responses', FORMATS.OPENAI_RESPONSES);
      assert.equal(first.response.status, 200);
      assert.match(await first.response.text(), /response.completed/);
      assert.equal(ledger.totals('fixture-key', now).monthly, '250000');
      db.close();
      db = await createNodeSqliteAdapter(path);
      ledger = createNodeAttemptLedger(db);
      assert.equal(ledger.totals('fixture-key', now).monthly, '250000');
      const exhausted = await request('/v1/responses', FORMATS.OPENAI_RESPONSES);
      assert.equal(exhausted.response.status, 503);
      const alternate = await request('/v1/chat/completions', FORMATS.OPENAI);
      assert.equal(alternate.response.status, 503);
      assert.equal(prepared, 2);
      assert.equal(posts, 1);
      assert.equal(db.get('SELECT count(*) AS n FROM accounting_terminals_v1').n, 1);
      if (tls) {
        assert.equal(upstream.serverError, undefined);
        assert.equal(upstream.wire.length, 1);
        const [wire] = upstream.wire;
        assert.deepEqual(wire.headers, {
          authorization: 'Bearer fixture-token', 'chatgpt-account-id': 'fixture-account', 'content-type': 'application/json',
        });
        assert.equal(wire.body.model, 'gpt-6.2-sol');
        assert.equal(wire.body.stream, true);
        assert.equal(wire.body.store, false);
      }
    } finally {
      await closeLoopback?.();
      db.close();
    }
  });
}
