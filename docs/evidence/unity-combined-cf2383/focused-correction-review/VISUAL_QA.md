# Focused presentation repair QA

Reviewed the four released `cf2383` native screenshots against their original d28 counterparts. This is a bounded visual check of border-only panels and map mark rendering; no new captures, Editor actions, source edits, or extra cases were made.

## Results

| Case | Result |
|---|---|
| 1440 HUD · text 1.0 | **Pass for glass and minimap marks.** Rewards, stats, and lower HUD panel centers reveal wall/arena detail; the frame is thin gold at the edge. Minimap faction glyphs are visible. JSON reports active marks `rendererPresent=true`, `rendererCull=false`, mesh present, 106 vertices / 156 triangle indices, 7 contacts; no base-mesh effects. |
| 720 HUD · text 1.5 · minimap 1.25 | **Pass for glass, endpoint fit, and minimap marks.** Wall texture is visible through Rewards/Vitals panel centers. Colored contacts appear within the minimap. The minimap stays onscreen with a narrow positive gap below Rewards. |
| 1440 map · text 1.5 | **Pass for map marks and edge-only controls.** Faction-shaped marks are clearly drawn inside the map frame and the seven-item contact list is visible at right. Active full-map marks report a renderer, are not culled, and have 106 vertices / 156 indices for 7 contacts. Panel/control outlines no longer fill their centers. |
| 720 planning · text 1.5 | **Pass for panel centers and supplied contacts.** World detail is visible through the large map and choice-button centers; thin gold edges remain around controls. The map shows contact glyphs. JSON reports the active marks mesh with 106 vertices / 156 indices for 7 contacts. |

## Pixel comparison against d28

All referenced images are original native PNGs, with no resize or edit for comparison.

- In d28 `1440-hud-text100.png`, the Rewards panel interior sample at `(1800,220)` is uniformly brown `(62,50,38)`. At the same coordinate in `cf2383` `1440-hud-text100.png`, it is `(49,49,52)`; a nearby panel-center sample `(2100,220)` is `(85,84,83)`, showing the wall detail varies through the repaired fill rather than staying a flat panel color.
- In d28 `720-hud-text150-mini125.png`, samples in the first reward button center at `(930,155)` and `(1200,155)` are the same flat `(25,34,46)`. In repaired `720-hud-text150-mini125.png`, those points are `(32,39,51)` and `(33,40,52)`, and the PNG visibly preserves the wall pattern beneath the translucent button/panel fills.
- At the planning control interior `(920,155)`, d28 `720-planning-text150.png` is `(34,38,43)`; repaired `720-planning-text150.png` is `(40,43,50)`, with the tile pattern visible in the control center. The repaired image shows the same through-panel detail across the broad map/planning backing.

The capture JSON retains configured `Image.color.a=200/255`; visual inspection confirms that the final appearance now preserves underlay detail. `meshEffects=[]` in all four captures. The active map-mark records each report `rendererPresent=true`, `rendererCull=false`, `meshPresent=true`, `vertexCount=106`, `triangleIndexCount=156`, and `contacts=7`.

## Boundary

These four offline `STAGED UI REVIEW / NO NETWORK` cases demonstrate the specific glass and map-mark repairs at the tested sizes and modes. They do not establish behavior in a live network session, interaction/raycast behavior, or untested layouts.
