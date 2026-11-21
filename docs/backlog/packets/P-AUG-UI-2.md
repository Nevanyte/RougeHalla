# P-AUG-UI-2: native card text, HUD readouts and the first-pick countdown (Unity client)

- **Serves:** not in the plan: owner approval 2026-11-18 (elite and augment rework, `docs/backlog/AUGMENT_ELITE_REWORK.md`, row P-AUG-UI-2 `:178`, details `:259-265`)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** coord/int-72 (`4f1a1884a`)
- **D-rules touched:** D1 loose proof (text and numbers read from the Rust tables) · D2 n/a · D5/D6/D9 none (presentation only; no rule in Unity)

## 1. ID and outcome
Protocol 20 now carries native card ids 80..=93 in chest options, the elite chest's first-pick window (`RewardChestView.FirstPick`: `Until`
server ms, `Mine` = the viewer is the killer) and the viewer's own native readout rows (`CollectionsView.Readouts`: card, kind 0 counter /
1 meter / 2 marks, value, max). The client shows "Unknown card" for a native option and nothing for the other two. When this lands: every
native card has name and text mirroring `crates/rh-sim/src/cards/native/table.rs`; the chest panel names native options; the HUD can show
the owner's readout rows as value/max counters with pips for marks; the chest countdown shows "Your first pick N s" for the killer and
"First pick N s" for everyone else while the window is in force, and nothing after.

## 2. Dependencies
Base coord/int-72 (P-WIRE19-A, P-WIRE19-B, P-AUG-NATIVE-1a..4 in it). Parallel, disjoint: P-AUG-NATIVE-5 (rh-sim; owns any minimap change: no minimap file here), P-AUG-BOTS-1 (rh-policy).

