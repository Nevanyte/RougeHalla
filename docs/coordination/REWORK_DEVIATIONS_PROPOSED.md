# Elite and augment rework: proposed DEVIATIONS rows (unsigned)

These rows are proposed by the rework packets (plan of record `docs/backlog/AUGMENT_ELITE_REWORK.md`, owner approval
2026-11-18). All are live-only: they apply when `SimConfig::augments` or `SimConfig::elites` is `Rework`
(`SimConfig::live_content()`). Parity, headless and test worlds keep Legacy and their fixtures, unless a row says
otherwise. Rows are numbered DEV-040 onward (the last signed row is DEV-039) in the `DEVIATIONS.md` format: ID,
category, legacy, port, reason, re-validation, reversibility, owner. Every Owner field is blank: the owner signs or
strikes each row. Once signed, the coordinator moves the row into `docs/DEVIATIONS.md`. Nothing here is signed by the
author. Integration numbers are those in `docs/MIGRATION.md`. Re-validation for a balance row is the loose proof the
packet's test gives, plus the workbook sheet named in the row; playtests may move the numbers (each is one registry row).

Reversal for every row: remove the Rework row or override and its hash fold; Legacy is already the default.

## Elites

### DEV-040 (balance): Rework elite numbers
- **Legacy:** an elite takes `ELITE_K` 0.65, hp x2.0 and damage x1.5 on top (`packages/shared/src/constants.ts:485`,
  `:513-514`).
- **Port:** under `EliteRule::Rework` an elite takes hp x1.5 and damage x1.0; `ELITE_K` is unchanged
  (`REWORK_ELITE_HP_MULT`, `REWORK_ELITE_DMG_MULT`).
- **Reason:** owner decision 2026-11-19, aiming at a 10 to 20% solo death rate at 12 banked camps.
- **Re-validation:** `camp_bench --elite`: the Duelist at 12 banked camps fell from 43.1% to 17.4%
  (`tools/balance-camps/elite_before.txt`, `elite_after.txt`).
- **Introduced by:** P-ELITE-TUNE-1 (integration 64; fix in 65). **Reversibility:** reversible. **Owner:** unsigned.

