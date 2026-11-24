// Client continuation in a fresh process with the original disposable database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POST } from '../../../src/app/api/v1/responses/route.js';
import { createNodeSqliteAdapter } from '../../../src/lib/db/adapters/nodeSqliteAdapter.js';

assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
const { path, endpoint, model, input } = JSON.parse(fs.readFileSync(0, 'utf8'));
assert.match(path, /^\/tmp\/budget-composed-[A-Za-z0-9]+\/budget\.sqlite$/);
const db = await createNodeSqliteAdapter(path);
try {
  globalThis.routeFixture = { db, preparations: 0, wire: [] };
  globalThis.__budgetCore = { refresh: 0, helpers: 0, peeks: 0 };
  const before = db.get('SELECT count(*) AS n FROM accounting_attempts_v1');
  const res = await POST(new Request('https://fixture.invalid' + endpoint, { method: 'POST',
    headers: { authorization: 'Bearer fixture-client' }, body: JSON.stringify({ model, input }) }));
  assert.equal(res.status, 503);
  assert.equal(globalThis.routeFixture.preparations, 0);
  assert.deepEqual(db.get('SELECT count(*) AS n FROM accounting_attempts_v1'), before);
} finally { db.close(); }
