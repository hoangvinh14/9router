// Explicit fail-fast unrelated dependency surface for entry-refusal tests only.
// No production import jobs, credentials, providers or network implementation.
const blocked = () => { throw new Error('fixture downstream helper reached'); };
export const AI_PROVIDERS = {};
export const HTTP_STATUS = { BAD_REQUEST: 400 };
export const DEFAULT_HEADROOM_URL = 'https://unused.invalid';
export const warn = () => {};
export const errorResponse = (status, message) => Response.json({error:message},{status});
export const unavailableResponse=blocked, getSettings=blocked, getCombos=blocked, getCustomModels=blocked, getProviderConnectionById=blocked;
export const getProviderCredentials=blocked, markAccountUnavailable=blocked, clearAccountError=blocked, extractApiKey=blocked, isValidApiKey=blocked;
export const getModelInfo=blocked, getComboModels=blocked, updateProviderCredentials=blocked, checkAndRefreshToken=blocked;
export const isRequestedTargetAllowed=blocked, getKeyAccessContext=blocked, enforceKeyAccess=blocked, enforceKeyAccessResolved=blocked, enforceKeyAccessProvider=blocked, filterAdapterModels=blocked;
export const handleChatCore=blocked, handleEmbeddingsCore=blocked, handleFetchCore=blocked, handleImageGenerationCore=blocked, getImageAdapter=blocked;
export const handleSearchCore=blocked, handleSttCore=blocked, handleSystemoneCore=blocked, handleTtsCore=blocked, handleVideoProxyCore=blocked, getVideoConfig=blocked, sanitizeSecrets=blocked;
export const handleComboChat=blocked, handleFusionChat=blocked, detectRequiredCapabilities=blocked, getComboModelsFromData=blocked;
export const augmentModelsWithCapacityAdapter=blocked, withCapacityAdapterStripping=blocked, getActiveAdapterStrategy=blocked;
export const upstreamResponseHeaders=blocked, handleBypassRequest=blocked, resolveSessionIdentity=blocked, stripModelContextMarker=blocked, detectFormatByEndpoint=blocked;
export const getProjectIdForConnection=blocked, resolveSmartChoice=blocked, handleAntigravityQuotaError=blocked, clearAntigravityStrikes=blocked;
export const getTransform=blocked, appendPxpipeEvent=blocked, resolveConnectionProxyConfig=blocked, resolveProviderId=blocked, assertPublicUrlResolved=blocked, saveRequestUsage=blocked;
export const maskKey=blocked, debug=blocked, info=blocked, error=blocked, request=blocked;
