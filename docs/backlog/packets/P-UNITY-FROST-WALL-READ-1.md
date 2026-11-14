# P-UNITY-FROST-WALL-READ-1: a standing Frost Wall and its aim preview are readable on every zone's ground

(Brief commit: outcome, the established facts and the legacy references. The oracle commit completes sections 4 to 11.)

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
