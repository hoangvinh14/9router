import { types } from 'node:util';

// Internal primitive ceilings, not queue scheduling/performance tunables.
export const ACCOUNTING_GROUP_MAX_COMMANDS = 32;
export const ACCOUNTING_GROUP_MAX_BYTES = 256 * 1024;
const MAX_NODES = 10000;
const MAX_DEPTH = 16;

// Snapshot plain data without invoking getters, toJSON, iterators or callbacks.
// Structural/size uncertainty refuses the entire batch before opening a write.
export function snapshotAccountingGroup(commands) {
  let bytes = 0, nodes = 0;
  const fail = () => { throw new Error('Accounting group payload unavailable'); };
  const charge = amount => { bytes += amount; if (bytes > ACCOUNTING_GROUP_MAX_BYTES) fail(); };
  // Native Proxy detection does not invoke traps, including revoked Proxies.
  if (types.isProxy(commands) || !Array.isArray(commands) || Object.getPrototypeOf(commands) !== Array.prototype ||
      commands.length < 1 || commands.length > ACCOUNTING_GROUP_MAX_COMMANDS) fail();
  const active = new Set();
  function copy(value, depth, member) {
    if (types.isProxy(value) || ++nodes > MAX_NODES || depth > MAX_DEPTH) fail();
    if (typeof value === 'string') { charge(Buffer.byteLength(value, 'utf8') + 2); return value; }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) { charge(24); return value; }
    if (!value || typeof value !== 'object') { member.invalid = true; return null; }
    if (active.has(value)) fail();
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(value) === null && !array)) fail();
    // Proxy/prototype guards above ensure descriptor traversal cannot invoke
    // user traps. Keep the whole key inventory, without allocating a second
    // descriptor map for every nested object; accessors still fail unread.
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string')) fail();
    const keys = ownKeys.filter(key => !(array && key === 'length'));
    if (keys.length > MAX_NODES || array && keys.length !== value.length) fail();
    active.add(value);
    const result = array ? [] : {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail();
      if (['__proto__', 'constructor', 'prototype'].includes(key) || array && !/^(0|[1-9]\d*)$/.test(key)) fail();
      charge(Buffer.byteLength(key, 'utf8') + 4);
      result[key] = copy(descriptor.value, depth + 1, member);
    }
    active.delete(value);
    return Object.freeze(result);
  }
  const descriptors = Object.getOwnPropertyDescriptors(commands);
  if (Reflect.ownKeys(descriptors).length !== commands.length + 1) fail();
  const result = [];
  for (let index = 0; index < commands.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail();
    const member = { invalid: false };
    const command = copy(descriptor.value, 0, member);
    result.push(member.invalid || !command || Array.isArray(command) ? Object.freeze({ type: 'invalid' }) : command);
  }
  return Object.freeze(result);
}
