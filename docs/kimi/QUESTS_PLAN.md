# Quests: the unified plan

Status: design plan, nothing built. Written 2026-10-26 by the judge pass over three designs ("gank", "economy", "systems"), then revised the same day after a balance review and an exploit review. Section 10 lists every change the reviews forced. The plan starts from the "systems" design (highest score; scores and provenance at the end) and grafts the strongest ideas from the other two.

Tags on numbers: **M** measured in the real sim or on real maps, **r** read from code or docs, **m** model, **g** guess. File references are to the R5 line unless marked. Every `p` (success chance) and `q_d` (share of failures that end in an elimination) in this plan is a **g** until `bench/questBench.ts` measures it (section 4.6).

Reference scripts (the table in section 3 is their output, not hand arithmetic): `/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RougeHalla/2fecac89-094f-4d8a-a460-aef8d4be96c5/scratchpad/quests/final/final_price.py` (catalog and price model), `report.py` (tables), `sens.py` (pay scale by lobby size), `timeline.py` (wave schedule against deaths). The review scripts are in `.../scratchpad/quests/audit/` and `.../critic/`.

## 0. Baseline, verified today

The facts briefs disagreed about which tree has what. I checked the branch heads directly (`git merge-base --is-ancestor`):

| Tree | Head | Contains | Notes |
|---|---|---|---|
| `main` | 053bde0 | R0, Wishes | |
| `claude/roguelike-zones-e9adf2` (the **R5 line**) | e57d6c0 | main + Wishes + R3/R4a + owner rulings (0ea80bc, 626c2af) + R5 + R5 docs | `AS_MULT_CAP = 1.5` (`shared/src/constants.ts:217`), `MOB_K = 0.22` (:237), `WISH_COOLDOWN_SECONDS` 300 (:178), `WISH_LOCK_SECONDS` 45 (:180), fx `campCleared` 18 and `chestTaken` 19 (`shared/src/fxCodec.ts:76`). `main` can fast-forward to it. |
| `claude/r2-zones` | 4eb201f | R3/R4a + R2 (96x96 zones, map pool, mapHash) | No Wishes, no R5. |
| `claude/r3r4a-main` | 626c2af + 19 uncommitted files | already inside the R5 line | Someone is mid-change: `hurt` hook gains `hpBefore` (`sim/world.ts`), ledger, mods, planning and step edits, planning tests. |

So the "R5 has no Wishes / AS cap 1.25 / fx 14-15 collide" lines in the economy and architecture briefs are stale. The next free fx code is **20**. `CLIENT_MESSAGE_TYPES` ends `plan, cast, choose, train`. `GvReason` is `"kill" | "mob" | "elite" | "bounty" | "skip"` (`shared/src/messages.ts:202`). The R5 line is still on 64x64 wedge maps; the quest site recipe and walk times are for R2's 96x96 maps. The exploit review cites R5-line call sites of `isEvading` (`projectiles.ts:144`, `melee.ts:46`, `weapons.ts:249`, `targeting.ts:53`, `factions.ts:220`, `abilities.ts:114/504/515`); those line numbers are from that review and must be re-read when Q5 starts.

---

## 1. Goals and the owner's spec

### 1.1 The owner's request (condensed)
- The game plays like the jungle in League: farm camps, get stronger, duel, win or lose. Strength depends too much on where you spawn and what is near you. It does not feel interactive.
- Add a way to gank, and make players ask: keep farming, or risk it for a bigger reward?
- Add fetch, collection and kill quests that force players to the other side of the map.
- Rewards substantial, but quests must not be the only thing a player does.
- About 10 optional NPC quests per game: 5 known (with locations, for planning) and 5 unknown.
- Quests have timers, so a player cannot farm all the way to a quest.
- 20 quests with their relative balance. Time to complete about proportional to the time to get the same benefit from mobs, slightly more for the risk.

### 1.2 Owner rulings that bind this plan
- Chests are competitive: both players can claim, the first to choose gets it, a chest lasts 15 s with a countdown.
- Camps do not respawn.
- The first coliseum teleport is at minute 5 (flat 300 s after planning; only a death-free lobby keeps it exactly there).
- Persistent rewards are cosmetic GV only, and mob GV is capped (`GV_MOB_CAP` 30).
- Buff values were doubled. Mobs were weakened (`MOB_K` 0.22) so most starters clear a camp.
- Leaving during planning is a loss.
- Attack-speed cap 1.5, no cap on damage rows. Fed players may beat their counters; bounties and falling rewards are the brakes.
- Wishes are once-per-5-minute faction spells on D.
- The owner wants a League feel: ganks, risk against reward.

### 1.3 What the numbers say the quests must fix
- **Farming flattens early.** Farmed fight power P is 1.11 / 1.13 / 1.13 at 60 / 120 / 300 s with 8 players, 1.14 / 1.19 / 1.20 with 4, 1.17 / 1.23 / 1.24 with 2 (m). With 8 players about 55 of 80 map mobs are gone by 60 s at bot pace (m). With 4 or fewer, hp binds: a starter fits 1 to 3 camps before the 20% floor and nothing regenerates (m, r: no player regen in `sim/`).
- **Nothing makes players meet.** The whole 96x96 floor is within 22.2 s of any spawn (M), there is no fog, the minimap draws no other player (r), and the camera shows about 19% of the map (r). Today players meet only at contested chests and in the coliseum.
- **The farm rate in force while quests run is far below the first-minute rate.** Farm P per second is 0.0035 / 0.0006 / 0.0001 over minutes 0-1 / 1-2 / 2-3 at 8 players, 0.0046 / 0.0015 / 0.0004 at 4 players, 0.0055 / 0.0018 / 0.0007 at 2 (m, from the farmed-P table plus chests). From about minute 2 (8 players) or 3 (4 or fewer) until the teleport the run is dead time, and a death makes that window longer, not shorter (patience restarts at 120-300 s). Quests fill that window, and each quest gives the lobby a place and a time to arrive at together.

### 1.4 Design goals derived from the above
1. Every quest has a public clock and a fixed or visible place (an unknown quest gets both once it is found).
2. Whoever is exposed shows a tell: a carry glyph, pips, a claim on the board, a fuzzy minimap ping.
3. Every quest has a contest point (a site where arrivals fall within about 2 s of each other) or a mobile, visible target.
4. Price: risk-adjusted completion time, with the cost of an elimination in it, is 1.0 to 1.35 times the farming time for the same benefit; a claim quest's success time is at least 0.65 of it.
5. Quests are about 40-45% of a player's growth by the teleport, capped by a P budget (0.45 per run), not more.
6. The existing brakes (falling mob reward curve, bounty) keep working.
7. A quest is open or about to open at every moment until the teleport, whatever deaths and gate unlocks do to the patience clock.
8. Everything fits the architecture rules: pure sim, handlers only enqueue, fixed tick order, spoils after the ledger pass, wire tables grow at the end, hidden information never in synced state.

---

## 2. The framework

### 2.1 Building blocks
Every quest is one data row (`QuestDef`) built from the same parts. There is no per-quest code except four special rules (Idol drip, Sigils race, the Marked, the Convoy march).

**Five step verbs** (closed union with an exhaustive visitor, like `visitEffect`):
- `reach {site, r}`: the server position is within r of a site.
- `hold {site, r, seconds, uncontested}`: one tick per second while alive inside the ring. With `uncontested`, another living player in the ring pauses progress only while it has dealt or taken damage in the last 5 s; an idle blocker only halves the rate, so one idle callsign cannot deny a ring. Displacement out of the ring pauses the hold (it does not reset); a blink across the ring counts as leaving it.
- `take {site, item, channel?}`: pick up an item (sets `carry`) or gather it. The input itself is instant (range, line of sight, standing, like `choose`); a `channel` (the Stash's 4 s dig, a beacon's 3 s light) is cancelled by damage from a player, a stun or a silence.
- `give {site}`: hand over or deliver the carried item (instant).
- `slay {what, n}`: bound champions, a named camp (the holder credited with the kills), a wagon, or a player.

The overheads in the price (accept 1.5 s, pickup 1.0 s, touch 0.5 s, turn-in 1.5 s, g) are the player's reaction and the round trip, not channels: no accept or turn-in can be poked.

