# Sentenced redesign: the contract

Original branch `claude/sentenced-redesign` (live base `main` c977910, combat upgrade `ebd3514` integrated and released in `6f06d9d`); the balance follow-up is `codex/sentenced-balance` from that latest main. This file is the rule the code, the tests and the Python oracles are built to; the owner's spec (the "Sentenced - Full Redesign" sheet) is the intent, the orchestrator's decisions D1-D11 override it where they differ, and section 11 says what tuning moved. Numbers marked **(tuned)** are the ones section 11 re-measures; everything else is a rule.

Sentenced stays the suppressor: it does not out-damage you, it denies your win condition while a percent-of-max-hp true-damage sentence tightens. It beats Plague and Frost, loses to Fire and Demon Blood (`BEATS` is unchanged, D8). No anti-heal (the mark does not reduce healing), no on-hit burn or reflection (Fire's backlash is untouched), no flat slow (Frost's chill is untouched).

## 1. What the old Sentenced was, and what goes

The old mark was a damage-over-time signature: `markDps(elapsed)` ramped to a cap with the engaged time on one target (`SigFighter.markElapsed`), reset by a new target or by the target's weapon swap, boosted by `markRate` (Gathering Storm) and by the PvP factor, typed true, reported in `DOT_FX_MS` chunks, and subject to the DoT cap, `dotMult`, AP-on-DoT, Festering Arcana and Slow Burn's linger. `FactionSpec.params` carried `mark_ramp` and `mark_cap` (the ramp times k squared at duel pace). All of that is removed: `markDps`, `markShare`, `markElapsed`, `mark_ramp`, `mark_cap`, `isDot("mark")`, the mark in `dealsDot`, `onWeaponSwapped`'s reset. `SignatureKind` keeps `"mark"` (wire code 3) for the new pulses; they are not damage over time.

## 2. The mark (spec section 2)

For PvP, a mark lives on a Sentenced fighter's signature target (`SigFighter.target`, sim/factions.ts: the last enemy it hit, forgotten after `TARGET_FORGET_SECONDS` without a hit or block, cleared when the target is not standing or is walking home or at the coliseum teleport). Choosing a target is not marking it: the mark exists from the first **landed hit** of the Sentenced on that target.

