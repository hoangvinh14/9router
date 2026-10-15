import { types } from 'node:util';
import { snapshotAccountingPreparedData } from '../../../open-sse/config/accountedBaseDispatch.js';
import { createAccountingGeminiSseParser } from '../../../open-sse/utils/accountingGeminiSseParser.js';
import { assertGeminiOwnedFileAuthoritySync, assertGeminiOwnedFileVideoMetadataSync, assertGeminiOwnedFileVideoResolutionSync, assertGeminiOwnedFileClientToolsSync, assertGeminiOwnedFileInlineMediaSync, assertGeminiOwnedFileInlineAudioSync, assertGeminiOwnedFileInlineVideoSync } from './geminiOwnedFileAuthority.js';
import { createGeminiOwnedFileRawAuthority } from '../../../open-sse/config/accountingGeminiOwnedFileRaw.js';
import { inspectRawGeminiAccounting } from '../../../open-sse/utils/accountingGeminiUsage.js';

// Current gateway-owned provenance and pure observed counters are independent.
// No source projection is dispatched, no quantity inferred and no price grant.
export function inspectGeminiOwnedFileUsageSync(db, capability, original, message, expectedModel) {
  if (typeof expectedModel !== 'string' || !expectedModel) throw new Error('Invalid raw Gemini owned file model');
  const bound = assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  const grant = assertGeminiOwnedFileVideoMetadataSync(db, capability, original, expectedModel);
  const resolution = assertGeminiOwnedFileVideoResolutionSync(db, capability, original, expectedModel);
  const client = assertGeminiOwnedFileClientToolsSync(db, capability, original, expectedModel);
  const inline = assertGeminiOwnedFileInlineMediaSync(db, capability, original, expectedModel);
  const audio = assertGeminiOwnedFileInlineAudioSync(db, capability, original, expectedModel);
  const video = assertGeminiOwnedFileInlineVideoSync(db, capability, original, expectedModel);
  const ownedFileRawAuthority = createGeminiOwnedFileRawAuthority(bound.original, bound.resources, grant, resolution, client, inline, audio, video);
  const observed = inspectRawGeminiAccounting(message, expectedModel, { ownedFileRawAuthority });
  assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  return observed;
}

// Native parser remains the sole framing/terminal-count owner. This wrapper
// only binds current resource lifecycle and latches callback/reentry failures.
// It never confers recorded-terminal ACK or authorizes dispatch.
export function createGeminiOwnedFileSseParserSync(db, capability, original, onEvent, expectedModel) {
  const unavailable = () => { throw new Error('Owned Gemini file stream unavailable'); };
  if (typeof onEvent !== 'function' || typeof expectedModel !== 'string' || !expectedModel) unavailable();
  const bound = assertGeminiOwnedFileAuthoritySync(db, capability, original, expectedModel);
  const grant = assertGeminiOwnedFileVideoMetadataSync(db, capability, original, expectedModel);
  const resolution = assertGeminiOwnedFileVideoResolutionSync(db, capability, original, expectedModel);
  const client = assertGeminiOwnedFileClientToolsSync(db, capability, original, expectedModel);
  const inline = assertGeminiOwnedFileInlineMediaSync(db, capability, original, expectedModel);
  const audio = assertGeminiOwnedFileInlineAudioSync(db, capability, original, expectedModel);
  const video = assertGeminiOwnedFileInlineVideoSync(db, capability, original, expectedModel);
  const ownedFileRawAuthority = createGeminiOwnedFileRawAuthority(bound.original, bound.resources, grant, resolution, client, inline, audio, video);
  let failed = false, active = false, ended = false;
  const recheck = () => {
    if (failed) unavailable();
    assertGeminiOwnedFileAuthoritySync(db, capability, bound.original, expectedModel);
  };
  const parser = createAccountingGeminiSseParser(event => {
    recheck();
    const returned = onEvent(event);
    // No deferred callback can finish changing authority after success. Observe
    // real promise rejections without executing arbitrary thenable accessors.
    if (types.isPromise(returned)) Promise.prototype.then.call(returned, undefined, () => {});
    if (returned !== undefined) unavailable();
    recheck();
  }, { expectedModel, ownedFileRawAuthority });
  function run(fn) {
    try {
      if (failed || active || ended) unavailable();
      active = true; recheck();
      const result = fn(); recheck();
      return result;
    } catch (error) { failed = true; throw error; }
    finally { active = false; }
  }
  return Object.freeze({
    evidence() { return null; },
    push(chunk) { return run(() => parser.push(chunk)); },
    finish() { return run(() => {
      const usage = parser.finish(); ended = true;
      return usage === null ? null : snapshotAccountingPreparedData(usage);
    }); },
  });
}
