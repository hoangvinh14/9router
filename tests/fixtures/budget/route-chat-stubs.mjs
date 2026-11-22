// Only the account producer and core are replaced; route selection is real.
const blocked = () => { throw new Error('Unexpected helper, retry or live read'); };
export const getSettings = blocked;
export const getProviderCredentials = (...args) => globalThis.routeFixture.select(...args);
export const handleChatCore = args => globalThis.routeFixture.core(args);
export const getModelAliases = blocked, getComboByName = blocked, getProviderNodes = blocked, getProviderConnections = blocked;
export const getAccountingAdapter = blocked, getAdapter = blocked;
export const markAccountUnavailable = blocked, clearAccountError = blocked, checkAndRefreshToken = blocked, updateProviderCredentials = blocked;
export const extractApiKey = request => request.headers.get('authorization')?.slice(7);
export const isValidApiKey = blocked, handleAntigravityQuotaError = blocked, clearAntigravityStrikes = blocked;
export const getProjectIdForConnection = blocked, resolveSmartChoice = blocked;
export const getTransform = blocked, appendPxpipeEvent = blocked, upstreamResponseHeaders = blocked;
export const DEFAULT_HEADROOM_URL = 'https://unused.invalid';
export const handleBypassRequest = () => null, resolveSessionIdentity = () => null;
export const stripModelContextMarker = model => ({ model });
export const detectFormatByEndpoint = () => 'claude';
export const extractTextContent = blocked;
export const peekStreamForContent = blocked, reconstructStream = blocked, isNoRetryFinish = blocked;
export const getCapabilitiesForModel = (_provider, model) => ({ vision: model === 'fixture-vision' });
