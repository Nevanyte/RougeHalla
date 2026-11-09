# Functional 9c658e04 test result review

## Result

The run contains exactly 42 unique expected cases: the unchanged 25 selectors plus all 17 launch-mode source cases. The ledger and four runner result files agree: **30 passed, 12 failed, 0 skipped, 0 unrun, 0 extra**. The old 25 all passed. The 17 new launch-mode cases produced 5 passes and 12 failures. No retry or Play Mode session is recorded.

Discovery and binding evidence reports the loaded test module MVID as `5060c178-6253-4a15-a153-f5615131d3c5`; all 42 discovered case records carry that MVID. The pre-execution binding report records the same MVID, 42 actual NUnit cases, exact method/argument binding, and `noMissingExtraSubstitute: true`. The execution ledger records the same MVID and `new17BindingsPreserved: true`.

## Per-fixture counts

| Fixture | Expected | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| QuestJournalViewEditModeTests | 8 | 8 | 0 | 0 |
| TraderDialogViewEditModeTests | 6 | 6 | 0 | 0 |
| PlayerFlowsEditModeTests | 11 | 11 | 0 | 0 |
| MatchLaunchEditModeTests | 17 | 5 | 12 | 0 |

## Launch-mode failure facts

The 12 failed result names are all among the new 17 cases. The captured assertions/exceptions include:

- `EditingTrainingTargetDuringOwnerRequestCannotUseItsCapturedToken`: expected the empty string to contain “connection changed”.
- `EndingBeforeTheFirstModeFactUnlocksRecoveryAndLeavePermitsAnotherDestination`, `PendingMenuAndPracticeCopyFollowDeliveredFactAndPlayAgainPreservesTraining`, `ReconnectWelcomeRevokesConfirmationAndRequiresANewMatchingFact`, `ReentrantLeaveCallbackCannotHaveItsReplacementCancelledOrArenaDestroyed`, `RetiredCallbacksCannotResetOrRefuseANewerSession`, and both `WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput` parameter cases: `Sequence contains no elements`, with the recorded stack including `Fixture.Welcome()` at `MatchLaunchEditModeTests.cs:100`.
- Both `OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot` parameter cases and `SynchronousFactionCancellationCannotOverwriteOrRelaunchANewerMode`: expected collection count 1, observed 0.
- `RapidModeChangesOnlyConnectTheCurrentOwnerIntentToItsCapturedTarget`: `ArgumentOutOfRangeException` for an invalid list index.

These are report-level descriptions of captured results only; they do not assign a cause.

## Binding integrity notes

The four enum/bool parameterized launch cases retain their literal discovered values and names. The enum type is `Roguehalla.Net.MatchLaunchMode`; `Arena` is numeric 0 and `Training` numeric 1. The bool values remain exactly those in the frozen source tuples, including the paired `Arena/false`, `Training/true`, `Arena/true`, and `Training/false` cases. The two bool-only cases preserve both `false` and `true`. No parameter case was collapsed into a method-level or count-only pass.

The 17 namespaced/global fixture names are bound against the actual `MatchLaunchEditModeTests` fixture; the enum’s `Roguehalla.Net.MatchLaunchMode` namespace is argument type metadata, not a fixture namespace. The global fixture name is preserved in discovered and executed `FullName` values.

## Evidence reviewed

- `EXPECTED_SELECTORS.frozen.json`
- `discovered-cases.json`
- `evidence/discovery-binding-verification.json`
- `evidence/test-execution-ledger.json`
- `evidence/tests-QuestJournalViewEditModeTests.json`
- `evidence/tests-TraderDialogViewEditModeTests.json`
- `evidence/tests-PlayerFlowsEditModeTests.json`
- `evidence/tests-MatchLaunchEditModeTests.json`

This review checks result/name/binding consistency only. It does not diagnose or repair failures and does not establish Play Mode, native-render, or visual acceptance.
