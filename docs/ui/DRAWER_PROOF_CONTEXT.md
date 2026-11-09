# Drawer proof contexts

This is a test contract, not a passing native receipt. Keep the original f5f5e0 cyan PNG/JSON and the 6cdf89 native test results (25/34 passing) unchanged.

## Why the synchronous test changes

At 6cdf89, `DrawerViewportBuildsVisibleCardMeshesClipsHitsScrollsAndKeepsSelection` passed natural initial Card00 bounds and real card/glyph mesh assertions, then failed the visible `GraphicRaycaster` hit. The later clipping, wheel and selection assertions were not reached. The failure did not log the fixture's depth, cull state, pixel rect, display or event camera; its exact rejection cause is unassigned.

The fixture is a synchronous NUnit `[Test]` that creates an Overlay Canvas and calls `Canvas.ForceUpdateCanvases` and `Image.Rebuild`. It never waits for a rendered frame. Installed uGUI `GraphicRaycaster.cs` rejects a graphic with depth −1, with the comment that it has not been processed by the Canvas and is not actually drawn. `Graphic.depth` returns `CanvasRenderer.absoluteDepth`. Overlay `eventCamera == null` is expected. A separate f5f5e0 replay measured depth −1 with populated meshes, but that replay is not the 6cdf89 test fixture and does not establish the failed test's exact depth.

The test therefore cannot promise processed render depth. Do not make the hit assertion pass by accepting a missing hit, skipping the test or changing production masks/materials. The two contexts below retain separate obligations.

## EditMode obligation

`BuildDrawerEditModeTests.DrawerGeometryMaskFiltersAndCallbacksPreserveScrollAndSelection` remains one required test; the class still has five tests. It checks:

- Natural first-open Card00 bounds intersect the viewport and its center is inside, without forcing an initial scroll-to-top workaround.
- Card background and glyph produce nonempty actual CanvasRenderer meshes.
- `Graphic.Raycast` traverses the production parent `ICanvasRaycastFilter`/Mask chain: an inside point is accepted, while a point inside partially clipped card geometry but outside the viewport is rejected.
- `ExecuteEvents` wheel dispatch reaches the owning ScrollRect and changes its normalized position; pointer-click callback dispatch changes selection and catalog detail.
- Refresh and close/reopen preserve selection and scroll.

These are geometry, filter and callback checks. They do not prove rendered visibility, sorted GraphicRaycaster hits, EventSystem routing, GPU stencil output or screenshot acceptance. The separate header test still requires B/Escape/Close behavior, restored header callbacks and no world commands; the injected-key helper now maps Escape explicitly. No assertion or test-count reduction certifies the unrun paths.

## Mandatory rendered Play obligation

The next root-released finite Art gate must execute all of the following in its actual advancing review session. This obligation is **NOTRUN** until exact-source native evidence passes; an EditMode pass cannot substitute for it.

1. Record exact source, native Screen/Canvas/image dimensions, advancing player frames and observation time. At the interaction/capture frame record active Canvas, target display, event camera, relevant graphic bounds/depth/cull and actual mask/pop/card materials with pass readiness. Relevant graphics must have processed depth ≥0. Do not count a stalled frame2/depth−1 snapshot as ready.
2. Open through the real Build Details control. The original native drawer PNG must visibly show Card00 and usable card tiles/glyphs clipped within the viewport, without the cyan occlusion. Global Help/Settings/Leave must be hidden, and the drawer title/count/Close must be visible. A mesh or colour-property receipt alone cannot pass this step.
3. Use the current EventSystem's real `RaycastAll` at a visible card's center. The resolved selectable must be that card. Also probe a point inside partially clipped card geometry but outside the viewport; that card must not be a hit. Record the points, complete hit identity and associated rendered readiness.
4. Dispatch wheel input from an actual resolved visible hit through `ExecuteEvents.ExecuteHierarchy<IScrollHandler>`. The handler must be the drawer ScrollRect; scroll and card bounds must move while title/count/Close remain fixed. Recheck the outside-viewport hit rejection after scrolling.
5. Resolve a visible card again through the EventSystem and dispatch its pointer-click handler. Verify public SelectedIndex and displayed catalog detail, retaining server-owned stack values. Directly invoking a Button callback without hit resolution does not fulfill this rendered routing obligation.
6. Close through the drawer's real Close control; verify the three global header buttons return. Reopen through Build Details and verify scroll/selection persistence. Record cleanup. Native keyboard regressions separately cover B/Escape and decoded no-world-command checks; the offline fixture alone does not certify the full world-input flow.

Use only the already authorized finite capture count; interaction receipts can accompany the drawer's original baseline PNG. If readiness or any assertion fails, preserve the failure and stop according to the coordinator's release. Do not add images, change expectations or infer cyan resolution. Full browser/network, accessibility and performance acceptance remain separate.
