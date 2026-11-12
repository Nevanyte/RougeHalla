# P-UNITY-HUD-CAMPS-3: reward chests show their remaining seconds on the maps and in the world

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-5 minimap, P-UI-6 Tab map); owner direction 2026-11-10
  (MIGRATION checkpoint, decision 3: camp timers on the minimap and Tab map); `docs/unity/PROTOCOL_GAPS.md` rows W2, W3
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
When a camp is cleared its reward chest stands for a limited time. Legacy shows the chest's remaining seconds on the
minimap blip (it replaces the camp's respawn clock while the chest is up: one badge per camp) and a ring with the
seconds in the world. Unity plots chests as plain plus glyphs with no time. The chest rows with their expiry are
already in client state (`Collections.RewardChests`, `RewardChestView.ExpiresAt`). When this lands a pure function
gives each chest's badge text and which camp badge it replaces, and the minimap, Tab map and world draw it.

## 2. Dependencies
- P-UNITY-HUD-CAMPS-2 merged (same map layer files: strictly serial)

## 3. Relevant legacy paths
- `packages/client/src/ui/minimapMarkers.ts:46-71` (badge box, `String(ceil(left))`, the one-badge rule)
- the world chest ring and its seconds (find it under `packages/client/src/render/`; the oracle author names it)

## 4. New paths
- chosen by the oracle author (a `ChestBadges` model beside `CampMarks` / `CampBadges`)

## 5. Exclusive write scope
- the model file, its synced copy and `.meta`
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`, `TacticalMapController.cs` (chest layer)
- none in the world: `Presentation/WorldIndicators.cs` already draws the chest ring and seconds
- EditMode tests for the chest layer

## 6. Contracts and references
- C-OBS: only chests in the viewer's delivered rows. No game rule in Unity: seconds are expiry minus server time.

## 7. Behaviour to preserve
- Camp markers, respawn clocks, reward badges and ward beacons (CAMPS-1, CAMPS-2) except where the one-badge rule
  replaces a clock while a chest is up.
- No allocation per frame.

## 8. Acceptance checks
- `scripts/gate.sh --quick --oracle packet/P-UNITY-HUD-CAMPS-3` passes; Unity EditMode passes.
- Unit tests: a chest with 12.3 s left reads "13"; an expired chest gives no badge; a chest near a cleared camp
  suppresses that camp's respawn clock and the clock returns when the chest is gone; a picked chest (pin legacy).
- One EditMode case: the minimap draws the seconds on a chest.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/ChestBadgesTests.cs` (7 cases)
- The stub commit fixes the model, a new sibling of `CampBadges.cs` (existing files and tests untouched):
  `client-unity/RoguehallaNet/Net/Ui/ChestBadges.cs`, its synced copy and `.meta` under `UnityProject/Assets/RoguehallaNet/Net/Ui/`.
  Implementers fill in the bodies only; types, fields and signatures stay:
  - `struct ChestBadgeRow { Index, WorldX, WorldY, Text, CampIndex }` (Index = position in the delivered rows; CampIndex -1 = no camp)
  - `ChestBadges.CampReach = 1.0`
  - `ChestBadges.Seconds(double expiresAtMs, double serverNowMs)` -> bare digits, null when expiry <= now
  - `ChestBadges.CampOf(MapCamp[] camps, double x, double y)` -> camp index or -1
  - `ChestBadges.Rows(MapCamp[] camps, IReadOnlyList<RewardChestView> chests, double serverNowMs, CampSurface surface, Func<double,double,bool> canSee, List<ChestBadgeRow> into)`
    (clear and fill; `canSee` applies to Minimap only; `CampSurface.World` gives an empty list; null chests gives an empty list; null camps
    still lists the chests with CampIndex -1)
  - `ChestBadges.Replaces(IReadOnlyList<ChestBadgeRow> rows, int campIndex)` -> true when a drawn chest stands at that camp
- Not an oracle file (implementer work): the Unity wiring and the EditMode case in section 8. Tests build `RewardChestView` by reflection
  (setters are internal), as `WorldIndicatorsEditModeTests` does.

## Legacy rules as verified (pinned by the oracle)
- Text: `String(Math.max(0, Math.ceil(left)))`, bare digits on the minimap blip (`minimapMarkers.ts:60-63`; `minimap.ts:283` ceil again,
  `mapPainter.ts:677`). 12.3 s -> "13", 12.0 -> "12", 1 ms -> "1".
- A blip exists only for a chest with `left > 0` (`RaidScene.ts:1114`); the server removes the chest in the tick `now >= expiresAt`
  (`sim/chests.ts:207-211`), so expiry == now gives no badge (strict).
- Pairing: legacy does NOT use the camp index. The one-badge filter drops a respawn blip when ANY chest blip is within `hypot < 1` world unit
  of the camp's map position (`minimapMarkers.ts:69-70`; strict, so exactly 1 is not paired). It works because a camp's chest stands at the
  camp centre (`chestSpot`, `sim/chests.ts:73-78`; `mapgen.ts:939-942` sets `chest` and `x,y` from the same `site`). The server does hold the
  camp index on the container (`box.camp`, `chests.ts:64`) but the wire row does not carry it. No adaptation needed: positions on the wire are
  on a 1/8 unit grid (`Quant.DequantizePos`), far inside the 1 unit reach.
- Suppression follows the DRAWN chest blips: the blip list only holds chests the viewer can see (`RaidScene.ts:1096`), so an unseen
  chest leaves the camp's respawn clock up.
- Picked / not choosable: legacy never reads pickers or takenBy for the blip, the ring or the seconds (`RaidScene.ts:1096-1114`,
  `ContainerView.ts:130-160`); the chest stays until expiry (`chests.ts:207-211`). So picked and `CanChoose == false` rows show their
  seconds like any other.
- Minimap: chests are gold ringed blips with the seconds under them (`mapPainter.ts:661-693`); sight-gated (above).
- World (ALREADY DONE, no work): the ring that drains over `CHEST_SECONDS = 15` and the `Ns` text within `2 x CHEST_RANGE` of the local
  player (`ContainerView.ts:130-160`, `TIMER_TEXT_REACH`, `shared/constants.ts:558-560`) is `WorldIndicators.DrawChestRing` with
  `WorldIndicatorRules.SecondsText/Near/RingStep` and tests in `WorldIndicatorRulesTests.cs`. The model therefore has no World output.

## Owner direction, not legacy (flag for review)
- Tab map: legacy draws no chest on the Tab map at all (`paintChests` is called only for the minimap, `mapPainter.ts:661`,
  `minimap.ts:277`; `planning.ts` has only the elite "Aug" badge). Owner decision 3 asks for timers on both maps, so the Tab map shows the same
  bare seconds. It applies no sight filter (map knowledge; the delivered rows are already limited by C-OBS), unlike the minimap.

## Not on the wire
- Chest ownership (`ContainerState.owner`, a kill augment private to its killer): legacy hides other players' kill augments
  (`RaidScene.ts:1097`) and uses a longer life (`KILL_AUG_SECONDS`). The wire row has neither; delivered rows are taken as the viewer's own.
- The ring/text life cap (`Math.min(life, left)`, `RaidScene.ts:1112`) is world-only and already handled there.
- Minimap `MAX_CHESTS = 60` (`minimap.ts:48`) is not modelled (a match has a handful of chests).

## Unity files the implementer changes
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`: `Present` (line ~107 builds `_chests` from `RewardChests`; call
  `ChestBadges.Rows` into a reused list with `Large ? TabMap : Minimap` and the minimap's sight test if the map has one, else null); the
  chest plus glyph pass (~:363) draws `Text` beside each chest with the existing badge text helper; the camp respawn clock for a camp with
  `ChestBadges.Replaces(rows, i)` is not drawn (`_camps` countdown pass, ~:203-250). `TacticalMapController.cs` legend row (~:209) only if its text changes.
- World: none (see above). EditMode case: the minimap draws "13" for a chest with 12.3 s left and drops the camp clock.

## 9. Validation commands
- `dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Small.

## 11. Known traps
- Which camp a chest belongs to: chest rows carry a position, not a camp index; pin how legacy pairs them (nearest
  camp within a distance) and copy it.

## Notes from previous attempts
