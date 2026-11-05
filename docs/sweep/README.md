# Core optimization sweep

Owner's goal: "do a final optimization sweep, and make provable improvements to the architecture as this will be the core
for the rest of the project. The architecture should NOT be 1:1 as legacy version but in new languages but should also be
substantially improved." Gameplay stays identical to legacy: every package keeps the parity report at all MATCH.

**Status: the core optimization sweep is COMPLETE.** `optimization_port` at `ae0c37b` holds every package: the audit
packages P1-P7b, P10a, P5a-P5d, P8, P9, the CI perf gate, the P10b measurement, the server hardening (H-server, H-server-2),
the restore hardening (H-sim), the records (Docs-2) and **P10c (protocol v3, the per-connection snapshot delta of ADR 0010)**.
The wire is protocol v3. Next: the final efficiency review of the whole result, then the backlog bulk port
([../backlog/README.md](../backlog/README.md)). This file is the record and the handoff: read it, then
[PACKAGES.md](PACKAGES.md). (The sweep was paused once to move development from the cloud session to a local Mac; the
macOS resume notes are kept below.)

## Method
- **Audit**: six measured lenses (sim architecture, sim hot path, observation/wire, server density, determinism seams,
  legacy carry-over), an architect and a critic. Full record with every design and baseline number:
  [audit_result.json](audit_result.json).
- **Proof harness**: [`tools/perfproof/perfproof.py`](../../tools/perfproof/perfproof.py) builds a baseline revision and the
  working tree and compares deterministic valgrind counts (callgrind instructions, DHAT allocations) per unit of work, plus
  behaviour fingerprints (outcome digest, state-hash fold, bytes, replay verification of base-recorded replays). Machine
  load does not change the counts. Self-comparison noise is about +-0.1%, up to 0.3% on the smallest per-step workloads
  (about 2.7k Ir/step after P7a/P7b): the sweep-wide proofs review compared a0e705e with itself and got 0.9989 (crowded_8),
  0.9994 (duel_chase) and 0.9991 (fists_duel), and 0.9971 between two revisions with no Rust change. The +-0.02% this file
  stated earlier is about 5x too small; gate thresholds below 1.01 are not meaningful.
- **Per package**: one engineer agent in its own git worktree and branch, an independent reviewer, a fix
  pass if the review blocks, then the coordinator merges and re-runs every gate. The reusable Claude Code workflow is
  [`tools/sweep/core-stage.workflow.js`](../../tools/sweep/core-stage.workflow.js).
- **Gates on every merge**: `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace --all-features` (with PostgreSQL), `cargo run -p rh-parity --bin parity-report` (all MATCH), the C#
  tests and `sync-net.sh --check` when client-unity changes, the browser proof when the server or wire changes.

## Merged into `optimization_port`

Numbers are deterministic counts (callgrind Ir, DHAT allocations) against the package's own merge-base unless noted. They
were taken by the package's engineer or reviewer and copied from the per-package reports; only the "Cumulative" section
below was re-measured for this record. Merge commits are listed in [PACKAGES.md](PACKAGES.md).

