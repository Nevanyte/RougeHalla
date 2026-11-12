# P-UNITY-HUD-VISUAL-FIX-3: drawer count, readable terrain chips, Hunt card, Tab-map footer and clock, hub activity card, cannon

- **Serves:** owner decision 7 (2026-11-10: the HUD presents the same information as legacy); screenshot round 4
  (2026-11-12, `1aff1d31`), defects 4, 6, 7, 8 and 10, the two "not reached" items, and the grey card
- **Implementer tier:** implementer-sonnet (Unity UI; pure text in `RoguehallaNet`; about 200 changed lines, one packet)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof against the legacy client's text · no wire change · no Rust change (both data items
  were diagnosed: neither has a server-side cause, so no `P-SIM-MOBBONUS-ROWS-1` brief exists)

## 1. ID and outcome
Six things seen in the running Web client. Items 1 and 2 were diagnosed first; the findings are in section 3.
1. **Drawer label "Cards & mob bonuses · 0"** after four kills and a camp clear. The count is of *card types* held, and the
   label never refreshes when the owner build summary changes. The mob rows themselves are correct and drawn (collapsed
   under the label, as in legacy). Make N = card types held + farmed mob types, refreshed when the summary changes.
2. **Terrain chips "never appear"**: they are built and positioned (the full path map plane -> tile -> chip passes in
   EditMode) but drawn as bare 11 unit pale-orange text with no backing, unreadable on snow and sand. Give chips and the
   home-ground note a dark backing like legacy (`terrainChips.css`: `rgba(10,12,16,.72)`, coloured border).
3. **Hunt card**: the status text is drawn very small in a mostly empty card (shots 16, 18).
4. **Tab map**: with a weapon highlighted the Weapon Counters footer runs into "QUESTS & TRADERS"; a cleared camp's
   respawn clock sits under the own-position ring when the player stands on the camp (shots 13, 15).
5. **Hub**: the lobby-activity card overlaps the Weapon Counters decal, the TRAINING tile and the Holy pedestal (shots 05, 21).
6. **Travel cannon**: `PropAppearance.Cannon` (`View/ArenaView.cs:515`) reads as a grey card with a small bar (shot 17).

## 2. Dependencies
none. Runs beside P-UNITY-NAME-GROUP-2 (disjoint files: that packet owns `Presentation/**`, `NameMerge.cs` and the
in-world labels).

## 3. Relevant legacy paths and diagnosis
Item 1 (GAINED / drawer count), traced end to end:
- Legacy: `packages/client/src/ui/hud.ts:111` the drawer summary is the bare text "Cards & mob bonuses" (no count); the rows
  are `ui/mobStatsHud.ts:30-39` ("Normal mob progress", `No normal-mob bonuses yet` when empty); the nine values
  `ui/buildModel.ts:153-179`. Legacy never shows a "0" there.
- Server: `crates/rh-sim/src/build_summary.rs:75-90` fills `mob_rows` per farmed type; `observe.rs:437-466` `summary_into` copies
  them into the owner view; `rh-policy/src/delivery/collections.rs:490-534` quantises and sends them as state key 13 whenever
  the summary changes (`summary_stale` :542-565). Evidence it works live: Soul Defense +18 is exactly 12 stacks x 1.5 (4 kills
  x `kill_stacks` 3) of one Seraph Shard row; Life steal +0.5% is the Holy camp term.
- Decoder: `RoguehallaNet/Protocol/State.cs:955-1030` `BuildSummaryState` reads `MobRows` intact; `Net/Collections.cs:452-455`
  stores `Summary`.
- Draw: `BuildHudText.MobLines` (`BuildHudText.cs:71-94`) lists every row; `MatchHud.Features.cs:421-428` writes them into
  `_mobText` inside `_extrasBody`, which is hidden until the toggle is clicked (legacy `<details>`, same).
- Where "0" comes from: `MatchHud.cs:458` `"Cards & mob bonuses · " + CountCards(view)`, `MatchHud.Features.cs:404` counts card
  types (`view.Cards[i] > 0`); a player with no cards reads 0 whatever was farmed. And `MatchHud.cs:442-453` recomputes the
  label only when cards, boosts or `HasBuild` change, never when `view.Summary` changes. So: the rows are not lost; the label
  is misleading and stale. The count is a port addition (legacy has none): flag for the owner in the hand-off.

