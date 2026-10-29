# RougeHalla: Game Design Document

## Live playtest update (2026-10-29)

These rules supersede older controls, range, healing, vision, and quest descriptions below. This release builds on current main's zone maps, uncapped normal-mob stat growth, champion progression passives, and elite augment chests.

- WASD / arrow keys move. Left-click attacks toward the cursor (hold to repeat); only wand clicks lock onto enemies and home. Right-click ground still walks. Ranged windups pause movement and cannot be cancelled by walking.
- Reach in world units: fists 72, sword 112, shield 96, axe 112, bow 520, wand 640. Arrows have a larger 7-unit collision radius. Bow pauses up to 0.5s / 55% of its attack interval, wand up to 0.45s / 50%.
- Q or 1/2 swaps weapons, E casts Wish, R drinks a potion, F picks up items or enters a cannon. Empty slots remain fists. Existing Plague corpse and Sentenced hunt interactions remain.
- Physical stats read Offense and Defense. Magic stats read Soul Offence (SO) and Soul Defense (SD). The faction display name is Holy.
- Camp clears drop a healing potion instead of immediately healing contributors. Contributor credit and champion camp-clear progression remain. Large potions heal 40% max HP over 5s; small potions found in weapon chests heal 25% over 5s. Carry up to 5 of each; large is used first and potion healing cannot overlap.
- One-use wind emblems appear at random clear-floor locations at random 8–15s intervals, capped at 12 on the ground. Walk over one for +50% movement for 5s; it disappears, with no inventory or activation key.
- Travel cannons connect distant regions. F enters and blasts to the linked destination; each cannon reloads for 75s. Cannons are sealed while coliseum gates are locked.
- Holy area's Light terrain now heals 3% max HP/s, five times its former rate. Holy receives 6%/s through its existing home bonus. The combat healing lockout remains.
- Vision trails last 30s. Camp wards last 120s; camp respawns remain 180s. Minimap size is saved in Settings (75%–200%).
- Camp previews show rewards and elite warnings, with no simulated win/remaining-HP percentages. Weapon chests conceal their contents until opened.
- Above players, the left build icon shows their secondary weapon; the next two show their strongest stat investments. Hold Tab for a roster left of the map with both weapons and the top three stat gains, ranked by combined stat growth and PvP power (strongest first).
- There are 20 quests per run: 10 known and 10 rumoured. Current acceptance and private objective-route rules remain.
- One Wandering Villager trades weapons and potions. One Soul Broker offers 3 persistent random stat exchanges based on current stats; choose 1 once per run (12% cost for 18% gain). Both wander and stop for nearby visitors. Trades preserve uncapped farming, augments, and champion progression.


> Current progression: see [Mob progression](MOB_PROGRESSION.md). Regular kills grant one fixed stat stack (ten per type); only elite deaths drop interactive augment chests. Historical card tables below remain reference data, not the live reward pool.

*Working title. Version 1 of this document, written from the owner's design board, the class sheet in `testing/`, and the approved build plan.*

*Revision v3 (attack speed). Fire attacks at 0.60/s (hit 305 to 150, base DPS 91.5 to 90, backlash 210 to 200) and Frost at 0.45/s (hit 135 to 90, DPS unchanged at 40.5). A weapon is now a % boost on the faction's base attack speed, so the speed ratios between factions hold on every weapon. Fire's axe swings every 1.19 s (was 2.58 s) and the slowest combo in the game, Frost's axe, every 1.59 s (was 2.58 s). The cost: Fire's backlash reads the foe's attack rate, so a faster Frost feeds it and Frost over Fire gets thinner (59% to 49% HP left). It never flips. Fixed animation timings now scale down with the interval, and a staggered target is immune to stagger for 0.5 s (sections 9.1 and 10.3).*

*Revision (Phase 10). No faction number changed. In the real-time game a Sentenced sword hit staggers Holy and cancels its windup, which costs a hit-based fighter about a fifth of its damage and a damage-over-time faction nothing, so Holy over Sentenced with both on swords lost every duel the engine says it wins. A stronger Holy lifesteal fixed that and was reverted after review (it lets Holy stall against Holy). What replaced it is a rule, not a number: a stagger that lands pauses the staggered fighter's burn, disease and mark for its weapon's windup (section 10.3). The chill also no longer stretches the ranged recovery. Every try, measurement and rejected variant is in `testing/TUNING_10.md`.*

*Revision (Controls rework). Right-click moves and a left-click on an enemy locks it: the server then walks you into range and auto-attacks it (sections 9.5 and 14). The click-and-hold bow with its partial draws, and the ranged move slows (0.1x while drawing, casting and recovering), are gone. Every attack is a windup that roots its fighter until the swing lands or the arrow or ball leaves, and the bow and the wand windups (bow 0.92 of the interval up to 0.6 s, wand 0.8 up to 0.4 s) are now what holds kiting back. The kiting check is judged against a shooter that walks away between its shots. No faction number changed. The numbers come from the 20 Hz Python model (`testing/test_kite.py`); the real-sim harness is re-measured in `testing/TUNING_CONTROLS.md`.*

*Revision (Wishes). Each faction gets one once-a-run ability, a **Wish**, on `D` (section 8.8): Freeze, Swarm, Trial, Blaze Step and Last Stand. They run on a status and ability framework that the later active skills and relics reuse (section 8.9). No faction, weapon or mob number changed, and the weapon harness and the kiting check do not cast a Wish (`testing/WISHES.md` reasons about what each one does to them).*

*Revision (Roguelike R2). The wedge map is gone. The arena is a map of five organic zones of equal area around the fixed coliseum (96 x 96 when this revision was made, 136 x 136 since the Zone shapes revision below), with camps and their territories in each zone (four a zone then, eight now), a spawn pool of 24 to 32 starts on one walking contour, and no ridges or passes (section 5). Mobs now leash to their camp's territory, at most 12 tiles from their spot (section 11). Every map is certified as it is made, built from a seed and an attempt that the state publishes, and made ahead of time by a background worker (section 16). No faction or weapon number changed. Zone terrain (lava, fences, ice and the like) was planned here and is built (section 5.2).*

*Revision (Roguelike R3 and R4a). A planning step now sits between the lobby and the run (section 3), and the first patience timer is a flat 5:00 (section 6). Camps are mono-type, and every mob type drops its own buff (sections 11 and 12): the three-stat S-curve and its kill combos are gone, and a single buff is smaller than the old stat plateaus (mostly +4% to +30% at the quoted value, after the owner doubled the first picks). The rest of the roguelike plan (zone maps, camp chests, skills, relics, start boons) was planned, not built, then: see `docs/ROGUELIKE_PLAN.md` and the next revision. No faction or weapon number changed.*

*Revision (Roguelike R5). Clearing a camp now matters. The first hit on any mob wakes its whole camp, a cleared camp stays cleared, and it drops one **shared chest** for 15 seconds that offers three passive skills, one pick per player, first come first served (sections 11 and 12.5). Nine of the 21 designed passives are built; you hold them for the run, on a row under the buff strip. To keep a camp that wakes together beatable, normal mobs are weaker: a normal mob is its region's faction scaled by 0.22 (it was 0.45; section 11). The practice room gets a console to set buffs and passives, spawn a camp and drop a chest (section 4). Active skills on Q and E, relics, curses, zone maps, "?" camps and start boons are still planned. No faction or weapon number changed.*

*Revision (Zone shapes). The map is 136 x 136, about twice the area, with eight camps in each zone and two of them elite (40 camps, about 160 mobs). The walls are no longer scattered: the 480 u sight cap and the cover pass that enforced it are gone (owner ruling), and every zone has one designed shape of named features, each with a job: Crater Basins (Scorch), the Rows (Gallows), the Barrows (Warren), the Mere (Rime) and the Hypostyle (Sanctum), with a designed landmark building in place of the random ruins (sections 5 and 5.3). Spawns keep 10 tiles apart unless a wall is between them, and their walks to the coliseum are certified within a ratio of 1.2 on the real pathfinder. The Rime has real ice lakes. No faction or weapon number changed. `docs/ZONE_SHAPES_AS_BUILT.md` has the details and the measurements.*

*Revision (Balance pass).* Every run now starts on **fists** (an empty hand fights with them), and a mob's weapon arms an unarmed killer. A mob kill pays GV, feed, the weapon and its fixed normal-type stat (see `MOB_PROGRESSION.md`); historically, the per-mob-type buffs of R4a and the 21 passives of R5 are gone, and all stat power is one of **75 cards** from camp chests and quests, built on AD and AP and converted by each weapon its own way, with the **PvP factor** (0.77 with no cards, 3.0 at the limit) scaling player-to-player damage by card power and thirteen guards (G1-G13) bounding what a stack can do (sections 10.2, 10.4 and 12). The faction sheet was compressed so every edge leaves its winner 10-35% hp, and the signatures were typed (burn and disease magic, backlash physical, the mark true: section 8). The weapon loop got a partial shield block, a longer stagger immunity, the wand's splash and the axe's shred (section 9). There are 30 mob types with roles (four normal and two elite per zone); a zone's eight camps are dealt from a shuffled bag of its normal types, each of its two elite camps holds one of its elites, and clearing a camp heals the players who fought it (sections 11 and 12.6). Quests pay a card. Time to kill is a design target: about 20 s for an even duel at minute 0 on fists and about 5 s with the kit of a player five camps in (section 10.4). The Wishes' numbers did not change. The measurements, the acceptance record and the open questions are in `testing/TUNING_BALANCE.md` and section 18.

---

## 1. The game in one paragraph

RougeHalla is a top-down, League-of-Legends-angled **roguelike battle arena**. You pick one of five factions, step out of the hub into an arena with up to seven other players, and start with nothing but your fists and your wits. You build a run by looting chests, fighting the neutral creatures of five regions (each region's creatures carry and drop their own weapons), clearing camps for cards, and picking fights you can win. Two counter loops decide every fight: **faction against faction** and **weapon against weapon**. There is no shrinking zone. Instead, the impatient host of the Arena runs a visible **patience timer**. If nobody dies before it runs out, everyone is teleported into the central coliseum and locked in until someone falls. The last player standing earns **Glorious Victory (GV)**. Everything you found during the run is gone when it ends. GV, cosmetics, titles and achievements are what you keep.

---

## 2. Scope

### 2.1 First playable (the target)
**Hub (menu) → pick faction → arena with weapons, mobs, patience timer and coliseum → last one standing → GV → back to the hub.**

| Area | In the first playable |
|---|---|
| Players per arena | Up to 8 |
| Factions | All 5 (Fire, Sentenced, Plague, Frost, Holy / "Demon Blood") with their signature mechanics |
| Weapons | Fists to start, then all 5 weapons (Sword, Bow, Wand, Shield, Axe) with their counters and interactions; 2 weapon slots |
| Wishes | One once-a-run ability per faction on `D` (Freeze, Swarm, Trial, Blaze Step, Last Stand), section 8.8 |
| Map | A 136 x 136 map of 5 faction zones (each with its own designed shape, 8 camps each, two of them elite) around a central coliseum with lockable gates |
| Planning | A 12 s planning step after the lobby: pick 1 of 2 dealt spawns, see every camp's mob type, its role, the weapon it drops and your matchup, draw a route |
| PvE | Neutral regional mobs (30 types with roles) in mono-type camps that fight back (one hit wakes the whole camp) and drop GV and their weapon; weapon chests |
| Camp chests | A cleared camp stays cleared, heals the players who fought it and drops one shared chest of three cards for 15 s: one pick per player (75 cards, all built; section 12.5) |
| Pressure | Patience timer → coliseum teleport → gates locked → sudden death |
| Snowballing | Feed score, cards and the PvP factor, falling mob rewards, bounties |
| Persistence | Profile with GV, stats, cosmetics (shop), achievements, titles, monthly GV leaderboard |
| Hub | Menu-based hub (GV, faction pick, counter wheel, shop, leaderboard), then a walkable hub with training grounds |

### 2.2 Later (designed, not in the first playable)
- **Quest NPCs.** Unique arena NPCs each offer a simple quest. The first player to finish it gets that NPC's unique reward (items, armor, sometimes abilities). A first version is built and no longer "later": ten standing offers per run (five known in planning, five scouted), paid in a card and a capped quest GV, with no unique items or abilities (`docs/quests.md`).
- **Raid-boss mobs.** Some neutral creatures reach raid-boss strength.
- **Secrets and lore.** Hidden spots for rare loot, cosmetics and lore snippets that point to deeper secrets.
- **Social.** Friends list, hosting 1v1s, private matches, text chat.
- **Hub NPCs** that exist only in the hub.
- **The roguelike overhaul** (see `docs/ROGUELIKE_PLAN.md`): two active skills on Q and E, relics (also offered by the chests) and curses, "?" camps that hide their reward, and a start boon picked on the planning screen are **planned, not built**. Zone maps, planning, mono-type camps, camp-wide aggro and the shared card chest are built (sections 3, 5, 11 and 12).

### 2.3 Out of scope for now
- **Real-money purchases.** The shop design allows them (cosmetics only), but no payments are built.
- **Accounts with passwords.** Profiles are callsigns tied to a token on the device.
- **Matchmaking by skill, ranked play, multiple servers.**

---

## 3. A run, start to finish

1. **Hub.** You see your GV balance, titles and leaderboard position. You pick a **faction** for this run. You start on **fists**, whatever the faction: you arm yourself in the arena. A counter wheel shows both loops and where your pick sits.
2. **Enter the Arena.** You climb the stairs (in the menu hub: press *Enter Arena*). You join a lobby of up to 8, which shows the map, every camp's mob type and the factions in the room. The lobby starts the run when enough players are in or a short timer runs out.
3. **Planning.** A 12-second planning screen (`PLAN_SECONDS`) follows, the room locked and nobody able to move, fight or be hurt. You are dealt **two spawns** at about the same walking distance from the coliseum (within 8% of a shared value) and in different zones, and you pick one. The first player to pick a spawn holds it, and a spawn someone else took shows as taken at once; within one tick a secret order decides. The screen also shows every camp with its mob type, its role, the weapon it drops and how your faction fares against it. You can draw a **route** (up to 12 stops, with its walking time), which shows faintly during the run. Pressing Ready locks your pick, and the run starts early once everyone connected is ready. With no pick you get your first free spawn. **Planning is part of the run** (owner ruling): leaving now, or dropping and not coming back in time, counts as going missing (MIA), a loss: a run and a death in your stats and no GV, so nobody can look at the deal and requeue for free. Only the lobby is free to leave. A leaver still counts as a starter; if everyone but one leaves, the run starts at once and the last player wins without the win bonus. A server restart during planning voids the run for everyone instead. A dropped player keeps the seat and, if they reconnect in time, their pick. A start boon is planned for this screen (see `docs/ROGUELIKE_PLAN.md`), not built.
4. **Spawn.** Players start at the spawn they picked, spread over the five zones and all about the same walk from the coliseum (the spawn pool of section 5). The first patience timer (a flat 5:00) and each faction's Wish lock (the first 45 s) count from this moment, not from the end of the lobby.
5. **Early run.** You start on fists, so your first kill matters: a mob's weapon goes straight into an empty hand. Hunt neutral mobs for GV and weapons, loot chests, and route toward the camps whose weapon you want and the region whose weapon counters what you're seeing. Hit one mob and its whole camp comes for you; clear the camp and it heals those who fought it and drops a shared chest of three cards for 15 seconds: whoever reaches it first picks first, and clearing the camp gives no claim on it (sections 12.5 and 12.6). Cards are your only source of stats, so a fresh player hits other players weakly (the PvP factor, 10.4): early fights are slow, and farming wins fights. Holding Tab shows the whole map, your route and which camps are already cleared.
6. **Mid run.** Fights break out. Every death resets the patience timer. Fed players gain bounties and get marked on everyone's minimap.
7. **Patience runs out.** If nobody dies for the full timer, the host teleports everyone alive into the **coliseum** and locks the gates. The gates open again as soon as someone dies.
8. **Endgame.** As players die, the patience timer shortens. With few players left, fights happen often, in the open or in the coliseum.
9. **Glorious Victory.** The last one standing wins and gets the win bonus. Everyone keeps the GV they earned during the run. Run gear (weapons, cards) is gone.
10. **Results → hub.** The results screen shows kills, GV earned, bounties claimed and time survived. Then you're back in the hub.

---

## 4. The hub

| Hub feature | What it does | When |
|---|---|---|
| GV balance and titles | Shows your currency and equipped title | First playable |
| Faction picker | Choose a faction; shows its card | First playable |
| Counter wheel | Both pentagrams (factions, weapons) with your pick highlighted | First playable |
| Cosmetics shop | Spend GV on colours, trails, titles and golden weapon variants. Cosmetics only. | First playable |
| Leaderboard | Monthly GV ranking | First playable |
| Achievements | e.g. 5 wins holding the same weapon unlocks its golden variant | First playable |
| Training grounds | Try any weapon combination; spar with training dummies (no GV) | Built (Phase 12) |
| Stairs to the Arena | The physical entrance to matchmaking | Built (Phase 12) |
| Hub NPCs | Characters who never appear in the Arena | Later |
| Social | Friends, 1v1s, private matches, chat | Later |

**As built (Phase 12).** The hub is a small walkable room, drawn on the client only (no server room while you are in it). You walk with right-click, WASD or the arrow keys; stepping up to a station shows a prompt, and **E** or a click uses it: the stairs start a run, the training door starts the training grounds, four kiosks open the shop, wardrobe, achievements and leaderboard, five pedestals pick a faction, and the floor in the middle shows the counter wheel. Your avatar wears your equipped cosmetics and your faction's colour, and stands on bare fists (a run starts unarmed). The menu panel sits docked beside it and still offers everything the old menu did (callsign, GV, stats, panels, Start Run).

**Training grounds.** A private room of one, created fresh each time. It has Phase 9's practice setup next to your spawn: a plain dummy, a shield dummy, and a rack with one of each weapon. You pick the faction in the hub first. Nothing is recorded: no GV, no stats, no achievements, no timer, no results, and if you go down you are simply stood back up. Leave with the button or Esc; there is no waiting room and no one else comes in, and a room whose player stays idle for five minutes is closed. A **Console** button in the training bar opens a small practice console, nothing of which counts for a real run: set how many copies of any card you hold (1, 2, 3 or 9 of a base card, one of a conditional or an augment; a conditional needs a base card of its kind first, and a card that is not built is set but does nothing, and says so) or take it off, spawn a practice camp of any mob type (three mobs, or one for an elite type, asleep on the floor near you, so hitting one wakes the rest as in a run), drop a card chest two tiles away with three cards of your choice (or a normal camp's roll for what you hold), or clear all of it. A practice camp's death pays no GV, feed or weapon and drops no chest (clearing one still heals you, as a real one does), a chest skip pays no GV either, and Clear also ends the arrows and balls the practice mobs have in the air. The caps are 12 practice mobs at once and 6 chests, with a short pause between drops. Esc inside the console hands the keyboard back to the game, and the next Esc leaves.

**Counter wheel.** Two pentagrams, the faction cycle and the weapon loop, drawn from the same counter lists the game uses. Your picked faction and its reference weapon are highlighted, with what each beats in green and what beats it in red.
---

## 5. The arena map

The map is generated from a seed. The server and every client build the same map from the seed and the generator attempt, so the layout itself never travels over the network: the state carries only the seed, the attempt and a hash that proves both sides built the same map.

- **136 x 136 tiles** (4,352 world units a side, about twice the area of the 96 x 96 map before it: the owner wants a slower pace, with mob farming as the main growth). **Five zones** surround the coliseum, one per faction:

  | Zone | Faction | Mobs carry |
  |---|---|---|
  | Under the mountain | Fire | Axes |
  | Haunted farmland (the Cult) | Sentenced | Swords |
  | The forgotten city | Plague | Bows |
  | The frozen plains | Frost | Shields |
  | The desert | Holy / Demon Blood | Wands |

  A zone is an organic shape, grown outward from a stretch of the road around the coliseum, so every zone reaches the coliseum. The five have the same area (about 3,534 tiles each; the generator certifies them within 8 tiles of each other), and their shapes and where they lie change with every seed, as does the order of the five around the ring. There are no ridges or passes between them: one zone simply meets the next, and the client marks a border with a dashed line in each zone's colour, a different dash for each zone so colour is never the only cue. Because each zone's mobs always carry the same weapon, **the map is a shopping list for counters**. If you're Plague and keep running into shields, you go where the axes are.
- **The coliseum** sits in the centre, with 4 gates. The gates are wall tiles that close on command. Inside are spawn spots for the teleport. Its layout is the same on every map (the pillars are one of eight arrangements, picked by the seed), and a road three tiles wide runs around it.
- **No cover.** Walls are not scattered to keep sight lines short any more (owner ruling: "the 480 rule isnt needed anymore. With speed buffs and with attack animations kiting isnt fully possible."). Nothing certifies how far you can see; every wall belongs to a named feature of its zone, with a job (section 5.3), and open ground and long sightlines are allowed. The bow and the wand still reach only 7.5 and 6.9 tiles, and what stops kiting is the windup that roots every attacker.
- **Camps and territories.** Each zone holds **eight camps**, 40 on a map, each a small clearing with 3 to 5 mob rest spots (about 160 mobs a map). Two camps per zone, the two farthest from the coliseum (the second at least 16 tiles from the first), are the **elite camps**. Camps keep at least 9 tiles apart. Every camp owns a **territory**: the part of its zone that is nearer to it than to the zone's other camps by walking distance. A zone's eight territories together cover all of it, and each is one connected piece of floor. The camp stands at its territory's **pole**, its deepest point, and no part of the territory is more than 30 tiles from it. The territory is where the camp's mobs may fight (section 11). A zone's eight camps hold its four normal mob types twice over, and its two elite camps its two elites (section 11).
- **The spawn pool.** 24 to 32 candidate player starts, each tagged with its zone and in at least four zones, all about the same walk from the coliseum centre. No two starts are within 10 tiles of each other unless a wall blocks the straight line between them (and never under 5), and every start is at least 5 tiles from every camp, so nobody spawns in a rival's sights. The generator then walks every start to the coliseum with the real pathfinder and drops the extremes until the longest walk is at most 1.2 times the shortest: over seeds 0 to 1,999 the worst map reads 1.194 and the 90th percentile 1.133, and no walk crosses more than 8 tiles of ice, bog or ember. The planning step deals each player two of them (section 3). The walks are long on this map: to the coliseum centre (the walk the gate certifies and the planning screen's ETA shows) 57, 62.6 and 67 tiles at the 10th, 50th and 90th percentile, or 10.7, 11.8 and 12.7 seconds; the 96 x 96 map measured the same way reads 50 tiles and 9.4 seconds at the median.
- **Loot spots.** Weapon crates stand against a wall, 4 to 6 a zone (20 to 30 a map), each holding one weapon, and loose weapons lie on 30 to 45 open spots. Each camp also has a **reward chest tile**, the centre of its clearing, where a cleared camp's shared chest drops (section 12.5).
- **Landmarks.** The random walled ruins are gone ("Keep as landmarks", the owner's ruling). Each zone has one designed building, placed up to twice, whole or not at all: the burnt-out forge (Scorch), the guard house (Gallows), the collapsed burrow (Warren), the frozen watchtower (Rime) and the shrine (Sanctum). Each is 7 to 9 tiles a side with 2-wide doors and a crate nook inside, and each has a job (a lee from shots, a fork on a road, a place to rest). No loot rule needs one, but crates prefer their nooks.
- **Themed and shaped zones.** Every generated map is themed: each zone's interior (lava, fences, ice, bog, light and the walls of its shape, sections 5.2 and 5.3) is placed after the landmarks and the spawn pool, the pool's 3x3s and 5x5s stay clear of walls and hazards, and every map is certified with the terrain in place. The zones differ by ground and by how you move through them, not only by colour and by their mobs.

Every map is certified as it is made: the floor is one connected piece with the gates open, and with them closed the arena is sealed; every zone touches the coliseum; every wall belongs to a named feature and no wall piece is smaller than 6 tiles; the starts keep their distances and their walks are fair; the camps keep theirs. A map that fails any check is thrown away and the generator tries the next attempt of the seed, and nothing is ever relaxed to pass (section 16).

The coliseum always has pillars (its eight layouts were found for the retired sight cap and kept), so archers can't kite across the final arena, and the bow's range is 240 u anyway.

### 5.2 Zone terrain (as built, on every generated map)

Each faction zone gets its own walls and ground, one light hazard and a home-faction edge. The generator still places the camps, spawns and chests; the zone's interior is styled by `shared/src/zoneStyle/` (the landmarks are placed from the generator's landmark hook before the spawn pool, the shape from its style hook after it, and the crates, the safety nets and the records last) and drawn by `client/src/render/zoneArt/`. The map is still never synced. On the 2,000 maps swept all five themes are present on every one, with about 94 tiles of lava, 132 of ember, 218 of fence, 195 of bog, 590 of ice and 83 of light a map.

