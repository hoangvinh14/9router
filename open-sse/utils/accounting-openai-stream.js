import { ACCOUNTING_SSE_FRAME_MAX_BYTES, ACCOUNTING_SSE_TERMINAL_MAX_BYTES } from "../config/runtimeConfig.js";
import { createUsageObservation } from "./accounting-openai-usage.js";
import { accountingRefusal } from "./accounting-transport.js";

const activities = new WeakMap();
export const accountingStreamActivity = response => activities.get(response);
const encoder = new TextEncoder();
const encode = value => encoder.encode(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`);

// The reader owns raw bytes. Translation sees only complete, verified events.
export function createAccountedStream(response, ticket, { profile, signal }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const observation = createUsageObservation(profile);
  const listeners = new Set();
  let rawComplete = false, stopped = false, released = false;
  const activity = {
    // The application ticket owns failure provenance and native formatting.
    // Null declines ordinary transport/parser errors; never inspect error.code.
    terminalError(error) {
      if (typeof ticket.terminalError !== 'function') return null;
      try { return ticket.terminalError(error); }
      catch { return ticket.fallbackTerminalBytes ?? null; }
    },
    subscribe(listener) { listeners.add(listener); if (rawComplete) listener(0, true); return () => listeners.delete(listener); },
  };
  const notify = (size, done = false) => { rawComplete ||= done; for (const listener of listeners) listener(size, done); };
  const cleanup = () => {
    signal?.removeEventListener("abort", abort);
    listeners.clear();
    if (!released) { released = true; reader.releaseLock(); }
  };
  let controllerRef;
  const stop = async reason => {
    if (stopped) return;
    stopped = true;
    notify(0, true);
    await reader.cancel(reason).catch(() => {});
    try { await ticket.finish(null, "stream_unknown"); } finally { cleanup(); }
  };
  const abort = () => {
    const error = accountingRefusal(signal.reason || new Error("Stream aborted"));
    controllerRef.error(error);
    // The same retained terminal sink survives cancellation and ACK delivery.
    stop(error).catch(() => {});
  };
  async function* events() {
    let line = "", data = [], frameSize = 0, previousCR = false;
    const terminal = [];
    let terminalSize = 0, sawFinish = false;
    const retain = frame => {
      const bytes = encode(frame);
      terminalSize += bytes.byteLength;
      if (terminalSize > ACCOUNTING_SSE_TERMINAL_MAX_BYTES) throw new Error("Accounting terminal evidence limit exceeded");
      terminal.push(bytes);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        decoder.decode(); // Reject incomplete UTF-8 even when protocol is incomplete.
        throw new Error("Accounting stream ended without protocol completion");
      }
      notify(value.byteLength);
      // Decode small pieces so arbitrary transport chunks cannot grow parser state.
      for (let offset = 0; offset < value.byteLength; offset += 4096) {
        const end = Math.min(offset + 4096, value.byteLength);
        const text = decoder.decode(value.subarray(offset, end), { stream: true });
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          if (previousCR && char === "\n") { previousCR = false; continue; }
          previousCR = false;
          frameSize += encoder.encode(char).byteLength;
          if (frameSize > ACCOUNTING_SSE_FRAME_MAX_BYTES) throw new Error("Accounting SSE frame limit exceeded");
          if (char !== "\n" && char !== "\r") { line += char; continue; }
          previousCR = char === "\r";
          if (line !== "") {
            if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
            line = "";
            continue;
          }
          const payload = data.join("\n");
          data = []; frameSize = 0;
          if (!payload) continue;
          if (payload.trim() === "[DONE]") {
            // DONE is the selected protocol's final boundary. Reject already-read
            // trailing evidence, then cancel the sole reader instead of draining.
            if (text.slice(i + 1).trim() || value.subarray(end).some(byte => ![9,10,13,32].includes(byte))) throw new Error("Evidence after stream completion");
            decoder.decode();
            notify(0, true);
            await reader.cancel();
            if (!sawFinish || !observation.value()) throw new Error("Incomplete accounting stream evidence");
            await ticket.finish(observation.value(), `http_${response.status}`);
            if (stopped || signal?.aborted) return;
            for (const bytes of terminal) yield bytes;
            yield encode("[DONE]");
            return;
          }
          const frame = JSON.parse(payload);
          if (!frame || typeof frame !== "object" || frame.error) throw new Error("Invalid accounting stream event");
          if (frame.usage != null) observation.observe(frame.usage);
          const choices = frame.choices;
          if (choices !== undefined && !Array.isArray(choices)) throw new Error("Invalid accounting stream choices");
          const deltas = [], finishes = [];
          for (const choice of choices || []) {
            if (choice.finish_reason != null) {
              sawFinish = true;
              const { delta, ...finish } = choice;
              finishes.push({ ...finish, delta: {} });
              if (delta && Object.keys(delta).length) deltas.push({ ...choice, finish_reason: null });
            } else deltas.push(choice);
          }
          if (deltas.length) { const delta = { ...frame, choices: deltas }; delete delta.usage; yield encode(delta); }
          if (finishes.length || frame.usage != null) retain({ ...frame, choices: finishes });
        }
      }
    }
  }
  const iterator = events();
  const body = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    },
    async pull(controller) {
      if (stopped) return;
      try {
        const { done, value } = await iterator.next();
        if (stopped) return;
        if (done) { stopped = true; cleanup(); controller.close(); }
        else controller.enqueue(value);
      } catch (error) {
        try { await stop(error); } catch { /* Failure remains in the retained sink. */ }
        try { controller.error(accountingRefusal(error)); } catch { /* Cancelled. */ }
      }
    },
    cancel(reason) { return stop(reason); },
  });
  const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  activities.set(wrapped, activity);
  return wrapped;
}
