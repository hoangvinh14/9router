# Host build attempt 1 — missing declared optional dependency

`bb279601d` failed exit1. Advisor counsel preceded diagnosis. All runner/build logs, exits and proxy events were archived before inspection; all 1,256 source hashes and the helper hash matched the manifest. No artifacts were missing.

## Actual result
Next16.3.8 webpack started an optimized production build and failed:

`./open-sse/shared/awsCredentials.js — Module not found: Can't resolve '@aws-sdk/credential-providers'`

Import trace: `open-sse/executors/bedrock.js` → `src/app/api/providers/validate/route.js`. `package.json` declares this optional package at `^3.1135.0`, but the current root installation has no package and `require.resolve()` reports MODULE_NOT_FOUND. The current package-lock has no `node_modules/@aws-sdk/credential-providers` entry. The existing AWS lazy literal import is visible to webpack; it was not changed by this pricing work.

This establishes a missing build dependency in the current host environment. It is not proof that pricing code compiles, that this is the only build error, or that AWS runtime functionality is correct. There is no evidence of timeout/OOM. BUILD_ID and standalone output are absent. Asset copy did not run.

The proxy allowed recorded Google Fonts destinations and denied one registry.npmjs.org CONNECT. That denied registry attempt is retained, not silently allowed; logs do not identify its exact initiating code. No dependency installation occurred. Font preflight success was not substituted for build acceptance.

## Disposition
Stop before another build. No source patch to remove or hide AWS support, no root dependency/lockfile modification, no same-input green rerun or resource tuning. A new environment dependency setup requires explicit approval: preferably install declared dependencies in a fresh disposable staging tree, retain resolution/version/integrity provenance and use it for a separately manifested build under the same isolation/profile. Do not use production HOME/data/credentials or the live Docker volume/container. Further compile failures remain possible.

Browser acceptance remains independently inconclusive: cached Chromium version succeeded but the launch diagnostic timed out before CDP. Removing concurrent build activity does not prove contention caused that timeout. No sandbox disabling, new browser install or acceptance downgrade is authorized.

UI helper/API tests27 and lint5, broader DB/pricing/API275, actual fixture TCP11/h2c1 remain scoped to their inputs; they do not substitute for build/browser/Docker. Current live Docker0.5.104 remains untouched. User owns replacement; no shutdown redesign, commit or push.
