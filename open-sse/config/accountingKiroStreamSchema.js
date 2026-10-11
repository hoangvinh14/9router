// Selected raw text-only Kiro accounting contract; not all AWS/Kiro events.
export const KIRO_ACCOUNTING_EVENT = Object.freeze({
  TEXT: 'assistantResponseEvent', METRICS: 'metricsEvent', STOP: 'messageStopEvent',
});
export const KIRO_ACCOUNTING_EVENT_FIELDS = Object.freeze({
  assistantResponseEvent: Object.freeze(['content']),
  messageStopEvent: Object.freeze(['stopReason']),
});
export const KIRO_ACCOUNTING_STOP_REASON = 'end_turn';
export const KIRO_ACCOUNTING_HEADER_VALUES = Object.freeze({
  ':message-type': 'event', ':content-type': 'application/json',
});
