import { exerciseClaudeConversion } from '../fixtures/budget/claude-conversion-cases.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { POST as postMessages } from '../../src/app/api/v1/messages/route.js';
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
    if (req.url !== '/oauth/token') state.wire.push(wire);
    (async () => {
      assert.equal(req.socket.encrypted, true);
      if (state.forwardedPorts) assert.ok(state.forwardedPorts.has(req.socket.remotePort), 'expected a tunneled request');
      assert.equal(req.socket.remoteAddress, '127.0.0.1');
      assert.equal(req.method, 'POST');
      if (req.url === '/oauth/token') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString();
        const grant = await state.grant(req.headers['content-type'] === 'application/json'
          ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)));
        res.writeHead(grant.status, Object.fromEntries(grant.headers));
        res.end(await grant.text());
        return;
      }
      assert.equal(req.url, pathname);
      if (state.profile?.provider !== 'claude') assert.equal(req.headers['anthropic-beta'], undefined);
      assert.equal(req.headers['anthropic-workspace-id'], undefined);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      wire.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (state.streamPrefix) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(state.streamPrefix);
        state.cutStream = () => res.destroy();
        return;
      }
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
    if (tls) closeLoopback = await startLoopback(state, reply, interrupted, partialResponse, profile?.provider === 'openai'
      ? { pathname: profile.endpoint || '/v1/chat/completions', headerNames: ['authorization', 'content-type'] } : profile?.provider === 'codex'
      ? { pathname: '/backend-api/codex/responses', headerNames: ['authorization', 'chatgpt-account-id', 'content-type'] }
      : profile?.provider === 'claude' ? { pathname: '/v1/messages?beta=true', headerNames: ['authorization'] } : undefined);
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
      resolveUsage: (attemptId, command) => owner.ledger.resolveUnresolvedUsage('fixture-key', attemptId, { action: 'waive', ...command }, clock),
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

for (const active of [false, true]) {
  if (stage) break;
  test(`selected ${active ? 'active' : 'inactive'} strict proxy pool refuses before transport or successor`, () => fixture(async ({ chat, state, rows }) => {
    const response = await chat();
    assert.equal(response.status, 503);
    assert.equal(isAccountingResponse(response), true);
    assert.deepEqual(state.selected, ['fixture-account']);
    assert.deepEqual([state.accounts, state.poolReads, state.preparations, state.wire.length], [1, 1, 0, 0]);
    assert.deepEqual(rows(), { attempts: [], terminals: [] });
  }, { reply: success, prepareDb(db) {
    db.run('INSERT INTO proxyPools (id, isActive, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', [
      'fixture-pool', Number(active), JSON.stringify({ strictProxy: true, proxyUrl: 'http://127.0.0.1:3128' }), now, now,
    ]);
    db.run('UPDATE providerConnections SET data = ? WHERE id = ?', [
      JSON.stringify({ apiKey: 'fixture-upstream', providerSpecificData: { proxyPoolId: 'fixture-pool' } }), 'fixture-account',
    ]);
  } }));
}

