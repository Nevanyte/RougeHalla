# Full-suite allocation context: diagnostic proposal, not a fix

Exact isolated base `1a1ac8d70b323ac7159d60dea336e89e7b56389e`, branch `codex/csharp-allocation-full-context`. Read the existing `csharp-allocation-isolation/root-linux-admission` receipt first. Its focused Linux diagnostic did not establish the cause of either full-suite failure. No production decoder, budget, selector, fixture setup, warmup, tiering, GC policy, dependency, lock, header, shared status or actual workflow is changed here. No Cargo, push, workflow dispatch, source campaign or cloud action occurred. One worker.

**Historical CI cause remains UNKNOWN.** Normal CI42610654982 failed spectator1 at120.108 versus120,2160 excess bytes over20000 calls,756/757 passing. Original CI42601100872 remains red at spectator14 with1128 excess bytes. Later lead-reported normal CI42615460588 at `3126e5c3209334c637d1f067f3f0b8209dbf06f4` passed773 after adding16 launch tests, with decoder/helper/budgets/workflow unchanged; that is a separate observation, not evidence of a repaired cause. This worker stayed on exact1a1 and did not rerun the later head.

## Actual local boundary

SDK8.0.427, runtime.NET8.0.33, macOS ARM64; these are **not** the earlier Ubuntu26.04 x64 environment, where SDK10 was selected while executing the.NET8.0.33 target runtime. The proposed Linux step captures both SDK inventory/selection and target-runtime metadata rather than conflating them.

| One finite execution | Actual result |
|---|---|
| Initial outside-Git build-output relocation | Invalid full-suite observation: Util.RepoRoot walks upward from the assembly; fixture discovery broke,44 failed/384 discovered. Preserved, not called an allocation regression. |
| Exact1a1 source in ordinary bin/obj layout, offline restore |757/757 passed once, with proposed source changes temporarily removed byte-for-byte. Local baseline only. |
| Opt-in traced **full** suite, original757 selectors/budgets |754/757 passed; three zero-budget failures remain red. All28 trace windows retained,540001 body samples (27 full windows plus the intentional one-sample exception control). |
| One console execution, four declared no-decoder controls | All four finished;80000 body samples. No forced collections. Pressure cases allocate128MiB each ordinarily, with at most nine1MiB arrays live per allocator. Threads join before the next case. |

No identical normal run was retried to select a green result. Tracing and controls are materially different diagnostic experiments. No further execution campaign is proposed before Root reviews this seal.

## What the full-context traces actually show

Session delta14: all20000 bracketed body deltas are0, yet the unchanged outer counter window contains4512 bytes. The complete4512 jump occurs in the gap immediately before measured index482. Session snapshot1 similarly has all20000 body deltas0, with8032 outer bytes in the gap before index2111. Both tests **failed** their unchanged zero ceilings; the interstitial counts were not subtracted.

Session snapshot68 has one1304-byte body delta and19999 zero deltas; attribution inside that body remains unresolved. Plain self14 has one40-byte excess and self68 one2016-byte excess. Spectator1/14/68 are exactly120/536/2264 on every body call in this diagnostic, so it did not reproduce the historical Linux spectator1 failure. Data are raw and unreduced in the archive.

The no-decoder console uses the real candidate PerCall and a declared warmup anchor at index0. Measured work only spins, optionally allocating a known object. Spin-only with and without ordinary background pressure both returned0: negative observations, not a reproduced empty-body surplus. Under pressure, the every-call-object control has **exactly24 bytes in every one of20000 body brackets**,480000 genuine body bytes, but an outer total493704. The13704 difference comprises gaps4768/4168/4768 before indices8139/10773/17155. This process never invokes a decoder. The first-measured-index object remains24 exact total. `controls.json`'s mean-times-iterations floating field is descriptive; the exact integer counter totals in raw window files are authoritative, without rounding.

This establishes that the local runtime/diagnostic environment can report interstitial counts independently of decoder calls. It does **not** establish whether those counts are allocation-context bookkeeping or runtime-internal managed objects, does not identify the inside-body1304 source, and does not retrospectively attribute Linux's1128/2160 bytes. The instrumentation's preallocated arrays/serialization add process heap pressure and alter timing; an observed diagnostic failure is not relabelled as an original CI reproduction.

## Exact diagnostic API placement and overhead

Everything below remains inside the **outer** original20000-call counter window unless explicitly described as caller setup/completion. No measured sample or gap is excluded from its result.

| Location | Calls/work | Allocation evidence and limitation |
|---|---|---|
| Before each inner body bracket | Environment.CurrentManagedThreadId; GC.CollectionCount(0/1/2); Stopwatch.GetTimestamp; preallocated array writes/index arithmetic | Source implementations are scalar/intrinsic/native queries, with no explicit managed allocation site. All are exercised in the existing200 warmup calls. CollectionCount's native return includes a GC poll, so a query can permit a GC transition even when it creates no object. |
| Inner bracket | GC.GetAllocatedBytesForCurrentThread; original body; GC.GetAllocatedBytesForCurrentThread in finally | Counter reads use the pinned runtime's allocation-context arithmetic. Body bytes and exception-path allocations remain visible. |
| After each inner bracket | Stopwatch.GetTimestamp; GC.CollectionCount(0/1/2); preallocated array writes/captured index | Same source-level no-object query paths; counters and writes remain in the outer window. These gaps are explicitly reconciled, never treated as a noise allowance. |
| Outside worker/window | Trace/delegate/array creation; test-name lookup; GetGCMemoryInfo(Background); runtime strings; JSON/file output after Join | These can allocate and induce process GC. Background index metadata spans caller setup through post-Join report construction; it is **not** an exact timestamped background-GC event stream for the measured window. |

