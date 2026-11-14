# P-UNITY-FROST-WALL-READ-1: a standing Frost Wall and its aim preview are readable on every zone's ground

- **Serves:** not in the plan: owner standing art rule 2026-11-13 (subjects are told apart at a glance by brightness and hue; a one-hue picture is a defect); follows P-UNITY-FROST-WALL-1 and P-UNITY-LOOK-WALL-1
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework (staging head `3f571eef8`)
- **D-rules touched:** D1 legacy's exact ice colours are the reference; the difference is a presentation deviation proposed below (the coordinator adds the row) · D2 n/a · D5/D6/D9 none (looks only; Unity decides nothing)

## 1. ID and outcome
The first renders of the Frost Wall (editor captures through the real `ArenaView` and `FrostWallPresenter`) show a wall that is
structurally right (it stands up from the ground, blocks join, it sorts against actors correctly) and unreadable where it matters
most. A Frost player fights mostly on Frost's pale ground, so the worst case is the common case. Faults, ranked by harm to play:

1. The valid aim preview is near-invisible: a faint white outline grid; fill, reach ring, line and centre dot cannot be seen.
   A player cannot aim.
2. The wall is low-contrast on Frost ground: legacy's ice colours at legacy's alphas give a pale glass strip almost the ground's colour.
3. The crack in the last second (alpha minus 0.3) is invisible: pale ice over pale ground cannot get paler.
4. The invalid (red) preview is correct but faint.

When this lands the wall, its preview and its crack read on all five zones' ground, ice stays ice-blue for every caster, and every
looks number is a named dial in `docs/unity/DIALS.md`.

## 2. Dependencies
P-UNITY-LOOK-WALL-1 (the five capture scenes) is in the base. Nothing else.

## 3. Relevant legacy paths
Legacy's Frost Wall is not in the `packages/` working tree; it is in history at `78dd8bd4` (`git show 78dd8bd4:<path>`):
- `packages/client/src/render/FieldView.ts:59-61` `WALL_TOP 0xe1f5fe`, `WALL_FRONT 0x4fc3f7`, `WALL_EDGE 0x0288d1`; `:276-295` `drawWall` (face alpha `0.78 - 0.3 * crack`, top `0.85 - 0.3 * crack`, 1 px edge at 0.6, `crack = 1 - left / 1000`, fade-out over the last 300 ms).
- `packages/client/src/render/AbilityAim.ts:45` the invalid tint `0xef5350`; the preview's alphas are in the same file.
Legacy's ground was a flat dark-ish arena; its ice was never drawn on a zone as pale as Frost's. D1 here means: keep legacy's HUES
(ice-blue), change contrast.

## Established facts (measured 2026-11-14 on `3f571eef8`; every number reproducible by the commands in section 9)

### The renders
Five look-capture PNGs (1920 x 1080, sRGB; `frost-wall`, `frost-wall-vertical`, `frost-wall-cracking`, `frost-wall-preview`,
`frost-wall-preview-invalid`) were read. Frost ground is pale cyan with snow patches, pines and crystals. The wall (7 tiles)
is a pale strip (top about `d8eaf4`) over a mid cyan face (about `93d7f3`); its edge is 1.5 sim px (2 to 3 screen px) of `0288d1`
at alpha .6, a hairline. The cracking wall looks the same as the fresh one. The valid preview is a thin white grid on the
ground; its centre dot sits on an ice crystal. The invalid preview is a faint pink line and dot and a ring of pink hairline over
blue-grey rock tops.

### What the shaders do to a wall (the model, and its error)
- The wall and preview meshes use `ShowcaseSprites.Unlit` (URP Sprite-Unlit): NOT lit by the zone. Each quad is its vertex colour
  alpha-blended over the ground in sRGB space, then the camera's grade. Frost wall render at x 1140: top modelled (215, 239, 251)
  against rendered (216, 234, 244), 4 percent high in luminance; face modelled (96, 197, 244) against rendered (147, 215, 243), 20 percent LOW
  (so face over top is modelled 1.64, rendered 1.29); the grade lifts darker colours toward the ground and is not modelled.
