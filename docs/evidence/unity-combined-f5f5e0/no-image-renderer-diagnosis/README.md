# No-image drawer renderer diagnosis — limited by stalled Editor rendering

Exact runtime source **`f5f5e016555755fb3e11b77026234148c107ca6b`**; the sealed failed icon review **`dd0150e2f1089a67baf5cda094ff995fe9e790a9`** and its original PNG/JSON files are unchanged. The coordinator authorized **one bounded no-image replay** of the same HUD → real Build Details button, public renderer/material inspection only. No source fix, shader compile/warmup request, material-property change, new test or asset import occurred.

## What was observed

The single replay opened the existing drawer. Its end-of-frame observer could not progress: public reads stayed at **Time.frameCount 2**, Play true, paused false, Application focused/background true. Temporary Editor auto-tick did not advance the player frame. One ordinary Game-tab selection was attempted through Computer Use without an image; its AX result was unchanged and `EditorWindow.focusedWindow` remained null. Computer Use did **not** explicitly report a locked Mac, so lock state is not asserted.

The pending EOF watcher was cancelled. A final direct public snapshot after ordinary `Canvas.ForceUpdateCanvases()` collected the requested state, still at frame 2. All renderer depths are −1. These are **unrendered direct-state facts**, not an advancing-frame or rendered-ready proof. No PNG, screenshot texture or screenshot observation was taken in this replay. No cyan-absence claim is possible from these facts alone. The initial 15-second watcher did not provide a reliable wall-time bound because it was suspended waiting for EOF; it was explicitly stopped rather than left pending or retried in another Play cycle.

`direct-renderer-facts.json` records:

- `ShaderUtil.anythingCompiling == false` at collection; sampled material pass 0 reports `ShaderUtil.IsPassCompiled == true`.
- Viewport `Mask.enabled=true`, **showMaskGraphic=false**, white Image and four white mesh vertices.
- Actual CanvasRenderer normal material: **UI/Default**, stencil **Replace / Always**, `_Stencil=1`, `_ColorMask=0`, read/write mask 255, `UNITY_UI_ALPHACLIP`, white `_Color`, compiled pass 0.
- Actual pop material: **UI/Default**, stencil **Zero / Always**, `_Stencil=1`, `_ColorMask=0`, read/write mask 255, same alpha-clip keyword, white `_Color`, compiled pass 0.
- Card00/01 normal materials: **UI/Default**, stencil **Keep / Equal**, read mask 1 / write mask 0, `_ColorMask=15`, white `_Color`, compiled pass 0; four-vertex dark `(27,38,53,200)` Image quads.
- `hasRectClipping=false`, no parent RectMask2D, `_ClipRect` is not a material property, clipping softness `(0,0)`. Geometry, public material/pop counts, shader keywords, cull flags, component bounds and depths are retained.

Card00/01 are **offscreen samples**, not evidence of visible-card rendering. A separate read-only analysis of the original failed capture at frame 167 finds Card00/01 at y6851–7144, while **Card40–45** geometrically intersect the viewport y371–1018. The original fixture therefore opened around the middle of the catalogue; geometry does not establish visibility under the cyan. This finding remains separate from the cyan cause. See `original-card-bounds.json`.

## What this does not establish

The installed URP17 `Shaders/Utils/FallbackLoading.shader` literally returns `(0,1,1,1)`, matching the original cyan. The static review finds visible source wiring through GPU Resident Drawer, disabled in the current pipeline. This is a useful lead and incomplete source context, **not causal evidence of the old draw**. Current compiled UI/Default material state cannot retroactively establish which shader pass produced the earlier image. No historical per-pass readiness or GPU frame capture accompanied that original screenshot.

No source-path cyan assignment or mutation of the default Graphic material tint was found in the inspected project UI/fixture/capture paths. Installed uGUI `StencilMaterial` sets the expected stencil and color-mask properties without assigning cyan. The original capture helper waited 0.15 seconds and checked frame/tick readiness but not actual shader-pass readiness. Those observations justify a future ready-pass check; they do not justify a delay-only fix or marking the failed screenshot accepted.

A separately released finite verification should require advancing rendered frames and the exact target mask/pop/card passes ready, then inspect the actual card grid in an original native image. It should also verify the initial scroll position and the separately confirmed global-header overlap. This diagnosis applies no production fix and leaves the root cause unassigned.

## Cleanup

The one Play cycle is stopped, pending diagnostic coroutine cancelled, auto-tick explicitly off, both background flags false, original InputSettings and text/minimap preference absence restored. The viewport preset was not changed from QHD/scale 0.28. Known ShaderGraphSettings blank-key whitespace was retained/restored. `source-and-cleanup.json` confirms empty runtime-subtree diff against frozen f5 and clean checkout before adding this diagnostic documentation. No second Editor or replay was launched.

The external scripts are public-API observers and are not installed in the Unity project. Package/source analyses are `PACKAGE_MASK_REVIEW.md` and `SHADER_READINESS_REVIEW.md`. Neither they nor the direct-state snapshot replace the preserved native failure evidence.
