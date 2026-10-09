# Pause investigation notes — 2026-10-08

Read-only inspections during Messages runtime gate; no Gemini/unhealthy implementation made. Parent self-review only, not independent approval/static-clean/runtime proof. These notes persist the actionable content of `/tmp/9router-{gemini-native-owner-preinspection,messages-sse-readonly-boundary-review,unhealthy-request-authority-preinspection}.md` for context clear.

## Gemini native next owner

- `src/app/api/v1beta/models/[...path]/route.js::POST` derives action by substring and path[1] for length>=2. Converter discards tools/nontext/most generationConfig; cannot authenticate original work after conversion.
- `handleChatRequest` owns gateway auth/settings and one accounting context; do not duplicate context/account fallback in wrapper.
- DefaultExecutor uses fixed Google v1beta model generateContent/streamGenerateContent URL and separate API-key/OAuth descriptors.
- Native JSON must explicitly distinguish stream mode; chatCore currently treats source GEMINI as streaming. Preserve OFF legacy behavior.
- Candidate standard API-key text-only generateContent: original-route request/action/model guard before converter, detached internal original intent through existing app/core, independent parsed wire check at actual fixed singlePOST owner, bounded raw JSON/cleanEOF, genuine finish/token-only schema/total/tier/model authority, durable settlement/auth before native return. No synthetic OpenAI reconversion or silent strip-to-eligibility.
- Live SSE/OAuth/tools/specialized paths remain required separate deliveries, not completed by denial. TTS/other-modality metering outside scope.
- Official evidence https://ai.google.dev/api/generate-content captured in `/tmp/9router-gemini-generate-content-official.{html,txt}`. HTML SHA256 `9948f52f43e2001449354e5f79ca84df9a92bc04daacd4e13b1d7d554a80a735`, 1,232,465 bytes: prompt includes cache; thoughts separate from candidates; total=prompt+thoughts+candidates. Modality arrays/tool-use/tier need explicit policy. modelVersion is generated version, docs do not guarantee caller-model equality; no fuzzy mapping.

## Messages self-review limitations

- Source inspected original+parsed-wire policy, fixed/APIkey/strictsinglePOST, pretransfer unresolved versus posttransfer sole stream owner, EOF/ACK/auth/first winner, local cancel not foreign quiescence, settled threshold bypass/new admission gate.
- Unit tests include default and injected parsers, exact route/mode/unsupported0intentPOST, missingstop/trailinginvalid/no successor/cooldown. No additional tests run in this inspection.
- Actual runtime fixture has FOUR groups (negative + three positive), not summary shorthand three.
- Socket fixture text payload ASCII; per-chunk toString decoding does not itself prove real UTF8 fragmentation. Unit split tests are separate evidence.
- Generic shared owner covers abort=false held ACK; new Claude live file does not explicitly duplicate protocol-specific cancellation matrix. Review at integrated acceptance, not an assertion that all races passed.
- Positive standard-only copied standalone config does not approve unchanged production beta/OAuth/nontext.

## Unhealthy request authority

- RequestAccounting/app auth/settings/gate requires healthy DB. Existing low-level begin exception proves persisted active key/binding/BOTHNULL policy and independent durable gap, NOT actual caller credential or upstream settings/model/connection authority.
- Fresh adapter-owned independent persisted snapshot needed; never poison RAM/cache/user proof. Exact credential precedence and binding verification, fresh active connection/settings/model, pinned request and gap ACK; per-POST generation/maintenance/cancel rechecks. One context, no second writer/healing/original commit ACK assumption.
- Native proof has readonly WAL-empty/quiescent/fsync checks; SQL.js pinned fresh disk image. Neither current return authenticates request/upstream fields. Begin-only tests are not actual unhealthy app dispatch approval.
- Do not remove gate/assertSupported to wire exception or permit unsupported unlimited work. Newly budgeted/disabled/retired/mutated authority denies.

## Search and infrastructure

- Original search assertion remains unwaived. combo.js intentionally disables search detection (line183); enabling it changes routing preferences outside scope. No delete/baseline waiver/fetch-to-green.
- Advisor failed exactly `Advisor model not found: 9router/cx/gpt-6-astra`; no advisory approval/provider substitution.
- Preferred 9router web search unavailable (no configured/discovered route); targeted official fetch worked. Not a multi-source review.
- Current Messages build0/NodeHTTP4passed, SQL.js standalone-copy EIO before runtime. See latest plan + handoff for authoritative pause state. Enforcement OFF, all phases incomplete.
