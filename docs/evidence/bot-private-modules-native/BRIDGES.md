# Root-leased shared-engine bridges — what was actually applied

Authority: Root corrected bridge allocation, committed at `de908f2b`
(`docs/backlog/packets/P-BOT-MODULES-1.md` § "Root corrected bridge allocation" and
`docs/evidence/bot-module-bridge-review/README.md`), read before implementation via `git show`.
The original proposal ([bridge-proposal.md](bridge-proposal.md) rev 2) is **not** approved verbatim; this document
records exactly what the lease authorized and what landed. No temporary mirrored engine survives: every source module
and its old public wrapper share one implementation of the leased transitions.

## Existing-file changes (only these five files)

| File | Change | Lease |
|---|---|---|
| `bots/temporal_percept.rs` | `+mod modules;` (one line) | dispatched line only |
| `bots/temporal_percept/strategy.rs` | `mod types;` → `pub(super) mod types;` | dispatched line only |
| `bots/planning.rs` | shared plan transition core + f64 source deal/index adapter; public `PlanModule` is a thin adapter over it | Root corrected lease: LEARN visibility, raw finite-f64 `SourcePlanDeal`, f64 source array-index score adapter, shared schedule/learned-bias/choice helpers, existing plan transitions extracted into one private core consumed by old wrapper + source module |
| `bots/wish.rs` | **361-line net reduction**: one shared cast-policy + availability/retry/slip transition core moved to new `bots/wish/source_core.rs`; public `WishModule`/`decide_cast*` are adapters over it | Root corrected lease: source-shaped borrowed ability/rank/context adapter, shared cast-policy/availability/retry/slip core, old public behavior retained via compatibility adapter, no rh-sim edit, rank f64 |
| `bots/hazards.rs` | **220-line net reduction**: classification/search/step/hold/expiry/arrival/throttle/light/adjust moved to new `bots/hazards/source_core.rs`; public `Hazards`/`burns`/`bad` are adapters over it | Root corrected lease: factor existing machinery into one private fact/service-based core; both old Observation wrapper and source module use it |

New helper files are exactly the optional ones the lease permits: `bots/planning.rs` has no helper file (core lives in
the existing file), `bots/wish/source_core.rs` and `bots/hazards/source_core.rs` exist with `mod source_core;` in their
leased files. No `types.rs`, rh-sim, World/Sim, observation/protocol, Cargo/dependency or identity edits.

## Planning core (applied)

- `pub(crate) const LEARN_WEIGHT/LEARN_CAP` (source types.ts) and `LearnedBiasView`/`learned_bias_of` apply the exact
  source `biasOf` sanitize/clamp once.
- `SourcePlanDeal { ends_at, spawns:[f64;2], taken:[bool;2], pick:f64, boons:Vec<String>, boon:f64 }` is the raw
  readDeal shape; the source adapter (`modules/planning.rs`) performs the source event-order/readDeal coercion and the
  schedule is anchored on the event `t`.
- `plan_spawn_score_raw(map, index:f64, …)`: JS array-index semantics — nonnegative integral finite index (with `-0`
  resolving 0) inside the pool resolves an entry; negative/fractional/out-of-range/nonfinite resolves **no entry and
  -Infinity**, never an i32 truncation. The old i32 `plan_spawn_score` delegates to it unchanged.
- One shared transition core (`PlanDealView` + `source_observe`/`source_intents`/`source_choose_spawn`/
  `source_choose_boon`): first-deal latch/schedule (schedule tables indexed by `TierId`, per the review correction),
  phase/no-deal/read/last-call/ask/resend/settle/ready transitions, `reaction.mu`/`softmaxT`/`lapseP` from the full
  declared `TierParams`, draw order via declared decide/lapse closures. `PlanModule` adapts typed `PlanDeal` into the
  same core; `planning_parity_tests`/`bot-planning.json` unchanged.

## Wish core (applied)

- `bots/wish/source_core.rs`: one `SourceAbility`/`SourceRank`/`SourceCastSituation` cast policy (`decide_cast`,
  `rank_of` f64 floor/nonfinite→1/clamp, `hides_caster`), exact source landing through the existing fixed-distance
  `rh_sim::abilities::blink::landing(open_map, real collision map, ring, gates_locked, from, toward)` — **no rh-sim
  edit was made**; the finite profile admits the five actual built-in definitions plus captured guard cases and refuses
  `dir`/unknown tags/unknown effect members/absent consumed rank fields/any blink distances other than Blaze's `(300, 64)`
  before mutation, never substituting a catalog row.
- One `WishStateCore` transition machine (availability edge/Easy remember draw/retry/armed/slipping/slip leg), shared by
  the source adapter and legacy `WishModule`. Legacy-only fields are documented in code/COMPAT below.
