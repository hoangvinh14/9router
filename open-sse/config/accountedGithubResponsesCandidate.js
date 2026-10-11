import { supportsResponsesRequest } from './accountedResponsesCandidate.js';
import { getProviderModels } from './providerModels.js';
import { GITHUB_COPILOT } from './appConstants.js';
import { ANTHROPIC_API_VERSION } from '../providers/shared.js';
export const ACCOUNTED_GITHUB_RESPONSES_URL = 'https://api.githubcopilot.com/responses';
export const ACCOUNTED_GITHUB_RESPONSES_MODE = 'native-github-responses-sse';
export const ACCOUNTED_GITHUB_RESPONSES_PROTOCOL = 'native-github-responses';
export const ACCOUNTED_GITHUB_RESPONSES_HEADER_FIELDS = Object.freeze(['authorization', 'content-type', 'accept', 'copilot-integration-id', 'editor-version', 'editor-plugin-version', 'user-agent', 'openai-intent', 'x-github-api-version', 'x-request-id', 'x-vscode-user-agent-library-version', 'x-initiator', 'anthropic-version']);
export const githubResponsesIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\x00-\x20\x7f]/.test(value);
export function supportsGithubResponsesRequest(body, model) {
  return typeof model === 'string' && model.startsWith('gpt-') && getProviderModels('gh').some(entry => entry.id === model && !entry.upstreamModelId) &&
    supportsResponsesRequest(body, model) && body.stream === true && body.store === false &&
    typeof body.instructions === 'string' && body.instructions.trim().length > 0;
}
// Same fingerprint as GithubExecutor.buildHeaders, but one request-local UUID,
// no legacy translator, cached-route selection, or runtime token fallback.
export function githubResponsesHeaders(credentials, requestId) {
  return { Authorization: `Bearer ${credentials.copilotToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream',
    'copilot-integration-id': 'vscode-chat', 'editor-version': `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    'editor-plugin-version': `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`, 'user-agent': GITHUB_COPILOT.USER_AGENT,
    'openai-intent': 'conversation-panel', 'x-github-api-version': GITHUB_COPILOT.API_VERSION,
    'x-request-id': requestId, 'x-vscode-user-agent-library-version': 'electron-fetch', 'X-Initiator': 'user', 'anthropic-version': ANTHROPIC_API_VERSION };
}
