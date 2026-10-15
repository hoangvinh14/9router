import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsClaudeDynamicOriginal } from './accountingClaudeDynamicOriginal.js';
import { createClaudeToolGraph, CLAUDE_ACCOUNTING_CODE_SUBTOOLS } from './accountingClaudeToolGraph.js';
import { supportsClaudeCodeCall, supportsClaudeCodeResult } from './accountingClaudeCodeSchema.js';
import { createClaudeServerSearchAuthority, CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME } from './accountingClaudeServerSearch.js';
import { createClaudeServerFetchAuthority, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME } from './accountingClaudeServerFetch.js';
import { captureClaudeCitationDocuments, supportsClaudeDocumentCitation } from './accountingClaudeCitations.js';
import { captureClaudeSearchResults, supportsClaudeSearchCitation } from './accountingClaudeSearchResults.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';

// Stream-local exact original graph/source owner, never provider permission.
export function createClaudeDynamicState(value, model) {
  const original = snapshotAccountingPreparedData(value);
  if (!supportsClaudeDynamicOriginal(original, model)) throw new Error('Invalid Claude dynamic authority');
  const graph = createClaudeToolGraph(original.tools), documents = [], searchResults = [], issued = new Set(), calls = new Map();
  const tools = original.tools.map(tool => [CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME].includes(tool.name) ? { ...tool, allowed_callers: ['direct'] } : tool);
  const search = tools.some(tool => tool.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME) ? createClaudeServerSearchAuthority(tools, issued) : null;
  const fetch = tools.some(tool => tool.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME) ? createClaudeServerFetchAuthority(tools, issued, documents) : null;
  let retained = 0;
  const isCode = name => Object.hasOwn(CLAUDE_ACCOUNTING_CODE_SUBTOOLS, name);
  const resultTypes = [...Object.values(CLAUDE_ACCOUNTING_CODE_SUBTOOLS), CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT, CLAUDE_BLOCK.WEB_FETCH_TOOL_RESULT];
  const state = {
    hasName(name) { return isCode(name) || name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME && !!search || name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME && !!fetch; },
    isResult(type) { return resultTypes.includes(type); },
    acceptCall(value) {
      const block = snapshotAccountingPreparedData(value), { caller: _caller, ...plain } = block;
      if (isCode(block.name)) {
        if (!supportsClaudeCodeCall(block)) return false;
        const size = new TextEncoder().encode(JSON.stringify(block)).byteLength;
        if (retained + size > 262144 || calls.size >= 10000 || !graph.acceptCall(block)) return false;
        retained += size; calls.set(block.id, { block, size }); return true;
      }
      const owner = block.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME ? search : block.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME ? fetch : null;
      return !!owner && graph.acceptCall(block) && owner.acceptCall(plain);
    },
    acceptResult(value) {
      const block = snapshotAccountingPreparedData(value), { caller: _caller, ...plain } = block;
      const call = calls.get(block.tool_use_id);
      if (Object.values(CLAUDE_ACCOUNTING_CODE_SUBTOOLS).includes(block.type)) {
        if (!call || !supportsClaudeCodeResult(call.block, block) || !graph.acceptResult(block)) return false;
        retained -= call.size; calls.delete(block.tool_use_id); return true;
      }
      const owner = block.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT ? search : block.type === CLAUDE_BLOCK.WEB_FETCH_TOOL_RESULT ? fetch : null;
      return !!owner && graph.acceptResult(block) && owner.acceptResult(plain);
    },
    acceptClientId(id) { return graph.acceptClientId(id); },
    canStop(reason) { return graph.canStop(reason); },
    supportsCitation(value) { return supportsClaudeDocumentCitation(value, documents) || supportsClaudeSearchCitation(value, searchResults) || search?.supportsCitation(value); },
    clientNames: new Set(original.tools.filter(tool => !isCode(tool.name) && ![CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME].includes(tool.name)).map(tool => tool.name)),
  };
  for (const message of original.messages) for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block.type === CLAUDE_BLOCK.SERVER_TOOL_USE && !state.acceptCall(block) || state.isResult(block.type) && !state.acceptResult(block) ||
        block.type === CLAUDE_BLOCK.TOOL_USE && !state.acceptClientId(block.id) || block.type === CLAUDE_BLOCK.TOOL_RESULT && !graph.acceptClientResult(block.tool_use_id)) throw new Error('Invalid Claude dynamic authority');
    documents.push(...(captureClaudeCitationDocuments({ messages: [{ content: [block] }] }) || []));
    searchResults.push(...(captureClaudeSearchResults({ messages: [{ content: [block] }] }) || []));
  }
  return state;
}
