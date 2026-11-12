# P-UNITY-WORLD-MARKS-1: the "HUNT" label on the hunted rival's dot on the Tab map

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (P-UI-7 combat presentation); owner direction 2026-11-10 (MIGRATION
  checkpoint, decision 7: the HUD presents the same information as legacy); `docs/rework/LEGACY_INDICATORS.md` row W17
  (its "violet world ring" is not legacy; see section 1)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
The only hunt behaviour legacy draws on a map is a word: on the held-Tab map the Sentenced player's living hunt target
is labelled "HUNT" where every other enemy fighter is labelled "ENEMY". Unity draws contacts as faction marks with no
words (`TacticalMapMarks.OnPopulateMesh`, the `FactionMark` loop). When this lands a pure function decides which
contacts carry which word, and the Tab map draws it. Legacy has no hunt ring in the world, no colour difference and no
minimap word; none is added. (The earlier brief's patience range and carrier flag moved to a wire packet, below.)

## 2. Dependencies
none

## 3. Relevant legacy paths
Legacy rules as verified:
- `packages/client/src/scenes/RaidScene.ts:587-589`: the target counts only when the local player is alive and
  `faction === "sentenced"` and `state.players.get(huntTarget)?.status === "alive"`; it is then also given to vision
  (`setTrackedTarget`).
- `RaidScene.ts:613`: the tracked actor's drawn position is kept as `huntMarker` (`tracked: true`) whether or not the
  normal fog test sees it.
- `RaidScene.ts:837-845`: a Tab-map enemy is a non-local, alive player, only when `mode === "map"`; the hunted one is
  pushed with `tracked: true`. `planning.ts:41-47`: mode is "map" only in an active, non-training run while Tab is held.
- `ui/planning.ts:1084`: a tracked dot is kept when the local player is a living Sentenced player even if fog hides it;
  other dots need `canSee`.
- `ui/planning.ts:1115-1117`: the dot is `pl-actor pl-actor-enemy` for both; the label is "HUNT" if tracked else
  "ENEMY". `ui/planning.css:175-183`: no per-hunt style, so no colour difference. Labels are always shown (no hover).
- Minimap: `RaidScene.ts:772-777` passes plain points to `minimap.setEnemies`: no word, no hunt flag.
- `ui/sentencedHuntHud.ts` is the DOM picker only (status text and buttons); it draws nothing in the world.
- No other file draws a hunt ring: `grep tracked|huntTarget packages/client/src` finds only the above.

Vision (record only, nothing is ported): legacy's "permanent vision of the target" is a client-side reveal (the dot is
kept despite fog, `planning.ts:1084`). The Rust server already delivers the hunted rival to a Sentenced viewer through
fog and bush: `crates/rh-sim/src/vision.rs:382-386` and `:444-446` call `systems/sentenced_hunt.rs:15-20` `sees_target`
(viewer standing, Sentenced, `hunt_target == Some(target)`, target alive). So the Unity client already has the rival in
its delivered actors; when the target is not delivered (dead, not hunted yet) Unity has no dot and the function labels
nothing for it. No reveal is added to Unity (C-OBS).

## 4. New paths
- `client-unity/RoguehallaNet/Net/Ui/WorldMarks.cs` (pure; `WorldMarks.TabMapContacts`, `ContactMark`, `ContactLabel`)
  and `client-unity/RoguehallaNet.Tests/WorldMarksTests.cs`

## 5. Exclusive write scope
- `client-unity/RoguehallaNet/Net/Ui/WorldMarks.cs`, its synced copy and `.meta` (the stub is committed; the
  implementer fills the body)
- `client-unity/UnityProject/Assets/Scripts/UI/TacticalMapMarks.cs`: `Present(Session, route)` fills a
  `List<ContactMark>` (only when `Large`, the Tab map; `session.Me` gives faction/status/`HuntTarget`, `session.PlayerId`
  the self id, `_actors` the delivered actors); a pooled `TMP_Text` label per mark, positioned and refreshed beside
  `RefreshBadgeTexts`, placed at each mark's `At(actor.X, actor.Y)` above the dot like legacy (`left:50% top:-5px`).
  Not `WorldIndicators.cs` or `ArenaView.cs`: legacy draws these on the map, not in the world.
- a new EditMode test file (one case: the Tab-map surface shows "HUNT" and "ENEMY" for the model's marks; the minimap
  surface shows none)

