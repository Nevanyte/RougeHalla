# P-FACTION-1: faction signatures, engagement, lifesteal and chill

## ID and outcome
P-FACTION-1. Between players with no cards (power 0), the five factions' signatures run exactly as in legacy: Fire burn +
backlash, Plague disease + execute, Sentenced tiered mark, Frost chill (rate aura + movement chill + ranged chill), Holy
lifesteal; with targets, engagement (reach, linger, trade window), `heal()` and its 3 s lockout, DoT fx chunking and the
PvP DoT cap. The capture tool gains a `signatures: true` mode.

## Dependencies
P-COMBAT-1 (weapons in hand: signatures scale by the weapon's `dpsMult` and reach). P-CAPTURE-1 (scenario/canonicalisation
helpers; the signature fields of `hit` events are needed). Mob-side signatures, shared camp marking and card rows are not here
(P-MOBS-1, P-CARDS-1).

## Relevant legacy paths (verified)
- `packages/server/src/sim/factions.ts` (1,250+ lines): header comment (l.1-45) is the rule list; `signatureDamage` (l.367), `contactsOf` (l.340), `afterWeapons` (l.291), `afterDamage` (l.859), `updateChill` (l.993), `frostMovementModifier` (l.1056), `heal` (l.1137), `markStep` (l.694), `promote` (l.635), `staggerPause` (l.959), `stretchUntil` (l.977), `flushDotFx` (l.941).
- `packages/shared/src/factions.ts` (sheet incl. `params`, `lifestealFraction` l.177, `auraRateMultiplier`), `signatures.ts` (`ENGAGE_TRADE_SECONDS` 3, `ENGAGE_TRADE_SLACK_SECONDS` 0.5, `ENGAGE_LINGER_SECONDS` 1.25, `TARGET_FORGET_SECONDS` 10, `CHILL_MOVE_RADIUS` 100, `CHILL_MOVE_MULT` 0.7, `CHILL_MOVE_HOLD_MS` 1000, `CHILL_MOVE_THAW_MS` 3000, `HEAL_LOCKOUT_SECONDS` 3, `DOT_FX_MS` 500, `engageRange`, `bonusMultiplier`, `burnDps`, `plagueDps`, `executeDps`, `EXECUTE_BAND` 0.5), `signatureShares.ts` (burn/disease magic, backlash physical, mark 40% phys / 60% magic), `mark.ts` (`markTierOf`, `markWeight`, `markPct`, `MARK_BONUS_STAT_PER_POINT`), `constants.ts` (`MARK_TIER_HITS` 3, `MARK_TOP_TIER` 4, `AP_DOT_RATIO` 0.6, `PVP_DOT_CAP_SHARE` 0.15, `FROST_RANGED_CHILL_MULT` 0.85 / `_MS` 1200, `LIFESTEAL_MAX` 0.85).
- Docs: `docs/SENTENCED_REDESIGN.md`, `testing/TUNING_BALANCE.md` section 13, `testing/TUNING_SENTENCED.md`. Oracle: `testing/realtime.py`, `testing/test_rpsls.py`.
- Tests: `packages/server/test/factions.test.ts`, `factionCycle.test.ts`, `mobSignatures.test.ts`, `shared/test/factions.test.ts`, `signatures.test.ts`.

## New paths
`crates/rh-sim/src/systems/signatures.rs` (engagement, targets, per-faction damage entries), `crates/rh-sim/src/systems/heal.rs` (heal + lockout), both fired from their `schedule.rs` rows and hook links,
extend `content.rs` with `FactionSpec.params`/mechanic (and `content_hash`); capture: a `signatures` scenario flag + new scenarios.

## Exclusive write scope
`crates/rh-sim/src/{systems/signatures.rs,systems/heal.rs,systems/ledger.rs,systems/mod.rs,schedule.rs,hooks.rs,state.rs,fighter.rs,scratch.rs,checkpoint.rs,content.rs,constants.rs,lib.rs,observe.rs}`, `crates/rh-sim/tests/`, `crates/rh-parity/**`,
`parity/legacy-capture/capture.ts`, `parity/fixtures/`. `testing/` Python tools are read-only references. Core layout rules (post-sweep, [ADR 0009](../../adr/0009-core-layout.md); the README "Shared-file rule" has the long form): the mechanic is `systems/<mechanic>.rs` with `fn(&mut Cx)` entry points, plus its rows flipped from `Pending` to `Ported` in `schedule.rs` at their legacy position (the row names, never a reorder); entity data goes in `fighter.rs` / `state.rs` / `store.rs` (hashed and checkpointed: extend `check_world` in `checkpoint.rs` if the new data has an invariant the tick relies on) and per-tick lists in `TickScratch` (`scratch.rs`, never serialized); `tests/no_alloc.rs` must stay at zero allocations per step, new content goes through the `content.rs` registry (`content_hash`), and every new serialized field must be covered by `tests/hash_coverage.rs`. `sim.rs` is a facade and is not in any write scope.

## Contracts and references
C-TICK (signatures sit in `[beforeDamage]`, after melee and before sudden death and the ledger; `afterWeapons` and `afterDamage` hooks bracket weapons and the ledger), C-PARITY, C-DET, C-RNG (no randomness here except the per-tick tie hash: use the order salt as legacy does), C-OBS (hp of others is a bar; signature state like marks/chill is public only as effect bits). ADR 0007.