| Zone | Feel | Ground | Hazard | Home faction |
|---|---|---|---|---|
| The Scorch (Fire) | volcanic badlands | **Crater Basins:** a basalt crater round every camp with 2 to 3 breaches, one lava river (impassable, see-through) with fords on the routes, ember banks, a burnt-out forge | **Ember** burns 2% of max hp per second (true damage; it is not combat and shows no numbers; "Killed by Lava") | Fire is exempt |
| The Gallows (Sentenced) | ruined prison | **The Rows:** about nine long fence lines toward the coliseum with staggered gates, a gallows on a square, guard houses | **Fences** stop bodies and melee swings, not sight or shots | the bow shoots across; melee detours to a gate (about 0.19 s of free fire per tile) |
| The Warren (Plague) | sewer swamp | **The Barrows:** a rock barrow on every road between camps, a bog flank on one side, a bored tunnel through the biggest, collapsed burrows | **Bog** slows to 0.7x (it stacks with chill) | Plague is exempt |
| The Rime (Frost) | glacier | **The Mere:** two frozen lakes, faceted headlands on their shores, a spire island, plain lanes where a start's walk crosses, frozen watchtowers | **Ice** slides: 0.4 s to full speed, about 34 u to stop, a clicked point is reached exactly, a windup or root plants you | Frost has full grip |
| The Sanctum (Holy) | cathedral ruins | **The Hypostyle:** a grid of square 3x3 piers on a 6-tile pitch at the heart of the zone, long views only down the aisles, light bays, two shrines | **Light shafts** heal 0.6% of max hp per second out of combat (the 3 s heal lockout applies) | Holy heals twice as much |

- **The Rime has real lakes.** With no cover to clear it, ice covers about 590 tiles a map, 17.4% of the zone's floor, in two meres of roughly 295 ice tiles each (each lake is grown to 400 tiles; the lanes, headlands and spire take the rest; owner question, section 18). Ice still needs plain floor on all eight sides, and a start's walk never crosses it: the lanes where a walk meets a lake are plain ground.
- **Low ground is see-through.** A fence, lava or crevasse tile blocks bodies and melee swings, not sight, arrows or balls, so a fence line is a place to shoot across and the Gallows' whole design rests on it. A wall (a rim, a barrow, a pier) blocks everything.
- **Home faction.** A zone's own faction ignores its hazard (or is boosted on it); regional mobs are of their zone's faction, so they are exempt at home. Measured with hp-margin duels (the sim has no rolls, so wins are all-or-nothing): the edge that moves is "the home faction picks the ground" (a lava ford, a pool crossing, a fence line) and only Fire is sensitive to the time a shooter gets for free; Frost's ice and Holy's light are feel and economy edges, not duel edges. All hazard numbers are first picks (CLAUDE.md Known TODOs).
- **Nobody stands on lava, fences or crevasses.** They are the new collision class (`TILE_LOW`): bodies and melee swings stop, sight, arrows, balls and abilities pass. A click on one walks to the nearest bank.

### 5.3 Zone shapes (as built)

