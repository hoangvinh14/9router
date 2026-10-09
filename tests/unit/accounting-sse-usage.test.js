import { describe, it, expect } from 'vitest';
import { extractAccountingSseUsage, inspectAccountingSseUsage } from '../../open-sse/utils/accountingSseUsage.js';
const frame = usage => 'data: ' + JSON.stringify({ choices: [], usage }) + '\n\n';
const usage = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 };
describe('raw OpenAI usage + DONE evidence', () => {
  it('accepts exact terminal usage and explicit zero, never DONE alone', () => {
    expect(extractAccountingSseUsage(frame(usage) + 'data: [DONE]\n\n')).toMatchObject({ exact: true, input: 10, output: 4 });
    expect(extractAccountingSseUsage(frame({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }) + 'data: [DONE]\n\n')).toMatchObject({ input: 0, output: 0 });
    expect(extractAccountingSseUsage('data: [DONE]\n\n')).toBeNull();
  });
  it.each([
    [frame(usage), 'missing_terminal'],
    [frame(usage) + frame({ ...usage, prompt_tokens: 11 }) + 'data: [DONE]\n\n', 'invalid_stream'],
    [frame(usage) + 'data: [DONE]\n\n' + frame(usage), 'invalid_stream'],
  ])('diagnostic counts do not become exact authority %#', (text, reason) => {
    const inspected = inspectAccountingSseUsage(text);
    expect(inspected.usage).toBeNull(); expect(extractAccountingSseUsage(text)).toBeNull();
    expect(inspected.usageEvidence).toMatchObject({ reason, observedCounts: { input: 10, output: 4 } });
    expect(inspected.usageEvidence.observedCounts).not.toHaveProperty('exact');
  });
  it.each([
    frame(usage), frame(usage) + frame({ ...usage, prompt_tokens: 11 }) + 'data: [DONE]\n\n',
    frame(usage) + 'data: {"error":{"message":"failed"}}\n\ndata: [DONE]\n\n',
    frame(usage) + 'data: [DONE]\n\n' + frame(usage),
    'data: {"choices":[{}],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
  ])('missing terminal/conflicting/error/nonterminal usage is not exact %#', text => expect(extractAccountingSseUsage(text)).toBeNull());
});
