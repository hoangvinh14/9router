import config from '../vitest.config.js';

// Explicit-only matched disposable service benchmark, never ordinary suite work.
export default {
  ...config,
  test: { ...config.test, include: ['unit/accounting-group-io-benchmark.fixture.js'] },
};
