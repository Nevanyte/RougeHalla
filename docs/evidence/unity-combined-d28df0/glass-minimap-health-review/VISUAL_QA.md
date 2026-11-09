# Offline UI capture visual QA

Reviewed all 14 saved native PNGs for the d28df0 capture set: 12 standard cases (720/1440 × HUD/planning/map × text 1.0/1.5), plus 720 HUD at minimap scales 0.85 and 1.25. Review is visual only; no Editor, source, tests, or asset changes. Captures are marked `STAGED UI REVIEW / NO NETWORK`. **Visual glass result: fail.** Configured Image alpha is not enough to establish translucency; the saved HUD images show major panel centers as uniform brown fills. See [GLASS_FINDING.md](GLASS_FINDING.md).

## Per-case notes

| Capture | Visual result |
|---|---|
| 1440 HUD · 1.0 | Panels and controls fit. Health/stat panels and minimap remain in their corners. HUD text and controls are legible. The brown panel centers read as solid rather than translucent. Minimap terrain is visible, but no discrete contact glyphs are apparent. |
| 1440 HUD · 1.5 | Main panels remain within screen. Chest heading and health/barrier text wrap, with content still contained; no obvious collision. Brown panel centers read as solid rather than translucent. Minimap contact glyph concern remains. |
| 1440 planning · 1.0 | Map, spawn choices, boon choices, Ready, Undo/Clear, and footer fit. The arena remains visible around the UI. This capture review does not establish translucent panel centers. |
| 1440 planning · 1.5 | Larger title and option labels remain inside their regions. No clear control overlap or clipped panel edge. |
| 1440 map · 1.0 | Map surface and contacts rail fit; seven contact labels are visible. The arena remains visible around the UI; panel-center glass is not counted as a pass. No discrete marks on the map are visually unambiguous. |
| 1440 map · 1.5 | Contact list grows but remains inside the rail; map and footer stay on screen. No obvious overlap. No discrete map marks are visually unambiguous. |
| 720 HUD · 1.0 | Corner panels fit and stay separated. Stat labels and health bar are readable; minimap is contained. No discrete minimap contact glyphs are apparent. |
| 720 HUD · 1.5 | Chest title and health/barrier line wrap; hotbar labels wrap within their buttons. The reward panel, health bar, and minimap remain visible without clear overlap. |
| 720 planning · 1.0 | Right-side choices, map, spawn labels, and bottom guidance fit. The arena remains visible around the UI; panel-center glass is not counted as a pass. |
| 720 planning · 1.5 | Larger choices and guidance remain within the visible regions. No obvious clipping or overlap. |
| 720 map · 1.0 | Contact list and controls fit around the map surface. Underlay remains visible. No discrete delivered-contact marks are visually unambiguous. |
| 720 map · 1.5 | Larger contact text stays in the rail; Undo/Clear and footer remain separated. No obvious clipping. No discrete map marks are visually unambiguous. |
| 720 HUD · 1.5 · minimap 0.85 | Smaller minimap stays in the lower-right corner with ample separation from rewards. HUD corner content remains visible. No discrete minimap contact glyphs are apparent. |
| 720 HUD · 1.5 · minimap 1.25 | Largest minimap remains within the screen. The reward panel and minimap have a narrow visible gap and do not overlap in this capture. No discrete minimap contact glyphs are apparent. |

## Concrete visual failure: HUD panel glass

The 1440 HUD captures show large Rewards and Stats/Vitals panel centers as broad, uniform brown fills rather than translucent overlays. Capture component metadata still reports alpha `200/255`; `MatchHud.Panel` also adds a brown Unity UI `Outline` with `useGraphicAlpha=false`. See [GLASS_FINDING.md](GLASS_FINDING.md) for the source values and pixel examples. The earlier wording that treated HUD legibility over the scene as a translucency pass is withdrawn.

## Concrete concern: map marks renderer

The JSON records show `rendererColor=null` for `TacticalMapMarks` in all relevant cases. On HUD captures, the minimap marks object is active and in hierarchy while the full-map object is inactive. On map/planning captures, the full-map object is active and the minimap object is inactive. The map-mode captures also contain seven entries in the visible `DeliveredContacts` text rail. Because `TacticalMapMarks` derives from `MaskableGraphic`, this active-surface null-renderer metadata is consistent with the missing-`CanvasRenderer` issue recorded in [FINDINGS.md](FINDINGS.md). The PNGs do not make individual marks unambiguous, so visual absence is not treated as a separate proof from the component metadata.

## Limits

This is a bounded image review of the saved offline fixture. It does not establish live-network behavior, mark vertex generation, pointer/raycast correctness, or settings/help screens. At minimap scale 1.25 the reward/minimap clearance is visibly narrow but remains positive; no endpoint overlap is visible.
