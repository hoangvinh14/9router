import { describe, expect, it, vi } from 'vitest';
import { supportsClaudeCodeCall, supportsClaudeCodeResult } from 'open-sse/config/accountingClaudeCodeSchema.js';
const call = (name = 'code_execution', input = { code: 'print(1)' }) => ({ type: 'server_tool_use', id: 'srvtoolu_code', name, input });
const result = (content, name = 'code_execution') => ({ type: `${name}_tool_result`, tool_use_id: 'srvtoolu_code', content });
const output = (type = 'code_execution_result') => ({ type, stdout: 'private corpus', stderr: '', return_code: 0, content: [] });
const editor = (command, extra = {}) => call('text_editor_code_execution', { command, path: '/tmp/file', ...extra });
describe('isolated code call/result schema, no duration/count/resource ownership', () => {
  it('validates code and Bash exact input/result schema, preserves opaque output rather than decoding', () => {
    expect(supportsClaudeCodeCall(call())).toBe(true); expect(supportsClaudeCodeResult(call(), result(output()))).toBe(true);
    const bash = call('bash_code_execution', { command: 'python /tmp/file.py' });
    expect(supportsClaudeCodeCall(bash)).toBe(true); expect(supportsClaudeCodeResult(bash, result(output('bash_code_execution_result'), 'bash_code_execution'))).toBe(true);
    const encrypted = output('encrypted_code_execution_result'); delete encrypted.stdout; encrypted.encrypted_stdout = 'opaque encrypted source';
    expect(supportsClaudeCodeResult(call(), result(encrypted))).toBe(true); expect(encrypted.encrypted_stdout).toBe('opaque encrypted source');
  });
  it('text editor view/create/replace require matching operation and bounded typed metadata', () => {
    const view = editor('view'); expect(supportsClaudeCodeCall(view)).toBe(true);
    expect(supportsClaudeCodeResult(view, result({ type: 'text_editor_code_execution_view_result', file_type: 'text', content: 'private content', num_lines: 2, start_line: 1, total_lines: 2 }, view.name))).toBe(true);
    const create = editor('create', { file_text: '' }); expect(supportsClaudeCodeCall(create)).toBe(true);
    expect(supportsClaudeCodeResult(create, result({ type: 'text_editor_code_execution_create_result', is_file_update: false }, create.name))).toBe(true);
    const replace = editor('str_replace', { old_str: 'old', new_str: 'new' }); expect(supportsClaudeCodeCall(replace)).toBe(true);
    expect(supportsClaudeCodeResult(replace, result({ type: 'text_editor_code_execution_str_replace_result', lines: ['- old', '+ new'], old_start: 1, old_lines: 1, new_start: 1, new_lines: 1 }, replace.name))).toBe(true);
    expect(supportsClaudeCodeResult(view, result({ type: 'text_editor_code_execution_create_result', is_file_update: false }, view.name))).toBe(false);
  });
  it('documented errors are typed by subtool, not inferred success or free count', () => {
    for (const code of ['invalid_tool_input', 'unavailable', 'too_many_requests', 'execution_time_exceeded'])
      expect(supportsClaudeCodeResult(call(), result({ type: 'code_execution_tool_result_error', error_code: code }))).toBe(true);
    expect(supportsClaudeCodeResult(editor('view'), result({ type: 'text_editor_code_execution_tool_result_error', error_code: 'file_not_found', error_message: null }, 'text_editor_code_execution'))).toBe(true);
    expect(supportsClaudeCodeResult(call(), result({ type: 'code_execution_tool_result_error', error_code: 'file_not_found' }))).toBe(false);
  });
  it('file outputs stay refused without tenant authority even when their syntax matches SDK', () => {
    const content = output(); content.content.push({ type: 'code_execution_output', file_id: 'file_foreign' });
    expect(supportsClaudeCodeResult(call(), result(content))).toBe(false);
    expect(supportsClaudeCodeResult(call(), result({ ...output(), content: [{ type: 'code_execution_output', file_id: 'file_dummy_owned' }] }))).toBe(false);
  });
  it('unknown fields/IDs/types/inputs and invalid numeric metadata cannot erase original work', () => {
    for (const block of [call('unknown'), call('code_execution', { code: '' }), call('bash_code_execution', { command: 'ok', cwd: '/' }), editor('str_replace', { old_str: '', new_str: 'x' }), { ...call(), id: 'toolu_client' }]) expect(supportsClaudeCodeCall(block)).toBe(false);
    for (const block of [{ ...result(output()), tool_use_id: 'srvtoolu_foreign' }, result({ ...output(), return_code: 0.5 }), result({ ...output(), duration_seconds: 10 }), result({ ...output(), content: null })]) expect(supportsClaudeCodeResult(call(), block)).toBe(false);
  });
  it('optional/null editor metadata and negative command return code remain typed, no derived duration or page semantics', () => {
    const view = editor('view', { view_range: [1, -1] }); expect(supportsClaudeCodeCall(view)).toBe(true);
    expect(supportsClaudeCodeResult(view, result({ type: 'text_editor_code_execution_view_result', file_type: 'text', content: '', num_lines: null, start_line: null, total_lines: null }, view.name))).toBe(true);
    expect(supportsClaudeCodeResult(call(), result({ ...output(), return_code: -1 }))).toBe(true);
    for (const content of [{ type: 'text_editor_code_execution_view_result', file_type: 'pdf', content: 'opaque' }, { type: 'text_editor_code_execution_view_result', file_type: 'text', content: '', num_lines: -1 }])
      expect(supportsClaudeCodeResult(view, result(content, view.name))).toBe(false);
    expect(supportsClaudeCodeCall(editor('view', { view_range: [5, 1] }))).toBe(false);
    expect(supportsClaudeCodeResult(call(), result({ type: 'code_execution_tool_result_error', error_code: 'unknown' }))).toBe(false);
  });
  it('schema validation is immutable and does not replace caller graph or resource binding', () => {
    const original = call(), block = result(output()), retained = structuredClone({ original, block });
    expect(supportsClaudeCodeResult(original, block)).toBe(true); expect({ original, block }).toEqual(retained);
    expect(supportsClaudeCodeCall({ ...original, caller: { type: 'direct' } })).toBe(true);
    expect(supportsClaudeCodeCall({ ...original, caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_foreign' } })).toBe(false);
    expect(supportsClaudeCodeResult(original, { ...block, caller: { type: 'direct' } })).toBe(false);
    expect(supportsClaudeCodeResult(original, { ...block, container: 'container_foreign' })).toBe(false);
    expect(supportsClaudeCodeResult(original, { ...block, content: Object.create(output()) })).toBe(false);
  });
  it('plain bounded input/result guard refuses getters/proxies/oversize before reading corpus', () => {
    const getter = vi.fn(), trapped = vi.fn();
    expect(supportsClaudeCodeCall(Object.defineProperty(call(), 'input', { enumerable: true, get: getter }))).toBe(false);
    expect(supportsClaudeCodeResult(call(), new Proxy(result(output()), { ownKeys: trapped }))).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(trapped).not.toHaveBeenCalled();
    expect(supportsClaudeCodeResult(call(), result({ ...output(), stdout: 'x'.repeat(262145) }))).toBe(false);
  });
});