## Behaviour to preserve
- **Targets:** each fighter has at most one target: the last enemy it hit; a fighter with none takes whoever hits it; a shield block counts as the attacker's contact; a passive hit (riposte, reflected arrow) only gives a target to a fighter that has none; same-tick choice never depends on order (hit target kept, else the largest hit, ties by a salted per-tick hash); forgotten after `TARGET_FORGET_SECONDS` 10 without a trade, when not standing, and at the coliseum teleport.
- **Engaged** = target within `engageRange(weapon)` with a clear line (present positions) within the last `ENGAGE_LINGER_SECONDS`, and a hit or block between the pair within the trade window (`tradeWindowMs`: 3 s, longer for a slow chilled pair, plus 0.5 s slack). Every signature bonus is multiplied by the wielded weapon's `dpsMult` and mitigated as its own damage type.
- Fire (`burn` 28, `backlash` 128 on the sheet; paced x `DUEL_PACE` 2): burn every tick while engaged; backlash on each attack the target performs = `backlash x` the target's **unbuffed** interval (foe-independent per second). Plague (`plague` 52, `execute` 325): disease every tick + execute `execute x max(0, 0.5 - foeHpFrac)` as a **separate** ledger entry, reading the target hp fraction at tick start. Sentenced (`mark_pct` 0.045, `mark_kill` 0.00675, `tier_hits` 3): a pulse per landed hit on its target, a share of the target's max hp, weight uses full attack speed, tiers climb by hits (or target weapon swaps), tier 4 denies the target's execute; tax/suppress/amp are neutral (1) on the reworked sheet. Frost: rate aura `slow` 0.32 (chilled fighters' cooldown progress, bow draw and press buffer are stretched every tick; windups other than the bow draw are not), movement chill x0.7 within 100 u (hold 1 s, thaw 3 s), ranged chill x0.85 for 1.2 s, everything the chilled fighter deals (signatures included) is multiplied by its chill. Holy: `lifestealFraction = min(0.6, 0.07 + 0.6 x (1 - hpFrac at tick start))` of damage landed, no lockout, applied **after** the tick's damage (a fighter the tick kills is dead whatever it healed).
- `heal()`: 3 s out-of-combat lockout; every lifesteal exempt. Lifesteal reads the hp the hits removed (`landedShare`); overkill on a player counts. A landed stagger pauses the staggered fighter's burn/disease/mark for its weapon's windup (none for a bow).
- PvP caps from the Rust ledger apply: DoT per source per victim is held to `PVP_DOT_CAP_SHARE` 0.15 of max hp per second (a budget per tick) in addition to the hit cap already ported.
- Hit events carry the signature kind (`sig`) and `passive`; DoT damage is reported in `DOT_FX_MS` 500 chunks, not per tick (`flushDotFx`).
- **Docs disagree:** docs/legacy/CLAUDE_LEGACY.md "Current faction rework" and `docs/SENTENCED_REDESIGN.md` describe the same mark but several older paragraphs in docs/legacy/CLAUDE_LEGACY.md (faction counters, `BEATS`) are historical; `shared/src/signatures.ts` `factionEdge` is always 0. Code wins.

## Acceptance checks
1. Capture: make `capture.ts` accept `signatures: true` per scenario. **Trap:** in `createGameWorld`, `signatures` also installs Fire roam, bruiser passives, Plague corpses/zombies and the Sentenced hunt (`gameplay.ts` l.90-93). Do not change `packages/`; build the module list in `capture.ts` from the exported per-module `install` functions (compose `createWorld` + the modules it needs) so only `sim/factions.ts` is installed, and record which list was used in `legacyConfig`. If that is not possible, keep scenarios inside each extra module's inactive window and say so in the fixture.
2. Scenarios (slice, with `weapon0` set): `fire_burn_backlash`, `plague_disease_execute` (kill a low target), `sentenced_mark_tiers` (swap weapons mid fight), `frost_chill_all` (rate aura + movement), `holy_lifesteal_low_hp`, plus 5 mirror/cross matchups on fists and on one armed pair each, and `heal_lockout`.
3. `hit` events in the harness gain `sig` (and `passive`); exact match for kind/tick/victim, amounts within 2e-6.
4. Cross-check the Rust numbers against `python3 testing/test_rpsls.py` and `python3 testing/matchup_band.py` (reference only, they need no change).
5. DoT cap, lockout and stagger-pause unit tests; replay/checkpoint determinism with every faction engaged.
6. `a_changed_rule_is_caught` extended to mutate a signature constant.

## Validation commands
`npx tsx parity/legacy-capture/capture.ts --only <scenario>`, `cargo test -p rh-sim`, `cargo test -p rh-parity`, `cargo test --workspace`,
`cargo run -p rh-parity --bin parity-report`, `python3 testing/test_rpsls.py` (reads the legacy sheet, optional), `cargo clippy --workspace --all-targets`.

## Risk and suggested model tier
High risk: strongest model, high effort. The module is the densest rule file in the sim; many orderings (afterWeapons, contacts,
promotion, chill stretch, lifesteal after damage) decide parity. Split into sub-PRs per faction behind the shared engagement core.

## Known traps
- Position in the tick: contacts are recorded in `afterWeapons`, damage entries in `beforeDamage`, heals/chill/visual syncs after the ledger. Never reorder.
- Per-tick tie hash uses the order salt; derive it exactly as `tieRank` does or ties diverge.
- Do not read cards: every `...MultOf` is 1 at power 0, but keep the hooks so P-CARDS-1 can fill them.
- Typed damage: hit events carry weapon shares; signatures use `SIGNATURE_SHARES`, not the attacker's `phys`.
- f64 accumulators (`ownHits`, rates) must keep the legacy summation order.
