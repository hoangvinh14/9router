import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';
import { captureAccountingRoutingGraph } from './accountingRoutingGraph.js';
import { captureCapabilityRoutingAuthoritySync, runWithCapabilityRoutingAuthority } from './capabilityRoutingAuthority.js';

const unavailable = () => { throw new Error('Persisted accounting routing graph unavailable'); };
const detach = value => snapshotAccountingGroup([{ type: 'routing-material', value }])[0].value;
// Only this module's bounded, deeply frozen snapshots are trusted comparison
// operands, and only for their original owned DB. This is not fresh authority:
// every comparison still captures and validates current persisted material.
const retainedMaterials = new WeakMap();
const capabilityAuthorities = new WeakMap();
// INTERNAL owned healthy DB only. Full settings/node JSON may contain secrets:
// never ledger/log/export this equality material. Not a dispatch grant.
export function capturePersistedRoutingMaterialSync(db) {
  if (!db.health().healthy || db.coverage.status(null).maintenance) unavailable();
  const material = {
    settings: db.get('SELECT data FROM settings WHERE id=1')?.data,
    combos: db.all('SELECT * FROM combos ORDER BY id'),
    aliases: db.all("SELECT key,value FROM kv WHERE scope='modelAliases' ORDER BY key"),
    providerNodes: db.all('SELECT * FROM providerNodes ORDER BY id'),
    capabilities: captureCapabilityRoutingAuthoritySync(),
  };
  if (typeof material.settings !== 'string') unavailable();
  // Bound before programmable resolution or JSON conversion; raw lexical
  // equality intentionally treats every persisted edit as authority drift.
  const result = detach(material);
  for (const text of [result.settings, ...result.combos.map(r => r.models),
    ...result.aliases.map(r => r.value), ...result.providerNodes.map(r => r.data)]) {
    if (typeof text !== 'string') unavailable();
    try { JSON.parse(text); } catch { unavailable(); }
  }
  if (!db.health().healthy || db.coverage.status(null).maintenance) unavailable();
  retainedMaterials.set(result, db);
  capabilityAuthorities.set(result, material.capabilities);
  return result;
}

export async function capturePersistedRoutingGraph(db, root, { resolve, gate }) {
  gate();
  const material = capturePersistedRoutingMaterialSync(db);
  const check = () => {
    gate();
    if (!isDeepStrictEqual(material, capturePersistedRoutingMaterialSync(db))) unavailable();
  };
  const authority = capabilityAuthorities.get(material);
  const graph = await runWithCapabilityRoutingAuthority(authority,
    () => captureAccountingRoutingGraph(root, { resolve, gate: check }));
  check();
  // Material and graph retain their own whole bounded snapshots; no nested
  // snapshot wrapper that accidentally lowers their independent depth bounds.
  return Object.freeze({ material, graph });
}
export function assertPersistedRoutingMaterialCurrent(db, retained, gate) {
  gate();
  // Avoid re-traversing our immutable retained operand; arbitrary callers and
  // detached queue envelopes still receive the complete descriptor-safe guard.
  const material = retainedMaterials.get(retained) === db ? retained : detach(retained);
  if (!isDeepStrictEqual(material, capturePersistedRoutingMaterialSync(db))) unavailable();
}
