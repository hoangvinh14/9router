import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';
import { assertAccountingIsolation } from './fixtures/accounting/isolation-attestation.mjs';
assertAccountingIsolation();
export default mergeConfig(base,defineConfig({cacheDir:`${process.env.R1_ISOLATED_ROOT}/cache/vite`,test:{
  pool:'forks',maxWorkers:1,fileParallelism:false,
  setupFiles:['./fixtures/accounting/isolated-setup.js'],
}}));
