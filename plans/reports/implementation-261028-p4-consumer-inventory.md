# P4 named key-route prerequisite — consumer inventory

Inventory was recorded before the guard change on source base b41dca0a,
branch feat/weekly-monthly-budget. Historical descriptions below are retained;
the execution reconciliation at the end supersedes their “not implemented” state.

## Current callers

- `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`: same-origin
  browser GET/list, default-key POST, named-key POST, PUT activation/ACL, DELETE.
  Browser session and automatic Origin on mutations fit shared guard. Preserve
  `{keys}`,201`{key,name,id,machineId}`, `{key}` and delete-message response shapes.
  Budget state must remain keyed and separate from ACL/toggle responses.
- `src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js`,
  MITM client and media-provider examples/cards/combo page: same-origin browser
  key listing. Preserve reveal/list behavior after authenticated request.
- `cli/src/cli/commands/connect.js`: actual dashboard password login, extracts
  auth_token cookie, lists keys, creates named key if missing. Its helper omits
  mutation Origin. Add exact configured-server Origin for supported management
  mutations without accepting redirects or broadening server authentication.
  Existing `tests/unit/cli-connect.test.js` is an affected consumer.
- `cli/src/cli/api/client.js`: legacy interactive TUI API helper sends only
  x-9r-cli-token. `getApiKeys/createApiKey/deleteApiKey` use key routes. Callers:
  `terminalUI.js` background header, `menus/apiKeys.js`, `menus/cliTools.js`.
  A route-level management guard intentionally cannot accept that inference/CLI
  token as management authentication. Preserve functionality by supported
  dashboard login/cookie or verified direct-local login-disabled flow; never
  add token exemption. Existing client has no session login/cookie handling.
  Background read must not prompt or falsely show “no keys” on401.
- Repo tests invoke key repositories directly and route consumers indirectly.
  Inventory exact test imports before implementation; add auth-first actual-route
  security and actual HTTP client controls, not only mocked CLI request shapes.

## Candidate compatibility direction (not yet implemented)

For explicit TUI key actions, offer dashboard-password login only when required;
keep cookie in memory bound to exact configured origin, clear on origin change
or expired session, never forward secrets/cookies cross-origin. Do not auto-use
public default password or persist a password/session. No background prompt;
show authentication-required/unavailable truthfully. Connect already has
password flow and needs Origin, not a new token contract. Browser flows continue
same-origin authenticated requests. Any unsupported consumer conflict requires
STOP/escalation rather than weakening auth/CSRF/peer guards.

Phase2 must verify key CRUD/default/reveal/toggle/delete, ACL inference, expired
session/no implicit credentials, login-disabled direct-loopback only and forged
peer/Origin failures before completion. CLI package is independently versioned;
no CLI release/pack/publication is authorized by P4 implementation.

## Execution reconciliation

Implemented memory-only exact-origin dashboard session management in
`cli/src/cli/api/managementSession.js`, explicit TUI password prompts via
`utils/managementLogin.js`, truthful background header status, and mutation Origin
in `connect.js`. No CLI/inference-token exemption was added to management routes.
Browser caller response shapes remain unchanged; per-key budget state is separate
from ACL and activation responses. Invalid session/origin changes clear cookie
authority; redirects and cross-origin targets are refused. No password/session is
persisted by this helper. Explicit `connect --password` retains its existing argv
secret exposure trade-off; prefer the interactive TUI password prompt where possible.

Evidence: CLI-session/connect unit tests; proxy-cache/key-security/connect69/69;
actual authenticated CLI login/list/create/pause/resume/delete/tombstone flow in
final18-check browser receipts on both adapters; actual Endpoint ACL restriction,
inference refusal and activation toggles preserve policy/spend. Detached shipping
smoke verifies dashboard JWT/key creation and real production-OFF panel. See
[phase2 receipt](./implementation-261028-p4-phase2-progress.md). Existing stateful
models-route test failures are independently reproduced on exact base, not waived
as CLI compatibility failures. No package release/publication was performed.
