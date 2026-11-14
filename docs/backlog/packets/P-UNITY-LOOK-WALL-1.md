# P-UNITY-LOOK-WALL-1: the look-capture tool renders a standing Frost Wall and its aim preview

- **Serves:** not in the plan: owner direction 2026-11-13 (tooling that lets an agent and the coordinator SEE a look without a Web
  round; the tuning lane `docs/agent/TUNING_LANE.md` step 5); follows P-UNITY-LOOK-TOOLS-1 and P-UNITY-FROST-WALL-1
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework (staging head `d423c126d`)
- **D-rules touched:** D1 n/a (a capture tool and documents; no rule, no wire, nothing in a player build) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
`FrostWallPresenter` can draw a standing Frost Wall, its cast telegraph and an aim preview, and nobody has seen any of it on
screen: the six `frost-wall-*` rows of `docs/unity/DIALS.md` name `frost-scene`, which has no wall, with a note pointing here. When
this lands, `look-capture.sh frost-wall ... --out <dir>` renders the wall and the preview through the client's real `ArenaView`
and `FrostWallPresenter`, with state injected the way `FrostWallPresenterEditModeTests` builds it (no server, no wire), and the
dials point at scenes that show them. The packet's real product is the first look: the implementer renders the five scenes
WITH graphics, reads the PNGs and reports honestly what looks right and what looks wrong (section 8).

The five scenes (all on a 60 x 60 map of open Frost ground, zone 4, no landmark; the camera frames the wall at play zoom like the
other scenes, about orthographic size 9 as `*-close`):

| Scene | Content |
|---|---|
| `frost-wall` | a horizontal wall of 7 tiles, fresh (more than 1300 ms from its end); the self actor (real, drawn through `ArenaView.Present`) one tile SOUTH of it, a second actor (a stand-in block) one tile NORTH of it |
| `frost-wall-vertical` | a vertical wall of 7 tiles, fresh; an actor beside its north end and one beside its south end (self and a stand-in), to show the per-row draw order |
| `frost-wall-cracking` | the `frost-wall` scene with the wall 500 ms from its end (top alpha .85 - .3 * .5 = .70) |
| `frost-wall-preview` | no standing wall; the aim preview open: reach ring round the self actor, a translucent block per tile it would take (about 7), the line and centre dot, in Frost's colour |
| `frost-wall-preview-invalid` | no standing wall; the preview aimed into a block of rock: no tile, red (`FrostWallPresenter.InvalidTint`) |

Telegraph: NOT a scene of its own. The cast line needs a live Wish start and moves with time; `frost-wall-telegraph` stays on
`frost-wall` in DIALS.md with a plain note that no scene draws the cast line (judge it in a Web round).

## 2. Dependencies
none beyond the base (the presenter, the capture tool and the docs are all in `d423c126d`).

## 3. Relevant legacy paths
The legacy Frost Wall is not in the `packages/` working tree; it is in git history at `78dd8bd4` (the same commit the presenter's
header cites). Read with `git show 78dd8bd4:<path>`:
- `packages/client/src/render/FieldView.ts:59-61`: `WALL_TOP 0xe1f5fe`, `WALL_FRONT 0x4fc3f7`, `WALL_EDGE 0x0288d1`.
- `packages/client/src/render/FieldView.ts:276-295` `drawWall`: per tile a face `fillRect` of height `WALL_LIFT` at alpha
  `0.78 - 0.3 * crack`, then the top `TILE * Y_SCALE` high at `0.85 - 0.3 * crack`, then a 1 px edge stroke at alpha 0.6;
  `crack = 1 - left / 1000` in the last second. ONE Graphics per wall, depth of its SOUTHMOST tile (line 282): legacy sorts the whole wall as one against actors.
- `packages/client/src/render/AbilityAim.ts:45`: the preview tint is `0xef5350` when no tile is valid.
- `packages/client/src/render/WishFx.ts:411` `drawWallTelegraph` (not drawn by these scenes).
Client side: `Assets/Scripts/Presentation/FrostWallPresenter.cs` (`PresentWalls` l.108, `Tick` l.211, `ShowPreview` l.238, `Aim` l.292),
`Assets/Scripts/View/ArenaView.cs` (`PresentCollections` l.501 feeds `PresentWalls` from `collections.Fields`; `_frostWall` l.74; `TickFrostWallAim` l.637).

