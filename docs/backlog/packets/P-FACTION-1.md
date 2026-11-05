# P-FACTION-1: faction signatures, engagement, lifesteal and chill

## Implemented slice: base-player Frost

`FactionMode::EngagementHolyPlagueFireFrost` adds rate aura, proximity/thaw movement and ranged movement chill together.
The preceding tick's chill drives attack clocks, carried-start correction, engagement cadence and Fire/Plague consumers.
Private source/episode clocks are checkpointed and hashed; observations expose existing chilled bits and legitimate
timing/movement consequences. Ephemeral actual-start markers preserve action identity across stretched ongoing Draws.
Off and prior modes retain their gameplay. There are no Unity rules or new transport effects in this slice.

Ten ordinary-input traces compare 2,265 ticks and every-tick continuations. Separate actual-source helper/runtime/ledger
proofs, 2,728 independent trusted/helper cases, headless/policy/privacy/hash/restore and warmed zero-allocation checks pass.
The combined workspace gate passed 602 tests; independent review is accepted. See
[bounded evidence](../../evidence/stage2-frost-search/README.md). Sentenced Mark, auxiliary installers, cards/AP/resistance,
mobs and elite passives remain open. Protocol 5 continues to omit signature bits/effects.

## Implemented slice: player Fire

`FactionMode::EngagementHolyPlagueFire` adds player Burn and Backlash to the explicit partial installation; the default
remains Off. Burn uses unpaused engaged time. Backlash consumes the genuine afterWeapons snapshot of melee requests,
then projectile spawns, preserving duplicates and request-time weapons; real whiffs and attacks on third parties count.
Cancelled windups, reflections and splash do not create extra performed requests. Backlash is instantaneous physical
damage and does not consume the shared DoT budget or pause with Burn/Disease. Private FX retain the actual pre-barrier
amount while sustain reads landed damage.

The separate report-local instant projection, fixed ledger-return marker, hidden-source merging and retained delayed
windows follow [ADR 0013](../../adr/0013-temporal-damage-projection.md). Both independent Fire gameplay and public/session
reviews passed, including 540 captured ticks, 720 additional exact-source steps and their checkpoint continuations.
The standalone ledger fixture now requires all twelve ordered cases, preventing an empty fixture from passing.
Sentenced, Fire roam and other auxiliary/card/mob producers remain open. Protocol 5 explicitly omits these new
signature effects/bits; no presentation or game rules were added to Unity.

## Implemented slice: Plague and temporal public reporting

Implemented and independently reviewed with the 557-test combined gate. Plague plus shared DoT accounting/reporting precedes Fire with
the genuine afterWeapons attack snapshot. Disease and execute are two ordered Disease entries; execute is a private
flag, not a new signature kind. Execute reads the target's pre-ledger HP fraction without barrier; Holy sustain reads
the source's fraction. The proportional DoT cap
replaces the instantaneous hit cap for those entries; barrier apportionment follows. A stagger's own tick is not paused;
with current player timings only wand produces a positive later pause (bow exempt, melee windups zero).

An actual-source paired probe found a delayed visibility leak: hidden earlier Plague damage produced chunks
12.146966292134834 versus 8.097977528089888 at tick 11, despite identical visible HP/signature history since tick 9.
The public boundary is per-contribution eligibility at its settled tick, with canonical flush timing.
Both visible portions in that pair total 4.048988764044944, with the unseen source redacted. Trusted private totals,
damage, summation and flush events must remain source-exact.

Redact source identity before public bucket keys/order/first-weapon selection; anonymous contributions must not expose
hidden source count or history. Live/headless/policy share a canonical every-tick Rust projection feed independent of
decision/delivery cadence. Fresh reconnect/restore sessions discard prior public-window entitlement; skipped history
cannot be rebuilt from the current view. Game rules never consume projector output. API continuity/checkpoint details
are resolved by the independently reviewed design in [ADR 0013](../../adr/0013-temporal-damage-projection.md): sealed
per-step reports with frozen settled eligibility, private instance tokens, fresh-session baselines, explicit gaps and
idempotent reads. Anonymous sums must be exact and rounded once so private source order cannot alter their low bits.
Implementation, independent core/public review and the post-fix native gate passed; see [evidence](../../evidence/stage2-plague-map/README.md). No aggregation belongs in Unity.

Whole-window suppression is a possible conservative alternative only if eligibility covers every tick of the entire
window, including zero-damage ticks. Requiring visibility only for actual contributions leaks through event absence.
Keep the original Fire/Plague full-world traces capture-only until unrelated installer inactivity is established.

## Stage 2 bounded slice: engagement and Holy

Originally implemented as `SimConfig.holy_foundation`; now represented by explicit `FactionMode::EngagementHoly` (default Off): private engagement, trusted
landed/contact provenance, Holy lifesteal and internal heal. Its historical gate used checkpoint /9, replay /7, observation 7 and policy 4; current formats are recorded above and in MIGRATION. Live Heal transport and remaining faction effects stay open. See [evidence](../../evidence/stage2-holy-camps/README.md).

Source review after C3 selected shared player engagement, authoritative landed-damage accounting and Holy lifesteal
as the first implementation slice. Other faction signatures remain pending. Capture uses the existing explicit module
list in its original installation order; do not add a blanket claim that all signature installers are ported.

Holy reads HP/maxHP in `factions.beforeDamage`, excluding barriers. Its heal amount uses actual landed rows after
barrier apportionment; instantaneous Hit/hitLanded FX keep their pre-barrier amounts. Player overkill remains credited.
The existing ledger discards these landed rows, so add ordered reusable scratch rather than deriving healing from FX.
Heal FX carry recipient and actual gained amount; there is no `Holy` damage signature kind. Full/dead recipients emit
no artificial heal. A fighter killed in this ledger pass cannot heal itself alive afterward.

Record physical block contacts at melee/projectile producers into trusted scratch. `Sim::step_into` accepts a caller-owned
event buffer, so old or invented caller Block events must never affect gameplay. Process actual ledger contacts first,
physical blocks second, preserving source iteration order. Blocks can engage at zero damage without starting heal
lockout. Add a prefilled-output-versus-empty-buffer state/hash regression.

Private signature target/reach/contact/forget clocks are separate from C3 wand locks and never enter observations.
Contact tie ranking uses the source salted tick/FNV/one-Mulberry formulation, not action order. Add finite optional clocks
and checkpoint validation. Keep remaining unported rows pending rather than installing placeholder handlers.

Use genuine Holy-only installed-module captures, then verify whether the original full-default `signature_holy` trace
can be compared unchanged. Holy-only deaths can still trigger unrelated corpse systems; prove their inactivity or use
the explicitly identified module set. Ordinary `heal` lockout boundary tests can call the actual source helper directly;
do not invent a heal command or pretend an unported terrain/chest producer exists. Sentenced, auxiliary Fire/Plague and elite passives,
cards, mobs, wards, training and teleport cleanup remain later work.

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
- `heal()`: 3 s out-of-combat lockout; every lifesteal exempt. Lifesteal reads the hp the hits removed (`landedShare`); overkill on a player counts. A landed stagger pauses the staggered fighter's Burn/Disease for its weapon's windup (none for a bow). Instantaneous Backlash and Mark do not use that DoT pause.
- PvP caps from the Rust ledger apply: DoT per source per victim is held to `PVP_DOT_CAP_SHARE` 0.15 of max hp per second (a budget per tick). This budget replaces the instantaneous hit cap for DoT entries; barrier apportionment follows.
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
