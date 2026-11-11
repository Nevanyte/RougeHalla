# P-BALANCE-2: camp-clear bench under both hitbox modes

- **Serves:** ORDER_OF_OPERATIONS phase 2, item 11 (D2 harness, PvE half); owner direction 2026-11-10 (MIGRATION checkpoint)
- **Implementer tier:** implementer-sonnet
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 outcome-class parity with a declared band · D2 this is harness evidence for DEV-009/010/011 ·
  D5/D6/D9 none

## 1. ID and outcome
The owner reports that camps take little damage in the beta, Holy heals a lot and Frost is very strong. The constants
match legacy; the live server runs Archetype hitboxes with mob spacing (DEV-009/010/011), which parity never exercises.
This packet is a verification tool: a deterministic bench in which one fighter of each faction and weapon clears each
camp kind, run under `LegacyCircle` and under `Archetypes`, reporting for each cell the ticks to clear, damage dealt
and taken, hp remaining, healing received from lifesteal, and seconds of chill/freeze applied. It changes no rule and
no number. When it lands, "camps die slower by X% for weapon W" is a measured table, and the retune packet has its input.

## 2. Dependencies
none (it reuses the headless environment; it does not need P-BALANCE-1)

## 3. Relevant legacy paths
- `packages/shared/src/constants.ts`: the multipliers the cells exercise: `MOB_K = 0.22` (:484), `ELITE_K = 0.65`
  (:485), `MOB_HP_MULT = 2` (:495), `MOB_DMG_MULT = 0.5` (:496) (commit `31256fcd`), `MOB_MELEE_DMG_MULT = 1.6` (:525),
  `MOB_RANGED_DMG_MULT = 1.2` (:526) (commit `73f46cdc`; the Rust twins are `crates/rh-sim/src/constants.rs:319-320`).
  The bench changes none of them.
- **A legacy camp-clear bench exists: `packages/server/bench/campDuel.ts`** (header :1-33). One starter (one faction,
  one weapon, no cards) meets one mono-type camp of a zone (4 normals, or an elite plus normals) on an open floor,
  walks into reach of the nearest mob, holds a directional attack and switches target when it dies; reports time to
  clear (first mob waking to last death) and hp left. `--weapons` (:25) runs fists and the five weapons, `--types`
  (:26) gives the 30 mob types (the same 30 camp kinds as here), `--map` (:30) fights on a real generated map, cap
  `--cap SECONDS (90)` (:33, :139). It is a TypeScript lens with its own setups and no hitbox modes, so it is the
  **conceptual cross-check, not a numeric oracle**: the Rust bench is not expected to reproduce its tables (different
  map, policy and pull). `farmRouteData.ts:1-4` is not a camp bench (it dumps camp and route tables for a Python proof);
  `mobDuel.ts` (one mob) and `ttkCurve.ts` (player duels) are neighbours. The legacy stand-in for the Rust bench is
  `HitboxMode::LegacyCircle`, parity-proven on `parity/fixtures/mob_camp` and `crowded_8` only.

