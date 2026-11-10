# P-BOT-MODULES-1 shared-engine bridge proposal (Root review required)

Status: proposal only. Author: DeepSeek (sole Rust implementation lane), 2026-11-10.
Base: `9f74ff3e` (`codex/deepseek-private-modules`, clean; admitted backend `dedb8658` + Root module dispatch).
Source authority: frozen `rh-bot-private-modules-source/1` at
`parity/policy/bot-private-modules/source.json` (12,755,158 B, SHA-256
`645e85f16adbea001f8d0e06a70b6e5d311864ed9691622c06b789c95578b012`, 255 cases / 3,259 operations) and the
admitted source candidate `d48b79bf` + independent review `63f6fda8`.

This document requests exact, minimal carves into the already-admitted shared engines so the complete private
source modules can share them instead of re-porting them. **No hunk below is applied yet.** The only two
existing-file edits made under the Root dispatch's explicit allocation are listed in section 1. All module
implementation work below proceeds in the new-file lease (`temporal_percept/modules/**`); where a requested
shared entry is not yet allocated, the new files use only already-public/`pub(crate)` leaves plus the small
interim mirrors recorded in section 5, which are deleted/replaced by these hunks when approved.

**Revision 2 (2026-11-10, Root review notes folded in; still no hunk applied):**
Root directed (a) no interim duplicated planning/Wish/hazard policy engines and no converting declared
definitions into a static catalog fallback — section 5 is withdrawn except for genuinely new-file work;
(b) `source_schedule` must consume the full `TierParams` rather than a `TierId` substitute; (c) a Wish blink may
not lose the rank's own `maxDist`/`minDist`, so section 3 now requests an exact-distance landing leaf in
`rh-sim` too; (d) the source-supported numeric `rank` must not be narrowed to `u8` (`rankOf` is
`floor(number)`, clamped after a non-finite → 1 sanitize); (e) the state-machine reuse boundary must be stated
explicitly. New-file work continues on ChestHunter, card choice, chests, registry and the strict
reader/trace/replay harness only; planning/Wish/hazard module adapters wait for the approved bridge.

## 1. Allocated existing-file hunks (dispatch already authorizes these two lines only)

1. `crates/rh-policy/src/bots/temporal_percept.rs`, after the current `mod memory;` (line 9), insert exactly:
   ```rust
   mod modules;
   ```
   No other change to that file.
2. `crates/rh-policy/src/bots/temporal_percept/strategy.rs`, replace the final `mod types;` (line 19) with
   ```rust
   pub(super) mod types;
   ```
   Same visibility class as the separately allocated Tactics lane; no other change.

`modules` consumers then reach the admitted private contracts through `super::strategy::types::{Goal, GoalKind,
GoalDecision, GoalState, GoalStatus, MemoryApi, KnowledgeApi, PathApi, LearnedBias, RngStream, lookup, ...}`.
Nothing in the private strategy engine or its state changes.

## 2. `crates/rh-policy/src/bots/planning.rs` (PlanModule and shared plan maths)

Verified current mismatch against `brain/modules/planning.ts`:

| Source behavior | Current engine | Consequence for the module layer |
|---|---|---|
| `observe` scans `ctx.p.events` in order for `private/plan`, runs `readDeal` coercions, schedules the **first** valid deal once using `event.t` (not `p.now`), then replaces `st.deal` with every later valid deal | `PlanModule::observe(now, Option<&PlanDeal>)` takes one already-narrowed `PlanDeal` parsed from the current `PlanningView` | ordered raw events, `event.t` vs `p.now`, malformed-but-source-valid payloads, and replacement order are not representable |
| `readDeal` keeps `spawns`/`pick`/`boon` as **binary64** (`typeof v === "number" ? v : -1`), taken flags literal-true, boon list strings only | `PlanDeal { spawns: [i32;2], pick: i8, boon: i8 }` truncates/narrows | fractional/large source indices and `-1` sentinels cannot be preserved |
| `biasOf` = `LEARN.weight * clamp(finite(b) ? b : 0, -LEARN.cap, LEARN.cap)` behind `cfg.learned.enabled`, calling the declared `learned.bias(key)` callback | `LEARN_WEIGHT`/`LEARN_CAP` and `PlanLearned::of` are private to this file | callback-driven bias cannot be reused |
| `schedule` draws `uniform(decide, rlo, rhi)` then `uniform(decide, slo, shi)` on a declared decide lane | the same body exists but only as `PlanModule::schedule(..., &mut Rng)` | draw source cannot be the module context’s recorded lane |
| `chooseSpawn`/`chooseBoon` use `planSpawnScore`/`PLAN_CAMPS` + bias + `pickOption(decide, lapse, utilities, softmaxT, lapseP)` | bodies private and typed to `&mut Rng` | same |