async function withStrictTunnel(endpoint, run) {
  let connects = 0;
  const forwardedPorts = new Set();
  const sockets = new Set();
  const proxy = http.createServer();
  proxy.on('connect', (req, downstream, head) => {
    connects++;
    if (req.url !== new URL(endpoint()).host) { downstream.destroy(); return; }
    const upstream = net.connect(Number(new URL(endpoint()).port), '127.0.0.1', () => {
      forwardedPorts.add(upstream.localPort);
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
    for (const socket of [upstream, downstream]) {
      sockets.add(socket);
      socket.on('error', () => socket.destroy());
      socket.on('close', () => sockets.delete(socket));
    }
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  try {
    return await run({ url: `http://127.0.0.1:${proxy.address().port}`, forwardedPorts, connects: () => connects });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
}

if (!stage && tls) test('saved strict HTTP pool tunnels one budgeted POST and rechecks the pool before dispatch', async () => {
  let target;
  let deactivate = false;
  await withStrictTunnel(() => target, async tunnel => {
    await fixture(async ({ chat, state, rows, totals }) => {
      target = state.endpoint;
      state.forwardedPorts = tunnel.forwardedPorts;
      const first = await chat();
      assert.equal(first.status, 200);
      await first.text();
      assert.equal(tunnel.connects(), 1);
      assert.equal(state.wire.length, 1);
      assert.equal(rows().terminals.length, 1);
      const amount = totals().monthly;
      assert.ok(BigInt(amount) > 0n);
      deactivate = true;
      assert.equal((await chat()).status, 503);
      assert.equal(tunnel.connects(), 1);
      assert.equal(state.wire.length, 1);
      assert.equal(rows().attempts.length, 2);
      assert.equal(rows().terminals.length, 1);
      assert.equal(totals().monthly, amount);
    }, { reply:success, beforeFinalBegin(peer) {
      if (deactivate) peer.prepare("UPDATE proxyPools SET isActive=0 WHERE id='fixture-pool'").run();
    }, prepareDb(db) {
      db.run('INSERT INTO proxyPools (id,isActive,data,createdAt,updatedAt) VALUES (?,1,?,?,?)',
        ['fixture-pool', JSON.stringify({type:'http', strictProxy:true, proxyUrl:tunnel.url}), now, now]);
      db.run('UPDATE providerConnections SET data=? WHERE id=?',
        [JSON.stringify({apiKey:'fixture-upstream', providerSpecificData:{proxyPoolId:'fixture-pool'}}), 'fixture-account']);
    } });
  });
});

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
if (!stage) test('two admitted POSTs spanning the HCM reset settle in their original periods', async () => {
  const before = '2026-11-30T16:59:59.999Z';
  const after = '2026-11-30T17:00:00.000Z';
  let instant = before;
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  let requests = 0;
  const reply = () => {
    if (++requests !== 1) return success();
    const response = success();
    return new Response(new ReadableStream({
      async start(controller) {
        arrived.resolve();
        await release.promise;
        controller.enqueue(new Uint8Array(await response.arrayBuffer()));
        controller.close();
      },
    }), { headers: response.headers });
  };
  await fixture(async ({ chat, rows, state, totals }) => {
    const first = chat();
    try {
      await Promise.race([arrived.promise, first.then(() => assert.fail('first POST never reached upstream'))]);
      instant = after;
      assert.equal((await chat()).status, 200);
      assert.equal(rows().terminals.length, 1);
      assert.equal((await chat()).status, 503);
      assert.equal(state.wire.length, 2);
    } finally { release.resolve(); }
    assert.equal((await first).status, 200);
    assert.equal(rows().terminals.length, 2);
    const settledStarts = state.db.all(`SELECT a.started_at FROM accounting_attempts_v1 a
      JOIN accounting_terminals_v1 t ON t.attempt_id = a.id ORDER BY a.started_at`);
    assert.deepEqual(settledStarts.map(row => row.started_at), [before, after]);
    for (const at of [before, after]) {
      assert.deepEqual(totals(at), { weekly: '211800', monthly: limit, unknown: 0 });
    }
    assert.equal((await chat()).status, 503);
    assert.equal(state.wire.length, 2);
  }, { weekly: limit, monthly: limit, clock: () => instant, reply });
});

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

const codexFixtureLimit = '374000';
const priceBasis = 'openai:codex/gpt-6.2-sol:standard:v1';
const referenceScope = 'budgetReferencePricing';

function codexFixture(run, { additionalPrices = {}, ...options } = {}) {
  const model = 'gpt-6.2-sol';
  const profile = { provider: 'codex', auth: 'oauth', producerAdmitted: true, connectionId: 'fixture-codex',
    accountId: 'fixture-account', model, priceBasis };
  const reply = () => new Response('data: {"type":"response.completed","response":{"id":"fixture","status":"completed","usage":{"input_tokens":100,"input_tokens_details":{"cached_tokens":40,"cache_write_tokens":60},"output_tokens":25,"total_tokens":125}}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
  const request = (overrides = {}) => new Request('https://fixture.invalid/v1/responses', {
    method: 'POST', headers: { authorization: 'Bearer fixture-client' },
    body: JSON.stringify({ model: `codex/${model}`, input: 'fixture prompt', stream: true, ...overrides }),
  });
  function prepareDb(db) {
    db.run('INSERT INTO kv VALUES (?,?,?)', [referenceScope, priceBasis, JSON.stringify({
      currency: 'USD', unit: 'USD/1M tokens', revision: priceBasis, syncedAt: 1,
      rates: { input: '2', cached: '0.1', output: '10' },
    })]);
    db.run("INSERT INTO kv VALUES ('pricing','openai',?)", [JSON.stringify({
      [model]: { input: 9, cached: 9, cache_creation: 9, output: 9 },
    })]);
    for (const [additionalModel, rates] of Object.entries(additionalPrices)) {
      const revision = `openai:codex/${additionalModel}:standard:v1`;
      db.run('INSERT INTO kv VALUES (?,?,?)', [referenceScope, revision, JSON.stringify({
        currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt: 2, rates,
      })]);
    }
    const allowedModels = [model, ...Object.keys(additionalPrices)].map(id => `codex/${id}`);
    db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify(allowedModels), 'fixture-key']);
    db.run(`INSERT INTO providerConnections (id, provider, authType, priority, isActive, data, createdAt, updatedAt)
      VALUES ('fixture-codex','codex','oauth',1,1,?,?,?)`, [
      JSON.stringify({ accessToken: 'fixture-token', providerSpecificData: { chatgptAccountId: 'fixture-account' } }), now, now,
    ]);
  }
  const bindingPath = '/run/9router/accounting-binding.json';
  fs.writeFileSync(bindingPath, JSON.stringify({ clientKeyId: 'fixture-key', codexBinding: {
    connectionId: profile.connectionId, accountId: profile.accountId, serviceTier: 'standard',
  } }));
  return fixture(context => run({ ...context, request }), {
    monthly: codexFixtureLimit, profile, reply, prepareDb, ...options,
  }).finally(() => fs.rmSync(bindingPath, { force: true }));
}

if (!stage) test('operator Anthropic binding requires a synchronized tariff before the first POST', async () => {
  const bindingPath = '/run/9router/accounting-binding.json';
  fs.writeFileSync(bindingPath, JSON.stringify({ clientKeyId: 'fixture-key', workspaceBinding }));
  try {
    await fixture(async ({ rows, state }) => {
      const response = await postMessages(new Request('https://fixture.invalid/v1/messages', {
        method: 'POST', headers: { authorization: 'Bearer fixture-client' },
        body: JSON.stringify({ ...body, model: `anthropic/${model}` }),
      }));
      assert.equal(response.status, 503);
      assert.equal(state.wire.length, 0);
      assert.equal(rows().attempts.length, 0);
    }, { prepareDb(db) {
      db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify([`anthropic/${model}`]), 'fixture-key']);
    } });
  } finally { fs.rmSync(bindingPath, { force: true }); }
});

for (const target of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']) {
  if (!stage) test(`Anthropic API key uses the synchronized Haiku tariff for ${target}`, async () => {
    const revision = 'anthropic:claude/claude-haiku-4-5:standard:v1';
    const requested = target.endsWith('20251001') ? 'dated-haiku' : `anthropic/${target}`;
    const bindingPath = '/run/9router/accounting-binding.json';
    fs.writeFileSync(bindingPath, JSON.stringify({ clientKeyId: 'fixture-key', workspaceBinding }));
    try {
      await fixture(async ({ rows, state, totals }) => {
        const send = () => postMessages(new Request('https://fixture.invalid/v1/messages', {
          method: 'POST', headers: { authorization: 'Bearer fixture-client', 'user-agent': 'claude-code fixture' },
          body: JSON.stringify({ ...body, model: requested }),
        }));
        assert.equal((await send()).status, 200);
        assert.equal(state.wire[0].body.model, target);
        assert.equal(rows().attempts[0].price.revision, revision);
        assert.equal(totals().monthly, '35300');
        assert.equal((await send()).status, 503);
        assert.equal(state.wire.length, 1);
      }, { monthly: '35300', reply: success, prepareDb(db) {
        db.run('INSERT INTO kv VALUES (?,?,?)', ['modelAliases', 'dated-haiku', JSON.stringify(`anthropic/${target}`)]);
        db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify([`anthropic/${target}`]), 'fixture-key']);
        db.run('INSERT INTO kv VALUES (?,?,?)', [referenceScope, revision, JSON.stringify({
          currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt: 2,
          source: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
          rates: { input: '1', cached: '0.10', cache_creation: '1.25', cache_creation_1h: '2', output: '5' },
        })]);
      } });
    } finally { fs.rmSync(bindingPath, { force: true }); }
  });

}

if (!stage) test('two Codex models share one budget and use their own synchronized prices', () =>
  codexFixture(async ({ request, rows, state, totals }) => {
    for (const target of ['gpt-6.2-sol', 'gpt-6.1-terra']) {
      const response = await postResponses(request({ model: `codex/${target}` }));
      assert.equal(response.status, 200);
      assert.match(await response.text(), /response.completed/);
    }
    assert.deepEqual(state.wire.map(({ body }) => body.model), ['gpt-6.2-sol', 'gpt-6.1-terra']);
    assert.deepEqual(rows().terminals.map(({ amount }) => amount), ['374000', '187000']);
    assert.equal(totals().monthly, '561000');
    assert.equal((await postResponses(request())).status, 503);
    assert.equal(state.wire.length, 2);
  }, { monthly: '561000', additionalPrices: { 'gpt-6.1-terra': { input: '1', cached: '0.05', output: '5' } } }));

