# P-UNITY-HUD-VISUAL-FIX-3: mob-bonus row, terrain chips in the running client, Hunt card, Tab-map footer, hub panel, cannon

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy); screenshot round 4
  (2026-11-12, `1aff1d31`), defects 4, 6, 7, 8 and 10, the two "not reached" items, and the grey card
- **Implementer tier:** implementer-sonnet (Unity UI; pure text in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof against the legacy client's text · no wire change (if a defect turns out to be
  missing server data, it is cut into its own packet and named, not worked around)

## 1. ID and outcome
Six things seen in the running Web client:
1. **GAINED "Cards & mob bonuses · 0"** stays at 0 after four kills and a camp clear that raised Soul Defense to +18
   and Life steal to +0.5% (shots 09 to 12). Legacy lists the mob-bonus rows under the nine values
   (`packages/client/src/ui/buildModel.ts:153-179`). Find whether the rows are absent from the owner build summary
   the server sends (key 13 / `build_summary.rs` mob-bonus rows), dropped by the C# decoder, or not drawn
   (`BuildHudText.cs`, `MatchHud.Legacy.cs`), and fix the Unity side; a server-side cause is reported, not patched.
2. **Terrain chips never appear** (shots 12, 14: Holy standing on ice; shot 20 beside lava). The live server runs
   `terrain::Mode::Map`. `TerrainChips.cs` and `MatchHud.Terrain.cs` pass their EditMode tests, so the gap is between
   the snapshot and the strip: trace which fact drives a chip at run time (the map's terrain plane under the local
   player's centre tile, or an owner status), why it is empty in the Web client, and fix it.
3. **Hunt card**: "No rival in sight…" is drawn in a very small font inside a mostly empty card (shots 16, 18).
4. **Tab map**: with a weapon highlighted the Weapon Counters footer lines run into the "QUESTS & TRADERS" heading;
   a cleared camp's respawn clock is hidden under the player marker when the player stands on the camp (shots 13, 15).
5. **Hub**: the lobby-activity panel overlaps the TRAINING tile and the Holy tile at 1280x720 and 1920x1080
   (shots 05, 21).
6. **Travel cannon**: `PropAppearance.Cannon` (`View/ArenaView.cs` near :515) is a blank grey card (shot 17). Give
   it a silhouette that reads as a cannon from the shapes already in the project (barrel, wheels, base), no new
   third-party art.

## 2. Dependencies
none. Runs beside P-UNITY-NAME-GROUP-2 (disjoint files: that packet owns the overhead and in-world labels).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/{BuildHudText.cs,TerrainChips.cs}` and the synced copy
- `client-unity/UnityProject/Assets/Scripts/UI/{MatchHud.Legacy.cs,MatchHud.Terrain.cs,MatchHud.Features.cs,TacticalMapController.cs,TacticalMapMarks.cs}`,
  the hub lobby-activity panel's script, `View/ArenaView.cs` (the cannon prop only)
- not in scope: `Presentation/**` (P-UNITY-NAME-GROUP-2)

## 7. Behaviour to preserve
- The GAINED plate's layout and text labels (owner: keep them; plate width 294, values at 10); the text-scale fit.
- Tab map: a camp is one buff icon, elite camps a gold diamond, the legend entries.
- Every existing EditMode and unit test not named as replaced.

## 8. Acceptance checks
- Unit: from a build summary with two mob-bonus rows the GAINED model lists both rows with their legacy text and the
  header count is 2; with none, the row reads as legacy does for an empty list.
- EditMode: a snapshot with the local player on an ice tile (non-Frost) shows the ice chip; on its home ground the
  home note; off hazard ground no chip; the test drives the same path the running client uses (the oracle author
  names the entry point it found).
- EditMode: Hunt card body text at least the HUD's body size and fits; Tab-map footer and the next heading do not
  intersect with a weapon highlighted; a cleared camp's clock is visible when the player marker is on it (offset or
  drawn above); the hub activity panel's rectangle intersects no faction or mode tile at 1280x720 and 1920x1080.
- EditMode: the cannon prop is built from at least three distinct shapes and is wider than tall.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-VISUAL-FIX-3` passes.

## Oracle files (read-only for implementers)
- listed by the oracle author on `packet/P-UNITY-HUD-VISUAL-FIX-3`

## 10. Risk and suggested model tier
Sonnet. Items 1 and 2 are diagnoses first: the oracle author finds the cause before writing the test, and cuts any
server-side cause into its own brief.

## 11. Known traps
- Run-time text scale re-applies sizes after build: measure after `MatchHud.ApplyTextScale`.
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-HUD-VISUAL-FIX-3`.

## Notes from previous attempts
