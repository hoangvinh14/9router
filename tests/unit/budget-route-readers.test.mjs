import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { captureNodeRoutingSnapshot, routingSnapshotMatches, ROUTING_READS } from '../../src/lib/accounting/node-routing-snapshot.js';
import { createNodeOuterTransaction } from '../../src/lib/accounting/node-outer-transaction.js';

assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
await import('./budget-route-chat-cases.mjs');
const { getModelInfo, getComboModels } = await import('../../src/sse/services/model.js');
const { isRequestedTargetAllowed } = await import('../../src/sse/services/keyAccess.js');
const { checkAccountedRoute } = await import('../../src/sse/services/accounted-route.js');

function bindAccessReads(modelReads, getCombos) {
  return {
    getCombos,
    getModelInfo: name => getModelInfo(name, modelReads),
    getComboModels: name => getComboModels(name, modelReads),
  };
}

function accessReads({ aliases = {}, combos = [], nodes = [], active = [] } = {}) {
  const modelReads = {
    getModelAliases: () => aliases,
    getComboByName: name => combos.find(combo => combo.name === name) ?? null,
    getProviderNodes: ({ type }) => nodes.filter(node => node.type === type),
    getProviderConnections: ({ provider }) => active.includes(provider) ? [{}] : [],
  };
  return bindAccessReads(modelReads, () => combos);
}

test('detached ACL resolution ignores populated ordinary cache and sees alias changes', async () => {
  const key = { allow: ['fast'], _sets: { models: new Set(['openai/old']), combos: new Set() } };
  const current = accessReads({ aliases: { fast: 'openai/new' } });
  assert.equal(await isRequestedTargetAllowed(key, 'openai/old', current), false);
  assert.equal(await isRequestedTargetAllowed(key, 'openai/new', current), true);
  assert.deepEqual([...key._sets.models], ['openai/old']);
});

test('combo lookup takes precedence over an alias; permission does not extend to direct members', async () => {
  const aliases = { Main: 'openai/leaf' };
  const current = accessReads({ aliases, combos: [{ name: 'Main', models: ['openai/leaf'] }] });
  assert.deepEqual(await current.getComboModels('Main'), ['openai/leaf']);
  assert.deepEqual(await current.getModelInfo('Main'), { provider: null, model: 'Main' });
  assert.equal(await isRequestedTargetAllowed({ allow: ['Main'] }, 'Main', current), true);
  assert.equal(await isRequestedTargetAllowed({ allow: ['Main'] }, 'openai/leaf', current), false);
  assert.equal(await isRequestedTargetAllowed({ allow: ['openai/leaf'] }, 'Main', current), false);
  assert.equal(await isRequestedTargetAllowed({ allow: ['openai/leaf'] }, 'Main', accessReads({ aliases })), true);
});

test('node precedence and Claude OAuth fallback both use the supplied data', async () => {
  const reads = accessReads({
    nodes: [{ id: 'fixture-node', type: 'openai-compatible', prefix: 'custom' }],
    active: ['claude'],
  });
  assert.deepEqual(await reads.getModelInfo('custom/m'), { provider: 'fixture-node', model: 'm' });
  assert.deepEqual(await reads.getModelInfo('claude-example'), { provider: 'claude', model: 'claude-example' });
  assert.deepEqual(await accessReads().getModelInfo('claude-example'), { provider: 'anthropic', model: 'claude-example' });
  assert.equal(await isRequestedTargetAllowed(null, 'claude-example'), false);
});

test('accounted route requires every nested combo edge and the exact resolved leaf', async () => {
  const combos = [
    { name: 'Root', models: ['Nested'] },
    { name: 'Nested', models: ['fast'] },
  ];
  const data = accessReads({ combos, aliases: { fast: 'openai/leaf' } });
  const snapshot = { access: { allow: ['Root'] }, reads: {
    getCombos: data.getCombos,
    getComboByName: name => combos.find(combo => combo.name === name) ?? null,
    getModelAliases: () => ({ fast: 'openai/leaf' }),
    getProviderNodes: () => [],
    getProviderConnections: () => [],
  } };
  const selected = { provider: 'openai', model: 'leaf' };
  await checkAccountedRoute(snapshot, ['Root', 'Nested', 'fast'], selected);
  await assert.rejects(checkAccountedRoute(snapshot, ['fast'], selected));
  await assert.rejects(checkAccountedRoute(snapshot, ['Root', 'fast'], selected));
  await assert.rejects(checkAccountedRoute(snapshot, ['Root', 'Nested', 'fast'], { ...selected, model: 'other' }));
});

