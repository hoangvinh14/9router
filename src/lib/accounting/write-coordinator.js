import { snapshotPayload, unavailable } from "./attempt-payload.js";
import { synchronousResult } from "../db/durableFile.js";

export const WRITE_LIMITS = Object.freeze({ groupCount: 32, groupBytes: 256 * 1024, queueCount: 256, queueBytes: 2 * 1024 * 1024, operationBytes: 32 * 1024 });
const coordinators = new WeakMap();
export function stopAccountingWrites(db, reason = unavailable("Accounting storage closing")) { coordinators.get(db)?.stop(reason); }

// One lane per adapter; application callback is module-owned, never queued input.
export function getWriteCoordinator(db, apply) {
  const previous = coordinators.get(db);
  if (previous) return previous;
  let queue = [];
  let bytes = 0;
  let scheduled = false;
  let stopped = false;
  let poisoned = false;
  function detach(entry) { entry.signal?.removeEventListener("abort", entry.abort); }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }
  function flush() {
    scheduled = false;
    if (!queue.length) return;
    const group = [];
    let size = 0;
    while (queue.length && group.length < WRITE_LIMITS.groupCount && size + queue[0].bytes <= WRITE_LIMITS.groupBytes) {
      const entry = queue.shift();
      bytes -= entry.bytes;
      size += entry.bytes;
      detach(entry);
      group.push(entry);
    }
    try {
      if (poisoned || !db.health().healthy) throw unavailable();
      const results = synchronousResult(apply(group.map(entry => entry.command)));
      if (!Array.isArray(results) || results.length !== group.length || results.some(r => !r || typeof r.ok !== "boolean")) throw unavailable("Malformed accounting group acknowledgement");
      for (let i = 0; i < group.length; i++) {
        if (results[i].ok) group[i].resolve(results[i].value);
        else group[i].reject(results[i].error);
      }
    } catch (error) {
      poisoned = true;
      for (const entry of group) entry.reject(error);
      stop(error);
    }
    // Yield between bounded groups; do not monopolize the event loop under load.
    if (queue.length && !scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  }
  function enqueue(input, { signal } = {}) {
    try {
      if (signal?.aborted) throw signal.reason;
      if (stopped || poisoned || !db.health().healthy) throw unavailable();
      const command = snapshotPayload(input);
      const retainedBytes = Buffer.byteLength(JSON.stringify(command)) * 2;
      if (retainedBytes > WRITE_LIMITS.operationBytes || queue.length >= WRITE_LIMITS.queueCount || bytes + retainedBytes > WRITE_LIMITS.queueBytes) throw unavailable("Accounting queue capacity exceeded");
      return new Promise((resolve, reject) => {
        const entry = { command, bytes: retainedBytes, resolve, reject, signal, abort: null };
        entry.abort = () => {
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1);
          bytes -= entry.bytes;
          detach(entry);
          reject(signal.reason);
        };
        queue.push(entry);
        bytes += retainedBytes;
        signal?.addEventListener("abort", entry.abort, { once: true });
        if (signal?.aborted) entry.abort();
        schedule();
      });
    } catch (error) { return Promise.reject(error); }
  }
  function stop(reason = unavailable("Accounting storage closing")) {
    stopped = true;
    for (const entry of queue) {
      detach(entry);
      entry.reject(reason);
    }
    queue = [];
    bytes = 0;
    return Promise.resolve();
  }
  const coordinator = Object.freeze({ enqueue, stop, status: () => ({ stopped, poisoned, queued: queue.length, bytes }) });
  coordinators.set(db, coordinator);
  return coordinator;
}
