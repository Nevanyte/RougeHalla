# P-UNITY-WORLD-MARKS-2: the client draws each camp's patience range and the quest carrier's flag

- **Serves:** owner decision 7 (2026-11-10: the HUD presents what legacy presents); `docs/rework/LEGACY_INDICATORS.md`
  rows W11 and W7, unblocked by P-WIRE17-MAP-2
- **Implementer tier:** implementer-sonnet (Unity presentation; engine-free geometry in `RoguehallaNet`)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework at or after `83a19406` (P-WIRE17-MAP-2 merged)
- **D-rules touched:** D1 loose proof (legacy drawing read, pinned by small tests) · no wire change · no game rule in Unity

## 1. ID and outcome
P-WIRE17-MAP-2 delivers two facts the client does not draw: `MapBlob.Patience` (one byte per tile: 0, or the 1-based
index of the camp whose mobs still chase from that tile) and the quest row's carrier actor id (`QuestRowView.CarrierActor`,
present only while the viewer is delivered that fighter, the local player included). When this lands:
1. **Patience outline (W11):** every camp with living mobs is outlined, during an active non-training run, along the
   edges between its patience tiles and everything else, with the word "PATIENCE RANGE" below the camp, as legacy. The
   edge list is built once per map from the plane.
2. **Quest carrier flag (W7):** a 14 x 12 px gold flag, 56 px above the ground point of the fighter who carries a quest,
   shown only while the row carries the actor id and that actor is drawn.

## 2. Dependencies
P-WIRE17-MAP-2 merged (it is in the base). P-UNITY-WORLD-MARKS-1 is independent (Tab-map labels).

## 3. Relevant legacy paths (read by the oracle author; `packages/` untouched)

