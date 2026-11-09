# Tactical map marks: capture metadata review

Scope: read-only review of `1440-hud-text100.json` and `1440-hud-text150.json`, their native PNGs, and the current `TacticalMapMarks` / `TacticalMapSurface` source. No Editor or project actions were taken.

## Finding

The full-map `TacticalMapMarks` entry is inactive and outside the hierarchy while the map is closed. Its null `rendererColor` is expected for this hidden surface in this capture and does not establish a visible defect.

The minimap `TacticalMapMarks` entry is **active and in the hierarchy**, but its `rendererColor` is null. The capture helper sets that field to null when `GetComponent<CanvasRenderer>()` returns null. `TacticalMapSurface.Initialize()` creates this object, attaches `TacticalMapMarks`, and leaves it active under the active minimap. Since `TacticalMapMarks` is a Unity UI `MaskableGraphic`, absence of its required `CanvasRenderer` is a concrete setup problem for drawing its generated mesh; the screenshot's minimap shows the terrain texture without discernible contact/route glyphs. This is a likely product defect on the active minimap path, not merely the inactive full-map surface.

The screenshot is supporting visual evidence only: the small minimap makes individual marks hard to distinguish. The JSON directly establishes the active state and missing `CanvasRenderer`; it does not report mesh vertex counts or `ContactCount`, so this note does not claim those were measured.

## Open-map confirmation

The map and planning captures show the complementary state: the full-map `TacticalMapMarks` is active/in hierarchy with `rendererColor=null`, while the minimap marks object is inactive. The `DeliveredContacts` rail contains seven player entries in these captures. Thus the same missing-renderer concern affects the active full-map surface too, not only the active minimap. The map screenshots do not make any individual generated contact mark unambiguous, so the null component metadata is the primary evidence.

## Source context

- `TacticalMapMarks.OnPopulateMesh()` draws route lines, chest crosses, delivered actor faction marks, and the local-player mark when a map is assigned.
- `TacticalMapSurface.Initialize()` creates the marks child as a `RectTransform`, adds `TacticalMapMarks`, and sets `raycastTarget = false`.
- Both full-map and minimap surfaces are initialized the same way, but only the minimap instance is active in this HUD capture.

## Evidence

- Captures: `layouts/1440-hud-text100.json` / `.png` and `layouts/1440-hud-text150.json` / `.png`. Both HUD captures report the same active-state and null-renderer pattern.
- Full map record: `MatchUI/TacticalMap/MapFrame/PublicMap/Delivered contacts and personal route` — `active=false`, `inHierarchy=false`, `rendererColor=null`.
- Minimap record: `MatchUI/Minimap/TerrainFrame/Delivered contacts and personal route` — `active=true`, `inHierarchy=true`, `rendererColor=null`.
- Minimap terrain frame is active with a 48x36 texture; map is closed (`isOpen=false`, `isPlanning=false`).
- Open map/planning captures (`1440-map-*`, `1440-planning-*`, `720-map-*`, `720-planning-*`) report active full-map marks with `rendererColor=null`, inactive minimap marks, and seven `DeliveredContacts` text entries.

## Review boundary

The active minimap and active full-map states both show null renderer metadata. Recheck those two surfaces after any product fix, with delivered contacts present. This review did not modify source or independently verify mesh generation.