### DEV-041 (balance): elite helper share
- **Legacy:** an elite kill pays no stat stacks to anyone (it drops a chest only).
- **Port:** under Rework, every standing player in the elite camp's contributor snapshot, the killer included, gets 12
  stacks (one camp's worth) of the stat the camp's normal kills pay.
- **Reason:** plan decision 7: elites become a co-op activity.
- **Re-validation:** `share_tests` in `rh-sim` (killer plus helper paid, bystander not, survives checkpoint and hash).
- **Introduced by:** P-ELITE-SHARE-1 (integration 63). **Reversibility:** reversible. **Owner:** unsigned.
- **Unpinned edges (the brief flags them):** an elite killed with no killer pays nobody; "alive" means standing when
  the payout runs.

### DEV-042 (balance): the killer's 5 s first pick at an elite chest
- **Legacy:** the elite chest is shared and first-come (`packages/server/src/sim/chests.ts`).
- **Port:** under Rework, the credited killer (most damage, decision 6) alone may choose, or skip, for 5 s
  (`REWORK_ELITE_FIRST_PICK_MS`). The window ends at once if the killer is not standing; a killer not standing at the
  drop gets none. Others hear "Not yours". The window does not depend on the killer's distance from the camp.
- **Reason:** plan decisions 1 and 6.
- **Re-validation:** the P-ELITE-PICK-1 oracle (60% damage holds the window, the 40% last hitter does not).
- **Note:** the new `Chest::first_pick` field hashes an `Option` tag on every reward chest, so the state hash and
  checkpoint bytes move in Legacy worlds too (`rh-checkpoint/35`). Legacy behaviour and draws are unchanged.
- **Introduced by:** P-ELITE-PICK-1 (integration 65). **Reversibility:** reversible for behaviour; the hash tag stays.
  **Owner:** unsigned.

## Augment retunes and the pool

### DEV-043 (balance): the Rework augment numbers
- **Legacy:** the catalogue numbers (`packages/shared/src/cards.ts`, for example Gambler `:320`, one chance for both
  outcomes; `OUTGOING_ROW_CAP` 2.5, `constants.ts:242`).
- **Port:** 18 augments play the Augment_Tuning numbers: Tank Engine 1.5 HP a point (cap +350); Plant Your Feet +35%;
  Slow Burn -15% a second; Pocket Sand 40% for 1.5 s; Overkill 260 u; Third Time 2.5x; Spiked Shell 20%; Siphon 25%;
  Hemorrhage 12%; Second Wind 25% below 30%; Gambler 18% double and 12% half (two separate chances); Committed +22%;
  Glass Cannon -22% max health; Machine Gun 55%; Fists of Fury +50% attack speed; Here Comes the Boom 2.6x with
  `OUTGOING_ROW_CAP` raised to 2.6 (`HP_RACE_CAP` unchanged); Vampiric Pact +18%; Arcane Overload Wish cooldown x1.5.
- **Reason:** the workbook's Augment_Value finds 46 of 50 augments cheaper than a solo elite's risk; plan decisions 1, 2
  and 4.
- **Re-validation:** workbook sheet Augment_Tuning; `rework_content_tests.rs`.
- **Introduced by:** P-AUG-CONTENT-1 (integration 61; fix in 62). **Reversibility:** reversible, one row each.
  **Owner:** unsigned.

### DEV-044 (balance): Wishful Thinking
- **Legacy:** each landed hit cuts the Wish cooldown by 1 s, at most 30 s in a 60 s window
  (`packages/shared/src/constants.ts:278-280`, `cardHooks.ts:367-388`).
- **Port:** under Rework each hit cuts 1.5% of the Wish's full cooldown (after every cooldown multiplier), at most 20%
  in the window. The 50% floor and the rolling window keep their legacy meaning.
- **Reason:** Augment_Tuning; plan Appendix A.
- **Re-validation:** the P-AUG-TUNE-1 oracle. The Wish restore check was widened for reachable live states.
- **Introduced by:** P-AUG-TUNE-1 (integration 63). **Reversibility:** reversible. **Owner:** unsigned.

### DEV-045 (balance): the Rework chest pool and offer rules
- **Legacy:** the chest offers the 14 interactive augments (`packages/shared/src/rewards.ts:51-53`,
  `cards.ts:646-652`), every pick equally likely, with no faction-only rule.
- **Port:** the pool adds Committed, Fists of Fury, Machine Gun, Here Comes the Boom and A Race to 0, then the native
  cards. Faction-only cards (Corpse Hoarder, Stoked, Glacier, Trophy Hunter) are offered only when every eligible picker
  is that faction, and never in a chest with no picker. Eye for an Eye counts double in its tier's draw when any picker
  owns a returned-damage source (today Spiked Shell). Marked Man is a generalist card.
- **Reason:** plan decision 5. The weight 2 is the author's number (the workbook says only "offer more often"), so the
  owner should confirm it.
- **Re-validation:** the P-AUG-POOL-1 and P-AUG-NATIVE-4 oracles; Legacy draws are byte-identical.
- **Introduced by:** P-AUG-POOL-1 (integration 62; fix in 65), P-AUG-NATIVE-4 (70), P-AUG-NATIVE-5 (74).
  **Reversibility:** reversible. **Owner:** unsigned.

## Native cards (new in the rework; a row only where a rule is a decision, not a workbook number)

### DEV-046 (balance): Hazard Walker
- **Legacy:** none (a new card).
- **Port:** one stack a second spent on a hazard (cap 15), 4% hazard resistance and 0.5% of base max hp per stack; ice
  resistance and immunity use the same 4% a stack and 20 s. Each stack raises hp with max hp, so a holder gets up to
  7.5% free healing at 15 stacks.
- **Reason:** the three numbers are packet decisions, not workbook numbers; the stack healing follows from
  `sync_max_hp`.
- **Introduced by:** P-AUG-NATIVE-3 (integration 68), P-AUG-NATIVE-3c (74). **Reversibility:** reversible.
  **Owner:** unsigned.

### DEV-047 (balance): an immune Hazard Walker stops the world's hazard seconds
- **Legacy:** none for the card. The world counts ember, bog and ice exposure seconds for every player.
- **Port:** an immune holder's own `terrain.seconds` for ember, bog and (from 3c) ice stop counting. Nothing reads those
  counters today.
- **Introduced by:** P-AUG-NATIVE-3 (integration 68), P-AUG-NATIVE-3c (74). **Reversibility:** reversible.
  **Owner:** unsigned.

### DEV-048 (balance): Overflow
- **Legacy:** none (a new card); Second Skin is legacy (`cards.ts:181`).
- **Port:** the Overflow shield is capped by the G6 cap, and the 8 s fade covers every barrier the holder has, Second
  Skin included.
- **Reason:** packet decisions, not workbook numbers.
- **Introduced by:** P-AUG-NATIVE-3 (integration 68). **Reversibility:** reversible. **Owner:** unsigned.

### DEV-049 (balance): Wish Engine
- **Legacy:** none (a new card). `WISH_COOLDOWN_MULT_MIN` is 0.5 (`constants.ts:262`).
- **Port:** only landed casts count, each stepping the world's Wish row (Fire per charge), up to 25% in 5 minutes. The
  50% floor is the combined cooldown multiplier, so Wish Engine with Wishful Thinking can bring one cast to 0.375 of the
  row.
- **Introduced by:** P-AUG-NATIVE-3b (integration 72). **Reversibility:** reversible. **Owner:** unsigned.

### DEV-050 (balance): Marked Man's stacks
- **Legacy:** none (a new card); a normal kill pays 3 stacks (`MOB_KILL_STACKS`).
- **Port:** the holder's normal-mob kills pay +50% (4, 5, 4, 5 and so on; the half is carried in the native counter).
  Not multiplied: the elite helper share, player kills (no stacks in legacy), hunt stacks and every other source.
- **Reason:** plan decision 9 says "only normal-mob kills pay stacks" but is ambiguous on the helper share; the author
  chose not to multiply it, and the oracle pins that.
- **Introduced by:** P-AUG-NATIVE-5 (integration 74). **Reversibility:** reversible. **Owner:** unsigned.

### DEV-051 (privacy exception): Marked Man's public marker
- **Legacy:** none. Positions leave the server only for actors in the viewer's vision.
- **Port:** every Alive holder's id and position is sent to every viewer, as State key 15 (`Observation::marked`,
  `OBSERVATION_VERSION` 34, an optional key inside protocol 20), and drawn on every minimap. The C-OBS exception is in
  `docs/CONTRACTS.md`. Nothing else about the holder (hp, weapon, effects) leaks.