## 4. New paths
- `crates/rh-headless/src/bin/camp_bench.rs` (a STUB is committed by the oracle author: it compiles and prints an empty
  versioned report; the implementer replaces it) and an optional helper directory beside it. Cargo auto-discovers
  `src/bin/*.rs` (the crate's other binaries rely on it), so `Cargo.toml` is not touched.
- `crates/rh-headless/tests/camp_bench.rs` (the oracle; read-only)
- `tools/balance-camps/README.md` (how to run, how to read the table)

## 5. Exclusive write scope
- the new paths above only (including replacing the stub `src/bin/camp_bench.rs`). No edits to `rh-sim`, `rh-policy`,
  `rh-headless/src/lib.rs`, parity fixtures, `Cargo.toml` or shared records. Everything the bench needs is public API
  (below); if something is not, stop and report, do not widen the scope.

## 6. Contracts and references
- C-INPUT: the fighter and every mob act only through `validate` + `Sim::submit`; no direct state edits.
- C-DET, `crates/rh-headless/AGENTS.md`: same seed and inventory give a byte-identical report; no wall clock.
- ADR 0024 (hitbox archetypes), `docs/DEVIATIONS.md` DEV-009/010/011: the two modes compared.
- Existing A/B precedent: `crates/rh-headless/examples/hitbox_compare.rs` (40 bot matches per mode).
- `LegacyCircle` is the legacy stand-in: it is parity-proven on `parity/fixtures/mob_camp` and `crowded_8`. That proof
  covers those scenarios only; the report says so.

## 7. Behaviour to preserve
- No content, tolerance or rule changes. Never tune a number to make a cell pass.
- The fighter's policy is an existing scripted `rh-policy` seat; do not write a second brain. **Chosen seat:
  `rh_policy::scripted::Brawler::new(1)`** (`crates/rh-policy/src/scripted.rs:46-200`): the smallest existing policy
  that attacks the nearest mob. Per decision it takes the nearest alive visible actor (mobs included), walks to it
  while farther than 80 u and presses `Attack` toward it inside 80 u, wandering when nothing is visible. `HumanBot` and
  the full legacy Brain are bigger and not needed. No scripted seat is a purpose-built farmer, so Brawler is the answer.
  Known confound, the same in both modes and therefore controlled, but to be stated in the tool README: it swings from
  80 u whatever the weapon's reach (a sword or axe swings at air until the mob closes in; bow and wand fire at close
  range), so the table is "Brawler with weapon W", not optimal play.
