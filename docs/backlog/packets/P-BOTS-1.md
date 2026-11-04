# P-BOTS-1: the human-like bot brain on `rh-policy` seats

## ID and outcome
P-BOTS-1. A new crate (`crates/rh-bots`) implements the legacy human-like bot brain as `rh_policy::Policy` implementations:
perception from the `Observation` only, memory, strategy and tactics for the mechanics that exist at merge time, the humanizer
(reaction delays, misclicks, APM bucket), tiers (easy/normal/hard) and personas (farmer/hunter/opportunist/cautious), with
decision cadence declared in ticks. The live room's fill bots and the headless runner use it instead of `scripted::Brawler`.
Mechanic-specific modules (Wishes, chests, hazards, mob hunting, build routes) are P-BOTS-2..4 and arrive with their mechanics.

## Dependencies
None hard (works on the current slice: fists duels between players). It grows as P-COMBAT-*, P-MOBS-1 extend `Observation`
(each such packet bumps `OBSERVATION_VERSION`; this brain must tolerate additive fields). Soft: P-COMBAT-3 for a shared pure
`decide`/`lockSpacing` (`policies.rs`).

## Relevant legacy paths (verified)
- Design: `docs/BOTS.md` (sections 2 human-likeness and tier table, 3 perception contract, 4 layers, 5 personas, 8 feature seam; section 11 lists 32 owner questions), `docs/BOTS_TUNING.md` (96x96-era numbers; tier evidence).
- Code (about 8,700 lines in `packages/server/src/bots/`): `brain/types.ts` (contracts, `TIERS` l.125, `PERSONAS`), `brain/perception.ts` (the only schema reader), `vision.ts`, `frames.ts`, `memory.ts`, `knowledge.ts`, `strategy.ts`, `tactics.ts` + `tactics/` (fight, kite, flee, `inReach`), `humanizer.ts`, `clicks.ts`, `services.ts` (budgeted `PathService`), `brain.ts`, `runner.ts`, `random.ts`, `modules/` (`index.ts`, `wishes.ts`, `chests.ts`, `planning.ts`, `hazards.ts`); drivers `BotManager.ts` (in-process fill) and `BotClient.ts` (network); `callsigns.ts`; shared `policies.ts` (`decide`, `POLICIES`, `lockSpacing`).
- Tests (the fairness suite is the model): `packages/server/test/bots/` (`boundary`, `perception`, `fairness`, `humanizer`, `brain`, `tactics`, `strategy`, `memory`, `knowledge`, `clicks`, `services`, `tournament`, `botManager`).
- Rust seam: `crates/rh-policy/src/lib.rs` (`Policy`, `PolicySpec`, `Seat`, `AsyncSeat`, `drive_seats`), `scripted.rs` (`Idle`, `Brawler`, `Panicky`, `Slow`, `Flood` as templates), `crates/rh-sim/src/observe.rs` (`Observation`: `me: Option<SelfView>`, `visible: Vec<ActorView>`, `events: Vec<SeenEvent>`, `phase`, `tick`, `server_time`), `crates/rh-server/src/room.rs` l.370-395 (fill bots built with `Brawler` today), `crates/rh-server/src/director.rs` (`fill_bots_to`).

## New paths
`crates/rh-bots/{Cargo.toml,src/lib.rs,perception.rs,memory.rs,tactics.rs,strategy.rs,humanizer.rs,tiers.rs,personas.rs}`, `crates/rh-bots/tests/`;
workspace member in root `Cargo.toml`; selection hook in `rh-server` (policy name/tier/persona in `BotPolicy` and the replay `Join` record).

## Exclusive write scope
`crates/rh-bots/**`, root `Cargo.toml` (member), `crates/rh-policy/src/scripted.rs` (only to leave `Brawler` as the baseline), the bot
construction block of `crates/rh-server/src/room.rs`/`director.rs`, `crates/rh-headless` (runner wiring and tests), `docs/BOTS.md` (append a "Rust port" section). No edits to `rh-sim`.

## Contracts and references
C-POLICY / ADR 0005 (a policy sees only `Observation`, keeps its own memory and its own seeded randomness `reset(seed, me)`, proposes `RawCommand`s through `validate` + order budget + input queue, declares `decision_interval_ticks`), C-INPUT (no extra actions: the legacy humanizer's APM bucket maps to the seat's 30 burst / 15 per second budget; do not exceed it), C-OBS (no secrets; hp is a bar; others only in sight), C-DET (live and headless bots re-decide identically: no wall clock, no `HashMap` iteration order, no global RNG), `docs/CONTRACTS.md` C-POLICY. Architecture only for ML: no model, training or inference code here.

