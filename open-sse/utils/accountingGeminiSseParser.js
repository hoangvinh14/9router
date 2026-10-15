import { assertGeminiOwnedFileRawAuthority } from '../config/accountingGeminiOwnedFileRaw.js';
import { inspectRawGeminiAccounting } from './accountingGeminiUsage.js';
import { createGeminiProcessingToolsRawAuthority } from '../config/accountingGeminiProcessingToolsRaw.js';
import { ACCOUNTING_GEMINI_MESSAGE_FIELDS, ACCOUNTING_GEMINI_CANDIDATE_FIELDS, ACCOUNTING_GEMINI_USAGE_FIELDS } from '../config/accountingGeminiSchema.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { createGeminiClientRawAuthority } from '../config/accountingGeminiClientRaw.js';
import { createGeminiBoundInputModalityAuthority, ACCOUNTING_GEMINI_TEXT_INPUT_MODALITY } from '../config/accountingGeminiInputModalities.js';
import { ACCOUNTED_GEMINI_STANDARD_TIERS } from '../config/accountedGeminiCandidate.js';
import { ACCOUNTING_SSE_EVENT_MAX_BYTES, ACCOUNTING_SSE_CHUNK_MAX_BYTES } from '../config/accountingStreamLimits.js';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
// Native text-only SSE: no synthetic DONE or OpenAI projection. Metadata is
// monetary authority only on genuine native finish + complete exact usage + EOF.
// Retain framing bytes, not accumulated output text or a total/event-count cap.
export function createAccountingGeminiSseParser(onEvent, { expectedModel, maxEventBytes = ACCOUNTING_SSE_EVENT_MAX_BYTES,
  maxChunkBytes = ACCOUNTING_SSE_CHUNK_MAX_BYTES, clientToolsOriginal = null, inlineMediaOriginal = null, inlineAudioOriginal = null, inlineVideoOriginal = null, videoMetadataOriginal = null, videoResolutionOriginal = null, inlineResolutionOriginal = null, audioResolutionOriginal = null, videoProcessingOriginal = null, processingToolsOriginal = null, ownedFileRawAuthority = null } = {}) {
  if (typeof onEvent !== 'function' || typeof expectedModel !== 'string' || !expectedModel ||
      ![maxEventBytes, maxChunkBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid Gemini SSE configuration');
  // Bind immutable source captures before any callback or later terminal frame.
  // A caller changing offsets/prompts between push and finish cannot replace
  // the original authority (or poison an already accepted source capture).
  [inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, clientToolsOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal] =
    [inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, clientToolsOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal]
      .map(original => original === null ? null : snapshotAccountingPreparedData(original));
  if (ownedFileRawAuthority !== null && [clientToolsOriginal, inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal].some(value => value !== null)) throw new Error('Invalid original Gemini owned file raw authority');
  const modalityAuthority = ownedFileRawAuthority !== null ? assertGeminiOwnedFileRawAuthority(ownedFileRawAuthority) : createGeminiBoundInputModalityAuthority({ inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, clientToolsOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal });
  const clientAuthority = clientToolsOriginal === null ? null : createGeminiClientRawAuthority(clientToolsOriginal, inlineMediaOriginal !== null, inlineAudioOriginal !== null, inlineVideoOriginal !== null, videoMetadataOriginal !== null, videoResolutionOriginal !== null, inlineResolutionOriginal !== null, audioResolutionOriginal !== null, videoProcessingOriginal !== null, processingToolsOriginal !== null && clientToolsOriginal.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'toolCall') || Object.hasOwn(part, 'toolResponse'))));
  const processingAuthority = processingToolsOriginal === null ? null : createGeminiProcessingToolsRawAuthority(processingToolsOriginal, modalityAuthority.allowedInputModalities, clientAuthority);
  const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
  let raw = '', line = '', data = [], bytes = 0, cr = false, ended = false, invalid = false, complete = false, usage = null, responseId = null;
  const reject = () => { throw new Error('Invalid raw Gemini accounting stream'); };
  function inspect(frame) {
    if (clientAuthority || modalityAuthority) frame = snapshotAccountingPreparedData(frame);
    if (complete || !fields(frame, ACCOUNTING_GEMINI_MESSAGE_FIELDS) ||
        frame.modelVersion !== undefined && frame.modelVersion !== expectedModel ||
        !Array.isArray(frame.candidates) || frame.candidates.length !== 1 ||
        frame.promptFeedback !== undefined && (!fields(frame.promptFeedback, ['safetyRatings']) || !Array.isArray(frame.promptFeedback.safetyRatings))) reject();
    if (frame.responseId !== undefined) {
      if (typeof frame.responseId !== 'string' || !frame.responseId || responseId !== null && responseId !== frame.responseId) reject();
      responseId = frame.responseId;
    }
    const candidate = frame.candidates[0];
    if (!fields(candidate, ACCOUNTING_GEMINI_CANDIDATE_FIELDS) || candidate.index !== 0 ||
        !(processingAuthority ? candidate.finishReason !== undefined || processingAuthority.acceptContent(candidate.content) : clientAuthority ? clientAuthority.acceptContent(candidate.content) : fields(candidate.content, ['role', 'parts']) && candidate.content.role === GEMINI_ROLE.MODEL &&
          Array.isArray(candidate.content.parts) && candidate.content.parts.every(part => fields(part, ['text', 'thought']) &&
            typeof part.text === 'string' && (part.thought === undefined || typeof part.thought === 'boolean'))) ||
        candidate.safetyRatings !== undefined && !Array.isArray(candidate.safetyRatings) ||
        candidate.avgLogprobs !== undefined && (typeof candidate.avgLogprobs !== 'number' || !Number.isFinite(candidate.avgLogprobs)) ||
        candidate.tokenCount !== undefined && (!Number.isSafeInteger(candidate.tokenCount) || candidate.tokenCount < 0)) reject();
    if (candidate.finishReason !== undefined) {
      usage = inspectRawGeminiAccounting(frame, expectedModel, { clientToolsOriginal, inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal, processingRawAuthority: processingAuthority, ownedFileRawAuthority }).usage; complete = true; return;
    }
    // Early complete-looking metadata is not terminal evidence. Nevertheless
    // unknown/paid dimensions cannot be laundered away by a later good frame.
    if (frame.usageMetadata !== undefined) {
      const metadata = frame.usageMetadata;
      if (modalityAuthority) {
        if (!fields(metadata, ACCOUNTING_GEMINI_USAGE_FIELDS) ||
            Object.entries(metadata).some(([key, value]) => key === 'serviceTier' ? !ACCOUNTED_GEMINI_STANDARD_TIERS.includes(value) :
              key.endsWith('Details') ? !Array.isArray(value) || !['promptTokensDetails', 'cacheTokensDetails', ...(processingAuthority ? ['toolUsePromptTokensDetails'] : [])].includes(key) && value.some(row =>
                !fields(row, ['modality', 'tokenCount']) || row.modality !== ACCOUNTING_GEMINI_TEXT_INPUT_MODALITY || !Number.isSafeInteger(row.tokenCount) || row.tokenCount < 0) :
                !Number.isSafeInteger(value) || value < 0 || !processingAuthority && key === 'toolUsePromptTokenCount' && value !== 0)) reject();
        modalityAuthority.inspect(metadata);
        processingAuthority?.inspectUsage(metadata);
      } else if (!fields(metadata, ACCOUNTING_GEMINI_USAGE_FIELDS) || metadata.serviceTier !== undefined ||
          Object.entries(metadata).some(([key, value]) => key.endsWith('Details') ? !Array.isArray(value) || value.length > 0 :
            !Number.isSafeInteger(value) || value < 0 || key === 'toolUsePromptTokenCount' && value !== 0)) reject();
    }
  }
  function dispatch() {
    let terminal = false;
    if (data.length) {
      let frame; try { frame = JSON.parse(data.join('\n')); } catch { reject(); }
      inspect(frame); terminal = complete;
    }
    const chunk = encoder.encode(raw); raw = ''; line = ''; data = []; bytes = 0;
    onEvent({ bytes: chunk, terminal, done: terminal });
  }
  function endLine() {
    if (!line) dispatch();
    else if (line.startsWith(':')) { /* comments retained but no protocol authority */ }
    else if (line === 'data' || line.startsWith('data:')) { let value = line === 'data' ? '' : line.slice(5); if (value.startsWith(' ')) value = value.slice(1); data.push(value); }
    else reject();
    line = '';
  }
  function add(character) {
    const cp = character.codePointAt(0); bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (bytes > maxEventBytes) reject(); raw += character;
  }
  function consume(value) {
    for (const character of value) {
      if (cr) { cr = false; if (character === '\n') { add(character); endLine(); continue; } endLine(); }
      add(character); if (character === '\r') cr = true; else if (character === '\n') endLine(); else line += character;
    }
  }
  return {
    evidence() { return null; },
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
