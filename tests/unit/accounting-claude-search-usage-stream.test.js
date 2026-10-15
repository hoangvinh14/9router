import { describe, expect, it } from 'vitest';
import { createBufferedClaudeUsageObserver, readBufferedClaudeAccounting } from 'open-sse/utils/accountingClaudeUsage.js';

const event = (type, value = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const start = usage => event('message_start', { message: { id: 'msg_search_counter', type: 'message', role: 'assistant', model: 'fixture-search', content: [], stop_reason: null, stop_sequence: null,
  usage: { input_tokens: 50, output_tokens: 3, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, ...usage } } });
const delta = usage => event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
const stop = event('message_stop');
const wire = () => start() + delta({ input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }) + delta({ input_tokens: 150, output_tokens: 20, server_tool_use: { web_search_requests: 2 } }) + stop;
const observer = options => createBufferedClaudeUsageObserver({ expectedModel: 'fixture-search', allowWebSearchUsage: true, ...options });
const feed = (value, options) => { const o = observer(options); o.push(new TextEncoder().encode(value)); return o.finish(); };

describe('search cumulative raw usage stream prerequisite, server blocks not yet admitted', () => {
  it('allows absent conditional start counter, replaces cumulative input/output/uses, never sums', () => {
    const o = observer({ captureMessage: true });
    for (const byte of new TextEncoder().encode(wire())) o.push(Uint8Array.of(byte));
    expect(o.message()).toBeNull();
    expect(o.finish()).toMatchObject({ input: 200, output: 20, toolUses: { webSearchRequests: 2 }, exact: true });
    expect(o.message().usage).toEqual({ input_tokens: 150, output_tokens: 20, cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10, server_tool_use: { web_search_requests: 2 } });
  });
  it('requires explicit final observed zero or positive count; missing is never fabricated zero', () => {
    expect(feed(start() + delta({ output_tokens: 20, server_tool_use: { web_search_requests: 0 } }) + stop).toolUses).toEqual({ webSearchRequests: 0 });
    expect(() => feed(start() + delta({ output_tokens: 20 }) + stop)).toThrow();
    expect(feed(wire().replace(stop, ''))).toBeNull();
  });
  it.each(['input', 'output', 'search', 'unknown', 'fetch', 'cache'])('rejects nonmonotonic/foreign billing metadata: %s', mode => {
    const changed = { input_tokens: 150, output_tokens: 20, server_tool_use: { web_search_requests: 2 } };
    if (mode === 'input') changed.input_tokens = 49;
    if (mode === 'output') changed.output_tokens = 9;
    if (mode === 'search') changed.server_tool_use.web_search_requests = 0;
    if (mode === 'unknown') changed.server_tool_use.future_requests = 0;
    if (mode === 'fetch') changed.server_tool_use.web_fetch_requests = 1;
    if (mode === 'cache') changed.cache_read_input_tokens = 41;
    expect(() => feed(start() + delta({ input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }) + delta(changed) + stop)).toThrow();
  });
  it('keeps default/false and nonboolean/mutually contradictory options closed', () => {
    for (const options of [{}, { allowWebSearchUsage: false }]) {
      const o = createBufferedClaudeUsageObserver({ expectedModel: 'fixture-search', ...options });
      expect(() => o.push(new TextEncoder().encode(wire()))).toThrow();
    }
    for (const options of [{ allowWebSearchUsage: 'true' }, { allowAbsentServerToolUsage: true }]) expect(() => observer(options)).toThrow();
  });
  it('does not let positive counters substitute for server-block/result/citation authority', () => {
    const block = event('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_fixture', name: 'web_search', input: {} } });
    expect(() => feed(start() + block + wire().slice(start().length))).toThrow();
  });
  it('observed start/search metadata may repeat or be omitted later but cannot disappear/change shape', () => {
    const initial = { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } };
    expect(feed(start(initial) + delta({ output_tokens: 20 }) + stop).toolUses).toEqual({ webSearchRequests: 1 });
    expect(feed(start(initial) + delta({ output_tokens: 20, server_tool_use: initial.server_tool_use }) + stop).toolUses).toEqual({ webSearchRequests: 1 });
    expect(() => feed(start(initial) + delta({ output_tokens: 20, server_tool_use: { web_search_requests: 2 } }) + stop)).toThrow();
    for (const value of [null, {}, { web_search_requests: '1' }, { web_search_requests: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => feed(start() + delta({ output_tokens: 20, server_tool_use: value }) + stop)).toThrow();
    }
  });
  it('late raw failure poisons captured usage, limits and one-shot EOF remain required', () => {
    const o = observer({ captureMessage: true });
    o.push(new TextEncoder().encode(wire()));
    expect(() => o.push(new TextEncoder().encode(event('ping')))).toThrow();
    expect(o.finish()).toBeNull(); expect(o.message()).toBeNull();
    expect(() => o.finish()).toThrow();
    expect(() => feed(wire(), { maxTotalBytes: 20 })).toThrow();
    expect(() => feed(wire(), { maxEventBytes: 20 })).toThrow();
    expect(() => feed(wire() + '\\uFFFD')).toThrow();
  });
  it('live callback sees original raw frames but only clean EOF exposes final counts', () => {
    const events = [], o = observer({ onEvent: value => events.push(value) });
    o.push(new TextEncoder().encode(wire()));
    expect(events.filter(value => value.terminal)).toHaveLength(3);
    expect(events.at(-1).done).toBe(true);
    expect(new TextDecoder().decode(events[1].bytes)).toBe(delta({ input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } }));
    expect(o.finish()).toMatchObject({ input: 200, output: 20, toolUses: { webSearchRequests: 2 } });
    const partial = observer({ onEvent: () => {} });
    partial.push(new TextEncoder().encode(wire().replace(stop, ''))); expect(partial.finish()).toBeNull();
  });
  it('bounded buffered reader has explicit opt-in and failed-HTTP still does not grant success', async () => {
    const response = status => new Response(wire(), { status, headers: { 'content-type': 'text/event-stream' } });
    const result = await readBufferedClaudeAccounting(response(200), null, { expectedModel: 'fixture-search', allowWebSearchUsage: true, captureMessage: true });
    expect(result.text).toBe(wire()); expect(result.usage.toolUses).toEqual({ webSearchRequests: 2 });
    await expect(readBufferedClaudeAccounting(response(503), null, { expectedModel: 'fixture-search', allowWebSearchUsage: true })).rejects.toThrow();
    const failed = await readBufferedClaudeAccounting(response(503), null, { expectedModel: 'fixture-search', allowWebSearchUsage: true, allowFailedHttp: true });
    expect(failed.usage.toolUses).toEqual({ webSearchRequests: 2 });
  });
});
