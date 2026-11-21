# P-SIM-BENCH-SEAM-1: trusted build setup for headless benches (feature-gated)

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 13, under the owner approval of 2026-11-18 (elite and augment rework,
  `docs/OWNER_DECISIONS.md` row 10; plan of record `docs/backlog/AUGMENT_ELITE_REWORK.md`, packets table and decision 8)
- **Implementer tier:** implementer-opus
- **Reviewer:** reviewer-opus (an `rh-sim` state API: it writes a fighter's build, folds and max hp outside a step)
- **Integration base:** `feature/unity-rework`
- **D-rules touched:** D1 loose proof (owner direction 2026-11-10; no capture: the seam has no legacy counterpart, its
  grant rules mirror legacy `grantCard`) · D2 n/a · D5/D6/D9 none (no gameplay rule, no wire, no client)

## 1. ID and outcome

The elite rework must measure how often an average minute-5 build dies fighting an elite alone (decision 8), and the
camp bench (`crates/rh-headless/src/bin/camp_bench.rs`) can only place a fighter with a faction and weapons
(`Placement`, `crates/rh-sim/src/sim.rs:70-83`; the fight runs through `Env::from_external_checkpoint`,
`camp_bench.rs:301`). `cards::grant` is `pub(crate)` (`crates/rh-sim/src/cards/mod.rs:370`). When this packet lands,
`rh-sim` has a cargo feature `trusted-build-setup` and, only under it, a module `rh_sim::trusted_build` whose one call
gives a seated fighter cards, normal-mob stat stacks and chest stat boosts between steps, through the same steps a
chest pick and a credited kill use (count, re-fold, max hp follows). The resulting world steps, observes, checkpoints,
restores (`check_world` accepts it) and hashes like any other. Without the feature the module does not exist.
`P-ELITE-BENCH-1` uses it; this packet does not touch the bench.

## 2. Dependencies

- None to start: the oracle is cut from `feature/unity-rework` before `P-AUG-RULES-1` lands. The plan lists RULES-1 as a
  dependency because both packets edit `crates/rh-sim/src/lib.rs`; here the one `lib.rs` line is already in the stub
  commit, so the implementer never edits `lib.rs` and the coordinator merges that one line (see 11).
- The functions the module calls are not changed by RULES-1's branch (`agent/opus/P-AUG-RULES-1`: no change to
  `modifiers::recompute`, `sync_max_hp`, `Build::add/set`, `Farm::set`). Under RULES-1 the re-fold reads the match's
  tuning table from `MatchStatic`, so a Rework world gets the Rework numbers with no change here.

## 3. Relevant legacy paths

The seam itself has no legacy counterpart (legacy benches set state directly). Its grant rules are legacy's:
- `packages/server/src/sim/chests.ts:184-196` `grantCard`: refuses an unknown id, a unique card already held and a
  conditional without a card of its base (`cardBlock`); else count + 1 (at most 255), `recomputeMods`, `syncMaxHp`.
  Native: `crates/rh-sim/src/cards/mod.rs:370-382` (`grant`), the pick checks at
  `crates/rh-sim/src/reward_chests/mod.rs:301-309` (`Owned`, `Needs`).
- `packages/server/src/sim/training.ts:153-174` `trainCard` and `:127-140` `trainStat` (the practice console: set a
  count, re-fold, `syncMaxHp`). Native: `crates/rh-sim/src/systems/training/console.rs:73-157`.
- Chest boosts: native `crates/rh-sim/src/reward_chests/mod.rs:216-226` `grant_boost` (refused at
  `chest_boost_max_picks`, 3, `crates/rh-sim/src/stat_fold/definition.rs:58`).
- Mob stat stacks: native `crates/rh-sim/src/modifiers/farm.rs:173-194` `grant_mob_stat` (normal types only, total at
  most `DEFINITION.max_count`; a standing fighter only), legacy `mobStatReward` (`training.ts:128`).
- Max hp: `crates/rh-sim/src/modifiers/mod.rs:553-563` `sync_max_hp`: a rise in max hp raises current hp by the same
  amount, so a full-health fighter stays full.

Doubts (flagged, pinned as legacy): Tank Engine's max-hp bonus is earned by blocking (`card_tank_hp`,
`cards/mod.rs:465-472`), so granting it raises no max hp at setup. Base cards (`Ad1`..`Fleet3`) have no live grant path
(chests offer interactive augments only, `reward_chests/mod.rs:107`), but legacy `grantCard` accepts them, so the seam
does too: they are the only way to unlock a conditional.

## 4. New paths

