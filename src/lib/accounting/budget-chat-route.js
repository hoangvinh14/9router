import { accountingUnavailableResponse, inspectAccountingRequest, selectedAccountingSecret } from './request-boundary.js';
import { isBudgetChatEndpoint } from './profile-registry.js';

export async function routeBudgetChat(request, { initialize, handleChat, handleAccountedChatCandidate }) {
  const state = await inspectAccountingRequest(request);
  if (state.kind === 'ordinary') {
    await initialize();
    return handleChat(request);
  }
  const endpoint = new URL(request.url).pathname;
  if (state.kind !== 'controlled' || request.method !== 'POST' || !isBudgetChatEndpoint(endpoint)) {
    return accountingUnavailableResponse();
  }
  try {
    const [{ bindAccountingIdentity, getInstalledAccountingServices }, { createRouterDispatchContext }] = await Promise.all([
      import('./installed-service.js'), import('./router-dispatch-context.js'),
    ]);
    const identity = bindAccountingIdentity(await getInstalledAccountingServices(), selectedAccountingSecret(request));
    if (identity?.keyId !== state.keyId) return accountingUnavailableResponse();
    await initialize();
    return await handleAccountedChatCandidate(request, {
      identity, createContext: args => createRouterDispatchContext({ ...args, identity, endpoint }),
    });
  } catch {
    return accountingUnavailableResponse();
  }
}
