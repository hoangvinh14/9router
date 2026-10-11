import { beforeAll, describe, expect, it } from 'vitest';
let capture;
beforeAll(async () => { ({ captureKiroEllipsisRepairConversion: capture } = await import('open-sse/config/accountedKiroRepairConversion.js')); });
const model = 'claude-sonnet-4.5';
// Independent literal oracle matches the existing legacy repair instruction.
const instruction = 'Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
const body = () => ({ conversationState: { chatTriggerType: 'MANUAL', conversationId: '11111111-1111-4111-8111-111111111111',
  currentMessage: { userInputMessage: { content: 'fixture prompt', modelId: model, origin: 'AI_EDITOR' } }, history: [] },
  inferenceConfig: { maxTokens: 100, temperature: 0.5, topP: 1 } });
const repaired = original => { const actual = structuredClone(original); actual.conversationState.currentMessage.userInputMessage.content += '\n\n' + instruction; return actual; };
describe('bounded complete Kiro ellipsis repair conversion, not retry/route/usage grant', () => {
  it('complete original and actual are detached/frozen and only exact current user instruction changes', () => {
    const original = body(), actual = repaired(original), result = capture({ model, original, actual });
    expect(result.original).toEqual(original); expect(result.actual).toEqual(actual); expect(result.model).toBe(model);
    original.inferenceConfig.temperature = 1; actual.conversationState.history.push({ changed: true });
    expect(result.original.inferenceConfig.temperature).toBe(0.5); expect(result.actual.conversationState.history).toEqual([]);
    expect(Object.isFrozen(result.actual.conversationState.currentMessage.userInputMessage)).toBe(true);
  });
  it.each(['instruction', 'conversation', 'inference', 'model', 'history', 'profile'])('accepted original then complete %s drift is refused without pruning', kind => {
    const original = body(); expect(capture({ model, original, actual: repaired(original) }).actual).toEqual(repaired(original));
    const actual = repaired(original);
    if (kind === 'instruction') actual.conversationState.currentMessage.userInputMessage.content = 'fixture prompt';
    if (kind === 'conversation') actual.conversationState.conversationId = '22222222-2222-4222-8222-222222222222';
    if (kind === 'inference') actual.inferenceConfig.maxTokens = 101;
    if (kind === 'model') actual.conversationState.currentMessage.userInputMessage.modelId = 'claude-sonnet-4';
    if (kind === 'history') actual.conversationState.history = [{ role: 'assistant' }];
    if (kind === 'profile') actual.profileArn = 'arn:aws:codewhisperer:us-east-1:123456789012:profile/changed';
    expect(() => capture({ model, original, actual })).toThrow();
  });
  it.each(['getter', 'proxy', 'bound'])('accepted original then %s refuses before programmable reads or aggregate erasure', kind => {
    const original = body(); expect(capture({ model, original, actual: repaired(original) }).original).toEqual(original);
    let input = { model, original, actual: repaired(original) }, reads = 0;
    const trap = () => { reads++; throw new Error('fixture repair programmable read'); };
    if (kind === 'getter') Object.defineProperty(input.actual.conversationState.currentMessage.userInputMessage, 'content', { get: trap, enumerable: true });
    if (kind === 'proxy') input = new Proxy(input, { ownKeys: trap, get: trap, getPrototypeOf: trap });
    if (kind === 'bound') { input.original.conversationState.currentMessage.userInputMessage.content = 'x'.repeat(140000); input.actual = repaired(input.original); }
    expect(() => capture(input)).toThrow(); expect(reads).toBe(0);
  });
});
