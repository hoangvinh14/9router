import { createSseEventDecoder } from './sseEventDecoder.js';
import { normalizeAccountedChatUsage } from './accountedChatUsage.js';
import { accountingUsageEvidence } from './accountingUsageEvidence.js';

// Raw OpenAI stream_options.include_usage contract. No client-converted counts.
// DONE alone is not charge evidence; EOF/error/conflicting observations deny exact.
export function createBufferedAccountingSseObserver(provider = 'openai') {
  let usage = null, done = false, invalid = false;
  const decoder = createSseEventDecoder(data => {
    if (done) { invalid = true; return; }
    if (data === '[DONE]') { done = true; return; }
    let frame;
    try { frame = JSON.parse(data); } catch { invalid = true; return; }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.error) { invalid = true; return; }
    if (frame.usage !== undefined && frame.usage !== null) {
      const exact = normalizeAccountedChatUsage(frame.usage, provider);
      if (!exact || !Array.isArray(frame.choices) || frame.choices.length !== 0 || usage && JSON.stringify(usage) !== JSON.stringify(exact)) invalid = true;
      else if (!invalid) usage = exact;
    }
  });
  return {
    push(chunk) { try { decoder.push(chunk); } catch (error) { invalid = true; throw error; } },
    evidence(reason = 'interrupted') { return accountingUsageEvidence(usage, invalid ? 'invalid_stream' : reason); },
    finish() {
      try { decoder.finish(); } catch (error) { invalid = true; throw error; }
      const exact = done && !invalid ? usage : null;
      return { usage: exact, usageEvidence: exact ? null : accountingUsageEvidence(usage, invalid ? 'invalid_stream' : 'missing_terminal') };
    },
  };
}

export function inspectAccountingSseUsage(text) {
  const observer = createBufferedAccountingSseObserver();
  observer.push(new TextEncoder().encode(text));
  return observer.finish();
}

// Compatibility callers receive exact authority only, never observations.
export function extractAccountingSseUsage(text) {
  return inspectAccountingSseUsage(text).usage;
}
