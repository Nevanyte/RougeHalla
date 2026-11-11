# P-SIM-BUILDSUMMARY-1: the server computes the legacy GAINED strip values

- **Serves:** not in the plan: owner approval 2026-11-10 (MIGRATION checkpoint, decision 3: HUD presents the legacy
  information)
- **Implementer tier:** implementer-sonnet (a pure read-only function: no state, tick order, RNG or hash)
- **Reviewer:** reviewer
- **Integration base:** feature/unity-rework
- **D-rules touched:** D1 one sanity test, owner direction 2026-11-10 (MIGRATION decision 9) · D2 n/a · D5/D6/D9 none

## 1. ID and outcome
Legacy's top-left GAINED strip shows nine values for the player's own build: +Offense, +SO, damage %, attack speed %,
life steal %, +health above baseline, +/-Defense, +/-Soul Defense and move speed %, plus a "Mob bonuses" row listing
farmed stats. The legacy client computed them from the synced build. Unity may not recompute combat numbers, and the
Rust sim has the ingredients but no assembled summary, so farmed stats never appear in the Unity strip. This packet adds
a pure, read-only function in `rh-sim` that returns those values for one player and proves it against legacy. It adds no
state and no observation or wire field: publication is a later wire-17 packet. The bottom-left champion panel numbers
are a sibling packet (P-SIM-BUILDSUMMARY-2).

## 2. Dependencies
- P-HOLY-DEMON-BLOOD-1 merged (the life steal value includes Holy's camp term in legacy,
  `packages/client/src/ui/buildModel.ts:74`)

## 3. Relevant legacy paths (verified by the oracle author)
- `packages/client/src/ui/buildModel.ts:154-181` `buildGains`; `:69-81` `cardLifesteal`. Cells and their order:
  `HUD_GAIN_IDS` (`buildModel.ts:14`) = ad, ap, damage, as, leech, health, armor, mr, move; label "Gained"
  (`buildHud.ts:16`); labels Offense, SO, Damage gained, Attack speed, Life steal, Health gained, Defense, Soul Defense,
  Move speed (`buildModel.ts:171-179`). `mirrors` = `decodeMirrors(wire)` of the synced PlayerState.
- `packages/shared/src/mobStats.ts:116` `mobStatRows`, `:130` `mobStatText` (the "Mob bonuses" rows: per owned type,
  `name x count` and cumulative reward); drawn by `packages/client/src/ui/mobStatsHud.ts:34-53`.

### The nine formulas and their Rust ingredients
Units in Rust: fractions (0.19 = 19%), points for flat stats. Display rounding stays in the client.

| # | Value | Legacy formula | Rust ingredient |
|---|---|---|---|
| 1 | +Offense | `m.adBonus` (`buildModel.ts:171`) | `Runtime::mirrors().ad_bonus` (`modifiers/mod.rs:117`); already folds cards, farm flat rows and chest boost |
| 2 | +SO | `m.apBonus` (`:172`) | `mirrors().ap_bonus` |
| 3 | damage % | `sum(mob damage rows) + sum(card rows with k=stat, stat=damage, no requires, no needs) * count` (`:164-169`); conditional (`while`) rows are NOT included | **No Rust equivalent.** `hit_mult()` (`mod.rs:139`) is the multiplicative Hit key, a different thing. Build: iterate `Build::rows(faction)` (`cards/mod.rs:341`) keeping `EffectKind::Stat{stat: Damage}` with empty `requires` and `!needs_status`, plus `Farm::rows()` damage (`modifiers/farm.rs`, `Farm::count`/`reward_of`). Do not read `Runtime.sums` (it includes held `while` rows) |
| 4 | attack speed % | `speedGain(m.asMult)` = `asMult - 1` (`:174`) | `mirrors().as_mult - 1`. Not `content::attack_interval` (`content.rs:309`): legacy shows the mirror, not an interval |
| 5 | life steal % | `lifestealTotal(0, holy ? rows*2.7 : rows, mult, 0, farm)` with `rows` = card lifesteal rows x count, `farm` = mob lifesteal rows + (holy ? campClears*0.005), `mult` = 2 if Bloodthirst held and hp<50% else 1 (`:69-81`, `:158`). Faction own leech excluded | **No assembled equivalent.** Parts: `status_runtime::stats::lifesteal_total` (`stats.rs:109`), `HOLY_LEECH_ROW_MULT` (`stats.rs:120`), `HOLY_CAMP_LIFESTEAL_PER_CLEAR` x `Player::camps_cleared` (as `systems/signatures.rs:425`), `StatView.lifesteal_rows` / `farm_lifesteal_rows` / `lifesteal_mult` (`stats.rs:3`, via `modifiers::view`). Call with `own = 0.` and `on_dot = 0.` |
| 6 | +health | `max(0, maxHp - faction.hp)` (`:157`); current max hp, not current hp | `vitals.max_hp - content::faction(f).hp`, clamped at 0 |
| 7 | +/-Defense | `m.armorBonus` (`:177`) | `mirrors().armor_bonus` |
| 8 | +/-Soul Defense | `m.shieldBonus` (`:178`) | `mirrors().shield_bonus` |
| 9 | move speed % | `speedGain(m.speedMult)` = `speedMult - 1` (`:179`) | `mirrors().speed_mult - 1` |

