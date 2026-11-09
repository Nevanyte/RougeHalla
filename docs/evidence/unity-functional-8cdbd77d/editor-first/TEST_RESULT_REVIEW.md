# Functional 8cdbd77d runner result review

## Exact-set and execution counts

Independently compared all four `tests-*.json` results and `test-execution-ledger.json` with the fresh discovery/binding and frozen 42-case contract. The run contains 42 results with 42 unique `FullName`s: exactly the unchanged 25 plus the bound 17 launch cases. No names are missing, extra, duplicated, substituted, or collapsed.

Totals: **26 passed, 16 failed, 0 skipped, 0 inconclusive, 0 unrun, 0 extra**. All unchanged 25 passed. The new launch group had 1 pass and 16 failures. Each of the four fixture groups has one recorded runner result and the ledger marks `exactNamesMatch: true` for every group; no retry is recorded.

| Fixture | Total | Passed | Failed | Skipped | Ledger |
|---|---:|---:|---:|---:|---|
| QuestJournalViewEditModeTests | 8 | 8 | 0 | 0 | PASS |
| TraderDialogViewEditModeTests | 6 | 6 | 0 | 0 | PASS |
| PlayerFlowsEditModeTests | 11 | 11 | 0 | 0 | PASS |
| MatchLaunchEditModeTests | 17 | 1 | 16 | 0 | FAIL |

The sole passing new case was `MatchLaunchEditModeTests.EditingTrainingTargetDuringOwnerRequestCannotUseItsCapturedToken`.

## Failure record

All 16 failed results have the same unhandled Unity error message:

`Destroy may not be called from edit mode! Use DestroyImmediate instead. Destroying an object in edit mode destroys it permanently.`

Recorded stack traces include `Roguehalla.Client.MatchClient.CloseCurrentSession()` at `Assets/Scripts/Net/MatchClient.cs:158`; some traces reach it through `Leave`, `CancelOwnedJoin`, or `RefuseLaunch`, and the `PendingMenuAndPracticeCopyFollowDeliveredFactAndPlayAgainPreservesTraining` trace includes `MatchHud.JoinAgain`. These are observed log and stack details only; this review does not assign a cause.

Failed names:

1. `MatchLaunchEditModeTests.CrossOriginTrainingCannotSendOwnerCredentialsOrStartAClaim`
2. `MatchLaunchEditModeTests.EndingBeforeTheFirstModeFactUnlocksRecoveryAndLeavePermitsAnotherDestination`
3. `MatchLaunchEditModeTests.LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation(False)`
4. `MatchLaunchEditModeTests.LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation(True)`
5. `MatchLaunchEditModeTests.MissingTrainingNeverFallsBackOrStartsAnOwnershipRequest`
6. `MatchLaunchEditModeTests.OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot(Arena,False)`
7. `MatchLaunchEditModeTests.OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot(Training,True)`
8. `MatchLaunchEditModeTests.PendingMenuAndPracticeCopyFollowDeliveredFactAndPlayAgainPreservesTraining`
9. `MatchLaunchEditModeTests.RapidModeChangesOnlyConnectTheCurrentOwnerIntentToItsCapturedTarget`
10. `MatchLaunchEditModeTests.ReconnectWelcomeRevokesConfirmationAndRequiresANewMatchingFact`
11. `MatchLaunchEditModeTests.ReentrantLeaveCallbackCannotHaveItsReplacementCancelledOrArenaDestroyed`
12. `MatchLaunchEditModeTests.RetiredCallbacksCannotResetOrRefuseANewerSession`
13. `MatchLaunchEditModeTests.SwitchingModeWhileOwnerReplyIsDeferredInvalidatesTheOldIntent`
14. `MatchLaunchEditModeTests.SynchronousFactionCancellationCannotOverwriteOrRelaunchANewerMode`
15. `MatchLaunchEditModeTests.WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput(Arena,True)`
16. `MatchLaunchEditModeTests.WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput(Training,False)`

The result names retain the prebound typed values: the boolean-only cases remain both `false` and `true`; `OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot` remains `(Arena,false)` and `(Training,true)`; `WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput` remains `(Arena,true)` and `(Training,false)`. The enum type remains `Roguehalla.Net.MatchLaunchMode` (`Arena = 0`, `Training = 1`).

## Identity, cleanup, and limits

The result ledger and discovery/binding receipts agree on source `8cdbd77d4f3e1e002956b2f5c352eea53b12a42d` and test MVID `b78f3c03-15d1-4924-b90a-9fe89d2737f4`. Post-test public cleanup inventory reports no lights or EventSystems and `currentEventSystem: 0`; this is only a post-run state. Source restoration evidence separately reports 1,140 tracked Unity inputs exact, clean worktree, and guard released. This is a runner-result audit only; it makes no Play Mode, native-render, visual, or gameplay acceptance claim and does not diagnose or repair failures.
