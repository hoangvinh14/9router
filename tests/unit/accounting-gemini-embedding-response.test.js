import { beforeAll, describe, expect, it } from 'vitest';
let inspectRawGeminiEmbedding, readBufferedGeminiEmbedding;
beforeAll(async () => ({ inspectRawGeminiEmbedding, readBufferedGeminiEmbedding } = await import('../../open-sse/utils/accountingGeminiEmbedding.js')));
const message = batch => batch
  ? { embeddings: [{ values: [0.1, -0.2, 0] }, { values: [0.3, 0.4, 0.5] }], usageMetadata: { promptTokenCount: 12 } }
  : { embedding: { values: [0.1, -0.2, 0] }, usageMetadata: { promptTokenCount: 12 } };
const options = batch => ({ inputCount: batch ? 2 : 1, batch, dimensions: 3 });
const response = raw => Response.json(raw);
describe('raw Gemini text embedding envelope, not POST/ACK/model authority', () => {
  it.each([false, true])('whole %s single/batch response freezes vectors and raw exact counts', batch => {
    const raw = message(batch), result = inspectRawGeminiEmbedding(raw, options(batch));
    expect(result.usage).toMatchObject({ exact: true, input: 12, output: 0, provenance: { endpoint: 'embeddings' } });
    expect(result.message).toEqual(raw); expect(Object.isFrozen(result.message)).toBe(true);
    const vector = batch ? result.message.embeddings[0].values : result.message.embedding.values;
    expect(Object.isFrozen(vector)).toBe(true);
    (batch ? raw.embeddings[0] : raw.embedding).values[0] = 99;
    expect(vector[0]).toBe(0.1);
  });
  it('absent raw usage remains unknown, not normalized fabricated zero', () => {
    const raw = message(false); delete raw.usageMetadata;
    expect(inspectRawGeminiEmbedding(raw, options(false)).usage).toBeNull();
  });
  it.each(['extra-root', 'wrong-envelope', 'batch-count', 'empty-vector', 'nonfinite', 'dimensions', 'shape', 'usage-chat', 'usage-null'])('refuses malformed full envelope %s after positive', fault => {
    expect(inspectRawGeminiEmbedding(message(true), options(true)).usage.input).toBe(12);
    const raw = message(true);
    if (fault === 'extra-root') raw.error = { code: 400 };
    else if (fault === 'wrong-envelope') raw.embedding = { values: [0, 0, 0] };
    else if (fault === 'batch-count') raw.embeddings.pop();
    else if (fault === 'empty-vector') raw.embeddings[0].values = [];
    else if (fault === 'nonfinite') raw.embeddings[0].values[0] = Infinity;
    else if (fault === 'dimensions') raw.embeddings[0].values.pop();
    else if (fault === 'shape') raw.embeddings[0].shape = [1, 3];
    else if (fault === 'usage-chat') raw.usageMetadata.candidatesTokenCount = 0;
    else raw.usageMetadata = null;
    expect(() => inspectRawGeminiEmbedding(raw, options(true))).toThrow('Gemini embedding response unavailable');
  });
  it.each(['getter', 'proxy', 'cycle', 'oversize', 'options-getter'])('descriptor/bounds refusal %s has no programmable reads', fault => {
    expect(inspectRawGeminiEmbedding(message(false), options(false)).usage.input).toBe(12);
    let reads = 0; const trap = () => { reads++; throw new Error('Fixture programmable read'); };
    let raw = message(false), config = options(false);
    if (fault === 'getter') Object.defineProperty(raw.embedding, 'values', { enumerable: true, get: trap });
    else if (fault === 'proxy') raw = new Proxy(raw, { get: trap, ownKeys: trap });
    else if (fault === 'cycle') raw.embedding.values = [raw];
    else if (fault === 'oversize') raw.extra = 'x'.repeat(262145);
    else Object.defineProperty(config, 'inputCount', { enumerable: true, get: trap });
    expect(() => inspectRawGeminiEmbedding(raw, config)).toThrow('Gemini embedding response unavailable'); expect(reads).toBe(0);
  });
  it('bounded JSON reader requires complete raw EOF before returning metadata', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const stream = new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(message(false))));
      await pending; controller.close();
    } });
    let returned = false;
    const work = readBufferedGeminiEmbedding(new Response(stream, { headers: { 'content-type': 'application/json' } }), null, options(false));
    work.then(() => { returned = true; }, () => {});
    try { await Promise.resolve(); expect(returned).toBe(false); } finally { release(); }
    expect((await work).usage.input).toBe(12);
  });
  it.each(['bad-media', 'unverified-error-envelope', 'invalid-json', 'invalid-utf8'])('raw response %s cannot become evidence', async fault => {
    expect((await readBufferedGeminiEmbedding(response(message(false)), null, options(false))).usage.input).toBe(12);
    let upstream;
    if (fault === 'bad-media') upstream = new Response(JSON.stringify(message(false)), { headers: { 'content-type': 'text/plain' } });
    else if (fault === 'unverified-error-envelope') upstream = Response.json({ error: { code: 401, message: 'fixture-error' }, usageMetadata: { promptTokenCount: 12 } }, { status: 401 });
    else if (fault === 'invalid-json') upstream = new Response('{', { headers: { 'content-type': 'application/json' } });
    else upstream = new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } });
    await expect(readBufferedGeminiEmbedding(upstream, null, options(false))).rejects.toBeDefined();
  });
});
