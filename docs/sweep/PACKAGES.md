# Core sweep: packages

Merged packages (one line each) and the specs of the packages not yet merged. Each is implemented by one engineer agent in its own git worktree and branch
(`tools/sweep/core-stage.workflow.js`), reviewed independently, fixed, then merged by the coordinator, who re-runs every gate.
Every package keeps the parity report at all MATCH, proves its claims with `tools/perfproof/perfproof.py` (deterministic
instruction and allocation counts against the merge-base, behaviour fingerprints identical unless declared), and follows
the non-negotiables in CLAUDE.md. Designs referenced as architect/critic/proposal ids (SA1, SH2, OW1, SD5, ...) are in
[audit_result.json](audit_result.json): keys `architect` (packages, target architecture, harness, bugs), `critic` (issues per
package, missing items) and `audit:<lens>` (proposals with designs and baseline measurements).

Dependencies: P7a after P2b; P5b after P5a (done); P7b after P7a; P5c after P5b; P8 after P7b; P9 after P7b + P5c + P10a;
P10b after P9; then the final review. Packages on different lines of that graph can run in parallel when their write scopes
are disjoint (the sim track P7a -> P7b -> P8 and the server track P5b -> P5c are disjoint).

Coordinator decisions that bind them: `dhat` is a dev-dependency of rh-sim (P7a's zero-allocation test); ADR numbers continue
at 0010 (0009 is the core layout, merged with P2b); secrets stay out of the state-hash digest; policy events between
decisions accumulate (bounded) unless that changes scripted-bot outcomes, in which case document the rule; the codec never
clamps what a client sees (it refuses).

## Done (merged into `optimization_port`; numbers in [README.md](README.md))
Earlier packages (perfproof, P1, P6, P2a, P3, P4, P5a-1, P5a-2) are listed in the README's merged table.
- **P2b** executable tick schedule, hook dispatch, same-tick `payLater` seam, `Cx::submit`, ADR 0009: merge `dd867d9`.
- **P10a** protocol v2 (quantized remote actors, `server_ms` derived, `protocol/fixtures/v2.json`): merge `fe4e168`.
- **P7a** allocation-free tick (`step_into`, Roster, inline queues, history ring, `rh-checkpoint/2`): merge `94a34c1`.
- **P5b** density bench, bounded log-linear telemetry, biased pinned-Sleep room loop, `/control/health` metrics: merge `76534b6`
  (merged together with P5c).
- **P5c** one push and one notify per client per tick, batched priority-order flush: merge `76534b6`.
- **P7b** `Store<T>`, `FighterCore`, dense per-slot ranks, scalebench, `rh-checkpoint/3`: merge `29d341c`.
- **P5d** (follow-ups of P5b/P5c: biased reader select, director admission races, padded metrics, refusal log once per room):
  merge `a0e705e`.

## P8: state identity by construction (architect P8, critic P8)
Scope: crates/rh-sim/src/{hash.rs,checkpoint.rs,replay.rs}, crates/rh-sim/tests/{hash_coverage.rs,replay.rs}, crates/rh-sim/clippy.toml,
crates/rh-headless/src/main.rs, docs/adr/0007 addendum.
Do: HashSer serde Serializer feeding 64-bit words (length-prefixed) over World; digest = config + map layer + spawns, NO secrets;
leaf-perturbation coverage test (0 unhashed serialized leaves); rh-replay/2 + ReplayError::Format; deserialization-complete
restore; validating serializer test: no non-finite f64 or skipped/flattened fields in World (sentinels as Option); clippy
disallowed HashMap/HashSet, std transcendentals, Instant/SystemTime in rh-sim.
Proofs: 0 unhashed (66 at 7d94332); hashing cost <= 0.30x base (recorded - unrecorded headless per tick); verify cost <= 0.5x;
restore Err not panic; outcome_digest identical; final_state_hash is the only changed fingerprint.
Inherited from reviews: CheckpointError only refuses a bad tag before parsing when `format` is the first key (P2a review):
refuse in any key order; TileMap keeps pub w/h/tiles that can go stale if mutated after construction, and
TileMap::rebuild()/Sim::after_restore are now redundant shims (P3 review): make the fields private or remove the shims.

## P9: observation and publish path (architect P9, critic P9)
Scope: crates/rh-sim/src/{observe.rs,events.rs}, crates/rh-policy/**, crates/rh-headless/src/lib.rs, crates/rh-server/src/{wire.rs,room.rs},
crates/rh-server/bin/wirebench.rs, crates/rh-server/tests/publish.rs, crates/rh-sim/tests/observe.rs.
Do: observe_into; exhaustive Event::visibility()/class() used by observe and wire, delete is_important; due-only bot observation
(events between decisions accumulate, bounded, unless that changes scripted outcomes; document C-POLICY); per-step event
filtering on multi-step catch-up; SnapshotWriter direct encoding; server uses step_into + reused buffers.
Proofs: publish allocs <= 1.2 per viewer-tick; wire Ir <= 0.75x; headless Ir/tick <= 0.85x of merge-base; byte-identical frames on
single-step wakes; catch-up test; leak tests green.
Note: protocol v2 (P10a) changes the snapshot encoder (SnapshotWriter begin takes the exact actor count); build P9 on top
of the merged P10a.

## P10b: per-connection delta in the writer task, gated on the 204/1000-actor bench; resume yields a full frame.

## Final: review, docs, CI gate
An independent multi-lens review of the whole sweep diff (correctness, parity, contracts, proofs), fixes, then: update
docs/CONTRACTS.md and docs/MIGRATION.md for P8, P9 and P10b (C-DET hash, C-OBS event visibility, C-NET deltas; the merged
packages' text is already recorded: C-TICK schedule, C-NET protocol v2 and egress, checkpoint/3, C-PERSIST admission wait),
ADRs, and a CI job that runs perfproof against the PR merge-base with `--max-ir-ratio` and the allocation gate (valgrind is
available on the ubuntu runners).
