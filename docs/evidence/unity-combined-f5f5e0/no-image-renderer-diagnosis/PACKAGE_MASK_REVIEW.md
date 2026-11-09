# uGUI mask/material source review

Read-only inspection of the installed `com.unity.ugui@cd4936b8279f` package and local UI/tests. The prior cyan capture remains sealed; this review does not change or reinterpret its pixels. No Editor, Play, Git, source edits, or tests were performed.

## Package behavior observed

Source: `Library/PackageCache/com.unity.ugui@cd4936b8279f/Runtime/UGUI/UI/Core/Mask.cs`.

- `Mask.m_ShowMaskGraphic` defaults to `true` (`Mask.cs:22`). Setting public `showMaskGraphic = false` records the value and calls the attached `Graphic.SetMaterialDirty()` (`:34–45`).
- At the root stencil level (`desiredStencilBit == 1`), `GetModifiedMaterial` passes `StencilOp.Replace`, `CompareFunction.Always`, and a color mask chosen from the property: `ColorWriteMask.All` when shown, integer `0` when hidden (`:160–174`). It also registers a pop material using `StencilOp.Zero`, `CompareFunction.Always`, color mask `0` (`:168–172`).
- Nested masks use a Replace/Equal stencil material and likewise request color mask `0` for a hidden mask graphic (`:177–187`).
- `StencilMaterial.Add` clones the supplied base material into a new `Material`, then sets `_Stencil`, `_StencilOp`, `_StencilComp`, `_StencilReadMask`, `_StencilWriteMask`, `_ColorMask`, and `_UseUIAlphaClip` (`StencilMaterial.cs:109–132`). This code configures stencil/color-write state; it does not set a cyan tint or mutate the base material’s color.
- Child `MaskableGraphic.GetModifiedMaterial` applies a `StencilOp.Keep` / `CompareFunction.Equal` material with `ColorWriteMask.All` when it has a positive stencil depth and is not itself the masking graphic (`MaskableGraphic.cs:102–129`).
- `Graphic.defaultGraphicMaterial` lazily obtains `Canvas.GetDefaultCanvasMaterial()` (`Graphic.cs:92–100`). `Graphic.color` is its per-graphic color property and dirties vertices (`:156`); `materialForRendering` applies attached material modifiers in sequence (`:505–517`), and `UpdateMaterial` assigns that result and the texture to `CanvasRenderer` (`:669–677`). These relevant package paths do not assign cyan to a Graphic.

## Project usage searched

- `MythicUi.ScrollView` creates a viewport `Image`, sets its color to white, then adds `Mask` with `showMaskGraphic=false` (`Assets/Scripts/UI/MythicUi.cs:149–158`). `BuildDrawer` uses this helper for `CardCatalogScroll` (`Assets/Scripts/UI/BuildDrawer.cs:72–78`).
- `HubGuideView` independently creates its text viewport mask with `showMaskGraphic=false` (`Assets/Scripts/UI/HubGuideView.cs:332–339`).
- Search across project UI/presentation scripts and tests found no `Color.cyan`, explicit `(0,255,255)` UI tint, debug mask-color mutation, `CanvasRenderer.SetColor`, or mutation of `Graphic.defaultGraphicMaterial`. The only other `SetColor` found in the searched presentation code configures `ShowcaseTerrainVignette`’s private glow material, outside uGUI.
- The card backgrounds are assigned `MythicUi.Backdrop(ShowcasePalette.PanelRaised)` and `Button.colors`; their displayed glyphs use `MythicUi.Icon` (`BuildDrawer.cs:86–100`). No cyan path is present in those source assignments.

## Conclusion boundary

The package source shows that a hidden uGUI mask graphic should contribute stencil state with color writes disabled, while child graphics use an equal-stencil material with color writes enabled. The inspected project setup follows that API. The source search found no explicit cyan assignment in these mask/card paths. Those observations do not identify why the saved drawer PNG contained cyan pixels; no cause is asserted from package code alone.
