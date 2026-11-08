# P-BOTS-1: the human-like bot brain's ported core on deterministic policy seats

Stacked PR: [#50](https://github.com/Nevanyte/RougeHalla/pull/50), `deepseek/p-bots-1` → `deepseek/p-cards-3` @
`9c2b97b9`; commits `4b6cc2d6`..`64b23ac1`. No wire/protocol change (protocol 7) and no dependency or `Cargo.lock` change.

Status: **this slice is DONE-VERIFIED; P-BOTS-1 (and the bot packet family) remains INCOMPLETE.** There is no packet file
for P-BOTS-1; the scope below was derived from the backlog row (`docs/backlog/README.md` line 157), the legacy sources it
names (`packages/server/src/bots/brain/*`, `humanizer.ts`, `clicks.ts`, `tactics/`) and `docs/BOTS.md` before writing.

## Assessment before writing (code + git)

The base already had the policy seam the packet depends on: `rh-policy`'s contract (`Policy`/`Seat`/`drive_seats`/`
`submit_all`, cadence, faults, fallback, `AsyncSeat`), the scripted `Brawler`/`Idle` policies, and the headless
`Env`/`Agent::Policy` runner. What did not exist was the legacy human-like brain itself (`scripted.rs` says so
explicitly). The legacy family is ~10,700 lines: `brain/{types,perception,frames,memory,strategy,tactics,humanizer,clicks,
runner,random,knowledge,services,vision,buildRoute,tactics/*,modules/*}` plus `mobHunt/chestHunt/BotManager/learning/
tournament`. Porting it all in one slice is not honest scope, so this branch ports the **deterministic human-likeness
core** (the part whose exact numbers `docs/BOTS.md` 2.2-2.5 pins and the packet's "cadence" names) with a pinned-container
source witness, and adds the fair observation-only seat that plays through it.

## What changed

New `crates/rh-policy/src/bots/` (all `rh-sim` types only; no new dependency, **`Cargo.lock` untouched**):

- `types.rs`: the legacy contract subset as plain data — `TIERS` (easy/normal/hard, every field of `TierParams`),
  `PERSONAS` (farmer/hunter/opportunist/cautious), `BOT_VIEW`/`HP_QUANT`/minimap/`TARGET_SNAP_RADIUS` and the shared
  `WORLD_W/H` bounds, `HUMANIZER_RULES`, priorities, and the `Stimulus`/`Intent`/`Command`/`TimedCommand`/`Percept` shapes.
- `random.rs`: the shared mulberry32 stream and `uniform`/`chance`/`gaussian` (Box-Muller)/`exponential`/`exGaussian`
  (floor retry + cap)/`softmaxIndex`/`pickOption` (lapse top-three). No platform math: a deterministic Newton `ln` over
  `rh_sim::math`'s forked `exp` keeps a policy stream identical on every declared target (ADR 0007; `f64::ln` is a
  clippy-banned call in this crate).
- `clicks.rs`: the client picker port (`pickTarget` ties/misses), `lockCandidates` (gated dodge of mobs), window
  in/clamp, `edgeToward`, `groundSigma`, `groundClick` (wall retries), `moveClick` (ground/edge/minimap) and `lockClick`
  (hand lag, slip flicks, picker result), over the match's public collision layer.
- `humanizer.rs`: the source humanizer — reaction ex-Gaussians with the attention periphery/engaged/reading multipliers,
  the refractory gap, one-pause hesitation, per-channel pending intents with priority arbitration, steps and timed
  rhythms, the APM token bucket and starvation, dedupe, the lock re-send rule, `alreadyLocked` self-lag, click misses and
  the complete stats counters.
- `perception.rs`: a fair view built **only** from the per-player `Observation` (C-OBS) plus the public static map:
  self view, on-screen actors (players vs NPCs, hp bars, in-hand weapon), velocities from earlier observations, visible
  props as containers, reward chests. No `World`, no hidden field, no secret; ids are rendered keys resolved back to
  public actor ids for commands.
- `bot.rs`: `HumanBot` — a `Policy` whose decision front end is bounded (engage the nearest visible enemy, approach, farm
  the nearest mob, roam a fresh point) and whose **hand** is the ported humanizer; three independent streams
  (`motor`/`lapse`/`decide`) seeded from `MatchStart.seed`. `assign_seats` draws the tier (30/45/25) and persona (uniform)
  mixes deterministically.

