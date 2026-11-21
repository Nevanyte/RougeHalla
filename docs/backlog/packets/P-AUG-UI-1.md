# P-AUG-UI-1: card text for the 22 retuned augments

- **Serves:** not in the plan: owner approval 2026-11-18 (elite and augment rework, `docs/backlog/AUGMENT_ELITE_REWORK.md`, wave W1)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (numbers match Appendix A) · D2 n/a · D5/D6/D9 none (presentation text only)

## 1. ID and outcome
`CardDisplayCatalog.cs` carries hand-written card text. The live server will run the Rework numbers (`SimConfig::augments = Rework`), so
the text for the 22 retuned cards must show them. Cards whose Appendix A change is Readability, Pool weighting or No change
(Best Offense, Eye for an Eye, A Race to 0) keep their text. No other row, no id, no order, no title changes. Decision 4 of the plan:
Gambler 18% double / 12% half. Wishful Thinking reads: each hit takes 1.5% of the full Wish cooldown, at most 20% a minute.

## 2. Dependencies
none (the Rust side lands in other packets; this file is text only).

## 3. Relevant legacy paths
Legacy text is the "Now" column of Appendix A. The current C# text (`client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs`,
rows 37-79; the trailing comment is the card index) matches every "Now" value; no card mismatches. Wording extras only: Third Time's
says "on the same target", Boom adds a 1.25x damage-over-time clause. Rust source of the numbers: `crates/rh-sim/src/cards/catalog_data.rs`
(pinned to the legacy capture, unchanged here).

Rework targets (Appendix A, "Rework" column):
Tank Engine 1.5 HP per blocked point, cap +350 · Plant Your Feet +35% range and damage · Slow Burn only 15% less per second after break-off ·
Pocket Sand 40% slow for 1.5 s · Wishful Thinking 1.5% of full cooldown per hit, at most 20% a minute · Overkill 260 u ·
Third Time's 2.5x on-hit effects · Spiked Shell 20% · Siphon 25% · Hemorrhage 12% · Second Wind heal 25% below 30% · Gambler 18/12 ·
Committed +22% damage (Rework does not mention its +15% speed; the oracle assumes it stays) · Fists +50% attack speed ·
Machine Gun 55% damage per hit · Boom 2.6x · Vampiric Pact +18% · Arcane Overload Wish cooldown x1.5 · Glass Cannon -22% max health.

## 4. New paths
- `client-unity/RoguehallaNet.Tests/CardDisplayReworkTests.cs`

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/UI/CardDisplayCatalog.cs`

## 6. Contracts and references
- Unity holds no rules (`client-unity/AGENTS.md`); text only.
- Existing tests that touch this file: none asserts description text. `BuildDrawerEditModeTests.cs` and
  `TrainingConsoleSelectorsEditModeTests.cs` use only Count, Id and Title (unchanged here). `docs/OWNER_DECISIONS.md`: only the
  2026-11-18 rework row; no conflict.

## 7. Behaviour to preserve
- 80 entries, id order, all titles, and the 58 other rows byte for byte (hash guards in the oracle); the `Count`, `Get`, `Snapshot` API.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-AUG-UI-1` passes; the C# step runs `dotnet test client-unity/RoguehallaNet.Tests`
  (`scripts/gate.sh:60`).

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/CardDisplayReworkTests.cs`

Runner: no runner compiled this file. The `stub:` commit adds one `<Compile Include>` for it to `RoguehallaNet.Tests.csproj` (the file is
self-contained, no usings), so the existing "C# net library tests" gate step runs the oracle. 25 cases: 19 retuned cards, 3 unchanged
cards, Arcane Overload count, id/title hash, other-rows hash. Today 20 fail on assertions, 5 pass (the guards and unchanged cards).

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests --filter CardDisplayReworkTests`

## 10. Risk and suggested model tier
Sonnet, low risk. Wording is free as long as the listed substrings appear and the listed old ones are gone. Keep "twice as long" in
Slow Burn, "twice" in Fists, "1.25x" in Boom, "15% faster" in Committed, "halved"/"doubled" where the oracle lists them.

## 11. Known traps
- `tools/training-console/training-console-source-pins.json:19` pins the SHA-256 of `CardDisplayCatalog.cs`; it goes stale when this
  file changes. No gate step checks it. Outside this write scope: the coordinator or P-AUG-UI-2 refreshes it.
- Do not invent a Committed speed number; if the owner meant to change it, the oracle changes.
- Use plain ASCII ("x" for multiply, "-" for minus), as the file already does.

## Notes from previous attempts
