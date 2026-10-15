import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { readBufferedGeminiAccounting } from '../utils/accountingGeminiUsage.js';
import { readAccountingText, readAccountingJson } from '../utils/readAccountingJson.js';
import { ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE, isGeminiOwnedVideoClientInlineAudioVideoMode, isGeminiOwnedVideoClientInlineAudioMode, isGeminiOwnedVideoClientInlineMode, isGeminiOwnedVideoClientMode, isGeminiOwnedFilesMode, isGeminiOwnedVideoMetadataMode, isGeminiOwnedVideoResolutionMode } from '../config/accountingGeminiOwnedFilesModes.js';
import { getGeminiOwnedRequestOwner } from '../config/accountingGeminiOwnedRequestOwner.js';
import { supportsGeminiCandidate, ACCOUNTED_GEMINI_SSE_MODE } from '../config/accountedGeminiCandidate.js';
import { createAccountingGeminiSseParser } from '../utils/accountingGeminiSseParser.js';
import { createAccountedOpenaiStream } from '../utils/accountedOpenaiStream.js';
import { FETCH_CONNECT_TIMEOUT_MS } from '../config/runtimeConfig.js';
import { captureAccountingBaseTransport } from '../config/accountedBaseTransport.js';
import { captureAccountingProxyEnvironment } from '../config/accountedProxyEnvironment.js';
import { snapshotAccountingPreparedData } from '../config/accountedBaseDispatch.js';
import { isGeminiClientMode, ACCOUNTED_GEMINI_CLIENT_SSE_MODE } from '../config/accountingGeminiClientModes.js';
import { ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES } from '../config/accountingGeminiInlineMedia.js';
import { ACCOUNTING_STATE } from '../config/apiKeyBudgetConstants.js';

