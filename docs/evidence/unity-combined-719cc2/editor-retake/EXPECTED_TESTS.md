# Expected UI Gate Tests

Frozen source: `719cc2b7e78415226246c0273ae9c78f7385fc04`. Disk `.cs` and `.meta` SHA-256 values were compared against read-only `git show` output.

**Total:** 34 test methods / 34 selectors across 7 groups.

| Group | Methods | Selectors | Source SHA-256 | `.meta` GUID | `.meta` SHA-256 |
|---|---:|---:|---|---|---|
| `BuildDrawerEditModeTests` | 5 | 5 | `1a21b74b0f66e4ae777e663c778c517186e3e634c4581486693ce6d5df1797eb` | `6995df0d410c4d188dda9c8ab9ecbabb` | `aad91af14e835facd975f707b00dd1d751fc3bc20477fbab1ce9d7a4d79b52cb` |
| `UiInputRoutingEditModeTests` | 10 | 10 | `231bf1918895c181a871e325c663010429808dd3c1ab93556bcc33d94f6aac45` | `f828a23cec084275bbe2f4d7bb93f185` | `bcf8fd8bf40b77c77a9cde2a30c0794a5f6636b2ae73bba8a083ab14c0342064` |
| `MatchHudWishBarrierEditModeTests` | 3 | 3 | `680a6a2e66c17c97d3cee761246ab697f3e47820eee5de65ea481bf0f07c581d` | `42ed7398690c426f8885769e5faed8ad` | `9ee7ff34ea32460af0edf8df0acfc74a71f3bdeb0609b3b204017591b89cdb70` |
| `HubCosmeticsViewEditModeTests` | 7 | 7 | `b9497df9dd5824934ece7c7ce85ea54ee91e314c10e746dff63393e320083b95` | `f87f72a74f9d4be69e495c1b16a0541e` | `6a4231ed2835dbfc121980c03c7657b2d1af2ea4f586c455fb05f832baccf20a` |
| `HubProgressViewEditModeTests` | 3 | 3 | `76a26ae4efd15d65da91eec5c15954fbec850f828d378dbd10a48c9d3b9e7d7f` | `9ed2e7b4dd5241d58ea4ab7a1e0a0af3` | `84370b5e647a7b18b16e787065882443fde47e471d8b5c65416c539f967ba694` |
| `AccountRecoveryViewEditModeTests` | 2 | 2 | `dc171e87ebd395a4b59bf5b59c4d41d3c9f1355e3759d05e1e385b8970e25b53` | `3d27b1c5c0524949b029e33fb04aa312` | `cea2fd37d637112f3ef67fd629eaf72da74762174baa5de901e7b6d5b25a4ba4` |
| `MatchClientAccountBindingEditModeTests` | 4 | 4 | `9d6b5778c92c3a47467a90adc4e471eac283920fb4ff8a362ad303fae77afcea` | `fac78127a58b4044bec5d3a102c8fec7` | `995ff5d51834ee1c063d477bad98a65b67bbcb4a43a4a4f65f1ded641bc03723` |

## Methods

### BuildDrawerEditModeTests (5)

- `DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags`
- `CatalogDrawerHasEightyFocusableCardsAndReadOnlyServerFactsSurviveRefresh`
- `HighestCardStackChangeRefreshesWithoutResettingInspectionOrScroll`
- `DrawerGeometryMaskFiltersAndCallbacksPreserveScrollAndSelection`
- `FactoryButtonsHaveAccessibleMinimumSizeAndGeneratedIcons`

### UiInputRoutingEditModeTests (10)

- `PlainDigitOneQueuesWeaponSwap`
- `ChestChoiceConsumesDigitEvenAsItReleasesChestFocus`
- `TabOpensMapAndBlocksPointerWhileWasdStillQueuesMove`
- `MenuAndResultsPreventTabFromOpeningMap`
- `ClosingSettingsRestoresThePreviouslyFocusedWorldHudControl`
- `SettingsOwnsKeyboardAndBlocksBuildHelpShortcutsWithoutWorldCommands`
- `BuildAndHelpShortcutsStillToggleAndSwitchBetweenTheirPanels`
- `BuildDrawerHidesGlobalHeaderActionsAndRestoresTheirCallbacksOnClose`
- `FocusedTextInputPreventsTabFromOpeningMap`
- `WindowBlurReleasesChestAndHeldMapFocus`

### MatchHudWishBarrierEditModeTests (3)

- `OwnerFactsRenderAndClearAcrossWishAndSessionResetTransitions`
- `OwnerVitalPercentagesPreserveDeliveredSharesAndHandleInvalidInput`
- `WeaponIconsRetainSemanticTintAcrossSlotChangesAndClearMissingInventory`

### HubCosmeticsViewEditModeTests (7)

- `NullOwnerCanInitializeAndShowUnavailableCatalog`
- `ShowingAndChangingCallsSignDoNotIssueProfileReadsAndRefreshRequiresOwnedProfile`
- `EquipGuardAllowsNullOnlyForAnEquippedSlotAndRequiresOwnershipOtherwise`
- `FocusRestoresTheNewActionWhileTheRetiredSameNamedCardStillExists`
- `ExistingOwnedFullProfileCanPurchaseWithoutExtraReadAndShowsPendingBeforeReply`
- `SameNameCredentialReplacementHidesAndRejectsOldUnknownRetryWithoutLosingHistory`
- `UnusableSameNameOwnerClearsWalletAndStatusWithoutDiscardingUnknownPurchase`

### HubProgressViewEditModeTests (3)

- `FormatsInt64WithoutFloatingPointLoss`
- `AchievementRowsShowServerFactsAndPreserveUnknownFutureIds`
- `OwnerRankIsClearedOnCancelAndSelectionChangeAndLatePrivateBoardCannotRestoreIt`

### AccountRecoveryViewEditModeTests (2)

- `UnownedAndFailedProfilesCannotRevealARecoveryKey`
- `OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur`

### MatchClientAccountBindingEditModeTests (4)

- `SelectingFactionDuringDeferredJoinInvalidatesIntentAndCreatesNoSocket`
- `StaleJoinFailureCannotOverwriteProfileSelectedBySynchronousFlowCallback`
- `MutatingMatchUrlWhileOwnershipRequestIsPendingCannotUseCapturedIntentOrConnect`
- `SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl`

## Source identity

The earlier `EXPECTED_TESTS.json` and `.md` were preserved as `EXPECTED_TESTS.initial-during-switch.*`. They were read during the checkout switch and are superseded by this manifest. Frozen source verification: Read-only git show of each .cs and .cs.meta; all disk hashes match.
