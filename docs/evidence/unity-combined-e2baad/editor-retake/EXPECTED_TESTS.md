# Expected selectors — e2baad

Exact source: `e2baadae03dd25cf74979bdfeb3bf35fd696393d`. Derived read-only with `git show`; no tests run by this author.

Scope: recovery (2) plus global MatchClient account binding (4), six selectors total. This is revision scoped; prior receipts are not reruns.

| Class | Selectors | Source SHA-256 | .meta GUID | .meta SHA-256 |
|---|---:|---|---|---|
| `AccountRecoveryViewEditModeTests` | 2 | `1c736677f4ea514478e420fc1837df0a082b114a791223b5dca77a81590d35e4` | `3d27b1c5c0524949b029e33fb04aa312` | `cea2fd37d637112f3ef67fd629eaf72da74762174baa5de901e7b6d5b25a4ba4` |
| `MatchClientAccountBindingEditModeTests` | 4 | `9d6b5778c92c3a47467a90adc4e471eac283920fb4ff8a362ad303fae77afcea` | `fac78127a58b4044bec5d3a102c8fec7` | `995ff5d51834ee1c063d477bad98a65b67bbcb4a43a4a4f65f1ded641bc03723` |

## Methods

### `AccountRecoveryViewEditModeTests` (Roguehalla.Client.Tests)
- `UnownedAndFailedProfilesCannotRevealARecoveryKey` (1 selector)
- `OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur` (1 selector)
### `MatchClientAccountBindingEditModeTests` (global namespace)
- `SelectingFactionDuringDeferredJoinInvalidatesIntentAndCreatesNoSocket` (1 selector)
- `StaleJoinFailureCannotOverwriteProfileSelectedBySynchronousFlowCallback` (1 selector)
- `MutatingMatchUrlWhileOwnershipRequestIsPendingCannotUseCapturedIntentOrConnect` (1 selector)
- `SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl` (1 selector)

## Revision boundaries

- The 95bd9c recovery run recorded 1 pass and 1 failure; this cut retakes recovery selectors and adds four account-binding selectors. Do not add prior cosmetics/progress outcomes to this cut.
- The 719cc2 receipt’s 18 passes remain separately scoped and were not rerun in this cut.
