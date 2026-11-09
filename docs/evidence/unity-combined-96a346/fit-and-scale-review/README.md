# Text-fit and actor-scale Unity review

Exact source **`96a3462eb6f774891e80c6b2e6dde2700eb8fed6`**, Unity **6000.0.85f2**, URP **17.0.4**, sole existing Editor PID **9075**. This is the coordinator composition of the text-fit repair and the owner-requested 20% visual actor/overhead scale. The original 20f failed layout cases remain preserved at evidence commit `3c488f309c5aac3e9cf56f27e5cbda80619f6d20` and in external capture storage.

## Actual verification

- **85/85 actual Unity Editor tests passed**, no failed, skipped or inconclusive tests. Full authoritative JSON is retained. Public before/after snapshots confirm exact InputSettings instance, flags, update mode and background behavior restored after the suite.
- **12 native screenshots:** HUD/planning/map × 1280×720 / 2560×1440 × 100% / 150% text. Original PNGs total **16,852,316 bytes**, with per-case hashes, frame/clock/dimension receipts in `layout-index.json`.
- Every capture has matching frame-local Screen, native texture and root Canvas dimensions; ready fixture, advancing frame and snapshot clock, and visible **STAGED UI REVIEW / NO NETWORK**. No resizing, image editing, camera-only substitute or generated image was used.
- All 12 report **zero TMP overflow/truncation flags**. Parent and independent Luna raster review found the prior footer collision, right-occluded status line and reward bleed-through resolved in the reviewed views. Titles, selected markers, minimap label and diagnostic watermark fit. Detailed case table and target-size limits are in `QA.md`.

These are explicit offline encoded synthetic stress fixtures with exaggerated stats, not live gameplay, server AI, native networking, a Web build, browser rendering, or performance acceptance. No further 24-case matrix was run. The owner's newer minimap/translucency/health-position requests are a separate revision and are not included here.

## Visual scale and fixed geometry

All **eight actor roots in each of twelve cases** report local/lossy scale **(1.2,1.2,1)** and exactly one sampled delivered ground-anchor match. Actual orthographic camera size remains **9**. Body and overhead SpriteRenderer local/world rectangle bounds are retained in each capture JSON and summarized in `ACTOR_SCALE_QA.md`/JSON. Renderer rectangles include transparent sprite padding; this is not an opaque-pixel or collision-size measurement. Fresh fixture lifecycles remain consistently 1.2; repeated pooling is not separately exercised by these captures.

Public source sets the scale once at root creation. Delivered anchors, source PPU and camera source are unchanged. Compared with 20f, every common HUD/map control rectangle is identical; the two planning spawn markers change bounds as expected from the fit repair. `control-bounds-vs-20f.json` records exact comparisons. Within the new source, controls retain exact bounds and raycast states between normal and 150% text.

**Light nuance:** local Light2D outer radius remains **2.4**, while inherited XY scale 1.2 yields a **transform-derived world outer radius of 2.88**. This is a 20% larger derived radius, not a claim of unchanged rendered world coverage, brightness, perceived reach or GPU cost. Only one of the 16 actor light components is enabled per captured fixture. No local compensation/source change was applied.

The public read-only EventSystem.RaycastAll center checks select all 13 exposed active HUD controls; foreground map/planning controls receive their centers while six covered reward/build controls are blocked by the modal foreground. These queries invoke no clicks or actions and do not certify real pointer-event handling. The separately tracked fixed 22-pixel ground-point actor picking remains outside this visual leaf; torso/head click accuracy is not established here.

## Exact source and cleanup

The pre-test and post-capture manifests cover all **1,108 tracked Unity project files**, with no change through tests and captures. The sole disk overlay against exact HEAD is Unity's known two blank-key trailing spaces in ShaderGraphSettings, retained with hashes and restored byte-for-byte after recording. No product source, scene, asset, package, gameplay or protocol patch was made during verification.

A transient Pipeline disposed-object/disconnection during the initial ordinary Play transition was preserved before clearing; it produced no image. The external read-only capture helper initially had a namespace ambiguity after adding observation metadata; it was fully qualified before any PNG was saved. That correction affected only the external helper, not project source or test expectations. Each released case has one original saved PNG.

The final console capture returns no warning/error entries; its native console warning counter still reports two warnings, so it is not a claim that every native compile warning is eliminated. No initialization or missing-glyph exception was returned during the valid capture pass.

`final-editor-state.json` confirms Play/background off, no review object, normal live InputSettings, text scale 1.0 and no stored key, matching the preference baseline. Auto-tick is explicitly off. The temporary fixed 720p preset was deleted through normal Unity UI and absence checked; QHD 2560×1440 / scale 0.28 was observed restored. The working tree is clean after this documentation-only receipt.

No queued asset import, protocol 14 adoption, server, browser, Web build, public deployment, cloud work or additional Editor occurred. The frozen art/audio queue remains for its separate import window.
