# P-CARDS-1 — complete authoritative cards and rewards (INCOMPLETE)

Phase: the card catalog/runtime foundation of [ORDER_OF_OPERATIONS](../../ORDER_OF_OPERATIONS.md) phase 1, serving the
backlog packet [P-CARDS-1](../backlog/packets/P-CARDS-1.md). Branch `deepseek/p-cards-1`, based on `856618eb`
(`optimization_port`) stacked over P-CONTENT-1. Content rule §6A: card effects are typed rows; this packet moves the
catalog to a generated, corpus-verified table and the build to the source count map.

## What this slice establishes

1. **The full 80-card catalog is data, generated from the accepted 409-case source corpus** (`parity/card-catalog/source.json`):
   `tools/card-catalog-fixtures/emit_cards.py` emits `crates/rh-sim/src/cards/{catalog,catalog_data}.rs` — 80 ids in source
   order, kind/tier/base/requires/unique/ready/title/text/tags, the complete typed effect rows (the eight folded kinds plus
   the full Vs/Scale/OnHit/Trigger payloads the stat-fold kernel deliberately projects away) and the two per-faction
   replacements (Plague's Cruel Wounds/Pestilence).
2. **Independent differentials** (`crates/rh-sim/tests/card_catalog.rs`): all 80 definitions and every row project back to the
   source JSON exactly; all seven selection entries per card; the 80 eligibility cases (view fields, held/count, owned,
   `cardPower`, and the complete `why`/`blocked` objects).
3. **The source build count map** replaces the three-slot subset: `Build` holds one count per card (base cards stack, unique
   cards once), `power` = Σ tier×count, and the fold gathers every owned card's rows into a fixed scratch with no per-step
   allocation.
4. **Protocol 7** carries the 80-byte count map (`WireBuild`), with the regenerated `protocol/fixtures/v7.json`, the Rust/JS/C#
   decoders and the Unity sync; browser proof PASS at protocol 7.
5. **The reward pools and the exact draw protocol are verified** (`reward_chests::pools`): the 14 interactive augment ids in
   source order, `conditionalPool`/`rewardAugmentPool` with held-by-all picker exclusion, the nearest-tier fallback with one
   tier draw plus one index draw per pick, the themed first slot and all five `ZONE_AUGMENT_THEMES`. The differential replays
   the corpus's **30 pool cases** and **181 roll cases** (options, every draw's cursor/value, final cursor, unused tape
   continuation). **Wired into `drop_augment`**: a chest drop now rolls the eligible pickers' full interactive pool with the
   real reward RNG and the source draw order. The legacy `parity/cards` option rows were recaptured from the legacy source
   without the old three-card restriction (the corpus now shows full-pool options such as Overkill/Third Time's the Charm)
   and the reward suite passes against them. This also closes the last terrain born-kernel partial case: the kernel is now
   **21/21 fully compared** (the old reward gap is gone).
6. **The first card runtime hook is live**: `cardHooks.onHitLanded` now applies the owned cards' on-hit rows after the
   weapon's special (Hemorrhage's bleed) with the source formula — the recorded hit normalized by the attacker's hit
   multiplier, scaled by the weapon's on-hit power (sword 1.5, fists 1.2), as a physical damage-over-time with the
   `bleed:<tick>` tag. Fists of Fury's multiplicity is also live: while the active hand is empty and the flag is owned the
   rows apply one extra time (fists 1.2 × 2 → 12/s in the test). Two focused tests pin the base 7.5/s and the doubled unarmed
   case. **Third Time's the Charm** is wired to the new card-state streak memory (`Player.card_streak`: target/count/last,
   read at the pass start by `streak_before` with the 3 s source gap): the third hit in a row adds an application, pinned by
   a seeded test (15/s). The **after-damage writer is ported** (`cardHooks.afterDamage` is no longer pending): it groups the
   tick's weapon hits from the existing scratch landed list by attacker, keeps a live streak when its target was hit (one per
   hit), else restarts on the biggest hit with the source tie rank, and writes the memory without allocating. **Best Offense
   blocks count as streak hits** under the `blockHits` flag (zero-damage notes on the blocked attacker), matching the source
   pending-block note. **Wishful Thinking** is now consumed too: the same group of hits trims a cast Wish's cooldown by the
   owned hit-trigger's 1000 ms each, at most 30 s in a 60 s window, never below half the cast cooldown, shifting the charged
   stock clock as well and recording the trims (`Player.card_trims`); focused tests cover the cut, budget, floor and window.
7. **Heal over time is a real system** (`factions.healOverTime` is ported): `start_over_time` spreads an amount over
   round(ms/500) equal steps through the ordinary heal funnel (the first now, the rest as `Player.card_hots` runs), and the
   scheduled system pays the due steps, drops the rest for a downed fighter and clears on raid start. A focused test pins the
   25-per-step spread of 100 over 2 s.
