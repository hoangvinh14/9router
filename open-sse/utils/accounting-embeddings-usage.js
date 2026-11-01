// Closed, internal fixture policy. Neither request fields nor a provider label enroll it.
export const EMBEDDINGS_USAGE_PROFILE = 'openai-embeddings-input-only-v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const refuse = () => { throw new Error('Unsupported selected embeddings profile'); };

export function assertEmbeddingsRequest(body) {
  if (!record(body) || Object.keys(body).some(key => !['model','input','encoding_format','dimensions','user'].includes(key))) refuse();
  if (typeof body.model !== 'string' || !body.model) refuse();
  const input = body.input;
  const tokens = value => Array.isArray(value) && value.length > 0 && value.every(integer);
  if (!(typeof input === 'string' && input.length > 0) &&
      !(Array.isArray(input) && input.length > 0 && (input.every(value => typeof value === 'string' && value.length > 0) || tokens(input) || input.every(tokens)))) refuse();
  if (body.encoding_format !== undefined && !['float','base64'].includes(body.encoding_format)) refuse();
  if (body.dimensions !== undefined && (!Number.isSafeInteger(body.dimensions) || body.dimensions <= 0)) refuse();
  // user is historically ignored by the adapter; it grants no billing authority.
  if (body.user !== undefined && typeof body.user !== 'string') refuse();
  return true;
}

export function assertEmbeddingsPrice(result) {
  const snapshot = result?.snapshot;
  if (result?.status !== 'priced' || snapshot?.endpoint !== 'embeddings' ||
      !record(snapshot.rates) || Object.keys(snapshot.rates).some(key => !['input','output'].includes(key)) ||
      typeof snapshot.rates.input !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(snapshot.rates.input) ||
      snapshot.rates.output !== '0' ||
      !['manual','synced','bundled_provider','bundled_canonical_reference','approved_free_namespace'].includes(snapshot.source)) refuse();
  return snapshot;
}

export function normalizeEmbeddingsUsage(raw, profile = EMBEDDINGS_USAGE_PROFILE) {
  if (profile !== EMBEDDINGS_USAGE_PROFILE || !record(raw) || Object.keys(raw).length !== 2 ||
      !Object.hasOwn(raw, 'prompt_tokens') || !Object.hasOwn(raw, 'total_tokens') ||
      !integer(raw.prompt_tokens) || !integer(raw.total_tokens) || raw.total_tokens !== raw.prompt_tokens) return null;
  return Object.freeze({ exact:true, input:raw.prompt_tokens, output:0, cacheRead:0, cacheWrite:0,
    reasoning:0, reasoningIncludedInOutput:true, cacheWrite5m:0, cacheWrite1h:0 });
}

// JSON.parse validates syntax first. This bounded structural walk checks decoded
// member names at the root and root usage object, never regexes arbitrary JSON.
function assertUnambiguousUsage(text) {
  let position = 0;
  const space = () => { while (position < text.length && ' \t\r\n'.includes(text[position])) position++; };
  function string() {
    const start = position++;
    while (position < text.length) {
      const char = text[position++];
      if (char === '\\') position++;
      else if (char === '"') {
        try { return JSON.parse(text.slice(start, position)); } catch { refuse(); }
      }
    }
    refuse();
  }
  function value(depth, scope = '') {
    if (depth > 128) refuse();
    space();
    if (text[position] === '{') {
      position++; space(); const keys = new Set();
      if (text[position] === '}') { position++; return; }
      while (position < text.length) {
        const key = string(); space(); position++; // validated colon
        if ((scope === 'root' && key === 'usage') || scope === 'usage') {
          if (keys.has(key)) refuse(); keys.add(key);
        }
        value(depth + 1, scope === 'root' && key === 'usage' ? 'usage' : '');
        space(); if (text[position++] === '}') return; space();
      }
    } else if (text[position] === '[') {
      position++; space(); if (text[position] === ']') { position++; return; }
      while (position < text.length) { value(depth + 1); space(); if (text[position++] === ']') return; space(); }
    } else if (text[position] === '"') string();
    else { while (position < text.length && !',]} \t\r\n'.includes(text[position])) position++; }
  }
  value(0, 'root');
}

export function observeEmbeddingsJson(bytes, profile = EMBEDDINGS_USAGE_PROFILE) {
  try {
    const text = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
    const raw = JSON.parse(text);
    assertUnambiguousUsage(text);
    if (!record(raw)) return { kind:'malformed' };
    // Ordinary metadata/vectors are opaque. Billing declarations are not.
    if (Object.keys(raw).some(key => /bill|cost|paid|token|tool|media/i.test(key) && !['usage'].includes(key))) return { kind:'malformed' };
    if (!Object.hasOwn(raw, 'usage')) return { kind:'absent' };
    const usage = normalizeEmbeddingsUsage(raw.usage, profile);
    return usage ? { kind:'valid', usage } : { kind:'malformed' };
  } catch { return { kind:'malformed' }; }
}