if (checkpoint === 'codex') {
  const writing = stage === '--restart-write';
  await codexFixture(async ({ state, rows, totals, request }) => {
    assert.equal(totals().monthly, writing ? '0' : codexFixtureLimit);
    const saved = rows();
    assert.equal(saved.terminals.length, writing ? 0 : 1);
    const response = await postResponses(request());
    assert.equal(response.status, writing ? 200 : 503);
    assert.equal(isAccountingResponse(response), true);
    if (writing) assert.match(await response.text(), /response.completed/);
    assert.equal(state.wire.length, writing ? 1 : 0);
    assert.equal(totals().monthly, codexFixtureLimit);
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


  test('a delayed Codex overload terminal settles after the first-frame deadline without transferring', async t => {
    const { EMPTY_PEEK_DEADLINE_MS } = await import('../../open-sse/config/runtimeConfig.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let source, settlements = 0, successors = 0;
    const providerResponse = new Response(new ReadableStream({start(controller) { source = controller; }}),
      {headers:{'content-type':'text/event-stream'}});
    const waiting = handleStreamingResponse({
      provider:'codex', model:'fixture', sourceFormat:FORMATS.OPENAI_RESPONSES, targetFormat:FORMATS.OPENAI_RESPONSES,
      providerResponse, streamController:createStreamController({log:{}}), allowAccountFallback:true,
      accountingAttempt:{
        settleResponses() { settlements++; return {recorded:true,replay:false}; },
        overloadSuccessor() { successors++; return {}; },
      },
    });
    t.mock.timers.tick(EMPTY_PEEK_DEADLINE_MS);
    const result = await waiting;
    assert.ok(result.success);
    const terminal = sseFrame({type:'response.failed',response:{id:'fixture',status:'failed',
      error:{code:'server_is_overloaded'},usage:{output_tokens:12}}});
    source.enqueue(new TextEncoder().encode(terminal));
    source.close();
    assert.equal(await result.response.text(), terminal);
    assert.deepEqual([settlements, successors], [1,0]);
  });

  test('accounted Codex executor hands the original SSE response to its owner and dispatches once', async () => {
    const executor = new CodexExecutor();
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
    let changeAfterIntent;
    return codexFixture(async ({ state, rows, reopen, path, request }) => {
      assert.equal((await postResponses(request({ service_tier: 'priority' }))).status, 503);
      assert.equal(state.preparations, 0);
      assert.deepEqual(rows(), { attempts: [], terminals: [] });

      const peer = new DatabaseSync(path);
      const updateToken = accessToken => peer.prepare("UPDATE providerConnections SET data = ? WHERE id = 'fixture-codex'")
        .run(JSON.stringify({ accessToken, providerSpecificData: { chatgptAccountId: 'fixture-account' } }));
      try {
        changeAfterIntent = () => updateToken('fixture-replacement');
        assert.equal((await postResponses(request())).status, 503);
        assert.equal(state.wire.length, 0);
        assert.equal(rows().attempts.length, 1);
        assert.equal(rows().terminals.length, 0);
        updateToken('fixture-token');
        const readPrices = peer.prepare('SELECT value FROM kv WHERE scope = ? AND key = ?');
        const updatePrices = peer.prepare('UPDATE kv SET value = ? WHERE scope = ? AND key = ?');
        const savedPrices = readPrices.get(referenceScope, priceBasis).value;
        const writePrices = value => updatePrices.run(value, referenceScope, priceBasis);
        const changed = JSON.parse(savedPrices);
        changed.rates.output = '12';
        changeAfterIntent = () => writePrices(JSON.stringify(changed));
        assert.equal((await postResponses(request())).status, 503);
        assert.equal(state.wire.length, 0);
        assert.equal(rows().attempts.length, 2);
        assert.equal(rows().terminals.length, 0);

        writePrices(JSON.stringify({ 'gpt-6.2-sol': { input: 2, output: 10 } }));
        assert.equal((await postResponses(request())).status, 503);
        assert.equal(state.preparations, 2);
        assert.equal(rows().attempts.length, 2);
        writePrices(savedPrices);
      } finally { peer.close(); }

      const first = await postResponses(request());
      assert.equal(first.status, 200);
      assert.match(await first.text(), /response.completed/);
      assert.equal(rows().terminals[0].amount, codexFixtureLimit);
      assert.equal(rows().attempts[0].keyId, 'fixture-key');
      assert.equal(rows().attempts.at(-1).price.revision, priceBasis);
      assert.equal(rows().attempts.at(-1).price.syncedAt, 1);
      await reopen();
      assert.equal((await postResponses(request())).status, 503);
      assert.equal(state.wire.length, 1);
      assert.equal(rows().terminals.length, 1);
      assert.equal(state.wire[0].headers['chatgpt-account-id'], 'fixture-account');
      assert.equal(state.wire[0].headers.authorization, 'Bearer fixture-token');
    }, {
      onCheckpoint(point) {
        if (point !== 'after-intent-commit' || !changeAfterIntent) return;
        const change = changeAfterIntent;
        changeAfterIntent = null;
        change();
      },
    });
  });

  for (const status of ['incomplete', 'failed']) {
    test(`Codex records reported ${status} usage and blocks the next Responses request`, () => {
      const terminal = {
        type: `response.${status}`,
        response: {
          id: 'fixture-response', status,
          ...(status === 'incomplete'
            ? { incomplete_details: { reason: 'max_output_tokens' } }
            : { error: { code: 'server_error', message: 'fixture failure' } }),
          usage: {
            input_tokens: 100, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 60 },
            output_tokens: 25, total_tokens: 125,
          },
        },
      };
      const bytes = `data: ${JSON.stringify(terminal)}\n\n`;
      return codexFixture(async ({ request, rows, state }) => {
        const response = await postResponses(request());
        assert.equal(response.status, 200);
        assert.equal(await response.text(), bytes);
        assert.equal(rows().terminals[0].amount, codexFixtureLimit);
        assert.equal((await postResponses(request())).status, 503);
        assert.equal(state.wire.length, 1);
        assert.equal(rows().terminals.length, 1);
      }, { reply: () => new Response(bytes, { headers: { 'content-type': 'text/event-stream' } }) });
    });
  }

  test('Codex Chat preserves multiline terminals and distinguishes cutoffs in JSON and SSE', async () => {
    let reason;
    const reply = () => {
      const status = reason ? 'incomplete' : 'completed';
      const response = { id: 'fixture-multiline', status, incomplete_details: reason ? { reason } : null,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fixture answer' }] }],
        usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 25, total_tokens: 125 } };
      const data = JSON.stringify({ type: 'response.' + status, response }, null, 2);
      const frame = data.split('\n').map(line => 'data: ' + line).join('\r\n') + '\r\n\r\n';
      return new Response(frame, { headers: { 'content-type': 'text/event-stream' } });
    };
    await codexFixture(async ({ state, rows }) => {
      for (const [cutoff, expected] of [[null, 'stop'], ['max_output_tokens', 'length'], ['content_filter', 'content_filter'], ['interrupted', null]]) {
        reason = cutoff;
        for (const stream of [false, true]) {
          const before = rows().terminals.length;
          const res = await postResponses(new Request('https://fixture.invalid/v1/chat/completions', {
            method: 'POST', headers: { authorization: 'Bearer fixture-client' },
            body: JSON.stringify({ model: 'codex/gpt-6.2-sol', messages: [{role:'user', content:'hello'}], stream }),
          }));
          assert.equal(res.status, stream || expected ? 200 : 502);
          if (stream) {
            const frames = (await res.text()).split('\n\n').filter(Boolean);
            assert.equal(frames.pop(), 'data: [DONE]');
            const last = JSON.parse(frames.pop().slice(6));
            if (expected) assert.equal(last.choices[0].finish_reason, expected);
            else assert.match(last.error.message, /incomplete/);
          } else {
            const body = await res.json();
            if (expected) {
              assert.equal(body.choices[0].finish_reason, expected);
              assert.equal(body.choices[0].message.content, 'fixture answer');
            } else assert.match(body.error.message, /incomplete/);
          }
          assert.equal(rows().terminals.length, before + 1);
          if (reason !== 'content_filter') assert.equal(rows().terminals.at(-1).amount, codexFixtureLimit);
        }
      }
      assert.equal(state.wire.length, 8);
      assert.equal(rows().attempts.length, 8);
    }, {reply, monthly:'5000000'});
  });

  for (const provider of tls ? ['codex', 'anthropic'] : []) {
    test(`a disconnected ${provider} stream with no usage preserves its original intent after reopen`, async () => {
      const codex = provider === 'codex';
      const run = async ({ state, chat, request, rows, reopen }) => {
        state.streamPrefix = sseFrame(codex
          ? { type:'response.created', response:{ id:'fixture-cut', status:'in_progress' } }
          : { type:'message_start', message:{ id:'fixture-cut', role:'assistant', content:[] } });
        const res = codex ? await postResponses(request()) : await chat('Root', { stream:true });
        assert.equal(res.status, 200);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        try {
          const prefix = await reader.read();
          assert.equal(decoder.decode(prefix.value), state.streamPrefix);
          state.cutStream();
          let suffix = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            suffix += decoder.decode(value);
          }
          const events = Array.from(suffix.matchAll(/^event: (.+)$/gm), match => match[1]);
          assert.deepEqual(events, [codex ? 'response.failed' : 'error']);
        } finally { reader.releaseLock(); }
        assert.equal(state.wire.length, 1);
        const recorded = rows();
        assert.equal(recorded.attempts.length, 1);
        assert.equal(recorded.attempts[0].keyId, 'fixture-key');
        assert.deepEqual(recorded.terminals, []);
        await reopen();
        assert.deepEqual(rows(), recorded);
        assert.equal(state.wire.length, 1);
      };
      if (codex) await codexFixture(run);
      else await fixture(run, { stream:true, reply:success });
    });
  }

  test('Codex forwards encrypted continuation without billing its byte length as estimated tokens', () => {
    return codexFixture(async ({ request, rows, state }) => {
      for (const ciphertext of ['fixture', 'fixture'.repeat(1000)]) {
        const input = [
          { type: 'reasoning', encrypted_content: ciphertext, summary: [] },
          { role: 'user', content: 'Continue' },
        ];
        const response = await postResponses(request({ input }));
        assert.equal(response.status, 200);
        assert.match(await response.text(), /response.completed/);
        assert.equal(state.wire.at(-1).body.input.find(item => item.type === 'reasoning').encrypted_content, ciphertext);
      }
      const amounts = rows().terminals.map(row => row.amount);
      assert.equal(amounts.length, 2);
      assert.ok(BigInt(amounts[0]) > 0n);
      assert.equal(amounts[0], amounts[1]);
    }, { monthly: '999999999', reply: () => sseReply([sseFrame({
      type: 'response.completed', response: { id: 'fixture', status: 'completed' },
    })])() });
  });

  test('Codex failure with unknown usage allows another POST below the spend limit', () => {
    const terminal = 'data: {"type":"response.failed","response":{"id":"fixture","status":"failed","usage":null}}\n\n';
    return codexFixture(async ({ request, rows, state, reopen, resolveUsage }) => {
      const response = await postResponses(request());
      assert.equal(response.status, 200);
      assert.equal(await response.text(), terminal);
      assert.equal(rows().terminals.length, 1);
      assert.equal(rows().terminals[0].amount, '0');
      assert.equal(rows().terminals[0].provenance, 'unknown/defaulted');
      assert.deepEqual(rows().terminals[0].unknown, ['cached', 'input', 'output']);
      await reopen();
      const allowed = await postResponses(request());
      assert.equal(allowed.status, 200);
      assert.equal(await allowed.text(), terminal);
      assert.equal(state.wire.length, 2);
      assert.equal(rows().terminals.length, 2);
      const { attemptId } = rows().attempts[0];
      const command = { operationId: 'fixture-recovery', expectedVersion: 1, reason: 'Missing terminal usage',
        evidence: 'Fixture upstream error' };
      assert.throws(() => resolveUsage(attemptId, { ...command, expectedVersion: 2 }), { status: 409 });
      const receipt = resolveUsage(attemptId, command);
      await reopen();
      assert.deepEqual(resolveUsage(attemptId, command), receipt);
      assert.throws(() => resolveUsage(attemptId, { ...command, reason: 'Changed' }), { status: 409 });
      const resumed = await postResponses(request());
      assert.equal(resumed.status, 200);
      assert.equal(await resumed.text(), terminal);
      assert.equal(state.wire.length, 3);
    }, { reply: () => new Response(terminal, { headers: { 'content-type': 'text/event-stream' } }) });
  });

  test('Codex cost correction preserves known spend and applies the adjustment once', () => {
    const terminal = 'data: {"type":"response.failed","response":{"id":"fixture","status":"failed","usage":{"output_tokens":25}}}\n\n';
    return codexFixture(async ({ request, totals, rows, state, reopen, resolveUsage }) => {
      assert.equal(await (await postResponses(request())).text(), terminal);
      assert.equal(totals().monthly, '250000');
      const { attemptId } = rows().attempts[0];
      const command = { operationId: 'fixture-adjustment', expectedVersion: 1,
        reason: 'Verified remaining usage', evidence: 'Fixture evidence', action: 'cost_correction', additionalNanoUsd: '124000' };
      assert.throws(() => resolveUsage(attemptId, { ...command, action: 'exact_usage' }), { status: 409 });
      const receipt = resolveUsage(attemptId, command);
      await reopen();
      assert.deepEqual(resolveUsage(attemptId, command), receipt);
      assert.equal(totals().monthly, codexFixtureLimit);
      assert.equal(rows().terminals[0].amount, '250000');
      assert.equal((await postResponses(request())).status, 503);
      assert.equal(state.wire.length, 1);
    }, { reply: () => new Response(terminal, { headers: { 'content-type': 'text/event-stream' } }) });
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

const failedCodex = { type: 'response.failed', response: { status: 'failed', error: { code: 'token_expired' },
  usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0 } } };
const failedClaude = { type: 'error', error: { type: 'authentication_error', message: 'fixture token expired' }, usage };
for (const provider of stage ? [] : ['codex', 'claude']) {
  for (const scenario of ['reactive', 'success', ...(tls ? ['strict-pool', 'pool-changed'] : []), 'proactive', 'auth-failure', 'usage-absent', '403', 'expired-403', 'limit', 'acl', 'rotation', 'write-refused', 'cancelled']) {
    test(`OAuth accounting ${provider} ${scenario}`, async () => {
      let sends = 0, auth = 0;
      const id = 'fixture-' + provider;
      const target = provider === 'claude' ? 'claude-sonnet-5' : 'gpt-6.2-sol';
      const expired = ['proactive', 'auth-failure'].includes(scenario);
      const reject = provider === 'claude' ? structuredClone(failedClaude) : structuredClone(failedCodex);
      if (scenario === 'expired-403' && provider === 'claude') reject.error.code = 'token_expired';
      if (scenario === '403' && provider === 'codex') reject.response.error.code = 'insufficient_quota';
      if (scenario === '403' && provider === 'claude') reject.error.type = 'permission_error';
      if (scenario === 'usage-absent') delete (provider === 'claude' ? reject : reject.response).usage;
      let databasePath;
      const reply = () => {
        sends++;
        if (sends === 1 && !expired) return Response.json(reject, { status: ['expired-403', '403'].includes(scenario) ? 403 : 401 });
        const persisted = new DatabaseSync(databasePath, { readOnly: true });
        try {
          const account = persisted.prepare('SELECT data FROM providerConnections WHERE id = ?').get(id);
          assert.equal(JSON.parse(account.data).accessToken, 'fixture-new');
          assert.equal(persisted.prepare('SELECT COUNT(*) AS n FROM accounting_terminals_v1').get().n, expired ? 0 : 1);
        } finally { persisted.close(); }
        if (['success','strict-pool'].includes(scenario)) {
          if (provider === 'claude') return success();
          return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'fixture-response',
            status: 'completed', usage: failedCodex.response.usage } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
        }
        return Response.json({ error: { message: 'successor unavailable' } }, { status: 429 });
      };
      const exercise = async ({ state, request, rows, reopen, totals, path }, tunnel) => {
        databasePath = path;
        const controller = new AbortController();
        const initial = { accessToken: 'fixture-token', refreshToken: 'fixture-old',
          ...(expired ? { expiresAt: '2000-01-01T00:00:00Z' } : {}),
          ...(provider === 'codex' ? { providerSpecificData: { chatgptAccountId: 'fixture-account' } } : {}) };
        if (tunnel) {
          state.forwardedPorts = tunnel.forwardedPorts;
          if (scenario === 'pool-changed') state.afterGrantPrepared = () =>
            state.db.run('UPDATE proxyPools SET isActive = 0 WHERE id = ?', ['fixture-pool']);
          initial.providerSpecificData = { ...initial.providerSpecificData, proxyPoolId:'fixture-pool' };
          state.db.run('INSERT INTO proxyPools (id,isActive,data,createdAt,updatedAt) VALUES (?,1,?,?,?)',
            ['fixture-pool', JSON.stringify({type:'http',strictProxy:true,proxyUrl:tunnel.url}), now, now]);
        }
        state.db.run('UPDATE providerConnections SET data = ? WHERE id = ?', [JSON.stringify(initial), id]);
        state.grant = body => {
          auth++;
          assert.equal(body.refresh_token, 'fixture-old');
          assert.equal(state.wire.length, expired ? 0 : 1);
          if (scenario === 'write-refused') state.db.exec("CREATE TRIGGER refuse_rotation BEFORE UPDATE OF data ON providerConnections BEGIN SELECT RAISE(IGNORE); END");
          if (scenario === 'cancelled') controller.abort();
          if (scenario === 'acl') state.db.run('UPDATE apiKeys SET accessAllow = ?', ['[]']);
          if (scenario === 'rotation') state.db.run("UPDATE providerConnections SET data = json_set(data,'$.refreshToken','peer') WHERE id = ?", [id]);
          return Response.json({ access_token: 'fixture-new', refresh_token: 'fixture-rotated', expires_in: 3600 },
            { status: scenario === 'auth-failure' ? 400 : 200 });
        };
        const response = provider === 'codex' ? await postResponses(new Request(request(), { signal: controller.signal })) : await postMessages(new Request('https://fixture.invalid/v1/messages', {
          method: 'POST', signal: controller.signal, headers: { authorization: 'Bearer fixture-client' }, body: JSON.stringify({ model: 'claude/' + target,
            stream: false, max_tokens: 20, messages: [{ role: 'user', content: 'fixture' }] }) }));
        assert.ifError(state.serverError);
        const status = { success: 200, 'strict-pool':200, 'pool-changed':503, reactive: 429, 'expired-403': 429, proactive: 429, 'auth-failure': 503, 'usage-absent': 401, '403': 403, limit: 503, acl: 503, rotation: 503, 'write-refused': 503, cancelled: 503 }[scenario];
        assert.equal(response.status, status, await response.text());
        assert.equal(auth, ['usage-absent','403','pool-changed'].includes(scenario) ? 0 : 1);
        assert.equal(sends, ['success','strict-pool','reactive','expired-403'].includes(scenario) ? 2 : scenario === 'auth-failure' ? 0 : 1);
        if (['success','strict-pool'].includes(scenario)) {
          assert.equal(rows().terminals.length, 2);
          assert.equal(totals().monthly, provider === 'codex' ? '40000' : '211800');
        }
        if (['reactive','success','strict-pool','expired-403','proactive'].includes(scenario)) {
          assert.equal(state.wire.at(-1).headers.authorization, 'Bearer fixture-new');
          assert.equal(rows().attempts.length, sends);
          assert.equal(new Set(rows().attempts.map(x => x.attemptId)).size, sends);
        }
        const stored = JSON.parse(state.db.get('SELECT data FROM providerConnections WHERE id = ?', [id]).data);
        if (scenario === 'rotation') assert.equal(stored.refreshToken, 'peer');
        else if (scenario === 'write-refused') assert.equal(stored.refreshToken, 'fixture-old');
        else if (auth && scenario !== 'auth-failure') assert.equal(stored.refreshToken, 'fixture-rotated');
        if (scenario === 'limit') {
          await reopen();
          assert.equal(totals().monthly, provider === 'codex' ? '20000' : '105900');
        }
      };
      const run = ctx => ['strict-pool','pool-changed'].includes(scenario)
        ? withStrictTunnel(() => ctx.state.endpoint, tunnel => exercise(ctx, tunnel))
        : exercise(ctx);
      const monthly = scenario === 'limit' ? '1' : '9999999';
      if (provider === 'codex') return codexFixture(run, { monthly, reply });
      const bindingPath = '/run/9router/accounting-binding.json';
      fs.writeFileSync(bindingPath, JSON.stringify({ clientKeyId: 'fixture-key', claudeBinding: { connectionId: id, serviceTier: 'standard' } }));
      try {
        await fixture(run, { monthly, reply, profile: { provider }, prepareDb(db) {
          const revision = 'anthropic:claude/' + target + ':standard:v1';
          db.run('INSERT INTO kv VALUES (?,?,?)', [referenceScope, revision, JSON.stringify({ currency: 'USD', unit: 'USD/1M tokens',
            revision, syncedAt: 2, source: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
            rates: { input: '3', cached: '0.30', cache_creation: '3.75', cache_creation_1h: '6', output: '15' } })]);
          db.run('UPDATE apiKeys SET accessAllow = ?', [JSON.stringify(['claude/' + target])]);
          db.run("INSERT INTO providerConnections(id, provider, authType, isActive, data, createdAt, updatedAt) VALUES (?, 'claude', 'oauth', 1, '{}', ?, ?)", [id, now, now]);
        } });
      } finally { fs.rmSync(bindingPath, { force: true }); }
    });
  }
}

for (const provider of stage ? [] : ['codex', 'claude']) {
  const sseModes = provider === 'codex' ? ['sse-success','sse-limit','sse-missing','sse-after-output','sse-json'] : ['claude-partial-error'];
  for (const mode of ['success', 'limit', 'missing-usage', 'backup-auth-error', ...sseModes]) {
    test(`budgeted ${provider} transfers to the configured backup only after complete usage: ${mode}`, async () => {
      const codex = provider === 'codex';
      const model = codex ? 'gpt-6.2-sol' : 'claude-sonnet-5';
      const primary = 'fixture-' + provider;
      const backup = primary + '-backup';
      const binding = { serviceTier:'standard', connectionId:primary, ...(codex && { accountId:'fixture-account' }) };
      const bindingFile = '/run/9router/accounting-binding.json';
      let calls = 0;
      const reply = () => {
        calls++;
        if (calls === 1) {
          const failure = codex ? structuredClone(failedCodex) : structuredClone(failedClaude);
          if (codex) failure.response.error.code = 'server_is_overloaded';
          else failure.error.type = 'overloaded_error';
          if (mode === 'missing-usage') delete (codex ? failure.response : failure).usage;
          if (mode === 'claude-partial-error') {
            return sseReply([
              { type:'message_start', message:{ type:'message', role:'assistant', model, content:[], usage } },
              { type:'message_delta', delta:{stop_reason:'end_turn'}, usage:{output_tokens:12} },
              { type:'error', error:failure.error },
            ].map(sseFrame))();
          }
          if (mode.startsWith('sse-')) {
            failure.response.id = 'fixture-first';
            if (mode === 'sse-missing') delete failure.response.usage;
            const prefix = mode === 'sse-after-output' ? sseFrame({type:'response.output_text.delta',delta:'visible'}) : '';
            return new Response(prefix + sseFrame(failure), {headers:{'content-type':'text/event-stream'}});
          }
          return Response.json(failure, { status:503 });
        }
        if (mode === 'backup-auth-error') return Response.json(codex ? failedCodex : failedClaude, {status:401});
        return codex ? new Response('data: ' + JSON.stringify({ type:'response.completed', response:{
          id:'fixture-second', status:'completed', usage:failedCodex.response.usage } }) + '\n\n',
          {headers:{'content-type':'text/event-stream'}}) : success();
      };
      const run = async ({ state, rows, totals, request, reopen }) => {
        const credentials = token => JSON.stringify({accessToken:token, refreshToken:"fixture-grant", ...(codex && {providerSpecificData:{
          chatgptAccountId:token === 'fixture-secondary' ? 'fixture-second-account' : 'fixture-account' }})});
        state.db.run('UPDATE providerConnections SET data=? WHERE id=?',[credentials('fixture-primary'),primary]);
        state.db.run('INSERT INTO providerConnections(id,provider,authType,isActive,priority,data,createdAt,updatedAt) VALUES(?,?,?,1,2,?,?,?)',
          [backup,provider,'oauth',credentials('fixture-secondary'),now,now]);
        fs.writeFileSync(bindingFile,JSON.stringify({clientKeyId:'fixture-key', [provider+'Binding']:binding,
          fallbackBinding:{...binding,connectionId:backup,...(codex && {accountId:'fixture-second-account'})} }));
        const jsonChat = () => new Request('https://fixture.invalid/v1/chat/completions', {
          method:'POST', headers:{authorization:'Bearer fixture-client'},
          body:JSON.stringify({model:'codex/'+model,stream:false,messages:[{role:'user',content:'hello'}]}),
        });
        const response = codex ? await postResponses(mode === 'sse-json' ? jsonChat() : request()) : await postMessages(new Request('https://fixture.invalid/v1/messages',{
          method:'POST',headers:{authorization:'Bearer fixture-client'},body:JSON.stringify({
            model:'claude/'+model,stream:mode === 'claude-partial-error',max_tokens:20,messages:[{role:'user',content:'hello'}]})}));
        assert.equal(response.status,['success','sse-success','sse-json','sse-missing','sse-after-output','claude-partial-error'].includes(mode) ? 200 : mode === 'backup-auth-error' ? 401 : 503);
        const body = await response.text();
        if (mode === 'claude-partial-error') {
          assert.match(body, /overloaded_error/);
          assert.match(body, /message_delta/);
          assert.doesNotMatch(body, /message_stop/);
          assert.equal(rows().attempts.length, 1);
          assert.equal(rows().terminals.length, 0);
          assert.equal(totals().monthly, '0');
        }
        if (mode === 'sse-success' || mode === 'sse-json') {
          assert.match(body, /fixture-second/);
          assert.doesNotMatch(body, /fixture-first/);
        }
        if (mode === 'sse-after-output' || mode === 'sse-missing') assert.match(body, /fixture-first/);
        const expected = ['success','backup-auth-error','sse-success','sse-json'].includes(mode) ? ['Bearer fixture-primary','Bearer fixture-secondary'] : ['Bearer fixture-primary'];
        assert.deepEqual(state.wire.map(w => w.headers.authorization),expected);
        const charges = rows().terminals;
        if (expected.length === 2) {
          assert.equal(new Set(rows().attempts.map(a => a.attemptId)).size,2);
          assert.equal(charges.length,2);
          assert.equal(totals().monthly,codex ? '40000' : '211800');
        }
        if (['limit','sse-limit'].includes(mode)) assert.equal(charges.length,1);
        await reopen();
        assert.deepEqual(rows().terminals,charges);
      };
      const monthly = ['limit','sse-limit'].includes(mode) ? '1' : '9999999';
      if (codex) return codexFixture(run,{monthly,reply});
      try {
        await fixture(run,{monthly,reply,profile:{provider},prepareDb(db) {
          const revision='anthropic:claude/'+model+':standard:v1';
          db.run('INSERT INTO kv VALUES(?,?,?)',[referenceScope,revision,JSON.stringify({currency:'USD',unit:'USD/1M tokens',
            revision,syncedAt:2,source:'https://platform.claude.com/docs/en/about-claude/pricing.md',
            rates:{input:'3',cached:'0.30',cache_creation:'3.75',cache_creation_1h:'6',output:'15'}})]);
          db.run('UPDATE apiKeys SET accessAllow=?',[JSON.stringify(['claude/'+model])]);
          db.run("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,'claude','oauth',1,'{}',?,?)",[primary,now,now]);
        }});
      } finally { fs.rmSync(bindingFile,{force:true}); }
    });
  }
}

if (!stage) test('OpenAI API Chat JSON and SSE share synchronized model-specific prices and block the next POST', async () => {
  const { syncOpenAIStandardReferences } = await import('../../src/lib/pricing/openai-standard-reference.js');
  const models = ['gpt-4.1', 'gpt-new-model'];
  const catalogModel = (id, input) => ({ id, modalities: { output: ['text'] }, cost: { input, cache_read: 0.25, output: 8 } });
  const catalog = { openai: { id: 'openai', models: {
    [models[0]]: catalogModel(models[0], 2), [models[1]]: catalogModel(models[1], 1),
  } } };
  const usage = { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, prompt_tokens_details: { cached_tokens: 40 } };
  let streaming = false;
  const reply = () => {
    const choice = { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'fixture' } };
    if (!streaming) return Response.json({ id: 'chatcmpl-fixture', object: 'chat.completion', choices: [choice], usage });
    const frame = fields => 'data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', ...fields }) + '\n\n';
    return new Response(frame({ choices: [{ index: 0, delta: { content: 'fixture' }, finish_reason: 'stop' }] }) +
      frame({ choices: [], usage }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const bindingPath = '/run/9router/accounting-binding.json';
  fs.writeFileSync(bindingPath, JSON.stringify({ clientKeyId: 'fixture-key', openaiBinding: { connectionId: 'fixture-openai', serviceTier: 'standard' } }));
  try {
    await fixture(async ({ rows, state, totals }) => {
      await syncOpenAIStandardReferences(catalog, 12345);
      const send = (model, extra = {}) => postResponses(new Request('https://fixture.invalid/v1/chat/completions', {
        method: 'POST', headers: { authorization: 'Bearer fixture-client' }, body: JSON.stringify({
          model: 'openai/' + model, messages: [{ role: 'user', content: 'fixture prompt' }], stream: streaming, ...extra,
        }),
      }));
      await syncOpenAIStandardReferences({ openai: { id: 'openai', models: {
        ...catalog.openai.models, [models[0]]: { ...catalog.openai.models[models[0]],
          cost: { ...catalog.openai.models[models[0]].cost, search_call: 10 } },
      } } }, 12346);
      assert.equal((await send(models[0])).status, 503);
      await syncOpenAIStandardReferences(catalog, 12347);
      await assert.rejects(syncOpenAIStandardReferences({}, 12348));
      assert.equal((await send(models[0], { service_tier: 'priority' })).status, 503);
      assert.equal(state.wire.length, 0);
      const json = await send(models[0]);
      assert.equal(json.status, 200);
      assert.deepEqual((await json.json()).usage, usage);
      streaming = true;
      const sse = await send(models[1]);
      assert.equal(sse.status, 200);
      const bytes = await sse.text();
      assert.match(bytes, /data: \[DONE\]/);
      assert.doesNotMatch(bytes, /"usage"/);
      assert.equal(state.wire[1].body.stream_options.include_usage, true);
      assert.deepEqual(state.wire.map(wire => [wire.body.model, wire.body.service_tier, wire.headers.authorization]),
        models.map(model => [model, 'default', 'Bearer fixture-upstream-api']));
      assert.deepEqual(rows().terminals.map(t => t.amount).sort(), ['270000', '330000']);
      assert.equal(totals().monthly, '600000');
      assert.equal((await send(models[0])).status, 503);
      assert.equal(state.wire.length, 2);
    }, { profile: { provider: 'openai' }, monthly: '600000', reply, prepareDb(db) {
      db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify(models.map(m => 'openai/' + m)), 'fixture-key']);
      db.run("INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES('fixture-openai','openai','apikey',1,1,?,?,?)",
        [JSON.stringify({ apiKey: 'fixture-upstream-api' }), now, now]);
      db.run("INSERT INTO kv VALUES('pricing','openai',?)", [JSON.stringify({ [models[0]]: { input: 0, output: 0 } })]);
    } });
  } finally { fs.rmSync(bindingPath, { force: true }); }
});

