# Combined drawer and Hub Editor gate — stopped on test failures

Exact released source **`6cdf893c67f55b70eb832c49ca01e72a7f7839f6`**, Unity **6000.0.85f2**, URP **17.0.4**, sole existing Editor PID **9075**. **Gate result: FAIL before Play/native capture.** Compilation passes; the seven requested groups execute the exact expected **34 methods**, with **25 passed / 9 failed**. No test, assertion or runtime source was repaired, retried or weakened.

## Exact source and executed methods

A Luna source manifest derives each `[Test]` method, namespace and sibling `.meta` GUID from the frozen cut. There are zero `[TestCase]` attributes. Before execution, public AssetDatabase/MonoScript and reflection over public test methods confirm imported paths/GUIDs, loaded class identities, module identity and all expected method names. Every test source file's disk bytes match the immutable release. All seven classes are from the same refreshed EditModeTests module. The actual result names then match that manifest exactly; this is not stale-count acceptance.

| Requested group | Expected/executed | Passed | Failed |
|---|---:|---:|---:|
| BuildDrawerEditModeTests | 5 | 4 | 1 |
| UiInputRoutingEditModeTests | 10 | 9 | 1 |
| MatchHudWishBarrierEditModeTests | 3 | 3 | 0 |
| HubCosmeticsViewEditModeTests | 7 | 2 | 5 |
| HubProgressViewEditModeTests | 3 | 3 | 0 |
| AccountRecoveryViewEditModeTests | 2 | 1 | 1 |
| Global MatchClientAccountBindingEditModeTests | 4 | 3 | 1 |
| **Total** | **34** | **25** | **9** |

No broad 85/706 suite was run. These are actual Editor control/test results, not live HTTP, browser, bank or account-service acceptance. Full runner JSON, `EXPECTED_TESTS.json`, `imported-loaded-identity.json`, `identity-verification.json` and `test-verification.json` are retained.

## Concrete failures

- **Drawer raycast:** `DrawerViewportBuildsVisibleCardMeshesClipsHitsScrollsAndKeepsSelection` expected the visible card to respond to the actual Canvas GraphicRaycaster; the assertion is false at test line 161. The immediate cause is not established by this receipt. It is not silently recast as a visual pass or fixed by bypassing the raycaster.
- **Header test prerequisite:** `BuildDrawerHidesGlobalHeaderActionsAndRestoresTheirCallbacksOnClose` throws **“No injected-key precondition configured for Escape”**. The injected-key helper lacks this case. The unexercised Escape portion is not counted as accepted behavior.
- **Five cosmetics failures:** the tests fail while retiring cosmetic cards, with **MissingComponentException for CanvasGroup** at `HubCosmeticsView.RetireCard` line 616, including asynchronous unhandled-log paths. No unexpected log was merely suppressed to pass. Native component lifecycle/root cause needs its own fix/review.
- **Recovery selection:** `OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur` expects a selection length of 64 and gets 0 at line 147. The source of the native focus/selection failure is not assigned here.
- **Ordinary account join:** global `SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl` expects the validated test WSS URL and gets null at line 184. This is not a live connection attempt; its async/transport/control cause remains to be diagnosed.

`FAILURE_TRIAGE.md` distinguishes the explicit Escape prerequisite gap from runtime assertions/exceptions whose deeper causes are unproven. Complete messages and stacks remain in the result files. Failure classification does not authorize assertion weakening, production changes or a new campaign.

## Unrun native work

The requested HUD1440 default, drawer1440 default and HUD720 text1.5/minimap1.25 captures are **all unrun**. **Zero native PNGs and zero Play cycles** were started for this gate. Shader-pass/render-depth/Card00 readiness, native wheel/selection, header hide/restore and the corrected drawer raster are therefore not accepted here.

One ordinary setup operation observed the idle Game tab selected at QHD/scale0.28 and raised/selected/clicked that pane. The public `EditorWindow.focusedWindow` remained null; Computer Use did not explicitly report a locked Mac. Since tests failed before Play, this cut did not attempt another frame-progress replay or infer a render blocker. No resolution preset was changed.

The prior f5 cyan failure and no-image stalled diagnosis remain preserved separately at **`dd0150e2f1089a67baf5cda094ff995fe9e790a9`** and **`595a40c7605f8174a3e0403b169c1e469739f812`**. No original PNG or receipt was overwritten, and no mask/material/shader workaround was introduced.

## State preservation

Pre/post manifests cover all **1,122 tracked Unity files**, unchanged through the tests. The only disk difference against frozen HEAD was the known ShaderGraphSettings two blank-key trailing spaces; exact bytes and patch were retained, then HEAD bytes restored. Final runtime-subtree diff is empty and the checkout was clean before documentation was added.

Public before/after states preserve the original live InputSettings instance, `HideAndDontSave`, update mode and background behavior. Final Play/paused/background flags are false, auto-tick is explicitly off, text scale remains 1.0 with no saved key, minimap defaults to index1 with no saved key, and no review or MatchClient object remains. QHD2560×1440/scale0.28 was not changed.

No source/identity/schema/gameplay change, new Editor, server, Web build, public network, performance claim, asset import or shared status edit is included. The existing four-package asset window remains closed under its release condition. Frozen asset preparation is external and distinct from live integration.
