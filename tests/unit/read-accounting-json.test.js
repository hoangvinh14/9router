import { describe, it, expect, vi, afterEach } from 'vitest';
import { readAccountingJson, readAccountingText } from '../../open-sse/utils/readAccountingJson.js';
import { ACCOUNTING_JSON_DEADLINE_MS, ACCOUNTING_JSON_MAX_BYTES } from '../../open-sse/config/accountingBodyLimits.js';
afterEach(() => vi.useRealTimers());
describe('raw accounting JSON reader', () => {
  it('decodes split UTF8 without translating usage', async () => {
    const bytes = new TextEncoder().encode('{"label":"đúng","usage":{"prompt_tokens":0,"total_tokens":0}}');
    const body = new ReadableStream({ start(ctrl) { for (const byte of bytes) ctrl.enqueue(Uint8Array.of(byte)); ctrl.close(); } });
    expect(await readAccountingJson(new Response(body))).toEqual({ label: 'đúng', usage: { prompt_tokens: 0, total_tokens: 0 } });
  });
  it('deadline cancel resolving EOF cannot admit partial parseable prefix', async () => {
    vi.useFakeTimers(); let cancelled = false;
    const body = new ReadableStream({ start(ctrl) { ctrl.enqueue(new TextEncoder().encode('{"usage":{"prompt_tokens":12,"total_tokens":12}}')); }, cancel() { cancelled = true; } });
    const pending = expect(readAccountingJson(new Response(body))).rejects.toThrow('deadline'); await vi.advanceTimersByTimeAsync(ACCOUNTING_JSON_DEADLINE_MS); await pending; expect(cancelled).toBe(true);
  });
  it('diagnostic tap sees chunks but deadline cancel never flushes or returns partial bytes', async () => {
    vi.useFakeTimers(); const tap = vi.fn(); let cancelled = false;
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n')); }, cancel() { cancelled = true; } }));
    const pending = expect(readAccountingText(response, null, { onChunk: tap })).rejects.toThrow('deadline');
    await vi.advanceTimersByTimeAsync(1); expect(tap).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ACCOUNTING_JSON_DEADLINE_MS); await pending;
    expect(cancelled).toBe(true); expect(tap).toHaveBeenCalledTimes(1);
  });
  it('abort during read preserves primitive reason and cancels reader', async () => {
    const ctrl = new AbortController(); let cancelled = false;
    const pending = expect(readAccountingJson(new Response(new ReadableStream({ cancel() { cancelled = true; } })), ctrl.signal)).rejects.toBe(17);
    ctrl.abort(17); await pending; expect(cancelled).toBe(true);
  });
  it('overflow cancels without returning parsed truncated JSON', async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(ctrl) { ctrl.enqueue(new Uint8Array(ACCOUNTING_JSON_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
    await expect(readAccountingJson(new Response(body))).rejects.toThrow('bound'); expect(cancelled).toBe(true);
  });
  it.each(['{', new Uint8Array([0x80])])('invalid JSON/UTF8 is not exact usage %#', async content => { await expect(readAccountingJson(new Response(content))).rejects.toThrow(); });
});