8. **The hpBelow trigger runner is live** (`factions.onHurt` is ported): the Hurt hook walks the owned cards' hpBelow rows; a
   `once` row fires the first time a hurt leaves the fighter below its threshold (remembered in `Player.card_fired`), a
   repeat row fires when the hurt crosses it, and a `Heal` with `ms` starts the heal-over-time run (without `ms` it heals
   at once). **Second Wind** is the reachable row and a focused test proves exactly one four-step run starts.
9. **Spiked Shell returns damage**: the on-hit hook first runs the victim's \`hitTaken\` rows; a \`Return\` above its max-hp
   threshold defers a physical hit back at the attacker (\`share x applied x returned multiplier\`, the victim's active weapon,
   passive entry for the next tick's ledger, the first real user of \`DeferredQueue\`). A focused test pins the 15 = 0.15 x 100
   return.
10. **Tank Engine's fortify is live**: the block hook dispatches the owned block trigger rows generically (Pocket Sand's status
   with the block tag, Tank Engine's fortify). Fortify adds the damage the block really kept (`mitigate_shares` over the
   prevented packet and the holder's armor/shield) to `Player.card_prevented` and earns `min(cap, tally x per)` flat max hp,
   which `sync_max_hp` adds on top of the folded maximum; a focused test pins the tally, the cap and the max-hp increase.
11. **Adrenaline's boost is live**: `start_boost` keeps a running boost's stronger factors (or starts over), extends the end,
   and the fold multiplies the final mirrors by the running attack/move factors; a lapsed boost stops contributing and is
   cleared by the after-damage system with a recompute. The hitTaken runner dispatches Boost/Status rows too, and a focused
   test pins 1.4x as/move for 2 s and the folded attack-speed increase.
12. **The teleport reset hooks are live**: `cardHooks.resetFight` clears every player's streak and running boost (recomputing
   when a boost was active) and drops pending heal-over-time runs; `cardHooks.dropDeferred` clears the deferred-hit queue on
   teleport and run end. Both schedule links moved from pending to ported, the parity trace and the arena inventory were
   updated, and a focused test pins the cleared fields.
13. **Overkill's splash is live**: the ledger fires the new `Overkilled` hook when a pass kills a victim with damage to spare,
   carrying the contributing entries and their raw shares; `cards::on_overkilled` records one splash request per kill row
   (share = raw × overkill/total, the victim's position, the card radius), and the after-damage system resolves each to the
   nearest standing hostile within the radius (excluding the holder/victim, same-faction players, immune and untargetable
   fighters) as a derived+passive hit for the next tick's ledger with the entry's damage shares and weapon. A focused test pins
   the share and the resolved hit on a third player.
14. **The folded damage rows reach outgoing damage**: the ledger multiplies every player entry by the source `outgoingMult` —
   1 + the folded damage sums, **G1-capped** so the row multiplier times the entry's own kind mult (hit/dot/returned plus the
   baked crit multiplier) never passes `OUTGOING_ROW_CAP` (2.5), with the farm damage added outside the cap; a fighter with no
   damage rows keeps the cap-only answer. The entry kind and the victim's pass-start hp fraction are read per entry. The
   `vs`/`scale` row tests are live too: the owned `Vs` rows whose test holds (elite, higher power, slowed, streak by hit
   count, third party, hp below, player above) and the stepped `Scale` rows (streak; camps-cleared needs the unported camp
   counter) add to the sum before the G1 cap, with the probe read from the victim's statuses/eliteness/build power and the
   attacker's pass-start streak on the victim.

## Measurements

- `cargo test --workspace --all-features --locked` (throwaway PostgreSQL): **1,401 passed, 0 failed, 3 ignored, 151 test
  binaries, exit 0** (after the full-pool drop, the 21/21 terrain kernel, the allocation-free on-hit hook, the Fists of Fury
  multiplicity, the streak memory, Wishful Thinking, heal over time, Second Wind's trigger, Spiked Shell's return, Tank Engine's fortify, Adrenaline's boost and the teleport resets).
- Catalog differentials: **2/2** (80 cards × all rows/selections; 80 × 4 eligibility entries incl. reasons).
- Protocol: Rust **11/11**, JS decoder **24 server vectors / 89 malformed / 10 chains / 15,454 checks**, C# **267/267**.
- Browser proof (`node tools/browser-proof/proof.mjs`): **PASS**, protocol 7.
- Reward pools/draw: **4/4** (30 pool cases, 181 roll cases, interactive order, five zone themes).
- Declared state change: the build map is hashed state, so this branch recalibrates the ability per-tick hash tape and
  `content_hash` (now `0x2835ca4eadc286bd`); the hash-coverage contract documents the new leaves.

## Still missing (the packet is INCOMPLETE)

- The reward/chest runtime over the verified pools (14-card interactive pool, theme/tier/distinctness/picker exclusion,
  exact roll draws), the chest choice/skip/expiry flow and grants that update the map.
- The card runtime/hook layer: `cardState` readers/writers, `cardHooks`/`onHit` multiplicity, streaks/stillness/bleeds,
  vs/scale contexts, guards G1–G13, and the wish/card coupling.
- Runtime source probes per family, mutant controls, and the packet's final accepted evidence.

No `DEVIATIONS.md` row; no coordinator-owned files touched.
