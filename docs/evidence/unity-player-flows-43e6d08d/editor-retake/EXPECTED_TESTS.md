# Frozen Unity EditMode test manifest — 43e6d08d

Exact source: `43e6d08d90e8ee63e3a16ef002bba3e971c9e30f`. Frozen selector file: `docs/evidence/unity-ui-player-flows/epoch-fence/native-selectors.txt` (SHA-256 `45a51bfdc427b9775dc8e2cb7c21ad2ee50b4ed6d0f7adcedb353bb72c968c8a`). It contains 20 selectors and matches exactly 20 `[Test]` methods in the three source files below. This is a manifest only; no tests or Editor were run.

Observed exact-cut counts: PlayerFlowsEditModeTests=7, QuestJournalViewEditModeTests=7, TraderDialogViewEditModeTests=6.

**Scope discrepancy:** task text requested 7 QuestJournal + 7 Trader + 6 MatchHud integration. The frozen source and selector file instead contain 7 PlayerFlows integration + 7 QuestJournal + 6 Trader. The complete frozen selector set is recorded; no tests were substituted or inferred.

## PlayerFlowsEditModeTests (7)

Source: `client-unity/UnityProject/Assets/Tests/Editor/PlayerFlowsEditModeTests.cs`; meta: `client-unity/UnityProject/Assets/Tests/Editor/PlayerFlowsEditModeTests.cs.meta`; GUID `2695dbaec0cf4aa3b68c217e1e45dd55`.
Source SHA-256 `ee223552f821e62d9166d794135b4d64ee6d32f9fb198feed36700bd8fabd581`; meta SHA-256 `04c5f186600e28ada6ea8cecdd2f7be79b5cb21f1abeec8a8dce0242e642123e`.

- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.ReceivedNoticeOrderIncludesDuplicatesAndResumeClearsBeforeNewBatch`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.InFlightOldSessionNoticeCallbackCannotAppendAfterRebind`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.InFlightSameSessionNoticeCallbackCannotCrossSourceClockCutAndNewEpochKeepsDuplicates`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.OrdinaryMixedQuestTradeQueueSplitsAtSixteenWithoutUiGeneratedCommands`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.DeliveredMapPointsReplaceWithoutActorFabricationOrNameDeduplication`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.MalformedFrameRetainsCanonicalViewButInvalidQuestItemReferenceFailsAndDisablesActions`
- `Roguehalla.Client.Tests.PlayerFlowsEditModeTests.JournalKeyboardOwnsSimultaneousMapAndWorldKeysAndRespectsExistingModals`

## QuestJournalViewEditModeTests (7)

Source: `client-unity/UnityProject/Assets/Tests/Editor/QuestJournalViewEditModeTests.cs`; meta: `client-unity/UnityProject/Assets/Tests/Editor/QuestJournalViewEditModeTests.cs.meta`; GUID `629434afa706419fbb9172e17b76ce43`.
Source SHA-256 `15d27e62d4dcd69b6abae0fd8bd0aa9ec24d94f896f8b1ecd81e388ce56eab93`; meta SHA-256 `fbf0d2abab7d153e486a3ebe28f86196f290df10a6c0d3da03e5fab70a2110a5`.

- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.UnseenUnavailableAndAvailableEmptyAreDistinctAndRowsPreserveExactServerText`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.MaximumLengthServerStringsRemainVerbatimInScrollableFixedSizeTextFields`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.ReplacementPreservesSelectedHandleAndScrollButClearsRemovedSelectionAndTracking`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.OldAcceptTrackAndRowCallbacksCannotActAfterReplacementBeforeRefresh`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.MetadataReplacementPreservesScrollPositionWhenRowsOverflowViewport`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.AcceptUsesCurrentHandleAndFreshCanAcceptThenSessionBatchesOnlyThatIntent`
- `Roguehalla.Client.Tests.QuestJournalViewEditModeTests.OldSessionCallbacksAndRemovedRowsCannotAcceptAfterRebindWelcomeOrDisconnect`

## TraderDialogViewEditModeTests (6)

Source: `client-unity/UnityProject/Assets/Tests/Editor/TraderDialogViewEditModeTests.cs`; meta: `client-unity/UnityProject/Assets/Tests/Editor/TraderDialogViewEditModeTests.cs.meta`; GUID `fbeed4975d944443b6c6f34fe85c6d32`.
Source SHA-256 `74f08af89ac872699567c2fe7ecc5451bdc3ffa94f6df48ec60abda813bb66cb`; meta SHA-256 `5dbe763a1b42575f08e6837a4e35ff5bfde5735ce102d50757e90e5a32c9f5c8`.

- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.MissingUnavailableAndAvailableEmptyTradeViewsStayDistinctAndOpeningIsReadOnly`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.DuplicateMerchantRowsLabelsAndSignedStatDeltasRenderInSourceOrder`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.StatUsedBlocksOnlyStatTradeWhileBarterPicksAreSentAsOrdinaryInput`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.CurrentOptionsQueueEveryOrdinaryStatPickAndMetadataReplacementInvalidatesOldCallbacks`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.DisconnectAndResumedWelcomeInvalidateOldRowsAndDropQueuedTradeInput`
- `Roguehalla.Client.Tests.TraderDialogViewEditModeTests.RebindingAnUnseenSessionClearsMerchantChoicesAndPendingCopyImmediately`
