// Raw Responses message lifecycle plus explicitly opt-in reasoning summaries.
// Other output item kinds remain denied; framing does not certify a provider.
export const RESPONSES_ACCOUNTING_EVENT = Object.freeze({
  CREATED: 'response.created', PROGRESS: 'response.in_progress', ITEM_START: 'response.output_item.added',
  PART_START: 'response.content_part.added', TEXT_DELTA: 'response.output_text.delta', TEXT_DONE: 'response.output_text.done',
  PART_DONE: 'response.content_part.done', ITEM_DONE: 'response.output_item.done', COMPLETE: 'response.completed',
  SUMMARY_START: 'response.reasoning_summary_part.added', SUMMARY_DELTA: 'response.reasoning_summary_text.delta',
  SUMMARY_TEXT_DONE: 'response.reasoning_summary_text.done', SUMMARY_DONE: 'response.reasoning_summary_part.done',
});
export const RESPONSES_ACCOUNTING_EVENT_FIELDS = Object.freeze({
  'response.created': ['type', 'sequence_number', 'response'],
  'response.in_progress': ['type', 'sequence_number', 'response'],
  'response.output_item.added': ['type', 'sequence_number', 'output_index', 'item'],
  'response.content_part.added': ['type', 'sequence_number', 'output_index', 'item_id', 'content_index', 'part'],
  'response.output_text.delta': ['type', 'sequence_number', 'output_index', 'item_id', 'content_index', 'delta', 'logprobs'],
  'response.output_text.done': ['type', 'sequence_number', 'output_index', 'item_id', 'content_index', 'text', 'logprobs'],
  'response.content_part.done': ['type', 'sequence_number', 'output_index', 'item_id', 'content_index', 'part'],
  'response.output_item.done': ['type', 'sequence_number', 'output_index', 'item'],
  'response.completed': ['type', 'sequence_number', 'response'],
  'response.reasoning_summary_part.added': ['type', 'sequence_number', 'output_index', 'item_id', 'summary_index', 'part'],
  'response.reasoning_summary_text.delta': ['type', 'sequence_number', 'output_index', 'item_id', 'summary_index', 'delta'],
  'response.reasoning_summary_text.done': ['type', 'sequence_number', 'output_index', 'item_id', 'summary_index', 'text'],
  'response.reasoning_summary_part.done': ['type', 'sequence_number', 'output_index', 'item_id', 'summary_index', 'part'],
});
export const RESPONSES_ACCOUNTING_IN_PROGRESS = 'in_progress';
