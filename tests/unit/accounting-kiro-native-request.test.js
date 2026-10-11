import { beforeAll, describe, expect, it } from 'vitest';

let supportsKiroOriginal;
beforeAll(async () => {
  ({ supportsKiroOriginal } = await import('open-sse/config/accountedKiroCandidate.js'));
});
const model = 'claude-sonnet-4.5';
const original = () => ({
  conversationState: {
    chatTriggerType: 'MANUAL', conversationId: '12345678-1234-4123-8123-123456789abc',
    currentMessage: { userInputMessage: { content: 'Xin chào', modelId: model, origin: 'AI_EDITOR' } },
    history: [],
  },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 },
});
// This helper's future caller must plain-snapshot BEFORE invoking it. Schema
// checks are not programmable-input guards or translator/credential authority.
describe('Kiro caller-native single-turn text request prerequisite', () => {
  it('accepts complete original work without rewriting it', () => {
    const body = original(), before = structuredClone(body);
    expect(supportsKiroOriginal(body, model)).toBe(true); expect(body).toEqual(before);
  });
  it('preserves optional caller-supplied profile ARN, not a generated default', () => {
    const body = { ...original(), profileArn: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/fixture' };
    const before = structuredClone(body);
    expect(supportsKiroOriginal(body, model)).toBe(true); expect(body).toEqual(before);
    // Schema acceptance alone is NOT persisted-credential/profile equality.
  });
  it.each([
    ['extra top-level', body => { body.metadata = {}; }],
    ['system prompt', body => { body.systemPrompt = 'hidden'; }],
    ['thinking config', body => { body.additionalModelRequestFields = { thinking: { type: 'enabled' } }; }],
    ['history', body => { body.conversationState.history.push({ assistantResponseMessage: { content: 'prior' } }); }],
    ['missing history', body => { delete body.conversationState.history; }],
    ['trigger', body => { body.conversationState.chatTriggerType = 'AUTO'; }],
    ['conversation ID', body => { body.conversationState.conversationId = 'generated-later'; }],
    ['continuation field', body => { body.conversationState.continuationId = 'other'; }],
    ['empty text', body => { body.conversationState.currentMessage.userInputMessage.content = ' '; }],
    ['NUL text', body => { body.conversationState.currentMessage.userInputMessage.content = 'a\0b'; }],
    ['model mismatch', body => { body.conversationState.currentMessage.userInputMessage.modelId = 'other'; }],
    ['origin', body => { body.conversationState.currentMessage.userInputMessage.origin = 'other'; }],
    ['images', body => { body.conversationState.currentMessage.userInputMessage.images = []; }],
    ['tools', body => { body.conversationState.currentMessage.userInputMessage.userInputMessageContext = { tools: [] }; }],
    ['assistant current', body => { body.conversationState.currentMessage.assistantResponseMessage = { content: 'other' }; }],
    ['missing inference', body => { delete body.inferenceConfig; }],
    ['missing max', body => { delete body.inferenceConfig.maxTokens; }],
    ['fraction max', body => { body.inferenceConfig.maxTokens = 0.5; }],
    ['zero max', body => { body.inferenceConfig.maxTokens = 0; }],
    ['missing temperature', body => { delete body.inferenceConfig.temperature; }],
    ['string temperature', body => { body.inferenceConfig.temperature = '0.5'; }],
    ['infinite temperature', body => { body.inferenceConfig.temperature = Infinity; }],
    ['missing topP', body => { delete body.inferenceConfig.topP; }],
    ['topP out of range', body => { body.inferenceConfig.topP = 1.1; }],
    ['inference extras', body => { body.inferenceConfig.futureCost = 0; }],
    ['empty profile', body => { body.profileArn = ''; }],
    ['profile header control', body => { body.profileArn = 'profile\r\nother'; }],
  ])('refuses %s after accepted original and does not strip unsupported work', (_label, mutate) => {
    const body = original(); expect(supportsKiroOriginal(body, model)).toBe(true);
    mutate(body); const before = structuredClone(body);
    expect(supportsKiroOriginal(body, model)).toBe(false); expect(body).toEqual(before);
  });
  it.each(['kr/claude-sonnet-4.5', 'claude-sonnet-4.5-thinking', 'claude-sonnet-4.5-agentic', 'gpt-5.6-sol', 'unknown-model'])('does not manufacture model support for %s', requested => {
    expect(supportsKiroOriginal(original(), model)).toBe(true);
    const body = original(); body.conversationState.currentMessage.userInputMessage.modelId = requested;
    expect(supportsKiroOriginal(body, requested)).toBe(false);
  });
});
