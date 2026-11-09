# Fresh 035b22c8 discovery review

## Result

`discovered-cases.json` is a fresh EditMode discovery snapshot (`executedTests: false`) with 42 case records and 42 unique `FullName` values. Every record is `Runnable`; no duplicate names were found. The loaded module is `Roguehalla.Client.EditModeTests.dll`, MVID `cad30248-17a5-410a-8d1b-d6b883f2b74d`.

The discovered set matches the frozen contract exactly: all 25 `unchanged25FullNames`, plus the 17 source-listed launch-mode cases. There are no missing, extra, substituted, or parameter-collapsed cases. The 17 launch cases represent 14 unique methods.

## Fixture closure

The helper's recorded class-filter lists match the discovered records for each fixture:

| Fixture | Discovered | Frozen expected |
|---|---:|---:|
| `Roguehalla.Client.Tests.QuestJournalViewEditModeTests` | 8 | 8 |
| `Roguehalla.Client.Tests.TraderDialogViewEditModeTests` | 6 | 6 |
| `Roguehalla.Client.Tests.PlayerFlowsEditModeTests` | 11 | 11 |
| global `MatchLaunchEditModeTests` | 17 | 17 |

The global fixture prefix is intentional and agrees with the loaded source identity. `Roguehalla.Net.MatchLaunchMode` is the argument enum's type, not the fixture namespace.

## Typed launch-case arguments

All six parameterized cases bind to the frozen source tuples using actual discovered argument values:

- `LeaveOrDestroyDuringOwnershipRequestPreventsLateSocketCreation`: `false`, `true` (`System.Boolean`).
- `OrdinaryOwnedTargetAndModeRemainUnconfirmedUntilAnAcceptedMatchingSnapshot`: `(Arena, false)`, `(Training, true)`; enum type `Roguehalla.Net.MatchLaunchMode`, with `Arena = 0` and `Training = 1`.
- `WrongDeliveredModeClosesTheExactSessionWithoutFallbackOrGameplayInput`: `(Arena, true)`, `(Training, false)` with the same enum type and values.

These literal source tuples remain distinct. No negative or opposite-value case was relabeled or replaced with a count-only result.

## Evidence and limits

Reviewed the fresh `discovered-cases.json` against `EXPECTED_SELECTORS.frozen.json`, including the four recorded `classFilterMatches` lists. The file reports 42 leaves and all are runnable; the helper filters to `!IsSuite && !HasChildren`. No test execution was performed in this review, so outcomes remain unrun here. This is metadata binding only and says nothing about Play Mode or rendered/native acceptance.
