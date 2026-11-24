import { estimateOutputTokens } from "./usageTracking.js";
import { estimateMissingCodexUsage, responsesTokenUsage } from "../../src/lib/accounting/responses-usage.js";

const MAX_FRAME_CHARS = 1024 * 1024;
const encoder = new TextEncoder();
const terminalStatuses = new Map([
  ["response.completed", "completed"],
  ["response.failed", "failed"],
  ["response.incomplete", "incomplete"],
]);

// The Codex client reads usage on these terminal incomplete responses.
const meteredIncompleteReasons = new Set(["max_output_tokens", "interrupted"]);

export function createAccountedResponsesStream(settle, onTerminal, priceCacheWrites = false, render = null, inputEstimate = 0, mapUsage = null) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let frame = "";
  let responseId;
  let outputCharacters = 0;

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
          if (!render) controller.enqueue(encoder.encode(output));
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
          const rawUsage = metered ? event.response.usage : null;
          const reported = mapUsage ? mapUsage(rawUsage) : responsesTokenUsage(rawUsage, priceCacheWrites);
          const usage = status === "completed" && inputEstimate > 0
            ? estimateMissingCodexUsage(reported, rawUsage, inputEstimate, estimateOutputTokens(outputCharacters))
            : reported;
          const evidence = priceCacheWrites === "included-in-input" || status === "completed" || usage.components.length
            ? usage : undefined;
          terminal = { output, evidence, event };
        } else {
          if (event.type === "response.done") throw new Error("Unsupported Responses SSE terminal");
          if (["response.output_text.delta", "response.reasoning_summary_text.delta",
            "response.function_call_arguments.delta", "response.custom_tool_call_input.delta"].includes(event.type) &&
            typeof event.delta === "string") outputCharacters += event.delta.length;
          const bytes = render ? render(event, false) : output;
          if (bytes) controller.enqueue(encoder.encode(bytes));
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
        const bytes = render ? render(terminal.event, true) : terminal.output + (terminal.done || "");
        if (bytes) controller.enqueue(encoder.encode(bytes));
        controller.terminate();
      }
    },
    flush() {
      throw new Error("Responses SSE ended before a complete terminal event");
    },
  });
}
