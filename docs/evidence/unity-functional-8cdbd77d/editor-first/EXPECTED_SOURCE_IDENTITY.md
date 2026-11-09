# Expected source identity — fresh lifecycle 42-case gate

Gate source commit: `8cdbd77d4f3e1e002956b2f5c352eea53b12a42d`. Frozen source pin SHA-256 `a9599f3a59a35ae75260e16ec81b738c6015cd558d50909c9806977410c777a3` (1153 entries). Production approval: `4ec547312dc9b7214bbf6a8e20a6ff7ed3f3ba3b`; lifecycle correction `68931e0634959035d14039ea445186398d888bd3`; lifecycle evidence `09aaed359a1a2697dc5f58907d255dd4e11c60b1`. This is a source identity packet, not a test result.

## Four fixture identities

| Fixture | Full type | Cases / methods | Source SHA-256 | Meta GUID |
|---|---|---:|---|---|
| `QuestJournalViewEditModeTests` | `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 / 8 | `a227e72035a95c76998a8e715eea197e54bf28de37ade69998404830186a9508` | `629434afa706419fbb9172e17b76ce43` |
| `TraderDialogViewEditModeTests` | `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 / 6 | `74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb` | `fbeed4975d944443b6c6f34fe85c6d32` |
| `PlayerFlowsEditModeTests` | `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 / 11 | `d3b75829d5fb35708b328eeaa95d3975c0369cc287195db330dfbe2a7bb11c26` | `2695dbaec0cf4aa3b68c217e1e45dd55` |
| `MatchLaunchEditModeTests` | `MatchLaunchEditModeTests` | 17 / 14 | `1df70730e10dd3a3ea82365cd88db15a2fa631f313d4b168cbdbfe47e5c3323a` | `fcfb3901a322446bbd5299b1e19524d6` |

Exact source/meta paths, byte counts, hashes, GUIDs, namespaces and NUnit attributes are recorded in the JSON.

## Preserved 25 cases

All original names remain unchanged:

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

The three corresponding test sources match `fa0c0891` and gate `9c658e049d4b4e77118004d481349d1523e2ded4` byte-for-byte.

## Added 17 cases

All 14 MatchLaunch method signatures, `[Test]`/`[TestCase(...)]` attributes, and bodies are byte-identical in the comparison with `035b22c8`. The 17 method/argument tuples match the frozen selector contract `docs/evidence/unity-launch-native-gate/EXPECTED_SELECTORS.json` (SHA-256 `32d8c1612e3c0c7672802f31859057e4b1a97678e4a9445081922045e7c220c9`):

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

The only changed client Unity project input between `035b22c8` and this cut is `MatchLaunchEditModeTests.cs`. Its fixture setup/teardown changes register and restore the EventSystem, own/destroy fixture-created Arena and Light2D objects, and restore prior selection and URP light registry state. No production code path changed.

## Status

Source identity and case inputs verified. Unity compilation, fresh NUnit discovery, exact leaf binding and execution remain coordinator work.
