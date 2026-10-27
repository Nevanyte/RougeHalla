# RougeHalla roguelike overhaul: phased implementation plan

> **Owner rulings (final, 2026-10-26; these override the tables below)**
> - **D21 is reversed: the Wishes session owns the status-effect runtime** (`sim/status.ts`-style timed statuses, silence, cleanse, invulnerability, displacement, areas) as well as the ability framework.
>   - Wishes builds it to the R0 checklist in section 4.
>   - Roguelike R0 shrinks to the contracts that aren't status-related: map `CampDef`, `MOB_TYPES`, the quantized stat mirrors with `sim/mods.ts`, the wedge adapter, `rewardRandom` and the `hitLanded` stub.
>   - R0's `Effect` union adopts Wishes' status kinds; the orchestrator relays Wishes' contract.
>   - R4b, which needs on-hit statuses, waits for Wishes' status runtime on main.
> - **D12 is confirmed:** a skip heals 15% max HP when out of combat (the lockout applies); in combat or at full HP it gives 3 GV, which counts against `GV_MOB_CAP`.
> - **Accepted as written:**
>   - Decision 10: a flat 300 s for the first timer, then today's scaling.
>   - D1: a chest is also removed at the coliseum teleport.
>   - D6: buff numbers are the value at 3 stacks.
>   - D7: "shield" means the magic-resistance stat.
>   - D10: the start boon is picked on the planning screen and applied at run start.
> - **Owner rulings after the R3/R4a report (2026-10-26):**
>   - **Weaker mobs (for R5's camp-wide aggro).** Lower `MOB_K` (and `ELITE_K` if needed) until most starters clear a full normal camp when the whole camp wakes: target at least 20 of 25 faction x zone pairings in `bench/campDuel.ts`, elite camps reported alongside (they may stay harder). Measure before and after. Result: see "As built" (R5).
>   - **Weaker mobs, outcome (R5 branch):** `MOB_K` 0.45 -> 0.22 (`ELITE_K` stays 0.65): at camp size 4 starters clear a full normal camp under camp-wide aggro in 21 of 25 pairings (was 4); the elite camp 9 of 25 (was 3). Tables: "As built" (R5 follow-up: weaker mobs).
>   - **Attack speed.** Plague Rat's doubling is not 2x attack speed: it was +4% -> +8% at 3 stacks (about +17% at the 2.1x plateau). The owner does not accept halving it: search the value between x1 and x2 (aim for >= 2/3 of the doubled value) that keeps `testing/test_kite.py` passing with buffs applied, check it in the real sim, and if only <= x1 passes keep the doubled value and add one League-style cap on the attack-speed multiplier from all sources, relatively high and as low as the kite guarantee needs. Then sanity-check every attack-speed and dps source. Result: see "As built" (R4a follow-up) and `testing/TUNING_ROGUE.md`.
>   - **Attack speed, outcome (2026-10-26):** "double them" took Plague Rat from +4% to +8% attack speed at 3 stacks; it was never 2x attack speed. The owner refused halving it: Plague Rat stays +8%.
>     - One League-style cap on the attack-speed total from every source, `AS_MULT_CAP`, applied after the sources multiply and before the mirror is encoded. First set to 1.25 (the kite model's limit), then raised to **1.5** by the owner (the real sim's limit; the model no longer holds there).
>     - No cap on the damage rows: fed players may beat their counters.
>     - Buffed shooters beating Holy > Sentenced is accepted, with no retune.
>     - Plague Rat's `worksWith` (left to the session) is `["frost", "holy", "plague"]`: attack speed is weapon damage only, worth +8% of all damage to Frost and Holy, +4% to Plague, +2% to Fire and +0.1% to Sentenced. Only the tooltip reads `worksWith`; the planning screen's counter list reads `counters`, which stays `["any"]`.
>   - **Leaving during planning counts as a loss:** a consented leave, or a drop whose reconnect grace runs out, during planning is MIA, as a leave in the run is: a result, a run and a death in the stats, no GV. The leaver stays a starter; with one player left the run starts at once and that player wins with the win bonus withheld. A shutdown during planning voids the run. Only the lobby is free to leave.
>   - **Merge order:** Wishes merged into `main` first; R3/R4a was then merged with `main` and its conflicts resolved against it on `claude/r3r4a-main` (cut from eafcc87); that line was then folded into the R5 working branch (`claude/roguelike-zones-e9adf2`), where R5's two fx kinds were renumbered after the Wishes' (`campCleared` 18, `chestTaken` 19).
> - **"Double them" (2026-10-26, after the R4a power report):** every BuffDef 3-stack value in section 3.4 is x2 in the code (`shared/buffs.ts` ROWS). Caps, durations, thresholds, `MOB_BUFF_STACKS`, `ELITE_BUFF_STACKS`, the reward curve and catch-up are unchanged. The owner tunes again after the playtest. The numbers in the 3.4 table below are the drafts; the code is authoritative.

Base: `main` at 9aae4ce. controls-feel was merged as f2aa8fc and web-ui-polish as 9aae4ce, after 4c8af1c. Branch state, checked 2026-10-26:
- `claude/wishes-349ec2` has no commits.
- `claude/roguelike-zones-e9adf2` has no commits of its own. It is the home for R1 and R2 and moves up to 9aae4ce before work starts.
- Nothing else is in flight.

This plan touches no code. Every number below is a first pick. The owner retunes the numbers; the sessions do not.

**Docs cadence.** A phase updates the CLAUDE.md architecture rules and Known TODOs, and the GAME_DESIGN sections it changes, in the same change. R9 only checks the docs.

**Strategy.** The core loop is built and playtested on today's wedge maps first:
- planning;
- typed mono-type camps;
- the new buffs;
- contested chests with passives.

The generator spike runs at the same time. Zone maps then swap in behind the same map contract, so the generator is never on the critical path.

---

## 1. Target experience

**Lobby.** During the lobby countdown, every player already sees a read-only preview of the whole map:
- five faction zones around a fixed central coliseum (wedges at first, organically shaped zones after R2);
- each camp's mob type and the themed buff it gives;
- elite crowns, chest kinds, and a few "?" camps whose reward is hidden;
- the factions of the other players present.

**Planning.** At load-in, a 12-second planning screen is only for the dealt choices:
- one of two spawns, both in the same walking-distance tier and in different zones;
- one of two small start boons.

A spawn someone else takes shows as taken right away. The screen shows each camp's matchup against your faction and the buffs that counter the factions present. You can draw a route, which shows faintly during the run.

**The run.**
- Every mob kill adds stacks of that mob type's buff on the S-curve.
- A cleared group drops one shared chest at the camp for 15 seconds.
- Anyone nearby takes one pick (1 of 3 skills, or a relic from an elite camp), first come first served.
- Cleared camps stay cleared on everyone's map.

**The skill.** The skill is knowing which buffs, skills and relics beat which matchups, and routing to get them. Inspect tooltips, a death recap and a hub Codex teach those matchups. Replayability comes from route regret: "I should have gone through Plague for Rot Monk before facing that Holy."

---

## 2. Core design decisions

| # | Decision | Ruling (owner updates applied) | Default and notes |
|---|---|---|---|
| 1 | Zones | 5 themed zones on every map (Fire, Sentenced, Plague, Frost, Holy/"Demon Blood"), random shapes and positions | "Paint bucket" region growing, deterministic from (seed, attempt). Today's wedges serve until R2 swaps in |
| 2 | Coliseum | Fixed at the centre | Today's coliseum and pillar layouts are reused as they are |
| 3 | Spawn | Pick 1 of 2 on the planning screen | Both options come from the same walking-distance tier (within ±8% of a shared contour value) and lie in different zones. The first pick wins, and the option shows as taken live; within one tick, the shuffled `actionOrder` decides. Options may overlap between players when 2 × players exceeds the pool. The walking-ratio target is reported |
| 4 | Information | Mostly visible, plus a few "?" camps | A "?" hides the camp's **reward** (kind and contents), never its mob type. 3 per map; elite camps are never "?". The reward is revealed to everyone on the camp's first damage. Lands in R7 |
| 5 | Skills | 2 active slots (Q, E) plus unlimited passives | Taking a new active with both slots full asks which slot to replace |
| 6 | Chest contents | 2 skills from the zone pool + 1 neutral, skip allowed, no rerolls | A skill you own is applied as rank 2 when you pick it. A skill you already have at rank 2 cannot be picked. An interim rule applies until R6 (see R5) |
| 7 | Buffs | The 3-stat system is replaced by per-mob themed buffs on the S-curve | Kill combos are removed and come back as relic and skill synergies (`requires` rows) |
| 8 | Chest ownership (replaced) | Contested shared chest | See D1–D3 |
| 9 | Camp respawn | One time per run, no respawn | Cleared state is synced, so it is visible to everyone |
| 10 | First patience timer (replaced) | 5:00, as the owner said | `SimConfig.firstPatienceSeconds = 300` flat for the first timer. Today `beginRun` arms `patienceMs(world, players.size)`, so a 2–3 player lobby gets 120 s. Unset keeps today's scaling, so the ~76 test references hold. Timers after a death keep the scaling. It starts when planning ends. **Owner confirms flat 300** |
| 11 | Meta | No unlocks; cosmetics only | The full pool is visible from the start |
| D1 | Chest lifetime | Vanishes 15 s after it drops, no matter what. It is never extended | `CHEST_SECONDS = 15`. It is also removed at the coliseum teleport, when it can no longer be reached because the gates lock. **Owner confirms** |
| D2 | Chest picking | One pick per player. Skipping counts as your pick. Taken options disappear for everyone | Within a tick, picks resolve in the shuffled `actionOrder` |
| D3 | Chest range | 96 u with line of sight | `CHEST_RANGE`. The server checks the authoritative position. The client enables picks from the latest server position within `CHEST_RANGE − 8 u`, not the predicted position. The panel opens on its own in range |
| D4 | Camps per zone | 3: two normal camps and one elite camp, on zone maps | 4 only where the spike shows room: 15 camps per map. Wedge maps keep their ~2.2 per zone (11.1 per map) until R2 |
| D5 | Camp roster | Mono-type camps; on a 3-camp zone each of the zone's 3 normal types appears once | The elite stands at the elite spot of the zone's elite camp, whose other mobs are the third normal type. A 4th camp repeats one normal type, drawn from `rewardRandom`. On wedge maps (2–3 camps), types are drawn without repeats, so one normal type may be absent. Rosters are rolled at world build |
| D6 | Buff number meaning | The quoted value is the value at 3 stacks | See the buff formula in 3.4. **Owner confirms** |
| D7 | "shield" in buff text | The magic-resistance stat (`factions.ts` `shield`), not a barrier | "Barrier" means an absorb. **Owner confirms** |
| D8 | Elite reward | Relic cache (1 of 2) instead of the skill chest | Same contested rules. Lands in R7; until then elites drop the skill chest |
| D9 | Cursed chests | 1–2 cursed camps per map, marked on the planning screen unless the camp is "?" | Options are one rank higher (or a relic), each shown with its curse. A real mimic fight is deferred. Lands in R7 |
| D10 | Start boon | Pick 1 of 2 on the planning screen | Applied at run start, after placement. Moved from "at spawn": **owner confirms** |
| D11 | Skill damage basis | P = one second of the caster faction's paced DPS | Uses the caster faction's damage shares, so armor and shield counters still apply. Never a percentage of the weapon hit: Sentenced's hit is 5 |
| D12 | Skip reward | Heal 15% max HP, **respecting** the combat lockout | In combat or at full HP: 3 GV, which still counts against `GV_MOB_CAP`. A lockout-free heal on a shared chest would give any passer-by a mid-fight heal. **Owner decides** between this and GV only |
| D13 | Keys | Q and E cast skills; D casts the Wish; weapon swap moves from Q to X; C focuses the chest panel | The swap change lands with R6; the chest focus key with R5. Every binding is remappable on physical `e.code` (R6) |
| D14 | Planning length | `PLAN_SECONDS = 12` (env override) | Starts early when everyone is ready. The map and rosters are readable during the lobby, so 12 s is only for the dealt choices |
| D15 | Leash | Inside the camp territory and within a 12-tile cap radius | Wedge and hand-built maps keep the old 9-tile circle |
| D16 | Hidden information | The map holds geometry only | Rosters are rolled from the private server stream `world.rewardRandom` and published at world build. "?" flags, the "?" reward kinds, cursed flags, chest rolls and plan deals stay server-side or in private messages, never derived from the public seed |
| D17 | Chest contents visibility | The options of a chest that is up are in synced state | Contested and public by design, and it survives reconnects. The UI shows contents only in range. Known TODO: state exposes them to every client |
| D18 | Weapon loot | Weapon crates and ground weapons stay | `crateSpots` and `groundSpots` keep feeding `loot.ts` |
| D19 | Ruins | Optional (0–2 per zone) | The "indoor chest per region" rule is dropped |
| D20 | Generator cost | A pool of pre-certified maps per server process | A background `worker_thread` fills a queue of certified (seed, attempt) pairs. `buildWorld` takes one. The state publishes `seed` and `attempt`, so clients and bots run exactly one attempt. The client builds its lane tables in a Web Worker at app boot and generates the map in that worker as soon as it has (seed, attempt). `RaidState.mapHash` detects a desync |
| D21 | Status and mods runtime | Owned by this plan (R0) | `sim/status.ts`, `sim/mods.ts` and `shared/effects.ts` land first; Wishes builds on them. The ability framework (`AbilityDef`, `cast`, slots, cooldown UI) stays Wishes'. **Owner confirms the split** |
| D22 | Mirrors | Quantized stat mirrors are authoritative | The sim itself uses the quantized `asMult`, `speedMult` and `windupMult`, so the prediction matches exactly |
| D23 | Persistence | Builds, buffs and routes live for one run and are never banked | `RunResult.build` and `route` are display-only. No ProfileStore file version bump |
| D24 | Camp aggro | Damaging one camp member wakes every idle member of that camp | Today camp-mates wake independently (`mobAI.aggro`), so mono-type camps can be pulled one at a time. R5 decision; **owner confirms** |

---

## 3. Data model and contracts

### 3.1 Where each piece of data lives

| Seed-derived (shared `generateMap(seed, attempt)`, never synced) | Synced state (public to every client) | Server-private (runtime or private messages) |
|---|---|---|
| tiles, `regionGrid` (zone = faction region), `territoryGrid` | `RaidState.seed`, `attempt`, `mapHash` | `rewardRandom` stream state |
| `camps[]`: id, zone, pole, spots, elite spot, chest tile, leash radius | `RaidState.camps`: one `CampState` per map camp, by index | "?" reward kinds until reveal; cursed flags of "?" camps |
| `spawnPool` (tagged by zone), `crateSpots`, `groundSpots` | `MobState.type`, `MobState.camp` | Chest option rolls before the drop |
| zone poles and areas (labels) | Reward containers: options, `takenBy`, `pickers`, `expiresAt` | Plan deals (2 spawns, 2 boons, taken flags): private `plan` message |
| | `PlayerState.buffs`, `build`, `slotQ`/`slotE`, quantized stat mirrors | "?" reveals from Scout or Insight: private `reveal` message |
| | `planEndsAt`, `planReady` | The drawn route (client only, in `sessionStorage` by room id, never sent) |

### 3.2 Map contract (`shared/src/map.ts`)

```ts
interface CampDef {
  id: string;            // "fire-1"; stable order: zone order, then index
  zone: FactionId;
  x: number; y: number;  // tile centre of the camp site
  r: number;             // clearing radius
  spots: Vec2[];         // 3–5, never the chest tile
  eliteSpot: number;     // -1, or the index in spots
  chest: Vec2;           // reward chest tile
  area: number;          // territory floor tiles (0 on wedge maps)
  radius: number;        // farthest territory floor tile in world units; leash = min(radius, 12 tiles)
}
interface GameMap {
  // ...existing fields
  attempt: number;             // the certified attempt this map was built from
  territoryGrid: Uint8Array;   // 0 = none, else 1 + camp index (all 0 on wedge maps)
  camps: CampDef[];
  spawnPool: { x: number; y: number; zone: FactionId }[];  // map.spawns stays as a view
  // regions[]: + pole, + area; anchor removed; mobCamps kept as views until R2, then removed
  // removed in R2: extracts, ridges and passes (and their keep-outs)
}
generateMap(seed: number, attempt: number): GameMap   // runs exactly that attempt; certification is the server's job
```

**R0 wedge adapter.** R0 fills the new fields from today's `regions[].mobCamps`:
- `chest` is the clearing floor tile nearest the clearing centre that is not a spot;
- `eliteSpot` is 0 for an elite camp;
- `radius` is the old 9-tile leash;
- `territoryGrid` is all 0;
- `spawnPool` is `map.spawns`, each tagged by `regionGrid`.

### 3.3 Camps, chests and choice

```ts
// RaidState.camps: t.array(CampState) in map.camps order; geometry stays seed-derived
CampState   { type: string /* MOB_TYPES id of the camp's normals */,
              reward: "" | "?" | "skills" | "relic" | "cursed",
              alive: uint8, state: uint8 /* 0 idle, 1 engaged, 2 cleared */ }
MobState    + { type: string, camp: uint8 /* camp index + 1, 0 = none */ }
ContainerState (kind "reward") + { camp: uint8, expiresAt: uint32, options: string[],
                                   takenBy: string[] /* "" = free */, pickers: string[] /* took or skipped */ }
// client -> server
choose  { chest: string, pick: number /* -1 = skip */, replace?: 0 | 1 }
plan    { spawn?: 0 | 1, boon?: 0 | 1, ready?: boolean }
// server -> client, private (resent on every change and on reconnect)
plan    { endsAt, spawns: [poolIndex, poolIndex], taken: [boolean, boolean], boons: [BoonId, BoonId] }
reveal  { camps: { index: number, reward: string }[] }
```

### 3.4 Mob roster and buffs

`MOB_TYPES` lands in R0 as contract data in `shared/mobs.ts`: id, zone, elite flag and display name for 20 types. It replaces the 2-name table. R4a adds the buff rows, and R3 and R4a both read the table, so neither depends on the other. In v1, mob types fight identically within a zone; only the skin and the buff differ (**owner confirms**).

Buff value at a given stack count:

```
value(stacks) = at3 × S(stacks) / S(3)
S(x) = sigmoid((x − 3) / 1) − sigmoid(−3)
```

- 1 stack gives 0.16 × at3, 2 stacks 0.49×, 3 stacks 1.0×, 4 stacks 1.51×, 6 stacks 2.0×. The plateau is about 2.1×.
- Each kill grants `MOB_BUFF_STACKS` 1.1 × m.
- An elite kill grants `ELITE_BUFF_STACKS` × m. Proposal: raise it from 2.2 to 3.1, so that one elite kill gives about the full quoted value.
- m is the existing reward curve × catch-up.
- One camp of 3–5 mobs at feed 0 gives 3.2–5.4 stacks, which is 1.1–1.9× the quoted value.
- On-hit effects scale the per-hit amount and stop at the cap. Extra stacks reach the cap faster; they never raise it.

Each zone's mobs carry that zone's weapon (`REGION_WEAPONS`). Combat stays zone faction × `MOB_K`/`ELITE_K`, so `mobDuel` stays valid.

| Mob type | Zone / weapon | Elite | Buff (effect kind) | Value at 3 stacks | Cap | Counters |
|---|---|---|---|---|---|---|
| emberImp | Fire / axe | | damage (stat) | +5% | plateau | any |
| cinderHound | Fire / axe | | move speed while chasing your lock (while) | +5% | plateau | kiters |
| magmaBrute | Fire / axe | | max HP +3% and +10 shield (stat + flat) | as quoted | plateau | Fire, Sentenced (magic damage) |
| wyrmling | Fire / axe | yes | damage vs targets above 70% HP (vs) | +10% | plateau | high-HP openers |
| bailiff | Sentenced / sword | | mark rate (stat; Sentenced only) | +8% | plateau | (faction-locked) |
| chainWarden | Sentenced / sword | | your hits slow movement (onHit) | 5% per hit, 1 s | 25% | kiters |
| inquisitor | Sentenced / sword | | damage vs a target you have hit for 3 s or more (vs streak) | +6% | plateau | long duels |
| executioner | Sentenced / sword | yes | damage vs targets below 30% (vs) | +15% | plateau | healers |
| plagueRat | Plague / bow | | attack speed (stat) | +4% | plateau | any |
| bloatfly | Plague / bow | | buff DoT on hit (onHit) | 2 raw/s × pace, 3 s, refreshes | 1 per source | Frost (high HP) |
| rotMonk | Plague / bow | | anti-heal on hit (onHit) | 6% per hit, 3 s | 40% | Holy lifesteal |
| ratOgre | Plague / bow | yes | damage vs targets below 50% (vs) | +8% | plateau | |
| frostWisp | Frost / shield | | your hits slow attack speed (onHit) | 3% per hit, 2 s | 15% | Plague (fast attacks) |
| iceGolem | Frost / shield | | max HP (stat) | +4% | plateau | burst |
| rimeStalker | Frost / shield | | armor (flat) | +10 | plateau | Plague, Frost, Holy (physical damage) |
| glacialWarden | Frost / shield | yes | damage vs slowed or chilled targets (vs) | +10% | plateau | |
| acolyte | Holy / wand | | lifesteal, any faction (stat) | +2% | `ls_cap` | sustain |
| seraphShard | Holy / wand | | shield (flat) | +8 | plateau | magic damage |
| penitent | Holy / wand | | +1% damage per 10% missing HP (scale, stepped) | as quoted | plateau | comebacks |
| bloodSaint | Holy / wand | yes | heal 10% when you drop below 30% (trigger; once per run; ignores the lockout) | as quoted | once | burst |

Every `BuffDef` carries `worksWith` and `counters` tags. The planning screen, tooltips and the Codex show them, so a faction-locked pick such as Bailiff is a visible choice.

### 3.5 Effects and statuses (`shared/src/effects.ts`, closed, exhaustive switch; runtime in `sim/status.ts` and `sim/mods.ts`, owned by R0)

```ts
type Effect =
 | { k: "stat";    stat: "maxHp" | "attackSpeed" | "moveSpeed" | "damage" | "windup" | "lifesteal" | "markRate"
                         | "healTaken" | "damageTaken" | "cooldown"; v: number }
 | { k: "flat";    stat: "armor" | "shield"; v: number }
 | { k: "vs";      test: "hpAbove" | "hpBelow" | "slowed" | "rooted" | "streak" | "thirdParty" | "higherFeed"; arg: number; v: number }
 | { k: "scale";   src: "ownMissingHp"; per: number; step: number }
 | { k: "while";   cond: "chasingLock" | "hpBelow" | "afterCast"; arg: number; stat: StatKey; v: number; ms?: number }
 | { k: "onHit";   status: "slowMove" | "slowAttack" | "antiHeal" | "dot"; per: number; cap: number; ms: number }
 | { k: "trigger"; on: "hpBelow" | "kill" | "hitTaken"; arg: number; once?: boolean; do: Action }
 // every row may carry requires?: string[] (synergy: active only while all of these ids are owned)
type StatusKind = "slowMove" | "slowAttack" | "antiHeal" | "dot" | "chill" | "root" | "silence" | "invulnerable" | "barrier";
type Action = { do: "heal" | "barrier" | "status" | "cleanse" | "cooldown"; /* ...args */ }
```

- Buffs, passives, relics, curses and boons are all lists of `Effect`. New content is data unless it needs a new kind.
- Statuses live on players and mobs, with per-kind caps and stacking rules. Status work touches only fighters that have statuses.
- `invulnerable` reuses `immuneUntil`. `silence` blocks Q, E and D. `cleanse` is an `Action`. Forced displacement is not a status: it is an R6 action with a synced displacement counter.
- **Double buffering keeps the ledger order-free:**
  - `outMult`, the `vs` tests (slowed, rooted, streak) and the mods read a status snapshot taken at the start of the step.
  - On-hit statuses written during `applyLedger` go to the live table and count from the next tick.
  - `afterDamage` (lifesteal) runs after the pass and reads the live table, so anti-heal still cuts that tick's lifesteal.

### 3.6 Skills (`shared/src/skills.ts`)

Damage is in P units (D11). A means active (Q/E), P means passive. Rank 2 is the upgraded version. "Telegraph" effects resolve in present time so they can be dodged.

| Pool | id | Kind | Cooldown | Targeting | Rank 1 | Rank 2 |
|---|---|---|---|---|---|---|
| Fire | flameWave | A | 10 s | cone 90°, 120 u, 0.3 s windup | 120% P as burn over 3 s | 160%, 150 u |
| Fire | fireLeap | A | 12 s | point; dash up to 160 u (shared `dashEnd`) | 40% P in 48 u on landing | 200 u, 9 s cooldown |
| Fire | ignite | A | 12 s | self | next 3 weapon hits burn 30% P over 3 s | next 5 hits |
| Fire | overheat | A | 18 s | self | +40% attack speed for 4 s, then −20% for 2 s | +50%, downside 1 s |
| Fire | meteor | A | 20 s | point up to 240 u, 1.2 s telegraph | 200% P in 64 u | 250%, 80 u |
| Fire | firebrand | P | – | – | weapon hits burn 10% P over 2 s | 15% |
| Fire | searingRiposte | P | – | – | reflect 15% of each melee hit taken as burn (passive hit) | 25% |
| Fire | ashwalk | P | – | – | +5% move speed; +20% for 2 s after a cast | +8% / +30% |
| Sentenced | condemn | A | 14 s | unit up to 240 u | Sentenced: full mark at once. Others: 80% P true damage after 1 s | 10 s cooldown |
| Sentenced | chainHook | A | 12 s | line 200 u, 0.25 s windup | pulls the first enemy hit 96 u toward you, +30% P | 260 u, plus a 30% slow for 0.5 s |
| Sentenced | judgment | A | 16 s | unit up to 240 u | target takes +20% damage from you for 4 s | 6 s |
| Sentenced | gallowsDrop | A | 16 s | point up to 200 u, 0.6 s telegraph | root 0.8 s, +50% P, 48 u radius | 1.1 s root |
| Sentenced | doubleSentence | P | – | – | every 4th attack hits twice (the second at 60%) | every 3rd |
| Sentenced | witness | P | – | – | +8% damage vs a fighter whose lock or last hit is on someone else | +12% |
| Sentenced | sentenceServed | P | – | – | when an enemy you hit in the last 3 s dies: heal 8%, Q/E cooldowns −2 s | 12%, −3 s |
| Sentenced | interrogate | A | 12 s | unit up to 200 u, 0.3 s windup | 60% P and silence (no Q/E/D) for 1.5 s | 2.5 s |
| Plague | ratPack (was Swarm) | A | 12 s | moving area along a 240 u line | 40% P to each enemy it passes, plus a 2 s DoT | 60% |
| Plague | plagueCloud | A | 16 s | point up to 200 u, 64 u area for 4 s | 25% P/s | 6 s |
| Plague | biteTwice | P | – | – | every 3rd weapon hit bites again at 55% | every 2nd |
| Plague | contagion | A | 14 s | unit up to 200 u | copies your DoTs on the target to enemies within 120 u | 160 u, and refreshes them |
| Plague | scurry | A | 10 s | self | +40% move speed for 2 s; ends slows on you | 3 s |
| Plague | pestilence | P | – | – | Plague: execute band starts at 60% (from 50%). Others: +8% damage vs targets below 60% | 70% / +12% |
| Plague | ratTide | A | 22 s | wide moving area 300×96 u, 0.5 s telegraph | 90% P and a 30% slow for 1.5 s | 130% |
| Plague | infest | A | 14 s | unit up to 220 u | host for 5 s; bursts 60% P in 80 u on death or expiry | 90% |
| Frost | iceWall | A | 18 s | point up to 200 u; 3 tiles for 3 s | dynamic blocker (late; see risks) | 5 tiles, 4 s |
| Frost | frostNova | A | 14 s | self, 96 u, 0.2 s windup | 40% P and a 40% move slow for 2 s | 60% P, 2.5 s |
| Frost | glacialShell | A | 20 s | self | barrier of 20% max HP for 4 s | 28% |
| Frost | avalanche | A | 18 s | line 280 u, 0.8 s telegraph | 120% P and a 25% attack slow for 2 s | 160% |
| Frost | coldSnap | A | 12 s | unit up to 220 u | freeze (root) 0.6 s; 1.0 s if the target is chilled | 0.9 / 1.4 s |
| Frost | shatter | P | – | – | +15% damage vs rooted or frozen targets | +25% |
| Frost | frozenPath | P | – | – | every second of walking leaves a 2 s ice patch that slows enemies 20% | 30% |
| Frost | hoarfrostArmor | P | – | – | +12 armor; melee attackers get −10% attack speed for 1 s | +18 armor, 15% |
| Holy | smite | A | 10 s | unit up to 240 u, 0.3 s windup | 100% P magic | 140% |
| Holy | consecrate | A | 16 s | point up to 200 u, 72 u area for 4 s | 20% P/s to enemies; heals you 2%/s while you stand in it | 6 s |
| Holy | bloodPact | A | 16 s | self | spend 15% of current HP (a named ledger entry): +25% damage for 5 s | +35% |
| Holy | hallowedGround (was Sanctuary) | A | 24 s | self | invulnerable 2 s, but rooted and unable to attack | 18 s cooldown |
| Holy | purify | A | 14 s | self | cleanses slows, anti-heal and DoTs; status immunity 1 s | 2 s |
| Holy | haloBurst | A | 12 s | self, 112 u | 60% P and a 30% slow for 1 s | 90% |
| Holy | radiance | P | – | – | overheal becomes a barrier, up to 15% max HP (decays over 5 s) | 25% |
| Holy | lastRites | P | – | – | +25% attack speed below 30% HP | below 40% |
| Neutral | whetstone | P | – | – | +6% damage | +10% |
| Neutral | swiftBoots | P | – | – | +6% move speed | +10% |
| Neutral | quickdraw | P | – | – | −8% windup | −12% |
| Neutral | thickHide | P | – | – | +6% max HP, +5 armor, +5 shield | +10%, +8, +8 |
| Neutral | bountyHunter | P | – | – | +10% damage vs players with a higher feed | +15% |
| Neutral | quartermaster | P | – | – | Q/E cooldowns −12% | −18% |
| Neutral | scout | P | – | – | reveals every "?" camp's reward to you (private message) | also enemies within 480 u on your minimap |
| Neutral | secondWind | P | – | – | once per run, below 25% HP: heal 20% over 2 s (ignores the lockout) | 30%, once per teleport |

**When each passive becomes available.** Many passives need machinery that does not exist before R6, so the R5 set is small.

| When | Passives |
|---|---|
| R5 (11 rows) | whetstone, swiftBoots, quickdraw, thickHide, bountyHunter; secondWind (trigger and `heal({ignoreLockout})` arrive in R4a for Blood Saint); witness (vs thirdParty); pestilence (vs hpBelow, plus a small Plague execute-band hook); lastRites (while hpBelow); after R4b, firebrand (dot) and hoarfrostArmor (flat, plus a hitTaken trigger applying slowAttack) |
| R6 | doubleSentence and biteTwice (extra hits); frozenPath (areas); ashwalk, sentenceServed and quartermaster (Q/E); shatter (roots); radiance (a barrier runtime split off from the combos) |
| R7 | searingRiposte (the reflect damage source, shared with haloOfThorns); scout (private reveal, with "?" camps) |

### 3.7 Relics, curses and boons

| Relic | Effect | Downside | Synergy (`requires`) |
|---|---|---|---|
| glassFang | +20% damage dealt | +15% damage taken | bloodPact costs 10% HP |
| leadenBoots | immune to move slows, roots and pulls | −10% move speed | – |
| hourglass | Q/E cooldowns −25% | −8% attack speed | overheat loses its downside |
| vampireFang | +6% lifesteal (any faction, under `ls_cap`) | −25% healing from other sources | acolyte stacks count double |
| bloodlust | each kill: +8% attack speed for 8 s (stacks to 3) | −1% max HP/s out of combat (floor 30%) | lastRites threshold 40% |
| dragonHeart | +15% max HP; burn aura of 8% P/s within 64 u | +10% magic damage taken | Fire buffs +25% |
| ironWrit | your on-hit statuses last 50% longer, with caps +50% | weapon hits −10% raw | chainWarden, frostWisp |
| ratCrown | mob kills give +50% buff stacks | −10% max HP | plagueRat |
| frozenHeart | enemies within 160 u get −10% attack speed | −10% move speed | glacialWarden treats them as slowed |
| haloOfThorns | reflect 20% of melee damage taken as true damage (passive hit) | −20% healing received | searingRiposte stacks with it |
| gamblersCoin | each chest pick: 50% chance it is one rank higher | the other 50%: a random curse | – |
| huntersMark | your lock target takes +12% damage from you and shows through walls on your minimap | the target sees you while you hold the lock | inquisitor streak starts at 1.5 s |

| Curse | Effect |
|---|---|
| haunted | every 20 s without dealing damage: 4% max HP true damage (a named ledger entry, cannot kill below 1 HP) |
| brittleBones | +15% physical damage taken |
| slowFuse | +15% windup on weapons and skills |
| greed | your bounty pays double to your killer; your chest skips give nothing |

| Boon (pick 1 of 2) | Effect |
|---|---|
| headStart | +2 stacks of one normal buff from your spawn zone |
| hardy | +8% max HP |
| trinket | a random neutral passive at rank 1 |
| sprint | +20% move speed for the first 45 s |
| insight | reveals the "?" rewards of two random zones to you during planning |
| purse | your first chest skip heals 30% (same lockout rule as D12) |

### 3.8 Player build state (PlayerState)

- Removed: `stacksHp`, `stacksAs`, `stacksMs`.
- Added:
  - `buffs: t.map("float32")`, a generic buff-stack collection keyed by BuffId;
  - `build: t.map("uint8")`, holding passive, relic, curse and boon ids with their rank;
  - `slotQ`, `slotE` (skill ids) and their ranks. Cooldown fields come from the Wishes framework.
  - `displaceSeq: uint8` (R6), so the victim's prediction rebases after a forced move.
- Stat mirrors `asMult`, `windupMult`, `speedMult`, `armorBonus`, `shieldBonus`:
  - `recomputeMods` writes them quantized to 0.001 steps and patches one only when its quantized value changes.
  - The sim itself uses the quantized values, so the prediction and `FighterArt` match the server exactly.
  - Continuous effects step-quantize (Penitent per 10% step; Cinder Hound on or off), so they do not patch every tick.
- Persistence: none of this is banked. `RunResult.build` and `route` are display-only, with no ProfileStore file version bump. Any cosmetic stat or achievement for camps, chests or relics would need a v3 ProfileStore migration (owner question).

---

## 4. Phases

| Phase | Name | Depends on | Runs in parallel with | Size (engineer-days) | Milestone |
|---|---|---|---|---|---|
| R0 | Contracts, mods and status runtime, wedge adapter | – | R1 | 5 | |
| R1 | Generator design spike (Opus, time-boxed) | – | R0, R3, R4a | 5 (hard time-box) | go/no-go |
| R2 | Generator implementation and map pool (swap-in) | R1 go (or Plan B), R0 | R3–R7 | 15–19 (Plan B: about 8) | M2: zone maps |
| R3 | Planning phase and screen (wedge maps) | R0; camp markers read R4a's rosters | R4a, R1/R2 | 10 | |
| R4a | Buff swap: data, stats, HUD, rosters | R0 | R3 | 7 | |
| R4b | Buff swap: on-hit statuses | R4a, R0 status runtime | R3, R5 | 4 | |
| R5 | Camp runtime and contested chests (passives) | R3, R4a (R4b for two passives) | R2, Wishes | 9 | **M1: core loop on wedge maps** |
| R6 | Active skills on Q/E (Wishes framework) | Wishes merged, R5 | R7 (relics only), R2 | 22–30 | M3 |
| R7 | Relics, curses, boons, "?" and cursed camps | R5 (R6 for skill synergies) | R6 | 8 | |
| R7b | Matchup readability: inspect, death recap, Codex | R4a (Codex), R5, R7 (full recap) | R6 | 5 | M4 (with R7) |
| R8 | Balance tooling and tuning | R4a (buffs, campDuel), R6 (skills) | R6, R7 | 6, plus owner time | |
| R9 | Hardening and verification | all | – | 3 | M5: release |

The total is about 99–111 engineer-days, with R1+R2 at 20–24. Three lanes can run at once:
- map: R1 → R2;
- sim and rewards: R0 → R4a → R4b → R5 → R6/R7;
- client: R3 client → R5 client → R6 UI.

M1 does not wait for the generator: R2 swaps in behind the R0 contract whenever it is ready.

### R0: Contracts, mods and status runtime
- **Goal:** fix the contracts every other phase depends on, move stats behind a seam, and land the status runtime that Wishes builds on. No behaviour change.
- **Scope and files:**
  - shared:
    - `effects.ts`: the `Effect` union, `StatusKind`, `Action`;
    - `map.ts`: `CampDef` and the new `GameMap` fields, filled by the wedge adapter (3.2);
    - `mobs.ts`: the `MOB_TYPES` table (data only).
  - schema: the quantized stat mirrors.
  - server:
    - `sim/status.ts` (new): timed statuses on players and mobs, caps, the tick-start snapshot, `invulnerable` on `immuneUntil`;
    - `sim/mods.ts` (new leaf module): `recomputeMods` as a `systems` entry that folds today's 3 stats;
    - the sim reads the quantized mirrors: `sim/combatant.ts`, `sim/buffs.ts`, the moveModifier in `step.ts`;
    - a `hitLanded` hook stub in `ledger.ts`;
    - `world.rewardRandom`: a private stream derived from a server-private salt, never from the seed, so it does not shift the loot rolls.
  - client: `net/localPrediction.ts` and `render/FighterArt.ts` read the mirrors.
- **The Wishes session gets the R0 contract now, plus this checklist.** Its framework must provide:
  - an `AbilityDef` with targeting self, dir, point or unit, shape, telegraph, ranks and `Effect` lists;
  - a `cast {slot, x, y, id?, t?}` input that addresses Q, E and D;
  - per-slot `readyAt`;
  - a pending cast kept outside the weapon `PendingAction` union: it roots the caster, a stagger cancels it, a teleport or death clears it, and the target lock survives it;
  - statuses only through R0's `sim/status.ts`, on players and mobs, including silence (Interrogate blocks Q/E/D), invulnerability on `immuneUntil`, cleanse (Purify), and forced displacement with a synced counter;
  - areas in state;
  - damage through `recordHit` with an appended skill or sig code;
  - a `noteCast` prediction hook;
  - a reusable cooldown widget;
  - an `ai` tag for bots.
- **Opus:** the Effect and status contract; the snapshot and double-buffer rules; the mods leaf-module boundary (no import cycle with weapons or arena); mirror quantization. **Sonnet:** the adapter, the prediction switch, tests.
- **Gates:**
  - every existing test passes unchanged;
  - the hash of the 200 generated maps is unchanged;
  - the adapter covers every wedge camp; each chest tile is in the clearing and not a spot;
  - status runtime unit tests, plus the ledger order-free property with statuses written mid-pass;
  - bandwidth within ±0.3 KB/s on bench and test; stepBench unchanged;
  - prediction tests pass when reading the mirrors.
- **Docs:** CLAUDE.md rules for mods, statuses and the private stream.

### R1: Generator design spike (Opus, start now, time-boxed to 5 engineer-days)
- **Record:** the spike's verdict and measurements are in [R1_GENERATOR_NOTE.md](R1_GENERATOR_NOTE.md). Its prototype code (`gen/`) is not in this repository; R2's production generator is on the `claude/r2-zones` branch.
- **Goal:** a paint-bucket generator that meets these hard targets on 200 seeds, confirmed on a 1000-seed sweep:
  - mean ≤ 40 ms and p99 ≤ 120 ms per certified map in Node, for a raw seed through every attempt until certified, with lane tables warm;
  - fewer than 5% of seeds need a fallback, meaning they fail certification within the attempt budget and the pool discards them;
  - no guarantee is ever relaxed: connectivity with gates open and closed, gates, the 480 u sight cap at 32 u strips, spawn screening both ways, determinism. There is no relaxed attempt anywhere.
  - Client budgets, first picks:
    - single published attempt in Chrome, cold: mean ≤ 60 ms, p99 ≤ 150 ms;
    - lane-table build in the worker at boot: ≤ 200 ms;
    - at 4× CPU throttle: p99 ≤ 500 ms.
- **Experiments, in order:**
  1. Place protected features first (coliseum, camp halos, camp chest tiles, spawns). Run a cheap check of the longest straight run of protected tiles along the 48 lattice directions, so an over-long lane costs a 3–6 ms local retry instead of a cover pass.
  2. Put each camp site at the best open cell near the territory pole: integer chamfer distance transform, halo clearance, global spacing ≥ 9 tiles across zones. This targets the 1969 "no site at the pole" failures.
  3. Grow zones on a coarse 2×2 grid, then refine boundaries per tile:
     - best-of-d frontier sampling instead of roulette;
     - a maintained boundary list;
     - integer noise;
     - seeds placed by farthest-point sampling inside an annulus of 0.55–0.9 × R0;
     - ring-road contact certified per zone (≥ F tiles).
  4. A retry budget per stage (zones ≤ 8, camps ≤ 4, spawns ≤ 4) before a full attempt, and at most 16 full attempts.
  5. Measure the Web Worker path in Chrome, cold and at 4× throttle, not only in Node.
  6. Last resort only, because it rewrites the most fragile code (`placeCover`): incremental lane certification, which updates only the lattice lines through a new rock and stops at the first cut.
- **Deliverables:**
  - a design note: algorithm, parameters (k, tolerance, F, sliver bound S, annulus), the measured table (mean, p50, p90, p99, max, attempts histogram, failure reasons, discard rate), and a recommendation on k = 3 or 4;
  - the map-pool design: pool size, refill, behaviour when the pool is empty;
  - 12 ASCII or PNG renders of zone shapes for the owner;
  - a go/no-go.
  - Prototype code (`pb1.ts`, `mapgenPB.ts`, `proto4.ts`) stays scratch.
- **Plan B (pre-agreed):** if the time-box ends without every hard target met, R2 ships "warped wedges": noise-displaced sector boundaries on today's certified pipeline, with the same camp, territory and spawn-pool contract. That is about 8 engineer-days.
- **Gate to R2:**
  - every hard target is met (or Plan B is chosen);
  - the owner has approved the renders;
  - the spawn walking ratio to the centre is measured and reported against the owner's target.

### R2: Generator implementation and map pool (swap-in, milestone M2)
- **Goal:** ship the R1 design (or Plan B) behind the R0 contract, with the 200-seed certification and the server map pool.
- **Scope, in commit order:**
  1. Split `mapgen.ts` into `zones.ts`, `cover.ts` and `mapgen.ts`, byte-identical (the hash test passes).
  2. Add `generateMap(seed, attempt)`. `RaidState.attempt` and `mapHash` are published.
  3. Zones replace the wedges, ridges and passes; everything else is unchanged; the suite goes green.
  4. Camps first:
     - territories, poles and global spacing;
     - optional ruins;
     - a territory repair pass;
     - a territory guard in the cover pass's `levelOf`;
     - the 3-camp (or 4-camp) rosters from D5.
  5. Spawn pool on the iso-walk contour, with a rejection check after the cover pass.
  6. `camp.chest`, `spawnPool`, and a territory and zone view in `scripts/printMap.ts`. `extracts` and the legacy extract code are deleted.
  7. Map pool, `server/src/mapPool.ts`, process infrastructure outside `sim/`:
     - one background `worker_thread` per process fills a queue of certified (seed, attempt) pairs;
     - `buildWorld` takes one synchronously and passes it through `createGameWorld({ map })`, so `onAuth`/`onJoin` stay synchronous;
     - training rooms use the pool too;
     - an empty pool falls back to one synchronous in-process certification;
     - lane tables are warmed at boot.
  8. Client:
     - lane tables are built in a Web Worker at app boot in the hub;
     - the map is generated in that worker as soon as (seed, attempt) arrives;
     - `mapHash` is checked. On a mismatch the client shows a friendly error ("This raid's map did not match your client. Please reload.") and leaves the room with a consented leave, so the profile is released.
  9. Consumers:
     - `mobLife.ts` and `sim/camps.ts` read `map.camps`;
     - `mobAI.ts` leash = territory and the cap, keeping the radius fallback;
     - the loot spot lists;
     - the planning deal reads `spawnPool`;
     - bench fixtures (`mobDuel`, `bandwidth`, `stepBench`);
     - `MapView` and `mapPainter` zone edges.
  10. Docs: `GAME_DESIGN` sections 5 and 11. In CLAUDE.md, the map rule becomes "only `seed` + `attempt` are in state", plus the pool and the worker.
- **Opus:** reviews determinism (no `Math.pow`, `exp`, `log`, `atan2`; total comparators; integer noise and distance transforms), the cover-guard changes and the pool. **Sonnet:** implementation, the test rewrite, the consumers. Tests keep in-process generation.
- **Gates, all on 200 seeds unless noted:**
  - Determinism:
    - 50 seeds byte-identical across fresh loads;
    - the Math spy extended to `pow`, `exp`, `log`, `atan2`, `hypot` and `random`;
    - worker output equals in-process output;
    - the pool only ever serves a certified (seed, attempt), and the code has no relaxed path.
  - Equal area: painted tiles per zone within ±8 tiles; floor share max/min ≤ 1.15.
  - Shape: each zone 4-connected on 100% of maps; ring contact ≥ F tiles; sliver tiles ≤ S.
  - Territories partition every eligible tile. Each territory's floor is 4-connected and contains its clearing, spots and chest tile.
  - Connectivity with gates open and closed; gates; coliseum interior and pillar lanes.
  - Cover:
    - lattice lane ≤ 14.98 tiles (479.4 u) at 32 u strips, open and sealed;
    - exact off-lattice strips (40 seeds) and 16 u discs (20 seeds) as today.
  - Spawns: sight screening both ways for every pool pair within 480 u; separation ≥ 5 tiles; ≥ 5 tiles from camp centres.
  - Camps: global spacing ≥ 9 tiles with no relaxed fallback; exactly one elite camp per zone; at least 3 camps per zone.
  - Perf:
    - the R1 targets (Node, cold Chrome, 4× throttle);
    - the perf test gates on median batches ≤ 45 ms;
    - the 200-seed suite runs in ≤ 15 s;
    - discard rate < 5%.
  - The `mapHash` mismatch path is tested.
  - Tests that pin seeds are rerun: pathfind, geometry, arena, loot, lifecycle, mobLife, mobAI, e2e (full loop through chests), bandwidth, perf.

### R3: Planning phase and screen (wedge maps)
- **Goal:** a read-only lobby preview, then load-in planning with the spawn deal and pick, route drawing and visible camps, on today's maps.
- **Server:**
  - `sim/planning.ts` (new) and `step.ts`: a `planning` phase between lobby and active. When the 8th joiner hits `MAX_PLAYERS`, planning starts on the next tick.
  - The deal at planning start:
    - two spawn-pool indexes from the same walking-distance tier (±8% of a shared contour value from `findPath` to the coliseum) and in different zones;
    - overlap between players allowed when 2 × players exceeds the pool;
    - boons hidden until R7.
  - `plan` input:
    - only indexes into the dealt options are accepted;
    - the first pick wins and resends the private `plan` with `taken` flags to every affected player;
    - within one tick, `actionOrder` decides;
    - a ready latch.
  - `messages.ts`: `RaidPhase` "planning", the `plan` input, the private `plan` message.
  - `inputs.ts`: `parsePlan`, the exhaustive tables, `BotClient.sent`.
  - `RaidRoom.ts`:
    - `lock()` at planning start;
    - `sendTo` for the plan;
    - **`onDrop` holds the seat during planning with `allowReconnection`**, like the run, not the lobby: the room is locked, so a 1 s blip would otherwise eject the player for the whole run. At timeout the defaults are picked.
    - `sendInFlight` is extended to resend the plan (and, from R7, the reveals).
  - `config.ts`:
    - `PLAN_SECONDS`; `SimConfig.planSeconds` defaults to 0;
    - `SimConfig.firstPatienceSeconds` (decision 10), armed when planning ends.
  - Training forces `planSeconds` 0.
- **Client:**
  - `main.ts` `enterRoom` registers the `plan` and `reveal` handlers in the inbox pattern (like fxs, toast and result) before awaiting the first state, so a deal that beats `RaidScene.create` is not lost.
  - `ui/planning.ts` and `planning.css` (new). The overlay lives in `uiRoot()` with CSS layout, so it survives resize and fullscreen. It is not an Esc panel.
  - `ui/mapPainter.ts`, extracted from `Minimap.setMap` and shared with the minimap.
  - The lobby shows the same map read-only.
  - The planning screen shows:
    - zone tints and territory outlines (from R2);
    - camp markers (type glyph, buff, elite crown, reward kind once R5/R7 set it);
    - weapon crates;
    - the two spawn markers, with "taken" live;
    - a Ready button;
    - the factions of the other players present;
    - each camp's matchup against your faction, from shared `duel` (`matchupShare` moves from `server/src/bots/mobHunt.ts` to shared);
    - the buffs that counter the factions present (from `counters` tags, once R4a lands).
  - A route drawn with shared `findPath`, with an ETA from `PLAYER_SPEED`, kept in `sessionStorage` by room id.
  - `RaidScene.ts`: phase overlay, route state, hold Tab for the full map (`preventDefault`; panel focus navigation still works).
  - `minimap.ts`: camp markers, the faint route and the next waypoint.
  - The `hud.ts` status line; a settings toggle for "Show route"; a text-scale setting.
- **Bots:** auto-plan. They score the two spawns with shared `matchupShare` against the nearest camps and send ready.
- **Opus:** phase flow, secrecy (deals only in private messages, picks as indexes only), the taken flow, reconnect. **Sonnet:** the UI, painter extraction, bots, tests.
- **Gates:**
  - Flow:
    - lobby → planning → active, and `planSeconds` 0 keeps today's flow;
    - early start when everyone is ready; timeout falls back to the defaults.
  - Inputs:
    - only indexes into the dealt options are accepted;
    - the ready latch holds;
    - inputs in the wrong phase are dropped;
    - dealt options never appear in state.
  - Spawn deal:
    - both options are in one tier and in different zones;
    - "taken" is live and the same-tick rule is deterministic;
    - options overlap only when 2 × players exceeds the pool.
  - Joining and reconnecting:
    - the 8th joiner gets its deal;
    - a drop during planning keeps the seat, and a reconnect gets the plan again;
    - the route survives a reload.
  - `firstPatienceSeconds` arms at planning end; unset keeps today's behaviour.
  - Accessibility:
    - a keyboard-only path (cycle spawns, camps and boons; Enter for Ready);
    - zone and buff identity by glyph or pattern, not hue alone, on the planning map, the minimap and MapView edges;
    - text scale; reduced motion respected.
  - e2e with bots that send ready.
- **Docs:** CLAUDE.md rules (planning phase; plan deals are private messages); `GAME_DESIGN` flow section.

### R4a: Buff swap, data, stats and HUD
- **Goal:** replace `stacksHp/As/Ms` and the combos with the 20 per-type buffs (stat, flat, vs, scale, while and trigger kinds), with typed mono-type camps. This is the owner's buff-swap phase, split into R4a and R4b.
- **Scope and files:**
  - shared:
    - `buffs.ts` rewritten (`BuffDef` rows on `MOB_TYPES`, `buffScale`; `rewardCurve`, `catchUp` and `bountyStacks` kept);
    - `buffView.ts`;
    - `fxCodec.ts`: a BUFF table of 20 ids replaces STAT; the COMBO code is retired, never reused.
  - schema: the `buffs` map; `CampState { type, alive }`; `MobState.type` and `camp`.
  - server:
    - `sim/camps.ts` (new): rosters rolled at world build from `rewardRandom` per D5. Mobs still spawn at `raidStarted`.
    - `sim/buffs.ts`: `grantBuff`; `transferBuffs` moves half of every owned id on a bounty kill.
    - `sim/mods.ts`: folds the effects.
    - `sim/ledger.ts`: an outgoing multiplier applied before `mitigateShares`, to hits and signature DoTs alike, so Sentenced benefits. It reads the tick-start snapshot, so the ledger stays order-free.
    - `sim/factions.ts`: `markRate`; lifesteal for any faction, capped at `ls_cap`; `heal({ignoreLockout})`; trigger actions.
    - `mobLife.ts` `payMobKill`; `arena.ts` bounty.
  - client:
    - `ui/buffsHud.ts` becomes a build strip (zone colour, stacks, value, gain from the next kill);
    - `buffTheme.ts`;
    - an `FxView` toast in the form "Ember Imp +1.1 (3.2): +5% damage";
    - `PlayerView` barrier no longer reads COMBOS.
  - `BotClient` and `mobHunt` sum buff power. The training build console can grant buffs.
  - `bench/campDuel.ts` (new, built here): `mobDuel` per mono-type camp, pulled singly or as a group, for each starter faction and weapon, normal and elite. It reports time to clear and HP left.
- **Report gate before merge (owner reads; not pass/fail):**
  - the campDuel table;
  - a "power at minute N, old vs new" comparison. Today's plateaus are +66.7% HP, +47.6% attack speed and +28.6% move speed; the new buffs are about 5–10% at the quoted value and about 2.1× that at the plateau. `ELITE_K`, the feed curve, catch-up and bounty transfer were tuned to the old magnitudes.
- **Opus:** the ledger hook and the trigger timing (mods run one tick late by design), roster secrecy and stream isolation. **Sonnet:** catalogs, HUD, campDuel, migration of the ~17 test files.
- **Gates:**
  - a table-driven test with one rig per `BuffDef` row;
  - S-curve values; the ledger order-free property;
  - a Sentenced damage buff reaches its mark damage;
  - bounty transfer per buff id; fx round trips; the `sync.test` field list;
  - rosters follow D5 on wedge maps and do not shift loot rolls;
  - heavy-case bandwidth ≤ 16.5 KB/s, with mirrors patched only when their quantized value changes;
  - stepBench avg < 5 ms and p99 < 15 ms with all buffs on 8 players;
  - the faction oracle and harnesses unchanged (empty builds).
- **Docs:** `GAME_DESIGN` buffs section; CLAUDE.md buff and roster rules.

### R4b: Buff swap, on-hit statuses
- **Goal:** Chain Warden, Bloatfly, Rot Monk and Frost Wisp, plus the vs-slowed and streak tests.
- **Scope:**
  - statuses on R0's runtime: `slowMove`, `slowAttack`, `antiHeal`, and the buff DoT with its own appended sig code, so e2e's "a sig hit comes from its own faction" check still holds;
  - `MIN_MOVE_MULT` 0.35 (chill × slows);
  - `heal()` × (1 − anti-heal);
  - `SIG_SLOWED` and `SIG_ANTIHEAL` visuals.
- **Gates:**
  - caps hold;
  - anti-heal reduces lifesteal in the same tick;
  - on-hit statuses count from the next tick for `outMult` and `vs`;
  - the slow-lock floor holds;
  - status work touches only fighters that have statuses (stepBench).
- **Depends on:** R4a and R0's status runtime. It no longer waits for Wishes.

### R5: Camp runtime and contested shared chests (milestone M1: the core loop on wedge maps)
- **Goal:** clear a camp, a shared chest drops, everyone nearby picks once, and it is gone in 15 s. Rewards are passives until R6. This is the owner's first route-regret playtest.
- **Scope and files:**
  - `sim/camps.ts`:
    - members and alive count;
    - clear detection inside `killMob`, with the chest queued through `payLater`;
    - the one-time rule (no respawn; the clear survives the teleport);
    - `CampState.state`;
    - camp-wide aggro per D24, as an `aggro` fan-out in `mobAI.ts`.
  - `sim/chests.ts` (new):
    - `rollChest` from `rewardRandom` and the reward container;
    - **interim rule until R6:** 3 options = at most one zone passive from the R5-ready set (3.6) + neutrals from that set, no duplicates;
    - a `choose` action with these checks: active phase, standing, within `CHEST_RANGE` with line of sight from the server position, chest live, picker not yet in `pickers`, option free, rank 2 not already owned;
    - an expiry system; the skip reward (D12); chests removed at teleport.
  - `messages.ts` / `inputs.ts`: `choose`. `loot.ts` keeps weapon pickup separate.
  - fx (appended): `campCleared`, `chestTaken`.
  - shared: `skills.ts` (R5-ready passives live), `rewards.ts`.
  - client:
    - `ui/chestPanel.ts` and css, a Chrome panel:
      - non-modal, docked off the fight centre;
      - never swallows canvas left-clicks, which lock targets;
      - opens on its own when the latest server position is within `CHEST_RANGE − 8 u`;
      - shows contents only in range;
      - shows a countdown;
      - greys taken options from state, and greys every option at `expiresAt − (RTT/2 + 50 ms)`;
      - picks by mouse, or by keyboard: C focuses the panel, 1/2/3 pick, 0 skips, C or Esc returns focus to the game.
    - a minimap blip with a countdown while the chest is up;
    - a ring and timer on the chest in `ContainerView`;
    - the cleared state on the minimap and planning painter.
  - training console: spawn a camp; drop a chest with chosen options.
  - bots walk to chests and take the first free option.
- **Opus:** concurrency and validation rules, RNG stream isolation, the aggro decision. **Sonnet:** UI, bots, tests.
- **Gates:**
  - Picking:
    - the same-tick race: the `actionOrder` winner gets the option; the loser gets a toast and may pick again;
    - one pick per player, and a skip counts as the pick;
    - range and line of sight from the server position;
    - expiry at exactly 15 s (a `choose` after it is refused);
    - dead or MIA players cannot pick; the `bornAt` guard holds;
    - the skip heal respects the lockout (or the owner's choice).
  - Camps:
    - a clear survives rests and evades; kill credit is unchanged;
    - camp-wide aggro.
  - Panel:
    - it never captures a canvas click;
    - keyboard path; reduced motion; the countdown is readable at every text scale.
  - Load: bandwidth with 5 chests up; e2e bots open chests.
- **Docs:** `GAME_DESIGN` section 12. CLAUDE.md:
  - rules for chests and camps;
  - Known TODO: chest options are in public state; interest management would also cover them.

### R6: Active skills on Q/E (milestone M3)
- **Goal:** about 25 actives on the Wishes framework, with explicit netcode.
- **Scope:**
  - **R6.0, first:** fix the lag-compensation `t` trust TODO before any instant skill rewinds.
    - Bound `t` per client by measured RTT: `t ≥ now − (RTT/2 + INTERP_DELAY_MS + one tick + margin)`, within `MAX_REWIND_MS`.
    - Require `t` to be monotonic per client.
    - Update Known TODOs.
  - First 4 reference skills, one per targeting kind: overheat (self), flameWave (dir), fireLeap (dash), meteor (telegraph). Then the zone pools and the R6 passives from 3.6.
  - Netcode rules:
    - instant hits rewind with the cast's own bounded `t`;
    - telegraphs resolve in present time, and their fx carry the absolute server `landsAt`, which the client fills against `serverNow` (not render time), so the predicted local player dodges on the true clock;
    - unit-target checks happen at landing, with range slack = target speed × (`INTERP_DELAY_MS` + RTT/2 + one tick);
    - forced movement (Chain Hook's 96 u pull equals `SNAP_DISTANCE`) bumps `displaceSeq`, so the victim's prediction rebases instead of snapping and dropping its walk;
    - self-costs (Blood Pact), Haunted, auras and reflects are named `recordHit` entries;
    - `sendInFlight` resends live telegraphs and areas on reconnect.
  - `slotQ`/`slotE` and `choose.replace`; chests switch from the interim rule to D6.
  - `ui/skillBar.ts` stacked above the weapon bar, so `BAR_CLEARANCE` stays valid.
  - Keys:
    - Q and E cast; swap moves to X (`weaponBar` keycap, `HELP_SECTIONS`, `trainingBar` tips, `weaponBarKeys.test`);
    - remappable bindings in settings on physical `e.code`, read by the help overlay and keycaps.
  - SkillArt telegraphs; skill scenarios in the bandwidth bench; bots cast by `ai` tag; training console grants skills.
- **Opus:** R6.0, the lag-compensation policy, the shared `dashEnd`, the displacement counter, the prediction's `noteCast`. **Sonnet:** the content, UI, bots.
- **Gates:**
  - Casting:
    - cooldown and buffer; the windup roots; a stagger cancels; the lock survives a cast;
    - silence blocks Q/E/D.
  - Netcode:
    - the bounded, monotonic `t`; the rewind clamp;
    - ledger entries carry the skill code;
    - the prediction expires an unconfirmed cast;
    - telegraph timing against `serverNow`;
    - a pulled victim's prediction rebases without a snap;
    - a reconnect sees live telegraphs.
  - Load: heavy-case bandwidth with skills ≤ 20 KB/s; stepBench with casts.
  - Accessibility: remap, keyboard-only casting, telegraphs readable without colour.
- **Depends on:** the Wishes merge (hard dependency).
- **Docs:** CLAUDE.md skills rule and the updated lag-compensation TODO; README controls.

### R7: Relics, curses, boons, "?" and cursed camps
- **Scope:**
  - `relics.ts`, `curses.ts`, `boons.ts` as `Effect` rows, plus special hooks:
    - the thorns and riposte reflect as a passive `recordHit`;
    - auras;
    - Gambler's Coin on `rewardRandom`;
    - Hunter's Mark.
  - Elite relic caches and cursed camp chests on the R5 mechanism.
  - "?" camps (3 per map, never elite):
    - `CampState.reward` is "?" until the camp's first damage, then everyone sees the reward;
    - Scout and Insight send private `reveal` messages, resent on reconnect.
  - The boon deal and pick on the planning screen, applied at start.
  - Synergy `requires` rows lit in the build strip.
  - `RunResult.build` and the route (display-only), so the results screen shows the planned and actual route.
  - Training console: grant a relic, curse or boon.
- **Gates:**
  - table-driven effect tests; downsides apply;
  - curses go through the ledger;
  - boons and reveals stay private;
  - a "?" reward is not in state before reveal;
  - the chest rules are identical to R5.
- **Docs:** `GAME_DESIGN` relics and curses; CLAUDE.md private-message list.

### R7b: Matchup readability
- **Goal:** put the owner's core skill, learning matchups, on screen.
- **Scope:**
  - a hover or lock inspect tooltip showing an enemy's public build (buffs, passives, relics, slots);
  - a death recap showing the killer's build and which counters applied, from ledger entry codes sent with the result;
  - a hub Codex of zones, mobs, buffs, skills, relics and counters, all from the shared catalogs;
  - the counter wheel (`shared/wheel.ts`) extended with zone buffs.
- **Gates:**
  - the Codex text is generated from the catalogs (no copies);
  - the recap matches the ledger in an e2e death;
  - keyboard and glyph accessibility.

### R8: Balance tooling and tuning
See section 6. Buff tooling (campDuel) lands in R4a, skill tooling after R6. All output is report-only.

### R9: Hardening and verification (milestone M5: release)
- Full recertification:
  - stepBench and bandwidth with everything on;
  - e2e with four bots through the whole loop (lobby preview → plan → camps → chests → skills → relics → coliseum) on zone maps.
- Checks that each phase's docs landed:
  - CLAUDE.md rules for the planning phase, chests, skills, mods and statuses, the private messages, and "seed + attempt";
  - Known TODOs, including interest management, which now also covers chest contents.
- `GAME_DESIGN` sections 3, 6, 9, 11, 12 and 14; README controls.

---

## 5. Sequencing against in-flight branches

| Branch | State | What it means here | Rule |
|---|---|---|---|
| controls-feel | Merged (f2aa8fc) | The prediction copies the server's speed maths from the stacks | R0 moves the prediction to the quantized mirrors before any buff changes. Dashes start in follow mode |
| web-ui-polish | Merged (9aae4ce) | It owns `minimap.ts`, `minimapMath.ts` (`BAR_CLEARANCE`), `weaponBar.ts` (Q keycap), `helpOverlay.ts` (`HELP_SECTIONS`), settings, `chrome.ts` (H, Esc, Alt+Enter), `style.css`, `toast.ts` and the viewport | It blocks nothing now: R3 client work and the `mapPainter` extraction start immediately. New UI goes in new CSS files. The planning overlay lives in `uiRoot()` and is not an Esc panel. The chest panel is a Chrome panel |
| wishes | No commits | Q/E must reuse its ability framework; D casts the Wish | It builds on R0's status and mods runtime: send the contract and checklist now. R6 waits for its merge. "Swarm" is the Plague Wish, so the chest skill is "Rat Pack" |
| roguelike-zones | No commits, behind main | Home for R1 and R2 | Bring it to 9aae4ce first. R2 swaps in behind the R0 contract at any point after M1 work begins |

Files that several phases touch, in merge order:
- `mobLife.ts`: R4a, R5, R2, R7.
- `schema.ts` and `messages.ts`: R0, R3, R4a, R5, Wishes, R6, R7, R2 (`attempt`, `mapHash`).
- `mobAI.ts`: R5 (camp aggro), R2 (leash).
- `main.ts`: R3 (inbox handlers), R2 (map worker).
- `RaidScene.ts`: R3, R5, Wishes, R6.
- fx KIND / SIG tables: append-only, with codes assigned in merge order.

Only one in-flight phase per file at a time.

Keys:

| Key | Today | After |
|---|---|---|
| Right-click, Left-click, S, 1, 2 | Unchanged | Unchanged (left-click on the panel picks chest cards; canvas clicks still lock) |
| Q | Swap weapon | Skill 1 (R6) |
| E | – | Skill 2 (R6) |
| X | – | Swap weapon (R6) |
| D | – | Wish (Wishes) |
| F | Pick up weapon | Unchanged |
| C | – | Focus the chest panel; then 1/2/3 pick, 0 skips (R5) |
| Tab (hold) | – | Full map with your route (R3) |
| H, Esc, Alt+Enter | Polish | Unchanged |
| Planning screen | – | Mouse, or keyboard cycling with Enter for Ready |
| All bindings | Fixed | Remappable in settings on `e.code` (R6) |

---

## 6. Balance strategy

- **Stays gating:**
  - `testing/test_rpsls.py`, the faction oracle;
  - parity between `harness:factions` and `realtime.py`;
  - the 20 Hz model.
  - The oracle and parity run with empty builds. Items that change faction mechanics (Pestilence's execute band, Condemn's mark, Bailiff's mark rate) are measured in the report-only matrix, never in the oracle.
- **New Python model, report-only:**
  - `realtime.py` gets a generic modifier vector: damage, attack speed, HP, armor, shield, lifesteal, anti-heal, slow.
  - New `testing/buff_report.py`: for each buff, at one camp (3.3 stacks) and at the plateau, the multiplier that flips each of the 20 edges, against the known soft spot (HP ×1.3 flips Holy over Sentenced).
  - It confirms each `counters` tag, for example Rot Monk against Holy lifesteal.
  - `test_kite.py` reruns with the attack-speed and move-speed plateaus of buffs and relics and reports the kiting margin.
- **New real-sim tools, report-only:**
  - `bench/campDuel.ts` (built in R4a; a report gate there): time to clear and HP left per starter faction × zone, normal and elite. Target: a starter clears a normal camp; an elite camp needs buffs.
  - "Power at minute N, old vs new" (R4a), for the owner.
  - "Camps clearable per timer": time to clear per camp × camps on the map against the first timer (300 s, or 120–300 s if the owner keeps the scaling). This is the core pacing question for route regret.
  - `bench/buffMatrix.ts`: the faction cycle with granted buffs, showing win-rate shifts.
  - A `--build` flag on the harness, to grant buffs, relics and skills to either side.
  - `bench/skillDuel.ts`: damage per cooldown in P units and the win-rate shift per skill.
  - `scripts/routeSim.ts`: Monte Carlo of routes over 200 seeds. It measures route regret, the spread of matchup outcomes across route choices; if one route dominates on most maps, the design is failing. It also reports the spawn walking ratio and the spread between the two dealt options.
- **Gating vs reporting:** unit tests, map certification, choice validation, bandwidth, tick budget, e2e and parity gate the build. Every balance output is report-only, written to `testing/TUNING_ROGUE.md`.
- **Owner retune authority:**
  - Results go to the owner before any tuning (`GAME_DESIGN` 17).
  - Sessions do not change catalog values, the S-curve constants, `MOB_K`/`ELITE_K`, caps, chest timers or stack grants. The exception is fixing a measured broken invariant, and only with the owner's sign-off.
  - A proposal is written as "change, measured effect" in the report.
  - All numbers live in the shared catalogs, so a retune is a one-line data edit.

---

## 7. Risks and open questions

| Risk | Mitigation |
|---|---|
| The generator misses its targets at the R1 time-box | Plan B "warped wedges" is pre-agreed. M1 does not depend on R2. Incremental lane certification is the last experiment, not the first |
| A burst of room creations empties the map pool | One synchronous in-process certification as the fallback; pool size and refill logged; training draws from the same pool |
| Client generation is slow on weak machines | Lane tables built in a worker at boot; generation starts in the lobby; budgets measured cold and at 4× throttle; a `mapHash` mismatch gives a friendly error and a clean leave |
| The wedge-map slice has ~2.2 camps per zone, not 3 | D5 draws types without repeats, so one type may be absent. R2 restores 3 per zone. The playtest also answers "does dropping a type sharpen route regret?" |
| The status runtime ends up duplicated with Wishes | R0 owns it and lands first. Wishes builds on it through the checklist |
| Shared-chest options and all synced state are public (no StateView) | Accepted by design. The UI shows contents only in range. "?" rewards and plan deals stay private. Known TODO |
| A cheating client picks the most favourable `t` | R6.0 bounds `t` by RTT and requires it to be monotonic before any instant skill rewinds |
| The prediction diverges on dashes, roots, slows, pulls and Ice Wall | Quantized authoritative mirrors; `rootUntil`; `noteCast` with expiry; `displaceSeq` rebasing; dashes in follow mode first; Ice Wall last, because it needs dynamic blockers in collision, pathing and line of sight |
| Planning drops and late deals | The seat is held during planning; the inbox is registered before the first state; plan, reveals and telegraphs are resent on reconnect |
| The skip heal is abused mid-fight on a shared chest | Skips respect the combat lockout (D12); the owner may choose GV only |
| The new buffs are far weaker than the old stacks | The campDuel and old-vs-new power report gates R4a; the owner retunes `ELITE_K`, the feed curve, catch-up and bounty before M1 |
| Bandwidth (heavy case at about 15 of 20 KB/s) | Mirrors patch only on quantized changes; `CampState` holds server-rolled fields only; small chest options; skill fx as tuples; bench after every phase |
| Buffs stack past the counters (plateau 2.1×, plus relics) | R8 flip-threshold report; caps; `MIN_MOVE_MULT`; `ls_cap` |
| Summons (Rat Pack, Rat Tide, Infest) | Moving areas, never rostered mobs |
| Test churn: about 17 buff test files and every seed-pinned suite | Phased; mechanical work goes to Sonnet; the R2 swap-in reruns the seed-pinned suites once |

| Open question | Default |
|---|---|
| First timer: a flat 300 s (owner's "5:00"), or today's player-count scaling (120 s at 2–3 players)? | Flat 300 s via `firstPatienceSeconds` |
| Does R0 owning statuses, with Wishes building on them, match the Wishes scope? | Yes (D21) |
| Skip reward: heal respecting the lockout, or GV only? | Heal respecting the lockout (D12) |
| Camp-wide aggro? | Yes (D24) |
| Should the chest also vanish at the coliseum teleport, alongside the 15 s limit? | Yes (D1) |
| Boon moved from "at spawn" to the planning screen? | Yes (D10) |
| Mob types fight identically (skins and buff only) in v1? | Yes |
| Every map offers every buff, or drop one normal type per zone per map? | Every buff on zone maps; wedge maps naturally drop some. Decide after the M1 playtest |
| Does "?" hide the reward only, not the mob type? | Yes (decision 4). The alternative is relaxing D5 so types can repeat |
| Quoted buff number = value at 3 stacks? | Yes (D6) |
| "Shield" means magic resistance, not a barrier? | Yes (D7) |
| Elite stack grant 3.1? | Yes |
| Cursed camps visible, mimic fight later? | Yes (D9) |
| Spawn walking ratio: target 1.2 (critique) or 1.25 (draft)? Gate or report? | 1.2, report |
| Zone borders, now that ridges are gone | A tinted edge line with a pattern, judged from the renders |
| Leash cap 12 tiles | Yes |
| "?" camps per map | 3 |
| Planning length | 12 s, with the lobby preview |
| Skill damage in P units | Yes (D11) |
| Cosmetic stats or achievements for camps, chests or relics? | None in v1; they would need a ProfileStore v3 migration |
| Effects of the relics, curses, boons and unnamed skills drafted above | Owner reviews before R6 and R7 content |

---

## Critique points rejected or adjusted

- **Point 2, partly kept as written.** "<5% of seeds need a fallback" stays an R1/R2 gate rather than becoming a server-cost metric only, because the owner set it as a hard target. Under the pool it means the share of seeds discarded within the attempt budget.
- **Point 1, adjusted.** `MOB_TYPES` lands in R0 as contract data rather than in R4a, so R3 and R4a both read it and neither depends on the other. The rosters themselves land in R4a.
- **Point 9, one option chosen.** "?" hides the reward, not the mob type, so D5 stays. Relaxing D5 is kept as an owner question. "?" and cursed camps move to R7, because before R7 every chest is a skill chest and there is nothing to hide.
- **Point 11, adjusted.** secondWind counts as R5-ready, because R4a already ships the trigger kind and `heal({ignoreLockout})` for Blood Saint. scout moves to R7 with the "?" camps it reveals.
- **Point 13, adjusted.** The chest panel's focus key is C, not F, because F is the weapon pickup.
---

## As built (kept in order; the plan above is not rewritten)

### R0: contracts, mods and the wedge adapter (built)
Deviations from the plan text, all agreed or harmless:
- **Status runtime:** not built here (owner ruling: the Wishes session owns it, `wishes-ability-contract.md`). `shared/effects.ts` carries a placeholder `StatusKind` that mirrors Wishes' 13-kind union in their order (no `chill`, no `barrier`), and a closed `TriggerAction` in Wishes' `do:` verb style. When Wishes merges, `effects.ts` switches to `import type { StatusKind } from "./status"` and stops exporting its own (the two `export *` lines in `index.ts` would collide).
- **Mirrors are float64, not 0.001 steps.** An existing test (`server/test/buffs.test.ts`) compares `attackSpeedMult` with `toBe(buffMultiplier(n))`, so quantizing would break "existing tests pass unchanged". R4a quantizes: change `encodeMult`/`decodeMult` and the field type (uint16 thousandths) together; rewrite those asserts and `client/test/fighterArt.test.ts` `SERVER_FULL_DRAW`; delete the stacks fields with the read-time freshness check in `sim/mods.ts`; wire `windupMult` into `timingsOf` and the client's draw/root, and `armorBonus`/`shieldBonus` into `defenseOf`; add mirrors to `MobState` if mobs can be slowed.
- **`world.modSources`** (a registry of `(world, c) => ModContribution | null`) is the seam Wishes' D22 needs: nobody has registered `attackSlowFactor` yet; R4b (or the Wishes merge) does it, and a status change must call `recomputeMods(world, c)`.
- **`generateMap(seed)` keeps its signature** (R2 adds `generateMap(seed, attempt)`); the map only records the `attempt` it was built from. `regions[].anchor` stays (with `pole` equal to it) until R2. `buildMap` returns null on a failed non-last attempt.
- **`rewardRandom`** is an sfc32 stream over a 128-bit crypto salt from `RaidRoom` (a number salt is expanded, tests only); it never draws from `world.random`.
- **`hitLanded`** is a chainable hook, called once per landed ledger entry (DoT entries included, after the hit fx); a throwing handler is NOT contained (it aborts the pass and drops that pass's queued payouts, as other hooks do): R4b must keep handlers total or wrap them.
- Legacy-hash test `shared/test/mapLegacyHash.test.ts` pins pre-R0 output for seeds 0..199 (`c214258d`); R2 replaces it.
- Merge hazards with Wishes (their worktree): `ledger.ts` has `if (isDot(e.sig) || e.dot) return;` (merged literally it skips `hitLanded` for DoT entries); their `client localPrediction.ts` still reads `buffMultiplier("moveSpeed", me.stacksMs)` (must stay `decodeMult(me.speedMult)`).
- R1 changed scope after the plan: the map grows to 96x96 tiles and the per-zone stylers (zone-terrain session) hook in after the partition, before cover certification.

### R3: planning phase (built)
Deviations and measurements, against the plan text above:
- **`PlanMessage`** is `{ endsAt, spawns, taken, pick, boons, boon }`: it gained `pick` (the player's own spawn pick, -1 for none) and `boon`, and `boons` is a `string[]` (empty until R7) rather than two ids. A `plan` input may carry `boon`, but it is ignored while no boons are dealt. `taken` means held by ANOTHER player's pick.
- **The deal** (`dealSpawns`, `rewardRandom` only): each pair is in one walking tier (`PLAN_WALK_TOLERANCE` 8%) and in different zones; "all dealt spawns in one tier" is preferred, not required. Wedge maps have a pool of 15 on every seed (200 checked), so with 8 players ONE spawn is dealt to two players on every map (the plan's overlap rule, kept to one spawn). Over 200 seeds, tier pairs are 100% up to 6 players, 99.1% at 7 and 95.8% at 8 (57 maps need a non-tier pair at 8, never a same-zone one); the max/min walk across everyone's dealt spawns averages 1.11 with 2 players and 1.57 with 8 (3.07 at worst); a deal costs 0.05 to 1.4 ms on average by player count (6 ms at most). The fallback is the closest walks in different zones. Zone maps (R2, a pool of 24 to 32) should lift the 8-player figure.
- **Timeout and early start:** a pick stands, anyone else takes their first free option, then the other, then the free spawn nearest in walk. The phase ends early once every CONNECTED player is ready (a dropped player does not hold it up). A dropped player keeps the seat and is dealt the default at the end.
- **Reconnect** resends the plan through a new `RaidRoom.sendPlan` (before `sendInFlight`), not by extending `sendInFlight`.
- **Config:** `SimConfig.planSeconds` unset is 0, but `loadConfig` defaults it to `PLAN_SECONDS` 12, so `loadConfig({})` now plans: tests that want the old flow set `planSeconds: 0` and `firstPatienceSeconds: 0`. `FIRST_PATIENCE_SECONDS` (300) feeds `firstPatienceSeconds`, armed in `startRaid`; training forces `planSeconds` 0.
- **Moved to shared:** `matchupShare` (re-exported by `bots/mobHunt.ts`), plus `shared/planning.ts`: `spawnWalks`, `walkLength`, `walkSeconds`, `sameTier`, `tierRatio`, `nearestCamps`, `isEliteCamp`, `campMatchup`. Bots plan with `planPick` (the matchup of the two camps nearest each dealt spawn) and press ready.
- **Client:** one `PlanningView` in four modes (lobby preview, planning, hold-Tab map, hidden); the route is capped at 12 stops (`MAX_WAYPOINTS`) and lives in `sessionStorage` only. Settings gained `showRoute` and `textScale` (100/125/150%). Planning freezes the client's world. Not done: a `reveal` handler (R7), zone edges on `MapView` (the planning map draws zone tints with a pattern and marker shape per zone), and the camp reward kind (R5/R7); a camp's type and buff show when `state.camps[i].type` is set.
- **Not in the plan:** the HUD status line shows "Planning m:ss"; the golden-hash test pins the minimap's painter output across the extraction.

### R4a: buff swap (built)
The owner's "double them" ruling (every 3-stack value x2) is recorded at the top of this file, in the Owner rulings block; the numbers below are not repeated there.
- **Mirrors are quantized now** (the R0 float64 note above is closed): `asMult`, `windupMult`, `speedMult` are uint16 thousandths (`WIRE_IDENTITY_MIRRORS` 1000, `decodeMult` = wire / 1000), `armorBonus`, `shieldBonus` int16 tenths; the sim reads the decoded value and a mirror patches only when its quantized value changes. `windupMult` is wired into `timingsOf` and the client's draw and root (`scaleWindup`), the flat bonuses into `defenseOf`. The read-time freshness check and the stacks cache are gone, and `stacksHp/As/Ms`, `COMBOS`, the kill bursts, the kill shield, `REGION_BUFF` and `rollBuffStat` with them. `MobState` has no mirrors (nothing slows a mob before R4b).
- **Buffs:** `BuffId` = `MobTypeId`; `PlayerState.buffs` is a float32 map; `BuffDef` is `{ id, zone, elite, name, text, effects, needs?, worksWith, counters }` with `text` generated from the rows. `MobTypeDef` has no short name (id, zone, elite, name only), so compact UI uses the full name. Grants: `MOB_BUFF_STACKS` 1.1 x m, `ELITE_BUFF_STACKS` 3.1 x m (the plan's proposal, up from 2.2); the bounty moves half of EACH owned buff. A mob-kill grant no longer draws from `world.random` (the stat roll did), so loot rolls after a mob kill differ from before.
- **Fx:** `buff` is `[10, id, B, stacks x 1000, total x 1000]` with B the buff's code in `MOB_TYPES` order (the BUFF table, append-only); kind 11 `combo` is retired (never emitted, never reused, the decoder drops it through `onDrop`); the `FxEvent` field `stat` became `buff`.
- **Ledger:** the outgoing multiplier is 1 + the damage sum + every holding `vs` row + every `scale` row (they ADD, not multiply), fixed for every entry at the start of `applyLedger` from the hp as the pass began (no separate status snapshot was needed); signature damage-over-time is multiplied; the arena's burn is not, and neither is a Wish's ability damage or its DoT chunks (flat power, the fix commit after the Wishes merge). `vs` tests `slowed`, `rooted`, `streak` and the rest are false until R4b.
- **`needs: "status"`:** `Effect` rows gained `needs?: "status"`. Chain Warden, Bloatfly, Rot Monk and Frost Wisp (`onHit`), Inquisitor (`streak`) and Glacial Warden (`slowed`) are shown on the HUD and tooltips ("(coming)") and never applied until R4b.
- **Factions:** `markRate` makes Sentenced's mark's engaged time grow (1 + rate) times as fast to the same cap. Lifesteal works for any faction from `lifesteal` rows capped at `LS_CAP` 0.25, Holy's own comes on top, the total capped at `LIFESTEAL_MAX` 1 (`lifestealShare`); it is exempt from the heal lockout. `heal(world, c, amount, { ignoreLockout })` skips only the lockout. These live in `sim/factions.ts`, so they do not run with `signatures: false`.
- **Blood Saint (trigger)** fires the first time a ledger pass leaves its owner standing below 30% hp, even if already below when the buff was gained, once per run per player (`PlayerRuntime.fired`), through a new chainable hook `hurt` (called once per surviving victim per pass, before the `hit` fx and `hitLanded`); the heal is paid with `payLater`. Penitent (`scale`) adds its `per` for every whole 10% of missing hp. Cinder Hound's `chasingLock` is "the player holds a target lock", re-checked once a tick, so its mirror follows one tick late. "Shield" in buff text is the magic-resistance stat (D7); the buff DoT's `per` is raw damage per second before `DUEL_PACE`.
- **Rosters:** `CampState { type, reward, alive, state }` is published at world build (none for training or `mobs: false`); `reward` and `state` are R5's. Zones draw without repeats from `rewardRandom`: on wedge maps (seeds 1-200) a zone has 2 camps (78%) or 3 (22%), so a 2-camp zone lacks one normal type. `spawnRegionalMobs` walks `map.camps` (same order as the old `regions[].mobCamps`); a mob without a type falls back through `mobTypeOf`.
- **HUD:** the build strip replaces the three rows (a chip per buff, built once in catalog order, tooltips from `buffTip.ts`); a buff's colour is its zone's; no kill bursts or combo UI remain.
- **`campDuel`** (report only; 3 seeds, a starter on its signature weapon, a camp of 3 normals on open floor): pulled one mob at a time, 18 of 25 faction x zone cells are cleared in every seed; with every mob awake (D24 as a preview), 9. The elite camp: 17 and 7 (16 and 7 in the implementing agent's run; the merged tree measures 17). Owner question for D24 and the camp runtime (R5).
- **Measurements** (seed 1, the bench default): bandwidth typical 7.06, heavy 10.05, idle 3.08 KB/s per client (6.87, 10.13 and 3.08 before R0; the heavy target of 16.5 holds with room, but it is report-only: the test gates 20 KB/s); a joiner's first sync grew from 7.6 to 8.5 KB. `stepBench --buffs` (every buff at 4 stacks on all 8 players): average 0.14 to 0.19 ms and p99 at most 0.5 ms in the implementing agent's run (a run beside other jobs showed 0.26 ms and 3.0 ms, inside the gate). `harness:factions --python` agreed on 60 of 60 cells (agent's run).
- **Not done:** the training build console (nothing grants a buff in training), `MobState` mirrors and the status rows (R4b), and the "power at minute N" report, which was produced separately and is not in the repo.

### R3/R4a follow-ups (built)
The owner's rulings above (attack speed, leaving during planning, merge order); numbers and method in `testing/TUNING_ROGUE.md`.
- **Attack speed:** Plague Rat stays +8% (x1.08 at 3 stacks, x1.17 at the plateau). `AS_MULT_CAP` (`shared/constants.ts`, 1.5) caps the `asMult` mirror from every source after they multiply (`sim/mods.ts` `mirrorsOf`, then encoded), so the sim, the prediction and the bow art read the capped value; a slow (the Wishes' `slowAttack`, a mod source since the merge) multiplies the uncapped product. With a buffed shooter, `testing/test_kite.py` (now `--shooter-as`, plus `kite_buff_sweep.py`) holds every cell to x1.25 outside a tick-alignment dip at x1.08-1.105 and fails from x1.3 (6 cells at x1.5); the real sim's KITE EDGES pass (`npm run harness -w @raid/server -- --kiting-only --shooter-as X`) holds to x1.5 (Plague > Frost at 2% hp) and first fails at x1.66, the faction counter itself. The dip is an artifact of the model's 20 Hz grid, and its failures from x1.3 are a trend the real sim does not show (the model is the conservative one); the owner set the cap at the real sim's limit.
- **Leaving during planning:** `removePlayer` in planning calls `missInPlanning` (`sim/arena.ts`): an MIA result with `place` = the players still in the room and 0 GV, recorded as a run and a death; `leavePlanning` frees what they held. `PlanningRuntime.starters` keeps the leaver among the starters (`beginRun` takes the larger of it and the players left), and `lastOneStanding` starts the run at once when one player is left of two or more, so the next tick's settle ends it with that player winning, bonus withheld. `RaidRoom.onLeave` voids the run instead while shutting down (`abandonPlayer`, `bankVoided`). The Wishes' `fighterOut "removed"` fires for every planning leave and finds nothing to clear (no statuses, cast or fields before the run).
- **The Wishes merge** (`claude/r3r4a-main`): the R0 merge hazards above are closed (`effects.ts` imports `StatusKind`, and `TriggerAction`'s `status`/`cleanse` are `AbilityEffect`'s; `hitLanded` fires for DoT entries; the prediction reads `decodeMult(me.speedMult)`); the Wishes registered the attack slow as a `ModSource` and re-fold it on apply and removal; the ledger multiplies raw x outgoing rows x `damageFactor` (Trial) before mitigation, order-free (`ledgerMult.test.ts`); the Wish lock starts at `raidStarted`, after planning, and planning drops a `cast` like any other non-`plan` input. Bandwidth (seed 1): typical 7.02, heavy 10.13, idle 3.08 KB/s; a joiner's first sync 9.0 KB (8.5 before the Wishes' synced fields).
- **Pre-merge review fixes** (the commit after the Wishes merge): (1) owner ruling "Keep Wishes flat": `outgoingMults` (`sim/ledger.ts`) skips every entry with `ability` set, so a caster's damage, `vs` and `scale` rows never multiply a Wish's damage or its DoT chunks (Blaze Step's trail stays 12 per tick whatever Ember Imp the caster holds); Trial's `damageFactor` still applies. (2) A void in planning is sticky: `abandonPlayer` sets `world.arena.voided` in planning too and `updatePlanning` returns early, so a shutdown can no longer let `lastOneStanding` start and win a void run. (3) The `hurt` hook now also gets the hp before the pass (`hpBefore`), so a non-`once` `hpBelow` trigger reads the real crossing under Last Stand's floor (no catalog row is non-once yet). (4) Hold-Tab leaves Tab alone while the results panel is up (`mapHoldAllowed`). (5) New tests: ability entries are flat, a cross-attacker Penitent pass is order-free and reads the start-of-pass hp (a lazy read fails it), the end-of-planning placement follows the secret order, and `perf.test.ts` also runs the all-buffs case.
- **Measured in that review (docs only):** the bandwidth and mob-strength figures were re-measured on the merged R3/R4a + Wishes tree, at `MOB_K` 0.45; R5 then lowered `MOB_K` to 0.22 and measured both again ("R5 follow-up: weaker mobs" and "The R3/R4a + Wishes line folded into R5", below).

### R5 follow-up: weaker mobs (built)

The owner's "weaker mobs" ruling for camp-wide aggro (D24). **`MOB_K` 0.45 -> 0.22; `ELITE_K` stays 0.65.** Target: at least 20 of 25 faction x zone pairings clear a full normal camp that wakes at the first hit (a starter on its signature weapon, no buffs, no second weapon), measured at camp size 4, the zone maps' mean. Full report with every table: `side-session-notes/.../r5-weaker-mobs.md`.

- **`campDuel` now measures the real D24 pull.** Its old `group` pull woke the mobs by hand and placed them without a camp, so camp-wide aggro never ran. The new `camp` pull (the primary one) places the mobs with `MobState.camp` and a published `CampState`, all idle; the first landed hit wakes the whole camp through `mobAI.aggro` (all `size` mobs awake on the tick the first wakes; `single` wakes one). `single` (the camp before R5) and `group` (all awake at tick 0, harsher than a real pull) stay. `--size N` sets the elite camp too (the elite and N - 1 normals); new `--k`, `--elite-k`, `--pulls`, and `--sweep` with `--ks`, `--eks`, `--sizes`. `mobDuel`'s default sweep now starts at 0.20.
- **Pairings cleared (of 25) in every one of 12 seeds, camp pull, normal camp** (ELITE_K 0.65): size 4: MOB_K 0.45 -> 4, 0.40 -> 6, 0.35 -> 8, 0.30 -> 11, 0.25 -> 19, 0.24 -> 20, 0.23 -> 21, **0.22 -> 21** (22 if at least half the seeds count), 0.20 -> 21, 0.15 -> 23. 0.22 is the smallest value that meets the target with a margin of one; 0.20 is the same at size 4 and better at size 5 (18).

| camp (MOB_K 0.45 -> 0.22) | camp pull (D24) | single pull | group pull |
|---|---|---|---|
| normal, 3 mobs | 9 -> **23** | 18 -> 24 | 7 -> 22 |
| normal, 4 mobs | 4 -> **21** | 15 -> 24 | 4 -> 22 |
| normal, 5 mobs | 2 -> **14** | 12 -> 22 | 2 -> 12 |
| elite + 2 normals | 7 -> 12 | 16 -> 19 | 7 -> 10 |
| elite + 3 normals | 3 -> **9** | 12 -> 18 | 2 -> 11 |
| elite + 4 normals | 2 -> 7 | 11 -> 18 | 2 -> 7 |

- **Weakest pairings (size 4, camp pull, normal camp), and why they stay failed:** Frost (shield) against a Frost zone, a stalemate at 100% hp at every size (both shields block every bash: the known hole, the second weapon is the answer); Holy (wand) against a Sentenced zone, 0 of 12 (the Sentenced mob carries a sword, and Sword beats Wand in the real sim); Sentenced (bow) against a Fire zone, 0 of 12 (four axe mobs with burn on the smallest hp pool, the bow's 0.6 s windup root lets them close); Sentenced against its own zone, 8 of 12. At size 5 more ranged starters fail (14 of 25).
- **Elite camps stay harder, as ruled, and none is impossible:** at size 4 every zone's elite camp is cleared by at least one starter (Fire zone: Fire, Frost, Holy; Sentenced and Plague zones: Fire only; Frost zone: Sentenced only; Holy zone: Plague, Frost, Holy). The ELITE_K lever (MOB_K 0.22, size 4, camp pull, in every seed): 0.65 -> 9, 0.55 -> 10, 0.50 -> 12, 0.45 -> 13, 0.40 -> 17, 0.30 -> 20; but the lone elite (`mobDuel --style stand`) is 22 of 25 pairings at 54% hp left at 0.65 and 23 of 25 at 70% at 0.50, so lowering it trades the elite fight for the camp.
- **A lone normal mob (`mobDuel`, 3 seeds):** `--style stand` 23 of 25 pairings won, 74% hp left before (Frost>Frost and Holy>Sentenced not won; the old docs' "24 of 25, 80%" was Phase 11's), now 24 of 25 and 91% (only Frost>Frost). Default `policy` style 22 of 25, 71% -> 84%. The elite is unchanged (22 and 20 of 25).
- **Benches after:** `stepBench` avg 0.152 ms, p99 0.426 ms (gates 5 and 15); `bandwidth` typical 7.66, heavy 11.69, idle 3.22 KB/s (gate 20).
- **Tests:** `shared/test/mobs.test.ts` (pinned constants and the concrete Fire mob: 110 hp, a 33 hit, burn 2.2) and `server/test/mobHunt.test.ts` (no normal matchup is under the bots' `mobMinShare` 0.5 any more, so the filter is exercised at a bar of 0.85) are the only ones that pinned the old value; the mob signature tests derive from the constants. Shared 981, server 3492, client 1151 pass; typecheck is clean.

### The R3/R4a + Wishes line folded into R5 (built)
`claude/r3r4a-main` (Wishes on `main`, then R3/R4a's owner rulings) merged into the R5 branch. Where the two lines meet:
- **Wire:** the Wishes' fx kinds keep 14-17 (`cast`, `castLand`, `castEnd`, `status`, on `main` first); R5's are renumbered to `campCleared` 18 and `chestTaken` 19 (never released). `CLIENT_MESSAGE_TYPES` ends `plan`, `cast`, `choose`, `train` (registered by name, not wire-indexed).
- **Hooks:** one `runEnded` (both lines added it): the Wishes cancel casts (no refund) and end statuses and fields, `sim/chests.ts` removes the chests; at the teleport the Wishes refund a pending cast and the chests go too. Tested together in `server/test/wishesCamps.test.ts`.
- **A chest pick is an action:** a stunned or casting player's `choose` is refused like a pickup (`actionBlocked`, the toast "Can't do that now", the pick not used); the bots wait a stun or their own cast out before their one try.
- **Camp-wide aggro and the statuses:** a woken camp-mate is never handed a hidden or untargetable target (Swarm); a stunned mate does nothing until its stun ends (the Wishes' stun stops mob AI).
- **Secrecy:** a chest pick names its picker even while Swarm hides it (`chestTaken`, `takenBy`, `pickers`; public by design, D17). Left as is and listed in CLAUDE.md's Known TODOs (owner question: should a pick reveal like a cast?).
- **Measurements after the merge** (seed 1; the machine was loaded, load average 12-19): `stepBench` avg 0.59 ms, p99 8.8 ms (`--buffs` 0.50 and 7.2; gates 5 and 15); `bandwidth` typical 7.68, heavy 11.71, idle 3.22, five chests up 7.93 KB/s, a joiner's first sync 9.4 KB; `harness:factions --python` 60 of 60; `test_rpsls.py` all pass. Tests: shared 1092, server 3818, client 1392; typecheck clean.
- **`main`'s pre-merge review fixes, merged after R5** (`7ef5d71`, through `main`): flat Wishes hold with R5's passives too: `outgoingMults` skips an ability entry before it builds the entry's `vsProbe`, so Whetstone, Bounty Hunter, Witness and Pestilence's `vs` row never multiply a Wish's damage or its DoT chunks (Trial's `damageFactor` still applies), while weapon hits and signature damage keep the probes and the start-of-pass reads. The `hurt` hook's single signature is `(world, c, applied, hpBefore)`, called only from `applyVictim`, and `onHurt` (`sim/factions.ts`) reads `hpBefore` for Blood Saint and Second Wind (heal over time and the teleport re-arm unchanged): the R5 follow-up "Last Stand and the `hurt` hook" is closed. The sticky planning void and `mapHoldAllowed` came in unchanged (the latter beside the chest panel's wiring in `RaidScene`). After this merge: shared 1092, server 3828, client 1394 tests pass (the tick-budget test failed once at load average 12-17 and passed alone); typecheck clean; `harness:factions --python` 60 of 60; `test_rpsls.py` all pass.

### R5: camps and contested chests (built)
The camp runtime, the shared chest, the passives, the chest bots and the training console, on today's wedge maps. Rules are in CLAUDE.md; the player-facing design is GAME_DESIGN 11 and 12.5. Deviations and additions against the plan text above:
- **The catalog is the whole 3.6 table, nine rows are live.** `shared/skills.ts` holds all 21 passives with their numbers; `ready` is `"r5" | "r4b" | "r6" | "r7"` and `LIVE_SKILL_READY = ["r5"]`, so only Whetstone, Swift Boots, Quickdraw, Thick Hide, Bounty Hunter, Second Wind, Witness, Pestilence and Last Rites are rolled or folded. Firebrand and Hoarfrost Armor are `"r4b"` (the plan's "after R4b"), Ashwalk, Double Sentence, Sentence Served, Bite Twice, Shatter, Frozen Path, Radiance and Quartermaster `"r6"`, Searing Riposte and Scout `"r7"`. `PlayerState.build` is a `uint8` map, skill id to rank. Passive rows fold in `sim/mods.ts` with the buffs' (the same damage sum, the same stat keys; a rank's `byFaction` rows replace its `effects` for that faction). New in the contracts: the `executeBand` stat key, the `higherFeed` and `thirdParty` `vs` tests, `ms` on a trigger's `heal`, `rearm: "teleport"` on a `once` trigger and the GV reason `skip`.
- **The vs tests read the start of the pass.** `higherFeed` (Bounty Hunter, players only) and `thirdParty` (Witness) are answered by the ledger's `vsProbe` lazily, per entry, from the state as the pass began, like every outgoing-multiplier input. Witness's "fighting someone else" is the victim's target lock, its mob fight target or its signature target naming anyone but the attacker. Pestilence gives Plague `executeBandOf` (0.5 + 0.1 or 0.2) and others a `vs hpBelow 0.6` row; Last Rites is a stepped `while hpBelow` row.
- **Second Wind** (the plan: "heal 20% over 2 s", rank 2 "30%, once per teleport"): a `trigger` row (`hpBelow` 0.25, `once`), its heal spread over `ms` 2000 in `HEAL_OVER_TIME_STEP_MS` (500) steps, four of 5% (rank 2 7.5%), the first paid with the pass, the rest by a `healOverTime` system, each through `heal({ ignoreLockout: true })` so an anti-heal scales it and a downed player loses the rest. Both ranks share one once-key (an upgrade does not re-arm it); rank 2 re-arms at every coliseum teleport (`rearmTriggers`, on the `teleported` hook).
- **The interim roll rule, as coded** (`shared/rewards.ts`, `CHEST_RULE = "interim"`; the plan's "at most one zone passive"): exactly one live passive of the camp's zone as card 1 when the zone has one (Sentenced, Plague and Demon Blood do; Fire and Frost give three neutrals until R4b), then live neutrals, no duplicates (a partial Fisher-Yates, one `rng()` per option taken, zone half first). The shared chest is rolled with NO build, so a card the picker holds at rank 2 is refused at the pick ("Already at rank 2") and a card held at rank 1 gives rank 2. The `"d6"` rule (2 zone + 1 neutral, a short pool filled from the other) is coded and tested for R6 to switch on. Options come from `world.rewardRandom` only.
- **The chest** (`sim/chests.ts`): a `ContainerState` of kind `"reward"` at `CampDef.chest` (the camp's centre when that tile is a wall), created through `payLater` from the new `campCleared` hook, `expiresAt` = the drop + `CHEST_SECONDS` (15 s), removed in the tick `serverTime` reaches it (after the inputs, which already refuse a `choose` at or after it), at the coliseum teleport and at run end. `pickup` on it says "Nothing to take". Every camp, elite ones too, drops one: `CampState.reward` stays "" (R7).
- **`choose`** is an action resolved in the shuffled `actionOrder`. Check order: standing; not stunned or casting (the Wishes' `actionBlocked`, "Can't do that now": **not in the plan's list, added with the merge**); chest exists, is a reward, was not born this tick, not expired ("Chest gone"); server position within `CHEST_RANGE` 96 u ("Too far away") with line of sight ("Can't reach that"); not in `pickers` ("You already picked"); skip, or an index the chest has (anything else ignored silently); option free ("Already taken"); not at rank 2 ("Already at rank 2"). `replace` is parsed and ignored (R6).
- **The skip** (D12, confirmed): `SKIP_HEAL_SHARE` 0.15 through `heal()` (the lockout applies); if it heals nothing, `GV_SKIP` 3 GV under `GV_MOB_CAP` 30 (`awardSkipGv`, reason `skip`).
- **Camps** (`sim/camps.ts`): `hurtMob` engages (sticky), `killMob` calls `campMobDied`, the last death sets state 2 (permanent, whoever or whatever kills) and queues the `campCleared` fx and hook with `payLater`. **Camp-wide aggro** (D24, `CAMP_WIDE_AGGRO = true`) is `mobAI.aggro` → `wakeCamp`: each damage to a member wakes every IDLE living mate onto the same target, even when the hit mob was already fighting; the mates hold it with 0 threat so kill credit is unchanged; a returning mate ignores it; a hidden or untargetable target is never handed on; a stunned mate waits out its stun. Strength was retuned for it (below).
- **Wire**: `campCleared` 18 and `chestTaken` 19, after the Wishes' 14-17 (renumbered in the merge; never released). `CLIENT_MESSAGE_TYPES` ends `plan`, `cast`, `choose`, `train`.
- **Bots** (`bots/chestHunt.ts`): one `choose` per chest per bot, never retried, within 88 u and over 350 ms of life, the best free usable option (own faction's pool +4, damage / attack speed / hp rows most, a missing weapon -3) else a skip; walks (`move` only) to the nearest chest with a usable option and enough life, within 12 tiles when fighting or with an awake mob within 220 u, never while retreating; waits out a stun or its own cast. The e2e asserts one `choose` per chest per bot and one `chestTaken` per chest and picker, and takes a chest option as a replay criterion when a camp was cleared.
- **Client**: the chest panel (`ui/chestPanel.ts`, `chestMath.ts`) opens from the SERVER position within 88 u with a clear line, is click-through but for its cards and Skip, and greys at `expiresAt − (RTT/2 + 50 ms)` in true server time; its RTT is the prediction's order delay, not a ping (a Known TODO). A reward container is never an F target. Minimap blips with a countdown, `ContainerView`'s ring and timer, cleared camps crossed out on the minimap and the planning map, the passives row (`ui/passivesRow.ts`), toasts for `campCleared` and your own `chestTaken`. A pick not confirmed in 600 ms (`ORDER_EXPIRE_MS`) says so, since some refusals are silent.
- **Training console** (the plan: "spawn a camp; drop a chest with chosen options", and R4a's "not done: the training build console"): `train { cmd: "buff" | "passive" | "camp" | "chest" | "clear" }`, three locks (dropped at the door outside training, registered by `installTraining` only, re-checked in the handler), caps of 12 practice mobs alive / 150 per room / 6 chests / 300 ms between drops. Practice camps use pseudo camp numbers 101..255 (no `state.camps` entry: no clear, no chest), and a practice kill pays nothing (`payMobKill` returns in training).
- **Known TODOs recorded in CLAUDE.md**: the chest's options and takers are public state; three empty arrays on every weapon container cost +0.14-0.24 KB/s; a pick names a Swarm-hidden picker; the panel's RTT and its silent refusals; `trainPassive` repeats `grantSkill`'s apply; Firebrand and Hoarfrost Armor wait for R4b.
- **Measurements after the merge** are in "The R3/R4a + Wishes line folded into R5" above (bandwidth typical 7.68, heavy 11.71, idle 3.22, five chests up 7.93 KB/s; stepBench 0.59 ms average on a loaded machine, 0.15 ms unloaded).

### Follow-ups
- **R4b: the on-hit statuses.** Chain Warden, Bloatfly, Rot Monk and Frost Wisp (`onHit`), Inquisitor (`streak`) and Glacial Warden (`slowed`) are still `needs: "status"` catalog data. The status runtime is on `main` (the Wishes), so they hang on `hitLanded` through `addStatus` now. Firebrand and Hoarfrost Armor are unblocked with them: add `"r4b"` to `LIVE_SKILL_READY` and Fire and Frost chests start offering their zone passive. `MobState` mirrors are needed once a mob can be slowed.
- **Commit `d40cd60`** (merged into this line): a damage over time's last chunk is reported when the run ends. Signature and ability DoT reported `hit` fx in `DOT_FX_MS` chunks and the chunk still open at the end was never sent, so the killing damage had no number and the e2e win-bonus check could see fewer victims than the server counted; both runtimes now flush on `runEnded`, before the victory fx.
- **Open for R6/R7**: `CampState.reward` is "" until R7; `choose.replace` and a slot-replace prompt arrive with the actives (R6); `CHEST_RULE` becomes `"d6"` then; interest management would hide chest contents from clients out of range; the panel's RTT should be a measured ping if the grey-out margin matters.
