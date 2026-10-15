import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { CLAUDE_ACCOUNTING_CODE_NAME, CLAUDE_ACCOUNTING_DIRECT_CALLER } from './accountingClaudeCodeRegime.js';
import { CLAUDE_ACCOUNTING_CODE_SUBTOOLS } from './accountingClaudeToolGraph.js';

// Whole-block schema prerequisite only. No raw quantities, duration, container
// provenance, file permissions or provider admission are established here.
export const CLAUDE_ACCOUNTING_CODE_RESULT = Object.freeze({
  CODE: 'code_execution_result', ENCRYPTED: 'encrypted_code_execution_result', BASH: 'bash_code_execution_result',
  VIEW: 'text_editor_code_execution_view_result', CREATE: 'text_editor_code_execution_create_result', REPLACE: 'text_editor_code_execution_str_replace_result',
});
export const CLAUDE_ACCOUNTING_CODE_ERROR = Object.freeze({
  CODE: 'code_execution_tool_result_error', BASH: 'bash_code_execution_tool_result_error', EDITOR: 'text_editor_code_execution_tool_result_error',
});
const COMMON_ERRORS = Object.freeze(['invalid_tool_input', 'unavailable', 'too_many_requests', 'execution_time_exceeded']);
const EDITOR = 'text_editor_code_execution', BASH = 'bash_code_execution';
const COMMAND = Object.freeze({ VIEW: 'view', CREATE: 'create', REPLACE: 'str_replace' });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const shape = (value, fields, required = fields) => object(value) && Object.keys(value).every(key => fields.includes(key)) && required.every(key => Object.hasOwn(value, key));
const text = value => typeof value === 'string';
const nonempty = value => text(value) && value.length > 0;
const integer = value => Number.isSafeInteger(value);
const nullableNumber = (value, min) => value === undefined || value === null || integer(value) && value >= min;
function validCall(block) {
  if (!shape(block, ['type', 'id', 'name', 'input', 'caller'], ['type', 'id', 'name', 'input']) || block.type !== CLAUDE_BLOCK.SERVER_TOOL_USE ||
      !nonempty(block.id) || !/^srvtoolu_[a-zA-Z0-9_]+$/.test(block.id) || !Object.hasOwn(CLAUDE_ACCOUNTING_CODE_SUBTOOLS, block.name) ||
      block.caller !== undefined && (!shape(block.caller, ['type']) || block.caller.type !== CLAUDE_ACCOUNTING_DIRECT_CALLER)) return false;
  const input = block.input;
  if (block.name === CLAUDE_ACCOUNTING_CODE_NAME) return shape(input, ['code']) && nonempty(input.code);
  if (block.name === BASH) return shape(input, ['command']) && nonempty(input.command);
  if (block.name !== EDITOR || !object(input) || !nonempty(input.path) || /[\u0000]/.test(input.path)) return false;
  if (input.command === COMMAND.VIEW) return shape(input, ['command', 'path', 'view_range'], ['command', 'path']) &&
    (input.view_range === undefined || Array.isArray(input.view_range) && input.view_range.length === 2 && integer(input.view_range[0]) && input.view_range[0] >= 1 &&
      integer(input.view_range[1]) && (input.view_range[1] === -1 || input.view_range[1] >= input.view_range[0]));
  if (input.command === COMMAND.CREATE) return shape(input, ['command', 'path', 'file_text']) && text(input.file_text);
  return input.command === COMMAND.REPLACE && shape(input, ['command', 'path', 'old_str', 'new_str']) && nonempty(input.old_str) && text(input.new_str);
}
export function supportsClaudeCodeCall(value) {
  try { return validCall(snapshotAccountingPreparedData(value)); } catch { return false; }
}
function error(call, content) {
  const type = call.name === CLAUDE_ACCOUNTING_CODE_NAME ? CLAUDE_ACCOUNTING_CODE_ERROR.CODE : call.name === BASH ? CLAUDE_ACCOUNTING_CODE_ERROR.BASH : CLAUDE_ACCOUNTING_CODE_ERROR.EDITOR;
  const extra = call.name === BASH ? ['output_file_too_large'] : call.name === EDITOR ? ['file_not_found'] : [];
  return shape(content, call.name === EDITOR ? ['type', 'error_code', 'error_message'] : ['type', 'error_code'], ['type', 'error_code']) &&
    content.type === type && [...COMMON_ERRORS, ...extra].includes(content.error_code) &&
    (content.error_message === undefined || content.error_message === null || text(content.error_message));
}
function output(call, content) {
  const encrypted = call.name === CLAUDE_ACCOUNTING_CODE_NAME && content.type === CLAUDE_ACCOUNTING_CODE_RESULT.ENCRYPTED;
  const expected = call.name === CLAUDE_ACCOUNTING_CODE_NAME ? CLAUDE_ACCOUNTING_CODE_RESULT.CODE : CLAUDE_ACCOUNTING_CODE_RESULT.BASH;
  if (content.type !== (encrypted ? CLAUDE_ACCOUNTING_CODE_RESULT.ENCRYPTED : expected) ||
      !shape(content, ['type', encrypted ? 'encrypted_stdout' : 'stdout', 'stderr', 'return_code', 'content']) ||
      !(encrypted ? nonempty(content.encrypted_stdout) : text(content.stdout)) || !text(content.stderr) || !integer(content.return_code)) return false;
  // Even syntactically valid generated IDs require a separate durable issuing
  // key/attempt/workspace binding. Empty output list is not fabricated ownership.
  return Array.isArray(content.content) && content.content.length === 0;
}
function editor(call, content) {
  if (call.input.command === COMMAND.CREATE) return shape(content, ['type', 'is_file_update']) &&
    content.type === CLAUDE_ACCOUNTING_CODE_RESULT.CREATE && typeof content.is_file_update === 'boolean';
  if (call.input.command === COMMAND.VIEW) return shape(content, ['type', 'file_type', 'content', 'num_lines', 'start_line', 'total_lines'], ['type', 'file_type', 'content']) &&
    content.type === CLAUDE_ACCOUNTING_CODE_RESULT.VIEW && content.file_type === 'text' && text(content.content) &&
    nullableNumber(content.num_lines, 0) && nullableNumber(content.start_line, 1) && nullableNumber(content.total_lines, 0);
  return call.input.command === COMMAND.REPLACE && shape(content, ['type', 'lines', 'old_start', 'old_lines', 'new_start', 'new_lines'], ['type']) &&
    content.type === CLAUDE_ACCOUNTING_CODE_RESULT.REPLACE && (content.lines === undefined || content.lines === null || Array.isArray(content.lines) && content.lines.every(text)) &&
    ['old_start', 'new_start'].every(key => nullableNumber(content[key], 1)) && ['old_lines', 'new_lines'].every(key => nullableNumber(content[key], 0));
}
export function supportsClaudeCodeResult(originalCall, value) {
  try {
    const call = snapshotAccountingPreparedData(originalCall), block = snapshotAccountingPreparedData(value);
    if (!validCall(call) || !shape(block, ['type', 'tool_use_id', 'content']) || block.tool_use_id !== call.id ||
        block.type !== CLAUDE_ACCOUNTING_CODE_SUBTOOLS[call.name] || !object(block.content)) return false;
    return error(call, block.content) || (call.name === EDITOR ? editor(call, block.content) : output(call, block.content));
  } catch { return false; }
}
