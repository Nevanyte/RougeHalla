# 0aedd first 42-case result

**Result: 42/42 EditMode cases passed once, with 0 failures, skips, inconclusive cases, or extra/missing names.** Exact group totals: QuestJournal 8/8, TraderDialog 6/6, PlayerFlows 11/11, MatchLaunch 17/17. Each group ran once; no test retries occurred. Earlier failed runs and their raw evidence remain preserved separately.

## Source and binding

- Gate source: `0aeddc5b4ce0feb5fc0060f2cf2d56c05dff8944`. The frozen 1,153-entry source identity was verified against Git blobs; the actual run source list covers 1,140 Unity project files.
- The four fixture source/meta pairs, types, methods and attributes match the 8c identity packet byte-for-byte. The 25 preserved case names and 17 added method/argument tuples match the frozen selector contract.
- The test assembly retained MVID `b78f3c03-15d1-4924-b90a-9fe89d2737f4`, with byte-identical fixture sources. Root clarified that this stable test MVID is valid; the earlier uniqueness-only orchestration check stopped before discovery and did not invoke test methods.
- Production `MatchClient` was loaded from the updated assembly, MVID `17da474b-9a95-4b98-8af9-13124aff40e9`, SHA-256 `812b702a3c995d9f0daa838e023279adba2c811f3483e98ae40aff7b57de52dd`. The corrected read-only IL observer verified both relevant call sites and helper; it invoked no source or test methods. The initial observer’s zero-length-operand formatting failure and raw output are retained; the corrected observer handled the operand.
- The loaded Test Framework is 1.6.0; the package lock remains 1.4.6. This version difference is recorded, not attributed as a cause of any behavior.

## Editor state and cleanup

The immediate post-test snapshot records Play/compile/background off, clean empty Main, one preexisting preview scene, original InputSettings ID `-1029656`, no Light2D or EventSystem instances, and a temporary text-scale preference of 0.85. Cleanup then restored that preference to its original absent/default-1 state and explicitly disabled session-only auto-tick. Final composed-source state is stopped and idle, one normal scene and one preexisting preview, clean empty Main, original input instance, default preferences, and unchanged background flags. The refresh guard is released.

Only the known ShaderGraph trailing-space overlay differed after tests. Its observed bytes and patch were retained; exact source bytes were restored. Final verification matched all 1,140 tracked Unity inputs and all 1,153 coordinator source pins with a clean worktree. This result is sealed before returning to exact Frozen4; that subsequent return is recorded separately.

## Scope

This is a bounded 42-case EditMode result. It does not establish full port readiness, Web build or browser behavior, server gameplay, or audio/art integration. No Play session, server, or Web build is claimed.

Detailed evidence is in `evidence/test-execution-ledger.json`, `evidence/discovery-binding-verification.json`, `evidence/as-tested-source.json`, `evidence/loaded-production-identity-and-il.json`, `evidence/native-cleanup-after-tests.json`, and `evidence/state-after-tests.json`.
