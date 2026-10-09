# Feature WIP checkpoint — branch isolation

## Operator decision

The operator approved a new branch and a checkpoint of the complete feature WIP, including its existing foundation, dependencies, tests and documentation. Branch: `feat/api-key-quota-budget-pricing`, based on `a99cf572`. The local `master` ref stays at that commit; no upstream fetch/pull/sync, push, merge, release or production activation is authorized.

This is a checkpoint, not feature acceptance. A is closed for sequential delivery with historical build/browser evidence; B remains active and C–E pending. All13AC, remaining provider/node/schema/OAuth/transport authority and current runtime/performance acceptance remain mandatory. Production enforcement remains OFF and app handlers remain synchronous by default.

## Included scope

Existing accounting identity/binding/ownership/durable adapters, ledger/policy/recovery foundation; reference pricing/memo/catalog/guarded management/UI; request-local accounting owners and transport prerequisites; bounded internal group writer/coordinator/queued service/Base option; native/helper/adaptor/management tests; plans, reports, browser fixtures and operator documentation. Existing retry/cancellation/proxy bootstrap, image DNS pinning, listener-lifetime, Tailscale login allowlist and regression-comparator changes are retained as documented feature prerequisites and security/verification repairs, not new product acceptance claims. Partial staging of only the newest queue files would omit their untracked foundation dependencies.

`docs/API_KEY_BUDGETS.md` is intentionally included despite the repository's general `docs/*` ignore rule. No general ignore-policy changes.

## Excluded and security limitations

All `.pi/` session/tool artifacts remain local and excluded. No operator database, `.env`, raw logs, build output, images/traces, generated certificates/private keys or installed dependency directory is included. `.env.example` documents only the management-origin option.

A bounded local scan of every selected file checked credential-bearing paths, binary data, private-key markers, common provider/AWS/GitHub token signatures, JWTs, credential URLs and credential literals. Candidate matches were reviewed as explicit dummy/disposable fixtures or source expressions; no real credential was identified. This is not a comprehensive security audit or dedicated secret-scanner certificate. Management auth/Origin/redaction, SSRF/proxy/TLS and durable accounting still retain their documented scope limits and outstanding acceptance obligations.

## Verification before commit

Latest native live gate: `b8f7cff1f`, 104/104 assertions across4files, no skips; test/lint/whitespace0. Native17 + actual service16 + live helper59 + parser12; LSP native file clean. Earlier exact receipts and failures remain in package reports; overlapping runs must not be summed as unique full-suite coverage. A build/browser predates B and is not current B acceptance.

Checkpoint gate `b8677e440` **PASS139/139 assertions across10 declared files, no failed/pending/todo**. Artifact: `/tmp/9router-feature-checkpoint-7hS5BP/{results.json,scope.json,inputs.json,test.log,comparator.log,lint.log,whitespace.log}`. TEST/COMPARATOR/LINT/STAGED_WHITESPACE/SOURCE_STABILITY_EXIT all0. Scope: native queued17, queued request14, actual queued service16, identity4, comparator6, offline policy security23, pricing management38, pricing memo9, queued authority11 and Tailscale URL1. Lint is scoped to the modified native test and browser runner, not all345 files. Disposable HOME/DATA_DIR; exact inventory comparison; all345 staged input hashes unchanged during execution. The post-gate update to this report changes documentation only and is restaged before commit.

Staged whitespace checking also includes newly tracked files; it initially detected one trailing space in `tests/browser/run-pricing-editor.mjs`, which was removed and the runner restaged/scoped-linted. Historical unstaged diff checks did not cover untracked files. No assertion, deadline or security boundary was relaxed.

This finite scoped gate is not full-product build/browser/regression or all-adapter acceptance. Never bypass hooks or rewrite `master` to create this checkpoint.
