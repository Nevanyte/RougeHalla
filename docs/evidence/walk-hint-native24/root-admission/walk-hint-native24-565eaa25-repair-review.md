# WalkHint native24 repaired seal review

**SOURCE + EVIDENCE RELEASE** for `565eaa259f42bf1e9f0c22b6bbc9abbc3976c45c`, descendant of held `2fbc86dfc42e4cd50270630ea660a5b0649dd7e3` through code repair `3abd47cc`. All three requested finite consumer repairs are closed. No remaining blocker in this packet. Read-only immutable Git review; no tests/builds/cache/source execution or source/ref mutations.

The original HOLD and raw outcomes remain preserved; this additive verdict supersedes only its three repair requirements. Prior report: `walk-hint-native24-2fbc-independent-review.md`, SHA256 `7a02419a6681ea303cd8849de0e7189c69475e1c4521fb3ae6b01395e4939e56`.

## Corrected consumer

- Every amove case now runs the first actual `targeting::update` immediately after the readonly hint, asserts no emitted events, and reads the real selected identity. Hide-to-acquire compares actual selectedBefore, performs the real typed Hidden removal and exact removed-row assertions, then performs the second readonly hint/actual update/selectedAfter. It no longer establishes the first negative selection from installed null.
- All pre/post ordered-candidate queries now use `now + TICK_MS` (2050 for these declared contexts), preserving current positions/lockable-now/physical LoS semantics.
- LOS history uses captured target position and viewer target.x−24 with no Move, followed by two ordinary steps. Both captured LOS targets have y200, so the repaired target.y expression is the exact source y200 recipe. Native-produced gameplay visibility and lockability remain required true; physical LoS remains required false. No history/visibility outcome is installed to satisfy those preconditions.

Only the new inline boundary24 module changes in Rust: the prior file prefix/old69 remain byte-identical to 2fbc. No production code, producer, source corpus, old14/69 expectations, schema/header/content/tape/lock/status change. The existing complete 675-line review remains applicable apart from this exact 50-line repair diff. Harmless redundant `events.clear()` on a newly empty local is not a correctness issue.

## Manifest and receipts

Amended parent `manifest.txt` SHA256 `be72fc8f7e96dc9992ed3dab96c1b6669c0145bfbba78203f393f542c2aa5a0c`: independently verified all **14/14** payload Git blobs for byte length and SHA256, including six repair files and current helper SHA256 `26a0faff030a766dc3966753248bd64864784bf4fb9c3c0a69e95cd963cfc420` (52,578 bytes). Repair verify.log validates preceding13 blobs; manifest then binds that receipt without circular self-hashing. Original verify.log is retained historical evidence, not a claim that its old helper hash is current.

Corpus remains exactly 150,406 bytes/SHA256 `1702ce0a44940709d229161211cbd6ceaf8b0f4ef55c147d3321b3e3ab78e774`. Raw corrected focused receipt: 1 pass/0 fail/exit0. Corrected WalkHint filter: 16 pass/0 fail/two explicitly existing ignored global-dhat controls/exit0. Scoped clippy/fmt receipts both exit0. These are author executions, not reruns by this reviewer; no corrected prerequisite failure is recorded or concealed. Repair README describes the actual changes/results and retains the packet limits accurately.

## Admission boundary

Release is the finite 24-case declared source-method consumer, alongside unchanged prior scopes. It is not earned World/full Frame/physics/restore/live/public/full-brain or complete boundary admission. Root-approved readonly full_method_gates context, explicit nonreached setup-deadline narrowing, readonly World/all-three-native-RNG checks, exact output bits, and direct-angle versus collapsed Cartesian path/hint distinction remain unchanged. In particular no Cartesian boundary transition or cross-language RNG bootstrap correspondence is newly proved. Root owns composition and main testing/admission; no further broad check is requested by this review.