## 3. Relevant paths (cited; legacy has no natives)
- Native names and texts: `crates/rh-sim/src/cards/native/table.rs:33-100` (`native(CardId::X, "title", "text")`, order = `CardId::NATIVE`, `crates/rh-sim/src/cards/catalog.rs:190`). Marked Man's text is there too (`:96-99`).
- Which cards show rows: `native/weapon.rs:88` (Tally counter, Bastion meter 0, Calluses / Executioner's Ledger / Eighth Strike counter), `zone.rs:88` (Pathfinder counter + marks, Hazard Walker counter + meters 0,1,2 = ember, bog, ice, Wish Engine counter), `faction.rs:77` (Corpse Hoarder, Stoked, Glacier, Trophy Hunter counter). Maxima: `table.rs` `NATIVE_RULES` (`:114-190`) and `constants.rs:608-665`. Units: share cards (Tally 0.30, Pathfinder 0.24, Wish Engine 0.25, Corpse Hoarder 0.24, Trophy Hunter 0.15) hold fractions, show as percent; Hazard Walker meters hold ms (cap 20000), show seconds; Pathfinder marks max = 20 normal mob types; Marked Man and Overflow have cap 0 today (value 0, max 0: no NaN, no pips).
- Wire facts: `RoguehallaNet/Protocol/State.cs:100-119` (`WireFirstPick`, `WireReadout`), `Net/Collections.cs:96,340,469,513`. `docs/agent/AUGMENT_REWORK.md` "Native cards" and `docs/backlog/packets/P-WIRE19-A.md:26-35,56` (the countdown wording).
- Client today: `UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs` (80 entries; `Get` returns "Unknown card" beyond), `MatchHud.Chest.cs:105-125` (`FillChestCard`) and `:88-101` (`RefreshChestClock`, whole-chest `ExpiresAt` countdown), `TrainingConsoleSelectors.cs` (generated).
- OWNER_DECISIONS: nothing on the HUD presentation; the plan decisions 6 (readout rows) and 9 (Marked Man) are the wire-side ones.

## 4. New paths
- `client-unity/UnityProject/Assets/Scripts/UI/NativeReadoutText.cs` (+ `.meta`): pure `Roguehalla.Client.NativeReadoutText.Lines(IReadOnlyList<WireReadout>)`.
- `client-unity/UnityProject/Assets/Scripts/UI/FirstPickText.cs` (+ `.meta`): pure `Label(WireFirstPick?, double serverMs)`.
- `client-unity/UnityProject/Assets/Scripts/UI/ChestOptionText.cs` (+ `.meta`): pure `Describe(RewardOptionView)`; `FillChestCard` calls it.
(The `stub:` commit creates all three with the signatures the oracle calls; their bodies are the implementer's.)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs`: natives in a SECOND array declared after `Entries` (the selector generator slices the text between `static readonly Entry[] Entries =` and the first `        };` and asserts 80 ids there); `Count` stays 80, `Snapshot()` stays the 80, `Get(80..93)` answers the natives, `Get(94)` stays "Unknown card".
- `client-unity/UnityProject/Assets/Scripts/UI/NativeReadoutText.cs`, `FirstPickText.cs`, `ChestOptionText.cs` (and metas)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.Chest.cs` (use `ChestOptionText`, `FirstPickText` in `RefreshChestClock`), and the HUD file that draws the owner's rows (a counters/pips strip fed from `Collections.Readouts`; the implementer picks `MatchHud.cs`, `MatchHud.Features.cs` or a new `MatchHud.Readouts.cs`, then lists it in the hand-off). No minimap file.
- `client-unity/UnityProject/Assets/Scripts/UI/TrainingConsoleSelectors.cs` and `tools/training-console/training-console-source-pins.json`: regenerate ONLY by `python3 -I tools/training-console/generate_training_console_selectors.py` (it rewrites both; it asserts 80 cards and 14 interactive entries, which stay true).
- `client-unity/RoguehallaNet.Tests/RoguehallaNet.Tests.csproj` is NOT in scope (the stub commit adds the Compile lines). The net library is not expected to change; if it does, `bash client-unity/sync-net.sh` only.

## 6. Contracts and references
C-OBS (readout rows are own-only; the client shows only what arrives), R-AUTH (no rule in Unity: the client formats, never computes a cap or a window), ADR 0008.

## 7. Behaviour to preserve
- The 80 existing catalog rows byte for byte, `Count == 80`, `Snapshot().Length == 80` (BuildDrawer shows 80 cards).
- Trophy and boost chest options render as before ("TROPHY" / "BOOST", "Permanent bonus for this run.").

## 8. Existing tests that pin what this changes (all stay green, none edited)
- `client-unity/UnityProject/Assets/Tests/Editor/BuildDrawerEditModeTests.cs:38` (`DisplayCatalogExactlyMirrorsRustCardIdsTitlesDescriptionsAndTags`): asserts `CardDisplayCatalog.Count` equals the 80 of `CardId::ALL` and the 80 `catalog_data.rs` rows; `:77` asserts the drawer has 80 buttons. Both stay true if `Count`/`Snapshot` stay 80 (the plan row's "extend it to the natives" is met by this oracle's table.rs mirror instead; the existing test is left alone).
- `TrainingConsoleSelectorsEditModeTests.cs`: the 14 interactive indices 44..73 and their ids/titles; unchanged by this packet.
- `RoguehallaNet.Tests/CardDisplayReworkTests.cs` (P-AUG-UI-1): hashes the 80 titles/ids and the 58 other rows; must still pass.
- `RoguehallaNet.Tests/Wire19ReadoutTests.cs`, `Wire19Tests.cs`: codec only.
No conflict found.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/AugmentUi2Tests.cs`

Runner: the dotnet suite (`dotnet test client-unity/RoguehallaNet.Tests`, a gate step), which compiles the pure UI files by `<Compile Include>` (added by the `stub:` commit). The tests read `table.rs` and `catalog.rs` from the repo, so a Rust rename moves the oracle with it.

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests --filter AugmentUi2Tests`
- `scripts/gate.sh --quick --oracle packet/P-AUG-UI-2`; `client-unity/UnityProject/Tools/editmode.sh` for the existing EditMode suite.

## 10. Risk and suggested model tier
Sonnet. Wording is free where the oracle lists substrings only.

## 11. Known traps and doubts
- The training console grants catalog cards only (`reward_chests/pools.rs` INTERACTIVE; AUGMENT_REWORK.md: "The practice console still grants catalog cards only"), so "selectors include the natives" is taken to mean: regenerate, keep 80/14, refresh the stale source pin. The oracle pins the pin hash of `CardDisplayCatalog.cs` and that the selector list stays inside 0..79. If the owner wants natives grantable, the Rust console must change first.
- The Best Offense hit marker has no server fact on the wire (no block-counts-as-hit event or flag in protocol 20): not testable here; needs its own wire packet. Not in this oracle.
- Pathfinder's "collection on the map" is the minimap (P-AUG-NATIVE-5's area); this packet shows only the HUD strip with pips from the marks row.
- The HUD strip and the chest-panel wiring (`MatchHud*.cs`) are not covered by the dotnet oracle (MonoBehaviour, TMP); the pure helpers carry the proof, the wiring is for the reviewer and the EditMode suite not to regress.
- Windows end is `Until` in server ms vs `Session.ServerTimeMs`; the countdown rounds seconds up, like the chest timer (`MatchHud.Chest.cs:95`).
- Ascii only in text.

## Notes from previous attempts
