import { normalizeAccountedChatUsage } from './accountedChatUsage.js';
import { accountingUsageEvidence } from './accountingUsageEvidence.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';

// Fatal incremental UTF-8 framing before any raw event reaches the client.
// EOF dispatch of a final unterminated event matches the buffered compatibility
// contract; it never invents DONE. Exactly one choice is supported in this slice.
export function createAccountingSseParser(onEvent, { maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES, maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES, provider = 'openai' } = {}) {
  if (typeof onEvent !== 'function' || !Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1 || !Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1) throw new Error('Invalid accounting SSE limits');
  const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
  let raw = '', line = '', data = [], eventBytes = 0, cr = false, done = false, usage = null, ended = false, invalid = false;
  function dispatch() {
    const text = data.join('\n');
    let terminal = false, isDone = false;
    if (data.length) {
      if (done) throw new Error('Accounting event after DONE');
      if (text === '[DONE]') { done = true; terminal = true; isDone = true; }
      else {
        let frame;
        try { frame = JSON.parse(text); } catch { throw new Error('Invalid accounting SSE JSON'); }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.error || !Array.isArray(frame.choices)) throw new Error('Invalid accounting SSE frame');
        if (frame.choices.length > 1 || frame.choices.some(choice => !choice || choice.index !== 0)) throw new Error('Unsupported accounting SSE choices');
        terminal = frame.choices.some(choice => choice.finish_reason !== undefined && choice.finish_reason !== null);
        if (frame.usage !== undefined && frame.usage !== null) {
          const exact = normalizeAccountedChatUsage(frame.usage, provider);
          if (!exact || frame.choices.length !== 0 || usage && JSON.stringify(usage) !== JSON.stringify(exact)) throw new Error('Invalid accounting SSE usage');
          usage = exact; terminal = true;
        }
      }
    }
    const bytes = encoder.encode(raw);
    raw = ''; line = ''; data = []; eventBytes = 0;
    onEvent({ bytes, terminal, done: isDone });
  }
  function endLine() {
    if (!line) { dispatch(); return; }
    if (line === 'data' || line.startsWith('data:')) {
      let value = line === 'data' ? '' : line.slice(5);
      if (value.startsWith(' ')) value = value.slice(1);
      data.push(value);
    }
    if (line === 'event: error') throw new Error('Accounting SSE error event');
    line = '';
  }
  function consume(text) {
    for (const character of text) {
      if (cr) {
        cr = false;
        if (character === '\n') { add(character); endLine(); continue; }
        endLine();
      }
      add(character);
      if (character === '\r') cr = true;
      else if (character === '\n') endLine();
      else line += character;
    }
  }
  function add(character) {
    const cp = character.codePointAt(0);
    eventBytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (eventBytes > maxEventBytes) throw new Error('Accounting SSE event limit');
    raw += character;
  }
  return {
    evidence(reason = 'interrupted') { return accountingUsageEvidence(usage, invalid ? 'invalid_stream' : reason); },
    push(chunk) {
      try {
        if (ended || !(chunk instanceof Uint8Array) || chunk.byteLength > maxChunkBytes) throw new Error('Invalid accounting SSE chunk');
        consume(decoder.decode(chunk, { stream: true }));
      } catch (error) { invalid = true; throw error; }
    },
    finish() {
      try {
        if (ended) throw new Error('Accounting SSE already finished');
        ended = true; consume(decoder.decode());
        if (cr) { cr = false; endLine(); }
        if (line) endLine();
        if (raw) dispatch();
        return done ? usage : null;
      } catch (error) { invalid = true; throw error; }
    },
  };
}
