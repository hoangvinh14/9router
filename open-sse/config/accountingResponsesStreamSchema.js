// Initial raw Responses SSE text-message lifecycle. Other output item kinds
// remain denied until their own ordered lifecycle is implemented and tested.
export const RESPONSES_ACCOUNTING_EVENT = Object.freeze({
  CREATED: 'response.created', PROGRESS: 'response.in_progress', ITEM_START: 'response.output_item.added',
  PART_START: 'response.content_part.added', TEXT_DELTA: 'response.output_text.delta', TEXT_DONE: 'response.output_text.done',
  PART_DONE: 'response.content_part.done', ITEM_DONE: 'response.output_item.done', COMPLETE: 'response.completed',
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
});
export const RESPONSES_ACCOUNTING_IN_PROGRESS = 'in_progress';
