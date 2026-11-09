# Functional 035b22c8 test result review

## Verified result

The runner files and `test-execution-ledger.json` report **42 executed: 27 passed, 15 failed, 0 skipped, 0 unrun, 0 extra**. There are 42 unique actual `FullName` values; their set equals the frozen unchanged 25 names plus the 17 prebound source cases. All 25 unchanged tests passed. The 17 launch-mode cases produced 2 passes and 15 failures. No retry or Play session is recorded.

The fresh discovery, pre-execution binding report, and execution ledger agree on test assembly MVID `cad30248-17a5-410a-8d1b-d6b883f2b74d`. Discovery/binding recorded 42 cases and exact method/argument binding before execution. The binding report records `old25SourceBodiesMatchFa0: true`, `methodArgumentsAndFullNamesBound: true`, and `noMissingExtraSubstitute: true`.

## Per-fixture result counts

| Fixture | Total | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| QuestJournalViewEditModeTests | 8 | 8 | 0 | 0 |
| TraderDialogViewEditModeTests | 6 | 6 | 0 | 0 |
| PlayerFlowsEditModeTests | 11 | 11 | 0 | 0 |
| MatchLaunchEditModeTests | 17 | 2 | 15 | 0 |

The two passing new cases were `CrossOriginTrainingCannotSendOwnerCredentialsOrStartAClaim` and `EditingTrainingTargetDuringOwnerRequestCannotUseItsCapturedToken`.

## Captured failure log clusters

All 15 failed results are reported as unhandled Unity log messages:

- 13 results contain `More than one global light on layer Default for light blend style index 0`; recorded stacks include `Roguehalla.Client.ArenaView.Awake()` at `Assets/Scripts/View/ArenaView.cs:57`.
- 2 results contain `Failed setting EventSystem.current to unknown EventSystem`; recorded stacks include `MatchLaunchEditModeTests.Fixture.InitializeHud()` at `Assets/Tests/Editor/MatchLaunchEditModeTests.cs:90`.

These are the result messages and stack locations only. This review does not assign a cause to either cluster. The captured post-test public inventory reports `lights: []`, `eventSystems: []`, and `currentEventSystem: 0`; this is post-run state only and does not establish per-test object state. The receipt states that no broad cleanup or log suppression was performed.

## Exact failed case names

1. `MatchLaunchEditModeTests.EndingBeforeTheFirstModeFactUnlocksRecoveryAndLeavePermitsAnotherDestination`
2. `MatchLaunchEditModeTests.LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation(False)`
3. `MatchLaunchEditModeTests.LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation(True)`
4. `MatchLaunchEditModeTests.MissingTrainingNeverFallsBackOrStartsAnOwnershipRequest`
5. `MatchLaunchEditModeTests.OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot(Arena,False)`
6. `MatchLaunchEditModeTests.OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot(Training,True)`
7. `MatchLaunchEditModeTests.PendingMenuAndPracticeCopyFollowDeliveredFactAndPlayAgainPreservesTraining`
8. `MatchLaunchEditModeTests.RapidModeChangesOnlyConnectTheCurrentOwnerIntentToItsCapturedTarget`
9. `MatchLaunchEditModeTests.ReconnectWelcomeRevokesConfirmationAndRequiresANewMatchingFact`
10. `MatchLaunchEditModeTests.ReentrantLeaveCallbackCannotHaveItsReplacementCancelledOrArenaDestroyed`
11. `MatchLaunchEditModeTests.RetiredCallbacksCannotResetOrRefuseANewerSession`
12. `MatchLaunchEditModeTests.SwitchingModeWhileOwnerReplyIsDeferredInvalidatesTheOldIntent`
13. `MatchLaunchEditModeTests.SynchronousFactionCancellationCannotOverwriteOrRelaunchANewerMode`
14. `MatchLaunchEditModeTests.WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput(Arena,True)`
15. `MatchLaunchEditModeTests.WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput(Training,False)`

## Source argument integrity and limits

The frozen 17 source tuples remain bound to the discovered cases, including both boolean values for `LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation`, `(Arena,false)` and `(Training,true)` for `OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot`, and `(Arena,true)` and `(Training,false)` for `WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput`. Their actual enum type is `Roguehalla.Net.MatchLaunchMode`; enum names and booleans were not collapsed, changed, or relabeled. Result names preserve the literal case arguments.

Reviewed `tests-*.json`, `test-execution-ledger.json`, `discovery-binding-verification.json`, `discovered-cases.json`, and `native-cleanup-after-tests.json`. This is a result-set and receipt consistency review; it does not diagnose or fix the failures and makes no Play Mode, visual, or native-render acceptance claim.
