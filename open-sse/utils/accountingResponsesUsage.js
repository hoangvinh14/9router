import { readAccountingJson } from './readAccountingJson.js';
import { normalizeExactUsage } from './exactUsage.js';
import { FORMATS } from '../translator/formats.js';
import { RESPONSES_ITEM } from '../translator/schema/blocks.js';
import { ROLE } from '../translator/schema/roles.js';
import { ACCOUNTING_RESPONSES_OBJECT, ACCOUNTING_RESPONSES_COMPLETE, ACCOUNTING_RESPONSES_TIER,
  ACCOUNTING_RESPONSES_USAGE_FIELDS, ACCOUNTING_RESPONSES_INPUT_DETAILS, ACCOUNTING_RESPONSES_OUTPUT_DETAILS,
  ACCOUNTING_RESPONSES_MESSAGE_FIELDS, ACCOUNTING_RESPONSES_TEXT_FIELDS, ACCOUNTING_RESPONSES_FUNCTION_FIELDS,
  ACCOUNTING_RESPONSES_REASONING_FIELDS, ACCOUNTING_RESPONSES_SUMMARY_FIELDS } from '../config/accountingResponsesSchema.js';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const string = value => typeof value === 'string' && value.length > 0;
const fields = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
function supportedOutput(item) {
  if (!object(item) || !string(item.id)) return false;
  if (item.type === RESPONSES_ITEM.MESSAGE) {
    return fields(item, ACCOUNTING_RESPONSES_MESSAGE_FIELDS) && item.role === ROLE.ASSISTANT &&
      item.status === ACCOUNTING_RESPONSES_COMPLETE && Array.isArray(item.content) && item.content.every(block =>
        fields(block, ACCOUNTING_RESPONSES_TEXT_FIELDS) && block.type === RESPONSES_ITEM.OUTPUT_TEXT &&
        typeof block.text === 'string' && Array.isArray(block.annotations) && block.annotations.length === 0);
  }
  if (item.type === RESPONSES_ITEM.FUNCTION_CALL) {
    return fields(item, ACCOUNTING_RESPONSES_FUNCTION_FIELDS) && item.status === ACCOUNTING_RESPONSES_COMPLETE &&
      string(item.call_id) && string(item.name) && typeof item.arguments === 'string';
  }
  if (item.type === RESPONSES_ITEM.REASONING) {
    return fields(item, ACCOUNTING_RESPONSES_REASONING_FIELDS) &&
      (item.status === undefined || item.status === ACCOUNTING_RESPONSES_COMPLETE) &&
      (item.encrypted_content === undefined || typeof item.encrypted_content === 'string') &&
      Array.isArray(item.summary) && item.summary.every(block => fields(block, ACCOUNTING_RESPONSES_SUMMARY_FIELDS) &&
        block.type === RESPONSES_ITEM.SUMMARY_TEXT && typeof block.text === 'string');
  }
  return false; // Hosted tools/audio/image and unknown billing dimensions are not token-only proof.
}

// Own one bounded/deadlined fatal-UTF8 reader. Native message data is never cost
// authority: exact usage is separately validated from RAW provider JSON at EOF.
export async function readBufferedResponsesAccounting(response, signal, { expectedModel } = {}) {
  signal?.throwIfAborted();
  if (!string(expectedModel) || !response.ok || response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('Unsupported raw Responses accounting response');
  }
  const message = await readAccountingJson(response, signal);
  signal?.throwIfAborted();
  return inspectRawResponsesAccounting(message, expectedModel);
}

// Shared raw terminal validation for JSON and genuine completed SSE envelope.
// This does not make event framing, dispatch, price or authorization trusted.
export function inspectRawResponsesAccounting(message, expectedModel) {
  const raw = message?.usage;
  if (!object(message) || message.object !== ACCOUNTING_RESPONSES_OBJECT || !string(message.id) ||
      message.model !== expectedModel || message.status !== ACCOUNTING_RESPONSES_COMPLETE ||
      message.error !== null || message.incomplete_details !== null || message.service_tier !== ACCOUNTING_RESPONSES_TIER ||
      !Array.isArray(message.output) || !message.output.every(supportedOutput) ||
      !fields(raw, ACCOUNTING_RESPONSES_USAGE_FIELDS) ||
      ![raw.input_tokens, raw.output_tokens, raw.total_tokens].every(count) ||
      BigInt(raw.input_tokens) + BigInt(raw.output_tokens) !== BigInt(raw.total_tokens) ||
      !fields(raw.input_tokens_details, ACCOUNTING_RESPONSES_INPUT_DETAILS) || !count(raw.input_tokens_details.cached_tokens) ||
      !fields(raw.output_tokens_details, ACCOUNTING_RESPONSES_OUTPUT_DETAILS) || !count(raw.output_tokens_details.reasoning_tokens)) {
    throw new Error('Invalid raw Responses accounting response');
  }
  const usage = normalizeExactUsage(raw, FORMATS.OPENAI_RESPONSES);
  if (!usage) throw new Error('Invalid raw Responses accounting usage');
  return { message, usage };
}
