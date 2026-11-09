# Focused repair proof checklist

Scope: read-only review of the source in art checkout `cf23833ff99b2472b217d43e26c5e5167391d2b9`, compared with the original d28 captures. The relevant source repairs are ancestor commits `19c31ce6` (panel/button border-only geometry) and `26abd7ba` (`TacticalMapMarks` CanvasRenderer requirement). This note defines checks for the four already-planned captures; it does not request extra captures or Editor actions.

## Source changes under review

- `MythicUi.Border` replaces a filled `Outline` mesh effect with four edge `Image` children. Each edge uses anchor/offset geometry for the specified width and `raycastTarget=false`, leaving the panel center to the original backdrop Image.
- `MatchHud.Panel` uses that border helper for the UI panel frame. `MythicUi.Button` uses it for button outlines.
- `TacticalMapMarks` now declares `[RequireComponent(typeof(CanvasRenderer))]`.

## Proof cases and pass evidence

| Saved case | Expected evidence |
|---|---|
| 1440 HUD · text 1.0 | Compare Rewards and PlayerHUD panel interiors against d28 `1440-hud-text100.png`. The repaired centers should show recognizable arena tile detail through a darkened blend, with brown/gold restricted to the thin frame edges and corner ornaments. Confirm the relevant Image component alpha remains 200/255 and the frame children are non-raycast-targeting. The minimap is active; metadata should report a non-null renderer color for its active `TacticalMapMarks`. Look for several distinct delivered contact/faction glyphs on the minimap, rather than terrain-only lines. |
| 720 HUD · text 1.5 · minimap 1.25 | Compare with d28 `720-hud-text150-mini125.png`. At this HUD scale endpoint, check tile features remain visible through Rewards/Vitals panel centers; border strokes remain narrow; minimap and Rewards remain non-overlapping with a positive gap. Confirm the active minimap marks has renderer metadata and visible contact glyphs. |
| 1440 map · text 1.5 | Compare the open-map panels with d28 `1440-map-text150.png`. Panel centers should no longer be filled by a brown border effect. The active full-map `TacticalMapMarks` should have a CanvasRenderer (non-null renderer metadata) and visible colored delivered contact marks corresponding in count/faction to the populated `DeliveredContacts` rail. Avoid mistaking the arena behind the translucent map for the marks; glyphs should lie within the map image and change according to map coordinates. |
| 720 planning · text 1.5 | Compare panels with d28 `720-planning-text150.png`. Panel interiors should preserve visible, darkened world detail while borders remain edge-only. Spawn labels/markers and planning controls remain within their bounds. Do not require actor-contact glyphs if this fixture's planning state supplies no contact set. |

## Comparison guidance

- The d28 HUD controls show component alpha 200/255 but large panel centers appear as uniform brown; that is the known glass failure. A source alpha value alone does not pass this visual check.
- For an easy screenshot comparison, use an empty panel-center patch where a distinctive wall seam or floor feature lies beneath the panel. It should remain recognizable but darkened. Border coloration should be limited to a narrow perimeter; it must not fill the quad interior.
- Check UI metadata and image together: component Image alpha verifies configuration, image pixels verify appearance, and the active marks `rendererColor` verifies a renderer is present. Neither metadata alone proves visual contrast or contact placement.

## Limits

These four cases can demonstrate the two specific presentation repairs at the tested sizes/states. They do not establish every UI panel, all resolutions, all map states, input/raycast behavior, or network-client behavior.
