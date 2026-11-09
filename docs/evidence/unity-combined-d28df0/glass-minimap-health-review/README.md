# Glass panels, minimap and health-position Unity review

Exact coordinator-released source **`d28df076bf98d10bfe6cb5fbc88b8d30a3fbe712`**, composed from the frozen `f8753b867840bda927e3b63d9ace05325e9bde8e` UI leaf while retaining the protocol-14 nullable giver work and actor scale. Unity **6000.0.85f2**, URP **17.0.4**, sole existing Editor PID **9075**. No runtime source, assets, scenes, packages or test assertions were changed during this gate.

**Result: the released layout and scale cases fit, but glass appearance fails and map-contact rendering has an open defect.** This is an offline native Editor review, not a browser/network, gameplay parity or performance acceptance.

## Actual checks

Actual compilation passes. Only the requested affected test groups were run, once each: TacticalMap **7/7**, UiInputRouting **7/7**, MatchHudWishBarrier owner HUD **2/2**. Total **16/16**, no failed, skipped or inconclusive tests. The unchanged full 85-test campaign was not repeated.

The bounded capture set is **14 original native PNGs**, totaling **31,690,292 bytes**:

- HUD / planning / map × 1280×720 / 2560×1440 × text 1.0 / 1.5: 12 captures.
- Only 720p HUD text 1.5 at saved minimap scales **0.85** and **1.25**: two more captures.

All captures report the exact source, ready fixture, advancing frame and snapshot clock, visible **STAGED UI REVIEW / NO NETWORK**, and matching frame-local Screen, texture and root Canvas dimensions. PNG IHDR dimensions were independently checked. Images came from `ScreenCapture.CaptureScreenshotAsTexture` at `WaitForEndOfFrame`; they were not resized, composited or edited. The offline fixture encodes and decodes synthetic public observations; no socket is opened.

All 14 report **zero TMP overflow/truncation flags**. Parent and independent Luna review found larger text wrapping within its intended controls, no prior route/status/footer collision, and no reward-panel/minimap overlap. These finite cases do not certify every screen, scroll position or background.

## Opacity, geometry and input evidence

Component alpha alone did not establish visual translucency: full-quad Outline effects make the HUD backing centers appear opaque brown in the original captures. See the glass finding below. Captured active text and icon colors retain **alpha 1**, with no fading CanvasGroup in their ancestry. Panel and button backing Images use **200/255 alpha**; essential health/barrier fills and icons retain their own colors/opacity. This is component opacity evidence, not a statement that every pixel of every sprite is opaque. The generated map RawImage tint remains alpha 1. A readback of the actual runtime 48×36 texture records **1,524 floor pixels at alpha 200** and **204 wall pixels at alpha 255**. The texture is intentionally CPU-unreadable; inspection uses a temporary public GPU Blit/readback and restores the active RenderTexture before the original screenshot is taken.

At 720p, health is bottom-left at `[19.2,12.96,364.8,99.36]`; stats are top-left at `[19.2,464.4,364.8,658.8]`. Default minimap bounds are `[902.4,12.96,1260.8,272.16]` (358.4×259.2). Saved endpoints load in fresh fixtures: 0.85 gives 304.64×220.32, and 1.25 gives 448×324. The maximum-size case moves Rewards upward and retains a **10.80004-pixel vertical gap**. Its five reward controls and all other exposed controls remain unobscured at their queried centers.

Read-only `EventSystem.RaycastAll` checks hit each exposed active control itself: **14/14 HUD**, **8/8 map**, **13/13 planning**, at both resolutions and text scales and at both minimap endpoints. These queries invoke no click or action. Vitals, stats, combat actions, Wish details, Rewards and minimap roots are inactive under the foreground map/planning state; the PlayerHUD parent remains active. This establishes the recorded underlay visibility and center-raycast state, not complete real pointer or keyboard interaction coverage. The actual affected input tests also pass.

All **112 actor-root observations** (eight roots × 14 cases) have exact `(1.2,1.2,1)` root scale, a unique matching delivered ground anchor and orthographic camera size **9**. Body and overhead sprite rectangle bounds are retained. This is not a hitbox, opaque-pixel, selection-accuracy or performance claim. Giver and eviction/reuse presentation were checked in the prior exact c6 packet, not repeated here.

