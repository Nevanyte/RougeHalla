# Bounded Plague implementation validation

The production slice and its captures are frozen for independent review, not yet accepted for integration.

Version scope: checkpoint 11, replay 9, observation 8, policy 5; protocol 5 is unchanged. Default faction mode is Off. The explicit Holy and Holy+Plague modes name partial player-only installations. Full Fire/Plague captures remain capture-only. Unity, auxiliary faction producers, cards, AP, mobs and training producers are not added.

Source checks:

- Four new installed-source gameplay traces match all compared fields: threshold/swap/windows, fractional wand pause, multiple sources/barriers/lethal, and departure/early-end. All 449 ticks restore and continue exactly.
- The original 72 canonical capture files are unchanged. Both Linux x64 Node22 recaptures match the complete 76-file inventory after removing only `legacyRevision` (75 JSON files in `parity/fixtures`, plus `parity/maps/seed1.map.json`).
- Pinned host Node22 and the second Linux run reproduce both standalone proofs byte-for-byte. The hidden-history proof uses remote bootstrap, retained memory OR current sight, and proves no getter/probe changed vision state. The twelve-case direct ledger matrix compares binary64 values without tolerance.
- Final parity report: 61 compared scenarios, 13 capture-only, 300 path queries; all match. Missing/extra diagnostics, raw amount, pause, bit, clock and installer/provenance mutations are rejected.

Rust checks (target directory `PREFIX/plague-target`):

- `cargo test -p rh-sim`: 234 checks passed in the broad run. Subsequent added exact/terminal/hash regressions passed in focused reruns.
- `cargo test -p rh-policy -p rh-headless -p rh-parity`: 81 checks passed; the two subsequently added Plague fixture tests passed separately.
- `cargo test -p rh-server --lib`: 56 passed.
- `cargo test -p rh-server --test publish --test equivalence --test live`: 20 passed.
- `cargo test -p rh-sim --lib fx_projector`: 11 passed; includes exact arithmetic boundaries, anonymous source permutation, duplicate/gap/session behavior, caller prefix injection, empty/ended reports, reset/clone/restore identity, and checked delivery.
- `cargo test -p rh-policy temporal_tests`: binding before the first owned step, idempotent feeds, empty ticks, independent async feed, no granted actor targets, one-time binding and failed-feed queue clearing passed.
- `cargo test -p rh-sim --test plague --test hash_coverage`: 8 passed. Real paired projection, dead-viewer/fresh-session behavior, private checkpoint continuation/corruption and generic leaf coverage pass; no unhashed leaves or ignored optional authoritative state.
- `cargo test -p rh-sim --test no_alloc -- --nocapture`: zero allocations in each of 110 measured steps of `plague_thresholds_swap` and `plague_wand_pause`. Forty initial steps are warm-up. Every player's projection feed is inside the measured region. The generic test excludes steps emitting Result/Victory; these two captures have no terminal results. This is steady-step evidence, not a whole-fixture or full-game benchmark.
- `cargo clippy -p rh-sim -p rh-policy -p rh-headless -p rh-parity -p rh-server --all-targets --all-features -- -D warnings`: passed.

Logs are `/tmp/rh-plague-{simgate,adapters2,serverlib2,serveradapters,continuation}.log` and `/tmp/rh-plague-final-{projection,policy,state2,noalloc,parity,clippy}.log`. Linux output is `/tmp/rh-plague-linux2`; pinned-host output is `/tmp/rh-plague-host`. The parent separately verified exact addition with 540 independent Fraction-derived cases; production arithmetic has not changed since that check.

Intentional public correction: source-ordered private chunks retain legacy totals/order/first weapon. Public contributions are filtered at their settled tick; identity is redacted before public keys and order, hidden weapons are suppressed, and exact nonnegative addition rounds once. Report identities, frozen visibility and projectors are derived state outside World/checkpoints/hash. Late attachment/reconnect/restore grants no previous window. Stateless previews omit private delayed aggregates. Public events are bound to instance/viewer/tick before canonical adapter enqueue. Adapters retain at most 256 newest events between deliveries, as the existing policy contract does. Bounds beyond eight players/sixteen contribution rows fail explicitly.

Independent review and the parent's combined all-feature/PG gate remain required before commit.

## Independent review correction: stale async reply

The first frozen combined gate passed, but independent review reproduced a session-boundary bug: an async worker's pending tick-1 reply survived a ForeignInstance projection fault, and could submit its move on foreign tick 2 before the next decision tick (101). This is corrected in `rh-policy` only. Projection failure clears pending authority; `poll` returns typed `OfferError::FxProjection` before any observation/fallback/submission, and rejects arriving worker responses. Response acceptance also requires no policy fault. The first projection fault stays sticky, so a new simulation session needs a new worker seat.

A real worker handshake regression holds the decision until after the foreign-instance failure, releases the late Move, and proves no input hash change or subsequent movement. It also proves unchanged cadence and a successful real response from a newly bound seat. No sleeps or injected response queue are used. All seven policy tests pass with default and all features, including the pre-existing late/panic/fallback and actual-delivery cases. `cargo clippy -p rh-policy --all-targets --all-features -- -D warnings` passes. Logs: `/tmp/rh-plague-async-{fix,features,clippy2,headless}.log`. The README's interim wire boundary now says “implemented and verified”; no new authorization requirement is implied.

The updated frozen manifest is `/tmp/rh-plague-frozen-manifest.json`; the preceding one is retained as `/tmp/rh-plague-frozen-manifest.pre-async-fix.json`. Independent review and the parent's post-fix combined gate still govern integration.