- **Reason:** plan decision 9; no existing public path (bounty, hunt, roster) carries a position.
- **Introduced by:** P-AUG-NATIVE-5 (integration 74). **Reversibility:** reversible; the wire key is optional.
  **Owner:** unsigned.

### DEV-055 (balance): Bastion's meter cap and a clipped burst
- **Legacy:** no Bastion card. The workbook gives only "Meter cap".
- **Port:** Bastion stores blocked damage up to `REWORK_BASTION_METER_CAP` 250 (the legacy Tank Engine cap number) and
  adds 35% of it to the holder's next landed weapon hit. A burst that the PvP hit cap clips still spends the whole meter.
- **Introduced by:** P-AUG-NATIVE-1b (integration 67). **Reversibility:** reversible (one row). **Owner:** unsigned.

### DEV-056 (balance): Stoked counts a burst when it is queued
- **Legacy:** no Stoked card.
- **Port:** Stoked's `BurstLanded` hook fires in `fire_roam.rs` when the burst is queued (`defer_hit`), not when its
  damage lands a tick later. A teleport or run end can count a burst that never hits.
- **Introduced by:** P-AUG-NATIVE-1b / P-AUG-NATIVE-4 (integrations 67, 70). **Reversibility:** reversible.
  **Owner:** unsigned.

