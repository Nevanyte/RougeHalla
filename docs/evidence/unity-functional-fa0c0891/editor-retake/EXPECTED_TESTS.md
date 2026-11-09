# Expected selectors — fa0c0891

Exact frozen source: `fa0c0891f78e2fd4a65fb08d71d226d8a426e724`. This file is a read-only inventory; no tests were run by its author.

The selector contract `docs/evidence/unity-ui-planning-quests/typing-guard/native-selectors.txt` is `25` full names (SHA-256 `2d619f2f0c69c3770c685f4e1403b68213dde6320257a09350de44d0c1b16c2b`). Each listed name matches a public `[Test]` method in the corresponding source file; there are no discrepancies.

| Test class | Selectors | .meta GUID | Source SHA-256 | .meta SHA-256 |
|---|---:|---|---|---|
| `QuestJournalViewEditModeTests` | 8 | `629434afa706419fbb9172e17b76ce43` | `a227e72035a95c76998a8e715eea197e54bf28de37ade69998404830186a9508` | `fbf0d2abab7d153e486a3ebe28f86196f290df10a6c0d3da03e5fab70a2110a5` |
| `TraderDialogViewEditModeTests` | 6 | `fbeed4975d944443b6c6f34fe85c6d32` | `74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb` | `5dbe763a1b42575f08e6837a4e35ff5bfde5735ce102d50757e90e5a32c9f5c8` |
| `PlayerFlowsEditModeTests` | 11 | `2695dbaec0cf4aa3b68c217e1e45dd55` | `d3b75829d5fb35708b328eeaa95d3975c0369cc287195db330dfbe2a7bb11c26` | `04c5f186600e28ada6ea8cecdd2f7be79b5cb21f1abeec8a8dce0242e642123e` |

## Exact selector names

### `QuestJournalViewEditModeTests` — 8
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.UnseenUnavailableAndAvailableEmptyAreDistinctAndRowsPreserveExactServerText` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.MaximumLengthServerStringsRemainVerbatimInScrollableFixedSizeTextFields` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.ReplacementPreservesSelectedHandleAndScrollButClearsRemovedSelectionAndTracking` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.OldAcceptTrackAndRowCallbacksCannotActAfterReplacementBeforeRefresh` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.MetadataReplacementPreservesScrollPositionWhenRowsOverflowViewport` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.SelectedParticipantsUseTypedRosterIdsKeepDuplicateLabelsAndClearOnReplacementOrRebind` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.AcceptUsesCurrentHandleAndFreshCanAcceptThenSessionBatchesOnlyThatIntent` (Test)
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.OldSessionCallbacksAndRemovedRowsCannotAcceptAfterRebindWelcomeOrDisconnect` (Test)
### `TraderDialogViewEditModeTests` — 6
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.MissingUnavailableAndAvailableEmptyTradeViewsStayDistinctAndOpeningIsReadOnly` (Test)
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.DuplicateMerchantRowsLabelsAndSignedStatDeltasRenderInSourceOrder` (Test)
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.StatUsedBlocksOnlyStatTradeWhileBarterPicksAreSentAsOrdinaryInput` (Test)
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.CurrentOptionsQueueEveryOrdinaryStatPickAndMetadataReplacementInvalidatesOldCallbacks` (Test)
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.DisconnectAndResumedWelcomeInvalidateOldRowsAndDropQueuedTradeInput` (Test)
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.RebindingAnUnseenSessionClearsMerchantChoicesAndPendingCopyImmediately` (Test)
### `PlayerFlowsEditModeTests` — 11
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.ReceivedNoticeOrderIncludesDuplicatesAndResumeClearsBeforeNewBatch` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.InFlightOldSessionNoticeCallbackCannotAppendAfterRebind` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.InFlightSameSessionNoticeCallbackCannotCrossSourceClockCutAndNewEpochKeepsDuplicates` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.OrdinaryMixedQuestTradeQueueSplitsAtSixteenWithoutUiGeneratedCommands` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.DeliveredMapPointsReplaceWithoutActorFabricationOrNameDeduplication` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.MalformedFrameRetainsCanonicalViewButInvalidQuestItemReferenceFailsAndDisablesActions` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.JournalKeyboardOwnsSimultaneousMapAndWorldKeysAndRespectsExistingModals` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningQuestReviewPreservesMapChoicesAndFocusWhileBlockingOtherPagesAndWorldKeys` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningPreviewRetiresDeferredAcceptAndWaitsForFreshNativePermission` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningJournalDropAndResumedWelcomeClearRowsAndRestoreMapInput` (Test)
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.PlanningJournalRespectsSettingsAndFocusedTextEntry` (Test)

## Boundary

This manifest covers 8 QuestJournal, 6 TraderDialog, and 11 PlayerFlows selectors at fa0c0891 only. It does not assert that prior build or other test gates were rerun, and it provides no runtime, browser, native-capture, or visual acceptance.