The owner asked for walls with intent: "The walls and placement of them feel somewhat random and arbitrary, can you give them more of an intentional feel? Frankly there are FAR too many walls that are just placed randomly. I want each zone to have a different navigation feeling." The generator now places no scatter. Every wall belongs to a named **feature** with a **job** (a pen, a crossing, a lane, a fork, a lee, a choke, cover, a rest, a landmark, a seal), a feature either stands or is rolled back (landmarks, the gallows, headlands, spires, meres and causeways whole or not at all; the Sanctum's hall pier by pier; craters, the lava river, fence rows and barrows trimmed, standing with at least 60% of their blocks), and no wall piece is under 6 tiles. The owner chose one shape of three for each zone, so a player can name a zone from the minimap.

- **The Scorch: Crater Basins.** Every camp sits in a basalt crater (radius 5 to 6.5 tiles, up to 7.5 for an elite camp) opened by two or three named breaches, each aimed at a neighbouring camp on the zone's camp graph; open ash lies between, crossed by one lava river with fords exactly where the camp routes and the starts' walks cross it. The fords and banks are ember, which Fire ignores. About 7.8 craters, 94 lava and 250 wall tiles a zone. A rim stops shots both ways, so a pen is a safe place for a ranged player to farm and a melee fighter comes in through a breach.
- **The Gallows: the Rows.** About nine fence lines run toward the coliseum, 7 to 9 tiles apart (one bow range), with 3-tile gates every 12 tiles and the gate phase alternating row to row, so a crosser stair-steps about 6 tiles sideways per row; a 3x3 wall gallows stands on a square in the middle, and guard houses give lees. You see and shoot across the whole zone and cross only at gates: a melee fighter pays at most 10 extra tiles (0.19 s of free fire a tile). About 218 fence tiles a zone, and only 53 wall tiles.
- **The Warren: the Barrows.** Every road between camps of at least 15 tiles forks round a noisy rock barrow (radius 2.6 to 4.6 tiles): go left on dry ground, right through the bog crescent on the barrow's wet flank, or straight through the 3-wide tunnel bored into the biggest ones (about four a zone, 8.4 barrows in all). Plague ignores bog, so the wet fork is its road. Collapsed burrows sit on the longest roads.
- **The Rime: the Mere.** Open drift: the camps look at each other across two frozen lakes. Run the lake (fast, exposed, slippery for everyone but Frost) or hug the shore behind faceted headlands (about four a zone); a spire island stands in about one lake in two and a frozen watchtower beside one or two of them. A start's walk never crosses ice.
- **The Sanctum: the Hypostyle.** A pillared hall of about 22 whole 3x3 piers on a 6-tile pitch (3-wide aisles) fills the heart of the zone, on its main axis; long views only down the aisles, a bow's lines cut every 6 tiles, and light in the 9 central bays, where Holy rests. Two shrines stand round it.

| Zone | Rays that reach bow range (7.5 tiles) | Engagement-range pairs a wall separates | Pairs only a fence or lava separates |
|---|---|---|---|
| The Scorch | 62.9% | 22.0% | 3.0% |
| The Gallows | 85.3% | 4.3% | 22.3% |
| The Warren | 70.8% | 11.3% | 0 |
| The Rime | 81.7% | 5.2% | 0 |
| The Sanctum | 70.8% | 13.6% | 0 |

(Means over seeds 0 to 1,999: 24 rays from every floor tile of a zone with even coordinates, and 2,500 random pairs of floor tiles 3 to 7.5 tiles apart. On the R2 maps 11% of rays reached bow range and about 61% of such pairs had a wall between them.)

**Owner rulings.** Zone-spanning counts scale with the area, sizes tied to a fighter stay fixed. The Rows were approved on one condition, that Fire still beats Sentenced at a fence; the zone duel harness (`npm run harness:zones -w @raid/server`) measures it: Fire's axe beats Sentenced's bow in 96 of 96 setups at a fence row (96 of 96 in the open), with an hp margin of +50 points against +63, a detour of 0.50 s on average, and 13% of Sentenced's arrows crossing a fence. The headroom is thin (section 18).

**What open ground does to a fight** (2,400 duels in the real zones' obstructed pairs, 3,600 for the ranged shift; report only, nothing retuned): the designed winner of a faction edge wins 90% in the zones and 90% in the open, no edge flips, and no zone costs a winner more than 15 points; a melee fighter reaches its first hit in 1.02 s instead of 0.82 s (+24%), the shooter's free damage stays about 3% of its hp, and melee still wins 66% of those duels against 67%. The one visible cost is the fenced Gallows, Fire over Plague, 91% against 100%.


---

## 6. Pressure: patience timer, coliseum, sudden death

There is **no shrinking zone**. Pressure comes from the Arena's host losing patience.

| Rule | Detail |
|---|---|
| Patience timer | Visible to all. Resets every time a **player** dies (mobs don't count). |
| Timer length scales with players alive | 5:00 with 8 alive, shrinking linearly to 2:00 at 3 or fewer. Each reset uses the current count. |
| The first timer | A flat 5:00 whatever the player count (`FIRST_PATIENCE_SECONDS`), armed when planning ends, so planning does not eat into it. Without it a lobby of 3 or fewer would start on 2:00. Every timer after a death scales as above. |
| Expiry | Everyone alive is teleported to the coliseum and the gates lock. A 30-second warning precedes it. Every camp chest still up is gone with it. |
| Teleport safety | 1.5 s of immunity after arriving (no damage taken or dealt); arrows and balls in flight are cleared. |
| Gates reopen | The moment any player dies. The timer resets and players can roam again. |
| Sudden death | After 60 s locked in with no kill, everyone in the coliseum takes damage that ramps every second until someone falls. |
| Simultaneous deaths | If the last two die in the same tick, the one with the higher HP fraction at the start of that tick wins; an exact tie is a draw. |
| Disconnects | A disconnected player who doesn't return within the grace period counts as a death (it resets the timer). During the grace period they count as alive. |

---

## 7. Winning, dying, and what persists

| Event | What happens |
|---|---|
| You die | Your run ends. Your weapons and cards are gone. You keep the GV you earned this run. |
| You win | +50 GV win bonus on top of what you earned. |
| Solo run (fewer than 2 humans) | No win bonus. |
| Persists between runs | GV, cosmetics owned and equipped, titles, achievements, stats (wins, kills, per-weapon and per-faction records), monthly GV total |
| Never persists | Weapons, cards, feed score, bounty |

---

## 8. Factions

**Sentenced redesign (2026-10-28):** [SENTENCED_REDESIGN.md](SENTENCED_REDESIGN.md) is the current contract for the tiered, per-hit mark, camp-wide marking, execute denial, Trial and five added cards (80 total). The older matchup measurements below describe the pre-redesign sheet; current evidence is in [../testing/TUNING_SENTENCED.md](../testing/TUNING_SENTENCED.md).

Five factions form a closed loop: **each beats exactly two and loses to exactly two.** The numbers come from the owner's design engine (`testing/engine.py`, `testing/classes.py`). The game's TypeScript copy is tested against it so they can't drift apart.

**The sheet was compressed by the balance pass.** The first sheet was a clean five-cycle in which the favourite won every duel with 27-77% of its hp left: a favourite that always wins is not a matchup, it is a wall. The numbers were moved, by a search over the whole sheet checked in the real sim, so that every edge leaves its winner **10-35% hp** and wins **60-70% of even duels once two players' execution noise is in** (each fighter's damage times `exp(0.45 Z)`; the favourite wins `Phi(ln r / 0.636)` of the time, r being the multiplier the underdog would need). A counter is now a strong tilt that play can overturn, not a wall. The laws (8.1) do not change; the signature damage types do (8.3). Method, tables and residuals: `testing/TUNING_BALANCE.md`.

### 8.1 The rulebook (identical for every fight)
1. **Attack.** Each second a fighter deals `rate × hit` raw damage plus its signature bonus.
2. **Three damage shares.** Every hit is split into physical, magic and true damage; the shares belong to the attacker. A signature's own damage has its own type, whatever the faction's shares are (8.3).
3. **Defense.** Armor cuts the physical share and shield (magic resist) cuts the magic share; true damage ignores both. Reduction is `1 / (1 + stat/100)`: 100 means half damage, 300 means a quarter.
4. **Rate effects.** One aura exists (Frost's slow). It multiplies an opponent's attack rate. It slows `rate × hit` only, not flat bonuses.
5. **Health effects.** Mechanics may read health fractions (the target's for execute, your own for lifesteal), never an opponent's identity.
6. **Progress effects.** A mechanic may read landed hits, weapon swaps and time in the fight.

No rule mentions a faction by name. Every counter falls out of the numbers.

### 8.2 Stat sheet (the compressed sheet)

| Faction | Role | HP | Attack rate | Hit | Base DPS | Damage mix (phys / magic / true) | Armor | Shield (magic resist) |
|---|---|---|---|---|---|---|---|---|
| Fire | Glass-cannon duelist | 835 | 0.60/s | 100 | 60 | 0 / 100 / 0 | 0 | 45 |
| Sentenced | Patient executioner | 880 | 0.95/s | 34.840203 | 33.1 | 40 / 60 / 0 | 135 | 120 |
| Plague | Attrition swarm | 1375 | 1.85/s | 20 | 37 | 80 / 20 / 0 | 190 | 0 |
| Frost | Control bruiser | 1200 | 0.45/s | 170 | 76.5 | 90 / 10 / 0 | 20 | 190 |
| Holy (Demon Blood) | Sustain juggernaut | 1400 | 0.95/s | 96 | 91 | 100 / 0 / 0 | 0 | 250 |

Attack rate is the faction's base. Each weapon boosts it by a percentage (section 10.2). What moved from the first sheet (hp, hit, armor, shield, signature numbers; rates and damage shares did not): Fire 500 hp / 150 hit / 125 shield to 835 / 100 / 45; Sentenced 700 / 5 / 100 armor / 50 shield to 800 / 10 / 125 / 210; Plague 1000 hp / 200 armor to 1375 / 190; Frost 1750 hp / 90 hit / 100 armor / 100 shield to 1200 / 175 / 20 / 190; Holy 1450 hp / 65 hit to 1400 / 96. Fire is no longer the lowest-hp faction by a wide margin and its damage leans on burn and backlash; Frost is a hard-hitting bruiser with the chill (owner ruling: accepted).

### 8.3 Signatures

| Faction | Signature | What it does | Damage type | How it feels |
|---|---|---|---|---|
| Fire | **Dragonslayer** | 18 burn per second, plus **145 backlash for each attack the engaged enemy makes at its base rate** (per real swing 58 to 104 depending on its weapon, section 10.3) | Burn: magic, over time. Backlash: physical, returned | Punishes fast attackers. Against Plague's flurry it is over in seconds. |
| Sentenced | **Marked** | Landed hits pulse a share of max HP as true damage and promote four tiers: pulse, attack-speed tax, output suppression, then pulse amplification and execute denial. Weapon swaps promote the mark. Camps share a mark; see the redesign contract for group scaling. | True, per hit; no AP-on-DoT rider | Pressure grows as hits land; switching between camp members preserves progress. |
| Plague | **Rat King** | 43 disease per second, plus an execute adding up to 207 per second as the target falls from 50% to 0 HP (415 per unit of hp below half). Disease and execute ticks cannot crit; auto attacks can. Cruel Wounds converts its expected DoT crit bonus into steady DoT damage. | Magic, over time, with the execute | A slow squeeze that collapses into a kill |
| Frost | **Living Wall of Ice** | Anyone engaged with Frost has their **attack rate cut to 48%** (slow 0.52). Within 100 u, movement starts 30% slower for 1 s, then thaws linearly to full speed over 3 s; repeated attacks and swapping Frost sources do not refresh it. Four seconds clear of every Frost movement chill resets its strength. | The slow | The fight slows down and Frost sets the pace |
| Holy | **Radiant** | Heals a share of damage dealt equal to `11% + 85% × missing HP`, capped at 75% (reached at about 75% missing HP) | Heal | Hardest to finish when nearly dead |

The first sheet's signatures were all magic (the mark, the burn, the backlash) or an 80/20 mix (the disease); the owner asked for the types in the table, which is what the sim deals (`SIGNATURE_SHARES`): the mark now ignores Holy's shield, Fire's backlash is cut by armor and not by shield, and Plague's disease is all magic. Cards add to them: Ability Power adds `0.6 × AP` magic damage per second to every running burn and disease (10.2).

### 8.4 Who beats whom, and why

The engine's fight (design sheet, k = 1; the game fights twice as fast) and what the real sim measures with both fighters on fists, noise on (`testing/TUNING_BALANCE.md` 2.1 and 4):

| Winner | Loser | Deciding factor | Fight (engine) | Winner HP left (engine) | Real sim on fists: HP left / favourite's win % |
|---|---|---|---|---|---|
| Fire | Sentenced | Backlash (physical: 58 of Fire's 83 a second get through Sentenced's 125 armor) ends the fight before the mark builds; Sentenced's 210 shield cuts Fire's hits and burn to 32% | 9.6 s | 28% | 20% / 64% |
| Fire | Plague | Plague's 1.85 swings a second feed the backlash (268 raw a second, 92 through its 190 armor); Plague's own hits get 35 a second through Fire's shield | 8.1 s | 34% | 31% / 64% |
| Sentenced | Plague | The mark lands in full (true, 72 a second); Sentenced's armor cuts Plague's physical damage to 42% | 18.8 s | 20% | 25% / 60% |
| Sentenced | Frost | The flat mark ignores Frost's slow; armor cuts Frost's hits to 43% | 18.3 s | 22% | 25% / 68% |
| Plague | Frost | Disease and execute are flat, so the slow barely matters; the execute decides it | 32.2 s | 24% | 25% / 68% |
| Plague | Holy | 86% of Plague's damage gets through Holy's zero armor | 35.0 s | 20% | 20% / 61% |
| Frost | Holy | The slow cuts Holy's swings, and with them its healing, from 0.95 to 0.46 a second | 25.8 s | 22% | 18% / 62% |
| Frost | Fire | Frost's 0.45 swings a second feed the backlash only 54 a second through its 20 armor, and the slow cuts Fire to 0.29 swings a second | 10.9 s | 36% (the widest edge) | 34% / 76% (underdog 24%) |
| Holy | Fire | Holy's 250 shield cuts Fire's hits and burn to 29%; its hp and lifesteal outlast the backlash (138 a second, physical, on Holy's zero armor) | 9.2 s | 22% | 20% / 64% |
| Holy | Sentenced | Holy's 1,400 hp against a mark capped at 72 a second: its hits (40 a second through Sentenced's armor) need 19.7 s, and the shield no longer cuts the mark | 19.7 s | 27% | 25% / 66% |

**The main axis is damage type against defense type.** Magic damage (Fire, Sentenced's weapon hits, Plague's disease) crushes the shieldless (Plague) and bounces off the heavily shielded (Holy, Sentenced, Frost). Physical damage (Plague, Frost, Holy, Fire's backlash) punishes zero armor. On top of that sit rate against flat damage (Frost's slow only hurts rate-based attackers), burst against ramp (Fire ends fights before the mark or execute come online) and HP pool (Holy and Frost win long fights). The closest engine edge is now Sentenced over Plague (19% left) and the widest Frost over Fire (36%).

### 8.5 How much of a hit survives (attacker → defender)

By the attacker's own weapon-hit shares:

| attacker \ defender | Fire | Sentenced | Plague | Frost | Holy |
|---|---|---|---|---|---|
| **Fire** | – | 0.32 | 1.00 | 0.34 | 0.29 |
| **Sentenced** | 0.69 | – | 1.00 | 0.34 | 0.29 |
| **Plague** | 0.94 | 0.42 | – | 0.74 | 0.86 |
| **Frost** | 0.97 | 0.43 | 0.41 | – | 0.93 |
| **Holy** | 1.00 | 0.44 | 0.34 | 0.83 | – |

A signature part uses its own type: burn and disease the shield column, the backlash the armor column, the mark neither.

### 8.6 Identity test: every signature must matter
Remove a signature and the class must visibly lose: a main signature has to flip at least one required win and move a margin by 20 points or more, a sub-mechanic has to flip one or move a margin by 15 or more.

| Faction | Removed | Wins lost | Largest margin swing |
|---|---|---|---|
| Fire | Burn and backlash | vs Sentenced, vs Plague | 97 points |
| Fire | Backlash only | vs Sentenced, vs Plague | 88 |
| Sentenced | The mark | vs Plague, vs Frost | 119 |
| Sentenced | The ramp (mark full from t = 0) | none | 17.7 |
| Plague | Execute | vs Frost, vs Holy | 31 |
| Plague | Flat disease | vs Frost, vs Holy | 78 |
| Frost | The slow | vs Holy | 68 |
| Holy | Lifesteal | vs Fire | 26 |
| Holy | Missing-HP scaling | none | 20.2 |

### 8.7 Design notes on the factions
- **Fire's burn (18/s) is still the small part.** Backlash does the work: 58 to 92 a second against Sentenced and Plague against 6 to 18 for burn. Burn is the one signature Ability Power reaches cheaply (it adds `0.6 × AP` to it), so a Fire that wants its burn to matter can build for it.
- **Frost over Fire is the widest edge** (36% hp left in the engine, 34% in the real sim on fists, the favourite winning 76% under noise: the underdog's 24% is the floor the pass held; on the bow and wand sets it reads 79 / 21, three points under: open question N3, section 18).
- **Holy's lifesteal** is 11% + 85% of missing hp up to 75% (the first sheet's 25% + 125% up to 100%). A lifesteal above 100% lets a losing Holy heal more than it takes and stalls Holy against Holy; with cards the whole lifesteal share (Holy's own, Leech and Siphon) is held to 85% (G5). It heals from the whole hit, even on a killing blow and from hits on a training dummy, which refills; the 20 Hz model counts it the same. Removing it flips Holy over Fire. `testing/TUNING_10.md` has the older lifesteal tries.
- **Holy over Sentenced and Plague over Holy changed character** with the typed signatures: the mark is true damage, so Holy's 250 shield does not cut it (the first sheet's "the shield cuts the mark to 29%" is gone), and Plague's disease is all magic, so Holy's shield cuts it (owner question Q5).
- **Fights are long in places** (Plague over Holy is 35 s at k = 1 and the Frost mirror 40 s; the real sim's minute-0 Frost mirror with fists lasts 44 s). Duels are sped up for the arena by the duel pace (10.2) and by cards (10.4).
- **Robustness.** The engine checks pass with every stat randomly jittered by ±3% every time and by ±5% in at least 28 of 30 draws (±10% is reported only: the compressed edges sit inside a 10% jitter by definition), at any global power level, and with names shuffled (proving no matchup is hard-coded).
- **Reference weapons.** A run starts on fists; each faction's signature weapon is now only the reference weapon the harness, the benches and the oracle fight with (10.1).

### 8.8 Wishes
Each faction has one **Wish**: an ability on `D` for the moment the weapons do not cover (stopping a kiter, leaving a lost fight, turning a duel). A Wish is **flat**: no card, relic or cooldown reduction changes it (two cards touch its cooldown, G13 in section 12.7), and it reads neither the feed nor your cards. Numbers are in `shared/src/abilities.ts` and every one of them is a best guess (section 18).

**Rules (all five)**
- **Locked, then 300 s.** A Wish is locked for the first 45 s of a run (counted from the moment the run starts, after the planning step), then it is ready. A cast spends the 300 s cooldown at once, so a run sees a Wish once and at most twice. In the practice room it is ready at once and cools down in 5 s.
- **Everyone can see whether it is up.** The ready time is public: every fighter's name carries a small icon of its Wish, coloured when ready and grey while locked or cooling down. Your own slot sits at the right end of the weapon bar (icon, key, a sweep and the time left, a cast bar, and a short line saying why a press did nothing: "Ready in 4:12", "Stunned", "No target", "Out of range", "No line of sight", "Can't blink there").
- **A refusal is free; a begun cast is not.** The server refuses a cast, with no cooldown and no effect, unless the run is active, you stand, the coliseum teleport is not within the last 0.3 s (a cast you aimed at the old world would land from the new spot toward a stale cursor), you are not stunned or silenced (a root does not stop a Wish), you are not already casting, the Wish is ready and its target is valid. Once a cast is accepted its cooldown is spent. If it then fails when it lands (its target is gone, hidden, immune, walking home, farther than range plus 32 u of slack for lag, or behind a wall) or is interrupted (a stun or a silence on the caster, or the caster goes down or leaves), the cooldown stays spent: a fizzle is the enemy's reward. The one exception is the coliseum teleport: a cast it cancels is refunded, because the arena's timer is nobody's outplay.
- **A cast time roots, and only crowd control breaks it.** A Wish with a cast time (Freeze 0.25 s, Swarm 0.25 s, Trial 0.35 s) roots its caster until it lands and shows a telegraph to everyone. Starting it cancels the attack the caster's lock was winding up (the attack's cooldown is refunded, as for any order), and no weapon attack starts while it casts. Only a stun or a silence interrupts it: a sword stagger never wastes a 300 s ability. The target lock survives a cast (Swarm and Blaze Step are the exceptions, below).
- **Targets.** Freeze and Trial take the enemy nearest the cursor within 64 u, as a left-click does, and can also be cast on a regional mob. Blaze Step takes the cursor's ground point. Swarm and Last Stand take nothing.
- **Casts land together.** Every cast due in a tick lands in the same pass, each judged against the state at the start of it, so who pressed first never decides an outcome.

| Faction | Wish | Cast | Reach | What it does |
|---|---|---|---|---|
| Frost | **Freeze** | 0.25 s | 450 u, line of sight | Stuns the target for 1.25 s |
| Plague | **Swarm** | 0.25 s | self | 8 s hidden and untargetable; a cloud of radius 72 u marks the place |
| Sentenced | **Trial** | 0.35 s | 400 u, line of sight | A ring of radius 300 u on the target for 5 s: it deals ×0.8, takes ×1.2 from you, and is stunned 1 s if it leaves |
| Fire | **Blaze Step** | none | cursor, 64 to 300 u | Blinks you through walls; a 2.5 s trail burns others for 30 true damage a second, lingering 2 s |
| Holy | **Last Stand** | none | self | 5 s with a floor of 1 hp and +30% walking speed; 30% of the damage taken is healed at the end |

**Freeze.** The target cannot walk, start an attack, swap, pick up or cast for 1.25 s, its facing is frozen (a shield still blocks, but only the way it faced: flank it), and the attack it was winding up is cancelled, a bow's draw included, with its cooldown spent. Orders it gives meanwhile are kept and carried out afterwards. It takes full damage. Freeze is not a projectile: it lands wherever the target stands, so the answers are to break line of sight or leave 482 u in the 0.25 s, to stun, silence or kill the caster in that window (a stun is rare: Freeze's and Trial's exit stun are the only ones), or to be immune. A stunned mob does not think. Frost is the control bruiser (its `ai` tags are control, peel and engage): Freeze is its answer to a kiter, a runner and a charger.

**Swarm.** After the cast the fighter is **hidden** for 8 s. Nobody can lock it or aim an ability at it (a lock on it drops in the same tick, and a locked swing no longer follows it), mobs do not pick it (they keep its threat, and with no one else they give up and walk home), and other clients do not draw it at all (its owner sees it faint). A cloud of radius 72 u follows it, drawn for everyone, so its rough place is public. Casting it drops your lock but not your walk, so you do not keep swinging out of it and a walk you had started goes on after the quarter-second cast (a best guess, W9). Its own attack or cast reveals it, so it can be locked again, from the tick after the attack starts until 0.5 s after the swing lands or the shot leaves; to ambush, click your target again once it is up. Being hit never reveals it. A hiding Plague that fights is therefore a visible Plague: Swarm is an escape and a reposition, not a way to attack for free (a bow with a 0.28 s interval keeps it revealed all the time). What still reaches it: arrows and balls already flying, a swing already winding up along its aim, areas (a Blaze Step trail), signature damage already running (its own signatures work from it too), and the coliseum teleport, which ends it. Playing against it: you cannot lock it and it cannot fight without showing itself, so use the 8 s for loot, a mob or a third party.

**Trial.** After the cast a ring of radius 300 u is centred where the target stands, for 5 s. While the target is inside it, everything the target deals (weapons, signatures, other Wishes, against anyone) is ×0.8 and everything **you** deal to it (the same) is ×1.2; damage from others to it is unchanged, and the arena's sudden-death burn is exempt. The multipliers are relative, so a fed caster gains more from the 1.2 (section 18). If the target walks or blinks out of the ring the ring ends and the target is stunned for 1 s by you. The ring also ends, with no stun, when the target goes down or walks home (a mob) or when you go down or leave. Leaving is a trade, not an escape: the target is stopped for 1 s at the edge, and a chaser uses that second to close. Playing against it: break line of sight or leave 432 u in the 0.35 s, then fight inside the ring on worse terms, or pay the 1 s for leaving.

**Blaze Step.** No cast time: the blink happens in the tick the press is applied. It lands on the cursor's point if that is within 300 u, else 300 u along that line, or at the farthest valid point short of it, never nearer than 64 u (a nearer cursor still blinks 64 u; a cursor on top of you has no direction and is refused). A point is valid if a body fits there (not in rock, not off the map), it is on the same stretch of floor as you (no sealed pockets), the straight line never crosses the coliseum's outer wall except through an open gate, and with the gates locked it is on the same side of the coliseum as you. So it crosses ordinary walls and never changes who is inside the coliseum. If there is no valid point the press is refused for free. It is an order of its own, like a move: it cancels your windup and drops your lock and your walk (other fighters' locks on you stay and path to the new place: a chaser that cannot see you goes after you, it is not dropped by the line-of-sight grace, and only the lock's range ends it). The trail is a band 40 u wide from where you started to where you landed. For 2.5 s anyone but you who stands on it (a mob too) burns for 30 true damage a second (armor and shield do not touch it), and the burn lingers 2 s after the last contact: about 60 for a crossing, more for standing in it. A chaser's path does not avoid it. The trail outlives its caster.

**Last Stand.** No cast time. For 5 s the fighter cannot fall below 1 hp and walks 30% faster (it adds 0.3 × 170 u/s on top of whatever the speed buffs give: it does not multiply them). A hit on it while it stands at the floor still lands: it staggers, shows its number and counts like any hit, though hp stays at 1. Every point of hp loss that reaches it in those 5 s is counted: after armor, shield and the barrier, **including the overkill the floor prevented**, and sudden death's burn included. At the end, 30% of that is healed back, through the usual heal rule without the 3 s out-of-combat lockout (an anti-heal still cuts it), up to max hp. The coliseum teleport ends it early and still pays; death, leaving and the end of the run pay nothing. It is a loan: do not burst a Holy in it, wait for it to end.

**Telegraphs.** What everyone sees:

| Wish | Before it lands | After |
|---|---|---|
| Freeze | A 0.25 s ice beam from the caster to the target | An ice burst, stars over the stunned fighter |
| Swarm | A 0.25 s gathering swarm around the caster | The cloud, and the fighter gone from view |
| Trial | A 0.35 s ring growing to 300 u | A dashed purple ring with a time sweep, chains on the target |
| Blaze Step | **None** | A flare and embers at both ends, an orange band for 2.5 s |
| Last Stand | **None** | A gold burst, a gold rim and speed streaks for 5 s |

Blaze Step and Last Stand are instant on purpose: a blink with a pre-cast is no escape, and a survival button with a delay loses to burst. Their only tell comes after the cast. Whether the enemy deserves a warning is an owner question (section 18).

### 8.9 Statuses and abilities
For designers. The Wishes sit on two frameworks that the later active skills, relics and on-hit effects reuse.

**Statuses.** A status is a timed effect on a player or a mob. One runtime applies all of them, driven by one table (`STATUS_RULES` in `shared/src/status.ts`); a cap, a maximum time or a stacking rule lives there and nowhere else. The caps below are best guesses.

| Status | What it does | Max time | Combines | Cleanse | Used by |
|---|---|---|---|---|---|
| stun | No walking, no attack or cast start, no swap or pickup; facing frozen; the weapon windup in progress is cancelled | 3 s | any | hard | Freeze, Trial's exit |
| root | No walking | 3 s | any | hard | nothing yet |
| silence | No casting | 3 s | any | hard | nothing yet |
| slowMove | Walks slower by its value | 5 s | sum, cap 0.6 | soft | Pocket Sand |
| slowAttack | Attacks slower by its value (it multiplies the attack-speed stat mirror) | 5 s | sum, cap 0.5 | soft | nothing yet |
| antiHeal | Every heal, lifesteal included, is cut by its value | 6 s | sum, cap 0.6 | soft | nothing yet |
| dot | Its value in raw damage a second through the damage ledger (all true by default) | 10 s | sum | soft | Blaze Step's burn, Hemorrhage, Festering Arcana |
| invulnerable | No damage (it is the teleport's immunity field); players only | 3 s | any | never | nothing yet |
| untargetable | Cannot be locked or picked by an ability | 10 s | any | never | nothing yet |
| hidden | Untargetable and not drawn for others unless revealed; players only | 10 s | any | never | Swarm |
| zoned | Deals and takes by the zone's multipliers | 6 s | product | never | Trial |
| deathFloor | The hp floor and its heal-back; players only | 6 s | any | never | Last Stand |
| haste | Adds its value × the base walking speed | 8 s | max, cap 0.5 | never | Last Stand |
| shred | Takes its value in armor points off the victim (never below 0 armor in all); no effect bit | 3 s | sum, cap 6 | soft | the axe's shred |

- **Stacking.** An instance is one (kind, source fighter, ability or tag). Applying it again extends it to the later end (never past the kind's maximum from now) and keeps the larger value, or adds to it when the source stacks per hit (up to a cap). Instances from different sources combine by the kind's rule: `any` is on or off, `sum` and `max` stop at the cap, `product` multiplies.
- **Cleanse.** A cleanse removes a class: `soft` (slows, anti-heal, damage over time) or `hard` (stuns, roots and silences too). `never` (invulnerability, untargetability, hiding, zones, the death floor, haste) cannot be cleansed. Nothing cleanses yet.
- **Statuses hold still while damage lands.** A status applied, removed or cleansed in the middle of a tick's damage pass waits until the pass ends, still in that tick. Every hit of the tick therefore sees the same statuses, and processing order never decides anything. An on-hit status counts from the next tick's damage.
- **Crowd control.** A stun stops walking, starting an attack, swapping, picking up and casting, freezes facing and cancels the windup in progress (a bow draw too, with its cooldown spent). A root stops walking only; a silence stops casting only. A player's `move`, `stop` and `target` orders still count while stunned or rooted: they are kept and carried out afterwards. A stunned mob drops its inputs and its AI does not think. A shield still blocks while its holder is stunned (best guess, section 18). Stagger and stun are independent (a stun does not start stagger immunity). Frost's chill stays a faction signature, not a status; a `slowMove` status or the chill both make a fighter "slowed".
- **Areas.** Three kinds: a zone (Trial), a cloud (Swarm) and a trail (Blaze Step). An area is in the room's state from the moment it starts and is removed when it ends; the server never updates it, and a cloud follows its owner as the clients draw it. Zones and clouds end with their owner, and a trail outlives its caster, as an arrow outlives its shooter.
- **Forced displacement.** A blink (and later pulls and knockbacks) moves a fighter at once through one call that also resets its position history, plans again any walk it had, and bumps a counter. Other clients draw that as a jump instead of a slide, and the local player's own prediction shifts by the jump without snapping.

**The cast pipeline.** An ability is a definition (`AbilityDef`) with ranks. A cast goes:
1. **Input.** `cast` carries the slot (`wish`, later `q` and `e`), the cursor's ground point, an optional target, a render time and an optional order number. A refused cast changes nothing, but a cast that carries an order number is still acknowledged so the player's prediction stops waiting.
2. **Validation**, in a fixed order: the slot holds an ability, the run is active, the caster stands, the coliseum teleport was not within the last 0.3 s, no status the ability lists as blocking is on it (Wishes: stun, silence), it is not already casting, the slot is ready, then the target (a unit: within range plus 32 u, standing, hostile, not hidden, untargetable, immune or walking home, in line of sight; a blink: a valid landing exists).
3. **Commit.** The cooldown is spent through one funnel (a flat ability ignores reduction; the practice room gives Wishes 5 s). A cast with a cast time roots the caster and starts the telegraph; one with none lands in the same tick. The ability keeps its own pending-cast record outside the weapon's, so it is never mistaken for an attack.
4. **Landing.** All casts due in a tick land together: each is checked again against the state at the start of the phase (a failure is a fizzle: cooldown spent, a `castEnd`), then every survivor's effects on its caster apply, then every survivor's effects on its target, each in the tick's secret order.
5. **Effects** are a closed list of verbs: apply a status, cleanse, set a death floor, put a zone on the target, put a cloud on the caster, blink, leave a trail. Later phases append more (damage, heal, barrier, projectile, area, cooldown).

- **Ability damage** is named. It is recorded in the ledger under the caster with no weapon, so kill credit, the bounty, mob threat and the kill-credit window work as for a weapon. It is never a signature contact (it does not start or keep an engagement) but it feeds lifesteal and the heal lockout's combat clock, as signature damage does. Damage over time from an ability is reported in 0.5 s chunks and causes no damage flash.
- **Flat power.** No ability number reads cards, AD or AP (the damage, vs and scale rows of the cards never multiply an ability's damage or its damage-over-time ticks: the ledger skips those entries before it asks a `vs` row anything; owner ruling "Keep Wishes flat"; only the two cards of G13 touch a Wish's cooldown). Haste adds to the base speed and trail damage is true damage. Trial's ±20% is the one relative number, by the owner's rule.
- **Lifecycle.**

| Event | Pending cast | Statuses on it | Areas | Last Stand heal |
|---|---|---|---|---|
| The fighter goes down or leaves | cancelled, cooldown spent | removed | its zones and clouds are removed (a trail stays); a zone it is the subject of ends with no stun | none |
| Coliseum teleport | cancelled, **refunded** | all removed | all removed | paid |
| The run ends | cancelled | removed | removed | none |
| A dropped connection | unchanged | unchanged | unchanged | n/a |

**What a designer can change in the data.**
- **Numbers.** The Wish numbers (the constants at the top of `abilities.ts`), `WISH_COOLDOWN_SECONDS`, `WISH_LOCK_SECONDS`, `TRAINING_WISH_COOLDOWN_SECONDS` and `CAST_RANGE_SLACK` in `constants.ts`, and every cap and maximum time in `STATUS_RULES`. Retune a Wish against the kiting check and the harness (`testing/WISHES.md`).
- **Definitions.** An `AbilityDef` lists its ranks (cooldown, cast time, targeting rule: self, direction, point or unit; shape; effects), whether it is an order of its own (it cancels your windup, lock and walk), what interrupts and what blocks it, its AI intent tags (escape, engage, peel, control, sustain, burst, zone, buff: the bots cast by tag, never by id) and its art. A new ability is its id appended at the end of `ABILITY_IDS` (wire order), a definition in `ABILITIES` and, for a Wish, a line in `WISHES`.
- **Verbs.** The effect list is closed. A new verb is code in `sim/abilities.ts` (the compiler refuses until it is handled) and, if it draws, in the client art.

---

## 9. Weapons

Five weapons form a second closed loop; again **each beats two and loses to two.** They are hard counters, not impossible matchups. You carry **two**, so what you hold, and what you go and get, matters. Every run starts on **fists**, which are outside the loop (9.6).

### 9.1 How each weapon works

| | Fists | Sword | Bow | Wand | Shield | Axe |
|---|---|---|---|---|---|---|
| Shape | Short punch (120° swing), reach 40 | Quarter-circle (90°) swing, reach 64 | Arrow, fast (900 u/s), range 240 | Magic ball, medium speed (380 u/s), range 220 | Barrier always raised toward the cursor, or toward the locked enemy (±60° front); bashes like a swinging door (120°, reach 44) | Half-circle (180°) swing, reach 60 |
| Input | Lock an enemy: it attacks for you | Lock an enemy: it attacks for you | Lock an enemy: a fixed full draw, no hold, no partial draw | Lock an enemy | The shield follows the cursor, or the locked enemy; the lock bashes | Lock an enemy |
| When damage lands | 0.1 s into the swing | 0.1 s into the swing | The arrow leaves when the draw ends: 0.6 s after the attack starts (at most 92% of the interval) | Ball leaves 0.4 s after the attack starts (at most 80% of the interval) | 0.1 s into the bash | 0.25 s into the swing (at most 25% of the interval) |
| Attack speed boost | +150% | +115% | +95% | +65% | +60% | +40% |
| Rooted | For the 0.1 s swing | For the 0.1 s swing | For the draw | For the cast | For the 0.1 s bash | For 0.5 s from the attack's start (at most 50% of the interval) |
| Damage multiplier | 0.60 | 0.75 | 0.8 | 0.8 | 0.75 | 0.77 |
| Scaling (what a point of a stat adds per second at base speed) | 0.6 AD + 0.6 AP | 1.0 AD | 1.0 AD | 1.0 AP + 0.3 AD | 0.4 per bonus armor or magic resist + 0.3 AP | 1.0 AD + 0.02 per bonus max hp |
| Special | What an empty hand fights with (not an item). **Pierces shields**, never staggers, meets no ball. On-hit effects land 1.2× as hard. | A hit that isn't blocked **staggers**: cancels the target's windup or cast (a bow draw carries on). A staggered target can't be staggered again for 1.1 s. On-hit effects land 1.5× as hard. | Always full damage: there are no partial draws. A stagger does not cancel the draw. | The ball **deletes arrows** within 28 units (and keeps 60% of its damage after it does), **pierces shields** and **splashes** 30% of its damage onto other enemies within 48 u of the target | Blocks frontal hits **in part** (a sword hit or bash loses 7%, the rest lands and never staggers), **ripostes** half of the blocked part, **reflects arrows** (the holder owns them, carrying 15% of the damage) | **Pierces shields**, **destroys magic balls** its swing meets, and every hit **shreds** 3 armor for 3 s (up to 6) |

The interval is the time between attacks (section 10.2). Every attack is a **windup** (Controls rework, section 9.5): the fighter is rooted from the attack's start until the swing lands or the arrow or ball leaves, and walks freely at full speed until the next one. A windup is its design time or the share of the interval shown, whichever is shorter, so a faster cadence shortens it and no fighter is rooted for the whole cycle (the bow, at 92%, comes closest).

Ranged weapons can kite, so four things hold them back (the numbers are the 9.1 tuning and the controls rework, see sections 9.4 and 9.5):
- **Short range.** Bow 240 u, wand 220 u (about 7 tiles each). A melee fighter charging a standing shooter takes (range - reach) / move speed of free fire: 1.06 s from the bow, 0.94 s from the wand. A shooter that walks away between its shots gives a little more (Plague's bow 1.16 s); the kiting check (9.6) asks that a perfect orb-walking shooter never wins more than 65% of its duels against the melee faction that beats it.
- **Damage no higher than the melee weapons it must beat:** bow 0.8, wand 0.8 (the sword 0.75, the axe 0.77, the shield 0.75). The bow wins the sword and the axe on its opening alone, so it cannot also out-trade them; the axe sits a little further under the bow's number because a zigzag approach takes the opening away and leaves the bow its close trade.
- **Drawing and casting root you.** The bow's draw (0.92 of its interval, at most 0.6 s) and the wand's cast (0.8 of its interval, at most 0.4 s) are windups like any other, and a chaser closes the gap only while the shooter is rooted. This replaces the 9.1 rule that drawing, casting and recovering moved you at 10%: nothing slows a walk any more, so the windups have to be long enough that a shooter walking away between shots still cannot out-kite a melee winner (section 9.5).
- A hit by a sword neither restarts nor cancels a bow draw.

### 9.2 The weapon loop

| Weapon | Beats | Why | Loses to | Why |
|---|---|---|---|---|
| **Sword** | Axe | Faster swings (+115% against +40%) and stagger: it weaves in more attacks | Bow | Range |
| | Wand | Its swing halves the damage of balls it meets | Shield | Part of the hit is blocked and riposted, and a block never staggers |
| **Bow** | Sword | Range | Shield | Arrows reflected back |
| | Axe | Huge range gap; the axe roots to swing | Wand | Balls delete arrows |
| **Wand** | Bow | Balls delete arrows | Sword | Swings cut ball damage |
| | Shield | Balls pierce shields | Axe | Swings destroy balls |
| **Shield** | Sword | Blocks and ripostes | Wand | Balls pierce it |
| | Bow | Reflects arrows | Axe | Axe pierces it |
| **Axe** | Wand | Destroys balls | Bow | Range |
| | Shield | Pierces it | Sword | Out-swung |

Every edge was checked in the real sim (sections 9.4 and 9.6): the designed winner wins the pooled duels over all 25 faction pairs at 51-71% at minute 0 and 55-77% with the minute-5 kit (noise off, no edge under 50%), and in the policy harness nine of the ten edges hold against a straight charge, a weave and a jink (Wand over Shield fails, 19%: the harness wand backs away from a charging shield, and with both fighters locking it holds at 100%), all ten when both fighters click each other. The edges are tilts, not walls: the balance pass made a shield block only part of a hit, so **Shield over Sword and Shield over Bow no longer end with the shield at full HP**: the sword's hits still land, but they never stagger the shield and the rest of the loop's counters (Wand over Shield, Axe over Shield, the axe's shred) stay open. The second weapon slot (section 9.3) is still the answer to a counter: swap to the axe or the wand.

### 9.3 Inventory and pickups
- **Two weapon slots.** Swap between them. Swapping shares the attack cooldown, adds 0.25 s, and cancels your current action, so it can't be used to cut animations short. A target lock stays through a swap.
- **Fists.** Both slots start empty, and an empty slot fights with fists (9.6). Swapping to an empty slot is allowed.
- **Pick up** a weapon from a chest or the ground by pressing F near it. It goes into the hand's slot when that is empty (the hand arms at once), else into the other slot when that is free (the hand stays), else it replaces the weapon in hand, which is dropped.
- **Mob drops.** A mob drops the weapon it carried, unless the killer already holds that weapon type. A killer whose hand is empty is armed with it at once instead ("Armed: Bow"), with nothing on the ground.
- **Swapping is skill expression.** Changing to the counter weapon mid-fight is the big play. Swapping while marked **promotes the mark**, so disengaging is safer than repeated weapon swaps.

### 9.4 As built (Phase 9): rules the design left open
Decisions taken while building the weapons. The sections above are unchanged; where they are silent, this is how the game plays.

**Input and timing** (the Controls rework changed these; section 9.5)
- **A windup is part of its interval.** The cooldown counts from the attack's start for every weapon, the bow's draw included, so the cycle is the interval whatever the windup.
- **Trigger.** The game client no longer holds one: the target lock does (section 9.5). The low-level `attack` (a press) and `release` remain for mobs and the weapon harness (the bots click their foe, like the game client): a press attacks, holding repeats the attack whenever the cooldown allows, and a release stops the repeating (an attack already winding up still lands). A press up to 150 ms before the cooldown ends is buffered and attacks the moment it ends.
- **Windups.** Sword, bash and fists 0.1 s, axe min(0.25 s, 25% of the interval), wand min(0.4 s, 80%), bow min(0.6 s, 92%). The fighter is rooted for all of it, and the axe for 0.5 s (at most 50%) from the attack's start.
- **Direction is fixed early, unless locked.** A swing and a cast go where the fighter aimed when the attack started; an arrow goes along the aim held when its draw ends (the bow was aimed at release, and still is). An attack started by a target lock is aimed again at its target as it lands or leaves (section 9.5).

**Interrupts**
- **A stagger** cancels the windup or cast; the cooldown stays spent. A bow draw is not interrupted (9.1 tuning; it used to restart). The stagger mark is shown only when a windup or cast was cancelled, so an archer or an idle fighter that is hit gets the 1.1 s immunity but no mark. Every stagger that lands (the immunity starts, whether or not it cancelled anything) also pauses the staggered fighter's burn, disease and mark for its weapon's windup (section 10.3).
- **A swap, or a pickup that replaces the weapon in hand,** cancels a pending windup (a swing, cast or draw, and adds 0.25 s), but never cuts an already-landed root short.

**Shields, swings and balls**
- **Reflected arrows** mirror about the shield's facing, carry 15% of the archer's damage (the holder takes the other 85% as a normal hit), belong to the shield holder and fly the full bow range. An arrow reflected again keeps only the range it has left, and one is reflected at most twice.
- **A raised shield blocks only in part.** A frontal sword hit or bash loses 7% to the block and the other 93% lands as a normal hit that never staggers. **A riposte** is 50% of the blocked part (3.5% of the hit), with the swordsman's own damage shares, credited to the shield holder. Fists, axe swings and wand balls pierce the shield.
- **A sword halves a ball once.** Swings meet balls in present time (balls fly in present time) and need line of sight to them. A ball that deletes an arrow keeps 60% of its damage.

**Credit**
- **Simultaneous hits land together,** and the kill (and any bounty) goes to the largest rival hit; an exact tie goes to a per-tick secret order, never to join order.
- **A projectile outlives its shooter.** Its hit still lands; a kill by a shooter who has left or is already out of the run is credited by name only, with no GV.

**Setup**
- **Picking up into an empty slot** other than the hand's doesn't change the weapon in hand (a pickup into an empty hand arms it).
- **The faction** is picked in the hub before each run. A player who hasn't picked one (or a bot without `--faction`) gets a round-robin default by join order, which never counts toward faction achievements.
- **Training dummies** (server option `DUMMIES=1`) have no faction, so no armor or shield, and never die: a hit that would kill refills them.

*The rest of this section's tuning history (the table below, the kiting check, the weave and jink grids) was measured on the first sheet and the first weapon rules; the balance pass's results are in 9.6.*

**Tuning (9.1): every weapon edge holds against a straight charge, and a melee winner survives the approach.** The full log, with the numbers before and after every change, is `testing/TUNING_9_1.md`. It was measured before the Controls rework: where it names the ranged move slows, the bow's partial draws or the wand's 0.2 s cast, section 9.5 replaces them, and the real-sim numbers below (the harness grids, the weave and the jink) were re-measured after it: nine of the ten edges hold in the policy matrix (Wand over Shield fails, 23%) and all ten when both fighters click each other, see section 9.5 and `testing/TUNING_CONTROLS.md`. What changed, and why:

| Change | Before | After | Why |
|---|---|---|---|
| A sword stagger on a bow draw | restarts it | does nothing to it | Every sword hit cost the archer a whole draw (about 70 per duel), so the bow could never win the close trade |
| Draw, cast and recovery move speed | 0.75 / 0.35 / 0.5 | 0.1 / 0.1 / 0.1 (removed by the Controls rework: windup roots instead, section 9.5) | Owner's lever for kiting at duel pace: a strafing or backing-off shooter gets at most 12% more free fire than a standing one (it got up to 2.25 times as much) |
| Sword damage multiplier | 1.0 | 0.75 | The bow can only win a close trade against a weapon that does no more damage than it does |
| Axe damage multiplier | 0.9 | 0.77 | Same (Bow over Axe); the last 0.8 -> 0.77 is what keeps Bow over Axe standing against a zigzag approach (44% -> 82% against the quick one) |
| Wand damage multiplier | 0.85 | 0.8 | Axe over Wand, and the kiting check |
| Bow range | 480 | 240 | The free-fire time a melee faction winner must absorb: 2.47 s -> 1.06 s |
| Wand range | 420 | 220 | Same: 2.12 s -> 0.94 s |

- **The kiting check.** `python3 testing/realtime_report.py <k = 2 what-if> kite` and `python3 testing/test_kite.py` model a melee faction winner charging a ranged loser who fires at full output, signature bonus included (a standing one in 9.1; since the Controls rework one that walks away between shots, section 9.5). At duel pace, with the old numbers, seven cells were stolen (Fire over Sentenced and Plague, Sentenced over Plague, Holy over Sentenced on the wand); none is now. The tightest, Fire over Plague with the bow, has a tolerance of 1.23 s against 1.06 s of free fire (the weakest melee weapon is the axe at 0.77; it was the shield's 1.30 s before the axe's last cut). The movement penalties do not change that number (it assumes a standing shooter); they kept the real sim near it, and the harness measured that (below). They are gone now: section 9.5 has the check against a shooter that walks.
- **Why the ranges are so short.** At duel pace every faction hits twice as hard on the same HP, so a 500-HP Fire has little to spare: against Plague's bow it can absorb 1.3 s of free fire, which is 220 u of approach, not the 420 u a 480 u bow gave. Cutting only the damage would have needed a bow near 0.5, which loses every close trade; cutting only the range needed about 280 u or less. Both together keep the weapons usable.
- **What each style does.** `stand` is the shared policy: a ranged fighter stands at a good range, backs off when the foe is closer than about half its range and shoots whenever it can. `strafe` sidesteps every 0.8 s. `kite` keeps a longer distance and backs off sooner. With the near-root penalties the three looked alike for the bow (it could not move while it drew), and the wand's strafe reply was its best style against a strafing bow. Since the Controls rework a shooter is rooted only for its windup, so the styles differ again (`testing/TUNING_CONTROLS.md` has the grids; the harness also plays an `orbwalk` shooter that stands only for its windups, and a `lock` shooter that clicks its chaser).
- **Against a weaving melee approach.** (The numbers in this bullet were measured before the Controls rework. After it: Bow over Sword 100% against a straight charge, 93% against the weave and 100% against the jink, Bow over Axe 93% / 100% / 93% (the bow's best replies), neither thin in the Fire column any more; Wand over Shield fails in the policy matrix, section 9.5.) The harness's melee fighters charge straight unless told otherwise; it also plays a `weave` (55 degrees off the line, a new side every 0.4 s) and a `jink` (50 degrees, every 0.3 s). Such a fighter arrives about a second later, but most of the shooter's arrows on the way in miss, so the ranged edges lose their free fire. With the axe at 0.8, Bow over Axe failed against the jink (44%, no better reply; 71% against the weave); lowering the axe to 0.77 repaired it (18 setups x 5 factions: 93% against a straight charge, 89% against the weave, 82% against the jink; the whole 45-60 degree x 0.3-0.6 s sweep at 82-98%), with nothing else moving. Bow over Sword holds (93% and 87%), Wand over Shield holds (82% and 84%), the melee winners (Sword over Wand, Axe over Wand, Shield over Bow) are not hurt. What stays thin is the Fire column: Fire's 500 HP and 125 shield make a hit-count cliff (its axe kills in 7 hits at any damage from 0.75 to 0.875, its bow in 10), so Bow over Axe is 56% / 44% / 11% there against a straight charge / weave / jink, Bow over Sword 33% against the jink and Wand over Shield 11-22%; that is a faction number (Phase 10). Faster arrows (1100 and 1300 u/s), a longer axe root and a bow draw tweak were measured and did not help or cost Wand over Bow. `testing/TUNING_9_1.md` has the grids, the sweep and the rejected levers.
- **Holy over Sentenced** is the thin faction edge this touched: at 9.1 the wand/bow signature opening left Holy 23.6% HP in the worst case in the 20 Hz model (30.4% before), because the wand's multiplier is now level with the bow's. Phase 10 left the faction numbers alone (section 8.7); at duel pace the opening keeps 22.5% in the model and 24.7% in the real sim (section 10.1). The wand's arrow deletion makes the real opening wider than the stat model says.

**Terrain and reach** (zone terrain; section 5.2)
- **A swing stops at a fence.** Sword, axe and bash reach is 72-76 u centre to centre while two bodies pressed against a one-tile fence stand 56 u apart, so the melee mask includes `TILE_LOW`: a swing, the lock's "clear" test, a melee mob and a melee signature do not cross a fence, lava or a crevasse. Arrows, balls, ranged signatures, target acceptance and abilities do. The lock stays on a target it can see across a fence and walks the detour; it drops a target no path leads to. One constant (`MASK_MELEE`) flips this (owner-confirmed).
- **A pickup needs a path.** Picking up an item uses the movement mask: no looting through bars.
- **Ice and bog.** A fighter on ice cannot stop on a dime (section 5.2); a windup or root plants it. Bog multiplies with chill and move-speed cards, and the product of all move multipliers never goes under 0.35 (a root still stops you).

### 9.5 As built: mouse orders and basic attacks (October 28 combat port)

This revision is developed from the verified live `main` commit `c977910`, with its 136×136 zone maps, AD/AP scaling, cards, fists, and weapon specials. See [the source verification](COMBAT_UPGRADE_BASE.md). The movement reference is League's classic mouse combat. The game retains its own 20 Hz simulation, abilities, terrain and weapon counters.

- **Right-click ground** orders movement; holding it steers every 100 ms. **Right-click an enemy** locks and attacks it. Left-clicking an enemy also locks it, with the existing 64-unit cursor snap. Re-clicking the same target preserves the attack in progress.
- **A then left-click** orders attack-move toward a point. The server walks there, acquires the nearest visible valid enemy entering the held weapon's range, and resumes the route when the target is gone. The destination breaks distance ties. Direct target orders replace this route; a normal move or **S** clears it. Escape cancels the armed attack-move cursor before leaving training.
- A lock walks into weapon range, faces the target and attacks when the shared cooldown permits. It does not automatically kite. The existing 640-unit lock leash, terrain-aware paths, line-of-sight grace, and shield facing remain. Empty hands attack with fists, including after losing a weapon.
- **Pre-launch cancellation:** a move, stop, or order to another target cancels a lock-started windup and refunds its unlaunched cycle. Once the swing or projectile has launched, moving preserves that attack and its cooldown. Directional attacks used by mobs and harness policies remain committed through movement.
- **Ranged locked autos home.** They launch toward the target's current position, follow it beyond the initial attack range, and have a five-second safety lifetime. Target death ends the projectile. The existing Swarm rule allows already-fired shots to hit after hiding. Walls, LOW fence clearance, shield reflection, projectile clashes, splash, returned-damage accounting and card guards remain part of RougeHalla. Directional and reflected shots remain ballistic, with their existing travel ranges.
- **Client rendering:** additive target metadata guides the missile against visible interpolated positions; reconnects receive its current position, heading and remaining flight range. The client does not follow hidden target positions.

| Player weapon | Windup | Movement after launch |
|---|---|---|
| Sword, shield bash, fists | min(0.1 s, interval) | Free |
| Axe | min(0.25 s, 25% of interval) | Free; no recovery root |
| Bow, wand | min(0.3 s, 30% of interval) | Free |

Regional PvE mobs keep their live-version ranged attack profiles: bow min(0.6 s, 92% of interval), wand min(0.4 s, 80%), with the previous ranged base-speed windup floor. Their damage and health remain unchanged. This preserves camp difficulty; shortening Frostbow Sentry windups had reduced the measured starter clear rate from 22/25 to 7/25.

Attack speed shortens ranged windups along with the interval; the former G9 base-speed windup floor is removed. The other attack-speed caps and card guards remain. Quickdraw continues to shorten **melee** windups only; a multiplier above one can lengthen a ranged windup. Windups still finish on server ticks, so displayed animation timing is subject to the 50 ms tick grid.

**Balance interpretation:** shorter windups and guided autos increase ranged mobility and reliability. Prior kiting guarantees and the numeric tables in `testing/TUNING_CONTROLS.md` and `testing/TUNING_ROGUE.md` describe the older combat rules. They are historical measurements, not validation of this port. No faction sheet, card catalog or weapon scaling coefficient is retuned by this controls change.

### 9.6 As built (balance pass): fists, scaling, specials and the loop's levers
The balance pass added a sixth weapon that is not in the loop, made every weapon turn the cards' power into damage its own way, gave two weapons a special and retuned the loop's levers. The measurements are in `testing/TUNING_BALANCE.md` 5 and 6; every number below is provisional.

**Fists.** What an empty hand fights with, and how every run starts: reach 40, a 120° swing, boost +150% with a 0.2 s floor (the fastest cadence in the game: Fire 0.67 s, Plague 0.22 s, Frost 0.89 s), damage multiplier 0.60, windup 0.1 s, scaling 0.6 AD + 0.6 AP, on-hit power 1.2. They pierce shields, never stagger and meet no ball. They are not an item (they cannot be dropped, picked up or looted) and not in the loop (the ten `WEAPON_BEATS` edges are unchanged), so a faction on fists has no weapon edge. Arming is worth about ×1.25-1.33 of dps (0.60 against a loop weapon's 0.75-0.80), and a mob's first kill arms an unarmed killer (section 11): a player who has killed one mob beats a fresh player on fists 69% of the time (A10). An empty weapon slot fights with fists, so both slots start empty; swapping to an empty slot is allowed.

**Scaling.** A weapon hit carries the faction's own damage plus what the weapon scales the fighter's stats into (10.2). The numbers: sword 1.0 AD; axe 1.0 AD and 0.02 per point of bonus max hp; bow 1.0 AD; wand 1.0 AP and 0.3 AD; shield 0.4 per point of bonus armor or magic resist and 0.3 AP; fists 0.6 AD and 0.6 AP. The AD weapons and the wand's AP convert one point to one point per second; the weapons are told apart by their damage multiplier, windups, reach and specials, and not by what a card is worth on them (the contract's first numbers, 1.2 on the axe and the wand and 0.9 on the bow, let the minute-5 loop drift: open question N1).

**Specials.** *The axe shreds*: each hit takes 3 armor off its target for 3 s, stacking up to 6 (the `shred` status, a negative armor bonus; total armor never goes below 0, so a shred never makes anyone take more than the bare hit), which is worth most against the factions with the least armor. The cap is tuned small on purpose: at 8 up to 24 it strips all of Frost's 20 armor and flips Frost over Demon Blood of the axe set, the weapon harness's Sword over Axe Frost column and the lock pass's Bow over Axe Frost cell, as does any cap of 9 or more. *The wand splashes*: a ball's impact also hits every other enemy within 48 units of the target for 30% of the ball (a wall stops it, the target is never hit twice, a mob's ball never splashes a mob). *On-hit power*: the sword makes the on-hit effects of its hits land 1.5× as hard and fists 1.2× (a card's bleed, slow or shred). The splash and the on-hit power cannot be measured in a duel with stat cards and one enemy; they are unit-tested.

**The loop's levers** (all constants in `constants.ts`; the rules in `interactions.ts`, `sim/melee.ts` and `sim/projectiles.ts`):

| Lever | Value | What it does |
|---|---|---|
| `SHIELD_BLOCK_SHARE` | 0.07 | A frontal sword hit or bash is blocked only in part: 7% is stopped and 93% lands as a normal hit with no stagger (a bash on a bash too). It ends the shield-mirror stalemate (two shields used to block every bash). The contract's first value, 0.35, lost Demon Blood's edges in the shield-only faction set; 0.10 left Shield over Sword at 80% at minute 5. |
| `RIPOSTE_SHARE` | 0.5 | Half of the BLOCKED part of a sword hit is dealt back to the swordsman (3.5% of the hit). |
| `ARROW_REFLECT_SHARE` | 0.15 | A reflected arrow carries 15% of its damage; the holder takes the other 85% as a hit (the contract's first value 0.35; 0.25 left Shield over Bow at 87% at minute 5). An arrow is reflected at most twice (`MAX_ARROW_REFLECTIONS`). |
| `STAGGER_IMMUNITY_SECONDS` | 1.1 | After a stagger the target can't be staggered again for 1.1 s (it was 0.5 s). The edge is a step: at 1.2 Sword over Axe falls to 45% at minute 5, at 1.0 Sword over Wand jumps to 81%. |
| `BALL_AFTER_ARROW` | 0.6 | A ball that deletes an arrow keeps 60% of its damage: Wand over Bow is a win and not a wall. It also decides the reference openings of Demon Blood over Sentenced and Plague over Demon Blood (open question N2). |
| `SWORD_BALL_SCALE` | 0.5 | A sword swing halves a ball it meets, once per ball (unchanged). |
| axe damage multiplier | 0.77 | Unchanged: 0.84 flipped Bow over Axe (41%) and Sword over Axe (48%), so the axe's window stays narrow. |

**Where the loop stands** (`bench/matchups.ts --layer weapon --cross`: the favourite's win % pooled over the 25 faction pairs, noise off, minute 0 with no cards / minute 5 with the typical kit of 10.4):

| Edge | Sword over Axe | Sword over Wand | Bow over Sword | Bow over Axe | Wand over Bow | Wand over Shield | Shield over Sword | Shield over Bow | Axe over Wand | Axe over Shield |
|---|---|---|---|---|---|---|---|---|---|---|
| Minute 0 / minute 5 | 60 / 55 | 71 / 74 | 60 / 66 | 59 / 58 | 70 / 77 | 60 / 62 | 60 / 64 | 56 / 74 | 51 / 55 | 60 / 56 |

The target is 55-75% pooled and none under 50%: minute 0 reads 51-71 (Axe over Wand 51, just above the floor) and minute 5 55-77 (Wand over Bow 77, just above the ceiling). The real-sim weapon harness (`npm run harness -w @raid/server -- --core`) holds nine of ten edges in the policy matrix (only Wand over Shield fails, 19%) and all ten when both fighters lock each other; the perfect orb-walking kiter is worst at ×1.40 for the wand (sword against wand), unchanged. Fragile spots: the Sword over Axe Frost column depends on the shred cap (6 holds, 9 or more flips it) and Sword over Wand on the stagger step (1.0 against 1.1 s): a change to either flips a verdict (open question N12).

**The kiting check on the compressed sheet.** The old guarantee (the melee favourite's tolerance, how late it may arrive and still win half the duels, at least the orb-walk free fire) needs a margin the compressed edges do not have: a favourite now wins a fair fight with 10-35% hp left, so its tolerance is near zero, and the old rule fails in 9 of the 20 cells with no buff at all. The check (`python3 testing/test_kite.py`) now asks that a perfect orb-walking underdog wins **at most 65% of its duels under the noise model** (`r_kite = r × (1 − free fire / T) ≥ 0.78`, T the underdog's time to kill the favourite in the same model). It passes in all 20 cells with **one named exception**: Demon Blood over Fire against Fire's wand (the weakest chaser is Demon Blood's shield, in a short fight where the 2.2 s of free fire is 39% of it): the wand kiter wins 76%, `r_kite` 0.64 against a recorded floor of 0.62; the bow on the same edge holds (0.80), and the other 18 cells hold at 0.93-1.15. A longer wand windup did not fix Wand over Shield in the controls rework (0.6 s / 0.8: 20%; 1.0 s / 0.95: 76%) and cost Axe over Wand (73%) and the Frost wand (0%), so the wand windup stays 0.4 s. A best guess for the owner (open question Q3). The old stricter measure survives in `kite_windup_sweep.py` and `kite_buff_sweep.py` as a stress test.

---

### 9.7 Player-facing champion and weapon reference

The main menu's **Champions & weapons · guide** opens two public tabs, available without a loaded profile. Champions shows each kit's passive/Wish, scaling boundaries, and a prominent "Generally pairs best with" summary. Its top two recommended weapons have numbered build examples and tradeoffs: Fire (wand, axe), Sentenced (sword, bow), Plague (wand, bow), Frost (shield, axe), Demon Blood (sword, wand). These are general kit-synergy recommendations, not measured win-rate rankings; current stats and enemy counter weapons can change the best choice. The Weapon guide describes all six weapons, derives the intended wins/losses from `WEAPON_BEATS`, and explains the mechanics behind those edges. Fists have no wheel edge. These labels are design intentions, not win-rate promises; the guide adds no combat bonus.

The guide separates **scaling stat** from **damage type**: the base hit uses the champion's physical/magic/true shares, while AD/bonus HP/bonus defense additions are physical and AP additions are magic. Its scaling examples are raw damage **per second at base attack speed**. A champion-selectable worked example uses `pacedFaction`, `attackInterval`, `damagePerHit`, `damageShares` and `scalingDamage`, the same functions as the server packet. It excludes passives, Wishes, crits, augments, defenses and PvP multipliers. Server packet parity tests cover all five champions × six weapons with every scaling input and an attack-speed bonus.

This is a clarity pass: weapon coefficients, champion values and counter mechanics are unchanged. A possible later numerical simplification is to give sword/bow/axe AD scaling, wand AP scaling and shield defense scaling, removing secondary coefficients only after checking progression value and counter matchups. That proposal is not implemented. Keeping mechanical counters (stagger/interception, range, shield facing/reflection, armor shred and splash) would retain weapon identities without a hidden counter multiplier. Making all weapon base damage follow weapon type would be a separate, larger rebalance because current champion defenses are tuned against champion-based damage shares.

## 10. How factions and weapons combine (class scaling)

### 10.1 The two loops together
- **Rule of thumb: weapons decide reach; factions decide trades.**
  - Who can hit whom, from where, is the weapon's job: range, blocks, interceptions.
  - Once two players are trading blows, the faction loop decides who outlasts whom.
- **Reference weapons keep almost every opening matchup contested.** A run starts on fists, so no faction starts with a weapon; each faction's reference weapon (`SIGNATURE_WEAPONS`: the one the harness, the benches and the oracle fight with, and the one a player who arms itself in its home zone holds) is mostly the weapon that **loses** the weapon edge against the factions it beats on stats:

  | Faction | Reference weapon | Beats (faction) | Weapon matchup in that opening |
  |---|---|---|---|
  | Fire | Axe | Sentenced (Bow), Plague (Bow) | Bow > Axe in both: contested |
  | Sentenced | **Bow** | Plague (Bow), Frost (Shield) | Bow vs Bow mirror: neutral; Shield > Bow: contested |
  | Plague | Bow | Frost (Shield), Holy (Wand) | Shield > Bow, Wand > Bow: contested |
  | Frost | Shield | Holy (Wand), Fire (Axe) | Wand > Shield, Axe > Shield: contested |
  | Holy | Wand | Fire (Axe), Sentenced (Bow) | Axe > Wand: contested; Wand > Bow: **favours Holy** |

  - **8 of the 10 openings are contested.** The faction winner's reference weapon is the losing one, so no fight is decided by a pick. The real decision is **which weapon to go and get**.
  - **Sentenced vs Plague** starts as a bow mirror, so the faction edge decides it.
  - **Holy vs Sentenced** favours Holy on both loops, on purpose, and **Sentenced stays on the bow**. This is a best-guess decision for the owner to overrule (`SIGNATURE_WEAPONS` in `shared/src/weapons.ts`). The reason it started on the bow (a sword opening was Holy's thinnest: 8.1% HP kept at the pre-9.1 numbers) went stale twice: 9.1's weapon cuts reversed it in the stat model, and then the real sim reversed that. The measurement is every opening that involves Sentenced, with Sentenced on each weapon in turn (designed winner's worst HP kept in %, duel pace k = 2: the 20 Hz model `realtime.py` / the real sim in policy mode with the stagger rule of section 10.3, 18 setups per cell; every cell wins 100% of its duels unless marked; the real-sim numbers predate the Controls rework: re-run for the bow row after it, the openings are Fire over Sentenced 47.6, Sentenced over Plague 59.5, Sentenced over Frost 47.1 and Holy over Sentenced 24.4, in `testing/TUNING_CONTROLS.md`; the sword and axe rows were not re-run). "Contested" means the weapon edge opposes the faction edge:

    | Sentenced starts with | Fire (axe) over Sentenced | Sentenced over Plague (bow) | Sentenced over Frost (shield) | Holy (wand) over Sentenced |
    |---|---|---|---|---|
    | Sword | 67.5 / 66.0, contested | 58.8 / 52.1, contested | 50.2 / 48.7, contested | 28.5 / **0.0 (wins 0%)**, contested |
    | Axe | 49.8 / 69.9, mirror | 59.0 / 52.1, contested | 50.2 / 50.2, favours the winner too | 26.1 / **0.0 (wins 78%)**, contested |
    | **Bow** | 57.0 / 42.8, contested | 60.8 / 60.8, mirror | 50.2 / 47.4, contested | 22.5 / 24.7, favours the winner too |

    - **The sword** makes all four openings contested, and in the real sim that is too much: Sword > Wand decides Holy over Sentenced outright. The sword closes the 220 u gap and staggers every cast, so Holy wins none of its 18 setups (the 20 Hz model, which has no stagger, says 28.5%). The weapon edge overrides the faction edge, and the opening is settled on the pick screen.
    - **The axe** is contested against Holy and fails it 22% of the time in the real sim (Holy wins 14 of 18 setups). It also removes the contest from two other Sentenced openings (Fire vs Sentenced becomes an axe mirror; against Frost, Axe > Shield favours Sentenced on both loops), so the game would stay at 8 of 10 contested.
    - **The wand and the shield** each leave three openings favouring the faction winner on both loops and one a mirror (6 of 10 contested).
    - **The bow** is the one choice that holds all four of Sentenced's openings in the real sim (worst 24.7%, Holy over Sentenced) and keeps 8 of 10 openings contested; the owner's original aim stands: Holy vs Sentenced favours Holy on both loops. 9.1's reading that the bow opening was the thinner one (23.6%, against 29.4% on the sword) is right in the stat model and wrong in the real sim. Numbers and method: `testing/TUNING_10.md` section 7.
  - **Region weapons don't change.** The Sentenced region's mobs still carry swords, so all five weapons can be farmed somewhere.
  - **On the compressed sheet** (balance pass; `bench/matchups.ts --weapon sig`, reported and not judged): the table above and the analysis under it were measured on the first sheet and weapon rules. With the new sheet, both fighters on their reference weapons, no cards (minute 0) and with the typical kit of 10.4 (minute 5), the favourite's win % under the noise model / the underdog's / the favourite's hp left when it wins noise-free (`--` = it loses noise-free):

    | Edge | Minute 0 | Minute 5 |
    |---|---|---|
    | Fire over Sentenced | 68 / 32 / 19% | 82 / 18 / 30% |
    | Fire over Plague | 62 / 38 / 21% | 57 / 43 / 17% |
    | Sentenced over Plague | 59 / 41 / 22% | 42 / 58 / -- |
    | Sentenced over Frost | 69 / 31 / 26% | 46 / 54 / -- |
    | Plague over Frost | 66 / 34 / 23% | 60 / 40 / 9% |
    | Plague over Demon Blood | 73 / 27 / 37% | 48 / 52 / 1% |
    | Frost over Demon Blood | 56 / 44 / 13% | 74 / 26 / 30% |
    | Frost over Fire | 74 / 26 / 21% | 75 / 25 / 35% |
    | Demon Blood over Fire | 60 / 40 / 20% | 63 / 37 / 34% |
    | Demon Blood over Sentenced | 43 / 57 / -- | 60 / 40 / 6% |

    At minute 0 Demon Blood over Sentenced (wand against bow) no longer wins noise-free: `BALL_AFTER_ARROW` 0.6 is a compromise that keeps Wand over Bow at 77% at minute 5 (0.7 would put this opening back at 51% and Wand over Bow at 83%: open question N2). At minute 5 three edges invert (Sentenced over Plague, Sentenced over Frost, Plague over Demon Blood): the typical kit is attack-damage shaped and the true mark scales with none of it (open question N10). A run starts on fists, so these openings are what players meet only after they arm themselves.

### 10.2 The scaling formula
- **The weapon sets the shape. The faction sets the rhythm and the punch.**
- **A weapon is a % boost on the faction's base attack speed**, so the speed ratios between factions hold on every weapon.
  - Attacks per second = `faction rate × (1 + weapon boost) × attack-speed cards`.
  - Seconds between attacks (the interval) = 1 ÷ that, never below the weapon's floor.
  - Boosts: sword +115%, bow +95%, wand +65%, shield +60%, axe +40%, fists +150%.
  - Floors (the shortest interval): sword 0.25 s, bow 0.25 s, wand 0.3 s, shield 0.3 s, axe 0.35 s, fists 0.2 s. At base speed none of them binds. They only bind under attack-speed cards (section 12.7).
- **Damage per hit** = `faction rate × faction hit × weapon damage multiplier × attack speed × interval`. With no cards that is `faction hit × damage multiplier ÷ (1 + boost)`. Every faction keeps its own damage per second, times the weapon's damage multiplier, on every weapon: faster weapons hit proportionally lighter. Weapons change the rhythm and shape, not the class's power.
- **Cards add through the weapon's scaling (AD and AP).** A hit also carries `(scaling.ad × AD + scaling.hp × bonus max hp + scaling.def × (bonus armor + bonus magic resist))` physical damage and `scaling.ap × AP` magic damage, in points of damage per second at base attack speed, times attack speed and the interval: a faster weapon's hit carries less of it, an interval at its floor turns surplus speed into bigger hits, and the faction's own rate does not matter (a Plague and a Frost gain the same dps from a point). The scaling is in the table of 9.1 (sword, axe, bow 1.0 AD; wand 1.0 AP and 0.3 AD; shield 0.4 defense and 0.3 AP; fists 0.6 AD and 0.6 AP). AD, bonus-hp and defense parts are physical, the AP part magic. AP also adds `0.6 × AP` magic damage per second to every running burn and disease (a second entry under the same signature). Wishes never read AD or AP.
- **Signature bonuses scale with the weapon multiplier too** (burn, backlash, disease, execute, mark). Otherwise a weapon's damage discount would hit some factions much harder than others.
- **Duel pace (k = 2).** All faction damage is doubled, HP unchanged, so every fight is **exactly twice as short** while the counter graph holds. For example, Frost over Holy drops from 25.8 s to about 13 s, and Fire over Plague from 8.1 s to about 4 s (the engine: `python3 testing/matchup_band.py`).

Interval and damage per hit with no cards, before duel pace (double the hits for in-game values):

| Faction | DPS | Sword | Axe | Bow | Wand | Shield | Fists |
|---|---|---|---|---|---|---|---|
| Fire | 60.0 | 0.78 s / 35 | 1.19 s / 55 | 0.85 s / 41 | 1.01 s / 48 | 1.04 s / 47 | 0.67 s / 24 |
| Sentenced | 9.0 | 0.52 s / 3.5 | 0.79 s / 5.5 | 0.57 s / 4.1 | 0.67 s / 4.8 | 0.69 s / 4.7 | 0.44 s / 2.4 |
| Plague | 37.0 | 0.25 s / 7.0 | 0.39 s / 11 | 0.28 s / 8.2 | 0.33 s / 9.7 | 0.34 s / 9.4 | 0.22 s / 4.8 |
| Frost | 78.8 | 1.03 s / 61 | 1.59 s / 96 | 1.14 s / 72 | 1.35 s / 85 | 1.39 s / 82 | 0.89 s / 42 |
| Holy | 91.2 | 0.49 s / 33 | 0.75 s / 53 | 0.54 s / 39 | 0.64 s / 47 | 0.66 s / 45 | 0.42 s / 23 |

Reading the table:
- Every column has the same speed ratios: on any weapon Plague swings 4.1× as often as Frost and 3.1× as often as Fire.
- Fire with an axe swings every 1.19 s for a 55-damage hit (before what cards add, above); Plague with a bow fires 3.6 arrows a second; Plague's fists punch every 0.22 s (the floor is 0.2 s) for under 5.
- Frost with an axe is the slowest combo in the game, one swing every 1.6 s. In the 20 Hz duels the longest stretch with no swing from either fighter is also 1.6 s.
- Plague's sword (0.251 s) sits just above its 0.25 s floor, so any attack-speed card on it turns into damage per hit at once.
- Windups are part of each interval (Controls rework, section 9.5): a bow cycle is rooted for 0.92 of it up to 0.6 s, a wand cycle for 0.8 up to 0.4 s. So Plague's bow (0.28 s) is rooted for 0.255 s of every cycle and Frost's bow (1.14 s) for 0.6 s of it. An attack-speed card shortens the interval and a melee windup together, but never a ranged windup below its base-speed value (G9, 12.7). The kite check's model assumes no attack-speed cards.
- Sentenced's weapon hits trigger its mark; the pulse is a separate true-damage entry, not damage over time.

### 10.3 Signatures in real time
The design engine assumes two fighters standing in range forever. The game has movement, walls and up to 8 players, so the signatures follow these rules:

| Rule | Why |
|---|---|
| **Engagement.** A signature applies to your **current target**: the last enemy you hit, while they are within your own weapon's range and in line of sight (plus the linger below). | Turns 1v1 math into multiplayer rules, and stops ranged DoT classes winning from range without swinging |
| **The clock starts at first contact** between two players, not at your own first hit | Keeps fights from being decided by who swung first |
| **Bonus damage lingers 1.25 s** after line of sight breaks | Stops peek-fighting (pop out, hit, hide, repeat) |
| **The mark holds through breaks.** It freezes while hidden and resets on target switch, a weapon swap by the target, death, or 10 s without contact. | Sentenced isn't cheesed by walls |
| **Frost's chill** applies to everyone engaged with Frost. It doesn't stack, and it stretches the cooldown, the bow draw (its start and the moment the arrow leaves, so a chilled archer's cycle stays the interval over the chill's rate) and the press buffer smoothly every tick (it's never snapshotted at swing time). The other windups, a swing and a cast, are not stretched. The **movement** slow (x0.7) only applies within melee reach of Frost (about 100 u). | A small radius would let ranged enemies ignore the attack slow; a ranged Frost slowing its chaser would be uncatchable. Even so, a Frost shooter walks its chaser back out to 100 u after every shot, so its windup must stay long enough for the chaser to cross the last 40 u inside it, about 0.31 s (section 9.5). |
| **Fire's backlash** hits an engaged enemy each time they swing, sized by how often their weapon swings (145 ÷ (1 + the weapon's boost)): fists 58, sword 67, bow 74, wand 88, shield 91, axe 104 | Literally "damaged when swinging", and over time it matches the design engine exactly. A flat 145 per swing would have over-punished fast weapons. The backlash is physical damage, so armor cuts it. |
| **HP stays fractional** and cooldown remainders carry over | Avoids rounding cliffs that flip close fights |
| **Healing** only works after 3 s out of combat. Lifesteal (Holy's and the Leech cards'), the camp-clear heal and Second Wind are exempt. | Mid-duel heals flip faction counters; blocking lifesteal would break Holy |
| **Attack-speed cards** past a weapon's floor (its shortest interval) turn into extra damage per hit. Plague's sword (0.251 s) is just above its 0.25 s floor, so any attack-speed card on it converts at once. | Otherwise Plague on a sword would gain next to nothing from attack speed |
| **Windups scale with the interval.** Axe root = min(0.5 s, 50% of the interval) and windup = min(0.25 s, 25%). Bow draw = min(0.6 s, 92%), always a full draw. Wand cast = min(0.4 s, 80%). Sword, bash and fists 0.1 s. Every windup roots the fighter (Controls rework: it replaces the old wand self-slow and the 10% ranged move multipliers). | Plague's axe swings every 0.39 s, shorter than a fixed 0.5 s root. Without this, fast cadences would be rooted for good. The ranged shares are the anti-kiting lever (section 9.5). |
| **Stagger immunity.** After a stagger, the target can't be staggered again for 1.1 s. | Plague's sword swings every 0.25 s and could otherwise stagger-lock a target |
| **A landed stagger pauses the staggered fighter's damage over time.** When a stagger lands (the 1.1 s immunity starts, whether or not it cancelled a swing), its burn, disease and mark stop for its weapon's windup: sword and shield 0.1 s, axe up to 0.25 s, wand cast up to 0.4 s, bow 0 (a bow draw is never cancelled). Fire's backlash never pauses, and the mark's clock keeps running. | A stagger only cancels a swing that is still winding up, so on average it costs a hit-based fighter one windup of its damage, and damage over time would lose nothing: a sword's staggers would trade only against hit-based factions (Holy lost Holy over Sentenced with both on swords). The pause costs the same expected damage. It exists only in the real sim; the 20 Hz model has no staggers. |
| **Each signature deals its own damage type** (burn and disease magic, backlash physical, the mark true), whatever the faction's weapon hits are. Mobs' signatures are typed the same way. | The first sheet's mark and backlash were magic: Holy's shield cut the mark to 29%. The types are the owner's tags and decide Holy over Sentenced and Plague over Holy (open question Q5). |
| **The mark's clock against a player runs at the attacker's PvP factor** (10.4); against a mob it runs at 1. | The factor is a PvP-only duel pace: equal-power fights keep their outcome and only their pace changes. |

A 20-tick-per-second simulation of the damage rules above reproduces the full faction cycle with the same weapon on both sides (all five weapons), in every signature-weapon opening and in all 25 weapon pairings of every edge (on the first sheet: before the 9.1 tuning, Holy over Sentenced lost with the bow or the shield against a sword; after it all 250 cells won every phase pair at duel pace, and the thinnest, Holy's sword against Sentenced's wand or bow, kept 17.4% HP in the worst case; on the compressed sheet the real sim agrees with the model on 70 of 70 cells, fists included, and every favourite wins its noise-free duels on fists and on each of the five weapons). It does not model movement, line of sight, stagger or the animation timings, except one approach: the kiting check (sections 9.4 and 9.5) charges a melee winner at a ranged loser, who since the Controls rework walks away between rooted shots.

### 10.4 Power, the PvP factor and the time to kill
Power is the weapon in hand plus the cards you hold (section 12): no kill gives a stat. Every player-to-player hit (a weapon hit or a signature's damage; never a Wish, the arena, a mob or a dummy) is multiplied by the **PvP factor** of its attacker's **card power** P, the sum of the tiers of its cards (a stacked card counts once per copy):

`pvpFactor(P) = 0.77 + 2.23 × (1 − e^(−P / 6))`

| P | 0 | 1 | 2 | 3 | 5 | 6 | 10 | 15 | limit |
|---|---|---|---|---|---|---|---|---|---|
| Factor | 0.77 | 1.11 | 1.40 | 1.65 | 2.03 | 2.18 | 2.58 | 2.82 | 3.0 |

A fresh player hits other players weakly and a farmed one far harder (a P 10 player deals 3.3 times a fresh player's damage: owner ruling Q9 kept the ×3.0 ceiling): **early fights are slow, late fights short, and farming wins fights.** The factor saturates (half of the gain is there by P 4, which is the snowball brake) and the guards of 12.7 bound what a stack of cards can add on top. It is a PvP-only duel pace: the mark's clock against a player runs at the same factor, so two fighters of equal power keep the outcome the faction sheet gives and only the length changes. The HUD shows it on the build strip ("PvP ×1.39").

**The time-to-kill target.** The curve is fit to a design target, measured in the real sim as the median over every ordered pair of different factions in an even duel (both on the same kit, the lock's controls, `bench/ttkCurve.ts`): **about 20 s at minute 0** (fists, no cards) and **about 5 s with the kit of a player who has cleared five camps**. The kits are a best guess, one card a camp and about a camp a minute:

| Minute | Weapon | Cards | P | Factor | Median TTK | Mean |
|---|---|---|---|---|---|---|
| 0 | fists | none | 0 | 0.75 | **19.8 s** | 20.6 s |
| 1 | reference weapon | first offense card | 1 | 1.10 | 10.1 s | 12.0 s |
| 2 | same | + Vitality I | 2 | 1.39 | 8.6 s | 10.2 s |
| 3 | same | + Haste I | 3 | 1.64 | 7.3 s | 8.7 s |
| 4 | same | + second offense card | 5 | 2.02 | 5.9 s | 6.6 s |
| 5 | same | + Armor I | 6 | 2.17 | **5.4 s** | 6.4 s |

(The offense card is Attack Damage on every weapon except a wand, which takes Ability Power, and a shield, which takes Armor.) The curve falls 3.7× from minute 0 to minute 5, every ordered pair lies between 0.46× and 1.96× of the minute-0 median, and no duel hit the cap. The big step from minute 0 to minute 1 is the weapon plus the first card (×1.47): **farm, then fight.** A player who has killed one mob (and so holds its weapon) beats a fresh player on fists 69% of the time; a player on the minute-5 kit beats a fresh one on fists in 100% of the duels it fights, keeping 86% of its hp. The slowest even duels are the sustain mirrors (the Frost mirror 44 s at minute 0 and 15.8 s at minute 5, 2.9 times the median: open question N4). `testing/TUNING_BALANCE.md` 3 has the full table.

---

## 11. Mobs and regions

- **Neutral by default.** Mobs idle near their camp and only fight once attacked.
- **They fight like their region, shaped by their type.** Each mob uses its region's faction rules (scaled down) and then its type's **role** (below), and carries its **type's own weapon**. Frost mobs slow you; Plague mobs execute you below half HP (their execute is scaled by `k²`, see Strength). A caster shoots, so it fights as a ranged fighter.
- **Aggro and leash.** Once hit, a mob chases and fights with spacing that suits its weapon, and so does the rest of its camp (below). If you run far enough, out of its camp's territory, it gives up, walks home and regenerates.
- **Drops.** On death a mob gives:
  - a little **GV**, and a quarter of a player kill's feed (section 12.1);
  - **its weapon**: if your hand is empty it goes straight into it ("Armed: Bow", no ground drop: the owner ruled this, so a starter on fists is armed by its first kill); otherwise it lies where the mob fell, unless the killer already holds that weapon type.

  **A kill never gives a stat.** The per-kill buffs of the first roguelike builds are gone; all stat power is a card (section 12). Clearing the whole camp pays once more: one **shared chest** of cards (section 12.5) and a **heal** for everyone who fought it (section 12.6). A camp's chest is not the killer's.
- **Mono-type camps, 30 types.** Every camp is one mob type: its normal mobs all share it, and an elite camp adds one elite of its zone at its elite spot (a zone has two elite camps). Each zone has **six types: four normal and two elite**, each with a role and a weapon:

  | Zone | Normal types (role, weapon) | Elite types (role, weapon) |
  |---|---|---|
  | Fire | Ember Imp (swarm, axe), Cinder Hound (skirmisher, axe), Magma Brute (brute, axe), Flame Caller (caster, wand) | Wyrmling (grunt, axe), Ash Drake (caster, wand) |
  | Sentenced | Bailiff (grunt, sword), Chain Warden (brute, sword), Inquisitor (skirmisher, sword), Pardoner (caster, bow) | Executioner (grunt, sword), Gaoler (brute, shield) |
  | Plague | Plague Rat (swarm, bow), Bloatfly (skirmisher, bow), Rot Monk (grunt, bow), Miasma Witch (caster, wand) | Rat Ogre (brute, bow), Pox Behemoth (brute, axe) |
  | Frost | Frost Wisp (swarm, shield), Ice Golem (brute, shield), Rime Stalker (skirmisher, shield), Frostbow Sentry (caster, bow) | Glacial Warden (grunt, shield), Avalanche Troll (brute, axe) |
  | Demon Blood | Acolyte (grunt, wand), Seraph Shard (swarm, wand), Penitent (skirmisher, wand), Zealot (brute, sword) | Blood Saint (grunt, wand), Archon (skirmisher, sword) |

  Every zone drops two or three kinds of weapon (Fire axe and wand; Sentenced sword, bow and shield; Plague bow, wand and axe; Frost shield, bow and axe; Demon Blood wand and sword), so every weapon can be farmed in at least two zones, and **the map is still a shopping list for counters**. A role is a multiplier on the zone's scaled faction:

  | Role | HP | Damage | Move | What it is |
  |---|---|---|---|---|
  | Grunt | ×1.0 | ×1.0 | ×1.0 | Plain fighter |
  | Swarm | ×0.7 | ×0.9 | ×1.1 | Fast and fragile |
  | Brute | ×1.4 | ×0.8 | ×0.9 | Slow and tough |
  | Skirmisher | ×0.85 | ×1.1 | ×1.15 | Runs you down |
  | Caster | ×0.75 | ×1.2 | ×1.0 | Shoots from range |

  (The damage multiplier scales the hit and every point-damage signature number, hp is separate; a swarm mob is both fragile and weak-hitting, a brute tanky and slow-hitting.) The client marks a role on the mob's disc (swarm: small dots, skirmisher: a chevron, caster: a ring, brute: a thick rim) and an elite with a star.
- **Rosters.** A zone's four normal types go into a **bag twice** (eight entries), shuffled once per zone from the private reward stream when the room is built, and the zone's camps take the entries in map order: a zone of eight camps shows each type in exactly two of them. The k-th elite camp of a zone (in map order) holds the k-th elite, so its two elite camps hold its two elites. **A generated map has eight camps a zone and two of them elite** (section 5), so every zone shows all four normal types and both elites; a hand-built map's zone with fewer camps shows the first bag entries (a type can repeat across its camps or be missing). The roster is public from the lobby on: the planning screen names every camp's type, its role and the weapon it drops, and your faction's matchup against the zone's faction (a straight duel of factions: it does not weigh the type's role, its weapon or your weapon).
- **One hit wakes the whole camp** (owner ruling, `CAMP_WIDE_AGGRO`). Damage to any mob wakes every idle mob of its camp onto the same attacker, even when the hit mob was already fighting, and so does a hit that kills it outright (the mates wake onto whoever is credited with the kill). The mates carry no threat of their own, so a pull earns no kill credit: a mob's kill still goes to whoever did that mob the most damage. A mob walking home ignores the call, a camp-mate of another camp stays asleep, a fighter that is hidden by Swarm is never handed on (the mates wait for a hit on someone they can see) and a stunned mate does nothing until its stun ends. Each woken mob keeps its own leash and give-up timer, so the camp can come apart as you kite. With the flag off, only the mob that is hit wakes.
- **Camp respawns and wards.** A camp is idle, engaged after its first damage, or cleared when its last mob dies. A full clear starts a three-minute countdown; individual deaths do not start one. At the deadline the entire original normal/elite roster returns at its original spots with full health, fresh IDs and clean combat state, and the camp becomes idle again. The final mob's credited killer receives a personal ward at the camp centre until that same deadline; environmental clears grant no ward. Ward vision ends without adding a two-minute residual trail. Camp state, surviving count, clear time, respawn deadline, ward owner and expiry are public outside vision. Respawns continue while coliseum gates are locked; training and ended runs do not respawn regional camps. Each cycle retains the camp chest and contributor heal (sections 12.5 and 12.6).
- **Strength.** A mob is its region's faction with hp and every damage number scaled by **0.22** (`MOB_K`), an elite by **0.65** (`ELITE_K`), then by its role. A normal mob was 0.45 until the camp began to wake together, and the owner ruled normal mobs weaker (elites stay harder). **A mob's execute is scaled by `k²`**: its bonus damage reads the PLAYER's hp fraction, whose pool is full-scale, so `k` alone left a Plague mob 4-5 times too strong (it killed a 25%-hp player in 0.9-3.6 s where any other zone took 5-120 s). Mobs are balanced against **a starter on fists** (a run starts unarmed, section 3), measured in the real simulation with signatures and the Phase 9.1 ranges included, one scripted player per duel and no cards (`testing/TUNING_BALANCE.md` 9):
  - *One mob at a time* (`mobDuel --style stand`, a hand-built floor with a 9-tile leash). A player who stands and fights finishes a normal mob in all 25 of the 25 starter-against-zone pairings with about 95% hp left (worst pairing 90%) and an elite in all 25 with about 43% left (97% of duels).
  - *A whole camp that wakes at the first hit,* which is what a run asks (`campDuel`, `camp` pull, 4 seeds so that every type is met): a camp of 4 normals is cleared in 24 of 25 pairings in every seed and in all 25 in half of them (the miss is a Fire fist against a Frost camp), every normal type's camp in at least 80% of runs (all 20 of 20, except the Frostbow Sentry, a ranged caster, at 17 of 20). An elite camp (the elite and 3 normals) is cleared in 4 of 25 pairings in every seed and 13 in half of them: elites are for armed, carded players (Plague's two elites clear 4 of 20 on fists), and every elite type's camp falls to at least one starter on its zone's weapon.
  - *The Plague execute (A13):* a motionless 25%-hp player lasts 0.94 times as long against a Plague mob as against the other zones' median (pooled), and 0.45 times for a Plague player, whose armor 190 shrugs off the other zones' physical mobs.

  What a fist cannot finish needs a better weapon, and that is the choice: the weapons you pick up decide which camps you farm. A player who backs away from a melee mob while shooting can still lose to it: the mob chases to its leash, gives up, heals and comes back, so a ranged weapon has to burst a melee mob down inside one round.
- **Who gets the kill.** The player who did the mob the most damage over the whole fight (since it last rested), among those still in the run, so a late shot cannot steal an elite. An exact tie goes by the tick's secret order. A mob that nobody in the run hit drops its weapon and pays nothing.
- **The leash is the camp's territory** (section 5), and never more than 12 tiles from the mob's own rest spot. A generated camp's territory reaches 10.8 to 30 tiles from the camp, so the 12-tile cap is what binds on almost every camp, unless the territory's edge comes first; a mob that has no territory to hold its spot (one placed with no camp, or in a hand-built test arena) keeps a 9-tile circle around its spot instead. A bow or wand mob backs away only to points a little way inside the leash.
- **Leash numbers.** Any hit from a player wakes the mob, wherever the player stands. It gives up when it leaves its leash, or 6 s after it last **dealt** damage (damage it takes does not extend the fight), or with nobody left to fight. It then walks home **ignoring everyone and taking no damage**: it starts nothing new (a shot already in the air still lands), and it is not a body, so swings and shots pass through it (its shield neither blocks nor reflects). It is whole again the moment it arrives, and is neutral again. A mob hurt by someone who was gone before it could wake heals after 3 s unhurt. So a shooter out of its reach gains nothing by kiting it: every round ends with a whole mob. A mob whose shield blocks or reflects a hit wakes too. A bow or wand mob backs away from a player who is too close, but only inside its leash and only to open the gap; cornered at the edge it stands and shoots. A hit on one mob wakes its whole camp (above), and each woken mob then follows this paragraph on its own. Mobs never hurt each other, and their shots fly past each other. Dead mobs return with their whole camp three minutes after its full clear. When the patience timer teleports everyone into the coliseum, every living mob is put back on its camp spot at full health.
- **Same input path as players.** Mobs use the same input rules and combat code as players, so a sword mob and a sword player behave identically. A mob holds the trigger itself (it never locks a target), and its windups root it like anyone's. A mob holds no cards, so it has no card bonus and no PvP factor.
- **Later.** Raid-boss mobs (section 2.2); relics in the chest and "?" camps that hide their reward are planned, not built (`docs/ROGUELIKE_PLAN.md`). Quest NPCs have a first version (`docs/quests.md`).

---

## 12. Power, snowballing and anti-snowballing: the card economy

Getting fed should feel like a fed League carry or a Slay the Spire run where the build "just comes together". Getting ahead is meant to feel powerful. The limits are soft: **rewards fall off and bounties rise**, rather than hard caps, and one curve (the PvP factor, 10.4) decides how much a stack of power is worth against another player.

**Farmed mob progression.** Each normal mob type gives one fixed stat per credited kill with no per-type ceiling. Only elites drop interactive augment chests. Quests grant 8–16 zone-matched normal-type stacks from objective/travel effort, plus GV; the single-award range does not cap accumulated stacks. See [Mob progression](MOB_PROGRESSION.md) for the twenty-type reward table and current UI. The historical card catalog remains in code for combat harnesses; base and conditional stat cards are excluded from external reward paths.

### 12.1 Feed score
`feed = player kills + 0.25 × mob kills` for the current run. It sets the mob reward curve (12.3) and the catch-up; the bounty reads player kills only (12.4).

### 12.2 The card catalog: 75 cards in three kinds
A card is data: a row of effects the sim folds into a player's stats (`shared/src/cards.ts`, `effects.ts`; the card's text is general mechanics only). A player's **card power** P is the sum of the tiers of the cards held (a stacked card counts once per copy); the PvP factor reads it (10.4). Cards last the run and are gone when it ends.

**24 base cards: eight stats at three tiers.** They stack: Attack Damage II held twice is two copies. T2 is 1.75 and T3 2.75 times T1.

| Stat | Title | Tier I | Tier II | Tier III | Tags |
|---|---|---|---|---|---|
| `ad` | Attack Damage | +12 AD | +21 | +33 | physical |
| `ap` | Ability Power | +12 AP | +21 | +33 | magic, damage over time |
| `haste` | Haste | +9% attack speed | +16% | +25% | |
| `vitality` | Vitality | +9% max health | +16% | +25% | |
| `armor` | Armor | +15 armor | +26 | +41 | physical |
| `mr` | Magic Resist | +15 magic resist | +26 | +41 | magic |
| `leech` | Leech | +5% lifesteal | +9% | +14% | heal |
| `fleet` | Fleet | +6% move speed, off while shooting and for 2.5 s after | +10% | +15% | |

AD and AP are **points of damage per second at base attack speed**, and each weapon converts them its own way (10.2). Fleet is Swift Boots' old rule: the bonus is off from the moment a bow or wand attack starts until 2.5 s after the shot leaves, so it helps walking, chasing and melee but never buys a shooter the walk back between shots (the ranged windups are the anti-kiting lever).

**11 conditional cards, all tier II, one per player.** A conditional is offered only when a player who earns the chest owns a card of its base stat (any tier) and is pickable only by an owner (the refusal reads "Needs Leech").

| Title | Needs | What it does | Tags |
|---|---|---|---|
| Bloodthirst | Leech | While below 50% health, your lifesteal is doubled. | heal |
| Second Skin | Leech | Healing you receive also grants a barrier worth 30% of it (up to 25% of max health). | heal |
| Juggernaut | Attack Damage | Gain 1 armor and 1 magic resist per 4 AD. | physical, magic |
| Spellsword | Attack Damage | Your AD also counts as AP at half value. | magic |
| Big Brain | Vitality | Gain AP equal to 2% of your max health. | magic |
| Arcane Tempo | Haste | Every 1% attack speed above base also grants 1 AP. | magic |
| Momentum | Fleet | Your bonus move speed is added to your damage. | |
| Stone Skin | Armor | Gain 2 armor and 2 magic resist per 100 max health. | physical, magic |
| Hearty | Vitality | +18% max health. | |
| Festering Arcana | Ability Power | Your magic damage over time keeps ticking 4 more times after it ends, each tick 1/8 of your AP. | magic, damage over time |
| Rhythm | Haste | Every 3rd attack is a critical strike. | crit |

**40 augments: titled, one per player, unconditional.** Each is a rule or a trade-off. All 40 are live.

| Title | Tier | What it does | Tags |
|---|---|---|---|
| Here Comes the Boom | III | Your attack speed is halved, but your hits deal 2.5x damage, AD and AP alike. Your damage over time and returned damage deal 1.25x. | dot, returned |
| A Race to 0 | III | Damage you deal and take is multiplied by 1 / your health fraction (up to 2.5x). | |
| Committed | III | Your second weapon slot is locked. The weapon you hold deals +20% damage and attacks 15% faster. | |
| Machine Gun | II | Your attack speed is doubled, but each hit deals half damage. Your on-hit effects keep their full strength. | on-hit |
| Glass Cannon | II | +35% damage, -25% max health. | |
| Thick Skull | II | +30% max health, but your hits can never critically strike. | crit |
| Vampiric Pact | II | +15% lifesteal, but no other healing works on you (camp heals included). | heal |
| Arcane Overload | II | Your AP is multiplied by 1.5, but your Wish's cooldown is doubled. | magic, wish |
| Fists of Fury | II | While unarmed: +40% attack speed (counts toward the cap), and your on-hit effects apply twice. | on-hit |
| Overkill | II | Damage beyond a kill splashes onto the nearest enemy within 200 u. | area |
| Tank Engine | II | Permanently gain 1 max health for every point of damage your blocks prevent (up to +250). | block |
| Slow Starter | II | -30% damage for your first 3 s in a fight, then +35%. | |
| Coup de Grace | II | +30% damage to targets below 30% health. | execute |
| Big Game Hunter | II | +25% damage to elites and to players above 70% health. | |
| Pack Leader | II | +3% damage for every camp you helped clear this run (up to +24%). | |
| Adrenaline | II | After losing 10% or more of your max health in one hit: +40% move and attack speed for 2 s. | |
| Cruel Wounds | II | Damage over time can crit (+20% critical strike chance). On Plague, only auto attacks can crit; its DoTs instead gain half its current crit chance as steady damage. | crit, dot |
| Third Time's the Charm | II | Every 3rd hit on the same target applies its on-hit effects twice. | on-hit |
| Eye for an Eye | II | Damage you return to attackers applies your on-hit effects. | on-hit, returned |
| Sitting Ducks | II | Slowed enemies take 12% more damage from you. | slow |
| Tunnel Vision | II | +4% damage per hit on the same target, up to 10 stacks; switching targets resets it. | ramping |
| Plant Your Feet | II | After standing still for 1 s, your next attack has +25% range and damage. | |
| Wishful Thinking | II | Each hit you land shortens your Wish's cooldown by 1 s (at most 30 s a minute). | wish |
| Spiked Shell | II | Melee attackers take 15% of the damage they deal to you back as physical damage. | returned, physical |
| Gathering Storm | II | Your ramping damage ramps 50% faster. | ramping |
| Siphon | II | Your damage over time heals you for 20% of the damage it deals. | dot, heal |
| Second Wind | II | Once per run, the first time a hit leaves you below 25% health: heal 20% of max health over 1.5 s. | heal |
| Pestilence | II | Your execute starts at 60% health instead of 50%; with no execute, +8% damage to targets below 60% health. | execute |
| Slow Burn | I | Your damage over time keeps burning twice as long after a fight breaks off, at 30% less per second. | dot |
| Pocket Sand | I | Your blocks slow the attacker by 30% for 1 s. | block, slow |
| Gambler | I | Each hit has a 15% chance to deal double damage and a 15% chance to deal half. | crit |
| Best Offense | I | Your blocks count as hits. | block |
| First Impressions | I | Your first hit on a new target deals +40% damage. | |
| Hemorrhage | I | Your physical hits make the target bleed for 10% of the hit over 2 s. | on-hit, dot, physical |
| Iron Will | I | Slows on you are 40% weaker. | slow |
| Wellspring | I | Healing you receive is 25% stronger (camp heals included). | heal |
| Quickdraw | I | Your melee windups are 50% shorter. | |
| Bounty Hunter | I | +10% damage to players who hold more card power than you. | |
| Witness | I | +8% damage to a target that is fighting someone else. | |
| Last Rites | I | +25% attack speed while below 30% health. | |

Notes that are easy to get wrong. *Quickdraw* shortens melee windups only (the sword's, the shield bash's, the fists' and the axe's, and the axe's root with its windup) and never a bow's or wand's (owner ruling "Melee windups only", 9.5); windups end on 50 ms ticks, so a cut counts in whole ticks (the sword, the bash and the fists go from two ticks to one, the axe from five to three). *Second Wind*'s heal is four steps of 5% max hp 500 ms apart (the first at once), so it spans 1.5 s; it ignores the 3 s heal lockout but not an anti-heal. *Pestilence* lets a Plague fighter widen its execute instead of dealing the +8%. *Last Rites* is a stepped attack-speed row that counts toward the cap. *Tank Engine*'s rate is a best guess: a block stops only 7% of a hit, so a Frost shield duel prevents about 10 points per melee block, and at 1 max hp per point the +250 takes about four to five camps' tanking to fill. *Slow Burn* trades 30% of every tick for twice the linger. Retired from the chest: Whetstone, Swift Boots, Thick Hide and the twelve declared-only passives of the first camp-chest build (Firebrand, Searing Riposte, Ashwalk, Double Sentence, Sentence Served, Bite Twice, Shatter, Frozen Path, Hoarfrost Armor, Radiance, Quartermaster, Scout); their ideas live on in the base stats and in Hemorrhage, Spiked Shell, Third Time's the Charm and Iron Will (owner question Q6).

**Tags and the glossary.** Every card, signature and weapon wears mechanic tags, and the Mechanics page of the help card (`H`) and the card tooltips explain each:

| Tag | Meaning |
|---|---|
| AD | Adds physical damage to your weapon hits. |
| AP | Adds magic damage to your hits (most on a wand) and to every damage over time you run. |
| Physical | Cut by armor, by `1 / (1 + armor / 100)`. |
| Magic | Cut by magic resist, by `1 / (1 + magic resist / 100)`. |
| True | Cut by nothing. |
| Damage over time | Ticks while you stay engaged (burn, disease, the mark, bleeds). AP adds to every one you run. |
| On-hit | An effect a weapon hit applies when it lands; as strong for a small hit as for a big one, so more, smaller hits apply it more often. |
| Returned | Damage dealt back to whoever hit you. |
| Slow | Anything that cuts move or attack speed. |
| Heal | Any healing. Most heals wait 3 s out of combat; lifesteal and camp heals do not. |
| Block | A shield stopping part of a hit in front of it (the rest still lands, and a blocked hit never staggers). |
| Ramping | Grows the longer the fight lasts. |
| Execute | Grows as the target's health falls. |
| Critical strike | A hit for 1.5x damage. |
| Area | Hits more than one enemy. |
| Wish | Your faction's once-a-run ability (key D). |

The signatures wear tags too: burn magic and over time, backlash physical and returned, the mark true, ramping and over time, the disease magic, over time, with its execute, the chill a slow, Holy's lifesteal a heal. Weapons: sword physical and on-hit (it staggers, its on-hit effects land 1.5x as hard), axe physical and on-hit (its shred), bow physical, wand magic and area, shield block and returned, fists on-hit (1.2x).

### 12.3 Mob rewards fall as you get fed
Mob GV and a quest's card tier are multiplied by a curve that is near full while you are hungry, drops sharply around a feed of 5, and never goes below 30%:

| Feed | 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| Mob reward | ×0.98 | ×0.92 | ×0.85 | ×0.76 | ×0.65 | ×0.54 | ×0.45 | ×0.38 | ×0.32 |

Players more than 2 feed behind the lobby median get **×1.25** from mobs (catch-up; it does not count for a quest's tier brake).

### 12.4 Bounties (shutdowns)
`bounty = 10 × max(0, player kills − 2)^1.5` GV. **Only player kills count.** Mob kills still raise your feed (section 12.1), and so set the mob reward curve and the catch-up, but they never raise your bounty.

**Who gets the kill.** The player whose hit lands in the killing tick (the biggest of them, if several do). When a mob (or a shooter's arrow that outlived them) finishes a player, or a player leaves, the kill and the bounty go to the last player who hit them within 5 s, so walking into a camp or quitting cannot dodge a bounty. Sudden death credits nobody.

| Player kills | ≤ 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|
| Bounty (GV) | 0 | 10 | 28 | 52 | 80 | 112 | 147 | 226 |

- **Announcement.** When a player's bounty first appears and when it grows, the host announces "*name* is on a rampage — bounty N GV", at most once per player per 10 s. A rise inside that window is held back and announced with its value when the window ends.
- **Crown.** Bountied players wear a crown. *Not built yet:* their position flashing on everyone's minimap for 2 s every 10 s.
- **Shutdown.** Killing a bountied player pays the bounty in GV and nothing else: no stat moves (the cards you hold are yours until you die, and your body keeps your weapons for whoever takes them). The comeback is the bounty GV and the catch-up on mob rewards (12.3); there is no stat transfer.
- **Trade-off, intended.** A fed player can beat their counters, as in League. Bounties, falling rewards and the guards (12.7) are the release valves.
- A big bounty can be worth more than winning (52 GV at 5 player kills against a 50 GV win bonus). That makes hunting the fed player a goal in its own right.

### 12.5 Elite augment chests

A credited elite death drops one shared chest at its camp, with up to three distinct interactive augments. The first option uses the zone theme when available, followed by neutral options. Ordinary camp clears drop no chest, and finishing an elite's remaining escorts cannot duplicate its drop. Only live interactive effects are offered; raw stat cards and conditional stat bonuses are excluded. The chest lasts fifteen seconds, each option belongs to its first picker, and each player can pick or skip once. Existing server range, line-of-sight, action-blocking, birth-hold and expiry checks apply. Skipping heals 15% of maximum health through the normal heal lockout, or pays 3 GV within the mob pot; practice pays no GV.

### 12.6 The camp-clear heal
Clearing a camp also heals the players who fought it. Everyone who dealt damage to any mob of the camp and stands within its territory or 12 tiles of its centre when it is cleared is healed `missing × f(m)`, `m` the share of max hp missing and `f(m) = 0.25 + 0.70 × sigmoid((m − 0.40) / 0.10)`: a scratched player gets a little, one who was ganked low nearly all of it.

| hp before | 95% | 90% | 80% | 70% | 60% | 50% | 40% | 30% | 20% | 10% |
|---|---|---|---|---|---|---|---|---|---|---|
| Heal (% of max hp) | 1.4 | 2.8 | 6.7 | 13.1 | 24.0 | 38.1 | 52.0 | 64.2 | 75.0 | 85.1 |
| hp after | 96% | 93% | 87% | 83% | 84% | 88% | 92% | 94% | 95% | 95% |

Everyone leaves a camp at 83-96%. The heal ignores the 3 s out-of-combat lockout (it is not lifesteal and never counts as a hit landed); an anti-heal cuts it and Wellspring and Vampiric Pact scale it. The healed player sees a rising "+N" and the toast "Camp cleared: +N health", and a green ring marks the camp. A training room's practice camp heals too.

### 12.7 The PvP factor's guards (G1-G13)
Power decides fights through one curve (10.4), and these guards bound what a stack of cards can do. Each is a constant in `constants.ts` and a case in `server/test/guards.test.ts`.

| # | Guard | Value |
|---|---|---|
| G1 | Damage rows: 1 + the damage sum (its `vs` and `scale` rows included), times the entry's `hit`, `dot` or `returned` multiplier and any crit, never passes | ×2.5 (`OUTGOING_ROW_CAP`) |
| G2 | **PvP per-hit cap**: one player-to-player hit that is not damage over time, after mitigation | 35% of the victim's max hp (`PVP_HIT_CAP_SHARE`) |
| G3 | PvP damage over time: one source on one victim | 15% of max hp a second (`PVP_DOT_CAP_SHARE`) |
| G4 | A Race to 0: ×1 / hp fraction on damage dealt AND taken, from the hp as the tick began; the extra it adds feeds no lifesteal, whoever dealt the hit | at most ×2.5 (`HP_RACE_CAP`) |
| G5 | Lifesteal: the cards' rows before Bloodthirst's doubling; the whole share with Holy's own and Siphon | 0.25 (`LS_CAP`); 0.85 (`LIFESTEAL_MAX`) |
| G6 | A barrier (Second Skin, a skill): its size; a barrier a heal made also decays | 25% of max hp (`BARRIER_MAX_SHARE`); 5% of max hp a second |
| G7 | Bonus armor and bonus magic resist, cards and conversions together | +200 each (`BONUS_DEFENSE_CAP`) |
| G8 | Max hp: the floor; Tank Engine's total | 50% of the faction's (`MAX_HP_FLOOR_SHARE`); +250 |
| G9 | Attack speed: the rows (cards and sources) together; Boom's ×0.5 and Machine Gun's ×2 come after the cap and are held to 0.5-2, so attack speed ends between 0.5× and 3×; a ranged windup never shortens below its base-speed value; a longer interval never stretches a windup past its cap | ×1.5 (`AS_MULT_CAP`) |
| G10 | Bonus move speed from rows; Fleet is off while shooting | +30% (`MOVE_BONUS_CAP`) |
| G11 | Conversions run in one pass from the plain sums and never feed each other; the AD and the AP they give | +60 each (`CONVERT_AD_AP_CAP`) |
| G12 | Critical strike chance; a crit's multiplier; the roll is a deterministic accumulator | 50% (`CRIT_CHANCE_MAX`); ×1.5 |
| G13 | Wishes are flat, except two cards: Arcane Overload doubles the cooldown, Wishful Thinking trims it (at most 30 s in any 60 s, never below half the cooldown) | `WISH_COOLDOWN_MULT_MIN` 0.5 |

**Trade-off arithmetic.** `damagePerHit = rate × hit × dpsMult × asMult × interval`, so attack speed changes damage per second and not damage per hit until a floor binds. Here Comes the Boom's ×0.5 halves dps and doubles the interval (per hit unchanged), then its ×2.5 per hit makes per-hit damage 2.5× and dps 1.25×: no double counting; its damage over time and returned damage get ×1.25 so every faction's gain is +25% whatever its damage mix. Machine Gun's ×2 speed and ×0.5 per hit is dps-neutral and doubles on-hit procs a second. Without G2 a single Boom hit killed (0.0 s); with it the fewest hits on any kill are 3 (the cap at 25% would give 4 but clips Frost's ordinary late hits: question N7).

### 12.8 Card hooks (what the rows cannot say)
Most cards are rows (`stat`, `flat`, `vs`, `scale`, `while`, `convert`, `mult`, `flag`, `onHit`, `trigger`). The ones that need machinery use hooks; every roll is deterministic and order-free.

- **Crits.** A per-player accumulator rolled where an attack lands: each landed attack adds the crit chance and crits at 1, so Rhythm's one third crits every third attack (a cancelled windup rolls nothing). Cruel Wounds normally lets damage over time roll once per player per tick. Plague DoTs cannot crit: Cruel Wounds keeps its auto-attack crit chance and converts half the current crit chance into steady DoT damage, matching the average ×1.5 crit bonus. Thick Skull's flag zeroes crit chance. A crit is ×1.5 and shares G1's cap.
- **Streaks** (Tunnel Vision, First Impressions, Third Time's the Charm): per-target memory written after the damage pass, so every hit of a pass reads the same count; it lapses after 3 s.
- **The on-hit pipeline** (from the `hitLanded` hook): the axe's shred, Hemorrhage's bleed and every on-hit effect are multiplied by the weapon's on-hit power (sword 1.5, fists 1.2) and by the times they apply (Fists of Fury while unarmed and Third Time's the Charm each add one; Eye for an Eye lets a returned hit apply them). An on-hit effect reads the hit without the attacker's `hit` multiplier, so it is a property of the swing.
- **Blocks** (the `blocked` hook): Tank Engine's tally, Pocket Sand's slow, and Best Offense (a block counts as a hit for streaks, on-hit effects and Wishful Thinking).
- **Returned damage.** Spiked Shell queues a physical entry at 15% of a melee hit taken for the next tick; returned hits set off no trigger.
- **Overkill** (the `overkilled` hook): the damage beyond a kill is found after the pass and queued for the next tick against the nearest enemy within 200 u (it needs a third fighter, so it does nothing in a duel).
- **Adrenaline**: a trigger at 10% max hp lost in one hit, a mod source on attack and move speed (it counts toward the cap).
- **Wishful Thinking**: 1 s off per landed hit, at most 30 s in any 60 s, never below half the cooldown cast.
- **Plant Your Feet**: a stillness clock; the next attack spends it for +25% damage and range.
- **Festering Arcana**: when a damage-over-time signature stops, a magic `dot` status keeps ticking 4 more times at AP/8 (the tail is AP/2 over 4 s).
- **Gambler**: a hash of a secret salt, the tick, the attacker, the victim and the entry's place, so no order decides it; it sits outside G1 and under G2.
- **Second Skin**: `heal()` turns 30% of every heal received (overheal and lifesteal included) into barrier, held to G6.
- **Ledger additions.** A card's damage that answers a pass is queued for the next tick's ledger; entries can be `final` (every multiplier already in, the PvP factor included), `derived` (a follow-on such as a splash: it sets off nothing) or `passive` (returned damage).

### 12.9 A14: what the strongest builds do (acceptance)
`bench/augments.ts` plays the strongest builds of augments against the minute-5 kit, with the guards on: no kill under 1.0 s and a median kill at least half the base kit's (Fire's 1.1 s mirror is judged by the relative rule; where the base median is 5 s or more, Holy and Frost, the bench also prints PASS\* for a median of at least 2.5 s). Holder win % under the noise model, then median kill in seconds, per faction (fire / sentenced / plague / frost / holy); noise-free results and the verdict list are in `testing/TUNING_BALANCE.md` 7.1.

| Build | fire | sentenced | plague | frost | holy | Verdict |
|---|---|---|---|---|---|---|
| base (the kit only) | 50 / 1.1 | 50 / 5.2 | 50 / 5.5 | 50 / 15.8 | 50 / 8.8 | PASS |
| Boom | 75 / 1.1 | 65 / 4.7 | 69 / 4.7 | 44 / 10.6 | 60 / 5.7 | PASS |
| Boom + AP III | 85 / 1.1 | 65 / 4.7 | 75 / 4.3 | 44 / 10.6 | 63 / 4.5 | PASS |
| Glass Cannon + AD III | 58 / 1.1 | 81 / 3.8 | 67 / 4.0 | 54 / 10.6 | 71 / 4.0 | PASS\* |
| Race to 0 | 50 / 1.1 | 50 / 4.3 | 50 / 4.1 | 50 / 10.5 | 50 / 3.4 | PASS\* |
| Race + Bloodthirst + Leech III + Vitality III | 77 / 1.1 | 75 / 4.3 | 73 / 4.4 | 73 / 10.5 | 69 / 4.0 | PASS\* |
| Race + Boom | 75 / 1.1 | 71 / 4.0 | 69 / 3.7 | 21 / 10.6 | 27 / 3.1 | PASS\* |
| Machine Gun | 19 / 1.1 | 21 / 5.2 | 50 / 5.5 | 54 / 15.8 | 42 / 8.8 | PASS |
| Coup de Grace + AD III | 63 / 1.1 | 79 / 4.3 | 63 / 4.9 | 52 / 13.2 | 60 / 6.4 | PASS |
| Big Game Hunter + Sitting Ducks | 60 / 1.1 | 56 / 5.0 | 56 / 5.2 | 67 / 13.2 | 50 / 8.1 | PASS |
| Slow Burn + Siphon + Leech III | 67 / 1.1 | 81 / 5.3 | 60 / 6.3 | 58 / 15.8 | 56 / 8.8 | PASS |
| Rhythm + Cruel Wounds + Haste III + AD III | 67 / 0.9 | 85 / 3.8 | 81 / 3.9 | 77 / 10.7 | 79 / 3.7 | PASS\* |
| Boom + Haste III + Rhythm | 77 / 1.1 | 79 / 4.3 | 77 / 4.0 | 75 / 8.6 | 79 / 4.4 | PASS |
| Gambler + Glass Cannon + AD III | 50 / 1.1 | 79 / 3.8 | 65 / 4.1 | 60 / 9.2 | 71 / 4.0 | PASS\* |
| Boom + Gambler + AD III | 75 / 1.1 | 90 / 3.2 | 77 / 4.2 | 40 / 11.9 | 63 / 4.8 | PASS |
| Tunnel Vision + First Impressions + AD III | 73 / 1.1 | 85 / 4.0 | 77 / 4.3 | 63 / 13.2 | 75 / 4.7 | PASS |
| Glass Cannon + Tunnel Vision + Coup de Grace + AD III | 69 / 1.1 | 83 / 3.5 | 77 / 3.6 | 56 / 10.6 | 77 / 3.4 | PASS\* |
| Hemorrhage + Third Time + Eye + Haste III | 54 / 1.3 | 50 / 5.1 | 58 / 5.1 | 71 / 10.7 | 73 / 5.2 | PASS |
| Hemorrhage + Third Time + Eye | 58 / 1.1 | 50 / 5.2 | 50 / 5.4 | 56 / 13.2 | 56 / 7.0 | PASS |
| Machine Gun + Hemorrhage + Third Time + Eye | 21 / 1.1 | 21 / 5.2 | 50 / 5.4 | 65 / 11.8 | 54 / 9.3 | PASS |
| Machine Gun + Hemorrhage + Tunnel Vision | 19 / 1.1 | 27 / 5.2 | 67 / 4.7 | 73 / 10.6 | 73 / 5.8 | PASS |
| Plant Your Feet + AD III | 56 / 1.1 | 81 / 4.3 | 60 / 4.9 | 67 / 13.2 | 65 / 5.8 | PASS |
| Spiked Shell + Armor III + Vitality III | 81 / 1.1 | 71 / 5.2 | 69 / 5.5 | 83 / 13.2 | 73 / 6.4 | PASS |
| Adrenaline + Haste III + Fleet III | 48 / 1.3 | 50 / 5.1 | 56 / 5.2 | 73 / 11.9 | 71 / 5.3 | PASS |
| Overkill + Boom + AD III | 75 / 1.1 | 85 / 3.8 | 77 / 4.2 | 44 / 10.6 | 63 / 4.5 | PASS |
| Festering Arcana + AP III + Slow Burn | 54 / 1.1 | 48 / 5.2 | 44 / 5.5 | 54 / 13.2 | 56 / 7.6 | PASS |
| Race + Rhythm + Cruel Wounds + Haste III | 63 / 0.9 | 65 / 3.9 | 75 / 3.4 | 77 / 6.4 | 83 / 2.7 | PASS\* |

The Boom + Haste III + Rhythm row was measured before the final review's G1 fix (a Boom hit that crits, for a fighter with no damage row of its own, was not held to ×2.5) and is to be re-run.

What it shows, as a player would find it: **Boom** helps Fire (75%), Plague (69%) and Sentenced (65%) and hurts Frost (44%), whose slow heavy hits run into the per-hit cap (a discoverable anti-synergy). **A Race to 0** is symmetric in a mirror (about 50% for everyone: its edge exists only in unequal fights, which were not measured) and ends fights quickly (Holy's stalled mirror falls from 8.8 s to 3.4 s). **Machine Gun** is neutral on melee weapons and a bad pick on a bow or a wand (the ranged windup does not shorten with attack speed) and for Fire (its backlash is per enemy swing); it becomes a real build with Hemorrhage, Third Time's the Charm and Eye for an Eye, which win for Plague, Frost and Holy on the reference weapons and for four factions on the sword. **Vitality III** is the strongest generalist base card, **Magic Resist** matters against Plague (the only magic damage left in mirrors) and **Fleet** is a farming stat, near-dead in a standing duel. None of this was measured in a camp, against unequal kits (Race to 0) or in a duel for the Second Skin barrier (`testing/TUNING_BALANCE.md` 11).

### 12.10 Quests pay effort-based normal-mob stat stacks

Quest completion grants 8–16 whole stacks of a normal type from the destination zone, based on objective time and 40% of travel time with a 2× route premium. Each stack equals that mob's fixed stat reward; aggregate earned stacks have no ceiling. GV is unchanged and paid through the separate 40 GV per-run quest pot. Feed never changes the stack amount. Quests grant no augment or base card. Historical card tier/copy metadata remains for tuning comparisons; [Mob progression](MOB_PROGRESSION.md) defines current payouts.

---

## 13. GV economy and meta progression

| Source | GV |
|---|---|
| Win (last one standing) | +50, only if the run had at least 3 players and the winner damaged at least 2 different opponents (guards against farming with a second profile). The win still counts either way. |
| Player kill | +10 |
| Bounty claimed | Per section 12.4 |
| Mob kill | +2 (elites +10) × the mob reward curve (and the ×1.25 catch-up, so a hungry player's elite pays 12), rounded to whole GV, at most 30 per run from mobs (chest skips count against the same 30). Normal kills also pay their fixed capped stat |
| Chest skip with nothing to heal | +3, inside the same 30 |
| Quest | The offer's GV (5 to 13), from a separate pot of at most 40 a run, and 8–16 effort-based normal-mob stat stacks per completion (section 12.10) |

- **Spending.** GV buys **cosmetics only**: colours, trails, titles, golden weapon variants. Nothing that changes combat.
- **Achievements and titles.** For example, 5 wins holding the same weapon unlocks its golden variant; per-faction milestones unlock titles.
- **Monthly leaderboard.** Ranks total GV earned this month. Totals are stored per month, so no reset job is needed. Spending GV never lowers your rank. The hub shows any past month, your own place even when you are outside the top 20, and each player's equipped title.

### 13.1 Cosmetics, shop and achievements (as built)
- **Slots.** Body colour (skin), outline, trail (dots, streak, sparks), title, and one slot per golden variant (five factions, five weapons). All are coloured shapes and text; nothing changes combat. A skin colours the inner core of the body disc, not the whole disc: the rim stays the faction colour, because every player must stay readable by faction at a distance (section 15). A golden weapon look tints the weapon in hand and shows while that weapon is held.
- **Prices.** Colours 40 to 100 GV, outlines 50 to 80, trails 100 to 180, titles 30 to 200, golden variants 300 (weapons) or 400 (factions). A win pays 50 and a kill 10, so a plain colour is a few runs of play and a golden look is a goal.
- **Earned-only items.** Most titles and a few exclusive colours, outlines and trails are not sold. Each is the reward of an achievement.
- **Golden variants** can be bought, and are also awarded by achievements: 3 wins as a faction gilds that faction, 5 wins holding a weapon gilds that weapon. A golden look is drawn only while you play that faction or hold that weapon.
- **Achievements** are computed on the server from the banked run, never from anything the client reports: first kill, 10 and 50 kills, 5 kills in one run, a claimed bounty, first win, 5 and 20 wins, 25 runs, 1,000 lifetime GV, a win with each faction (a title each), a win with all five (Cycle Breaker), and the golden-variant goals above. Each unlocks once, and the results screen lists what a run unlocked. Win goals count only wins that earn the win bonus (3+ players, damage on 2+ opponents), so a win against a throwaway second profile unlocks nothing.
- **Equip.** The equipped set is read when you join a run and sent to everyone as one small number. Changing it in the hub applies from the next run.
- **Death doesn't erase GV.** You keep what you earned in a run even if you die; the win bonus is the prize for surviving.

---

## 14. Controls

**As built (Controls rework).** League-style: right-click moves, left-click locks an enemy and the server fights for you. There is no attack button to hold and no bow to draw by hand (sections 9.1 and 9.5).

| Input | Action |
|---|---|
| Right-click (hold to keep steering) | Walk there; the server pathfinds around walls, and an unreachable point is ignored. Drops your attack target |
| Left-click on or near an enemy | Lock the nearest enemy (a player or a mob) within 64 u of the cursor. The server walks you into range and auto-attacks it until you give another order, it dies, it leaves 640 u or it stays out of sight for 1.5 s. A click on empty ground does nothing. The locked enemy gets a red ring and the one a click would lock a thin light one |
| Mouse position | Aim for the shield: it faces the cursor while nothing is locked, and the locked enemy otherwise |
| Swap key (Q), 1 and 2 | Switch weapon slot (a lock stays) |
| F | Pick up a weapon from a weapon chest, the ground or a body. A camp's skill chest holds no items: it is not taken with F |
| C | Focus the camp chest panel while one is open (section 12.5). Then **1**, **2**, **3** take the first, second or third card, **0** skips, and **C** or **Esc** give the keyboard back to the game. The digits and Esc belong to the panel only while it has the focus, so 1 and 2 switch weapon slots as ever otherwise |
| D | Cast your faction's Wish (section 8.8): 300 s cooldown, locked for the first 45 s of a run. Freeze and Trial take the enemy nearest the cursor (within 64 u, like a left-click), Blaze Step blinks toward the cursor, Swarm and Last Stand need no aim |
| S | Stop: stops walking and drops the attack target |
| Hold Tab | During a run: the whole map with your route and where you are; let go and it is gone. It does not take Tab from a text field or an open settings or help card |

Every attack roots you for its windup (section 9.5): you can walk between attacks but not during one. An attack your lock started is cancelled by your next walk, stop or lock on another fighter (9.5); a mob's, which is not a click, stays committed, and a walk ordered during it starts when it ends.

The chest panel never takes a click meant for the world: only its cards and the Skip button catch the pointer, so a left-click elsewhere still locks a target and a right-click still walks. You can also click a card or Skip with the mouse, or keep fighting and pick by key.

**Planning screen.** While the room plans (section 3) nobody moves, so none of the above works; the screen has its own controls:

| Input | Action |
|---|---|
| 1 / 2, or click a spawn card | Pick the first or second dealt spawn (the other lets go) |
| Click on the map | Add a route stop; a click on a stop takes it out (up to 12) |
| Arrow keys, Home, End | Move between the map's markers (the spawns, the camps, the route's stops) |
| Enter on a camp | Add a route stop there |
| Delete on a route stop | Take it out |
| Tab | Move between the options and buttons |
| Ready | Lock your pick; the run starts early once everyone connected is ready |

Settings add "Show route" (the route on the minimap and the Tab map) and a map text size of 100%, 125% or 150% (these screens only).

---

## 15. Feedback and readability
Hard counters are only fair if you can see them coming.

Personal sight is a full circle with a radius of 900 ground units, independent of viewport width. Walls and closed gates block new sight. Every revealed tile continues providing live vision for two minutes after its last refresh, including moving enemies. Camp wards add live sight for their owner only and leave no residual trail. Swarm still hides remote fighters. Actor rendering, combat effects, minimap dots, targeting and hover information follow vision. Reconnecting restores the player's unexpired trail through a private message. Planning and training retain an open view.

Visible opponents produce independent diffuse glows at the screen edge in their projected direction. Distance uses the ground plane: red within 150 units, yellow around 525, green at 900 and beyond. Bearings adapt to the viewport; several opponents can light several directions. Peeking does not change the player's vision origin.

| Feedback | What you see |
|---|---|
| Faction and weapon at a glance | Every player wears their faction colour and shows a weapon silhouette, readable at a distance |
| Damage flash | A red vignette when you take a real hit, scaled by damage. Small ticks don't flash. |
| Vision edge hue | Each visible opponent lights the screen edge in its direction: **green** far away, through yellow, to **red** nearby. This replaces the earlier matchup tint during raids; damage flashes remain. |
| Your target | A thin light ring on the enemy a left-click would lock, a red ring on the one you have locked. The bow's pull is drawn from its synced start, so everyone sees a draw build |
| Wishes | A small icon of each fighter's Wish by its name, grey until it is ready. A telegraph over every cast that has a cast time (Freeze's beam, Swarm's gathering swarm, Trial's growing ring); an effect on every fighter under a status (stun stars, shackles, a gold rim, a dashed outline, speed streaks); the cloud, the ring and the trail drawn on the ground. Blaze Step and Last Stand have no telegraph before the cast (section 8.8) |
| Sentenced | A visibly growing brand on the marked target |
| Holy | Heal numbers when lifesteal lands |
| Plague | A "below half" execute cue on its target |
| Fire | A burst of flame on any enemy who swings while engaged with Fire |
| Frost | Frost on chilled enemies |
| Fed players | Crown and rampage announcements (minimap pings are not built yet) |
| Your cards | A cards row under your HP: one chip per card you hold (a stacked card shows its count) with its tier, and a tooltip with what it does, its tags and the glossary line of each. Under it a build strip: AD, AP, armor, magic resist, attack and move speed, lifesteal, your card power and the PvP factor ("PvP ×1.39"). Both take no pointer; the tooltips are found by hit-test. Every term has an entry on the Mechanics page of the help card (`H`) |
| Card and heal news | A line for your own pick ("You took Haste II"); "Armed: Bow" when a mob's weapon fills an empty hand; and after a camp you fought is cleared a green ring on its centre, a rising "+N" on each healed player and the toast "Camp cleared: +N health" |
| Your hits | A critical strike's number is bigger and has a "!"; a card's bleed shows as small drips rather than a hit |
| Camp chest | While you stand within 88 units of a live chest, a card on the right edge: the camp's zone and name ("Plague camp"), a countdown, three cards (title, tier badge, an augment's rarity frame, why it is on offer for you, what it does, its tag chips and who took it) and Skip. Cards grey just before the chest vanishes. In the world the chest wears a pick-range mark and a ring and timer that drain over its 15 seconds, with a cue when it drops. Your own pick is a line ("You took Haste II") |
| Camps | The minimap and planning/Tab map mark cleared and engaged camps. The public Camps & wards dock lists every camp's remaining mobs, ward owner/expiry and respawn countdown outside vision. A ward beacon shows remaining seconds at the camp. Each respawn resets the camp to idle. Live chests have pulsing map blips and seconds left. |
| Barrier | A pale-blue bubble around the player, a blue segment on the HP bar and "+N barrier" in the readout, for everyone to see. Second Skin gives one (up to 25% of max hp, decaying) |
| Planning screen | The whole map with the zones (each a colour, a floor pattern and a marker shape), every camp (its mob type, its role and the weapon it drops, a crown on an elite camp, your matchup against it with a sign and a tone: "+62%", "~35%", "!10%", "lose"), the weapon crates, your two spawns with "taken" live, who is in the room and who is ready, a countdown and the route you draw with its walking time. The lobby shows the same map small and read-only; in a run, hold Tab. The HUD line reads "Planning 0:07" |
| Mobs | Faction colour and weapon like a player, with a role mark on the disc (swarm: small dots, skirmisher: a chevron, caster: a ring, brute: a thick rim); the HP bar shows once a mob is hurt or fighting, and an elite's always shows. Elites wear a gold ring and a star over a gold name. A fallen mob shrinks and fades, and its weapon stays on the ground. Living mobs show as dots on the minimap |
| Patience timer | Always on the HUD; a 30-second warning and a host voice line before the teleport |
| Counter wheel | In the hub, both pentagrams with your pick highlighted |

---

## 16. How it's built (short)
- **Authoritative server.** Colyseus 0.18 runs the game at a fixed 20 ticks per second. Clients only send inputs (move, stop, target, aim, swap, pickup, cast, choose at a camp's chest, and plan during the planning step; the low-level attack and release stay for mobs and the harness); the server decides every hit, death and reward, and since the Controls rework it also plays the fight of a locked target (walking, attacking, aiming).
- **Client.** Phaser 4 draws the world in a fake-3D angled view. Every other fighter is drawn 100 ms in the past and smoothed, so motion looks fluid; your own fighter is predicted, so an order answers at once, and each server patch pulls it back in line.
- **Hits feel fair under lag.**
  - A low-level melee attack checks against where things were when you clicked ("what I saw is what I hit"). A locked attack, which is all the game client makes, is timed in the present, one tick back, and aimed at its target as it lands.
  - Arrows and balls fly in real server time; each one is sent once and its straight flight is computed on every screen.
- **The map is seeded and certified.** Only how to build the map is sent: the seed, the generator attempt and a hash of the finished map, plus the gate state. The server, the bots and every client run exactly that attempt of the generator, which is deterministic to the last bit (it avoids the floating-point functions that two JavaScript engines may round differently), and a client whose map hashes differently is told to reload and leaves the room. The cosmetic props are left out of the hash, so the server builds without them. Every map is certified as it is made (connectivity with the gates open and closed, the spawn pool's 10-tile rule and its 1.2 walk-ratio gate on the real pathfinder, equal zones, camp spacing, every wall owned by a named feature), and an attempt that fails is thrown away: nothing is relaxed. Over 2,000 seeds a seed takes 1.009 attempts on average and none is discarded.
- **Maps are made ahead.** A worker thread on the server keeps 8 certified maps ready, so a room takes one at once (0.03 ms) instead of generating its own on the event loop (about 33 ms, 64 at p99, 80 at worst). If a burst empties the queue, the room generates one on the spot; if the worker dies or hangs (no answer for 5 s while maps are owed), it restarts with a growing delay and rooms keep working. The client builds the map in a Web Worker behind the loading screen, after warming it up while the hub is idle.
- **Hidden information.** The planning deal (which two spawns you were dealt, and which are taken) is drawn from a private server stream and reaches you only in your own private message, never in the shared state; camp rosters come from the same stream but are published, since the planning screen shows them, and so are a camp chest's options, which are rolled from it too: a chest is contested, so its contents and its takers are public state (section 18). Your route stays in your browser and is never sent.
- **Vision boundary.** Trail memory is private server runtime, restored through a private reconnect message. Locks and unit-targeted abilities require server-verified vision. Actor state and effects still use the existing shared network stream; clients cull their presentation. Per-recipient filtering against modified clients remains unimplemented.
- **Persistence.** Profiles (GV, stats, cosmetics) live in a crash-safe JSON file behind a store interface, so a database can replace it later.
- **Bots.** Bots fill lobbies, play full runs and power the end-to-end tests (`docs/BOTS.md`). One human-like brain sits behind two drivers: the server's own fill bots (inside the room, with no profile or connection: up to `BOTS_FILL_TO`, 6 by default, arriving in the last seconds of a lobby, tagged `[BOT]`, never paying GV or a bounty to whoever kills one and never counting for the win bonus) and the `npm run bots` network client. They see what a player's screen and minimap show, answer in a few hundred milliseconds, miss clicks, and play like a person with the game's controls: they walk, click their foe (`target`) and let the server fight, swap and pick up weapons, cast their faction's Wish by the intent tags of the ability, and step off embers. At the planning screen they read for a few seconds (2 to 8, by skill tier), pick one of their two dealt spawns by the matchup of the camps nearest it (the better one nearly always at Hard, sometimes the worse at Easy) and press ready. They walk to a cleared camp's chest and take a card (`choose`). Not built: the quest decision module, the Q/E skills and relics, and a penalty for hunting a fighter whose Wish is ready (`docs/BOTS.md` 8).

---

## 17. Balance and verification
- **The design oracle** is `python3 testing/test_rpsls.py`:
  - the 10-edge graph at four timesteps;
  - each faction beats exactly two;
  - power-scale invariance;
  - name-shuffle invariance;
  - ±3/±5% jitter robustness (±10% is reported only: the compressed edges sit inside it);
  - a purity audit (no faction names in the rules);
  - the identity tests.
- **Parity.** The game's TypeScript copy of the faction rules must reproduce the Python results for all 20 matchups.
- **Harnesses** (they report, never block the build):
  - the weapon loop, scripted duels per weapon pair;
  - the faction cycle per weapon (5 weapons × 10 edges);
  - kiting tolerance.

  `python3 testing/realtime_report.py` (needs numpy, about a minute) runs the last two as 20 Hz weapon duels, with signature openings, buff thresholds and the longest stretch with no swing. `python3 testing/test_kite.py` (about 10 s) is the kiting guarantee at duel pace against a shooter that walks between its rooted shots (a perfect orb-walking underdog may win at most 65% under the noise model, section 9.6: one PASS, EXCEPT or FAIL per cell), and `python3 testing/kite_windup_sweep.py` (about 10 s) sweeps the bow's and the wand's windups against the older, stricter measure (a stress test now, not the gate).
  Results go to the designer before any tuning.
- **The real-sim weapon harness**: `npm run harness -w @raid/server` (`-- --core` for a 30 s run without the sensitivity passes). Every weapon duel plays out in the real sim with two policy-driven clients; it prints the weapon matrix, a style grid for every edge with a ranged weapon (a ranged fighter can stand, strafe or kite; a melee fighter can charge straight or **weave**, approaching off the line and changing side every 0.4 s), an edge verdict (holds, or fails and why, with the factions where a reply is thin), the same edges when both fighters click each other (the target lock), and the kiting table (a shooter that never moves, stands, strafes, kites, **orb-walks** (the perfect kiter: it stands only for its windups) or **locks** its chaser). `-- --grid-setups full` runs every grid cell on all 18 setups instead of 3 (steadier, about 3 times the time).
- **Mob and camp strength** (report only): `npx tsx packages/server/bench/mobDuel.ts` plays a starting player against one mob of every region (`--style stand` is the measure of section 11), and `npx tsx packages/server/bench/campDuel.ts` against a whole camp. Its `camp` pull places the mobs with their camp, so the first hit wakes them all through the real aggro rule; `single` (one at a time, the camp before R5) and `group` (all awake at the start, harsher) are kept. `--size N` sets the camp size, `--k` and `--elite-k` try another scale, and `--sweep` prints the pairings cleared (of 25) per scale and size. A run starts on fists, so both benches start a player on fists unless `--weapon` says otherwise (`--types` prints one row per mob type and checks the gates); the target is at least 20 of 25 faction × zone pairings clearing a full camp of 4, and it measures 24 of 25 (4 seeds).
- **The faction cycle in the real sim**: `npm run harness:factions -w @raid/server -- --python` plays every edge with the same weapon on both sides and on the signature openings, with each hit and shot landing in the tick it starts, and checks it pair by pair against `testing/realtime.py` (70 of 70 cells agree, fists included). `-- --mode policy` plays them as moving fighters by the shared weapon policies from 18 starting setups, with staggers, blocks and projectile flight; its failing cells (the four shield mirrors and Plague's bow against Frost's shield) are weapon-layer problems, listed in `testing/TUNING_10.md` section 6. Both report and never block the build.
- **The balance benches** (report only; `testing/TUNING_BALANCE.md` has the definitions, the tables and the acceptance record). Each plays real-sim duels with the lock's controls and the play-noise model (`DuelSpec.damageScale`, sigma 0.45), and each acceptance line prints PASS, WARN or FAIL against a target and a tolerance: `npx tsx packages/server/bench/ttkCurve.ts` (A1-A5: the time-to-kill curve by minute), `matchups.ts --layer faction|weapon|fed` (A6-A9: the ten faction edges, each weapon edge pooled over the 25 faction pairs, a fed player against a fresh one), `farmVsFight.ts` (A10: does farming pay), `augments.ts` (A14: the strongest builds, the guards on), `pickValue.ts` (what one card is worth in a mirror duel), `mobExecute.ts` (A13: the Plague mob's execute) and `botPicks.ts` (what bots take from the chests); `mobDuel.ts` and `campDuel.ts` are A11 and A12.
- **Budgets.** Server tick time with 8 players and the map's ~160 mobs, bytes per second per player, and what a map costs to make.
  - **Tick:** At the zone-shapes merge (136 x 136, 177 mobs on the bench maps) `step()` averages 0.51 ms with a p99 of 1.25 ms, 0.62 / 1.58 ms in the pathfinder's worst case (`--stress`) and 0.38 / 0.74 ms with every buff at 4 stacks (`--buffs`, before the cards replaced the buffs); with 8 in-process fill bots the whole tick is 0.74 to 0.87 ms. On R2's 96 x 96 maps (about 80 mobs) `step()` with 8 players at 8 camps averaged 0.2 to 0.4 ms and its p99 stays between 0.6 and 1 ms; the pathfinder's worst case (`--stress`: about 72 mobs awake, 52 fighting, 7.4 of 8 players holding a lock, every camp woken every second) averages 0.33 to 0.6 ms with a p99 of 0.9 to 3 ms (0.36 / 0.91 ms and `--stress` 0.60 / 1.44 ms on the R2 + R5 tree at load average 20; 0.22 / 0.44 ms on the balance-pass tree); every live card once on all 8 players (`--cards`) is a case of its own (gate: 5 ms average, 15 ms p99 for each case, best of five attempts, judged by the smaller of wall-clock and CPU time). `npx tsx packages/server/bench/stepBench.ts [--cards] [--stress]`; `test/perf.test.ts` is the gate, and `test/pathLoad.test.ts` counts the path searches (97 a second against a throttle ceiling of 304; 0.03 ms each, 1.5 ms at worst).
  - **Bandwidth:** per client, websocket payload, measured headless with the real encoder: at the zone-shapes merge (136 x 136, 177 mobs) 6.49 and 7.18 KB/s typical at seeds 1 and 2, 10.59 and 9.81 with eight whole camps woken every half second, 3.25 and 3.31 idle, 6.82 and 6.84 with five camp chests up, and a joiner's first full sync of 22.5 to 23.9 KB (the schema encoder's buffer is 64 KB for it); on R2's 96 x 96 maps (about 80 mobs at `MOB_K` 0.22, seeds 1 to 5, 732 and 2547): 6.1 to 7.1 KB/s typical, 8.9 to 10.6 KB/s with 20 to 25 mobs fighting (eight whole camps woken every half second, the most 8 players can pull), 6.0 to 7.0 KB/s typical with five camp chests up, and 3.1 to 3.3 KB/s with nobody fighting; a joiner's first full sync is 11.6 to 12.7 KB (gate: 20 KB/s; the figures of the 60-mob wedge map, 7.1 to 8.0, 9.4 to 12.1 and 3.0 to 3.2, are not comparable: that bench woke one mob at a time). Sleeping mobs cost nothing. Two things hold it down: all of a step's fx travel as one compact message (`fxs`, which also announces each arrow and ball: they are not in the synced state), and the synced numbers are narrow on the wire (float32 positions, uint32 timers). `npx tsx packages/server/bench/bandwidth.ts`; `test/bandwidth.test.ts` is the gate. StateView is not needed yet, and would help most on this larger map. The plan's 16.5 KB/s for the heavy case is a report-only target, not asserted. A reward chest's three arrays (`options`, `takenBy`, `pickers`) are on every weapon container too and cost 0.14 to 0.24 KB/s. On the balance-pass tree (seed 1, on the 96 x 96 maps, before the zone shapes) typical is 7.05 KB/s, heavy 11.48, idle 3.45 and five camp chests up 7.00.
  - **Map generation:** at the final review about 33 ms on average, 64 ms at p99 and 80 ms at worst (300 seeds, the server's path) (the targets are 45 and 120). The lane tables are gone (four of them took 44 MB per process and 40 to 75 ms to build); warming the layouts takes about 7 ms. `npx tsx packages/shared/scripts/mapBench.ts` prints the time per stage against the targets; `mapgen.perf.test.ts` gates the median, scaled by a yardstick measured on one machine. In Chrome a 136 x 136 map bakes in 95 ms on the worker path and a join reaches the scene in 354 ms (1x CPU; 4x throttle not measured).
  - **Certification sweeps:** `npx tsx packages/shared/scripts/mapSweep.ts <count>` runs an independent certifier, written apart from the generator, over seeds 0 to 1,999 (16 shards): no failures, no decor mismatch and no discards, and per-zone measures (rays, engagement pairs, camp-graph stretch and loops, wall pieces, features) judged against windows, with two report-only breaches, the Rime's rays at bow range and its ice share (section 5.3).
- **End-to-end.** Bots play full arena runs to a winner, with GV and bounties balancing exactly.

---

## 18. Open questions and known risks

| Topic | Note |
|---|---|
| Long fights and third-partying | In an 8-player arena, long duels invite a third player to clean up. Duel pace ×2 helps; it gets watched in playtests. |
| Readable counters | Losing to a counter you didn't see coming feels random. Faction colours, weapon silhouettes and the counter hue are the mitigation. |
| Kiting | Equal move speed lets ranged weapons kite. Held back by short ranges (bow 240 u, wand 220 u), by every attack rooting its shooter for a windup (bow 0.92 of the interval up to 0.6 s, wand 0.8 up to 0.4 s; nothing can shorten them) and by ranged damage no higher than the melee weapons'. Since the compressed sheet the check is that a perfect orb-walking shooter (it roots for its windup at each shot and walks between) **wins at most 65% of its duels under the noise model** against the melee faction that beats it (section 9.6): it passes in all 20 cells with one named exception, Demon Blood over Fire against Fire's wand (r_kite 0.64 against the 0.78 the others hold, a recorded floor of 0.62). The margin is a few percent: a windup tweak, a range increase or a melee cut can flip it, and the model was designed without attack-speed cards (it holds to ×1.25 only; attack speed is capped at ×1.5 on the owner's ruling, and the real sim's KITE EDGES held to ×1.5 on the first sheet and have not been re-run on the compressed one). Frost's movement slow now thaws over four seconds, so its wand cannot keep a chaser outside reach forever. In the real sim the harness's perfect orb-walker is worst at x1.40 for the wand against a motionless shooter (sword against wand), and it is an upper bound: a right-click drops the lock, so each step of an orb-walk costs a click to move and a click to lock again (`testing/TUNING_CONTROLS.md`). The maps no longer cap sight (the 480 u cover is gone, owner ruling), so this guarantee rests on the windups and the ranges alone; the zone duels of section 5.3 measure what the open ground costs. The check and the harness never cast a Wish: `testing/WISHES.md` reasons about what Freeze, Blaze Step, Last Stand, Swarm and Trial do to them: Freeze and Blaze Step each end one approach's worth of kiting, Last Stand cuts a Holy chaser's free fire by a quarter to a half, Swarm is outside the model, and in a what-if Trial flips Fire over Sentenced (section 18, W5). |
| Weaving melee approach | (Measured before the Controls rework, with the old ranged move slows. After it, in the real sim: Bow over Sword 100% / 93% / 100% and Bow over Axe 93% / 100% / 93% against a straight charge / weave / jink, no thin Fire column for either, but Wand over Shield fails, below.) The weapon edges were tuned against a melee fighter that charges straight, then re-checked against a weave and a quick jink. All ten hold (Bow over Axe 82% against the jink once the axe is at 0.77; it was 44% at 0.8), but the Fire column stays thin for Bow over Axe, Bow over Sword and Wand over Shield (11 to 44%): Fire's 500 HP make hit-count cliffs, so a faction number (Phase 10) or a projectile that leads is what would move them (section 9.4, `testing/TUNING_9_1.md`). |
| Frost frustration | Frost still controls attack cadence, but the movement slow fades after four seconds so repeated hits cannot keep a runner slowed forever. |
| Frost against a chilled shooter | The movement slow applies only within 100 u and thaws over four seconds even during continuous contact. Leaving range removes it while away; four seconds clear resets its full strength. The attack-speed slow remains tied to engagement. |
| Controls are best guesses | The owner may overrule these (section 9.5): a windup the lock started is cancelled by the player's next order, as League does, with the cooldown refunded (a mob's stays committed); the click snap is 64 u; an empty click does nothing, so there is no attack-move; a lock is accepted and kept out to 640 u, and breaks after 1.5 s out of sight; it survives a swap or a pickup; the shield faces the locked enemy, else the cursor; a locked shot flies straight and can be dodged; the bow still ignores stagger. |
| Wand over Shield in the policy matrix | After the Controls rework the weapon harness's policy wand loses to its policy shield, 23% (19% in the balance pass's last run; Sentenced and Frost at 0 in both; 100% before). It holds at 100% when both fighters click each other. The harness wand backs away from a charging shield, which with no ranged slow no longer pays; longer wand windups did not fix it and broke Axe over Wand. Reported, nothing changed, the ranged slows were not brought back. Owner call: accept it, or give the harness wand no back-off (`testing/TUNING_CONTROLS.md`). |
| Sentenced feel | Its weapon hits are nearly zero by design; the brand visual has to carry the class. |
| Fire's burn | Still the small part of Fire's damage (18 a second against the backlash's 58 to 92 against Sentenced and Plague). Ability Power adds 0.6 per point to it, so a burn build exists for a player who looks for it. |
| Frost over Fire | The widest edge of the compressed sheet: Frost keeps 36% hp in the engine (the top of the 10-35% band), wins 76% of fists duels under noise and the underdog's 24% is the floor the pass held; on the bow and wand sets it reads 79 / 21 (open question N3). Fire's backlash reads the foe's attack rate, so a faster Frost feeds it. |
| Snowballing | The PvP factor (×0.75 to ×3.0 by card power) plus bounties and falling mob rewards need playtesting: are fed players fun to fight, is hunting them worth it, and is a fresh player's weak early damage (×0.75) fun? A fed player deals 3.4 times a fresh one's damage by design (Q9). |
| The faction cycle matters most late | Early fights are mostly weapons, positioning and third parties. The cycle decides the 1v1s, often in the coliseum. |
| Bounties within a tick | If several players hit a fed player in the same tick, who gets the payout has to be decided by a fair rule. |
| Cards past the counters | The per-kill buffs this row once measured are gone. On the compressed sheet a fed player beats the counters on purpose (a minute-5 kit beats a fresh fighter on fists in all 25 pairings and keeps 86% hp) and the guards bound the stacks: no build kills any faction in under 1.0 s outside the Fire mirror and the fewest hits on a kill are 3 (section 12.9). **Ruled:** fed players may beat their counters: the damage rows are capped only by G1, attack speed from every source is capped at ×1.5, and a buffed shooter beating Holy over Sentenced is accepted with no retune. Not measured: a buffed chaser, several cards on one shooter beyond the A14 bench, and the real-sim kiting check on the compressed sheet with cards. |
| Weapon edges inside one faction | (Measured before the balance pass.) With signatures on, several weapon edges flip when both fighters are the same faction: in a Fire mirror Sword over Axe goes from 100% to 0% and Sword over Wand to 11%; in a Sentenced mirror Sword over Axe, Sword over Wand and Axe over Wand go to 0%. Sentenced's damage is almost all the mark times the weapon's damage multiplier, and a Fire sword's staggers cancel axe windups, so the axe swings less and takes less backlash. Owner decision: the weapon loop is designed for the faction cycle's openings, and nothing was retuned (`testing/TUNING_10.md` section 8). |
| Wishes: no warning before Blaze Step and Last Stand (W1) | Both are instant (no cast time), so their tell comes only after the cast: a flare at both ends and a trail, a gold burst and a rim. A blink with a pre-cast is no escape and a survival button with a delay loses to burst, which is why they have none, but an enemy gets no read on either. Owner call: keep them instant, or give them a short telegraph. |
| Wishes: Swarm hides only on an honest client (W2) | The browser does not draw a hidden fighter and the server refuses every lock and ability on it, but every client still receives every position and the server still accepts the low-level `attack` input, so a modified client can find the fighter and attack its true position. The fix is interest management (per-client state) and refusing `attack` from game clients; until then the cloud marks the place for everyone anyway. |
| Wishes: Last Stand at the teleport and in sudden death (W3) | A Last Stand running when the coliseum teleport comes ends and still pays its heal (the damage was real and the teleport is the arena's, not an enemy's). Its 5 s floor also keeps a fighter alive through sudden death's burn for 5 s, which can decide a finish. Owner call: keep both, or pay nothing at the teleport. |
| Wishes: Trial's ±20% is relative (W4) | Everything else about a Wish is flat, but Trial's ×0.8 and ×1.2 scale with what the two fighters deal, so a fed caster gains more from it. It is the owner's rule. |
| Wishes: Swarm drops its caster's lock (W9) | Casting Swarm drops your lock, and only the lock: your walk goes on after the cast, because an escape must not stop you. Otherwise a Plague locked on a foe kept swinging out of the cloud and was revealed at once, so the 300 s escape did nothing. The cost: a Plague that wants to fight from it must click again, which shows it for the swing and 0.5 s. Owner call: keep it, or keep the lock and have a hidden fighter's lock hold no trigger. The bots slip away while their Swarm is casting and hidden and never lock anyone then. |
| Wishes: numbers are best guesses (W5) | Every Wish number, the trail's burn (30 true damage a second for 2 s, about 60 a crossing), the 5 s practice cooldown, and the maximum times and caps in the status table (8.9). A balance pass retunes them; the harness and the kiting check do not cast. The first thing to look at is Trial against a charging Fire: in the 20 Hz what-if its x1.2 and x0.8 over a 2.5 s duel (inside the 5 s ring) cut Fire over Sentenced's tolerance from 1.89 s to 0.88 s (bow) and 1.74 s to 0.83 s (wand) against 1.16 s and 1.49 s of free fire (`testing/WISHES.md`). |
| Wishes: stunned shields still block (W6) | A stun freezes facing but not the guard: a shield blocks toward where it faced, so a flank beats a stunned shield and the frontal hit still bounces. Owner call: keep it, or let a stun drop the guard. |
| Wishes: reconciliation with the roguelike plan (W7) | Settled: the attack slow is wired as a stat-mirror source, Frost's chill stays a faction signature and is not a status, and the statuses hold still while damage lands. Left for the skills phase: `barrier` and a crowd-control immunity are appended (three effect bits are spare), the move-speed status hands its slows and haste to the speed mirror when that lands (it then keeps only the stop), and an ability's effect list is meant to be the roguelike plan's on-trigger action list (settled for `status` and `cleanse`, which `TriggerAction` now takes from `AbilityEffect`; only `heal`, `barrier` and `cooldown` stay trigger-only until the skills phase). |
| Wishes: the end-to-end runs require a Wish (W8) | The bot e2e replays once if no bot's Wish landed, as it does for a kill, a signature hit or a mob kill. If that ever fails twice, keep the invariants (no cast before the lock ends, at most one cast per bot, every fx names a player) and drop the requirement rather than loosen the others. |
| Camps: how hard is a pull (R5) | The camp wakes together (owner ruling), so camp strength was retuned: MOB_K 0.22, ELITE_K 0.65. A starter on **fists** (every run starts there) clears a camp of 4 in 24 or 25 of 25 pairings and every normal type's camp in at least 80% of runs; elite camps clear in 4 to 10 of 25, on purpose (section 11, `testing/TUNING_BALANCE.md` 9). The figures come from one scripted player with no cards, never humans or camp-mates: playtests will move MOB_K, ELITE_K, the role numbers and the leash. The elite lever is ELITE_K. |
| Shared chest: public contents, hidden pickers (R5) | A chest's options and takers are in the synced state (D17: contested, and they must survive a reconnect), so a modified client reads every chest on the map; the panel merely hides them out of range. A pick names its picker even while Swarm hides it (a pick is not a reveal), which shows a hidden player is within reach of that chest. Interest management would cover the first; whether a pick should reveal like a cast is the owner's call. |
| Shared chest: the panel's clock (R5) | The panel greys its cards at the chest's expiry minus (half the round trip + 50 ms), but the round trip it uses is the prediction's order delay, not a measured ping, so a very slow or jittery link greys a card late or early. Some refusals (an option the chest lacks, a phase that is not active) are silent, and the panel then says "not confirmed" after 0.6 s. |
| Cards are first picks | The numbers beyond tier I and the augments' are first picks, tuned by the acceptance pass only where a gate asked (Machine Gun's hit multiplier, Tank Engine's rate, A Race to 0's lifesteal rule). Only Quickdraw and the Fleet cards were run through the kiting check, and as the passives of the first sheet. Open: whether 2.5 s is too long a pause for Fleet (a shorter one lets the boots back into the gap a chilled shooter idles in), and Last Rites' +25% attack speed against the ×1.5 cap. |
| The Rime's ice | Solved by the zone shapes: the cover that put a rock in every 3x3 is gone, and the Rime has two ice lakes (590 tiles a map, 17.4% of its floor). What remains is a number the owner may overrule: its rays reach bow range in 81.7% of cases against the 62 to 78% the contract expected (only 6% of maps inside it), because the lakes make it the most open zone, and ice is at least 12% of its floor on 94.5% of seeds against a target of 95%. Lever: more headlands, or accept it. |
| Two Rime meres (Zone shapes, owner question 1) | The Rime has two meres of about 295 ice tiles each (590 a Rime, ice share 17%; each lake is grown to 400 tiles and the lanes, headlands and spire take the rest), the default. The alternative is one mere grown toward 700 tiles, which would hit the clearance of a camp's clearing at about 450 tiles and so read as a smaller share. |
| Loot density on the bigger map (Zone shapes, owner question 2) | The map has twice the area, and loot scales with its square root: 4 to 6 crates a zone (20 to 30 a map) and 30 to 45 ground spots a map (one pick for the whole map; the default), a density of 0.72 of before with the nearest loot about 17% farther. The alternative keeps the density: 6 to 8 crates a zone and 40 to 60 spots a map. |
| Longer spawn walks (Zone shapes, owner question 3) | A start to the coliseum centre is 57 / 62.6 / 67 tiles (10th / 50th / 90th percentile), 10.7 / 11.8 / 12.7 s, against 50 tiles and 9.4 s at the median on the 96 x 96 map, measured the same way (the walk the gate certifies and the planning screen shows). The patience timers (300 s first, 120 to 300 s after a death) and the teleport are unchanged (the default); in the tournament at the zone-shapes merge the teleport came in 92% of games (50% on the 64 x 64 map) and games lasted 327 s. Retune any of them if it feels slow. |
| The Rows' headroom (Zone shapes) | The Rows were approved on condition that Fire still beats Sentenced at a fence, and it does (96 of 96, hp margin +50 against +63 in the open), but the worst pocket has a margin of +24 at the built gate period of 12 and about +5 at 16. In the real Gallows the fenced Fire over Plague duel is 91% against 100% on open floor. The gate spacing is the lever if melee should have it easier; widen it only with the condition rerun. |
| Generation cost (Zone shapes) | A certified 136 x 136 map costs about 33 ms on average, 64 ms at p99 and 80 ms at worst in Node (300 seeds, the server's path; targets 45 and 120), 1.009 attempts a seed over 2,000 seeds. The styler stage reads 12.1 ms against a target of 10 and the landmark stage 2.5 ms against 1 (report-only). |
| Balance pass, decided (Q2, Q4, Q8, Q9) | **Q2** the compressed sheet is accepted: Fire 835 hp and 100 hit leaning on burn and backlash, Frost 1,200 hp and 175 hit, Sentenced's mark ramping in 2.1 s paced (all identity tests pass). **Q4** a mob's weapon drop goes straight to an unarmed killer, with nothing on the ground. **Q8** Thick Skull reads "+30% max health, but your hits can never critically strike". **Q9** the PvP factor keeps its ×3.0 ceiling: a fed player (P 10 or more) deals 3.4 times a fresh player's damage, so farming dominates fights by design. Also in force: attack speed is capped at ×1.5; Wishes stay flat; all mob power comes from credited kills without per-type ceilings; builds are discovered, not forced (no card text names a faction or a weapon); quests pay their GV through `completeQuest`'s separate 40 GV pot and grant 8–16 effort-based normal-mob stat stacks. |
| Balance pass, best guesses the owner kept (Q1, Q3, Q5, Q6, Q7) | **Q1** the variance model: sigma 0.45 of execution noise per fighter (each fighter's damage times `exp(0.45 Z)`) is the definition of an "even duel" behind every win % in `testing/TUNING_BALANCE.md`. **Q3** the kiting guarantee is "a perfect orb-walking underdog wins at most 65%", with one named exception (9.6). **Q5** signature damage types (burn and disease magic, backlash physical, the mark true) change Holy over Sentenced and Plague over Holy. **Q6** Whetstone, Swift Boots, Thick Hide and the 12 declared-only passives left the chest. **Q7** the augment Glass Cannon echoes Fire's role line ("Glass-cannon duelist") on the faction card. |
| N1: the weapon scalings | Axe AD 1.0, bow AD 1.0 and wand AP 1.0 against the contract's 1.2 / 0.9 / 1.2, needed to hold the loop at minute 5 (it drifted to Sword over Axe 45, Bow over Axe 49 and Wand over Bow 86 otherwise). Keep, or restore and retune the axe and wand multipliers with the Python tables. Recommended: keep. |
| N2: `BALL_AFTER_ARROW` 0.6 | Keeps Wand over Bow at 77% at minute 5 but loses the reference-set opening Holy over Sentenced noise-free at minute 0 (43%). The alternatives: 0.7 (Wand over Bow 83%, over the ceiling) or another reference weapon for Holy or Sentenced. Recommended: accept 0.6 (a run starts on fists, and the opening is reported, not judged). |
| N3: Frost over Fire and Fire over Plague | Frost over Fire reads 79 / 21 on the bow and wand sets (the underdog floor of 24 missed by 3) and Fire over Plague keeps 36% on the axe and shield sets (tolerance 35). The sheet was left alone: a change means regenerating the Python references and re-running the oracle and the kite check. Accept, or a Frost hit −5% or a Fire armor pass through the optimizer. |
| N4: the minute-5 Frost shield mirror | 2.94× the median TTK (tolerance 3×): the shield's kit holds three armor cards, so a shield mirror is a wall that the PvP curve cannot move against the median. A kit or a defense-scaling decision. |
| N5: the literal per-step A3 reading | Minute 0 to 1 is ×1.96 by design (fists to the first weapon ×1.28, the first card ×1.47). Decide whether the intended rule is the bench's (monotone, minute 0 over minute 5 at least 3: PASS). |
| N6: A14 in the sustain mirrors | Eight builds miss the strict "median kill at least half the base's" rule only in the Holy and Frost mirrors (Holy's mirror stalls 8.8 s against 6.4 s in the contract); the bench ships a PASS* reading (median at least 2.5 s where the base is at least 5 s). Adopt it, or soften Holy's lifesteal ramp. Trimming card numbers does not help (12.9). |
| N7: Boom builds kill in 3 hits | The per-hit cap at 35% is the floor; 25% would give 4 but clips Frost's ordinary hits (its base kill 5.2 to 5.9 s). Recommended: accept 3. |
| N8: farm-then-fight against its counter | 36% (tolerance 35; it was 44% before the axe's shred was cut from 8/24 to 3/6): Fire's axe against a fresh Frost on fists. The cut fixed Frost over Holy and Sword over Axe's Frost column. Accept, or confirm the trade. |
| N9: the Plague-player column of A13 | 0.45× against the 0.5× target (pooled 0.94× passes): the Plague player's armor 190 shrugs off the other zones' physical mobs, and the fix would be another execute factor pinned in six tests for one informational cell. Recommended: accept. |
| N10: Sentenced's base cards | The typical minute-5 kit is attack-damage shaped and the mark is true damage that no base card scales, so the reference-set edges Sentenced over Plague (42%), Sentenced over Frost (46%) and Plague over Holy (48%) invert at minute 5 (a kit artefact the contract already noted). Decide whether a base card, or the mark's cap, should scale with AD or AP. |
| N11: discoverable anti-synergies and outliers | Machine Gun is neutral on melee and poor on bows, wands and Fire (the windup lever, backlash per swing); A Race to 0 is symmetric in a mirror and its edge exists only in unequal fights (unmeasured); Vitality III is the strongest generalist base card; Magic Resist and Fleet are near-dead in duel mirrors (Magic Resist matters against Plague, Fleet is a farming stat). Nothing was changed; they need a camp or a kiting measure. |
| N12: fragility | The harness's Sword over Axe Frost column depends on the axe shred cap (6 holds, 9 or more flips it) and Sword over Wand on the stagger immunity step (1.0 against 1.1 s). A later change to either flips a verdict. |
| N13: the map | The zone shapes built the 8-camp layout (40 camps, two elite camps a zone), so the balance pass's rosters are live: every zone shows its four normal types twice and both elites, and a run offers 120 chest options instead of 60. The balance pass's measurements were taken on maps of four camps a zone (about 80 mobs). The planning chip and the bots' planning are zone-level and do not weigh a camp's mob type. |
| Review m3: Iron Will and the client prediction | Resolved: Frost's movement multiplier, including Iron Will resistance and thaw, is now synced as a separate wire field so local movement prediction follows the server's value. |
| Review m8: Adrenaline's speed is outside G10 | Adrenaline's ×1.4 move speed is a mod source applied after the rows' +30% cap, so it stacks with Fleet III's ×1.3 up to ×1.82 for 2 s after a hit of 10% max hp; no kite check measured it. Leave it, or cap the total like attack speed. Recommended: cap it, then measure it. |
| Review m11: cards that do nothing for some factions | The chest roll is shared and build-blind, so Gathering Storm (Sentenced only), Slow Burn and Festering Arcana (signature damage-over-time factions only; Festering also needs AP) are offered to Frost and Holy pickers too. Give each a fallback row as Pestilence has, or skip a card no eligible picker can use. Recommended: fallback rows. |
| What is measured and what is not | Not measurable in a 1v1 duel with stat cards: the wand's splash, the sword's and fists' on-hit power, Overkill, Wishful Thinking and Arcane Overload. Measured in duels but not where the card is for: Tank Engine's rate (a camp), the Second Skin barrier (unit-tested, not measured in a duel), A Race to 0 against unequal kits. Not re-measured on the compressed sheet: Quickdraw and the Fleet cards in the kiting check, attack speed above ×1.25 in the model, a buffed chaser. `testing/TUNING_BALANCE.md` 11. |

---

## 19. Glossary

| Term | Meaning |
|---|---|
| **GV (Glorious Victory)** | The currency, and the title of winning a run |
| **Run** | One arena match, from spawn to death or victory |
| **Patience timer** | The host's countdown; when it hits zero, everyone goes to the coliseum |
| **Coliseum** | The walled arena at the map centre with lockable gates |
| **Zone** | One of the five faction areas of the map: an organic shape of equal area that reaches the coliseum (section 5). The code calls it a region |
| **Camp** | A clearing with 3 to 5 mob rest spots and a reward chest tile; eight per zone, two of them elite camps |
| **Territory** | The part of a zone nearer to one camp than to the zone's other camps by walking distance; its camp's mobs leash to it |
| **Pole** | The deepest point of a territory, farthest from its edge, where its camp stands. A zone's pole is where its name is drawn |
| **Feature** | A named piece of a zone's shape (a crater, a fence row, a barrow, a mere, a hall, a landmark) with one or two jobs; every wall belongs to one |
| **Landmark** | A designed building a zone places whole or not at all (forge, guard house, burrow, watchtower, shrine); it replaced the random ruins |
| **Spawn pool** | The 24 to 32 candidate starts of a map, all about the same walk from the coliseum and at least 10 tiles apart unless a wall is between them; planning deals each player two |
| **Attempt** | One try of the map generator for a seed. The state publishes the attempt that certified, so every side builds that one |
| **Map pool** | The queue of certified maps a server keeps ready on a worker thread, so a room never waits for the generator |
| **Faction** | Your class for the run (Fire, Sentenced, Plague, Frost, Holy / Demon Blood) |
| **Signature** | A faction's unique mechanic |
| **Reference weapon** | The weapon each faction is measured with (`SIGNATURE_WEAPONS`: the harness, the benches, the oracle). A run itself starts on fists |
| **Fists** | What an empty hand fights with: reach 40, the fastest swing, a weak hit that pierces shields. Every run starts on them; they are not an item |
| **Wish** | A faction's once-a-run ability on `D` (Freeze, Swarm, Trial, Blaze Step, Last Stand): locked for 45 s, then a 300 s cooldown |
| **Cast** | Using an ability: validated, committed (cooldown spent, rooted if it has a cast time), then it lands and takes effect |
| **Status** | A timed effect on a fighter (stun, root, silence, slows, anti-heal, a burn, hidden, a zone, a death floor, haste, an armor shred), all from one table with caps and cleanse classes |
| **Hidden** | Untargetable and not drawn for others until its own attack or cast reveals it (Swarm) |
| **Engaged** | Fighting a specific enemy: you hit them recently or they hit you |
| **Planning** | The 12-second step between the lobby and the run: pick one of two dealt spawns, read the camps, draw a route |
| **Camp chest** | The shared chest a cleared camp drops: three cards for 15 s, one pick per player, each option to one player (12.5) |
| **Card** | What a chest or a quest gives: a base card (24: eight stats at three tiers, they stack), a conditional (11: needs a base card of its kind) or an augment (40: one each, a rule or a trade-off). All stat power is cards (12.2) |
| **Card power / PvP factor** | Card power P is the sum of the tiers of your cards. The PvP factor is the multiplier on your damage to other players: 0.75 at P 0, 2.17 at P 6, 3.0 at the limit (10.4) |
| **AD / AP** | Attack damage and ability power: stats cards add. Each weapon turns them into damage its own way (9.1); AP also adds to every damage over time you run |
| **Guard** | A cap that bounds what a stack of cards can do (G1-G13, 12.7) |
| **Role / mob type** | A mob's shape (grunt, swarm, brute, skirmisher, caster) and its type among the 30 (four normal and two elite per zone), each with its own weapon (11) |
| **Camp heal** | The heal everyone who fought a camp gets when it is cleared: a little for a scratch, nearly everything when low (12.6) |
| **Skip** | Taking nothing from a camp chest: heals 15% of max HP, or pays 3 GV when it cannot heal. It counts as your pick |
| **Cleared** | A camp whose mobs are all dead. It never comes back |
| **TTK / even duel** | Time to kill: seconds from the first landed hit to the end of a duel in which both fighters hold the same kit. The design targets about 20 s at minute 0 on fists and about 5 s on the minute-5 kit (10.4) |
| **Noise model** | How the benches stand in for two players' execution: each fighter's damage times `exp(0.45 Z)`, which makes a 10-35% hp edge win 60-70% of duels (`testing/TUNING_BALANCE.md`) |
| **Feed** | Your run's kill score (player kills + a quarter per mob kill); sets the mob reward curve and the catch-up. The bounty counts player kills only |
| **Bounty / shutdown** | GV paid for killing a player with several player kills (it moves no stat) |
| **Edge** | One "A beats B" relationship in a counter loop |
| **Margin** | Winner's remaining HP fraction minus the loser's, in points |
