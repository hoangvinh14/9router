// Keep provider-signed blocks in process memory. All tool IDs from one assistant
// turn reference the same immutable snapshot and expire or evict together.
import { canonical, unavailable } from './attempt-payload.js';

export function createClaudeToolStore({ now = () => Date.now(), ttl = 30 * 60_000, maxBytes = 8 * 1024 * 1024, maxTurns = 512 } = {}) {
  const turns = new Set();
  const byId = new Map();
  let bytes = 0;
  const key = (scope, id) => canonical([...scope, id]);
  function remove(turn) {
    turns.delete(turn);
    for (const id of turn.keys) byId.delete(id);
    bytes -= turn.size;
  }
  function expire() {
    for (const turn of turns) {
      if (turn.until > now()) break;
      remove(turn);
    }
  }
  return Object.freeze({
    save(scope, blocks) {
      const calls = blocks.filter(b => b.type === 'tool_use');
      if (!calls.length) return;
      expire();
      const keys = calls.map(call => key(scope, call.id));
      const collisions = new Set(keys.map(k => byId.get(k)).filter(Boolean));
      if (collisions.size || new Set(keys).size !== keys.length) {
        for (const previous of collisions) remove(previous);
        throw unavailable();
      }
      const json = JSON.stringify(blocks);
      const size = Buffer.byteLength(json) + keys.reduce((n, k) => n + Buffer.byteLength(k), 0);
      if (size > maxBytes) throw unavailable();
      while (turns.size >= maxTurns || bytes + size > maxBytes) remove(turns.values().next().value);
      const turn = { json, keys, size, until: now() + ttl };
      turns.add(turn);
      bytes += size;
      for (const k of keys) byId.set(k, turn);
    },
    restore(scope, calls) {
      expire();
      if (!calls.length) throw unavailable();
      const turn = byId.get(key(scope, calls[0].id));
      if (!turn) throw unavailable();
      const blocks = JSON.parse(turn.json);
      const expected = blocks.filter(b => b.type === 'tool_use').map(({ id, name, input }) => ({ id, name, input }));
      if (canonical(calls) !== canonical(expected)) throw unavailable();
      return blocks;
    },
  });
}

export const claudeToolStore = createClaudeToolStore();
