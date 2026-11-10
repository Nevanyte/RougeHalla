# Unity ownership handoff to Claude

Owner instruction (2026-11-10): Claude takes over Unity development; pause all Codex Unity development.
Codex UI/art/client work, Editor/browser tests, builds and client profiling are stopped. Root continues Rust/backend,
AWS, budget/cleanup and integration coordination. Existing completed work and branches are preserved.

## Current playable baseline

- Canonical repository: `/Users/nevinmckinnon/Documents/Projects/RogueHalla`, branch `optimization_port`.
- Live test: **https://play.rougehalla.com**. Official **play.roguehalla.com** is unchanged production.
- Native identity: protocol14 / checkpoint29 / replay23 / OBS21 / policy15 / content `7c6a633f68c2cc72`.
- Unity Web B: `build_81371688fcdf`, source `77a92e715809a6a1aa0686299ccc68dc2c6e2300`;
  compiled Assets match canonical `3253da04905dd80c545dba824ab1b502a1dc15f7`.
- Web manifest SHA `89aa154216996a7df694479d3efc990ffb73521de02dae143a15fa105b4a4455`,14 files/107,046,886 bytes.
  Artifact: `/Users/nevinmckinnon/.codex/tools/rougehalla-unity-wave1-2026-11-09/native-01/web-demo-b/Web`.
- Native Mac B SHA `c30fc84f9b284d0212d2bbe0d13c3b7d894f098d6d93271072df6b8ad6f1dc28`;
  deployed Linux SHA `dd7a208cc2b183268740a910d07db6aa7002260d6d1f9511cfaccf3e4791ce6d`.
- Hosted profile load, Training join, movement and Leave pass. Locally, all five faction activations and genuine
  three-player PvP/Trophy chosen-and-taken/results/profile load pass at the recorded B cuts. These do not prove FPS.

## Preserve these boundaries

- Original dirty Editor PID9075 is not an accepted clean build source. Do not save, reset or clean its state casually.
- Isolated Editor PID46583/project
  `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject`
  was the accepted B build source, with recorded RAM/settings overlays. Verify current handles before using it.
- Preserve Root's prediction stale-echo repair and current Resume/session/retirement guards when applying new hunks.
- The owner approves intentional competitive-netcode departures from older constraints. Review actual correctness,
  privacy, fairness and measured behavior; coordinate protocol/identity changes across Rust/C#/JS and Root's integration.
- No ML. AWS account3033/Calgary and CAD20 total remain the budget scope. Do not change production or credentials.

## Work awaiting Claude

`claude/peaceful-babbage-rtsgq6` at `1f7c5460c22af9907f1cfec4aeffaaa6abf0c489` is explicit Rust protocol15 WIP;
its C#/JS consumers are still14. It is not deployed. The
[focused netcode completion packet](CLAUDE_NETCODE_CHECKPOINT_FINISH.md) records codec, cue lifecycle, epoch cache,
aim-time, projectile alias and catch-up counterplay findings. Root owns final merge/deployment decisions.

The bounded profiling entrypoint is tracked at `client-unity/UnityProject/Tools/profile-m5-b.cjs`, with its adjacent
instructions/tests and passive `profile-hub14.cjs`.24 scoped offline controls and frozen-artifact preflight pass.
It enables Chromium sandboxing and excludes unsafe SwiftShader fallback. Owner approved one local experiment, but
the attempt **failed before measurement** with `BROWSER_DEFAULT_FLAGS_UNAVAILABLE`; do not infer the underlying cause.
Receipt: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/m5-profile-reviewed-01/profile.json`.
Cleanup reports browser/native/static closed; Root independently confirms PIDs96863/96865 and ports17837/18243 absent.
No FPS, GPU-time, input-latency or legacy speedup result exists. Codex will not repair/retry this under the pause.

## Existing evidence and remaining measurement

- Verified compressed main downloads: WASM58,599,146→16,436,423 bytes; data47,874,287→37,908,873 bytes.
  Exact decoded hashes match B. These are HTTP body sizes, not frame-rate evidence.
- Warm public HTTPS `/ping` requests: p50 10.86ms, p95 12.00ms over20 samples; not game WebSocket RTT.
- A fresh local legacy production build and shared160×160 map guard are ready in
  `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/coordination/reports/legacy-m5-build-01`.
  The current48×40 B workload cannot be called a matched160×160 legacy comparison.
- Normal source CI42739863259 at `388e3557` passes all five jobs. Subsequent profiler-only integration has its own
  local checks and fresh CI; do not relabel the earlier run as a new Unity runtime test.

The test AWS host is ephemeral. **Original shutdown: 2026-11-10 03:50:21 UTC (November9,20:50 Calgary).** Root owns
post-expiry AWS/DNS cleanup. Do not extend its timer or budget implicitly; local artifacts/evidence remain available.
