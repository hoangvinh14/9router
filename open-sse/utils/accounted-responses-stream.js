import { responsesTokenUsage } from "../../src/lib/accounting/responses-usage.js";

const MAX_FRAME_CHARS = 1024 * 1024;
const encoder = new TextEncoder();
const terminalStatuses = new Map([
  ["response.completed", "completed"],
  ["response.failed", "failed"],
  ["response.incomplete", "incomplete"],
]);

// The Codex client reads usage on these terminal incomplete responses.
const meteredIncompleteReasons = new Set(["max_output_tokens", "interrupted"]);

export function createAccountedResponsesStream(settle, onTerminal, priceCacheWrites = false) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let frame = "";
  let responseId;

  return new TransformStream({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let terminal;
      let offset = 0;
      let newline;
      while ((newline = buffer.indexOf("\n", offset)) !== -1) {
        const raw = buffer.slice(offset, newline + 1);
        offset = newline + 1;
        frame += raw;
        if (frame.length > MAX_FRAME_CHARS) throw new Error("Responses SSE frame too large");
        if (raw !== "\n" && raw !== "\r\n") continue;

        const output = frame;
        frame = "";
        const lines = output.split(/\r?\n/);
        const names = lines.filter(line => line.startsWith("event:"));
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (terminal) {
          if (data === "[DONE]" && names.length === 0 && !terminal.done) {
            terminal.done = output;
          } else if (data || names.length) {
            throw new Error("Unexpected data after the Responses terminal");
          }
          continue;
        }
        if (!data && !names.length) {
          controller.enqueue(encoder.encode(output));
          continue;
        }
        const event = JSON.parse(data);
        if (typeof event?.type !== "string" || names.length > 1 ||
            (names.length === 1 && names[0].slice(6).trim() !== event.type)) {
          throw new Error("Invalid Responses SSE event type");
        }

        const id = event.response?.id;
        if (id !== undefined) {
          if (typeof id !== "string" || !id || (responseId && id !== responseId)) {
            throw new Error("Responses SSE identity changed");
          }
          responseId = id;
        }
        const status = terminalStatuses.get(event.type);
        if (status || event.type === "error") {
          if (status && (!id || event.response.status !== status)) {
            throw new Error("Invalid Responses SSE terminal");
          }
          const metered = status === "completed" || status === "failed" ||
            (status === "incomplete" && meteredIncompleteReasons.has(event.response.incomplete_details?.reason));
          const usage = responsesTokenUsage(metered ? event.response.usage : null, priceCacheWrites);
          const evidence = priceCacheWrites === "included-in-input" || status === "completed" || usage.components.length
            ? usage : undefined;
          terminal = { output, evidence };
        } else {
          if (event.type === "response.done") throw new Error("Unsupported Responses SSE terminal");
          controller.enqueue(encoder.encode(output));
        }
      }

      buffer = buffer.slice(offset);
      if (frame.length + buffer.length > MAX_FRAME_CHARS) throw new Error("Responses SSE frame too large");
      if (terminal) {
        // The terminal is authoritative without the optional [DONE] sentinel.
        // Only inspect the bytes already received with it.
        const trailing = (frame + buffer + decoder.decode()).replace(/\r\n/g, "\n").trimStart();
        if (trailing && (terminal.done || !"data: [DONE]\n\n".startsWith(trailing))) {
          throw new Error("Partial frame after Responses terminal");
        }
        if (terminal.evidence) await settle(terminal.evidence);
        onTerminal();
        controller.enqueue(encoder.encode(terminal.output + (terminal.done || "")));
        controller.terminate();
      }
    },
    flush() {
      throw new Error("Responses SSE ended before a complete terminal event");
    },
  });
}
