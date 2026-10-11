import { beforeAll, describe, expect, it } from 'vitest';
let supportsOriginal;
beforeAll(async () => { ({ supportsCommandCodeOriginal: supportsOriginal } = await import('open-sse/config/accountedCommandCodeCandidate.js')); });
const model = 'deepseek/deepseek-v4-pro';
const original = () => ({
  threadId: '11111111-1111-4111-8111-111111111111', memory: '',
  config: { workingDir: '/fixture/workspace', date: '2026-10-10', environment: 'linux', structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 64, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] },
});
describe('CommandCode native original text-only schema (not translator, wire, dispatch, or retry authority)', () => {
  it('accepts unchanged complete native original including explicit workspace/date/environment', () => {
    const body = original(), before = JSON.stringify(body); expect(supportsOriginal(body, model)).toBe(true); expect(JSON.stringify(body)).toBe(before);
  });
  it('preserves explicit system and zero temperature without generated defaults', () => {
    const body = original(); body.params.system = 'fixture system'; body.params.temperature = 0;
    expect(supportsOriginal(body, model)).toBe(true); expect(body.params.system).toBe('fixture system'); expect(body.params.temperature).toBe(0);
  });
  it.each([
    ['erased top-level metadata', body => { body.metadata = { private: true }; }],
    ['memory/continuity', body => { body.memory = 'prior content'; }],
    ['invalid thread identity', body => { body.threadId = 'not-a-uuid'; }],
    ['missing workspace', body => { delete body.config.workingDir; }],
    ['structure/hosted context', body => { body.config.structure = ['file']; }],
    ['git context', body => { body.config.isGitRepo = true; }],
    ['unknown environment configuration', body => { body.config.extra = true; }],
    ['model mismatch', body => { body.params.model = 'moonshotai/Kimi-K2.7-Code'; }],
    ['nonstream request', body => { body.params.stream = false; }],
    ['missing explicit max tokens', body => { delete body.params.max_tokens; }],
    ['missing explicit temperature', body => { delete body.params.temperature; }],
    ['invalid temperature', body => { body.params.temperature = -1; }],
    ['tools', body => { body.params.tools = []; }],
    ['billing tier', body => { body.params.service_tier = 'auto'; }],
    ['second message', body => { body.params.messages.push({ role: 'user', content: [{ type: 'text', text: 'other' }] }); }],
    ['assistant role', body => { body.params.messages[0].role = 'assistant'; }],
    ['image block', body => { body.params.messages[0].content[0] = { type: 'image', image: 'data:image/png;base64,AA==' }; }],
    ['blank prompt', body => { body.params.messages[0].content[0].text = ' '; }],
  ])('%s refuses rather than erasing/defaulting', (_label, mutate) => {
    const body = original(); expect(supportsOriginal(body, model)).toBe(true); mutate(body); const before = JSON.stringify(body);
    expect(supportsOriginal(body, model)).toBe(false); expect(JSON.stringify(body)).toBe(before);
  });
  it('alias/unregistered selected model cannot acquire native-schema authority', () => {
    const body = original(); expect(supportsOriginal(body, model)).toBe(true);
    expect(supportsOriginal(body, 'cmc/deepseek/deepseek-v4-pro')).toBe(false); expect(supportsOriginal(body, 'unknown')).toBe(false);
  });
});
