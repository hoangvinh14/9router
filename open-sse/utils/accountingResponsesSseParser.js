import { inspectRawResponsesAccounting } from './accountingResponsesUsage.js';
import { RESPONSES_ACCOUNTING_EVENT as EVENT, RESPONSES_ACCOUNTING_EVENT_FIELDS, RESPONSES_ACCOUNTING_IN_PROGRESS } from '../config/accountingResponsesStreamSchema.js';
import { ACCOUNTING_RESPONSES_OBJECT, ACCOUNTING_RESPONSES_COMPLETE, ACCOUNTING_RESPONSES_MESSAGE_FIELDS, ACCOUNTING_RESPONSES_TEXT_FIELDS,
  ACCOUNTING_RESPONSES_REASONING_FIELDS, ACCOUNTING_RESPONSES_SUMMARY_FIELDS } from '../config/accountingResponsesSchema.js';
import { RESPONSES_ITEM } from '../translator/schema/blocks.js';
import { ROLE } from '../translator/schema/roles.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

// Raw text-message Responses protocol candidate. Exact usage only emerges at
// clean EOF after genuine response.completed; no DONE synthesis or translation.
export function createAccountingResponsesSseParser(onEvent, { expectedModel, maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES,
  maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES, allowReasoning = false } = {}) {
  if (typeof allowReasoning !== 'boolean' || typeof onEvent !== 'function' || typeof expectedModel !== 'string' || !expectedModel ||
      ![maxEventBytes, maxChunkBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid Responses SSE configuration');
  const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
  let raw = '', line = '', data = [], eventName = null, bytes = 0, cr = false, ended = false, invalid = false;
  let sequence = -1, responseId = null, complete = false, usage = null, active = null, part = null, text = '', textDone = false;
  const output = [];
  const reject = () => { throw new Error('Invalid raw Responses accounting stream'); };
  function startResponse(response) {
    if (!object(response) || response.object !== ACCOUNTING_RESPONSES_OBJECT || typeof response.id !== 'string' || !response.id ||
        response.model !== expectedModel || response.status !== RESPONSES_ACCOUNTING_IN_PROGRESS ||
        response.error !== null || response.incomplete_details !== null || response.usage !== null ||
        !Array.isArray(response.output) || response.output.length || responseId !== null && responseId !== response.id) reject();
    responseId = response.id;
  }
  function inspect(frame) {
    if (complete || !object(frame) || frame.type !== eventName ||
        !fields(frame, RESPONSES_ACCOUNTING_EVENT_FIELDS[frame.type] || []) ||
        !Number.isSafeInteger(frame.sequence_number) || frame.sequence_number !== sequence + 1) reject();
    sequence = frame.sequence_number;
    if (frame.type === EVENT.CREATED) { if (responseId !== null) reject(); startResponse(frame.response); return; }
    if (!responseId) reject();
    if (frame.type === EVENT.PROGRESS) { if (active || output.length) reject(); startResponse(frame.response); return; }
    if (frame.type === EVENT.COMPLETE) {
      if (active || part) reject();
      const inspected = inspectRawResponsesAccounting(frame.response, expectedModel);
      if (frame.response.id !== responseId || !equal(frame.response.output, output)) reject();
      usage = inspected.usage; complete = true; return;
    }
    if (frame.type === EVENT.ITEM_START) {
      const item = frame.item;
      if (allowReasoning && item?.type === RESPONSES_ITEM.REASONING) {
        if (active || frame.output_index !== output.length || !fields(item, ACCOUNTING_RESPONSES_REASONING_FIELDS) ||
            item.status !== RESPONSES_ACCOUNTING_IN_PROGRESS || typeof item.id !== 'string' || !item.id ||
            output.some(value => value.id === item.id) || !Array.isArray(item.summary) || item.summary.length ||
            item.encrypted_content !== undefined && typeof item.encrypted_content !== 'string') reject();
        active = structuredClone(item); return;
      }
      if (active || frame.output_index !== output.length || !fields(item, ACCOUNTING_RESPONSES_MESSAGE_FIELDS) ||
          item.type !== RESPONSES_ITEM.MESSAGE || item.role !== ROLE.ASSISTANT || item.status !== RESPONSES_ACCOUNTING_IN_PROGRESS ||
          typeof item.id !== 'string' || !item.id || output.some(value => value.id === item.id) || !Array.isArray(item.content) || item.content.length) reject();
      active = structuredClone(item); return;
    }
    if (!active || frame.output_index !== output.length) reject();
    if (allowReasoning && active.type === RESPONSES_ITEM.REASONING) {
      if (frame.type === EVENT.ITEM_DONE) {
        const item = frame.item;
        if (part || !fields(item, ACCOUNTING_RESPONSES_REASONING_FIELDS) || item.status !== ACCOUNTING_RESPONSES_COMPLETE ||
            item.encrypted_content !== undefined && typeof item.encrypted_content !== 'string' ||
            active.encrypted_content !== undefined && item.encrypted_content !== active.encrypted_content ||
            !equal(item, { ...active, ...(item.encrypted_content !== undefined ? { encrypted_content: item.encrypted_content } : {}), status: ACCOUNTING_RESPONSES_COMPLETE })) reject();
        output.push(structuredClone(item)); active = null; return;
      }
      if (frame.item_id !== active.id || frame.summary_index !== active.summary.length) reject();
      if (frame.type === EVENT.SUMMARY_START) {
        if (part || !fields(frame.part, ACCOUNTING_RESPONSES_SUMMARY_FIELDS) ||
            frame.part.type !== RESPONSES_ITEM.SUMMARY_TEXT || frame.part.text !== '') reject();
        part = structuredClone(frame.part); text = ''; textDone = false; return;
      }
      if (!part) reject();
      if (frame.type === EVENT.SUMMARY_DELTA) {
        if (textDone || typeof frame.delta !== 'string') reject();
        text += frame.delta; if (encoder.encode(text).byteLength > maxEventBytes) reject(); return;
      }
      if (frame.type === EVENT.SUMMARY_TEXT_DONE) {
        if (textDone || frame.text !== text) reject();
        textDone = true; return;
      }
      if (frame.type === EVENT.SUMMARY_DONE) {
        if (!textDone || !equal(frame.part, { ...part, text })) reject();
        active.summary.push(structuredClone(frame.part)); part = null; text = ''; textDone = false; return;
      }
      reject();
    }
    if (frame.type === EVENT.ITEM_DONE) {
      if (part || !fields(frame.item, ACCOUNTING_RESPONSES_MESSAGE_FIELDS) || frame.item.status !== ACCOUNTING_RESPONSES_COMPLETE ||
          !equal(frame.item, { ...active, status: ACCOUNTING_RESPONSES_COMPLETE })) reject();
      output.push(structuredClone(frame.item)); active = null; return;
    }
    if (frame.item_id !== active.id || frame.content_index !== active.content.length) reject();
    if (frame.type === EVENT.PART_START) {
      if (part || !fields(frame.part, ACCOUNTING_RESPONSES_TEXT_FIELDS) || frame.part.type !== RESPONSES_ITEM.OUTPUT_TEXT ||
          frame.part.text !== '' || !Array.isArray(frame.part.annotations) || frame.part.annotations.length) reject();
      part = structuredClone(frame.part); text = ''; textDone = false; return;
    }
    if (!part) reject();
    if (frame.type === EVENT.TEXT_DELTA) {
      if (textDone || typeof frame.delta !== 'string' || frame.logprobs !== undefined && (!Array.isArray(frame.logprobs) || frame.logprobs.length)) reject();
      text += frame.delta; if (encoder.encode(text).byteLength > maxEventBytes) reject(); return;
    }
    if (frame.type === EVENT.TEXT_DONE) {
      if (textDone || frame.text !== text || frame.logprobs !== undefined && (!Array.isArray(frame.logprobs) || frame.logprobs.length)) reject();
      textDone = true; return;
    }
    if (frame.type === EVENT.PART_DONE) {
      if (!textDone || !equal(frame.part, { ...part, text })) reject();
      active.content.push(structuredClone(frame.part)); part = null; text = ''; textDone = false; return;
    }
    reject();
  }
  function dispatch() {
    let terminal = false, done = false;
    if (data.length) {
      let frame; try { frame = JSON.parse(data.join('\n')); } catch { reject(); }
      inspect(frame);
      terminal = [EVENT.TEXT_DONE, EVENT.PART_DONE, EVENT.SUMMARY_TEXT_DONE, EVENT.SUMMARY_DONE, EVENT.ITEM_DONE, EVENT.COMPLETE].includes(frame.type);
      done = frame.type === EVENT.COMPLETE;
    } else if (eventName !== null) reject();
    const chunk = encoder.encode(raw); raw = ''; line = ''; data = []; bytes = 0; eventName = null;
    onEvent({ bytes: chunk, terminal, done });
  }
  function endLine() {
    if (!line) dispatch();
    else if (line.startsWith(':')) { /* keep wire comments, no protocol authority */ }
    else if (line === 'data' || line.startsWith('data:')) { let value = line === 'data' ? '' : line.slice(5); if (value.startsWith(' ')) value = value.slice(1); data.push(value); }
    else if (line.startsWith('event:')) { if (eventName !== null) reject(); eventName = line.slice(6).trim(); }
    else reject();
    line = '';
  }
  function add(character) {
    const cp = character.codePointAt(0);
    if (cp <= 0x7f) bytes += 1;
    else if (cp <= 0x7ff) bytes += 2;
    else if (cp <= 0xffff) bytes += 3;
    else bytes += 4;
    if (bytes > maxEventBytes) reject(); raw += character;
  }
  function consume(value) {
    for (const character of value) {
      if (cr) { cr = false; if (character === '\n') { add(character); endLine(); continue; } endLine(); }
      add(character); if (character === '\r') cr = true; else if (character === '\n') endLine(); else line += character;
    }
  }
  return {
    evidence() { return null; }, // Do not widen diagnostic provenance as a side effect.
    push(chunk) {
      try { if (ended || invalid || !(chunk instanceof Uint8Array) || chunk.byteLength > maxChunkBytes) reject(); consume(decoder.decode(chunk, { stream: true })); }
      catch (error) { invalid = true; throw error; }
    },
    finish() {
      try {
        if (ended || invalid) reject(); ended = true; consume(decoder.decode());
        if (cr) { cr = false; endLine(); } if (line) endLine(); if (raw) dispatch();
        return complete ? usage : null;
      } catch (error) { invalid = true; throw error; }
    },
  };
}
