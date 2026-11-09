# e2baad focused Editor retake — stopped at inactive-label assertion

Exact source **`e2baadae03dd25cf74979bdfeb3bf35fd696393d`**. Unity **6000.0.85f2**, sole Editor PID **9075**, active WebGL target. **Gate FAIL: 6 executed / 5 passed / 1 failed / 0 unrun.** Compile and imported/loaded source identities passed. No Play, native capture or rendered interaction occurred; no retry or source/expectation change followed the failure.

## Authorized six cases and result

| Class | Expected | Executed | Passed | Failed |
|---|---:|---:|---:|---:|
| AccountRecoveryViewEditModeTests | 2 | 2 | 2 | 0 |
| Global MatchClientAccountBindingEditModeTests | 4 | 4 | 3 | 1 |
| **Total** | **6** | **6** | **5** | **1** |

Both recovery selectors pass on this exact source, including the previously failing focus callback case. The global binding group then returned one failure: `MatchClientAccountBindingEditModeTests.SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl`, **expected True, actual False**, at test line **196**:

```csharp
Assert.That(pickup.GetComponentInChildren<TMPro.TMP_Text>() == null, Is.True);
```

The preceding line195 asserts that the pickup object is inactive in hierarchy. The failure occurs in this pre-Join fixture assertion; the subsequent `Join` call at line201 and successful transport/Hello assertions were not reached in this method. This receipt does **not** diagnose an ordinary transport or authentication failure. `FAILURE_TRIAGE.md` preserves source/stack facts and leaves the cause unassigned. No API substitution, assertion relaxation, suppression, HTTP replay, diagnostic rerun or fix was attempted.

Every executed method name matches the exact frozen six-selector manifest (`test-verification.json`). The unchanged cosmetics7/progress3 remain scoped to **95bd9c**, and drawer5/input10/owner3 remain scoped to **719cc2**; none was repeated or relabeled as an e2 execution. All three requested native PNGs and every advancing-rendered drawer/EventSystem readiness/inside-outside-hit/wheel/click/clipping/header/persistence obligation remain **NOTRUN** because the six-case gate failed.

## Source, compilation and loaded identity

Before refresh, all **1,122 tracked Unity project files** matched the frozen Git blobs and were indexed with SHA256 in `as-tested-source.json`. `EXPECTED_TESTS.json` records the six source/meta hashes and GUIDs from the exact revision. The parent checked the public imported MonoScript type, GUID, public test methods and fresh assembly identity before execution (`identity-verification.pretest.json`).

Fresh test module **`e4946255-a7a1-4d99-8e3e-b146994f5e47`**, distinct from the 95bd9c test module. Loaded Net remains **`3734718b-02bd-4a5f-ad3c-d2f64cda6d5d`** with public Wire protocol14; its source is unchanged by this test-only cut. Actual compile completed without errors (`compile-after-switch.json`, `compile-final.json`). No old test assembly was accepted and no new Editor was opened.

The console tail is retained without clearing; it includes historical errors from prior cuts and is not treated as a fresh error count for this run. The current failed assertion and stack are taken from the untouched current runner JSON.

## Restoration and scope

The independent Luna source audit found no runtime/UI/test/Net/art additions or missing/untracked project files. The only drift was Unity serialization adding two trailing spaces on empty ShaderGraphSettings fields. The observed overlay and patch were retained and exact source bytes restored. All **1,122** files matched after cleanup (`restoration-verification.json`).

Final state preserves the original live InputSettings instance **−1029656**, `HideAndDontSave`, `ProcessEventsInDynamicUpdate`, `ResetAndDisableNonBackgroundDevices`. Play/pause and both background flags are false; no saved text-scale key (default1.0) or minimap key (default index1); scene empty/clean; no UiLayoutReview or MatchClient remains. Auto-tick is off and the refresh guard is released. No preset/GUI change, Play, screenshot, new art import/study, audio listening/override, runtime patch, feature UI merge, Web build or deployment was performed. An external drawer helper was planned for the conditional later phase but no helper file was written before interruption at the failed gate.

The asset preparation branch remains separately sealed at source **`5b7877f99805d6ef980577eda86a779ee4614d9f`** and evidence **`a6214598851d4ca8f8e630ba0b2548d89c8dbdff`**. The new player-flow feature source is also outside this cut. This finite retake ends stopped and restored; Root owns all fixes, admission and later release.
