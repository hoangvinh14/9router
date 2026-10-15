import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsClaudeServerSearchTool, CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES } from './accountingClaudeServerSearch.js';
import { supportsClaudeServerFetchTool, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES } from './accountingClaudeServerFetch.js';

// Original-definition authority only: not raw quantity, duration, tenant ownership,
// full request validation or provider permission. No caller uses this to admit work.
export const CLAUDE_ACCOUNTING_CODE_NAME = 'code_execution';
export const CLAUDE_ACCOUNTING_CODE_TYPES = Object.freeze(['code_execution_20250825', 'code_execution_20260120', 'code_execution_20260521']);
export const CLAUDE_ACCOUNTING_CODE_CALLER = CLAUDE_ACCOUNTING_CODE_TYPES[1];
export const CLAUDE_ACCOUNTING_DIRECT_CALLER = 'direct';
// Declared20260521 maps to raw20260120; not an additional raw caller kind.
export const normalizeClaudeDeclaredCaller = caller => caller === CLAUDE_ACCOUNTING_CODE_TYPES[2] ? CLAUDE_ACCOUNTING_CODE_CALLER : caller;
export const CLAUDE_ACCOUNTING_CODE_CHARGE = Object.freeze({ ABSENT: 'absent', INCLUDED: 'token-only', UNOBSERVABLE: 'duration-unobservable' });
const invalid = () => { throw new Error('Invalid Claude code regime authority'); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function cache(tool) {
  if (!Object.hasOwn(tool, 'cache_control')) return true;
  const value = tool.cache_control;
  return object(value) && Object.keys(value).every(key => ['type', 'ttl'].includes(key)) && value.type === 'ephemeral' &&
    (value.ttl === undefined || ['5m', '1h'].includes(value.ttl));
}
function webDefinition(tool, predicate, types) {
  if (tool.allowed_callers !== undefined && (!Array.isArray(tool.allowed_callers) || !tool.allowed_callers.length ||
      new Set(tool.allowed_callers.map(normalizeClaudeDeclaredCaller)).size !== tool.allowed_callers.length ||
      tool.allowed_callers.some(caller => ![CLAUDE_ACCOUNTING_DIRECT_CALLER, CLAUDE_ACCOUNTING_CODE_CALLER].includes(normalizeClaudeDeclaredCaller(caller))))) invalid();
  // Validate existing option/version grammar without changing the direct-only
  // admission predicates. Projection is local definition validation, not a wire.
  if (!predicate({ ...tool, allowed_callers: [CLAUDE_ACCOUNTING_DIRECT_CALLER] }) || !cache(tool)) invalid();
  return tool.type !== types[0];
}
export function captureClaudeCodeRegime(tools) {
  tools = snapshotAccountingPreparedData(tools);
  if (!Array.isArray(tools)) invalid();
  let included = false, explicitCode = null;
  const names = new Set();
  for (const tool of tools) {
    if (!object(tool) || typeof tool.name !== 'string' || !tool.name || names.has(tool.name)) invalid();
    names.add(tool.name);
    if (tool.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME) {
      included = webDefinition(tool, supportsClaudeServerSearchTool, CLAUDE_ACCOUNTING_SERVER_SEARCH_TYPES) || included;
    } else if (tool.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME) {
      included = webDefinition(tool, supportsClaudeServerFetchTool, CLAUDE_ACCOUNTING_SERVER_FETCH_TYPES) || included;
    } else if (tool.name === CLAUDE_ACCOUNTING_CODE_NAME) {
      if (!CLAUDE_ACCOUNTING_CODE_TYPES.includes(tool.type) || !cache(tool) ||
          Object.keys(tool).some(key => !['type', 'name', 'cache_control'].includes(key))) invalid();
      explicitCode = tool.type;
    } else if (tool.type !== undefined || !object(tool.input_schema) ||
        Object.keys(tool).some(key => !['name', 'description', 'input_schema', 'cache_control'].includes(key)) ||
        tool.description !== undefined && typeof tool.description !== 'string' || !cache(tool)) invalid();
  }
  if (included && explicitCode === CLAUDE_ACCOUNTING_CODE_TYPES[0]) invalid();
  return Object.freeze({ codeCharge: included ? CLAUDE_ACCOUNTING_CODE_CHARGE.INCLUDED : explicitCode ? CLAUDE_ACCOUNTING_CODE_CHARGE.UNOBSERVABLE : CLAUDE_ACCOUNTING_CODE_CHARGE.ABSENT,
    codeVersion: explicitCode || (included ? CLAUDE_ACCOUNTING_CODE_CALLER : null) });
}
