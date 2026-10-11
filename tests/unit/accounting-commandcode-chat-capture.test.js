import { beforeAll, describe, expect, it, vi } from 'vitest';
let capture;
beforeAll(async () => {
  ({ captureCommandCodeChatConversion: capture } = await import('open-sse/config/accountedCommandCodeChatCapture.js'));
});
const model = 'deepseek/deepseek-v4-pro';
const input = () => ({ body: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] },
  model, stream: true, credentials: { apiKey: 'dummy-only', connectionId: 'fixture' }, providerOverrides: null, proxyOptions: null,
  config: { baseUrl: 'https://fixture.invalid/not-route-permission' }, runtime: { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux' } });
const translated = () => ({ threadId: '12345678-1234-4123-8123-123456789abc', memory: '', config: { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux',
  structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] }, params: { model, stream: true, max_tokens: 100, temperature: 0.3,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
// Supplied synchronous translator is an internal test seam, not a hostile-code sandbox.
describe('CommandCode original guard before translation and retained full evidence (not dispatch)', () => {
  it('calls translation once with frozen detached original, retaining complete immutable evidence', () => {
    const value = input(), wire = translated();
    const translate = vi.fn((selected, body, stream) => {
      expect(selected).toBe(model); expect(stream).toBe(true); expect(body).not.toBe(value.body); expect(Object.isFrozen(body.messages[0])).toBe(true);
      value.body.messages[0].content = 'mutated caller'; value.credentials.apiKey = 'mutated token'; return wire;
    });
    const result = capture(value, translate);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(result.original.body.messages[0].content).toBe('fixture prompt'); expect(result.original.credentials.apiKey).toBe('dummy-only');
    expect(result.actual.params.messages[0].content[0].text).toBe('fixture prompt'); expect(Object.isFrozen(result.actual.config)).toBe(true);
    wire.params.messages[0].content[0].text = 'mutated output'; expect(result.actual.params.messages[0].content[0].text).toBe('fixture prompt');
    expect(result.identity).toEqual({ threadId: wire.threadId, ...input().runtime });
  });
  it.each(['getter', 'proxy', 'oversized', 'unknown-original'])('refuses %s before translation or programmable reads', mode => {
    const value = input(), translate = vi.fn(translated); let touched = 0;
    const trap = () => { touched++; throw new Error('fixture programmable read'); };
    if (mode === 'getter') Object.defineProperty(value.credentials, 'apiKey', { enumerable: true, get: trap });
    if (mode === 'proxy') value.body = new Proxy(value.body, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    if (mode === 'oversized') value.body.messages[0].content = 'x'.repeat(300000);
    if (mode === 'unknown-original') value.body.metadata = {};
    expect(() => capture(value, translate)).toThrow(); expect(translate).not.toHaveBeenCalled(); expect(touched).toBe(0);
  });
  it.each(['cwd', 'unknown-actual', 'programmable-actual', 'aggregate-bound'])('refuses translated %s after one accepted translation seam', mode => {
    expect(capture(input(), translated).actual.params.model).toBe(model);
    const value = input(), wire = translated(); let touched = 0;
    if (mode === 'cwd') wire.config.workingDir = '/fixture/changed';
    if (mode === 'unknown-actual') wire.extra = true;
    if (mode === 'programmable-actual') Object.defineProperty(wire.params, 'model', { enumerable: true, get() { touched++; throw new Error('fixture output read'); } });
    if (mode === 'aggregate-bound') { const text = 'x'.repeat(140000); value.body.messages[0].content = text; wire.params.messages[0].content[0].text = text; }
    const translate = vi.fn(() => wire);
    expect(() => capture(value, translate)).toThrow(); expect(translate).toHaveBeenCalledTimes(1); expect(touched).toBe(0);
  });
});
