# HUD panel glass failure in saved captures

## Finding

The 1440 HUD captures do **not** pass a visual transparency check. The major brown panels read as solid fills: their interior centers are broad, uniform brown regions with no discernible arena detail showing through. This conflicts with the intended translucent panel appearance even though the `Image.color.a` component value is 200/255.

In the original 2560×1440 `1440-hud-text150.png`, multiple interior samples from the Rewards panel center are uniformly RGB `(62, 50, 38)` (for example `(1800,130)`, `(2000,130)`, `(2450,130)`, and corresponding interior points lower in the panel). The visual is a flat brown center, not a glass-like blend of the arena underlay. The Stats/Vitals panels also read as flat brown in the screenshot.

## Source and metadata

In the captured source snapshot `d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712`:

- `MatchHud.Panel` sets its `Image.color` through `MythicUi.Backdrop(ShowcasePalette.Panel)`. `MythicUi.Backdrop` clamps the alpha to `200/255`.
- The same `Image` receives a Unity UI `Outline` with color `(126,96,51,220)`, distance `(1,-1)`, and `useGraphicAlpha=false`.
- The capture JSON still reports the Rewards Image color as approximately `(17,24,35,0.7843)` and its `CanvasRenderer` tint as white. That component color alone does not represent the final rendered center appearance after the outline effect modifies the mesh.

The outline's brown effect quads are independent of the source graphic's alpha because `useGraphicAlpha` is false. Their repeated, shifted geometry covers the interior of the large panel and visually overwhelms the translucent base fill. The screenshots establish the visual failure; this note does not infer a precise final framebuffer alpha from component metadata.

## Evidence

- `layouts/1440-hud-text100.png` and `layouts/1440-hud-text150.png` show the same broad brown-panel appearance.
- `layouts/1440-hud-text150.json` reports Rewards `Image.color` `[0.06666667, 0.09411765, 0.13725491, 0.78431374]`, i.e. RGB `(17,24,35)` with alpha `200/255`; `rendererColor` is white.
- Source locations: `client-unity/UnityProject/Assets/Scripts/UI/MatchHud.cs`, `Panel`; and `Assets/Scripts/UI/MythicUi.cs`, `Backdrop` / button outline setup.

This is limited to reviewing existing captures and source. No new captures, Editor actions, or source modifications were made.
