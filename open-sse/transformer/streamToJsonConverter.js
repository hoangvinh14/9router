import { isNativeResponsesAccounting } from '../config/accountingProfiles.js';
import { RESPONSES_EVENT, RESPONSES_STATUS } from '../translator/schema/index.js';
import { createResponsesSSEFramer } from '../utils/responses-sse-framing.js';
import { ACCOUNTING_JSON_MAX_BYTES } from '../config/runtimeConfig.js';

async function convertAssociatedNativeStream(stream) {
  if (!stream?.getReader) throw new Error('Native Responses stream required');
  const reader=stream.getReader();let terminal=null,id=null,bytes=0;
  const types=new Map([[RESPONSES_EVENT.COMPLETED,RESPONSES_STATUS.COMPLETED],[RESPONSES_EVENT.FAILED,RESPONSES_STATUS.FAILED],
    [RESPONSES_EVENT.INCOMPLETE,RESPONSES_STATUS.INCOMPLETE],[RESPONSES_EVENT.DONE,null]]);
  const framer=createResponsesSSEFramer(frame=>{
    let data;
    try { data=JSON.parse(frame.payload); }
    catch(cause) { throw new Error('Malformed native Responses converter event',{cause}); }
    const type=frame.event||data.type;
    if(frame.event&&data.type!==frame.event)throw new Error('Native converter event mismatch');
    if(data.response?.id){if(id&&id!==data.response.id)throw new Error('Native converter response identity changed');id=data.response.id;}
    if(type===RESPONSES_EVENT.ERROR)throw new Error('Native Responses error');
    if(types.has(type)){
      const raw=data.response,status=types.get(type);
      if(!raw||!Object.values(RESPONSES_STATUS).includes(raw.status)||status&&raw.status!==status)throw new Error('Native converter terminal mismatch');
      if(terminal&&JSON.stringify(terminal)!==JSON.stringify(raw))throw new Error('Conflicting native converter terminals');
      terminal=raw;
    }
  });
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
      if(bytes>ACCOUNTING_JSON_MAX_BYTES)throw new Error('Native Responses JSON conversion limit exceeded');framer.push(value);}
    framer.end();if(!terminal)throw new Error('Native Responses terminal absent');return terminal;
  }catch(error){await reader.cancel(error).catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}

/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

/**
 * Process a single SSE message and update state accordingly.
 */
function processSSEMessage(msg, state) {
  if (!msg.trim()) return;

  const eventMatch = msg.match(/^event:\s*(.+)$/m);
  const dataMatch = msg.match(/^data:\s*(.+)$/m);
  if (!eventMatch || !dataMatch) return;

  const eventType = eventMatch[1].trim();
  const dataStr = dataMatch[1].trim();
  if (dataStr === "[DONE]") return;

  let parsed;
  try { parsed = JSON.parse(dataStr); }
  catch { return; }

  if (eventType === "response.created") {
    state.responseId = parsed.response?.id || state.responseId;
    state.created = parsed.response?.created_at || state.created;
  } else if (eventType === "response.output_item.done") {
    state.items.set(parsed.output_index ?? 0, parsed.item);
  } else if (eventType === "response.completed" || eventType === "response.done") {
    state.status = "completed";
    if (parsed.response?.usage) {
      state.usage.input_tokens = parsed.response.usage.input_tokens || 0;
      state.usage.output_tokens = parsed.response.usage.output_tokens || 0;
      state.usage.total_tokens = parsed.response.usage.total_tokens || 0;
    }
  } else if (eventType === "response.failed") {
    state.status = "failed";
  }
}

const EMPTY_RESPONSE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream, accounting = null) {
  if (isNativeResponsesAccounting(accounting)) return convertAssociatedNativeStream(stream);
  if (!stream || typeof stream.getReader !== "function") {
    return { id: `resp_${Date.now()}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "failed", output: [], usage: { ...EMPTY_RESPONSE } };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const state = {
    responseId: "",
    created: Math.floor(Date.now() / 1000),
    status: "in_progress",
    usage: { ...EMPTY_RESPONSE },
    items: new Map()
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const msg of messages) {
        processSSEMessage(msg, state);
      }
    }

    // Flush remaining buffer (last event may not end with \n\n)
    if (buffer.trim()) {
      processSSEMessage(buffer, state);
    }
  } finally {
    reader.releaseLock();
  }

  // Build output array from accumulated items (ordered by index)
  const output = [];
  const maxIndex = state.items.size > 0 ? Math.max(...state.items.keys()) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    output.push(state.items.get(i) || { type: "message", content: [], role: "assistant" });
  }

  return {
    id: state.responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: state.created,
    status: state.status || "completed",
    output,
    usage: state.usage
  };
}
