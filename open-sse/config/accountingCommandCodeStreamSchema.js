// Initial raw AI-SDK NDJSON accounting slice: one generation step, one optional
// text block, token-only explicit-zero cache/reasoning. Not a general SDK schema.
export const COMMANDCODE_ACCOUNTING_EVENT = Object.freeze({
  START: 'start', STEP_START: 'start-step', TEXT_START: 'text-start',
  TEXT_DELTA: 'text-delta', TEXT_END: 'text-end', STEP_FINISH: 'finish-step', FINISH: 'finish',
});
export const COMMANDCODE_ACCOUNTING_EVENT_FIELDS = Object.freeze({
  [COMMANDCODE_ACCOUNTING_EVENT.START]: Object.freeze(['type']),
  [COMMANDCODE_ACCOUNTING_EVENT.STEP_START]: Object.freeze(['type']),
  [COMMANDCODE_ACCOUNTING_EVENT.TEXT_START]: Object.freeze(['type', 'id']),
  [COMMANDCODE_ACCOUNTING_EVENT.TEXT_DELTA]: Object.freeze(['type', 'id', 'text']),
  [COMMANDCODE_ACCOUNTING_EVENT.TEXT_END]: Object.freeze(['type', 'id']),
  [COMMANDCODE_ACCOUNTING_EVENT.STEP_FINISH]: Object.freeze(['type', 'finishReason', 'usage']),
  [COMMANDCODE_ACCOUNTING_EVENT.FINISH]: Object.freeze(['type', 'finishReason', 'totalUsage']),
});
export const COMMANDCODE_ACCOUNTING_FINISH_REASON = 'stop';
