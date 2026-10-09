import config from '../vitest.config.js';

// Explicit-only owned-CA fixture, not auto-discovered by the ordinary suite.
// This config preserves aliases and test deadlines; use the isolated shell runner.
export default {
  ...config,
  test: { ...config.test, include: ['unit/accounting-queued-verified-tls-loopback.fixture.js'] },
};