Proposed hunks (all additive; existing public `PlanModule`/`PlanDeal` methods delegate to them so old
`planning_parity_tests`/`bot-planning.json` behavior is byte-identical):

```rust
// planning.rs lines 27-29: expose the two source LEARN constants (only visibility change).
pub(crate) const LEARN_WEIGHT: f64 = 0.3;
pub(crate) const LEARN_CAP: f64 = 0.25;

// planning.rs after the PlanDeal impl (~line 605): the source readDeal shape, raw binary64 retained.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SourcePlanDeal {
    pub ends_at: f64,
    pub spawns: [f64; 2],   // source num(): typeof number else -1
    pub taken: [bool; 2],   // source: taken[k] === true
    pub pick: f64,          // source num()
    pub boons: Vec<String>, // source: array elements filtered to typeof string
    pub boon: f64,          // source num()
}

// planning.rs: source schedule formula over a declared draw stream (body of PlanModule::schedule).
pub(crate) fn source_schedule(
    now: f64, deal: &SourcePlanDeal, tier: &TierParams, decide: &mut dyn FnMut() -> f64,
) -> (f64 /*read_until*/, f64 /*settle_ms*/, f64 /*last_call*/);

// planning.rs: biasOf over a declared enabled+bias callback (source LEARN clamp, Number.isFinite sanitize).
pub(crate) fn source_learned_bias(enabled: bool, bias: &dyn Fn(&str) -> f64, key: &str) -> f64;

// planning.rs: chooseSpawn over raw SourcePlanDeal (the existing body, source free/one-free/no-faction branches,
// plan_spawn_score/PLAN_CAMPS, bias and pickOption draw order preserved).
pub(crate) fn source_choose_spawn(
    deal: &SourcePlanDeal, free: &[usize], map: &PlanMap, faction: Option<FactionId>,
    weapon: Option<WeaponId>, bias: &dyn Fn(&str) -> f64, params: &TierParams,
    decide: &mut dyn FnMut() -> f64, lapse: &mut dyn FnMut() -> f64,
) -> usize;

// planning.rs: chooseBoon over the first two declared boons (existing body).
pub(crate) fn source_choose_boon(
    deal: &SourcePlanDeal, faction: Option<FactionId>, bias: &dyn Fn(&str) -> f64,
    params: &TierParams, decide: &mut dyn FnMut() -> f64, lapse: &mut dyn FnMut() -> f64,
) -> usize;
```

`readDeal` itself stays in the module layer (`modules/planning.rs`), because it consumes the declared
`MethodValue` private message record, which lives under `temporal_percept` rather than under `bots::planning`.

Preservation tests: `cargo test -p rh-policy planning_parity` and the `bot-planning.json` filter exactly as today;
the new functions must reproduce `PlanModule::schedule/choose_spawn/choose_boon` bit-for-bit for the old typed input
(witness test added with the hunk), so the old public module output does not move.

## 3. `crates/rh-policy/src/bots/wish.rs` (pure cast policy, `abilityPolicy.ts`)

Verified current mismatch against `abilityPolicy.ts` + `brain/modules/wishes.ts`:

- `decide_cast_with` is generic in the tag list but typed to the static `WishDef` (`&'static` ai/blockedBy/effects).
  The source module consumes the **opaque declared `AbilityDef` object** from `extras.wish.def` (`defOf` guard:
  object, non-empty `ranks`, array `ai`, array `blockedBy`; then `rankOf` clamps and reads that rank’s
  `targeting`/`effects`/`castMs`). The declared def must be parsed by the module, not replaced by a catalog row.
- `landing()` hard-codes the open map, `gates_locked = false` and ignores the blink’s `maxDist`/`minDist`
  (`let _ = (max_dist, min_dist)`), where source `blinkLanding(map, gatesLocked, me, to, maxDist, minDist)`
  uses the gated collision map and the effect’s own distances (all five actual Wishes equal the sim leaf’s
  `BLAZE_RANGE`/`BLAZE_MIN_DIST`, so this is exact for the frozen profile but not a general contract).