- The ground is NOT the palette Base times a light. Ground-only captures of the five zone scenes (central 900 x 500 px) against
  `RegionPaletteGenerated` Base: luminance x0.56 Fire, x1.9 Sentenced, x0.67 Plague, x0.80 Frost, x1.9 Holy. The oracle therefore uses the MEASURED
  rendered ground (median RGB and 10th/50th/90th percentile luminance per zone; table and re-measure command in `FrostWallReadEditModeTests`).
  Its error against one pixel is the ground's own spread (Frost 0.36 to 0.64, Holy 0.23 to 0.61, Fire 0.009 to 0.030).
- Contrast is WCAG relative luminance, `(Lhi + .05) / (Llo + .05)` (`Tools/contrast-lib.cjs`, `RegionThemeEditModeTests`).

### Today's numbers
Render check (`Tools/wall-read-check.py` on the five PNGs; ground = median luminance of pixels just outside the element):

| Measure | Today | Floor |
|---|---|---|
| fresh wall: top vs ground (ground L .565) | 1.38 | 1.6, or edge 3.0 |
| fresh wall: edge vs ground (north rim 1.45, base line 1.14, east end 1.38; min) | 1.14 | 3.0 (alternative to top) |
| fresh wall: face over top | 1.28 | 1.4 |
| cracking wall: top / face over top / edge | 1.27 / 1.20 / 1.14 | as fresh |
| crack: change against the fresh wall (top / face / edge, luminance) | 1.08 / 1.01 / 1.11, hue shift 1 degree | one of them 1.25, or a hue shift of 25 degrees |
| valid preview (ground L .593): cell outline / fill | 1.24 / 1.05 | 2.5 (either) |
| valid preview: reach ring / line | 1.13 / 1.37 | 2.0 each |
| valid preview: centre dot | 2.12 (it sits on an ice crystal in the scene: reported, not gated) | 2.0 (gated by the colour-model test) |
| invalid preview (over rock, L .606): line / dot | 1.47 / 1.39 | 3.0 each |
| invalid preview: ring | 1.15 | 2.0 |
| invalid preview: line and dot hue | pink, `c0a0b5` and `e19ba3` (hue 321 and 353, saturation .17 and .31) | red (hue 335 to 25, saturation at least .25) |

Colour-model test (`FrostWallReadEditModeTests`, margins included), today's worst: fresh wall on Frost p50 top 1.46, edge 1.62, face
over top 1.64; on Frost p90 top 1.29, edge 1.75; Holy p90 top 1.35, edge 1.85. The crack differs from fresh by x1.07 on Frost p50
and x1.11 on Holy p50 (Fire, Sentenced and Plague already show it: the ice lets a dark ground through). The valid preview misses on every
Frost and Holy mark and on every zone's ring; the invalid preview misses on every zone (Fire p10 line 2.43 against 3.30).
Model against render, Frost p50: cell outline 1.30 against 1.24, ring 1.06 against 1.13, line 1.13 against 1.37, edge 1.62 against 1.14 (a
hairline).

### Where the preview tint comes from
`ArenaView.cs:149` sets `_frostTint = ShowcasePalette.Faction(WishFxModel.FactionIndex(AbilityId.Freeze))` once and `:640` passes it to
`FrostWallPresenter.Aim`, which hands it to `ShowPreview`. The capture tool calls `ShowPreview` directly with the same expression, so a
fix that lives only in `ArenaView` would not appear in the captures. Frost's faction tint is a cyan close to the ground; it cannot meet the
floors on Frost ground at any alpha. Decision: the presenter draws the preview in its own fixed colours and ignores the tint argument
for the marks; `ArenaView.cs` stays untouched.

## 4. New paths
None in the implementer's hands. The oracle commit adds `FrostWallReadEditModeTests.cs` (+ `.meta`) and `Tools/wall-read-check.py`.

