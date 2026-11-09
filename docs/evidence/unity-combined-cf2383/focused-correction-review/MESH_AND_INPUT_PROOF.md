# Public map-mark mesh and input proof

Source-only review of four actual capture JSONs plus the saved Unity EditMode result arrays. No Editor, Play, source, Git, or test actions were performed for this review.

## Native captures

All four original PNG/JSON pairs are in [`layouts/`](layouts/). Each JSON records `isReady`, `nativeDimensionsMatch`, `advanced`, `ticksAdvanced`, and `stagedWatermark` as true. Capture dimensions are 2560×1440 for the 1440 cases and 1280×720 for the 720 cases. The decoded map-marks mesh data is:

| Capture | Open surface | Other surface | Observed mesh screen bounds (px) |
|---|---|---|---|
| `1440-hud-text100` | Minimap active: 7 contacts, renderer present, not culled, mesh 106 vertices / 156 indices | Full map inactive: 7 contacts, no mesh | x 1853.329–2233.267, y 187.153–513.091 |
| `1440-map-text150` | Full map active: 7 contacts, renderer present, not culled, mesh 106 / 156 | Minimap inactive: no mesh | x 491.275–1022.045, y 696.444–1150.834 |
| `720-hud-text150-mini125` | Minimap active at scale 1.25: 7 contacts, renderer present, not culled, mesh 106 / 156 | Full map inactive: no mesh | x 843.797–1079.258, y 115.064–316.775 |
| `720-planning-text150` | Full map active: 7 contacts, renderer present, not culled, mesh 106 / 156 | Minimap inactive: no mesh | x 245.638–511.022, y 348.222–575.417 |

For each active mesh, all 106 recorded screen vertices are within that capture’s screenshot bounds. For each closed surface the helper can still report 7 observed contacts, but the renderer is inactive and no mesh is built. Vertex/index counts and coordinates establish populated render geometry; they do not, alone, prove visible rasterization. Parent and another reviewer separately confirmed glyphs in the original PNGs.

The four active meshes each decode the same opaque vertex RGBA distribution (106 vertices total):

- `(9,13,20,255)` ×32
- `(255,226,145,255)` ×32
- `(237,199,123,255)` ×12
- `(205,184,255,255)` ×8
- `(120,210,239,255)` ×8
- `(255,126,94,255)` ×6
- `(178,220,128,255)` ×4
- `(244,242,235,255)` ×4

These are decoded from each JSON `vertexColors[].color` base64 RGBA payload and `count`; all component alpha bytes are 255. This is mesh vertex-color evidence, separate from UI `Graphic.color`/`rendererColor` metadata.

## Actual saved test results

The three saved runner result arrays report **19 passed, 0 failed, 0 skipped, 0 inconclusive**: [TacticalMapEditModeTests (8/8)](tests-TacticalMapEditModeTests.json), [UiInputRoutingEditModeTests (9/9)](tests-UiInputRoutingEditModeTests.json), and [MatchHudWishBarrierEditModeTests (2/2)](tests-MatchHudWishBarrierEditModeTests.json).

Relevant named passed assertions:

- `TacticalMapEditModeTests.DeliveredMapContactHasCanvasRendererAndNonemptyRenderedGeometry`: verifies an opened map’s delivered contact, active marks, `ContactCount == 1`, CanvasRenderer, non-null mesh and positive vertex count.
- `UiInputRoutingEditModeTests.SettingsOwnsKeyboardAndBlocksBuildHelpShortcutsWithoutWorldCommands`: verifies B/H leave the actual settings view open, do not open Build/Help over it, and produce no decoded `ClientMsg.Input` world commands.
- `UiInputRoutingEditModeTests.BuildAndHelpShortcutsStillToggleAndSwitchBetweenTheirPanels`: verifies B and H open/close their panels and switch mutually exclusively.
- `UiInputRoutingEditModeTests.ClosingSettingsRestoresThePreviouslyFocusedWorldHudControl`: verifies the same previously selected Build control is restored after settings closes.

The map result array also records passing snapshot invalidation, disconnect/rebind, hidden-contact removal, and map-visibility cases. Exact names and statuses are retained in the linked result JSONs.

## Limits

Capture JSON geometry and result arrays do not substitute for input-event, server, browser, or gameplay acceptance. PNG visibility is attributed to the separate reviewers’ direct inspection, not inferred from mesh counts or color bytes.