- `CastSituation` carries `map`/`ring`/`gates_locked`; the module needs one source-shaped context that can hold
  the parsed def and the locked collision map.

Proposed hunks (additive source-shaped policy; the five-row public table and `decide_cast`/`WishModule` keep
their current behavior and fixtures; the existing private helpers are generalized with the static table providing
a trivial adapter):

```rust
// wish.rs: source-shaped def/rank views over an owned parsed AbilityDef (no 'static requirement).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SourceRank<'a> {
    pub cast_ms: f64,
    pub targeting: TargetRule,          // self | unit{range,los,snapRadius} | point{range,minRange}
    pub hides_caster: bool,             // an effect: status -> self, status "hidden"
    pub blink: Option<(f64, f64)>,      // effect: do "blink", maxDist, minDist
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SourceAbility<'a> {
    pub name: &'a str,
    pub ai: &'a [AiIntent],
    pub blocked_by: &'a [BlockedBy],
    pub ranks: &'a [SourceRank<'a>],    // source rankOf clamp: ranks[clamp(rank,1,len)-1]
}

// wish.rs: source rank clamp/hide predicates (rankOf, hidesCaster on arbitrary declared defs).
pub(crate) fn source_rank(def: &SourceAbility<'_>, rank: f64) -> &SourceRank<'_>;
pub(crate) fn source_hides_caster(def: &SourceAbility<'_>, rank: f64) -> bool;

// wish.rs: the source moment with the gated collision map and the effect-defined blink distances.
pub(crate) struct SourceCastSituation<'a> {
    pub me: MeView, pub foe: Option<FoeView>, pub threat: Option<ThreatView>,
    pub map: &'a TileMap,                       // open map (ring/region identity)
    pub collision: &'a TileMap,                 // map, or withGates(map) when gatesLocked
    pub ring: &'a blink::Ring,
    pub gates_locked: bool,
}

// wish.rs: exact source policy over the parsed def; first firing tag decides (escape/sustain/engage/control/peel;
// burst/zone/buff no-op), block bits and casting guard, unit/point/self results, and the exact source blink landing
// using the rank effect's own maxDist/minDist (section 3b).
pub(crate) fn source_decide_cast(
    def: &SourceAbility<'_>, rank: f64, s: &SourceCastSituation<'_>,
) -> Option<CastChoice>;
```

Implementation note: `source_decide_cast` is the shared body; `decide_cast_with` becomes a call with a view built
from the static `WishDef` (ai slice, blockedBy slice, one SourceRank from `rank.effects`), so the existing corpus
still pins exactly one code path. If Root prefers not to generalize the file, the alternative is to make
`WishRank.effects`/`WishDef.ai`/`blocked_by` owned `Vec`s (larger public-API churn; not recommended).

Preservation tests: `wish_parity`, `wish_module`, `bot-wish.json`, and `bot-core.json` filters unchanged; a new
witness asserts static `WISHES` → `SourceAbility` → `source_decide_cast` equals the old `decide_cast` for the five
rows and both Easy/non-Easy tag sets.

## 4. `crates/rh-policy/src/bots/hazards.rs` (risk classification + stable tile search)

Verified current mismatch against `brain/modules/hazards.ts`:

- Source `burns`/`bad`/`clean` take the fighter’s **faction string** (`surfaceAt(map,x,y,faction)`): `""`/unknown
  has no home rule. Rust `burns`/`bad` take `FactionId` (no unknown/no-faction representation) and would need a
  fabricated faction to call them from the module. Classification for a known faction is identical.
- Source `nearestTile(map, around, from, tiles, tests, accept)` is private to `hazards` and Rust’s `nearest_tile`
  hard-codes the two-pass `[clean, !bad]` order and an optional `require_clear`; the source `tests` list order and
  the `accept` callback (the real `paths.clear` call) must be preserved for `stepOff` and `adjust`.
- Source `adjust` calls `ctx.svc.paths.collisionMap()` even when no intent changes; the module layer needs the
  classification/search leaves parameterized by the actual collision map, not `Observation`.

