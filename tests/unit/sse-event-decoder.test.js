import { describe, it, expect } from "vitest";
import { createSseEventDecoder } from "../../open-sse/utils/sseEventDecoder.js";
const encoder = new TextEncoder();
function parse(chunks, options) {
  const events = [], parser = createSseEventDecoder(data => events.push(data), options);
  chunks.forEach(chunk => parser.push(chunk)); parser.finish(); return events;
}
describe("bounded local SSE transport framing", () => {
  const wire = ':comment\r\ndata: {"content":\r\ndata: "Chào 👋"}\r\n\r\ndata: next\r\rdata: tail';
  const bytes = encoder.encode(wire), expected = ['{"content":\n"Chào 👋"}', "next", "tail"];
  it("every split position has identical output including UTF8 and splitCRLF", () => {
    for (let split = 0; split <= bytes.length; split++) expect(parse([bytes.slice(0, split), bytes.slice(split)])).toEqual(expected);
    expect(parse(Array.from(bytes, byte => Uint8Array.of(byte)))).toEqual(expected);
  });
  it("preserves optional one-space rule, comments and bounded EOF compatibility", () => {
    expect(parse([encoder.encode("data:  leading\ndata:trailing \n: ignored\n\ndata\n\ndata: unterminated")])).toEqual([" leading\ntrailing ", "", "unterminated"]);
    expect(parse([encoder.encode("data: x\n\n\n")])).toEqual(["x"]);
  });
  it("flushes decoder at EOF without generating a terminal DONE", () => {
    expect(parse([encoder.encode("data: a"), Uint8Array.of(0xe2)])).toEqual(["a�"]);
    expect(parse([encoder.encode(": heartbeat")])).toEqual([]);
  });
  it("bounds both incomplete lines and total multiline event codeunits", () => {
    expect(() => parse([encoder.encode("data: " + "x".repeat(11))], { maxCodeUnits: 10 })).toThrow("SSE line exceeds framing limit");
    expect(() => parse([encoder.encode("data: aaaa\ndata: bbbb\ndata: cccc\n")], { maxCodeUnits: 10 })).toThrow("SSE event exceeds framing limit");
    expect(parse([encoder.encode("data: aaa\n\ndata: bbb\n\n")], { maxCodeUnits: 10 })).toEqual(["aaa", "bbb"]);
    expect(() => parse([], { maxCodeUnits: 0 })).toThrow("Invalid SSE decoder configuration");
  });
});