if (!stage) exerciseClaudeConversion({ test, fixture, postResponses, workspaceBinding, fs, usage, sseFrame, sseReply });

if (!stage) test('OpenAI API Responses uses native JSON and SSE with cached writes and the long context tariff', async () => {
  const { parseOpenAIStandardReferences } = await import('../../src/lib/pricing/openai-standard-reference.js');
  const model = 'gpt-6.2-sol', endpoint = '/v1/responses';
  const prices = parseOpenAIStandardReferences({ openai: { id: 'openai', models: { [model]: { id: model,
    modalities: { output: ['text'] }, cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5,
      tiers: [{ tier: { type: 'context', size: 100 }, input: 4, output: 15, cache_read: 0.2, cache_write: 5 }] } } } } }, 12345);
  let streaming = false;
  const reply = () => {
    const response = { id: 'resp_fixture', object: 'response', status: 'completed', output: [], usage: {
      input_tokens: streaming ? 101 : 100, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 },
      output_tokens: 10, total_tokens: streaming ? 111 : 110,
    } };
    return streaming ? new Response('data: ' + JSON.stringify({ type: 'response.completed', response }) + '\n\n',
      { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response);
  };
  const bindingPath = '/run/9router/accounting-binding.json';
  fs.writeFileSync(bindingPath, JSON.stringify({ clientKeyId: 'fixture-key', openaiBinding: { connectionId: 'fixture-openai', serviceTier: 'standard' } }));
  try {
    await fixture(async ({ rows, state, totals }) => {
      const send = (extra = {}) => postResponses(new Request('https://fixture.invalid' + endpoint, {
        method: 'POST', headers: { authorization: 'Bearer fixture-client' }, body: JSON.stringify({
          model: 'openai/' + model, input: 'fixture prompt', stream: streaming, ...extra,
        }),
      }));
      assert.equal((await send({ prompt_cache_options: { ttl: '12h' } })).status, 503);
      assert.equal(state.wire.length, 0);
      const json = await send();
      assert.equal(json.status, 200);
      assert.equal((await json.json()).usage.input_tokens, 100);
      streaming = true;
      const sse = await send();
      assert.equal(sse.status, 200);
      assert.match(await sse.text(), /response.completed/);
      assert.deepEqual(rows().terminals.map(t => t.amount).sort(), ['234000', '422000']);
      assert.equal(totals().monthly, '656000');
      assert.equal((await send()).status, 503);
      assert.equal(state.wire.length, 2);
    }, { profile: { provider: 'openai', endpoint }, monthly: '656000', reply, prepareDb(db) {
      db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify(['openai/' + model]), 'fixture-key']);
      db.run("INSERT INTO providerConnections(id,provider,authType,priority,isActive,data,createdAt,updatedAt) VALUES('fixture-openai','openai','apikey',1,1,?,?,?)",
        [JSON.stringify({ apiKey: 'fixture-upstream-api' }), now, now]);
      for (const [key, price] of Object.entries(prices)) db.run('INSERT INTO kv VALUES(?,?,?)', [referenceScope, key, JSON.stringify(price)]);
    } });
  } finally { fs.rmSync(bindingPath, { force: true }); }
});

