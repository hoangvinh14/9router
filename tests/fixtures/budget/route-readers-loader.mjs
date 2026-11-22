const aliases = new Map([
  ['@/shared/constants/providers.js', '/app/src/shared/constants/providers.js'],
  ['@/shared/constants/providersDisplay.js', '/app/src/shared/constants/providersDisplay.js'],
  ['@/shared/constants/keyAccess.js', '/app/src/shared/constants/keyAccess.js'],
  ['open-sse/services/model.js', '/app/open-sse/services/model.js'],
  ['open-sse/utils/error.js', '/app/open-sse/utils/error.js'],
  ['open-sse/config/runtimeConfig.js', '/app/open-sse/config/runtimeConfig.js'],
]);
const registry = 'data:text/javascript,export default [];';
const refusal = '() => { throw new Error("Unexpected live read in snapshot fixture"); }';
const live = new Map([
  ['@/lib/localDb', ['getModelAliases', 'getComboByName', 'getProviderNodes', 'getProviderConnections']],
  ['@/lib/db/repos/apiKeysRepo.js', ['getApiKeyByKey']],
  ['@/lib/db/repos/combosRepo.js', ['getCombos']],
]);
const chatDependencies = new Set([
  '../services/auth.js', '../services/antigravityQuota.js', '@/lib/localDb',
  'open-sse/handlers/chatCore.js', '@/lib/headroom/detect', '@/lib/pxpipe/loader.js', '@/lib/pxpipe/events.js',
  'open-sse/utils/upstreamHeaders.js', 'open-sse/utils/bypassHandler.js', 'open-sse/translator/formats.js',
  'open-sse/utils/sessionManager.js', '../services/tokenRefresh.js', 'open-sse/services/projectId.js',
  'open-sse/utils/modelMarkers.js', '../services/systemoneRouter.js',
]);
const appAccounting = new Map([
  ['@/lib/accounting/request-boundary.js', '/app/src/lib/accounting/request-boundary.js'],
  ['@/lib/db/repos/settingsRepo.js', '/app/src/lib/db/repos/settingsRepo.js'],
  ['open-sse/services/combo.js', '/app/open-sse/services/combo.js'],
  ['open-sse/services/capacityAdapter.js', '/app/open-sse/services/capacityAdapter.js'],
  ['open-sse/utils/accountingResponse.js', '/app/open-sse/utils/accountingResponse.js'],
]);
export function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL;
  if (parent === 'file:///app/src/sse/handlers/chat.js') {
    if (specifier === 'open-sse/index.js') return nextResolve('data:text/javascript,export {};', context);
    if (chatDependencies.has(specifier)) return nextResolve('/app/tests/fixtures/budget/route-chat-stubs.mjs', context);
  }
  if ((parent === 'file:///app/src/lib/accounting/installed-service.js' && specifier === '../db/driver.js') ||
      (parent === 'file:///app/src/lib/db/repos/settingsRepo.js' && specifier === '../driver.js') ||
      (parent?.startsWith('file:///app/open-sse/services/') && ['../providers/capabilities.js', '../translator/formats/gemini.js', './emptyFailover.js'].includes(specifier))) {
    return nextResolve('/app/tests/fixtures/budget/route-chat-stubs.mjs', context);
  }
  if (appAccounting.has(specifier)) return nextResolve(appAccounting.get(specifier), context);
  if (specifier === 'open-sse/providers/registry/index.js' ||
      (specifier === '../providers/registry/index.js' && context.parentURL === 'file:///app/open-sse/services/model.js')) {
    return nextResolve(registry, context);
  }
  const names = live.get(specifier);
  if (names) {
    const body = names.map(name => `export const ${name} = ${refusal};`).join('\n');
    return nextResolve(`data:text/javascript,${encodeURIComponent(body)}`, context);
  }
  return nextResolve(aliases.get(specifier) ?? specifier, context);
}
