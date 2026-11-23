import { BUDGET_REFERENCE_SCOPE } from './constants.js';
import { validatePriceSnapshot } from '../accounting/exact-money.js';

export const CLAUDE_STANDARD_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';

const standardModels = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5': 'Claude Sonnet 5',
};
export const CLAUDE_STANDARD_MODELS = Object.freeze(Object.keys(standardModels));
export const claudeStandardReferenceKey = model => CLAUDE_STANDARD_MODELS.includes(model)
  ? `anthropic:claude/${model}:standard:v1` : null;

export function readClaudeStandardReference(scope, model) {
  const revision = claudeStandardReferenceKey(model);
  if (!revision) return null;
  const row = scope.referencePrice([BUDGET_REFERENCE_SCOPE, revision]);
  try {
    const price = row && validatePriceSnapshot(JSON.parse(row.value));
    if (price?.revision === revision && price.source === CLAUDE_STANDARD_PRICING_URL &&
        Number.isSafeInteger(price.syncedAt) && price.syncedAt > 0 &&
        Object.keys(price.rates).sort().join(',') === 'cache_creation,cache_creation_1h,cached,input,output') return price;
  } catch { /* Missing or malformed snapshots cannot authorize dispatch. */ }
  return null;
}

const columns = ['Model', 'Base input tokens', '5m cache writes', '1h cache writes', 'Cache hits and refreshes', 'Output tokens'];
const rateFields = ['input', 'cache_creation', 'cache_creation_1h', 'cached', 'output'];
function readColumns(line) {
  const trimmed = line?.trim() ?? '';
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim());
}

export function parseClaudeStandardReferences(markdown, syncedAt) {
  const sections = markdown.split(/^##[ \t]+/m).slice(1).filter(section => /^Model pricing[ \t]*\r?\n/.test(section));
  if (sections.length !== 1 || !Number.isSafeInteger(syncedAt) || syncedAt <= 0) {
    throw new Error('Invalid Claude Standard price source');
  }
  const lines = sections[0].split(/\r?\n/);
  const header = lines.findIndex(line => line.trim().startsWith('|'));
  const divider = readColumns(lines[header + 1]);
  if (readColumns(lines[header]).join('|') !== columns.join('|') ||
      divider.length !== columns.length || !divider.every(cell => /^:?-{3,}:?$/.test(cell))) {
    throw new Error('Missing Claude Standard price table');
  }
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    const cells = readColumns(line);
    if (!cells.length) break;
    rows.push(cells);
  }

  return Object.fromEntries(Object.entries(standardModels).map(([model, name]) => {
    const matches = rows.filter(([label]) => label === name);
    if (matches.length !== 1 || matches[0].length !== columns.length) {
      throw new Error('Missing or ambiguous Claude Standard model price');
    }
    const rates = Object.fromEntries(matches[0].slice(1).map((cell, index) => {
      const rate = /^\$(\d+(?:\.\d+)?)\s*\/\s*MTok\s*(?:<sup>\d+<\/sup>)?$/.exec(cell)?.[1];
      if (!rate) throw new Error('Invalid Claude Standard rate');
      return [rateFields[index], rate];
    }));
    const revision = claudeStandardReferenceKey(model);
    return [revision, validatePriceSnapshot({ currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt,
      source: CLAUDE_STANDARD_PRICING_URL, rates })];
  }));
}