if (!stage) test('OAuth accounting concurrent rejections rotate once and require the owning acknowledgement', () => {
  let sends = 0;
  return codexFixture(async ({ state, request, rows }) => {
    state.db.run("UPDATE providerConnections SET data = json_set(data,'$.refreshToken','fixture-old') WHERE id = 'fixture-codex'");
    let release;
    const bothRecorded = new Promise(resolve => { release = resolve; });
    let terminals = 0;
    const run = state.db.run.bind(state.db);
    state.db.run = (sql, params) => {
      const result = run(sql, params);
      if (sql.startsWith('INSERT INTO accounting_terminals_v1 ') && ++terminals === 2) release();
      return result;
    };
    let grants = 0;
    state.grant = async () => {
      grants++;
      await bothRecorded;
      return Response.json({ access_token: 'fixture-new', refresh_token: 'fixture-rotated', expires_in: 3600 });
    };
    const responses = await Promise.all([postResponses(request()), postResponses(request())]);
    assert.deepEqual(responses.map(r => r.status).sort(), [429, 503]);
    assert.equal(grants, 1);
    assert.deepEqual(state.wire.map(w => w.headers.authorization), ['Bearer fixture-token', 'Bearer fixture-token', 'Bearer fixture-new']);
    assert.equal(rows().attempts.length, 3);
    assert.equal(rows().terminals.length, 2);
  }, { monthly: '9999999', reply: () => ++sends <= 2 ? Response.json(failedCodex, { status: 401 }) : Response.json({}, { status: 429 }) });
});

