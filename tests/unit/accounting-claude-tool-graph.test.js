import { describe, expect, it, vi } from 'vitest';
import { createClaudeToolGraph } from 'open-sse/config/accountingClaudeToolGraph.js';
const tools = () => [{ type: 'web_search_20260318', name: 'web_search' }, { type: 'web_fetch_20260318', name: 'web_fetch' }];
const call = (id, name, parent = null) => ({ type: 'server_tool_use', id, name, input: name === 'code_execution' ? { code: 'private source' } : name === 'web_search' ? { query: 'private query' } : { url: 'https://example.com' }, ...(parent ? { caller: { type: 'code_execution_20260120', tool_id: parent } } : {}) });
const result = (id, name, parent = null) => ({ type: `${name}_tool_result`, tool_use_id: id, content: name === 'web_search' ? [] : name === 'web_fetch' ? { type: 'web_fetch_tool_result_error', error_code: 'unavailable' } : { type: 'code_execution_result', stdout: 'private corpus', stderr: '', return_code: 0, content: [] }, ...(parent ? { caller: { type: 'code_execution_20260120', tool_id: parent } } : {}) });
const graph = (definitions = tools()) => { const value = createClaudeToolGraph(definitions); expect(value).not.toBeNull(); return value; };

describe('isolated code-parent/web-child association, not result schema/resource/counter authority', () => {
  it('implicit code parent binds full visible nested search/fetch pairs, no cross-parent completion', () => {
    const value = graph(); expect(value.acceptCall(call('srvtoolu_parent', 'code_execution'))).toBe(true);
    expect(value.acceptCall(call('srvtoolu_search', 'web_search', 'srvtoolu_parent'))).toBe(true);
    expect(value.acceptCall(call('srvtoolu_fetch', 'web_fetch', 'srvtoolu_parent'))).toBe(true);
    expect(value.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(false);
    expect(value.acceptResult(result('srvtoolu_search', 'web_search', 'srvtoolu_parent'))).toBe(true);
    expect(value.acceptResult(result('srvtoolu_fetch', 'web_fetch', 'srvtoolu_parent'))).toBe(true);
    expect(value.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(true); expect(value.pendingCount()).toBe(0); expect(value.canStop('end_turn')).toBe(true);
  });
  it('caller original permissions/defaults and runtime alias are distinct from raw parent IDs', () => {
    const value = graph([{ ...tools()[0], allowed_callers: ['direct', 'code_execution_20260521'] }]);
    expect(value.acceptCall(call('srvtoolu_direct', 'web_search'))).toBe(true); expect(value.acceptResult(result('srvtoolu_direct', 'web_search'))).toBe(true);
    expect(value.acceptCall(call('srvtoolu_code', 'code_execution'))).toBe(true);
    const child = call('srvtoolu_child', 'web_search', 'srvtoolu_code'); child.caller.type = 'code_execution_20260521';
    expect(value.acceptCall(child)).toBe(false); child.caller.type = 'code_execution_20260120'; expect(value.acceptCall(child)).toBe(true);
    const wrong = result('srvtoolu_child', 'web_search', 'srvtoolu_foreign'); expect(value.acceptResult(wrong)).toBe(false);
    expect(value.acceptResult(result('srvtoolu_child', 'web_search', 'srvtoolu_code'))).toBe(true);
    expect(graph().acceptCall(call('srvtoolu_no_direct', 'web_search'))).toBe(false);
  });
  it('suppressed whole pairs are not fabricated uses/sources; visible half-pairs still owe their completion', () => {
    const value = graph([{ ...tools()[0], response_inclusion: 'excluded' }]);
    expect(value.acceptCall(call('srvtoolu_parent', 'code_execution'))).toBe(true);
    expect(value.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(true); expect(value.canStop('end_turn')).toBe(true);
    const partial = graph([{ ...tools()[0], response_inclusion: 'excluded' }]);
    expect(partial.acceptCall(call('srvtoolu_parent', 'code_execution'))).toBe(true); expect(partial.acceptCall(call('srvtoolu_child', 'web_search', 'srvtoolu_parent'))).toBe(true);
    expect(partial.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(false); expect(partial.canStop('end_turn')).toBe(false);
    expect(Object.keys(value)).not.toContain('usage'); expect(Object.keys(value)).not.toContain('documents');
  });
  it('pending pause/client suspension keeps original graph for deferred result; unresolved end and pause+client denied', () => {
    const value = graph(); expect(value.acceptCall(call('srvtoolu_parent', 'code_execution'))).toBe(true);
    expect(value.canStop('pause_turn')).toBe(true); expect(value.canStop('end_turn')).toBe(false);
    expect(value.acceptClientId('toolu_client')).toBe(true); expect(value.canStop('pause_turn')).toBe(false); expect(value.canStop('tool_use')).toBe(true);
    expect(value.acceptClientResult('toolu_client')).toBe(true); expect(value.acceptClientResult('toolu_client')).toBe(false);
    expect(value.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(true); expect(value.canStop('end_turn')).toBe(true);
  });
  it('rejects cycles/future parents/closed parents/duplicate shared IDs and exact result-kind mismatch without consuming pending', () => {
    const value = graph(); expect(value.acceptCall(call('srvtoolu_future', 'web_search', 'srvtoolu_missing'))).toBe(false);
    expect(value.acceptCall(call('srvtoolu_parent', 'code_execution'))).toBe(true); expect(value.acceptClientId('srvtoolu_parent')).toBe(false);
    expect(value.acceptCall(call('srvtoolu_parent', 'web_search', 'srvtoolu_parent'))).toBe(false);
    expect(value.acceptResult(result('srvtoolu_parent', 'web_search'))).toBe(false); expect(value.pendingCount()).toBe(1);
    expect(value.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(true); expect(value.acceptResult(result('srvtoolu_parent', 'code_execution'))).toBe(false);
    expect(value.acceptCall(call('srvtoolu_late', 'web_search', 'srvtoolu_parent'))).toBe(false); expect(value.acceptCall(call('srvtoolu_parent', 'code_execution'))).toBe(false);
  });
  it('implicit code requires code-enabled web caller; original snapshots and independent graph instances cannot share IDs', () => {
    const direct = graph([{ ...tools()[0], allowed_callers: ['direct'] }]);
    expect(direct.acceptCall(call('srvtoolu_unauthorized', 'code_execution'))).toBe(false);
    const original = tools(), value = graph(original); original[0].allowed_callers = ['direct'];
    expect(value.acceptCall(call('srvtoolu_code', 'code_execution'))).toBe(true); expect(value.acceptCall(call('srvtoolu_search', 'web_search', 'srvtoolu_code'))).toBe(true);
    const other = graph(); expect(other.acceptCall(call('srvtoolu_search', 'web_search', 'srvtoolu_code'))).toBe(false);
    expect(other.acceptCall(call('srvtoolu_code', 'code_execution'))).toBe(true); expect(other.acceptResult(result('srvtoolu_code', 'code_execution'))).toBe(true);
    expect(value.pendingCount()).toBe(2); expect(value.canStop('foreign')).toBe(false);
  });
  it('validated original client IDs are opaque nonempty bounded values, not a fabricated provider prefix requirement', () => {
    const value = graph(); expect(value.acceptClientId('use1')).toBe(true); expect(value.acceptClientId('use1')).toBe(false);
    expect(value.acceptClientResult('use1')).toBe(true); expect(value.acceptClientResult('use1')).toBe(false);
    for (const id of ['', null, 1, 'srvtoolu_foreign', 'x'.repeat(262145)]) expect(value.acceptClientId(id)).toBe(false);
    expect(value.canStop('end_turn')).toBe(true);
  });
  it('bounded association state is cumulative even after pairs close; IDs are never recycled', () => {
    const value = graph(); let denied = false;
    for (let i = 0; i <= 10000; i++) {
      const id = `srvtoolu_bound_${i}`;
      if (!value.acceptCall(call(id, 'code_execution'))) { denied = true; break; }
      if (!value.acceptResult(result(id, 'code_execution'))) { denied = true; expect(value.pendingCount()).toBe(1); break; }
    }
    expect(denied).toBe(true); expect(value.acceptCall(call('srvtoolu_bound_0', 'code_execution'))).toBe(false);
  });
  it('association snapshot guards getters/proxies/bounds and does not retain fetched/code corpus', () => {
    const value = graph(), getter = vi.fn(), trap = vi.fn();
    expect(value.acceptCall(Object.defineProperty(call('srvtoolu_getter', 'code_execution'), 'input', { enumerable: true, get: getter }))).toBe(false);
    expect(value.acceptCall(new Proxy(call('srvtoolu_proxy', 'code_execution'), { ownKeys: trap }))).toBe(false); expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(value.acceptCall({ ...call('srvtoolu_huge', 'code_execution'), input: { code: 'x'.repeat(262145) } })).toBe(false);
    expect(value.pendingCount()).toBe(0); expect(JSON.stringify(value)).not.toMatch(/private|corpus|example/);
    expect(createClaudeToolGraph([{ type: 'code_execution_20260120', name: 'code_execution' }])).toBeNull();
  });
});
