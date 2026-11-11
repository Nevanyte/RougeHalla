# P-UNITY-SENTENCED-READ-1: Sentenced walls and fences read clearly against the floor

- **Serves:** ORDER_OF_OPERATIONS phase 3, item 16 (Unity UI packets); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 n/a (art) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
In Sentenced the owner cannot tell walls and fences from walkable floor. Legacy draws the wall top clearly lighter than the
floor (WCAG 2.76:1, which is 4.7 times the relative luminance, not "twice as light"), a lighter rim on open edges (3.84:1 as
drawn) and light fence bars over a darkened blocked tile (4.16:1). Unity's Sentenced wall top (1.17:1), rim as drawn
(1.79:1) and fence bars (1.07:1) sit at almost the floor's darkness. When this lands Sentenced wall tops, wall rims and
fence bars each reach 3:1 (WCAG) against the floor on the palette values and on the generated textures; the picture after the
zone's lighting is checked by screenshot (section 8).

**Legacy flag:** legacy's own wall top is 2.76:1, below the 3:1 this packet requires, and its wall front is 1.34:1. The
oracle asks for 3:1 on the wall top (owner's 3:1 readability rule, `docs/prompts/UNITY_REWORK_FABLE.md:69-74`, which is
written for characters; applying it to walls is this packet's choice). Unity's floor is darker than legacy's
(`#1f1e25` against `#3a3b42`, matching the owner's "black or dark grey tiles" direction), so 3:1 is reachable without a
light-grey wall. The wall face (front) has no assertion.

## 2. Dependencies
none

## 3. Relevant legacy paths
Verified by the oracle author; the node test also reads `palette.ts` and pins the legacy ratios below.
- `packages/client/src/render/zoneArt/palette.ts:32-35`: `sentenced` floor `0x3a3b42`, floorAlt `0x44454d`, floorMark `0x2c2d33`,
  wallTop `0x7b7e8a`, wallFront `0x4b4e58`, wallRim `0xa4a8b6`. `palette.ts:57`: `fence` iron `0x1c1d22`, highlight `0x8d93a3`.
- `packages/client/src/render/zoneArt/zoneStyle.ts:371-374`: Sentenced wall: flat top in wallTop, then `rim(..., wallRim, 0.6)`;
  `:333-335` `rim()` is a 1 px line along the open north side; `:376` the front in wallFront. `:519-543` `drawFenceTile`: iron at
  alpha 0.3 over the whole tile (`:525`), then rails and bars in highlight at alpha 0.95 (`:529-538`).

Legacy WCAG contrast against floor `0x3a3b42` (computed from those values; pinned by the node test "LEGACY (pinned)"):

| pair | legacy |
|---|---|
| wall top / floor | 2.756:1 (against floorAlt `0x44454d`: 2.356) |
| rim, full strength / floor | 4.700:1 |
| rim as drawn (alpha 0.6 over the wall top) / floor | 3.837:1 |
| wall front / floor | 1.343:1 |
| fence bar / plain floor | 3.628:1 |
| fence bar / 30% iron-shaded fence tile | 4.156:1 |

Unity today (floor = `RegionPaletteGenerated` region 2 Base `#1f1e25`; the node test prints these): wall top
`#302a27` 1.166:1; rim colour `#757272` 3.459:1 but 1.792:1 as drawn (alpha 0.40 on its brightest light row, over the wall
top `#302a27`); fence bar `iron` `#262233` 1.068:1, fence rail `ironL` `#565360` 2.190:1.

## 4. New paths
- none expected

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionThemes.cs` (Sentenced wall colours only)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionWallAtlas.cs` (fence bars, rim)
- `client-unity/UnityProject/Assets/Scripts/View/Regions/RegionWalls.cs` (fence style selection, `:92`)
- `client-unity/UnityProject/Assets/Scripts/View/Atmosphere/RegionAtmosphereTable.cs` (Sentenced row only)

Not in the write scope (oracle, read-only): `Tools/contrast-lib.cjs`, `Tools/contrast-lib.test.cjs`, and the test file above is
oracle too. The oracle commit adds no production code, so `RegionWallAtlas.cs` is free to edit.

## 6. Contracts and references
- Owner direction in `docs/prompts/UNITY_REWORK_FABLE.md:69-74`: black/dark-grey tiles and a 3:1 contrast gate.
- `docs/prompts/UNITY_REWORK_STATE.md:65,129,137`: known Sentenced lighting notes (flagstone tint, lights-off after
  about 10 s parked on `rework/flicker`, corner haze). The lights-off bug is out of scope unless it is a one-line cause.
- No game rule: collision comes from the server's tiles; this changes colours only.

## 7. Behaviour to preserve
- Other zones' palettes and atmosphere rows.
- `RegionPaletteGenerated.cs` is generated: do not hand-edit it.
- Fog-of-war darkness (owner request 2026-11-10: unseen ground about 0.30 of lit).

## 8. Acceptance checks
**`scripts/gate.sh` does not run any of this.** It has no node-test or Unity step for `client-unity/UnityProject` (its client
steps cover `RoguehallaNet` and `sync-net.sh --check` only), so a green gate says nothing about this packet. The command that
proves it is:

`node --test client-unity/UnityProject/Tools/contrast-lib.test.cjs`

and the reviewer must run it themselves and paste the pass/fail counts and the measured ratios; the implementer's report is
not enough. Required: all tests pass (28 pass, 3 fail before the fix; the three failing are the oracle). The tests, with the
ratios they read from the C# sources (`RegionPaletteGenerated.cs`, `RegionThemes.cs` Sentenced block, `RegionWallAtlas.cs`
`PaintRim` and the Timber branch of `PaintLow`; the reader evaluates the `Mix`/`Shade`/`new Color` expressions, so keep those
expression forms, and keep the rim alpha as `Mathf.Pow(1f - t, p) * k` or the reader throws):
- "Sentenced wall top reads against the floor": `th.WallTop` / Base, at least 3:1.
- "Sentenced wall rim ...": the rim colour and the rim as drawn on its brightest light row (row 2, over the wall top) / Base, each at least 3:1.
- "Sentenced fence bar and rail ...": `iron` (bar) and `ironL` (rail) / Base, each at least 3:1. The plain floor is the
  conservative ground: shading the fenced tile darker only raises the contrast of light bars.
- `gate.sh --oracle packet/P-UNITY-SENTENCED-READ-1` must still pass for the files it does cover: it also fails the branch if
  an oracle file is edited.

EditMode (`RegionThemeEditModeTests`, new cases `SentencedWallTopTextureReadsAgainstTheFloor`,
`SentencedWallRimTextureReadsAgainstTheFloor`, `SentencedFenceBarsReadAgainstTheFenceTileGround`,
`ASentencedFenceTileHasADarkerGroundThanOpenFloor`) measure the same pairs on the generated atlas pixels. They are not
gate-run and were not run by the oracle author (no Unity or C# compiler on that machine; they were checked by reading
only, so a compile slip is possible: report it, do not edit the file without owner approval). The implementer runs them in the
Unity EditMode batch runner (Editor closed) or says they could not. They need one addition from the implementer: 
`public static Color FenceTileGround(Color floorSrgb)` on `RegionWallAtlas` (found by reflection; the case fails with a
message until it exists), returning the ground colour under a fence tile for an open floor colour (legacy: iron at alpha 0.3,
about 30% darker). The same function must colour the fence tile's ground in the picture; the reviewer confirms that in the
screenshots, since no test can.

Not proven by any test: the lit picture. The palette and texture ratios ignore the zone lighting (post exposure 0.55,
saturation -22, ambient `* .45`) and the flagstone detail on the ground. The implementer attaches Sentenced screenshots
(section 9) and states a measured wall-top/floor and fence/floor ratio from them using
`contrast-lib.cjs` `ratioOf`/`decodePng` on the lit pixels, next to the palette numbers.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Tools/contrast-lib.test.cjs` (new cases at the end: the Sentenced block; the existing cases are unchanged)
- `client-unity/UnityProject/Tools/contrast-lib.cjs` (added only: `evalCsColor`, `csAssignment`, `readGeneratedSrgb`,
  `readSentencedColours`, `luminanceOf`, `ratioOf`, `hex`; no existing export changed)
- `client-unity/UnityProject/Assets/Tests/Editor/RegionThemeEditModeTests.cs` (new region before "batching"; existing cases unchanged)

## 9. Validation commands
- `node --test client-unity/UnityProject/Tools/contrast-lib.test.cjs`
- Unity EditMode batch run (Editor closed). Not part of the gate: report whether it was run.
- Sentenced screenshots from `Assets/Scripts/View/Regions/RegionPreviewCapture.cs`, attached to the hand-off.

## 10. Risk and suggested model tier
Sonnet. The gate does not run Unity, so the node contrast test is the machine check; the look still needs a screenshot.

## 11. Known traps
- Raising wall brightness without the rim leaves flat grey blocks: legacy's readability comes from the rim on open edges.
- Lighting multiplies the palette: a pair that passes on palette values can fail under exposure 0.55 and saturation -22.
  State both measurements.
- Fences in every zone use the Sentenced fence style (`RegionWalls.cs:92`) and the Sentenced theme colours
  (`RegionWallAtlas.ThemeOf(Timber)`), so lightening the bars lightens them over every zone's ground. Light bars on a light
  ground (Holy Base `#9e8f7a`-class, Coliseum `#aea394`) can lose contrast that they had as dark iron. The oracle only
  covers Sentenced; the implementer reports the bar/Base ratio for all six zones (same `ratioOf`) and checks their screenshots.
- The fence tile's ground comes from the zone's ground shader, not the wall atlas; darkening it is the one part that has to be
  wired outside the pure colour constants (via `FenceTileGround`).
- The legacy wall top is itself 2.76:1 (see section 1): do not "match legacy" on that pair; the oracle's 3:1 governs.

## Notes from previous attempts
