# Weapon icon and drawer visual QA

Reviewed the two saved original PNGs and their capture JSONs: [1440 HUD](layouts/1440-hud-text100.png) and [1440 Build drawer](layouts/1440-drawer-text100.png). Both are 2560×1440, ready, frame/tick advanced, and carry the staged-review watermark. The planned 720 HUD capture was not run after the visible drawer failure; this QA covers only these two captures.

## HUD capture: icon presentation looks correct

The weapon glyphs are visually distinct in the original HUD PNG: Sword is orange, Bow is gold, the potion glyph is green, and the selected Sword has a visible gold underline. The bottom combat row and lower-left vitals panel remain in frame; actor silhouettes, overhead health/status marks, and the lower-right minimap are visible. The four main layout anchors fit within the screen: VitalsPanel `[38.4,25.92–729.6,198.72]`, BuildStrip `[38.4,928.8–729.6,1317.6]`, CombatActions `[806.4,21.6–1574.4,194.4]`, Minimap `[1804.8,25.92–2521.6,544.32]` in screen coordinates. The semi-transparent dark HUD panel centers let the floor remain visible underneath.

The HUD capture JSON separately records the active underline and icon values:

| Element | Active | Sprite | Component color RGBA | Alpha |
|---|---:|---|---|---:|
| Slot 1 weapon icon | yes | Mythic Sword | `(240,138,99,255)` / `#F08A63` | 1 |
| Slot 1 active underline | yes | solid Image | `(237,199,123,255)` / `#EDC77B` | 1 |
| Slot 2 weapon icon | yes | Mythic Bow | `(232,184,93,255)` / `#E8B85D` | 1 |
| Slot 2 active underline | no | solid Image | `(237,199,123,255)` / `#EDC77B` | 1 |

This capture metadata confirms which underline is enabled and that its component color is gold; the screenshot independently shows that line rendered. The saved [icon test result](tests-MatchHudWishBarrierEditModeTests.json) reports all 3 tests passed. Its icon test checks semantic tint stability across active-slot swaps and underline enabled-state changes, but does not assert the bar’s gold color; the color evidence above comes from capture metadata and the PNG, not that assertion.

## Build drawer capture: fail

The actual drawer panel is anchored on the right and remains inside the screenshot, but a solid bright-cyan rectangle occludes almost the entire card catalog viewport. At original PNG sample points `(1900,700)`, `(1500,500)`, `(2470,1000)`, and `(2300,600)`, raster pixels are `(0,255,255,255)`. The cards are not visually reviewable through this rectangle. The capture JSON reports card tile/glyph components in the hierarchy with normal dark tile tint and semantic glyph colors, but no active Image tint matching the cyan; this QA does not infer the cause.

There is a separate top-right collision: the BuildDrawer bounds are `[1459.2,36–2521.6,1404]`, overlapping the global Leave/menu control’s vertical range. The original screenshot shows the drawer’s count/close controls crowded over the global top bar. The drawer fits inside the canvas bounds, but its top controls do not have clear separation from that bar.

Do not treat the passing icon unit test as visual acceptance of the BuildDrawer. The card-grid raster is visibly blocked in this saved capture.

## Test result scope

The saved runner result reports `MatchHudWishBarrierEditModeTests`: 3 passed, 0 failed. `WeaponIconsRetainSemanticTintAcrossSlotChangesAndClearMissingInventory` proves tint/state behavior against test-created Images. The native HUD PNG adds the rendered icon/underline check. The BuildDrawer screenshot has a separate visible failure above.
