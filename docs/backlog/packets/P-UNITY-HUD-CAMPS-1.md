# P-UNITY-HUD-CAMPS-1: camps and their respawn timers on the minimap, Tab map and in the world

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 minimap, P-UI-6 Tab map); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 3: "Camp logos (stat buff) and timers dont show on minimap and tab map")
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy shows every camp on the minimap and the Tab map (a marker per camp with its zone shape, an elite glyph, a cleared
cross) with a blue respawn countdown, and "RESPAWN Ns" in the world at a cleared camp. Unity draws none of it, although
the camp state (mob type, elite, alive, state, respawn time) is already in client state and unused. With protocol 17
the map blob also carries each camp's position, radius and zone. When this lands the Unity minimap and Tab map draw a
marker for every camp at its position with the legacy states, show the respawn countdown for cleared camps, and the
world shows the "RESPAWN Ns" label; the real concealment bushes from the map blob are drawn. Reward badges and ward
beacons are the follow-up P-UNITY-HUD-CAMPS-2 (they need P-WIRE17-HUD-1).

## 2. Dependencies
- P-WIRE17-MAP-1 merged (camp positions and the bush plane in the map blob)

## 3. Relevant legacy paths
- `packages/client/src/ui/minimap.ts` (camp markers and respawn clocks; survey: `:257-269`, `:294-309`)
- `packages/client/src/ui/minimapMarkers.ts` (marker shapes and states; survey: `:60-71`, `:85-92`, `:111-112`)
- `packages/client/src/ui/mapPainter.ts`, `packages/client/src/ui/planning.ts` (Tab map camp layer)
- `packages/client/src/render/CampWards.ts:13-20` ("RESPAWN Ns" label)
(the oracle author verifies the lines and pins the texts, colours and the countdown rounding)

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs` (pure model: from the map's camp list and the camp state rows to
  marker rows with kind, state and countdown text) and its test file

## 5. Exclusive write scope
- the new library file and its synced copy
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (camp layer)
- a small world-label presenter under `client-unity/UnityProject/Assets/Scripts/Presentation/` and its hook in
  `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`
- the bush drawing in `client-unity/UnityProject/Assets/Scripts/View/Regions/` (from the map blob's bush plane)

## 6. Contracts and references
- C-OBS: a camp's position is public map data (legacy clients generated the map); its state comes from the camp rows
  the server already sends to this viewer. Nothing is inferred beyond those rows.
- No game rule in Unity; the countdown is server time minus the row's respawn time, drawn only.
- Camp rows: `client-unity/RoguehallaNet/Net/Collections.cs` (around `:407-411`: `MobType`, `Elite`, `Alive`, `State`,
  `RespawnAt`); map camps: `client-unity/RoguehallaNet/Protocol/MapBlob.cs` (protocol 17), index-aligned with the rows.

## 7. Behaviour to preserve
- Existing map marks (contacts, route, quests, traders, chests, zone icons) and their draw order.
- Decorative bushes keep being drawn only where they do not sit on a real concealment cell.
- No allocation per frame in the map mark pass.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-CAMPS-1-oracle` passes; Unity EditMode suite passes.
- Unit tests on the pure model: one marker per camp at the map position; alive, cleared and elite states; the countdown
  text for a cleared camp with a respawn time (legacy rounding); no countdown when the camp is alive or has no time;
  a camp-row count that differs from the map's camp count gives no markers and no exception.
- One EditMode case: the tactical map draws the model's markers.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/CampMarksTests.cs` (6 cases). The stub `client-unity/RoguehallaNet/Net/Ui/CampMarks.cs`
  (and its synced copy) fixes the signatures: `CampMarks.Markers(MapCamp[] camps, IReadOnlyList<CampView> rows, double
  serverNowMs, bool active, List<CampMarkRow> into)` and `WorldLabels(..., List<CampWorldLabel> into)`; both clear `into`
  and fill it (caller-owned list, so the per-frame pass allocates nothing). Implementers fill in the bodies only; the
  public types and signatures stay.

