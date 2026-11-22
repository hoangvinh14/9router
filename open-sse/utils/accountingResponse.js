// Server-internal response identity, never a wire header/body/client flag.
// Means no implicit successor, NOT a receipt or proof of successful accounting.
// Clones/reconstruction and separate module instances/realms do not inherit it.
const terminalResponses = new WeakSet();

export function markAccountingResponse(response) {
  if (!(response instanceof Response)) throw new Error('Invalid accounting response');
  terminalResponses.add(response);
  return response;
}

export function isAccountingResponse(response) {
  return terminalResponses.has(response);
}