Item 2 (terrain chips), traced:
- Driver: `MatchHud.Terrain.cs:71-85` `TickTerrain` (called each frame from `MatchHud.Features.cs:342`) reads the delivered map's
  terrain plane (`_session.Map.Terrain`, `MapBlob.TerrainMode`) at the tile under `Motion.DrawnX/Y` (32 units a tile) and
  `Me.Faction`; no owner status or Welcome flag is involved.
- The Web client's map does carry the plane: `rh-server/src/public_ground.rs:22-30,135-137` sends terrain and region planes,
  `room.rs:610` publishes `hazards` (Map) as the mode; seed1 has 574 ice tiles (all in the Frost region), and `RegionGround.cs:167`
  draws the glossy ice from the same plane, so the player on glossy ice stands on code 6.
- A real `Session` (Welcome with a Map-mode terrain plane, snapshot with a Holy player on an ice tile) driven through
  `TickTerrain` gives chip "◇ ICE" with the right tooltip, the row active, positioned 3 units under the plate, 11 pt text
  (verified in EditMode while writing this oracle). So the chain works; no server data is missing.
- The gap: `MatchHud.Terrain.cs:60-61` the chip's backing `Image` is `Color(0,0,0,0)` and the label colour is `theme.Warning`
  (pale orange), the note `theme.Success` on no plate at all (`:120`). Over snow or sand the contrast is about 1.2:1, so the chip
  is there and invisible. The tests (`TerrainChipsHudEditModeTests`, text only) could not see it. Legacy: dark pill + border.
- Not covered (legacy has it, the port never had it): the RESTING chip for light tiles (code 7; `terrainFeedback.ts:chipsOf`).
  Out of scope; the owner did not report it.

Item 3: `UI/SentencedHuntPanel.cs:39` status label 10 pt in a fixed 224 x 28 box; the box fit (`MythicTextScale.FitBox`) shrinks it.
Item 4: `UI/TacticalMapController.cs:274` the legend box is a fixed 30 units, `:276` the quests heading sits at `34 + sq + 38`; the
legend text (`WeaponCounterGuide.cs:186-188`, two to four lines) is about 55 units. `TacticalMapMarks.cs:248-272`
`RefreshCampClocks` puts the clock at `(0,-16)` under the camp; the own ring (`:513`) is 26 x 1.2 across.
Item 5: `UI/HubLobbyActivityView.cs:34` anchors `(.76,.06)-(.99,.46)` of the canvas whatever the hub room does; the other hub
panels use `HubPanelDock.Apply` from `ApplyViewport`, called from `MatchHud.Legacy.cs:591`.
Item 6: `View/ArenaView.cs:515-521` stone card .62 x .34, bar .48 x .12 untilted, two .2 rings.

