import { normalizeExactUsage } from './exactUsage.js';
import { readAccountingText } from './readAccountingJson.js';
import { FORMATS } from '../translator/formats.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
import { CLAUDE_STOP } from '../translator/schema/finishReasons.js';
import { ROLE } from '../translator/schema/roles.js';
import { CLAUDE_ACCOUNTING_EVENT as EVENT, CLAUDE_ACCOUNTING_USAGE_FIELDS, CLAUDE_ACCOUNTING_MAX_EVENTS, CLAUDE_ACCOUNTING_MESSAGE_TYPE, CLAUDE_ACCOUNTING_EVENT_FIELDS, CLAUDE_ACCOUNTING_MESSAGE_DELTA_FIELDS, CLAUDE_ACCOUNTING_BLOCK_DELTAS, CLAUDE_ACCOUNTING_MESSAGE_FIELDS, CLAUDE_ACCOUNTING_BLOCK_FIELDS, CLAUDE_ACCOUNTING_TOOL_INPUT_MAX_BYTES, CLAUDE_ACCOUNTING_SIGNATURE_MAX_BYTES } from '../config/accountingClaudeSchema.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
import { ACCOUNTING_JSON_MAX_BYTES } from '../config/accountingBodyLimits.js';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
function equal(a, b) {
  if (a === b) return true;
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

// Sole raw reader composition. A stop frame alone is never EOF, and read
// failure/abort/deadline cannot flush authority or a captured native message.
export async function readBufferedClaudeAccounting(response, signal, { expectedModel = null, captureMessage = false, allowFailedHttp = false, allowCache1h = false, requireCacheTiers = false, allowThinking = false } = {}) {
  // Status and observed billable usage are independent facts. Only an explicit
  // owner opt-in permits failed HTTP; it never relaxes raw schema/stop/EOF or
  // grants success authorization. Default consumers retain success-only reads.
  if (typeof allowFailedHttp !== 'boolean' || !response.ok && !allowFailedHttp ||
      !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new Error('Unsupported raw Claude accounting response');
  const observer = createBufferedClaudeUsageObserver({ expectedModel, captureMessage, allowCache1h, requireCacheTiers, allowThinking });
  const text = await readAccountingText(response, signal, { onChunk: chunk => observer.push(chunk) });
  const result = { text, usage: observer.finish() };
  if (captureMessage) result.message = observer.message();
  return result;
}

// Unconnected raw buffered protocol candidate. Only finish() after a sole reader's
// clean EOF can return exact counts; parser success is not POST/pricing authority.
// The caller must use the bounded/deadlined raw reader, not an unbounded read loop.
export function createBufferedClaudeUsageObserver({ maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES,
  maxTotalBytes = ACCOUNTING_JSON_MAX_BYTES, maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES,
  maxEvents = CLAUDE_ACCOUNTING_MAX_EVENTS, expectedModel = null, captureMessage = false, onEvent = null,
  allowClientTools = false, maxToolInputBytes = CLAUDE_ACCOUNTING_TOOL_INPUT_MAX_BYTES, allowCache1h = false, requireCacheTiers = false,
  allowThinking = false, maxThinkingSignatureBytes = CLAUDE_ACCOUNTING_SIGNATURE_MAX_BYTES } = {}) {
  if (typeof allowCache1h !== 'boolean' || typeof requireCacheTiers !== 'boolean' || requireCacheTiers && !allowCache1h ||
      typeof allowClientTools !== 'boolean' || allowClientTools && onEvent === null || typeof allowThinking !== 'boolean' ||
      ![maxEventBytes, maxTotalBytes, maxChunkBytes, maxEvents, maxToolInputBytes, maxThinkingSignatureBytes].every(value => Number.isSafeInteger(value) && value > 0) ||
      expectedModel !== null && (typeof expectedModel !== 'string' || !expectedModel) || typeof captureMessage !== 'boolean' || onEvent !== null && (typeof onEvent !== 'function' || captureMessage || expectedModel === null)) throw new Error('Invalid Claude accounting limits');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0, eventBytes = 0, events = 0, line = '', data = [], eventName = null, cr = false, raw = '';
  const encoder = new TextEncoder();
  let started = false, stopped = false, ended = false, invalid = false, usage = null, hadDelta = false, stopReason = null;
  let nextIndex = 0, openBlock = null, blockType = null;
  let message = null, capturedBlock = null, partialInput = '', toolInputBytes = 0;
  const liveTool = () => onEvent && allowClientTools && blockType === CLAUDE_BLOCK.TOOL_USE;
  const strictThinking = () => allowThinking && blockType === CLAUDE_BLOCK.THINKING;
  let signatureBytes = 0, signatureStarted = false;
  const content = [];
  const reject = () => { throw new Error('Invalid raw Claude accounting stream'); };
  function inspectUsage(raw) {
    if (!object(raw) || Object.keys(raw).some(key => !CLAUDE_ACCOUNTING_USAGE_FIELDS.includes(key))) reject();
    // Unlike legacy normalization, this candidate requires observed tool counters.
    if (!Object.hasOwn(raw, 'server_tool_use') || !normalizeExactUsage(raw, FORMATS.CLAUDE, 'chat', { allowCache1h, requireCacheTiers })) reject();
  }
  function inspect(frame) {
    if (!object(frame) || frame.type !== eventName || stopped || frame.error) reject();
    const fields = CLAUDE_ACCOUNTING_EVENT_FIELDS[frame.type];
    if (!Array.isArray(fields) || Object.keys(frame).some(key => !fields.includes(key))) reject();
    if (frame.type === EVENT.PING) return;
    if (frame.type === EVENT.START) {
      const message = frame.message;
      if (started || !object(message) || message.type !== CLAUDE_ACCOUNTING_MESSAGE_TYPE || message.role !== ROLE.ASSISTANT ||
          typeof message.id !== 'string' || !message.id || typeof message.model !== 'string' || !message.model ||
          expectedModel !== null && message.model !== expectedModel ||
          Object.keys(message).some(key => !CLAUDE_ACCOUNTING_MESSAGE_FIELDS.includes(key)) ||
          message.stop_reason !== undefined && message.stop_reason !== null || message.stop_sequence !== undefined && message.stop_sequence !== null ||
          !Array.isArray(message.content) || message.content.length || !object(message.usage)) reject();
      inspectUsage(message.usage);
      if (message.usage.output_tokens !== 0) reject();
      usage = structuredClone(message.usage); started = true;
      if (captureMessage) captureStart(message);
      return;
    }
    if (!started) reject();
    if (frame.type === EVENT.DELTA) {
      if (openBlock !== null || !object(frame.delta) || Object.keys(frame.delta).some(key => !CLAUDE_ACCOUNTING_MESSAGE_DELTA_FIELDS.includes(key)) ||
          frame.delta.stop_sequence !== undefined && frame.delta.stop_sequence !== null && typeof frame.delta.stop_sequence !== 'string' ||
          !object(frame.usage) || !count(frame.usage.output_tokens) || frame.usage.output_tokens < usage.output_tokens) reject();
      for (const [key, value] of Object.entries(frame.usage)) {
        if (!CLAUDE_ACCOUNTING_USAGE_FIELDS.includes(key) || key !== 'output_tokens' && (!Object.hasOwn(usage, key) || !equal(value, usage[key]))) reject();
      }
      const reason = frame.delta.stop_reason;
      if (reason !== undefined && reason !== null) {
        if (!Object.values(CLAUDE_STOP).includes(reason) || stopReason !== null && stopReason !== reason) reject();
        stopReason = reason;
      }
      usage = { ...usage, output_tokens: frame.usage.output_tokens };
      if (captureMessage) {
        if (reason !== undefined && reason !== null) message.stop_reason = reason;
        if (Object.hasOwn(frame.delta, 'stop_sequence')) message.stop_sequence = frame.delta.stop_sequence;
      }
      inspectUsage(usage); hadDelta = true; return;
    }
    if (frame.type === EVENT.STOP) {
      if (!hadDelta || stopReason === null || openBlock !== null) reject();
      stopped = true; return;
    }
    if (hadDelta) reject();
    if (frame.type === EVENT.BLOCK_START) {
      if (openBlock !== null || frame.index !== nextIndex || !object(frame.content_block) ||
          ![CLAUDE_BLOCK.TEXT, CLAUDE_BLOCK.THINKING, CLAUDE_BLOCK.REDACTED_THINKING, CLAUDE_BLOCK.TOOL_USE].includes(frame.content_block.type)) reject();
      if (onEvent && frame.content_block.type !== CLAUDE_BLOCK.TEXT &&
          !(allowClientTools && frame.content_block.type === CLAUDE_BLOCK.TOOL_USE) &&
          !(allowThinking && [CLAUDE_BLOCK.THINKING, CLAUDE_BLOCK.REDACTED_THINKING].includes(frame.content_block.type))) reject();
      if (onEvent || allowThinking) validateBlock(frame.content_block);
      blockType = frame.content_block.type; openBlock = frame.index;
      if (captureMessage) captureBlock(frame.content_block);
      if (strictThinking()) {
        signatureBytes = encoder.encode(frame.content_block.signature || '').byteLength;
        signatureStarted = signatureBytes > 0;
        if (signatureBytes > maxThinkingSignatureBytes) reject();
      }
      if (liveTool()) {
        // Anthropic streams client-tool input as JSON fragments from an empty
        // initial object. Never silently replace a prepopulated start object.
        if (Object.keys(frame.content_block.input).length) reject();
        partialInput = ''; toolInputBytes = 0;
      }
      return;
    }
    if (frame.type === EVENT.BLOCK_DELTA) {
      if (openBlock === null || frame.index !== openBlock || !object(frame.delta)) reject();
      const types = CLAUDE_ACCOUNTING_BLOCK_DELTAS[blockType];
      if (!Object.hasOwn(types, frame.delta.type)) reject();
      const field = types[frame.delta.type];
      if (typeof frame.delta[field] !== 'string' || Object.keys(frame.delta).some(key => key !== 'type' && key !== field)) reject();
      if (strictThinking()) {
        if (field === 'signature') {
          signatureStarted = true;
          signatureBytes += encoder.encode(frame.delta[field]).byteLength;
          if (signatureBytes > maxThinkingSignatureBytes) reject();
        } else if (signatureStarted) reject();
      }
      if (liveTool()) {
        toolInputBytes += encoder.encode(frame.delta[field]).byteLength;
        if (toolInputBytes > maxToolInputBytes) reject();
        partialInput += frame.delta[field];
      }
      if (captureMessage) {
        if (blockType === CLAUDE_BLOCK.TOOL_USE) partialInput += frame.delta[field];
        else capturedBlock[field] = (capturedBlock[field] || '') + frame.delta[field];
      }
      return;
    }
    if (frame.type === EVENT.BLOCK_STOP) {
      if (openBlock === null || frame.index !== openBlock) reject();
      if (strictThinking() && !signatureBytes) reject();
      if (liveTool()) {
        if (partialInput) {
          let input;
          try { input = JSON.parse(partialInput); } catch { reject(); }
          if (!object(input)) reject();
        }
        partialInput = ''; toolInputBytes = 0;
      }
      if (captureMessage) {
        if (blockType === CLAUDE_BLOCK.TOOL_USE && partialInput) {
          let input;
          try { input = JSON.parse(partialInput); } catch { reject(); }
          if (!object(input)) reject();
          capturedBlock.input = input;
        }
        content.push(capturedBlock); capturedBlock = null; partialInput = '';
      }
      openBlock = null; blockType = null; nextIndex++; return;
    }
    reject(); // Unknown/fallback/error events cannot grant pricing compatibility.
  }
  function captureStart(raw) {
    message = { id: raw.id, type: raw.type, role: raw.role, model: raw.model,
      content, stop_reason: null, stop_sequence: null, usage: null };
  }
  function validateBlock(raw) {
    const fields = CLAUDE_ACCOUNTING_BLOCK_FIELDS[raw.type];
    if (Object.keys(raw).some(key => !fields.includes(key))) reject();
    if (raw.type === CLAUDE_BLOCK.TEXT && typeof raw.text !== 'string' ||
        raw.type === CLAUDE_BLOCK.THINKING && (typeof raw.thinking !== 'string' || raw.signature !== undefined && typeof raw.signature !== 'string') ||
        raw.type === CLAUDE_BLOCK.REDACTED_THINKING && typeof raw.data !== 'string' ||
        raw.type === CLAUDE_BLOCK.TOOL_USE && (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name || !object(raw.input))) reject();
  }
  function captureBlock(raw) {
    validateBlock(raw);
    capturedBlock = structuredClone(raw); partialInput = '';
  }
  function dispatch() {
    let terminal = false, done = false;
    if (data.length) {
      if ((!onEvent && ++events > maxEvents) || !eventName) reject();
      let frame;
      try { frame = JSON.parse(data.join('\n')); } catch { reject(); }
      inspect(frame);
      terminal = frame.type === EVENT.DELTA || frame.type === EVENT.STOP;
      done = frame.type === EVENT.STOP;
    } else if (eventName !== null) reject();
    const bytes = onEvent ? encoder.encode(raw) : null;
    data = []; eventName = null; eventBytes = 0; raw = '';
    if (onEvent) onEvent({ bytes, terminal, done });
  }
  function endLine() {
    if (!line) dispatch();
    else if (!line.startsWith(':')) {
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') { if (eventName !== null) reject(); eventName = value; }
      else reject();
    }
    line = '';
  }
  function consume(text) {
    for (const character of text) {
      if (cr) {
        cr = false;
        if (character === '\n') {
          if (++eventBytes > maxEventBytes) reject();
          if (onEvent) raw += character;
          endLine(); continue;
        }
        endLine();
      }
      const cp = character.codePointAt(0);
      if (cp <= 0x7f) eventBytes += 1;
      else if (cp <= 0x7ff) eventBytes += 2;
      else if (cp <= 0xffff) eventBytes += 3;
      else eventBytes += 4;
      if (eventBytes > maxEventBytes) reject();
      if (onEvent) raw += character;
      if (character === '\r') cr = true;
      else if (character === '\n') endLine();
      else line += character;
    }
  }
  return {
    message() {
      if (!captureMessage || !ended || invalid || !stopped) return null;
      return structuredClone({ ...message, usage });
    },
    push(chunk) {
      try {
        if (ended || invalid || !(chunk instanceof Uint8Array) || chunk.byteLength > maxChunkBytes) reject();
        if (!onEvent) { total += chunk.byteLength; if (total > maxTotalBytes) reject(); }
        consume(decoder.decode(chunk, { stream: true }));
      } catch (error) { invalid = true; throw error; }
    },
    finish() {
      if (ended) throw new Error('Claude accounting observer already finished');
      ended = true;
      if (invalid) return null;
      try {
        consume(decoder.decode());
        if (cr) { cr = false; endLine(); }
        if (line) endLine();
        if (data.length || eventName !== null || raw) dispatch();
        return stopped ? normalizeExactUsage(usage, FORMATS.CLAUDE, 'chat', { allowCache1h, requireCacheTiers }) : null;
      } catch (error) { invalid = true; throw error; }
    },
  };
}
