import { resolve as routeResolve } from './route-readers-loader.mjs';
import { resolve as coreResolve } from './core-loader.mjs';

const root = 'file:///app/';
const stub = `${root}tests/fixtures/budget/composed-stubs.mjs`;
const chat = `${root}src/sse/handlers/chat.js`;
const core = `${root}open-sse/handlers/chatCore.js`;
const streaming = `${root}open-sse/handlers/chatCore/streamingHandler.js`;
const coreStubs = `${root}tests/fixtures/budget/core-stubs.mjs`;
const ordinaryStreaming = new Set([
  '../../translator/index.js', '../../utils/stream.js', './requestDetail.js', '@/lib/usageDb.js',
]);
const codex = `${root}open-sse/executors/codex.js`;
const auth = `${root}src/sse/services/auth.js`;
const proxyConfig = `${root}src/lib/network/connectionProxy.js`;
const fixtureDb = `${root}tests/fixtures/budget/composed-account-db.mjs`;
const dbRepos = new Set(['connectionsRepo.js', 'proxyPoolsRepo.js', 'settingsRepo.js'].map(name => `${root}src/lib/db/repos/${name}`));
const accountAliases = new Map([
  ['@/lib/localDb', fixtureDb],
  ['@/lib/network/connectionProxy', proxyConfig],
  ['open-sse/services/accountFallback.js', `${root}open-sse/services/accountFallback.js`],
  ['open-sse/config/errorConfig.js', `${root}open-sse/config/errorConfig.js`],
  ['./antigravityQuota.js', stub],
]);
const executorDependencies = new Map([
  ['../services/oauthCredentialManager.js', ['open-sse/executors/base.js', 'open-sse/executors/codex.js']],
  ['../services/provider.js', ['open-sse/executors/base.js', 'open-sse/executors/default.js']],
  ['../config/appConstants.js', ['open-sse/executors/default.js']],
  ['../shared/clineAuth.js', ['open-sse/executors/default.js']],
  ['../utils/claudeCloaking.js', ['open-sse/executors/default.js']],
  ['../../providers/capabilities.js', ['open-sse/translator/concerns/paramSupport.js']],
  ['../utils/proxyFetch.js', ['open-sse/executors/base.js', 'open-sse/executors/default.js']],
  ['../../../open-sse/utils/proxyFetch.js', ['src/lib/accounting/anthropic-dispatch-context.js', 'src/lib/accounting/codex-dispatch-context.js']],
]);
const providerConfigParents = new Set([core, codex, `${root}open-sse/executors/default.js`, `${root}open-sse/utils/reasoningContentInjector.js`]);
const providerConfig = `data:text/javascript,import anthropic from '${root}open-sse/providers/registry/anthropic.js';import codex from '${root}open-sse/providers/registry/codex.js';export const PROVIDERS={anthropic:anthropic.transport,codex:codex.transport}, PROVIDER_OAUTH={};`;
const realAppImports = new Map([
  ['open-sse/handlers/chatCore.js', 'open-sse/handlers/chatCore.js'],
  ['open-sse/translator/formats.js', 'open-sse/translator/formats.js'],
  ['open-sse/utils/modelMarkers.js', 'open-sse/utils/modelMarkers.js'],
]);

export function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL;
  if (['messages', 'responses'].some(path => parent === `${root}src/app/api/v1/${path}/route.js`)) {
    if (specifier === '@/sse/handlers/chat.js') return nextResolve(chat, context);
    if (specifier === 'open-sse/translator/index.js') return nextResolve('data:text/javascript,export const initTranslators=()=>{};', context);
    if (specifier.startsWith('@/lib/accounting/')) return nextResolve(root + specifier.replace('@/', 'src/'), context);
  }
  if (['installed-service.js', 'request-boundary.js', 'profile-registry.js'].some(name => parent === `${root}src/lib/accounting/${name}`) &&
      specifier === '../db/driver.js') return nextResolve(stub, context);
  if (parent === root + 'open-sse/handlers/chatCore/sseToJsonHandler.js' &&
      ['./requestDetail.js', '@/lib/usageDb.js'].includes(specifier)) return nextResolve(coreStubs, context);
  if (parent === root + 'open-sse/handlers/chatCore/sseToJsonHandler.js' && specifier === '../../utils/opencodeFingerprint.js') {
    return nextResolve('data:text/javascript,export const restoreToolNames = value => value;', context);
  }
  if (parent === root + 'open-sse/handlers/chatCore/sseToJsonHandler.js' && specifier === '../../config/providers.js') {
    return nextResolve(providerConfig, context);
  }
  if (specifier === '../index.js' && ['request', 'response'].some(kind =>
    parent === root + `open-sse/translator/${kind}/openai-responses.js`)) {
    return nextResolve('data:text/javascript,export const register = () => {};', context);
  }
  if (parent === chat && realAppImports.has(specifier)) {
    return nextResolve(root + realAppImports.get(specifier), context);
  }
  if (parent === chat && specifier === '../services/auth.js') return nextResolve(auth, context);
  if (parent === chat && specifier === '../services/antigravityQuota.js') return nextResolve(stub, context);
  if (parent === auth && accountAliases.has(specifier)) return nextResolve(accountAliases.get(specifier), context);
  if (parent === proxyConfig && specifier === '@/models') return nextResolve(fixtureDb, context);
  if (dbRepos.has(parent) && specifier === '../driver.js') return nextResolve(stub, context);
  if (dbRepos.has(parent) && specifier === 'uuid') {
    return nextResolve('data:text/javascript,export function v4(){throw new Error("Unexpected account creation in fixture");}', context);
  }
  if (parent === core && specifier === '../utils/clientDetector.js') return nextResolve(specifier, context);
  if (parent === core && ['./chatCore/streamingHandler.js', './chatCore/sseToJsonHandler.js', '../utils/streamHandler.js'].includes(specifier)) {
    return nextResolve(specifier, context);
  }
  if (parent === streaming && ordinaryStreaming.has(specifier)) return nextResolve(coreStubs, context);
  if (parent === streaming && specifier === '../../config/providers.js') return nextResolve(providerConfig, context);
  if (specifier === '../config/providers.js' && providerConfigParents.has(parent)) return nextResolve(providerConfig, context);
  if (parent === core && specifier === '../executors/index.js') {
    return nextResolve(`data:text/javascript,import {DefaultExecutor} from '${root}open-sse/executors/default.js';import {CodexExecutor} from '${root}open-sse/executors/codex.js';export const getExecutor=provider=>provider==='codex'?new CodexExecutor():new DefaultExecutor(provider);`, context);
  }
  if (parent === codex) {
    if (specifier === '../translator/concerns/image.js') {
      return nextResolve('data:text/javascript,export function fetchImageAsBase64(){throw new Error("Unexpected image prefetch");}', context);
    }
    if (specifier === '../config/providerModels.js') {
      return nextResolve('data:text/javascript,export const getModelUpstreamId=(_,model)=>model,getProviderModels=()=>[];', context);
    }
    if (specifier === '../providers/thinkingLevels.js') {
      return nextResolve('data:text/javascript,export const getThinkingLevels=()=>null;', context);
    }
  }
  if (executorDependencies.get(specifier)?.some(path => parent === root + path)) {
    return nextResolve(stub, context);
  }
  // The pre-reviewed resolvers cover exact unrelated seams. No host module
  // tree is mounted; an undeclared path fails instead of importing live code.
  return routeResolve(specifier, context, (spec, ctx) => coreResolve(spec, ctx, nextResolve));
}
