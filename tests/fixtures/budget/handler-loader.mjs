import { pathToFileURL } from 'node:url';
const unrelated = new Set([
 'open-sse/index.js','../services/auth.js','../services/antigravityQuota.js','../services/model.js',
 '../services/tokenRefresh.js','../services/keyAccess.js','../services/systemoneRouter.js','../utils/logger.js',
 '@/lib/localDb','@/lib/usageDb.js','@/lib/headroom/detect','@/lib/pxpipe/loader.js','@/lib/pxpipe/events.js',
 '@/lib/network/connectionProxy.js','@/shared/constants/providers.js','@/shared/constants/providers','@/shared/utils/ssrfGuard.js',
 'open-sse/handlers/chatCore.js','open-sse/handlers/embeddingsCore.js','open-sse/handlers/fetch/index.js',
 'open-sse/handlers/imageGenerationCore.js','open-sse/handlers/imageProviders/index.js','open-sse/handlers/search/index.js',
 'open-sse/handlers/sttCore.js','open-sse/handlers/systemoneCore.js','open-sse/handlers/ttsCore.js','open-sse/handlers/videoCore.js',
 'open-sse/config/runtimeConfig.js','open-sse/services/combo.js','open-sse/services/capacityAdapter.js','open-sse/services/projectId.js',
 'open-sse/translator/formats.js','open-sse/utils/error.js','open-sse/utils/upstreamHeaders.js','open-sse/utils/bypassHandler.js',
 'open-sse/utils/sessionManager.js','open-sse/utils/modelMarkers.js',
]);
export function resolve(specifier,context,nextResolve){
 if(specifier==='@/shared/constants/keyAccess.js')return nextResolve(pathToFileURL('/app/src/shared/constants/keyAccess.js').href,context);
 if(specifier==='open-sse/utils/accountingResponse.js')return nextResolve(pathToFileURL('/app/open-sse/utils/accountingResponse.js').href,context);
 if(specifier==='@/lib/db/repos/settingsRepo.js')return nextResolve(pathToFileURL('/app/src/lib/db/repos/settingsRepo.js').href,context);
 if(specifier==='@/lib/dataDir.js')return nextResolve(pathToFileURL('/app/src/lib/dataDir.js').href,context);
 if(specifier==='@/lib/accounting/request-boundary.js')return nextResolve(pathToFileURL('/app/src/lib/accounting/request-boundary.js').href,context);
 if(context.parentURL?.startsWith('file:///app/src/sse/handlers/') && unrelated.has(specifier))return nextResolve(pathToFileURL('/app/tests/fixtures/budget/handler-stubs.mjs').href,context);
 return nextResolve(specifier,context);
}