**Site roles** (the server picks concrete tiles): `node` (clear 3x3 site), `nook` (dead end with 3 or more solid sides), `camp`, `eliteCamp`, `gate` (a coliseum gate's outer lane), `pit` (coliseum centre), `ruin`, `body` (a death site), `ring` (a ring-road tile).

**Zone relations** on the 5-cycle (every zone touches exactly 2 others in 200 of 200 maps, M): `H` (the giver's zone; for a giver on the ring road, the zone that owns that ring tile), `adj(H)`, `opp(H)` (the two zones that do not touch H: 13.6 s pole to pole, M), `next(H, k)` around the cycle, and `emptiest` (section 2.5).

**Carry** (a `QUEST_ITEMS` row): a speed factor (0.95, 0.90, 0.85 or 0.75) and flags. `bright` announces the pickup to the lobby; `heavy` and `bright` carries **block Wish casts** while held (Swarm, Last Stand's +30% speed and Blaze Step would otherwise cancel the slow or make the carrier unclickable; the relic, the banner and the Idol are the heavy or bright ones; the light letter, vials, oil and sigils do not block); `fragile` breaks the item (section 3, Q03); `stealable` (default) drops at the body on death. A carrier's `wishReadyAt` is a public field and stays visible on its glyph as an intended gank tell.

### 2.2 Kinds
- **Fetch** = `take` then `give` (or a hold of a carried object).
- **Collection** = n units of `reach`, `hold` or `take` spread over zones or over time.
- **Kill** = `slay`.
- **Hybrid** = `slay` then `take` and `give`, or a chain of kills across zones.
The catalog has 6 fetch, 6 collection, 6 kill and 2 hybrid.

### 2.3 Two modes
**Claim** (13 quests: Q01, Q02, Q03, Q04, Q05, Q07, Q08, Q13, Q14, Q15, Q17, Q19, Q20). One holder at a time. The first accepted `quest` input in the tick (shuffled `actionOrder`, the chest rule) holds it. The board shows the holder's name, step and deadline to everyone.
- **Progress guard.** The first step must finish within 40% of the timer, and every 12 s the holder must be closer (straight-line, no path search) to its next target, or be fighting its bound target, or be inside a channel. Otherwise the claim is released: the quest returns to open with its **full window** (not the remainder), the window is extended by the time lost (never past the teleport clip), the player cannot re-claim it, and it counts as their attempt. A rival who accepts and idles therefore denies a quest for at most 12 s.
- **Focus.** While a claim is active, kills of regional camp mobs other than the quest's own target pay no stacks, GV, weapon drop or feed, and the holder cannot pick a reward chest (structured ack `focus`). The fights themselves still happen. This makes "you cannot farm your way to a quest" a mechanical rule, not only a slack rule (section 2.6).
- **Carry loss and stealing.** If the holder goes down holding a carry, the item drops at the body for 20 s. The first living player without a claim who picks it up (hops 1) carries it **to the quest's giver, not the receiver**, and is paid **50%** of the stack, heal and GV rows and no pick. A stolen item cannot be stolen again (hops at most 1; it vanishes if the thief goes down). The thief's deadline is the measured walk to the giver plus slack. Abandoning with a carry returns it to the giver at once; a carry leaves a player only by death or leaving, so it cannot be handed to a partner.
- If the holder goes down with no carry, abandons or runs out of time, the quest returns to open with its full window.

**Open** (7 quests: Q06 Idol, Q09 Sigils, Q10 Coin Rain, Q11 Whispering Shrine, Q12 Carrion Call, Q16 the Marked, Q18 Tax Convoy). No accept. Anyone acts on the public objects; the rule of each quest says who is paid. At 7 or more starters Q06 and Q18 have **two instances** (a second pedestal 8 tiles from the first; a second convoy on a different rim pair) so the crowd splits.

Why claim and not a free race: an exclusive claim makes one named player the target (the gank), lets a bound champion fight only its holder (no kill-stealing), and a player who sees "claimed by X" loses only the walk so far. The open-mode quests keep the race and the scramble where those are the point.

### 2.4 Lifecycle
Per quest (server `QuestRuntime`, not synced):
`hidden` (unknown, not revealed) or `waiting` (known, before it opens) → `rumor` (unknown: zone and a fuzzy disc are public) → `open` → `claimed(holder, deadline)` → `done` (paid, closed), or back to `open` (abandon, down, timeout, **released** by the progress guard), or `closed` (window over, teleport, run end).

Per player: `offered` (private, unknown quests) → `active` (one claim, personal timer) → `complete` or `failed` (timeout, down, leave, abandon, release, teleport, a fragile break). One attempt per player per quest.

### 2.5 Known and unknown, and how unknown quests are revealed
- **Known** (6 / 5 / 4 / 3 by lobby size, section 5). Drawn at planning start and written into the public `RaidState.quests` at once, so the planning screen shows each one's kind, open time, reward cards and its **public sites** (the catalog field `publicSites` says which: exact giver and endpoint for most; for Q01 the giver and three receiver candidates, which one is revealed privately at pickup; for Q13 the giver and the two far zones; for Q14 and Q19 the giver and the two reserved camps; for Q20 the giver and the three zones with the pack nodes private). The spawn pick becomes a bet: a camp-rich start, or a start near a rich first-wave quest. A known quest is never swapped or dropped after it is shown.
- **Unknown** (the same count again). Not in synced state at all until revealed (all synced state is public). Players see "N hidden quests". Each unknown row has one reveal rule:
  - `prox` (Q01, Q03, Q04, Q11, Q13, Q17). From 15 s before its open time, a public **rumor** names the zone and draws a fuzzy disc on the minimap (radius 12 tiles, centred up to 12 tiles off the real site; the centre is chosen so at least 8 candidate sites lie inside the disc, and the offset comes from the private quest stream). The reveal radius is **6 tiles (192 u)**, smaller than the disc, so finding the site is a real search (priced at +1.5 stacks and 10 s, section 4.2). The first player whose SERVER position comes within the reveal radius gets a private offer with the exact site, the steps and the reward. That finder and every other player within 288 u of the site at that instant form the claim group and hold a **4 s exclusive window** to claim it (claim exclusivity, not secrecy: all positions are public state, see section 6.3). A public announcement says "<name> found the hidden quest in <zone>" (no position). After 4 s the row becomes public with its site. If nobody finds it within 60 s of its open, the site is published anyway.
  - `time` (Q10, Q15, Q18 as unknown). At its open time the site is published to everyone at once. Coin Rain's open time is a fixed wave time, not "the first pop".
  - `chain` (Q20 as unknown). The completer of a named known quest gets a private reveal; it leaks to everyone 45 s later.
  - `event` (Q12, Q16). Q12 is a modifier, not a slot (section 3). Q16 arms at 0.5 of the live window (about 2:30) and only if it passes the leader test (Q16 note); if it never arms, its slot goes to the first unused eligible unknown def.
- **Slot fallbacks.** If an unknown slot's trigger or needs fail by its wave time, the slot is filled by the first unused eligible unknown def; the change is announced only for unknown slots and never for a known one.
- **Placement of unknown givers** (rumor time). In an "emptiest" zone: zone counts are averaged over the previous 30 s of server positions, the zone is drawn at random from the two emptiest, never the zone of the previous placement, never a zone already holding 2 givers, and the site is at least 8 tiles from any living player. A lone farmer or a pair that vacates a zone cannot steer it. Placing unknown quests where nobody is costs the nearest player +1.4 s and the median player +1.6 s (M, 100 maps); the +1.5 stacks pays for it.
- A refused `quest` input for a quest the player has not been shown answers exactly like a quest that does not exist, so probing reveals nothing.

### 2.6 Timers and when quests appear

**The owner's rule "a timer so you cannot farm all the way to a quest" is delivered by three things, in this order of importance:** (1) the **window**: waiting costs up to 30% of the payout and a missed window loses the quest; (2) the **focus rule** (section 2.3): kills in other camps pay nothing during a claim; (3) the **claim timer's slack**, which is deliberately small. The claim timer alone does not stop farming first: it starts at accept, when the player is already at the giver.

**Waves are fractions of the live patience window, not clock times.** Let `Wref = min(300 s, patienceEndsAt − run start)`. Wave k opens at `patienceEndsAt − (1 − f_k) × Wref`, with f = 0.15 / 0.30 / 0.45 / 0.60. In a death-free lobby that is the old schedule, 0:45 / 1:30 / 2:15 / 3:00 (m, `timeline.py`). The schedule is recomputed at every death and for waves not yet opened only:
- A death that **shortens** the window (small lobbies: a death at 60 s with 3 left alive teleports at 180 s) compresses the unopened waves proportionally into `[now + 10 s, patienceEndsAt − timerS − 5 s]` instead of dropping them.
- A death that **lengthens** it (8 players, a death at 120 s teleports at 384 s) re-times the unopened waves against the new teleport. If every wave had already opened, a **top-up** of `max(2, round(4 × alive / 8))` quests is dealt from the unused defs, opening at `patienceEndsAt − 0.55 × Wref` and `− 0.40 × Wref` (never before now + 10 s) whenever the open or scheduled quests would end more than 60 s before the teleport.
- Result (m, `timeline.py`, a schedule model, not the real sim): the last window closes 15-40 s before the teleport in every case checked (8 players with deaths at 60, 120 and 200 s, 7 with 200, 6 with 120, 5 with 60, 4 with 60, 100 and 150, 3 with 30 and 60, 2 with none). The fixed clock left 24 s, 84 s and 164 s of nothing for 8 players with the first death at 60, 120 and 200 s (m).
- **A death never voids a claim in flight.** `settle()` sets `patienceEndsAt = max(scaled, min(latest active claim deadline + 3 s, scaled + 30 s))`.

| Wave | Opens (death-free, 300 s) | Content | Why then |
|---|---|---|---|
| W1 | 0:45 | the open-mode pair: Tax Convoy plus the Idol or the Sigils | The 8-player camp rush is over (about 55 of 80 mobs gone by 60 s, m); Wishes unlock at the same moment (`WISH_LOCK_SECONDS` 45). Open-mode, so the nearest-spawn player gets no claim lottery (section 5). |
| W2 | 1:30 | claim quests that can start from anywhere, plus the first unknowns (rumor at 1:15) | 8-player farm income is flat from about minute 2 (m). |
| W3 | 2:15 | heavier quests, camp fights, unknowns | 4- and 2-player farm income flattens at minutes 2-3 (m). |
| W4 | 3:00 | the last unknowns | Last wave; windows clip at the teleport. |
| events | Marked 2:30; Carrion Call after the first eligible death, or armed at 3:00 | | |

**Seasons.** Season 1 is dealt at planning. A **season 2** of `max(2, round(4 × alive / 8))` quests is dealt at every gate unlock (the first death after a teleport) with 150 s or more on the new timer, from the unused defs, preferring ones that need no camps (Q01, Q06, Q07, Q09, Q10, Q16, Q18; never Q14 or Q19), all public rows at once, windows capped by the live teleport. The run cap is 16 slot-counted quests.

- **Windows** (`windowS`): 80 s at 8 starters, 90 at 6-7, 105 at 4-5, 120 at 2-3 (a smaller lobby has fewer contenders and farms out later). An open quest also ends at `patienceEndsAt − timerS − 5 s`, read live.
- **Decaying payout.** Stack, heal and GV rows are multiplied by `1 − 0.3 × elapsed / window` (floor 0.7), elapsed from open to the accept or scoring event. Picks and camp spoils do not decay. The table in section 3 prices a claim at the opening instant (a typical claim 20% into the window costs about 6%, inside the model's noise).
- **Claim timer** (`timerS`, personal, from accept) is computed **per instance after placement**, from the measured path: `ceil(measured legs at the carry speed + slack)`, `slack = clamp(0.15 × legs, 5, 9)` s. It covers walking, accepts, pickups, channels and holds. **Fight steps pause it** while the holder has damaged the bound target in the last 4 s; each fight has its own hard cap (Warden 45 s, camp 60 s, elite camp 60 s, gladiator wave 40 s, gauntlet pack 30 s). Where the next site is chosen later (Q01's receiver at pickup, a zone choice at accept), the deadline for that leg is issued then. Table values are nominal; no table value is used at runtime. The Highwayman's Writ is a 60 s hunt window, not a path timer.
- **Why this slack.** A median size-3 camp on the route costs 2.5 s of detour plus 8.6 s of clear = 11.1 s (13.1 s with its chest; M, `campDuel`). The nominal slack is 5.0 to 7.5 s, under 10 s with rounding, so a median camp does not fit (Fire clears a size-4 camp in 6.0 s on average, so a fast faction could squeeze one into the longest timers), and the focus rule makes it pay nothing anyway. The old rule ("always under the 18 s brisk camp cycle") assumed a detour camp and ignored `ceil5` rounding: Q20's old timer left 18.5 s.
- **Measured fit** (M, 100 R2 maps, the review): with fixed timers 5-16% of random-site instances were impossible even with perfect play (Q03 16%, Q02 11%, Q08 11%, Q13 11%, Q05 7%, Q01 5%). Per-instance timers make that 0% by construction, and 5 s of minimum slack covers an 8% click error on a 45-60 s run.
- **Teleport.** Everything closes, every carry vanishes, every champion parks or despawns, nothing is paid for unfinished steps. Cleared camps stay cleared; reserved camps are unlocked. Quests reopen only as season 2 at a gate unlock (above).

### 2.7 Competitive or personal
Competitive. Known quests are public rendezvous points with one prize each (claim mode) or a public scramble (open mode). Unknown quests are private first and public 4 s after discovery. Progress, private sites and timers are personal; payouts are first-come. This matches the chest ruling: the first to finish takes it.

### 2.8 Rewards (existing channels only)
- **Buff stacks** via `grantBuff` (`server/src/sim/buffs.ts:66`).
  - **Pick 1 of 2** live normal buffs of the quest's far zone (the "other side" pays in its own currency), shown on the card. If that zone has fewer than 2 buffs useful to the player's faction (Sentenced's only live normal is Bailiff, Sentenced-only; Frost's are both defensive), the free card is filled from the faction-neutral damage rows Ember Imp and Penitent. R4b will add more live options.
  - **Cards are sized to one value.** A quest reward is a power value (the stack count in the table is stacks of the median far-zone buff), and the server converts it per offered card so each card's own P equals the value within ±15% (a 3.2-stack reward is about 1.8 stacks of Magma Brute for a Plague player but 2.8 stacks of Ember Imp). The choice is a preference, not a bonus: the faction-and-zone luck that made the same quest worth 0.065 to 0.194 P is gone. The stack count is capped at the S-curve plateau (6.35).
  - **Drips** (Idol, Coin Rain, Carrion Call) pay whichever of Ember Imp and Penitent the player holds fewer stacks of (ties: Ember Imp); both are faction-neutral damage rows (+0.111 and +0.075 at 3.2 stacks, m), so a drip is priced like a card.
  - **Scaling.** Stacks and heals are paid × `QUEST_PAY_SCALE(N)` × the decay (section 2.6) × `mobRewardMultiplier(feed, medianFeed)` (`shared/src/buffs.ts`: the reward curve times catch-up), read at payout like a mob kill. A fed player's quests pay less: the owner's falling-rewards brake applies to quests. Picks are not scaled by the curve; the P budget is the brake for picks.
  - **Pay scale by lobby size** (m, sections 4.2 and 4.4): ×0.88 at 8 starters, 0.95 at 7, 1.00 at 6, 1.10 at 5, 1.12 at 4, 1.30 at 3, 1.45 at 2. The farm rate that quests are measured against differs by lobby size, so the same table would be 1.14 at 8 players and 1.63 at 2.
  - **Quest income cap.** A per-player P budget of **0.45 per run** (about two average quests), counted in the shared price function at the values actually paid. A reward that would exceed the budget is scaled to what is left, and a pick is converted to its value in stacks. The completion count cap (3) stays as a backstop. The three richest quests (Q19 .293, Q17 .270, Q09 .251, total .81 P in about 130 s of success time) are trimmed to 55% of that.
  - **Walk scale.** At placement the server measures the real legs with `findPath` and rejects a placement whose leg sum is outside 0.8-1.25 × nominal (retry up to 8 times with the next ranked candidate); the rows are then multiplied by `clamp(actual / nominal, 0.75, 1.40)` in steps of 0.05, shown on the card. The scale applies to stack, heal and GV rows; the pick is fixed, so the residual mispricing after the constrained placement is at most about ±8%. Measured legs on top-ranked sites: adjacent 8.9 s, opposite 13.8 s; on random recipe sites 10.0 s and 14.9 s (M, 100 maps).
- **Skill pick** = a claimant-bound reward chest (R5 machinery: `handleChoose`, `grantSkill`, `server/src/sim/chests.ts:117`) with 2 live passives (one of the far zone's when it has one, one neutral), only the holder may pick, 15 s, skip = the usual heal or GV.
- **Heal** through `heal()` (`server/src/sim/factions.ts:540`) with the 3 s out-of-combat lockout; whatever the lockout blocks is owed for up to 10 s. Bypassing the lockout would turn a turn-in under attack into a free escape and blunt the gank. **Each quest heals at most 15% of max hp and a player at most 40% in total from quests** (the chest-skip level is 15%): heal is the scarce resource at 4 players or fewer, and uncapped heals made "heal-bearing quests first, then farm" the dominant route.
- **GV**: 3 to 8 per quest, reason `"quest"`, into **its own pot capped at 24 GV per run** (`QUEST_GV_CAP`, section 8 question 7). Putting it in the mob pot (`GV_MOB_CAP` 30) would lose almost all of it at 4 players or fewer: mob GV is about 16, 24 and 30 by the time quests pay at 8, 4 and 2 players (m). A completed quest is required (abandoned or released pays nothing). `GvBreakdown` and the results UI gain a `quests` field; `ProfileStore` banks the same total (verify in Q2).
- **Stack transfer** (the Marked only) via `transferBuffs` (`server/src/sim/buffs.ts:84`): half of each buff, capped at 3 stacks per buff and 6 in total, as a bounty kill. Never stacked with a bounty transfer for the same kill.
- **Reveal**: a private message naming one still-hidden quest's site (Whispering Shrine).
- **Contested chest**: the Tax Convoy's wagon drops a standard R5 reward chest.
- **EHP note.** At most one defensive quest reward (Magma Brute, Ice Golem, Rime Stalker, Seraph Shard, Thick Hide) per player per run; later defensive cards are replaced by Ember Imp or Whetstone. This stops quests alone from stacking hp, but it does **not** protect the Holy-over-Sentenced flip bar (hp x1.28-1.30): Sentenced's best-3 farm reaches x1.254 and one Thick Hide chest (about x1.09, g) already reaches 1.37 before any quest card. The owner ruled that fed players may beat their counters, so this is documented, not fixed (owner question 17).
- No quest row is attack speed except a Plague Rat card from the Plague zone (cap 1.5, Plague Rat's plateau x1.168, r).
- No Wish cooldown reward in v1 (Wishes are flat; reductions never reach them, r: `sim/abilities.ts`).
- **Feed.** Each completed quest counts as 4 mob kills in the feed (+1.0 feed); each drip touch (coin, soul) counts as 1 mob kill. Quests never count toward the bounty (player kills only, ruled). Without this, a quest-heavy player keeps a low feed, gets full mob rewards and even catch-up while being strong.
- **Quest mobs** (champions, gladiators, the wagon and escorts) pay nothing themselves: no stacks, GV, weapon or feed. Only the quest pays. Camp quests (Q14, Q19) use real camps, whose own spoils pay as usual and are counted in the price.

### 2.9 Limits and anti-abuse
1. The client sends only `quest {n, act, o?}` (act: accept, use, abandon; `o` = a zone option at accept or an object index). Every check runs on the SERVER position with line of sight on `collisionMap(world)`, in order, each refusal a structured private ack that spends nothing: standing; not stunned or casting (`actionBlocked`); quest exists and was shown to you; open and not born this tick; in range (96 u for an NPC, 56 u for an object); line of sight; no claim of your own; not already attempted; under the completion cap and the P budget; quest-specific eligibility.
2. One active claim, one carry, at most **3 completions** and **0.45 P** of quest rewards per player per run, one attempt per quest.
3. A carried item changes hands at most once (`hops` ≤ 1); stolen cargo pays 50% to the thief and goes to the giver (section 2.3).
4. A leaver's carry drops at the body like a death. A target who leaves voids a PK quest with no refund.
5. **Bound champions** carry `boundTo = holderId` and a quest-group id. A new `isShieldedFrom(c, attackerId)` replaces `isEvading(c)` at every hit-test, targeting and signature call site (same behaviour when `boundTo` is unset), so a bound champion does not absorb a rival's arrow or swing and a non-holder's chill, mark or disease never lands. `hurtMob` zeroes non-holder entries per entry in the pass (a holder and a rival hitting in one tick credit only the holder), `killMob`'s credit loop reads the same arrays, and their hits on anyone else record at scale 0. Wake and aggro use the quest-group id, never an index into `state.camps`.
6. **PK payout guard** (Marked and Writ): a kill pays only if the victim had been alive at least 15 s since pickup or marking, had dealt or taken damage worth at least 25% of its max hp this run, and the killer has not been paid for that victim before. An accept-and-die partner pays nothing.
7. **Souls** (Carrion Call): the player credited with a death cannot take its soul, and a soul pays only if the dead player had dealt at least 25% of its max hp.
8. The Marked is chosen by the server; nobody is marked twice. PK quests need 4 or more starters.
9. **Hidden information** comes from a separate private stream with one sub-stream per quest (section 6.3) and travels only in private messages. Exact-position pings skip a Swarm-hidden fighter; names in announcements follow the chest precedent (a name is public, a position is not).
10. Acks are codes in the private message, never toast text (the R5 chest panel reads refusals from toasts, `client/src/ui/chestPanel.ts`, a known weakness).
11. **Status rules for quests.** A stun or silence cancels a channel. A displacement out of a hold ring pauses the hold. A bright or heavy carry blocks Wish casts (ack `wishBlocked`).
12. **Fragile Vials** break on any hit from a player or the first 20% of max hp lost to anything; mob chip below that and hazard ticks do not break them. A claim or channel interrupt that depends on the attacker reads `hitLanded` (its entry names the attacker) and defers the write with `payLater`.
13. Training never rolls quests. The `train` console gains `quest <id>` to place a practice quest that pays nothing.

### 2.10 How quests make ganks and the farm-or-risk choice
1. **The window and the focus rule.** Each open quest forces a choice: the camp in front of you (+0.13 P in 18-30 s while camps last, m) or the quest. Early, the camp usually wins (a fresh camp earns 0.0085 P/s, a quest P/E about 0.003, so a quest costs 2.2 to 3.1 times a fresh camp's time per P, m); from minute 2 (8 players) or 3 (4 or fewer) farm income is near 0 and the quest wins about tenfold. A player who farms first pays up to 30% of the payout in decay.
2. **The carrier is the bounty.** Slowed (x0.75 to x0.95), iconned, pinged on other minimaps as a blurred 300 u disc every 5 s, and announced when the carry is bright. Killing the carrier ends their run and lets the killer finish the delivery for half pay. A chaser 160 u behind catches a x0.85 carrier in 6.3 s (160 / 25.5). The receiver is not a public point (Q01: one of three candidates, revealed at pickup), so a hunter must follow the carrier, not wait at a spot published at planning (the review measured a rival within a 16 s carry of a random public receiver in 86% / 99% / 100% of cases at 2 / 4 / 8 players).
3. **Public claims turn sites into traps.** The board shows who holds what, the step and the deadline. A holder can abandon to fake.
4. **Funnels.** The four gates (128 u wide; first and second arrival within 2 s in 58% of 8-player cases, M) and the pit: Four Gates, Idol, Gladiator Pit and the Sigils altar. At most 2 of these per game.
5. **The weakened winner.** Warden, Elite's Banner, Trophy Run and the Convoy leave the winner at about 55-70% hp on a known spot, often next to a 15 s contested chest.
6. **Pop-ups.** Coin Rain and Carrion Call are the scuttle crabs: short fuses, a ping, and every pop is where nobody is (coins) or where a fight just ended (souls).
7. **Hunt the leader.** The Marked is chosen only when it is a real leader, pinged and crowned; it chooses to hide, farm or bait. Its killer takes up to 6 of its stacks.
8. **Hunt the couriers.** The Highwayman's Writ gives its holder exact, continuous blips of every carrier for 60 s.
9. **Follow the finder.** An unknown quest's finder is named with the zone, and its site goes public 4 s later.
10. **One lobby-wide pull in every game.** The Tax Convoy is always in the known draw as a W1 quest, a public moving brawl on a public route that every player can see on the minimap, whether or not they chose to do quests.
11. **Planning.** The known quests make the spawn pick a strategic bet.
12. **Wishes.** Blaze Step (a 300 u blink) and Last Stand's speed are blocked while carrying a heavy or bright item; Freeze and Trial by Combat stop a carrier; Swarm cannot be cast on a heavy or bright carry. Light carries keep their Wish, so completion is reported by faction and Wish-ready state.

---

## 3. The 20 quests

Abbreviations: **st** = stacks of the median far-zone buff at feed 0 (sized per card, scaled by pay scale, decay and the reward curve); **pick** = a 1-of-2 skill pick; **T** = time to succeed from a typical position; **p** = success chance (g); **E** = expected time per payout with the risk and elimination premia (section 4.2); **P** = fight-power gain at full pay; **Mob-eq** = P / R (R = 0.004 P/s at the 6-player reference); **Ratio** = cost per attempt / expected P per attempt in units of R. All rows are at the 6-player reference and pay scale 1.0; section 4.4 gives the other lobby sizes. "Timer" is the nominal claim timer (legs only, fight steps pause it and have their own caps) for claim quests, the window (80-120 s) for open ones. For winner-take-all open quests p is shown as p_skill / contenders. As-unknown reveal rules are in brackets.

| ID | Name | Kind | K/U | Where | Steps | Timer s | E s (T, p) | Reward | P | Mob-eq s | Ratio | Risk and gank hook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | Sealed Letter | fetch | KU [prox] | giver H, receiver one of 3 nodes in opp(H), revealed at pickup | accept, carry x0.85, deliver | 26 | 39.2 (31.1, .80) | 3.5 st + heal 8% + 3 GV | .136 | 34.0 | 1.15 | 16 s slowed and pinged; a thief returns it to the giver at 50% |
| Q02 | Pilgrim's Relic | fetch | K | shrine H, relic opp(H) | walk out, take (announced), carry x0.75 back | 42 | 65.0 (47.1, .70) | pick + 3.5 st + heal 8% + 4 GV | .216 | 54.0 | 1.20 | heavy and bright: named to all, no Wish casts |
| Q03 | Fragile Vials | fetch | KU [prox] | giver H, vials next(H,1) and next(H,2) | 2 pickups, carry x0.95 home; breaks on a player's hit or 20% hp lost | 44 | 60.8 (48.7, .75) | pick + 2.5 st + heal 15% + 4 GV | .206 | 51.5 | 1.18 | denial: one ranged poke ends it |
| Q04 | Smuggler's Stash | fetch | U [prox] | hidden giver, private nook in adj zone | find, accept, 4 s dig, carry x0.85 back | 32 | 56.2 (47.3, .80) | pick + 3.6 st + 4 GV | .185 | 46.2 | 1.21 | dead-end dig with a public dust plume; follow the finder |
| Q05 | Signal Fires | fetch | K | well H, beacons next(H,1), next(H,2) | carry oil x0.90, light 2 beacons (3 s channels) | 34 | 48.4 (39.2, .80) | pick + 2.5 st + heal 5% + 4 GV | .162 | 40.5 | 1.20 | each lit beacon pings every minimap 25 s |
| Q06 | Idol of Embers | fetch | K | pedestal(s) at the pit | hold the Idol: 1 st per 5 s (cap 4), x0.90, bright | window | 42.4 (29.1, .70) | drip, 4 st cap; a loss banks what was held | .121 | 30.3 | 1.28 | hot potato: kill the holder, take the Idol and the drip |
| Q07 | Four Gates | collection | K | the four gate lanes | hold each gate ring 5 s (a blocker pauses only while fighting, else half rate) | 42 | 66.1 (44.5, .65) | pick + 3.6 st + heal 8% + 4 GV | .220 | 55.0 | 1.20 | the busiest funnels on the map |
| Q08 | Cartographer's Survey | collection | K | giver H, stakes next(H,1..3) | touch 3 stakes, return | 54 | 65.1 (57.4, .85) | pick + 4 st + heal 5% + 4 GV | .223 | 55.8 | 1.17 | 45 s in the open, touches ping |
| Q09 | Sigils of the Five | collection | K | one sigil per zone, altar at the pit | open race: take 3 sigils (public pips), bank at the altar | window | 112.1 (33.6, .75 / 2.5) | winner: pick + 3.6 st + heal 15% + 5 GV; others 1 st per sigil (max 2) | .251 | 62.7 | 1.31 | pips are a public bounty ledger; dead carriers drop all sigils |
| Q10 | Coin Rain | collection | U [time] | 8 pops, each in an emptiest zone | touch piles (1.1 st each, max 3) | window | 49.1 (34.2, .65) | 3.3 st + heal 15% on the 3rd | .159 | 39.7 | 1.24 | pop interval (window - 30) / 8, 30 s per pile; each pile is a cross-zone sprint |
| Q11 | Whispering Shrine | collection | U [prox 6 tiles] | hidden node, emptiest zone | hold the ring 12 ticks; pulse at tick 6 | 25 | 45.2 (32.9, .70) | pick + 1 st + heal 15% + a reveal + 4 GV | .159 | 39.7 | 1.14 | the last 6 s are a siege |
| Q12 | Carrion Call (modifier) | collection | U [event] | souls at death sites | touch a soul (25% hp dealt rule), max 2 | window | 27.3 (12.4, .55) per soul | 3 st + heal 6% + 2 GV per soul | .107 | 26.7 | 1.02 | the vulture: third parties come to every fight's end |
| Q13 | Slay the Warden | kill | KU [prox] | giver H, Warden in either far zone of opp(H), chosen at accept | walk, kill a bound champion, walk back | 36 + fight 45 | 68.8 (53.5, .72) | pick + 2.6 st + heal 15% + 6 GV | .210 | 52.5 | 1.31 | about 45% hp (g), then a hurt walk home |
| Q14 | Trophy Run | kill | K | giver H, a reserved 4+ camp in either far zone, chosen at accept | clear it (3 trophies), take the chest, return | 33 + fight 60 | 57.5 (48.4, .80) | heal 15% + 4 GV + the camp's own spoils | .186 | 46.5 | 1.24 | about 38% hp (M); a hurt, slowed holder 11 s from home, chest up |
| Q15 | Gladiator Pit | kill | KU [time] | lanista at the pit | two bound waves of 3 | 11 + 2 x fight 40 | 52.7 (37.3, .70) | pick + 1.5 st + heal 15% + 6 GV | .172 | 43.0 | 1.22 | about 2 x 19% hp (M), rooted in the pit |
| Q16 | Hunt the Marked (bounty) | kill | U [event] | wherever the leader is | kill the Marked within 90 s | window | 113.4 (27.0, .50 / 1.5) | killer: pick + up to 6 stacks of transfer + 8 GV; each other hunter with 20% of its hp: 2 st | .230 | 57.5 | 1.47 | a duel with the strongest player; the Marked is paid to survive |
| Q17 | Highwayman's Writ | kill | U [prox] | hidden fence near the ring road | 60 s: exact blips of carriers, kill one | 60 (fixed) | 78.6 (45.4, .60) | pick + 2.4 st + heal 10% + 4 GV + the cargo at 50% | .270 | 67.4 | 1.16 | an alert target; you are named at discovery |
| Q18 | Tax Convoy | kill | KU [time] | wagon marches rim X to rim opp(X), forced into the known W1 pair | hit the wagon anywhere on its public route | window | 38.9 (25.0, .65) | top 3 damage dealers (15% of the wagon each): 2 st + heal 15%; contested chest | .135 | 33.8 | 1.15 | a moving fight anyone can join |
| Q19 | Elite's Banner | hybrid | K | giver (a ring-road node) H, a reserved elite camp in either far zone, chosen at accept | clear the elite camp, carry the banner x0.90 home | 33 + fight 60 | 91.9 (54.2, .55) | pick + heal 10% + 8 GV + the camp's own spoils | .293 | 73.2 | 1.25 | about 45% hp (M), then a bright, blocked-Wish carry |
| Q20 | Gauntlet of Three | hybrid | KU [chain] | giver (a ring-road node) H, packs in next(H,1..3), nodes revealed one by one | walk, kill a bound pack of 2, three times | 35 + 3 x fight 30 | 81.4 (58.6, .65) | pick + 3.6 st + heal 15% (5% per pack) + 8 GV | .251 | 62.7 | 1.30 | each fight is visible; the holder arrives lower in each zone |

Summary: ratio 1.02 to 1.47 (income rows 1.14 to 1.31, Q16 is the one bounty row, Q12 the modifier), mean 1.22. P per quest 0.107 to 0.293, mean 0.195. Mean T 40 s, mean E 63 s. Kinds 6 / 6 / 6 / 2. Suitability: 8 known-only, 6 unknown-only, 6 either. 13 claim, 7 open. Success-time ratio (T / Mob-eq) 0.46 to 1.04; the claim quests are 0.67 to 1.04 (Q17 .67 is the lowest), the open lotteries and the modifier are 0.46 to 0.96 (Q09 .54, Q16 .47, Q12 .46). Against a fresh camp (0.0085 P/s) every quest costs 2.2 to 3.1 times as much time per P (section 4.5). Unknown draws of the proximity-revealed KU quests are priced +1.5 st and +10 s of search: Q01 1.11, Q03 1.09, Q13 1.20.

Where each quest sends players: 10 send them to a far zone or across three zones (Q01, Q02, Q03, Q08, Q09, Q13, Q14, Q19, Q20, and Q18's rim to rim route); 2 to an adjacent zone (Q04, Q05); 2 to the zone nobody is in (Q10, Q11); 3 to the coliseum funnels (Q06, Q07, Q15); 3 follow players (Q12, Q16, Q17).

### 3.1 Notes per quest
**Q01 Sealed Letter** (fetch, claim, known or unknown). Postmaster at a `node` in H; three candidate receiver `node`s in opp(H), all public; the real one is drawn from the Q01 sub-stream at pickup and sent privately. Accept, take the Letter (carry x0.85, light, stealable), walk 13.8 / 0.85 = 16.2 s, deliver. T = 10.9 + 1.5 + 1.0 + 16.2 + 1.5 = 31.1 s. The timer for the delivery leg is issued at pickup from the measured path to the real receiver (nominal 26 s). A thief delivers it back to the Postmaster for 50% (3 GV, 1.75 st, 4% heal, no pick). As unknown: the Postmaster is hidden (prox), +1.5 st and 10 s of search.

**Q02 Pilgrim's Relic** (fetch, claim, known). Shrine (giver and turn-in) at a `node` in H; the relic on a plinth in a `ruin` in opp(H), else a `node`. Walk out 13.8 s, take it (1 s): the lobby is told your name, and you carry it heavy (x0.75, gold light, Wish casts blocked). Walk back 13.8 / 0.75 = 18.4 s. The announcement is the point: everyone knows who to hunt, and where the relic started.

**Q03 Fragile Vials** (fetch, claim, known or unknown). Vial 1 in next(H,1), vial 2 in next(H,2), home to H (non-adjacent, 13.8 s). Carry x0.95. The vials break on any hit from a player or the first 20% of max hp lost to anything; mob chip below that and hazard ticks do not break them (read through `hitLanded` with `payLater`: its entry names the attacker). A denial gank: one ranged poke ends a 49 s run without a kill, so it prices at p 0.75, q_d 0.08.

**Q04 Smuggler's Stash** (fetch, claim, unknown only). Stranger at a hidden `node` in an emptiest zone; the stash in a private `nook` in an adjacent zone. Find (prox, 6-tile reveal; +10 s search is in T), accept, walk 8.9 s, dig 4 s (a hit from a player, a stun or a silence restarts it; a public dust plume object appears at the nook when the dig starts), carry x0.85 back (10.5 s). The nook has one exit, and the finder is named when the quest is found.

**Q05 Signal Fires** (fetch, claim, known). Oil well in H, beacons in next(H,1) and next(H,2). Carry oil x0.90, light each beacon with a 3 s channel that a hit from a player, a stun or a silence interrupts; each lit beacon pings every minimap for 25 s. Lighting beacon 2 completes it, so the second beacon is a public 3 s kill window that a hunter can reach first.

**Q06 Idol of Embers** (fetch, open, known, W1 pair). Pedestal at the pit (two pedestals at 7+ starters), reachable through the four gates before the teleport. The pit is equidistant from every pool spawn (all within +-8% of one walk, M), so nobody has a spawn lead. G on the pedestal takes the Idol (x0.90, glow, bright: announced, Wish casts blocked, a fuzzy ping on other minimaps). Every 5 s held pays 1 stack of the drip (cap 4 per player). A holder who goes down drops it at the body; whoever takes it continues the drip. A voluntary drop returns it to the pedestal after 4 s. Pay per second means losing it still banks what you held. A 20 s hold prices at ratio 1.28; the cap was cut from 6 to 4 so the drip is not worth more than a card.

**Q07 Four Gates** (collection, claim, known). Gatekeeper at the gate lane nearest H. Hold each of the four gate rings (3-tile radius) for 5 uncontested seconds; each gate keeps its progress; the hop between gates is 19.8 / 4 = 4.95 s (ring lap 19.8 s, M). Another living player in the ring pauses you only while it has dealt or taken damage in the last 5 s (it attacks you, or you attack it); an idle blocker halves the rate. No hp cost beyond the fights it invites, but the busiest funnels on the map.

**Q08 Cartographer's Survey** (collection, claim, known). Survey stakes in next(H,1), next(H,2), next(H,3); touch each (1 s, a 5 s ping), return to H. Legs 3 x 8.9 + 13.8 = 40.5 s. The longest exposure without a fight, so the highest p (0.85); the interim 20% trim took it from 5 to 4 stacks.

**Q09 Sigils of the Five** (collection, open, known, W1 pair). One sigil at a `node` in each zone (public), the altar at the pit (two altars at 7+ starters). Touch a sigil (0.5 s, consumed) to gain a public pip (max 3, carry x0.95, light). The first to bank 3 at the altar wins the pick, 3.6 st, 15% heal and 5 GV. When someone wins (or the window ends) every other player is paid 1 stack per sigil still held or banked, at most 2 (the winner needed 3 of 5). A carrier who goes down drops every sigil at the body. p is priced per contender: 0.75 / 2.5 contenders = 0.30, with the consolation counted. The race ends in the pit, where arrivals bunch.

**Q10 Coin Rain** (collection, open, unknown only). Eight coin piles pop at even intervals across the window minus 30 s, each at a `node` in an emptiest zone at that moment (never the same zone twice in a row), each lasting 30 s with a pin and a countdown. Touch (0.5 s) = 1.1 stacks of the drip; a player's third pile adds a 15% heal; max 3 piles per player (8 piles for 8 players: the scarcity is real but nobody is shut out). One near pile is a bargain (5 s away), a far one is not; three piles price at ratio 1.24. The rumor is 15 s before its fixed W3 open time.

**Q11 Whispering Shrine** (collection, open, unknown only). A hidden shrine at a `node` in an emptiest zone. Coming within 6 tiles reveals it privately (the disc offset is up to 12 tiles). Standing in the 3-tile ring counts 12 ticks (one per second; another living player in the ring pauses you only while it fights, else halves the rate; you have 25 s from your first tick). At tick 6 the shrine pulses on every minimap for 5 s with your name. The reward includes a private reveal of one still-hidden quest. Its heal was cut from 28% to 15% and replaced by 1 stack.

**Q12 Carrion Call** (collection, open, modifier). Not one of the 5 unknown slots: it is armed in any lobby of 3+ starters at the first player death after 0:45, or at 3:00, whichever is first, and it never takes a slot, so a death-free lobby loses nothing. For 120 s every player death leaves a soul at the body for 30 s (public glow and ping). Touch a soul (0.5 s) for 3 stacks of the drip, 6% heal and 2 GV; max 2 per player. The player credited with that death cannot take its soul, and a soul pays only if the dead player had dealt 25% of its max hp. Priced per soul at ratio 1.02 (12.4 s, p .55, the fight's winner is standing there).

**Q13 Slay the Warden** (kill, claim, known or unknown). At accept the claimant picks one of the two far zones of opp(H), each shown with its faction, a matchup tint and its buff cards. A bound elite-class champion (`ELITE_K` of that zone's faction, hp scaled by the claimant's faction clear speed, section 6.3) spawns when the holder is within 320 u of its node, never at accept or reveal. Only the holder can damage it and it fights only the holder. The timer pauses while the holder is engaged (cap 45 s), then 13.8 s home at about 55% hp. It needs a `mobDuel` pass per faction and zone pairing before Q5 ships (target: 20 of 25 starter pairings win; elite camps clear in 9 of 25 today, M).

**Q14 Trophy Run** (kill, claim, known). Q14 reserves the hardest 4+ camp (a 5-spot camp when there is one) in **each** of the two far zones at planning: the reserved camp's mobs cannot be damaged by anyone and never aggro, drawn with a lock glyph on the minimap and the planning map. At accept the claimant picks one; the other unlocks at once. After accept the camp is bound to the holder. Each mob the holder is credited with drops a trophy pip (x0.95 carry); 3 are needed. The camp's own spoils pay as usual and are in the price (4 kills at 0.015 P plus the chest 0.06); take the camp's standard contested chest, walk back 11.1 s. If the window closes unclaimed, both camps unlock. This replaces "pick an uncleared camp at open", which could leave a known quest with nothing to open. At most one camp-reserving quest per season.

**Q15 Gladiator Pit** (kill, claim, known or unknown). Lanista at the pit. Accept, then a wave of 3 bound gladiators (`MOB_K`, a random zone faction), a 3 s gap, a second wave of 3 spawned only after the first dies. About 2 x 19% hp (size-3 camp, M). Rooted by windups in the one arena every route leads to. The timer pauses during each wave (cap 40 s each).

**Q16 Hunt the Marked** (kill, open, unknown only; needs 4+ starters). At 0.5 of the live window (about 2:30) the server marks the living player with the highest estimated power (`estimatePower`: max hp times the mod mirrors' attack-speed, armor and shield terms), but only if its feed is at least `max(2.0, median feed + 1.0)` and it has at least 1 player kill or 2 completed quests; the check repeats every 15 s until 60 s before the teleport, and a never-armed Marked releases its slot. Crown, and a fuzzy public minimap ping every 15 s for 90 s. The killer gets a pick, half of the Marked's stacks (at most 3 per buff and 6 in total, `transferBuffs`), 8 GV, plus the normal kill GV and bounty. Every other hunter who lands 20% of the Marked's max hp gets 2 stacks. If the Marked survives 90 s it gets a 20% heal and 4 GV, but only if no hunter landed 30% of its max hp (survival by evasion, not by being untouchable). The PK payout guard applies. This is the one **bounty** row: priced as a lottery with 1.5 self-selecting contenders (ratio 1.47, 1.33 at 8 players, 1.64 at 4), because only a hunter who thinks it will win should enter; it exists to break snowballs, not as income, and it is excluded from the income band (section 4.5).

**Q17 Highwayman's Writ** (kill, claim, unknown only; needs 4+ starters and at least one carry quest in the draw). The fence stands at a hidden `node` near the ring road (prox, 6 tiles). For 60 s after accept, the holder's minimap shows every quest carrier as an exact blip (a blip every 4 s; the Writ is the one source of exact carrier positions). Kill a carrier: the writ pays, and the dropped cargo is yours to take (hops 1, delivered to its giver at 50% for its own reward). The cargo is priced in (+0.09 P) and the Writ's own rows were cut by the same amount (stacks 4.5 to 2.4, heal 15% to 10%) so hunting couriers does not beat doing quests. The PK payout guard applies (15 s of carry, 25% hp dealt or taken, once per pair).

**Q18 Tax Convoy** (kill, open, known or unknown, always in the known W1 pair). A wagon (2.5x a normal mob's hp, does not attack) and 3 escorts (0.8x damage, normal hp, the start zone's faction) march from a rim `node` of X across the ring road to a rim `node` of opp(X) at x0.65 speed (about 23 s), stand 20 s, then leave. The route is drawn on every minimap (clients compute it with the same `findPath` from the public start and end, so it is not synced). Escorts wake on a hit (camp-wide aggro). The top three damage dealers (each at least 15% of the wagon's hp) get 2 stacks and a 15% heal each, which brings the net hp cost to about 25% (g); the wagon drops a standard 15 s contested chest. Escorts pay nothing. A second convoy runs on a different rim pair at 7+ starters.

**Q19 Elite's Banner** (hybrid, claim, known). Q19 reserves the elite camp of each far zone from planning, like Q14. The giver stands on a ring-road node (a top-tier quest, section 5). The claimant picks one far zone at accept; the camp is bound to the holder; clear it (mean 15.9 s, about 45% hp, M), with the holder credited with the elite's kill. Take the banner (bright carry x0.90, announced, Wish casts blocked), walk back 12.3 s. Price includes the camp's own spoils (elite stacks 0.064, 3 normals 0.045, chest 0.06). Most starters cannot clear an elite camp unbuffed (9 of 25, M), so this is for a player who already took 1 or 2 camps; its hp efficiency (P per net hp lost) is 1.5x a camp's, the highest of the fight quests, with the heal cut to 10%.

**Q20 Gauntlet of Three** (hybrid, claim, known or unknown). The giver stands on a ring-road node. Packs of 2 bound champions at `node`s in next(H,1), next(H,2), next(H,3); the three zones are public, the exact nodes are sent privately as the previous pack dies, and each pack spawns when the holder is within 320 u of its node. The last site holds the turn-in, so there is no walk home. 5% heal per pack. Hp cost is the highest of the catalog (57%, g), net 42% after the heal. As unknown: chain reveal (the completer of a known quest is told privately; the lobby 45 s later).

---

## 4. Balance method

### 4.1 The price sheet (v2)
All in fight power P (max hp x defence x lifesteal x attack speed x damage, the square-law proxy of `r4a-power-report.md`; it overstates attack speed and damage).

| Item | P | Source |
|---|---|---|
| Stacks of the offered card, n stacks of the median far-zone buff | `S(n) = 0.0804 x scale(n)`; scale 0.16 / 0.49 / 1.00 / 1.51 / 1.84 / 2.00 at 1-6 stacks (r), so S(1) .013, S(2) .039, S(3.2) .089, S(4) .121, S(5) .148, S(6.35) .163 | m: price list |
| Drip stacks (Ember Imp or Penitent, the lower-stack one) | the same S(n): Ember Imp +0.111 and Penitent +0.075 at 3.2 stacks, mean 0.093 against the median 0.089 | m |
| Skill pick of 2 | 0.08 (Whetstone +0.06, Thick Hide +0.10) | m |
| Heal 1% max hp | `lambda(N)`: 0.0033 at 7-8 starters, 0.0044 at 5-6, 0.0055 at 4 or fewer. A size-3 camp costs 27% hp and pays 0.089 + 0.06 chest, so 0.0055 per % is the camp's own exchange rate where hp binds | m |
| A normal mob kill (type-blind) | 0.015 | m |
| A cleared camp's chest | 0.06 | m |
| An elite kill | 0.064 | m |
| Stack transfer (the Marked, at most 6 stacks) | 0.15 | g |
| GV, reveal | 0 | |

**Why S(n) on the median card, and what it brackets.** The card is pick 1 of 2 with the faction-neutral fallbacks, and the sizing rule (section 2.8) pins each card to the median value, so the player's choice adds no luck. The review bracketed the true value: priced at the best-of-2 card the mean ratio is 0.98 with 12 of 20 below 1.0; priced at the farm-realised value of a split-type farmed stack (0.0149 P per stack against 0.0277 here) it is 1.57 with 15 of 20 above 1.35. The median basis sits in the middle, and the interim 20% trim of the biggest stack rows (Q08 5 to 4, Q13 3.2 to 2.6, Q04, Q07, Q09 and Q20 4.5 to 3.6, Q06's drip 5 to 4) is kept until `questPower` (the P of a real build state per faction, zone and held stacks, Q1) replaces the median proxy and re-issues the table. The drip's build dependence is real (a Fire farmer holding 4.3 Ember Imp gets only 0.047 P from 5 more) and is why drips go to the lower-stack buff.

**Farm rate R(N)**, the realised first-minute rate including chests (m): 0.0035 P/s at 8 starters, 0.0037 at 7, 0.0040 at 6 (the reference), 0.0043 at 5, 0.0046 at 4, 0.0051 at 3, 0.0056 at 2. At R at 6 starters one stack of the card is worth about 5-7 s of farming, a pick 20 s, 1% heal 1.1 s.

**Interaction overheads** (g): accept 1.5 s, pickup 1.0 s, touch 0.5 s, turn-in 1.5 s; instant inputs, the time is reaction and round trip. **Walk inputs** (M, R2 maps): random tile to random site 10.9 s (same zone 5.0, adjacent 9.7, opposite 14.9); node to node adjacent 8.9 s, opposite 13.8 s on top-ranked sites (10.0 and 14.9 on random recipe sites); camp hop 4.2; camp to opposite camp 11.1; camp to coliseum centre 8.1; ring lap 19.8. **Fight inputs** (M, `bench/campDuel.ts`, MOB_K 0.22, camp-wide aggro): size-3 camp 8.6 s median / 11.6 mean, 27% hp; size-4 10.3 / 15.8, 38%; size-5 12.3 / 15.0, 43%; elite camp 8.1 / 15.9, 45%. Clear time varies by faction: size-4 mean seconds Fire 6.0, Plague 12.2, Sentenced 15.4, Frost 16.8, Holy 32.0.

### 4.2 The formula
- `T` = time to succeed from a typical position: approach + search (10 s, prox unknowns only) + accept + task + carry legs at the carry speed + fights + turn-in.
- `p` = success chance per attempt (g). `q_d` = the share of failed attempts that end in an elimination (g: 0.08 for pure PvE and denial quests, 0.10-0.15 for carries and holds on public routes, 0.20 for lobby-wide scrambles, 0.30 for PvP targets).
- **Cost of an attempt** = `T x (p + 0.6 (1 - p)) + (1 - p) x q_d x C_ELIM`. A failed attempt wastes about 60% of a run (0.6 T), and `C_ELIM` = 90 s is the run value an elimination costs (g, tune from carrier-death data). The old formula had no elimination term, although the plan itself says a gank "usually ends the runner's run".
- **Expected P of an attempt** = `p x P_win + (1 - p) x P_consolation`.
- **ratio** = cost per attempt x R(N) / expected P per attempt. Without a consolation it equals `E x R / P` with `E = cost / p`. Target **1.0 to 1.35** for income rows.
- **Winner-take-all open quests** use `p = p_skill / n_exp` with a consolation row, because p is per contender: `n_exp` = 2 at 4 or fewer starters, 2.5 at 5-6, 2 per instance at 7-8 (two instances), 1.5 for the self-selecting Marked. The old table priced Q09, Q16 and Q18 at the per-player chance of a single contender and would have read 1.85, 2.64 and 1.86 with two to three contenders. Q09 keeps a consolation (1 stack per sigil), Q16 pays assisters 2 stacks, and Q18 pays its top three; Q10's pile count rose from 6 to 8.
- **Unknown draws** of proximity-revealed quests add +1.5 stacks (the search the 12-tile disc forces) and 10 s of T. U-only rows (Q04, Q11, Q17) have the search in T and their reward sized to it.
- **Pay scale** (section 2.8) multiplies stack, heal and GV rows so the mean ratio stays about 1.22 at every lobby size.
- **Hp.** Fight quests list `hp_gross` (the fight's hp cost) and the heal they return. The ratio does **not** charge gross hp: at the hp-binding shadow price (0.0055 per %) a 45% fight costs 0.25 P, almost its whole reward, and both sides of the comparison go to zero (a camp would price at 0.149 - 27 x 0.0055 = 0). Hp is guarded instead by the heal cap (15% per quest, 40% per run), by the **hp-efficiency check** (P per net hp lost must be at most 1.6x a camp's 0.0055, i.e. 0.0088), and by the questBench metric "hp at the teleport". Net hp lost and efficiency: Q13 30% (.0070), Q14 23% (.0081), Q15 23% (.0075), Q18 25% (.0054), Q19 35% (.0084), Q20 42% (.0060). The old table paid 1.9 to 4.1x a camp per net hp, which made fight quests the dominant route where hp binds.

### 4.3 Worked examples (6 players)
- **Q01.** T = 10.9 + 1.5 + 1.0 + 13.8 / 0.85 (16.2) + 1.5 = 31.1 s. p 0.80, q_d 0.15: cost = 31.1 x (0.80 + 0.12) + 0.20 x 0.15 x 90 = 28.6 + 2.7 = 31.3 s (E = 39.2 s). Reward 3.5 stacks = 0.101, heal 8% x 0.0044 = 0.035, P = 0.136; Mob-eq 34.0 s; ratio 31.3 x 0.004 / (0.80 x 0.136) = **1.15**.
- **Q09.** T = 5.0 + 1.5 + 2 x 8.9 + 7.8 + 1.5 = 33.6 s. p = 0.75 / 2.5 = 0.30, q_d 0.15: cost = 33.6 x (0.30 + 0.42) + 0.70 x 0.15 x 90 = 24.2 + 9.5 = 33.6 s; expected P = 0.30 x 0.251 + 0.70 x S(2) 0.039 = 0.103; ratio 33.6 x 0.004 / 0.103 = **1.31**. The prize is 0.080 pick + 0.105 stacks + 0.066 heal.
- **Q13.** T = 10.9 + 1.5 + 13.8 + 12 (fight) + 13.8 + 1.5 = 53.5 s. p 0.72, q_d 0.08: cost 49.5 s. Pick 0.08 + 2.6 stacks 0.064 + heal 15% 0.066 = 0.210. Ratio **1.31**. Its hp efficiency is 0.0070 per net hp lost, 1.27x a camp.
- **Q16.** T = 12 (find) + 15 (duel) = 27 s. p = 0.50 / 1.5 = 0.33, q_d 0.30: cost 37.8 s. Pick 0.08 + transfer 0.15 = 0.23, consolation 2 stacks 0.039: ratio **1.47**.
- **Q19.** T = 10.9 + 1.5 + 11.1 + 15.9 + 1.0 + 11.1 / 0.90 (12.3) + 1.5 = 54.2 s. p 0.55, q_d 0.15: cost 50.5 s. Pick 0.08 + heal 10% 0.044 + the camp's own spoils 0.169 = 0.293. Ratio **1.25**, success-time ratio 0.74.

### 4.4 Pool and share of income, by lobby size
Quest counts by lobby size (section 5): 3+3 at 2-3 starters, 4+4 at 4-5, 5+5 at 6-7, 6+6 at 8.

| Starters | Quests | R(N) | lambda | Pay scale | Mean ratio | Rows outside 1.0-1.35 | Completions per player | Quest P (cap 0.45) | Farm P by 300 s | Quest share | Time share | Players with no payout |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 12 | .0035 | .0033 | 0.88 | 1.21 | Q10 1.37 | 1.05 | .181 | .256 | 41% | 16% | 19% |
| 7 | 10 | .0037 | .0033 | 0.95 | 1.23 | Q13 1.36, Q16 1.38 | 1.00 | .179 | .280 g | 39% | 15% | |
| 6 | 10 | .0040 | .0044 | 1.00 | 1.22 | Q16 1.47 (bounty) | 1.17 | .227 | .310 g | 42% | 18% | 15% |
| 5 | 8 | .0043 | .0044 | 1.10 | 1.24 | Q16 1.54 | 1.12 | .230 | .350 g | 40% | 17% | |
| 4 | 8 | .0046 | .0055 | 1.12 | 1.23 | Q12 .99, Q16 1.64, Q19 1.36 | 1.40 | .308 | .390 | 44% | 22% | 9% |
| 3 | 6 | .0051 | .0055 | 1.30 | 1.23 | Q12 .95, Q16 1.74, Q19 1.46 | 1.40 | .338 | .440 g | 43% | 22% | |
| 2 | 6 | .0056 | .0055 | 1.45 | 1.26 | Q04 1.35, Q12 .93, Q16 1.84, Q19 1.57 | 2.10 | .450 (capped) | .490 | 48% | 32% | 1% |

Completions per player is `quests x 0.70 / starters` (completion 70%, g), counted at full pay; open quests also pay consolations, which the "no payout" column counts (1.5 payees per quest on average, g). The farm-P figures for 3, 5, 6 and 7 players are interpolations (g). The quest share is `quest P / (quest P + farm P)`, so quests are 39-48%: substantial, not the only thing. Outside-band cells are listed, not hidden: Q16 is the labelled bounty row, Q12 the modifier, and Q19 and Q04 drift up in 2-4 player lobbies, where the P budget caps the share anyway. Ratio by lobby size and quest (8 / 6 / 4 / 2 starters):

| Q | 8 | 6 | 4 | 2 |  | Q | 8 | 6 | 4 | 2 |
|---|---|---|---|---|---|---|---|---|---|---|
| Q01 | 1.22 | 1.15 | 1.11 | 1.04 |  | Q11 | 1.17 | 1.14 | 1.11 | 1.16 |
| Q02 | 1.18 | 1.20 | 1.23 | 1.25 |  | Q12 | 1.08 | 1.02 | 0.99 | 0.93 |
| Q03 | 1.21 | 1.18 | 1.17 | 1.19 |  | Q13 | 1.34 | 1.31 | 1.30 | 1.32 |
| Q04 | 1.14 | 1.21 | 1.31 | 1.35 |  | Q14 | 1.23 | 1.24 | 1.24 | 1.34 |
| Q05 | 1.15 | 1.20 | 1.25 | 1.31 |  | Q15 | 1.26 | 1.22 | 1.20 | 1.24 |
| Q06 | 1.27 | 1.28 | 1.31 | 1.23 |  | Q16 | 1.33 | 1.47 | 1.64 | 1.84 |
| Q07 | 1.18 | 1.20 | 1.23 | 1.25 |  | Q17 | 1.11 | 1.16 | 1.23 | 1.33 |
| Q08 | 1.13 | 1.17 | 1.21 | 1.23 |  | Q18 | 1.26 | 1.15 | 1.07 | 1.05 |
| Q09 | 1.15 | 1.31 | 1.14 | 1.12 |  | Q19 | 1.16 | 1.25 | 1.36 | 1.57 |
| Q10 | 1.37 | 1.24 | 1.15 | 1.08 |  | Q20 | 1.32 | 1.30 | 1.29 | 1.30 |

Players with no payout is `(1 - 1/N)^(quests x 0.70 x 1.5)` for a uniform spread (a lower bound; winner-take-all and nearest-wins skew it up). With the old 5 + 5 at 8 players it was 39%. The questBench gate is 25% at 8 players (section 4.6).

### 4.5 Checks
- **Two bands, because the comparator moves.** Quests do not run at the first-minute farm rate. The rate in force while a quest runs is 0.0012 / 0.00035 / 0.00007 P/s for W1 / W2 / W3 at 8 starters (0.0021 / 0.0009 / 0.0003 at 4), where an income-band ratio of 1.2 at the reference rate becomes about 0.37 / 0.11 / 0.02 against the real alternative (m). So: **(a) W1 and W2 quests are tested against a fresh camp, 0.0085 P/s (0.0056 slow to 0.0104 brisk for a size-4 camp, m): the ratio against it must be at least 1.3, so the camp wins first.** Every row is 2.2 to 3.1 (minimum Q12 2.17 at 6 starters; 1.41 at 2 starters). **(b) W3 and later quests are tested only for spread against each other (1.14 to 1.31 on income rows)**, because the farm alternative has gone to about zero by then, which is deliberate.
- **Not dominant early.** A fresh camp near you earns 0.006-0.011 P/s; a quest earns on average P / E about 0.003. Farm first while camps last, and pay the decay if you wait.
- **Dominant late, on purpose.** After minute 2 (8 players) or 3 (4 or fewer) farm income is about 0.0003 P/s (m): quests win about tenfold. The real choice becomes which quest, whom to fight, and when to leave the last camp.
- **Not ignorable.** Skipping every quest forgoes about 40-48% of growth by 300 s **on average**; the average hides a split (the review measured 39% of 8-player players with no quest income under 5 + 5 and uniform luck). The count table and the open-mode instances bring it to about 19% (m), and the gate is 25% (section 4.6).
- **Not chainable.** One claim at a time, 3 completions and 0.45 P per run, a window that decays the payout, the focus rule, a claim timer whose slack is under one en-route camp, and waves that open in order. The three richest quests (.81 P) and the three safest (Q08 + Q04 + Q05, .57 P) both trim to the 0.45 budget; the old top-3 route was x5.3 an average player's quest income at 8 players.
- **Brakes intact.** Quest stacks and heals fall with the feed's reward curve; completions raise the feed; the budget trims picks; the Marked takes up to 6 of a leader's stacks; bounty stays player kills only.
- **Success-time reading.** Success time is 0.67 to 1.04 of Mob-eq for the claim quests (0.46 to 0.96 for the open lotteries and the modifier). The owner's phrase "time proportional to the mob time, slightly more for the risk" is read on risk-adjusted time (E), with a floor of 0.65 on success time for claim quests so no claim is a fast farm replacement even when it succeeds (owner question 1).
- **Faction asymmetry.** Clear time differs by faction (Holy 32.0 s against Fire 6.0 s for a size-4 camp, M), and a fixed champion hp would lock Holy and Sentenced out of the fight quests. Champion hp is scaled by the claimant's faction clear-speed factor (initial values in section 6.3, g), the claimant picks the far zone, and `questBench` fails if any faction's completion rate is below 50% of the median.
- **Pace effect.** Walking is pace-independent and fighting is not, so quests look worse to a brisk farmer (5.3 s per kill) and better to a slow one (7.9 s): a mild catch-up for weaker players.
- **Corrected statements from the old plan.** The slack was not "always under 18 s" (Q20's was 18.5 s, and the rounded values were higher, and it ignored en-route camps). The 6 s rule was not a guarantee at 8 players. "Skipping every quest forgoes 37-47%" was an average. The search for Q04 and Q17 was double-counted in the old geometry, and Q04 and Q17 are priced on the new geometry now.

### 4.6 What must be measured before values are trusted
`p`, `q_d`, `C_ELIM`, the champion and Warden fight times, the overheads, the completion rates and the realised share of income are model values. `bench/questBench.ts` (section 7, Q7) runs bot tournaments on the real sim at 2, 4 and 8 players over many seeds and reports per quest, and the table is re-issued from it. The shared unit test checks arithmetic, flags and the structural rules; **the band is asserted only on measured p** (at least 200 runs per quest), and `questBench` exits 1 if a measured p moves a row outside its band until the table is re-issued.

Metrics and gates:
- completion and failure rates, realised T and ratio, **both** the E ratio and the success-time ratio, contest rate and contenders per open quest;
- carry quests are measured with hunters present: a rival within about 8 s of the pickup who reacts after the humanizer delay (the review measured a rival within a 16 s carry of a random public receiver in 86%, 99% and 100% of cases at 2, 4 and 8 players, so the old p of 0.85 for visible carriers was not credible);
- carrier deaths, split by killer type (bot or human), and completion by faction and by Wish-ready state; **fail if any faction is below 50% of the median completion**;
- **players with no payout: gate 25% at 8 players;** hp at the teleport; quest share of P; players who never saw another player before the coliseum (target 25% or less);
- **nearest-spawn win rate: gate 25%, goal 20%** (chance is 12.5% at 8 players; the old 35% was 2.8x chance), measured with pre-positioning on;
- run length (unmeasured today) and dead time: **at least one quest open until the teleport minus 40 s in a lobby with one early death** (also an e2e assertion), and a default 8-player death-free run opens at least 11 of 12 quests.

---

## 5. The per-game selection and placement rule

Runs once, at planning start (`startPlanning`, `server/src/sim/planning.ts:78`), when the map exists and the spawn pairs are dealt; at `startRaid` when planning is off. Everything draws from the private quest stream (section 6.3), never `world.random` or `world.rewardRandom`.

1. **Count.** Known + unknown by starters: **2-3: 3 + 3; 4-5: 4 + 4; 6-7: 5 + 5; 8: 6 + 6.** (The owner's "about 10, 5 and 5" is the 6-7 player row; the review found 5 + 5 leaves 39% of an 8-player lobby with no payout.) Carrion Call is a modifier and is not counted. Run cap 16 slot-counted quests with season 2 and top-ups. Training: none.
2. **Eligibility.** Q16 and Q17 need 4+ starters; Q12 needs 3+; Q17 needs a carry quest in the final draw; Q14 and Q19 need a hardest 4+ camp or an elite camp in each far zone (always true at planning, a 1% fallback draws another def), and at most one camp-reserving quest per season. A draw is refused if its quest-mob total exceeds `QUEST_MOB_CAP` 30 (section 6.3).
3. **Draw.** Known from the K and KU rows, unknown from the U and KU rows, no duplicates, each set with at least one fetch, one collection and one kill or hybrid. **The known set always holds the Tax Convoy and one of the Idol or the Sigils** (the W1 pair), so every lobby gets one public moving brawl. The forced collection of the unknown set is Q10 or Q11 (Q12 is a modifier). At most 2 coliseum quests in the game (Q06, Q07, Q09, Q15) and at most 2 PvP-target quests (Q16, Q17). Rejection-sample up to 32 times, then relax the coliseum and PvP limits.
4. **Waves.** Known by lobby: 3+3: W1 W2 W3, unknown W2 W3 W4; 4+4: known W1 W1 W2 W3, unknown W2 W3 W4 W4; 5+5: known W1 W1 W2 W2 W3, unknown W2 W3 W3 W4 W4; 6+6: known W1 W1 W2 W2 W2 W3, unknown W2 W2 W3 W3 W4 W4. A def never goes earlier than its preferred wave: **W1: Q06, Q09, Q18 only (open-mode, spawn-fair)**; W2+: Q01, Q02, Q03, Q05, Q08, Q13, Q15; W3+: Q04, Q07, Q10, Q11, Q14, Q17, Q19, Q20; W4: Q16 (by its event). Claim quests are not W1 because the nearest-spawn player would win the claim lottery: the review measured the nearest-spawn player first at the quest in 72% of 8-player and 83% of 4-player deals. Wave times are fractions of the live window (section 2.6).
5. **Zones.** Every zone holds at least 1 and at most 2 of the quests. **Giver value is balanced per zone at draw time**: the sum of P of the givers in each zone is within +-25% of the zone mean (rejection-sampled), and each known card shows its P. **Top-tier claims (P at least 0.24: Q19, Q20, Q17) put their giver on a ring-road node** rather than in a home zone; ring nodes are about equidistant from the zones. Far-zone endpoints are in the relation the def names. Unknown givers are placed at rumor time (section 2.5).
6. **Sites.** From R2 maps, using the recipe that worked in 1000 of 1000 zones (M): an all-floor, terrain-free 3x3; off the ring road + 2; at least 6 tiles from any camp centre, 3 from crates; not in a ruin; 28.1 such sites per zone on average (p10 17), at least 3 sites 10 tiles apart in every zone. Plus: quest sites at least 10 tiles apart. **The spawn rule is public and pool-based, chosen before the deal: a site is at least 3 s of walking from EVERY pool spawn** (M: 50% of candidates pass, every zone has passers, the mean walk to the nearest pool spawn is 4.2 s and to the coliseum 11.1 s, and the deal still has about 28.7 of 29.5 spawns). The old "6 s from every dealt spawn option" was void at 8 players (2.4% of sites and 12% of zones qualify with 16 options, M) and leaked the private deal, because a published site told every client which pool spawns were not dealt. A relative check also runs after the picks: no picked spawn may be more than 3 s closer to a W1 giver than the next player (the W1 quests are open-mode, so this is a backstop). Candidates are ranked by min(distance to camp centre, pool spawn, zone border, capped at 9 tiles) and the site is drawn **at random among the top 6 ranked candidates** from the quest stream, so the pick is not recomputable from the public map. `nook`s for hidden objects (16 per zone, M), the gate lanes and the pit for coliseum quests, `ruin`s when present.
7. **Verify and price.** Measure each quest's legs once with `findPath` (about 0.117 ms each, 30-40 paths, about 5 ms per game, M), check reachability with `moveComponents`, **reject a placement whose leg sum is outside 0.8-1.25 x nominal** and retry up to 8 times; issue per-instance timers (section 2.6) and the walk scale (section 2.8).
8. **Publish.** Known rows go into `RaidState.quests` (public) with their `publicSites`. Unknown defs stay in `world.quests` until their rumor or reveal. A test asserts that every known row lists its public sites.

The candidate site pool is recomputable from the public map; the pick among the top 6 is not (secret stream).

---

## 6. Architecture

### 6.1 Where it runs (tick order unchanged)
- **Input phase.** `world.actions.quest` runs in `applyInputs` per player in the shuffled `actionOrder`, like `choose` (`server/src/sim/chests.ts`). Same-tick races (two accepts, two pickups) are decided by the secret shuffle. Handlers only parse and enqueue (`enqueueClientMessage`).
- **System.** `updateQuests` is a `world.systems` entry. `installQuests` goes in `MODULES` (`server/src/sim/gameplay.ts:21-38`) after `installAbilities` and before `installMods`, so camp rosters draw first and a carry change re-folds in the same tick (`updateMods` is last). Per tick: the wave schedule against the live `patienceEndsAt` (the unopened waves and top-ups), window expiry, the progress guard (straight-line distances only, no path search); rumor and proximity reveal (at most 6 unknown x 8 players distance checks); hold, channel and drip progress; Marked pings; coin pops; Convoy march and champion inputs; carry timers. Nothing quest-related runs in the ledger or in `beforeDamage`.
- **Hooks.**
  - Existing (`server/src/sim/world.ts:462-511`): `raidStarted` (schedule), `teleported` and `runEnded` (close everything, clear carries, park quest mobs, unlock camps), `fighterOut(id, cause)`, `campCleared(world, camp)` (Trophy Run, Elite's Banner), `bountyClaimed`, `hurt`, `hitLanded`, `dropBody` (carried items on the ground).
  - **`fighterOut`** fires twice for a leaver (`down` inside `downPlayer`, then `removed` at `step.ts:98`) and for every mob death (`mobLife.ts:173`), and before `creditKill`. Quest handlers act only for players, only on `down`, and ignore `removed` for a fighter already down. The carry is **snapshotted before the drop** so the Writ can see that the victim was a carrier.
  - **`playerKilled(world, killer, victim, outcome)`**: extend the signature (it has no victim today) and add it to `ChainableHook` (`world.ts:666-668`). It also fires for a leave-kill (`downPlayer` `mia` goes through `leaveCredit`), so the PK quests ignore outcome `mia`.
  - New chainable `mobKilled(world, mobId, killerId, camp)`, fired from `payMobKill` (`server/src/sim/mobLife.ts:197`) so it inherits the post-pass order; it does not fire in training.
  - **`hitLanded`** (not `hurt`, which has no source) is allowed for a player-damage interrupt (Vials, dig, beacon channels, the 25% damage tests) provided it decides from the entry and defers the write with `payLater`, as CLAUDE.md allows; it never changes who survives.
  - Anything written while `world.combat.collecting` goes through `payLater`.
- **Payout reads the tick-start snapshot** of the median feed (not the live value), so two completions in one tick do not move each other's rewards. **Ties found by a system** (two players finishing a hold in one tick) break by a draw from the quest stream's tie sub-stream, **never `world.combat.rank`**: `tieRank` outcomes are the ones a client can stage and read (CLAUDE.md Known TODOs), and more public outcomes on that rank would widen the `orderSalt` exposure.
- **Patience.** `settle()` (`arena.ts`) sets `patienceEndsAt = max(scaled, min(latest active claim deadline + 3 s, scaled + 30 s))`.

### 6.2 Data model
Shared, pure (`packages/shared/src/quests.ts`, no `Math.random`, `rng.ts` only):
```ts
type QuestKind = "fetch" | "collection" | "kill" | "hybrid";
type QuestMode = "claim" | "open";
type QuestClass = "income" | "bounty" | "modifier";
type Suit = "K" | "U" | "KU";
type RevealRule = "prox" | "time" | "chain" | "event";
type SiteRole = "node" | "nook" | "camp" | "eliteCamp" | "gate" | "pit" | "ruin" | "body" | "ring";
type ZoneRel = "H" | "adj" | "opp" | "next1" | "next2" | "next3" | "emptiest";
type Step =
  | { v: "reach"; site: number; r: number }
  | { v: "hold"; site: number; r: number; seconds: number; uncontested: boolean }
  | { v: "take"; site: number; item: QuestItemId; channelS?: number }
  | { v: "give"; site: number }
  | { v: "slay"; what: "champion" | "camp" | "eliteCamp" | "wagon" | "player"; n: number };
type QuestReward =
  | { r: "buff"; stacks: number; from: "farZone" | "drip" }
  | { r: "skillPick" } | { r: "heal"; share: number } | { r: "gv"; n: number }
  | { r: "reveal" } | { r: "transfer" } | { r: "chest" };
interface QuestDef {
  id: number; key: string; name: string; kind: QuestKind; mode: QuestMode; suit: Suit; cls: QuestClass;
  asUnknown?: RevealRule; wave: 1 | 2 | 3 | 4; windowS: number;
  sites: Array<{ role: SiteRole; zone: ZoneRel; pub: "full" | "zone" | "candidates" | "none" }>;   // `publicSites`: what the planning screen may show
  steps: Step[]; rewards: QuestReward[];
  carry?: { item: QuestItemId; speed: number; bright?: boolean; heavy?: boolean; fragile?: boolean };
  needs?: { minStarters?: number; carryInDraw?: boolean; reservesCamp?: boolean };
  mobs?: number;                                                                                 // quest-mob roster entries this def can create
  price: { p: number; qd: number; pre: number[]; legs: number[]; fights: Array<[median: number, cap: number]>;
           hpGross: number; heal: number; cons?: number; nexp?: number; model: true };           // `model` until questBench measures p
}
```
Plus `QUEST_ITEMS`, `QUEST_EV` (the fx sub-event table), `visitStep`/`visitReward` (exhaustive), `questPrice(def, ctx)` (the P of a build state, `questPower`, replaces the median proxy in Q1), `drawQuests(rng, ctx)`, `walkScale(actual, nominal)`, `payScale(starters)`, text helpers, and the `QUEST_*` constants (`QUEST_PAY_SCALE` table, `QUEST_MAX_DONE` 3, `QUEST_P_BUDGET` 0.45, `QUEST_HEAL_CAP` 15 and 40, `QUEST_GV_CAP` 24, `QUEST_NPC_RANGE` 96, `QUEST_OBJ_RANGE` 56, `QUEST_REVEAL_R` 192, `QUEST_HEADSTART_R` 288, `QUEST_HEAD_START_S` 4, `QUEST_DROP_TTL_S` 20, `QUEST_STEAL_PAY` 0.5, `QUEST_MAX_HOPS` 1, `QUEST_FEED_MOBS` 4, `QUEST_MOB_CAP` 30, `QUEST_RUN_CAP` 16, `QUEST_WINDOW_BY_STARTERS`, the wave fractions 0.15 / 0.30 / 0.45 / 0.60).

Server runtime (`world.quests`, not synced): per quest the def, resolved sites and legs, state, holder, deadline, per-step progress, ground carry (position, until, hops), `revealedTo`, attempts, rumor disc, walk scale, the progress-guard clock; per player the active claim, completions, paid P, quest heal total and the EHP-guard flag.

### 6.3 Synced against private
| Data | Where | Who sees it |
|---|---|---|
| Known quests, and unknown quests once public: def, state, zone, public sites, open and end times, holder, public progress | `RaidState.quests: ArraySchema<QuestState>` (a new collection appended at the end of `RaidState`, never fields on `ContainerState`) | everyone |
| Rumors (zone, disc centre and radius, no site) | the same row with `r > 0` | everyone |
| Public floor objects: sigils, coin piles, souls, the Idol, lit beacons, dropped carries, the dust plume, the Convoy's start and end, reserved-camp locks | `RaidState.questObjs: ArraySchema<QuestObjState>` | everyone |
| Carry glyph and pips | `PlayerState.carry` uint8 (low 5 bits item, high 3 bits count) | everyone |
| Unknown sites before they go public, private objects (nook, private stakes), the receiver of Q01, the next site of a chain, rewards of an offer | server only; the private `quest` message | the player who learned it |
| Own claim: step, progress, deadline, next site; acks | private `quest` message | that player |
| The draw, the streams, rumor offsets, hold clocks, pending acks, the Writ's carrier blips | server only (the Writ's blips go by private message) | nobody / the holder |

`QuestState { n: uint8, def: uint8, state: uint8, zone: uint8, x: float32, y: float32, r: uint16, opensAt: uint32, endsAt: uint32, holder: int16 (roster index, -1 none), step: uint8, progress: uint8, goal: uint8 }`. `QuestObjState { n: uint8, kind: uint8, x: float32, y: float32, owner: int16, until: uint32 }`.

**What "hidden" actually protects.** The guarantee is that a hidden quest is never in synced state. That is not the property that matters, which is what a client can learn. Every player's x,y is public state, so the finder's walk to a site is visible, and a quest mob spawned at a hidden site, its hit fx and its death fx (`death [id,x,y,by]`) carry coordinates. So the finder's head start is **claim exclusivity**, not secrecy, and quest mobs spawn only when the holder is within about 10 tiles (320 u) of their node, never at reveal or at accept. The secrecy test is extended to perturb the hidden draw and compare the **whole** synced state, the fx stream and the roster (not only `RaidState.quests`). The rumor disc is chosen with at least 8 candidate sites inside it. The finder-position leak is a Known TODO tied to `StateView` (interest management).

**The secret streams.** `world.questRandom` comes from **`questSalt`, four more crypto words** that `RaidRoom` takes next to `rewardSalt` (`world.ts:577-600`), not a derivation from it: a tagged XOR of `rewardSalt` would hand anyone who recovers the reward stream's start state (the public camp rosters and the known draw publish roughly 60-100 bits of it) the hidden draws too. One sub-stream per quest, `mix(questSalt, questIndex)`, so the public known draw says nothing about a hidden quest and runtime consumption (rumor offsets, emptiest-zone ties, pick draws) never shifts a draw; plus a tie sub-stream. It draws nothing from `world.random` or `world.rewardRandom`, so pinned rosters, deals and chest rolls do not move. Tests without a salt fall back to a tagged hash of `orderSalt`, never in a live room. A test changes player behaviour and asserts the hidden draws are equal.

**The carry is a mod source, not a status.** A `world.modSources` entry (`world.ts:460`, the Wishes' attack slow is the precedent) returns `speedMult` for a carrier; `recomputeMods` on pickup and drop. The speed mirror is synced and decoded by the client prediction, so the slow predicts with no new client movement code. A status would need a long `maxMs`, one of the three spare effects bits reserved for R6, and the `soft` cleanse class (Purify would shake a carry), and it would count in `isSlowed()`. With zone terrain the slow multiplies with bog and chill under the 0.35 floor.

**Quest mobs** reuse R5's camp machinery with a `quest` kind: no `state.camps` entry, no chest, no spoils (`payMobKill` returns early for them), a **quest-group id** for wake and aggro. The roster is append-only, so the budget is fixed at draw time: each def lists `mobs` (Q13 1, Q15 6, Q20 6, Q18 4 plus 4 for the second convoy: 21 in the worst draw), the draw is refused above `QUEST_MOB_CAP` 30, and bodies are **reused**: a lapsed champion resets to full hp and parks like an evading mob instead of despawning, so a re-claim after an abandon adds no roster entry. Bodies are created lazily on first approach. Q14 and Q19 use reserved real camps and add none. Free callsigns (profile creation is free, CLAUDE.md Known TODOs) cannot burn the roster by accept-and-abandon. Wave 2 of the gladiators spawns only after wave 1 dies. Bound champions carry `boundTo = holderId` (section 2.9, item 5). Champion hp is scaled by the claimant's faction clear-speed factor from the campDuel means (initial values, g, retuned by the Q5 `mobDuel` pass): Fire 1.00, Plague 1.00, Sentenced 0.80, Frost 0.70, Holy 0.45. The Convoy uses a new `march(path)` mode in `mobAI.ts`, still pushing `move` inputs into the mob's own `InputQueue` ("mobs are players who send inputs"); its path is computed once at placement.

**Reserved camps** (Q14, Q19): the camp's mobs get a `lockedBy = quest` flag from planning until the claimant picks a zone or the window closes: they cannot be damaged and never aggro (`isShieldedFrom` for everyone), and the camp does not count for `campCleared`. The lock is drawn on the minimap. The reserved camps are the hardest of their zone (5-spot, elite), so the early rush rarely wants them.

**Payout** (`payQuest`): rows are computed by the shared `questPrice` at the paid values: stacks via `grantBuff` (`stacks x payScale(N) x decay x walkScale x mobRewardMultiplier(feed, medianFeed)`, sized per card), the feed credit, `grantSkill` through a claimant-bound reward chest, `heal()` with up to 10 s owed (15% per quest, 40% per run), `awardQuestGv` (reason `"quest"`, own pot), `transferBuffs` for the Marked. The P budget trims the whole reward when it runs out. Training: nothing pays (`world.config.training` gate, like `payMobKill`).

### 6.4 Messages and wire
- **Input** `quest { n: uint8, act: 0 accept | 1 use | 2 abandon, o?: uint8 }` (`o` = the zone option at accept for Q13, Q14, Q19, or a quest object index for open-mode objects). Add to `ClientMessages`, `CLIENT_MESSAGE_TYPES` (append after `train`), `ActionCommand`, `parseQuest`, the `enqueueClientMessage` switch (`server/src/sim/inputs.ts`), `BotClient.sent`, and the exhaustive-table tests. It rides `MAX_ACTIONS_PER_TICK`; one action per tick per player is enough.
- **Server message** `quest` (private): `{ v, offers: [...], mine: { n, step, progress, goal, endsAt, next } | null, revealed: [{ n, def, x, y, endsAt }], blips?: [...], ack?: { code, n, act } }`. Ack codes include `focus`, `wishBlocked`, `budget`, `released`. The `plan` precedent end to end: `SimEvent { type: "quest", to, msg }`, `RaidRoom.handleEvents` case calling `sendTo`, a JSON key so only changes go out, resent in `onReconnect` next to `sendPlan` and before `sendInFlight` (`server/src/rooms/RaidRoom.ts:305-317`), a client `net/questInbox.ts` registered before the first state (like `planInbox.ts`), `sanitizeQuest` dropping malformed messages, a later message replacing earlier ones.
- **fx.** One new kind, `quest` = **20** (after `chestTaken` 19): `[20, n, ev, by | null, arg]`, `ev` from the append-only `QUEST_EV` table (opened, rumor, found, claimed, progress, carried, dropped, stolen, done, failed, expired, ping, marked, soul, released, season). No strings on the wire; announcement text is built on the client from the catalog. `by` is a roster index. Update `shared/test/fxCodec.test.ts`; the e2e run already asserts no tuple is dropped.
- **GV.** `GvReason` gains `"quest"`; `GV_TOAST` in `RaidRoom.ts:131` is an exhaustive `Record` and gets its entry; `GvBreakdown` gains `quests`.
- **Plan message unchanged.** Known quests are public rows in `RaidState.quests`, so the planning screen reads state; `PlanMessage` and `sanitizePlan` need no new field.
- **Cost.** A quest row is about 21 B in the full sync (measured on a similar row: 10 rows about 213 B), a progress change 5 B, a claim 9 B, `carry` +2 B per player (M, `scratchpad/quests/arch/wireCost.ts`). Expected +0.1 to +0.3 KB/s at heavy load against the 20 KB/s gate (R5 heavy load 11.7 KB/s, chests +0.25, M). A `quests` scenario in `bench/bandwidth.ts` gates it at +0.5 KB/s. `stepBench` headroom is about 30x (0.15 ms average unloaded, gate 5 ms, M); the progress guard is straight-line only. No per-tick pathing.

### 6.5 Client
- **Planning screen** (`client/src/ui/planning.ts` + `planning.css`): a `pl-quests` box in the side column (the known quests: name, kind glyph, open time, the far zone, the reward cards with their P; and "N hidden"), and quest glyph buttons in `pl-markers` for givers and public sites, reserved camps drawn with a lock. Reads `RaidState.quests` only.
- **Tracker and log** (`ui/questLog.ts` + `questLog.css`, pure `ui/questMath.ts`): a HUD line under the build strip with your claim (step, countdown from true server time) and the next quest to open; **J** opens the full log (every public quest with state, holder and timer; your private offers and revealed sites).
- **Quest panel** (`ui/questPanel.ts`), modelled on the chest panel: non-modal, opens from the SERVER position within range - 8 u with line of sight, accept / use / abandon and the zone choice, **G** acts on the nearest quest NPC or object, countdowns in true server time, actions grey at `endsAt - (RTT/2 + 50 ms)`, structured ack codes, a pending action expires after `ORDER_EXPIRE_MS`, never swallows canvas clicks, refused while `room.reconnection.isReconnecting`. F stays the weapon pickup and C the chest panel.
- **World** (`render/QuestMarkerView.ts`): NPC glyphs as coloured shapes, rings for holds and channels, sigils, coins, souls, the pedestal, countdown rings like `ContainerView`. `render/PlayerView.ts` draws the carry glyph and pips and the carrier's `wishReadyAt`; the glyph is drawn even over a Swarm-hidden carrier (owner question 14).
- **Minimap** (`ui/minimap.ts`, `ui/mapPainter.ts` `paintQuests`): givers and public sites, rumor discs, coin pops, souls, lit beacons, reserved-camp locks, the Convoy route (computed locally), private sites for you only. **One rule for carriers: other players' carriers appear as a ping blurred to a 300 u disc (the blur is a presentation rule of honest clients; positions are public state until `StateView`) once every 5 s; bright carries are announced on pickup; the Writ upgrades its holder to exact continuous blips for 60 s.** The Marked ping uses the same blur. The painter's golden-hash test is updated.
- **Announcements** through `FxView` `announce` and toasts. **Help**: G and J in `HELP_SECTIONS` (`ui/helpOverlay.ts`). **Training console** (`ui/trainingConsole.ts`): `quest <id>`.
- Overlay rules: `--ui-w`/`--ui-h`, no `vw`/`vh`, new CSS in new files.

### 6.6 Bots
- `server/src/bots/questHunt.ts`, a pure decision module mirroring `chestHunt.ts` (accept, walk, use, abandon, steal, skip), run by `BotClient.questStep`, with `quest` in `BotClient.sent`.
- Scoring: reward P x estimated win chance / E[T] (from the shared `questPrice`) against the bot's farm option from `mobHunt.ts`; no fight quest under 60% hp; no carry while an enemy is within 400 u; weight targets that carry something.
- **Humanizer.** A reaction delay of 200-500 ms plus RTT before any quest reaction; non-minimap information limited to the view window (+-800 x +-562 u); carriers seen only through the same blurred ping as humans. Otherwise a bot reading full state and reacting on the next tick is always first at the receiver and human carriers die more in bot-filled lobbies, which lowers p below the model. `questBench` splits carrier deaths by killer type.
- Perception: public rows plus the bot's own private message only. Bots send only human messages (`quest`, `move`, `stop`, `target`, `pickup`, `choose`, `swap`, `cast`), never `aim`, `attack` or `release`.
- On the human-bots line (`claude/human-bots-0f19c0`, `docs/BOTS.md`): a `brain/modules/quests.ts` `FeatureModule` enabled by `CLIENT_MESSAGE_TYPES.includes("quest")`, private messages through `onPrivate`, and quest cases in `perception.test.ts` (allowlist) and `fairness.test.ts` (perturb hidden quest data, the percept stays byte-identical). The 8-bot gate stays 1.5 ms average, 6 ms p99.

### 6.7 Config and training
- `SimConfig.quests` defaults to **off**, so the existing room tests keep their helpers (R3's `loadConfig({})` change forced `planSeconds: 0, firstPatienceSeconds: 0` into every helper; do not repeat that). `loadConfig` turns quests on only after the helpers are updated. Env `QUESTS=0|1`, plus a count override for tests.
- A training world never installs quests; the console's `quest <id>` places a practice copy that pays nothing.

### 6.8 Files
**New.**
- Shared: `src/quests.ts`, `src/questPower.ts` (the P of a build state, card sizing), `test/quests.test.ts`, `test/questPrice.test.ts`.
- Server: `src/sim/quests.ts` (runtime, install, action, system, hooks, payouts, private-message builder), `src/sim/questSites.ts` (pure site picker and solver), `src/sim/questMobs.ts` (bound champions, gladiators, the Convoy, reserved camps), `src/bots/questHunt.ts`, `bench/questBench.ts`, tests `quests.test.ts`, `questsRoom.test.ts` (private message, reconnect), `questSecrecy.test.ts` (no unrevealed coordinate in a full sync, a joiner's sync, the fx stream or the roster; the hidden draw perturbed), `questMobs.test.ts` (a rival arrow passes through a bound champion, a rival Frost hit applies no chill, a holder and a rival hitting in one pass credit only the holder), `questSchedule.test.ts` (the live-window waves, top-ups, season 2, the claim-in-flight extension), `botQuests.test.ts`, and a `quests` scenario in `bench/bandwidth.ts`.
- Client: `src/net/questInbox.ts`, `src/ui/questLog.ts`, `questLog.css`, `questPanel.ts`, `questPanel.css`, `questMath.ts`, `src/render/QuestMarkerView.ts`, with tests.

**Touched.**
- Shared: `schema.ts` (QuestState, QuestObjState, `RaidState.quests`, `questObjs`, `PlayerState.carry`, appended at the ends), `messages.ts` (input, server message, fx kind, `GvReason`, `GvBreakdown`, `CLIENT_MESSAGE_TYPES`), `fxCodec.ts` (KIND `quest` 20, `QUEST_EV`), `constants.ts`, `rules.ts` (feed term), `index.ts`, `training.ts`.
- Server: `sim/world.ts` (runtime, `questRandom`, `SimEvent`, `mobKilled`, `playerKilled` chainable with victim and outcome, `isShieldedFrom`, `SimConfig.quests`), `sim/inputs.ts`, `sim/gameplay.ts` (one MODULES line), `sim/mobLife.ts` (`mobKilled`, bound gate, spoils skip), `sim/mobAI.ts` (`march`, bound targeting), `sim/combatant.ts` (`isShieldedFrom`), `sim/projectiles.ts`, `melee.ts`, `weapons.ts`, `targeting.ts`, `factions.ts`, `abilities.ts` (the `isEvading` call sites), `sim/camps.ts` (quest kind, reserved lock), `sim/arena.ts` (`awardQuestGv`, the patience extension), `sim/loot.ts` (carry drop), `sim/chests.ts` (claimant-bound chest, the `focus` refusal), `sim/feed.ts` (quest feed), `sim/planning.ts` (call `placeQuests`), `sim/training.ts`, `rooms/RaidRoom.ts` (event case, reconnect resend, `GV_TOAST`, `questSalt`), `config.ts`, `bots/BotClient.ts`.
- Client: `main.ts` (inbox before the first state), `scenes/RaidScene.ts`, `ui/hud.ts`, `ui/minimap.ts`, `ui/mapPainter.ts`, `ui/planning.ts`, `ui/planning.css`, `render/FxView.ts`, `render/PlayerView.ts`, `ui/helpOverlay.ts`, `ui/trainingConsole.ts`, the results panel (`quests` GV line).
- Tests: `sync.test.ts` (field list), `fxCodec.test.ts`, `inputs.test.ts`, `e2e.test.ts`, `bandwidth.test.ts`, the minimap painter golden hash.
- Docs: CLAUDE.md (a Quests architecture rule; Known TODOs: public quest state and the finder-position leak, interest management, quest values are model values), `docs/GAME_DESIGN.md` (2.2 leaves "later"; a new quests section), README controls (G, J), `docs/ROGUELIKE_PLAN.md` as-built.

### 6.9 Conflicts with in-flight work
- **R2 is not on the R5 line.** R2 edits `rooms/RaidRoom.ts`, `sim/world.ts`, `shared/planning.ts`, `client/main.ts`, `BotClient.ts`, `minimap.ts`, `MapView.ts` and changes every distance (96x96, 4 camps per zone, pool 24-32). The site recipe needs R2's `buildings`, `territoryGrid` and zone layout. R2 appends `attempt`/`mapHash` to `RaidState`; quests append after them.
- **`claude/r3r4a-main` has 19 uncommitted files** on top of a commit the R5 line contains, including a `hurt` signature change (`hpBefore`), and edits to `ledger.ts`, `mods.ts`, `planning.ts`, `step.ts`, `world.ts`. They should land on the R5 line before quest code starts.
- **Human bots** (`claude/human-bots-0f19c0`) rewrote `BotClient.ts`; R3, R4a, R5 and R2 all edit the old one. Quests add a third hand to that resolve: build `questHunt.ts` pure so it ports to either driver.
- **Zone terrain** (`claude/zone-terrain-75bb8e`, on main): replaces `advanceAlongPath` with `walkFighter` in `step.ts`, edits `mobLife`, `mobAI`, `loot.ts`, `minimap`, `MapView`. Quest sites need `terrain === NONE` on their 3x3; the carry slow multiplies under its 0.35 floor; Light heals and Ember burns change the hp budget that limits farming (and would change `lambda`).
- **R4b** (on-hit statuses): turns 6 inert buffs and 2 passives live, which widens the quest card pools (Sentenced, Plague and Frost zones gain options). Quest code must read the live lists, not hard-code them.
- **R6** (Q/E actives) takes Q and E; G and J stay free. **R7** ("?" camps, relics, the private `reveal` message): quests' `reveal` reward should become that message when R7 lands.

---

## 7. Phased build plan

Model use (the owner's standing preference, restated for this run): Sonnet subagents do the majority of the work in every phase; Opus is used only for the trunk merges (Q0), the Q2 architecture review and the Q7 balance review.

| Phase | Work | Depends on | Ships | Model |
|---|---|---|---|---|
| **Q0 Trunk** | Land the r3r4a-main follow-ups on the R5 line; fast-forward `main` to the R5 line; merge R2 into it (map size, planning deal, RaidRoom, BotClient). Confirm the suite, `stepBench` and `bandwidth` are green. | owner go-ahead | a trunk with R2 + R3/R4a + R5 + Wishes | Opus (merge) |
| **Q1 Catalog and price** | `shared/quests.ts` (20 defs with `price` rows, verbs, rewards, `drawQuests`, `walkScale`, `payScale`, wire tables); `questPower.ts` (P of a build state per faction, zone and held stacks; card sizing so each offered card is within +-15% of the target, tested over 5 factions x 5 far zones); the price test (arithmetic on the section 3 table from the shared function, printing both the E ratio and the success-time ratio, kinds 6/6/6/2, suit 8/6/6, claim/open 13/7, success-time floor 0.65 for claim rows, fresh-camp ratio at least 1.3 for W1/W2 defs, hp efficiency at most 1.6x a camp, `p` flagged `model`); `sim/questSites.ts` as a pure module with a 1000-seed sweep (sites per zone, spacing, the 3 s pool rule, reachability, per-instance timers within slack 5-9 s, leg sums 0.8-1.25x). The price table is checked against `final_price.py`. No gameplay. | can start now on a branch from e57d6c0 (the site sweep needs R2 maps: run it once Q0 lands, or against `claude/r2-zones` read-only) | data and tests | Sonnet |
| **Q2 Skeleton** | Schema rows and `carry`, the input, the private message and inbox, `questSalt` streams, placement at planning start, the live-window schedule, top-ups and the patience extension, claim / abandon / timeout / progress guard / release, the focus rule, the carry mod source, drop and steal (`hops` 1, 50%), payouts (stacks, pick, heal caps, quest GV pot, feed, P budget, decay), `SimConfig.quests`, structured acks; minimal client (markers, tracker, panel, minimap with the fuzzy carrier ping, planning box, G/J). Quests Q01, Q02, Q05, Q08 end to end. Tests: action order ties, steal and deadline, expiry on teleport and run end, reconnect resend, secrecy, sync field list, fx round trip, schedule against deaths, bandwidth scenario. | Q0, Q1 | the core loop | Sonnet; Opus review at the end |
| **Q3 Holds and open objects** | `hold` with the damage-aware pause, channels, Wish block on heavy and bright carries, the Idol drip, the Sigils race and consolation, Fragile Vials (`hitLanded` + `payLater`), second instances at 7+. Q03, Q06, Q07, Q09. | Q2 | coliseum funnels and denial | Sonnet |
| **Q4 Unknown quests** | Rumor discs (12-tile offset, 6-tile reveal), prox reveal with the 4 s claim group, time / chain / event reveals and slot fallbacks, emptiest-zone placement with the 30 s average, private sites, Coin Rain pops, Carrion Call as a modifier, the shrine reveal reward. Q04, Q10, Q11, Q12. Metamorphic secrecy test (perturb the hidden draw: the whole synced state, the fx stream and the roster stay byte-identical; changing behaviour leaves the draws equal). | Q2 | exploration | Sonnet |
| **Q5 Kills and quest mobs** | `mobKilled` hook, `isShieldedFrom`, quest mob kind and the roster budget, bound champions, reserved camps, gladiator waves, the Convoy `march` mode, the Marked and the Highwayman (`playerKilled` with victim and outcome, transfer caps, the PK payout guard). Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20. A `mobDuel` pass for the Warden, gladiators and gauntlet packs **per faction and zone pairing** (target: 20 of 25 starter pairings win and no faction below 50% of the median completion; retune the champion hp table). | Q2 (Q3 for the banner carry) | the full catalog | Sonnet |
| **Q6 Bots and e2e** | `questHunt.ts` with the humanizer, `BotClient.questStep`; e2e with quests on (at least one quest completes, replay once like the existing rule; every `quest` fx decodes; **a lobby with one early death still has an open quest until the teleport minus 40 s**); the human-bots `FeatureModule` when that line merges. | Q2-Q5 | bots that play quests | Sonnet |
| **Q7 Measure and tune** | `bench/questBench.ts` tournaments at 2, 4, 8 players with the metrics and gates of section 4.6. Re-issue the table from measured p, retune windows, the pay scale, the P budget and rewards as data. Turn quests on in `loadConfig`. | Q6 | defaults on | Sonnet runs; Opus reviews |
| **Q8 Docs** | CLAUDE.md rule and Known TODOs, GAME_DESIGN, README, ROGUELIKE_PLAN as-built (each phase updates its part; this closes it). | each phase | | Sonnet |

Q1 is the only phase that can start before Q0. Everything from Q2 touches `schema.ts`, `messages.ts`, `fxCodec.ts`, `world.ts`, `inputs.ts`, `RaidRoom.ts`, `RaidScene.ts` and `BotClient.ts`, the exact files the trunk merges move.

---

## 8. Owner questions (each with the default this plan uses)

### 8.1 Decide first (ranked)
1. **How to read "1.0 to 1.3 times the mob time".** Default (A): risk-adjusted expected time E, including the cost of an elimination, 1.0 to 1.35, plus a floor of 0.65 on success time for claim quests (they run 0.67 to 1.04). Alternatives: (B) success time only (the risk gets no premium; riskier quests pay less per attempt); (C) E only, no floor. Why it matters: on success time alone the lotteries sit at 0.46 to 0.54 and 14 of 20 old rows were below 1.0.
2. **How many quests per game.** Default (A): scale with the lobby, 3+3 at 2-3 starters, 4+4 at 4-5, **5+5 at 6-7 (your numbers)**, 6+6 at 8. Alternatives: (B) always 5+5; (C) always 10 with a second instance of every open quest at 6+. Why: 5+5 at 8 players leaves about 39% of players with no payout.
3. **Quests after an early death and after the teleport.** Default (A): waves are fractions of the live window, a top-up after an early death, a small second season at every gate unlock with 150 s or more left, and a death never voids a claim in flight (the timer may extend by up to 30 s). Alternatives: (B) live-window waves only, nothing reopens, no timer extension; (C) the fixed clock (the earlier plan; 84-164 s of nothing after an early death at 8 players).
4. **How lethal and visible carriers are.** Default (A): fuzzy 300 u minimap ping, receiver private at pickup, stolen cargo goes back to the giver at 50%, one steal, heavy or bright carry blocks Wishes. Alternatives: (B) exact public blips and full-value steals (the most League-like, carriers die almost always); (C) no stealing (the cargo vanishes, carriers are safer, fewer ganks).
5. **What caps quest income.** Default (A): a 0.45 P budget per player per run plus the 3-completion cap. Alternatives: (B) a falling payout multiplier 1.0 / 0.75 / 0.5 per completion; (C) the count cap only (the three richest quests are x5.3 an average player's quest income).
6. **PvP quests (Hunt the Marked, Highwayman's Writ).** Default (A): keep both at 4+ starters with guards (the Marked only fires on a real leader; payouts need 15 s, 25% damage and once per pair). Alternatives: (B) keep only the Marked; (C) remove both (fewer quests that can eliminate a player).
7. **Quest GV.** Default (A): its own pot, capped at 24 GV per run, a completed quest required. Alternatives: (B) the mob pot (30 shared; at 4 players or fewer almost all of it is lost); (C) no quest GV.
8. **Farming while on a claim.** Default (A): camp kills outside the quest's own target pay nothing and chests are refused while a claim is active. Alternatives: (B) slack only (a median camp does not fit the 5-8 s slack, but Fire clears a size-4 camp in 6.0 s on average, about 8.5 s with the detour, so a fast faction can still squeeze one into the longest timers); (C) weapons disabled while carrying (carriers cannot fight back, the most lethal).

### 8.2 Other decisions with the default this plan uses
9. **Competitive model.** Default: exclusive claim with steal for 13 quests, open scramble for 7. Alternatives: everyone races every quest; personal copies.
10. **Feed.** Default: quest stacks and heals scale with the reward curve and catch-up; a completion counts as 4 mob kills (+1.0 feed), a coin or soul as 1; never bounty. Alternatives: no feed effect; flat stacks.
11. **How much a discovery exposes the finder.** Default: name and zone at once, a 4 s claim window for everyone within 288 u, the site public after that. Alternatives: a 10 s exact ping; fully private (impossible while all positions are public state).
12. **Reward currency.** Default: a power value sized per offered card (pick 1 of 2 far-zone buffs, filled with Ember Imp or Penitent), drips to the lower-stack of Ember Imp and Penitent, Plague Rat allowed. Alternative: Ember Imp for everything.
13. **Quest heals.** Default: through `heal()` with the 3 s lockout, owed up to 10 s, at most 15% per quest and 40% per run. Alternative: bypass the lockout.
14. **Carriers and Swarm.** Default: a heavy or bright carry blocks Wish casts; the carry glyph stays visible on any carrier; exact-position pings skip hidden fighters. Alternative: hide the glyph too.
15. **Camp-reserving quests (Q14, Q19).** Default: the hardest 4+ camp and the elite camp of each far zone are locked from planning until the claimant picks one zone, at most one such quest per season. Alternative: instance a bound pack at accept like Q13 (no supply cost, loses the real camp and its chest).
16. **Fight-quest fairness.** Default: the claimant picks one of two far zones, champion hp scales by the claimant's faction clear speed (Holy 0.45 to Fire 1.00), and questBench fails a faction below 50% of the median. Alternative: fixed champions and accept that Holy and Sentenced rarely finish Q13, Q14, Q19 and Q20.
17. **EHP guard.** Default: one defensive quest reward per player per run, documented as not protecting the Holy-over-Sentenced flip bar (the owner's "fed players may beat counters"). Alternative: a run-wide guard (farm + chest + quest) capping EHP at x1.25 from non-farm sources.
18. **Wish cooldown as a reward.** Default: no in v1 (Wishes are flat; new code with no price).
19. **Keys.** Default: G interacts, J opens the log, the panel opens by proximity. Alternative: reuse F.
20. **Public quest state.** Default: accept that every client receives every public quest row and object (like chests) and the finder's walk until interest management. Hidden quests are never in state, but a finder's position and quest mob state are public.
21. **Maps.** Default: build runtime phases after R2 merges; the site picker targets R2. Alternative: ship on wedge maps with the walk scale and retune later.
22. **Quest mob spoils.** Default: champions, gladiators, the wagon and escorts pay nothing; only the quest pays (camp quests keep the camp's own spoils).
23. **Coliseum quests.** Default: at most 2 per game (Idol, Four Gates, Gladiator Pit, the Sigils altar). Alternative: none, so every quest pulls outward.
24. **Late-game share.** Default: quests are the only growth after minute 2-3; measure with `questBench` and tune the pay scale and the P budget. Alternative: add camp regrowth or supply.
25. **Window sizes and the decay.** Default: 80 / 90 / 105 / 120 s by lobby size and a 30% decay of stack, heal and GV rows over the window. Alternative: one 120 s window and no decay (waiting is free, so W1 and W2 collapse into one burst at 1:30-2:45).

---

## 9. Risks

1. **The trunk is not ready.** R2 is not on the R5 line, `claude/r3r4a-main` has 19 uncommitted files, and the human-bots line rewrote `BotClient.ts`. Quest runtime code started before Q0 would be rewritten in the merge.
2. **The prices are a model.** Every `p`, `q_d`, `C_ELIM`, search budget, champion fight time and overhead is a guess. The two bases for stack value bracket the mean ratio at 0.98 to 1.57; the median basis and the interim trim sit in the middle. A swing of +-0.15 in p moves the gamble rows by -0.2 to +0.4, wider than the 0.35 band, so the band is asserted only on measured p (section 4.6).
3. **The elimination term is the biggest guess.** `C_ELIM` 90 s and `q_d` raise the ratio of every exposed quest by 10-40% against the old table; the rewards were sized to it. If real elimination rates are lower, quests overpay.
4. **Spawn luck can still decide contests.** Claims go to whoever arrives first. W1 is open-mode, the pit is equidistant, ring-road givers carry the top-tier quests, giver value is balanced per zone, and unknown quests land in the emptiest zones, but the nearest-spawn win rate is a questBench gate (25%).
5. **Death is elimination.** A gank on a quest runner usually ends that player's run. That gives quests real stakes, but 8-player lobbies may avoid them; measure participation (players with no payout, players who never met another player).
6. **Untuned quest mobs.** Elite camps clear in 9 of 25 starter pairings today (M). The Warden, gladiators, gauntlet packs and the Convoy need a `mobDuel` pass per faction and zone, or Q13, Q15, Q19 and Q20 become traps for Holy and Sentenced.
7. **Reserved camps cost supply.** Q14 and Q19 lock up to 4 camps (2 per quest, hardest of their zones) from planning until the claim; at 8 players the early rush rarely wants them, but the lock is a real cost and a bot-behaviour change.
8. **Season complexity.** Waves, top-ups, season 2 and the patience extension are new rules in the clock the owner already ruled on (flat 5:00, scaled timers). The extension is capped at 30 s and applies only while a claim is in flight.
9. **Small lobbies.** A death with 3 left alive restarts the patience timer at 120 s; the live-window schedule compresses unopened waves so quests still open, but 2-3 players get 3+3 quests and a quest share near the 50% cap.
10. **Public state and cheating.** Every client receives every public quest row, object and position (no interest management). Swarm hiding and the blurred ping are honest-client rules. Hidden quests are safe only because they are never in state; a finder's walk and quest mob state are public. The secrecy test must hold that line.
11. **Complexity.** 20 quests, 5 verbs, 2 modes, 4 reveal rules and 4 special rules. The phase order ships value early (Q2: 4 quests), so the catalog can be trimmed if a phase overruns.
12. **Bandwidth.** About +0.1 to +0.3 KB/s expected; R5 found that extra arrays can push ref ids past one varint byte. A dedicated bench scenario gates it at +0.5 KB/s.
13. **Refusal handling.** The R5 chest panel reads refusals from toast text. Quest acks must be structured codes from the start.
14. **Hooks.** `playerKilled` needs a victim and outcome, `fighterOut` fires for mobs and twice for a leaver, and `isEvading` has eight call sites to replace with `isShieldedFrom`; a missed site lets a bound champion act as a wall. `mobKilled` must fire from `payMobKill` after the pass, or a quest reward could change who survives.
15. **Zone terrain.** If it ships, Light heals and Ember burns change the hp budget that makes quests valuable (and `lambda`), and LOW ground creates real chokes that the walk scale and the leg-sum test must absorb.
16. **Bots.** Without bots that play quests, neither the e2e run nor `questBench` can measure anything. Q6 is a hard dependency of Q7, and bots without the humanizer lower p.

---

## Provenance and scores

| Design | Score (a/b/c/d/e) | Total /50 | Taken into this plan |
|---|---|---|---|
| systems | 8 / 8 / 9 / 9 / 8 | 42 | The base: 5 verbs and data rows, exclusive claim with steal, bound champions, the carry as a mod source, the timer slack rule, walk-scaled rewards, P price sheet and failure factor, R_REF, most of the catalog (Q02, Q03, Q05, Q07, Q08, Q11, Q13, Q14, Q15, Q16, Q19, Q20), the verified baseline. |
| gank | 9 / 7 / 8 / 6 / 8 | 38 | Waves at 0:45 / 1:30 / 2:15 / 3:00 timed to the camp rush and the Wish unlock (now fractions of the live window); the rumor disc and emptiest-zone placement; Idol of Embers, Sigils of the Five, Coin Rain, Carrion Call, Tax Convoy; stacks scaled by the reward curve; lobby scaling; one `quest` fx kind with a sub-event table; Ember Imp as the drip currency (now Ember Imp or Penitent). |
| economy | 7 / 8 / 8 / 8 / 6 | 37 | Counting quests in the feed; the EHP guard; the finder's head start and delayed publication; `hops` limit; the Highwayman's Writ; the contest analysis; counting a camp quest's own spoils in its price; one-way Sealed Letter. |

Criteria: (a) creates ganks and farm-or-risk decisions, (b) balance against mob farming, (c) fits the owner's spec, (d) implementable within the architecture rules and hidden-information limits, (e) fun and clear for players.

Review passes (2026-10-26): a balance audit (recomputed the table, measured legs and starts on 100 R2 maps, ran the sensitivity cases) and an exploit review (measured hunters, claims, sites and the private-deal leak, read the hook and ledger code). Their scripts are in `.../scratchpad/quests/audit/` and `.../critic/`.

---

## 10. Changes after review

Two reviews of the first version of this plan (a balance audit that recomputed the table on measured legs and 100 R2 maps, and an exploit review that measured hunters, claims and sites) found five structural problems and a set of hook traps. Every high and medium finding was applied. The table in section 3 and the numbers in section 4 were **recomputed from the new model** (`scratchpad/quests/final/final_price.py`), not edited by hand.

**What changed in the economy**
- The comparator and the band (4.1, 4.2, 4.5): two bands (a fresh camp for W1/W2, spread only for W3+), the ratio now carries an elimination term (`C_ELIM` 90 s x `q_d`), winner-take-all quests use p per contender with a consolation, the pay scale follows lobby size (x0.88 at 8, 1.00 at 6, 1.12 at 4, 1.45 at 2), a 0.45 P budget replaces the count as the income cap, and both the E ratio and the success-time ratio are reported with a 0.65 floor for claims. The old table's mean ratio was 1.16 at the 6-player rate, 1.02 at 8 players and 1.63 at 2; it is now 1.21 at 8, 1.22 at 6, 1.23 at 4 and 1.26 at 2.
- Stack currency (2.8, 4.1): rewards are power values sized per offered card (+-15%), drips go to the lower-stack of Ember Imp and Penitent, the biggest stack rows are trimmed about 20% (Q08, Q13, Q04, Q07, Q09, Q20, Q06) until `questPower` replaces the median proxy.
- Hp (2.8, 4.2): heals capped at 15% per quest and 40% per run; the plan does not charge gross hp (it degenerates against the camp) but checks hp efficiency (at most 1.6x a camp per net hp, the old table was 1.9 to 4.1x) and reports hp at the teleport; Q18 got a 15% heal, Q11, Q13, Q15 and Q20 lost 11-15 points of heal (Q11 and Q15 got stacks back).
- Rewards and rows: Q02 pick + 3.5 st + heal 8% (was pick + 4 st), Q03 2.5 st + heal 15%, Q05 2.5 st + heal 5%, Q07 heal 8%, Q08 heal 5%, Q09 heal 15%, Q10 8 piles and 1.1 st each, Q11 pick + 1 st + heal 15%, Q12 3 st + 6% heal per soul and a modifier instead of a slot, Q15 1.5 st, Q17 2.4 st + heal 10% + the cargo priced in, Q18 top three paid, Q19 heal 10%.
- Quest GV has its own pot (cap 24) instead of the mob pot.
- p values are flagged `model`; the band is asserted only on measured p.

**What changed in timing and supply**
- Waves are fractions of the live patience window with compression on shortening, re-timing on lengthening, a top-up when cover ends 60+ s early, a season 2 at every gate unlock with 150 s or more left, and a patience extension (up to +30 s) so a death never voids a claim in flight (2.6).
- Timers are computed per instance from measured legs with slack clamp(0.15 x legs, 5, 9) s; fight steps pause them under hard caps; placements outside 0.8-1.25 x nominal are rejected; the walk-scale clamp is [0.75, 1.40]; the "always under 18 s" sentence was corrected.
- Focus rule (kills outside the quest's own target pay nothing during a claim), progress guard and release (a quest returns with its full window), windows sized by lobby (80-120 s) with a 30% decay, and an explicit statement that the window, not the claim timer, stops "farm all the way to the quest".
- Counts: 3+3 / 4+4 / 5+5 / 6+6 by lobby (was 5+5 or 3+3); second instances of Idol and Convoy at 7+; slot fallbacks; known quests never swapped; `publicSites` per def; Q12 is a modifier; Q16 needs a real leader; Q10's trigger is a fixed time.
- W1 is open-mode only (Convoy plus Idol or Sigils); claim quests start at W2; the spawn rule is public and pool-based (3 s from every pool spawn, not 6 s from every dealt option); giver value is balanced per zone and the top-tier givers stand on ring nodes; the nearest-spawn gate is 25% (was 35%); players with no payout gate 25%.

**What changed in exploits and architecture**
- Carriers: a private receiver chosen at pickup (Q01), stolen cargo delivered to the giver at 50%, one steal, heavy and bright carries block Wishes, one minimap rule (blurred 300 u ping, exact blips only for the Writ), the Writ priced for its cargo.
- PvP quests: a payout guard (15 s alive, 25% hp dealt or taken, once per killer-victim pair), the Marked chosen by estimated power with a feed and kills floor and a 6-stack transfer cap.
- Camp quests Q14 and Q19 reserve real camps from planning (no more "re-pick at open"), claimants of Q13 and Q14 and Q19 pick one of two far zones, champion hp scales by faction clear speed, and questBench fails a faction below 50% of the median.
- Architecture: `boundTo` with `isShieldedFrom` at every `isEvading` call site, per-entry zeroing in the ledger call to `hurtMob`, a quest-group id, a quest-mob budget (cap 30, bodies reused), `playerKilled(world, killer, victim, outcome)`, `fighterOut` only for players and only on `down`, a carry snapshot before the drop, `hitLanded` + `payLater` for player-damage interrupts, tick-start median for payouts, ties from the quest stream's own tie sub-stream (not `combat.rank`), `questSalt` as four more crypto words with a sub-stream per quest, instant accept and give inputs, status rules for channels and rings, hold pause only while fighting.
- Secrecy: the finder's head start is reworded as claim exclusivity (4 s, to everyone within 288 u), quest mobs spawn only on approach, the disc offset is 12 tiles with at least 8 candidates inside and a 6-tile reveal radius, and the secrecy test compares the whole state, the fx stream and the roster; the finder-position leak is a Known TODO.
- Unknown placement: zone counts averaged over 30 s, random among the two emptiest, never the previous zone, 8 tiles from any living player.
- Bots get a humanizer (200-500 ms plus RTT, the view window, the blurred ping).

**Not changed, deliberately**
- Hp is not charged in the ratio (degenerate), the pick is not scaled by the walk scale (placement is constrained instead), W2 is not offset from W1 by a full window (W1 is open-mode and cannot wait, and the decay prices waiting), the second-finisher payout was not adopted (claims are exclusive; per-player instances remain an option in question 9), a run-wide EHP guard was not adopted (the owner's ruling stands), and Q16 stays outside the income band as a labelled bounty row.

**Owner decisions added or changed** (section 8): 1 (the reading, now with a floor), 2 (counts by lobby), 3 (after the teleport, now with a default), 4 (carrier lethality), 5 (the cap is a P budget), 6 (PvP guards), 7 (own GV pot), 8 (focus rule), 15 (camp reservation), 16 (fight fairness), 25 (windows and decay).
