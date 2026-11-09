# b4bf62 binding retake — tests pass, native readiness stopped

Exact source **`b4bf621d7ed285bb6af4eb737073e197450415df`**, Unity **6000.0.85f2**, sole Editor PID **9075**, active WebGL target. **Binding test gate PASS: 4/4. Native gate FAIL_STOPPED: first pre-capture readiness coroutine did not complete; 0 native PNGs.** The two outcomes are separate. No test retry, Play replay, shader/focus workaround or source change followed the concrete native failure.

## Test identity and result

Only the four global-namespace `MatchClientAccountBindingEditModeTests` selectors ran. Their actual names match the exact frozen source/.meta/GUID/imported public type/method manifest; all four pass, including `SuccessfulOrdinaryJoinUsesOwnedCanonicalIdentityTokenAndValidatedUrl`. Fresh loaded test module **`60a7fa0d-77ee-42fe-b18e-fe2439f20ad3`** differs from e2baad. Compilation completed without errors. `four-case-gate.json`, `test-verification.json`, raw runner output and pre-test loaded identity retain the actual evidence.

The already-green recovery2 remain scoped to e2baad, cosmetics7/progress3 to95bd9c, and drawer5/input10/owner3 to719cc2. None was repeated or relabeled as b4bf62 execution. No full backend, Web or network match acceptance follows from this bounded Editor test run.

## Native attempt and first failure

After the four-case pass, one Play session started in the existing explicit offline `?uiReview=hud` fixture. Pipeline auto-tick was enabled at16ms after the Play domain reload; the public runtime background flag was true and pause false. CUA observed the existing Game pane configured **QHD2560×1440 at scale0.28**, after raising the Unity window and selecting the Game tab/surface before Play. No resolution preset was changed.

Before any screenshot call, the external `observe-rendered-readiness.cs` coroutine was started once on the actual ready review. It recorded its start and awaited `yield null`, 0.2seconds realtime, then `WaitForEndOfFrame`, intending to write actual player-frame/Screen/Canvas/depth facts. Its request succeeded at **frame1**, but **no coroutine receipt was produced within the bounded10second wait** (`rendered-readiness-timeout.json`). There was no second request.

The public Editor-eval observations preserve:

| Observation | frameCount | NewestMs | realtimeSinceStartup |
|---|---:|---:|---:|
| Initial Play state | 1 | 5050 | 34.835043167244294 |
| State at failure | 1 | 5050 | 191.71316366724204 |

Both report playing=true, paused=false, runInBackground=true, review present/ready and session present. `EditorWindow.focusedWindow` was null despite the preceding CUA actions. Editor-eval Screen readings were752×252; because the coroutine never reached a player end-of-frame, these are **not accepted native backbuffer or Canvas measurements** and do not replace the selected QHD preset. The specific cause of the missing player progress/end-of-frame remains unassigned.

CUA's in-app Editor-window observations displayed the offline world, but a visible last frame is not advancing Play proof. They were not exported as native Game PNGs or counted as acceptance captures. The requested 2560×1440 HUD, 2560×1440 drawer and1280×720 HUD captures are all **NOTRUN**; no ScreenCapture call was made. All mandatory rendered drawer material/depth/hit/wheel/click/clipping/header/persistence obligations also remain **NOTRUN**. No cyan-resolution claim is made.

The first failure was preserved and reported, Play was stopped, and no additional focus/GUI/shader/readiness/capture replay occurred. Root is diagnosing the capture harness separately. Unexecuted capture/helper source is retained under `helpers/` for review only; it is not acceptance evidence and was never copied into Assets.

## Cleanup and source preservation

All **1,122 tracked Unity project files** matched frozen Git blobs before refresh. The post-native independent Luna audit found only two serialization trailing spaces in ShaderGraphSettings; observed bytes and patch were preserved, then exact source bytes restored. ProjectSettings already matched the baseline. The two disk copies named as-configured/as-played both retain runInBackground0; they are disk observations (the latter taken after stop before global restoration), not evidence that the temporary in-memory public background flag was serialized. Its actual true Play value is in the runtime observations.

Final public state restores original live InputSettings instance **−1029656**, `HideAndDontSave`, `ProcessEventsInDynamicUpdate`, `ResetAndDisableNonBackgroundDevices`; both background flags and Play/pause false; no saved text-scale/minimap keys (defaults1.0/index1), and the original missing preview query restored. Scene empty/clean, no review/MatchClient remains, auto-tick off, refresh guard released. CUA confirmed inactive Play/No cameras rendering and unchanged QHD/0.28 before completing its UI part. `restoration-verification.json` confirms all1,122 files and globals/prefs match.

No new art import, study, audio audition/override, feature UI merge, production source fix, Web build or deployment occurred. The separately sealed asset preparation remains at source5b7877f9/evidencea6214598 and was not integrated. Root owns native diagnosis, fixes, admission and future release. This b4bf62 finite lease ends stopped and restored.
