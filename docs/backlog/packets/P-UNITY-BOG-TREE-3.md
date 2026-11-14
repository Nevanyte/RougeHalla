# P-UNITY-BOG-TREE-3: the bog tree's crown fades only for an actor the crown actually hides

- **Serves:** owner decision 4 (2026-11-10: "a giant bog tree near the outer edge" of Plague) and Web round 11 (2026-11-14, running client)
- **Implementer tier:** implementer-sonnet (Unity presentation)
- **Reviewer:** reviewer
- **Integration base:** aadff95e3 (the coordinator's staging head; contains P-UNITY-BOG-TREE-2)
- **D-rules touched:** D1 n/a (presentation; DEV-020) · D2 n/a · D5/D6/D9 none · no wire change · no game rule in Unity

## Established facts
- **Decision 2026-11-14 (coordinator; flagged to the owner as a mechanical test-helper change).** `BogTreeLandmarkEditModeTests` read
  `Landmark.RoofRenderers` three ways: the union of their bounds must reach all 275 cover tiles (line 247 via `RoofBounds`, line 166), every one is on
  `RoofOrder` (line 257) and every one carries the faded alpha (line 289; `LandmarkRoofPeekEditModeTests` lines 126, 169 the peek alpha). A shadow that is
  not a roof cannot be in `RoofRenderers`, and then the first assertion fails because the crown is lifted. Accepted amendment: a general seam in
  `Landmark.cs`, `AddGroundPiece(SpriteRenderer r, int order)` / `GroundRenderers` (never tinted by the roof fade, keeps the order it is given, disposed
  with the landmark; the `stub:` commit has it compile-only), and the `RoofBounds` helper also encapsulates `GroundRenderers` (the only change to that
  file; assertions at 257 and 289 untouched, they stay true for real roof pieces). `BogTreeLandmark` registers the shadow through `AddGroundPiece` with an
  order below every actor on the cover (see Known traps).
- The crown's fade set is by the actor's FEET tile, like every roof in this client (cave, church, hall, volcano): accepted for this packet that a head
  can be under the crown's bottom edge while the crown stays solid.

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
P-UNITY-BOG-TREE-2 (in the base). none open (see Established facts).

## 3. Relevant legacy paths
none (DEV-020: the landmarks are new)

## 4. New paths
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeCrownFadeEditModeTests.cs` (and `.meta`)

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/BogTreeLandmark.cs` (`PaintCanopy` fade set at the `SetFadeTiles` call, `PaintShadow`)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/Landmarks/Landmark.cs`: the ground-piece seam only (`AddGroundPiece`, `GroundRenderers`, clear it in `Dispose`); any art may use it; nothing bog specific
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
- `BogTreeCrownFadeEditModeTests` all green (see Baseline).
- `scripts/gate.sh --oracle packet/P-UNITY-BOG-TREE-3` passes; `BogTreeCrownEditModeTests` (incl. `EveryTileTheCrownPaintsOverFades...`) stays green.
- Look check `bog-wide`, `bog-close` before and after (docs/unity/LOOK_CHECK.md), attached to the hand-off: crown solid when the player stands on the shadow south of it.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeCrownFadeEditModeTests.cs` (and its `.meta`)
- `client-unity/UnityProject/Assets/Tests/Editor/BogTreeLandmarkEditModeTests.cs`: ONLY the `RoofBounds` helper is amended (coordinator-approved); read-only for implementers
- The other existing structure tests stay read-only and green:
  `BogTreeCrownEditModeTests.cs`, `LandmarkRoofPeekEditModeTests.cs`, `LandmarkViewEditModeTests.cs`, `LandmarkSeamsEditModeTests.cs`.

## What the oracle pins
Fixture: the bog drawing stamped in all eight orientations (as `BogTreeCrownEditModeTests.BogScene`); driven through `LandmarkView.NoteActor`/`NoteOtherActor`/`Tick(10)`.
1. Red today (8): every cover tile whose centre is at least two tile heights (2 x GroundSquash) below the crown renderer's bottom bound leaves the roof at 1.0.
2. Guard (8, green today): every tile under an opaque (alpha >= 128) crown pixel fades to 0.2 for the local player and gives 0.5 for another visible actor.
3. Red today (16): (a) the shadow's `sortingOrder` is below every cover tile's actor order; actor order in this client is `2000 + RoundToInt(server y px * .5)`
   (`SpriteActorPresenter.cs:437`), here `2000 + 16 * tileY + 8` at a tile's centre; (b) the shadow's `color.a` is unchanged while the crown is 0.2 and 0.5.
3c. Seam (red today): a ground piece added with `AddGroundPiece` is listed in `GroundRenderers`, not in `RoofRenderers`, keeps its order and alpha through a fade and a peek, and is destroyed and delisted with the landmark.
4. Guards (2, green today): church override with a cover only (0.2 / 0.5 / 1.0) and the cave (0.2 inside, 0.5 for another actor).
Not pinned: the shadow's order against the ground and trunk (above the ground, below actors is the intent; look check decides); the exact fade set.

## Baseline (packet/P-UNITY-BOG-TREE-3 at the oracle commit)
`bash client-unity/UnityProject/Tools/editmode.sh`: 1495 tests, 1469 pass, 26 fail, all in `BogTreeCrownFadeEditModeTests`:
- `AnActorOnTheCoverTwoTiles...` (8): e.g. orientation 4, tile (14, 30): expected 1.0, was 0.2.
- `TheGroundShadowSortsBelow...` (8): e.g. orientation 0, tile (17, 9): expected less than 2152, was 2576 (the roof order).
- `TheGroundShadowsAlphaDoesNotChange...` (8): expected 1.0, was 0.2.
- `AGroundPieceKeepsItsOrder...` and `AGroundPieceIsDisposedWithTheLandmark` (2): `GroundRenderers` expected to contain the piece, was empty (the stub seam does nothing).
Green: the 8 painted-tile guards, the church and the cave guards. The pre-existing 1459 tests are unchanged and green at this commit.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh` (never commit anything under `Assets/Resources/Showcase/`)
- `scripts/gate.sh --quick --base aadff95e3`

## 10. Risk and suggested model tier
Sonnet. Small change; the one conflicting test helper is amended in the oracle commits.

## 11. Known traps
- "Hidden" is by the actor's FEET tile, as the existing crown test does. An actor's body is about 1.7 units tall (more than two tile heights, 1.56), so one
  standing just south of the crown's bottom edge can have its head under the crown while the crown stays solid. This is the rule as briefed; whether a
  head-height margin is wanted is the owner's call after the Web round.
- The fade-tile threshold is alpha >= 100 in `PaintCanopy` and >= 128 in the oracle; tiles between differ only at the rim, which the oracle does not pin.
- The shadow's order must stay above the ground and below every actor on the cover: a value at the first cover row's roof order minus a few works; do not use the roof order.
- Do not let the shadow's alpha follow `RoofAlpha`: `SetRoofAlpha` tints every `RoofRenderers` entry.
- `BogTreeLandmark.ShadowName` was made public in the `stub:` commit; keep the name.

## Notes from previous attempts
