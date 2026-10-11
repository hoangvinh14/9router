import { describe, expect, it, vi } from 'vitest';
import { captureAccountingRoutingGraph, assertAccountingRoutingGraphCurrent, ACCOUNTED_ROUTING_GRAPH_LIMIT } from '@/lib/apiKeyBudget/accountingRoutingGraph.js';
const leaf = model => ({ id: model, kind: 'leaf', provider: 'openai', model, evidence: { alias: model } });
const options = nodes => ({ resolve: vi.fn(async token => nodes[token] || leaf(token)), gate: vi.fn() });
describe('operator-approved bounded immutable routing expansion, unwired authority seam', () => {
  it('counts panel/judge/every possible regeneration without changing fanout', async () => {
    const o = options({ outer: { id: 'outer', kind: 'fusion', models: ['a', 'b'], judge: 'j', evidence: {} } });
    const graph = await captureAccountingRoutingGraph('outer', o);
    expect(graph.count).toBe(6);
    expect(graph.occurrences[graph.rootIndex].children.map(i => [graph.occurrences[i].token, graph.occurrences[i].role])).toEqual([['a', 'panel'], ['b', 'panel'], ['j', 'judge'], ['a', 'regeneration'], ['b', 'regeneration']]);
    await expect(assertAccountingRoutingGraphCurrent(graph, 'outer', o)).resolves.toEqual(graph);
    expect(Object.isFrozen(graph)).toBe(true); expect(Object.isFrozen(graph.occurrences[0].node)).toBe(true);
  });
  it('counts shared siblings separately and includes capacity/fallback candidates', async () => {
    const o = options({ outer: { id: 'outer', kind: 'fallback', models: ['shared', 'shared'], evidence: { capacity: ['a'] } },
      shared: { id: 'shared', kind: 'fallback', models: ['a', 'b'], evidence: {} } });
    expect((await captureAccountingRoutingGraph('outer', o)).count).toBe(7);
  });
  it('accepts exactly64 and stops before resolving occurrence65', async () => {
    expect(ACCOUNTED_ROUTING_GRAPH_LIMIT).toBe(64);
    const nodes = { outer: { id: 'outer', kind: 'fallback', models: Array.from({ length: 63 }, (_, i) => 'm' + i), evidence: {} } };
    const o = options(nodes); expect((await captureAccountingRoutingGraph('outer', o)).count).toBe(64);
    nodes.outer.models.push('extra'); o.resolve.mockClear();
    await expect(captureAccountingRoutingGraph('outer', o)).rejects.toThrow('Accounting routing graph unavailable');
    expect(o.resolve).toHaveBeenCalledTimes(64);
  });
  it.each(['fallback', 'fusion'])('refuses canonical cycle in %s before recursive work', async kind => {
    const o = options({ outer: { id: 'canonical', kind, models: ['alias', 'b'], ...(kind === 'fusion' ? { judge: 'j' } : {}), evidence: {} },
      alias: { id: 'canonical', kind: 'fallback', models: ['a'], evidence: {} } });
    await expect(captureAccountingRoutingGraph('outer', o)).rejects.toThrow('Accounting routing graph unavailable');
    expect(o.resolve).toHaveBeenCalledTimes(2);
  });
  it('retains depth16 and refuses depth17 independently of count', async () => {
    const nodes = Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['c' + i, { id: 'c' + i, kind: 'fallback', models: [i === 15 ? 'leaf' : 'c' + (i + 1)], evidence: {} }]));
    expect((await captureAccountingRoutingGraph('c0', options(nodes))).count).toBe(17);
    nodes.c15.models = ['c16']; nodes.c16 = { id: 'c16', kind: 'fallback', models: ['leaf'], evidence: {} };
    await expect(captureAccountingRoutingGraph('c0', options(nodes))).rejects.toThrow('Accounting routing graph unavailable');
  });
  it.each(['models', 'judge', 'evidence'])('refuses fresh %s drift without rebuilding original', async field => {
    const nodes = { outer: { id: 'outer', kind: 'fusion', models: ['a', 'b'], judge: 'j', evidence: { revision: 1 } } };
    const o = options(nodes), graph = await captureAccountingRoutingGraph('outer', o);
    if (field === 'models') nodes.outer.models.push('c');
    else if (field === 'judge') nodes.outer.judge = 'new-j';
    else nodes.outer.evidence.revision = 2;
    await expect(assertAccountingRoutingGraphCurrent(graph, 'outer', o)).rejects.toThrow('Accounting routing graph unavailable');
    expect(graph.count).toBe(6); expect(graph.occurrences[0].node.models).toEqual(['a', 'b']); expect(graph.occurrences[0].node.judge).toBe('j');
  });
  it('gates before and after resolver awaits', async () => {
    const reason = new Error('fixture fresh gate refused'); let resolved = false;
    const o = { resolve: vi.fn(async token => { resolved = true; return leaf(token); }), gate: vi.fn(() => { if (resolved) throw reason; }) };
    await expect(captureAccountingRoutingGraph('a', o)).rejects.toBe(reason); expect(o.resolve).toHaveBeenCalledTimes(1);
  });
  it('refuses accessor result without invoking it', async () => {
    let reads = 0; const node = leaf('a'); Object.defineProperty(node, 'model', { enumerable: true, get() { reads++; return 'a'; } });
    await expect(captureAccountingRoutingGraph('a', { resolve: async () => node, gate() {} })).rejects.toThrow(); expect(reads).toBe(0);
  });
});
