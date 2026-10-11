import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsCommandCodeChatOriginal } from './accountedCommandCodeChatCandidate.js';
import { validateCommandCodeChatConversion } from './accountedCommandCodeChatConversion.js';
import { captureAccountingCommandCodeRuntime } from './accountedCommandCodeRuntime.js';

const INPUT_FIELDS = Object.freeze(['body', 'model', 'stream', 'credentials', 'providerOverrides', 'proxyOptions', 'config', 'runtime']);

const unavailable = () => { throw new Error('Accounting CommandCode chat capture unavailable'); };
const exactFields = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

// Internal synchronous translation seam, not a sandbox for executable hooks.
// Runtime is supplied explicitly by the future owner; this helper neither reads
// ambient cwd/clock nor proves persisted route/credential/runtime provenance.
export function captureCommandCodeChatConversion(value, translate) {
  const original = snapshotAccountingPreparedData(value);
  if (!exactFields(original, INPUT_FIELDS) || original.stream !== true || !supportsCommandCodeChatOriginal(original.body, original.model) ||
      typeof translate !== 'function') unavailable();
  captureAccountingCommandCodeRuntime(original.runtime);
  // Never inspect programmable translator output to extract thread/config first.
  const actual = snapshotAccountingPreparedData(translate(original.model, original.body, original.stream, original.credentials));
  const identity = snapshotAccountingPreparedData({ threadId: actual?.threadId ?? null, ...original.runtime });
  if (!validateCommandCodeChatConversion(original.body, original.model, identity, actual)) unavailable();
  // One retained envelope has one bound, including repeated prompt bytes in both
  // original and actual. Per-object bounds cannot substitute for this total.
  return snapshotAccountingPreparedData({ original, actual, identity });
}
