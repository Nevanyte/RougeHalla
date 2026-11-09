# 95bd9c focused Editor retake — stopped at recovery assertion

Exact source **`95bd9c1efcde9b71cb07f23f24aef8ff4fb17013`**. Unity **6000.0.85f2**, sole Editor PID **9075**, active WebGL project. **Gate FAIL: 12 executed / 11 passed / 1 failed / 4 unrun.** Compilation and imported/loaded identity passed. No Play, native capture, drawer interaction, source repair, assertion change or test retry occurred.

## Authorized scope and actual result

| Class | Expected | Executed | Passed | Failed | Unrun |
|---|---:|---:|---:|---:|---:|
| HubCosmeticsViewEditModeTests | 7 | 7 | 7 | 0 | 0 |
| HubProgressViewEditModeTests | 3 | 3 | 3 | 0 | 0 |
| AccountRecoveryViewEditModeTests | 2 | 2 | 1 | 1 | 0 |
| Global MatchClientAccountBindingEditModeTests | 4 | 0 | — | — | 4 |
| **Total** | **16** | **12** | **11** | **1** | **4** |

The test runner returned the recovery group with its failure; execution halted before global binding. The failing selector is `Roguehalla.Client.Tests.AccountRecoveryViewEditModeTests.OwnedKeyNeedsRevealAndManualSelectionAndClearsOnCloseSwitchCancelAndBlur`. Its unhandled Unity assertion is **`Assertion failed on expression: 'ShouldRunBehaviour()'`**, with `UnityEngine.Component.SendMessage` and test line **183** invoking `OnApplicationFocus`. The exact source/stack facts are retained in `FAILURE_TRIAGE.md` and the untouched runner JSON. The cause is unassigned; no log suppression, callback substitution or retry was attempted.

`test-verification.json` matches every executed selector against the frozen 16-selector manifest, including the global namespace of the four unrun binding cases. The earlier drawer5/input10/owner3 (18 passes) remain their exact **719cc2** receipt and were not rerun. They are not relabeled as new 95bd9c executions. The prior cyan and rendered drawer gates remain held.

## Source, compile and assembly identity

Before refresh/tests, `as-tested-source.json` captured all **1,122 tracked Unity files**, each matching `git show` at the exact source. The parent independently checked all 16 source test selectors and .meta GUIDs against the public imported/loaded types before running the first group (`identity-verification.pretest.json`). The separate Luna manifest/audit corroborates the same exact bytes and names.

Loaded test module: `347fc0ee-ba5f-48e0-89ed-badd4f96d719`. Loaded Net module: `3734718b-02bd-4a5f-ad3c-d2f64cda6d5d`, public `Wire.ProtocolVersion` field **14**. Rust and both identical C# decoder mirrors agree on Quests state key10 and Trade key11; QuestAccept command kind is17. These are source/loaded identity observations, not new wire-vector or live network acceptance.

The first compile-status poll landed during the source-switch domain reload and returned `EDITOR_NOT_RUNNING`; it is preserved as `compile-after-switch.json`. The same existing Editor then returned ready; `compile-complete.json` and `compile-final.json` report completed/no errors. No new Editor was launched and no stale assembly was accepted.

The retained console tail contains three old CanvasGroup exceptions timestamped 03:35 UTC from an earlier cut, plus the current assertion at 05:00:27 UTC. They were not cleared or counted as new cosmetics failures. Current test success/failure uses the raw runner records; the current assertion is also in the retained console.

## Native proof remains unrun

The authorized 2560×1440 HUD, 2560×1440 drawer and 1280×720 HUD captures were **NOTRUN**, as was every mandatory `docs/ui/DRAWER_PROOF_CONTEXT.md` rendered readiness/hit/wheel/click/clipping/persistence obligation. `CAPTURE_AND_INTERACTION_PLAN.md` is only a plan. Its initial draft briefly assumed incorrect dimensions and a physical-input requirement; both were corrected to the exact release/contract before execution, and no capture or input action ever followed. The contract's hit-resolved ExecuteEvents dispatch was the planned route; no direct Button callback would substitute.

## Restoration and sealed asset separation

The source audit found only Unity's two trailing spaces on empty ShaderGraphSettings fields. The as-tested overlay and patch were preserved; exact source bytes were restored. All **1,122** project files then matched again (`restoration-verification.json`). No runtime, test, UI, Net, protocol or shared status source was changed.

Final public state: Play and pause false; original live InputSettings instance **−1029656**, `HideAndDontSave`, `ProcessEventsInDynamicUpdate`, `ResetAndDisableNonBackgroundDevices`; both background flags false; no saved text-scale key (default1.0) or minimap key (default index1). Auto-tick is off, the refresh guard is released, the scene is empty/clean and no UiLayoutReview or MatchClient object remains. No resolution preset or GUI action was changed in this cut.

The separate art preparation source **`5b7877f99805d6ef980577eda86a779ee4614d9f`** and evidence **`a6214598851d4ca8f8e630ba0b2548d89c8dbdff`** remain immutable on `codex/unity-art-preparation-frozen4`. None of those new assets were merged into this QA source. Audio remains unpublished/uncleared at its separate rate guard; no new importer override, recipe change, study, listening, feature UI, asset integration, Web build or deployment occurred. Root owns fixes, admission and later release. This finite retake ends with the stopped failure and cleanup.