- `crates/rh-sim/src/trusted_build.rs` (stub in the stub commit; the implementer replaces the body of `apply`).
- `crates/rh-sim/tests/trusted_build.rs` (oracle).
- `crates/rh-sim/tests/trusted_build_feature_guard.rs` (oracle).

## 5. Exclusive write scope

- `crates/rh-sim/src/trusted_build.rs`, nothing else.
- Already done in the stub commit, and not to be edited again: the `[features]` lines of `crates/rh-sim/Cargo.toml`
  and the `#[cfg(feature = "trusted-build-setup")] pub mod trusted_build;` line of `crates/rh-sim/src/lib.rs`. If the
  implementation needs a change to either, stop and report.
- Not in scope: any other `rh-sim` file (P-AUG-RULES-1 edits statics, cards, modifiers, checkpoint, state, mob runtime
  in parallel), any other crate, `Cargo.lock`, `scripts/gate.sh`, CI.

## 6. Contracts and references

- C-INPUT: the seam is not an input path. It is a trusted constructor-time tool like `Placement` and `Sim::synthetic`
  (`sim.rs:192-202`, feature `bench`): no `RawCommand`, no `validate` arm, never reachable from a socket.
- C-RNG / C-DET: no RNG draw, no event, no clock read; the same request on the same world gives the same state hash.
- C-OBS: nothing new is observed; the fighter's build is visible exactly as a picked build is.
- Checkpoint: `check_world` (`crates/rh-sim/src/checkpoint.rs:346`, the fold rule at `:865-877`,
  `modifiers::Runtime::valid` at `modifiers/mod.rs:168-215`) must accept the result. No new serialized field, so no
  `CHECKPOINT_FORMAT` bump and no `hash_coverage` row.
- ADR 0007 (determinism), ADR 0009 (layout: the schedule is the only caller of a system).

## 7. Behaviour to preserve

- Every world built without the feature, and every world with the feature on that never calls `apply`: no change at
  all (no field, no hash input, no draw, no schedule row).
- Feature wiring (stub commit): `trusted-build-setup = []`, and `trusted-status-probes` now also enables it
  (`trusted-status-probes = ["schedule-trace", "trusted-build-setup"]`). Why: the gate's rh-sim suite and CI test
  `rh-sim` only with `--features trusted-status-probes` (`scripts/gate.sh:112-113`, `scripts/gate.sh:389-391` in
  `--oracle-check`, `.github/workflows/rust.yml:49`); a test behind the new feature alone would never run anywhere.
  Both are trusted, test-only features, already kept out of production builds.
- **Never in `rh-server`.** No production build enables either feature: the server is built as `-p rh-server`
  (`hosting/Dockerfile:28`, `hosting/scripts/fleet-local/build.sh:12`), whose manifest names neither feature, and no
  crate it depends on (rh-headless, rh-policy, rh-protocol, rh-mapdress, rh-persist) enables one in `[dependencies]`
  (rh-headless enables `trusted-status-probes` only in `[dev-dependencies]`, `crates/rh-headless/Cargo.toml:33-34`,
  which a `-p rh-server` build never resolves under resolver 2). `tests/trusted_build_feature_guard.rs` pins this by
  reading the manifests and the two build recipes: rh-server never names a trusted feature or a feature of another crate
  that leads to one, no manifest enables one in `[dependencies]`, and the two recipes name none. `P-ELITE-BENCH-1`
  therefore adds an rh-headless feature (e.g. `elite-bench = ["rh-sim/trusted-build-setup"]`) and gives the bench
  binary `required-features`, like `scalebench` (`crates/rh-headless/Cargo.toml:21-28`); the guard refuses rh-server
  naming it. The workspace `--all-features` clippy build does compile the server with the feature on: that build is
  never shipped.
- The API does not exist without the feature: by construction (`#[cfg(feature = "trusted-build-setup")]` on the `mod`
  line), pinned textually by the guard test, and compiled both ways by the gate (clippy `--all-features` and default
  features over `--all-targets`; the oracle test file is `#![cfg(feature = "trusted-build-setup")]`).

## 8. Acceptance checks

The API (fixed by the stub; the oracle uses exactly these names):

```rust
// crates/rh-sim/src/trusted_build.rs, only with feature "trusted-build-setup"
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TrustedBuild {
    pub cards: Vec<(CardId, u8)>,        // copies to add, request order
    pub stacks: Vec<(MobTypeId, u64)>,   // normal-mob stat stacks to add (Player::farm), by the type that pays them
    pub boosts: Vec<(BoostId, u8)>,      // chest stat boost picks to add (Build::boosts)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildRefusal {
    NoSuchPlayer(PlayerId), NotStanding(PlayerId),
    UniqueHeld(CardId), NeedsBase(CardId), CardCount(CardId),
    NotNormalMob(MobTypeId), StacksOverMax(MobTypeId), BoostOverCap(BoostId),
}
pub fn apply(sim: &mut Sim, id: PlayerId, build: &TrustedBuild) -> Result<(), BuildRefusal>;
```