Proposed hunks (additive; existing `Hazards`/`Context`/`burns`/`bad`/`adjust` behavior and `bot-hazards.json`
unchanged):

```rust
// hazards.rs: the source's faction-string surface predicates, with the unknown/no-faction case explicit.
pub(crate) fn source_burns(map: &TileMap, faction: Option<FactionId>, x: f64, y: f64) -> bool;
pub(crate) fn source_bad(map: &TileMap, faction: Option<FactionId>, x: f64, y: f64) -> bool;
pub(crate) fn source_clean(map: &TileMap, faction: Option<FactionId>, x: f64, y: f64) -> bool;

// hazards.rs: source nearestTile order (preference tests in given order, stable JS sort by distance from
// `from`, optional accept callback = the real paths.clear at that point).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceTileTest { Clean, NotBad }
pub(crate) fn source_nearest_tile(
    map: &TileMap, around: Vec2, from: Vec2, faction: Option<FactionId>, tiles: i64,
    tests: &[SourceTileTest], accept: &dyn Fn(Vec2) -> bool,
) -> Option<Vec2>;
```

The module layer keeps the state machine (`step`/`lastStepAt`, hold/arrive/expiry, light-only rules,
copy-on-first-redirect list identity and why suffix) in the new file; only these pure leaves move.

Preservation tests: `bot-hazards.json` + the existing hazards unit tests unchanged; new witnesses pin
`source_burns/bad == burns/bad` for all five known factions and the existing map fixtures.

## 5. Permitted new-file work while the bridge is reviewed (Root direction, revision 2)

**Withdrawn:** any interim duplication of planning/Wish/hazard policy engines and any fallback that converts a
declared `AbilityDef` into a static catalog row. Those three module adapters (`modules/planning.rs`,
`modules/wishes.rs`, `modules/hazards.rs`) are not started until Root's exact approved bridge response lands; the
corpus replay for their suites is marked blocked on that review, never skipped silently.

Permitted and in flight now, because none of it duplicates a bridged engine:

- `modules/chest_hunt.rs` — complete source `ChestHunter` (state, stalls, walks, done/tried, stats, log strings,
  decision, write-only private diagnostics for the replay).
- `modules/choice.rs` — complete source `costsSomething`/`activeWeapon`/`cardScore`/`optionScore`/`chooseOption`
  over the admitted static card/kill/boost format leaves (arbitrary unknown ids score 0; no catalog mutation).
- `modules/chests.rs` — complete source chests module state machine (per-cfg retained hunter, build merge/counted,
  readable/asks, panel close, pick retry/window, blind cards, goals/act/intents and source done/running reasons).
- `modules/registry.rs` — ordered registry, equal-id replacement in place, enabled filtering, reset, opaque
  cast-policy slot (Wishes is not routed through it; that code moves with the Wish adapter later).
- Private typed input layer + fixtures replay infrastructure: `modules/types.rs` (source-shaped private facts;
  parsed `AbilityDef` etc. retained losslessly, no catalog substitution), `modules/source_reader.rs` (tagged
  `rh-method-value/1` codec + duplicate-key raw parse), `modules/source_input.rs` (atomic typed case/config/map/
  percept/hunter/hook conversion), `modules/source_trace.rs` (ordered encode/compare + callback transcript),
  `modules/source_tests.rs` (replay harness and blocked-suite accounting).
- New-file witnesses: `blocks/` suites replayed for choice/hunter/chests/registry; exact numeric policy of
  section 6; reader-negative controls.

## 6. Numeric comparison and tolerance

Start every module comparison exact (binary64 bit equality, `-0`, `NaN`/`±Infinity` tag identity, ordered arrays,
`Undefined` vs `null` vs absent). The only review question is the existing admitted strategy precedent
`PATH_DIST_TOLERANCE = 2e-6` on the `paths.walk` distance leaf. The module corpus records `paths.walk` results
inside ordered callback transcripts; if the replay shows a real last-bit difference on that leaf only, this
proposal asks Root to reuse the already-admitted strategy whitelist for exactly that leaf (no timer, order,
choice, utility, status, string or RNG tolerance; no new breadth). Until said review, the harness compares exact
and reports the first raw difference rather than relaxing it.

## 7. Requested decision

