import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { ACCOUNTING_GEMINI_PROCESSING_TOOL_TYPE } from './accountingGeminiProcessingTrace.js';
import { supportsGeminiThoughtSignature } from './accountingGeminiClientTools.js';
import { GEMINI_ROLE } from '../translator/schema/roles.js';
export { ACCOUNTING_GEMINI_PROCESSING_MODALITY_PROVENANCE } from './accountingGeminiProcessingRates.js';
const states = new WeakMap();
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const fields = (v, names) => object(v) && Object.keys(v).every(k => names.includes(k));
const reject = () => { throw new Error('Invalid raw Gemini processing authority'); };
// Stream-local association metadata only. Never retain opaque argument/result
// corpus or infer token quantity from calls, results, frames or processing mode.
export function createGeminiProcessingToolsRawAuthority(original, allowedModalities, clientAuthority = null) {
  original = snapshotAccountingPreparedData(original);
  const issued = new Set(), pending = new Set(); let entries = 0, bytes = 0;
  for (const content of original.contents) for (const part of content.parts) if (part.toolCall?.id !== undefined) issued.add(part.toolCall.id);
  const state = Object.freeze({
    acceptContent(value, terminal = false) {
      const content = snapshotAccountingPreparedData(value);
      if (!fields(content, ['role', 'parts']) || content.role !== GEMINI_ROLE.MODEL || !Array.isArray(content.parts)) reject();
      const ordinary = [];
      for (const part of content.parts) {
        const call = object(part) && Object.hasOwn(part, 'toolCall'), response = object(part) && Object.hasOwn(part, 'toolResponse');
        if (!call && !response) {
          if (clientAuthority) ordinary.push(part);
          else if (!fields(part, ['text', 'thought', 'thoughtSignature']) || typeof part.text !== 'string' ||
            Object.hasOwn(part, 'thought') && typeof part.thought !== 'boolean' || Object.hasOwn(part, 'thoughtSignature') && !supportsGeminiThoughtSignature(part.thoughtSignature)) reject();
          continue;
        }
        if (call === response || !fields(part, [call ? 'toolCall' : 'toolResponse', 'thoughtSignature']) ||
            Object.hasOwn(part, 'thoughtSignature') && !supportsGeminiThoughtSignature(part.thoughtSignature)) reject();
        const payload = part[call ? 'toolCall' : 'toolResponse'], data = call ? 'args' : 'response';
        if (!fields(payload, ['toolType', 'id', data]) || payload.toolType !== ACCOUNTING_GEMINI_PROCESSING_TOOL_TYPE ||
            Object.hasOwn(payload, 'id') && (typeof payload.id !== 'string' || !payload.id) || Object.hasOwn(payload, data) && !object(payload[data])) reject();
        const key = Object.hasOwn(payload, 'id') ? `id:${payload.id}` : 'no-id';
        bytes += Buffer.byteLength(key); if (++entries > 10000 || bytes > 262144) reject();
        if (call) { if (pending.has(key) || key !== 'no-id' && issued.has(payload.id)) reject(); pending.add(key); if (key !== 'no-id') issued.add(payload.id); }
        else if (!pending.delete(key)) reject();
      }
      if (clientAuthority && !clientAuthority.acceptContent({ role: content.role, parts: ordinary }) || terminal && pending.size) reject();
      return true;
    },
    inspectUsage(value, terminal = false) {
      const raw = snapshotAccountingPreparedData(value), scalar = raw.toolUsePromptTokenCount, details = raw.toolUsePromptTokensDetails;
      if (scalar === undefined && details === undefined && !terminal) return null;
      if (!Number.isSafeInteger(scalar) || scalar < 0 || !Array.isArray(details)) reject();
      const result = {};
      for (const row of details) {
        if (!fields(row, ['modality', 'tokenCount']) || Object.keys(row).length !== 2 || !allowedModalities.includes(row.modality) ||
            !Number.isSafeInteger(row.tokenCount) || row.tokenCount < 0 || Object.hasOwn(result, row.modality)) reject();
        result[row.modality] = row.tokenCount;
      }
      if (Object.values(result).reduce((sum, n) => sum + BigInt(n), 0n) !== BigInt(scalar)) reject();
      return terminal ? result : null;
    },
  });
  states.set(state, { original, allowedModalities: [...allowedModalities] }); return state;
}
export function assertGeminiProcessingToolsRawAuthority(state, original, allowedModalities) {
  const retained = states.get(state);
  if (!retained || !isDeepStrictEqual(retained.original, snapshotAccountingPreparedData(original)) || !isDeepStrictEqual(retained.allowedModalities, allowedModalities)) reject();
  return state;
}
