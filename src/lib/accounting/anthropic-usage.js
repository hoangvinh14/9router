import { snapshotPayload } from './attempt-payload.js';
import { EXCLUSIVE_USAGE } from './terminal-cost.js';

// First-party Messages API-key usage only; no OAuth/Codex or invoice claim.
// Source: references/anthropic-official-api-research-2026-11-15.md in the budget
// plan. Input counters are exclusive; output includes thinking, so never add
// output_tokens_details or reasoning again. No estimated/canonical analytics.
const valid = count => Number.isSafeInteger(count) && count >= 0;
const category = (name, count) => ({ category: name, count, unit: 'USD/1M tokens' });
const fields = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'cache_creation'];

function snapshot(value) {
  try { return snapshotPayload(value); } catch { return null; }
}
function mapUsage(value) {
  const components = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { semantics: EXCLUSIVE_USAGE, components };
  for (const [field, name] of [['input_tokens', 'input'], ['output_tokens', 'output'], ['cache_read_input_tokens', 'cached']]) {
    if (valid(value[field])) components.push(category(name, value[field]));
  }
  const cache = value.cache_creation;
  const five = cache?.ephemeral_5m_input_tokens;
  const hour = cache?.ephemeral_1h_input_tokens;
  const aggregate = value.cache_creation_input_tokens;
  // A valid aggregate conflict makes both TTL categories uncertain. Do not
  // guess all writes were five-minute or infer omitted TTL as reported zero.
  const conflict = valid(aggregate) && (
    (valid(five) && five > aggregate) || (valid(hour) && hour > aggregate) ||
    (valid(five) && valid(hour) && BigInt(five) + BigInt(hour) !== BigInt(aggregate))
  );
  if (!conflict) {
    if (valid(five)) components.push(category('cache_creation', five));
    if (valid(hour)) components.push(category('cache_creation_1h', hour));
  }
  return { semantics: EXCLUSIVE_USAGE, components };
}

export function anthropicJsonUsage(rawUsage) {
  return mapUsage(snapshot(rawUsage));
}

// Feed ONLY the existing raw response owner's parsed native events. This module
// creates no reader/tee/network/retry. Snapshot updates replace, NEVER add/max.
// Missing delta fields preserve earlier observations; explicit invalid/null
// overwrites that counter as unknown, not zero. Keep input from message_start
// when a malformed later output appears. Terminal cutoff remains owner policy.
export function createAnthropicUsageAccumulator() {
  const latest = Object.create(null);
  let stopped = false;
  let error = false;
  let started = false;
  let delta = false;
  return Object.freeze({
    observe(rawEvent) {
      if (stopped) return;
      const event = snapshot(rawEvent);
      if (!event || typeof event !== 'object') return;
      if (event.type === 'error') { error = true; return; }
      if (event.type === 'message_stop') { stopped = true; return; }
      if (event.type !== 'message_start' && event.type !== 'message_delta') return;
      if (event.type === 'message_start') {
        if (started) { error = true; return; }
        started = true;
      } else {
        if (!started) { error = true; return; }
        delta = true;
      }
      const usage = event.type === 'message_start' ? event.message?.usage : event.usage;
      if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return;
      for (const field of fields) {
        if (!Object.hasOwn(usage, field)) continue;
        if (field === 'cache_creation' && usage[field] && typeof usage[field] === 'object' && !Array.isArray(usage[field])) {
          const previous = latest[field] && typeof latest[field] === 'object' ? latest[field] : {};
          latest[field] = { ...previous, ...usage[field] };
        } else latest[field] = usage[field];
      }
    },
    result() {
      return snapshotPayload({ usage: mapUsage(latest), observedStart: started,
        observedStop: stopped, observedError: error,
        completed: started && delta && stopped && !error });
    },
  });
}
