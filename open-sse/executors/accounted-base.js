import { ACCOUNTING_JSON_MAX_BYTES } from "../config/runtimeConfig.js";
import { createUsageObservation } from "../utils/accounting-openai-usage.js";
import { accountingRefusal } from "../utils/accounting-transport.js";
import { createAccountedStream } from "../utils/accounting-openai-stream.js";

const invalidBodies = new WeakSet();
async function readRawJson(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ACCOUNTING_JSON_MAX_BYTES) {
        const error = new Error('Accounting JSON evidence limit exceeded');
        invalidBodies.add(error);
        throw error;
      }
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

// One boundary per executor invocation; one ticket per actual native POST.
export function createAccountedBoundary(accounting) {
  if (!accounting) return null;
  return Object.freeze({ async prepare(wire) {
    const ticket = await accounting.prepare(wire);
    return Object.freeze({ ...ticket,
      async response(response) {
        if (response.ok && response.body && response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
          return createAccountedStream(response, ticket, accounting);
        }
        let bytes;
        try { bytes = await readRawJson(response); }
        catch (error) {
          await ticket.finish(null, "body_unknown", { kind: invalidBodies.has(error) ? 'malformed' : 'absent', interrupted: true });
          throw accountingRefusal(error);
        }
        const observation = createUsageObservation(accounting.profile);
        try {
          const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) observation.observe(null);
          else if (Object.hasOwn(raw, 'usage')) observation.observe(raw.usage);
        } catch { observation.observe(null); }
        // Persistence errors must not be recaught as missing transport evidence.
        await ticket.finish(observation.value(), `http_${response.status}`, { ...observation.evidence(), interrupted: false });
        return new Response([204, 205, 304].includes(response.status) ? null : bytes,
          { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
  } });
}
