# P-AUG-UI-3: draw every Marked Man holder on the minimap and Tab map

- **Serves:** AUGMENT_ELITE_REWORK decision 9 (the holder is always shown on every minimap); proposed by P-AUG-NATIVE-5 decision 9.
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** `coord/int-74` @ `314261a56` (P-AUG-NATIVE-5 landed there)
- **D-rules touched:** D1 loose proof (pure helper unit tests) · D2 n/a · D5/D6/D9 none (presentation only, no game rule)

## 1. ID and outcome
Every `Collections.Marked` row (State key 15: `{Id, X, Y}` of every Alive Marked Man holder, identical for every viewer, regardless of vision) is drawn as a mark on the minimap and the Tab map at the row's own position, with no actor or sight test. When the rows clear (reset, holder dies or loses the card) the marks go. A viewer with no rows sees nothing new.

Pinned choices (doubts below):
- The viewer's own row is **not** drawn as a second mark: the self ring is already at that point and the player knows its own card. `MarkedHolders(rows, selfId, into)` skips `Id == selfId`.
- Marks are in ascending id (the wire guarantees it; the helper also sorts, so out-of-order input is safe).
- Marks come from the rows, never from `_actors` (a holder outside vision has no actor).

## 2. Dependencies
P-AUG-NATIVE-5 (in base): `Collections.Marked`, `WireMarked`, `StateKey.Marked`.

## 3. Relevant legacy paths
Legacy has no Marked Man marker (the card is new in the rework). Pattern to follow: existing contact labels, `WorldMarks.TabMapContacts` (`client-unity/RoguehallaNet/Net/Ui/WorldMarks.cs`, legacy planning.ts:1117, RaidScene.ts:842-845), and the drawing in `TacticalMapMarks.cs` (`Present` ~l.133-150; player dots in `OnPopulateMesh` ~l.509-517; self ring ~l.518). Public-marker rule: AUGMENT_ELITE_REWORK decision 9, C-OBS. OWNER_DECISIONS: no row on this subject beyond the 2026-11-18 rework row.

## 4. New paths
None (a new `MarkedMark` struct and `WorldMarks.MarkedHolders` inside `WorldMarks.cs`).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/WorldMarks.cs`
- `client-unity/UnityProject/Assets/RoguehallaNet/Net/Ui/WorldMarks.cs` (only via `bash client-unity/sync-net.sh`)
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`

## 6. Contracts and references
C-OBS (the marker is deliberately public), R-AUTH (no rules in Unity), `client-unity/AGENTS.md`.

## 7. Behaviour to preserve
`TabMapContacts` output and the ENEMY/HUNT words unchanged (existing `WorldMarksTests`, 6 tests, all stay green); no new wire bytes; camp, chest, route, ping drawing unchanged.

## 8. Acceptance checks
- `dotnet test client-unity/RoguehallaNet.Tests` green, `bash client-unity/sync-net.sh --check` clean.
- Implement `MarkedHolders` (skip self, sort ascending into the output, clear `into` first).
- In `TacticalMapMarks.Present` (both `Large` and minimap): `WorldMarks.MarkedHolders(session.Collections.Marked, _selfId, _marked)` into a pooled `List<MarkedMark>`, cleared with the other lists (also when `session` is null, not InMatch, or `map` is null); in `OnPopulateMesh` draw one distinct marker per mark (suggest a Diamond/Ring glyph in a warning/danger theme colour, larger than a player dot, drawn after the dots and before the self ring). Existing EditMode suite stays green; a look check of minimap and Tab map is the implementer's report.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/WorldMarksTests.cs` (existing 6 tests untouched; 5 new appended; one `using Roguehalla.Net.Protocol;` line added, compile-only)

Existing tests pinning the area: `WorldMarksTests` (TabMapContacts: HUNT/ENEMY words, living others only, dead target, minimap none); `AugmentUi2Tests` (Marked Man card title only). No conflict.

Red now (stub `MarkedHolders` only clears): `EveryOtherHolderGets...` (count 2 vs 0), `TheViewersOwnRowIsNotDrawn...` (2 vs 0), `MarksAreInAscendingId...` (3 vs 0), `NoRowsDrawNothing...` (1 vs 0 after the one-row call), `MarkedHoldersDoNotChangeTheTabMapContactLabels` (marks.Count 1 vs 0).

## 9. Validation commands
`~/.dotnet/dotnet test client-unity/RoguehallaNet.Tests --filter FullyQualifiedName~WorldMarksTests`; `scripts/gate.sh --quick --oracle packet/P-AUG-UI-3`.

## 10. Risk and suggested model tier
Low; Sonnet. The Unity drawing is not unit-tested (look check only).

## 11. Known traps
- `_selfId` is set in `Present` after `Snapshots.Sample`; use it, not `Me.Id`.
- Clear the new list on every `Present`, or a dead holder's mark lingers.
- The rows are a shared decoded array: do not mutate or sort it in place; sort the output.
- Mark colour must separate from faction dots (zone-art contrast preference).
