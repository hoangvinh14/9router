// Structural protobuf limits only: these do not define Cursor usage fields.
export const CURSOR_ACCOUNTING_PROTOBUF_MAX_BYTES = 1024 * 1024;
export const CURSOR_ACCOUNTING_PROTOBUF_MAX_FIELDS = 10000;
export const CURSOR_PROTOBUF_MAX_FIELD_NUMBER = 536870911n;
export const CURSOR_PROTOBUF_VARINT_MAX_BYTES = 10;
export const CURSOR_PROTOBUF_WIRE = Object.freeze({ VARINT: 0, FIXED64: 1, LENGTH: 2, FIXED32: 5 });
