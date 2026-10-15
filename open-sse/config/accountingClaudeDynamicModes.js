// Internal queued opt-ins only; direct/app/synchronous modes stay unchanged.
export const ACCOUNTED_ANTHROPIC_DYNAMIC_MODE = 'native-claude-dynamic-sse';
export const ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE = 'native-claude-oauth-dynamic-sse';
export const isClaudeDynamicMode = mode => [ACCOUNTED_ANTHROPIC_DYNAMIC_MODE, ACCOUNTED_CLAUDE_OAUTH_DYNAMIC_MODE].includes(mode);
