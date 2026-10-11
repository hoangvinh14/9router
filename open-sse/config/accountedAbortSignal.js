import { types } from 'node:util';

const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const protectedFields = Object.freeze(['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener']);

// Validate the owner handle without invoking caller-provided getters/methods.
// This is a native brand/prototype boundary, not a same-process sandbox.
export function captureAccountingAbortSignal(value) {
  if (value === undefined || value === null) return value;
  const unavailable = () => { throw new Error('Accounting AbortSignal unavailable'); };
  if (typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== AbortSignal.prototype) unavailable();
  for (const key of protectedFields) if (Object.getOwnPropertyDescriptor(value, key)) unavailable();
  try { nativeAborted.call(value); } catch { unavailable(); }
  return value;
}
