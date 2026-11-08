# Input scheduling and end-to-end network verification

Status: **local scheduling and network tests verified; AWS endpoint run pending**, 2026-11-08.
This is the Codex-owned latency work; it does not certify P-NET-1 prediction or rewind.

## Ownership and integration

- Isolated worktree: `RogueHalla-input-latency`, branch `codex/input-latency`.
- Started from the consolidation tip `b7788161`, then rebased on `6340947b`.
- Notified the Codex `OPTimization_port` coordinator and both DeepSeek Harness sessions (`Rust Port Worker`, `Post Rust`).
  DeepSeek recorded the boundary in its progress ledger. P-NET-1 continues in its existing worktrees.
- Owned changes: `Session.Poll` / `FlushInput`, Unity input scheduling, opt-in presentation trace, `FrameInputTests`,
  `tools/latency/**`, and this evidence directory. Existing `Session.Update` callers retain poll-then-flush behaviour.
- When P-NET-1 Phase 2 is integrated, its `Motion.Step(now)` stays in `Poll` after the clock update. Prediction,
  pathfinding fixtures, RTT bounds, gameplay rules and protocol changes remain owned by their existing lanes.

## Scheduling change

Unity now polls incoming state and advances clocks, collects controls, flushes input once, then prepares presentation.
The earlier order flushed before collecting controls and left a new press queued for the following frame.
Movement pacing, aim gating and server action budgets are preserved.

The test-only browser trace is enabled by `window.__rhLatency` before Unity starts. It records Unity frame IDs,
sampled move sequences and presented positions using `performance.now`, sharing a clock with the harness's actual
WebSocket observer. Ordinary sessions do not retain a trace. The trace has a bounded event count and overflow invalidates
measurement. Presentation markers mean Unity prepared the scene; they are not physical display or photon measurements.

## Checks completed so far

- Engine-independent C# suite: **307 passed, 0 failed**, including same-frame collection/flush, disconnect gating,
  existing `Update` callers and the integrated pathfinder tests. Command:
  `dotnet test client-unity/RoguehallaNet.Tests --nologo --no-restore` with the installed .NET 8 SDK.
- `client-unity/sync-net.sh --check`: pass.
- Pinned Unity `6000.0.85f2` import/C# compilation and actual Web build including the final trace: exit 0.
- Actual Chromium WSS protocol-11 regression proof: **15 checks passed**, 419 snapshots, accepted movement,
  delta resync, reconnect, authoritative results and no page errors. Raw report: `browser-proof.json`.
- Local hosting scripts, templates and identity/budget prerequisites: [AWS readiness](aws-readiness.md).
- Real two-Unity-client added-RTT sweep: **12/12 trials pass**, 0/50/100/150 ms added RTT and 10 ms jitter.
  [Final Linux ARM64 report](linux-rtt-sweep-final.json). Every move left in its sampling frame; maximum sample-to-send 0.101 ms.
- Packaged Unity Web through Caddy HTTPS/WSS to Linux ARM64 Rust: **5/5 pass**.
  [Final report](linux-caddy-wss-final.json). Loopback certificate trust was explicitly skipped; public TLS remains unverified.
- Ordered-stall profile, 100 ms added RTT / 10 ms jitter, every 20th TCP chunk delayed 60 ms: **3/3 pass**.
  [Final Linux report](linux-ordered-stalls-final.json) and a [10/10 repeat](linux-ordered-stalls-repeat.json) record actual
  stalls across both connections/directions. One earlier failed attempt is described below.
- Harness scheduler/completeness/causal-baseline/cleanup/TLS tests: **12/12 pass**. The final evaluator independently accepts all
  four reports above and keeps the saved failed attempt rejected. These are short functional measurements, not statistically
  strong tail-latency or capacity estimates.
- Controlled staging renderer: **5/5 pass**, default byte-preserving, pinned map content, 4h process cap under the existing
  4h30 host deadline. Exact release tar and rendered Caddyfile validate locally. [Staging plan](staging-plan.md).
- The real Go GameLift bridge and Rust server complete their local fake-SDK session lifecycle: **1/1 pass**;
  this does not exercise managed GameLift. [AWS/bridge evidence](aws-readiness.md).

