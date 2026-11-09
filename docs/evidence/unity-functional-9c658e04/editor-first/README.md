# 9c658e04 first Unity functional outcome

**FAIL: 42 executed, 30 passed, 12 failed, zero skipped/unrun/missing/extra.** Exact private composed source `9c658e049d4b4e77118004d481349d1523e2ded4`, source approval `4ec547312dc9b7214bbf6a8e20a6ff7ed3f3ba3b`. One first execution of each approved group; no retry, test/assertion/source edit, earlier gate replay, Play, screenshot, art import/render, audio, Web build or server work.

| Fixture | Expected/executed | Passed | Failed |
|---|---:|---:|---:|
| QuestJournalViewEditModeTests | 8 | 8 | 0 |
| TraderDialogViewEditModeTests | 6 | 6 | 0 |
| PlayerFlowsEditModeTests | 11 | 11 | 0 |
| MatchLaunchEditModeTests | 17 | 5 | 12 |
| Total | 42 | 30 | 12 |

The last group completed before its failures were observed through the CLI; no later test invocation followed. The raw results and unchanged negative cases remain available. New failures include an empty connection-change message, expected ownership-request counts1 observed0, and attempts to welcome a nonexistent transport. The cause is unassigned here; the UI author/coordinator owns diagnosis and a separately released revision. A successful CLI envelope is not treated as a passing test outcome.

## Identity and discovery before execution

All 1,140 tracked Unity inputs matched frozen Git blobs before refresh. Source/meta hashes, imported GUIDs/types and public method names matched the source packet; method counts8/6/11/14 correspond to8/6/11/17 cases. Fresh loaded test module MVID: `5060c178-6253-4a15-a153-f5615131d3c5`. Actual compilation completed without errors.

Public TestRunnerApi discovery, without test execution, retained all42 leaf full names and typed arguments. The old25 full names match the frozen selector file and their source bodies match fa0c0891. Each of the new17 source method/argument tuples binds uniquely to actual NUnit discovery; the new fixture is in the global namespace and its enum is `Roguehalla.Net.MatchLaunchMode` (Arena0/Training1), with literal Boolean values preserved. The complete case-insensitive CLI fixture-filter closure was checked against those exact names before execution. Raw discovery, binding verification and per-case outcomes are retained.

A preliminary identity-file read raced a still-running CLI process and saw an empty file; after completion the same result validated. A preliminary binder assumed a Client enum namespace; it was corrected against the frozen Net source and actual typed discovery before any tests. No selector, test or assertion changed. These observer issues are separate from the twelve engine test failures.

Public PackageInfo confirms actual Test Framework1.6.0. The frozen manifest/cache report1.6.0 while packages-lock reports1.4.6; no package or lock update was attempted. Unity remains6000.0.85f2. Auto-tick was observed already enabled after source reload; the gate set a temporary16ms interval without persisting a preference, then explicitly disabled it. No numerical auto-tick baseline is invented for the period before that observation.

## Owned cleanup

The tests left the known text-scale key at0.85; its observation was saved and public PlayerPrefs restored the absent/default1.0 baseline. Original live InputSettings −1029656, HideAndDontSave, dynamic update and reset/disable background behavior remain. Both background flags and Play/pause are false. Main is empty/clean at its original asset path, with one loaded scene and one pre-existing preview scene; no scene was saved. Native scene handles may change when the engine reloads test scenes; path/root/dirty restoration is recorded without inventing preservation of the entry handle.

Only the known ShaderGraph trailing-space overlay differed after the run. Its observed bytes/patch were preserved and exact source bytes restored; all1,140 hashes match. Refresh guard is released and auto-tick is disabled. The composed gate is sealed before returning to `codex/unity-frozen4-visual-corrections` at5b7877f9; the subsequent return is recorded separately outside this immutable proof commit. Frozen4 correction sources/helper remain external and unchanged. This report provides engine fixture results only, not browser, rendered, gameplay-loop or art acceptance.