## 4. New paths
- none (tests only, in the oracle)

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/BuildHudText.cs` and the synced copy (run `bash client-unity/sync-net.sh`)
- `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs` (only the drawer-label refresh, `:442-458`),
  `MatchHud.Legacy.cs` (the `ApplyLegacyViewport` call for the lobby card, the drawer wiring), `MatchHud.Features.cs`
  (`RefreshBuildIcons`/`CountCards`), `MatchHud.Terrain.cs`
- `.../UI/SentencedHuntPanel.cs` (the Hunt card), `.../UI/TacticalMapController.cs`, `.../UI/TacticalMapMarks.cs`
- `.../UI/HubLobbyActivityView.cs` (the hub activity panel), `.../View/ArenaView.cs` (the cannon prop only, `:515-521`)
- not in scope: `Presentation/**`, `NameMerge.cs` (P-UNITY-NAME-GROUP-2), any Rust, `packages/`

## 6. Contracts and references
- R-AUTH: Unity draws what the server delivered; nothing here computes a game fact. C-OBS unchanged.
- `ShowcaseSettings` text scale: sizes are measured after `MythicUi.ApplyTextScale`.

## 7. Behaviour to preserve
- The GAINED plate's layout and labels (owner: keep them; plate width 294, values at 10); the text-scale fit.
- Tab map: a camp is one buff icon, elite camps a gold diamond, the legend entries.
- `ArenaPropCueEditModeTests.WindEmblemAndCannonHaveDistinctVisibleUnlitSilhouettes` (the cannon keeps stone, bar and ring
  sprites near it and no rune): keep a *small* stone as the carriage base.
- Every existing EditMode and unit test. No existing test is replaced.

## 8. Acceptance checks
- Unit (`RoguehallaNet.Tests/BuildHudHeaderTests.cs`): `ExtrasHeader(cards, summary)` = card types + farmed mob rows; the two-row
  model lists both rows with legacy text (already true: pins the diagnosis).
- EditMode (`HudVisualFix3EditModeTests`): the drawer label follows a summary change with no card change; the terrain chip
  and home note, driven through a real `Session` and `TickTerrain`, have a backing at least 60% opaque and 3:1 text contrast over
  a white ground (Holy on ice shows "◇ ICE"; Frost on ice shows the note and no chip; plain floor nothing); the Hunt card
  body text is at least 11 x scale after `ApplyTextScale`, fits its box and the card, at scales 1 and 1.5, with no rival and tracking.
- EditMode (`TabMapVisualFix3EditModeTests`): at 1280x720 and 1920x1080 stage sizes the footer text ends above the quests
  heading with Wand highlighted; the cleared camp's clock box misses `TacticalMapMarks.SelfMarkerRect` with the player on the camp.
- EditMode (`HubLobbyPanelPlacementEditModeTests`): the card, placed through `HubLobbyActivityView.ApplyViewport`, overlaps none of
  the 13 stations, the launch panel, the wordmark or the station message at both windows, is at least 200 x 100 HUD units and inside the window.
- EditMode (`CannonSilhouetteEditModeTests`): at least 3 distinct shapes, wider than tall (1.3), the stone card under 40% of the
  silhouette, a bar at least .5 long tilted 8 to 60 degrees, two equal rings of at least .24 side by side at the foot.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-VISUAL-FIX-3` passes. Baseline before the oracle: EditMode 721/721, dotnet 1621.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/BuildHudHeaderTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/HudVisualFix3EditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Assets/Tests/Editor/TabMapVisualFix3EditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Assets/Tests/Editor/HubLobbyPanelPlacementEditModeTests.cs` (+ `.meta`)
- `client-unity/UnityProject/Assets/Tests/Editor/CannonSilhouetteEditModeTests.cs` (+ `.meta`)
- the `stub:` commit holds the signatures the implementer replaces: `BuildHudText.ExtrasHeader`, `TacticalMapMarks.SelfMarkerRect`,
  `HubLobbyActivityView.ApplyViewport` (empty; call it from `MatchHud.Legacy.cs ApplyLegacyViewport`, as for the other hub panels).

## 9. Validation commands
- `export PATH="$HOME/.dotnet:$PATH"; dotnet test client-unity/RoguehallaNet.Tests`; `bash client-unity/sync-net.sh --check`
- `client-unity/UnityProject/Tools/editmode.sh`, then `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`

## 10. Risk and suggested model tier
Sonnet. UI geometry; each item is local. Hints for the implementer (not requirements beyond the tests): the lobby card can sit in
the empty top-right floor of the hub room (about 330 x 230 units at the 1422 x 800 stage) with fractional anchors computed from
the viewport like `HubPanelDock`; the legend box can take its preferred height and push the quests heading down.

## 11. Known traps
- Run-time text scale re-applies sizes after build: measure after `MythicUi.ApplyTextScale`; `MythicTextScale.FitBox` shrinks text
  to its box, so a bigger font needs a bigger box.
- The label count's refresh in `MatchHud.cs:442` is keyed on cards and boosts only: key it on `view.Summary` too (reference
  compare, as `RefreshBuildIcons` does).
- An EditMode run modifies `Assets/Resources/Showcase/NunitoRegular.asset`: `git checkout --` it, never commit it.
- Hand-off includes `git diff --stat packet/P-UNITY-HUD-VISUAL-FIX-3`.

## Notes from previous attempts