Median milliseconds from the three samples at each profile (additional RTT, beyond the local link):

| Added RTT | Sample → send | Send → confirmed self echo | Sample → confirmed self presentation | Sample → opponent presentation |
|---|---:|---:|---:|---:|
| 0 ms | 0.1 | 54.8 | 66.6 | 114.3 |
| 50 ms | 0.0 | 77.7 | 83.4 | 114.1 |
| 100 ms | 0.0 | 114.1 | 116.6 | 147.3 |
| 150 ms | 0.0 | 192.3 | 199.7 | 230.3 |

Zero means below the browser timer resolution, not zero execution cost. Input sampling starts after a Playwright browser
keyboard event; it excludes physical device/OS latency. The current client uses authoritative self positions; future
P-NET-1 prediction can draw earlier than the confirmed-self endpoint measured here.

Initial smoke and sweep attempts are retained for audit. `local-rtt-sweep.json` and
`agent-sweep-smoke-failed.json` correctly failed because the first harness selected interpolated movement from a previous
trial. The accepted harness now requires stationary received/rendered baselines before every input, a post-send movement,
matching order sequences, matching Unity frames, all requested trials, and no trace/runtime errors. Early smoke reports
use the earlier completeness gate and are superseded by the accepted reports above.

The coordinator's review found that the original delay proxy forwarded TCP FIN before its delayed payload had drained.
The final reports above were repeated with its repair applied: queued request and response bytes drain before FIN;
both player and server must be loopback to bypass test certificate trust; cleanup failures still save a failing report.
The repair provenance is pinned in `manifest.json`. Earlier settled sweep and ordered-stall reports remain historical,
rather than the final corrected-harness evidence. CI runs the 12 contract tests, five renderer tests and saved-report
evaluation; it does not run a new Unity build or network measurement.

The first corrected stall attempt failed before completing a trial: the browser saw authoritative movement sequence 1,
but the harness never observed a post-`Present` self trace with that exact sequence. Repeated three-trial and ten-trial runs passed.
The failure is retained in `linux-ordered-stalls-missing-presentation.json`; the harness now saves bounded per-attempt
sequence/frame traces when a measurement fails. Snapshot batching while held-key controls emit newer orders is a
possible explanation, not a confirmed cause. Passing repeats do not establish reliable exact-sequence presentation
under stalls; this remains a verification item for the integrated client.

The first three-trial Caddy run was slow (confirmed-self median 109.8 ms, opponent 353.2 ms).
Repeated direct-Linux and Caddy diagnostic runs passed five trials each; Caddy socket RTT was about 3.2 ms and snapshot
delivery gaps about 50 ms. The final Caddy run measured confirmed-self 33.2 ms and opponent 129.9 ms medians. These short
unpaired runs show variation and do not establish a Caddy bottleneck. No transport settings were changed to chase it.
See `linux-caddy-unity-wss.json`, `linux-direct-diagnostic.json`, `linux-caddy-diagnostic.json` and the final WSS report.

## Integration build repairs

The consolidated native tree at `6340947b` did not yet compile. For the local server test, applied the coordinator's exact
three-arm `PropKind` match repair (`Cannon`, `Corpse`, `WindEmblem`) and removed the duplicate `consumables: true`
initializer, retaining the existing `consumables: profile_enabled` initializer. Both are reported to the coordinator and
isolated in commit `8c190ed1`, so integration can reuse or drop the identical repair without duplicating gameplay work.

The resulting server reports protocol **11**, content **801a76cde4cfd305**. The Unity build script bakes that identity.
The native executable and Unity payload are pinned to source `23b2e4cf`; the project lead's subsequent integration and
prediction repairs require their own rebuilt artifacts before cloud execution. This evidence certifies the isolated
input scheduling change and baseline data path, not all later gameplay integration.

After the measurements, the two owned Linux test containers and the four owned local server/static listeners were
stopped. Ports 7795–7799 and 8097 had no remaining listeners. Other agents' containers and processes were left running.

## Remaining verification

- Run against the approved AWS endpoint after account, resource, certificate and budget checks.
- Real network packet loss, physical display latency, full eight-player density, Firefox/Safari and sustained production
  fleet capacity remain separate unproven scopes until actually exercised.
