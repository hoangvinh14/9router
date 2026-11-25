import { handleChat, handleAccountedChatCandidate } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { accountingUnavailableResponse, inspectAccountingRequest, selectedAccountingSecret } from '@/lib/accounting/request-boundary.js';
import { findInstalledBudgetProfileForKey } from '@/lib/accounting/profile-registry.js';

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
export async function POST(request) {
  const state = await inspectAccountingRequest(request);
  if (state.kind === 'ordinary') {
    await ensureInitialized();
    return await handleChat(request);
  }
  const profile = state.kind === 'controlled' && await findInstalledBudgetProfileForKey(state.keyId);
  const pathname = new URL(request.url).pathname;
  if (!profile || !(['anthropic', 'codex'].includes(profile.provider) && pathname === '/v1/messages' ||
      profile.provider === 'claude' && ['/v1/messages', '/v1/v1/messages'].includes(pathname))) return accountingUnavailableResponse();
  try {
    const { getInstalledAccountingServices, bindAccountingIdentity } = await import('@/lib/accounting/installed-service.js');
    const createContext = profile.provider === 'codex'
      ? (await import('@/lib/accounting/codex-dispatch-context.js')).createCodexDispatchContext
      : (await import('@/lib/accounting/anthropic-dispatch-context.js')).createAnthropicDispatchContext;
    const identity = bindAccountingIdentity(await getInstalledAccountingServices(), selectedAccountingSecret(request));
    if (identity?.keyId !== state.keyId) return accountingUnavailableResponse();
    await ensureInitialized();
    return await handleAccountedChatCandidate(request, { identity, provider: profile.provider, connectionId: profile.connectionId, fallbackConnectionId: profile.fallbackProfile?.connectionId,
      createContext: ({ routeProof, credentials, model, body }) => createContext({ endpoint: pathname, identity, routeProof, credentials, profile: credentials.connectionId === profile.fallbackProfile?.connectionId ? profile.fallbackProfile : profile,
        model, stream: body.stream === true,
      }),
    });
  } catch {
    return accountingUnavailableResponse();
  }
}

