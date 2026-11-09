# 035b22c8 first Unity functional retake

**FAIL: 42 executed, 27 passed, 15 failed; zero skipped, unrun, missing or extra.** Exact source `035b22c8b0773d6637da4e0d4906c31d5b3af01e`, containing reviewed fixture-only correction9398/evidence76066 and unchanged launch production4ec. Original9c outcome30/12 remains preserved at fce9e14b. No source/assertion/log-suppression change or retry occurred in this run.

| Fixture | Executed | Passed | Failed |
|---|---:|---:|---:|
| QuestJournalViewEditModeTests | 8 | 8 | 0 |
| TraderDialogViewEditModeTests | 6 | 6 | 0 |
| PlayerFlowsEditModeTests | 11 | 11 | 0 |
| MatchLaunchEditModeTests | 17 | 2 | 15 |
| Total | 42 | 27 | 15 |

The new failures are13 unhandled duplicate-global-light error logs at ArenaView.Awake line57 and2 unhandled EventSystem.current registration logs at fixture InitializeHud line90. Raw full messages/stacks and all17 case statuses are retained. No production cause is assigned. The last group completed before the failure was observed; no later test invocation followed. The coordinator/UI author owns a separately reviewed fix.

Before tests, all1,153 coordinator project/net pins and1,140 tracked Unity Git inputs matched. Exact supplied source-identity manifest SHA256 is `0e8642a4abab996fe66e7ecf2355098f5c527f9df4d7aa9d3bf9f9f6ba5cc384`. Actual compile completed without errors. Source/meta GUIDs/types/public methods matched the corrected fixture; fresh module MVID `cad30248-17a5-410a-8d1b-d6b883f2b74d` differs from9c. Public NUnit discovery again bound the exact42 Runnable leaves to old25 full names and all17 typed method/argument tuples. Full filter closure, enum values/Boolean arguments and global fixture namespace are retained. The old25 source bodies remain byte-identical tofa0; only MatchLaunchEditModeTests.cs changed among Unity/net code versus9c. Two Luna reviews cover source identity, discovery and actual results.

Actual Test Framework is1.6.0. The frozen manifest/cache versus lock1.4.6 discrepancy remains recorded and unmodified. No package update, Play, screenshot, art import/render, audio, Web build or server work occurred.

Post-run public native cleanup inventory contains no Light2D or EventSystem instances and currentEventSystem0. This is a post-state observation, not a reconstruction of error-time registration. Main is empty/clean; no broad native-object or manager cleanup was performed. The known text preference0.85 was observed then restored to absent/default1.0. Original live InputSettings−1029656 and background flags remain. Auto-tick was temporarily16ms/session-only then disabled; no persisted user choice was changed.

Only the known ShaderGraph trailing-space overlay differed. Observed bytes/patch were preserved and exact bytes restored; all1,140 Unity and1,153 coordinator pins match. Refresh guard is released, stopped/idle. The composed result is sealed before returning to exact Frozen4/source5b; the subsequent return is recorded separately. Art source/helper packet a081 remains external and unimported. These are actual engine fixture outcomes, with no browser, gameplay-loop, visual or performance acceptance.
