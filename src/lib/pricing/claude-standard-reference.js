import { BUDGET_REFERENCE_SCOPE } from './constants.js';
import { validatePriceSnapshot } from '../accounting/exact-money.js';

export const CLAUDE_STANDARD_PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';

export const claudeStandardReferenceKey = model => /^claude-[a-z]+-\d+(?:-\d+)*$/.test(model)
  ? `anthropic:claude/${model}:standard:v1` : null;

export function claudeModelFromReference(revision) {
  const model = /^anthropic:claude\/(claude-[a-z]+-\d+(?:-\d+)*):standard:v1$/.exec(revision)?.[1];
  return model ?? null;
}

export function readClaudeStandardReference(scope, model) {
  // Pricing names use the family first. Older wire IDs put the version first,
  // and pinned releases keep their date on the wire.
  if (typeof model !== 'string') return null;
  const undated = model.replace(/-\d{8}$/, '');
  const familyFirst = undated.replace(/^claude-(\d+(?:-\d+)*)-([a-z]+)$/, 'claude-$2-$1');
  for (const name of new Set([model, familyFirst])) {
    const revision = claudeStandardReferenceKey(name);
    if (!revision) continue;
    const row = scope.referencePrice([BUDGET_REFERENCE_SCOPE, revision]);
    if (row) return validateReference(row, revision);
  }
  return null;
}

function validateReference(row, revision) {
  try {
    const price = validatePriceSnapshot(JSON.parse(row.value));
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
  const prices = {};
  const bands = new Map();
  for (const line of lines.slice(header + 2)) {
    const cells = readColumns(line);
    if (!cells.length) break;
    const match = /^Claude ([A-Za-z]+) (\d+(?:\.\d+)*)(?: \(\[.*\)| \(for prompts (up to|over) ([0-9,]+) tokens\))?$/.exec(cells[0]);
    if (!match) continue;
    const model = `claude-${match[1].toLowerCase()}-${match[2].replaceAll('.', '-')}`;
    const revision = claudeStandardReferenceKey(model);
    if (cells.length !== columns.length || Object.hasOwn(prices, revision)) {
      throw new Error('Invalid or ambiguous Claude Standard tariff');
    }
    const rates = Object.fromEntries(cells.slice(1).map((cell, index) => {
      const rate = /^\$(\d+(?:\.\d+)?)\s*\/\s*MTok\s*(?:<sup>\d+<\/sup>)?$/.exec(cell)?.[1];
      if (!rate) throw new Error('Invalid Claude Standard rate');
      return [rateFields[index], rate];
    }));
    const price = { currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt,
      source: CLAUDE_STANDARD_PRICING_URL, rates };
    if (!match[3]) {
      if (bands.has(revision)) throw new Error('Ambiguous Claude Standard tariff');
      prices[revision] = validatePriceSnapshot(price);
      continue;
    }
    const threshold = Number(match[4].replaceAll(',', ''));
    const band = bands.get(revision) ?? { threshold };
    if (band.threshold !== threshold || Object.hasOwn(band, match[3])) throw new Error('Ambiguous Claude Standard context band');
    band[match[3]] = price;
    bands.set(revision, band);
  }
  for (const [revision, { threshold, 'up to': base, over }] of bands) {
    if (!base || !over) throw new Error('Incomplete Claude Standard context bands');
    prices[revision] = validatePriceSnapshot({ ...base, inputThreshold: threshold, aboveThresholdRates: over.rates });
  }
  if (!Object.keys(prices).length) throw new Error('Missing Claude Standard tariffs');
  return prices;
}