Root: approve sections 2–4 as the allocated bridge hunks (they are additive, preserve every old public path, and
are pinned by the listed preservation filters), or direct an ordering/alternative. Until then the new-file lease
proceeds against the public leaves and section 5 seams so the complete module behavior, corpus replay, controls
and evidence can be built; the two allocated lines in section 1 are applied as part of that build.


## 3b. `crates/rh-sim/src/abilities/blink.rs` (exact-distance landing leaf; Root note c)

The shipped `blink::landing` hard-codes `MAX_DIST`/`MIN_DIST` (`BLAZE_RANGE`/`BLAZE_MIN_DIST`) and cannot be called
with a declared rank's own distances; silently keeping the BLAZE constants would drop source-supported declared
geometry. The source `blinkLanding(map, gatesLocked, from, toward, maxDist, minDist)` is otherwise exactly the
already-faithful leaf. Proposed minimal hunk (additive; the existing public `landing` delegates with the shipped
constants, so the abilities and P-ABIL parity paths are bit-identical):

```rust
// blink.rs: exact source landing with caller-supplied distances (the shipped five Wishes pass BLAZE_RANGE/BLAZE_MIN_DIST).
pub fn landing_with(
    map: &TileMap, cmap: &TileMap, ring: &Ring, locked: bool, from: Vec2, toward: Vec2,
    max_dist: f64, min_dist: f64,
) -> Option<Vec2>;
```

`landing_in` already receives all other inputs; the hunk adds two parameters to it and makes the existing
`landing` call `landing_with(..., MAX_DIST, MIN_DIST)`. Preservation: `cargo test -p rh-sim abilities` (blink
ring/landing source corpus) unchanged, plus the wish blink source cases.

## 3c. State-machine reuse boundary (Root note e)

Explicit boundary, so “reuse the engine” is not a blanket claim:

| Layer | Decision |
|---|---|
| Pure leaves with source-identical inputs: `planning::{PLAN_RULES, PLAN_CAMPS, PlanMap, plan_spawn_score, plan_pick}`, plan matchup/duel maths; `wish::{ESCAPE_*, SUSTAIN_HP, ENGAGE_*, PEEL_DISTANCE, EFFECT_*, TARGET_SNAP_RADIUS, AiIntent, BlockedBy, TargetRule, CastChoice, MeView/FoeView/ThreatView}`, the single cast-policy decision (through the hunk in section 3); `hazards::{STEP_EVERY_MS, STILL_MS, STEP_TILES, HOLD_MS, ARRIVE_U, REDIRECT_TILES, REDIRECT_MIN_U, LIGHT_TILES, burns, bad}`; `paths::RoomPathService` behind a new private trait; admitted `memory::Memory` and `Strategy` private memory/knowledge APIs; `random::Rng`; `kite::away_point`; sim static card/kill/augment/boost catalog and terrain/geometry leaves | **Reused via the hunks above or already-public APIs.** |
| Stateful public modules: `PlanModule`/`PlanState` (typed `PlanDeal`, narrowed `PlanningView` input, no event-time/callback/raw-binary64 contract), `WishModule`/`WishState` (inferred cast clock from observed casting bits, capped fighter-hit auxiliary list, static-map landing, no cfg-identity state), `Hazards` (its `Context` requires a public `Observation` and its adjust/step helpers are private and clock/one-map shaped; fabricating an Observation/actor identity is forbidden) | **Genuinely incompatible private context; NOT reused or re-implemented as a whole module.** The new `modules/**` files carry source-shaped state machines (state keyed by declared cfg object identity, source facts in, source intents/status out). Any behavior they share with those public modules is only the pure leaves in the row above. |
| Public Brain/bot, tactics, humanizer, hand, World/Sim/Observation, protocol | Outside this lease; untouched. |

## 3d. Preservation and numeric gates for the proposed hunks

Existing filters must stay green and unchanged: `cargo test -p rh-policy planning_parity`, `wish_parity`,
`wish_module`, `paths_parity`, `knowledge*`, `bot_hazards`/`bot_hazards` fixtures, `parity/policy/bot-*.json`
filters as currently wired, and `cargo test -p rh-sim abilities`. New witnesses pin old-static → new-shared entry
equivalence row by row. No tolerance is pre-approved: the module replay compares exact first, keeps the first raw
failure and its ancestry, and only after that reports the `paths.walk`-distance question of section 6 to Root.