## Open findings

**P1 visual finding: HUD panel centers fail the intended glass appearance.** The original HUD 100% and 150% screenshots show uniform opaque-looking brown panel centers, with no visible world tile detail through those centers. `MatchHud.Panel` attaches Unity UI `Outline` with effect color `(126,96,51,220)`, offset `(1,-1)` and `useGraphicAlpha=false`. On an Image quad this adds nearly coincident filled quads, rather than only a border; the effect can mask the intended translucency even while the Image's own alpha reports 200/255. `MythicUi.Button` and BuildDrawer also use quad Outline effects. The UI owner/root review identified this issue, and the captured visual result supports it. Best screenshot is `layouts/1440-hud-text150.png`, with the 100% version for comparison. This contradicts a glass visual pass; the component-alpha and text/icon-opacity receipts remain valid. No source fix or replacement image was made here. A separately released border-only repair must demonstrate visible world pixels through panel centers, not merely alpha metadata. See `GLASS_FINDING.md`.

**P1 presentation finding: active map contact layers have no CanvasRenderer.** Every case has one active `TacticalMapMarks` object with `GetComponent<CanvasRenderer>() == null`, represented by null renderer metadata. HUD cases expose it on the minimap; map/planning cases expose it on the full map. The map has terrain/walls and seven observed-contact text entries, but its projected contact glyphs are not discernible. This is a concrete setup defect in the generated UI layer; its source path predates this UI leaf. No missing component was silently added during capture. See `FINDINGS.md`; best reproduction image is `layouts/1440-map-text150.png` with its JSON. Start the existing `?uiReview=map` fixture at the exact source and inspect `MatchUI/TacticalMap/MapFrame/PublicMap/Delivered contacts and personal route`. The absence of CanvasRenderer is the primary evidence; mesh vertex counts were not measured. The same setup can affect other custom marks such as route strokes, but this zero-route fixture does not independently prove a route-line failure.

The UI owner/coordinator's already-known **B/H hotkeys while Settings is open** remain a separate source-audit finding. `ReadUiInput` includes Settings in its dialog state but does not guard those two hotkeys with that state. No additional modal interaction/capture campaign or source fix was performed here. A separate repair candidate is required before any claim that this path is accepted.

## Helper failures and console

Two optional-metadata helper errors occurred before any PNG was saved: an inactive Graphic had no CanvasRenderer, and the generated map texture was intentionally CPU-unreadable. Both original error JSON/stack traces and helper revisions are retained. The external helper was corrected to null-check the component and use bounded GPU readback. Product source and tests were unchanged. The Python orchestration wrapper also initially assumed an object-shaped acknowledgement for Play stop; it was corrected to accept the CLI's JSON string before any planning capture. No valid capture was overwritten or replaced.

After retaining those errors, the valid capture pass returns **zero console errors**. Its final log retains two harmless `Editor is already in edit mode` stop warnings; the native warning counter also remains two. This is not a claim of a warning-free project. Complete compile/test/capture/console records remain in this packet.

## Cleanup and limits

All **1,108 tracked Unity project files** match the pre-test manifest after public setting restoration. The sole disk overlay against exact HEAD was Unity's known two trailing spaces on blank ShaderGraphSettings keys. Its exact bytes, patch and hashes were retained, then HEAD bytes restored. Before documentation was added, the checkout was clean.

The public InputSettings instance id, `HideAndDontSave`, update mode and background behavior match the baseline through tests and cleanup. Play and both background flags are false, auto-tick is off, text scale is 1.0 and its key absent, minimap scale index defaults to 1 and its key is absent, and no review object remains. Native CUA observations verify the temporary 720p preset was deleted and the original seven presets restored; final Game view is **QHD 2560×1440 / scale 0.28**.

This gate adds no asset import, feature, protocol change, server, Web build, cloud action or shared migration status update. Prepared art/audio packages remain external and frozen for their separate release. No new Editor was launched.

The detailed per-case receipts are `acceptance-summary.json`, `METADATA_SUMMARY.md`, `VISUAL_QA.md`, and the original `layouts/*.json` files. The exact external capture scripts and orchestrator are retained under `helpers/`.
