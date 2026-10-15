import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';
import { PROVIDERS } from 'open-sse/config/providers.js';
import anthropicRegistry from 'open-sse/providers/registry/anthropic.js';

const fixture = vi.hoisted(() => ({ url: null, registryDrift: false }));
// Only fixed owned URL substituted. Production registry beta/header semantics
// retained verbatim, never removed to manufacture standard-only admission.
vi.mock('../../open-sse/config/providers.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, PROVIDERS: { ...original.PROVIDERS, get anthropic() { return { ...original.PROVIDERS.anthropic,
    baseUrl: fixture.url, headers: fixture.registryDrift ? { ...original.PROVIDERS.anthropic.headers, 'Anthropic-Beta': 'fixture-foreign' } : original.PROVIDERS.anthropic.headers }; } } };
});
vi.mock('../../open-sse/config/accountedAnthropicCandidate.js', async importOriginal => {
  const original = await importOriginal();
  return { ...original, get ACCOUNTED_ANTHROPIC_CANDIDATE_URL() { return fixture.url; },
    supportsAnthropicCandidate(executor, options, url, body, headers) {
      return url === fixture.url && original.supportsAnthropicCandidate(executor, options, original.ACCOUNTED_ANTHROPIC_CANDIDATE_URL, body, headers);
    } };
});
vi.mock('../../src/lib/db/engineAcquisition.js', async importOriginal => {
  const original = await importOriginal();
  return process.env.ACCOUNTING_TEST_SQLJS === '1' ? { ...original, initializeAvailableAdapter: async () => null } : original;
});
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const wire = () => event('message_start', { message: { id: 'msg_beta', type: 'message', role: 'assistant', model: 'fixture-beta', content: [],
  usage: { input_tokens: 50, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } } } }) +
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }) + event('message_stop');
const options = accounting => ({ model: 'fixture-beta', stream: true, accountingMode: 'native-claude-beta-sse', connectionId: 'c', accounting,
  body: { model: 'fixture-beta', stream: true, max_tokens: 100, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture', cache_control: { type: 'ephemeral', ttl: '5m' } }] }] },
  credentials: { apiKey: 'dummy-provider' }, proxyOptions: { persistedGlobalProxy: { url: 'http://127.0.0.1:1', noProxy: '127.0.0.1' } } });
let db, directory, server, requests, failure, responder, createAccounting;
const previous = process.env.DATA_DIR;
beforeEach(async () => {
  vi.resetModules(); fixture.registryDrift = false; directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-beta-messages-'));
  process.env.DATA_DIR = directory; delete global._dbAdapter;
  db = await (await import('@/lib/db/driver.js')).getAdapter();
  if (process.env.ACCOUNTING_TEST_SQLJS === '1') expect(db.driver).toBe('sql.js');
  await (await import('@/lib/db/index.js')).importDb({ apiKeys: [{ id: 'a', key: 'dummy-key-a' }],
    settings: { requireApiKey: true, outboundProxyEnabled: true, outboundProxyUrl: 'http://127.0.0.1:1', outboundNoProxy: '127.0.0.1' },
    providerConnections: [{ id: 'c', provider: 'anthropic', authType: 'apikey', apiKey: 'dummy-provider' }] });
  db.durableTransaction(() => {
    db.run("INSERT INTO _meta(key,value) VALUES('ledgerStartedAt','2026-10-03T00:00:00.000Z')");
    db.run("INSERT INTO kv(scope,key,value) VALUES('pricing','anthropic',?)", [JSON.stringify({ 'fixture-beta': { input: '1', output: '2', cached: '0.1', cache_creation: '1.25' } })]);
  });
  requests = []; failure = null;
  responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire()); };
  server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      requests.push({ body: JSON.parse(Buffer.concat(chunks).toString()), beta: request.headers['anthropic-beta'], key: request.headers['x-api-key'],
        version: request.headers['anthropic-version'], row: db.get('SELECT requestId,state FROM apiKeyAccounting ORDER BY rowid DESC LIMIT 1') });
      await responder(request, response);
    } catch (error) { failure = error; response.writeHead(500); response.end('fixture error'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  fixture.url = `http://127.0.0.1:${server.address().port}/v1/messages`;
  createAccounting = () => import('@/lib/apiKeyBudget/requestAccounting.js').then(({ createRequestAccounting }) => createRequestAccounting(
    new Request('http://localhost/v1/messages', { headers: { Authorization: 'Bearer dummy-key-a' } }), { adapter: async () => db, queued: true }));
});
afterEach(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  vi.restoreAllMocks(); db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  fixture.registryDrift = false; if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
});
describe('explicit queued API-key production-registry beta (owned HTTP, not OAuth/general beta/TLS approval)', { timeout: 20000 }, () => {
  it('retains exact production beta and original wire at POST, original-price debit and own ACK before terminal', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const result = await context.completeAttempt(...args); enter(); await held; return result; }) };
    const args = options(accounting), original = structuredClone(args.body);
    expect(PROVIDERS.anthropic.headers).toEqual(anthropicRegistry.transport.headers);
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire());
    };
    const result = await new DefaultExecutor('anthropic').execute(args); let ended = false;
    const consume = result.response.text().then(text => { ended = true; return text; });
    try {
      await entered; expect(ended).toBe(false); expect(result.accountingLive).toBe(true);
      expect(requests).toEqual([{ body: original, beta: anthropicRegistry.transport.headers['Anthropic-Beta'], key: 'dummy-provider', version: '2023-06-01', row: { requestId: context.requestId, state: 'pending' } }]);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    } finally { release(); await consume; }
    expect(await consume).toBe(wire()); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(failure).toBeNull();
  });
  it.each(['thinking', 'image', 'document', 'tool-image'])('queued API-key %s preserves original/actual content, original price and own terminal ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); enter(); await held; return terminal; }) };
    const args = options(accounting), image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } };
    let raw = wire();
    if (mode === 'thinking') {
      args.body.max_tokens = 4096; args.body.thinking = { type: 'enabled', budget_tokens: 1024 };
      args.body.messages.unshift({ role: 'assistant', content: [{ type: 'thinking', thinking: 'original🙂 history', signature: 'EgAB' }, { type: 'text', text: 'answer' }] });
      raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }) +
        event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'observed🙂' } }) +
        event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } }) +
        event('content_block_stop', { index: 0 }) + 'event: message_delta');
    } else if (mode === 'tool-image') {
      args.body.tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
      args.body.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', is_error: true, content: [{ type: 'text', text: 'original error' }, image] }] });
    } else args.body.messages[0].content.unshift(mode === 'image' ? image : { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'original🙂 document' }, title: 'original title', context: 'original context' });
    const original = structuredClone(args.body);
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const result = await new DefaultExecutor('anthropic').execute(args); let ended = false;
    const consume = result.response.text().then(text => { ended = true; return text; });
    try {
      await entered; expect(ended).toBe(false); expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original);
      expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' });
      expect(requests[0].beta).toBe(anthropicRegistry.transport.headers['Anthropic-Beta']);
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    } finally { release(); await consume; }
    expect(await consume).toBe(raw); expect(args.body).toEqual(original); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    const row = db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting');
    expect(JSON.stringify(row)).not.toMatch(/original|opaque-signature|aW5saW5l/); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http'])('inline document citation %s preserves actual wire and own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async completeAttempt(...input) { const result = await context.completeAttempt(...input); enter(); await held; return result; } };
    const args = options(accounting), document = { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'original citation document' }, title: 'citation title', citations: { enabled: true } };
    args.body.messages[0].content.unshift(document); const original = structuredClone(args.body);
    const citation = { type: 'char_location', document_index: 0, document_title: 'citation title', cited_text: 'original citation', start_char_index: 0, end_char_index: 8 };
    const raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'cited answer' } }) + event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta');
    responder = (_request, response) => { response.writeHead(mode === 'success' ? 200 : 429, { 'content-type': 'text/event-stream' }); response.end(raw); };
    const work = new DefaultExecutor('anthropic').execute(args); let finished = false;
    const consume = work.then(result => result.response.text()); consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try { expect(reached).toBe(true); expect(finished).toBe(false); expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original);
      expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); }
    finally { release(); }
    if (mode === 'success') expect(await consume).toBe(raw);
    else { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('original citation'); }
    expect(args.body).toEqual(original); expect(JSON.stringify(db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'))).not.toContain('original citation'); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'out-of-range', 'erased-source', 'url-success', 'url-failed-http', 'url-out-of-range', 'url-erased-source'])('API-key custom document %s keeps original source/raw range/own ACK', async rawMode => {
    const mode = rawMode.replace(/^url-/, '');
    const context = await createAccounting(); let enter, persisted, release;
    const entered = new Promise(resolve => { enter = resolve; }), durable = new Promise(resolve => { persisted = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { enter(); const result = await context.completeAttempt(...input); persisted(); await held; return result; }) };
    const args = options(accounting), document = { type: 'document', source: { type: 'content', content: [{ type: 'text', text: 'original custom chunk' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } }] }, title: 'custom title', citations: { enabled: true } };
    if (rawMode.startsWith('url-')) document.source.content[1].source = { type: 'url', url: 'https://media.example.invalid/custom%20source.png?version=1' };
    args.body.messages[0].content.unshift(document); const original = structuredClone(args.body), executor = new DefaultExecutor('anthropic');
    if (mode === 'erased-source') {
      executor.transformRequest = (_model, body) => { body.messages[0].content[0].source.content.pop(); return body; };
      await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return;
    }
    const citation = { type: 'content_block_location', document_index: 0, document_title: 'custom title', cited_text: 'original custom chunk', start_block_index: 0, end_block_index: mode === 'out-of-range' ? 3 : 1 };
    const raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'custom answer' } }) + event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta');
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const work = executor.execute(args); let finished = false, captured = '';
    const consume = work.then(async result => {
      const reader = result.response.body.getReader(), decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; captured += decoder.decode(chunk.value, { stream: true }); }
      return captured;
    });
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try {
      expect(reached).toBe(true); await durable;
      if (mode === 'out-of-range') { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(finished).toBe(true); }
      else expect(finished).toBe(false);
      expect(captured).not.toContain('event: message_stop');
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([mode === 'out-of-range' ? { state: 'unresolved', costNanoUsd: null } : { state: 'settled', costNanoUsd: 106500 }]);
    } finally { release(); }
    if (mode === 'out-of-range') { await expect(consume).rejects.toThrow(); expect(captured).not.toContain('event: message_stop'); }
    else if (mode === 'success') expect(await consume).toBe(raw);
    else { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('original custom chunk'); }
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(args.body).toEqual(original);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'))).not.toMatch(/original custom chunk|custom title|aW5saW5l|media.example.invalid/); expect(failure).toBeNull();
  });
  it.each(['delivered', 'erased-history'])('API-key citation replay %s preserves whole original and owns terminal ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const result = await context.completeAttempt(...input); enter(); await held; return result; }) };
    const args = options(accounting), citation = { type: 'char_location', document_index: 0, document_title: 'replay title', cited_text: 'replay source', start_char_index: 0, end_char_index: 6 };
    args.body.messages = [{ role: 'user', content: [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'replay source' }, title: 'replay title', citations: { enabled: true } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'replay answer', citations: [citation] }] }, { role: 'user', content: 'continue' }];
    const original = structuredClone(args.body), executor = new DefaultExecutor('anthropic');
    if (mode === 'erased-history') {
      executor.transformRequest = (_model, body) => { delete body.messages[1].content[0].citations; return body; };
      await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return;
    }
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(wire());
    };
    const work = executor.execute(args), consume = work.then(result => result.response.text()); let finished = false;
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try { expect(reached).toBe(true); expect(finished).toBe(false); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); }
    finally { release(); }
    expect(await consume).toBe(wire()); expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(args.body).toEqual(original);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'))).not.toMatch(/replay source|replay title|replay answer/); expect(failure).toBeNull();
  });
  it.each(['image-success', 'pdf-success', 'image-failed-http', 'pdf-failed-http', 'erased-source'])('API-key URL media %s preserves actual reference, raw-only cost and own ACK', async mode => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { const result = await context.completeAttempt(...input); enter(); await held; return result; }) };
    const args = options(accounting), pdf = mode.startsWith('pdf');
    const media = { type: pdf ? 'document' : 'image', source: { type: 'url', url: `https://media.example.invalid/original%20asset?version=${pdf ? 'pdf' : 'image'}` },
      ...(pdf ? { title: 'URL title', context: 'URL context', citations: { enabled: true } } : {}) };
    args.body.messages[0].content.unshift(media); const original = structuredClone(args.body), executor = new DefaultExecutor('anthropic');
    if (mode === 'erased-source') {
      executor.transformRequest = (_model, body) => { body.messages[0].content.shift(); return body; };
      await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return;
    }
    const raw = pdf ? wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation: { type: 'page_location', document_index: 0, document_title: 'URL title', cited_text: 'URL cited text', start_page_number: 1, end_page_number: 2 } } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta') : wire();
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(mode.endsWith('failed-http') ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const work = executor.execute(args), consume = work.then(result => result.response.text()); let finished = false;
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try { expect(reached).toBe(true); expect(finished).toBe(false); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); }
    finally { release(); }
    if (mode.endsWith('failed-http')) { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('URL cited text'); }
    else expect(await consume).toBe(raw);
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(args.body).toEqual(original);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'))).not.toMatch(/media.example.invalid|URL title|URL context|URL cited text/); expect(failure).toBeNull();
  });
  it.each(['success', 'failed-http', 'tool-source', 'wrong-source', 'erased-source'])('API-key client RAG %s binds original source/raw citation and own terminal ACK', async mode => {
    const context = await createAccounting(); let enter, persisted, release;
    const entered = new Promise(resolve => { enter = resolve; }), durable = new Promise(resolve => { persisted = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...input) => { enter(); const result = await context.completeAttempt(...input); persisted(); await held; return result; }) };
    const args = options(accounting), source = { type: 'search_result', source: 'kb://original/item', title: 'RAG title', content: [{ type: 'text', text: 'original RAG chunk' }], citations: { enabled: true } };
    args.body.messages[0].content.unshift(source);
    if (mode === 'tool-source') {
      args.body.tools = [{ name: 'lookup', input_schema: { type: 'object' } }];
      args.body.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'use', name: 'lookup', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'use', is_error: true, content: [{ ...source, source: 'kb://original/tool' }] }] });
    }
    const original = structuredClone(args.body), executor = new DefaultExecutor('anthropic');
    if (mode === 'erased-source') {
      executor.transformRequest = (_model, body) => { body.messages[0].content.shift(); return body; };
      await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); return;
    }
    const citation = { type: 'search_result_location', source: mode === 'wrong-source' ? 'kb://foreign/item' : mode === 'tool-source' ? 'kb://original/tool' : source.source, title: source.title, cited_text: 'original RAG chunk', search_result_index: mode === 'tool-source' ? 1 : 0, start_block_index: 0, end_block_index: 1 };
    const raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'text', text: '', citations: [] } }) +
      event('content_block_delta', { index: 0, delta: { type: 'citations_delta', citation } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta');
    responder = (_request, response) => {
      db.durableTransaction(() => db.run("UPDATE kv SET value=? WHERE scope='pricing' AND key='anthropic'", [JSON.stringify({ 'fixture-beta': { input: '9', output: '9', cached: '9', cache_creation: '9' } })]));
      response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw);
    };
    const work = executor.execute(args); let finished = false, captured = '';
    const consume = work.then(async result => { const reader = result.response.body.getReader(), decoder = new TextDecoder();
      while (true) { const chunk = await reader.read(); if (chunk.done) break; captured += decoder.decode(chunk.value, { stream: true }); } return captured;
    });
    consume.then(() => { finished = true; }, () => { finished = true; });
    const reached = await Promise.race([entered.then(() => true), consume.then(() => false, () => false)]);
    try { expect(reached).toBe(true); await durable;
      if (mode === 'wrong-source') { await expect(consume).rejects.toThrow('Gateway accounting stream unavailable'); expect(finished).toBe(true); }
      else expect(finished).toBe(false);
      expect(captured).not.toContain('event: message_stop');
      expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([mode === 'wrong-source' ? { state: 'unresolved', costNanoUsd: null } : { state: 'settled', costNanoUsd: 106500 }]);
    } finally { release(); }
    if (mode === 'wrong-source') await expect(consume).rejects.toThrow();
    else if (mode === 'failed-http') { expect((await work).response.status).toBe(429); expect(await consume).not.toContain('original RAG chunk'); }
    else expect(await consume).toBe(raw);
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(args.body).toEqual(original);
    expect(requests[0].row).toEqual({ requestId: context.requestId, state: 'pending' }); expect(accounting.completeAttempt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'))).not.toMatch(/kb:\/\/|RAG title|original RAG chunk/); expect(failure).toBeNull();
  });
  it('documented nonzero initial usage without server counters uses original token-only authority and cumulative debit', async () => {
    const args = options(await createAccounting());
    const raw = wire().replace('"output_tokens":0', '"output_tokens":2').replace(',"server_tool_use":{"web_search_requests":0}', '');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    expect(await (await new DefaultExecutor('anthropic').execute(args)).response.text()).toBe(raw);
    expect(requests).toHaveLength(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    expect(JSON.parse(db.get('SELECT usageJson FROM apiKeyAccounting').usageJson)).toMatchObject({ output: 20 }); expect(failure).toBeNull();
  });
  it('API-key redacted original and raw output preserve opaque data with token-only debit', async () => {
    const context = await createAccounting(), args = options(context);
    args.body.max_tokens = 4096; args.body.thinking = { type: 'enabled', budget_tokens: 1024 };
    args.body.messages.unshift({ role: 'assistant', content: [{ type: 'redacted_thinking', data: 'opaque-original🙂' }, { type: 'text', text: 'answer' }] });
    const original = structuredClone(args.body);
    const raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'redacted_thinking', data: 'opaque-response' } }) + event('content_block_stop', { index: 0 }) + 'event: message_delta');
    responder = (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    expect(await (await new DefaultExecutor('anthropic').execute(args)).response.text()).toBe(raw);
    expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original); expect(args.body).toEqual(original);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]);
    expect(JSON.stringify(db.get('SELECT usageJson,priceSnapshotJson FROM apiKeyAccounting'))).not.toMatch(/opaque-original|opaque-response/);
    expect(failure).toBeNull();
  });
  it.each(['thinking', 'media'])('queued beta validates original as well as actual %s after transform', async mode => {
    const args = options(await createAccounting()), executor = new DefaultExecutor('anthropic');
    if (mode === 'thinking') { args.body.max_tokens = 4096; args.body.thinking = { type: 'enabled', budget_tokens: 1024 }; }
    else args.body.messages[0].content.unshift({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' } });
    executor.transformRequest = (_model, body) => { if (mode === 'thinking') delete body.thinking; else body.messages[0].content.shift(); return body; };
    await expect(executor.execute(args)).rejects.toThrow(); expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each(['getter', 'toJSON'])('programmable API-key source %s is rejected without invocation', async mode => {
    const args = options(await createAccounting()); let invoked = 0;
    const source = { type: 'base64', media_type: 'image/png', data: 'aW5saW5l' };
    if (mode === 'getter') Object.defineProperty(source, 'data', { enumerable: true, get() { invoked++; return 'aW5saW5l'; } });
    else source.toJSON = () => { invoked++; return {}; };
    args.body.messages[0].content.unshift({ type: 'image', source });
    await expect(new DefaultExecutor('anthropic').execute(args)).rejects.toThrow(); expect(invoked).toBe(0);
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0);
  });
  it.each(['missing-signature', 'missing-stop', 'failed-http', 'unknown-usage', 'lost-ack', 'terminal-credential-drift', 'budget-crossing'])('thinking raw/authority %s keeps sole sink, exact-or-unknown and fresh successor gates', async mode => {
    const context = await createAccounting(); let observed;
    const acknowledged = new Promise(resolve => { observed = resolve; });
    if (mode === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)',
      ['a', 100000, null, 1, '2026-10-03T00:00:00.000Z']));
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); observed();
      if (mode === 'lost-ack') throw new Error('fixture lost ACK'); return terminal;
    }), assertAnthropicBetaTerminal(attempt, terminal) {
      if (mode === 'terminal-credential-drift') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
      return context.assertAnthropicBetaTerminal(attempt, terminal);
    } };
    const args = options(accounting); args.body.max_tokens = 4096; args.body.thinking = { type: 'enabled', budget_tokens: 1024 };
    let raw = wire().replace('event: message_delta', event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'observed🙂' } }) +
      (mode === 'missing-signature' ? '' : event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'opaque' } })) +
      event('content_block_stop', { index: 0 }) + 'event: message_delta');
    if (mode === 'missing-stop') raw = raw.split('event: message_stop')[0];
    if (mode === 'unknown-usage') raw = raw.replace('"output_tokens":20', '"output_tokens":"20"');
    responder = (_request, response) => { response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' }); response.end(raw); };
    const result = await new DefaultExecutor('anthropic').execute(args);
    if (mode === 'failed-http') { expect(result.response.status).toBe(429); expect(await result.response.json()).toMatchObject({ error: { message: 'Rate limit exceeded' } }); }
    else if (mode === 'budget-crossing') expect(await result.response.text()).toBe(raw);
    else await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    await acknowledged; expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
    const unknown = ['missing-signature', 'missing-stop', 'unknown-usage'].includes(mode);
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: unknown ? 'unresolved' : 'settled', costNanoUsd: unknown ? null : 106500 }]);
    if (mode === 'budget-crossing') {
      await expect(new DefaultExecutor('anthropic').execute(options(await createAccounting()))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
      expect(requests).toHaveLength(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    }
  });
  it('installed intent is not delivered ACK permission for beta POST', async () => {
    const context = await createAccounting(); let enter, release;
    const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const accounting = { ...context, async beforeAttempt(...args) { const attempt = await context.beforeAttempt(...args); enter(); await held; return attempt; } };
    const work = new DefaultExecutor('anthropic').execute(options(accounting));
    try { await entered; expect(requests).toHaveLength(0); expect(db.all('SELECT state FROM apiKeyAccounting')).toEqual([{ state: 'pending' }]); }
    finally { release(); }
    expect(await (await work).response.text()).toBe(wire()); expect(requests).toHaveLength(1); expect(failure).toBeNull();
  });
  it.each(['delivered', 'terminal-credential-drift', 'terminal-registry-drift', 'copied-attempt', 'wrong-terminal', 'budget-crossing'])('beta client-tool history keeps original blocks and sole debit: %s', async mode => {
    const context = await createAccounting(); let observed;
    const acknowledged = new Promise(resolve => { observed = resolve; });
    if (mode === 'budget-crossing') db.durableTransaction(() => db.run('INSERT INTO apiKeyBudgetPolicies(apiKeyId,weeklyLimitNanoUsd,monthlyLimitNanoUsd,version,updatedAt) VALUES(?,?,?,?,?)',
      ['a', 100000, null, 1, '2026-10-03T00:00:00.000Z']));
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); observed(); return terminal; }),
      assertAnthropicBetaTerminal(attempt, terminal) {
        if (mode === 'terminal-credential-drift') db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
        if (mode === 'terminal-registry-drift') fixture.registryDrift = true;
        return context.assertAnthropicBetaTerminal(mode === 'copied-attempt' ? { ...attempt } : attempt,
          mode === 'wrong-terminal' ? { ...terminal, requestId: 'wrong' } : terminal);
      } };
    const args = options(accounting);
    args.body.tools = [{ name: 'fixture_lookup', input_schema: { type: 'object' } }];
    args.body.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'tool_beta', name: 'fixture_lookup', input: { query: 'fixture🙂' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_beta', is_error: true, content: 'fixture error🙂' }] });
    const original = structuredClone(args.body), result = await new DefaultExecutor('anthropic').execute(args);
    if (['delivered', 'budget-crossing'].includes(mode)) expect(await result.response.text()).toBe(wire());
    else await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    await acknowledged; expect(requests).toHaveLength(1); expect(requests[0].body).toEqual(original);
    expect(requests[0].beta).toBe(anthropicRegistry.transport.headers['Anthropic-Beta']);
    expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: 'settled', costNanoUsd: 106500 }]); expect(failure).toBeNull();
    if (mode === 'budget-crossing') {
      await expect(new DefaultExecutor('anthropic').execute(options(await createAccounting()))).rejects.toMatchObject({ code: 'api_key_budget_exceeded' });
      expect(requests).toHaveLength(1); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(1);
    }
  });
  it.each(['strip-beta', 'foreign-beta', 'client-beta', 'registry-drift', 'OAuth', '1h', 'thinking', 'ordinary-mode', 'bare-prepared', 'credential-dequeue'])('unsupported %s refuses before POST/intent', async mode => {
    const context = await createAccounting(), args = options(context), executor = new DefaultExecutor('anthropic');
    if (mode === 'strip-beta') executor.buildHeaders = (...args) => { const headers = DefaultExecutor.prototype.buildHeaders.apply(executor, args); delete headers['Anthropic-Beta']; return headers; };
    if (mode === 'foreign-beta') args.providerOverrides = { headers: { 'Anthropic-Beta': 'fixture-foreign' } };
    if (mode === 'client-beta') args.credentials.rawHeaders = { 'anthropic-beta': 'fixture-foreign' };
    if (mode === 'registry-drift' || mode === 'credential-dequeue') args.accounting = { ...context, beforeAttempt(meta, supported, wire) {
      const work = context.beforeAttempt(meta, supported, wire);
      if (mode === 'registry-drift') fixture.registryDrift = true;
      else db.durableTransaction(() => db.run("UPDATE providerConnections SET data=? WHERE id='c'", [JSON.stringify({ apiKey: 'dummy-rotated' })]));
      return work;
    } };
    if (mode === 'OAuth') args.credentials = { accessToken: 'dummy-oauth', apiKey: 'sk-ant-oat-dummy' };
    if (mode === '1h') args.body.messages[0].content[0].cache_control.ttl = '1h';
    if (mode === 'thinking') args.body.thinking = { type: 'enabled', budget_tokens: 1024 };
    if (mode === 'ordinary-mode') args.accountingMode = 'native-claude-sse';
    if (mode === 'bare-prepared') args.accounting = { ...context, requiresPreparedBaseWire: false };
    await expect(executor.execute(args)).rejects.toThrow();
    expect(requests).toHaveLength(0); expect(db.all('SELECT * FROM apiKeyAccounting')).toHaveLength(0); expect(db.coverage.status('a').gaps).toHaveLength(0);
  });
  it.each(['missing-stop', 'lost-ack', 'failed-http', '1h-raw'])('beta raw/terminal %s keeps sole sink and never replays', async mode => {
    const context = await createAccounting(); let observed;
    const ack = new Promise(resolve => { observed = resolve; });
    const accounting = { ...context, completeAttempt: vi.fn(async (...args) => { const terminal = await context.completeAttempt(...args); observed(); if (mode === 'lost-ack') throw new Error('fixture lost ACK'); return terminal; }) };
    responder = (_request, response) => { response.writeHead(mode === 'failed-http' ? 429 : 200, { 'content-type': 'text/event-stream' });
      response.end(mode === 'missing-stop' ? wire().split('event: message_stop')[0] : mode === '1h-raw' ? wire().replace('"ephemeral_5m_input_tokens":10,"ephemeral_1h_input_tokens":0', '"ephemeral_5m_input_tokens":5,"ephemeral_1h_input_tokens":5') : wire()); };
    if (mode === 'failed-http') {
      const result = await new DefaultExecutor('anthropic').execute(options(accounting)); expect(result.response.status).toBe(429);
      expect(await result.response.json()).toMatchObject({ error: { message: 'Rate limit exceeded' } });
    } else {
      const result = await new DefaultExecutor('anthropic').execute(options(accounting)); await expect(result.response.text()).rejects.toThrow('Gateway accounting stream unavailable');
    }
    await ack; expect(accounting.completeAttempt).toHaveBeenCalledTimes(1); expect(requests).toHaveLength(1); expect(failure).toBeNull();
    expect(db.all('SELECT state,costNanoUsd FROM apiKeyAccounting')).toEqual([{ state: ['missing-stop', '1h-raw'].includes(mode) ? 'unresolved' : 'settled', costNanoUsd: ['missing-stop', '1h-raw'].includes(mode) ? null : 106500 }]);
  });
});
