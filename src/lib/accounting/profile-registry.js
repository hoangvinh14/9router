// These ingress paths use the native usage producers below. The context
// factories still validate the body and the exact wire request before POST.
const ingress = new Map([
  ['/v1/messages', ['anthropic', 'claude', 'codex']],
  ['/v1/v1/messages', ['claude']],
  ['/v1/responses', ['anthropic', 'claude', 'codex', 'openai']],
  ['/v1/chat/completions', ['anthropic', 'claude', 'codex', 'openai']],
]);

export const isBudgetChatEndpoint = pathname => ingress.has(pathname);
export const supportsBudgetProvider = (pathname, provider) => ingress.get(pathname)?.includes(provider) === true;