## Legacy rules as verified (pinned by the oracle)
- State codes: 0 idle, 1 engaged ("somebody has fought here", sticky history), 2 cleared; any other value is drawn as idle
  (`minimap.ts:298-310`, `mapPainter.ts:510-512`, `planning.ts:748-751`).
- Marker: every map camp, regardless of sight (`minimapMarkers.ts:85-92` loops `input.camps`); zone shape in zone colour
  with dark outline `#0b0e11`; elite camp bigger (radius 4.6 vs 3.4) with its elite glyph above (crown `#ffd54f` fallback);
  cleared: drawn at alpha 0.38 with an X in `#eceff1` over a dark `#0b0e11` line; engaged: small muted ring
  (`mapPainter.ts:503-516, 584-629`). A camp mark is dropped when a contact or clock sits within 8 px
  (`minimapMarkers.ts:87-88`).
- Minimap clock: only for state 2 with `respawnAt > 0`, only while the match is active (not training)
  (`minimap.ts:258-265`, caller `RaidScene.ts:784`); text = `max(0, ceil((respawnAt - serverNow) / 1000))` as a bare integer,
  so 181000 vs 1100 reads "180" and an expired clock reads "0" (it does not disappear); colour `#b4c9dc`, a small clock
  glyph left of the digits (`minimapMarkers.ts:10, 60-71, 135-155`); replaced by the chest badge while that camp's reward
  chest is up (`:70`, chest is a later packet).
- World label: state 2 with `respawnAt > 0`: `RESPAWN ${ceil((respawnAt-now)/1000)}s` while `respawnAt > now`, else
  `RESPAWN READY`; 11 px monospace `#e5edf7`, 3 px stroke `#08101d`, centred 32 px below the camp (`CampWards.ts:19-30`).
  Note the boundary: at `respawnAt == now` the minimap shows "0" and the world shows READY.
- Tab map: same state vocabulary (cross for cleared, text "Cleared" / "Someone has fought here" in the camp line,
  `planning.ts:748-751`); the Tab map shows no clock in legacy, the owner asked for one, so reuse the minimap text.
- Pinned from the owner's brief, not legacy: a camp-row count that differs from the map's camp count gives no markers
  (legacy would draw idle markers for missing rows; Unity treats it as "rows not delivered yet").
- Elite in Unity comes from the camp row (`CampView.Elite != null`); legacy used the map's `eliteSpot`. Equivalent when
  the server sends the row; flag any difference found.

## Unity files for the implementer
- `UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (camp layer; use `MapProjection`).
- World label: new presenter under `Scripts/Presentation/`, hooked from `Scripts/View/ArenaView.cs`.
- Bushes: decorative bushes are `*.bush` `PropRule`s in `Scripts/View/Regions/RegionThemes.cs` (lines ~112, 122), placed by
  `Scripts/View/Regions/RegionProps.cs`; the real bush cells (`MapBlob.Bushes`, row-major, non-zero = bush id) should be
  drawn there, and decorative bushes must skip those cells (section 7).

## Not established by the oracle
Colours, glyphs, placement and the bush drawing are visual and covered only by the EditMode case; the oracle pins the
model (rows, states, text, rounding, boundaries).

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`
- Unity EditMode batch (in the worktree, through a copy-on-write clone of the main checkout's `Library`)

## 10. Risk and suggested model tier
Sonnet. Medium: three surfaces (minimap, Tab map, world) over one pure model.

## 11. Known traps
- World units to map pixels: use the existing map projection (`RoguehallaNet/Net/Ui/MapProjection.cs`), do not rescale
  by hand.
- Fog of war: legacy shows every camp marker regardless of sight (map knowledge), but a camp's alive/cleared state only
  as last delivered. Pin what legacy does and copy it.
- The minimap is small: clocks must not overlap contact dots; follow legacy's placement.

## Notes from previous attempts
