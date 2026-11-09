# Source-derived expected test identities

Requested source release: `6cdf893c67f55b70eb832c49ca01e72a7f7839f6`.

Expected identities are derived from source `[Test]` attributes and public test method names, with sibling `.meta` GUIDs. No Unity test discovery or execution was run. This manifest does not claim an imported assembly is current or that the Editor accepted these tests.

**Expected total: 34 test methods / case identities; 0 `[TestCase]` attributes across these seven files.**

## Roguehalla.Client.Tests.BuildDrawerEditModeTests — 5

- Source: `Assets/Tests/Editor/BuildDrawerEditModeTests.cs`
- Frozen `.meta` GUID: `6995df0d410c4d188dda9c8ab9ecbabb`

- `BuildDrawerEditModeTests.DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags`
- `BuildDrawerEditModeTests.CatalogDrawerHasEightyFocusableCardsAndReadOnlyServerFactsSurviveRefresh`
- `BuildDrawerEditModeTests.HighestCardStackChangeRefreshesWithoutResettingInspectionOrScroll`
- `BuildDrawerEditModeTests.DrawerViewportBuildsVisibleCardMeshesClipsHitsScrollsAndKeepsSelection`
- `BuildDrawerEditModeTests.FactoryButtonsHaveAccessibleMinimumSizeAndGeneratedIcons`

## Roguehalla.Client.Tests.UiInputRoutingEditModeTests — 10

- Source: `Assets/Tests/Editor/UiInputRoutingEditModeTests.cs`
- Frozen `.meta` GUID: `f828a23cec084275bbe2f4d7bb93f185`

- `UiInputRoutingEditModeTests.PlainDigitOneQueuesWeaponSwap`
- `UiInputRoutingEditModeTests.ChestChoiceConsumesDigitEvenAsItReleasesChestFocus`
- `UiInputRoutingEditModeTests.TabOpensMapAndBlocksPointerWhileWasdStillQueuesMove`
- `UiInputRoutingEditModeTests.MenuAndResultsPreventTabFromOpeningMap`
- `UiInputRoutingEditModeTests.ClosingSettingsRestoresThePreviouslyFocusedWorldHudControl`
- `UiInputRoutingEditModeTests.SettingsOwnsKeyboardAndBlocksBuildHelpShortcutsWithoutWorldCommands`
- `UiInputRoutingEditModeTests.BuildAndHelpShortcutsStillToggleAndSwitchBetweenTheirPanels`
- `UiInputRoutingEditModeTests.BuildDrawerHidesGlobalHeaderActionsAndRestoresTheirCallbacksOnClose`
- `UiInputRoutingEditModeTests.FocusedTextInputPreventsTabFromOpeningMap`
- `UiInputRoutingEditModeTests.WindowBlurReleasesChestAndHeldMapFocus`

## Roguehalla.Client.Tests.MatchHudWishBarrierEditModeTests — 3

- Source: `Assets/Tests/Editor/MatchHudWishBarrierEditModeTests.cs`
- Frozen `.meta` GUID: `42ed7398690c426f8885769e5faed8ad`

- `MatchHudWishBarrierEditModeTests.OwnerFactsRenderAndClearAcrossWishAndSessionResetTransitions`
- `MatchHudWishBarrierEditModeTests.OwnerVitalPercentagesPreserveDeliveredSharesAndHandleInvalidInput`
- `MatchHudWishBarrierEditModeTests.WeaponIconsRetainSemanticTintAcrossSlotChangesAndClearMissingInventory`

## Roguehalla.Client.Tests.HubCosmeticsViewEditModeTests — 7

- Source: `Assets/Tests/Editor/HubCosmeticsViewEditModeTests.cs`
- Frozen `.meta` GUID: `f87f72a74f9d4be69e495c1b16a0541e`

- `HubCosmeticsViewEditModeTests.NullOwnerCanInitializeAndShowUnavailableCatalog`
- `HubCosmeticsViewEditModeTests.ShowingAndChangingCallsSignDoNotIssueProfileReadsAndRefreshRequiresOwnedProfile`
- `HubCosmeticsViewEditModeTests.EquipGuardAllowsNullOnlyForAnEquippedSlotAndRequiresOwnershipOtherwise`
- `HubCosmeticsViewEditModeTests.FocusRestoresTheNewActionWhileTheRetiredSameNamedCardStillExists`
- `HubCosmeticsViewEditModeTests.ExistingOwnedFullProfileCanPurchaseWithoutExtraReadAndShowsPendingBeforeReply`
- `HubCosmeticsViewEditModeTests.SameNameCredentialReplacementHidesAndRejectsOldUnknownRetryWithoutLosingHistory`
- `HubCosmeticsViewEditModeTests.UnusableSameNameOwnerClearsWalletAndStatusWithoutDiscardingUnknownPurchase`

## Roguehalla.Net.Tests.HubProgressViewEditModeTests — 3

- Source: `Assets/Tests/Editor/HubProgressViewEditModeTests.cs`
- Frozen `.meta` GUID: `9ed2e7b4dd5241d58ea4ab7a1e0a0af3`

- `HubProgressViewEditModeTests.FormatsInt64WithoutFloatingPointLoss`
- `HubProgressViewEditModeTests.AchievementRowsShowServerFactsAndPreserveUnknownFutureIds`
- `HubProgressViewEditModeTests.OwnerRankIsClearedOnCancelAndSelectionChangeAndLatePrivateBoardCannotRestoreIt`

## Roguehalla.Client.Tests.AccountRecoveryViewEditModeTests — 2

- Source: `Assets/Tests/Editor/AccountRecoveryViewEditModeTests.cs`
- Frozen `.meta` GUID: `3d27b1c5c0524949b029e33fb04aa312`

- `AccountRecoveryViewEditModeTests.UnownedAndFailedProfilesCannotRevealARecoveryKey`
- `AccountRecoveryViewEditModeTests.OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur`

## MatchClientAccountBindingEditModeTests — 4

- Source: `Assets/Tests/Editor/MatchClientAccountBindingEditModeTests.cs`
- Frozen `.meta` GUID: `fac78127a58b4044bec5d3a102c8fec7`

- `MatchClientAccountBindingEditModeTests.SelectingFactionDuringDeferredJoinInvalidatesIntentAndCreatesNoSocket`
- `MatchClientAccountBindingEditModeTests.StaleJoinFailureCannotOverwriteProfileSelectedBySynchronousFlowCallback`
- `MatchClientAccountBindingEditModeTests.MutatingMatchUrlWhileOwnershipRequestIsPendingCannotUseCapturedIntentOrConnect`
- `MatchClientAccountBindingEditModeTests.SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl`

## MatchClientAccountBinding fixture cleanup

`MatchClientAccountBindingEditModeTests` has four source-declared `[Test]` methods and no class-level `[SetUp]`/`[TearDown]`; each test scopes `Fixture` with `using`. The fixture disables `MatchClient` before setup, injects local fake account/match transports and an owned `AccountCoordinator`, and `Dispose` destroys its fixture `GameObject`. `AccountCoordinator.OnDestroy` calls `Flow.Cancel`; `MatchClient.OnDestroy` cancels owned joins, unbinds presentation, resets its timeline, leaves any session, and destroys its arena. No global `PlayerPrefs`, `EventSystem`, `InputSystem`, or static state mutations appear in this fixture/test file.

The first pending ownership operation is explicitly completed after intent invalidation; the URL mutation test completes the pending reply and waits for the flow to settle; the successful join test waits for the fake transport and then decodes its hello. The observer-failure test removes its event callback before fixture disposal. These are source-path cleanup observations, not runtime leak acceptance.
