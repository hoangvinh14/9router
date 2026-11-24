import { handleChat, handleAccountedChatCandidate } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

import { accountingUnavailableResponse, inspectAccountingRequest, isCodexBudgetEndpoint, selectedAccountingSecret } from '@/lib/accounting/request-boundary.js';
import { findInstalledBudgetProfileForKey } from '@/lib/accounting/profile-registry.js';

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

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
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request) {
  const state = await inspectAccountingRequest(request);
  if (state.kind === 'ordinary') {
    await ensureInitialized();
    return handleChat(request);
  }
  if (state.kind !== 'controlled' || !isCodexBudgetEndpoint(new URL(request.url).pathname)) return accountingUnavailableResponse();
  try {
    const profile = await findInstalledBudgetProfileForKey(state.keyId);
    if (profile?.provider !== 'codex') return accountingUnavailableResponse();
    const { getInstalledAccountingServices, bindAccountingIdentity } = await import('@/lib/accounting/installed-service.js');
    const { createCodexDispatchContext } = await import('@/lib/accounting/codex-dispatch-context.js');
    const identity = bindAccountingIdentity(await getInstalledAccountingServices(), selectedAccountingSecret(request));
    if (identity?.keyId !== state.keyId) return accountingUnavailableResponse();
    await ensureInitialized();
    return await handleAccountedChatCandidate(request, {
      identity, provider: 'codex',
      createContext: ({ routeProof, model, credentials }) =>
        model === profile.model ? createCodexDispatchContext({ identity, routeProof, credentials, profile }) : null,
    });
  } catch {
    return accountingUnavailableResponse();
  }
}
