# Usage diagnosis attempt 1 — collection failure, no causal result

Task `b357bc75b` exited 1. Counsel was taken before reading/diagnosing output. Raw artifacts and hashes are in `receipt.json`; original temporary root `/tmp/9router-usage-diagnosis-qx2rXF` is retained.

Vitest reports `There are some problems in resolving the mocks API` and zero tests/zero assertions. The assistant-authored probe imports `vi` from the absolute `vitest/dist/index.js` path rather than literal `vitest`, which the mocking transform expects (or explicit globals). No Node scenario executed; actual backend selection and counts are NOT established. The parent deliberately stops after this failure, so SQL.js is NOTRUN. This is a harness collection defect, not evidence supporting or contradicting timestamp dedup causality and not a product regression finding.

Frozen R4 source hashes rechecked unchanged. No production analytics/test assertions changed, no installation or rerun. Original 118/120 affected result remains FAILED. Static source observation about timestamp dedup remains a hypothesis for the two original failures, not demonstrated causality.

## Smallest follow-up proposed
With approval, use a fresh temporary root/copy, change the test import to literal `vitest`, and configure an exact `vitest` alias to the already installed tests package entry (no install). Preserve all four scenario inputs, expectation strength, backend selection assertions, timeout and offline/disposable boundaries. Execute the corrected probe once, stopping and taking counsel again on any failed verification. Retain this failed attempt separately; do not overwrite its files or merge it into a pass.
