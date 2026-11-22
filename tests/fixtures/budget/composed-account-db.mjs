// Narrow import facade for the real repositories; the fixture supplies the DB.
export { getProviderConnections, updateProviderConnection } from '../../../src/lib/db/repos/connectionsRepo.js';
export { getProxyPools, getProxyPoolById } from '../../../src/lib/db/repos/proxyPoolsRepo.js';
export { getSettings } from '../../../src/lib/db/repos/settingsRepo.js';

// The internal candidate authenticates via its owner-bound accounting identity.
export function validateApiKey() {
  throw new Error('Unexpected ordinary API-key validation in candidate fixture');
}
