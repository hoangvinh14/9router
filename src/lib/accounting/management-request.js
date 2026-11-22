// Shared bounded reader for authenticated accounting management mutations.
// Call ONLY after session/origin validation; this reader grants no authority.
export async function boundedAccountingJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error(), { status: 400 });
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || BigInt(declared) > 4096n)) throw Object.assign(new Error(), { status: 413 });
  if (!request.body) throw Object.assign(new Error(), { status: 400 });
  const reader = request.body.getReader();
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw Object.assign(new Error(), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