if (!stage) test('OAuth accounting credential commit with a lost acknowledgement prevents a successor', async () => {
  if (process.env.BUDGET_OAUTH_LOST_ACK !== '1') {
    // The uncertain COMMIT deliberately latches this process's storage fault.
    const child = spawnSync('/runtime/node', ['--experimental-loader', '/app/tests/fixtures/budget/composed-loader.mjs',
      '--test', '--test-name-pattern=credential commit with a lost acknowledgement', import.meta.filename], {
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, BUDGET_OAUTH_LOST_ACK: '1' }, encoding: 'utf8', timeout: 15000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /pass 1|# pass 1/);
    return;
  }
  await codexFixture(async ({ state, request, path }) => {
    state.db.run("UPDATE providerConnections SET data = json_set(data,'$.refreshToken','fixture-old') WHERE id = 'fixture-codex'");
    let auth = 0;
    state.grant = () => {
      auth++;
      return Response.json({ access_token: 'fixture-new', refresh_token: 'fixture-rotated', expires_in: 3600 });
    };
    // The adapter transaction owner captures its methods before the grant.
    // Inject at that captured boundary when it handles the credential COMMIT.
    const exec = state.db.exec.bind(state.db);
    state.db.exec = sql => {
      exec(sql);
      if (sql === 'COMMIT' && auth) throw new Error('fixture lost acknowledgement');
    };
    const response = await postResponses(request());
    assert.equal(response.status, 503);
    assert.equal(auth, 1);
    assert.equal(state.wire.length, 1);
    const peer = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(peer.prepare("SELECT json_extract(data,'$.accessToken') AS token FROM providerConnections WHERE id='fixture-codex'").get().token, 'fixture-new');
      assert.equal(peer.prepare('SELECT count(*) AS n FROM accounting_terminals_v1').get().n, 1);
    } finally { peer.close(); }
  }, { monthly: '9999999', reply: () => Response.json(failedCodex, { status: 401 }) });
});

