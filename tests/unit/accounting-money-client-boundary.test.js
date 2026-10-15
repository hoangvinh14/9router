import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Deterministic relative static import graph, not a Next build substitute.
function relativeGraph(entry) {
  const seen = new Set(), imports = [];
  function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"]([^'"]+)['"]/g)) {
      const specifier = match[1]; imports.push({ file: path.relative(root, file), specifier });
      if (specifier.startsWith('.')) walk(path.resolve(path.dirname(file), specifier));
    }
  }
  walk(path.resolve(root, entry));
  return { files: [...seen].map(file => path.relative(root, file)), imports };
}

describe('client monetary validation boundary', () => {
  it.each(['src/shared/utils/pricingDraft.js', 'src/shared/utils/budgetManagementDraft.js'])('%s does not pull server monetary/proxy/transport owners', entry => {
    const graph = relativeGraph(entry);
    expect(graph.imports.filter(({ specifier }) => specifier.startsWith('node:'))).toEqual([]);
    expect(graph.files.filter(file => /(?:pricing\/money\.js|accountingEmbeddedTools|accountedBaseDispatch|accountedRuntimeTransport|accountedBaseTransport)/.test(file))).toEqual([]);
  });
  it('legacy public monetary exports still resolve through the server kernel', async () => {
    const money = await import('@/lib/pricing/money.js');
    expect(money.validateRate('0.000000001')).toBe('0.000000001');
    expect(money.decimalToNanoUsd('0.0028')).toBe('2800000');
    expect(money.nanoUsdToDecimal('2800000')).toBe('0.0028');
  });
});
