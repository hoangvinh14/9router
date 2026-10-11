import { types } from 'node:util';
import { QODER_ACCOUNTING_ENVELOPE_LIMITS as LIMITS, QODER_ACCOUNTING_ENVELOPE_FIELDS as FIELDS,
  QODER_ACCOUNTING_STATUS_MIN, QODER_ACCOUNTING_STATUS_MAX, QODER_ACCOUNTING_RAW_DONE } from '../config/accountingQoderEnvelope.js';

const unavailable = () => { throw new Error('Invalid raw Qoder accounting envelope'); };
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;
const intrinsicSet = Uint8Array.prototype.set;

// Selected flat outer JSON grammar: reject decoded duplicate keys BEFORE
// assignment. Parse only individual strings/numbers; body contents stay opaque.
function parseEnvelope(text) {
  let offset = 0;
  const result = Object.create(null);
  const whitespace = () => { while (offset < text.length && /[ \t\r\n]/u.test(text[offset])) offset++; };
  const string = () => {
    if (text[offset] !== '"') unavailable();
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '\\') { if (offset >= text.length) unavailable(); offset++; }
      else if (character === '"') {
        try { return JSON.parse(text.slice(start, offset)); } catch { unavailable(); }
      }
    }
    unavailable();
  };
  whitespace(); if (text[offset++] !== '{') unavailable();
  for (let count = 0; count < FIELDS.length; count++) {
    whitespace(); const key = string();
    if (!FIELDS.includes(key) || Object.hasOwn(result, key)) unavailable();
    whitespace(); if (text[offset++] !== ':') unavailable(); whitespace();
    if (text[offset] === '"') result[key] = string();
    else {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(offset));
      if (!match) unavailable();
      try { result[key] = JSON.parse(match[0]); } catch { unavailable(); }
      offset += match[0].length;
    }
    whitespace(); const separator = text[offset++];
    if (separator === '}') { whitespace(); if (offset !== text.length) unavailable(); return result; }
    if (separator !== ',') unavailable();
  }
  unavailable();
}

// Retains opaque raw body strings. No callbacks, normalization, synthetic DONE,
// usage/terminal claims, owner provenance, delivered ACK or retry permission.
export function createQoderAccountingEnvelopeReader(options = {}) {
  if (!options || types.isProxy(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) unavailable();
  const selected = { ...LIMITS };
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (typeof key !== 'string' || !Object.hasOwn(LIMITS, key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
        !Number.isSafeInteger(descriptor.value) || descriptor.value < 1 || descriptor.value > LIMITS[key]) unavailable();
    selected[key] = descriptor.value;
  }
  let buffer = new Uint8Array(Math.min(4096, selected.maxEventBytes)), length = 0, eventBytes = 0, totalBytes = 0;
  let cr = false, data = null, done = false, ended = false, invalid = false;
  const records = [], decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  function dispatch() {
    if (data !== null) {
      if (done || records.length >= selected.maxRecords) unavailable();
      if (data === QODER_ACCOUNTING_RAW_DONE) { records.push(Object.freeze({ kind: 'done' })); done = true; }
      else {
        const value = parseEnvelope(data);
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== FIELDS.length || !FIELDS.every(key => Object.hasOwn(value, key)) ||
            !Number.isInteger(value.statusCodeValue) || value.statusCodeValue < QODER_ACCOUNTING_STATUS_MIN || value.statusCodeValue > QODER_ACCOUNTING_STATUS_MAX || typeof value.body !== 'string') unavailable();
        records.push(Object.freeze({ kind: 'envelope', statusCodeValue: value.statusCodeValue, body: value.body }));
      }
    }
    data = null; eventBytes = 0;
  }
  function endLine() {
    const line = decoder.decode(buffer.subarray(0, length)); length = 0;
    if (!line) { dispatch(); return; }
    if (line.startsWith(':')) return;
    if (line !== 'data' && !line.startsWith('data:')) unavailable();
    if (data !== null) unavailable(); // Selected one-data-line envelope, no silent field erasure.
    data = line === 'data' ? '' : line.slice(5);
    if (data.startsWith(' ')) data = data.slice(1);
  }
  function append(byte) {
    if (length === buffer.byteLength) {
      const grown = new Uint8Array(Math.min(selected.maxEventBytes, Math.max(length + 1, buffer.byteLength * 2)));
      intrinsicSet.call(grown, buffer); buffer = grown;
    }
    buffer[length++] = byte;
  }
  return Object.freeze({
    push(input) {
      try {
        if (invalid || ended || types.isProxy(input) || !types.isUint8Array(input)) unavailable();
        const size = byteLength.call(input);
        if (size > selected.maxChunkBytes || totalBytes + size > selected.maxTotalBytes) unavailable();
        const bytes = new Uint8Array(size); intrinsicSet.call(bytes, input); totalBytes += size;
        utf8.decode(bytes, { stream: true });
        for (const byte of bytes) {
          if (++eventBytes > selected.maxEventBytes) unavailable();
          if (cr) { cr = false; if (byte !== 10) unavailable(); endLine(); continue; }
          if (byte === 13) cr = true;
          else if (byte === 10) endLine();
          else append(byte);
        }
      } catch (error) { invalid = true; throw error; }
    },
    finish() {
      try {
        if (invalid || ended || cr || length || data !== null || eventBytes) unavailable();
        ended = true; utf8.decode();
        return Object.freeze(records.slice()); // Empty/no-DONE EOF has no semantic interpretation.
      } catch (error) { invalid = true; throw error; }
    },
  });
}