## Behaviour to preserve
- The brain is layered: perception -> memory/knowledge -> strategy (goal choice, slow cadence) -> tactics (fight, kite, flee, retreat) -> humanizer (delay line + noise) -> commands. Perception must run over `Observation` alone: port the legacy rule "never see what a player's screen could not show", with the difference below.
- **Fairness differs by design:** legacy bots saw a *screen window* (`BOT_VIEW`, minimap for the rest); the Rust observation is the sight circle (`VISION_RADIUS` 900 u, wall-blocked) a human client also gets. Adopt the observation as the whole truth and re-derive the attention parameters (`TierParams.attention`) as documented deviations; record them in `docs/BOTS.md`.
- Human-likeness: reaction time is an ex-Gaussian delay (Hard mean 200 ms, Normal 280, Easy 450; floors/caps in the tier table) applied as a **tick-quantised delay line** (50 ms ticks), a refractory gap between independent decisions (120/140/180 ms), thinking cadence (tactics every 150/200/300 ms, strategy 1200/1500/2000 ms mean), APM bucket (170/110/60 per minute, burst 5/4/3, min gap 80/110/160 ms), click scatter on move and target points, hesitation chance, softmax decisions with a lapse, dodge/juke/orb-walk probabilities by tier. Numbers are in `TIERS` and BOTS.md section 2.2: copy from code, not from this summary.
- Personas (BOTS.md section 5, `PERSONAS`): farmer/hunter/opportunist/cautious weights, fight-opening logits, flee/re-engage hp shares, kite multiplier, chase give-up, mob kill goal, card risk. Tier = execution, persona = preference; never multiply them (one coupling: orb-walk chance x persona kite).
- Hard rules of the legacy driver: a bot sends only what a human client sends (move, target, attack/release, swap, pickup, cast, plan, choose); never `aim` directly for a click; a bot's result never touches persistence; killing a bot pays no GV/bounty (already in `rh-sim`).
- Cadence: choose `decision_interval_ticks` per tier (suggest Hard 2, Normal 3, Easy 4; the legacy `thinkMs` is 150/200/300) and test that the declared cadence is what `drive_seats` enforces live and headless.
- Fill: `BOTS_FILL_TO` default 8, persona mix farmer 4 / hunter 1 / opportunist 2 / cautious 3 and tier mix 30/45/25 (`BOT_FILL_DEFAULTS` in `brain/types.ts` l.1245; BOTS.md section 5 still says "uniform", code wins), bots do not open/close lobbies (already enforced in `rh-sim`).
- Current slice reality: only fists duels exist, so only the player-vs-player fight/flee/wander logic is testable now. Keep module registries (like legacy `modules/index.ts` + `detectFeatures`) so later mechanics plug in without editing the core.

## Acceptance checks
1. `cargo test -p rh-bots`: unit tests per layer plus a **fairness suite** modelled on `fairness.test.ts`: perturb hidden information (everything not in `Observation`, e.g. players out of sight, secrets, other seats' inputs) and assert identical commands; assert no command exceeds the seat budget; assert the delay-line quantisation.
2. Determinism: same seed + same observations -> same commands; a live recorded match with these bots replays headless with identical state hashes (extend `crates/rh-server/tests/equivalence.rs` pattern).
3. Strength sanity (not a balance claim): in `rh-headless`, per-tier win rates over >= 400 games of fists duels show Hard > Normal > Easy with 95% Wilson intervals reported (port the `npm run tournament` summary format); record numbers in the hand-off.
4. A policy panic/over-budget falls back to `Idle` without stalling (existing seat tests still pass).
5. Per-decision CPU cost p99 recorded (legacy gate: bots' share avg < 1.5 ms, p99 < 6 ms for 8 bots per tick in `bench/stepBench.ts --bots 8`).

## Validation commands
`cargo test -p rh-bots` (to be created by this packet), `cargo test -p rh-policy`, `cargo test -p rh-headless`, `cargo test -p rh-server`,
`cargo test --workspace`, `cargo clippy --workspace --all-targets`; legacy reference only: `npm run tournament -- --games 400 --lineup E,E,N,N,H,H` (needs the legacy workspace deps).

## Risk and suggested model tier
Medium-high: large but not rule-bearing (it cannot change outcomes), so correctness risk is fairness/determinism and cost. Strong
builder, high effort for the perception/fairness boundary; medium for tiers/personas tables. Do not tune; port the numbers.

## Known traps
- New crate = a `Cargo.lock` change: per `AGENTS.md` only the coordinator edits `Cargo.lock`; list the new dependencies in the hand-off.
- Bots must not read `Sim`; `drive_seats` hands only the `Observation`. Keep `rh-bots` dependent on `rh-sim` types for `Observation`/`RawCommand` only.
- Anything keyed by wall-clock (legacy `Date.now`/`performance.now`) becomes `obs.server_time` or tick counts.
- Legacy used a seeded stream per bot (`brain/random.ts`); use the policy's own seed from `reset`, never a match secret (`Secrets`).
- Do not let policies learn from other seats' inputs or from `Sim` diagnostics (ADR 0005); the legacy learning store (P-BOTS-5) is cross-match and off-tick.
- Unity/browser: bots run server-side only; nothing here ships to the client.
- The legacy tier tables are documented as 96x96-era (BOTS_TUNING); they are a starting point, not a parity target (bots have no deterministic legacy fixtures).
