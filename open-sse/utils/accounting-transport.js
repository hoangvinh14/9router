const refusals = new WeakSet();
const ENVIRONMENT_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "STRICT_SSL", "NODE_TLS_REJECT_UNAUTHORIZED"];

export function accountingRefusal(cause) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  refusals.add(error);
  return error;
}
export const isAccountingRefusal = error => !!error && typeof error === "object" && refusals.has(error);
export const captureTransportEnvironment = () => JSON.stringify(ENVIRONMENT_KEYS.map(key => [key, process.env[key] ?? null]));

// Retain values, never the mutable options/headers/environment references.
export function captureTransportRequest(url, options, proxyOptions) {
  try {
    if (typeof options.body !== "string") throw new Error("Accounting requires a serialized request body");
    return Object.freeze({
    targetUrl: String(url), method: (options.method || "GET").toUpperCase(), body: options.body,
    headers: JSON.stringify([...new Headers(options.headers).entries()].sort(([a], [b]) => a.localeCompare(b))),
    proxyOptions: JSON.stringify(proxyOptions),
    environment: captureTransportEnvironment(),
    });
  } catch (error) { throw accountingRefusal(error); }
}

export async function runAccountedTransport({ boundary, initial, url, options, proxyOptions, route, invoke }) {
  if (!boundary) return invoke(options);
  const wire = Object.freeze({ ...initial, url: String(url), route: Object.freeze({ ...route }) });
  const assertUnchanged = () => {
    const current = captureTransportRequest(initial.targetUrl, options, proxyOptions);
    if (JSON.stringify(current) !== JSON.stringify(initial)) throw accountingRefusal(new Error("Accounting transport selection changed"));
    options.signal?.throwIfAborted();
  };
  let ticket;
  try {
    assertUnchanged(); ticket = await boundary.prepare(wire);
    if (typeof ticket?.assertDispatch !== "function" || ticket.assertDispatch.constructor?.name === "AsyncFunction") throw new Error("Synchronous dispatch authority required");
  }
  catch (error) { throw accountingRefusal(error); }
  try {
    assertUnchanged();
    // All fallible local validation precedes the single-use consumption.
    // The assertion must consume only as its final synchronous operation.
    if (ticket.assertDispatch(wire) !== true) throw new Error("Synchronous dispatch authority refused");
  } catch (error) {
    try { await ticket.failed(error, { exposed: false }); }
    catch (failure) { throw accountingRefusal(failure); }
    throw accountingRefusal(error);
  }
  let response;
  try {
    // Invocation is uncertain exposure even when it throws synchronously.
    // There is no await between the final assertion and this invocation.
    const pending = invoke({ ...options, redirect: "manual" });
    response = await pending;
  } catch (error) {
    try { await ticket.failed(error, { exposed: true }); }
    catch (failure) { throw accountingRefusal(failure); }
    throw error;
  }
  // Accounting/body failures must never enter the network-failure stage.
  try { boundary.onHeaders?.(); return await ticket.response(response); }
  catch (error) { throw accountingRefusal(error); }
}
