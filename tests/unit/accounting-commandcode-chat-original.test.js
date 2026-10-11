import { beforeAll, describe, expect, it } from 'vitest';
let supports;
beforeAll(async () => {
  ({ supportsCommandCodeChatOriginal: supports } = await import('open-sse/config/accountedCommandCodeChatCandidate.js'));
});
const model = 'deepseek/deepseek-v4-pro';
const original = () => ({ model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] });
// Schema consumes already bounded plain snapshots. Programmable input guarding
// and generated identity binding belong to the later owner, not this helper.
describe('narrow original OpenAI chat for CommandCode conversion (not owner/retry approval)', () => {
  it('accepts explicit canonical one-user text and preserves the whole original', () => {
    const body = original(), before = structuredClone(body);
    expect(supports(body, model)).toBe(true); expect(body).toEqual(before);
  });
  it.each([
    ['missing-model', body => { delete body.model; }],
    ['mismatched-model', body => { body.model = 'different-model'; }],
    ['missing-stream', body => { delete body.stream; }],
    ['nonstream', body => { body.stream = false; }],
    ['missing-max', body => { delete body.max_tokens; }],
    ['fractional-max', body => { body.max_tokens = 1.5; }],
    ['missing-temperature', body => { delete body.temperature; }],
    ['invalid-temperature', body => { body.temperature = Infinity; }],
    ['unknown-original', body => { body.metadata = { fixture: true }; }],
    ['system-message', body => { body.messages.unshift({ role: 'system', content: 'fixture system' }); }],
    ['image-block', body => { body.messages[0].content = [{ type: 'image_url', image_url: { url: 'https://fixture.invalid/image' } }]; }],
    ['tools', body => { body.tools = []; }],
    ['unknown-message-field', body => { body.messages[0].name = 'fixture'; }],
    ['empty-text', body => { body.messages[0].content = '  '; }],
  ])('refuses %s without erasure after accepted positive control', (_name, mutate) => {
    expect(supports(original(), model)).toBe(true);
    const body = original(); mutate(body); const before = structuredClone(body);
    expect(supports(body, model)).toBe(false); expect(body).toEqual(before);
  });
  it('refuses unregistered model even when original and selected model agree', () => {
    expect(supports(original(), model)).toBe(true);
    const body = { ...original(), model: 'fixture-unregistered' };
    expect(supports(body, body.model)).toBe(false);
  });
});
