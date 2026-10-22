# 9Router Embeddings Tests

Unit tests for the `/v1/embeddings` endpoint implementation.

## Setup

Install test dependencies from the `tests/` directory:

```bash
cd tests/ && npm install
```

## Running Tests

From the `tests/` directory:

```bash
npm test
```

Or run vitest directly with npx:

```bash
npx vitest run --reporter=verbose --config ./vitest.config.js
```

## Pricing browser acceptance

Install the matching browser from this directory with `npx playwright install chromium`.
With Node 24 and an existing compiled standalone artifact, run:

```bash
PRICING_STANDALONE=/absolute/path/to/standalone npm run test:pricing-browser
```

The runner reserves `127.0.0.1:23128`, starts its own compiled server with a fresh
temporary SQLite database, and stops the server and browser on exit. It blocks
non-local browser requests and supplies catalog fixtures at the server fetch
boundary. It writes results, server logs and a mobile screenshot to the printed
temporary directory. It never connects to a production instance.

To smoke-test an already-built container image without exposing any host port:

```bash
PRICING_TEST_IMAGE=your-test-image node browser/pricing-container-smoke.mjs
```

This requires Docker daemon access. It creates a uniquely named container with
networking disabled, uses disposable data, tests exact pricing and scheduler
state across restart, and removes the container on exit.

## Test Files

| File | What it tests |
|------|--------------|
| `unit/embeddingsCore.test.js` | `open-sse/handlers/embeddingsCore.js` — core logic: body builder, URL router, headers, handler flow |
| `unit/embeddings.cloud.test.js` | `cloud/src/handlers/embeddings.js` — cloud worker handler: auth, validation, rate limits, CORS |

## Coverage Summary (59 tests)

### `embeddingsCore.test.js` (36 tests)
- `buildEmbeddingsBody`: single string, array, encoding_format, default float
- `buildEmbeddingsUrl`: openai, openrouter, openai-compatible-*, unsupported providers
- `buildEmbeddingsHeaders`: per-provider header sets, fallback to accessToken
- `handleEmbeddingsCore` input validation: missing, wrong type, null, empty
- `handleEmbeddingsCore` success: response format, CORS, Content-Type, callbacks
- `handleEmbeddingsCore` errors: 400/429/500, network error, invalid JSON
- `handleEmbeddingsCore` token refresh: 401 retry, graceful fallback

### `embeddings.cloud.test.js` (23 tests)
- CORS OPTIONS: 200 response, empty body, correct headers
- Authentication: missing key, bad format, old-format key, wrong key value, valid key
- Body validation: invalid JSON, missing model, missing input, bad model
- Happy path: single string, array, correct delegation, CORS header, machineId override
- Rate limiting: all accounts rate-limited → 503 + Retry-After, no credentials → 400
- Error propagation: non-fallback errors passed through, 429 exhausts accounts
- machineId override: validates key, rejects wrong key
