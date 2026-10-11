import config from '../vitest.config.js';
// Explicit private-CA invocation; the normal loopback suite remains HTTP.
export default {
  ...config,
  test: { ...config.test, include: ['unit/accounting-queued-fusion-loopback.test.js'] },
};
