import { applyAccountingGroupSync } from '../db/repos/apiKeyAccountingRepo.js';
import { snapshotAccountingGroup, ACCOUNTING_GROUP_MAX_COMMANDS, ACCOUNTING_GROUP_MAX_BYTES } from '../db/accountingGroupPayload.js';
import { synchronousResult } from '../db/durableFile.js';

// Provisional hard memory ceilings, NOT benchmark-tuned queue latency settings.
const MAX_QUEUED_COMMANDS = 128;
const MAX_QUEUED_BYTES = 1024 * 1024;
const writers = global.__accountingWriteCoordinators ??= new WeakMap();
const unavailable = () => new Error('Accounting write queue unavailable');

// Matches snapshotAccountingGroup's conservative byte charges on detached data.
function payloadBytes(value) {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 2;
  if (value === null || typeof value !== 'object') return 24;
  return Object.keys(value).reduce((sum, key) => sum + Buffer.byteLength(key, 'utf8') + 4 + payloadBytes(value[key]), 0);
}

// Internal typed queue foundation only. Does NOT authorize inference. Until
// service/caller fresh-authority integration is proved, no inference uses this.
// Never accepts arbitrary transaction callbacks, SQL or asynchronously applied work.
export function getAccountingWriteCoordinator(db, { apply = applyAccountingGroupSync } = {}) {
  if (!db || typeof db !== 'object' || typeof db.health !== 'function' || typeof apply !== 'function') throw unavailable();
  const existing = writers.get(db);
  if (existing) return existing;
  const queue = [];
  let bytes = 0, scheduled = false, stopped = false;
  const drainWaiters = [];
  function settled() {
    if (!queue.length && !scheduled) while (drainWaiters.length) drainWaiters.shift()();
  }
  function detach(entry) { entry.signal?.removeEventListener('abort', entry.abort); }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // Same-turn coalescing only: no timer wait for a full batch at low traffic.
    queueMicrotask(flush);
  }
  function flush() {
    scheduled = false;
    while (queue.length) {
      const group = []; let groupBytes = 0;
      while (queue.length && group.length < ACCOUNTING_GROUP_MAX_COMMANDS &&
          groupBytes + queue[0].bytes <= ACCOUNTING_GROUP_MAX_BYTES) {
        const entry = queue.shift(); bytes -= entry.bytes; groupBytes += entry.bytes;
        entry.writing = true; detach(entry); group.push(entry);
      }
      // A single entry was bounded before admission; failure is internal, not
      // permission to replay or wait indefinitely for different group sizing.
      if (!group.length) {
        const entry = queue.shift(); bytes -= entry.bytes; detach(entry); entry.reject(unavailable()); continue;
      }
      try {
        if (!db.health().healthy) throw unavailable();
        const results = synchronousResult(apply(db, group.map(entry => entry.command)));
        if (!Array.isArray(results) || results.length !== group.length || results.some(r => !r || typeof r.ok !== 'boolean')) throw unavailable();
        // apply returns only after own durable group ACK. No result from a
        // throwing/malformed group is delivered, even if installed rows exist.
        for (let index = 0; index < group.length; index++) {
          const result = results[index];
          if (result.ok) group[index].resolve(result.value);
          else group[index].reject(result.error);
        }
      } catch (error) { for (const entry of group) entry.reject(error); }
    }
    settled();
  }
  function enqueue(command, { signal = null } = {}) {
    try {
      if (stopped || signal?.aborted) throw signal?.aborted ? signal.reason : unavailable();
      const prepared = snapshotAccountingGroup([command])[0], size = payloadBytes(prepared);
      if (size > ACCOUNTING_GROUP_MAX_BYTES || queue.length >= MAX_QUEUED_COMMANDS || bytes + size > MAX_QUEUED_BYTES) throw unavailable();
      return new Promise((resolve, reject) => {
        const entry = { command: prepared, bytes: size, resolve, reject, signal, writing: false, abort: null };
        entry.abort = () => {
          if (entry.writing) return; // A recorded result cannot be erased by abort.
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1); bytes -= entry.bytes; detach(entry); reject(signal.reason);
        };
        queue.push(entry); bytes += size;
        signal?.addEventListener('abort', entry.abort, { once: true });
        if (signal?.aborted) entry.abort();
        schedule();
      });
    } catch (error) { return Promise.reject(error); }
  }
  function stop() {
    stopped = true;
    if (!queue.length && !scheduled) return Promise.resolve();
    return new Promise(resolve => { drainWaiters.push(resolve); schedule(); });
  }
  const coordinator = Object.freeze({ enqueue, stop });
  writers.set(db, coordinator);
  return coordinator;
}
