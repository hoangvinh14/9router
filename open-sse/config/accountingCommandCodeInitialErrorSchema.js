import { COMMANDCODE_ACCOUNTING_EVENT } from './accountingCommandCodeStreamSchema.js';

export const COMMANDCODE_INITIAL_ERROR_EVENT = Object.freeze({
  START: COMMANDCODE_ACCOUNTING_EVENT.START,
  STEP_START: COMMANDCODE_ACCOUNTING_EVENT.STEP_START,
  ERROR: 'error',
});
export const COMMANDCODE_INITIAL_ERROR_FIELDS = Object.freeze(['type', 'error']);
export const COMMANDCODE_INITIAL_ERROR_DETAIL_FIELDS = Object.freeze(['statusCode', 'message']);
export const COMMANDCODE_INITIAL_ERROR_STATUS_MIN = 400;
export const COMMANDCODE_INITIAL_ERROR_STATUS_MAX = 599;
