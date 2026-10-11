import config from '../vitest.config.js';
// Explicit-only owned private CA fixture; never auto-discover without its runner.
export default {
  ...config,
  test: { ...config.test, include: ['unit/accounting-kiro-verified-tls.fixture.js'] },
};