### W11 camp patience outline: `packages/client/src/render/CampPatience.ts`
- **When drawn** (`RaidScene.ts:676`): `this.campPatience?.update(state.camps, state.phase === "active" && !state.training)`
  every frame; `CampPatience.ts:90-98` shows camp `i` when `active && camps[i].alive > 0` (and, `:95`, its box overlaps the
  camera: a client cull, left to Unity's renderer and not pinned). So: **always, for every living camp, for the whole
  active run**. Not "near the camp", not "in combat", not "only while chasing"; the local player's position and state never
  enter. A cleared camp (`alive == 0`) has none until its mobs respawn (the file's own comment, `:90`). Lobby, planning,
  ended and training: none. A camp whose outline is null (`:19` `area <= 0` or no spots, or `:34` no tile) never has one.
- **Which tiles** (`:25-37`): tile inside when `territoryGrid == campIndex + 1` and some spot passes `leashOk`
  (`packages/shared/src/mobs.ts:243-262`); the server computes exactly this into `MapBlob.Patience`.
- **Edges** (`:42-52`): for each inside tile, the side facing a non-inside neighbour, out-of-map counting as non-inside;
  segments `[x0, y0, x1, y1]` in world units with `x0 <= x1`, `y0 <= y1`. Each camp is built with its own `inside` array, so
  **an edge between two touching camps is in both outlines** (pinned).
- **Style** (`:63-77`): a dark rim, 3 px, `09242a`, alpha .72, solid; then dashes, 1.5 px, **`8feef0`**, alpha .82, 9 px on
  7 px off. The owner brief and the W11 row say cyan `a9f4f5`; that is the **label** colour only (`:81`), the line is
  `8feef0`. The oracle pins `8feef0` for the line.
- **Text** (`:79-83`): the single static string **"PATIENCE RANGE"**, 10 px monospace, `a9f4f5`, dark stroke `081a20`
  3 px, centred at the camp's centre x and **25 px below** its y (`projY(camp.y) + 25`), shown with the line. **There is no
  seconds text and no per-mob timer anywhere in the legacy range view.** Nothing is cut for lack of a number on the wire.
- Draw depth `-480000` (under everything on the ground), label `-479999`.

### W7 quest carrier flag: `packages/client/src/render/QuestView.ts`
- **When** (`:51-76`): for each quest that is `open`, `visibleQuest`, not expired (`questModel.ts:38-40`: `expiresAt > 0
  && serverNow >= expiresAt`), has a def, **and whose giver is not in fog** (`:57`, `frame.canSee(quest)` returns before the
  carrier block: a legacy quirk, pinned, see LEGACY DOUBTS), and `quest.carrier` has a drawn position: one marker, moved to
  that position every frame (`:72-73`). The position map is the rendered actors (`RaidScene.ts:734` `positions: this.rendered`),
  the local player included (so the local flag is the same code path, `:68-70`). No drawn actor, no flag.
- **Shape** (`:166-168`): fill `kindColor`, 2 px `101318` rim, rect `(-7, -BODY_LIFT - 48, 14, 12)` with `BODY_LIFT = 14`
  (`projection.ts:6`): 14 x 12 px, top edge 62 px above the ground point, centre 56 px above. Plus a feet ring (`strokeEllipse`
  `30 * Y_SCALE`, alpha .8, same colour) at the ground point: **not pinned and cut** (not in the owner's ask; the
  implementer may add it).
- **Colour:** `questKindColor` (`questModel.ts:184-186`): kill `ef9a9a`, collect `80deea`, else `ffd54f`. Only a **fetch**
  quest ever has a carrier (`packages/server/src/sim/quests.ts:154-159`), so the flag is always `ffd54f`; the wire carries no
  quest kind and none is needed.

### Rust side delivered (`docs/backlog/packets/P-WIRE17-MAP-2.md`)
`MapBlob.Patience` is `byte[w*h]` or null (older server, practice, a map with no camps or territory). `CarrierActor` is
set exactly when the viewer is the carrier or is delivered it.

## 4. New paths (all committed by the oracle author as stubs)
- `client-unity/RoguehallaNet/Net/Ui/PatienceOutline.cs` (+ Unity copy and `.meta`): `PatienceEdge`, `PatienceOutline.Edges`,
  `PatienceOutline.Visible`, the legacy constants.
- `client-unity/RoguehallaNet/Net/Ui/QuestCarrierFlag.cs` (+ Unity copy and `.meta`): `CarrierFlagRow`, `QuestCarrierFlag.Rows`,
  the legacy constants.
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampPatienceOutlines.cs` and `QuestCarrierFlags.cs` (+ `.meta`):
  presenters with empty members and final signatures (`ActorPoint` delegate lives in `QuestCarrierFlags.cs`).

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/PatienceOutline.cs`, `QuestCarrierFlag.cs` and their synced Unity copies
  (`bash client-unity/sync-net.sh`)
- `client-unity/UnityProject/Assets/Scripts/Presentation/CampPatienceOutlines.cs`, `QuestCarrierFlags.cs`
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs`: create the two presenters beside `_worldMarks`
  (`:139`), call them next to `_worldMarks.Update` (`:579`), clear them where `_worldIndicators?.Clear()` is called (`:680`).
  Feed `CampPatienceOutlines.Update(session.Map, session.Collections.Camps, session.Phase, session.Training)` and
  `QuestCarrierFlags.Update(rows, ActorPoint over _actors.TryPosition (convert with the same Scale / GroundSquash as
  _hitZones.Position at :131), MarkVisible)`; rows come from `QuestCarrierFlag.Rows(session.Collections.Quests,
  session.ServerTimeMs, list)` into a reused list.
- not `Protocol/**`, not `MatchHud*.cs`, not any existing test

## 6. Contracts and references
- C-OBS: the flag uses only a delivered actor; nothing is revealed. R-AUTH: no game rule in Unity: the plane and the id come
  from the server, the client only draws.

## 7. Behaviour to preserve
- Existing world marks, camp badges, wards and respawn labels unchanged (guards: `WorldIndicatorsEditModeTests`,
  `OverheadIndicatorsEditModeTests`, `CampLabelsHiddenFix4EditModeTests`, `UiLabFixesEditModeTests`; none needs to change).
- A map without a patience plane, or no map, draws nothing and throws nothing. No per-frame garbage.

## 8. Acceptance checks
- `dotnet test client-unity/RoguehallaNet.Tests` (`PatienceOutlineTests`, `QuestCarrierFlagTests`), `bash client-unity/sync-net.sh --check`.
- `client-unity/UnityProject/Tools/editmode.sh` (`WorldMarks2EditModeTests`); then
  `git checkout -- client-unity/UnityProject/Assets/Resources/Showcase/NunitoRegular.asset`, never committed.
- `scripts/gate.sh --quick --oracle packet/P-UNITY-WORLD-MARKS-2` passes.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/PatienceOutlineTests.cs`
- `client-unity/RoguehallaNet.Tests/QuestCarrierFlagTests.cs`
- `client-unity/UnityProject/Assets/Tests/Editor/WorldMarks2EditModeTests.cs` (+ its `.meta`)

Stub-owned (the implementer replaces the bodies, kept in the `stub:` commit): the four files in section 4, their synced
copies and `.meta` files. The constants in the stubs are already final and are pinned by green guard tests.

## 9. Validation commands
See section 8. An EditMode run needs a free Unity project lock (`Temp/UnityLockfile`).

## 10. Risk and suggested model tier
Sonnet.
- **Frost cave on a landmark-mode map:** its camp owns the whole 34-tile reserved site, so the territory is a 34-tile square;
  the patience tiles are that territory intersected with the 24-tile leash circle around each spot
  (`mobs.ts:243-262`, `MOB_LEASH_CAP = 24 * TILE`), so the outline is up to the whole square (a spot near the middle covers it
  all). **Legacy's "when" rule does not keep it from being permanent clutter**: it has no proximity or combat condition, so
  the dashed square and "PATIENCE RANGE" show for the whole active run while the camp has a living mob, exactly like every
  other camp (50 camps on seed 1). It only disappears while the camp is cleared. The oracle pins legacy; if the owner finds
  the cave's square too loud, a near-the-player rule is a deviation (`DEVIATIONS.md` row, owner signs), not part of this packet.
- The label sits 25 px below the camp centre; on the cave the centre is inside the square, so the word reads at the middle.
- The "drawn" flag is a presenter input (`ActorPoint`), so the wiring in `ArenaView` is the one place a mismatch with the
  rendered actor set could hide; the EditMode tests cannot see it.

## Cut or not pinned
- The camera-box cull (`CampPatience.ts:95`): Unity's renderer culls.
- The feet ring under the carrier (`QuestView.ts:168`), the dark rim of the outline and the dash pattern as drawn pixels (the
  constants are pinned, how Unity draws them is the implementer's art; the label's stroke too).
- Depth order values (legacy `-480000`); Unity's sorting is its own.

## LEGACY DOUBTS
- `packages/client/src/render/QuestView.ts:57`: the carrier flag is skipped when the quest **giver** is in fog, even if the
  carrier is plainly visible. Looks accidental (the flag belongs to the carrier). Pinned as legacy by
  `Legacy_quirk_a_row_whose_giver_is_in_fog_draws_no_flag_even_over_a_drawn_carrier`. The owner may prefer to drop the gate;
  that is a deviation, and then that one test changes with the owner's approval.
- `packages/client/src/render/CampPatience.ts` header comment calls the dashes "faint cyan"; the colours are `8feef0` line,
  `a9f4f5` text. The brief's "colour a9f4f5" is therefore the label only.

## Notes from previous attempts
none
