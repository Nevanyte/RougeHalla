# 719cc2 focused Editor retake — stopped at two Hub failures

Exact release **`719cc2b7e78415226246c0273ae9c78f7385fc04`**, Unity **6000.0.85f2**, URP **17.0.4**, sole Editor PID **9075**. **Gate result: FAIL / native proof unrun.** Compilation passes. Execution stopped at the first failing test group: **23 passed / 2 failed out of 25 executed**, with **9 remaining tests unrun**. No Play session, native PNG, source repair, test retry or assertion change occurred.

## Source identity and scope

The seven source groups still contain 34 selectors. The source-derived method/GUID/hash manifest matches frozen `git show` bytes, including `DrawerGeometryMaskFiltersAndCallbacksPreserveScrollAndSelection`. The loaded public types have the expected names and methods in refreshed module `e2bc6b64-8713-45bf-8789-1457bb8a9a75`. Public AssetDatabase/MonoScript identities and the raw loaded-method receipt predate test execution.

A preparatory Luna read raced the checkout switch and initially saw the previous method name. Those initial manifests are preserved as `EXPECTED_TESTS.initial-during-switch.*`; they were corrected from actual 719cc2 before execution and were not used to reduce expectations. The parent report comparison also initially assumed the earlier manifest schema and threw metadata KeyErrors. The comparison report was corrected after the test halt against the existing raw source/identity/results, without rerunning or changing any test. The full project manifest was collected after halt; the pre-test per-test-source and meta hashes remain in `EXPECTED_TESTS.json`. This packet does not claim that a complete pre-test all-file manifest was successfully written.

## Actual results

| Group | Expected | Executed | Passed | Failed |
|---|---:|---:|---:|---:|
| BuildDrawerEditModeTests | 5 | 5 | 5 | 0 |
| UiInputRoutingEditModeTests | 10 | 10 | 10 | 0 |
| MatchHudWishBarrierEditModeTests | 3 | 3 | 3 | 0 |
| HubCosmeticsViewEditModeTests | 7 | 7 | 5 | 2 |
| HubProgressViewEditModeTests | 3 | 0 | — | — |
| AccountRecoveryViewEditModeTests | 2 | 0 | — | — |
| Global MatchClientAccountBindingEditModeTests | 4 | 0 | — | — |
| **Total** | **34** | **25** | **23** | **2** |

Exact executed method names match the source manifest. No failed, missing or unrun method is accepted by a count-only check. No broad suite was repeated. This is actual Editor test execution, not live HTTP/browser/bank or authoritative gameplay acceptance.

The two Hub failures are:

1. `SameNameCredentialReplacementHidesAndRejectsOldUnknownRetryWithoutLosingHistory`, test line 247: **ArgumentException, “The actual value must be an IEnumerable”** from NUnit's collection/contains constraint path. The intended assertion is not counted as evaluated successfully.
2. `UnusableSameNameOwnerClearsWalletAndStatusWithoutDiscardingUnknownPurchase`, line 327: expected text containing **“Retry resubmits”**, actual **“Choose a cosmetic to buy or equip.”** The exact state/event cause is unassigned here.

Full stacks are in the original runner JSON and `test-verification.json`; `FAILURE_TRIAGE.md` is a read-only source review. Unexpected logs were not suppressed and assertions were not weakened.

## Native proof boundary

All three requested captures and every rendered interaction obligation in `docs/ui/DRAWER_PROOF_CONTEXT.md` remain **NOTRUN** because testing halted first. The passed drawer EditMode method checks geometry, mask filters and callbacks; it does not establish processed depth, sorted EventSystem hits, GPU stencil output, native wheel/selection routing or raster acceptance. No geometry-only cyan-resolution claim is made.

The prior f5 cyan failure, stalled no-image diagnosis and 6cdf 25/34 result remain unchanged. This cut introduces no mask/material/shader workaround and no forced shader compilation.

## Restoration and separation from asset work

The post-test manifest covers 1,122 tracked Unity files. Final runtime-subtree diff against frozen 719cc2 is empty. Known ShaderGraphSettings two-space serialization was retained and restored to frozen HEAD bytes. The checkout was clean before this documentation was added.

Final public state preserves the original live InputSettings instance, flags, update mode and background behavior; Play, paused and background flags are false; auto-tick is off; text is 1.0 with no saved key; minimap defaults to index 1 with no saved key. No review or MatchClient object remains. No resolution preset was changed from QHD/scale0.28.

No asset import occurred in this QA cut. The coordinator separately authorized a **new private preparation-only branch after this packet is sealed/stopped/restored, even if native acceptance remains held**. That later branch may verify only frozen first-four package import hashes, pivots, PPU, alpha, reload, compile and provenance. It does not gain permission for new Play, captures, listening or live catalog integration. Unpreviewed assets must remain explicitly unaccepted, and this failed UI cut must stay intact.
