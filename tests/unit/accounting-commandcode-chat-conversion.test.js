import { beforeAll, describe, expect, it } from 'vitest';
import { openaiToCommandCodeRequest } from 'open-sse/translator/request/openai-to-commandcode.js';
let validate;
beforeAll(async () => {
  ({ validateCommandCodeChatConversion: validate } = await import('open-sse/config/accountedCommandCodeChatConversion.js'));
});
const model = 'deepseek/deepseek-v4-pro';
const original = () => ({ model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: 'fixture prompt' }] });
const identity = () => ({ threadId: '12345678-1234-4123-8123-123456789abc', workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux' });
// Deliberately independent fixture, not built using the proposed oracle.
const actual = () => ({ threadId: identity().threadId, memory: '', config: { workingDir: '/fixture/work', date: '2026-10-10', environment: 'linux',
  structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
  params: { model, stream: true, max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture prompt' }] }] } });
// These helpers consume guarded plain snapshots, not hostile programmable input.
describe('CommandCode complete original-to-wire conversion equality (not owner authority)', () => {
  it('accepts exact independently constructed conversion without mutating evidence', () => {
    const body = original(), generated = identity(), wire = actual(), before = structuredClone({ body, generated, wire });
    expect(validate(body, model, generated, wire)).toBe(true); expect({ body, generated, wire }).toEqual(before);
  });
  it('matches existing translator output using explicitly retained generated identity, not a second translation', () => {
    const body = original(), wire = openaiToCommandCodeRequest(model, body, true);
    const generated = { threadId: wire.threadId, workingDir: wire.config.workingDir, date: wire.config.date, environment: wire.config.environment };
    expect(validate(body, model, generated, wire)).toBe(true);
  });
  it.each([
    ['thread', wire => { wire.threadId = '22345678-1234-4123-8123-123456789abc'; }],
    ['workspace', wire => { wire.config.workingDir = '/fixture/changed'; }],
    ['date', wire => { wire.config.date = '2026-10-11'; }],
    ['environment', wire => { wire.config.environment = 'darwin'; }],
    ['context', wire => { wire.config.structure.push('fixture hidden context'); }],
    ['text', wire => { wire.params.messages[0].content[0].text = 'changed'; }],
    ['generation-limit', wire => { wire.params.max_tokens = 101; }],
    ['extra-params', wire => { wire.params.metadata = {}; }],
    ['extra-root', wire => { wire.extra = true; }],
  ])('refuses %s drift after exact accepted positive', (_name, mutate) => {
    expect(validate(original(), model, identity(), actual())).toBe(true);
    const wire = actual(); mutate(wire); const before = structuredClone(wire);
    expect(validate(original(), model, identity(), wire)).toBe(false); expect(wire).toEqual(before);
  });
  it('refuses an unsupported original even when the lossy translated body matches the narrow fixture', () => {
    expect(validate(original(), model, identity(), actual())).toBe(true);
    expect(validate({ ...original(), metadata: {} }, model, identity(), actual())).toBe(false);
  });
  it.each(['extra', 'invalid-date', 'invalid-thread'])('refuses invalid retained identity %s', mode => {
    expect(validate(original(), model, identity(), actual())).toBe(true);
    const generated = identity();
    if (mode === 'extra') generated.unknown = true;
    if (mode === 'invalid-date') generated.date = '2026-02-30';
    if (mode === 'invalid-thread') generated.threadId = 'not-a-uuid';
    expect(validate(original(), model, generated, actual())).toBe(false);
  });
});
