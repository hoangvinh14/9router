import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsAnthropicLiveRequest } from './accountedAnthropicCandidate.js';
import { captureClaudeCodeRegime, CLAUDE_ACCOUNTING_CODE_CHARGE, CLAUDE_ACCOUNTING_CODE_NAME } from './accountingClaudeCodeRegime.js';
import { createClaudeToolGraph, CLAUDE_ACCOUNTING_CODE_SUBTOOLS } from './accountingClaudeToolGraph.js';
import { supportsClaudeCodeCall, supportsClaudeCodeResult } from './accountingClaudeCodeSchema.js';
import { createClaudeServerSearchAuthority, CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_SEARCH_PAUSE } from './accountingClaudeServerSearch.js';
import { createClaudeServerFetchAuthority, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME } from './accountingClaudeServerFetch.js';
import { captureClaudeCitationDocuments, supportsClaudeDocumentCitation } from './accountingClaudeCitations.js';
import { captureClaudeSearchResults, supportsClaudeSearchCitation } from './accountingClaudeSearchResults.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { ROLE } from '../translator/schema/roles.js';
import { CLAUDE_STOP } from '../translator/schema/finishReasons.js';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const WEB_NAMES = [CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME, CLAUDE_ACCOUNTING_SERVER_FETCH_NAME];
const CODE_RESULTS = Object.values(CLAUDE_ACCOUNTING_CODE_SUBTOOLS);
// Full bounded original validation prerequisite only. No provider/SSE caller
// opts in. Validation projections never replace the original wire; each omitted
// server/citation field has a separate exact schema and association check.
export function supportsClaudeDynamicOriginal(value, model) {
  try {
    const body = snapshotAccountingPreparedData(value);
    if (!object(body) || body.model !== model || !Array.isArray(body.tools) || !Array.isArray(body.messages) ||
        captureClaudeCodeRegime(body.tools).codeCharge !== CLAUDE_ACCOUNTING_CODE_CHARGE.INCLUDED) return false;
    const graph = createClaudeToolGraph(body.tools);
    if (!graph) return false;
    // Full tool grammar is checked by the original regime. This local direct
    // view only reuses existing request/cache/client validation, never POSTs.
    const directTools = body.tools.map(tool => tool.name === CLAUDE_ACCOUNTING_CODE_NAME
      ? { name: tool.name, input_schema: { type: 'object' }, ...(tool.cache_control ? { cache_control: tool.cache_control } : {}) }
      : WEB_NAMES.includes(tool.name) ? { ...tool, allowed_callers: ['direct'] } : tool);
    const documents = [], searchResults = [], issued = new Set(), codeCalls = new Map();
    const search = directTools.some(tool => tool.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME) ? createClaudeServerSearchAuthority(directTools, issued) : null;
    const fetch = directTools.some(tool => tool.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME) ? createClaudeServerFetchAuthority(directTools, issued, documents) : null;
    const projectedMessages = [];
    for (const message of body.messages) {
      if (!object(message) || ![ROLE.USER, ROLE.ASSISTANT].includes(message.role)) return false;
      if (typeof message.content === 'string') { projectedMessages.push(message); continue; }
      if (!Array.isArray(message.content)) return false;
      const content = [];
      for (const block of message.content) {
        if (!object(block)) return false;
        if (block.type === CLAUDE_BLOCK.SERVER_TOOL_USE) {
          if (message.role !== ROLE.ASSISTANT || !graph.acceptCall(block)) return false;
          const { caller: _caller, ...plain } = block;
          if (Object.hasOwn(CLAUDE_ACCOUNTING_CODE_SUBTOOLS, block.name)) {
            if (!supportsClaudeCodeCall(block)) return false;
            codeCalls.set(block.id, block);
          } else {
            const owner = block.name === CLAUDE_ACCOUNTING_SERVER_SEARCH_NAME ? search : block.name === CLAUDE_ACCOUNTING_SERVER_FETCH_NAME ? fetch : null;
            if (!owner?.acceptCall(plain)) return false;
          }
          content.push({ type: CLAUDE_BLOCK.TEXT, text: '[validated server call]' }); continue;
        }
        if ([CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT, CLAUDE_BLOCK.WEB_FETCH_TOOL_RESULT, ...CODE_RESULTS].includes(block.type)) {
          if (message.role !== ROLE.ASSISTANT) return false;
          const { caller: _caller, ...plain } = block;
          if (CODE_RESULTS.includes(block.type)) {
            const call = codeCalls.get(block.tool_use_id);
            if (!call || !supportsClaudeCodeResult(call, block)) return false;
          } else {
            const owner = block.type === CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT ? search : fetch;
            if (!owner?.acceptResult(plain)) return false;
          }
          if (!graph.acceptResult(block)) return false;
          codeCalls.delete(block.tool_use_id);
          content.push({ type: CLAUDE_BLOCK.TEXT, text: '[validated server result]' }); continue;
        }
        if (block.type === CLAUDE_BLOCK.TEXT && Object.hasOwn(block, 'citations')) {
          if (message.role !== ROLE.ASSISTANT || typeof block.text !== 'string' || Object.keys(block).some(key => !['type', 'text', 'citations'].includes(key)) ||
              !Array.isArray(block.citations) || !block.citations.every(citation => supportsClaudeDocumentCitation(citation, documents) ||
                supportsClaudeSearchCitation(citation, searchResults) || search?.supportsCitation(citation))) return false;
          content.push({ type: CLAUDE_BLOCK.TEXT, text: block.text }); continue;
        }
        if (block.type === CLAUDE_BLOCK.TOOL_USE && !graph.acceptClientId(block.id) ||
            block.type === CLAUDE_BLOCK.TOOL_RESULT && !graph.acceptClientResult(block.tool_use_id)) return false;
        documents.push(...(captureClaudeCitationDocuments({ messages: [{ content: [block] }] }) || []));
        searchResults.push(...(captureClaudeSearchResults({ messages: [{ content: [block] }] }) || []));
        content.push(block);
      }
      projectedMessages.push({ ...message, content });
    }
    if (documents.some(document => document.enabled) && documents.some(document => !document.enabled)) return false;
    // PTC force/parallel/client-caller schemas and container tenancy are separate
    // still-open obligations. Never erase those requested fields here.
    if (body.tool_choice && (body.tool_choice.type !== 'auto' && body.tool_choice.type !== 'none' || body.tool_choice.disable_parallel_tool_use === true)) return false;
    if (!graph.canStop(CLAUDE_STOP.END_TURN) && !graph.canStop(CLAUDE_ACCOUNTING_SERVER_SEARCH_PAUSE)) return false;
    return supportsAnthropicLiveRequest({ ...body, tools: directTools, messages: projectedMessages }, model, true, true, true, true, true, true, true, true, true);
  } catch { return false; }
}