Mob bonuses rows: for each `Farm` type with `count > 0`: stacks = `Farm::count(id)`, total = `reward_of(id).value * count`
(`farm_text::stat_text` is the same arithmetic as text). Legacy lists in catalog order (`MOB_STAT_REWARDS`).

Notes on legacy behaviour pinned here:
- `buildGains` ignores kill-augment Trophy damage (`extra.killStats`) though `combatReadability.ts:103` adds it. Pinned: not included.
- Bloodthirst doubles card and farm leech (not the Holy camp term separately: it is inside `farm`, so it is doubled too,
  `lifestealTotal` multiplies `farmRows` by `mult`). hp-dependent, so the raw value is returned.
- The pre-existing `Runtime.sums` lifesteal row total includes `while` rows that currently hold; legacy `cardLifesteal`
  counts every lifesteal `stat` row regardless of `requires`. Differences only matter for conditional leech rows.

## 4. New paths
- `crates/rh-sim/src/build_summary.rs`
- a unit test module beside it (`crates/rh-sim/src/build_summary_tests.rs`)
- stub (already committed): `pub fn build_summary(sim: &Sim, id: PlayerId) -> Option<BuildSummary>`, `BuildSummary` (nine f64 fields plus `mob_rows: [Option<MobBonusRow>; 20]`), `MobBonusRow`. The implementer may change private details but keep these names; if a signature must change, the oracle author must be asked.

## 5. Exclusive write scope
- the new paths above
- `crates/rh-sim/src/lib.rs` (the `mod` line only)

## 6. Contracts and references
- R-AUTH: Rust decides every number the HUD shows about a build.
- C-OBS: the summary is owner-only when it is published; this packet publishes nothing.
- C-NUM: f64, legacy operation order, `crate::math` for transcendentals.
- `crates/rh-sim/AGENTS.md`: pure, no allocation in the tick path (this function runs outside the tick; state that and
  keep it allocation-free if the wire packet will call it per snapshot).
- Existing ingredients: `Runtime::mirrors()` (`crates/rh-sim/src/modifiers/mod.rs:117`), `hit_mult()` (`:139`),
  `content::attack_interval` (`crates/rh-sim/src/content.rs:309`), `Farm::count` and `reward_of`
  (`crates/rh-sim/src/modifiers/farm.rs`), `lifesteal_total` (`crates/rh-sim/src/status_runtime/stats.rs`).

## 7. Behaviour to preserve
- No schedule row, state field, RNG draw, observation field or wire byte changes: state hash, checkpoint 31, replay 25,
  observation 24 and the content hash are unchanged.
- Existing parity report: all MATCH.

## 8. Acceptance checks
- `scripts/gate.sh --oracle packet/P-SIM-BUILDSUMMARY-1` passes (full).
- One unit test: a mixed build (cards, farmed stats, a chest boost, a Holy player with camp clears) whose nine values
  are worked out by hand from the legacy formulas cited in section 3, each within 10% of the function's result and with
  the right sign; and a build with nothing gained returns all zeros and no rows.
- No legacy capture (owner direction 2026-11-10: one test that the numbers are not drastically off).

## Oracle files (read-only for implementers)
- `crates/rh-sim/src/build_summary_tests.rs`
- `crates/rh-sim/src/lib.rs`: only the line `#[cfg(test)] mod build_summary_tests;` (added with the oracle; leave it)

## 9. Validation commands
- `cargo test -p rh-sim --features trusted-status-probes`


## 10. Risk and suggested model tier
Sonnet. "Life steal gained" and "damage gained" have no Rust equivalent today (only the combat total exists); they are
ported by reading `buildModel.ts`. Riskiest value: damage % from unconditional rows only.

## 11. Known traps
- Legacy rounds for display in `buildHud.ts`; compare unrounded values and leave formatting to the client packet.
- "+health above baseline" is `max_hp - faction.hp`, not current hp.
- hp-dependent values (Holy leech) change every tick: return the raw value; quantization is the wire packet's choice.
- Chest boosts, cards and farmed stats can each move the same mirror: use the fold's own totals, do not re-add rows.

## Oracle design (author notes)
- Test (a) is a Holy player built with the real helpers (`cards::grant`, `modifiers::grant_mob_stat`,
  `reward_chests::grant_boost`, `camps_cleared`). Hand values were cross-checked against the sim's mirrors before commit:
  as_mult 1.19, speed_mult 1.09, armor 20, shield 18, ad 43.2, ap 17, max hp +400.75 (1145 x 0.35). Expected: damage -0.23
  (Slow Starter's unconditional -0.30 plus 7 Ember Imp; its `while` +0.65 must not count: the trap), life steal 0.185.
- Test (b) passes against the stub; it is a regression guard, the failing assertion is in (a).
- Not covered (accepted): a negative Defense/SD, Bloodthirst below half hp, a non-Holy faction, hp-dependent doubling.
- Failure with the stub: `offense: sign differs, got 0, want 43.2`.

## Notes from previous attempts