### DEV-057 (balance): Glacier counts every chill source
- **Legacy:** no Glacier card.
- **Port:** `ChillInflicted` fires once per ranged chill and once per tick for each attack-chill source while the
  victim's chill is below 1. Every source counts, not only the strongest.
- **Introduced by:** P-AUG-NATIVE-1b / P-AUG-NATIVE-4 (integrations 67, 70). **Reversibility:** reversible.
  **Owner:** unsigned.

### DEV-058 (balance): native stat counters fold outside the card caps
- **Legacy:** card stats are bounded by the card caps and guards G1-G13.
- **Port:** Calluses and Glacier (armor), Executioner's Ledger (AD) and Stoked (AP) fold as farm-class rows
  (`modifiers::combined_farm_rows`, `native::fold_stats`), outside the card caps. Calluses and Glacier together can
  reach 60 armor.
- **Introduced by:** P-AUG-NATIVE-2 / P-AUG-NATIVE-4 (integrations 68, 70). **Reversibility:** reversible.
  **Owner:** unsigned.

## Bots and display

### DEV-052 (presentation): the Wish slot's charge count with Arcane Overload granted mid-recharge
- **Legacy:** the slot recomputes the recharge from the current `wishCooldownMult`, so a Fire player granted Arcane
  Overload while both charges recharge sees one charge back early (`packages/client/src/ui/abilitySlot.ts:93-100`).
  The server's `readyAt` is unaffected.
- **Port:** the owner view reads charges and the next charge off the stock clocks and shows the true count. Display only.
- **Introduced by:** P-AUG-NATIVE-3b-fix (integration 72). **Reversibility:** reversible. **Owner:** unsigned.

### DEV-053 (presentation): Marked Man marks on the maps
- **Legacy:** none.
- **Port:** the holder's own row is not drawn as a second mark; other holders show on the minimap and on the Tab map.
- **Introduced by:** P-AUG-UI-3 (integration 74; there is no brief file for it, the row comes from `MIGRATION.md`).
  **Reversibility:** reversible. **Owner:** unsigned.

### DEV-054 (balance, bots): bots' elite estimate
- **Legacy:** bots read the one (legacy) set of elite numbers.
- **Port:** in a Rework world, bots' in-match elite estimates (mob share, hunt hp) read the world's elite rule, so they
  match the sim. Only the spawn-time camp score (`plan_spawn_score_raw`, which runs before the match exists) still uses
  the Legacy elite numbers: it overstates a Rework elite (4/3 hp, 1.5x damage), which errs cautious (accepted in the
  P-AUG-BOTS-1 review).
- **Introduced by:** P-AUG-BOTS-1 (integration 73). **Reversibility:** reversible. **Owner:** unsigned.

## Not deviations

- **Plant Your Feet's range and ranged weapons** (P-AUG-PLANT-1, integration 60): legacy behaviour that was never
  ported (`packages/server/src/sim/weapons.ts:333-340`), applied in every world. Its brief says "No DEVIATIONS row: it
  matches legacy", so it has no row here. It does move Legacy-world hashes, and the hash tape was re-recorded
  (checkpoint 33). The +35% retune is in DEV-043.
- **Eighth Strike** (legacy has no Tenth Strike) and the other 13 native cards, with their Rework-only content rows: new
  cards with no legacy behaviour. Only the departures above are rows.
- **Content hash moves** (P-AUG-CONTENT-1, NATIVE-1a, ELITE-TUNE-1, TUNE-1, POOL-1 and later) and the checkpoint,
  observation, policy-contract and protocol 20 changes: identity bumps through the documented commands.
- **Test changes:** the coordinator's `oracle-amend:` commits, the Wish restore fixes for reachable states, the
  P-SYNC-ORIGIN-1-fix test and the card provenance refresh (P-CI-GREEN-7).
- **Own-card readouts, native card text and the first-pick countdown** (P-AUG-UI-1, UI-2): display of Rework rules, with
  no difference from legacy of their own.