- Mode and spacing: `LegacyCircle` (no spacing code runs) and `Archetypes` with `MobSpacing::Auto` (the live setting,
  `rh_server::runtime::LIVE_DEFAULT_HITBOXES`, `crates/rh-server/src/runtime.rs:29-30`; `archetype::mob_spacing`).
  `MobSpacing::Off` is measurement-only: it is available only as the opt-in third mode `archetypes-nospacing`
  (`--with-nospacing`), never in the default inventory.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-BALANCE-2` passes (full).
- Tests (all in `crates/rh-headless/tests/camp_bench.rs`; a debug `cargo test` runs `--quick` subsets with
  `--max-ticks 400`, the full run is an `#[ignore]`d release test):
  1. `full_inventory_is_complete_ordered_and_exactly_once`: `--list` gives 5 factions x 6 weapons x 30 camp kinds x 2
     modes = **1800 cells**, each once, in that order (mode innermost), kinds taken from the catalog.
  2. `quick_inventory_is_the_documented_subset_and_opt_in_columns_are_labelled`: `--quick` = Frost,Holy x Sword,Wand x
     {first normal, first elite of the first zone} x 2 modes = **16 cells**; `--with-nospacing` adds exactly one
     labelled `archetypes-nospacing` mode per scenario.
  3. `quick_run_reports_every_cell_with_consistent_metrics`: complete, finite, non-negative, outcome-consistent
     (cleared => hp left and damage dealt; died => hp 0 and damage taken >= start hp; truncated => ticks == cap), and
     `hp_remaining + damage_taken >= hp_start` (damage taken counts every source).
  4. `both_modes_of_a_scenario_fight_the_same_camp`: same camp index, mob count, roster type, start hp in both modes.
  5. `two_runs_with_one_seed_are_byte_identical`.
  6. `truncated_cells_are_reported_not_dropped` (`--max-ticks 20`: 16 cells, `truncated`, ticks == 20, finite deltas).
  7. `an_empty_report_fails_the_checker` (the oracle's `validate_report` rejects an empty or partial report).
  8. `every_scenario_carries_per_metric_deltas`: one comparison per scenario, six metrics, `rel_delta` as defined below.
  9. `the_band_is_a_named_constant_and_out_of_band_cells_are_listed`: `const BAND: f64 = 0.10;` in
     `src/bin/camp_bench.rs`; report `band` is 0.1; `out_of_band` equals the recomputed list.
  10. `a_changed_weapon_changes_the_cells_it_touches_and_only_those` (negative control, below).
  11. `frost_chill_and_holy_healing_are_measured` (oracle assumption, below).
  12. `full_run_reports_every_cell_and_exits_zero` (`#[ignore]`, release).
- The bench exits 0 whenever it ran and reported (every test run asserts it), whatever the deltas: it is evidence, not a
  gate on today's numbers.
- **"+/-10%" is a relative difference per metric**: `rel_delta = (archetypes - legacy) / legacy`; both zero is 0.0;
  legacy zero with archetypes nonzero is undefined (JSON `null`) and counts as out of band; a cell is in band iff
  `|rel_delta| <= BAND` (exactly 0.10 is in band). A scenario whose two modes end differently (cleared vs died vs
  truncated) is listed first with metric `"outcome"`, then its out-of-band metrics.
- **Negative control** differs from the plan's wording: the plan says "a test-only mutated weapon number", but a rule
  number cannot be changed without editing `rh-sim`. The control is the hidden flag `--control-weapon-swap from=to`
  (e.g. `sword=axe`): cells labelled `from` are run with weapon `to`; at least one such cell must change and every other
  cell must be byte-identical. That proves the report follows the weapon actually wielded. Document it as test-only.

### 8a. CLI and report schema (version 1)
`camp_bench [--seed N] [--quick] [--list] [--with-nospacing] [--max-ticks N] [--control-weapon-swap a=b]`; stdout is
exactly one JSON object; defaults: seed 1, `--max-ticks 1800` (90 s, the legacy cap). `--list` runs nothing: the report
has `"list_only":true` and cells carrying only their key fields.
```
{"version":1,"seed":u64,"quick":bool,"list_only":bool,"max_ticks":u32,"band":0.1,
 "cells":[{"faction","weapon","kind"(MobTypeId::as_str),"zone","elite":bool,"mode":"legacy"|"archetypes"|"archetypes-nospacing",
           "camp":u32,"mobs":u32,"roster_type":str,"hp_start":f64,"outcome":"cleared"|"died"|"truncated",
           "ticks_to_clear":u32,"damage_dealt":f64,"damage_taken":f64,"hp_remaining":f64,
           "healing_received":f64,"chill_seconds":f64}],
 "comparisons":[{"faction","weapon","kind","outcomes":[legacy,archetypes],
                 "metrics":{<six metric names>:{"legacy":f64,"archetypes":f64,"rel_delta":f64|null}}}],
 "out_of_band":[{"faction","weapon","kind","metric"}]}
```
Order: faction in `FactionId::ALL`, weapon in `WeaponId::ALL`, kind = per zone in `FactionId::ALL` order, normals then
elites in catalog order; comparisons follow the scenario order of the cells. Numbers print with `serde_json`
(`float_roundtrip`), so reruns are byte-identical.

Definitions the oracle relies on (the implementer realises them and flags any that cannot be):
- A scenario builds one world: `Sim::reset_active` over the seed1 map (`crates/rh-sim/src/mapdata/fixtures/seed1.map.json`:
  50 camps, 10 per zone, 2 elite camps per zone; every normal type appears among each zone's first 10 camp draws, both
  elites appear), config = the live source-arena config of `examples/hitbox_compare.rs::live_config` but active
  lifecycle, `MobMode::Pve`, `regen: false`, `consumables: false`, `quests: false` (so lifesteal is not mixed with
  regen or potions), `hitboxes` per mode. One fighter: the cell's faction and weapon (`Placement.weapon0`), no cards.
  (`Env::new` cannot place a fighter at a camp or give it a weapon, hence the checkpoint seam below.)
- Camp kinds come from the catalog (`mob_catalog::{normal_types_of, elites_of}`), the camp from the rolled rosters
  (`Sim::camp_rosters()`): the first camp of the kind's zone whose roster has that `mob_type` and no elite (normal
  kind), or an elite spot and `elite == Some(type)` (elite kind). The fighter starts at a deterministic floor point
  ~10 tiles from it (legacy `--map`, campDuel.ts:30-32). Same point, camp and seed in both modes.
- The fighter is driven by Brawler through the external-checkpoint seam: `Env::from_external_checkpoint(sim, max_ticks)`,
  `Brawler::reset(&MatchStart::of(&sim, id, seed))`, `decide(&obs)` each tick, commands into `Env::step` (C-INPUT).
