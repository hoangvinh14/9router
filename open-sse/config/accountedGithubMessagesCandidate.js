import { getProviderModels } from './providerModels.js';
import { supportsAnthropicLiveRequest } from './accountedAnthropicCandidate.js';
import { ACCOUNTED_GITHUB_RESPONSES_HEADER_FIELDS, githubResponsesHeaders, githubResponsesIdentity } from './accountedGithubResponsesCandidate.js';
// Shared Copilot fingerprint, not shared endpoint/schema/dispatch authority.
export const ACCOUNTED_GITHUB_MESSAGES_URL = 'https://api.githubcopilot.com/v1/messages';
export const ACCOUNTED_GITHUB_MESSAGES_MODE = 'native-github-messages-sse';
export const ACCOUNTED_GITHUB_MESSAGES_PROTOCOL = 'native-github-messages';
export const ACCOUNTED_GITHUB_MESSAGES_HEADER_FIELDS = ACCOUNTED_GITHUB_RESPONSES_HEADER_FIELDS;
export const githubMessagesHeaders = githubResponsesHeaders;
export const githubMessagesIdentity = githubResponsesIdentity;
export function supportsGithubMessagesOriginal(body, model) {
  return typeof model === 'string' && model.startsWith('claude-') && getProviderModels('gh').some(entry => entry.id === model && !entry.upstreamModelId) &&
    body && typeof body === 'object' && !Array.isArray(body) && typeof body.stream === 'boolean' &&
    Array.isArray(body.messages) && body.messages.length > 0 && supportsAnthropicLiveRequest({ ...body, stream: true }, model);
}
export function githubMessagesAccountingBody(body) { return { ...body, stream: true }; }
