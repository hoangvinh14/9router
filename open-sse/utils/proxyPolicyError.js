// Local resolved-policy refusal, not an upstream/network failure. A required
// unavailable pool cannot become available by retrying the same pinned options.
export class ProxyPoolUnavailableError extends Error {
  constructor() {
    super('[ProxyFetch] Proxy required pool unavailable (strictProxy=true)');
    this.name = 'ProxyPoolUnavailableError';
  }
}
