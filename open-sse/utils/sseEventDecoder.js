import { SSE_EVENT_MAX_CODE_UNITS } from "../config/sseLimits.js";

// Local Gemini adoption only. Event framing is transport parsing, never trusted
// accounting provenance. Limits measure UTF-16 code units, not token usage.
export function createSseEventDecoder(onData, { maxCodeUnits = SSE_EVENT_MAX_CODE_UNITS } = {}) {
  if (!Number.isSafeInteger(maxCodeUnits) || maxCodeUnits < 1 || typeof onData !== "function") throw new Error("Invalid SSE decoder configuration");
  const decoder = new TextDecoder();
  let line = "", fields = [], size = 0, afterCR = false;
  function dispatch() {
    if (!fields.length) return;
    const data = fields.join("\n"); fields = []; size = 0;
    onData(data);
  }
  function endLine() {
    if (!line) dispatch();
    else if (line === "data" || line.startsWith("data:")) {
      let value = line === "data" ? "" : line.slice(5);
      if (value.startsWith(" ")) value = value.slice(1);
      const nextSize = size + value.length + (fields.length ? 1 : 0);
      if (nextSize > maxCodeUnits) throw new Error("SSE event exceeds framing limit");
      fields.push(value); size = nextSize;
    }
    line = "";
  }
  function consume(text) {
    for (const character of text) {
      if (afterCR) { afterCR = false; if (character === "\n") continue; }
      if (character === "\r" || character === "\n") { endLine(); afterCR = character === "\r"; }
      else {
        line += character;
        if (line.length > maxCodeUnits) throw new Error("SSE line exceeds framing limit");
      }
    }
  }
  return {
    push(chunk) { consume(decoder.decode(chunk, { stream: true })); },
    finish() {
      consume(decoder.decode());
      // Compatibility extension: OpenAI-compatible upstreams sometimes omit
      // the final blank line. Deliberately dispatch a final data event at EOF;
      // unlike browser EventSource, it is not discarded. Never invent DONE.
      if (line) endLine();
      dispatch();
    },
  };
}
