import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: (...args) => fixture.transport(...args) }));
import { clearQoderCatalog, getQoderModelConfig, resolveQoderModels } from 'open-sse/services/qoderModels.js';
const credentials = token => ({ provider: 'qoder', accessToken: token, providerSpecificData: { userId: 'fixture-same-user', machineId: 'fixture-machine' } });
const config = () => ({ key: 'auto', enable: true, max_output_tokens: 32, max_input_tokens: 1000,
  context_config: [{ name: '1K', tokenCount: 1000, isDefault: true }], fixtureAuthority: 'first credential catalog' });
beforeEach(() => { clearQoderCatalog(); fixture.transport.mockReset(); fixture.transport.mockImplementation(async (url, options) => {
  expect(url).toBe('https://api3.qoder.sh/algo/api/v2/model/list'); expect(options.method).toBe('GET'); expect(options.headers['Cosy-User']).toBe('fixture-same-user');
  return Response.json({ chat: [config()] });
}); });
describe('actual Qoder model helper authority characterization (fully mocked transport, not fresh queued authority)', () => {
  it('same user/region token rotation reuses previously fetched model catalog rather than proving new credential equality', async () => {
    const first = credentials('dt-fixture-original'), rotated = credentials('dt-fixture-rotated');
    const original = await resolveQoderModels(first); expect(original.rawConfigs.get('auto')).toEqual(config()); expect(fixture.transport).toHaveBeenCalledTimes(1);
    fixture.transport.mockImplementation(async () => { throw new Error('No second credential lookup expected in legacy cache'); });
    const second = await resolveQoderModels(rotated);
    expect(second).toBe(original); expect(fixture.transport).toHaveBeenCalledTimes(1); expect(rotated.accessToken).toBe('dt-fixture-rotated');
    expect(first.accessToken).not.toBe(rotated.accessToken); expect(second.rawConfigs.get('auto')).toEqual(config());
  });
  it('top-level model config clone retains nested shared mutable tier evidence across lookups', async () => {
    const first = await getQoderModelConfig(credentials('dt-fixture-token'), 'auto'); expect(first).toEqual(config());
    first.max_output_tokens = 999; first.context_config[0].tokenCount = 4000;
    const second = await getQoderModelConfig(credentials('dt-fixture-token'), 'auto');
    expect(second).not.toBe(first); expect(second.max_output_tokens).toBe(32); expect(second.context_config).toBe(first.context_config);
    expect(second.context_config[0].tokenCount).toBe(4000); expect(fixture.transport).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(second.context_config)).toBe(false);
  });
});
