// Fail-fast downstream only. Real route bodies/classifier/driver stay unmodified.
const blocked=()=>{throw new Error('fixture route downstream reached');};
export const handleChat=blocked, initTranslators=blocked, clearAccountError=blocked, getProviderCredentials=blocked,
 isValidApiKey=blocked, markAccountUnavailable=blocked, getSettings=blocked, getKeyAccessContext=blocked, enforceKeyAccessResolved=blocked;
export const PROVIDER_MODELS={};
export const GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS=100;
