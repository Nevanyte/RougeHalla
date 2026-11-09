# UI-022 planning quest typing-guard corrective review

**RELEASE — bounded source integration, not engine/Web acceptance.** Reviewed immutable corrective code `ecb06b97189d14c236aba3bf7d64288c0fffc451`, direct parent prior seal `ac584b2dba9ffa7a560936f54055fcb6bb6be597`, final evidence seal `04cc779e9890def3fa10a2b9d64d3e0b3103840f`. The sole finding in `unity-ui-planning-quests-review.md` is closed in source. All25 current-source native selectors remain engine UNRUN and require Root/sole Editor-owner authorization and execution. No tests, builds, Editor, capture, browser/cloud, source/ref/status/lock or other mutations were performed for this review.

## Corrective behavior

Only MatchHud.Features.cs changes (6 lines added,3 removed). ReadUiInput captures `bool typing=Typing` immediately at entry, before RememberWorldHudFocus or the explicit focus-changing Recovery Escape handler. That same local value is used for ordinary hotkeys, generic FocusRoot Tab cycling and TacticalMapController.ReadUiInput's typing argument. No dynamic Typing re-read remains in this method after focus/navigation changes, and no persistent latch or new authority state is introduced.

For the held J+Tab+Digit1+W regression, a field focused on entry blocks ordinary hotkeys and generic Tab. Tab therefore cannot select a PlanningDecisions control and deselect the TMP field. The map receives typing=true, so its real planning-digit guard does not queue a spawn choice. The existing subsequent world input reader still sees the focused field; this repairs the original within-read reclassification path without changing map rules or input eligibility. The existing regression still asserts focused TMP and zero queued commands; it was not weakened to accept a missing field/fallback/default.

The explicit Recovery Escape body remains unchanged: it intentionally deactivates the recovery field, clears selection and closes the Hub panel. The entry-time true value now continues to suppress other UI/map keys in that same read. Native TMP explicit submit callbacks and all other text-submit paths are unchanged. This review does not claim a new whole-frame/world-input latch or alter that intentional explicit-dismissal exception. No callbacks, input-module lifecycle or runtime ExecuteAlways changes were made.

## Existing five-file packet remains bounded

The original source review's other approved boundaries remain unchanged: planning permits quest journal access only, callback restrictions and native CanAccept/current Session/epoch/view/handle/deadline gates retain authority, trader/notices are refused during planning, opening journal queues nothing, map interaction flags/focus restore do not invent canonical choices, participant labels use selected delivered participants/OwnerRoster rather than names/private roster inference. The four other original source files are unchanged by the correction; source-specific approval is inherited from that exact original review, not a new gameplay/visibility permission.

Independent immutable checks:

- Full current source.sha256 has exactly5 entries; all hashes match both corrective code and final seal. Manifest SHA256 `f1ca1e83d7c9f6bc7a159f65c851609fe9d6dfab74e168e2fe4488758bec23fc`.
- correction.sha256 has exactly1 entry, the corrected Features source; its hash matches both objects. Manifest SHA256 `6c327da1216935bbfc2a3489d452fe5a9ba0d89449bec4539ea14ce889b24a3f`.
- All3 COMPLETE quest/trader/player-flow test files are byte-identical to prior ac584, including every assertion/helper and PlanningJournalRespectsSettingsAndFocusedTextEntry. Exactly25 [Test] method identities still match the selector file: Quest8,Trader6,PlayerFlows11. No body/expectation or selector was removed or replaced.
- Only1 runtime source path changes from ac584 toecb; the seal adds7 own typing-guard evidence paths. No metadata/meta/asset/scene, Net/map/controller/Rust/protocol/status/lock or unrelated source path changes. git diff --check passes.
- Both retained managed runtime/test project templates currently exist, hash-match the unchanged prior validation record and bind to the intended source tree/separate graph and installed Unity/package assemblies. Their local/tmp paths describe this compile environment, not standalone clean-checkout/native execution proof.

## Retained validation and remaining actual gate

Read complete corrective managed compile stdout/stderr: Build succeeded,0 errors,1 inherited CS0067 unused test-transport event warning; no suppressed/new native failure is represented. This compiles the real matching Unity/Net/test source graph but executes no engine lifecycle, TMP selection, raycast, render or focus behavior.

Read the current focused pure-control output:10 passed,0 failed/skipped (UiInputGate5 + PlanningSelections5). These are the recorded unchanged pure Net controls, not execution of the25 Unity fixtures. The historical original packet's11 planning/quest pure passes and prior20 native pass stay historical; they are not added to or substituted for this correction's results. New validation explicitly records current-source engine execution0 and Editor/Play/browser/capture0.

No remaining corrective source blocker found. Root may admit the source and authorize the finite25-method native retake, preserving all earlier failed/compiled/historical receipts. Actual planning rail visibility, raycast/focus restoration, simultaneous key ownership under the engine, text scaling/layout and authoritative Web/planning/quest acceptance remain open until their real gates pass. Source compilation/pure controls do not authorize public/full gameplay or visual/browser acceptance.
