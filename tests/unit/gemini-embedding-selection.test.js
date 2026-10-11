import { describe, it, expect, vi } from 'vitest';
import { captureGeminiEmbeddingSelectionSync } from '@/lib/apiKeyBudget/geminiEmbeddingSelection.js';

function fixture() {
  const authority = { provider: 'gemini', model: 'gemini-embedding-001', connectionId: 'connection-a', apiKeyId: 'key-a', settings: '{}' };
  const row = (id, priority, extra = {}) => Object.assign(Object.create(null), {
    id, provider: 'gemini', authType: 'apikey', priority, isActive: 1, data: JSON.stringify(extra),
  });
  const rows = [row('connection-a', 2), row('connection-b', 3)];
  const db = { health: () => ({ healthy: true }), coverage: { status: () => ({ maintenance: false }) }, all: vi.fn(() => rows) };
  return { authority, rows, row, db, capture: () => captureGeminiEmbeddingSelectionSync(db, authority) };
}
function refuse(f) {
  expect(f.capture).toThrow('Gemini embedding selection unavailable');
}

describe('healthy Gemini fill-first bounded selection equality only, not SQL provenance/POST authority', () => {
  it('accepts null-prototype SQL rows and detaches/freezes complete pool', () => {
    const f = fixture(), captured = f.capture();
    expect(f.db.all).toHaveBeenCalledWith('SELECT * FROM providerConnections WHERE provider = ? AND isActive = ?', ['gemini', 1]);
    expect(captured.connections.map(c => c.id)).toEqual(['connection-a', 'connection-b']);
    f.rows[1].priority = 1;
    expect(captured.material.candidates[1].priority).toBe(3);
    expect(Object.isFrozen(captured.material.candidates[1])).toBe(true);
    refuse(f);
  });
  it('uses stable SQL order for equal priority; never a synthetic ID preference', () => {
    const f = fixture(); f.rows[1].priority = 2;
    expect(f.capture().connections[0].id).toBe('connection-a');
    f.rows.reverse(); refuse(f);
  });
  it('retains legacy zero/null priority default of 999', () => {
    const f = fixture(); f.rows[0].priority = 0; f.rows[1].priority = null;
    expect(f.capture().connections).toHaveLength(2);
    f.rows[1].priority = 1; refuse(f);
  });
  it('uses existing per-model lock availability with SQL columns winning over JSON shadows', () => {
    const f = fixture(); f.rows[1].priority = 1;
    f.rows[1].data = JSON.stringify({ id: 'connection-a', priority: 900, modelLock_GEMINI: '2999-01-01T00:00:00Z',
      'modelLock_gemini-embedding-001': '2999-01-01T00:00:00Z' });
    expect(f.capture().connections[1].id).toBe('connection-b');
    f.rows[1].data = '{}'; refuse(f);
  });
  it.each(['round-robin', 'unknown'])('refuses unsupported selection strategy %s without defaulting', strategy => {
    const f = fixture(); expect(f.capture()).toBeTruthy();
    f.authority.settings = JSON.stringify({ fallbackStrategy: strategy }); refuse(f);
  });
  it('checks provider-specific strategy over global strategy', () => {
    const f = fixture(); f.authority.settings = JSON.stringify({ fallbackStrategy: 'round-robin', providerStrategies: { gemini: { fallbackStrategy: 'fill-first' } } });
    expect(f.capture()).toBeTruthy();
    f.authority.settings = JSON.stringify({ fallbackStrategy: 'fill-first', providerStrategies: { gemini: { fallbackStrategy: 'round-robin' } } }); refuse(f);
  });
  it.each(['settings', 'candidate'])('refuses malformed private JSON in %s with fixed error', where => {
    const f = fixture(); expect(f.capture()).toBeTruthy();
    if (where === 'settings') f.authority.settings = '{fixture-private'; else f.rows[1].data = '{fixture-private';
    refuse(f);
    try { f.capture(); } catch (error) { expect(String(error)).not.toContain('fixture-private'); }
  });
  it('refuses array settings/strategy and fractional priority', () => {
    for (const change of [f => { f.authority.settings = '[]'; }, f => { f.authority.settings = '{"providerStrategies":[]}'; }, f => { f.rows[1].priority = 1.5; }]) {
      const f = fixture(); expect(f.capture()).toBeTruthy(); change(f); refuse(f);
    }
  });
  it('refuses getter and proxy candidate rows before programmable reads', () => {
    const f = fixture(); expect(f.capture()).toBeTruthy(); let reads = 0;
    Object.defineProperty(f.rows[1], 'data', { enumerable: true, get() { reads++; throw new Error('fixture-private'); } });
    refuse(f); expect(reads).toBe(0);
    f.rows[1] = new Proxy(f.row('connection-b', 3), { ownKeys() { reads++; throw new Error('fixture-private'); } });
    refuse(f); expect(reads).toBe(0);
  });
  it('refuses oversized sibling pool rather than pruning a harmless losing account', () => {
    const f = fixture(); expect(f.capture()).toBeTruthy();
    f.rows[1].data = JSON.stringify({ private: 'x'.repeat(262144) }); refuse(f);
  });
  it('refuses deeply nested JSON even though the encoded string fits', () => {
    const f = fixture(); expect(f.capture()).toBeTruthy(); let nested = {};
    for (let i = 0; i < 20; i++) nested = { nested };
    f.rows[1].data = JSON.stringify(nested); refuse(f);
  });
  it.each(['constructor', '__proto__', 'prototype'])('refuses parsed forbidden key %s before projection without pruning', key => {
    for (const where of ['settings', 'candidate']) for (const nested of [false, true]) {
      const f = fixture(); expect(f.capture()).toBeTruthy();
      const leaf = `{"${key}":"fixture-private"}`, json = nested ? `{"private":${leaf}}` : leaf;
      if (where === 'settings') f.authority.settings = json; else f.rows[1].data = json;
      refuse(f);
    }
  });
  it('refuses unhealthy or maintenance SQL view, not routing from retained data', () => {
    const f = fixture(); expect(f.capture()).toBeTruthy();
    f.db.health = () => ({ healthy: false }); refuse(f);
    f.db.health = () => ({ healthy: true }); f.db.coverage.status = () => ({ maintenance: true }); refuse(f);
  });
});