| Package | What it changed | Proven |
|---|---|---|
| perfproof + schedule record | A/B proof harness; the legacy tick schedule as data (`parity/schedule/legacy_schedule.json`) | self-test ratios 1.000 +- 0.0002 |
| P1 proof gate | parity discovery by format, unknown keys refused, preconditions asserted, per-entity tables; link-level legacy hook capture (append/wrap/replace); hash-independent outcome digest; replay A/B; CI gate flags | synthetic unknown keys MATCH at the base, refused now; digest detects a one-number rule change |
| P6 encoder | exact-size single-allocation frames, `encode_into`, `SnapshotWriter` (removed by H-server), pre-encoded map, MAX_ACTORS refused; C# value-type actors, allocation-free snapshot path | 4.69 -> 1.00 allocations per frame; encode 0.247x Ir; wire workload 0.710x Ir/step; C# decode garbage 0 B steady |
| P2a module split | `sim.rs` 1,868 -> 272 lines: World / MatchStatic / TickScratch, 8 systems as `fn(&mut Cx)`, accessors, `Arc<Arena>`, tagged checkpoint (`rh-checkpoint/1`, now `/3`) | base-recorded replays verify step for step; Ir/step 0.96x on all sim workloads |
| P3 kernel | O(explored) A* reset, nav step mask, memoized string pull, hit-only rays, integer floor, exact `js_round`, validating TileMap | path query 0.778x Ir, allocations 5.4 -> 1.3; `find_path` in bot matches 0.411x; headless 0.893x; 300 legacy paths MATCH; rays equal on 1e6 segments x 2 maps |
| P4 content registry | every gameplay number declared once (50 rows); `content_hash` derived from the registry; source scan | 0 unhashed (about 20 missing before); every row perturbs the hash |
| P5a-2 transport | one shared `serve()` with TCP_NODELAY on plain and TLS; 4 KiB WebSocket read buffers | nodelay on 100% of sockets (0% before); 64 idle connections 9.10 -> 0.97 MB peak heap |
| P5a-1 lifecycle | rooms close at the first wake after the last human; reservations no longer erased; fullest-lobby-first; outbox counters in stats; one `Arc<Arena>` per map; Welcome map encoded once | a failing-before test per bug; per-room heap (seed-1 map, DHAT slope) 210,096 -> 18,566 B per room (-91%); Welcome bytes identical |
| P2b executable schedule | the tick is data: `crates/rh-sim/src/schedule.rs` (phases, systems, hook chains, actions, move modifiers; Ported or Pending rows) checked against `parity/schedule/legacy_schedule.json` in three worlds with mutation tests; hook dispatch (`hooks.rs`, `loot.dropBody` ported through it); `World::pay`, the same-tick `payLater` seam (kill credit routed through it); `Cx::submit` input seam; [ADR 0009](../adr/0009-core-layout.md) | parity all MATCH; base-recorded replay verifies; outcome digests and state hashes identical; Ir 0.97-1.00x vs `95272a3`; allocations 17.40 -> 14.73 per step (crowded_8); flipping `collecting` to false is caught by the slice fixtures (reviewer mutation) |
| P10a protocol v2 | snapshots drop `server_ms` (= tick x 50 ms); remote actors quantized (u16 position at 1/8 u, u16 facing, hp percent, per-actor field mask, varints), the self view keeps full precision; out-of-range positions are refused, never clamped; `wire::arena_fits` at startup; `protocol/fixtures/v2.json` shared by the Rust, C# and JS decoders | wirebench 1,888 -> 908 B/player/s (0.481x), mean snapshot 89.8 -> 43.0 B; encoder 1.0426x Ir/step of the v1 encoder (budget 1.05x), allocations 37.16 -> 30.11 per step; gameplay digests unchanged |
| P7a allocation-free tick | `Sim::step_into(&mut Vec<Event>)`; scratch cleared not taken; inline input queues; history ring; path cursor; Copy ledger entries with names resolved from an append-only `Roster` at result time; `tests/no_alloc.rs` (dhat); `rh-checkpoint/2` (typed refusal of `/1`) | 0 allocations per steady-state step (crowded_8, duel_chase, fists_duel); perfproof allocations per step 14.73 -> 0.12 and 7.26 -> 0.06 vs `dd867d9`; Ir/step vs `7d94332` crowded_8 0.691x (target 0.70 met), duel_chase 0.688x (target 0.62 **missed**; 0.592x with only the step measured); all fingerprints identical |
| P5b density bench + telemetry | biased room-loop select with one pinned `Sleep` (a due step runs before a queued command); per-room step telemetry is a fixed 384 B log-linear histogram (was an unbounded sample list); process metrics on `/control/health`; `densitybench` (real Room, Outbox, Pacer on a paused clock) | 3 callgrind runs within 0.0012%; telemetry 384 B per room (budget 1 KB); 4.18 M Ir per match-second (practice map, 8 humans), about 82 KB heap per room (DHAT) |
| P5c batched egress | one outbox push and one notify per client per tick; the writer drains in priority order and flushes once per wake under one `SEND_TIMEOUT` (early flushes keep the feed under `WS_MAX_WRITE_BUFFER`); reader liveness by last-seen time on a coarse timer | notifies per human-tick 1.097 -> 1.0 (asserted in `tests/density.rs`); frames byte-identical in the old order (counting-sink test); densitybench Ir +1.7% because the bench has no sockets, so the flush, timer and syscall savings are NOT measured |
| P7b identity and data model | `Store<T>` in id order (`EntityId`), dense per-slot ranks and bounties, `FighterCore` components with `Seat`/`Credit`/`Fate`, `FighterRef`, `rh-checkpoint/3`, `scalebench` (feature `bench`); `parity_bench` parses its fixture outside the measured loop | ledger Ir per entry from N=32 to N=212: the merged claim "1.006x (base 3.96x)" does **not reproduce**; reproducible figure 664 -> 740 Ir per entry over the first 100 ticks, 1.115x (under the 1.3x limit), see "Corrections to merged claims" (steady state is worse); same-harness sim-only Ir vs `94a34c1`: crowded_8 0.940x, duel_chase 0.980x, fists_duel 0.971x; vs `7d94332` on one harness: crowded_8 0.595x, duel_chase 0.612x; sim allocations per bot tick 0.387 -> 0.004 |
| P5d reader and admission fixes | biased reader select (a ready client frame beats an overdue liveness tick); two real director admission races fixed plus the test race behind the `pg_e2e` rejoin flake; batched padded metrics counters (shared RMWs 28 -> 7 per wake); refused-snapshot log once per room; real notify counts in densitybench | `pg_e2e` 30 of 30 green under 4 CPU burners (the base failed 3 of 15); the fairness test fails unbiased and passes biased; fingerprints identical; single-thread densitybench Ir +0.26% (unattributed; the RMW saving does not show in single-thread Ir) |
| P8 state identity | `Sim::state_hash` derived from the serialized `World` by a serde `HashSer` (64-bit words, length-prefixed, seeded with a statics digest of config + map layer + spawns); `tests/hash_coverage.rs` perturbs every leaf; `rh-replay/2` with a typed `ReplayError::Format`; decoded values complete (`TileMap::rebuild` and `Sim::after_restore` removed), checkpoint tag refused in any key order, `Sim::restore` refuses a `next_id` not past the last player; `Sim::check_layout` (validating run of the same serializer); `clippy.toml` in rh-sim disallowing hash collections, platform-libm transcendentals and the wall clock; perfproof `--rerecord`; [ADR 0007](../adr/0007-determinism.md) addendum. Merge `95c220b` | 0 unhashed leaves of 12,696 (66 at `7d94332`); hashing cost (recorded - unrecorded headless Ir per tick) 15,170 -> 2,915 = 0.192x (limit 0.30x); verify_replay 21,955 -> 9,746 Ir/step = 0.444x (limit 0.5x); outcome digests and allocations identical, only the four hash fingerprints changed (declared). **Costs:** `sim_crowded_8` 7,545 -> 7,637 Ir/step (+1.2%) and `headless_seed1_8bots` 10,124 -> 10,187 (+0.6%), cause not isolated (probably the per-construction statics digest); the P3-inherited `TileMap` public `w`/`h`/`tiles` were not privatized. The statics secrets stay out of the digest, but the hash still depends on `spawn_seed` through `World.spawn_rng`, so it is server-private (CONTRACTS C-RNG) |
| P9 observation and publish path | `observe_into` (caller-owned buffers); exhaustive `Event::visibility()`/`class()` (a new variant fails to compile in 3 places); bots observed only on decision ticks with bounded event accumulation (`MAX_PENDING_EVENTS` 256, oldest dropped); per-step catch-up filtering with a per-human carry; one `Publisher::frames` path with reused buffers shared by the room and `wirebench`; the room steps with `step_into`; `rh-policy/clippy.toml`. Merge `639843f` | `wire_seed1_8bots` 32,345 -> 25,842 Ir/step = **0.799x** vs `a0e705e` (the spec asked 0.75x; the coordinator's gate was 0.80x, margin a few hundred Ir); allocations 22.73 -> 9.08 per step, publish (9.08 - 0.06) / 8 = 1.13 per viewer-tick (limit 1.2); `headless_seed1_8bots` 10,124 -> 7,262 = 0.717x (limit 0.85x); `headless_arena_8bots` 41,315 -> 21,862 = 0.529x; verify_replay verified, all fingerprints identical; frames byte-identical on single-step wakes (2,400 ticks x 8 viewers); the catch-up room test fails under the reviewer's mutation. Sight is not symmetric (5,946 of 2e6 segments on the seed-1 map), so each ordered pair is judged alone; **the merge subject's "pair-sight cache" does not exist in the code** |
| CI perf gate | `.github/workflows/perfproof.yml`: perfproof A/B against the PR merge-base (or a manual baseline), Ir ratio <= 1.03, no allocation increase, behaviour fingerprints equal unless the PR description declares `Perf-Allow-Fingerprint: ...` (read at run time, re-triggered on `edited`); path filter `crates/**`, `parity/**`, `Cargo.*`, `rust-toolchain.toml`, `tools/perfproof/**`; [CONTRIBUTING.md](../../CONTRIBUTING.md) section. Merge `03dbcd4` | dry run of the exact command line on `sim_crowded_8` (self-compare against `a0e705e`): 7,546 vs 7,545 Ir (0.9998), allocations 0.13 = 0.13, fingerprints equal; `actionlint` clean. **Not yet observed on a real pull request** (cache mapping, valgrind install time) |
| P10b delta measurement | `deltabench` (feature `synthetic`) prototypes a lossless per-connection delta incl. a self-block delta; [ADR 0010](../adr/0010-snapshot-delta.md); no runtime or wire change. Merge `55786a7`; ADR then **Accepted**: protocol v3 adopted, implemented by P10c (merged, next rows) | 8 players, whole stream 908 -> 345 B/player/s (**62.0% saved**, gate 25%); publish Ir about 1.06x (an **estimate** from callgrind of the prototype's functions, not a perfproof A/B; gate 1.10x); 204 synthetic fighters 36,601 -> 21,933 B/s (40.1%, still above 20 KB/s, so the "204 needs it" clause is not what passes the gate); 1000 fighters 165,614 -> 100,936 (917 mean visible exceeds `MAX_ACTORS` 512: a follow-up for mob interest management) |
| H-server hardening | director: owner token per profile entry, `Reserved`/`Seated`/`Leaving`, lease states, a lease never given back while a result is due or in flight, permanent write refusals (`NoLease`, `StaleFence`) stop at once, one `LEAVING_WAIT` deadline per admission starting before auth; rooms: a panic is caught and reported `Closed` (`crashed`), overload applies the queued commands; conn: Ping/Pong charged to the frame bucket, reader fairness after `FAIR_STREAK` (32), Welcome and Reject under `SEND_TIMEOUT`; Events and Fx through a refusing encoder (counted per room); `SnapshotWriter` removed; 10 new `malformedServer` vectors in `v2.json` (server and client vectors byte-identical), JS probe and C# encoders refuse what Rust refuses; `MemoryStore::strict` for deterministic director tests. Merge `3ad072b` | each fix has a test that fails when the fix is reverted (mutation-checked): dead-lobby retry waits for its own give-back, deadline refused at exactly 3.000 s, result in flight keeps the lease, refused write not retried, room panic frees seats and leases, overloaded room applies queued commands, reader sees a finished writer after exactly 32 frames, Ping flood closed `RateLimited`; `pg_e2e` and director/conn/room tests 20 of 20 under 4 CPU burners; `wire_seed1_8bots` 25,811 -> 25,918 Ir/step (**+0.41%**), `headless_seed1_8bots` 7,299 -> 7,299, `densitybench` 3,963,550 -> 3,975,454 Ir per match-second (**+0.30%**, measured by hand), every deterministic count and fingerprint identical; C# 138 tests, JS 663 checks, browser proof PASS |
| H-server-2 | follow-ups to H-server: camelCase `/info` keys, no `sessions` entry for a gone room, duplicate result reports give their lease back, a test rename. Merge `65b08a2` | director tests for each; no sim, wire or perf claim |
| Docs-2 | contracts and records for P8, P9, CI, the P10b decision and H-server; corrected noise floor and P7b scaling proof. Merge `ff57609` | docs only |
| H-sim restore hardening | `Sim::restore` refuses (typed `CheckpointError::Malformed`) every state the tick cannot survive: ids and roster order, clock and tick, rewind gap >= `TICK_MS`, coordinates within the arena + `COORD_MARGIN` (1024), kill/join/down counter bounds, carried weapons, pending actions, queued inputs re-validated; saturating counters and tile arithmetic as the second layer; `Command` opaque (built only by `validate` or a re-validating `Deserialize`); `run_replay` checks `REPLAY_FORMAT`; rh-sim README (`FighterCore`/`FighterRef`, restore rules) and backlog write scopes corrected. Merge `2e8682c` | each rule has a refusal test; a mutation fuzz that also submits, joins and leaves after restore; `crates/rh-headless/tests/restore_real.rs`: 0 false refusals over bot matches (5 seeds, 2-8 players, every 5th tick) and lobby matches (joins, leaves, random validated inputs); an earlier corpus of 817k real checkpoints showed 0 refusals before the coordinate and counter rules were added; perfproof vs `3ad072b` (limit 1.02): Ir ratios 1.0045, 1.0056 (`sim_duel_chase`, the maximum), 1.0011 and 1.0014 on four workloads, allocations and bytes identical, fingerprints identical, base-recorded replays verify; parity all MATCH (13 slice scenarios + 1 capture-only, 300 pathfinding queries); the reviews found four panics reachable through restore (pending action, queued inputs, clock, `next_id`), then dense rewind histories, out-of-arena coordinates and impossible counters, all fixed before the merge |
| P10c protocol v3 | `PROTOCOL_VERSION` 3: per connection, a Full frame (tag 0x83, the v2 layout) or a Delta (tag 0x87) against the last snapshot that connection's writer wrote; the room hands the outbox validated `SnapshotData` and the writer task encodes it (a skipped snapshot is never encoded); Full on the first snapshot, resume, a base older than 64 ticks, a self that appears or changes id, a delta not smaller than the Full, and an answered Resync; a Resync is deferred, never dropped, and forced Full frames are spaced `MIN_FORCED_FULL_TICKS` (20) apart; clients repeat an unanswered Resync with the next refused delta after 2 s; decoders (Rust, C# `SnapshotTracker`, JS) refuse unknown bases and malformed deltas and never clamp; `v3.json` replaces `v2.json`; room counters `snapshotsFull`/`snapshotsDelta`/`snapshotBytesSent`; ADR 0002 v3 addendum. Merge `ae0c37b` | wirebench 908 -> **305 B/player/s** (mean snapshot 43.0 -> 12.8 B; ADR 0010 predicted 345); `wire_seed1_8bots` 25,929 -> 27,178 Ir/step = **1.0482x** vs `2e8682c` (gate 1.10x), allocation count equal (9.08), allocated bytes 366 -> 827; outcome digests and state-hash folds identical, only the declared byte keys changed; a Resync flood costs at most one forced Full per 20 ticks (encoder test with 400 snapshots, live burst); the browser proof replays the review's failing sequence (13 refused deltas, one Full, deltas resume); Rust `vectors.rs` 11/11, `delta.rs` 18, C# 175 and JS 1,945 checks agree on `v3.json` |

Gates on each merge: fmt and clippy clean, the workspace tests (with PostgreSQL), parity all MATCH, the C# tests and
`sync-net.sh --check` when client-unity or the wire changed, and the browser proof when the server or wire changed. Two
exceptions to "re-run at the merge": H-server-2 and H-sim have no merge-time gate run recorded for `2e8682c`; the H-sim tests
ran on the H-sim branch head `fec4572`, which does not contain H-server-2's server changes. The perfproof gates were run per
package against its merge-base, with fingerprints identical except the declared changes: the P10a wire bytes, the P8 hash
values and the P10c wire byte keys.

### Merge-message omissions and corrections
The merge commit messages summarize each report and left out some of its misses. The reports and reviews record them:
- **P5c** (`76534b6`, with P5b): `densitybench` Ir rose 1.7% (ratio 1.0173) because the socket-less bench has no flush or
  syscall to save; the saving is not measured. **P5d** (`a0e705e`): "fingerprints identical" omits `densitybench` +0.26% Ir per
  match-second (4,227,924 -> 4,238,794), which the engineer marked failed and nobody attributed.
- **P8** (`95c220b`): step cost rose, `sim_crowded_8` +1.2% and `headless_seed1_8bots` +0.6% Ir, unattributed.
- **P9** (`639843f`): the wire gate was 0.799x against a relaxed 0.80x (the spec said 0.75x) and the "pair-sight cache" in the
  subject was tried and dropped because sight is asymmetric; nothing like it is in the code.
- **H-server** (`3ad072b`): `wire_seed1_8bots` +0.41% Ir and `densitybench` +0.30% Ir per match-second for the added
  guards; fingerprints identical.
- **P10b** (`55786a7`): the 1.06x publish cost is an estimate from the prototype, not a perfproof A/B.
- **H-sim** (`2e8682c`): the subject says "no false refusals on real matches" and omits the step cost, +0.45-0.56% Ir on
  the sim workloads (above the noise floor, not isolated); the 817k-checkpoint corpus predates the coordinate and counter
  rules, so `restore_real.rs` (smaller, current) is the live evidence.
- **P10c** (`ae0c37b`): the allocated bytes 366 -> 827 per step are in the report, not the subject (the subject does name the 1.048x wire Ir).
- **P7a** (`94a34c1`) did report that duel_chase missed its 0.62x target; it is repeated under Known issues.

### Corrections to merged claims
- **P7b ledger scaling.** The merge claimed "ledger cost per entry N=32 -> 212 grows 1.006x (was 3.96x)". The command behind it
  was not recorded and it does not reproduce. Reproducible: build `scalebench` (`cargo build --release -p rh-headless --features
  bench --bin scalebench`), then
  `valgrind --tool=callgrind --toggle-collect='*ledger*apply*' target/release/scalebench step <N> 100`; divide the toggled
  function's Ir by the ledger entries (hits) the bench prints. Over the first 100 ticks: N=32 599,604 Ir / 903 hits = **664 Ir
  per entry**; N=212 29,865,709 Ir / 40,353 hits = **740 Ir per entry**, **1.115x** growth (the P7b reviewer got the same),
  under the 1.3x limit. The warm-up inflates the early window; a differential run (T=400 minus T=300, which the review did)
  gives 592 Ir per entry at N=32 and 945 at N=212: **1.60x in steady state, over 1.3x**. The cause is the linear
  `src.credit.damaged.contains(&victim_id)` and `damaged_humans.contains` scans in `systems/ledger.rs` (about lines 295-298),
  over a list that grows with the distinct victims of a match. The index, rank and bounty lookups are O(1). Making
  `damaged` membership O(1) (a per-slot bitset or seen-tick beside the ordered `Vec`) keeps legacy order and the hash; it is
  open (see Follow-ups). The old MIGRATION figures 873 and 878 (1.006x) are withdrawn.
- **Cumulative sim ratios** against `7d94332` mix in P7b's harness change (see the note under "Cumulative"); behaviour identity
  to `7d94332` rests on the chain of per-package A/B comparisons, because the base prints no outcome digest or final hash.

## Known issues
- The `pg_e2e` rejoin flake is FIXED (P5d: two admission races and a test race) and H-server removed the remaining
  per-attempt wait (one deadline per admission). Do not reopen it without a failing run.
- P7a's duel_chase Ir target (<= 0.62x of `7d94332`) was missed (0.688x in perfproof, 0.592x step-only). The difference is the
  old `parity_bench` harness's per-step JSON work, which P7b removed from the harness.
- Unattributed Ir increases: P5d +0.26% (densitybench), P8 +1.2% (`sim_crowded_8`) and +0.6% (`headless_seed1_8bots`), H-server
  +0.41% (wire) and +0.30% (densitybench; attributable to the added guards), H-sim +0.45% to +0.56% on the sim workloads
  (`sim_crowded_8`, `sim_duel_chase`; attributed only by the engineer's change list: saturating tile arithmetic and the
  pathfinder's finiteness test).
  P10c's +4.8% on the wire row is attributed (the delta encoder in the writer) and inside its 1.10x gate.
- Not measured: protocol v3 over a real network. The delta numbers are in-process (`wirebench`, perfproof, density runs,
  loopback browser and C# probes). A client that keeps refusing deltas costs one Full frame per 20 ticks, so the saving
  shrinks with loss; there is no server counter for Resync requests yet.
- Ledger cost per entry grows 1.60x from N=32 to 212 in steady state (see Corrections); per-fighter step cost still grows with N
  in a packed melee (1,730 -> 7,204 Ir per fighter at N=8 -> 212, from the O(attackers x bodies) melee candidate scan).
- The state hash is server-private (it depends on `spawn_seed`): never log or export it (CONTRACTS C-RNG). The director keeps
  the last 4 replays in memory; serving or exporting one needs `spawn_rng` separated from `spawn_seed`, or a keyed hash.
- `wire_seed1_8bots` is 0.799x of `a0e705e`: `ray_blocked` is about 29% of the run, a cheaper raycast or fixed-point sight test
  is the next cut (a symmetric sight definition would change observation behaviour and needs a decision).
- perfproof's absolute instruction counts are architecture-specific (the numbers here are x86_64); compare A/B on one machine.

## Follow-ups still open (and where each lives)
| Follow-up | Lives in |
|---|---|
| Make `Credit.damaged` membership O(1); restate the P7b scaling proof | this file (Corrections); `crates/rh-sim/src/systems/ledger.rs` |
| Privatize `TileMap` `w`/`h`/`tiles` (add accessors) | P8/P3 reviews; `crates/rh-sim/src/map.rs` |
| Separate `spawn_rng` from `spawn_seed` or use a keyed hash before any public replay or checkpoint export | CONTRACTS C-RNG; ADR 0007 |
| Isolate the P8 (+1.2% / +0.6% Ir) and H-sim (+0.45-0.56% Ir) step-cost increases | P8 and H-sim reports |
| P10c: wire allocated bytes per step 366 -> 827 (each frame reserves `min_len` + `MAX_DELTA_HEAD` + `MAX_ACTOR_DELTA`, a delta averages 12.8 B; the allocation count rose by 0.004 per step, 9.08 after rounding, visible only with `--max-alloc-increase 0`): size the frame from the previous frame or encode from a writer scratch buffer | `crates/rh-protocol/src/delta.rs`, `crates/rh-server/src/conn.rs` |
| P10c: C# `SnapshotTracker.CopyActorsTo` (like the Full decode) allocates a new `Actors` array when the visible actor count changes; needs an array plus count API | `client-unity/RoguehallaNet/Protocol/SnapshotTracker.cs` |
| P10c: a server counter for Resync requests received and deferred | `crates/rh-server/src/room.rs`, `conn.rs` |
| perfproof: require `verified:true` on the candidate in every mode; add `density_practice` / `density_seed1` workloads | `tools/perfproof/perfproof.py` |
| First real pull-request run of the CI gate (cache mapping, valgrind install time, the cancel-in-progress behaviour on an edited description) | `.github/workflows/perfproof.yml` |
| `wirebench` measures only single-step wakes; add a multi-step-wake (carry) workload | `crates/rh-server/src/bin/wirebench.rs` |
| `observe_into` inlines the sight test that `sees()` also holds: a change to one must change the other | `crates/rh-sim/src/observe.rs` |
| 1000 fighters means 917 visible actors against `MAX_ACTORS` 512: bound the observation | backlog P-MOBS-1, P-VISION-1 |
| Fold the `synthetic` feature of `deltabench` into the existing `bench` feature (optional) | `crates/rh-server/Cargo.toml` |
| `pg_e2e` case for a dead-lobby retry needs a test seam; `RoomCmd::Crash` is test-only, so no end-to-end crash test over WebSockets | `crates/rh-server/tests/pg_e2e.rs`, `room.rs` |
| Lease renewal and the crash lockout, the result spool | backlog P-PERSIST-2 |

## Resuming on macOS
Tools: Xcode command line tools; `rustup` (the toolchain comes from `rust-toolchain.toml`); Node 22; the .NET 8 SDK;
PostgreSQL 16 (Homebrew `postgresql@16`); Docker Desktop (for perfproof); Unity Hub with the Unity 6.0 LTS Editor + WebGL module
(for P-UNITY-1; prefer the newest 6.0 patch over the pinned `6000.0.23f1`, which predates a Unity security advisory).

```
git fetch origin optimization_port
git checkout optimization_port
export PGBIN="$(brew --prefix postgresql@16)/bin"   # tools/pgtest/start.sh defaults to Linux paths
eval "$(tools/pgtest/start.sh)"                       # throwaway cluster; tools/pgtest/stop.sh stops it
cargo test --workspace --all-features && cargo run -p rh-parity --bin parity-report
dotnet test client-unity/RoguehallaNet.Tests && bash client-unity/sync-net.sh --check
npm i --no-save playwright@1.63.0 && npx playwright install chromium
cargo build -p rh-server && node tools/browser-proof/proof.mjs
```

perfproof needs valgrind, which does not run on macOS: run it in a Linux container from the repo root (arm64 Linux is
fine; it builds both sides itself):

```
docker run --rm -v "$PWD":/src -w /src rust:1-bookworm bash -lc \
  'apt-get update -qq && apt-get install -y -qq valgrind python3 >/dev/null && python3 tools/perfproof/perfproof.py --baseline <rev>'
git worktree prune   # afterwards: the container's temporary worktree path does not exist on the Mac
```

Agents: run Claude Code in the repo and invoke the stage workflow with `scriptPath: tools/sweep/core-stage.workflow.js` and
`args: {scratch: <a temp dir>, base: <optimization_port sha>, packages: [...]}` (specs in PACKAGES.md; `resume` +
`resume_note` continue an existing branch). A workflow runs up to min(16, CPUs - 2) agents at once, so a 12-core Mac runs
10. Give each worktree its own target dir (the default) and keep an
eye on disk: `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only` keeps each worktree's build small.

## Cumulative (merged head `ae0c37b` vs the Stage 1 head `7d94332`)
The sim and headless rows were measured at `2e8682c` with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=line-tables-only`:
`python3 tools/perfproof/perfproof.py --baseline 7d94332 --only sim_crowded_8,sim_duel_chase,sim_fists_duel,headless_seed1_8bots,headless_arena_8bots`
(x86_64 cloud container, 4 vCPU; deterministic counts per unit of work; no `--allow-fingerprint-change` was needed, the gate
printed `pass`; the base prints no outcome digest or state hash for these rows, only tick counts). They stay valid at
`ae0c37b`: `git diff --stat 2e8682c ae0c37b -- crates/rh-sim crates/rh-headless crates/rh-policy` is empty (P10c touched no
simulation, headless or policy code). The wire row was measured at `ae0c37b` (candidate `f382e86`, a merge with docs-only
changes on top of `ae0c37b`) with `python3 tools/perfproof/perfproof.py --baseline 7d94332 --only wire_seed1_8bots
--allow-fingerprint-change wire_seed1_8bots.bytesPerPlayerPerSec,wire_seed1_8bots.meanSnapshotBytes` (gate `pass`; the declared
changes are the two byte keys, 1,888 -> 305 B/player/s and mean snapshot 89.8 -> 12.8 B). The previous records of this table
were taken at `3ad072b` and `a0e705e`.

| Workload | Instructions | Allocations | Allocated bytes |
|---|---|---|---|
| sim_crowded_8 (8 players brawling, per step) | 15,273 -> 7,667 (0.502x; see note) | 19.32 -> 0.13 | 1,804 -> 124 |
| sim_duel_chase (pathfinding, per step) | 5,899 -> 3,030 (0.514x; see note) | 10.71 -> 0.07 | 625 -> 57 |
| sim_fists_duel (per step) | 5,511 -> 2,718 (0.493x; see note) | 10.45 -> 0.18 | 669 -> 112 |
| wire_seed1_8bots (step + observe + encode for 8, per step; protocol v3) | 50,692 -> 27,179 (0.536x) | 72.16 -> 9.08 | 5,273 -> 827 |
| headless_seed1_8bots (full bot tick, per tick) | 14,647 -> 7,307 (0.499x) | 13.34 -> 0.06 | 1,502 -> 262 |
| headless_arena_8bots (per tick) | 48,844 -> 21,836 (0.447x) | 32.15 -> 0.46 | 5,014 -> 252 |

Wire bytes (`wirebench`, seed 1, 8 bots, payload only): 1,888 B/player/s at Stage 1 (protocol v1), 908 with v2 (P10a), **305
with v3** (P10c): 0.162x of Stage 1; mean snapshot 89.8 -> 43.0 -> 12.8 B. The wire row's Ir is 0.536x of Stage 1 with v3
against 0.511x with v2 at `3ad072b`: the delta encoder costs 1.0482x of the v2 wire row for 66% fewer bytes. The wire row
allocates more bytes per step than at `3ad072b` (366 -> 827) at an equal allocation count (follow-up below).

Against `3ad072b` (the previous record) the sim-side rows moved by +0.46% (`sim_crowded_8` 7,632 -> 7,667), +0.70%
(`sim_duel_chase` 3,009 -> 3,030), -0.22% (`sim_fists_duel` 2,724 -> 2,718), +0.11% (`headless_seed1_8bots` 7,299 -> 7,307) and
+0.21% (`headless_arena_8bots` 21,791 -> 21,836), with allocations and bytes unchanged. The causes are H-sim's saturating tile
arithmetic and the per-coordinate finiteness test in the pathfinder, not isolated further. `sim_crowded_8` and
`sim_duel_chase` are above the noise floor (+-0.1%, up to 0.3% on the smallest per-step workloads), and `headless_arena_8bots`
arguably too. These deltas compare against an earlier record, not an A/B run, which is why `sim_duel_chase` reads 1.0070
here while the H-sim A/B against its merge-base measured at most 1.0056. The base column differs by up to 5 Ir from the
earlier record (15,271, 5,897, 5,516), which is noise.

Against `a0e705e` the sim rows went up by 1.0% to 2.2% (P8's statics digest and hash walk;
`sim_crowded_8` 7,545 -> 7,632, `sim_duel_chase` 2,979 -> 3,009, `sim_fists_duel` 2,665 -> 2,724), which is above the
+-0.3% noise; the wire and headless rows went down by P9 (wire 32,345 -> 25,918 with v2, headless 10,124 -> 7,299, arena 41,315 ->
21,791).

Behaviour fingerprints: outcome digests equal the previous records and the per-package ones (crowded_8
`81840e347e82edd9`, duel_chase `2a0afa364dd6bf10`, fists_duel `7a3fb62cf2aceb59`, headless_seed1 `cf2d4984cfd44b3a`,
headless_arena `8794abeb297abb79`; wire `12e2915af47124fd`, equal at `3ad072b` and at `ae0c37b`). The `3ad072b` record held
only outcome digests; the H-sim A/B against `3ad072b` found every fingerprint identical. The final state hashes (crowded_8
`59579cc78d027da2`, duel_chase `3d6422f23d5f8d93`, fists_duel `c520e9eae08b7ef7`) and state-hash folds (headless_seed1
`39f3a3170600b491`, headless_arena `1852586132e59e61`) were recorded for the first time at `2e8682c`, for the next comparison.
The base at `7d94332` prints no outcome digest or final hash (perfproof's "same behaviour" is vacuous for them in the
sim-side comparison; the base prints tick counts only), so behaviour identity to `7d94332` rests on the chain of
per-package A/B comparisons. The wire row at `ae0c37b` printed an outcome digest only on the candidate and equals the recorded
one. Declared changes, over the whole sweep: the P10a wire bytes (1,888 -> 908 B/player/s, mean snapshot 89.8 -> 43.0 B), the
P8 hash values (the final state hash and the state-hash fold changed definition) and the P10c wire bytes (908 -> 305
B/player/s, mean snapshot 43.0 -> 12.8 B). At `3ad072b` the declared changes were the P10a bytes and the P8 hash definition;
the sim-side run at `2e8682c` needed no declaration because the base prints no hash.

**Note on the `sim_*` rows.** They run `parity_bench`. At `7d94332` that harness parsed the fixture's JSON inside the measured
loop (per-step `Value` lookups for every input); P7b moved the parsing out of the loop. The base side of the table runs the old
harness and the candidate the new one, so the `sim_*` rows (instructions, allocations and bytes alike) include the removal of
the harness's own work and overstate the simulator's gain. Same-harness figures from the P7b report (not re-run for this
record, and obtained with an overlay of the new harness on `7d94332` that was never committed, so nobody can reproduce them):
Ir per step vs `7d94332`, crowded_8 12,673 -> 7,546 (0.595x) and duel_chase 4,869 -> 2,978 (0.612x), at `94a34c1`/`29d341c`,
before P8. Do not quote 0.612x as a met target: P7a measured duel_chase at 0.688x on the original harness. The simulator
itself is proven allocation-free per steady-state step by `crates/rh-sim/tests/no_alloc.rs`. The `wire_*` and `headless_*`
rows do not use `parity_bench`.

Deterministic server figures (not part of perfproof): wirebench at `ae0c37b` 305 B/player/s (snapshot 256, fx 48, 22.9 frames
per player-second, mean snapshot 12.8 B, 8 Full and 19,192 Delta snapshot frames over 2,400 steps and 8 players, Welcome
4,911 B; it was 908 with v2: snapshot 859); densitybench `--rooms 4 --humans 8 --secs 20` (practice map, no bots, measured
before v3 and not re-run): notifies 1.0 and writer wakes 1.0 per human-tick, 1.0947 frames and 92.83 B per human-tick. Ir per match-second: 4,178,279 at `a0e705e`
((519,590,708 at 30 s - 185,328,394 at 10 s) / (4 rooms x 20 s), callgrind); 3,963,550 before H-server and 3,975,454 after
(+0.30%), both from the H-server report (callgrind at `--secs 10` and `20`, by hand; perfproof has no densitybench
workload), not re-run for this record.

The largest gains still to come (backlog work and the final efficiency review): a cheaper raycast or sight test (about 29% of
the wire workload), the O(1) `damaged` membership in the ledger, and the melee candidate scan.
