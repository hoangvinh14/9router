import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
let db, directory, createCombo, resolver, capture, previousCatalogSource;
const previous = process.env.DATA_DIR;
await import('../../src/sse/services/accountingRoutingResolver.js');
beforeEach(async () => {
  previousCatalogSource = globalThis.__9rCatalogSource;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), '9router-routing-resolver-')); process.env.DATA_DIR = directory;
  delete global._dbAdapter; vi.resetModules(); db = await (await import('@/lib/db/driver.js')).getAdapter();
  await (await import('@/lib/db/index.js')).importDb({ settings: { requireApiKey: true, comboStrategies: {
    outer: { fallbackStrategy: 'fusion', judgeModel: 'openai/j' }, inner: { fallbackStrategy: 'fusion', judgeModel: 'openai/ij' } } },
    modelAliases: { fixtureAlias: 'openai/a' } });
  ({ createCombo } = await import('@/lib/db/repos/combosRepo.js'));
  ({ createAccountingRoutingResolver: resolver } = await import('../../src/sse/services/accountingRoutingResolver.js'));
  ({ capturePersistedRoutingGraph: capture } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js'));
});
afterEach(() => { vi.restoreAllMocks(); if (previousCatalogSource === undefined) delete globalThis.__9rCatalogSource;
  else globalThis.__9rCatalogSource = previousCatalogSource;
  db?.close(); delete global._dbAdapter; fs.rmSync(directory, { recursive: true, force: true });
  if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; });
