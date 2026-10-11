import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseExecutor } from '../../open-sse/executors/base.js';
import { PROVIDERS } from '../../open-sse/config/providers.js';
const fixture = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.post(...args) }));
beforeEach(() => fixture.post.mockReset().mockImplementation(async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })));
function setup() {
  const attempt = Object.freeze({ attemptId: 'fixture-own-attempt' }), terminal = Object.freeze({ attemptId: attempt.attemptId, state: 'fixture-terminal' });
  const accounting = { requiresUnhealthyChatWire: true,
    assertSupported: vi.fn(value => { if (!value) throw new Error('Fixture unsupported'); }),
    gate: vi.fn(), beforeAttempt: vi.fn(async () => attempt), completeAttempt: vi.fn(async () => terminal), assertSuccessfulTerminal: vi.fn() };
  const body = { model: 'fixture-model', stream: false, messages: [{ role: 'user', content: 'fixture original' }] };
  const options = { model: body.model, body, stream: false, credentials: { apiKey: 'fixture-key', accessToken: null }, accounting, connectionId: 'fixture-connection', proxyOptions: null, providerOverrides: null };
  return { accounting, options, attempt, terminal, executor: new BaseExecutor('openai', structuredClone(PROVIDERS.openai)) };
}
async function positive() {
  const s = setup(); const result = await s.executor.execute(s.options);
  expect(result.response.ok).toBe(true); expect(fixture.post).toHaveBeenCalledTimes(1);
  expect(s.accounting.completeAttempt).toHaveBeenCalledWith(s.attempt, expect.objectContaining({ outcome: 'success' }));
  return s;
}
describe('internal opt-in unhealthy Chat Base owner, mocked POST/ACK not persisted proof', () => {
  it('binds exact original text POST and strict transport to its own delivered intent', async () => {
    const s = await positive(); const [url, init, proxy, contract] = fixture.post.mock.calls[0];
    expect(url).toBe(PROVIDERS.openai.baseUrl); expect(init.redirect).toBe('error'); expect(contract.singlePost).toBe(true);
    expect(contract.unhealthyChatTransport.body).toEqual(s.options.body); expect(JSON.parse(init.body)).toEqual(s.options.body);
    expect(proxy).toBeNull(); expect(typeof contract.routingGate).toBe('function');
    expect(s.accounting.assertSuccessfulTerminal).toHaveBeenCalledWith(s.terminal);
  });
  it('waits for delivered admission and dispatches detached original values despite caller mutation', async () => {
    const s = setup(); let enter, release; const entered = new Promise(r => { enter = r; }); const held = new Promise(r => { release = r; });
    s.accounting.beforeAttempt.mockImplementation(async () => { enter(); await held; return s.attempt; });
    const observed = s.executor.execute(s.options).then(value => ({ value }), error => ({ error }));
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull(); expect(fixture.post).not.toHaveBeenCalled();
      s.options.body.messages[0].content = 'changed'; s.options.credentials.apiKey = 'other';
      release(); const result = await observed; expect(result.error).toBeUndefined();
      const [, init, , contract] = fixture.post.mock.calls[0];
      expect(JSON.parse(init.body).messages[0].content).toBe('fixture original'); expect(init.headers.Authorization).toBe('Bearer fixture-key');
      expect(contract.singlePost).toBe(true); expect(contract.unhealthyChatTransport.credentials.apiKey).toBe('fixture-key');
    } finally { release(); await observed; }
  });
  it.each(['transformed', 'fresh-gate'])('refuses %s mismatch without replay or double completion', async mode => {
    await positive(); fixture.post.mockClear(); const s = setup(), lost = new Error('Fixture unhealthy dispatch stale');
    if (mode === 'transformed') s.executor.transformRequest = (_model, body) => ({ ...body, temperature: 0 });
    else { s.accounting.beforeAttempt.mockImplementation(async () => { s.accounting.gate.mockImplementation(() => { throw lost; }); return s.attempt; }); }
    const result = await s.executor.execute(s.options).then(value => ({ value }), error => ({ error }));
    expect(result.error).toBeTruthy(); expect(fixture.post).not.toHaveBeenCalled(); expect(s.accounting.beforeAttempt).toHaveBeenCalledTimes(mode === 'transformed' ? 0 : 1);
    if (mode === 'fresh-gate') { expect(result.error).toBe(lost); expect(s.accounting.completeAttempt).toHaveBeenCalledWith(s.attempt, { notDispatched: true, outcome: 'routing_refused' }); }
    expect(s.accounting.completeAttempt).toHaveBeenCalledTimes(mode === 'transformed' ? 0 : 1);
  });
  it.each(['plain', 'exact-json'])('preserves HTTP401 %s failure with its own completion, never retry/free usage', async mode => {
    await positive(); fixture.post.mockClear(); const s = setup();
    const payload = { error: { message: 'fixture denied' }, usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    fixture.post.mockResolvedValue(mode === 'plain' ? new Response('fixture denied', { status: 401 }) : Response.json(payload, { status: 401 }));
    const result = await s.executor.execute(s.options);
    expect(result.response.status).toBe(401);
    expect(await result.response.text()).toBe(mode === 'plain' ? 'fixture denied' : JSON.stringify(payload));
    expect(fixture.post).toHaveBeenCalledTimes(1); expect(s.accounting.beforeAttempt).toHaveBeenCalledTimes(1);
    expect(s.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    const completion = s.accounting.completeAttempt.mock.calls[0][1];
    expect(completion.outcome).toBe('failed');
    if (mode === 'plain') expect(completion.usage).toBeNull();
    else { expect(completion.usage).not.toBeNull(); expect(completion.usage.input).toBe(100); expect(completion.usage.output).toBe(50); }
    expect(s.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
  });
  it.each(['delivered', 'lost'])('waits for own completion ACK, %s delivery cannot retry or authorize early', async mode => {
    const s = setup(); let enter, release; const entered = new Promise(r => { enter = r; }); const held = new Promise(r => { release = r; }); const lost = new Error('Fixture lost unhealthy completion ACK');
    s.accounting.completeAttempt.mockImplementation(async () => { enter(); await held; if (mode === 'lost') throw lost; return s.terminal; });
    let returned = false; const observed = s.executor.execute(s.options).then(value => ({ value }), error => ({ error })).then(result => { returned = true; return result; });
    try {
      expect(await Promise.race([entered.then(() => null), observed])).toBeNull(); expect(returned).toBe(false); expect(s.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled();
      release(); const result = await observed;
      if (mode === 'lost') { expect(result.error).toBe(lost); expect(s.accounting.assertSuccessfulTerminal).not.toHaveBeenCalled(); }
      else expect(result.value.response.ok).toBe(true);
      expect(fixture.post).toHaveBeenCalledTimes(1); expect(s.accounting.completeAttempt).toHaveBeenCalledTimes(1);
    } finally { release(); await observed; }
  });
});
