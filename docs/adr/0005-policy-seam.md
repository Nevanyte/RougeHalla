# ADR 0005: One seat contract for humans, scripted bots and future learned policies

**Status:** Accepted (architecture only: no model, training, dataset or inference service exists or is planned in
Stage 1). **Decision.**
- A policy receives the immutable per-player `Observation` (projected through its reusable `ItemObserver`),
  may keep its own memory, and proposes `PublicCommand`s. It never sees `Sim`, secrets, RNG state, other players' inputs or
  privileged diagnostics.
- Proposals take the shared path: resolve public handles and `validate` → the seat's order budget (sim time) → the input queue (≤ 6 actions/tick).
  `rh_policy::drive_seats` is the one implementation, called by the live room and the headless runner alike.
- Each policy declares `decision_interval_ticks`; the cadence is enforced identically live and headless. Humans and bots
  need not sample at the same rate, but nobody gets extra actions per simulated second.
- Faults never stall a match: panic → fallback for the rest of the match; inline over-budget (live) → fallback; an
  `AsyncSeat` (thread + channel) answers by `deadline_ticks` or the fallback decides that turn.
- Contract version `POLICY_CONTRACT_VERSION` = 3; observation version `OBSERVATION_VERSION` = 4. Incompatible policies are
  refused at attach time (a typed `Fault` and the fallback plays; package L-sim). v2 replaces `reset(seed, me)` with
  `reset(&MatchStart)`: `MatchStart { me, seed, arena: Arc<Arena>, content_hash, observation_version, tick_ms }`, where `seed`
  is the policy's own public seed (never `Secrets`) and the arena is public static data (map and spawn points).
- v3 introduces typed observer-local pickup handles and a persistent private projector per synchronous, asynchronous
  or external seat. Only a delivered decision observation advances offers. Trusted replay/fixture commands remain
  separate; expired, unknown or hidden handles become normal budgeted pickup misses, never a raw-ID lookup fallback.
  Late worker answers are discarded before submission and worker panics trigger the declared fallback.
- Future learned policies attach to the LIVE Rust server through `AsyncSeat` (or a networked equivalent) with normal
  pacing and Unity rendering; batching and model hosting stay outside the deterministic rules. No Python gameplay server.

**Evidence.** `crates/rh-headless/tests/env.rs` (resets, terminal/truncation, panicking and flooding policies);
`crates/rh-server/tests/equivalence.rs` (a live match's bots re-decide identically headless); observation leak tests in
`crates/rh-sim/tests/observe.rs`. This is a tested slice, not a full-game training environment.