## 4. New paths
- `client-unity/UnityProject/Assets/Tests/Editor/LookCaptureWallEditModeTests.cs` (+ `.meta`) and `client-unity/UnityProject/Tools/look-wall-docs.test.cjs` (oracle, already committed).

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Editor/Look/LookCapture.cs`
- `client-unity/UnityProject/Assets/Editor/Look/scenes.txt`
- `docs/unity/DIALS.md` (the six `frost-wall-*` rows' Scene cell only)
- `docs/unity/LOOK_CHECK.md` (the scene list, the count 32 -> 37, the "three non-public members" sentence -> four, now naming `ArenaView._frostWall`)
- Not `FrostWallPresenter.cs`, not `ArenaView.cs`, nothing under `Assets/Scripts/`, not `Assets/Resources/**` (never commit anything there), not any test or tool.

## 6. Contracts and references
- ADR 0008 / D9: the capture decides nothing; it injects what the server would have delivered and looks.
- The capture stays in the editor assembly (`Roguehalla.Editor`); no player build contains it (pinned by the existing test).
- `docs/unity/LOOK_CHECK.md`, `docs/unity/DIALS.md`, `docs/backlog/packets/P-UNITY-LOOK-TOOLS-1.md` (how the tool was built and tested).

## 7. Behaviour to preserve
- The 32 existing scenes render exactly as before; their order in `scenes.txt` / `SceneNames` is unchanged and the five new names are appended AFTER `volcano-edge-rot-wide`, in the order of section 1.
- `LookCapture.RenderMap` and `BandOutlineCapture` unchanged in behaviour.

## 8. Acceptance checks
- `bash client-unity/UnityProject/Tools/editmode.sh` green; `node --test client-unity/UnityProject/Tools/look-docs.test.cjs client-unity/UnityProject/Tools/look-wall-docs.test.cjs client-unity/UnityProject/Tools/look-compare.test.cjs` green; `scripts/gate.sh --oracle packet/P-UNITY-LOOK-WALL-1` passes.
- NOT in the gate: render the five scenes with graphics (`client-unity/UnityProject/Tools/look-capture.sh frost-wall frost-wall-vertical frost-wall-cracking frost-wall-preview frost-wall-preview-invalid --out <dir>`), then Read each PNG. The report lists the five PNG paths and, per scene, an honest description: what is drawn, and what looks right and what looks wrong against legacy's look: one ice block per tile standing up from the ground, pale top over a blue face with a darker edge, sorted with actors row by row, cracking pale near its end; the preview a translucent block per tile with a reach ring, line and centre dot, red when it takes no tile. Say plainly if a wall is invisible, floats, is cut by the ground, an actor draws on the wrong side of a block, the camera mis-frames, or the preview is hidden or the wrong colour. Do not fix presenter defects in this packet: name them for a follow-up.
- Report whether the vertical scene's actors sort right against the blocks, and note legacy's one-depth-per-wall rule (section 3) against the client's per-tile order: a difference to flag, not to fix here.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/LookCaptureWallEditModeTests.cs` (+ `.meta`): NEW. What `LookCapture.BuildWallScene` leaves in the hierarchy for each scene (below).
- `client-unity/UnityProject/Assets/Tests/Editor/LookCaptureEditModeTests.cs`: AMENDED (coordinator-approved for this packet, see below). Changed: `BuildPinned` appends the five names; `LandmarkScenes()` excludes names starting `frost-wall`; `ThePinnedListHasThirtyTwoDistinctNames` -> `ThePinnedListHasThirtySevenDistinctNames` (37, 37); `TheCaptureReachesExactlyThreeNonPublicClientMembersByReflectionAndAllResolve` -> `...ExactlyFour...` (the list gains `"ArenaView._frostWall"` as fourth entry, plus one independent `GetField("_frostWall")` lookup). Nothing else.
- `client-unity/UnityProject/Tools/look-compare.test.cjs`: AMENDED: its `PINNED` gains the five names and `assert.equal(PINNED.length, 37)` (was 32), so `look-capture.sh --list` is pinned to 37.
- `client-unity/UnityProject/Tools/look-docs.test.cjs`: AMENDED: its `PINNED` gains the five names (so the DIALS Scene column may name them, and LOOK_CHECK.md must tick each).
- `client-unity/UnityProject/Tools/look-wall-docs.test.cjs`: NEW. DIALS.md: the six rows; LOOK_CHECK.md: "37 names print", the five names, "four non-public client members" and `ArenaView._frostWall`.
- Stub commit (not oracle; the implementer replaces): `Assets/Editor/Look/LookCapture.cs`, which gains the `WallScene` class and the empty `BuildWallScene` / `DisposeWallScene`.

### The contract the tests pin (LookCapture API, public, in `LookCapture.cs`)
- `WallScene BuildWallScene(string scene)`: builds (no camera, no rendering; works under `-nographics`) the named scene: `ArenaView` made as `NewArena` does, the wall or preview injected, the self actor drawn through `arena.Present`, the stand-in with `Actor(...)`. Fills `WallScene`: `Arena` (the root GameObject), `View`, `Presenter` (the arena's `FrostWallPresenter`, reached by reflection on `ArenaView._frostWall`: the one new reflection target; add it to `ReflectionTargets` and `MissingReflectionTargets`), `Map`, `WallTiles`, `Actors` (tile coordinates, tile centre = integer + .5; self first), `AimTile`, `RenderMs`, `EndsAtMs`.
- `void DisposeWallScene(WallScene s)`: destroys the arena and every stand-in (the static `Actors` list), so a second build in the one editor session starts clean. `RenderScene` for these names should call `BuildWallScene`, take the camera from the scene, `Shot`, then dispose; `Parse`, `SceneNames`, `ZoneOf` (zone 4) and `BuildMap` (the same 60 x 60 Frost map) must accept the five names.
- Standing walls: build a `Wall` `AreaView` (`Ability = Freeze`, `StartedAt`, `EndsAt`, `Tiles`, `Key = new AreaKey(start, firstTile)`, as `FrostWallPresenterEditModeTests.Wall` does) and call `Presenter.PresentWalls(list, renderMs)` then `Presenter.Tick(renderMs, now, false)`. `CollectionsView.Fields` has a private setter and `Apply` is internal, so go to the presenter, not `PresentCollections`. Fresh: `EndsAtMs - RenderMs` above 1300; cracking: 500 (+/- 1).
- Preview: compute segment and tiles with the public `FrostWallAim.SegmentFor` / `PlanMap` / `Cells` on the scene's map with the legacy numbers `new FrostWallNumbers(450, 64, 224, 4000, 24, 8)` (the ones `FrostWallAimEscapeEditModeTests` uses), caster = the self actor, then `Presenter.ShowPreview(seg, cells, map.W, casterX, casterY, 450, tint, FrostWishKind.Wall)` and `Tick`. Tint for the valid preview is `ShowcasePalette.Faction(WishFxModel.FactionIndex(AbilityId.Freeze))` (what `ArenaView` uses; `ShowPreview` itself turns it red when no tile). The invalid scene aims at a block of rock (more than 20 Wall tiles; the aim tile itself is `MapBlob.Wall`); the aim lies 2 to 14 tiles from the caster.
- Hierarchy names the tests find: `Ice block`, `Frost wall preview` (the presenter's) and `stand-in actor` (the capture's; exactly one in the actor scenes: the self actor is the real one).
- Map: `frost-*` scenes are open ground: floor, region 4, `GroundTerrainAll`, no anchor, and no rock within 6 tiles of a standing wall.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh` (a stale `Temp/UnityLockfile` in your own worktree may be deleted if none of your Unity processes runs).
- `node --test client-unity/UnityProject/Tools/look-docs.test.cjs client-unity/UnityProject/Tools/look-wall-docs.test.cjs client-unity/UnityProject/Tools/look-compare.test.cjs`
- `client-unity/UnityProject/Tools/look-capture.sh --list` (37 names), then the render of section 8.

## 10. Risk and suggested model tier
implementer-sonnet: editor tooling and documents, one reflection target, no rule. The hard part is honesty about what the first
look shows; a capture that renders nothing visible must be reported, not decorated. Writing the scene correctly (the presenter's
sort order and the camera) is a judgement call a reviewer should check against the PNGs.

## 11. Known traps
- Rows grow SOUTHWARD (Dir front 4 is (0, 1)): "one tile south of the wall" is `wallY + 1`.
- `Shot` re-runs `arena.Present(..., me, ...)` for the self actor and `SnapLocal`s the region; build the wall/preview state so that a second `Present` does not clear it (walls live in the presenter, not in `Present`). `Shot` also clears nothing about the presenter.
- `ArenaView.Update`/`LateUpdate` do not run in batch capture: drive the presenter by hand (`Tick`) once, with a fixed `now`, so the pulse is the same each render (the preview pulses; the noise note in LOOK_CHECK.md applies).
- The `Actor` stand-in helper uses a static list: dispose clears it; tests count `stand-in actor` objects.
- Never commit anything under `Assets/Resources/Showcase/` (the EditMode run touches the font assets; `editmode.sh` restores clean ones).
- The ten per-scene tests in `LookCaptureEditModeTests` (`EverySceneBuilds...`, `EverySceneIsOneZone...`) fail with "unknown scene" today, not an assertion; they go green when `SceneNames` knows the five names.

## Baseline (on the oracle commit, 2026-11-14)
- EditMode: total 1566, passed 1531, failed 35, all in `LookCaptureEditModeTests` (list, scenes.txt, reflection count, 10 per-scene tests) and `LookCaptureWallEditModeTests` (assertion: no arena object built). Nothing else red; no compile error.
- Node: `look-docs.test.cjs` 1 red (LOOK_CHECK.md lacks the five names), `look-wall-docs.test.cjs` 2 red, `look-compare.test.cjs` 1 red (`--list` prints 32).

## Notes from previous attempts
