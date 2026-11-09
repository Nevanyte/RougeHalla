# Expected source identity — fresh 42-case gate

Gate source commit: `035b22c8b0773d6637da4e0d4906c31d5b3af01e`. Frozen source pin: `0e8642a4abab996fe66e7ecf2355098f5c527f9df4d7aa9d3bf9f9f6ba5cc384` (1153 entries). Production approval: `4ec547312dc9b7214bbf6a8e20a6ff7ed3f3ba3b`. This packet records identity only; it does not execute tests.

## Four fixtures

| Fixture | Full type | Cases / methods | Source SHA-256 | Meta GUID |
|---|---|---:|---|---|
| `QuestJournalViewEditModeTests` | `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 / 8 | `a227e72035a95c76998a8e715eea197e54bf28de37ade69998404830186a9508` | `629434afa706419fbb9172e17b76ce43` |
| `TraderDialogViewEditModeTests` | `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 / 6 | `74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb` | `fbeed4975d944443b6c6f34fe85c6d32` |
| `PlayerFlowsEditModeTests` | `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 / 11 | `d3b75829d5fb35708b328eeaa95d3975c0369cc287195db330dfbe2a7bb11c26` | `2695dbaec0cf4aa3b68c217e1e45dd55` |
| `MatchLaunchEditModeTests` | `MatchLaunchEditModeTests` | 17 / 14 | `0b39a8b75960a9fbb3a288982ce8822ce1283982eefd7c0a473f673d5410c98a` | `fcfb3901a322446bbd5299b1e19524d6` |

Exact source and `.meta` paths, bytes, hashes, GUIDs, namespaces, and NUnit method/source-argument attributes are in the JSON packet. MatchLaunch is a global-namespace type, with 17 cases from 14 methods.

## Preserved 25 cases

Selector contract: `docs/evidence/unity-ui-planning-quests/typing-guard/native-selectors.txt` (SHA-256 `2d619f2f0c69c3770c685f4e1403b68213dde6320257a09350de44d0c1b16c2b`). Full names, unchanged from the frozen contract:

- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.UnseenUnavailableAndAvailableEmptyAreDistinctAndRowsPreserveExactServerText`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.MaximumLengthServerStringsRemainVerbatimInScrollableFixedSizeTextFields`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.ReplacementPreservesSelectedHandleAndScrollButClearsRemovedSelectionAndTracking`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.OldAcceptTrackAndRowCallbacksCannotActAfterReplacementBeforeRefresh`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.MetadataReplacementPreservesScrollPositionWhenRowsOverflowViewport`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.SelectedParticipantsUseTypedRosterIdsKeepDuplicateLabelsAndClearOnReplacementOrRebind`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.AcceptUsesCurrentHandleAndFreshCanAcceptThenSessionBatchesOnlyThatIntent`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.OldSessionCallbacksAndRemovedRowsCannotAcceptAfterRebindWelcomeOrDisconnect`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.MissingUnavailableAndAvailableEmptyTradeViewsStayDistinctAndOpeningIsReadOnly`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.DuplicateMerchantRowsLabelsAndSignedStatDeltasRenderInSourceOrder`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.StatUsedBlocksOnlyStatTradeWhileBarterPicksAreSentAsOrdinaryInput`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.CurrentOptionsQueueEveryOrdinaryStatPickAndMetadataReplacementInvalidatesOldCallbacks`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.DisconnectAndResumedWelcomeInvalidateOldRowsAndDropQueuedTradeInput`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.RebindingAnUnseenSessionClearsMerchantChoicesAndPendingCopyImmediately`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.ReceivedNoticeOrderIncludesDuplicatesAndResumeClearsBeforeNewBatch`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.InFlightOldSessionNoticeCallbackCannotAppendAfterRebind`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.InFlightSameSessionNoticeCallbackCannotCrossSourceClockCutAndNewEpochKeepsDuplicates`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.OrdinaryMixedQuestTradeQueueSplitsAtSixteenWithoutUiGeneratedCommands`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.DeliveredMapPointsReplaceWithoutActorFabricationOrNameDeduplication`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.MalformedFrameRetainsCanonicalViewButInvalidQuestItemReferenceFailsAndDisablesActions`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.JournalKeyboardOwnsSimultaneousMapAndWorldKeysAndRespectsExistingModals`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningQuestReviewPreservesMapChoicesAndFocusWhileBlockingOtherPagesAndWorldKeys`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningPreviewRetiresDeferredAcceptAndWaitsForFreshNativePermission`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningJournalDropAndResumedWelcomeClearRowsAndRestoreMapInput`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningJournalRespectsSettingsAndFocusedTextEntry`

Quest Journal, Trader Dialog, and Player Flows sources match `fa0c0891` and gate `9c658e049d4b4e77118004d481349d1523e2ded4` byte-for-byte.

## Added 17 cases

Case source: `docs/evidence/unity-launch-modes/expected-native-cases.json` (SHA-256 `160f16431671daa01b8463a44a51d47075b5bfcae84445b04c36c40b6d8da1b5`). Bind each source method + argument tuple to exactly one discovered NUnit leaf by type, method, and `Arguments`; execute only discovered exact names.

- `MatchLaunchEditModeTests.MissingTrainingNeverFallsBackOrStartsAnOwnershipRequest`
- `MatchLaunchEditModeTests.CrossOriginTrainingCannotSendOwnerCredentialsOrStartAClaim`
- `MatchLaunchEditModeTests.SwitchingModeWhileOwnerReplyIsDeferredInvalidatesTheOldIntent`
- `MatchLaunchEditModeTests.RapidModeChangesOnlyConnectTheCurrentOwnerIntentToItsCapturedTarget`
- `MatchLaunchEditModeTests.EditingTrainingTargetDuringOwnerRequestCannotUseItsCapturedToken`
- `MatchLaunchEditModeTests.SynchronousFactionCancellationCannotOverwriteOrRelaunchANewerMode`
- `MatchLaunchEditModeTests.LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation` — `false`
- `MatchLaunchEditModeTests.LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation` — `true`
- `MatchLaunchEditModeTests.OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot` — `MatchLaunchMode.Arena, false`
- `MatchLaunchEditModeTests.OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot` — `MatchLaunchMode.Training, true`
- `MatchLaunchEditModeTests.WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput` — `MatchLaunchMode.Arena, true`
- `MatchLaunchEditModeTests.WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput` — `MatchLaunchMode.Training, false`
- `MatchLaunchEditModeTests.ReconnectWelcomeRevokesConfirmationAndRequiresANewMatchingFact`
- `MatchLaunchEditModeTests.RetiredCallbacksCannotResetOrRefuseANewerSession`
- `MatchLaunchEditModeTests.ReentrantLeaveCallbackCannotHaveItsReplacementCancelledOrArenaDestroyed`
- `MatchLaunchEditModeTests.PendingMenuAndPracticeCopyFollowDeliveredFactAndPlayAgainPreservesTraining`
- `MatchLaunchEditModeTests.EndingBeforeTheFirstModeFactUnlocksRecoveryAndLeavePermitsAnotherDestination`

## Source comparison

Between `9c658e049d4b4e77118004d481349d1523e2ded4` and `035b22c8b0773d6637da4e0d4906c31d5b3af01e`, the only changed client Unity test source is `MatchLaunchEditModeTests.cs`; there are no other changed client Unity code paths. The selected 25-case source bodies remain byte-identical to `fa0c0891` and the 9c gate. This fresh identity covers the corrected MatchLaunch fixture setup while production sources remain unchanged in that comparison.

## Status

Identity only. Unity compilation, discovery, binding, and execution remain coordinator work.
