# P-UNITY-BOG-TREE-3: the bog tree's crown fades only for an actor the crown actually hides

- **Serves:** owner decision 4 (2026-11-10: "a giant bog tree near the outer edge" of Plague) and Web round 11 (2026-11-14, running client)
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer
- **Integration base:** aadff95e3 (the coordinator's staging head; contains P-UNITY-BOG-TREE-2)
- **D-rules touched:** D1 n/a (presentation; DEV-020) · D2 n/a · D5/D6/D9 none · no wire change · no game rule in Unity

## BLOCKED ON A DECISION (read first)
An existing test conflicts with the second half of this packet (the shadow is not a roof). The implementer may not edit tests, so
this packet cannot go gate-green until the coordinator/owner applies the amendment below as its own commit on `packet/P-UNITY-BOG-TREE-3`.
The first half (crown fade set) has no conflict.

`BogTreeLandmarkEditModeTests` (all three read `Landmark.RoofRenderers`, which is the crown plus the shadow today):
1. `TheCanopyIsDrawnOverEveryCoverTileAndNoTileOutsideTheFootprintAndSortsUnderTheFog` (line 247): `var roof = RoofBounds(lm);` where
   `RoofBounds` (line 166) is the union of every `RoofRenderers` bounds; then `Assert.That(Reaches(roof, t), Is.True, ...)` for every one of the 275
   cover tiles (give or take half a tile). The lifted crown cannot reach the ring south of the trunk; only the shadow does.
2. Same test (line 257): `Assert.That(lm.RoofRenderers.All(r => r.sortingOrder == lm.RoofOrder), Is.True, "every canopy piece on the roof order")`.
3. `TheCanopyFadesForAnActorOnTheDryGround...` (line 289): `foreach (var r in lm.RoofRenderers) Assert.That(r.color.a, Is.EqualTo(LandmarkView.RoofFadedAlpha)...`
   "every canopy piece carries the alpha". Also `LandmarkRoofPeekEditModeTests` lines 126 and 169 assert the same for the peek alpha, on their own fixtures.

So the shadow cannot stay in `RoofRenderers` (it would have to be on the roof order and fade: 2 and 3), and if it leaves `RoofRenderers` the union in 1
no longer reaches the cover ring (the crown is lifted: `BogTreeCrownEditModeTests`). No way to satisfy the existing tests and the new rule together.

**Smallest amendment proposed (owner's to approve):**
- `Landmark.cs`: a general seam `AddGroundPiece(SpriteRenderer r, int sortingOrder)` and `GroundRenderers` (not in `RoofRenderers`, never tinted by
  `SetRoofAlpha`, order as given, disposed with the landmark).
- `BogTreeLandmarkEditModeTests.RoofBounds` (one helper, used only by test 1 above): also `Encapsulate` the bounds of `lm.GroundRenderers`. Then 1 holds
  (union of crown and shadow still reaches the cover and stays inside the footprint), and 2 and 3 hold because the shadow is not a roof renderer.
The new oracle finds the shadow by name (`BogTreeLandmark.ShadowName`) and does not depend on which list holds it, so it needs no change either way.
If the owner prefers, relax assertion 1 instead; then nothing else changes.

## 1. ID and outcome
Seen in the running Web client (round 11, 2026-11-14): the landmark's crown is lifted over a tall trunk; a second roof piece, the ground shadow, lies over
the rest of the 275-tile cover (about 17 x 17). BOG-TREE-2 handed the landmark a fade set of "the cover plus every tile the crown paints over". The camera
shows about 30 x 17 tiles centred on the player, so a player walking in from the south steps onto the shadow (a cover tile) while the crown is still off the
top of the screen: the roof fades to 20 percent at once and the player never sees the crown solid. When this lands:
- The bog tree's fade set is exactly the tiles under the crown sprite's opaque pixels (alpha >= 128; the rule of `BogTreeCrownEditModeTests`
  `EveryTileTheCrownPaintsOverFades...`), by the actor's feet tile. An actor on the shadow south of the crown's bottom edge fades nothing.
- The shadow is not a roof: it does not fade with the crown (its alpha is the same while the crown is 1.0, 0.5 or 0.2) and it sorts below actors.
- The roof rule is unchanged: local player on a fade tile 20 percent, another visible actor 50 percent, nobody solid. Cave, church, hall, volcano unchanged.

## 2. Dependencies
P-UNITY-BOG-TREE-2 (in the base). The decision above before the implementer starts.

## 3. Relevant legacy paths
none (DEV-020: the landmarks are new)

## 4. New paths
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeCrownFadeEditModeTests.cs` (and `.meta`)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` (`PaintCanopy` fade set at the `SetFadeTiles` call, `PaintShadow`)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/Landmark.cs` only for the general seam (above): any art may use it; nothing bog specific in it
- `docs/unity/DIALS.md` only if a dial row changes (`bog-tree-shadow`)
- not `LandmarkView.cs`, not the other arts, not shaders, not any existing test

## 6. Contracts and references
- C-OBS: only actors the client may see reach `NoteActor`/`NoteOtherActor` (ArenaView passes them); unchanged.
- `Landmark.Fades` (`Landmark.cs:79`) reads `_fadeMask` when set; `LandmarkView.NoteActor/NoteOtherActor/Tick` (`LandmarkView.cs:62,71,81`).

## 7. Behaviour to preserve
- The roof rule, the peek rule, `RoofCovers` = the cover (275 tiles), the trunk, stumps, names (`TrunkName`, `StumpName`, `CrownName`, now `ShadowName`).
- The crown stays a roof renderer on the roof order; the crown paints nothing outside the footprint; cave, church, hall, volcano unchanged.
- Existing tests green (after the amendment above, if approved). Nothing per frame (`AFrameWhereNothingChangedCreatesAndAllocatesNothing`).
- The shadow still reaches the cover ring and stays inside the footprint (`BogTreeLandmarkEditModeTests`, as amended).

## 8. Acceptance checks
- `BogTreeCrownFadeEditModeTests` all green (24 red today, see Baseline).
- `scripts/gate.sh --oracle packet/P-UNITY-BOG-TREE-3` passes; `BogTreeCrownEditModeTests` (incl. `EveryTileTheCrownPaintsOverFades...`) stays green.
- Look check `bog-wide`, `bog-close` before and after (docs/unity/LOOK_CHECK.md), attached to the hand-off: crown solid when the player stands on the shadow south of it.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeCrownFadeEditModeTests.cs` (and its `.meta`)
- The existing structure tests stay read-only and green: `BogTreeLandmarkEditModeTests.cs` (except the one helper if the owner approves the amendment),
  `BogTreeCrownEditModeTests.cs`, `LandmarkRoofPeekEditModeTests.cs`, `LandmarkViewEditModeTests.cs`, `LandmarkSeamsEditModeTests.cs`.

## What the oracle pins
Fixture: the bog drawing stamped in all eight orientations (as `BogTreeCrownEditModeTests.BogScene`); driven through `LandmarkView.NoteActor`/`NoteOtherActor`/`Tick(10)`.
1. Red today (8): every cover tile whose centre is at least two tile heights (2 x GroundSquash) below the crown renderer's bottom bound leaves the roof at 1.0.
2. Guard (8, green today): every tile under an opaque (alpha >= 128) crown pixel fades to 0.2 for the local player and gives 0.5 for another visible actor.
3. Red today (16): (a) the shadow's `sortingOrder` is below every cover tile's actor order; actor order in this client is `2000 + RoundToInt(server y px * .5)`
   (`SpriteActorPresenter.cs:437`), here `2000 + 16 * tileY + 8` at a tile's centre; (b) the shadow's `color.a` is unchanged while the crown is 0.2 and 0.5.
4. Guards (2, green today): church override with a cover only (0.2 / 0.5 / 1.0) and the cave (0.2 inside, 0.5 for another actor).
Not pinned: the shadow's order against the ground and trunk (above the ground, below actors is the intent; look check decides); the exact fade set.

## Baseline (packet/P-UNITY-BOG-TREE-3 at the oracle commit)
`bash client-unity/UnityProject/Tools/editmode.sh`: 1493 tests, 1469 pass, 24 fail, all in `BogTreeCrownFadeEditModeTests`:
- `AnActorOnTheCoverTwoTiles...` (8): e.g. orientation 4, tile (14, 30): expected 1.0, was 0.2.
- `TheGroundShadowSortsBelow...` (8): e.g. orientation 0, tile (17, 9): expected less than 2152, was 2576 (the roof order).
- `TheGroundShadowsAlphaDoesNotChange...` (8): expected 1.0, was 0.2.
Green: the 8 painted-tile guards, the church and the cave guards. The pre-existing 1459 tests are unchanged and green at this commit.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh` (never commit anything under `Assets/Resources/Showcase/`)
- `scripts/gate.sh --quick --base aadff95e3`

## 10. Risk and suggested model tier
Sonnet. Small change, but it needs the owner's decision on the conflicting test first.

## 11. Known traps
- "Hidden" is by the actor's FEET tile, as the existing crown test does. An actor's body is about 1.7 units tall (more than two tile heights, 1.56), so one
  standing just south of the crown's bottom edge can have its head under the crown while the crown stays solid. This is the rule as briefed; whether a
  head-height margin is wanted is the owner's call after the Web round.
- The fade-tile threshold is alpha >= 100 in `PaintCanopy` and >= 128 in the oracle; tiles between differ only at the rim, which the oracle does not pin.
- The shadow's order must stay above the ground and below every actor on the cover: a value at the first cover row's roof order minus a few works; do not use the roof order.
- Do not let the shadow's alpha follow `RoofAlpha`: `SetRoofAlpha` tints every `RoofRenderers` entry.
- `BogTreeLandmark.ShadowName` was made public in the `stub:` commit; keep the name.

## Notes from previous attempts
