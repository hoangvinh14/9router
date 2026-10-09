import { describe, it, expect, vi } from 'vitest';
import { createAccountedOpenaiStream } from '../../open-sse/utils/accountedOpenaiStream.js';
const encode = text => new TextEncoder().encode(text);
const delta = 'data: {"choices":[{"index":0,"delta":{"content":"Việt🙂"}}]}\n\n';
const finish = 'data: {"choices":[{"index":0,"finish_reason":"stop"}]}\n\n';
const usage = 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n';
const done = 'data: [DONE]\n\n';
const attempt = Object.freeze({ attemptId: 'fixture' });
function fixture(limits) {
  let upstream, cancelReason;
  const response = new Response(new ReadableStream({ start(c) { upstream = c; }, cancel(reason) { cancelReason = reason; } }));
  const completeAttempt = vi.fn(() => ({ state: 'settled' }));
  // Explicit trusted-policy stand-in, not a production fallback. Real-context
  // policy/gap/cost authority is covered by chat-accounting-base fixtures.
  const assertSuccessfulTerminal = vi.fn(terminal => { if (terminal?.state !== 'settled') throw new Error('Fixture terminal unauthorized'); });
  const ctrl = new AbortController();
  const accounting = { completeAttempt, assertSuccessfulTerminal };
  const stream = createAccountedOpenaiStream(response, { accounting, attempt, signal: ctrl.signal, limits });
  return { upstream, completeAttempt, assertSuccessfulTerminal, accounting, ctrl, reader: stream.getReader(), cancelReason: () => cancelReason };
}
const decode = chunk => new TextDecoder().decode(chunk.value);
describe('single live raw terminal owner', () => {
  it('delta reaches client promptly; terminal frames wait for EOF and durable ACK', async () => {
    const f = fixture(); let ack;
    f.completeAttempt.mockImplementation(() => new Promise(resolve => { ack = resolve; }));
    f.upstream.enqueue(encode(delta + finish + usage + done));
    expect(decode(await f.reader.read())).toBe(delta); expect(f.completeAttempt).not.toHaveBeenCalled();
    let delivered = false; const terminal = f.reader.read().then(value => { delivered = true; return value; });
    f.upstream.close(); await vi.waitFor(() => expect(f.completeAttempt).toHaveBeenCalledTimes(1));
    expect(delivered).toBe(false);
    expect(f.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { exact: true, input: 1, output: 2 }, outcome: 'success' });
    ack({ state: 'settled' }); expect(decode(await terminal)).toBe(finish);
    expect(decode(await f.reader.read())).toBe(usage); expect(decode(await f.reader.read())).toBe(done);
    expect((await f.reader.read()).done).toBe(true); expect(f.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it.each(['ack-resolve', 'ack-reject', 'authorization-resolve', 'authorization-reject'])('existing idle deadline bounds held %s after clean EOF without resetting or changing winner', async mode => {
    vi.useFakeTimers();
    let settle, rejectHeld, entered;
    const hold = new Promise((yes, no) => { settle = yes; rejectHeld = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture({ idleMs: 10, postDoneMs: 100 });
    if (mode.startsWith('ack')) f.completeAttempt.mockImplementation(() => { entered(); return hold; });
    else f.assertSuccessfulTerminal.mockImplementation(() => { entered(); return hold; });
    let localDone = false;
    const pending = f.reader.read().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
    try {
      f.upstream.enqueue(encode(finish + usage + done)); await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(7); expect(localDone).toBe(false);
      f.upstream.close(); await vi.advanceTimersByTimeAsync(0); await started;
      await vi.advanceTimersByTimeAsync(2); expect(localDone).toBe(false);
      await vi.advanceTimersByTimeAsync(1); expect(localDone).toBe(true);
      expect((await pending).error?.message).toBe('Gateway accounting stream unavailable');
      expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1]).toMatchObject({ outcome: 'success', usage: { exact: true, input: 1, output: 2 } });
      if (mode.startsWith('ack')) expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled(); else expect(f.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
    } finally {
      if (mode.endsWith('reject')) rejectHeld(new Error('private held finalization rejection')); else settle({ state: 'settled' });
      await hold.catch(() => {}); await vi.advanceTimersByTimeAsync(0); await pending; vi.useRealTimers();
    }
    expect(f.completeAttempt).toHaveBeenCalledTimes(1);
    if (mode.startsWith('ack')) expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
  });
  it.each(['timely', 'clean-EOF-post-DONE'])('%s ACK before idle deadline releases terminal and cleans timers', async mode => {
    vi.useFakeTimers(); let settle, entered;
    const ack = new Promise(resolve => { settle = resolve; }), started = new Promise(resolve => { entered = resolve; });
    const f = fixture({ idleMs: 20, postDoneMs: mode === 'timely' ? 100 : 5 });
    f.completeAttempt.mockImplementation(() => { entered(); return ack; });
    let delivered = false;
    const pending = f.reader.read().then(value => { delivered = true; return value; });
    try {
      f.upstream.enqueue(encode(finish + usage + done)); await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3); f.upstream.close(); await vi.advanceTimersByTimeAsync(0); await started;
      await vi.advanceTimersByTimeAsync(3); expect(delivered).toBe(false);
      // Crossing post-DONE at5 after clean EOFat3 is not an idle expiry at20.
      settle({ state: 'settled' }); expect(decode(await pending)).toBe(finish);
      expect(decode(await f.reader.read())).toBe(usage); expect(decode(await f.reader.read())).toBe(done);
      expect((await f.reader.read()).done).toBe(true); expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.assertSuccessfulTerminal).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30); expect((await f.reader.read()).done).toBe(true); expect(vi.getTimerCount()).toBe(0);
    } finally { settle({ state: 'settled' }); await ack; await pending; vi.useRealTimers(); }
  });
  it.each([
    ['missing_terminal', finish + usage],
    ['invalid_stream', finish + usage + done + usage],
    ['invalid_stream', finish + usage + 'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n'],
    ['invalid_stream', finish + usage + 'data: {"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":2}}\n\n'],
  ])('retains first observed counts only as %s diagnostic evidence %#', async (reason, text) => {
    const f = fixture(); f.completeAttempt.mockReturnValue({ state: 'unresolved' });
    f.upstream.enqueue(encode(text)); f.upstream.close();
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(f.completeAttempt).toHaveBeenCalledTimes(1);
    const terminal = f.completeAttempt.mock.calls[0][1];
    expect(terminal.usage).toBeNull(); expect(terminal.usageEvidence).toEqual({ version: 1, kind: 'raw_usage_observation', schema: 'openai', endpoint: 'chat', reason,
      observedCounts: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningIncludedInOutput: true } });
    expect(terminal.usageEvidence.observedCounts).not.toHaveProperty('exact');
  });
  it.each(['missing', 'reject'])('terminal assertion %s fails closed with one completion', async mode => {
    const f = fixture();
    if (mode === 'missing') delete f.accounting.assertSuccessfulTerminal;
    else f.assertSuccessfulTerminal.mockRejectedValue(new Error('private authorization failure'));
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(f.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('async terminal authorization holds all successful terminal bytes', async () => {
    const f = fixture(); let authorize;
    f.assertSuccessfulTerminal.mockImplementation(() => new Promise(resolve => { authorize = resolve; }));
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    let delivered = false; const pending = f.reader.read().then(value => { delivered = true; return value; });
    await vi.waitFor(() => expect(f.assertSuccessfulTerminal).toHaveBeenCalledTimes(1)); expect(delivered).toBe(false);
    authorize(); expect(decode(await pending)).toBe(finish); expect(decode(await f.reader.read())).toBe(usage); expect(decode(await f.reader.read())).toBe(done);
    expect((await f.reader.read()).done).toBe(true); expect(f.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it.each(['resolve', 'reject'])('cancel while authorization pending then %s never releases terminals', async mode => {
    const f = fixture(); let authorize, reject;
    const authorization = new Promise((yes, no) => { authorize = yes; reject = no; });
    f.assertSuccessfulTerminal.mockReturnValue(authorization);
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    const pending = f.reader.read(); await vi.waitFor(() => expect(f.assertSuccessfulTerminal).toHaveBeenCalledTimes(1));
    await f.reader.cancel('authorization cancel');
    if (mode === 'resolve') authorize(); else reject(new Error('late authorization failure'));
    await authorization.catch(() => {});
    expect((await pending).done).toBe(true); expect((await f.reader.read()).done).toBe(true);
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage.exact).toBe(true);
  });
  it.each(['missing-usage', 'missing-DONE', 'invalid-usage', 'read-failed'])('permissive policy cannot rescue %s protocol failure', async mode => {
    const f = fixture(); f.assertSuccessfulTerminal.mockImplementation(() => {});
    const text = mode === 'missing-usage' ? finish + done : mode === 'missing-DONE' ? finish + usage : mode === 'invalid-usage' ? finish + 'data: {"choices":[],"usage":{"prompt_tokens":-1,"completion_tokens":2}}\n\n' + done : finish + usage + done;
    f.upstream.enqueue(encode(text)); if (mode === 'read-failed') f.upstream.error(new Error('fixture upstream read failure')); else f.upstream.close();
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage).toBeNull();
  });
  it('settlement failure withholds successful terminal and never completes twice', async () => {
    const f = fixture(); f.completeAttempt.mockRejectedValue(new Error('private persistence diagnostic'));
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(f.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it.each([finish + done, finish + usage, finish + usage + done + usage, finish + usage + done + done, 'data: {"error":{"message":"private"}}\n\n'])('incomplete or invalid stream %# has no success terminal', async text => {
    const f = fixture(); f.completeAttempt.mockReturnValue({ state: 'unresolved' });
    f.upstream.enqueue(encode(text)); f.upstream.close();
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage).toBeNull();
  });
  it.each([{ terminalMaxBytes: 8 }, { terminalMaxEvents: 1 }])('bounded terminal retention rejects overflow %#', async limits => {
    const f = fixture(limits); f.upstream.enqueue(encode(finish + usage + done));
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable'); expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage).toBeNull();
  });
  it('caller abort during waiting read is prompt and preserves upstream cancel reason', async () => {
    const f = fixture(); const pending = expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    f.ctrl.abort(7); await pending;
    expect(f.cancelReason()).toBe(7); expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
  });
  it('downstream cancel acknowledges unresolved once', async () => {
    const f = fixture(); await f.reader.cancel('client gone');
    expect(f.cancelReason()).toBe('client gone'); expect(f.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('cancellation during successful settlement cannot overwrite terminal winner', async () => {
    const f = fixture(); let ack;
    f.completeAttempt.mockImplementation(() => new Promise(resolve => { ack = resolve; }));
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    const pending = f.reader.read(); await vi.waitFor(() => expect(f.completeAttempt).toHaveBeenCalledTimes(1));
    const cancelled = f.reader.cancel('late cancel'); ack({ state: 'settled' });
    await cancelled; expect((await pending).done).toBe(true);
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage.exact).toBe(true);
  });
  it('caller signal abort during ACK suppresses bytes without changing exact winner', async () => {
    const f = fixture(); let ack;
    f.completeAttempt.mockImplementation(() => new Promise(resolve => { ack = resolve; }));
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    const pending = expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    await vi.waitFor(() => expect(f.completeAttempt).toHaveBeenCalledTimes(1));
    f.ctrl.abort('during ACK'); ack({ state: 'settled' }); await pending;
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage.exact).toBe(true);
  });
  it.each(['signal-resolve', 'signal-reject', 'cancel-resolve', 'cancel-reject'])('first %s cancellation closes local delivery while its own ACK remains pending', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture(); f.completeAttempt.mockImplementation(() => { entered(); return ack; });
    let localDone = false, pending;
    try {
      if (mode.startsWith('signal')) {
        // No pull/read-error reentry may accidentally close this first winner.
        f.ctrl.abort(false);
        pending = f.reader.read().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
      } else pending = f.reader.cancel(false).then(() => { localDone = true; });
      await started;
      await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      if (mode.startsWith('signal')) expect((await pending).error?.message).toBe('Gateway accounting stream unavailable');
      else await pending;
      expect(f.cancelReason()).toBe(false); expect(f.completeAttempt).toHaveBeenCalledTimes(1);
      expect(f.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
      expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally {
      if (mode.endsWith('reject')) rejectAck(new Error('private first cancellation ACK rejection'));
      else settle({ state: 'unresolved' });
      await ack.catch(() => {}); await pending;
    }
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it.each(['signal-resolve', 'signal-reject', 'cancel-resolve', 'cancel-reject'])('local %s settles while claimed exact ACK remains pending', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture();
    f.completeAttempt.mockImplementation(() => { entered(); return ack; });
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    let localRead = false, localCancel = false;
    const pending = f.reader.read().then(value => { localRead = true; return { value }; }, error => { localRead = true; return { error }; });
    let cancellation;
    try {
      await started;
      if (mode.startsWith('signal')) f.ctrl.abort(0);
      else cancellation = f.reader.cancel(0).then(() => { localCancel = true; });
      await vi.waitFor(() => { expect(localRead).toBe(true); if (cancellation) expect(localCancel).toBe(true); }, { timeout: 200 });
      const result = await pending;
      if (mode.startsWith('signal')) expect(result.error?.message).toBe('Gateway accounting stream unavailable');
      else expect(result.value.done).toBe(true);
      expect(f.completeAttempt).toHaveBeenCalledTimes(1);
      expect(f.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { exact: true, input: 1, output: 2 }, outcome: 'success' });
      expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally {
      if (mode.endsWith('reject')) rejectAck(new Error('late fixture ACK rejection'));
      else settle({ state: 'settled' });
      await ack.catch(() => {}); await pending; await cancellation;
    }
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])('reentrant sink abort and downstream cancel share claimed ACK then %s', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture();
    f.completeAttempt.mockImplementation(() => { f.ctrl.abort(false); entered(); return ack; });
    f.upstream.enqueue(encode(finish + usage + done)); f.upstream.close();
    const pending = f.reader.read().then(value => ({ value }), error => ({ error }));
    try {
      await started;
      let localDone = false; pending.then(() => { localDone = true; });
      await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      expect((await pending).error?.message).toBe('Gateway accounting stream unavailable');
      await f.reader.cancel(false).catch(error => expect(error.message).toBe('Gateway accounting stream unavailable'));
      expect(f.completeAttempt).toHaveBeenCalledTimes(1);
      expect(f.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: { exact: true, input: 1, output: 2 }, outcome: 'success' });
      expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally {
      if (mode === 'reject') rejectAck(new Error('late reentrant ACK rejection'));
      else settle({ state: 'settled' });
      await ack.catch(() => {}); await pending;
    }
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])('first cancel with reentrant sink abort and asynchronous warning then %s keeps one winner', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => Promise.reject(new Error('private asynchronous logger failure')));
    const f = fixture();
    f.completeAttempt.mockImplementation(() => { f.ctrl.abort(0); entered(); return ack; });
    let localDone = false;
    const pending = f.reader.cancel(false).then(() => { localDone = true; });
    try {
      await started; await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 }); await pending;
      expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'aborted' });
      expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled(); expect(f.cancelReason()).toBe(false);
      if (mode === 'reject') rejectAck(new Error('private reentrant first ACK failure')); else settle({ state: 'unresolved' });
      await ack.catch(() => {});
      if (mode === 'reject') await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      else expect(warn).not.toHaveBeenCalled();
      expect((await f.reader.read()).done).toBe(true);
    } finally { settle({ state: 'unresolved' }); await ack.catch(() => {}); await pending; warn.mockRestore(); }
  });
  it.each(['resolve', 'reject'])('abort after network winner with pending ACK then %s ends local delivery without replacing outcome', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture(); f.completeAttempt.mockImplementation(() => { entered(); return ack; });
    let localDone = false;
    const pending = f.reader.read().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
    f.upstream.error(new Error('private network failure'));
    try {
      await started;
      await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      expect(f.ctrl.signal.aborted).toBe(false);
      const winner = f.completeAttempt.mock.calls[0][1]; expect(winner).toEqual({ usage: null, outcome: 'network_unknown' });
      f.ctrl.abort(null);
      expect((await pending).error?.message).toBe('Gateway accounting stream unavailable');
      expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1]).toBe(winner);
      expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally {
      if (mode === 'reject') rejectAck(new Error('late network winner ACK failure')); else settle({ state: 'unresolved' });
      await ack.catch(() => {}); await pending;
    }
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it.each(['read-resolve', 'read-reject', 'protocol-resolve', 'protocol-reject'])('uncanceled %s closes local failure before ACK with one original winner', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture(); f.completeAttempt.mockImplementation(() => { entered(); return ack; });
    let localDone = false;
    const pending = f.reader.read().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
    if (mode.startsWith('read')) f.upstream.error(new Error('private network failure')); else { f.upstream.enqueue(encode(finish + usage)); f.upstream.close(); }
    try {
      await started; await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      expect((await pending).error?.message).toBe('Gateway accounting stream unavailable'); expect(f.ctrl.signal.aborted).toBe(false);
      expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1]).toMatchObject({ usage: null, outcome: 'network_unknown' });
      expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally {
      if (mode.endsWith('reject')) rejectAck(new Error('private late failure ACK')); else settle({ state: 'unresolved' });
      await ack.catch(() => {}); await pending;
    }
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'])('network failure claims winner before foreign cleanup reentrant abort then ACK %s', async mode => {
    let settle, rejectAck, entered;
    const ack = new Promise((yes, no) => { settle = yes; rejectAck = no; });
    const started = new Promise(resolve => { entered = resolve; });
    const ctrl = new AbortController();
    const cancel = vi.fn(() => { ctrl.abort(false); return Promise.reject(new Error('private foreign cleanup rejection')); });
    const response = { body: { getReader: () => ({ read: () => Promise.reject(new Error('private read failure')), cancel }) } };
    const completeAttempt = vi.fn(() => { entered(); return ack; }), assertSuccessfulTerminal = vi.fn();
    const reader = createAccountedOpenaiStream(response, { accounting: { completeAttempt, assertSuccessfulTerminal }, attempt, signal: ctrl.signal }).getReader();
    let localDone = false;
    const pending = reader.read().then(value => { localDone = true; return { value }; }, error => { localDone = true; return { error }; });
    try {
      await started; await vi.waitFor(() => expect(localDone).toBe(true), { timeout: 200 });
      expect((await pending).error?.message).toBe('Gateway accounting stream unavailable');
      expect(ctrl.signal.reason).toBe(false); expect(cancel).toHaveBeenCalled();
      expect(completeAttempt).toHaveBeenCalledTimes(1); expect(completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'network_unknown' });
      expect(assertSuccessfulTerminal).not.toHaveBeenCalled();
    } finally {
      if (mode === 'reject') rejectAck(new Error('private late network ACK rejection')); else settle({ state: 'unresolved' });
      await ack.catch(() => {}); await pending;
    }
    expect(completeAttempt).toHaveBeenCalledTimes(1); expect(assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it('post-DONE absolute deadline fires despite comments and no EOF', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ idleMs: 1000, postDoneMs: 10 });
      f.upstream.enqueue(encode(finish + usage + done));
      const pending = expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
      await vi.advanceTimersByTimeAsync(1); f.upstream.enqueue(encode(': keepalive\n\n'));
      await vi.advanceTimersByTimeAsync(10); await pending;
      expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it.each([{ readyMaxBytes: 8 }, { readyMaxEvents: 2 }])('nonterminal queue bounds %# apply before retaining tiny events', async limits => {
    const f = fixture(limits); f.upstream.enqueue(encode(delta + delta + delta));
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
    expect(f.completeAttempt).toHaveBeenCalledTimes(1); expect(f.completeAttempt.mock.calls[0][1].usage).toBeNull();
  });
  it('overflow after a delivered delta cannot release successful terminal', async () => {
    const f = fixture({ readyMaxEvents: 1 });
    f.upstream.enqueue(encode(delta)); expect(decode(await f.reader.read())).toBe(delta);
    f.upstream.enqueue(encode(': one\n\n: two\n\n'));
    await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable'); expect(f.completeAttempt).toHaveBeenCalledTimes(1);
  });
  it('foreign read and cancel may outlive timeout but cannot settle again', async () => {
    vi.useFakeTimers();
    try {
      let rejectRead;
      const cancel = vi.fn(() => new Promise(() => {}));
      const foreign = { body: { getReader: () => ({ read: () => new Promise((_resolve, reject) => { rejectRead = reject; }), cancel }) } };
      const completeAttempt = vi.fn(() => ({ state: 'unresolved' }));
      const reader = createAccountedOpenaiStream(foreign, { accounting: { completeAttempt }, attempt, limits: { idleMs: 10 } }).getReader();
      const pending = expect(reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
      await vi.advanceTimersByTimeAsync(11); await pending;
      rejectRead(new Error('late foreign rejection')); await vi.advanceTimersByTimeAsync(1);
      expect(cancel).toHaveBeenCalled(); expect(completeAttempt).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('idle policy includes downstream backpressure, never bypasses accounting on a slow consumer', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ idleMs: 10 }); f.upstream.enqueue(encode(delta + delta));
      expect(decode(await f.reader.read())).toBe(delta);
      await vi.advanceTimersByTimeAsync(11);
      await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable');
      expect(f.completeAttempt.mock.calls[0][1]).toEqual({ usage: null, outcome: 'network_unknown' });
    } finally { vi.useRealTimers(); }
  });
  it('idle timeout owns terminal without client pull', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ idleMs: 10 });
      await vi.advanceTimersByTimeAsync(11); await expect(f.reader.read()).rejects.toThrow('Gateway accounting stream unavailable'); expect(f.completeAttempt).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
