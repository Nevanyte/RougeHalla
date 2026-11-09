# Focused glass, map marks and modal-input correction review

Exact immutable source **`cf23833ff99b2472b217d43e26c5e5167391d2b9`**, coordinator composition of the border-only, required map renderer, modal B/H guard and actual-Settings test-path repairs. Unity **6000.0.85f2**, URP **17.0.4**, sole existing Editor PID **9075**.

**The four released correction cases pass.** This finite native Editor check establishes the stated presentation and affected-input behavior, not complete UI/gameplay, browser/network or performance acceptance. No runtime source, asset, scene, package or test assertion changed during verification.

## Focused tests

Actual compile passes. Only the affected groups ran, once each: TacticalMap **8/8**, UiInputRouting **9/9**, MatchHudWishBarrier owner HUD **2/2**. Total **19/19**, zero failed, skipped or inconclusive tests. No full 85/669 campaign was repeated.

The actual saved `Results` arrays include these passed regressions:

- `DeliveredMapContactHasCanvasRendererAndNonemptyRenderedGeometry`.
- `SettingsOwnsKeyboardAndBlocksBuildHelpShortcutsWithoutWorldCommands`: the real Settings view owns input while B/H do not open unrelated panels, and the client/transport path records no decoded world commands.
- `BuildAndHelpShortcutsStillToggleAndSwitchBetweenTheirPanels`: own-panel close and B/H panel switching remain positive.
- `ClosingSettingsRestoresThePreviouslyFocusedWorldHudControl`.

`MODAL_TEST_REVIEW.md` and `MESH_AND_INPUT_PROOF.md` explain the exact test coverage; complete runner JSON is retained. The keyboard conclusions derive from those executed tests, not screenshot appearance.

## Four original native captures

Exactly the released cases were saved, totaling **11,529,827 PNG bytes**:

| Case | Native backbuffer | Text scale | Saved minimap scale |
|---|---|---|---|
| HUD, early owner preview | 2560×1440 | 1.0 | default 1.0 |
| HUD, maximum minimap | 1280×720 | 1.5 | 1.25 / index 2 |
| Tactical map | 2560×1440 | 1.5 | default 1.0 |
| Planning | 1280×720 | 1.5 | default 1.0 |

Each receipt records exact source, ready offline fixture, advancing frame and snapshot clock, visible **STAGED UI REVIEW / NO NETWORK**, and matching frame-local Screen, texture and root Canvas dimensions. PNG IHDR dimensions were independently checked. Images are original `ScreenCapture.CaptureScreenshotAsTexture` results at `WaitForEndOfFrame`, with no resizing, image editing or compositing. No extra image or replacement capture was made.

## Visual glass and actual rendered marks

Parent and independent Luna review of all four originals confirms **visible arena tile seams and the lit wall through panel and button centers**. Thin gold strokes remain at edges. The prior flat brown panel interior is gone. Read-only comparison with the preserved d28 original shows old Rewards interior samples uniformly RGB `(62,50,38)`, while the corrected original has differing darkened arena pixels and a visible continuing tile pattern. This is actual rendered visual evidence in addition to component alpha, not an alpha-only pass. Details and original-pixel samples are in `VISUAL_QA.md`.

The full map and minimap now visibly contain distinct projected faction glyphs, the self diamond and chest cross. The active `TacticalMapMarks` has a real **CanvasRenderer**, is **not culled**, and exposes a populated public `CanvasRenderer.GetMesh()` with **106 vertices / 156 triangle indices** and **seven delivered contacts** in each case. Full vertex screen coordinates and per-color counts are retained in the capture JSON. Newtonsoft serializes byte-array RGBA values as base64; `acceptance-summary.json` decodes them for reading. The inactive alternate map surface may have an empty mesh and is not treated as a failure.

These mesh records establish actual generated geometry; the separate PNG review establishes visible glyphs. No visibility claim is obtained from contact or vertex counts alone. The source remains synthetic encoded/decoded observations through the existing offline fixture, with no socket/server or hidden-state claim. This fixture has no route points; route-line visibility is not separately accepted here.

## Fit, opacity and input surfaces

All four captures report **zero TMP overflow/truncation flags**. Large text wraps within the reviewed controls. The maximum 720p minimap is on-screen and retains the positive 10.8-pixel geometric gap below Rewards; the original raster also shows a clear gap.

All captured active text/icon component colors remain **alpha 1** with no ancestry CanvasGroup fading. Backing Image alpha remains **200/255**; health/barrier fills and decorations retain their own explicit opacity. This does not claim that antialiased text or every texture pixel has alpha 1. The actual runtime map texture retains floor alpha 200 and wall alpha 255. Inspection of its intentionally CPU-unreadable texture uses bounded temporary GPU readback and restores the prior RenderTexture.

All **228 active border strips** across the four cases have `raycastTarget=false`; no active `BaseMeshEffect` remains in the captured HUD. Read-only EventSystem control-center queries hit the intended exposed control: **14/14** in each HUD, **8/8** in map, **13/13** in planning (**49/49 total**). No query invokes clicks or actions. In foreground map/planning, world-HUD child roots, Rewards and minimap remain hidden, so translucent foreground does not reveal those HUD controls. These checks are bounded to the sampled controls/centers and executed affected-input tests.

All **32 actor-root observations** retain exact `(1.2,1.2,1)` scale, unique delivered ground-anchor matches and orthographic camera size **9**. Source PPU and gameplay targeting are not changed or reaccepted. Body/overhead rectangle and light metadata remain in the original receipts.

## Preservation and restoration

The failed d28 packet remains unchanged at evidence commit **`86783e091b1331b269180f0e66a9254d205674da`** and its original external storage. No failed PNG/receipt was overwritten. This corrected-source receipt is separate.

All **1,108 tracked Unity files** match the pre-test manifest after public flag restoration. The sole disk overlay against source was the known two trailing spaces on blank ShaderGraphSettings keys; its exact bytes/patch were retained, then HEAD bytes restored. The checkout was clean before documentation was added.

Public snapshots preserve the original live InputSettings instance, `HideAndDontSave`, update mode and background behavior. Final state: Play off, both background flags false, auto-tick off, text scale 1.0 with no stored key, minimap default index 1 with no stored key, no offline review object. Native CUA observations confirm the temporary 720p entry was deleted, the original seven preset list restored and final Game view **QHD 2560×1440 / scale 0.28**.

Per-case and final console receipts show zero current errors. Existing compile/stop warnings remain retained; the final native warning counter is two, so this is not a warning-free-project claim. No Unity capture-helper error or compiler/test failure occurred in this valid focused pass.

No new Editor, asset import, source repair during proof, protocol change, server, Web build, browser, cloud, public deployment or shared migration-status update is included. Frozen art/audio packages remain separate and await their own released candidate. The gate stops after these four cases.