## 6. Contracts and references
- C-OBS: the hunt target is the local player's own fact; a label needs the actor in the delivered list.
- No game rule in Unity: the function labels, it never reveals or decides.

## 7. Behaviour to preserve
- Existing contact marks, camp, chest, ward and badge drawing and order; `ContactCount`; no allocation per frame.

## 8. Acceptance checks
- `dotnet test client-unity/RoguehallaNet.Tests` (the six `WorldMarksTests`), `bash client-unity/sync-net.sh --check`,
  `scripts/gate.sh --quick --oracle packet/P-UNITY-WORLD-MARKS-1`; Unity EditMode passes.
- Cases: hunt target "HUNT", other living rivals "ENEMY", self and non-players skipped; dead/Mia/Lobby players none; a
  dead hunt target none; HUNT needs a living Sentenced local player; nothing unless the Tab map is open; a target
  absent from the delivered list gets no row; the output list is cleared and refilled.

## Oracle files (read-only for implementers)
- `client-unity/RoguehallaNet.Tests/WorldMarksTests.cs`

## 9. Validation commands
- `~/.dotnet/dotnet test client-unity/RoguehallaNet.Tests`, `bash client-unity/sync-net.sh --check`,
  `client-unity/UnityProject/Tools/editmode.sh`

## 10. Risk and suggested model tier
Sonnet. Low: one small pure function and a label pool.

## 11. Known traps
- Do not draw a ring or tint: legacy has neither. Do not label the minimap.
- Legacy's `ENEMY` set is every living other player on the Tab map; mobs, zombies, dummies and givers are not labelled.
- `GarbageTests.DecodeIntoTheSpareMeetsTheBudgetAndIsFreeInSteadyState` is load-sensitive: rerun if it alone fails.

## Moved to a wire packet (nothing here is implementable on the current wire)
**Camp patience range (W11, B16).**
- Outline = boundary of every `territoryGrid` tile of the camp that `leashOk(map, ref, spot, tileCentre)` accepts for at
  least one rest spot (`packages/client/src/render/CampPatience.ts:18-50`); `leashOk`/`territoryLeash`:
  `packages/shared/src/mobs.ts:243-262` (`min(camp.radius, MOB_LEASH_CAP)`, tile must be in the camp's territory; no
  territory: circle `MOB_LEASH_RADIUS = 24*TILE`, `shared/src/constants.ts:539`). Drawn as dashed 1.5px `#8feef0` a.82 over a
  3px `#09242a` a.72 rim, `dashSpans [9,7]` (`CampPatience.ts:63-80`).
- Label "PATIENCE RANGE", 10px monospace, `#a9f4f5`, stroke `#081a20` 3px, at camp (x, y+25) (`:79`). No seconds text.
- Shown when the run is active and not training and `camps[i].alive > 0`, and the outline box overlaps the camera
  (`CampPatience.ts:93-100`; call `RaidScene.ts:676`). Not tied to being engaged; every living camp in view.
- Missing on the client: the territory plane, camp rest spots, area and leash cap. `MapCamp` has only X, Y, R, Zone
  (`client-unity/RoguehallaNet/Protocol/MapBlob.cs:7-11`). Needs the B16 wire addition (`LEGACY_INDICATORS.md:158,202`).

**Quest carrier flag (W7, B14).**
- Per open, visible, unexpired quest with a carrier whose position is known (delivered actor, or the player list when
  there is no vision filter): a container at the carrier, depth `depthFor(y, PLAYER_RADIUS + 50)`
  (`packages/client/src/render/QuestView.ts:68-76`). Art: kind-coloured filled 14x12 rect at (-7, -BODY_LIFT-48) with a
  2px `#101318` outline, plus a 30px (x `Y_SCALE`) ellipse ring, 2px, kind colour a.8 (`QuestView.ts:167-173`).
  `LEGACY_INDICATORS.md:154` says "y -62"; the file says -BODY_LIFT-48..-36.
- Missing on the client: `WireQuestRow.Carrier` is a view-local `RosterId` (`Protocol/State.cs:36-43,174`) mapping to a
  text label only (`:164`); the match roster (`StateKey.Roster`, `:875`) maps actor id to name. No id mapping exists.
  Needs the B14 wire addition: carrier actor id (`LEGACY_INDICATORS.md:200`).

## Notes from previous attempts
none
