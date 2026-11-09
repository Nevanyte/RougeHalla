# Expected tests for 95bd9c UI cut

Frozen source: `95bd9c1efcde9b71cb07f23f24aef8ff4fb17013` (source and `.meta` verified with read-only `git show`; workspace copies match).

**Run scope:** 16 selectors across 4 groups. The prior 18 passed selectors remain a separate receipt and were not rerun.

| Class | Methods | Selectors | Source SHA-256 | `.meta` GUID | `.meta` SHA-256 |
|---|---:|---:|---|---|---|
| `HubCosmeticsViewEditModeTests` | 7 | 7 | `d78c64231d6a2b4d24eed743bfb45950751fb3d88b35dc00aca5c3178aa9fea4` | `f87f72a74f9d4be69e495c1b16a0541e` | `6a4231ed2835dbfc121980c03c7657b2d1af2ea4f586c455fb05f832baccf20a` |
| `HubProgressViewEditModeTests` | 3 | 3 | `76a26ae4efd15d65da91eec5c15954fbec850f828d378dbd10a48c9d3b9e7d7f` | `9ed2e7b4dd5241d58ea4ab7a1e0a0af3` | `84370b5e647a7b18b16e787065882443fde47e471d8b5c65416c539f967ba694` |
| `AccountRecoveryViewEditModeTests` | 2 | 2 | `dc171e87ebd395a4b59bf5b59c4d41d3c9f1355e3759d05e1e385b8970e25b53` | `3d27b1c5c0524949b029e33fb04aa312` | `cea2fd37d637112f3ef67fd629eaf72da74762174baa5de901e7b6d5b25a4ba4` |
| `MatchClientAccountBindingEditModeTests` | 4 | 4 | `9d6b5778c92c3a47467a90adc4e471eac283920fb4ff8a362ad303fae77afcea` | `fac78127a58b4044bec5d3a102c8fec7` | `995ff5d51834ee1c063d477bad98a65b67bbcb4a43a4a4f65f1ded641bc03723` |

## Expected method names

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

## Preserved prior passes

Do not rerun as part of this cut. The original 719cc2 receipt reports 18 passed selectors:

- `BuildDrawerEditModeTests` — 5/5 pass, `719cc2b7e78415226246c0273ae9c78f7385fc04`, method names matched.
- `UiInputRoutingEditModeTests` — 10/10 pass, `719cc2b7e78415226246c0273ae9c78f7385fc04`, method names matched.
- `MatchHudWishBarrierEditModeTests` — 3/3 pass, `719cc2b7e78415226246c0273ae9c78f7385fc04`, method names matched.

Receipt: [prior test-verification.json](/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/combined-719cc2-2026-11-08/evidence/test-verification.json). The earlier HubCosmetics suite had two failures; this cut intentionally includes all seven cosmetics selectors again. No inference is made about other unrun tests.

## Imported identity and Net decoder mirror check

The parent’s saved public MonoScript identity receipt matches the `.meta` GUID and full sorted public test-method set for all four groups: `Roguehalla.Client.EditModeTests, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null`, module MVID `347fc0ee-ba5f-48e0-89ed-badd4f96d719`. Net identity records protocol v14 in its loaded assembly. The recommended observer remains external: restrict its name list to these four classes, compare public declared NUnit methods and MonoScript GUIDs with this manifest, and keep assembly/MVID in the receipt.

Exact-cut decoder files (SHA-256):

- `crates/rh-protocol/src/state.rs` — `dc2e8db3f61777887fbbca44e857fc486ec37cf74538ec8b4af92fecb07db882`; workspace matches `git show`: `true`.
- `client-unity/RoguehallaNet/Protocol/State.cs` — `440ee19df31c8fd30d4bfe963f8c2f10aebed10f8498de456dbaff0a590828f3`; workspace matches `git show`: `true`.
- `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/State.cs` — `440ee19df31c8fd30d4bfe963f8c2f10aebed10f8498de456dbaff0a590828f3`; workspace matches `git show`: `true`.
- `client-unity/RoguehallaNet/Protocol/Codec.cs` — `d6977f013d6ebd97d775ae0ffd386f59cfc5eaa6e1cf069ebaaf54109c814370`; workspace matches `git show`: `true`.
- `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Codec.cs` — `d6977f013d6ebd97d775ae0ffd386f59cfc5eaa6e1cf069ebaaf54109c814370`; workspace matches `git show`: `true`.
- `client-unity/RoguehallaNet/Protocol/Messages.cs` — `ad35b76a1e22a31d1388f412d00d2097b4cf789aa130d63b20749d0def4a68ad`; workspace matches `git show`: `true`.
- `client-unity/UnityProject/Assets/RoguehallaNet/Protocol/Messages.cs` — `ad35b76a1e22a31d1388f412d00d2097b4cf789aa130d63b20749d0def4a68ad`; workspace matches `git show`: `true`.
- `client-unity/RoguehallaNet.Tests/TradeQuest14ProtocolTests.cs` — `9f6f2d5ea98c25c3f03d6201d9b3b031048ac2146243d02bf9c278684d8b0e1a`; workspace matches `git show`: `true`.

The two C# `State.cs`, `Codec.cs`, and `Messages.cs` copies are byte-identical at this commit. Rust `rh-protocol` mirrors the C# state assignment: **Quests key 10, Trade key 11**. Protocol version is 14; `QuestAccept` command kind is 17. `TradeQuest14ProtocolTests.cs` is a separate network-test class and is not part of this 16-selector UI gate. There is no Quests state key 14; “14” names the protocol version.

## Scope and actions

Only HubCosmetics (7), HubProgress (3), AccountRecovery (2), and MatchClientAccountBinding (4) are in this cut. No tests were run by this manifest preparation. No source, project, Editor, or test changes were made.
