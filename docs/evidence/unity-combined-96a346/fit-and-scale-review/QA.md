# Follow-up UI capture QA

Read-only review of all 12 native end-of-frame captures in `layouts/`, compared with the prior 20f capture review at [the earlier QA report](/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/combined-20f188-2026-11-08/evidence/QA.md). No source, Unity, app input, or screenshot pixels were changed. The current captures are staged offline UI-review frames; the watermark is a harness overlay, not product UI. This review does not establish browser/gameplay acceptance or actual input behavior.

## Capture matrix

The `720` filename prefix represents **1280×720** PNGs; `1440` represents **2560×1440**. All JSON cases use source `96a346` (full SHA is recorded in each JSON), report matching PNG/native dimensions, `isReady`, background, frame/tick advance, and the staged-review watermark. All 12 JSON records report zero TMP overflow flags and zero truncation flags.

| PNG case | Mode | Text scale | PNG dimensions | Active tracked controls | Center raycast self hits | Active controls occluded by foreground overlay | TMP overflow / truncation | Off-screen bounds |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `1440-hud-text100.png` | hud | 100% | 2560×1440 | 13 | 13 | 0 | 0 / 0 | 0 |
| `1440-hud-text150.png` | hud | 150% | 2560×1440 | 13 | 13 | 0 | 0 / 0 | 0 |
| `1440-map-text100.png` | map | 100% | 2560×1440 | 18 | 12 | 6 | 0 / 0 | 0 |
| `1440-map-text150.png` | map | 150% | 2560×1440 | 18 | 12 | 6 | 0 / 0 | 0 |
| `1440-planning-text100.png` | planning | 100% | 2560×1440 | 20 | 14 | 6 | 0 / 0 | 0 |
| `1440-planning-text150.png` | planning | 150% | 2560×1440 | 20 | 14 | 6 | 0 / 0 | 0 |
| `720-hud-text100.png` | hud | 100% | 1280×720 | 13 | 13 | 0 | 0 / 0 | 0 |
| `720-hud-text150.png` | hud | 150% | 1280×720 | 13 | 13 | 0 | 0 / 0 | 0 |
| `720-map-text100.png` | map | 100% | 1280×720 | 18 | 12 | 6 | 0 / 0 | 0 |
| `720-map-text150.png` | map | 150% | 1280×720 | 18 | 12 | 6 | 0 / 0 | 0 |
| `720-planning-text100.png` | planning | 100% | 1280×720 | 20 | 14 | 6 | 0 / 0 | 0 |
| `720-planning-text150.png` | planning | 150% | 1280×720 | 20 | 14 | 6 | 0 / 0 | 0 |

All tracked control centers had an available `EventSystem.RaycastAll` result in every case (zero missing center rays). The raycasts were read-only; no click or pointer action was issued.

## Visual comparison with the 20f captures

The issues documented in the earlier QA are visibly resolved across both native sizes and both text scales:

- **Planning and map copy:** the route summary is on its own lower row; the concise status/helper line sits beneath it. They no longer overlap at 150%.
- **Map status:** the shorter status line fits inside the panel, including at 100%; it no longer runs under the minimap or off the right edge.
- **Reward bleed-through:** map and planning panels now have opaque backgrounds. Reward labels no longer show through the foreground contacts list or boon choices.
- **Titles and labels:** the reward title fits its header. At 150% it wraps onto two lines but remains legible and inside its header bounds. `TACTICAL MAP` / `PLAN YOUR RUN`, the selected-boon label, and `TAB · MAP` remain visible without clipping.
- **Watermark:** `STAGED UI REVIEW / NO NETWORK` is visibly contained at both scales and sizes. It is an intentional harness overlay and should not be counted as a product UI label.

No additional clipping, overlap, or hidden foreground controls was observed in these 12 PNGs. The minimap placeholder contains only its boundary marks, as in the supplied capture; this report checks layout, not map-content correctness.

## Center-raycast interpretation

- **HUD:** all 13 active tracked controls hit themselves at their centers in all four cases (14 controls are recorded including disabled/non-interactable Pickup). These are exposed controls in the HUD state.
- **Map:** 12/18 active tracked controls hit themselves. Six tracked reward/build controls are intentionally under the map overlay: `Next`, `BuildDetails`, `Option0`, `Option1`, `Option2`, and `Skip`. Their centers return the map `Viewport` or `MapFrame` and no selectable object. The map’s own active controls hit themselves.
- **Planning:** 14/20 active tracked controls hit themselves. The six underlying reward/build controls are `Skip`, `Next`, `Option1`, `Option2`, `Option0`, and `BuildDetails`; their centers return `TacticalMap`, the visible `Spawn1`/`Spawn0` overlay, or `MapFrame`, rather than an exposed reward control. This is consistent with the foreground planning panel covering background HUD/rewards.

Raycast metadata verifies which selectable is topmost at each sampled center. It does not prove click handling, navigation, focus behavior, or input acceptance.

## Minimum tracked target sizes and fixed HUD bounds

Measurements are capture pixels from the JSON bounds. At each resolution they are unchanged between text scales; 1280×720 values are half their 2560×1440 counterparts.

| Mode | 2560×1440 narrowest active target | 2560×1440 shortest active target | 1280×720 narrowest active target | 1280×720 shortest active target |
| --- | --- | --- | --- | --- |
| HUD | Potion, 126.72×160.70 px | OpenMap, 329.73×57.02 px | Potion, 63.36×80.35 px | OpenMap, 164.86×28.51 px |
| Map | Potion, 126.72×160.70 px | OpenMap, 329.73×57.02 px | Potion, 63.36×80.35 px | OpenMap, 164.86×28.51 px |
| Planning | SpawnMarker1, 106.67×85.33 px | OpenMap, 329.73×57.02 px | SpawnMarker1, 53.33×42.67 px | OpenMap, 164.86×28.51 px |

The shortest tracked target is the OpenMap button by height. The 28.51 px height at 1280×720 remains visible and inside screen bounds; this is a capture measurement, not a touch-target assessment.

Representative fixed HUD content bounds, identical at 100% and 150% text scale:

| HUD region | 2560×1440 bounds `[xMin,yMin,xMax,yMax]` | Size | 1280×720 bounds | Size |
| --- | ---: | ---: | ---: | ---: |
| Build strip + vitals content envelope* | `[55.68, 810.828, 719.44, 1313.568]` | 663.76×502.74 px | `[27.84, 405.414, 359.72, 656.784]` | 331.88×251.37 px |
| Combat action controls + Wish summary envelope | `[911.36, 27.648, 1648.64, 190.944]` | 737.28×163.30 px | `[455.68, 13.824, 824.32, 95.472]` | 368.64×81.65 px |

\*The first envelope is the union of the tracked BuildDetails button and BuildStrip/VitalsPanel text bounds; it is not claimed as the root panel’s full rect. The second is the union of tracked action controls and Wish summary.

## Limits

This is screenshot and center-raycast layout QA only. It does not validate real pointer events, UI navigation, screen-reader behavior, browser rendering, gameplay state, or performance. The watermark remains present by design in all captures.