Independent empirical checks: existing empty/context controls have exactly0 across all their inner/outer counters; the existing real-object control reports24 per call, and the index200 control reports24 once. The additional no-decoder pressure control preserves480000 body bytes exactly while showing13704 interstitial bytes. These observations rule out an unconditional per-call instrumentation allocation, but do not prove the APIs/runtime never allocate in every state. No allocation-stack profiler or exhaustive native allocation log was collected. We therefore do not claim physical-object attribution from counter arithmetic alone.

Pinned primary sources at **v8.0.33**, all downloaded source lengths/hashes/URLs bound in `runtime-source-manifest.json`:

- [GC counters](https://github.com/dotnet/runtime/blob/v8.0.33/src/coreclr/vm/comutilnative.cpp): CollectionCount761–773 queries the heap and polls GC; GetAllocatedBytesForCurrentThread936–945 combines context byte counters and remaining context space.
- [Stopwatch](https://github.com/dotnet/runtime/blob/v8.0.33/src/libraries/System.Private.CoreLib/src/System/Diagnostics/Stopwatch.cs), [Unix path](https://github.com/dotnet/runtime/blob/v8.0.33/src/libraries/System.Private.CoreLib/src/System/Diagnostics/Stopwatch.Unix.cs), [interop](https://github.com/dotnet/runtime/blob/v8.0.33/src/libraries/Common/src/Interop/Unix/System.Native/Interop.GetTimestamp.cs), [native clock](https://github.com/dotnet/runtime/blob/v8.0.33/src/native/libs/System.Native/pal_time.c): scalar monotonic-clock query, with suppressed GC transition on the interop path.
- [Environment intrinsic](https://github.com/dotnet/runtime/blob/v8.0.33/src/coreclr/System.Private.CoreLib/src/System/Environment.CoreCLR.cs): current managed thread ID is a runtime intrinsic/internal call. [Thread wrapper](https://github.com/dotnet/runtime/blob/v8.0.33/src/coreclr/System.Private.CoreLib/src/System/Threading/Thread.CoreCLR.cs) and [native thread helpers](https://github.com/dotnet/runtime/blob/v8.0.33/src/coreclr/vm/comsynchronizable.cpp) expose scalar ID/short-spin paths; the64-iteration spin takes the native short-spin branch.

Upstream [issue134724](https://github.com/dotnet/runtime/issues/134724) reports no-decoder counter anomalies; [draft PR134855](https://github.com/dotnet/runtime/pull/134855) proposes retiring abandoned background-GC allocation contexts correctly. These are a specific mechanism to investigate, **not proof of this repository's CI cause or an accepted/backported runtime fix**. No workaround based on them is installed.

## Concrete reviewable patch and next boundary

`GarbageTests.PerCall` adds only an opt-in trace decorator, an exact after-counter capture, and post-Join report completion. The returned mean still uses the entire original window. Without RH_ALLOCATION_TRACE_DIRECTORY no trace/decorator/arrays exist. Existing five controls remain byte-unchanged. No live production library/mirror diff exists. This is a **DIAGNOSTIC-ONLY candidate**, not an allocation fix or normal-CI clearance.

`proposed-workflow.patch` is applicable but **not applied**. It keeps the actual normal full-suite command and existing Unity-copy check first, then adds an always-run traced full suite, bounded console controls, reconciliation and always-uploaded raw artifacts. There is no continue-on-error or filtered substitute for the normal suite; its red status cannot be cleared by diagnostic results. Root owns review/application/push/dispatch. Diagnostic analysis exit0 means exact data reconciliation only; it does not mean decoder budgets passed.

The smallest justified next step is this full-context Linux evidence, followed by allocation-stack/native accounting investigation if needed. **No production or measurement workaround is justified yet.** In particular no window subtraction, tolerance, warmup increase, GC.Collect, NoGCRegion, tiering override, SDK/runtime substitution or green-by-retry is proposed. Reliable unchanged-budget measurement and historical Linux attribution remain open review gates.

Verification without rerunning the experiment:

```sh
git apply --check docs/evidence/csharp-full-context/proposed-workflow.patch
shasum -a 256 -c docs/evidence/csharp-full-context/SHA256SUMS
# After unpacking local-raw.tar.gz into a NEW task-owned directory:
python3 tools/csharp-full-context/analyze.py NEW_DIRECTORY/traced-full-001 --expected-windows 28
python3 tools/csharp-full-context/analyze.py NEW_DIRECTORY/controls-001/windows --expected-windows 4
```

Exact raw files, source snapshots used in the executed diagnostic, outcomes and API source pins remain outside Git under `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/csharp-full-context-1a1a/`. The sealed archive/manifest retain all32 raw windows and620001 captured samples, including red/partial outcomes. Build with warnings-as-errors passes; source diff/patch and checksum checks pass. That is source/tool verification, not Linux runtime acceptance.
