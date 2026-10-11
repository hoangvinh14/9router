import { describe, expect, it } from 'vitest';
import { readBufferedGeminiEmbedding } from '../../open-sse/utils/accountingGeminiEmbedding.js';
const options = { batch: false, inputCount: 1 };
// Defensive status/body independence using the documented embedding envelope;
// not a claim that provider failures normally contain this envelope.
const raw = (count = 12) => ({ embedding: { values: [0.1, -0.2, 0] }, usageMetadata: { promptTokenCount: count } });
const read = message => readBufferedGeminiEmbedding(Response.json(message, { status: 429 }), null, options);
const positive = async () => expect((await read(raw())).usage).toMatchObject({ exact: true, input: 12, output: 0 });
describe('Gemini embedding failed-status explicit raw evidence, not settlement/permission', () => {
  it.each([0, 12])('failed HTTP with explicit prompt count %s preserves exact evidence', async count => {
    const result = await read(raw(count));
    expect(result.usage).toMatchObject({ exact: true, input: count, output: 0 });
    expect(result.message).toEqual(raw(count)); expect(Object.isFrozen(result.message.embedding)).toBe(true);
  });
  it('failed full embedding envelope without raw metadata remains unknown, not normalized zero', async () => {
    await positive(); const message = raw(); delete message.usageMetadata;
    expect((await read(message)).usage).toBeNull();
  });
  it.each(['error-envelope', 'coerced-count', 'chat-count', 'null-usage', 'extra-root', 'missing-vector', 'error-shape'])('refuses %s after accepted explicit raw failure', async fault => {
    await positive(); const message = raw();
    if (fault === 'error-envelope') { delete message.embedding; message.error = { code: 429, message: 'fixture-private-error', status: 'RESOURCE_EXHAUSTED' }; }
    else if (fault === 'coerced-count') message.usageMetadata.promptTokenCount = '12';
    else if (fault === 'chat-count') message.usageMetadata.candidatesTokenCount = 0;
    else if (fault === 'null-usage') message.usageMetadata = null;
    else if (fault === 'extra-root') message.extra = true;
    else if (fault === 'missing-vector') delete message.embedding;
    else message.error = 'fixture-private-error';
    await expect(read(message)).rejects.toThrow('Gemini embedding response unavailable');
  });
  it('raw metadata cannot escape before failed-status full EOF', async () => {
    await positive(); let release; const barrier = new Promise(resolve => { release = resolve; });
    const stream = new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(raw())));
      await barrier; controller.close();
    } });
    let returned = false;
    const work = readBufferedGeminiEmbedding(new Response(stream, { status: 429, headers: { 'content-type': 'application/json' } }), null, options);
    work.then(() => { returned = true; }, () => {});
    try { await Promise.resolve(); expect(returned).toBe(false); } finally { release(); }
    expect((await work).usage.input).toBe(12);
  });
  it('truncated failed-status body cannot certify metadata', async () => {
    await positive(); const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(raw()))); controller.error(new Error('fixture-read-failed'));
    } });
    await expect(readBufferedGeminiEmbedding(new Response(stream, { status: 429, headers: { 'content-type': 'application/json' } }), null, options)).rejects.toBeDefined();
  });
});
