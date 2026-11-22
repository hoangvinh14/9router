import {pathToFileURL} from 'node:url';
// Map exact unrelated dependencies only when imported by actual core or native
// JSON owner. No mapping for error, upstreamHeaders, formats, runtime or ledger.
const core=new Set([
 '../services/provider.js','../translator/index.js','../translator/concerns/thinkingUnified.js','../translator/formats/claude.js',
 '../utils/streamHandler.js','../services/tokenRefresh.js','../utils/requestLogger.js','../config/providerModels.js','../config/providers.js',
 '../utils/bypassHandler.js','@/lib/usageDb.js','../executors/index.js','../config/grokCli.js','./chatCore/requestDetail.js',
 './chatCore/sseToJsonHandler.js','./chatCore/streamingHandler.js','../utils/clientDetector.js','../utils/toolDeduper.js',
 '../utils/opencodeFingerprint.js','../rtk/caveman.js','../rtk/ponytail.js','../rtk/customPrompt.js','../rtk/index.js',
 '../rtk/headroom.js','../rtk/pxpipe.js','../providers/capabilities.js','../translator/concerns/modality.js',
 '../translator/concerns/prefetch.js','../translator/concerns/toolCall.js','../utils/sessionManager.js',
]);
const owner=new Set(['../../translator/index.js','../../translator/concerns/claudeMessage.js','../../translator/response/ollama-to-openai.js',
 '../../utils/usageTracking.js','./sseToJsonHandler.js','../../shared/clineEnvelope.js','./requestDetail.js','@/lib/usageDb.js',
 '../../utils/claudeCloaking.js','../../utils/opencodeFingerprint.js','../../translator/schema/index.js']);
const combo=new Set(['./accountFallback.js','../providers/capabilities.js','./model.js','../translator/formats/gemini.js','./emptyFailover.js','./systemoneRouter.js']);
export function resolve(specifier,context,nextResolve){
 if((context.parentURL==='file:///app/open-sse/handlers/chatCore.js'&&core.has(specifier))||
    (context.parentURL==='file:///app/open-sse/handlers/chatCore/nonStreamingHandler.js'&&owner.has(specifier))||
    (context.parentURL==='file:///app/open-sse/services/combo.js'&&combo.has(specifier)))
  return nextResolve(pathToFileURL('/app/tests/fixtures/budget/core-stubs.mjs').href,context);
 return nextResolve(specifier,context);
}
