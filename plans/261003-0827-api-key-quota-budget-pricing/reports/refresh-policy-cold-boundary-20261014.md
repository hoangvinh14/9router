# Cold runtime attribution and synchronous refresh-policy candidate

## Contract

Continue full confirmed product goals and B/F→G/T/I/V→C/D/E/all13AC; no deadline/prewarm/freshness/cache/durability/ownACK changes or activation. Candidate targets import dependency only, not fewer accounting operations. No delegation/commit/push/live provider/production DB.

## Runtime attribution consumed

`b520c956c` FAILED overall,original1864inputs stable. ONE Vitest then ONE native Node ran identical external storage fixture: real SQL.js/writer/coverage/lifecycle,4seeded metadata resources,32freshregistrycaptures,448SQLget/1184fsread/checksum544 in both,credentialdriftrefused/noaccountingrows. Vitest gate timed out5s but late diagnostic returned result; not positive gate acceptance or source of permission. Nativeexit0.

| Stage | Vitest ms | Native ms |
|---|---:|---:|
| Cold imports |4853.491|1862.529|
| Setup durable fixture/resources |1181.342|918.894|
|32current captures|366.202|295.382|

Registry-storage prerequisite only, not authenticated upload/private capability/producer/network/price/ownACK. One sample/orderbias/wrapperoverhead/not statistical speedup; native alias-only loader covers existing `@/` import. Does not replace original acceptance. Supports cold dependency investigation, not claims all performance due to Vitest.

## Source-grounded candidate

`open-sse/executors/base.js` imports `shouldRefreshCredentials` from `oauthCredentialManager.js`. `needsRefresh()` only calls that synchronous decision. Manager imports `getRefreshLeadMs` and active refresh execution from `tokenRefresh.js`, which eagerly imports `tokenRefresh/providers.js`, including unrelated Kiro IdP implementation. Current policy only needs timestamp parsing, provider maxRefreshAge, REFRESH_LEAD_MS and default buffer; none needs network execution functions.

Candidate: extract exact pure policy functions/constants into `services/credentialRefreshPolicy.js`; Base imports pure module. Existing manager/tokenRefresh public exports remain backward-compatible via re-exports. Active network refresh implementations and all accounting checks/read sequences remain unchanged. No lazy authority frame or shifted app verification outside deadline. Module initialization/cycles/mock seams require regression evidence; current static direct-relative graph model284files isn't complete measured runtime fanout. Savings unknown.

## Test-first gate

New `tests/unit/oauth-refresh-policy-boundary.test.js`:2finite tests trap provider-refresh/IdP module loads on Base import, check real sync decisions; pure module timestamp aliases/explicitclock/Codexstale/leadalias. `b2855432e` FAILED/consumed0pass2fail/stable1865:Base load reached provider-refresh trap via tokenRefresh import; purepolicy missingmodule. No candidate productcode before consuming red. Existing assertions/deadlines/historicalfailures intact.

## Implementation candidate rejected and fully reverted

Extracted unchanged policy into `open-sse/services/credentialRefreshPolicy.js`:getRefreshLeadMs/defaultbuffer/Codexmaxage/timestampaliases/stalewindow/shouldRefresh. Base imports purepolicy instead of manager; manager and tokenRefresh re-export original names, remaining network implementation unchanged. Three modified existing modules plus1newpuremodule; additional compatibility test verifies exact exportidentity/null/zero/alias/threshold cases. Backups `refresh-policy-{base,manager,token}-before.js` under temp evidence directory. Original producer source/assertions and all resource/accounting/freshness/money/ACK code unchanged.

`bd21e4732` FAILED/consumed:policy23pass3fail0pending; standalonepolicy+compatibilitypassed but coldBaseimport exceeded5s/5015ms, Codexrotation5s/5021ms runnerSTACK_TRACE_ERROR, refreshlead600000!=432000000/body218ms (not attributed newregression; no assertion rewrite). Producer0pass2fail108filtered:JSON5stimeout8474.604ms/SSErunnerSTACK_TRACE_ERROR5735.846ms. Lint6exit0/stable1867. No appwarmup/mockpolicy/deadlinechange; no realpipelineobjective met.

Candidate REJECTED/FULLY REVERTED by targeted source edits,3experiment-addedfiles archived then removed, all6candidate source/test copies retained `refresh-policy-rejected-*`. Independent `refresh-policy-restoration.json`:exact original1864dictionary/no changed/added/missing; whitespace0. OriginalaudioWIPpreserved; no candidate helper/import/test in tree. No broadimpact or unchangedgate retry. Purepolicy extraction alone not sufficient; no causal speedup/regression/allgreen claim. No gate running.

## Verification / rejection criteria

After red, extract definitions without semantic change. Focused boundary plus existing refresh/provider consumers, compatibility exports and lint. Then unchanged actual JSON/SSE originalprice/ownACK/held/dequeue producer gate; no early refusal counted as support. Keep candidate only with useful real pipeline evidence; micro/static import count not enough, revert if insufficient. Broad callers only after coherent accepted change; all13ACremainopen.
