import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCatalog, fetchCatalog } from '../../src/lib/pricing/catalogSync.js';
import { validateStoredCatalog, validateReferenceState, catalogRevision, CATALOG_SOURCE } from '../../src/lib/pricing/referenceState.js';

const fixture = fs.readFileSync(new URL('../fixtures/pricing/models-dev-minimal.json', import.meta.url), 'utf8');
const published = () => ({ ...validateCatalog(fixture), syncedAt: '2026-10-19T00:00:00.000Z' });
describe('pricing-only fixed catalog ingress', () => {
  it('retains exact decimals/zero and unsupported/missing categories without catalog model registration', () => {
    const catalog = validateCatalog(fixture);
    expect(catalog.entries['openai/gpt-5'].rates).toEqual({ input: '1.25', output: '10', cached: '0.125' });
    expect(catalog.entries['openai/free-fixture'].rates.input).toBe('0');
    expect(catalog.entries['openai/unknown-fixture'].status).toBe('missing');
    expect(catalog.entries['openai/tier-fixture'].status).toBe('unsupported');
    expect(catalog.entries['openai/audio-fixture'].status).toBe('unsupported');
    expect(catalog.entries['anthropic/claude-sonnet-4-6'].rates.cache_creation).toBe('3.75');
    expect(catalog).not.toHaveProperty('api');
  });
  it('keeps opaque public identifiers and exact small exponents', () => {
    const text = '{"cloudflare-workers-ai":{"id":"cloudflare-workers-ai","models":{"@cf/meta/fixture":{"id":"@cf/meta/fixture","cost":{"input":1e-9,"output":1e-3}}}},"kilo":{"id":"kilo","models":{"~lab/latest":{"id":"~lab/latest","cost":{"input":0,"output":2}}}}}';
    const catalog = validateCatalog(text);
    expect(catalog.entries['cloudflare-workers-ai/@cf/meta/fixture'].rates).toEqual({ input: '0.000000001', output: '0.001' });
    expect(catalog.entries['kilo/~lab/latest'].status).toBe('priced');
  });
  it('rejects malformed/prototype/duplicate/negative/non-numeric prices and overprecision before publication', () => {
    for (const text of ['{}', '{', '{"__proto__":{}}', '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":null,"output":1}}}}}',
      '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":-1,"output":1}}}}}',
      '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":1,"input":2,"output":1}}}}}',
      '{"p":{"id":"p","models":{"m":{"id":"m","cost":{"input":{"numericLexeme":"0"},"output":1}}}}}']) {
      expect(() => validateCatalog(text)).toThrow();
    }
    const overprecision = fs.readFileSync(new URL('../fixtures/pricing/models-dev-overprecision.json', import.meta.url), 'utf8');
    expect(() => validateCatalog(overprecision)).toThrow(/precision/);
  });
  it('validates nested rate values and does not flatten tiers or accept composite provider collisions', () => {
    expect(() => validateCatalog(fixture.replace('"input": 2, "output": 4', '"input": -2, "output": 4'))).toThrow(/Negative/);
    expect(() => validateCatalog('{"a/b":{"id":"a/b","models":{"c":{"id":"c","cost":{"input":1,"output":2}}}}}')).toThrow(/provider/);
    expect(() => validateCatalog('{"p":{"id":"p","models":{"m":{"id":"m","cost":{"tiers":[{"tier":{"type":"context","size":100},"input":1,"output":2}]}}}}}')).toThrow(/Incomplete/);
  });
  it('uses only fixed HTTPS URL with no credentials and rejects redirects/offline/incorrect final source', async () => {
    let args;
    await fetchCatalog({ fetchImpl: async (...input) => { args = input; return new Response(fixture); } });
    expect(args[0]).toBe(CATALOG_SOURCE); expect(args[1].redirect).toBe('error');
    expect(args[1].headers).not.toHaveProperty('Authorization');
    await expect(fetchCatalog({ fetchImpl: async () => new Response('', { status: 302 }) })).rejects.toThrow();
    await expect(fetchCatalog({ fetchImpl: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    await expect(fetchCatalog({ fetchImpl: async () => ({ ok: true, redirected: true, body: new ReadableStream() }) })).rejects.toThrow();
    await expect(fetchCatalog({ fetchImpl: async () => ({ ok: true, url: 'http://127.0.0.1/', body: new ReadableStream() }) })).rejects.toThrow();
  });
  it('cancels streaming response at decompressed byte bound', async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(128)); controller.enqueue(new Uint8Array(128)); }, cancel() { cancelled = true; } });
    await expect(fetchCatalog({ fetchImpl: async () => new Response(body), maxBytes: 200 })).rejects.toThrow(/size/);
    expect(cancelled).toBe(true);
  });
});
describe('versioned reference state projection', () => {
  it('roundtrips canonical entries/revision, precise rates and schedule without executable options', () => {
    const catalog = published();
    const result = validateReferenceState({ version: 1, catalog, status: { lastAttempt: catalog.syncedAt, lastSuccess: catalog.syncedAt, error: null }, schedule: { enabled: false } });
    expect(result.catalog).toEqual(validateStoredCatalog(catalog));
    expect(result.catalog.revision).toBe(catalogRevision(result.catalog.entries));
    expect(result.schedule).toEqual({ enabled: false });
    expect(validateReferenceState({ version: 1, catalog: null, status: null, schedule: { enabled: false } }).catalog).toBeNull();
  });
  it('rejects altered source/hash/rates/units/timestamps and arbitrary projection fields', () => {
    const base = published();
    for (const delta of [{ source: 'http://127.0.0.1/' }, { revision: 'a'.repeat(64) }, { unit: 'USD/token' }, { syncedAt: 'bad' }, { endpoint: 'fetch' }]) {
      expect(() => validateStoredCatalog({ ...base, ...delta })).toThrow();
    }
    const changed = structuredClone(base); changed.entries['openai/gpt-5'].rates.input = '99';
    expect(() => validateStoredCatalog(changed)).toThrow(/revision/);
    for (const value of [{ version: 2, catalog: null, status: null, schedule: { enabled: false } },
      { version: 1, catalog: null, status: null, schedule: { enabled: 'false' } },
      { version: 1, catalog: null, status: null, schedule: { enabled: false }, fetch: true },
      { version: 1, catalog: null, status: { error: 'raw secret error' }, schedule: { enabled: false } }]) expect(() => validateReferenceState(value)).toThrow();
  });
});
