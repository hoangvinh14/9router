import { describe, it, expect } from 'vitest';
import * as candidate from '../../open-sse/config/accountedChatProviders.js';
const original = () => ({ model: 'fixture-model', stream: false,
  messages: [{ role: 'user', content: 'fixture original' }] });
const accepts = body => {
  expect(candidate.supportsUnhealthyChatRequest).toBeTypeOf('function');
  return candidate.supportsUnhealthyChatRequest(body, 'fixture-model');
};
describe('unwired unhealthy canonical Chat original schema, not selection/dispatch permission', () => {
  it('accepts complete canonical text body without changing it', () => {
    const body = original(), before = JSON.stringify(body);
    expect(accepts(body)).toBe(true); expect(JSON.stringify(body)).toBe(before);
  });
  it('retains every allowed text role without defaulting or erasing message fields', () => {
    const body = original(); body.messages = ['system', 'developer', 'user', 'assistant'].map(role => ({ role, content: 'fixture' }));
    expect(accepts(body)).toBe(true);
    body.messages[0].name = 'fixture'; expect(accepts(body)).toBe(false);
  });
  it.each(['extra', 'tools', 'stream', 'implicit-stream', 'model', 'role', 'media', 'empty', 'getter', 'proxy', 'oversized', 'cycle'])('refuses full original %s without dropping fields or reading programmable values', kind => {
    const positive = original(); expect(accepts(positive)).toBe(true);
    const body = original(); let reads = 0;
    if (kind === 'extra') body.temperature = 0;
    if (kind === 'tools') body.tools = [];
    if (kind === 'stream') body.stream = true;
    if (kind === 'implicit-stream') delete body.stream;
    if (kind === 'model') body.model = 'other-model';
    if (kind === 'role') body.messages[0].role = 'tool';
    if (kind === 'media') body.messages[0].content = [{ type: 'image_url', image_url: { url: 'fixture' } }];
    if (kind === 'empty') body.messages = [];
    if (kind === 'getter') Object.defineProperty(body.messages[0], 'content', { enumerable: true, get() { reads++; return 'fixture'; } });
    if (kind === 'oversized') body.messages[0].content = 'x'.repeat(262145);
    if (kind === 'cycle') body.messages[0].content = body;
    const value = kind === 'proxy' ? new Proxy(body, { get(target, key) { reads++; return target[key]; } }) : body;
    expect(accepts(value)).toBe(false); expect(reads).toBe(0);
  });
});