New `crates/rh-headless/tests/bots.rs`: eight `HumanBot` seats on the real `Env`, a byte-identical replay across two
runs, no policy faults, real proposed/accepted commands and hits, a different seat seed playing differently, and a
decision-purity test (identical delivered observations decide identically from an observation stream alone).

New `tools/bot-fixtures/` + `parity/policy/bot-core.json`: the pinned `node:22.23.4-bookworm-slim` linux/amd64 capture
of the **unchanged** legacy `types/random/clicks/humanizer` modules over declared inputs (see the tool README), plus six
committed mutants and `run-mutants.sh`. The native `parity_tests.rs` reproduces the corpus: tables field for field, the
map solidity samples, every distribution draw, all 27 click cases, and all 27 humanizer cases / 1,860 frames / 47 commands
plus misses and the final stats.

## Measurements (this branch, base `9c2b97b9`)

- `cargo test -p rh-policy bot_core`: **5 passed, 0 failed** (tables, map solidity, distributions, clicks, humanizer).
- `cargo test -p rh-headless --test bots`: **3 passed, 0 failed** (deterministic replay, observation purity, seat mix).
- `bash tools/bot-fixtures/run-mutants.sh`: **6/6 mutants killed; unchanged control passes**.
- `bash tools/bot-fixtures/capture.sh --check`: **PASS**, byte-identical in the pinned container.
- `cargo fmt --all --check`, both strict Clippy modes
  (`cargo clippy --workspace --all-targets --all-features -- -D warnings` and `... --all-targets -- -D warnings`) and
  `eval "$(bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked`: **1,446 passed, 0 failed,
  152 test-result groups, exit 0**.

## Still missing (P-BOTS-1 stays INCOMPLETE)

- **The rest of the legacy brain**: `perception.ts` (camera window at `viewT` with the 100/30 ms driver delays, the
  minimap dot ring at its 10 Hz refresh, fx decoding/visibility masking, effect filtering), `frames.ts` (the delay ring),
  `memory.ts` (opponent/mob/camp/container memory and the stimulus finder), `strategy.ts` (goal scoring/appraisal/
  softmax/keep-or-switch), `tactics.ts` + `tactics/{fight,kite,world}`, `knowledge.ts`, `buildRoute.ts`, and the
  `services.ts` path budget/cache. This slice's seat has only the bounded front end above; it is not the full brain.
- **Feature modules** (`modules/{wishes,planning,chests,hazards}`, `abilityPolicy.ts`) are P-BOTS-2/P-BOTS-3 and are
  absent; `mobHunt`/`chestHunt`/build routing is P-BOTS-4.
- **In-process driver human-likeness**: the legacy fill driver delays perception (world 130 ms, self 30 ms) and commands
  (30 ± 8 ms) so in-process bots are as stale as a client. A policy seat currently decides on the delivered observation
  with no artificial delay; this is an owner decision (the contract gives policies exactly the client's observation) and
  is documented rather than silently approximated.
- **Fill/anti-farming/UI** (`BotManager`, `BOTS_FILL_TO`, persona mix, callsigns, yield seat) is P-BOTS-7; the learning
  store is P-BOTS-5 and the tournament runner P-BOTS-6. This branch adds no persistence, network driver or wire fact.
- **Fairness/perception test corpus**: the legacy suite's proxy-based field-allowlist test, window-edge parity, encoder/
  decoder percept parity and the 200-state metamorphic fairness test are not ported. This slice proves the architectural
  side (a decision takes only `Observation`, replay is byte-identical) and pins the hand; the full fairness corpus stays.
- **Performance gate**: the brain's 8-bot CPU budget (mean ≤ 1.5 ms, p99 ≤ 6 ms) and the path-budget/cache are not
  measured or ported; no perf claim is made.

## Commands

```sh
cargo test -p rh-policy bot_core
cargo test -p rh-headless --test bots
CARGO=$HOME/.codex/tools/rougehalla-stage2/cargo/bin/cargo bash tools/bot-fixtures/run-mutants.sh
bash tools/bot-fixtures/capture.sh --check
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
export PGBIN=/opt/homebrew/opt/postgresql@16/bin
eval "$(bash tools/pgtest/start.sh)" && cargo test --workspace --all-features --locked
```
