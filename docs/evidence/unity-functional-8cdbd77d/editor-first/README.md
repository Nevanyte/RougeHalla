# Unity functional 42-case result — 8cdbd77d

## Result

Fresh Unity Editor discovery bound all 42 NUnit leaves to the frozen selectors and source arguments under test assembly MVID `b78f3c03-15d1-4924-b90a-9fe89d2737f4`.

- Quest Journal: 8/8 passed.
- Trader Dialog: 6/6 passed.
- Player Flows: 11/11 passed.
- Match Launch: 1/17 passed; 16 failed.
- Overall: 26 passed, 16 failed.

The one passing Match Launch case was `EditingTrainingTargetDuringOwnerRequestCannotUseItsCapturedToken`. All 16 failures reported the same unhandled EditMode log: `Destroy may not be called from edit mode! Use DestroyImmediate instead.` The recorded stack reaches `MatchClient.CloseCurrentSession` at `Assets/Scripts/Net/MatchClient.cs:158`, through `CancelOwnedJoin`, `Leave`, and fixture `Dispose`. This note records the observed failure only; it makes no root-cause claim, proposes no fix, and records no retry or log suppression.

## Source and runner identity

The run used the fresh 8c lifecycle-retake source identity: its root pin covers 1,153 project and Net inputs, including 1,140 tracked Unity inputs. The 25 existing case bodies/names and all 17 Match Launch method/argument tuples were preserved. The actual loaded Test Framework was 1.6.0; the project lock reports 1.4.6, the same version discrepancy noted before this run.

## Restored state

After the run, the Editor was stopped and idle; auto-tick was off. Text preference key was absent and scale restored to 1.0. The original InputSettings instance ID was `-1029656`. Main was empty and clean; no Light2D objects or EventSystem remained. The restoration receipt verifies all 1,140 tracked Unity inputs and all 1,153 project/Net pins, with exact hashes and a clean worktree.

The orchestration observer had two receipt-handling issues: one call placed flags after `--` and returned empty output; a later successful auto-tick response was string-shaped and rejected by the orchestrator. The corrected cleanup calls succeeded. These issues caused no test or source rerun.

## Raw evidence

- `EXPECTED_SOURCE_IDENTITY.json` and `EXPECTED_SELECTORS.frozen.json`: expected source and cases.
- `discovered-cases.json`, `evidence/discovery-binding-verification.json`, `evidence/imported-loaded-identity.json`: discovery, exact binding, loaded assembly identity, and MVID.
- `evidence/test-execution-ledger.json` and `evidence/tests-{QuestJournalViewEditModeTests,TraderDialogViewEditModeTests,PlayerFlowsEditModeTests,MatchLaunchEditModeTests}.json`: per-group raw results.
- `evidence/final-composed-idle-state.json`, `evidence/temporary-pref-restoration.json`, `evidence/native-cleanup-after-tests.json`, `evidence/composed-source-restoration-verification.json`, and `evidence/source-overlays.patch`: cleanup and restoration records.
