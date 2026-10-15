import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';
import { ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from './accountingGeminiInlineMedia.js';
import { supportsGeminiThoughtSignature } from './accountingGeminiClientTools.js';

// GenerateContent-specific guide and official SDK document this server-side
// trace. Discovery's omitted enum is not a grant for other hosted tool types.
export const ACCOUNTING_GEMINI_PROCESSING_TOOL_TYPE = 'MEDIA_PROCESSING';
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));

// Original grammar only: the bounded immutable full original is still the wire
// owner. This local validation view never becomes a POST or a usage estimate.
export function supportsGeminiProcessingTraceOriginal(value, validateOriginal) {
  try {
    const body = snapshotAccountingPreparedData(value);
    if (!object(body) || !Array.isArray(body.contents) || !body.contents.length ||
        !body.contents.some(content => [undefined, GEMINI_ROLE.USER].includes(content.role) && content.parts?.some(part =>
          Object.hasOwn(part, 'mediaProcessing') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType)))) return false;
    const issued = new Set(), contents = []; let pairs = 0;
    for (const content of body.contents) {
      if (!fields(content, ['role', 'parts']) || !Array.isArray(content.parts) || !content.parts.length) return false;
      const pending = new Set(), parts = [];
      for (const part of content.parts) {
        if (!object(part)) return false;
        const call = Object.hasOwn(part, 'toolCall'), response = Object.hasOwn(part, 'toolResponse');
        if (!call && !response) {
          // Preserve existing client-call/result validation independently. Only
          // model text's validated thought/signature fields need a local view.
          if (content.role === GEMINI_ROLE.MODEL && Object.hasOwn(part, 'text')) {
            if (!fields(part, ['text', 'thought', 'thoughtSignature']) || typeof part.text !== 'string' ||
                Object.hasOwn(part, 'thought') && typeof part.thought !== 'boolean' ||
                Object.hasOwn(part, 'thoughtSignature') && !supportsGeminiThoughtSignature(part.thoughtSignature)) return false;
            parts.push({ text: part.text });
          } else parts.push(part);
          continue;
        }
        if (call === response || content.role !== GEMINI_ROLE.MODEL || !fields(part, [call ? 'toolCall' : 'toolResponse', 'thoughtSignature']) ||
            Object.hasOwn(part, 'thoughtSignature') && !supportsGeminiThoughtSignature(part.thoughtSignature)) return false;
        const payload = part[call ? 'toolCall' : 'toolResponse'], data = call ? 'args' : 'response';
        if (!fields(payload, ['toolType', 'id', data]) || payload.toolType !== ACCOUNTING_GEMINI_PROCESSING_TOOL_TYPE ||
            Object.hasOwn(payload, 'id') && (typeof payload.id !== 'string' || !payload.id) ||
            Object.hasOwn(payload, data) && !object(payload[data])) return false;
        const key = Object.hasOwn(payload, 'id') ? `id:${payload.id}` : 'no-id';
        if (call) {
          if (pending.has(key) || key !== 'no-id' && issued.has(key)) return false;
          pending.add(key); if (key !== 'no-id') issued.add(key);
        } else {
          if (!pending.delete(key)) return false;
          pairs++;
        }
        parts.push({ text: call ? '[validated original processing call]' : '[validated original processing result]' });
      }
      if (pending.size) return false;
      contents.push({ ...content, parts });
    }
    return pairs > 0 && validateOriginal({ ...body, contents });
  } catch { return false; }
}
