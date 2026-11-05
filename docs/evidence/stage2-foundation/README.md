# Stage 2 native integration checkpoint

These checks cover the melee/item foundation and protocol 5 integration on `optimization_port`, based on commit
`50bb06a` plus the working changes included by this evidence's containing commit. They do not establish full-game
parity, browser performance, public hosting, capacity or release readiness. Unity build inputs and fingerprints are
recorded separately in `../stage2-unity-v5/`.

On Apple M5 Pro, macOS 26.6.1 arm64, Rust 1.97.0:

| Check | Observed result |
| --- | --- |
| `cargo test --workspace --all-features` with PostgreSQL 16.15 | 395 passed, 0 failed, 1 intentionally ignored heap measurement, none filtered |
| `cargo test --workspace` with PostgreSQL 16.15 | 386 passed, 0 failed, 1 intentionally ignored, none filtered |
| Workspace Clippy, default and all features, all targets, warnings denied | Passed |
| `cargo fmt --all --check` | Passed |
| Current parity report | 20 compared scenarios, 300 path queries MATCH; 15 additional scenarios remain capture-only |
| C# tests / JS vectors | 220 tests / 3,344 checks passed |
| Actual C# console probe against current Rust server | Welcome, 59 snapshots through tick 59, no rejects, decode errors, refused deltas or resyncs |

`csharp-probe.json` records the real console run and the tested server's SHA-256. Its 3-second loopback WS run did not
observe a match result and is not a public TLS or Unity presentation test. Loopback RTT is not regional latency.
The actual Unity HTTP/WS and locally certified HTTPS/WSS runs are recorded in `../stage2-unity-v5/`.

`native-bench.json` compares the frozen `e7e85338` baseline with the candidate on the same machine, using release
`parity-bench` binaries and the original captured inputs. Each of three interleaved baseline/candidate pairs runs
1,000 repetitions after 10 warm-up repetitions. The table shows the median of the three reported values, in microseconds
per simulation step:

| Fixture | Baseline mean / p50 / p99 | Candidate mean / p50 / p99 |
| --- | --- | --- |
| crowded_8 | 0.23 / 0.21 / 0.67 | 0.25 / 0.25 / 0.67 |
| duel_chase | 0.07 / 0.08 / 0.17 | 0.08 / 0.08 / 0.17 |
| fists_duel | 0.06 / 0.04 / 0.17 | 0.07 / 0.04 / 0.17 |

The added mechanics have a small measured cost on these slice workloads. Sub-microsecond wall timings are coarse and
noisy; this is not evidence of a speedup or a replacement for deterministic instruction-count regression gates.
Private state hashes differ because the checkpoint/content schemas changed; both revisions preserve the original
canonical slice outcomes. These measurements do not represent complete-game CPU cost, hosting density or frame time.
The owner selected M5 Pro as the initial 60 FPS reference on 2026-11-05; that frame-rate target is still unverified.

All checks were local. Stage 2 AWS resources created: zero; cloud spend from these checks: zero. The authorized
staging budget remains CAD 20 total. No DNS or production service was changed.