## 5. Exclusive write scope
- `client-unity/UnityProject/Assets/Scripts/Presentation/FrostWallPresenter.cs`
- `client-unity/UnityProject/Assets/Scripts/View/ArenaView.cs` only the line that picks the preview tint, and only if the presenter cannot do it (the brief's decision is that it can: leave `ArenaView.cs` alone)
- `docs/unity/DIALS.md` (the six `frost-wall-*` rows only)
- Not `docs/DEVIATIONS.md` (the coordinator adds the row below), not `LOOK_CHECK.md`, not any test, capture tool or script, nothing under `Assets/Resources/**` (never commit anything there).

## 6. Contracts and references
- Unity decides nothing (ADR 0008, D9): these are looks only. No rule, no wire field, no hitbox, no timing the server uses.
- The owner's art rule (2026-11-13): subjects told apart at a glance by brightness and hue; a one-hue picture is a defect.
- `docs/agent/TUNING_LANE.md`: every looks number is a named dial with a row and a range in `docs/unity/DIALS.md`.
- `FrostWallPresenter` is already guarded by `FrostWallPresenterEditModeTests` (blocks per tile, kept per key, no object left after Dispose, a warmed frame allocates nothing: any new quad is allocated up front, no `new` per frame).

## 7. Behaviour to preserve
- Ice stays ICE-BLUE: every layer of the wall has hue 185 to 225 degrees (legacy: 199) or is a neutral (saturation under .08); the same for every caster (no faction tint). What changes is contrast: a darker, more saturated face and edge, an outline, a shadow or base line, stronger alphas, a warning treatment for the crack. Top stays the lightest layer, then face, then the darkest edge layer.
- Geometry, draw order, pooling, the 1000 ms crack window, the 300 ms fade-out, `Lift`, the telegraph and the pulse speed stay as they are (pinned by `TheDialsThisPacketDoesNotTouchStayInTheirRows`).
- The crack still begins only in the last second and never makes the ice more solid; all blocks of a wall change together.
- `InvalidTint` stays red (hue 340 to 20); it may get darker or more saturated.
- The six `frost-wall-*` rows of DIALS.md stay six (`Tools/look-wall-docs.test.cjs`): fold new dials into the row they belong to.
- `ShowPreview`, `Aim`, `PreviewTint` keep their signatures; `PreviewTint` need only differ from `InvalidTint` for a valid preview.

## 8. Acceptance checks
Floors, not the goal: the renders decide, and the colour-model test and the render check each bite where the other cannot.
- Wall: on each zone's measured ground (10th, 50th, 90th percentile luminance), the top differs from the ground by luminance ratio at least 1.6, OR an edge/outline layer by at least 3.0 around the silhouette; the face differs from the top by at least 1.4. (A part drawn in two tones passes when any layer does.)
- Valid preview: the cell outline or fill at least 2.5, the reach ring, line and centre dot at least 2.0, at every moment of the pulse, on every zone. The invalid preview (no tile): line and dot at least 3.0, ring at least 2.0, line and dot red.
- Crack: in the last second (500 ms from the end) something visible changes: some layer's luminance against the fresh wall by x1.25, or its hue by 25 degrees; pure alpha loss over pale ground does not count; all blocks of the wall together; nothing before the last second.
- Every public looks constant of `FrostWallPresenter` appears by name in a `frost-wall-*` row of `docs/unity/DIALS.md`, with its value and range (`InvalidTint` is missing today).
- `bash client-unity/UnityProject/Tools/editmode.sh` green (today: 1574 total, 5 red, all in the new oracle file); `node --test client-unity/UnityProject/Tools/look-docs.test.cjs client-unity/UnityProject/Tools/look-wall-docs.test.cjs` green.
- Render check on FRESH captures of all five scenes: `look-capture.sh frost-wall frost-wall-vertical frost-wall-cracking frost-wall-preview frost-wall-preview-invalid --out <dir>`, then `python3 client-unity/UnityProject/Tools/wall-read-check.py <dir> --check` exits 0; the hand-off carries its output (the numbers) and the implementer's own honest reading of each of the five PNGs (Read them: what a player sees, what is still weak, and whether the wall still looks like ice on Frost ground, not a black bar). Read `--debug <dir2>` output once if a number looks wrong: it draws the sampling windows. `frost-wall-vertical` is not measured by the script: read it by eye.
- The render check measures Frost ground only (the capture scenes are Frost); the other four zones are covered by the colour-model test on measured ground. Say so in the hand-off. A Web round on the five zones follows before the owner sees it (LOOK_CHECK.md: the editor render has known differences from the client).
- `scripts/gate.sh --quick --oracle packet/P-UNITY-FROST-WALL-READ-1` passes.

## Oracle files (read-only for implementers)
- `client-unity/UnityProject/Assets/Tests/Editor/FrostWallReadEditModeTests.cs` (+ `.meta`): NEW. The colour model against measured ground (floors above, with margins 1.1 for surfaces and preview marks, 1.3 for face over top, 1.4 for the edge, derived from the measured model error in the Established facts), hue family and caster-independence, the crack, the preview on every pulse sample, the invalid preview's red, the DIALS names. Today: 5 red (wall, crack, valid preview, invalid preview, DIALS), 2 green guards (hue family, together-cracking).
- `client-unity/UnityProject/Tools/wall-read-check.py`: NEW. The pixel half; not in the gate.
- Amended earlier oracles, in the STUB commit (changes to existing tests live there; the coordinator approves by approving this packet; nothing else in them changed):
  - `FrostWallPresenterEditModeTests.TheIceCracksPaleOnlyInItsLastSecond` (P-UNITY-FROST-WALL-1): dropped the exact `TopAlpha - CrackFade * .5` at 500 ms and the exact `(TopAlpha - CrackFade * .9) * 100/300` at 100 ms. KEPT: solid until the last second, never more solid in it, still fading out (late below half, and at most one third of `TopAlpha` 100 ms before the end), the whole wall together. The visible change itself is now pinned by the crack test of the new file.
  - `FrostWallPresenterEditModeTests.TheIceIsTheLegacyColoursForEveryCasterSeenOrNot`, renamed `TheIceIsTheSameForEveryCasterSeenOrNot`: dropped the exact pins of `TopColor`, `FaceColor`, `EdgeColor` and `InvalidTint`; kept the six-block, three-caster loop. The colours are now pinned by hue family and contrast in the new file.
  - `FrostWallPresenterEditModeTests.ThePreviewDrawsTheMirrorsTilesRedWithNoneAndNothingUnderFreeze`: `AreEqual(tint, PreviewTint)` became `AreNotEqual(InvalidTint, PreviewTint)` (the presenter may draw its own readable colour). The red-with-no-tile line is unchanged.
  - `LookCaptureWallEditModeTests.TheIceTopIsAsSolidAsTheLegacyAlphaForAFreshWallAndPaleHalfwayThroughTheCrack` (P-UNITY-LOOK-WALL-1): the cracking branch's exact `.85 - .3 * .5` became `<= TopAlpha`; the fresh branch and "one wall, one look" are unchanged.
  - `LookCaptureWallEditModeTests.TheValidPreviewTakesAboutSevenFloorTilesAndIsTintedWithFrostsColour`, renamed `...AndIsNotTheRedOne`: dropped "PreviewTint equals Frost's faction colour".
- Stub commit (the implementer edits): `FrostWallPresenter.cs` gained `BlockPart`, `PreviewPart`, `BlockLayers(i, part)`, `PreviewLayers(part)` and `QuadMesh.ColorOf`.

### The contract the tests read
`BlockLayers(i, Top|Face|Edge)` and `PreviewLayers(Fill|Outline|Ring|Line|Dot)` return the colour WITH alpha of EVERY quad that draws that part, as on the mesh after the last `Tick`. A part drawn in two tones (a light core over a dark halo) lists both; Edge lists every quad that outlines the block (rim, base line, any outline or shadow line, any crack overlay). The implementer updates these two methods when it adds quads; the reviewer checks them against the PNGs (a listed colour that is not drawn is a defect). A crack overlay exists in both states (transparent when fresh): the test compares layer by layer.

## 9. Validation commands
- `bash client-unity/UnityProject/Tools/editmode.sh` (then `git checkout --` any font asset under `Assets/Resources/Showcase/`; never commit it).
- `node --test client-unity/UnityProject/Tools/look-docs.test.cjs client-unity/UnityProject/Tools/look-wall-docs.test.cjs`
- `client-unity/UnityProject/Tools/look-capture.sh frost-wall frost-wall-vertical frost-wall-cracking frost-wall-preview frost-wall-preview-invalid --out <dir>` then `python3 client-unity/UnityProject/Tools/wall-read-check.py <dir> --check [--debug <dir2>]` (python3 with numpy and Pillow).
- Re-measure the ground table (only if zone art changes): `look-capture.sh fire-scene sentenced-scene plague-scene frost-scene holy-scene --ground-only --out <dir>`, medians and percentiles of pixels [500..1400) x [300..800).

## 10. Risk and suggested model tier
implementer-sonnet; reviewer `reviewer`. Looks only, one presenter file, no rule. The hard part is design under two opposite constraints: a mark that reads on Frost's pale ground (dark) must also read on Fire's and Sentenced's dark ground (light), which is why the oracle accepts two-tone parts; and the wall must still look like ICE. The numbers are floors: a palette can meet every ratio and still look wrong (P-UNITY-SENTENCED-TILES-1 did), which is why the render check and the PNG reading are acceptance.

## 11. Known traps
- The model overstates thin lines (a 1.5 sim px rim is 2 to 3 screen px): thicken the outline rather than chasing the model. When the model test and the render check disagree, the render check governs; if one is red where the other and the PNG are clearly fine, report it, do not edit the oracle.
- The preview pulses (`PulseSpeed`): the test samples 40 moments over one pulse and takes the worst; a mark must not fade below its floor at the trough.
- `ShowPreview` is called directly by the capture tool with the faction tint: the fixed colours live in the presenter, not in `ArenaView`.
- The invalid scene's "ground" is rock tops (mid blue-grey), and its line and dot are measured against the band just outside them; a red that reads there and on Frost snow needs a dark or white halo.
- The valid preview's centre dot sits on an ice crystal in the capture scene: its render number is not gated; judge it by eye and by the model test.
- A warmed frame must allocate nothing (`GuardAWarmedFrameAllocatesNothing`): allocate every extra quad and array up front. `BlockLayers` and `PreviewLayers` allocate and are test-only.
- The six `frost-wall-*` rows stay six; `look-wall-docs.test.cjs` reads their first cell and Scene cell.
- Raising the wall's contrast raises it on every zone: check Holy (mid gold) and Fire (dark) in the colour-model output, and that the wall is not a black bar on Frost.

## Proposed DEVIATIONS row (the coordinator adds it; next free number is DEV-033)
- ID DEV-033, area presentation. Difference: a standing Frost Wall, its aim preview and its crack are drawn with more contrast than legacy (legacy `FieldView.ts` `WALL_TOP/FRONT/EDGE` `e1f5fe/4fc3f7/0288d1` at alpha .85/.78/.6 with the crack as alpha minus .3; `AbilityAim.ts` preview in a faint white or faction tint at alpha .18 to .55).
- Why: legacy's ice is close to the ground's own colour on Frost's pale ground, where a Frost player mostly fights: the valid preview cannot be seen and the crack cannot be seen. The ice keeps legacy's hue family (ice-blue, no faction tint); face, edge, outline, preview marks and crack warning are darker, more saturated or stronger, and the preview uses fixed readable colours instead of the faction tint. Looks only: no rule, number or timing changes. Owner art rule 2026-11-13; packet P-UNITY-FROST-WALL-READ-1. The coordinator fits the ledger's column layout; the Owner column stays blank until signed.

## Notes from previous attempts
<!-- Coordinator appends on escalation: tier, branch, the gate's failure block. Nothing else. -->
