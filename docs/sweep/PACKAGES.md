# Core sweep: remaining packages

Specs for the packages not yet built. Each is implemented by one engineer agent in its own git worktree and branch
(`tools/sweep/core-stage.workflow.js`), reviewed independently, fixed, then merged by the coordinator, who re-runs every gate.
Every package keeps the parity report at all MATCH, proves its claims with `tools/perfproof/perfproof.py` (deterministic
instruction and allocation counts against the merge-base, behaviour fingerprints identical unless declared), and follows
the non-negotiables in CLAUDE.md. Designs referenced as architect/critic/proposal ids (SA1, SH2, OW1, SD5, ...) are in
[audit_result.json](audit_result.json): keys `architect` (packages, target architecture, harness, bugs), `critic` (issues per
package, missing items) and `audit:<lens>` (proposals with designs and baseline measurements).

Dependencies: P7a after P2b; P5b after P5a (done); P7b after P7a; P5c after P5b; P8 after P7b; P9 after P7b + P5c + P10a;
P10b after P9; then the final review. Packages on different lines of that graph can run in parallel when their write scopes
are disjoint (the sim track P7a -> P7b -> P8 and the server track P5b -> P5c are disjoint).

Coordinator decisions that bind them: `dhat` may be added as a dev-dependency of rh-sim (P7a's zero-allocation test);
ADR numbers continue at 0010 (0009 is the core layout, on the P2b branch); secrets stay out of the state-hash digest;
policy events between decisions accumulate (bounded) unless that changes scripted-bot outcomes, in which case document
the rule; the codec never clamps what a client sees (it refuses).


## P7a: allocation-free tick (architect P7 step 4 + Copy ledger from step 2; critic P7 issues)
Scope: crates/rh-sim/src/{scratch.rs,systems/*,input.rs,rng.rs,sim.rs,state.rs,results.rs,hash.rs (field paths only)},
crates/rh-sim/Cargo.toml + Cargo.lock (ONLY: dhat as a dev-dependency of rh-sim), crates/rh-sim/tests/no_alloc.rs,
crates/rh-parity/src/bin/parity_bench.rs (use step_into), one-line call sites elsewhere if an API changes.
Do: TickScratch buffers cleared not taken; action_order_into; inline InputQueue [ActionCmd; MAX_ACTIONS_PER_TICK]+len serialized
as a sequence; step_into(&mut Vec<Event>) (step() wraps); history ring (capacity const-asserted from MAX_REWIND_MS/TICK_MS,
serialized/hashed oldest-first); path cursor (serialize/hash path[cursor..], compact on replace); sort_unstable_by_key((rank,j));
Copy ledger/melee/payout entries without Strings, names resolved from an append-only Roster at result time (departed-shooter
fallback test with leave_mia); adopt find_path_into/ray_blocked/floor_i64 where bit-identical.
Proofs: dhat test: 0 allocations per steady-state step_into on crowded_8 inputs after warm-up; perfproof sim_crowded_8 allocs/step
<= 0.25; Ir/step vs 7d94332 crowded_8 <= 0.70x, duel_chase <= 0.62x (cumulative with P3); verify_replay; parity; fingerprints identical.
Inherited follow-ups: switch the inline epsilon sites (BARRIER_EPS, FACING_EPS, ARC_EPS, PATH_TIE_EPS, START_CENTER_SLACK) and the
duplicated SNAP_RADIUS/PULL_WINDOW/MASK_* declarations to the content registry names (crates/rh-sim/tests/content.rs keeps
passing either way); switch the sword stagger check to content::STAGGER_WEAPONS. Depends on P2b being merged.

## P5b: density benchmark + bounded telemetry (architect P5 part)
Scope: crates/rh-server/src/{room.rs (select, telemetry),metrics.rs (new),lib.rs (control health),bin/densitybench.rs (new)},
crates/rh-server/tests/density.rs (new).
Do: biased select with a pinned Sleep (a due step before queued commands; document C-TICK note); log-linear histograms replace
step_us (<= 1 KB per room); live process metrics on /control/health; densitybench: in-process, real Room/Outbox/Pacer, paused
tokio clock, N rooms x 8 humans as in-process clients draining outboxes (+ bots), deterministic; reports Ir per match-second,
notifies and writer wakes per human-tick, heap per room; a capacity estimate (matches per vCPU) clearly labelled.
Proofs: 3 callgrind runs within +-0.05%; telemetry <= 1 KB/room; tests green.
Inherited from the P5a-2 review: document why rh_server's NoDelay acceptor exists (its accept hook) instead of
axum_server::accept::NoDelayAcceptor; add a behavioural test for the ws() buffer settings (today only const asserts); the
/control listener (loopback) has no TCP_NODELAY (low value); densitybench should run the production path via
rh_server::serve_with (as examples/connheap.rs does).

## P7b: identity and data model (architect P7 steps 1,3,5)
Scope: crates/rh-sim/src/{store.rs,fighter.rs (new),state.rs,systems/*,sim.rs,hash.rs (paths only),observe.rs (paths)},
crates/rh-sim/Cargo.toml (feature bench), crates/rh-headless/Cargo.toml (feature bench), crates/rh-headless/src/bin/scalebench.rs,
one-line call sites in rh-policy/rh-server/rh-parity.
Do: EntityId (PlayerId alias) + Store<T> in id order (binary-search get, legacy iteration order); dense per-slot ranks and
bounty-at-start; O(1)/O(log n) idx/rank_of/owed_bounty/victims; FighterCore {body, vitals, weapon, motion, inputs} + seat +
credit + fate; FighterRef; scalebench N=8/32/128/212 per step and per fighter, plus observe/publish scaling at 204/1000
synthetic actors (bench feature constructor; MAX_PLAYERS stays in the real API).
Proofs: lookup scaling <= 1.3x growth N=32->212 per fighter; parity; verify_replay; fingerprints identical; no Ir regression.

## P5c: per-tick batched egress (architect P5 part)
Scope: crates/rh-server/src/{outbox.rs,conn.rs,room.rs (publish only)}, tests.
Do: one Outbox push + one notify per client per tick; writer drains in priority order, flushes once per wake under one timeout;
reader liveness via last-seen timestamp + coarse timer. Counting-Sink unit test: exactly one flush per wake, byte-identical frames
in the old order. densitybench notifies per human-tick = 1.
Proofs: those; live tests (drain, resume, liveness, rate limit, slow client) green; browser proof PASS.
Inherited from the P5a-2 review: WS_MAX_WRITE_BUFFER is 16 KiB + 2 x MAX_SERVER_FRAME; a batched flush must keep its feed
total under it (or raise it deliberately).

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
docs/CONTRACTS.md (C-TICK executable schedule, C-NET protocol v2, C-DET checkpoint/hash, C-OBS event visibility; status
table), docs/MIGRATION.md (benchmarks and results, the sweep record), ADRs, and a CI job that runs perfproof against the
PR merge-base with `--max-ir-ratio` and the allocation gate (valgrind is available on the ubuntu runners).
