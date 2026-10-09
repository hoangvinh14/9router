// Explicit raw-schema compatibility slices, not inferred from provider labels
// or an OpenAI-compatible prefix. Specialized executors remain independently gated.
export const ACCOUNTED_OPENAI_CHAT_PROVIDERS = Object.freeze(['openai', 'deepseek']);
export function isAccountedOpenaiChatProvider(provider) {
  return ACCOUNTED_OPENAI_CHAT_PROVIDERS.includes(provider);
}
// DeepSeek's approved slice is the registry's fixed chat-completions endpoint.
// A stale Claude runtime transport or endpoint override is not schema authority.
export function isAccountedChatTransport(provider, url, runtimeTransport) {
  if (provider === 'openai') return !runtimeTransport || runtimeTransport.format === 'openai';
  return provider === 'deepseek' && (!runtimeTransport || runtimeTransport.format === 'openai') &&
    url === 'https://api.deepseek.com/chat/completions';
}
