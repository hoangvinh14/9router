import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, rawUsage, jsonReply, gate, observe, reach } from '../fixtures/accounting/chat-loopback.js';
import { openFixture } from '../fixtures/accounting/test-database.js';
import { event, streamDelta, streamFinish, streamReply } from '../fixtures/accounting/chat-stream.js';
import { createAccountingService } from '../../src/lib/accounting/service.js';
import { normalizeOpenAIUsage, OPENAI_EXPLICIT_USAGE_PROFILE } from '../../open-sse/utils/accounting-openai-usage.js';

let fixture;
async function setup(engine, options) {
  for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']) vi.stubEnv(name, '');
  fixture = await openChatFixture(engine, options);
  return fixture;
}
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (fixture) { await fixture.close(); fixture = null; } });

function failNextPublication(engine, f) {
  let injected = false;
  if (engine === 'sqljs') {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (!injected && target === f.file) { injected = true; throw new Error('terminal publication failed'); }
      return rename(source, target);
    });
  } else {
    const exec = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(sql, ...args) {
      if (!injected && sql.startsWith('RELEASE sp_0_')) { injected = true; throw new Error('terminal publication failed'); }
      return exec.call(this, sql, ...args);
    });
  }
  return () => expect(injected).toBe(true);
}
async function reopened(engine, f, inspect) {
  f.db.beforeClose = undefined;
  f.db.close();
  const fresh = await openFixture(engine, f.file);
  try { await inspect(fresh.db); expect(fresh.db.get("SELECT value FROM _meta WHERE key='ledgerStartedAt'")).toBeUndefined(); }
  finally { fresh.db.close(); }
}
const reply = (res, stream, usage = rawUsage(400)) => {
  res.setHeader('content-type', stream ? 'text/event-stream' : 'application/json');
  res.end(stream ? streamReply(usage) : JSON.stringify(jsonReply(usage)));
};
const read = async response => ({status:response.status, text:await response.text()});

