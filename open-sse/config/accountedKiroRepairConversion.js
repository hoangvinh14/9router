import { isDeepStrictEqual } from 'node:util';
import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { supportsKiroOriginal } from './accountedKiroCandidate.js';

export const ACCOUNTED_KIRO_ELLIPSIS_INSTRUCTION = 'Retry the previous response because it ended with only an ellipsis. Return the complete final answer, not only ... or ….';
const fields = Object.freeze(['model', 'original', 'actual']);

// Pure full-equality capture for ONE selected repair conversion. Not permission
// to regenerate, choose a route/credential, settle money or reconstruct an ACK.
// Guard/bound the entire aggregate before programmable reads or cloning work.
export function captureKiroEllipsisRepairConversion(value) {
  const unavailable = () => { throw new Error('Accounting Kiro repair conversion unavailable'); };
  const captured = snapshotAccountingPreparedData(value);
  if (!captured || typeof captured !== 'object' || Array.isArray(captured) ||
      Object.keys(captured).length !== fields.length || !fields.every(field => Object.hasOwn(captured, field)) ||
      !supportsKiroOriginal(captured.original, captured.model)) unavailable();
  const expected = structuredClone(captured.original);
  expected.conversationState.currentMessage.userInputMessage.content += '\n\n' + ACCOUNTED_KIRO_ELLIPSIS_INSTRUCTION;
  if (!supportsKiroOriginal(expected, captured.model) || !isDeepStrictEqual(captured.actual, expected)) unavailable();
  return captured;
}
