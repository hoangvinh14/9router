import { ACCOUNTING_JSON_MAX_BYTES } from "../config/runtimeConfig.js";
import { createUsageObservation } from "../utils/accounting-openai-usage.js";
import { accountingRefusal } from "../utils/accounting-transport.js";
import { createAccountedStream } from "../utils/accounting-openai-stream.js";

async function readRawJson(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ACCOUNTING_JSON_MAX_BYTES) throw new Error("Accounting JSON evidence limit exceeded");
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
        try {
          const bytes = await readRawJson(response), observation = createUsageObservation(accounting.profile);
          try {
            const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            if (raw.usage !== undefined) observation.observe(raw.usage);
          } catch { /* Invalid/missing evidence remains unresolved, never free. */ }
          await ticket.finish(observation.value(), `http_${response.status}`);
          return new Response([204, 205, 304].includes(response.status) ? null : bytes,
            { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
          await ticket.finish(null, "body_unknown");
          throw accountingRefusal(error);
        }
      },
    });
  } });
}