- `modules/wishes.rs`: complete source Wishes module from declared percept + admitted Memory: `lastHitAt`/fighter
  `hitMeAt` for recently-hit/chasing, real `Memory.noteSent` lastCast for sent slip grace, ordered CAST_STIMULI timing,
  unit target/at/snapRadius only when the rank supplies it, exact priorities/why/statuses, real open map + `ctx.collision`
  view (current gate state) + real gate flag, per-cfg state.

## Wish legacy-adapter incompatibilities (field + counterexample, as required)

The review allows a precise incompatible legacy field instead of forcing identical behavior. The one behavioral delta is
source-exact by design; every other difference is an input seam, not a second engine:

1. sent-cast clock: source `Memory.self.lastCast` (`cast` type, `at >= armedAt`); legacy infers it when the casting bit is
   first observed (`sent_at`) and clears it on expiry — `slipping_source` vs `slipping_legacy` in one core.
2. expiry retention: source clears only `armedAt` and retains `from`/`leg` (corpus pending-expiry→later-hidden); legacy
   clears the inferred clock plus from/leg (`clear_on_expiry` pin flag).
3. arm with null enemy: source retains previous `from`; legacy overwrote it.
4. hypotenuse leaf: source uses JS `Math.hypot` (`HypotMode::Js`); legacy keeps admitted `rh_sim::math::hypot`
   (`HypotMode::Legacy`) bit-for-bit.
5. rank domain: legacy public `WishView.rank` is u8 (widened to f64 at the core); source passes f64 unchanged.
6. landing inputs: legacy static fair view passes open/open/unlocked and “visible⇒LOS”; source passes the real
   collision view, gate flag, percept LOS/targetable.
7. **Behavioral correction (source-exact, field + counterexample):** source `abilityPolicy.engage` for a unit rule does
   not consult `rule.los`; it requires the foe’s own `los`. The old code had `if (los && !f.los)`. For the five shipped
   Wish rows (`los=true`) and every old fixture/corpus case the outputs are identical (all `wish_parity`,
   `wish_module`, `bot-wish.json`, `bot-core` filters pass unchanged). Counterexample: an externally constructed custom
   `WishDef` with `TargetRule::Unit { los: false }` + `FoeView.los = false` would have cast under the old behavior and
   does not now; source-exact behavior is authoritative per the corrected lease.

## Hazards core (applied)

- One private fact/service core (`bots/hazards/source_core.rs`): explicit declared-terrain classification
  (`burns/bad/clean(map, terrain, faction:Option<FactionId>, at)`) so the seven source hand-built arenas need no
  invented map layers; unknown/empty faction has no home exception and no fabricated faction; parameterized
  `nearest_tile(map, terrain, around, from, tiles, faction, tests:[Clean|NotBad], accept, dist)` preserving JS stable
  dy/dx candidate order, nearest-from sorting and ordered test passes; the complete step/hold/expiry/arrival/throttle/
  light/adjust transitions.
- Old public `Hazards` (Observation wrapper) and `modules/hazards.rs` both call the same core; `burns`/`bad` public
  functions keep their FactionId signatures/behavior; `hazards/tests.rs` and `bot-hazards.json` unchanged.
- Callback timing preserved exactly: guards and retained step occur before `paths.collisionMap()`; intents then calls it
  once; step-off `accept` is the real `paths.clear`; light search calls clear only at the source point; adjust calls
  collisionMap once even for empty/unchanged lists and never calls clear; unchanged list returns borrowed identity.

## Public behavior preserved

`planning_parity_tests` 6/6, `wish_parity_tests` 6/6, `wish_module_tests` 8/8, old hazards tests 4/4 (28 steps/20
adjusts/75 classifications of the unchanged `bot-hazards.json`), `bots::bot::` 17/17 hand/bot-core, admitted Memory
13/13, and the strategy/parity/knowledge/paths/view/mob-hunt filters all remain green — exact counts in
[OVERLAPS.md](OVERLAPS.md). No old expectation, fixture or golden was edited.

## No surviving mirrors

`rg 'ChestHunter::new|decide_cast_with|Hazards::intents|PlanModule::intents'`-level duplication was avoided: the source
modules call the same publicly exposed leaves/cores the old wrappers call; in particular chest-hunter/choice/chests,
planning, wish and hazard state machines each exist once. The only intentionally separate implementation is the
long-standing public `kite::away_point` leaf versus the source slip-step inside `wish/source_core.rs` (the source slip
core uses the same admitted `TURN/LENGTH` constants and clear-only search; the public `away_point` was outside the
leased wish seam and is untouched).
