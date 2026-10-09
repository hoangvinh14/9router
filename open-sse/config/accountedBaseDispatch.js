import { types } from 'node:util';
import { validateAccountingBaseTransport } from './accountedBaseTransport.js';
import { validateAccountingRuntimeTransport } from './accountedRuntimeTransport.js';

const unavailable = () => { throw new Error('Accounting Base transport unavailable'); };
// Bounded internal equality data only; never callbacks, routing permission,
// environment writes or ledger material. Refuse programmable objects before
// introspection, including nested/revoked proxies and accessor descriptors.
export function snapshotAccountingPreparedData(value) {
  let nodes = 0, bytes = 0;
  const seen = new Set();
  const copy = (input, depth = 0) => {
    if (++nodes > 10000 || depth > 16) unavailable();
    if (input === null || typeof input === 'boolean') { bytes += 5; if (bytes > 262144) unavailable(); return input; }
    if (typeof input === 'string') { bytes += Buffer.byteLength(input, 'utf8') + 2; if (bytes > 262144) unavailable(); return input; }
    if (typeof input === 'number' && Number.isFinite(input)) { bytes += 32; if (bytes > 262144) unavailable(); return input; }
    if (!input || typeof input !== 'object' || types.isProxy(input) || seen.has(input)) unavailable();
    const array = Array.isArray(input);
    if (Object.getPrototypeOf(input) !== (array ? Array.prototype : Object.prototype)) unavailable();
    seen.add(input); const result = array ? [] : {};
    for (const key of Reflect.ownKeys(input)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || (array && !/^(0|[1-9][0-9]*)$/.test(key))) unavailable();
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) unavailable();
      bytes += Buffer.byteLength(key, 'utf8') + 4; if (bytes > 262144) unavailable();
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    if (array && (result.length !== input.length || Object.keys(result).length !== result.length)) unavailable();
    seen.delete(input); return Object.freeze(result);
  };
  return copy(value);
}

export function snapshotAccountingBaseDispatch(value) {
  const result = snapshotAccountingPreparedData(value);
  if (!result || Array.isArray(result) || Reflect.ownKeys(result).length !== 4 ||
      !['provider', 'baseTransport', 'urlIndex', 'runtimeTransport'].every(key => Object.hasOwn(result, key)) ||
      typeof result.provider !== 'string' || !['openai', 'deepseek'].includes(result.provider)) unavailable();
  return result;
}

export function validateAccountingBaseDispatch(evidence, url) {
  const original = snapshotAccountingBaseDispatch(evidence);
  validateAccountingRuntimeTransport(original.provider, original.runtimeTransport, url);
  validateAccountingBaseTransport(original.provider, original.baseTransport, url, original.urlIndex, original.runtimeTransport);
  return original;
}