**R1 Lifecycle.** The mark is one-way within itself and resets whole (tier, hits, swaps, the denial latch) when: the Sentenced targets someone else (`setTarget`: it hit another enemy and not its current target in that tick), the target dies or stops standing, the teleport, the Sentenced goes down, or the target stays farther than `TARGET_RANGE` (640 u) from the Sentenced for `TARGET_LOS_GRACE_MS` (1.5 s) running (the repo's existing lock-break numbers; the target is dropped too). Kill-stacks are not part of a mark (R7).

**Camp marking (owner update, 2026-10-28).** A mob group is its camp (`MobState.camp > 0`), including training practice camps. The first landed hit marks living, non-returning members together. Tier progress is shared; switching between members or killing the focused member preserves the group mark. Camp-less mobs and players are singletons. A pulse batch reaches every living, non-returning camp member within `TARGET_RANGE` (640 u). Each member receives `1 / sqrt(N)` of its singleton pulse, where `N` is the number of living, non-returning camp members when the mark starts (captured as server-only `markGroupSize`, including practice camps). That divisor remains fixed until the mark resets. Several weapon hits in one tick all advance progress, but emit at most one pulse per group member in that tick, using the tier after all those hits. This prevents an arc swing touching N mobs from causing N squared pulses. Tax, suppression, execute denial and mark visuals apply to those same eligible members; returning members and members beyond 640 u are omitted. The focused member retains the usual 1.5 s range-break grace; if it dies or returns, the lowest-id eligible survivor becomes the focus. With no survivor, the mark clears. A contact on any member refreshes the group contact timer.

**R2 Hits that count.** A ledger entry (this tick, in `beforeDamage`, before the pass) of the Sentenced's on its target that is a weapon hit: `weapon !== null`, no `sig`, no `ability`, not `dot`, not `passive`, not `derived`, not `final`, `scale > 0`, raw above 0, and the victim neither teleport-immune nor walking home (the same filter `contactsOf` uses). A blocked swing never reaches the ledger and counts for nothing. A hit on a dummy counts.

**R3 Tiers.** Per mark: `hits` (integer), `progress` (each hit credits `(1 + markRate) / chill`, so Gathering Storm credits 1.5 without chill; Frost's cadence loss is compensated for both tier progress and pulse damage), `swaps` (the target's weapon changes while marked, from the `weaponSwapped` hook: a swap input or a pickup that replaced the weapon in hand; one count per event).

| Tier | Name | Reached by | Effects |
|---|---|---|---|
| 0 | none | no landed hit yet | nothing |
| 1 | Accused | first landed hit | a pulse on every landed hit |
| 2 | Charged | 3 hits or 1 swap | + the attack-speed tax (R5) |
| 3 | Convicted | 6 hits or 2 swaps | + output suppression (R6) |
| 4 | Sentenced | 9 hits or 3 swaps | + the x1.17 amplifier on the pulse **(tuned)** + execute denial (R7) |

`tier = clamp(1 + max(floor(progress / MARK_TIER_HITS), swapSteps), 1, 4)`, `MARK_TIER_HITS` = 3 **(tuned)**, where `swapSteps = swaps x (noCommutation ? 2 : 1) + (swiftJudgment ? floor(hits / 2) : 0)`. Either path alone reaches a tier (a maximum, not a sum). A hit and a swap in one tick are both counted before the tier is read; promotion can skip tiers (two swaps in a tick). The tier read after a tick's hits is the tier of that tick's pulses, of the tax, the suppression and the denial from that tick's ledger pass on. A swap while the mark is at tier 0 counts nothing.

**R4 The pulse (the percent true damage).** For every counted hit the Sentenced records one extra ledger entry in the same tick: `sig: "mark"`, `weapon` = the hit's weapon, `packet {raw, true: 1}`, `stagger: false`, victim the target, `by` the Sentenced, with

```
raw = pct x target.maxHp x weight x amp x prox
pct    = (mark_pct + killStacks x mark_kill) x heavier
heavier = 1 + HEAVIER_SENTENCE_PER_BONUS x bonusMaxHp / factionBaseHp with Heavier Sentence, else 1      (paced faction numbers; mark_pct, mark_kill are x DUEL_PACE)
weight = markWeight(f, weapon, asMult) = f.rate x dpsMult(weapon) x asMult x attackInterval(f, weapon, asMult) / chill
amp    = mark_amp (1.17) while tier 4 or now < ampUntil (R7), else 1
prox   = 0.5 when the target is farther than MARK_NEAR_RANGE (300 u) from the Sentenced and not inside the Sentenced's own Trial ring, else 1
```

`weight` is the hit's share of the faction's base hit, so a pulse tracks the weapon's `dpsMult` exactly as every other bonus does (the weapon loop is untouched; unfloored it is `dpsMult / (1 + boost)`). `chill` is the Sentenced's own cooldown-progress multiplier from Frost's chill (`SigFighter.chill`, 1 when not chilled): a chilled fighter lands fewer hits and each pays out the time it took, so **a slow on the cadence never cuts the mark** (spec 5: "Frost's slow does not reduce % damage"). Only the chill is paid back; a slowAttack status or any other cadence loss lowers the mark with the hits. The pulse is an ordinary ledger entry: the attacker's damage rows and the PvP factor multiply it (outgoing multiplier, kind `"other"`: no `hit`/`dot` mult of its own, so Boom's x2.5 and Slow Burn do not touch it), Trial's `takenFromSourceMult` x1.2 applies, it is true damage (nothing mitigates it), it makes a `hit` fx with `sig: "mark"` (not chunked: the mark is no longer damage over time), it feeds lifesteal and the combat clock, it is no contact (`contactsOf` skips `sig` entries), it cannot crit, and AP adds nothing to it (the AP-on-DoT rider is for burn and disease only).

**R5 The attack-speed tax (tier 2+).** While a Sentenced holds a mark of tier 2 or more on a fighter and that fighter is within `MARK_NEAR_RANGE` of it or inside its Trial ring, the fighter's attack rate `r` above `MARK_TAX_THRESHOLD` (1.0) keeps `tax_keep` (0.38 **tuned**) of its excess and is held to `tax_cap` (1.6): `taxed(r) = r <= 1 ? r : min(1.6, 1 + (r - 1) x 0.38)`. `r` is the fighter's faction attack rate times its card attack-speed multiplier (`min(AS_MULT_CAP, 1 + sums.attackSpeed)`; not the weapon's boost, not the Wishes' slows, not `asPost`). Plague 1.85 -> 1.323; Demon Blood 0.95, Fire 0.60, Frost 0.45 and Sentenced 0.95 are below 1.0 and untouched. It is a `world.modSources` entry (`asMult` factor `taxed(r) / r`) so the stat mirrors stay the one source of truth: the product goes through `capAsMult` and the encoder like any source, the mirror carries it to the client, and the weapon reads it at the next attack it starts. It works on mobs too (server side, no mirror). Several marks on one fighter tax it once. The source answers from `world.combat.marks` (R9), which is rebuilt in `beforeDamage`, and every change of the answer calls `recomputeMods` (a tier-2 promotion, a proximity flip, the mark ending).

**R6 Output suppression (tier 3+).** A fighter that carries a tier 3 or 4 mark deals `suppress` (0.8) of its damage: in the ledger's `applyVictim`, next to `damageFactor`, from the pass-start snapshot `world.combat.marks.suppressed` (tiers only change in `beforeDamage` and in `payLater` closures). It covers every entry of that attacker but the arena's burn (abilities included: it is a debuff like Trial's). It does not stack with Trial's `dealtMult` 0.8: a fighter already inside a Trial ring under 0.8 takes no further cut (`min`, one relative number), so the two never compound to 0.64. Proximity does not loosen it.

**R7 Execute denial, kill-stacks, the amplifier's linger (tier 4).** "Execute effects" are (a) Plague's execute (the `execute` part of the disease signature, now its own ledger entry flagged `execute: true`, same damage type as the disease), and (b) the extra a `vs hpBelow` damage row adds to a hit (Coup de Grace, Pestilence outside Plague; `outgoingExecuteShare`, sim/mods.ts: the share of the entry's outgoing multiplier that those rows contribute). While a Sentenced S holds a **tier 4** mark on a fighter P, P's execute effects cannot take **S** below 1 hp. In `applyVictim`, for a victim S with `world.combat.marks.denies.get(S)` containing P: after mitigation and the PvP caps, `N` = every entry's amount minus its execute part, `X` = the execute parts of P's entries; the allowed execute is `clamp(pool - 1 - N, 0, X)` with `pool` = hp + barrier as the pass began; P's execute parts are scaled down to it. Decided from pass-start state only, so no order decides it. When the denied amount `D = X - allowed` is above 0, queued with `payLater` (the pass is still collecting): the `executeDenied` hook runs, which for the Sentenced (a) sets `ampUntil = now + MARK_DENIAL_LINGER_MS` (2 s: the x1.17 amplifier outlives the mark by that long, so it survives P escaping and the mark breaking), (b) gives +1 kill-stack, once per mark (`markDenied` latch; a mob gets none), (c) toasts P "Execute blocked - already sentenced.", and (d) with Final Verdict, queues `D` as true damage back to P through `deferHit` (`final`, `passive`, next tick's ledger). Denial is only at tier 4, so a Plague that kills Sentenced early still gets its execute: a timing counter, not a lock. Other damage still kills S.

**R8 Kill-stacks.** `PlayerState.sentence` (0..`MARK_KILL_STACK_CAP` = 5): +1 for each PLAYER kill by a Sentenced fighter (the `playerKilled` hook, outcome `died`; bots are players; mobs, dummies and `mia` leaves count nothing), +1 once per mark for a denied execute (R7), reset to 0 at `raidStarted` (every run), not banked, kept through the teleport, never above 5. Each stack adds `mark_kill` to `pct` (a quarter of `mark_pct`, so five stacks are x2.25: the spec's 0.6 -> 1.35). Toast to the Sentenced when its marked target dies by it: "Your sentence has been carried out." A Sentenced-zone mob has no stacks (D7).

**R9 Proximity and Trial (spec 2.5, 3).** Beyond `MARK_NEAR_RANGE` (300 u) the pulse halves and the tax lifts; the mark itself does not decay. Inside the Sentenced's own Trial ring (the target carries a `zoned` status whose source is that Sentenced) the mark is at full strength whatever the distance. A hit can only land inside its weapon's reach, below 300 u, so the halving only ever shows for a projectile that was loosed in range and lands after the target has run: the tax is the part players feel. The server keeps the pass-start index `world.combat.marks` (`MarkIndex`: `suppressed` = fighters carrying tier 3+, `denies` = S -> the fighters whose execute S denies, `taxed` = fighters under the tax), rebuilt in `signatureDamage` after the tick's promotions and on every reset.

## 3. Trial retuned (spec section 3)

Unchanged: 0.35 s cast, range 400, line of sight, 5 s, the target deals x0.8 and takes x1.2 from the caster, walking or blinking out stuns the target 1 s, locked the first 45 s, 300 s cooldown. Changed:

- The ring is 300 u, and **200 u when the target carries a tier 3+ mark of the caster as the ring lands** (`convictedRadius` on the `zone` effect; the ring is born at 200: the client animates the contraction from the telegraph's 300, it infers it from `FieldState.r` below the def's `radius`).
- Inside the ring the mark is at full strength (R9): the pulse's proximity halving and the tax's range limit are off.
- **Gallows' Patience** (card): the zone lasts `GALLOWS_PATIENCE_EXTRA_MS` (2 s) longer and the escape stun is `GALLOWS_PATIENCE_STUN_MS` (1.5 s). The zone's exit stun is read at the cast and kept on the `FieldRuntime` (`exitStunMs`), so it survives a caster that leaves. `STATUS_RULES.zoned.maxMs` rises from 6000 to 8000 so the 7 s zone is not cut short.
- Respite (spec section 4) is not shipped (D5).

## 4. Cards (D6; `shared/src/cards.ts`, the catalog is 80 cards)

Five new cards, every text in mechanic terms (never a faction, "Sentenced", a weapon, a mob or a Wish's name; "your marks", "a marked enemy", "your zone Wish"). Each is a `flag` row (`EffectFlag` grows by `heavierSentence`, `swiftJudgment`, `gallowsPatience`, `noCommutation`, `finalVerdict`, appended), read through `hasFlag`.

| Card | Kind | Requires | Rule |
|---|---|---|---|
| Heavier Sentence | conditional, tier 2 | Vitality | `pct` is multiplied by `1 + 1.5 × (bonus hp / base hp)` **(tuned)**: +15% mark damage for every 10% bonus max health |
| Swift Judgment | conditional, tier 2 | Haste | every 2nd hit on a marked enemy counts as a weapon swap for the marks' tiers (R3) |
| Gallows' Patience | augment, tier 2 | - | the zone Wish lasts 2 s longer and its escape stun is 1.5 s (section 3) |
| No Commutation | augment, tier 2 | - | a weapon swap by a marked enemy promotes its mark two tiers (R3) |
| Final Verdict | augment, tier 3 | - | a blocked execute is paid back to its attacker as true damage (R7) |

Counts: 75 -> 80 cards (24 base, 13 conditional, 43 augment); `CONDITIONAL_IDS` 11 -> 13, `AUGMENT_IDS` 40 -> 43; every count in tests and docs follows. **Gathering Storm** keeps its `markRate` row and its title; its text becomes "Your marks climb their tiers 50% faster." and it now credits `1 + markRate` per hit toward the tiers (R3). Like the other cards that do nothing for some factions, all five are offered to everyone (the chest roll is build-blind; CLAUDE.md "Known TODOs").

## 5. Mobs (D7)

A Sentenced-zone mob is a Sentenced fighter through `factionOf` and marks players with the same rules and numbers: `mobFaction` scales `mark_pct` and `mark_kill` by its `k` (a pulse is a share of the PLAYER's pool, which is full scale: the same reason `execute` is scaled twice), `mobTypeFaction` by the type's `dmgMult`. A mob's mark can reach tier 4 and deny a Plague player's execute on it; it earns no kill-stacks. Its pulses carry the PvP factor for no one (a mob is not a player).

## 6. Sheet and the Python oracles (D10)

| | hp | rate | hit | phys / magic | armor | shield | params |
|---|---|---|---|---|---|---|---|
| Sentenced | 880 **(tuned)** | 0.95 **(tuned)** | 34.840203 **(tuned)** | 0.4 / 0.6 **(tuned)** | 135 **(tuned)** | 120 **(tuned)** | `mark_pct` 0.027 **(tuned)**, `mark_kill` 0.00675, `mark_amp` 1.17 **(tuned)**, `tax_keep` 0.38 **(tuned)**, `tax_cap` 1.6, `suppress` 0.8 |

`DAMAGE_PARAMS` (x k at duel pace, `pacedFaction`) gains `mark_pct` and `mark_kill` and loses `mark_ramp`/`mark_cap`; the old "ramp x k squared" is gone. `scaledFaction` (the power-level knob and the invariance test) leaves them alone: they are shares of the target's hp, which scales with the same knob. `testing/engine.py` is the source of truth the TS `duel()` mirrors: its `State` gains `foe_max_hp`, `own_hits`, `own_stacks`, `own_base_rate`; a mechanic's `PRESSURE` entry returns what it does to the opponent (`foe_rate` after the tax, `foe_out` the suppression, `deny_execute`); `rat_king` returns the execute as its own part. `realtime.py` adds the per-hit mark, the tax (a cooldown that changes at the start of the attack after the promotion), the suppression, the denial and the stack, so the harness's `--python` comparison stays exact in trades mode. `test_rpsls.py`'s identity rows for the mark are re-recorded.

## 7. Wire and schema (D11: append only)

`PlayerState` and `MobState` gain, appended after their last field: `markTier` (uint8 0..4: the strongest mark any Sentenced holds on this fighter), `markBy` (string: that Sentenced's id, "" for none), `markTax` (uint8: the attack-speed cut the tax is making, in percent, 0 for none). `PlayerState` alone gains `sentence` (uint8: kill-stacks 0..5). `sig` gets three bits on the marked fighter: `SIG_TAXED` 16, `SIG_SUPPRESSED` 32, `SIG_EXEC_BLOCKED` 64 (128 spare). `brand` keeps its meaning as the brand's growth, now `markTier x 25` (the existing sigil art keeps drawing). No new fx kind: the pulse is a `hit` fx with `sig: "mark"`. Toasts are ordinary `toast` events. `STATUS_KINDS`, `FIELD_KINDS`, `ABILITY_IDS` and the fx code tables do not change.

## 8. Tick placement and the architecture rules

Nothing is reordered. In `beforeDamage` (`signatureDamage`): contacts and targets as today; the mark step (distance break, swaps already counted by the hook, this tick's counted hits -> `hits`, `progress`, tier, one pulse each, `world.combat.marks` rebuilt, `recomputeMods` for a changed tax) before the Plague/Fire parts; then the ledger pass reads `world.combat.marks` (suppression, denial) as it stood at the pass start; `payLater` carries the denial's consequences; `afterDamage` writes the synced visuals. The mark is installed only with signatures on (a harness world with `signatures: false` has no marks, as before). Pulses are ledger entries (one way down, one place to settle); the tax is a mod source (the mirrors stay the one truth, `AS_MULT_CAP` applies); suppression and denial decide from the pass-start snapshot (no order dependence); kill-stacks live in synced state and are written in hooks and `payLater` closures.

## 9. How each spec item maps to code

| Spec | Code |
|---|---|
| 1 baseline | `shared/factions.ts` sentenced row; `classes.py` |
| 2 Marked, 2.1 tiers | `sim/factions.ts` mark step; `shared/signatures.ts` `markTier`, `markWeight`, `markPulsePct` |
| 2.2 tax | `shared/signatures.ts` `taxedRate`; `sim/factions.ts` `markTaxSource`; `sim/mods.ts` `cardAsMultOf` |
| 2.3 denial | `sim/ledger.ts` `applyVictim`; `sim/mods.ts` `outgoingExecuteShare`; `sim/factions.ts` `onExecuteDenied` |
| 2.4 kill-stacks | `PlayerState.sentence`; `playerKilled` and denial hooks |
| 2.5 proximity | `sim/factions.ts` `markNear` |
| 3 Trial | `shared/abilities.ts` `zone.convictedRadius`; `sim/abilities.ts` `zone` |
| 6 cards | `shared/cards.ts`, `shared/effects.ts` flags |
| 7 UI | the client reads section 10 |
| 9 checklist | section 11 |

## 10. What the client reads

`PlayerState.markTier`/`markBy`/`markTax`/`sig` on the marked fighter and `sentence` on the Sentenced; the nameplate's four pips are `markTier` 1..4 (grey, amber, red, black), dimmed when the marker (`markBy`) is farther than 300 u and the fighter is not inside a Trial ring (`FieldState.subject`); the tax icon with `-markTax%` when `sig & SIG_TAXED`; the broken skull "execute blocked" when `sig & SIG_EXEC_BLOCKED` (tier 4); `sig & SIG_SUPPRESSED` for tier 3+; the Sentenced's strip shows `Sentence: sentence/5`; the Trial ring is a `FieldState` of kind `zone` whose `r` is 200 for a convicted target (contract: animate 300 -> 200). The three toasts arrive as `toast` events.

## 11. Tuning (D9) and what moved

The saved WIP used 1050 hp, 20 hit, 90% physical hits, 150 armor, 240 shield and a 1.9% base pulse. It regressed the measured early median duel from main's 19.8 s to 32.2 s. The follow-up balance sheet retains 20% output suppression and the 0.38 excess-rate keep factor. It uses a 2.7% base pulse (5.4% at game pace), 0.675 percentage points per sentence stack, and a 1.17x tier-4 amplifier. Sentenced attacks at 0.95/s with 34.840203 base hit and a 40/60 physical/magic split. Demon Blood lifesteal is 11% + 85% of missing-health fraction, capped at 75%. These changes bring all four measured primary matchups inside the 60–76% win-share and 10–35% winner-health targets.

The owner also permitted changing other factions while preserving each faction’s two wins and two losses. After bounded Sentenced-only searches could not simultaneously satisfy the real-sim edges, model robustness and independent tax/suppression identity gates, D9's fallback was used: Frost's base hit changes from 175 to 170 (−2.86%), with no other Frost stat changed. Additional Plague/Holy buffs and Frost armor changes improved the real-sim margins but failed the unchanged jitter gates, so they were rejected. All five faction sheets and every parameter are checked for exact TypeScript/Python agreement. Current measurements, commands and remaining target misses are in `testing/TUNING_SENTENCED.md`; those misses are retained explicitly rather than relaxing any test thresholds.

Camp pulses use a fixed `1 / sqrt(N)` per-member share, where N is captured at mark start. A four-member group therefore takes a half-strength pulse on each member, with one group pulse batch per tick. A group keeps its mark and fixed divisor through member deaths. After the ledger settles, dead owners and ended targets are removed from the mark index in the same tick, and a surviving camp member becomes the new focus before visuals are synchronized. The pass-start index remains frozen throughout damage settlement.

The initial release (`6f06d9d`) retained two primary target misses. The follow-up shifts some pulse power from tier 4 to earlier hits and adjusts the physical share, closing those misses while retaining the counter cycle and unchanged robustness/identity thresholds. This accounts for the abstract weaponless oracle climbing tiers more slowly than actual weapon combat; the weapon-aware Python model and real sim remain the primary measurements. Exact results are in `testing/TUNING_SENTENCED.md`.

The baseline player-to-player factor is 0.77 (previously 0.75), with the same 3.0 ceiling and power scale 6. This adds 2.67% damage to fresh PvP fights across every faction, bringing the starter-duel median within its existing 26 s tolerance; player-to-mob damage and NPC strength are unaffected.