Stat stacks are given by the mob type that pays them, not by stat: the state stores them per type
(`modifiers/farm.rs:64-69`), a soak sample reads them per type (`Farm::count`), and several types pay the same stat
(`farm.rs:39-58`), so a by-stat request would have to pick a row arbitrarily. JSON form (a bench may read builds from
a file): `{"cards":[["tankEngine",1]],"stacks":[["emberImp",12]],"boosts":[["ad",2]]}`; an unknown name is a parse
error, never a panic.

Rules of `apply`, between steps only (like `state_hash`):
1. All-or-nothing: the whole request is checked first; on `Err` the world is unchanged (same state hash, no event).
2. The fighter must be seated (`NoSuchPlayer`) and standing (`Player::standing`, as `grant_mob_stat`; `NotStanding`).
3. Cards are added in request order with legacy `grantCard`'s rules: a unique card held before, or reaching a count
   above 1, is `UniqueHeld`; a conditional needs a base card of its `requires` held before or earlier in the request
   (`NeedsBase`); a count past 255 is `CardCount`. Any augment is accepted, in or out of today's chest pool
   (`INTERACTIVE`): the bench must model Rework-pool builds (Committed is not in `INTERACTIVE`). A count of 0 is a no-op.
4. Stacks: a type with no reward row (an elite, a quest giver: `Farm::reward_of` is `None`) is `NotNormalMob`; a total
   past `farm::DEFINITION.max_count` is `StacksOverMax`.
5. Boosts: a total past `chest_boost_max_picks` is `BoostOverCap`.
6. On success: the counts are written, the fighter is re-folded once (`modifiers::recompute`) and `sync_max_hp` runs,
   so current hp rises with max hp. The projection's build-mark cache is dropped (`sim.projection.marks =
   Default::default()`, the field is `pub(crate)`): otherwise the next observation before a step debug-asserts on a stale
   row (`fx_report.rs:79-87`). No RNG draw, no event, no schedule row.

Machine checks:
- `scripts/gate.sh --quick --oracle packet/P-SIM-BENCH-SEAM-1` passes.
- `cargo test -p rh-sim --features trusted-status-probes --test trusted_build --test trusted_build_feature_guard`
  passes, and so do `content`, `hash_coverage`, `no_alloc` and the other `*_no_alloc` tests, `checkpoint`.
- `cargo test -p rh-parity --test schedule` passes (`nothing_but_the_schedule_calls_a_system`).
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` and the same with default features pass.

## Oracle files (read-only for implementers)

- `crates/rh-sim/tests/trusted_build.rs`
- `crates/rh-sim/tests/trusted_build_feature_guard.rs`
- `docs/backlog/packets/P-SIM-BENCH-SEAM-1.md`

What the oracle asserts (loose proof: directions and rough sizes, plus the invariants):
- `a_minute_five_build_reaches_the_fold_and_survives_a_checkpoint`: on the camp bench's PvE config
  (`camp_bench.rs:164-183`, legacy hitboxes) and seed1, a Holy sword fighter beside the first camp, one step in, gets
  Tank Engine, Hemorrhage, Committed, 12 Ember Imp stacks (+1% damage each), 12 Magma Brute stacks (+1% max hp each)
  and 2 Ad boosts. Against an identical world without the build: max hp is about 12% higher (within 1%) and current hp
  equals it; the summary's damage is about +0.32 (12% stacks + Committed's 20%); attack speed is up about 15%; Offense
  is up; the counts read back. It observes at once (stale-cache check), emits no event, gives the same hash as a twin
  given the same request, checkpoints and restores to the same hash, fights 400 ticks in the bench Brawler's way (move
  to the nearest camp-0 mob, attack within 80 units, one order every 5 ticks; a hit involving the fighter lands) with
  the restored copy in step, and checkpoints and restores again.
- `invalid_requests_are_refused_and_change_nothing`: each of a conditional without its base, a unique card twice in one
  request, a unique card already held, an elite's stacks, a boost past the cap, an unknown player, and a valid card
  mixed with an invalid one is the named `Err`, leaves the state hash unchanged and grants nothing; a conditional after
  its base card in the same request is accepted.
