# Worker comparison readiness — lifecycle fixture passed, integrity gate incomplete

## Scope

User approved post-baseline lifecycle/integrity checks followed by one isolated webpackBuildWorker=true comparison only after the gates pass. No worker build was launched; original product config, dependency tree and live Docker remain untouched by this follow-up.

## Lifecycle fixture be6f9560f

Controller completed exit0. Observer returned124 normally in7.818s, within its30s external bound. The expected inner fixture2s watchdog fired, then TERM,5s escalation, KILL and payload exit-9. Both inside/outside observer terminal events recorded124; no unexplained controller timeout occurred. Only MainThread was non-daemon at final thread snapshots.

Outside samples captured namespace wrappers, inside observer, Python payload and sleeping child (five host PID/startTicks identities). A subsequent exact-identity check found all five absent. This establishes the exercised fixture escalation/cleanup path, not the explanation for the baseline's slower outer shutdown under load. The fixture did not exercise font relay traffic or full build load.

Inputs/result/analysis: lifecycle-fixture-inputs.json, lifecycle-fixture-result.json, lifecycle-fixture-analysis.json. Root /tmp/9router-pricing-lifecycle-gzo9010v, dist .next-pricing-lifecycle-gzo9010v.

## Postverification b2bce4f02

Terminal failed124. Counsel preceded diagnosis. One task-log collection identifies source PASS, exact inventory PASS, hash0..6 PASS, then hash7 exceeded its45s bound. Failed-stage log only shows offsets0,500,1000. No mismatch was printed; this is incomplete verification, not proof of changed files.

Completed hash partitions certify21000 of36425 dependency files against the frozen manifest. Hash7 lacks a completed receipt; hash8..12 were not run by this task. Exact inventory still checked36425files32links. Completed receipts and logs preserved in baseline-evidence/postverify. No repeated verification/timeout increase or build was used to bypass the failed gate.

## Decision

Worker comparison remains held because full post-baseline dependency integrity was not established. Fixture success does not waive that gate, establish baseline source/lock equality beyond the completed checks, or prove a worker build will complete.

A revised next plan would inspect the manifest/path range for hash7, then verify only incomplete ranges in smaller deterministic partitions with streaming progress and retained complete receipts; preserve all36425-file coverage and revalidate source/helper/locks at actual launch. Do not silently grant a larger retry budget or start worker-on build before full coverage is restored. No root cause for slow hash7 reads is established.