import { isGeminiInlineMode, ACCOUNTED_GEMINI_INLINE_SSE_MODE } from '../config/accountingGeminiInlineModes.js';
import { ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, isGeminiInlineResolutionMode } from '../config/accountingGeminiInlineResolutionModes.js';
import { ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, isGeminiAudioResolutionMode } from '../config/accountingGeminiAudioResolutionModes.js';
import { ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, isGeminiVideoProcessingMode } from '../config/accountingGeminiVideoProcessingModes.js';
import { ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, isGeminiProcessingToolsMode } from '../config/accountingGeminiProcessingToolsModes.js';
import { isGeminiAudioMode, ACCOUNTED_GEMINI_AUDIO_SSE_MODE } from '../config/accountingGeminiAudioModes.js';
import { isGeminiVideoMode, ACCOUNTED_GEMINI_VIDEO_SSE_MODE } from '../config/accountingGeminiVideoModes.js';
import { isGeminiVideoMetadataMode, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE } from '../config/accountingGeminiVideoMetadataModes.js';
import { isGeminiVideoResolutionMode, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE } from '../config/accountingGeminiVideoResolutionModes.js';
function fetchOnce(invoke, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    let work;
    try { work = invoke(); } catch (error) { finish(reject, error); return; }
    Promise.resolve(work).then(value => {
      if (settled) { try { Promise.resolve(value?.body?.cancel(signal.reason)).catch(() => {}); } catch { /* foreign cleanup */ } }
      else finish(resolve, value);
    }, error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
// Native original generateContent JSON, not an OpenAI reconversion. One strict
// POST/intent/sole bounded raw reader; no refresh, redirect or retry shortcut.
export async function executeAccountedGeminiCandidate(executor, options) {
  const { model, accounting, signal, connectionId } = options;
  const ownedVideoMetadata = isGeminiOwnedVideoMetadataMode(options.accountingMode);
  const ownedVideoResolution = isGeminiOwnedVideoResolutionMode(options.accountingMode);
  const ownedFiles = isGeminiOwnedFilesMode(options.accountingMode) || ownedVideoMetadata || ownedVideoResolution;
  const ownedOwner = ownedFiles ? getGeminiOwnedRequestOwner(accounting) : null;
  const ownedTarget = ownedFiles ? snapshotAccountingPreparedData({ provider: executor.provider, model, endpoint: 'chat', connectionId }) : null;
  let retainedOriginal;
  function assertOwnedCurrent() {
    ownedOwner.capture(ownedTarget, retainedOriginal);
    if (ownedOwner.videoMetadata(ownedTarget, retainedOriginal) !== ownedVideoMetadata || ownedOwner.videoResolution(ownedTarget, retainedOriginal) !== ownedVideoResolution || ownedOwner.clientTools(ownedTarget, retainedOriginal) !== isGeminiOwnedVideoClientMode(options.accountingMode) || ownedOwner.inlineMedia(ownedTarget, retainedOriginal) !== isGeminiOwnedVideoClientInlineMode(options.accountingMode) || ownedOwner.inlineAudio(ownedTarget, retainedOriginal) !== isGeminiOwnedVideoClientInlineAudioMode(options.accountingMode) || ownedOwner.inlineVideo(ownedTarget, retainedOriginal) !== isGeminiOwnedVideoClientInlineAudioVideoMode(options.accountingMode)) throw new Error('Owned Gemini request owner unavailable');
  }
  const processingTools = isGeminiProcessingToolsMode(options.accountingMode);
  const processing = isGeminiVideoProcessingMode(options.accountingMode) || processingTools;
  // Processing delivery requires this terminal's retained exact evidence
  // authority to have settled. Generic unlimited unresolved success is not a
  // processing grant, even after an ACK of the unresolved ledger row.
  const terminalAccounting = ownedFiles || processing ? { ...accounting, async assertSuccessfulTerminal(terminal) {
    if (!terminal || terminal.state !== ACCOUNTING_STATE.SETTLED || terminal.unrecorded || terminal.costNanoUsd === null || terminal.costNanoUsd === undefined) throw new Error('Gateway accounting stream unavailable');
    if (ownedOwner) { assertOwnedCurrent(); ownedOwner.terminal(ownedTarget, retainedOriginal, terminal); }
    return accounting.assertSuccessfulTerminal(terminal);
  } } : accounting;
  const audioResolution = isGeminiAudioResolutionMode(options.accountingMode);
  const inlineResolution = isGeminiInlineResolutionMode(options.accountingMode);
  let resolution = isGeminiVideoResolutionMode(options.accountingMode);
  const metadata = isGeminiVideoMetadataMode(options.accountingMode);
  const video = isGeminiVideoMode(options.accountingMode) || metadata || resolution || processing, audio = isGeminiAudioMode(options.accountingMode) || video || audioResolution, inline = isGeminiInlineMode(options.accountingMode) || audio || inlineResolution, originalRequired = ownedFiles || inline || isGeminiClientMode(options.accountingMode);
  if (originalRequired) {
    accounting.assertSupported(accounting.requiresPreparedBaseWire === true);
    try {
      // Capture original material before any programmable clone/introspection.
      options = { ...options, body: snapshotAccountingPreparedData(options.body), credentials: snapshotAccountingPreparedData(options.credentials),
        proxyOptions: options.proxyOptions == null ? null : snapshotAccountingPreparedData(options.proxyOptions),
        providerOverrides: options.providerOverrides == null ? null : snapshotAccountingPreparedData(options.providerOverrides) };
    } catch (error) { accounting.assertSupported(false); throw error; }
  }
  if (processing) resolution = Object.hasOwn(options.body.generationConfig || {}, 'mediaResolution') || options.body.contents?.some(content => content.parts?.some(part => Object.hasOwn(part, 'mediaResolution') && ACCOUNTING_GEMINI_INLINE_VIDEO_MIME_TYPES.includes(part.inlineData?.mimeType)));
  const credentials = structuredClone(options.credentials);
  const proxyOptions = options.proxyOptions ? structuredClone(options.proxyOptions) : null;
  const live = [ACCOUNTED_GEMINI_SSE_MODE, ACCOUNTED_GEMINI_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_INLINE_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_INLINE_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_AUDIO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_VIDEO_PROCESSING_SSE_MODE, ACCOUNTED_GEMINI_PROCESSING_TOOLS_SSE_MODE, ACCOUNTED_GEMINI_OWNED_FILES_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_METADATA_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_RESOLUTION_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_COMBINED_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_SSE_MODE, ACCOUNTED_GEMINI_OWNED_VIDEO_CLIENT_INLINE_AUDIO_VIDEO_SSE_MODE].includes(options.accountingMode);
  const url = executor.buildUrl(model, live, 0, credentials);
  const { model: _model, stream: _stream, ...body } = structuredClone(options.body);
  const headers = new Headers({ ...executor.buildHeaders(credentials, live, url, model, body), ...(options.providerOverrides?.headers || {}) });
  accounting.assertSupported(supportsGeminiCandidate(executor, options, url, body, headers));
  let serialized, wireBody;
  try { serialized = JSON.stringify(body); wireBody = JSON.parse(serialized); }
  catch (error) { accounting.assertSupported(false); throw error; }
  accounting.assertSupported(supportsGeminiCandidate(executor, options, url, wireBody, headers));
  signal?.throwIfAborted();
  // Default synchronous owner keeps its two-argument contract. Internal queued
  // admission receives the original immutable native work, never rebuilt later.
  const preparedWire = accounting.requiresPreparedBaseWire ? snapshotAccountingPreparedData({
    protocol: 'native-gemini', url, headers: Object.fromEntries(headers),
    credentials: { apiKey: credentials?.apiKey ?? null, accessToken: credentials?.accessToken ?? null },
    providerOverrides: options.providerOverrides ?? null, proxyOptions, proxyEnvironment: captureAccountingProxyEnvironment(),
    geminiTransport: { model, mode: options.accountingMode, baseTransport: captureAccountingBaseTransport(executor.config), serializedBody: serialized,
      ...(originalRequired ? { originalBody: body } : {}),
      ...(ownedFiles ? { resources: ownedOwner.capture(ownedTarget, body).resources } : {}) },
  }) : null;
  const postHeaders = preparedWire ? preparedWire.headers : headers;
  const postProxy = preparedWire ? preparedWire.proxyOptions : proxyOptions;
  const postBody = preparedWire ? preparedWire.geminiTransport.serializedBody : serialized;
  retainedOriginal = originalRequired ? preparedWire.geminiTransport.originalBody : null;
  const clientToolsOriginal = isGeminiClientMode(options.accountingMode) || inline && Object.hasOwn(retainedOriginal, 'tools') ? retainedOriginal : null;
  const inlineMediaOriginal = inline ? retainedOriginal : null;
  const inlineAudioOriginal = audio ? retainedOriginal : null;
  const inlineVideoOriginal = video ? retainedOriginal : null;
  const videoMetadataOriginal = metadata || (resolution || processing) && retainedOriginal.contents.some(content => content.parts.some(part => Object.hasOwn(part, 'videoMetadata'))) ? retainedOriginal : null;
  const videoResolutionOriginal = resolution ? retainedOriginal : null;
  const inlineResolutionOriginal = inlineResolution ? retainedOriginal : null;
  const audioResolutionOriginal = audioResolution ? retainedOriginal : null;
  const videoProcessingOriginal = processing ? retainedOriginal : null;
  const processingToolsOriginal = processingTools ? retainedOriginal : null;
  const parserFactory = ownedFiles ? onEvent => ownedOwner.parser(ownedTarget, retainedOriginal, onEvent) : originalRequired ? (onEvent, limits) => createAccountingGeminiSseParser(onEvent, { ...limits, clientToolsOriginal, inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal }) : createAccountingGeminiSseParser;
  const attempt = await (preparedWire
    ? accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true, preparedWire)
    : accounting.beforeAttempt({ provider: executor.provider, model, endpoint: 'chat', connectionId }, true));
  if (signal?.aborted) {
    await accounting.completeAttempt(attempt, { notDispatched: true, outcome: 'aborted' }); signal.throwIfAborted();
  }
  const control = new AbortController();
  const merged = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  const timer = setTimeout(() => control.abort(new Error('Chat connection deadline exceeded')), executor.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
  let response, message = null, usage = null, text, transportError = null, invoked = false;
  try {
    response = await fetchOnce(() => {
      invoked = true;
      return proxyAwareFetch(url, { method: 'POST', headers: postHeaders, body: postBody, redirect: 'error', signal: merged }, postProxy,
        preparedWire ? { singlePost: true, proxyEnvironment: preparedWire.proxyEnvironment, geminiTransport: preparedWire.geminiTransport,
          ...(ownedFiles ? { routingGate: assertOwnedCurrent } : {}) } : { singlePost: true });
    }, merged);
  } catch (error) { transportError = { error }; }
  finally { clearTimeout(timer); }
  if (!transportError && response.ok && live) {
    let ownedBody;
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Gemini response destination');
      if (!response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('Unsupported raw Gemini SSE response');
      ownedBody = createAccountedOpenaiStream(response, { accounting: terminalAccounting, attempt, signal, parserFactory, expectedModel: model });
    } catch (error) { transportError = { error }; }
    // Transfer once to the existing sole stream terminal owner. Caller delivery
    // or response construction cannot start a second settlement/JSON fallback.
    if (ownedBody) {
      let replay;
      try { replay = new Response(ownedBody, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } }); }
      catch (error) { await ownedBody.cancel(error); throw error; }
      return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingLive: true };
    }
  }
  if (!transportError) {
    try {
      if (response.redirected || response.url && response.url !== url) throw new Error('Unexpected Gemini response destination');
      if (response.ok) {
        if (ownedFiles && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Unsupported raw Gemini accounting response');
        const inspected = ownedFiles ? ownedOwner.inspect(ownedTarget, retainedOriginal, await readAccountingJson(response, signal)) : await readBufferedGeminiAccounting(response, signal, { expectedModel: model, clientToolsOriginal, inlineMediaOriginal, inlineAudioOriginal, inlineVideoOriginal, videoMetadataOriginal, videoResolutionOriginal, inlineResolutionOriginal, audioResolutionOriginal, videoProcessingOriginal, processingToolsOriginal });
        usage = inspected.usage; message = inspected.message;
      } else text = await readAccountingText(response, signal);
    } catch (error) { transportError = { error }; }
  }
  if (transportError && response?.body && !response.bodyUsed && !response.body.locked) {
    try { Promise.resolve(response.body.cancel(transportError.error)).catch(() => {}); } catch { /* unhanded cleanup only */ }
  }
  // Exact evidence already observed survives a cancellation while ACK is held.
  // Persistence and trusted authorization failures are not transport failures.
  const outcome = signal?.aborted ? 'aborted' : transportError ? 'network_unknown' : response.ok ? 'success' : 'failed';
  const completion = { usage, outcome };
  if (!invoked) completion.notDispatched = true;
  const terminal = await accounting.completeAttempt(attempt, completion);
  signal?.throwIfAborted();
  if (transportError || !response.ok) accounting.gate();
  else { await terminalAccounting.assertSuccessfulTerminal(terminal); signal?.throwIfAborted(); }
  if (transportError) throw transportError.error;
  const replay = message ? Response.json(message, { headers: { 'Cache-Control': 'no-store' } }) :
    new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  return { response: replay, url, headers, transformedBody: wireBody, accountingOwned: true, accountingMessage: message };
}
