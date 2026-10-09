import { describe, it, expect } from 'vitest';
import { readBufferedResponsesAccounting } from 'open-sse/utils/accountingResponsesUsage.js';
const message = () => ({ id: 'resp_fixture', object: 'response', model: 'fixture-responses', status: 'completed',
  error: null, incomplete_details: null, service_tier: 'default',
  output: [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'fixture', annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 10 } } });
const response = (body, options = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...options });
describe('sole bounded raw Responses JSON authority (not POST/provider approval)', () => {
  it('keeps native response separate from cache/reasoning exact monetary evidence after clean EOF', async () => {
    const original = message(); const result = await readBufferedResponsesAccounting(response(original), null, { expectedModel: original.model });
    expect(result.message).toEqual(original); expect(result.usage).toEqual({ exact: true, input: 100, output: 20, cacheRead: 40, cacheWrite: 0, reasoning: 10, reasoningIncludedInOutput: true,
      provenance: { schema: 'openai-responses', endpoint: 'chat', inputIncludesCache: true } });
  });
  it('explicit safe zero counts retain exact zero authority', async () => {
    const body = message(); body.usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
    expect((await readBufferedResponsesAccounting(response(body), null, { expectedModel: body.model })).usage).toMatchObject({ exact: true, input: 0, output: 0 });
  });
  it.each(['wrong-model', 'missing-id', 'wrong-object', 'incomplete', 'failed', 'error', 'incomplete-details', 'priority', 'missing-tier', 'missing-cache', 'missing-reasoning', 'wrong-total', 'unsafe-total', 'cache-above-input', 'reasoning-above-output', 'negative', 'estimated', 'unknown-usage-field', 'audio', 'hosted-output', 'unfinished-output'])('%s cannot certify a token-only success', async mode => {
    const body = message();
    if (mode === 'wrong-model') body.model = 'other';
    if (mode === 'missing-id') delete body.id;
    if (mode === 'wrong-object') body.object = 'chat.completion';
    if (mode === 'incomplete' || mode === 'failed') body.status = mode;
    if (mode === 'error') body.error = { code: 'fixture' };
    if (mode === 'incomplete-details') body.incomplete_details = { reason: 'max_output_tokens' };
    if (mode === 'priority') body.service_tier = 'priority';
    if (mode === 'missing-tier') delete body.service_tier;
    if (mode === 'missing-cache') delete body.usage.input_tokens_details.cached_tokens;
    if (mode === 'missing-reasoning') delete body.usage.output_tokens_details.reasoning_tokens;
    if (mode === 'wrong-total') body.usage.total_tokens = 119;
    if (mode === 'unsafe-total') { body.usage.input_tokens = Number.MAX_SAFE_INTEGER; body.usage.output_tokens = 1; body.usage.total_tokens = Number.MAX_SAFE_INTEGER; }
    if (mode === 'cache-above-input') body.usage.input_tokens_details.cached_tokens = 101;
    if (mode === 'reasoning-above-output') body.usage.output_tokens_details.reasoning_tokens = 21;
    if (mode === 'negative') body.usage.output_tokens = -1;
    if (mode === 'estimated') body.usage.estimated = true;
    if (mode === 'unknown-usage-field') body.usage.paid_tool_tokens = 1;
    if (mode === 'audio') body.usage.input_tokens_details.audio_tokens = 1;
    if (mode === 'hosted-output') body.output.push({ type: 'web_search_call', status: 'completed' });
    if (mode === 'unfinished-output') body.output[0].status = 'in_progress';
    await expect(readBufferedResponsesAccounting(response(body), null, { expectedModel: 'fixture-responses' })).rejects.toThrow();
  });
  it.each(['malformed', 'partial', 'bad-status', 'wrong-media'])('%s response does not become exact zero or native success', async mode => {
    const body = mode === 'malformed' ? '{bad}' : mode === 'partial' ? JSON.stringify(message()).slice(0, -1) : message();
    const options = mode === 'bad-status' ? { status: 429 } : mode === 'wrong-media' ? { headers: { 'content-type': 'text/event-stream' } } : {};
    await expect(readBufferedResponsesAccounting(response(body, options), null, { expectedModel: 'fixture-responses' })).rejects.toThrow();
  });
  it('already-aborted primitive reason remains exact with no body authority', async () => {
    const caller = new AbortController(); caller.abort(false);
    await expect(readBufferedResponsesAccounting(response(message()), caller.signal, { expectedModel: 'fixture-responses' })).rejects.toBe(false);
  });
  it('chunked JSON never returns before actual clean EOF', async () => {
    let end, ready; const started = new Promise(resolve => { ready = resolve; });
    const bytes = new TextEncoder().encode(JSON.stringify(message()));
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); end = () => controller.close(); ready(); } });
    let delivered = false;
    const work = readBufferedResponsesAccounting(new Response(stream, { headers: { 'content-type': 'application/json' } }), null, { expectedModel: 'fixture-responses' }).then(result => { delivered = true; return result; });
    await started; await Promise.resolve(); expect(delivered).toBe(false); end(); expect((await work).message.id).toBe('resp_fixture');
  });
});
