// Internal candidate composition: counted transport by default, isolated TLS explicitly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const tls = process.argv.length === 3 && process.argv[2] === '--tls';
if (process.platform !== 'linux' || process.version !== 'v24.21.0' || (!tls && process.argv.length !== 2) ||
    process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('Clean pinned Linux Node required');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const files = [
  'tests/fixtures/budget/claude-conversion-restart.mjs', 'tests/fixtures/budget/claude-conversion-cases.mjs', 'src/lib/accounting/claude-converted-request.js', 'src/lib/accounting/claude-tool-continuity.js', 'open-sse/utils/claude-budget-output.js',
  'src/lib/accounting/profile-registry.js', 'src/lib/accounting/budget-chat-route.js', 'src/lib/accounting/router-dispatch-context.js',
  'src/app/api/v1/messages/route.js', 'src/app/api/v1/responses/route.js', 'src/app/api/v1/chat/completions/route.js',
  'src/lib/db/helpers/kvStore.js', 'src/lib/pricing/openai-standard-reference.js', 'src/lib/accounting/openai-dispatch-context.js',
  'open-sse/providers/registry/openai.js', 'open-sse/utils/accounted-openai-chat-stream.js',
  'open-sse/translator/response/openai-to-claude.js', 'open-sse/utils/usageTracking.js', 'open-sse/translator/request/openai-responses.js', 'open-sse/translator/response/openai-responses.js',
  'open-sse/translator/concerns/chunk.js', 'open-sse/translator/concerns/usage.js',
  'open-sse/translator/concerns/reasoning.js', 'open-sse/translator/concerns/claudeMessage.js',
  'open-sse/translator/concerns/finishReason.js', 'open-sse/handlers/chatCore/sseToJsonHandler.js',
  'open-sse/transformer/streamToJsonConverter.js', 'src/lib/accounting/codex-dispatch-context.js',
  'src/sse/handlers/chat.js', 'src/sse/services/model.js', 'src/sse/services/keyAccess.js', 'src/sse/services/auth.js',
  'src/sse/services/accounted-route.js', 'src/sse/utils/logger.js',
  'src/shared/constants/keyAccess.js', 'src/shared/constants/providers.js', 'src/shared/constants/providersDisplay.js', 'src/shared/utils/keyAccess.js',
  'src/lib/db/helpers/jsonCol.js', 'src/lib/db/repos/settingsRepo.js', 'src/lib/db/schema.js',
  'src/lib/db/repos/connectionsRepo.js', 'src/lib/db/repos/proxyPoolsRepo.js', 'src/lib/network/connectionProxy.js',
  'src/lib/db/adapters/nodeSqliteAdapter.js', 'src/lib/db/adapters/nodeClosure.js',
  'src/lib/accounting/oauth-refresh.js', 'src/lib/accounting/internal-binding.js', 'src/lib/accounting/installed-service.js', 'src/lib/accounting/request-boundary.js', 'src/lib/accounting/mutation-barrier.js',
  'src/lib/accounting/node-routing-snapshot.js', 'src/lib/accounting/node-outer-transaction.js', 'src/lib/accounting/sql-operation-scope.js',
  'src/lib/accounting/node-attempt-ledger.js', 'src/lib/accounting/node-key-policy.js', 'open-sse/utils/ordinary-dispatch.js', 'src/lib/accounting/node-anthropic-account.js',
  'src/lib/accounting/anthropic-reference-price.js', 'src/lib/accounting/responses-usage.js', 'src/lib/accounting/anthropic-dispatch-context.js', 'src/lib/accounting/anthropic-usage.js',
  'src/lib/accounting/attempt-payload.js', 'src/lib/accounting/process-state.js', 'src/lib/accounting/budget-windows.js',
  'src/lib/accounting/exact-money.js', 'src/lib/accounting/terminal-cost.js', 'src/lib/pricing/claude-standard-reference.js', 'src/lib/pricing/constants.js', 'src/lib/pricing/decimalMoney.js',
  'open-sse/services/model.js', 'open-sse/services/combo.js', 'open-sse/services/capacityAdapter.js',
  'open-sse/services/accountFallback.js', 'open-sse/services/systemoneRouter.js',
  'open-sse/handlers/chatCore.js', 'open-sse/handlers/chatCore/nonStreamingHandler.js',
  'open-sse/handlers/chatCore/streamingHandler.js', 'open-sse/utils/accounted-anthropic-stream.js', 'open-sse/utils/accounted-responses-stream.js',
  'open-sse/utils/streamHandler.js', 'open-sse/utils/responsesStreamHelpers.js', 'open-sse/utils/streamHelpers.js',
  'open-sse/utils/sseConstants.js', 'open-sse/translator/concerns/toolCall.js',
  'open-sse/executors/codex.js', 'open-sse/config/codexInstructions.js', 'open-sse/utils/codexToolSchema.js',
  'open-sse/utils/sessionManager.js', 'open-sse/translator/formats/responsesApi.js', 'open-sse/translator/formats/gemini.js', 'open-sse/translator/concerns/json.js',
  'open-sse/translator/schema/index.js', 'open-sse/translator/schema/roles.js',
  'open-sse/translator/schema/blocks.js', 'open-sse/translator/schema/finishReasons.js',
  'open-sse/translator/schema/streamEvents.js', 'open-sse/translator/schema/defaults.js', 'open-sse/providers/registry/codex.js', 'open-sse/providers/models/helpers.js',
  'open-sse/executors/base.js', 'open-sse/executors/default.js', 'open-sse/utils/geminiLongDecode.js', 'open-sse/shared/kiroIdentity.js', 'open-sse/config/kiroClient.js', 'open-sse/providers/registry/claude.js', 'open-sse/providers/registry/anthropic.js', 'open-sse/providers/shared.js', 'src/mitm/antigravityIdeVersion.js',
  'open-sse/config/runtimeConfig.js', 'open-sse/config/errorConfig.js', 'open-sse/translator/formats.js', 'open-sse/translator/concerns/paramSupport.js',
  'open-sse/utils/error.js', 'open-sse/utils/upstreamHeaders.js', 'open-sse/utils/accountingResponse.js',
  'open-sse/utils/clientDetector.js', 'open-sse/utils/modelMarkers.js', 'open-sse/utils/claudeCliVersion.js',
  'open-sse/translator/concerns/systemPrompt.js', 'open-sse/rtk/systemInject.js',
  'open-sse/utils/debugLog.js', 'open-sse/utils/reasoningContentInjector.js',
  'tests/fixtures/budget/route-readers-loader.mjs', 'tests/fixtures/budget/route-chat-stubs.mjs',
  'tests/fixtures/budget/core-loader.mjs', 'tests/fixtures/budget/core-stubs.mjs',
  'tests/fixtures/budget/composed-loader.mjs', 'tests/fixtures/budget/composed-stubs.mjs',
  'tests/fixtures/budget/composed-account-db.mjs', 'tests/unit/budget-composed.test.mjs',
  'tests/fixtures/budget/module-scope.json',
];
files.push('tests/fixtures/budget/commonjs-scope.json');
const args = ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib'];
if (tls) {
  files.push('tests/fixtures/budget/composed-undici.mjs', 'open-sse/utils/proxyFetch.js', 'tests/fixtures/budget/composed-tls-bootstrap.mjs');
  const undici = path.resolve(repo, 'node_modules/undici');
  if (fs.realpathSync(undici) !== undici || !fs.statSync(undici).isDirectory()) throw new Error('Unsafe undici fixture input');
  args.push('--unshare-user', '--unshare-net', '--uid', '0', '--gid', '0', '--cap-drop', 'ALL',
    '--cap-add', 'CAP_NET_ADMIN', '--cap-add', 'CAP_SETPCAP', '--symlink', 'usr/bin', '/bin',
    '--ro-bind', undici, '/app/node_modules/undici');
}
if (fs.existsSync('/lib64')) args.push('--ro-bind', '/lib64', '/lib64');
for (const file of files) {
  const source = path.resolve(repo, file);
  if (fs.realpathSync(source) !== source || !fs.statSync(source).isFile()) throw new Error(`Unsafe fixture input: ${file}`);
  args.push('--ro-bind', source, file.endsWith('/commonjs-scope.json') ? '/app/src/mitm/package.json' : file.endsWith('/module-scope.json') ? '/app/package.json' : `/app/${file}`);
}
args.push('--tmpfs', '/run/9router');
args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', fs.realpathSync(process.execPath), '/runtime/node',
  '--chdir', '/app', '--remount-ro', '/', '--', '/runtime/node', '--unhandled-rejections=strict');
if (tls) args.push('/app/tests/fixtures/budget/composed-tls-bootstrap.mjs');
else args.push('--experimental-loader', '/app/tests/fixtures/budget/composed-loader.mjs', '--test', '/app/tests/unit/budget-composed.test.mjs');
const result = spawnSync('/usr/bin/bwrap', args, {
  env: { PATH: '/usr/bin:/bin', HOME: '/tmp', DATA_DIR: '/tmp/fixture-data', TMPDIR: '/tmp', TZ: 'UTC',
    NODE_ENV: 'test', BUDGET_PURE_SANDBOX: '1', BUDGET_OUTER_NET: fs.readlinkSync('/proc/self/ns/net'),
    ...(tls ? { BUDGET_COMPOSED_TLS: '1', BUDGET_OUTER_USER: fs.readlinkSync('/proc/self/ns/user') } : {}) },
  stdio: 'inherit', timeout: tls ? 180000 : 120000,
});
if (result.error || result.signal || result.status !== 0) {
  console.error('Composed sandbox failed; no host fallback', result.error?.code, result.signal, result.status);
  process.exitCode = 1;
}