const body = () => ({ model: 'outer', stream: false, messages: [{ role: 'user', content: 'fixture original' }] });
describe('actual app combo/alias/provider-node resolver preflight, not nested dispatch permission', () => {
  it('expands nested fusion panels/judges/regeneration and aliases with real persisted combos', async () => {
    await createCombo({ name: 'outer', models: ['inner', 'fixtureAlias'] });
    await createCombo({ name: 'inner', models: ['openai/a', 'openai/b'] });
    const proof = await capture(db, 'outer', { resolve: resolver(body()), gate() {} });
    expect(proof.graph.count).toBe(16);
    expect(proof.graph.occurrences.filter(o => o.token === 'inner')).toHaveLength(2);
    expect(proof.graph.occurrences.filter(o => o.token === 'fixtureAlias').every(o => o.node.provider === 'openai' && o.node.model === 'a')).toBe(true);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('honors concrete provider-node prefix over custom provider parsing', async () => {
    await (await import('@/lib/db/repos/nodesRepo.js')).createProviderNode({ id: 'owned-node', type: 'openai-compatible', name: 'fixture', prefix: 'custom', baseUrl: 'http://fixture.invalid/chat' });
    const proof = await capture(db, 'custom/a', { resolve: resolver(body()), gate() {} });
    expect(proof.graph.occurrences[0].node).toMatchObject({ kind: 'leaf', provider: 'owned-node', model: 'a' });
  });
  it('preserves fusion default judge selection without adding capacity to its panel', async () => {
    await createCombo({ name: 'plain', models: ['openai/a', 'openai/b'] });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ comboStrategies: { plain: { fallbackStrategy: 'fusion' } } });
    const proof = await capture(db, 'plain', { resolve: resolver(body()), gate() {} });
    expect(proof.graph.count).toBe(6); expect(proof.graph.occurrences[0].node.judge).toBe('openai/a');
  });
  it('captures standalone capacity ordering once without recursively augmenting each leaf', async () => {
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: {
      vision: { enabled: true, roundRobin: true, models: ['openai/vision-model', 'openai/coder-model'] } } });
    const media = { model: 'openai/coder-model', stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } ] }] };
    const proof = await capture(db, media.model, { resolve: resolver(media), gate() {} });
    expect(proof.graph.count).toBe(3);
    expect(proof.graph.occurrences[0].node).toMatchObject({ kind: 'fallback',
      models: ['openai/vision-model', 'openai/coder-model'], evidence: { strategy: 'round-robin', required: ['vision'] } });
    expect(proof.graph.occurrences.slice(1).map(o => o.node.kind)).toEqual(['leaf', 'leaf']);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('keeps original fallback siblings and capacity candidate occurrences without pruning', async () => {
    await createCombo({ name: 'pool', models: ['openai/coder-model', 'openai/coder-model'] });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: {
      vision: { enabled: true, models: ['openai/vision-model', 'openai/vision-model'] } } });
    const media = { model: 'pool', stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } ] }] };
    const proof = await capture(db, 'pool', { resolve: resolver(media), gate() {} });
    expect(proof.graph.count).toBe(4);
    expect(proof.graph.occurrences[0].node.models).toEqual(['openai/vision-model', 'openai/coder-model', 'openai/coder-model']);
    expect(proof.graph.occurrences.filter(o => o.token === 'openai/coder-model')).toHaveLength(2);
    expect(proof.graph.occurrences[0].node.evidence.nestedTextEligible).toBe(false);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('already capable original model retains exact candidates without capacity additions', async () => {
    await createCombo({ name: 'capable', models: ['openai/vision-model', 'openai/coder-model'] });
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: {
      vision: { enabled: true, models: ['openai/another-vision-model'] } } });
    const media = { model: 'capable', stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } ] }] };
    const proof = await capture(db, 'capable', { resolve: resolver(media), gate() {} });
    expect(proof.graph.count).toBe(3);
    expect(proof.graph.occurrences[0].node.models).toEqual(['openai/vision-model', 'openai/coder-model']);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('persisted capacity edit refuses current proof rather than silently rebuilding it', async () => {
    const settings = await import('@/lib/db/repos/settingsRepo.js');
    await settings.updateSettings({ capacityAdapter: { vision: { enabled: true, models: ['openai/vision-model'] } } });
    const media = { model: 'openai/coder-model', stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } ] }] };
    const proof = await capture(db, media.model, { resolve: resolver(media), gate() {} });
    expect(proof.graph.occurrences[0].node.models).toEqual(['openai/vision-model', 'openai/coder-model']);
    await settings.updateSettings({ capacityAdapter: { vision: { enabled: false, models: ['openai/vision-model'] } } });
    const { assertPersistedRoutingMaterialCurrent } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    expect(() => assertPersistedRoutingMaterialCurrent(db, proof.material, () => {})).toThrow('Persisted accounting routing graph unavailable');
    expect(proof.graph.occurrences[0].node.models).toEqual(['openai/vision-model', 'openai/coder-model']);
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('verified catalog images isolate concurrent awaits and do not replace legacy reads', async () => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    const { captureCapabilityRoutingAuthoritySync: read,
      runWithCapabilityRoutingAuthority: scoped } = await import('@/lib/apiKeyBudget/capabilityRoutingAuthority.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2, models: {}, providers: {} }));
    await catalog.installCatalogSource(); const textOnly = read();
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2,
      models: { 'openai:coder-model': { vision: true } }, providers: {} }));
    const vision = read(); let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const lookup = () => catalog.getCatalogModalities('openai', 'coder-model');
    const a = scoped(textOnly, async () => { await barrier; return lookup(); });
    const b = scoped(vision, async () => { await barrier; return lookup(); });
    release(); expect(await Promise.all([a, b])).toEqual([null, { vision: true }]);
    catalog.invalidateCatalog(); expect(lookup()).toEqual({ vision: true });
    expect(() => scoped(Object.freeze({ ...textOnly }), lookup)).toThrow('Persisted accounting routing graph unavailable');
    await expect(scoped(textOnly, async () => { throw new Error('Fixture scoped resolver failure'); }))
      .rejects.toThrow('Fixture scoped resolver failure');
    expect(lookup()).toEqual({ vision: true });
  });
  it.each(['unchanged', 'edit', 'malformed', 'remove', 'source-reinstall', 'symlink'])('verified catalog image never substitutes freshness after resolver await: %s', async mode => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    const original = JSON.stringify({ v: 2, models: {}, providers: {} });
    fs.writeFileSync(catalog.CATALOG_FILE, original); await catalog.installCatalogSource();
    const input = { model: 'openai/coder-model', stream: false,
      messages: [{ role: 'user', content: 'fixture original' }] };
    const actualResolve = resolver(input);
    const positive = await capture(db, input.model, { resolve: actualResolve, gate() {} });
    expect(positive.graph.count).toBe(1); expect(positive.material.capabilities.text).toBe(original);
    let enter, release, calls = 0, observedImage;
    const entered = new Promise(resolve => { enter = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    const work = capture(db, input.model, { gate() {}, resolve: async (...args) => {
      calls++; const node = await actualResolve(...args);
      enter(); await barrier;
      observedImage = catalog.getCatalogModalities('openai', 'coder-model');
      return node;
    } }).then(proof => ({ proof }), error => ({ error }));
    try {
      await Promise.race([entered, work.then(() => { throw new Error('Fixture catalog capture finished before await boundary'); })]);
      expect(calls).toBe(1);
      if (mode === 'edit') fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2,
        models: { 'openai:coder-model': { vision: true } }, providers: {} }));
      if (mode === 'malformed') fs.writeFileSync(catalog.CATALOG_FILE, '{');
      if (mode === 'remove') fs.unlinkSync(catalog.CATALOG_FILE);
      if (mode === 'source-reinstall') await catalog.installCatalogSource();
      if (mode === 'symlink') {
        const target = path.join(directory, 'owned-catalog-target.json');
        fs.writeFileSync(target, original); fs.unlinkSync(catalog.CATALOG_FILE);
        fs.symlinkSync(target, catalog.CATALOG_FILE);
      }
      release(); const result = await work;
      expect(observedImage).toBeNull(); expect(calls).toBe(1);
      if (mode === 'unchanged') {
        expect(result.error).toBeUndefined(); expect(result.proof.graph.count).toBe(1);
        expect(result.proof.material.capabilities.text).toBe(original);
      } else {
        expect(result.proof).toBeUndefined();
        expect(result.error?.message).toBe('Persisted accounting routing graph unavailable');
      }
      expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
    } finally { release(); await work; }
  });
  it('catalog resolver consumes verified bytes, not an unbound transient reader image', async () => {
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: {
      vision: { enabled: true, models: ['openai/vision-model'] } } });
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    const original = JSON.stringify({ v: 2, models: {}, providers: {} });
    fs.writeFileSync(catalog.CATALOG_FILE, original); await catalog.installCatalogSource();
    const media = { model: 'openai/coder-model', stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } ] }] };
    const positive = await capture(db, media.model, { resolve: resolver(media), gate() {} });
    expect(positive.graph.count).toBe(3);
    const read = fs.readFileSync.bind(fs); let transientReads = 0;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (file !== catalog.CATALOG_FILE) return read(file, ...args);
      transientReads++;
      // Owned local race fixture: actual alternate file bytes exist only while
      // the separate legacy reader runs, not at either fresh material capture.
      fs.writeFileSync(file, JSON.stringify({ v: 2, models: { 'openai:coder-model': { vision: true } }, providers: {} }));
      try { return read(file, ...args); } finally { fs.writeFileSync(file, original); }
    });
    try {
      const proof = await capture(db, media.model, { resolve: resolver(media), gate() {} });
      expect(proof.material.capabilities.text).toBe(original);
      expect(proof.graph.count).toBe(3);
      expect(proof.graph.occurrences[0].node.models).toEqual(['openai/vision-model', 'openai/coder-model']);
      expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
    } finally { spy.mockRestore(); }
    // Queued resolution must not make a second unbound legacy file read.
    expect(transientReads).toBe(0);
  });
  it('catalog source replacement after module reload cannot alias retained source authority', async () => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ v: 2, models: {}, providers: {} }));
    await catalog.installCatalogSource();
    const proof = await capture(db, 'openai/coder-model', { resolve: resolver(body()), gate() {} });
    const { assertPersistedRoutingMaterialCurrent: originalCheck } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    expect(() => originalCheck(db, proof.material, () => {})).not.toThrow();
    const originalSource = globalThis.__9rCatalogSource;
    vi.resetModules();
    const replacement = await import('../../open-sse/providers/catalogOverride.js');
    await replacement.installCatalogSource();
    expect(globalThis.__9rCatalogSource).not.toBe(originalSource);
    const { assertPersistedRoutingMaterialCurrent: reloadedCheck,
      capturePersistedRoutingMaterialSync: recapture } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    expect(() => reloadedCheck(db, proof.material, () => {})).toThrow('Persisted accounting routing graph unavailable');
    const fresh = recapture(db);
    expect(fresh.capabilities.sourceId).not.toBe(proof.material.capabilities.sourceId);
    expect(fresh.capabilities.text).toBe(proof.material.capabilities.text);
    expect(() => reloadedCheck(db, fresh, () => {})).not.toThrow();
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('catalog capability drift changes capacity graph and refuses retained authority, not dispatch permission', async () => {
    await (await import('@/lib/db/repos/settingsRepo.js')).updateSettings({ capacityAdapter: {
      vision: { enabled: true, models: ['openai/vision-model'] } } });
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ version: 2, models: {}, providers: {} }));
    catalog.invalidateCatalog(); await catalog.installCatalogSource();
    const media = { model: 'openai/coder-model', stream: false, messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } } ] }] };
    const resolve = resolver(media), proof = await capture(db, media.model, { resolve, gate() {} });
    expect(proof.graph.count).toBe(3);
    expect(proof.graph.occurrences[0].node.models).toEqual(['openai/vision-model', 'openai/coder-model']);
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ version: 2,
      models: { 'openai:coder-model': { vision: true } }, providers: {} }));
    catalog.invalidateCatalog();
    const { getCapabilitiesForModel } = await import('../../open-sse/providers/capabilities.js');
    expect(getCapabilitiesForModel('openai', 'coder-model').vision).toBe(true);
    const material = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    // The earlier characterization proved SQL-only equality insufficient.
    // Full retained authority now includes the bounded installed catalog.
    expect(() => material.assertPersistedRoutingMaterialCurrent(db, proof.material, () => {}))
      .toThrow('Persisted accounting routing graph unavailable');
    const current = await capture(db, media.model, { resolve, gate() {} });
    expect(current.graph.count).toBe(1); expect(current.graph.occurrences[0].node.kind).toBe('leaf');
    const { assertAccountingRoutingGraphCurrent } = await import('@/lib/apiKeyBudget/accountingRoutingGraph.js');
    await expect(assertAccountingRoutingGraphCurrent(proof.graph, media.model, { resolve, gate() {} }))
      .rejects.toThrow('Accounting routing graph unavailable');
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('retained request material must refuse catalog edits even when SQL routing rows are unchanged', async () => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ version: 2, models: {}, providers: {} }));
    catalog.invalidateCatalog(); await catalog.installCatalogSource();
    const proof = await capture(db, 'openai/coder-model', { resolve: resolver({ model: 'openai/coder-model',
      stream: false, messages: [{ role: 'user', content: 'original text' }] }), gate() {} });
    expect(proof.graph.count).toBe(1);
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ version: 2,
      models: { 'openai:coder-model': { vision: true } }, providers: {} }));
    catalog.invalidateCatalog();
    const { assertPersistedRoutingMaterialCurrent } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    expect(() => assertPersistedRoutingMaterialCurrent(db, proof.material, () => {}))
      .toThrow('Persisted accounting routing graph unavailable');
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('same-mtime catalog edits still refuse retained lexical authority', async () => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ models: {}, providers: {} }));
    catalog.invalidateCatalog(); await catalog.installCatalogSource();
    const proof = await capture(db, 'openai/coder-model', { resolve: resolver(body()), gate() {} });
    const stat = fs.statSync(catalog.CATALOG_FILE);
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ models: { 'openai:coder-model': { vision: true } }, providers: {} }));
    fs.utimesSync(catalog.CATALOG_FILE, stat.atime, stat.mtime);
    const { assertPersistedRoutingMaterialCurrent } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    expect(() => assertPersistedRoutingMaterialCurrent(db, proof.material, () => {})).toThrow('Persisted accounting routing graph unavailable');
  });
  it('catalog absence is explicit, while later creation or source replacement refuses', async () => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    await catalog.installCatalogSource();
    const proof = await capture(db, 'openai/coder-model', { resolve: resolver(body()), gate() {} });
    expect(proof.material.capabilities.text).toBeNull();
    const { assertPersistedRoutingMaterialCurrent } = await import('@/lib/apiKeyBudget/persistedRoutingGraph.js');
    expect(() => assertPersistedRoutingMaterialCurrent(db, proof.material, () => {})).not.toThrow();
    await catalog.installCatalogSource();
    expect(() => assertPersistedRoutingMaterialCurrent(db, proof.material, () => {})).toThrow('Persisted accounting routing graph unavailable');
    const next = await capture(db, 'openai/coder-model', { resolve: resolver(body()), gate() {} });
    fs.writeFileSync(catalog.CATALOG_FILE, JSON.stringify({ models: {}, providers: {} }));
    expect(() => assertPersistedRoutingMaterialCurrent(db, next.material, () => {})).toThrow('Persisted accounting routing graph unavailable');
  });
  it.each(['malformed', 'oversized', 'symlink', 'fifo'])('installed %s catalog refuses before resolver callbacks', async mode => {
    const catalog = await import('../../open-sse/providers/catalogOverride.js');
    if (mode === 'malformed') fs.writeFileSync(catalog.CATALOG_FILE, '{');
    if (mode === 'oversized') fs.writeFileSync(catalog.CATALOG_FILE, 'x'.repeat(262145));
    if (mode === 'symlink') { const target = path.join(directory, 'catalog-target.json');
      fs.writeFileSync(target, JSON.stringify({ models: {}, providers: {} })); fs.symlinkSync(target, catalog.CATALOG_FILE); }
    if (mode === 'fifo') execFileSync('mkfifo', [catalog.CATALOG_FILE]);
    await catalog.installCatalogSource(); const resolve = vi.fn();
    await expect(capture(db, 'openai/coder-model', { resolve, gate() {} })).rejects.toThrow('Persisted accounting routing graph unavailable');
    expect(resolve).not.toHaveBeenCalled(); expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('arbitrary or accessor catalog source is refused without executing callbacks', async () => {
    const callbacks = vi.fn(); globalThis.__9rCatalogSource = { getModalities: callbacks, getLimits: callbacks };
    const resolve = vi.fn();
    await expect(capture(db, 'openai/coder-model', { resolve, gate() {} })).rejects.toThrow('Persisted accounting routing graph unavailable');
    globalThis.__9rCatalogSource = Object.defineProperty({}, 'getModalities', { enumerable: true, get: callbacks });
    await expect(capture(db, 'openai/coder-model', { resolve, gate() {} })).rejects.toThrow('Persisted accounting routing graph unavailable');
    expect(callbacks).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });
  it('real cyclic persisted graph refuses before any accounting attempt', async () => {
    await createCombo({ name: 'outer', models: ['inner', 'openai/a'] });
    await createCombo({ name: 'inner', models: ['outer', 'openai/b'] });
    await expect(capture(db, 'outer', { resolve: resolver(body()), gate() {} })).rejects.toThrow('Accounting routing graph unavailable');
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
  it('real configured oversized graph stops before any accounting attempt', async () => {
    await createCombo({ name: 'outer', models: Array.from({ length: 32 }, (_, i) => 'openai/m' + i) });
    await expect(capture(db, 'outer', { resolve: resolver(body()), gate() {} })).rejects.toThrow('Accounting routing graph unavailable');
    expect(db.get('SELECT COUNT(*) AS n FROM apiKeyAccounting').n).toBe(0);
  });
});
