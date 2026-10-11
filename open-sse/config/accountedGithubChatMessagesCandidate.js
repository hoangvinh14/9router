import { getProviderModels } from './providerModels.js';
import { getCapabilitiesForModel } from '../providers/capabilities.js';
import { CLAUDE_SYSTEM_PROMPT } from './appConstants.js';
import { ROLE } from '../translator/schema/roles.js';
import { CLAUDE_BLOCK } from '../translator/schema/blocks.js';
export const ACCOUNTED_GITHUB_CHAT_MESSAGES_MODE = 'chat-github-messages-sse';
export const ACCOUNTED_GITHUB_CHAT_MESSAGES_PROTOCOL = 'chat-github-messages';
// Initial conversion seam: one nonempty user string only. No system/assistant,
// tools, cache directives, thinking, metadata or arbitrary conversion semantics.
export function supportsGithubChatMessagesOriginal(body, model) {
  return typeof model === 'string' && model.startsWith('claude-') && getProviderModels('gh').some(entry => entry.id === model && !entry.upstreamModelId) &&
    body && typeof body === 'object' && !Array.isArray(body) && body.model === model && body.stream === true &&
    Object.keys(body).every(key => ['model', 'messages', 'max_tokens', 'stream', 'temperature'].includes(key)) &&
    Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= getCapabilitiesForModel('github', model).maxOutput &&
    (body.temperature === undefined || typeof body.temperature === 'number' && Number.isFinite(body.temperature) && body.temperature >= 0) &&
    Array.isArray(body.messages) && body.messages.length === 1 && body.messages[0] &&
    Object.keys(body.messages[0]).length === 2 && body.messages[0].role === ROLE.USER &&
    typeof body.messages[0].content === 'string' && body.messages[0].content.trim().length > 0;
}
// Independent exact equality oracle for this one-user conversion slice. Owner
// still calls the existing translator; validators never rerun its mutable hooks.
// Generated system cache TTL is preserved, not stripped to fit native5m schema.
export function expectedGithubChatMessagesBody(body, model) {
  return { model, max_tokens: body.max_tokens, stream: true,
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    messages: [{ role: ROLE.USER, content: [{ type: CLAUDE_BLOCK.TEXT, text: body.messages[0].content }] }],
    system: [{ type: CLAUDE_BLOCK.TEXT, text: CLAUDE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }] };
}