for (const engine of ['node', 'sqljs']) for (const stream of [false, true]) describe(`${engine} actual ${stream ? 'SSE' : 'JSON'} durable completion`, () => {
  it.each(['held', 'lost'])('requires own %s gap ACK after dispatched terminal publication fails', async mode => {
    let verifyFault;
    const f = await setup(engine, {respond:(_req,res) => {
      expect(f.db.get('SELECT state FROM apiKeyAccounting').state).toBe('pending');
      verifyFault = failNextPublication(engine, f);
      reply(res, stream);
    }});
    const entered = gate(), held = gate(); let delivered = false;
    const outcome = observe(f.request({stream, hooks:{gapAck:async () => {
      entered.release();
      if (mode === 'lost') throw new Error('own gap ACK lost');
      await held.promise;
    }}}).then(read).then(result => { delivered = true; return result; }));
    try {
      await reach(entered, outcome);
      verifyFault(); expect(f.posts).toBe(1);
      expect(f.db.coverage.status('key-one').gaps).toHaveLength(1);
      expect(f.db.coverage.status('key-two').gaps).toHaveLength(0);
      if (mode === 'held') expect(delivered).toBe(false);
      held.release(); const result = await outcome; if (!result.ok) throw result.error;
      if (mode === 'held') { expect(result.value.status).toBe(200); expect(result.value.text).toContain(stream ? '"finish_reason":"stop"' : 'hello'); }
      else if (stream) { expect(result.value.text).toContain('"error"'); expect(result.value.text).not.toContain('"finish_reason":"stop"'); }
      else expect(result.value.status).toBe(503);
      vi.restoreAllMocks();
      await reopened(engine, f, db => {
        expect(db.get('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting')).toEqual({apiKeyId:'key-one',state:'unresolved',costNanoUsd:null});
        expect(db.coverage.status('key-one').gaps).toHaveLength(1);
        expect(db.coverage.status('key-two').gaps).toHaveLength(0);
        expect(db.all('SELECT apiKeyId FROM apiKeyBindings ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one'},{apiKeyId:'key-two'}]);
      });
    } finally { held.release(); await outcome; }
  });

  it.each(['status', 'network'])('settles the %s predecessor before an actual native retry', async failure => {
    let predecessor;
    const f = await setup(engine, {respond:(_req,res,count) => {
      if (count === 1) {
        if (failure === 'network') { res.destroy(); return; }
        res.statusCode = 503; res.setHeader('content-type','application/json');
        res.end(JSON.stringify({error:{message:'fixture retry'},usage:rawUsage(400)}));return;
      }
      const rows = f.db.all('SELECT state,costNanoUsd FROM apiKeyAccounting ORDER BY startedAt');
      expect(rows).toHaveLength(2); predecessor = rows[0];
      expect(predecessor).toEqual(failure === 'status' ? {state:'settled',costNanoUsd:900000} : {state:'unresolved',costNanoUsd:null});
      expect(rows[1].state).toBe('pending'); reply(res, stream);
    }});
    const result = await read(await f.request({stream}));expect(result.status).toBe(200);expect(result.text).toContain(stream ? '"finish_reason":"stop"' : 'hello');expect(f.posts).toBe(2);expect(predecessor).toBeDefined();
    await reopened(engine, f, db => expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting ORDER BY startedAt')).toEqual([predecessor,{state:'settled',costNanoUsd:900000}]));
  });

  it('reopens unknown usage and concurrent identities without inventing zero cost', async () => {
    const f = await setup(engine, {respond:(_req,res,_count,wire) => {
      if (wire.body.user === 'known') return reply(res, stream);
      res.setHeader('content-type',stream ? 'text/event-stream' : 'application/json');
      const raw = jsonReply(); delete raw.usage;
      res.end(stream ? event(streamDelta)+event(streamFinish)+event('[DONE]') : JSON.stringify(raw));
    }});
    const responses = await Promise.all([f.request({stream}),f.request({stream,key:'fixture-secret-two',body:{user:'known'}})]);
    await Promise.all(responses.map(read));expect(f.posts).toBe(2);
    await reopened(engine, f, db => {
      expect(db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting ORDER BY apiKeyId')).toEqual([{apiKeyId:'key-one',state:'unresolved',costNanoUsd:null},{apiKeyId:'key-two',state:'settled',costNanoUsd:900000}]);
      expect(db.coverage.status('key-one').gaps).toHaveLength(0);expect(db.coverage.status('key-two').gaps).toHaveLength(0);
    });
  });

  it('reopens one original-price late settlement after duplicate and conflicting callbacks', async () => {
    const f = await setup(engine, {respond:(_req,res) => {
      res.setHeader('content-type',stream ? 'text/event-stream' : 'application/json');
      const raw = jsonReply();delete raw.usage;
      res.end(stream ? event(streamDelta)+event(streamFinish)+event('[DONE]') : JSON.stringify(raw));
    }});
    let receipt;await read(await f.request({stream,hooks:{intentAck:value => { receipt = value; }}}));
    const originalSnapshot=f.db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson;
    f.db.durableTransaction(() => f.db.run("UPDATE kv SET value=? WHERE scope='pricing'",[JSON.stringify({fixture:{input:'9',output:'9',cached:'9'}})]));
    const service = createAccountingService(f.db);
    const terminal = {state:'settled',outcome:'late_exact_usage',finishedAt:new Date().toISOString(),usage:normalizeOpenAIUsage(rawUsage(400),OPENAI_EXPLICIT_USAGE_PROFILE)};
    await service.completeAttempt(receipt,terminal);await service.completeAttempt(receipt,terminal);
    await expect(service.completeAttempt(receipt,{...terminal,usage:normalizeOpenAIUsage(rawUsage(401),OPENAI_EXPLICIT_USAGE_PROFILE)})).rejects.toThrow(/conflict/);
    await reopened(engine, f, db => {
      expect(db.all('SELECT apiKeyId,state,costNanoUsd FROM apiKeyAccounting')).toEqual([{apiKeyId:'key-one',state:'settled',costNanoUsd:900000}]);
      expect(db.get('SELECT priceSnapshotJson FROM apiKeyAccounting').priceSnapshotJson).toBe(originalSnapshot);
    });
  });
});

for (const engine of ['node','sqljs']) it(`${engine} parses native fragmented UTF-8, CRLF and multiline SSE before durable completion`, async () => {
  const delta={...streamDelta,choices:[{index:0,delta:{content:'héllo 😀'},finish_reason:null}]};
  const first=JSON.stringify(delta), split=first.indexOf(',');
  const wire=Buffer.from(`data: ${first.slice(0,split+1)}\r\ndata: ${first.slice(split+1)}\r\n\r\n`+streamReply(rawUsage(400)).slice(event(streamDelta).length).replaceAll('\n','\r\n'));
  const f=await setup(engine,{respond:async (_req,res) => {
    res.setHeader('content-type','text/event-stream');
    for(let offset=0;offset<wire.length;offset++){res.write(wire.subarray(offset,offset+1));await new Promise(resolve=>setImmediate(resolve));}
    res.end();
  }});
  const output=await (await f.request({stream:true})).text();expect(output).toContain('héllo 😀');expect(output).toContain('"finish_reason":"stop"');expect(output).toContain('[DONE]');expect(f.posts).toBe(1);
  await reopened(engine,f,db=>expect(db.get('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual({state:'settled',costNanoUsd:900000}));
});
