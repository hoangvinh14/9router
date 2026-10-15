import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { captureClaudeCodeRegime, CLAUDE_ACCOUNTING_CODE_CHARGE, CLAUDE_ACCOUNTING_CODE_NAME, CLAUDE_ACCOUNTING_CODE_CALLER,
  CLAUDE_ACCOUNTING_DIRECT_CALLER, normalizeClaudeDeclaredCaller } from './accountingClaudeCodeRegime.js';
import { CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES, CLAUDE_ACCOUNTING_SERVER_SEARCH_PAUSE } from './accountingClaudeServerSearch.js';
import { CLAUDE_ACCOUNTING_SERVER_FETCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES } from './accountingClaudeServerFetch.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { CLAUDE_STOP } from '../translator/schema/finishReasons.js';

// Association only. Consumers must independently validate original/full result
// schemas, raw quantities, container/file ownership and actual delivery. Never
// retain input/output corpus or synthesize hidden children, usage or citations.
export const CLAUDE_ACCOUNTING_CODE_SUBTOOLS = Object.freeze({
  [CLAUDE_ACCOUNTING_CODE_NAME]: CLAUDE_BLOCK.CODE_EXECUTION_TOOL_RESULT,
  bash_code_execution: CLAUDE_BLOCK.BASH_CODE_EXECUTION_TOOL_RESULT,
  text_editor_code_execution: CLAUDE_BLOCK.TEXT_EDITOR_CODE_EXECUTION_TOOL_RESULT,
});
export const CLAUDE_ACCOUNTING_TOOL_GRAPH_BYTES = 262144;
export const CLAUDE_ACCOUNTING_TOOL_GRAPH_ENTRIES = 10000;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const shape = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
export function createClaudeToolGraph(tools) {
  let original, regime;
  try { original = snapshotAccountingPreparedData(tools); regime = captureClaudeCodeRegime(original); } catch { return null; }
  if (regime.codeCharge !== CLAUDE_ACCOUNTING_CODE_CHARGE.INCLUDED) return null;
  const definitions = new Map(original.map(tool => [tool.name, tool]));
  const issued = new Set(), pending = new Map(), clients = new Set();
  let bytes = 0, entries = 0;
  const reserve = value => {
    const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes + size > CLAUDE_ACCOUNTING_TOOL_GRAPH_BYTES || entries + 1 > CLAUDE_ACCOUNTING_TOOL_GRAPH_ENTRIES) return false;
    bytes += size; entries++; return true;
  };
  const parent = caller => {
    if (caller === undefined || shape(caller, ['type']) && caller.type === CLAUDE_ACCOUNTING_DIRECT_CALLER) return null;
    if (!shape(caller, ['type', 'tool_id']) || caller.type !== CLAUDE_ACCOUNTING_CODE_CALLER || typeof caller.tool_id !== 'string') return false;
    const owner = pending.get(caller.tool_id);
    return owner?.code === true ? caller.tool_id : false;
  };
  const permissions = definition => {
    const types = definition.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME ? CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES : CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES;
    return definition.allowed_callers?.map(normalizeClaudeDeclaredCaller) || [definition.type === types[0] ? CLAUDE_ACCOUNTING_DIRECT_CALLER : CLAUDE_ACCOUNTING_CODE_CALLER];
  };
  const codeEnabled = definitions.has(CLAUDE_ACCOUNTING_CODE_NAME) || original.some(tool =>
    [CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME].includes(tool.name) &&
    permissions(tool).includes(CLAUDE_ACCOUNTING_CODE_CALLER));
  return Object.freeze({
    pendingCount() { return pending.size; },
    acceptCall(value) {
      let block; try { block = snapshotAccountingPreparedData(value); } catch { return false; }
      if (!shape(block, ['type', 'id', 'name', 'input', 'caller']) || block.type !== CLAUDE_BLOCK.SERVER_TOOL_USE ||
          typeof block.id !== 'string' || !/^srvtoolu_[a-zA-Z0-9_]+$/.test(block.id) || issued.has(block.id) || !object(block.input)) return false;
      const code = Object.hasOwn(CLAUDE_ACCOUNTING_CODE_SUBTOOLS, block.name), definition = definitions.get(block.name), owner = parent(block.caller);
      if (owner === false || code && (!codeEnabled || owner !== null) || !code && ![CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME].includes(block.name)) return false;
      if (!code && (!definition || !permissions(definition).includes(owner === null ? CLAUDE_ACCOUNTING_DIRECT_CALLER : CLAUDE_ACCOUNTING_CODE_CALLER))) return false;
      const expected = code ? CLAUDE_ACCOUNTING_CODE_SUBTOOLS[block.name] : block.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME ? CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT : CLAUDE_BLOCK.WEB_FETCH_TOOL_RESULT;
      const association = { expected, code, parent: owner };
      if (!reserve([block.id, association])) return false;
      issued.add(block.id); pending.set(block.id, association); return true;
    },
    acceptResult(value) {
      let block; try { block = snapshotAccountingPreparedData(value); } catch { return false; }
      if (!shape(block, ['type', 'tool_use_id', 'content', 'caller']) || !Object.hasOwn(block, 'content') || typeof block.tool_use_id !== 'string') return false;
      const association = pending.get(block.tool_use_id), owner = parent(block.caller);
      if (!association || block.type !== association.expected || owner === false || owner !== association.parent ||
          association.code && [...pending.values()].some(child => child.parent === block.tool_use_id)) return false;
      if (!reserve([block.tool_use_id, block.type, owner])) return false;
      pending.delete(block.tool_use_id); return true;
    },
    acceptClientId(id) {
      if (typeof id !== 'string' || !id || id.startsWith('srvtoolu_') || issued.has(id) || !reserve(id)) return false;
      issued.add(id); clients.add(id); return true;
    },
    acceptClientResult(id) {
      if (!clients.has(id) || !reserve(id)) return false;
      clients.delete(id); return true;
    },
    canStop(reason) {
      if (reason === CLAUDE_STOP.TOOL_USE) return clients.size > 0;
      if (reason === CLAUDE_ACCOUNTING_SERVER_SEARCH_PAUSE) return clients.size === 0;
      return Object.values(CLAUDE_STOP).includes(reason) && clients.size === 0 && pending.size === 0;
    },
  });
}
