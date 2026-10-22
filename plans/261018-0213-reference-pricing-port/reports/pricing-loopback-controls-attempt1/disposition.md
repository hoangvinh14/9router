# Loopback control attempt 1 — helper compatibility failure

Task `bcc368221` failed exit 1. Counsel was obtained before raw collection/diagnosis. Raw output, exit, helpers and input manifest were archived; all frozen source/helper hashes matched. TCP/h2c checks were not launched.

The first owned HTTP fetch rejected with `TypeError: fetch failed`, caused by the preload's `Pricing fixture: non-loopback network disabled` in Socket.connect. No application module is loaded by these controls. This is not application acceptance or evidence of successful external egress.

Read-only Node v24.21.0 native-source inspection and a no-network argument-shape reproduction identify the compatibility defect: `net.connect()` calls `socket.connect(normalized)` with an internally tagged array. The original Socket.connect recognizes that array and does not normalize it again. The preload instead calls `net._normalizeArgs(args)` unconditionally. With `[normalized]`, it obtains the array as its options rather than the original host/port object, and rejects the owned loopback request. Reproduction used fixed `{host:'127.0.0.1',port:12345}` values without opening a socket.

Proposed next minimal helper correction must preserve the numeric-loopback-only allowlist, reject Unix sockets/TLS/external targets, recognize only the existing runtime's normalized-arguments marker and otherwise retain normal normalization. No correction has been applied while independent startup/lint checks are pending. Fresh helper manifest and bounded controls required before any TCP/h2c launch; no identical retry or egress relaxation.

Also retain Advisor's test-quality caveat: redirect rejection should assert the specific redirect-denial cause, not arbitrary promise rejection. Numeric-loopback-only selected-JS interception permits all local ports, is not fixture-port ownership and is not an OS/native network sandbox. Framework forwarding in the planned TCP test is simulated; it is not compiled Next-server evidence.
