import { describe, it, expect } from 'vitest';
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from '../../open-sse/services/capacityAdapter.js';
const settings = { capacityAdapter: { vision: { enabled: true, roundRobin: true, models: ['openai/gpt-4o'] } } };
describe('existing capacity selection contract', () => {
  it('priority augmentation does not mutate originals and retains configured strategy', () => {
    const originals = ['openai/fixture-text'];
    expect(augmentModelsWithCapacityAdapter(originals, new Set(['vision']), settings)).toEqual(['openai/gpt-4o', ...originals]);
    expect(originals).toEqual(['openai/fixture-text']); expect(getActiveAdapterStrategy(new Set(['vision']), settings)).toBe('round-robin');
    expect(augmentModelsWithCapacityAdapter(originals, new Set(), settings)).toBe(originals);
  });
  it('stripping wrapper forwards callback argument shape and signal without added ownership', () => {
    const calls = [], callback = (...args) => { calls.push(args); return 'result'; }, signal = new AbortController().signal;
    const wrapper = withCapacityAdapterStripping(callback, ['openai/gpt-4o']);
    const body = { messages: [{ role: 'user', content: 'fixture' }] };
    expect(wrapper(body, 'openai/gpt-4o', false, signal)).toBe('result');
    expect(calls[0]).toHaveLength(4); expect(calls[0][0]).toBe(body); expect(calls[0][3]).toBe(signal);
    expect(withCapacityAdapterStripping(callback, [])).toBe(callback);
  });
});
