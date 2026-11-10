# Settings row layout repair

Status: source candidate for coordinator review. Compilation, Unity tests and corrected Web raster verification have **not** run for this packet.

Base: `cdec00efa6d56661264271ebc3437f7b7f5349c2`.
Branch: `codex/unity-settings-row-layout` in the existing UI worktree.
The source commit and file hashes are pinned in `PACKET_PINS.json` and `SOURCE_REVIEW.json`.

## Observed failure

The coordinator's actual Web57 Training session opened ordinary Settings. Both captured 1280×720 rasters show settings labels and controls stacked near the top. The original text-size value was unreadable. No setting was changed, and neither R nor an attack was sent while Settings was open.

- [First observation](observed-web57/04-settings-original-visible-value.jpg), 2026-11-09 22:40:11.611 UTC.
- [Second observation without input](observed-web57/05-settings-second-observation-no-input.jpg), 2026-11-09 22:40:49.401 UTC.
- [Original stop boundary](observed-web57/SETTINGS_OVERLAP_BOUNDARY.json) and [original pins](observed-web57/RECOVERY_AND_SETTINGS_PINS.json), copied byte for byte.

Only screenshots 04 and 05 are copied here. The original boundary/pins also describe earlier screenshots retained by the coordinator. These are failure evidence, not images of the repair.

## Source cause and change

`ModernSettingsView.Initialize` creates 12 rows with `LayoutElement.minHeight=66` and `preferredHeight=72`, then disables the vertical layout group's child-height control. The rows start with zero `sizeDelta.y`. Installed UGUI `HorizontalOrVerticalLayoutGroup.GetChildSizes` uses that zero size and ignores `LayoutElement` when height control is disabled. Placement advances by only the 8-unit spacing. `LayoutGroup.SetChildAlongAxisWithScale` also pins the child anchors to the top-left, leaving the final rows zero-high. Their text can overflow and stack.

The product change is exactly `vertical.childControlHeight = false` → `true`. Existing preferred heights, spacing, padding and `childForceExpandHeight=false` remain in use. Expected reference-space geometry is twelve 72-unit rows, eleven 8-unit gaps and 20 units of vertical padding: **972 units of content**. Before the change, the layout's preferred content height is only 108. These numbers are source-derived expectations, not native measurements.

No settings values, saved preferences, event handlers, account/Resume/session code, transport, gameplay, shared styling, HUD, assets or package versions change. No existing test file or meta is edited.

## Focused regression source

`ModernSettingsLayoutEditModeTests` creates the real `ModernSettingsView` under a deterministic 1920×1080 reference-space WorldSpace Canvas. Its settings source remains inactive; the fixture seeds its text-scale field in memory and never invokes a setting action. It uses the ordinary read-only `UiDisplayPreferences` constructor. EventSystem selection is captured before initialization and restored after owned objects are destroyed.

The default and 150% text-scale cases measure actual row bounds, content extent, clipping and scroll reach, and preserve the initial in-memory text scale, slider value and caption. The assertions exercise the hierarchy and geometry rather than checking only the changed property. They are authored source and have not been compiled or executed. They do not establish text legibility, actual window-resolution behavior, pointer interaction or raster quality.

## Verification performed

`SOURCE_REVIEW.json` records the exact one-property product diff, comparison of every existing Editor fixture/meta against the base, new meta GUID uniqueness, installed UGUI source hashes and layout arithmetic. `git diff --check` is recorded separately. These are static source checks only. They are not managed or Unity test results.

No .NET build/test, Unity Editor action, native test, browser input or Web build was performed under this source-only lease. The original Editor9075 and the coordinator's active browser session were not touched.

## Remaining proof

After coordinator review and an explicit isolated native/build lease:

1. Compile this exact source and execute the two focused geometry cases with the actual UI resources. Preserve any failure without relabeling it as a pass.
2. In the isolated current Unity project, inspect the ordinary Settings panel with real fonts at default and 150% text. Confirm row separation, visible values, viewport clipping and scroll access to Reset display options. Confirm keyboard focus and Escape/close restoration.
3. In a rebuilt Web client, repeat the ordinary Settings path at 1280×720 and 1920×1080; check larger and ultrawide windows as required by the broader UI plan. Record corrected screenshots. Read and preserve the original saved text size, then restore it exactly if an authorized interaction test changes it.
4. Close Settings before testing R/attack. The earlier failed raster remains an independent, unchanged observation.

The change is not accepted as a visible repair until the coordinator reviews the native geometry and Web raster evidence. This packet does not claim completion of the full UI modernization.