for (const first of stage ? [] : ['ordinary', 'budget']) {
  test(`OAuth accounting serializes ${first} refresh with the other mode`, () => codexFixture(async ({ state, request }) => {
    const { refreshStoredOAuth } = await import('../../src/lib/db/repos/connectionsRepo.js');
    const id = 'fixture-codex';
    state.db.run("UPDATE providerConnections SET data = json_set(data,'$.refreshToken','old','$.expiresAt','2000-01-01T00:00:00Z') WHERE id = ?", [id]);
    const creds = { connectionId: id, accessToken: 'fixture-token', refreshToken: 'old' };
    let entered, resume;
    const started = new Promise(resolve => { entered = resolve; });
    const wait = new Promise(resolve => { resume = resolve; });
    let grants = 0;
    const exchange = async () => {
      grants++;
      entered();
      await wait;
      return { accessToken: 'winner', refreshToken: 'winner-refresh', expiresIn: 3600 };
    };
    state.grant = async () => {
      const tokens = await exchange();
      return Response.json({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, expires_in: 3600 });
    };
    const ordinary = () => refreshStoredOAuth('codex', creds, exchange);
    const budget = () => postResponses(request());
    let runFirst = first === 'ordinary' ? ordinary() : budget();
    await started;
    let selected;
    const readSelection = new Promise(resolve => { selected = resolve; });
    const all = state.db.all.bind(state.db);
    state.db.all = (sql, params) => {
      const rows = all(sql, params);
      if (sql.startsWith('SELECT * FROM providerConnections WHERE provider =')) selected();
      return rows;
    };
    const other = first === 'ordinary' ? budget() : ordinary();
    if (first === 'ordinary') await readSelection;
    resume();
    const [a, b] = await Promise.all([runFirst, other]);
    const response = first === 'ordinary' ? b : a;
    assert.equal(response.status, first === 'ordinary' ? 503 : 429);
    assert.equal(grants, 1);
    assert.equal(state.wire.length, first === 'ordinary' ? 0 : 1);
    assert.equal((first === 'ordinary' ? a : b).refreshToken, 'winner-refresh');
  }, { reply: () => Response.json({}, { status: 429 }) }));
}
