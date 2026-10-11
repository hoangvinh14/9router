import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingGroup } from '../db/accountingGroupPayload.js';

// Operator-approved routing expansion limit, NOT spend/reservation/POST limit.
export const ACCOUNTED_ROUTING_GRAPH_LIMIT = 64;
const MAX_DEPTH = 16;
const unavailable = () => { throw new Error('Accounting routing graph unavailable'); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 8192;
const detach = value => snapshotAccountingGroup([{ type: 'routing-node', value }])[0].value;

// INTERNAL trusted resolver seam. Resolver must include all routing authority
// relevant to this node in `evidence`, including settings/aliases/capacity inputs.
// This module proves bounded expansion/equality only, not persisted provenance,
// credential freshness, dispatch permission, usage ownership or durable ACK.
export async function captureAccountingRoutingGraph(root, { resolve, gate }) {
  if (!text(root) || typeof resolve !== 'function' || typeof gate !== 'function') unavailable();
  let count = 0;
  // Flat occurrence records keep routing depth independent of plain-data depth.
  // A sibling reusing the same canonical node still gets its own record/index.
  const occurrences = [];
  async function visit(token, role, ancestry) {
    if (!text(token) || ++count > ACCOUNTED_ROUTING_GRAPH_LIMIT) unavailable();
    gate();
    const node = detach(await resolve(token, role));
    gate();
    if (!node || !text(node.id) || !['leaf', 'fallback', 'fusion'].includes(node.kind) ||
        !Object.hasOwn(node, 'evidence')) unavailable();
    const allowed = node.kind === 'leaf' ? ['id', 'kind', 'evidence', 'provider', 'model']
      : node.kind === 'fusion' ? ['id', 'kind', 'evidence', 'models', 'judge'] : ['id', 'kind', 'evidence', 'models'];
    if (Object.keys(node).some(key => !allowed.includes(key))) unavailable();
    const index = occurrences.length;
    const result = { token, role, node, children: [] };
    occurrences.push(result);
    if (node.kind === 'leaf') {
      if (!text(node.provider) || !text(node.model)) unavailable();
      return index;
    }
    if (ancestry.includes(node.id) || ancestry.length >= MAX_DEPTH || !Array.isArray(node.models) ||
        node.models.length === 0 || node.models.some(model => !text(model))) unavailable();
    const next = [...ancestry, node.id];
    if (node.kind === 'fusion' && node.models.length > 1) {
      if (!text(node.judge)) unavailable();
      for (const model of node.models) result.children.push(await visit(model, 'panel', next));
      result.children.push(await visit(node.judge, 'judge', next));
      // Exactly one regeneration may run; conservatively capture every possible
      // winning branch, never reserve money or prune an accepted routing branch.
      for (const model of node.models) result.children.push(await visit(model, 'regeneration', next));
    } else {
      if (node.kind === 'fusion' && !text(node.judge)) unavailable();
      for (const model of node.models) result.children.push(await visit(model, 'candidate', next));
    }
    return index;
  }
  const rootIndex = await visit(root, 'root', []);
  gate();
  return detach({ count, rootIndex, occurrences });
}

// Re-read through the same trusted resolver before a generation's admission.
// Drift refuses, never repairs the original snapshot or selects a new graph.
export async function assertAccountingRoutingGraphCurrent(original, root, options) {
  const retained = detach(original);
  const current = await captureAccountingRoutingGraph(root, options);
  if (!isDeepStrictEqual(retained, current)) unavailable();
  return retained;
}
