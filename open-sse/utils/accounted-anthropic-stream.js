// The native passthrough owns framing and observes each event before publishing it.
const MAX_FRAME_CHARS = 1024 * 1024;
const encoder = new TextEncoder();

export function createAccountedAnthropicStream(attempt, onTerminal) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let frame = "";

  return new TransformStream({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let offset = 0;
      let newline;
      while ((newline = buffer.indexOf("\n", offset)) !== -1) {
        const raw = buffer.slice(offset, newline);
        offset = newline + 1;
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line) {
          frame += raw + "\n";
          if (frame.length > MAX_FRAME_CHARS) throw new Error("Anthropic SSE frame too large");
          continue;
        }

        const fields = frame.split(/\r?\n/);
        const names = fields.filter(field => field.startsWith("event:"));
        const data = fields.filter(field => field.startsWith("data:")).map(field => field.slice(5).replace(/^ /, ""));
        const output = frame + raw + "\n";
        frame = "";
        if (data.length === 0 && names.length === 0) {
          controller.enqueue(encoder.encode(output));
          continue;
        }
        let event;
        try { event = JSON.parse(data.join("\n")); }
        catch { throw new Error("Invalid Anthropic SSE frame"); }
        if (names.length !== 1 || typeof event?.type !== "string" || names[0].slice(6).trim() !== event.type) {
          throw new Error("Invalid Anthropic SSE event type");
        }

        attempt.observe(event);
        if (event.type === "message_stop") await attempt.settleStream();
        const terminal = event.type === "message_stop" || event.type === "error";
        if (terminal) onTerminal();
        controller.enqueue(encoder.encode(output));
        if (terminal) {
          controller.terminate();
          return;
        }
      }

      buffer = buffer.slice(offset);
      if (frame.length + buffer.length > MAX_FRAME_CHARS) throw new Error("Anthropic SSE frame too large");
    },
    flush() {
      throw new Error("Anthropic SSE ended before a complete terminal event");
    },
  });
}