test('SQLite routing snapshot becomes stale after peer ACL and route changes, including new rows', async () => {
  const dir = fs.mkdtempSync('/tmp/route-snapshot-');
  const file = `${dir}/db.sqlite`;
  const raw = new DatabaseSync(file);
  const peer = new DatabaseSync(file);
  try {
    raw.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE apiKeys(id TEXT PRIMARY KEY, accessRestricted INTEGER, accessAllow TEXT);
      CREATE TABLE combos(name TEXT PRIMARY KEY, models TEXT);
      CREATE TABLE kv(scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope,key));
      CREATE TABLE providerNodes(id TEXT PRIMARY KEY, type TEXT, data TEXT);
      CREATE TABLE providerConnections(provider TEXT, isActive INTEGER, data TEXT);
      CREATE TABLE settings(id INTEGER PRIMARY KEY, data TEXT);
      INSERT INTO apiKeys VALUES('key',1,'["fast"]');
      INSERT INTO kv VALUES('modelAliases','fast','"openai/model"');
      INSERT INTO providerConnections VALUES('claude',1,'credential-not-read');`);
    const adapter = { driver: 'node:sqlite', raw, exec: sql => raw.exec(sql),
      get: (sql, params = []) => raw.prepare(sql).get(...params),
      all: (sql, params = []) => raw.prepare(sql).all(...params),
      run: (sql, params = []) => raw.prepare(sql).run(...params),
    };
    const finalCheck = createNodeOuterTransaction(adapter, ROUTING_READS);
    const matches = snapshot => finalCheck(scope => routingSnapshotMatches(scope, 'key', snapshot.stamp)).value;
    for (const change of [
      `INSERT INTO combos VALUES('fast','["openai/other"]')`,
      `UPDATE apiKeys SET accessAllow='[]' WHERE id='key'`,
      `UPDATE kv SET value='"openai/new"' WHERE key='fast'`,
      `INSERT INTO providerNodes VALUES('node','openai-compatible','{"prefix":"custom"}')`,
      `INSERT INTO providerConnections VALUES('anthropic',1,'credential-not-read')`,
      `INSERT INTO settings VALUES(1,'{"comboStrategy":"smart"}')`,
    ]) {
      const snapshot = captureNodeRoutingSnapshot(adapter, 'key');
      assert.equal(matches(snapshot), true);
      if (change.startsWith('INSERT INTO combos')) {
        assert.equal(await isRequestedTargetAllowed(snapshot.access, 'openai/model', bindAccessReads(snapshot.reads, snapshot.reads.getCombos)), true);
        assert.equal(await snapshot.reads.getComboByName('fast'), null);
      }
      peer.exec(change);
      assert.equal(matches(snapshot), false);
    }
    const snapshot = captureNodeRoutingSnapshot(adapter, 'key');
    peer.exec(`UPDATE providerNodes SET data='{"prefix":"ignored","prefix":"custom"}' WHERE id='node'`);
    assert.equal(matches(snapshot), true, 'node projection uses the same last prefix as JSON.parse');
    peer.exec("UPDATE providerConnections SET data='changed-credential' WHERE provider='anthropic'");
    assert.equal(matches(snapshot), true, 'account credential freshness belongs to the wire gate');
    peer.exec(`INSERT INTO providerNodes VALUES('duplicate','openai-compatible','{"prefix":"custom"}')`);
    assert.throws(() => captureNodeRoutingSnapshot(adapter, 'key'));
  } finally {
    peer.close();
    raw.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
