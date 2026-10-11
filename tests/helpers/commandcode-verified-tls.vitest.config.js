import config from '../vitest.config.js';
// Explicit-only private CA fixture; never auto-discover without isolated runner.
export default {
  ...config,
  test: { ...config.test, include: ['unit/accounting-commandcode-verified-tls.fixture.js'] },
};
