import { beforeAll, describe, expect, it, vi } from 'vitest';
let route;
beforeAll(async () => { ({ routeAccountingCommandCodeResponse: route } = await import('open-sse/utils/accountingCommandCodeResponseRoute.js')); });
const encode = value => new TextEncoder().encode(value);
const line = value => JSON.stringify(value) + '\n';
const prefix = line({ type: 'start' }) + line({ type: 'start-step' });
const failure = line({ type: 'error', error: { statusCode: 503, message: 'fixture failure' } });
const success = prefix + line({ type: 'text-start', id: 'fixture' }) + line({ type: 'text-delta', id: 'fixture', text: 'fixture text' });

describe('raw CommandCode response routing with one retained reader (not terminal/ACK authority)', () => {
  it.each([['success', success], ['initial-error', failure], ['initial-error', prefix + failure]])('routes %s and preserves all original prefix and remainder bytes', async (kind, text) => {
    const upstream = new Response(text, { headers: { 'content-type': 'application/x-ndjson' } }), getReader = vi.spyOn(upstream.body, 'getReader');
    const selected = await route(upstream);
    expect(selected.kind).toBe(kind); expect(getReader).toHaveBeenCalledTimes(1);
    expect(await selected.response.text()).toBe(text); expect(upstream.body.locked).toBe(false);
  });
  it('one-byte chunks retain the entire routing prefix without synthesized EOF or data', async () => {
    const bytes = encode(success); let index = 0;
    const upstream = new Response(new ReadableStream({ pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); else controller.close(); } }));
    const selected = await route(upstream); expect(selected.kind).toBe('success'); expect(await selected.response.text()).toBe(success);
  });
  it('initial error selection is not clean EOF: downstream waits for genuine remaining bytes', async () => {
    let controller; const cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(encode(failure)); }, cancel }));
    const selected = await route(upstream); expect(selected.kind).toBe('initial-error'); expect(cancel).not.toHaveBeenCalled();
    let delivered = false; const consumed = selected.response.text().then(text => { delivered = true; return text; });
    expect(delivered).toBe(false); controller.enqueue(encode('fixture trailing bytes')); controller.close();
    expect(await consumed).toBe(failure + 'fixture trailing bytes'); expect(cancel).not.toHaveBeenCalled();
  });
  it('downstream cancellation cancels the sole upstream reader rather than draining/reopening', async () => {
    const cancel = vi.fn(), upstream = new Response(new ReadableStream({ start(controller) { controller.enqueue(encode(success)); }, cancel }));
    const getReader = vi.spyOn(upstream.body, 'getReader'), selected = await route(upstream), reason = new Error('fixture consumer cancel');
    await selected.response.body.cancel(reason); expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
    expect(getReader).toHaveBeenCalledTimes(1); expect(upstream.body.locked).toBe(false);
  });
  it.each(['empty', 'unknown', 'invalid-json', 'out-of-order', 'truncated', 'utf8', 'oversized'])('%s cannot be classified as successful or exact failure', async kind => {
    expect((await route(new Response(success))).kind).toBe('success');
    let bytes = encode('');
    if (kind === 'unknown') bytes = encode(line({ type: 'unknown' }));
    if (kind === 'invalid-json') bytes = encode('{broken}\n');
    if (kind === 'out-of-order') bytes = encode(line({ type: 'start-step' }));
    if (kind === 'truncated') bytes = encode(failure.trimEnd());
    if (kind === 'utf8') bytes = new Uint8Array([255, 10]);
    if (kind === 'oversized') bytes = encode('x'.repeat(1024 * 1024 + 1));
    const upstream = new Response(bytes);
    await expect(route(upstream)).rejects.toThrow(); expect(upstream.body.locked).toBe(false);
  });
  it('abort with false-like reason while routing pending cancels reader and preserves rejection', async () => {
    let entered; const reading = new Promise(resolve => { entered = resolve; }), cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ pull() { entered(); }, cancel })), controller = new AbortController();
    const work = route(upstream, controller.signal).then(value => ({ value }), error => ({ error }));
    await reading; controller.abort(false); expect(await work).toEqual({ error: false });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(false); expect(upstream.body.locked).toBe(false);
  });
});