- `ticks_to_clear`: ticks from tick 0 to the camp's last death (`outcome` cleared), to the fighter's death (`died`), or
  `max_ticks` (`truncated`). `hp_remaining` is 0 when dead. Never divide by a zero metric.
- `damage_dealt`: `Hit`, `SignatureHit`, `AbilityHit`, `CardBleedHit` amounts with `by == fighter` against mobs;
  `damage_taken`: the same event kinds with `victim == fighter`. `healing_received`: `Event::Heal` amounts for the
  fighter. `chill_seconds`: `StatusApplied{by: fighter, kind in SlowMove|Root|Stun}.ms / 1000` plus 0.05 s per tick per
  mob with `core.chill < 1` while the fighter is in its `chillers`.

## Oracle assumptions (the oracle author could not verify these without an implementation)
- The quick set shows non-zero Frost `chill_seconds` and non-zero Holy `healing_received` (test 11). If the implementer
  shows with a sim test that a column is genuinely zero by the rules, it reports back; the oracle author amends the test.
  Do not edit the oracle. (`systems/heal.rs` has a Lifesteal kind; `kill_augments.rs:213` says the Rust sim has no Holy
  camp-lifesteal passive, so Holy healing may come from elsewhere or be small: this is the least certain assumption.)
- `Env::from_external_checkpoint` plus an externally driven `Brawler` is feasible with public API (`Env`,
  `Sim::reset_active`, `Placement`, `MatchStart::of`, `Policy::decide`); the oracle author did not build it.
- Debug-build cost of the quick tests (16 cells x at most 400 ticks over a 50-camp world, four to five runs) is
  unmeasured. If it exceeds a couple of minutes, say so in the hand-off rather than trimming the oracle.
- Seed 1 is assumed to roll a camp of every needed kind on seed1.map (by the roster rules: 4 normals per round, 3 rounds,
  10 camps per zone); the bench must fail loudly if a kind has no camp.

## Oracle files (read-only for implementers)
- `crates/rh-headless/tests/camp_bench.rs`
- `crates/rh-headless/src/bin/camp_bench.rs` is a STUB, not an oracle: the implementer replaces it, except that the line
  `const BAND: f64 = 0.10;` must stay in that file (test 9 reads the source).

## 9. Validation commands
- `cargo test -p rh-headless --test camp_bench`
- `cargo test --release -p rh-headless --test camp_bench -- --ignored` (full 1800 cells)
- `cargo run --release -p rh-headless --bin camp_bench -- --seed 1` (the full report)
- `cargo run --release -p rh-headless --bin camp_bench -- --quick --seed 1`

## 10. Risk and suggested model tier
Sonnet: one crate, a tool, no sim change. The risk is a bench that measures the scripted policy rather than the
hitboxes; the same policy and seeds in both modes control for that.

## 11. Known traps
- The oracle must fail on an assertion, not on a missing binary: the oracle author commits a stub `camp_bench` that
  prints an empty report.
- Camp kinds must come from the mob catalog (`crates/rh-sim/src/mob_catalog/`), not a hand list.
- `MobSpacing::Off` is measurement-only and the server refuses it: use it only to separate the hitbox effect from the
  spacing effect, and label those columns.
- A fighter that dies has not cleared the camp: report the death, do not divide by zero.

## Routing
- **Serves:** ORDER_OF_OPERATIONS phase 2, item 11 (D2 harness, PvE half) · **Tier:** implementer-sonnet ·
  **Reviewer:** reviewer · **D-rules:** D1 (declared band, no new parity claim), D2 (harness evidence for DEV-009/010/011),
  D5/D6/D9 none · **Write scope:** section 5 · **Deviations:** none (a measurement; no rule or number changes).

## Notes from previous attempts
- Oracle author (2026-11-10): oracle committed on `packet/P-BALANCE-2`; all 11 non-ignored tests fail on assertions
  against the stub. Corrections to the first draft: the legacy camp bench exists (`campDuel.ts`); the negative control is a
  weapon swap, not an edited weapon number; DEV-009/010/011 record that P-BALANCE-1 does not exist and the switch was
  accepted as risk, so this bench is reported evidence, not a gate.
