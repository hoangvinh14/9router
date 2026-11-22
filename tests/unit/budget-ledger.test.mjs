import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.BUDGET_PURE_SANDBOX, '1');
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.BUDGET_OUTER_NET);
let sequence = 0;
function child(body) {
  const prelude = `
    import assert from 'node:assert/strict';
    const { createNodeSqliteAdapter } = await import('/app/src/lib/db/adapters/nodeSqliteAdapter.js');
    const { initializeNodeAttemptLedger: initialize, createNodeAttemptLedger: ledger } = await import('/app/src/lib/accounting/node-attempt-ledger.js');
    const { terminalCost, EXCLUSIVE_USAGE: semantics } = await import('/app/src/lib/accounting/terminal-cost.js');
    const { faultAccounting: fault, assertAccountingHealthy: healthy } = await import('/app/src/lib/accounting/process-state.js');
    const file = '/tmp/ledger-${++sequence}.sqlite';
    const db = await createNodeSqliteAdapter(file);
    const { initializeNodeKeyPolicy, createNodeKeyPolicy } = await import('/app/src/lib/accounting/node-key-policy.js');
    db.exec('CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, isActive INTEGER NOT NULL)');
    initializeNodeKeyPolicy(db);
    const policy = createNodeKeyPolicy(db);
    for (const id of ['key-A','key-B']) {
      db.run('INSERT INTO apiKeys VALUES (?,?,1)', [id, 'fixture-'+id]);
      policy.save(id,0,{weekly:null,monthly:null});
    }
    const now = '2026-11-16T10:00:00.000Z';
    const price = { currency:'USD', unit:'USD/1M tokens', revision:'fixture-original', rates:{input:'1',output:'2'} };
    const cmd = (attemptId, keyId='key-A') => ({ attemptId,keyId,bindingGeneration:'1',provider:'provider',model:'model',startedAt:now,price });
    const context = (keyId='key-A') => ({presentedSecret:'fixture-'+keyId,now});
    const usage = (input=1000,output=1000) => ({semantics,components:[{category:'input',count:input,unit:'USD/1M tokens'},{category:'output',count:output,unit:'USD/1M tokens'}]});
    const count = table => db.get('SELECT COUNT(*) AS n FROM '+table).n;
    try {
  `;
  const result = spawnSync('/runtime/node', ['--unhandled-rejections=strict','--input-type=module','--eval',prelude+body+`
    } finally { if(db.raw.isOpen === true && db.raw.isTransaction) db.exec('ROLLBACK');db.close(); }
  `], {env:process.env,encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stdout+result.stderr);
}

test('ledger setup is explicit, atomic and schema presence alone never grants inferred readiness', () => child(`
  assert.throws(()=>ledger(db)); healthy();
  assert.equal(initialize(db).transactionOutcome,'commit_observed');
  const store=ledger(db);assert.equal(typeof store.prepare,'function');
  assert.throws(()=>initialize(db)); // existing schema is not silently replaced
  assert.throws(healthy);
`));

test('own intent ACK only after COMMIT; one use, forged and other-store ACKs refuse', () => child(`
  initialize(db); const store=ledger(db);const own=store.prepare(cmd('a'));let posts=0;
  assert.equal(count('accounting_attempts_v1'),1);
  assert.throws(()=>store.dispatch({},context(),()=>posts++));
  assert.throws(()=>ledger(db).dispatch(own.ack,context(),()=>posts++));
  assert.equal(store.dispatch(own.ack,context(),()=>{posts++;return 'POST';}),'POST');
  assert.throws(()=>store.dispatch(own.ack,context(),()=>posts++));assert.equal(posts,1);
  own.settle(usage());assert.deepEqual(store.totals('key-A',now),{weekly:'3000000',monthly:'3000000',unknown:0});
`));

test('idempotent original attempt replay never mints network authority and conflict never overwrites original', () => child(`
  initialize(db);const store=ledger(db);const first=store.prepare(cmd('same'));
  assert.deepEqual(store.prepare(cmd('same')),{replay:true});
  assert.throws(()=>store.prepare({...cmd('same'),keyId:'key-B'}),e=>e.status===409);
  assert.equal(count('accounting_attempts_v1'),1);healthy();
  first.settle(usage());assert.deepEqual(first.settle(usage()),{recorded:true,replay:true});
  assert.throws(()=>first.settle(usage(2000)),e=>e.status===409);
  assert.equal(count('accounting_terminals_v1'),1);healthy();
`));

test('partial malformed and conflicting usage defaults only unknown categories and retains exact known spend', () => child(`
  initialize(db);const store=ledger(db);const attempt=store.prepare(cmd('partial'));
  attempt.settle({semantics,components:[{category:'input',count:1000,unit:'USD/1M tokens'},
    {category:'output',count:1000,unit:'USD/1M tokens'},{category:'output',count:2000,unit:'USD/1M tokens'}]});
  assert.deepEqual(store.totals('key-A',now),{weekly:'1000000',monthly:'1000000',unknown:1});
  const missing=store.prepare(cmd('missing'));missing.settle(null);
  assert.deepEqual(store.totals('key-A',now),{weekly:'1000000',monthly:'1000000',unknown:2});
  const next=store.prepare(cmd('next'));let posts=0;store.dispatch(next.ack,context(),()=>posts++);
  assert.equal(posts,1);healthy();
`));

test('block-next equality and zero budget initiate no POST, peer settlement counted, no reservations', () => child(`
  initialize(db);const store=ledger(db);let posts=0;
  const first=store.prepare(cmd('first'));const second=store.prepare(cmd('second'));
  policy.save('key-A',1,{weekly:'3000000',monthly:'3000000'});
  policy.save('key-B',1,{weekly:null,monthly:'0'});
  store.dispatch(first.ack,context(),()=>posts++);
  store.dispatch(second.ack,context(),()=>posts++); // admitted overshoot permitted
  first.settle(usage());
  const next=store.prepare(cmd('next'));
  policy.save('key-A',2,{weekly:'3000000',monthly:null});
  assert.throws(()=>store.dispatch(next.ack,context(),()=>posts++));
  const other=store.prepare(cmd('zero','key-B'));
  assert.throws(()=>store.dispatch(other.ack,context('key-B'),()=>posts++));
  assert.equal(posts,2);second.settle(usage());
  assert.equal(store.totals('key-A',now).monthly,'6000000');healthy();
`));

test('original price, key, generation and HCM start window remain immutable across caller mutation and month boundary', () => child(`
  initialize(db);const store=ledger(db);const command=cmd('snapshot');const attempt=store.prepare(command);
  command.price.rates.input='999';command.keyId='key-B';
  const stale=store.prepare({...cmd('stale'),bindingGeneration:'2'});
  assert.throws(()=>store.dispatch(stale.ack,context(),()=>assert.fail('POST')));
  assert.throws(()=>store.dispatch(attempt.ack,{...context(),now:'2026-11-30T17:00:00.000Z'},()=>assert.fail('POST')));
  attempt.settle(usage());
  assert.equal(store.totals('key-A',now).monthly,'3000000');
  assert.equal(store.totals('key-B',now).monthly,'0');
  assert.equal(store.totals('key-A','2026-11-30T17:00:00.000Z').monthly,'0');healthy();
`));

test('retained original terminal writes after process fault; finite and unlimited dispatch and new intents remain blocked', () => child(`
  initialize(db);const store=ledger(db);const attempt=store.prepare(cmd('original'));const next=store.prepare(cmd('next'));
  policy.save('key-B',1,{weekly:'999999999',monthly:null});
  const finite=store.prepare(cmd('finite','key-B'));
  let posts=0;store.dispatch(attempt.ack,context(),()=>posts++);fault();
  attempt.settle(usage());
  assert.equal(count('accounting_terminals_v1'),1);assert.throws(healthy);
  assert.throws(()=>store.dispatch(next.ack,context(),()=>posts++));
  assert.throws(()=>store.dispatch(finite.ack,context('key-B'),()=>posts++));
  assert.throws(()=>store.prepare(cmd('replacement')));assert.equal(posts,1);
`));

test('terminal SQL fault quarantines connection and denies other retained attempts without erasing known spend', () => child(`
  initialize(db);const store=ledger(db);const known=store.prepare(cmd('known'));known.settle(usage());
  const broken=store.prepare(cmd('broken'));const retained=store.prepare(cmd('retained'));
  db.exec("CREATE TRIGGER reject_terminal BEFORE INSERT ON accounting_terminals_v1 WHEN NEW.attempt_id = 'broken' BEGIN SELECT RAISE(ABORT,'private cause'); END");
  assert.throws(()=>broken.settle(usage()),e=>e.code==='api_key_accounting_unavailable'&&!e.message.includes('private'));
  assert.throws(()=>retained.settle(usage()));assert.throws(healthy);
  assert.equal(count('accounting_terminals_v1'),1);
  assert.equal(db.get("SELECT amount FROM accounting_terminals_v1 WHERE attempt_id = 'known'").amount,'3000000');
`));

test('intent COMMIT execute-then-throw grants no ACK and no replacement rights despite visible durable row', () => child(`
  initialize(db);const exec=db.exec.bind(db);
  const wrapped={...db,exec(sql){if(sql==='COMMIT'){exec(sql);throw new Error('lost return');}return exec(sql);}};
  // Factory readiness itself observes a COMMIT; inject only after construction.
  let fail=false;const store=ledger({...db,exec(sql){if(fail&&sql==='COMMIT'){exec(sql);throw new Error('lost return');}return exec(sql);}});
  fail=true;assert.throws(()=>store.prepare(cmd('lost')));assert.throws(healthy);
  assert.equal(count('accounting_attempts_v1'),1);assert.equal(count('accounting_terminals_v1'),0);
`));

test('peer limit cut at final BEGIN blocks using current policy and committed spend', () => child(`
  initialize(db);policy.save('key-A',1,{weekly:null,monthly:'10000000000'});
  const peer=await createNodeSqliteAdapter(file);
  try {
    const peerPolicy=createNodeKeyPolicy(peer);
    let cut=false;let posts=0;const exec=db.exec.bind(db);
    const store=ledger({...db,exec(sql){
      if(cut && sql==='BEGIN IMMEDIATE') {
        cut=false;peerPolicy.save('key-A',2,{weekly:null,monthly:'8000000000'});
      }
      return exec(sql);
    }});
    const first=store.prepare({...cmd('charged'),price:{...price,rates:{input:'9',output:'2'}}});
    store.dispatch(first.ack,context(),()=>posts++);
    first.settle(usage(1000000,0));
    assert.equal(store.totals('key-A',now).monthly,'9000000000');
    const next=store.prepare(cmd('blocked'));
    cut=true;
    assert.throws(()=>store.dispatch(next.ack,context(),()=>posts++));
    assert.equal(cut,false);assert.equal(posts,1);healthy();
  } finally {peer.close();}
`));

for (const change of [
  "peer.run('UPDATE apiKeys SET isActive = 0 WHERE id = ?', ['key-A'])",
  "peerPolicy.rotate('key-A',1,'fixture-key-A','fixture-rotated')",
  "peerPolicy.retire('key-A',1)",
]) test('peer change before final gate: '+change.split('(')[0], () => child(`
  initialize(db);const store=ledger(db);
  const first=store.prepare(cmd('already-sent')); const next=store.prepare(cmd('not-sent'));
  let posts=0;store.dispatch(first.ack,context(),()=>posts++);
  const peer=await createNodeSqliteAdapter(file);
  try {const peerPolicy=createNodeKeyPolicy(peer); ${change};} finally {peer.close();}
  assert.throws(()=>store.dispatch(next.ack,context(),()=>posts++));
  assert.equal(posts,1);healthy();
  first.settle(usage());assert.equal(store.totals('key-A',now).monthly,'3000000');
`));

test('change committed after final COMMIT does not cancel the admitted attempt', () => child(`
  initialize(db);const peer=await createNodeSqliteAdapter(file);
  try {
    const peerPolicy=createNodeKeyPolicy(peer);
    let revoke=false;let posts=0;const exec=db.exec.bind(db);
    const store=ledger({...db,exec(sql){
      const result=exec(sql);
      if(revoke && sql==='COMMIT'){revoke=false;peerPolicy.retire('key-A',1);}
      return result;
    }});
    const first=store.prepare(cmd('admitted'));const next=store.prepare(cmd('not-admitted'));
    revoke=true;store.dispatch(first.ack,context(),()=>posts++);
    assert.equal(revoke,false);assert.equal(posts,1);
    assert.throws(()=>store.dispatch(next.ack,context(),()=>posts++));
    first.settle(usage());assert.equal(store.totals('key-A',now).monthly,'3000000');healthy();
  } finally {peer.close();}
`));

test('close and reopen persists exact rows but never resurrects old process-local dispatch receipts', () => child(`
  initialize(db);const store=ledger(db);const attempt=store.prepare(cmd('persist'));attempt.settle(usage());db.close();
  const reopened=await createNodeSqliteAdapter(file);
  try { const next=ledger(reopened);
    assert.equal(next.totals('key-A',now).monthly,'3000000');
    assert.deepEqual(next.prepare(cmd('persist')),{replay:true});
    assert.throws(()=>next.dispatch(attempt.ack,context(),()=>assert.fail('POST')));
  }finally{reopened.close();}healthy();
`));

test('tampered persisted evidence or original period faults instead of undercounting or allowing retained reuse', () => {
  for (const mutation of [
    "UPDATE accounting_terminals_v1 SET evidence = '{}'",
    "UPDATE accounting_attempts_v1 SET month_start = '1900-01-01T00:00:00.000Z'",
    "UPDATE accounting_attempts_v1 SET original = '{}'",
  ]) child(`
    initialize(db);const store=ledger(db);const known=store.prepare(cmd('known'));known.settle(usage());
    const retained=store.prepare(cmd('retained'));
    db.exec(${JSON.stringify(mutation)});
    assert.throws(()=>store.totals('key-A',now));assert.throws(healthy);
    assert.throws(()=>retained.settle(usage()));assert.equal(count('accounting_terminals_v1'),1);
  `);
});

test('paged exact totals above signed64 do not overflow or truncate and NUL identities never alias', () => child(`
  initialize(db);const store=ledger(db);
  const expensive={...price,rates:{input:'1000000',output:'1000000'}};
  const a=store.prepare({...cmd('large-0'),price:expensive});a.settle(usage(9000000,0));
  const original=JSON.parse(db.get("SELECT original FROM accounting_attempts_v1 WHERE id='large-0'").original);
  const evidence=db.get("SELECT evidence FROM accounting_terminals_v1 WHERE attempt_id='large-0'").evidence;
  const {canonical}=await import('/app/src/lib/accounting/attempt-payload.js');
  // Valid fixture rows bulk-installed to exercise sums beyond signed64 without
  // claiming 1100 individually dispatched network attempts.
  db.transaction(()=>{for(let i=1;i<1100;i++) {
    const id='large-'+i;
    db.run('INSERT INTO accounting_attempts_v1 VALUES (?,?,?,?,?,?)',[id,'key-A',now,original.windows.weekly.startAt,original.windows.monthly.startAt,canonical({...original,attemptId:id})]);
    db.run('INSERT INTO accounting_terminals_v1 VALUES (?,?,?)',[id,'9000000000000000',evidence]);
  }});
  assert.equal(store.totals('key-A',now).monthly,'9900000000000000000');
  assert.throws(()=>store.prepare({...cmd('bad'),attemptId:'a'+String.fromCharCode(0)+'b'}));
  assert.equal(count('accounting_attempts_v1'),1100);healthy();
`));

test('throwing transport and reentrant dispatch consume own ACK before initiation', () => child(`
  initialize(db);const store=ledger(db);const attempt=store.prepare(cmd('once'));let posts=0;
  assert.throws(()=>store.dispatch(attempt.ack,context(),()=>{
    posts++;assert.throws(()=>store.dispatch(attempt.ack,context(),()=>posts++));throw new Error('transport');
  }),/transport/);
  assert.throws(()=>store.dispatch(attempt.ack,context(),()=>posts++));assert.equal(posts,1);healthy();
`));

test('exact terminal cost rounds union once and explicit zero is reported, missing price refuses pre-intent', () => child(`
  assert.equal(terminalCost(usage(1,1),{...price,rates:{input:'0.0004',output:'0.0004'}}).amountNanoUsd,'1');
  assert.deepEqual(terminalCost(usage(0,0),price),{amountNanoUsd:'0',known:usage(0,0).components,unknown:[],provenance:'provider-reported'});
  initialize(db);const store=ledger(db);assert.throws(()=>store.prepare({...cmd('unpriced'),price:{}}));
  assert.equal(count('accounting_attempts_v1'),0);healthy();
`));

test('budget readback uses persisted exact policy, windows and recorded evidence for the requested key', () => child(`
  initialize(db);
  const writer = ledger(db);
  policy.save('key-A', 1, {weekly:'3000000',monthly:null});
  writer.prepare(cmd('first')).settle(usage());
  writer.prepare(cmd('defaulted')).settle(null);
  writer.prepare(cmd('pending'));
  writer.prepare(cmd('other','key-B')).settle(usage());
  const snapshot = ledger(db).inspectBudget('key-A', () => now);
  assert.deepEqual(snapshot.policy, {keyId:'key-A',bindingGeneration:'1',version:2,lifecycle:'active',limits:{weekly:'3000000',monthly:null}});
  assert.deepEqual(snapshot.usage, {weekly:{spent:'3000000',remaining:'0',resetAt:'2026-11-22T17:00:00.000Z'},
    monthly:{spent:'3000000',remaining:null,resetAt:'2026-11-30T17:00:00.000Z'},
    timezone:'Asia/Ho_Chi_Minh',unknownDefaulted:1,unrecorded:1});
  const next = writer.inspectBudget('key-A', () => snapshot.usage.weekly.resetAt);
  assert.equal(next.usage.weekly.spent,'0'); assert.equal(next.usage.monthly.spent,'3000000');
  assert.throws(() => writer.inspectBudget('absent', () => now));
  db.exec('DROP TABLE accounting_terminals_v1');
  assert.throws(() => writer.inspectBudget('key-A', () => now));
`));

for (const evidence of ['attempt', 'generation', 'retirement']) {
  test('missing policy with retained ' + evidence + ' cannot offer first-time setup', () => child(`
    initialize(db);
    const store = ledger(db);
    if ('${evidence}' === 'attempt') store.prepare(cmd('original'));
    if ('${evidence}' === 'retirement') policy.retireAudited('key-A', 1);
    db.exec('PRAGMA foreign_keys = OFF');
    if ('${evidence}' !== 'generation') db.run('DELETE FROM accounting_key_generations_v1 WHERE key_id = ?', ['key-A']);
    db.run('DELETE FROM accounting_key_policy_v1 WHERE key_id = ?', ['key-A']);
    db.run('UPDATE apiKeys SET isActive = 1 WHERE id = ?', ['key-A']);
    assert.throws(() => store.inspectBudget('key-A', () => now));
  `));
}
