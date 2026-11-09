# Icon colour gate — stopped on Build drawer visual failure

Exact released source **`f5f5e016555755fb3e11b77026234148c107ca6b`**, Unity **6000.0.85f2**, URP **17.0.4**, sole existing Editor PID **9075**. **Gate result: FAIL.** The native HUD icon sample looks correct; the actual Build drawer shows a solid cyan region covering its card catalogue. No runtime source repair or asset import was attempted.

## Actual compile and test identity

Compilation passes. The first narrow owner-HUD test run discovered only the two earlier methods, both passing. That initial **2/2 is retained as stale/incomplete coverage**, not acceptance. Work stopped before capture while public source/assembly freshness was checked.

The `.cs` file has three `[Test]` methods and exactly matches frozen f5 bytes (SHA-256 `680a6a2e66c17c97d3cee761246ab697f3e47820eee5de65ea481bf0f07c581d`). Public AssetDatabase/MonoScript receipts confirm imported path `Assets/Tests/Editor/MatchHudWishBarrierEditModeTests.cs`, frozen `.meta` GUID **`42ed7398690c426f8885769e5faed8ad`**, expected public test type and EditModeTests assembly/module identity. The Editor was neither compiling nor updating and its loaded public type contained the new method. A narrow rerun then passed the expected **3/3**, including `WeaponIconsRetainSemanticTintAcrossSlotChangesAndClearMissingInventory`. No test expectation was reduced, no assertions/source were changed, and no forced recompile/domain reload was necessary.

The passing icon test exercises stable type tint across active-slot swaps, underline enabled-state changes, replacement glyph/tint and missing-inventory clearing. It does not assert the underline's gold color; the native HUD receipt separately records and shows that. Full suites were not repeated.

## Two original captures; third unrun

Exactly two original native PNGs were saved before stop-on-failure, totaling **8,985,704 bytes**:

- `layouts/1440-hud-text100.png`: sampled HUD icon presentation passes.
- `layouts/1440-drawer-text100.png`: drawer presentation **fails**.

The planned **720 HUD / text 1.5 / minimap 1.25 case was not run**, in accordance with the released stop-on-failure instruction. No third/replacement/diagnostic image was added.

Both saved receipts report native **2560×1440 Screen, texture and Canvas**, exact source, ready offline fixture, advancing frame/snapshot clock and visible **STAGED UI REVIEW / NO NETWORK**. They are original `ScreenCapture.CaptureScreenshotAsTexture` captures at `WaitForEndOfFrame`, with no resizing or image editing. The drawer opened through the existing Build Details Button's public `onClick`, invoking its normal cleanup/focus handler; no private method or direct visibility bypass was used.

These are staged encoded/decoded observations in actual Unity, not a native server, network, Web/browser, authoritative gameplay or performance proof.

## Concrete results

**HUD sample:** semantic glyphs are discernible: orange Sword `#F08A63`, gold Bow `#E8B85D`, green Potion and differentiated stat roles. Captured icon components have alpha 1; the active Sword underline is visibly rendered and has Gold **`#EDC77B`**, alpha 1, `raycastTarget=false`; the other underline is disabled. Dark navy panel centers still transmit arena detail. Health/barrier, stats, minimap, actors and overhead marks fit at the sampled default 1440p layout. The full colour/lifecycle evidence is in `ICON_TEST_REVIEW.md`, `ICON_VISUAL_QA.md` and the actual runner JSON. This does not certify the unrun large-text case.

**P1 drawer failure:** a solid bright-cyan rectangle covers almost the entire card-grid viewport, approximately original-image x **1486–2495**, y **423–1069**. At four sampled original PNG positions the raster is exactly `(0,255,255,255)`. Card tiles/glyphs are not visually reviewable. The hierarchy's normal-looking component colours and zero TMP overflow flags do not establish rendered correctness. Root cause is undetermined here; the cyan is not explained or fixed by changing source under proof.

Reproduce at exact f5 source: start the existing `?uiReview=hud` fixture, then invoke the real Build Details control. Best evidence is `layouts/1440-drawer-text100.png` and JSON. Both parent and independent Luna raster inspection confirm the occlusion. This is the final saved failed-source capture, not a preliminary image excluded from the result.

**Secondary drawer collision:** the drawer title/count/Close area overlaps the still-visible global Leave/menu header region. This appears in the same original capture and is recorded separately from icon hue correctness; no broad polish list or extra modal campaign was added.

All sixteen actor-root observations retain `(1.2,1.2,1)` scale and unique matching delivered ground anchors; camera remains orthographic size 9. Both images have zero TMP overflow/truncation flags, which does not mitigate the visible drawer failure. Full public UI geometry, colour, raycast and mesh records are retained.

## Preservation and cleanup

All prior c6/d28/cf238 evidence branches and originals are preserved. Current runtime source is unchanged. Pre/post manifests cover **1,108 tracked Unity files**. Their sole difference is Unity's known ShaderGraphSettings two trailing spaces, serialized after the initial pre-test manifest. The exact overlay bytes/patch are retained and frozen HEAD bytes restored; final tracked Unity diff against f5 is empty and the checkout was clean before documentation was added.

Final public state: Play off, both background flags false, original live InputSettings instance/flags/update mode/background behavior, auto-tick off, text scale 1.0 with no stored key, default minimap index 1 with no stored key, no offline review object. Native CUA observation confirms **QHD 2560×1440 / scale 0.28**; no resolution preset was changed in this stopped gate. Console/compiler records are retained, with no native runtime error reported by the valid saved-case runner; a visual failure can occur without an exception.

The separately authorized first-four asset import window was conditional on a passed/sealed icon gate, so **no asset branch/import was started**. Frozen VFX, landmarks, biome props and original ambience remain external; a read-only import-order audit was prepared separately. No outfit/download/paid/AI expansion, protocol/schema change, shared status edit, new Editor, server, Web build, cloud or public deployment is included.
