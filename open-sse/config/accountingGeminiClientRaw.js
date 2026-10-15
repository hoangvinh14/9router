import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsGeminiRequest } from './accountedGeminiCandidate.js';
import { ACCOUNTING_GEMINI_CALL_NAME, supportsGeminiThoughtSignature } from './accountingGeminiClientTools.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));
// Stream-local name/ID metadata only. No corpus, client execution, resource
// access, usage inference or terminal permission. All monetary rules stay in
// the raw inspector; absence of tool-use tokens never follows from call count.
export function createGeminiClientRawAuthority(value, allowInlineMedia = false, allowInlineAudio = false, allowInlineVideo = false, allowVideoMetadata = false, allowVideoResolution = false, allowInlineResolution = false, allowAudioResolution = false, allowVideoProcessing = false, allowProcessingTrace = false) {
  const original = snapshotAccountingPreparedData(value);
  if (!supportsGeminiRequest(original, true, allowInlineMedia, allowInlineAudio, allowInlineVideo, allowVideoMetadata, allowVideoResolution, allowInlineResolution, allowAudioResolution, allowVideoProcessing, allowProcessingTrace)) throw new Error('Invalid original Gemini client authority');
  const config = original.toolConfig?.functionCallingConfig;
  const names = new Set(config?.mode === 'NONE' ? [] : config?.allowedFunctionNames || original.tools.flatMap(tool => tool.functionDeclarations.map(item => item.name)));
  const issued = new Set(); let bytes = 0, entries = 0;
  for (const content of original.contents) for (const part of content.parts) {
    if (part.functionCall?.id !== undefined) issued.add(part.functionCall.id);
  }
  return Object.freeze({
    acceptContent(value) {
      const content = snapshotAccountingPreparedData(value);
      if (!fields(content, ['role', 'parts']) || content.role !== GEMINI_ROLE.MODEL || !Array.isArray(content.parts)) return false;
      for (const part of content.parts) {
        if (!fields(part, ['text', 'thought', 'thoughtSignature', 'functionCall']) ||
            ['text', 'functionCall'].filter(key => Object.hasOwn(part, key)).length !== 1 ||
            part.thought !== undefined && typeof part.thought !== 'boolean' ||
            part.thoughtSignature !== undefined && !supportsGeminiThoughtSignature(part.thoughtSignature)) return false;
        if (Object.hasOwn(part, 'text')) { if (typeof part.text !== 'string') return false; continue; }
        const call = part.functionCall;
        if (!fields(call, ['id', 'name', 'args']) || typeof call.name !== 'string' || !ACCOUNTING_GEMINI_CALL_NAME.test(call.name) || !names.has(call.name) ||
            call.args !== undefined && !object(call.args) || call.id !== undefined && (typeof call.id !== 'string' || !call.id || issued.has(call.id))) return false;
        // Reserve only association metadata. Arguments/signatures remain opaque
        // framed bytes, bounded individually by the parser/capture ceiling.
        bytes += Buffer.byteLength(call.name, 'utf8') + (call.id === undefined ? 0 : Buffer.byteLength(call.id, 'utf8'));
        if (++entries > 10000 || bytes > 262144) return false;
        if (call.id !== undefined) issued.add(call.id);
      }
      return true;
    },
  });
}