- `an_unknown_card_name_is_a_parse_error`: JSON with an unknown card, mob or boost name is a serde error; the documented
  form parses.
- `trusted_build_feature_guard.rs` (runs with or without the feature): the manifests, the `lib.rs` line and the two
  server build recipes, as in 7 (`no_server_build_can_turn_on_a_trusted_feature`,
  `the_trusted_build_api_exists_only_under_its_feature`), and `the_guard_sees_a_leak_through_another_crates_feature`,
  which plants leaks in synthetic manifests (an rh-server feature naming `rh-headless/elite-bench`, a shipped dependency
  enabling a trusted feature, a recipe) and requires the guard to see each. It is green on the stub and guards later
  packets.

State of the oracle on the stub (checked by the author with a throwaway implementation, then discarded): with a
correct `apply` all six tests pass; leaving out the build-mark cache drop fails the first test at
`fx_report.rs:87` ("stale build-mark cache row"). On the stub, `a_minute_five_build_...` fails at "TankEngine held once"
and `invalid_requests_...` at "a conditional without its base card"; the JSON test and the three guard tests pass.

## Existing tests this could disturb (survey)

- `crates/rh-sim/tests/no_alloc.rs`, `no_alloc_training.rs` and the other `*_no_alloc.rs`: zero allocations per step.
  `apply` runs outside a step and is never called by them; the feature only adds a module. No change expected.
- `crates/rh-sim/tests/hash_coverage.rs`: every serialized leaf moves the hash. No new field. No change expected.
- `crates/rh-sim/tests/content.rs` (`every const/static is registered or listed`, `crates/rh-sim/tests/content.rs:11-30`):
  scans every `const`/`static` in `crates/rh-sim/src`. The module must declare none (it reads the existing
  `farm::DEFINITION.max_count` and `default_definition().chest_boost_max_picks`).
- `crates/rh-parity/tests/schedule.rs:1048` `nothing_but_the_schedule_calls_a_system`: scans every file of
  `crates/rh-sim/src` for a call to a scheduled system (`settle::settle(`, `ledger::apply(`, ...); only `#![cfg(test)]`
  and `#![cfg(feature = "trusted-status-probes")]` files are exempt (`:990-1001`), not this one. The module calls no
  scheduled system.
- Feature-gated suites now also built with the new module (because `trusted-status-probes` implies it):
  `status_privacy_review.rs`, `status_alloc_review.rs`, `status_no_alloc.rs`, `terrain_no_alloc.rs` (the trusted part),
  the `abilities::source_tests` modules, `rh-parity`'s `status-probes` binary, `rh-headless` tests (dev-dependency).
  None reads the new module.
- `crates/rh-sim/tests/checkpoint.rs`: unchanged format; no change expected.
- `scripts/readability_check.py`: the new module needs a `//!` header and fewer than 1,500 lines.
No existing expectation changes: there is no `oracle-amend:` commit.

## 9. Validation commands

- `export PATH="$HOME/.cargo/bin:$PATH"; cargo test -p rh-sim --features trusted-status-probes --test trusted_build
  --test trusted_build_feature_guard`
- `scripts/gate.sh --quick --oracle packet/P-SIM-BENCH-SEAM-1`

## 10. Risk and suggested model tier

Opus: it writes `World` state from outside the tick, and three caches must agree afterwards (the modifier fold that
`check_world` re-derives, max hp, the projection's build-mark cache). Small (one file, roughly 150 lines).

## 11. Known traps

- Re-fold once after all counts are written; calling `cards::grant` per card works but re-folds per card and has
  different refusal rules (it does not check the base of a conditional).
- `sync_max_hp` after `recompute`, never before (the fold sets `max_hp_mult`).
- Drop the build-mark cache (`sim.projection.marks`), or `observe` before the next step panics in debug builds.
- Check everything before writing anything (all-or-nothing): validate against a copy of `build` and `farm`.
- Tank Engine: its `card_tank_hp` stays 0 at setup (earned by blocks); do not invent a bonus.
- No `const`/`static` in the module (content registry test); no call to a scheduled system (schedule guard).
- `lib.rs` conflict: RULES-1 adds `mod rework_overrides; mod tuning;` in `cards/mod.rs` and edits `lib.rs`; the one
  line here merges by hand. Native card ids (P-AUG-NATIVE-1a) will extend `TrustedBuild` later; out of scope here.
- Kill-augment stats (`Player::kill_stats`) and Soul Broker trades are not part of the request: a minute-5 build rarely
  has them, and P-ELITE-BENCH-1 can ask for them as a follow-up.

## Notes from previous attempts
