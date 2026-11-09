# 95bd9c UI retake result and failure triage

Source: `95bd9c1efcde9b71cb07f23f24aef8ff4fb17013`. Expected scope is 16 selectors in `EXPECTED_TESTS.json` (manifest SHA-256: `3463f1ba7f33f57d5d8b3d77c163f5e53ff5669c07a0f7128b592f6a202cbf04`). The saved raw suite files match the expected public method names for all three executed groups.

## Result boundary

**12 executed: 11 passed, 1 failed; 4 selectors unrun.** Cosmetics passed 7/7, progress passed 3/3, and recovery passed 1/2. The gate stopped on the recovery failure. MatchClientAccountBinding (4) was not run. No Play session or screenshots were produced. This is a stopped retake, not full acceptance.

| Group | Expected | Executed | Passed | Failed | Skipped | Raw result |
|---|---:|---:|---:|---:|---:|---|
| `HubCosmeticsViewEditModeTests` | 7 | 7 | 7 | 0 | 0 | `tests-HubCosmeticsViewEditModeTests.json` |
| `HubProgressViewEditModeTests` | 3 | 3 | 3 | 0 | 0 | `tests-HubProgressViewEditModeTests.json` |
| `AccountRecoveryViewEditModeTests` | 2 | 2 | 1 | 1 | 0 | `tests-AccountRecoveryViewEditModeTests.json` |

## Failure

`Roguehalla.Client.Tests.AccountRecoveryViewEditModeTests.OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur` failed with the recorded unhandled Unity log: `Unhandled log message: '[Assert] Assertion failed on expression: 'ShouldRunBehaviour()''. Use UnityEngine.TestTools.LogAssert.Expect`. The stack places the event at `AccountRecoveryViewEditModeTests.cs:183`, where the test executes `_view.SendMessage("OnApplicationFocus", false, SendMessageOptions.RequireReceiver);`. The view declares `void OnApplicationFocus(bool focus) { if (!focus) SetVisible(false); }` at [AccountRecoveryView.cs](/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Assets/Scripts/UI/AccountRecoveryView.cs:83); the immediate failing source line is [AccountRecoveryViewEditModeTests.cs](/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Assets/Tests/Editor/AccountRecoveryViewEditModeTests.cs:183). The saved stack reports `UnityEngine.Component:SendMessage` and `ShouldRunBehaviour()` but does not establish why that assertion fires. This triage does not infer a cause or suppress the log.

The other recovery selector, `UnownedAndFailedProfilesCannotRevealARecoveryKey`, passed. No test, expectation, or source change was made in response to the failure.

## Unrun selectors

- `MatchClientAccountBindingEditModeTests.SelectingFactionDuringDeferredJoinInvalidatesIntentAndCreatesNoSocket`
- `MatchClientAccountBindingEditModeTests.StaleJoinFailureCannotOverwriteProfileSelectedBySynchronousFlowCallback`
- `MatchClientAccountBindingEditModeTests.MutatingMatchUrlWhileOwnershipRequestIsPendingCannotUseCapturedIntentOrConnect`
- `MatchClientAccountBindingEditModeTests.SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl`

## Preserved prior passes

The separate 719cc2 receipt retains 18 passed selectors (BuildDrawer 5/5, UI input 10/10, owner facts 3/3). They were not rerun. The earlier partial cosmetics result is not included in that 18-pass count. See [the prior test receipt](/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/combined-719cc2-2026-11-08/evidence/test-verification.json).

Evidence is limited to the three raw test-result JSON files, the exact-cut expected manifest, and the source line cited above. There was no Play run, screenshot, or global-binding result.
