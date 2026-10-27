# RougeHalla: Game Design Document

*Working title. Version 1 of this document, written from the owner's design board, the class sheet in `testing/`, and the approved build plan.*

*Revision v3 (attack speed). Fire attacks at 0.60/s (hit 305 to 150, base DPS 91.5 to 90, backlash 210 to 200) and Frost at 0.45/s (hit 135 to 90, DPS unchanged at 40.5). A weapon is now a % boost on the faction's base attack speed, so the speed ratios between factions hold on every weapon. Fire's axe swings every 1.19 s (was 2.58 s) and the slowest combo in the game, Frost's axe, every 1.59 s (was 2.58 s). The cost: Fire's backlash reads the foe's attack rate, so a faster Frost feeds it and Frost over Fire gets thinner (59% to 49% HP left). It never flips. Fixed animation timings now scale down with the interval, and a staggered target is immune to stagger for 0.5 s (sections 9.1 and 10.3).*

*Revision (Phase 10). No faction number changed. In the real-time game a Sentenced sword hit staggers Holy and cancels its windup, which costs a hit-based fighter about a fifth of its damage and a damage-over-time faction nothing, so Holy over Sentenced with both on swords lost every duel the engine says it wins. A stronger Holy lifesteal fixed that and was reverted after review (it lets Holy stall against Holy). What replaced it is a rule, not a number: a stagger that lands pauses the staggered fighter's burn, disease and mark for its weapon's windup (section 10.3). The chill also no longer stretches the ranged recovery. Every try, measurement and rejected variant is in `testing/TUNING_10.md`.*

*Revision (Controls rework). Right-click moves and a left-click on an enemy locks it: the server then walks you into range and auto-attacks it (sections 9.5 and 14). The click-and-hold bow with its partial draws, and the ranged move slows (0.1x while drawing, casting and recovering), are gone. Every attack is a windup that roots its fighter until the swing lands or the arrow or ball leaves, and the bow and the wand windups (bow 0.92 of the interval up to 0.6 s, wand 0.8 up to 0.4 s) are now what holds kiting back. The kiting check is judged against a shooter that walks away between its shots. No faction number changed. The numbers come from the 20 Hz Python model (`testing/test_kite.py`); the real-sim harness is re-measured in `testing/TUNING_CONTROLS.md`.*

*Revision (Wishes). Each faction gets one once-a-run ability, a **Wish**, on `D` (section 8.8): Freeze, Swarm, Trial, Blaze Step and Last Stand. They run on a status and ability framework that the later active skills and relics reuse (section 8.9). No faction, weapon or mob number changed, and the weapon harness and the kiting check do not cast a Wish (`testing/WISHES.md` reasons about what each one does to them).*

*Revision (Roguelike R2). The wedge map is gone. The arena is a map of five organic zones of equal area around the fixed coliseum (96 x 96 when this revision was made, 136 x 136 since the Zone shapes revision below), with camps and their territories in each zone (four a zone then, eight now), a spawn pool of 24 to 32 starts on one walking contour, and no ridges or passes (section 5). Mobs now leash to their camp's territory, at most 12 tiles from their spot (section 11). Every map is certified as it is made, built from a seed and an attempt that the state publishes, and made ahead of time by a background worker (section 16). No faction or weapon number changed. Zone terrain (lava, fences, ice and the like) was planned here and is built (section 5.2).*

*Revision (Roguelike R3 and R4a). A planning step now sits between the lobby and the run (section 3), and the first patience timer is a flat 5:00 (section 6). Camps are mono-type, and every mob type drops its own buff (sections 11 and 12): the three-stat S-curve and its kill combos are gone, and a single buff is smaller than the old stat plateaus (mostly +4% to +30% at the quoted value, after the owner doubled the first picks). The rest of the roguelike plan (zone maps, camp chests, skills, relics, start boons) was planned, not built, then: see `docs/ROGUELIKE_PLAN.md` and the next revision. No faction or weapon number changed.*

*Revision (Roguelike R5). Clearing a camp now matters. The first hit on any mob wakes its whole camp, a cleared camp stays cleared, and it drops one **shared chest** for 15 seconds that offers three passive skills, one pick per player, first come first served (sections 11 and 12.5). Nine of the 21 designed passives are built; you hold them for the run, on a row under the buff strip. To keep a camp that wakes together beatable, normal mobs are weaker: a normal mob is its region's faction scaled by 0.22 (it was 0.45; section 11). The practice room gets a console to set buffs and passives, spawn a camp and drop a chest (section 4). Active skills on Q and E, relics, curses, zone maps, "?" camps and start boons are still planned. No faction or weapon number changed.*

*Revision (Zone shapes). The map is 136 x 136, about twice the area, with eight camps in each zone and two of them elite (40 camps, about 160 mobs). The walls are no longer scattered: the 480 u sight cap and the cover pass that enforced it are gone (owner ruling), and every zone has one designed shape of named features, each with a job: Crater Basins (Scorch), the Rows (Gallows), the Barrows (Warren), the Mere (Rime) and the Hypostyle (Sanctum), with a designed landmark building in place of the random ruins (sections 5 and 5.3). Spawns keep 10 tiles apart unless a wall is between them, and their walks to the coliseum are certified within a ratio of 1.2 on the real pathfinder. The Rime has real ice lakes. No faction or weapon number changed. `docs/ZONE_SHAPES_AS_BUILT.md` has the details and the measurements.*

---

## 1. The game in one paragraph

RougeHalla is a top-down, League-of-Legends-angled **roguelike battle arena**. You pick one of five factions, step out of the hub into an arena with up to seven other players, and start with almost nothing: your faction's signature weapon and your wits. You build a run by looting chests, fighting the neutral creatures of five regions (each region drops its own weapon, and each kind of creature its own buff), and picking fights you can win. Two counter loops decide every fight: **faction against faction** and **weapon against weapon**. There is no shrinking zone. Instead, the impatient host of the Arena runs a visible **patience timer**. If nobody dies before it runs out, everyone is teleported into the central coliseum and locked in until someone falls. The last player standing earns **Glorious Victory (GV)**. Everything you found during the run is gone when it ends. GV, cosmetics, titles and achievements are what you keep.

---

## 2. Scope

### 2.1 First playable (the target)
**Hub (menu) → pick faction → arena with weapons, mobs, patience timer and coliseum → last one standing → GV → back to the hub.**

| Area | In the first playable |
|---|---|
| Players per arena | Up to 8 |
| Factions | All 5 (Fire, Sentenced, Plague, Frost, Holy / "Demon Blood") with their signature mechanics |
| Weapons | All 5 (Sword, Bow, Wand, Shield, Axe) with their counters and interactions; 2 weapon slots |
| Wishes | One once-a-run ability per faction on `D` (Freeze, Swarm, Trial, Blaze Step, Last Stand), section 8.8 |
| Map | A 136 x 136 map of 5 faction zones (each with its own designed shape, 8 camps each, two of them elite) around a central coliseum with lockable gates |
| Planning | A 12 s planning step after the lobby: pick 1 of 2 dealt spawns, see every camp's mob type, its buff and your matchup, draw a route |
| PvE | Neutral regional mobs in mono-type camps that fight back (one hit wakes the whole camp) and drop GV, their type's buff and their weapon; weapon chests |
| Camp chests | A cleared camp stays cleared and drops one shared chest of three passive skills for 15 s: one pick per player (9 of 21 passives built; section 12.5) |
| Pressure | Patience timer → coliseum teleport → gates locked → sudden death |
| Snowballing | Feed score, per-mob-type S-curve buffs, falling mob rewards, bounties |
| Persistence | Profile with GV, stats, cosmetics (shop), achievements, titles, monthly GV leaderboard |
| Hub | Menu-based hub (GV, faction pick, counter wheel, shop, leaderboard), then a walkable hub with training grounds |

### 2.2 Later (designed, not in the first playable)
- **Quest NPCs.** Unique arena NPCs each offer a simple quest. The first player to finish it gets that NPC's unique reward (items, armor, sometimes abilities). A first version is built and no longer "later": ten standing offers per run (five known in planning, five scouted), paid in a mob-type buff and a capped quest GV, with no unique items or abilities (`docs/quests.md`).
- **Raid-boss mobs.** Some neutral creatures reach raid-boss strength.
- **Secrets and lore.** Hidden spots for rare loot, cosmetics and lore snippets that point to deeper secrets.
- **Social.** Friends list, hosting 1v1s, private matches, text chat.
- **Hub NPCs** that exist only in the hub.
- **The roguelike overhaul** (see `docs/ROGUELIKE_PLAN.md`): terrain in each zone (lava, fences and the like), two active skills on Q and E, relics (also offered by the chests) and curses, "?" camps that hide their reward, and a start boon picked on the planning screen are **planned, not built**. Zone maps, planning, mono-type camps, the per-type buffs, camp-wide aggro and the shared skill chest with its nine live passives are built (sections 3, 5, 11 and 12).

### 2.3 Out of scope for now
- **Real-money purchases.** The shop design allows them (cosmetics only), but no payments are built.
- **Accounts with passwords.** Profiles are callsigns tied to a token on the device.
- **Matchmaking by skill, ranked play, multiple servers.**

---

## 3. A run, start to finish

1. **Hub.** You see your GV balance, titles and leaderboard position. You pick a **faction** for this run; your **signature weapon** comes with it. A counter wheel shows both loops and where your pick sits.
2. **Enter the Arena.** You climb the stairs (in the menu hub: press *Enter Arena*). You join a lobby of up to 8, which shows the map, every camp's mob type and the factions in the room. The lobby starts the run when enough players are in or a short timer runs out.
3. **Planning.** A 12-second planning screen (`PLAN_SECONDS`) follows, the room locked and nobody able to move, fight or be hurt. You are dealt **two spawns** at about the same walking distance from the coliseum (within 8% of a shared value) and in different zones, and you pick one. The first player to pick a spawn holds it, and a spawn someone else took shows as taken at once; within one tick a secret order decides. The screen also shows every camp with its mob type, the buff it gives and how your faction fares against it, and the buffs that counter the factions in the room. You can draw a **route** (up to 12 stops, with its walking time), which shows faintly during the run. Pressing Ready locks your pick, and the run starts early once everyone connected is ready. With no pick you get your first free spawn. **Planning is part of the run** (owner ruling): leaving now, or dropping and not coming back in time, counts as going missing (MIA), a loss: a run and a death in your stats and no GV, so nobody can look at the deal and requeue for free. Only the lobby is free to leave. A leaver still counts as a starter; if everyone but one leaves, the run starts at once and the last player wins without the win bonus. A server restart during planning voids the run for everyone instead. A dropped player keeps the seat and, if they reconnect in time, their pick. A start boon is planned for this screen (see `docs/ROGUELIKE_PLAN.md`), not built.
4. **Spawn.** Players start at the spawn they picked, spread over the five zones and all about the same walk from the coliseum (the spawn pool of section 5). The first patience timer (a flat 5:00) and each faction's Wish lock (the first 45 s) count from this moment, not from the end of the lobby.
5. **Early run.** Hunt neutral mobs for buffs, GV and weapons, loot chests, and route toward the camps whose buff and weapon you want and the region whose weapon counters what you're seeing. Hit one mob and its whole camp comes for you; clear the camp and it drops a shared chest of three skills for 15 seconds: whoever reaches it first picks first, and clearing the camp gives no claim on it (section 12.5). Holding Tab shows the whole map, your route and which camps are already cleared.
6. **Mid run.** Fights break out. Every death resets the patience timer. Fed players gain bounties and get marked on everyone's minimap.
7. **Patience runs out.** If nobody dies for the full timer, the host teleports everyone alive into the **coliseum** and locks the gates. The gates open again as soon as someone dies.
8. **Endgame.** As players die, the patience timer shortens. With few players left, fights happen often, in the open or in the coliseum.
9. **Glorious Victory.** The last one standing wins and gets the win bonus. Everyone keeps the GV they earned during the run. Run gear (weapons, buffs) is gone.
10. **Results → hub.** The results screen shows kills, GV earned, bounties claimed and time survived. Then you're back in the hub.

---

## 4. The hub

| Hub feature | What it does | When |
|---|---|---|
| GV balance and titles | Shows your currency and equipped title | First playable |
| Faction picker | Choose a faction; shows its card and signature weapon | First playable |
| Counter wheel | Both pentagrams (factions, weapons) with your pick highlighted | First playable |
| Cosmetics shop | Spend GV on colours, trails, titles and golden weapon variants. Cosmetics only. | First playable |
| Leaderboard | Monthly GV ranking | First playable |
| Achievements | e.g. 5 wins holding the same weapon unlocks its golden variant | First playable |
| Training grounds | Try any weapon combination; spar with training dummies (no GV) | Built (Phase 12) |
| Stairs to the Arena | The physical entrance to matchmaking | Built (Phase 12) |
| Hub NPCs | Characters who never appear in the Arena | Later |
| Social | Friends, 1v1s, private matches, chat | Later |

**As built (Phase 12).** The hub is a small walkable room, drawn on the client only (no server room while you are in it). You walk with right-click, WASD or the arrow keys; stepping up to a station shows a prompt, and **E** or a click uses it: the stairs start a run, the training door starts the training grounds, four kiosks open the shop, wardrobe, achievements and leaderboard, five pedestals pick a faction, and the floor in the middle shows the counter wheel. Your avatar wears your equipped cosmetics and your faction's colour and signature weapon. The menu panel sits docked beside it and still offers everything the old menu did (callsign, GV, stats, panels, Start Run).

**Training grounds.** A private room of one, created fresh each time. It has Phase 9's practice setup next to your spawn: a plain dummy, a shield dummy, and a rack with one of each weapon. You pick the faction in the hub first. Nothing is recorded: no GV, no stats, no achievements, no timer, no results, and if you go down you are simply stood back up. Leave with the button or Esc; there is no waiting room and no one else comes in, and a room whose player stays idle for five minutes is closed. A **Console** button in the training bar opens a small practice console, nothing of which counts for a real run: set any mob type's buff to 1, 3, 6 or 12 stacks (or take it off), set any passive to rank 1 or 2 (or take it off; one that is not built yet is set but does nothing, and says so), spawn a practice camp of any mob type (three mobs, or one for an elite type, asleep on the floor near you, so hitting one wakes the rest as in a run), drop a skill chest two tiles away with three skills of your choice (or three random ones for your faction), or clear all of it. A practice camp's death pays no GV, buff or weapon and drops no chest, a chest skip pays no GV either, and Clear also ends the arrows and balls the practice mobs have in the air. The caps are 12 practice mobs at once and 6 chests, with a short pause between drops. Esc inside the console hands the keyboard back to the game, and the next Esc leaves.

**Counter wheel.** Two pentagrams, the faction cycle and the weapon loop, drawn from the same counter lists the game uses. Your picked faction and its starting weapon are highlighted, with what each beats in green and what beats it in red.
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
- **Camps and territories.** Each zone holds **eight camps**, 40 on a map, each a small clearing with 3 to 5 mob rest spots (about 160 mobs a map). Two camps per zone, the two farthest from the coliseum (the second at least 16 tiles from the first), are the **elite camps**. Camps keep at least 9 tiles apart. Every camp owns a **territory**: the part of its zone that is nearer to it than to the zone's other camps by walking distance. A zone's eight territories together cover all of it, and each is one connected piece of floor. The camp stands at its territory's **pole**, its deepest point, and no part of the territory is more than 30 tiles from it. The territory is where the camp's mobs may fight (section 11).
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
| You die | Your run ends. Your weapons and buffs are gone. You keep the GV you earned this run. |
| You win | +50 GV win bonus on top of what you earned. |
| Solo run (fewer than 2 humans) | No win bonus. |
| Persists between runs | GV, cosmetics owned and equipped, titles, achievements, stats (wins, kills, per-weapon and per-faction records), monthly GV total |
| Never persists | Weapons, buffs, feed score, bounty |

---

## 8. Factions

Five factions form a closed loop: **each beats exactly two and loses to exactly two.** The numbers come from the owner's design engine (`testing/engine.py`, `testing/classes.py`). The game's TypeScript copy is tested against it so they can't drift apart.

### 8.1 The rulebook (identical for every fight)
1. **Attack.** Each second a fighter deals `rate × hit` raw damage plus its signature bonus.
2. **Three damage shares.** Every hit is split into physical, magic and true damage; the shares belong to the attacker.
3. **Defense.** Armor cuts the physical share and shield cuts the magic share; true damage ignores both. Reduction is `1 / (1 + stat/100)`: 100 means half damage, 300 means a quarter.
4. **Rate effects.** One aura exists (Frost's slow). It multiplies an opponent's attack rate. It slows `rate × hit` only, not flat bonuses.
5. **Health effects.** Mechanics may read health fractions (the target's for execute, your own for lifesteal), never an opponent's identity.
6. **Time effects.** A mechanic may read time spent in the fight (the mark ramp).

No rule mentions a faction by name. Every counter falls out of the numbers.

### 8.2 Stat sheet (v3)

| Faction | Role | HP | Attack rate | Hit | Base DPS | Damage mix (phys / magic / true) | Armor | Shield |
|---|---|---|---|---|---|---|---|---|
| Fire | Glass-cannon duelist | 500 | 0.60/s | 150 | 90 | 0 / 100 / 0 | 0 | 125 |
| Sentenced | Patient executioner | 700 | 0.90/s | 5 | 4.5 | 0 / 100 / 0 | 100 | 50 |
| Plague | Attrition swarm | 1000 | 1.85/s | 20 | 37 | 80 / 20 / 0 | 200 | 0 |
| Frost | Control bruiser | 1750 | 0.45/s | 90 | 40.5 | 90 / 10 / 0 | 100 | 100 |
| Holy (Demon Blood) | Sustain juggernaut | 1450 | 0.95/s | 65 | 62 | 100 / 0 / 0 | 0 | 250 |

Attack rate is the faction's base. Each weapon boosts it by a percentage (section 10.2).

### 8.3 Signatures

| Faction | Signature | What it does | How it feels |
|---|---|---|---|
| Fire | **Dragonslayer** | 10 burn per second, plus **200 backlash for each attack the engaged enemy makes at its base rate** (per real swing 93 to 143 depending on its weapon, section 10.3) | Punishes fast attackers. Against Plague's flurry it's over in seconds. |
| Sentenced | **Marked** | Bonus damage ramping +35/s for every second in the fight, capped at 275/s (7.9 s to full). The mark is tied to the **weapon the target is holding**; swapping weapons resets it. | Gets worse for the opponent every second. Its own hits barely matter (5 damage). |
| Plague | **Rat King** | 40 disease per second, plus an execute adding up to 1025/s as the target falls from 50% to 0 HP | A slow squeeze that collapses into a kill |
| Frost | **Living Wall of Ice** | Anyone engaged with Frost has their **attack rate cut to 40%** and their **movement slowed** | The fight slows down and Frost sets the pace |
| Holy | **Radiant** | Heals a share of damage dealt equal to `0.25 + 1.25 × missing HP`, capped at 100%. It heals all of the damage it deals from 60% missing HP. | Hardest to finish when nearly dead |

### 8.4 Who beats whom, and why

| Winner | Loser | Deciding factor | Fight length | Winner HP left |
|---|---|---|---|---|
| Fire | Sentenced | Fire's burst ends the fight before the mark builds | 3.7 s | 77% |
| Fire | Plague | Plague's 1.85 swings/s feed Fire's backlash (about 370 damage per second) | 2.1 s | 71% |
| Sentenced | Plague | The mark lands at 100% on Plague's zero shield; Plague's physical damage is cut to 53% | 7.4 s | 56% |
| Sentenced | Frost | The flat mark ignores Frost's slow; armor halves Frost's hits | 16.6 s | 51% |
| Plague | Frost | Disease and execute are flat, so the slow barely matters; the execute decides it | 37.0 s | 40% |
| Plague | Holy | 86% of Plague's damage gets through Holy's zero armor | 15.8 s | 67% |
| Frost | Holy | The slow cuts Holy's swings, and with them its healing, from 0.95 to 0.38/s | 52.3 s | 63% |
| Frost | Fire | Frost's 0.45/s feeds the backlash only 90 damage per second (its shield cuts half), and the slow cuts Fire to 0.24 swings/s | 13.1 s | 49% |
| Holy | Fire | A 250 shield cuts Fire's all-magic damage to 29% | 8.1 s | 69% |
| Holy | Sentenced | The shield cuts the mark to 29%; lifesteal decides it | 22.7 s | 27% (tightest) |

**The main axis is damage type against defense type.** Magic damage (Fire, Sentenced) crushes the shieldless (Plague) and bounces off the heavily shielded (Holy). Physical damage (Plague, Frost, Holy) punishes zero armor. On top of that sit rate against flat damage (Frost's slow only hurts rate-based attackers), burst against ramp (Fire ends fights before the mark or execute come online) and HP pool (Holy and Frost win long fights).

### 8.5 How much of a hit survives (attacker → defender)

| attacker \ defender | Fire | Sentenced | Plague | Frost | Holy |
|---|---|---|---|---|---|
| **Fire** | – | 0.67 | 1.00 | 0.50 | 0.29 |
| **Sentenced** | 0.44 | – | 1.00 | 0.50 | 0.29 |
| **Plague** | 0.89 | 0.53 | – | 0.50 | 0.86 |
| **Frost** | 0.94 | 0.52 | 0.40 | – | 0.93 |
| **Holy** | 1.00 | 0.50 | 0.33 | 0.50 | – |

### 8.6 Identity test: every signature must matter
Remove a signature and the class must visibly lose: a main signature has to flip at least one required win, a sub-mechanic at least has to move a margin a lot.

| Faction | Removed | Wins lost | Largest margin swing |
|---|---|---|---|
| Fire | Burn and backlash | vs Sentenced, vs Plague | 131 points |
| Fire | Backlash only | vs Sentenced, vs Plague | 127 |
| Sentenced | The mark | vs Plague, vs Frost | 152 |
| Sentenced | The ramp (mark full from t = 0) | none | 70 |
| Plague | Execute | vs Frost | 43 |
| Plague | Flat disease | vs Frost | 114 |
| Frost | The slow | vs Holy | 103 |
| Holy | Lifesteal | vs Sentenced | 30 |
| Holy | Missing-HP scaling | none | 19 |

### 8.7 Design notes on the factions
- **Fire's burn (10/s) is nearly cosmetic.** Backlash does the work: 64% to 79% of Fire's damage against Sentenced, Plague and Frost, against 2% to 7% for burn. If burn should matter, raise it and retune.
- **Frost over Fire got thinner** (59% to 49% HP left). Fire's backlash reads the foe's attack rate, so a faster Frost feeds it: 90 backlash per second against Frost, up from 63. It never flips. In the 20 Hz check the smallest HP buff on Fire that flips it is ×1.90 with the 9.1 weapon numbers (×1.59 in v3 before them, ×1.97 in v2). Raising Fire's own rate is free: at equal damage per second it moves no engine result (and at most 3 points in the 20 Hz duels).
- **Holy beats Sentenced is the tightest edge** (27% HP left); lifesteal decides it.
- **Holy's lifesteal was not changed in Phase 10.** A stronger one (second coefficient 1.25 to 1.75, cap 100% to 150%) was tried because a Sentenced sword's staggers cost Holy a fifth of its damage in the real sim, and it fixed that. It was reverted after review: with a cap above 100% a losing Holy at low HP heals more than it takes, so Holy against Holy can stall (in the engine a Holy dealing 1.0× to 1.5× the other's damage never wins in 600 s; in the real sim 6 of the 10 weapon edges with Holy on both sides ran into the 300 s cap). The fix that stayed is the stagger rule in section 10.3. Lifesteal also heals from the whole hit, even on a killing blow, and from hits on a training dummy, which refills; the 20 Hz model counts it the same way. Details in `testing/TUNING_10.md`.
- **Fights are long in places** (Frost over Holy is 52 s). Duels are being sped up for the arena (section 10.2).
- **Robustness.** The engine checks pass with every stat randomly jittered by ±10%, at any global power level, and with names shuffled (proving no matchup is hard-coded).

### 8.8 Wishes
Each faction has one **Wish**: an ability on `D` for the moment the weapons do not cover (stopping a kiter, leaving a lost fight, turning a duel). A Wish is **flat**: no buff, relic or cooldown reduction changes it, and it reads neither the feed nor your stacks. Numbers are in `shared/src/abilities.ts` and every one of them is a best guess (section 18).

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
| slowMove | Walks slower by its value | 5 s | sum, cap 0.6 | soft | nothing yet |
| slowAttack | Attacks slower by its value (it multiplies the attack-speed stat mirror) | 5 s | sum, cap 0.5 | soft | nothing yet |
| antiHeal | Every heal, lifesteal included, is cut by its value | 6 s | sum, cap 0.6 | soft | nothing yet |
| dot | Its value in raw damage a second through the damage ledger (all true by default) | 10 s | sum | soft | Blaze Step's burn |
| invulnerable | No damage (it is the teleport's immunity field); players only | 3 s | any | never | nothing yet |
| untargetable | Cannot be locked or picked by an ability | 10 s | any | never | nothing yet |
| hidden | Untargetable and not drawn for others unless revealed; players only | 10 s | any | never | Swarm |
| zoned | Deals and takes by the zone's multipliers | 6 s | product | never | Trial |
| deathFloor | The hp floor and its heal-back; players only | 6 s | any | never | Last Stand |
| haste | Adds its value × the base walking speed | 8 s | max, cap 0.5 | never | Last Stand |

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
- **Flat power.** No ability number reads buffs or passives (the damage, vs and scale rows of the buffs and of the R5 passives never multiply an ability's damage or its damage-over-time ticks: the ledger skips those entries before it asks a `vs` row anything, and a test holds every live passive at rank 2 against it; owner ruling "Keep Wishes flat"). Haste adds to the base speed and trail damage is true damage. Trial's ±20% is the one relative number, by the owner's rule.
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

Five weapons form a second closed loop; again **each beats two and loses to two.** They are hard counters, not impossible matchups. You carry **two**, so what you hold, and what you go and get, matters.

### 9.1 How each weapon works

| | Sword | Bow | Wand | Shield | Axe |
|---|---|---|---|---|---|
| Shape | Quarter-circle (90°) swing, reach 64 | Arrow, fast (900 u/s), range 240 | Magic ball, medium speed (380 u/s), range 220 | Barrier always raised toward the cursor, or toward the locked enemy (±60° front); bashes like a swinging door (120°, reach 44) | Half-circle (180°) swing, reach 60 |
| Input | Lock an enemy: it attacks for you | Lock an enemy: a fixed full draw, no hold, no partial draw | Lock an enemy | The shield follows the cursor, or the locked enemy; the lock bashes | Lock an enemy |
| When damage lands | 0.1 s into the swing | The arrow leaves when the draw ends: 0.6 s after the attack starts (at most 92% of the interval) | Ball leaves 0.4 s after the attack starts (at most 80% of the interval) | 0.1 s into the bash | 0.25 s into the swing (at most 25% of the interval) |
| Attack speed boost | +115% | +95% | +65% | +60% | +40% |
| Rooted | For the 0.1 s swing | For the draw | For the cast | For the 0.1 s bash | For 0.5 s from the attack's start (at most 50% of the interval) |
| Damage multiplier | 0.75 | 0.8 | 0.8 | 0.75 | 0.77 |
| Special | A hit that isn't blocked **staggers**: cancels the target's windup or cast (a bow draw carries on). A staggered target can't be staggered again for 0.5 s. | Always full damage: there are no partial draws. A stagger does not cancel the draw. | The ball **deletes arrows** within 28 units and **pierces shields** | Blocks frontal hits, **reflects arrows** back (the shield holder owns them), **negates a frontal sword hit and ripostes** 50% of it | **Pierces shields**, **destroys magic balls** its swing meets |

The interval is the time between attacks (section 10.2). Every attack is a **windup** (Controls rework, section 9.5): the fighter is rooted from the attack's start until the swing lands or the arrow or ball leaves, and walks freely at full speed until the next one. A windup is its design time or the share of the interval shown, whichever is shorter, so a faster cadence shortens it and no fighter is rooted for the whole cycle (the bow, at 92%, comes closest).

Ranged weapons can kite, so four things hold them back (the numbers are the 9.1 tuning and the controls rework, see sections 9.4 and 9.5):
- **Short range.** Bow 240 u, wand 220 u (about 7 tiles each). A melee fighter charging a standing shooter takes (range - reach) / move speed of free fire: 1.06 s from the bow, 0.94 s from the wand. A shooter that walks away between its shots gives a little more (Plague's bow 1.16 s, against the 1.23 s a melee faction winner can absorb at duel pace, k = 2).
- **Damage no higher than the melee weapons it must beat:** bow 0.8, wand 0.8 (the sword 0.75, the axe 0.77, the shield 0.75). The bow wins the sword and the axe on its opening alone, so it cannot also out-trade them; the axe sits a little further under the bow's number because a zigzag approach takes the opening away and leaves the bow its close trade.
- **Drawing and casting root you.** The bow's draw (0.92 of its interval, at most 0.6 s) and the wand's cast (0.8 of its interval, at most 0.4 s) are windups like any other, and a chaser closes the gap only while the shooter is rooted. This replaces the 9.1 rule that drawing, casting and recovering moved you at 10%: nothing slows a walk any more, so the windups have to be long enough that a shooter walking away between shots still cannot out-kite a melee winner (section 9.5).
- A hit by a sword neither restarts nor cancels a bow draw.

### 9.2 The weapon loop

| Weapon | Beats | Why | Loses to | Why |
|---|---|---|---|---|
| **Sword** | Axe | Faster swings (+115% against +40%) and stagger: it weaves in more attacks | Bow | Range |
| | Wand | Its swing halves the damage of balls it meets | Shield | Blocked and riposted |
| **Bow** | Sword | Range | Shield | Arrows reflected back |
| | Axe | Huge range gap; the axe roots to swing | Wand | Balls delete arrows |
| **Wand** | Bow | Balls delete arrows | Sword | Swings cut ball damage |
| | Shield | Balls pierce shields | Axe | Swings destroy balls |
| **Shield** | Sword | Blocks and ripostes | Wand | Balls pierce it |
| | Bow | Reflects arrows | Axe | Axe pierces it |
| **Axe** | Wand | Destroys balls | Bow | Range |
| | Shield | Pierces it | Sword | Out-swung |

Every edge was checked in the real sim (section 9.4, "Tuning (9.1)"): the designed winner wins at least 60% of the duels, at least 50% in every faction, and has a reply that wins at least 50% against every way the loser can play. **That holds against a melee fighter who charges straight at its target.** **It also holds against one who zigzags in** (50 to 55 degrees off the line, changing side every 0.3 to 0.4 s), where the ranged-over-melee edges are thinner: Bow over Axe 89% against the slower zigzag and 82% against the quick one (44% before the axe's damage was cut from 0.8 to 0.77), Bow over Sword and Wand over Shield 82 to 93%. All three stay thin for Fire, whose 500 HP leave no room for the arrows lost on the way in (section 9.4). **Shield over Sword and Shield over Bow end with the shield at full HP, on purpose:** a raised shield turns the hit back (the riposte, the reflected arrow) and the losing weapon has no way through it. The counterplay is the second weapon slot (section 9.3): swap to the axe or the wand.

### 9.3 Inventory and pickups
- **Two weapon slots.** Swap between them. Swapping shares the attack cooldown, adds 0.25 s, and cancels your current action, so it can't be used to cut animations short. A target lock stays through a swap.
- **Pick up** a weapon from a chest or the ground by pressing F near it. If both slots are full, the weapon in your active slot is dropped.
- **Mob drops.** A mob drops the weapon it carried, unless the killer already holds that weapon type.
- **Swapping is skill expression.** Changing to the counter weapon mid-fight is the big play. Swapping also **resets a Sentenced mark** on you, so it's the counterplay to Sentenced.

### 9.4 As built (Phase 9): rules the design left open
Decisions taken while building the weapons. The sections above are unchanged; where they are silent, this is how the game plays.

**Input and timing** (the Controls rework changed these; section 9.5)
- **A windup is part of its interval.** The cooldown counts from the attack's start for every weapon, the bow's draw included, so the cycle is the interval whatever the windup.
- **Trigger.** The game client no longer holds one: the target lock does (section 9.5). The low-level `attack` (a press) and `release` remain for mobs and the weapon harness (the bots click their foe, like the game client): a press attacks, holding repeats the attack whenever the cooldown allows, and a release stops the repeating (an attack already winding up still lands). A press up to 150 ms before the cooldown ends is buffered and attacks the moment it ends.
- **Windups.** Sword and bash 0.1 s, axe min(0.25 s, 25% of the interval), wand min(0.4 s, 80%), bow min(0.6 s, 92%). The fighter is rooted for all of it, and the axe for 0.5 s (at most 50%) from the attack's start.
- **Direction is fixed early, unless locked.** A swing and a cast go where the fighter aimed when the attack started; an arrow goes along the aim held when its draw ends (the bow was aimed at release, and still is). An attack started by a target lock is aimed again at its target as it lands or leaves (section 9.5).

**Interrupts**
- **A stagger** cancels the windup or cast; the cooldown stays spent. A bow draw is not interrupted (9.1 tuning; it used to restart). The stagger mark is shown only when a windup or cast was cancelled, so an archer or an idle fighter that is hit gets the 0.5 s immunity but no mark. Every stagger that lands (the immunity starts, whether or not it cancelled anything) also pauses the staggered fighter's burn, disease and mark for its weapon's windup (section 10.3).
- **A swap, or a pickup that replaces the weapon in hand,** cancels a pending windup (a swing, cast or draw, and adds 0.25 s), but never cuts an already-landed root short.

**Shields, swings and balls**
- **Reflected arrows** mirror about the shield's facing, keep the archer's damage, belong to the shield holder and fly the full bow range. An arrow reflected again keeps only the range it has left.
- **A riposte** is 50% of the sword hit, with the swordsman's own damage shares, credited to the shield holder. A frontal bash is simply blocked.
- **A sword halves a ball once.** Swings meet balls in present time (balls fly in present time) and need line of sight to them.

**Credit**
- **Simultaneous hits land together,** and the kill (and any bounty) goes to the largest rival hit; an exact tie goes to a per-tick secret order, never to join order.
- **A projectile outlives its shooter.** Its hit still lands; a kill by a shooter who has left or is already out of the run is credited by name only, with no GV.

**Setup**
- **Picking up into an empty slot** doesn't change the weapon in hand.
- **The faction** is picked in the hub before each run. A player who hasn't picked one (or a bot without `--faction`) gets a round-robin default by join order, which never counts toward faction achievements.
- **Training dummies** (server option `DUMMIES=1`) have no faction, so no armor or shield, and never die: a hit that would kill refills them.

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
- **Ice and bog.** A fighter on ice cannot stop on a dime (section 5.2); a windup or root plants it. Bog multiplies with chill and buffs, and the product of all move multipliers never goes under 0.35 (a root still stops you).

### 9.5 As built (Controls rework): the target lock and the windups
The owner's ask: right-click moves, left-click auto-attacks the enemy closest to the cursor (so a near miss does not matter), with an attack animation or just a pause while it swings, and that pause should replace the ranged move slow. This is how it plays. The windups are tuned in the 20 Hz Python model and checked in the real sim; `testing/TUNING_CONTROLS.md` has both, before and after.

**The target lock** (the server plays the fight, as it does for a mob)
- **Locking.** A left-click sends `target`. The client picks the living enemy (a player or a mob) drawn nearest the cursor's ground point, within 64 u (two tiles) of it. A click on empty ground does nothing. The server accepts it only for a standing enemy that is not a mob walking home, within 640 u (20 tiles); anything else is ignored and changes nothing. Line of sight is not needed: an enemy seen behind a pillar is locked and you walk around to it, as in League, but nothing is attacked without a clear line, and one out of sight with no way to it (a mob outside the locked coliseum gates) is refused. Clicking the enemy already locked changes nothing.
- **Fighting.** From then on the server walks you into the weapon's range (it closes in, then stands: it never backs off, strafes or weaves), attacks whenever the cooldown allows, faces the target (the shield's block cone too) and aims every attack at it. Your `aim` is ignored while you are locked.
- **Ending.** The lock ends when you give another order, the target goes down or walks home, it leaves 640 u, it stays out of line of sight for 1.5 s after you have seen it (until then you path around the wall; a target locked behind a wall is chased until you first see it), or you hold no weapon; the coliseum teleport and your own death end it too. You stop where you stand. A swap or a pickup keeps it.
- **Orders replace each other, in arrival order.** A right-click (even to a point you cannot reach) or `S` drops the lock, and a left-click on an enemy replaces any earlier order. Mobs never lock: they hold the trigger themselves.
- **Re-aiming.** An attack the lock started goes at its target as it lands (a swing straight at where the target stood at the swing's rewind time) or leaves (an arrow or ball led at the target's position and velocity at that moment), if the target still stands. Once loosed it flies straight, so its target can still dodge it by stepping off the line. An attack without a lock (a mob's, the harness's) goes where it was aimed: a swing or a cast at the start, an arrow when its draw ends.
- **Lag.** A locked attack carries no client timestamp: it is timed in the present, one tick back.

**Windups root.** Every attack roots its fighter from its start until the swing lands or the arrow or ball leaves, and then you walk freely until the next one (the axe for 0.5 s from its start). Nothing else slows a walk except buffs and Frost's chill. A windup the target lock started is cancelled by the player's own next order, as in League of Legends: a walk, a stop, or locking another fighter ends it with no swing, ball or arrow, refunds the cooldown (it was over when the attack began) and cuts the root, and the walk starts that tick. A windup that is not the lock's (a mob's, the harness's, which hold the trigger while they move and must still fire) stays committed: a walk ordered while it runs is kept and starts when it ends, and only a swap or a stagger (never on a bow) cancels it. A swing that has landed is not undone (the axe's root after it stays).

| Weapon | Windup | Rooted |
|---|---|---|
| Sword, shield bash | 0.1 s | the windup |
| Axe | min(0.25 s, 25% of the interval) | min(0.5 s, 50%) from the attack's start |
| Wand | min(0.4 s, 80% of the interval) | the windup |
| Bow | min(0.6 s, 92% of the interval) | the windup |

**A windup mod shortens melee windups only** (owner ruling "Melee windups only", R5; it replaced "Floor the windup"). A passive or buff that shortens windups (Quickdraw, a `windupMult` below 1) shortens the sword's, the shield bash's and the axe's windups (the axe's root with its windup, never under it) and never a bow's or wand's: the ranged windups are the anti-kiting lever and nothing may buy them down, so a ranged attack with the passive is the same attack without it (`testing/TUNING_ROGUE.md` section 7). A mult of 1 or more lengthens every weapon. Windups end on the 50 ms tick grid (an attack lands on the first tick at or after its windup, never in the tick it started in), so a cut only counts in whole ticks: the 0.1 s sword and bash are two ticks and need a cut of 50% or more to land one tick sooner, the axe's 0.25 s is five and loses a tick for each 20%.

**The bow is a fixed draw.** It has no hold, no minimum draw and no partial draws: the arrow leaves when the draw ends, at full damage, and everyone sees the pull from its synced start (`drawStartedAt`). A stagger still does not cancel it, and Frost's chill still stretches it (the cycle under chill stays the interval over the chill's rate). The wand's cast is longer than before (0.4 s, at most 80% of the interval, against 0.2 s and 40%). Plague's bow (0.277 s interval) is rooted for 0.255 s of every cycle, so a Plague archer hardly walks at all.

**Kiting is judged against a shooter that walks.** With no move slows, a shooter can fire, walk away at full speed until its cooldown ends, and fire again (an "orb-walk"). The chaser closes only while the shooter is rooted, so such a shooter gives about the interval over the windup times the free fire of one that stands, a little less because its first windup comes first. The check is `orbwalk_free_fire` in `testing/realtime.py`, a 0.05 s kinematic model of the rules above: the chaser starts at the weapon's range and walks at 170 u/s, the shooter roots for its windup and walks away until its interval (counted from the windup's start) is up, and the time is when the gap is 60 u (melee reach). It ignores arrow flight and attack-speed buffs and does not apply a Frost chaser's chill to the shooter, the conservative way. `python3 testing/test_kite.py` now requires the weakest melee weapon's tolerance (how late it may arrive and still win half the duels, unchanged by this) to be at least that time, in all 20 cells (10 edges, bow and wand), and prints the standing figure beside it.

| Ranged windup | Tightest cell | Weakest melee tolerance against orb-walk free fire | Margin |
|---|---|---|---|
| Bow, 0.6 s / 92% | Fire over Plague | axe 1.23 s against 1.16 s (standing 1.06 s) | x1.06 |
| Wand, 0.4 s / 80% | Fire over Plague | sword 1.23 s against 1.14 s (standing 0.94 s) | x1.08 |

The next tightest is Fire over Sentenced with the wand (shield 1.74 s against 1.49 s, x1.16). The old draw and cast numbers as windups (bow 0.6 s / 70%, wand 0.2 s / 40%) steal 7 of the 20 cells, and `python3 testing/kite_windup_sweep.py` finds what holds: with a cap of 0.4 s or more, the bow needs a share of at least 0.89 (x1.02) and the wand 0.75 (x1.03); 0.92 and 0.8 give the margins above. **Frost is the other limit.** A Frost shooter slows its chaser to 0.7 inside 100 u (section 10.3), so after each shot it walks the gap back out to 100 u and the chaser must cover the last 40 u (100 minus the 60 u reach) inside ONE windup: (100 - 60) / (0.7 x 170) = 0.34 s. A Frost windup under about 0.31 s keeps the chaser out of reach for good, whatever the share, so the wand's cap must stay at or above about 0.35 s (at the old 0.2 s the two Frost-loser wand cells never close). The bow's 0.6 s cap is not near it.

**In the real sim** (`testing/TUNING_CONTROLS.md`). With both fighters playing the harness's policies, nine of the ten weapon edges hold, against a straight charge, a weave and a jink (before: ten of ten); **Wand over Shield fails, 23%** (Fire 33, Sentenced 0, Plague 56, Frost 0, Holy 28), because the harness wand backs away from a charging shield, which with no ranged slow no longer pays. When both fighters click each other, as players do, **all ten hold and Wand over Shield is 100%**. Kiting: a perfect orb-walking bow (the harness's `orbwalk` style) holds a chaser off 0.90 to 1.05 s against 0.85 to 1.00 s for a motionless one (x1.06 at worst), a perfect orb-walking wand 1.05 to 1.15 s against 0.75 to 0.85 s (**x1.40**, sword against wand). Longer wand windups (0.6 s / 0.8, 1.0 s / 0.95) were measured and rejected: they do not fix Wand over Shield (20% and 76%) and the second breaks Axe over Wand (73%) and the Frost wand. Whether to accept the policy-matrix failure is an owner question (section 18). A ball aimed at release instead of at the start of its cast breaks Axe over Wand (33%), so a ball keeps its start aim and an arrow its release aim.

**Best guesses, logged for the owner to overrule.**
- A windup the lock started is cancelled by the player's next walk, stop or lock on another fighter; a mob's or the harness's is committed, as above.
- The click snap is 64 u, and an empty click does nothing: there is no attack-move.
- 640 u is both the range a lock is accepted at and the leash it breaks at, and 1.5 s without line of sight breaks it once the target has been seen; locking needs no line of sight.
- The lock survives a swap or a pickup.
- The shield faces the locked target, else the cursor.
- A locked shot is aimed once, as it leaves, and flies straight (dodgeable).
- The bow stays immune to stagger.

---

## 10. How factions and weapons combine (class scaling)

### 10.1 The two loops together
- **Rule of thumb: weapons decide reach; factions decide trades.**
  - Who can hit whom, from where, is the weapon's job: range, blocks, interceptions.
  - Once two players are trading blows, the faction loop decides who outlasts whom.
- **Signature weapons keep almost every opening matchup contested.** Mostly, each faction starts with the weapon that **loses** the weapon edge against the factions it beats on stats:

  | Faction | Starts with | Beats (faction) | Weapon matchup in that opening |
  |---|---|---|---|
  | Fire | Axe | Sentenced (Bow), Plague (Bow) | Bow > Axe in both: contested |
  | Sentenced | **Bow** | Plague (Bow), Frost (Shield) | Bow vs Bow mirror: neutral; Shield > Bow: contested |
  | Plague | Bow | Frost (Shield), Holy (Wand) | Shield > Bow, Wand > Bow: contested |
  | Frost | Shield | Holy (Wand), Fire (Axe) | Wand > Shield, Axe > Shield: contested |
  | Holy | Wand | Fire (Axe), Sentenced (Bow) | Axe > Wand: contested; Wand > Bow: **favours Holy** |

  - **8 of the 10 openings are contested.** The faction winner starts with the losing weapon, so no fight is decided on the pick screen. The real decision is **which second weapon to go and get**.
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

### 10.2 The scaling formula
- **The weapon sets the shape. The faction sets the rhythm and the punch.**
- **A weapon is a % boost on the faction's base attack speed**, so the speed ratios between factions hold on every weapon.
  - Attacks per second = `faction rate × (1 + weapon boost) × attack-speed buffs`.
  - Seconds between attacks (the interval) = 1 ÷ that, never below the weapon's floor.
  - Boosts: sword +115%, bow +95%, wand +65%, shield +60%, axe +40%.
  - Floors (the shortest interval): sword 0.25 s, bow 0.25 s, wand 0.3 s, shield 0.3 s, axe 0.35 s. At base speed none of them binds. They only bind under attack-speed buffs (section 10.3).
- **Damage per hit** = `faction rate × faction hit × weapon damage multiplier × buffs × interval`. With no buffs that is `faction hit × damage multiplier ÷ (1 + boost)`. Every faction keeps its own damage per second, times the weapon's damage multiplier, on every weapon: faster weapons hit proportionally lighter. Weapons change the rhythm and shape, not the class's power.
- **Signature bonuses scale with the weapon multiplier too** (burn, backlash, disease, execute, mark). Otherwise a weapon's damage discount would hit some factions much harder than others.
- **Duel pace (k = 2).** All faction damage is doubled (and Sentenced's mark ramp quadrupled), HP unchanged, so every fight is **exactly twice as short** while the counter graph holds. For example, Frost over Holy drops from 52 s to about 26 s, and Fire over Plague takes 1.1 s.

Interval and damage per hit with no buffs, before duel pace (double the hits for in-game values):

| Faction | DPS | Sword | Axe | Bow | Wand | Shield |
|---|---|---|---|---|---|---|
| Fire | 90.0 | 0.78 s / 52 | 1.19 s / 83 | 0.85 s / 62 | 1.01 s / 73 | 1.04 s / 70 |
| Sentenced | 4.5 | 0.52 s / 2 | 0.79 s / 3 | 0.57 s / 2 | 0.67 s / 2 | 0.69 s / 2 |
| Plague | 37.0 | 0.25 s / 7 | 0.39 s / 11 | 0.28 s / 8 | 0.33 s / 10 | 0.34 s / 9 |
| Frost | 40.5 | 1.03 s / 31 | 1.59 s / 50 | 1.14 s / 37 | 1.35 s / 44 | 1.39 s / 42 |
| Holy | 61.8 | 0.49 s / 23 | 0.75 s / 36 | 0.54 s / 27 | 0.64 s / 32 | 0.66 s / 30 |

Reading the table:
- Every column has the same speed ratios: on any weapon Plague swings 4.1× as often as Frost and 3.1× as often as Fire.
- Fire with an axe swings every 1.2 s for an 83-damage hit; Plague with a bow fires 3.6 arrows a second.
- Frost with an axe is the slowest combo in the game, one swing every 1.6 s. In the 20 Hz duels the longest stretch with no swing from either fighter is also 1.6 s.
- Plague's sword (0.251 s) sits just above its 0.25 s floor, so any attack-speed buff on it turns into damage per hit at once.
- Windups are part of each interval (Controls rework, section 9.5): a bow cycle is rooted for 0.92 of it up to 0.6 s, a wand cycle for 0.8 up to 0.4 s. So Plague's bow (0.28 s) is rooted for 0.255 s of every cycle and Frost's bow (1.14 s) for 0.6 s of it, and an attack-speed buff shortens the interval and the windup together. The kite check assumes no buffs.
- Sentenced's weapon hits are near zero on purpose; the mark is its damage.

### 10.3 Signatures in real time
The design engine assumes two fighters standing in range forever. The game has movement, walls and up to 8 players, so the signatures follow these rules:

| Rule | Why |
|---|---|
| **Engagement.** A signature applies to your **current target**: the last enemy you hit, while they are within your own weapon's range and in line of sight (plus the linger below). | Turns 1v1 math into multiplayer rules, and stops ranged DoT classes winning from range without swinging |
| **The clock starts at first contact** between two players, not at your own first hit | Keeps fights from being decided by who swung first |
| **Bonus damage lingers 1.25 s** after line of sight breaks | Stops peek-fighting (pop out, hit, hide, repeat) |
| **The mark holds through breaks.** It freezes while hidden and resets on target switch, a weapon swap by the target, death, or 10 s without contact. | Sentenced isn't cheesed by walls |
| **Frost's chill** applies to everyone engaged with Frost. It doesn't stack, and it stretches the cooldown, the bow draw (its start and the moment the arrow leaves, so a chilled archer's cycle stays the interval over the chill's rate) and the press buffer smoothly every tick (it's never snapshotted at swing time). The other windups, a swing and a cast, are not stretched. The **movement** slow (x0.7) only applies within melee reach of Frost (about 100 u). | A small radius would let ranged enemies ignore the attack slow; a ranged Frost slowing its chaser would be uncatchable. Even so, a Frost shooter walks its chaser back out to 100 u after every shot, so its windup must stay long enough for the chaser to cross the last 40 u inside it, about 0.31 s (section 9.5). |
| **Fire's backlash** hits an engaged enemy each time they swing, sized by how often their weapon swings (200 ÷ (1 + the weapon's boost)): sword 93, bow 103, wand 121, shield 125, axe 143 | Literally "damaged when swinging", and over time it matches the design engine exactly. A flat 200 per swing would have over-punished fast weapons. |
| **HP stays fractional** and cooldown remainders carry over | Avoids rounding cliffs that flip close fights |
| **Healing** (when added) only works after 3 s out of combat. Holy's lifesteal is exempt. | Mid-duel heals flip faction counters; blocking lifesteal would break Holy |
| **Attack-speed buffs** past a weapon's floor (its shortest interval) turn into extra damage per hit. Plague's sword (0.251 s) is just above its 0.25 s floor, so any attack-speed buff on it converts at once. | Otherwise Plague on a sword would gain next to nothing from attack speed |
| **Windups scale with the interval.** Axe root = min(0.5 s, 50% of the interval) and windup = min(0.25 s, 25%). Bow draw = min(0.6 s, 92%), always a full draw. Wand cast = min(0.4 s, 80%). Sword and bash 0.1 s. Every windup roots the fighter (Controls rework: it replaces the old wand self-slow and the 10% ranged move multipliers). | Plague's axe swings every 0.39 s, shorter than a fixed 0.5 s root. Without this, fast cadences would be rooted for good. The ranged shares are the anti-kiting lever (section 9.5). |
| **Stagger immunity.** After a stagger, the target can't be staggered again for 0.5 s. | Plague's sword swings every 0.25 s and could otherwise stagger-lock a target |
| **A landed stagger pauses the staggered fighter's damage over time.** When a stagger lands (the 0.5 s immunity starts, whether or not it cancelled a swing), its burn, disease and mark stop for its weapon's windup: sword and shield 0.1 s, axe up to 0.25 s, wand cast up to 0.4 s, bow 0 (a bow draw is never cancelled). Fire's backlash never pauses, and the mark's clock keeps running. | A stagger only cancels a swing that is still winding up, so on average it costs a hit-based fighter one windup of its damage, and damage over time would lose nothing: a sword's staggers would trade only against hit-based factions (Holy lost Holy over Sentenced with both on swords). The pause costs the same expected damage. It exists only in the real sim; the 20 Hz model has no staggers. |

A 20-tick-per-second simulation of the damage rules above reproduces the full faction cycle with the same weapon on both sides (all five weapons), in every signature-weapon opening and in all 25 weapon pairings of every edge (before the 9.1 tuning, Holy over Sentenced lost with the bow or the shield against a sword; now all 250 cells win every phase pair at duel pace, and the thinnest, Holy's sword against Sentenced's wand or bow, keeps 17.4% HP in the worst case). It does not model movement, line of sight, stagger or the animation timings, except one approach: the kiting check (sections 9.4 and 9.5) charges a melee winner at a ranged loser, who since the Controls rework walks away between rooted shots.

---

## 11. Mobs and regions

- **Neutral by default.** Mobs idle near their camp and only fight once attacked.
- **They fight like their region.** Each mob uses its region's faction rules (scaled down) and that region's weapon. Frost mobs slow you; Plague mobs execute you below half HP.
- **Aggro and leash.** Once hit, a mob chases and fights with spacing that suits its weapon, and so does the rest of its camp (below). If you run far enough, out of its camp's territory, it gives up, walks home and regenerates.
- **Drops.** On death a mob gives:
  - a little **GV**;
  - **stacks of its type's buff** (section 12.2);
  - **its weapon**, unless the killer already holds that weapon type.

  Clearing the whole camp pays once more: one **shared chest** of skills for everyone near (section 12.5). A camp's chest is not the killer's.
- **Mono-type camps.** Every camp is one mob type: its normal mobs all share it, and the zone's elite type stands at the elite spot of each of its two elite camps. A zone has four types, three normal and the elite (Fire: Ember Imp, Cinder Hound, Magma Brute and the elite Wyrmling), and each gives its own buff (the table in 12.2). Types are drawn per zone without repeats when the room is built: a zone has eight camps, so the first three take its three normal types and each of the other five repeats one of them at random (every type stands in at least one camp; both elite camps hold the zone's one elite type). The roster is public from the lobby on: the planning screen names every camp's type and buff, so the map is also a shopping list for buffs. Mobs of one zone still fight identically (their zone's faction and weapon, scaled as below): the types differ by name and buff only.
- **One hit wakes the whole camp** (owner ruling, `CAMP_WIDE_AGGRO`). Damage to any mob wakes every idle mob of its camp onto the same attacker, even when the hit mob was already fighting, and so does a hit that kills it outright (the mates wake onto whoever is credited with the kill). The mates carry no threat of their own, so a pull earns no kill credit: a mob's kill still goes to whoever did that mob the most damage. A mob walking home ignores the call, a camp-mate of another camp stays asleep, a fighter that is hidden by Swarm is never handed on (the mates wait for a hit on someone they can see) and a stunned mate does nothing until its stun ends. Each woken mob keeps its own leash and give-up timer, so the camp can come apart as you kite. With the flag off, only the mob that is hit wakes.
- **Camps clear for good.** A camp is idle, engaged (from the first damage to any of its mobs, and never idle again) or cleared (all its mobs dead). Camps never respawn: a clear is permanent, whoever or whatever landed the last blow, and the coliseum teleport only puts the living mobs of camps that are not cleared back on their spots. The minimap and the planning map cross a cleared camp out, so everyone reads what was taken, and a line announces "Plague camp cleared" to everyone. The camp's state is synced; its chest is section 12.5.
- **Strength.** A mob is its region's faction with hp and every damage number scaled by **0.22**, and an elite by **0.65**. A normal mob was 0.45 until the camp began to wake together: at 0.45 a starter cleared a full camp of 4 in 4 of 25 pairings, so the owner ruled normal mobs weaker (elites stay as they were, and harder). Measured in the real simulation (signatures and the Phase 9.1 ranges included; a scripted player on the starting kit, which is its faction's signature weapon, no buffs and no second weapon):
  - *One mob at a time,* on a hand-built floor with a 9-tile leash. A player who stands and fights finishes a normal mob in 24 of the 25 starter-against-region pairings with about 91% hp left (the one that is not finished is a Frost shield against a Frost shield mob, which both block forever), and an elite in 22 of 25 with about 54% left. A player who backs away from a melee mob while shooting (the default policy) wins 22 of 25 normal pairings with about 84% left.
  - *A whole camp that wakes at the first hit,* which is what a run asks (`bench/campDuel.ts`, its `camp` pull, 12 seeds, cleared in every seed, on an open floor with the 9-tile leash, before the camps' territories reached the bench): a camp of 4 normals, the mean of the maps' camps (3 to 5 mobs), is cleared in 21 of 25 faction × zone pairings (23 at 3 mobs, 14 at 5). An elite camp (the elite and 3 normals) in 9 of 25, and every zone's elite camp falls to at least one starter. What fails is a Frost shield against a Frost zone (a stalemate), a Holy wand against a Sentenced sword camp (Sword beats Wand), a Sentenced bow against a Fire axe camp and, in a third of the seeds, against its own zone. Ranged starters do worst, and more so as the camp grows.

  What the starting kit cannot finish needs a second weapon, and that is the choice: the weapons you pick up decide which camps you farm. A player who backs away from a melee mob while shooting can still lose to it: the mob chases to its leash, gives up, heals and comes back, so a ranged weapon has to burst it down inside one round. Each region has two elite camps, and each holds **one elite**: the mob at its elite spot. The other mobs of such a camp are normal.
- **Drop numbers.** GV is 2 (elite 10) and a buff is 1.1 stacks of the mob's type (elite 3.1), both times the mob reward curve of section 12.3. At full reward (a feed near 0, the curve at about 0.98) three kills of one camp give about 3.2 stacks, the buff's quoted value (3 stacks), and one elite kill gives about 3.0 on its own. The weapon lies where the mob fell and anyone can take it; it is not dropped when the killer already holds that weapon type.
- **Who gets the kill.** The player who did the mob the most damage over the whole fight (since it last rested), among those still in the run, so a late shot cannot steal an elite. An exact tie goes by the tick's secret order. A mob that nobody in the run hit drops its weapon and pays nothing.
- **The leash is the camp's territory** (section 5), and never more than 12 tiles from the mob's own rest spot. A generated camp's territory reaches 10.8 to 30 tiles from the camp, so the 12-tile cap is what binds on almost every camp, unless the territory's edge comes first; a mob that has no territory to hold its spot (one placed with no camp, or in a hand-built test arena) keeps a 9-tile circle around its spot instead. A bow or wand mob backs away only to points a little way inside the leash.
- **Leash numbers.** Any hit from a player wakes the mob, wherever the player stands. It gives up when it leaves its leash, or 6 s after it last **dealt** damage (damage it takes does not extend the fight), or with nobody left to fight. It then walks home **ignoring everyone and taking no damage**: it starts nothing new (a shot already in the air still lands), and it is not a body, so swings and shots pass through it (its shield neither blocks nor reflects). It is whole again the moment it arrives, and is neutral again. A mob hurt by someone who was gone before it could wake heals after 3 s unhurt. So a shooter out of its reach gains nothing by kiting it: every round ends with a whole mob, and a ranged weapon has to burst a melee mob down inside one round. A mob whose shield blocks or reflects a hit wakes too. A bow or wand mob backs away from a player who is too close, but only inside its leash and only to open the gap; cornered at the edge it stands and shoots. A hit on one mob wakes its whole camp (above), and each woken mob then follows this paragraph on its own. That call matters at four mobs a camp: in the scripted camp duels a starting kit clears a camp with every mob awake in only 8 of 75 runs (24 of 75 with three mobs), so waking the whole camp waits on weaker mobs, which the owner wants and the camp runtime will tune. Mobs never hurt each other, and their shots fly past each other. Dead mobs do not respawn. When the patience timer teleports everyone into the coliseum, every living mob is put back on its camp spot at full health.
- **Same input path as players.** Mobs use the same input rules and combat code as players, so a sword mob and a sword player behave identically. A mob holds the trigger itself (it never locks a target), and its windups root it like anyone's.
- **Mob types.** The 20 types (four per region) are in section 12.2 with their buffs. Each camp's `alive` count is synced, and a mob's type and camp ride its state. A cleared camp drops a shared skill chest (section 12.5); relics in the chest and "?" camps that hide their reward are planned, not built (see `docs/ROGUELIKE_PLAN.md`).
- **Later.** Raid-boss mobs (section 2.2). Quest NPCs have a first version (`docs/quests.md`).

---

## 12. Snowballing and anti-snowballing

Getting fed should feel like a fed League carry or a Slay the Spire run where the build "just comes together". Getting ahead is meant to feel powerful. The limits are soft: **rewards fall off and bounties rise**, rather than hard caps.

### 12.1 Feed score
`feed = player kills + 0.25 × mob kills` for the current run.

### 12.2 Buffs: one per mob type, S-shaped
Every mob type (section 11) gives its own buff, and a kill adds stacks of the buff of the mob's type. A buff's numbers follow an S-curve of its stacks: small at first, a spike around the 3rd to 5th stack, then a plateau. The numbers in the table below are the value **at 3 stacks** (the quoted value); at n stacks every number of the buff is multiplied by S(n) / S(3), with S(x) = sigmoid(x − 3) − sigmoid(−3):

| Stacks | 1 | 2 | **3** | **4** | 5 | 6 | 8 | plateau |
|---|---|---|---|---|---|---|---|---|
| Share of the quoted value | ×0.16 | ×0.49 | **×1** | **×1.51** | ×1.84 | ×2.00 | ×2.09 | about ×2.1 |

So Ember Imp's +10% damage is +1.6% at 1 stack, +4.9% at 2, +10% at 3, +15.1% at 4, +20% at 6 and about +21% at the plateau. Stacks are real numbers: a drop is scaled by the reward curve below, and a bounty moves half of each buff. A drop is 1.1 stacks (an elite 3.1) times that curve, so three kills of one camp, or one elite kill, reach the quoted value when you are hungry. Rows of one stat from different buffs add (two +5% damage rows are +10%, never ×1.1025), and different stats multiply where the game combines them (attack speed with damage per hit, move speed with the chill). An on-hit effect's cap never rises: more stacks reach it sooner and no further.

| Zone | Mob type | Buff at 3 stacks | Cap | Strong against |
|---|---|---|---|---|
| Fire | Ember Imp | +10% damage | plateau | anyone |
| Fire | Cinder Hound | +10% move speed while chasing your target | plateau | kiters, bow users, wand users |
| Fire | Magma Brute | +6% max HP and +20 magic resist | plateau | Fire, Sentenced, magic damage |
| Fire | Wyrmling (elite) | +20% damage to targets above 70% HP | plateau | high-HP fighters, Frost, Demon Blood |
| Sentenced | Bailiff | +16% mark ramp speed (Sentenced only) | plateau | – |
| Sentenced | Chain Warden | Your hits slow movement 10% for 1 s (up to 25%) \* | 25% total | kiters, bow users, wand users |
| Sentenced | Inquisitor | +12% damage to a target you have kept hitting for 3 s \* | plateau | long duels |
| Sentenced | Executioner (elite) | +30% damage to targets below 30% HP | plateau | healers, Demon Blood |
| Plague | Plague Rat | +8% attack speed | plateau | anyone |
| Plague | Bloatfly | Your hits deal 8 damage/s for 3 s \* | 1 instance per source (it refreshes) | Frost, high-HP fighters |
| Plague | Rot Monk | Your hits cut healing 12% for 3 s (up to 40%) \* | 40% total | Demon Blood, lifesteal, healers |
| Plague | Rat Ogre (elite) | +16% damage to targets below 50% HP | plateau | – |
| Frost | Frost Wisp | Your hits slow attacks 6% for 2 s (up to 15%) \* | 15% total | Plague, fast attackers |
| Frost | Ice Golem | +8% max HP | plateau | burst damage |
| Frost | Rime Stalker | +20 armor | plateau | Plague, Frost, Demon Blood, physical damage |
| Frost | Glacial Warden (elite) | +20% damage to slowed or chilled targets \* | plateau | – |
| Demon Blood | Acolyte | +4% lifesteal | all lifesteal rows together at most 25% | sustain |
| Demon Blood | Seraph Shard | +16 magic resist | plateau | Fire, Sentenced, magic damage |
| Demon Blood | Penitent | +2% damage per 10% HP missing | plateau | comebacks |
| Demon Blood | Blood Saint (elite) | Below 30% HP: heal 20% of max HP (once per run) | once per run | burst damage |

\* Not built: these effects put statuses on a hit (slows, damage over time, anti-heal) or test them ("slowed", "streak"). The status system exists (it came with the Wishes, section 8.9); wiring it to hits is a later phase (R4b). The HUD and the planning screen show the buff and mark it "(coming)", and it does nothing yet.

How the rows work:
- **Damage** (Ember Imp, the vs and scale rows, and the damage and vs rows of the passives) is a multiplier on the weapon hits and the signature damage you deal (burn, backlash, disease, the mark), applied before armor and magic resist. It never touches a Wish's damage, whether the rows come from buffs or from passives: ability power is flat (8.9). So Sentenced, whose damage is almost all its mark, benefits in full. The conditions (target above 70% or below 30% or 50% HP, Penitent's missing HP) are read as the tick's hits began, so the order hits are applied in never matters. Penitent adds its bonus per whole 10% of your own missing HP, in steps.
- **Magic resist** is the faction's `shield` stat (section 8.1, rule 3: it cuts the magic share of a hit; the buff text says "magic resist" so it is not read as the barrier), and **armor** its armor stat. Both are flat points added to the faction's own, under the same `1 / (1 + stat / 100)` reduction. A max-HP buff raises HP by the same amount, so you never end up lower on the bar than before.
- **Attack speed is capped, damage is not.** Attack speed from every source together never goes above ×1.5 (the League approach: one cap on the total, applied after every source multiplies, so a slow still lands below it); buffs alone never reach it (Plague Rat's plateau is ×1.17), it matters once passives, skills and relics stack (`testing/TUNING_ROGUE.md`). The damage rows have no cap, on purpose (owner ruling): a fed player may beat a counter, and a buffed shooter can beat Holy over Sentenced (section 18). The on-hit effects and lifesteal have caps of their own. Damage rows from different buffs add: Ember Imp, Executioner, Rat Ogre and Penitent at 3 stacks each give +74% against a target below 30% HP while you are at 10% HP or less (×2.56 at the plateau). Flat armor and magic resist count most for a faction that has none of that stat: +20 armor makes Fire or Holy (armor 0) take about 15% to 17% less from a Plague, Frost or Holy hit at 3 stacks (26% to 30% at the plateau), and Magma Brute plus Seraph Shard (+36 magic resist) make Plague (no shield) take about 26% less from Fire or Sentenced (about 43% at the plateau). The reduction is `1 / (1 + stat / 100)`, so it never reaches zero.
- **Cinder Hound** speeds you up while you hold a target lock, one tick after the lock starts or ends.
- **Bailiff** makes Sentenced's mark ramp toward its cap faster by that much, and does nothing for anyone else.
- **Acolyte** gives lifesteal to any faction, with no heal lockout, like Holy's own. Holy's lifesteal comes on top and the total never passes 100% (the 25% cap is on the buffs alone).
- **Blood Saint** heals the first time a hit leaves you below 30% HP, once per run, even inside the heal lockout; the healed share scales with the stacks like any number.
- **Kill combos are gone.** The bursts, the kill shield and the cooldown reset of the old three-stat system no longer exist; they come back as relic and skill synergies (planned). The barrier still exists as a stat for the HP bar (a pale-blue segment) and has no source until skills arrive.

One buff is smaller than one stat of the old three-stat system, whose plateau was +66% HP, +47% attack speed and +28% move speed, but a build stacks several. The owner doubled the first picks (every value above is twice the plan's draft; caps, durations, thresholds and the drops are unchanged). The numbers stay first picks, and the mob reward curve, the catch-up and the bounty were tuned to the old magnitudes.

### 12.3 Mob rewards fall as you get fed
Mob GV and buff value are multiplied by a curve that's near full while you're hungry, drops sharply around a feed of 5, and never goes below 30%:

| Feed | 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| Mob reward | ×0.98 | ×0.92 | ×0.85 | ×0.76 | ×0.65 | ×0.54 | ×0.45 | ×0.38 | ×0.32 |

Players more than 2 feed behind the lobby median get **×1.25** from mobs (catch-up).

### 12.4 Bounties (shutdowns)
`bounty = 10 × max(0, player kills − 2)^1.5` GV. **Only player kills count.** Mob kills still raise your feed (section 12.1), and so feed the buffs and set the mob reward curve and the catch-up, but they never raise your bounty.

**Who gets the kill.** The player whose hit lands in the killing tick (the biggest of them, if several do). When a mob (or a shooter's arrow that outlived them) finishes a player, or a player leaves, the kill and the bounty go to the last player who hit them within 5 s, so walking into a camp or quitting cannot dodge a bounty. Sudden death credits nobody.

| Player kills | ≤ 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|
| Bounty (GV) | 0 | 10 | 28 | 52 | 80 | 112 | 147 | 226 |

- **Announcement.** When a player's bounty first appears and when it grows, the host announces "*name* is on a rampage — bounty N GV", at most once per player per 10 s. A rise inside that window is held back and announced with its value when the window ends.
- **Crown.** Bountied players wear a crown. *Not built yet:* their position flashing on everyone's minimap for 2 s every 10 s.
- **Shutdown.** Killing a bountied player pays the bounty and **half the stacks of each buff they hold** to the killer (a buff you did not have starts at that half), so comebacks are real.
- **Trade-off, intended.** A fed player can beat their counters, as in League. Bounties and falling rewards are the release valves.
- A big bounty can be worth more than winning (52 GV at 5 player kills against a 50 GV win bonus). That makes hunting the fed player a goal in its own right.

### 12.5 Camp chests and passives (as built, R5)
Clearing a camp pays something the mobs' own drops do not: a **shared chest** of skills. It is the run's source of passives and the reason a route matters: the chest is for whoever is there.

- **The drop.** The moment the last mob of a camp dies, whoever or whatever killed it, one chest appears on the camp's chest tile (its centre if that tile is a wall) and the camp is marked cleared. The chest lasts **15 seconds** from the drop and is never extended; it is gone at the coliseum teleport and when the run ends. Every camp drops one, elite camps included, until relics and "?" camps arrive.
- **Options.** The chest offers **three** passives, the same three to everyone, in a fixed order. The first is the camp's zone passive when the zone has one that is built (Sentenced, Plague and Demon Blood have one each, Fire and Frost none yet), then neutral passives, no duplicates. The options are rolled from a private server stream when the camp clears. They are public in the game state (the chest is contested and a rejoining player must see it), so the chest panel shows them only to a player in reach, but a modified client could read them from anywhere (section 18).
- **Picking.** Each player picks **once** per chest: one skill, or a skip, and a skip counts as the pick. A skill is yours for the run at rank 1; picking one you hold at rank 1 makes it rank 2, and one you hold at rank 2 cannot be picked. Each option goes to **one** player: the first to pick takes it, the cards of the others show "Taken by <name>" and they may pick another while the chest lasts. Two picks of one option in the same tick go to the tick's secret order (as for loot), and the loser may pick again. The server checks every pick against the picker's server position and state: standing, not stunned, not casting (a pick is an action like picking up a weapon), the chest still up, within 96 units of it with a clear line, not yet picked, the option free and not already at rank 2. A pick the server refuses comes back as a short message ("Too far away", "Can't reach that", "Already taken", "Already at rank 2", "You already picked", "Chest gone", "Can't do that now") and uses nothing up. A passive acts from the tick it is taken, and a max-hp passive raises your hp bar with it.
- **Skipping** heals 15% of your max hp, subject to the 3-second out-of-combat heal lockout. If that heals nothing (you fought a moment ago, or you are at full hp) it pays 3 GV instead, which counts against the 30 GV a run can earn from mobs. In the practice room a skip pays no GV.
- **The chest panel** opens by itself on the right edge while you stand within 88 units (8 less than the server's range) of a live chest with a clear line, measured from your server position, and shows a countdown and the three cards: the skill, the rank the pick gives you, what it does for your faction, and who took it. Once open it stays open out to 92 units, so walking along the edge does not make it flicker or drop a pick on its way. The range is checked on the position the client last heard of, so a player walking away can still be refused "Too far away" at the edge. It never takes a click meant for the world: a mouse click in the first quarter second after it opens is ignored, so a cursor clicking away over the world cannot take a pick it never saw, and its buttons are out of the browser's Tab order until you press C. It greys every card slightly before the chest expires (half your round trip plus 50 ms, the round trip being the order delay plus one tick), so you do not click into a closed door. Controls are in section 14.
- **Passives.** 21 are designed, each with two ranks; 9 are built, and the rest are listed in the catalog and do nothing yet. They are effect rows like the buffs' (12.2): a damage row from a passive and from a buff add, and attack speed from every source is capped at ×1.5. The tests a row makes against its target (hp, feed, whom it fights) are read as the tick's hits began, so the order hits are applied in never matters.

| Passive | Pool | Rank 1 | Rank 2 |
|---|---|---|---|
| Whetstone | Neutral | +6% damage | +10% damage |
| Swift Boots | Neutral | +6% move speed, but not while you shoot or for 2.5 s after a bow or wand shot | +10% |
| Quickdraw | Neutral | Melee windups 50% shorter: the sword and the shield bash land one tick (50 ms) sooner, the axe two (suits the sword, axe and shield; a bow or wand windup never shortens) | 75% shorter: the axe three ticks sooner and walking again 7 ticks sooner |
| Thick Hide | Neutral | +6% max HP, +5 armor, +5 magic resist | +10% max HP, +8 armor, +8 magic resist |
| Bounty Hunter | Neutral | +10% damage to a player whose feed is higher than yours | +15% |
| Second Wind | Neutral | Once per run, the first time a hit leaves you below 25% HP: heal 20% of max HP over 1.5 s (four steps of 5%, 500 ms apart, the first at once), through the lockout | 30% (four steps of 7.5%), and it can fire again after each coliseum teleport (a heal still being paid out is dropped at the teleport) |
| Witness | Sentenced | +8% damage to a target that is fighting someone else | +12% |
| Pestilence | Plague | Plague: its execute starts at 60% HP (from 50%). Everyone else: +8% damage to targets below 60% HP | Plague: 70%. Others: +12% |
| Last Rites | Demon Blood | +25% attack speed below 30% HP | +25% attack speed below 40% HP |

A target is "fighting someone else" when its target lock, its mob fight target or its signature target names a fighter other than you. Second Wind's heal ignores the heal lockout but not an anti-heal, and stops if you fall. Quickdraw is melee only (owner ruling "Melee windups only", section 9.5): the sword's, the bash's and the axe's windups shorten, the axe's root with its windup, and a bow's or wand's never does. Windups end on 50 ms ticks, so the cuts are the ones that remove whole ticks: the sword and the bash go from two ticks to one at both ranks (one tick is the floor, so rank 2 adds nothing for them), the Fire and Frost axe from five ticks (and ten rooted) to three (five rooted) at rank 1 and two (three rooted) at rank 2, Sentenced's and Holy's from four (eight rooted) to two (four) and one (two), Plague's from two (four) to one (two) and one (one). Its HUD tooltip says melee only and whole ticks. The kiting check is unaffected by a shooter holding it and a melee chaser holding it only gains (`testing/TUNING_ROGUE.md` section 7.3). Swift Boots is "no boost while shooting" (owner ruling): its bonus is off from the moment a bow or wand attack starts until 2.5 s after the shot leaves, and on otherwise, so it helps walking, chasing and melee but never buys a shooter the walk back between shots. The pause is 2.5 s because Frost's chill stretches a chilled shooter's cooldown 2.5 times (Fire's wand idles 2.1 s between shots against Frost); the real sim's kiting check then reads as without the boots at both ranks (section 7.4).

*Planned, not built* (they have text in the catalog and are never offered): Firebrand and Hoarfrost Armor wait for the on-hit statuses (R4b); Ashwalk, Double Sentence, Sentence Served, Bite Twice, Shatter, Frozen Path, Radiance and Quartermaster wait for the active skills on Q and E (R6); Searing Riposte and Scout wait for relics and "?" camps (R7). The numbers are the plan's first picks; the owner retunes them, and none was run through the kiting check or the weapon harness.

---

## 13. GV economy and meta progression

| Source | GV |
|---|---|
| Win (last one standing) | +50, only if the run had at least 3 players and the winner damaged at least 2 different opponents (guards against farming with a second profile). The win still counts either way. |
| Player kill | +10 |
| Bounty claimed | Per section 12.4 |
| Mob kill | +2 (elites +10) × the mob reward curve (and the ×1.25 catch-up, so a hungry player's elite pays 12), rounded to whole GV, at most 30 per run from mobs |

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

| Feedback | What you see |
|---|---|
| Faction and weapon at a glance | Every player wears their faction colour and shows a weapon silhouette, readable at a distance |
| Damage flash | A red vignette when you take a real hit, scaled by damage. Small ticks don't flash. |
| Counter hue | Near an enemy (in sight, within about 450 u) the screen takes a soft tint: **green** if you counter them, **red** if they counter you. The score adds the faction edge and the weapon edge (±1 each) and fades with distance. |
| Your target | A thin light ring on the enemy a left-click would lock, a red ring on the one you have locked. The bow's pull is drawn from its synced start, so everyone sees a draw build |
| Wishes | A small icon of each fighter's Wish by its name, grey until it is ready. A telegraph over every cast that has a cast time (Freeze's beam, Swarm's gathering swarm, Trial's growing ring); an effect on every fighter under a status (stun stars, shackles, a gold rim, a dashed outline, speed streaks); the cloud, the ring and the trail drawn on the ground. Blaze Step and Last Stand have no telegraph before the cast (section 8.8) |
| Sentenced | A visibly growing brand on the marked target |
| Holy | Heal numbers when lifesteal lands |
| Plague | A "below half" execute cue on its target |
| Fire | A burst of flame on any enemy who swings while engaged with Fire |
| Frost | Frost on chilled enemies |
| Fed players | Crown and rampage announcements (minimap pings are not built yet) |
| Your buffs | A build strip under your HP: one chip per buff you hold, with its zone's colour and marker shape (never colour alone), the mob type's name (an elite's buff has a star), the stacks held, what they give now and what the next kill of that type adds. Hovering a chip gives the full wording, what the buff suits and what it is strong against. A buff whose effect needs on-hit statuses (R4b) is marked "(coming)". A feed line explains the mob reward: "Feed 2.5 (kills + mobs/4) · mobs pay x0.89" |
| Buff news | A toast for your own gains ("Ember Imp +1.1 (3.2): +11.1% damage", or the buffs listed when a bounty kill moves several), a floating line over anyone else's, and a ring in the buff's zone colour on the fighter who gained |
| Your passives | A row under the buff strip, shown once you hold one: a chip per passive with its zone's mark, its name and its rank (R1, R2). Hovering a chip shows what it gives at that rank, what rank 2 adds, and what it suits and counters |
| Camp chest | While you stand within 88 units of a live chest, a card on the right edge: the camp's zone and name ("Plague camp"), a countdown, three skill cards (the skill, the rank the pick gives you, what it does, and who took it) and Skip. Cards grey just before the chest vanishes. In the world the chest wears a pick-range mark and a ring and timer that drain over its 15 seconds, with a cue when it drops. Your own pick is a line ("You took Whetstone") |
| Camps | The minimap and the planning or Tab map cross out a cleared camp, ring a camp somebody has fought at (a small muted ring and "Someone has fought here": the state never goes back, so it is history and not a fight under way), and show each live chest as a pulsing blip with its seconds left. "Plague camp cleared" is announced to everyone |
| Barrier | A pale-blue bubble around the player, a blue segment on the HP bar and "+N barrier" in the readout, for everyone to see. Nothing gives one yet (skills, planned) |
| Planning screen | The whole map with the zones (each a colour, a floor pattern and a marker shape), every camp (its mob type, its buff, a crown on an elite camp, your matchup against it with a sign and a tone: "+62%", "~35%", "!10%", "lose"), the weapon crates, your two spawns with "taken" live, who is in the room and who is ready, a countdown and the route you draw with its walking time. The lobby shows the same map small and read-only; in a run, hold Tab. The HUD line reads "Planning 0:07" |
| Mobs | Faction colour and weapon like a player; the HP bar shows once a mob is hurt or fighting, and an elite's always shows. Elites wear a gold ring and a star over a gold name. A fallen mob shrinks and fades, and its weapon stays on the ground. Living mobs show as dots on the minimap |
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
- **Persistence.** Profiles (GV, stats, cosmetics) live in a crash-safe JSON file behind a store interface, so a database can replace it later.
- **Bots.** Bots fill lobbies, play full runs and power the end-to-end tests (`docs/BOTS.md`). One human-like brain sits behind two drivers: the server's own fill bots (inside the room, with no profile or connection: up to `BOTS_FILL_TO`, 6 by default, arriving in the last seconds of a lobby, tagged `[BOT]`, never paying GV or a bounty to whoever kills one and never counting for the win bonus) and the `npm run bots` network client. They see what a player's screen and minimap show, answer in a few hundred milliseconds, miss clicks, and play like a person with the game's controls: they walk, click their foe (`target`) and let the server fight, swap and pick up weapons, cast their faction's Wish by the intent tags of the ability, and step off embers. At the planning screen they read for a few seconds (2 to 8, by skill tier), pick one of their two dealt spawns by the matchup of the camps nearest it (the better one nearly always at Hard, sometimes the worse at Easy) and press ready. They walk to a cleared camp's chest and take a card (`choose`). Not built: the quest decision module, the Q/E skills and relics, and a penalty for hunting a fighter whose Wish is ready (`docs/BOTS.md` 8).

---

## 17. Balance and verification
- **The design oracle** is `python3 testing/test_rpsls.py`:
  - the 10-edge graph at four timesteps;
  - each faction beats exactly two;
  - power-scale invariance;
  - name-shuffle invariance;
  - ±5/±10% jitter robustness;
  - a purity audit (no faction names in the rules);
  - the identity tests.
- **Parity.** The game's TypeScript copy of the faction rules must reproduce the Python results for all 20 matchups.
- **Harnesses** (they report, never block the build):
  - the weapon loop, scripted duels per weapon pair;
  - the faction cycle per weapon (5 weapons × 10 edges);
  - kiting tolerance.

  `python3 testing/realtime_report.py` (needs numpy, about a minute) runs the last two as 20 Hz weapon duels, with signature openings, buff thresholds and the longest stretch with no swing. `python3 testing/test_kite.py` (about 5 s) is the kiting guarantee at duel pace against a shooter that walks between its rooted shots, one PASS or FAIL per cell, and `python3 testing/kite_windup_sweep.py` (about 10 s) sweeps the bow's and the wand's windups against it.
  Results go to the designer before any tuning.
- **The real-sim weapon harness**: `npm run harness -w @raid/server` (`-- --core` for a 30 s run without the sensitivity passes). Every weapon duel plays out in the real sim with two policy-driven clients; it prints the weapon matrix, a style grid for every edge with a ranged weapon (a ranged fighter can stand, strafe or kite; a melee fighter can charge straight or **weave**, approaching off the line and changing side every 0.4 s), an edge verdict (holds, or fails and why, with the factions where a reply is thin), the same edges when both fighters click each other (the target lock), and the kiting table (a shooter that never moves, stands, strafes, kites, **orb-walks** (the perfect kiter: it stands only for its windups) or **locks** its chaser). `-- --grid-setups full` runs every grid cell on all 18 setups instead of 3 (steadier, about 3 times the time).
- **Mob and camp strength** (report only): `npx tsx packages/server/bench/mobDuel.ts` plays a starting player against one mob of every region (`--style stand` is the measure of section 11), and `npx tsx packages/server/bench/campDuel.ts` against a whole camp. Its `camp` pull places the mobs with their camp, so the first hit wakes them all through the real aggro rule; `single` (one at a time, the camp before R5) and `group` (all awake at the start, harsher) are kept. `--size N` sets the camp size, `--k` and `--elite-k` try another scale, and `--sweep` prints the pairings cleared (of 25) per scale and size. The owner's target for the weaker-mobs ruling is at least 20 of 25 faction × zone pairings clearing a full camp of 4: it measures 21.
- **The faction cycle in the real sim**: `npm run harness:factions -w @raid/server -- --python` plays every edge with the same weapon on both sides and on the signature openings, with each hit and shot landing in the tick it starts, and checks it pair by pair against `testing/realtime.py` (60 of 60 cells agree). `-- --mode policy` plays them as moving fighters by the shared weapon policies from 18 starting setups, with staggers, blocks and projectile flight; its failing cells (the four shield mirrors and Plague's bow against Frost's shield) are weapon-layer problems, listed in `testing/TUNING_10.md` section 6. Both report and never block the build.
- **Budgets.** Server tick time with 8 players and the map's ~160 mobs, bytes per second per player, and what a map costs to make.
  - **Tick:** At the zone-shapes merge (136 x 136, 177 mobs on the bench maps) `step()` averages 0.51 ms with a p99 of 1.25 ms, 0.62 / 1.58 ms in the pathfinder's worst case (`--stress`) and 0.38 / 0.74 ms with every buff at 4 stacks (`--buffs`); with 8 in-process fill bots the whole tick is 0.74 to 0.87 ms. On R2's 96 x 96 maps (about 80 mobs) `step()` with 8 players at 8 camps averaged 0.2 to 0.4 ms and its p99 stays between 0.6 and 1 ms; the pathfinder's worst case (`--stress`: about 72 mobs awake, 52 fighting, 7.4 of 8 players holding a lock, every camp woken every second) averages 0.33 to 0.6 ms with a p99 of 0.9 to 3 ms (0.36 / 0.91 ms, `--buffs` 0.35 / 0.94 ms and `--stress` 0.60 / 1.44 ms on the R2 + R5 tree at load average 20); every buff at 4 stacks on all 8 players (`--buffs`) is a case of its own (gate: 5 ms average, 15 ms p99 for each case, best of five attempts, judged by the smaller of wall-clock and CPU time). `npx tsx packages/server/bench/stepBench.ts [--buffs] [--stress]`; `test/perf.test.ts` is the gate, and `test/pathLoad.test.ts` counts the path searches (97 a second against a throttle ceiling of 304; 0.03 ms each, 1.5 ms at worst).
  - **Bandwidth:** per client, websocket payload, measured headless with the real encoder: at the zone-shapes merge (136 x 136, 177 mobs) 6.49 and 7.18 KB/s typical at seeds 1 and 2, 10.59 and 9.81 with eight whole camps woken every half second, 3.25 and 3.31 idle, 6.82 and 6.84 with five camp chests up, and a joiner's first full sync of 22.5 to 23.9 KB (the schema encoder's buffer is 64 KB for it); on R2's 96 x 96 maps (about 80 mobs at `MOB_K` 0.22, seeds 1 to 5, 732 and 2547): 6.1 to 7.1 KB/s typical, 8.9 to 10.6 KB/s with 20 to 25 mobs fighting (eight whole camps woken every half second, the most 8 players can pull), 6.0 to 7.0 KB/s typical with five camp chests up, and 3.1 to 3.3 KB/s with nobody fighting; a joiner's first full sync is 11.6 to 12.7 KB (gate: 20 KB/s; the figures of the 60-mob wedge map, 7.1 to 8.0, 9.4 to 12.1 and 3.0 to 3.2, are not comparable: that bench woke one mob at a time). Sleeping mobs cost nothing. Two things hold it down: all of a step's fx travel as one compact message (`fxs`, which also announces each arrow and ball: they are not in the synced state), and the synced numbers are narrow on the wire (float32 positions, uint32 timers). `npx tsx packages/server/bench/bandwidth.ts`; `test/bandwidth.test.ts` is the gate. StateView is not needed yet, and would help most on this larger map. The plan's 16.5 KB/s for the heavy case is a report-only target, not asserted. A reward chest's three arrays (`options`, `takenBy`, `pickers`) are on every weapon container too and cost 0.14 to 0.24 KB/s.
  - **Map generation:** at the final review about 33 ms on average, 64 ms at p99 and 80 ms at worst (300 seeds, the server's path) (the targets are 45 and 120). The lane tables are gone (four of them took 44 MB per process and 40 to 75 ms to build); warming the layouts takes about 7 ms. `npx tsx packages/shared/scripts/mapBench.ts` prints the time per stage against the targets; `mapgen.perf.test.ts` gates the median, scaled by a yardstick measured on one machine. In Chrome a 136 x 136 map bakes in 95 ms on the worker path and a join reaches the scene in 354 ms (1x CPU; 4x throttle not measured).
  - **Certification sweeps:** `npx tsx packages/shared/scripts/mapSweep.ts <count>` runs an independent certifier, written apart from the generator, over seeds 0 to 1,999 (16 shards): no failures, no decor mismatch and no discards, and per-zone measures (rays, engagement pairs, camp-graph stretch and loops, wall pieces, features) judged against windows, with two report-only breaches, the Rime's rays at bow range and its ice share (section 5.3).
- **End-to-end.** Bots play full arena runs to a winner, with GV and bounties balancing exactly.

---

## 18. Open questions and known risks

| Topic | Note |
|---|---|
| Long fights and third-partying | In an 8-player arena, long duels invite a third player to clean up. Duel pace ×2 helps; it gets watched in playtests. |
| Readable counters | Losing to a counter you didn't see coming feels random. Faction colours, weapon silhouettes and the counter hue are the mitigation. |
| Kiting | Equal move speed lets ranged weapons kite. Held back by short ranges (bow 240 u, wand 220 u), by every attack rooting its shooter for a windup (bow 0.92 of the interval up to 0.6 s, wand 0.8 up to 0.4 s), and by ranged damage no higher than the melee weapons'. The check is against a shooter that walks away between its shots (section 9.5) and passes at duel pace in all 20 cells, with the thinnest, Fire over Plague with the bow, at 1.23 s of tolerance against 1.16 s of orb-walk free fire (x1.06). The margin is a few percent: a windup tweak, a range increase or a melee cut can flip it, and the check runs without attack-speed buffs. A Frost shooter with a windup under about 0.31 s could walk a chilled chaser out of reach for good, so the wand's windup cap must stay above about 0.35 s. In the real sim the harness's perfect orb-walker (`orbwalk`) is worst at x1.06 for the bow and x1.40 for the wand against a motionless shooter (1.05 to 1.15 s of free fire from a wand, about the model's 1.14 s for its tightest wand cell), and it is an upper bound: a right-click drops the lock, so each step of an orb-walk costs a click to move and a click to lock again (`testing/TUNING_CONTROLS.md`). The maps no longer cap sight (the 480 u cover is gone, owner ruling), so this guarantee rests on the windups and the ranges alone; the zone duels of section 5.3 measure what the open ground costs. The check and the harness never cast a Wish: `testing/WISHES.md` reasons about what Freeze, Blaze Step, Last Stand, Swarm and Trial do to them: Freeze and Blaze Step each end one approach's worth of kiting, Last Stand cuts a Holy chaser's free fire by a quarter to a half, Swarm is outside the model, and in a what-if Trial flips Fire over Sentenced (section 18, W5). |
| Weaving melee approach | (Measured before the Controls rework, with the old ranged move slows. After it, in the real sim: Bow over Sword 100% / 93% / 100% and Bow over Axe 93% / 100% / 93% against a straight charge / weave / jink, no thin Fire column for either, but Wand over Shield fails, below.) The weapon edges were tuned against a melee fighter that charges straight, then re-checked against a weave and a quick jink. All ten hold (Bow over Axe 82% against the jink once the axe is at 0.77; it was 44% at 0.8), but the Fire column stays thin for Bow over Axe, Bow over Sword and Wand over Shield (11 to 44%): Fire's 500 HP make hit-count cliffs, so a faction number (Phase 10) or a projectile that leads is what would move them (section 9.4, `testing/TUNING_9_1.md`). |
| Frost frustration | Its movement slow makes it the hardest class to escape. That's its identity, but it gets watched. |
| Frost against a chilled shooter | Before the Controls rework the chill stretched a shooter's cooldown but not the slow recovery after its shot, so between shots a chilled shooter walked away at full speed (the movement slow is only within 100 u). In the real sim Frost's axe still won every setup against Fire's wand but kept 2.7% HP in the worst case (36% when the chill stretched the recovery). The recovery is gone: a chilled shooter now roots for its windup and walks between shots, and the old numbers have not been re-measured (the weapon harness runs with signatures off; `testing/TUNING_CONTROLS.md`, open question 6). The earlier owner call (a longer chill-move radius or a Frost-only recovery stretch; `testing/TUNING_10.md` section 4) is moot in its old form. |
| Controls are best guesses | The owner may overrule these (section 9.5): a windup the lock started is cancelled by the player's next order, as League does, with the cooldown refunded (a mob's stays committed); the click snap is 64 u; an empty click does nothing, so there is no attack-move; a lock is accepted and kept out to 640 u, and breaks after 1.5 s out of sight; it survives a swap or a pickup; the shield faces the locked enemy, else the cursor; a locked shot flies straight and can be dodged; the bow still ignores stagger. |
| Wand over Shield in the policy matrix | After the Controls rework the weapon harness's policy wand loses to its policy shield, 23% (Fire 33, Sentenced 0, Plague 56, Frost 0, Holy 28; 100% before). It holds at 100% when both fighters click each other. The harness wand backs away from a charging shield, which with no ranged slow no longer pays; longer wand windups did not fix it and broke Axe over Wand. Reported, nothing changed, the ranged slows were not brought back. Owner call: accept it, or give the harness wand no back-off (`testing/TUNING_CONTROLS.md`). |
| Sentenced feel | Its weapon hits are nearly zero by design; the brand visual has to carry the class. |
| Fire's burn | Nearly cosmetic in the current numbers. |
| Frost over Fire | Thinner since v3 in the engine: Frost keeps 49% HP (was 59%), because Fire's backlash reads Frost's faster rate. In the worst 20 Hz signature opening at k = 1 it keeps 44% (v2 47%; v3 with the pre-9.1 weapons 34%). It never flips: the smallest HP buff on Fire that flips it is ×1.90 (v2 ×1.97; v3 with the pre-9.1 weapons ×1.59). Raising Fire's own rate is free at equal damage per second (no engine result moves, at most 3 points in the 20 Hz duels); it is Frost's rate that feeds the backlash. |
| Snowballing | Uncapped S-curves plus bounties need playtesting: are fed players fun to fight, and is hunting them worth it? |
| The faction cycle matters most late | Early fights are mostly weapons, positioning and third parties. The cycle decides the 1v1s, often in the coliseum. |
| Bounties within a tick | If several players hit a fed player in the same tick, who gets the payout has to be decided by a fair rule. |
| Buffs past the counters | (Measured against the old three-stat curve, +32% HP at three stacks and a plateau of +66%; the per-mob-type buffs of 12.2 are smaller per buff, but a build stacks several, and the check has not been re-run with them.) In the 20 Hz check (same weapon on both sides, plus the signature openings; the 9.1 weapon numbers, Holy's lifesteal as in v3) the softest HP edge, Holy over Sentenced, flips at ×1.30 HP on the losing side (about three stacks in the S-curve of 12.2, +32%). The softest attack-speed edges, Plague over Frost at ×1.66 (×1.79 on its signature opening) and Frost over Holy at ×1.73 on its signature opening (×1.84 on the five mirrors), sit above the curve's plateau of about +47%. Stacked, HP ×1.2 with attack speed ×1.2 and HP ×1.2 with attack speed ×1.3 hold every edge at 60% or better. HP ×1.3 with attack speed ×1.2 does not: Holy over Sentenced then wins 0% with both sides on swords, 45% on bows and 52% on shields. With attack speed ×1.3 as well, Plague over Frost wins 0% on all five mirrors and Holy over Sentenced 0% on swords, 27% on bows and 29% on shields. Move speed isn't modelled there. The S-curve deliberately goes past these numbers (fed players can beat their counters); bounties are the release valve. **Ruled (after R4a):** fed players may beat their counters: the damage rows stay uncapped, attack speed from every source is capped at ×1.5 (12.2), and a buffed shooter beating Holy over Sentenced is accepted with no retune (`testing/TUNING_ROGUE.md` section 6). |
| Weapon edges inside one faction | With signatures on, several weapon edges flip when both fighters are the same faction: in a Fire mirror Sword over Axe goes from 100% to 0% and Sword over Wand to 11%; in a Sentenced mirror Sword over Axe, Sword over Wand and Axe over Wand go to 0%. Sentenced's damage is almost all the mark times the weapon's damage multiplier, and a Fire sword's staggers cancel axe windups, so the axe swings less and takes less backlash. Owner decision: the weapon loop is designed for the faction cycle's openings, and nothing was retuned (`testing/TUNING_10.md` section 8). |
| Wishes: no warning before Blaze Step and Last Stand (W1) | Both are instant (no cast time), so their tell comes only after the cast: a flare at both ends and a trail, a gold burst and a rim. A blink with a pre-cast is no escape and a survival button with a delay loses to burst, which is why they have none, but an enemy gets no read on either. Owner call: keep them instant, or give them a short telegraph. |
| Wishes: Swarm hides only on an honest client (W2) | The browser does not draw a hidden fighter and the server refuses every lock and ability on it, but every client still receives every position and the server still accepts the low-level `attack` input, so a modified client can find the fighter and attack its true position. The fix is interest management (per-client state) and refusing `attack` from game clients; until then the cloud marks the place for everyone anyway. |
| Wishes: Last Stand at the teleport and in sudden death (W3) | A Last Stand running when the coliseum teleport comes ends and still pays its heal (the damage was real and the teleport is the arena's, not an enemy's). Its 5 s floor also keeps a fighter alive through sudden death's burn for 5 s, which can decide a finish. Owner call: keep both, or pay nothing at the teleport. |
| Wishes: Trial's ±20% is relative (W4) | Everything else about a Wish is flat, but Trial's ×0.8 and ×1.2 scale with what the two fighters deal, so a fed caster gains more from it. It is the owner's rule. |
| Wishes: Swarm drops its caster's lock (W9) | Casting Swarm drops your lock, and only the lock: your walk goes on after the cast, because an escape must not stop you. Otherwise a Plague locked on a foe kept swinging out of the cloud and was revealed at once, so the 300 s escape did nothing. The cost: a Plague that wants to fight from it must click again, which shows it for the swing and 0.5 s. Owner call: keep it, or keep the lock and have a hidden fighter's lock hold no trigger. The bots slip away while their Swarm is casting and hidden and never lock anyone then. |
| Wishes: numbers are best guesses (W5) | Every Wish number, the trail's burn (30 true damage a second for 2 s, about 60 a crossing), the 5 s practice cooldown, and the maximum times and caps in the status table (8.9). A balance pass retunes them; the harness and the kiting check do not cast. The first thing to look at is Trial against a charging Fire: in the 20 Hz what-if its x1.2 and x0.8 over a 2.5 s duel (inside the 5 s ring) cut Fire over Sentenced's tolerance from 1.89 s to 0.88 s (bow) and 1.74 s to 0.83 s (wand) against 1.16 s and 1.49 s of free fire (`testing/WISHES.md`). |
| Wishes: stunned shields still block (W6) | A stun freezes facing but not the guard: a shield blocks toward where it faced, so a flank beats a stunned shield and the frontal hit still bounces. Owner call: keep it, or let a stun drop the guard. |
| Wishes: reconciliation with the roguelike plan (W7) | Settled: the attack slow is wired as a stat-mirror source, Frost's chill stays a faction signature and is not a status, and the statuses hold still while damage lands. Left for the skills phase: `barrier` and a crowd-control immunity are appended (three effect bits are spare), the move-speed status hands its slows and haste to the speed mirror when that lands (it then keeps only the stop), and an ability's effect list is meant to be the roguelike plan's on-trigger action list (settled for `status` and `cleanse`, which `TriggerAction` now takes from `AbilityEffect`; only `heal`, `barrier` and `cooldown` stay trigger-only until the skills phase). |
| Wishes: the end-to-end runs require a Wish (W8) | The bot e2e replays once if no bot's Wish landed, as it does for a kill, a signature hit or a mob kill. If that ever fails twice, keep the invariants (no cast before the lock ends, at most one cast per bot, every fx names a player) and drop the requirement rather than loosen the others. |
| Camps: how hard is a pull (R5) | The camp wakes together (owner ruling), so camp strength was retuned: MOB_K 0.22, ELITE_K 0.65, and a starter on its signature weapon clears a camp of 4 in 21 of 25 pairings (bench/campDuel.ts, section 11), against the target of 20. The misses are structural, not numbers: a Frost shield against Frost (both block), a Holy wand against a Sentenced sword camp, a Sentenced bow against Fire, and ranged starters in general (14 of 25 at 5 mobs). Elite camps clear in 9 of 25, on purpose. The figures come from one scripted player with no second weapon, never humans or camp-mates: playtests will move MOB_K, ELITE_K and the leash. The elite lever is ELITE_K (0.50 would clear 12 of 25 but a lone elite stops being a fight). |
| Shared chest: public contents, hidden pickers (R5) | A chest's options and takers are in the synced state (D17: contested, and they must survive a reconnect), so a modified client reads every chest on the map; the panel merely hides them out of range. A pick names its picker even while Swarm hides it (a pick is not a reveal), which shows a hidden player is within reach of that chest. Interest management would cover the first; whether a pick should reveal like a cast is the owner's call. |
| Shared chest: the panel's clock (R5) | The panel greys its cards at the chest's expiry minus (half the round trip + 50 ms), but the round trip it uses is the prediction's order delay, not a measured ping, so a very slow or jittery link greys a card late or early. Some refusals (an option the chest lacks, a phase that is not active) are silent, and the panel then says "not confirmed" after 0.6 s. |
| Passives are first picks (R5) | The numbers are the plan's (3.6), nine of 21 built, and the owner retunes them. Only Quickdraw and Swift Boots were run through the kiting check, and both were ruled on: Quickdraw shortens melee windups only (-50% / -75%, sized in whole ticks) and Swift Boots is off while shooting and for 2.5 s after (`testing/TUNING_ROGUE.md` section 7); with those rules a holder of either keeps the real sim's KITE EDGES at the baseline 1 of 20 orbwalk failures (a melee chaser holding Quickdraw: 0). Open: whether 2.5 s is too long a pause (a shorter one lets the boots back into the gap a chilled shooter idles in), and Last Rites' +25% attack speed against the ×1.5 cap. Fire and Frost chests offer neutrals only until the on-hit statuses land (R4b). |
| The Rime's ice | Solved by the zone shapes: the cover that put a rock in every 3x3 is gone, and the Rime has two ice lakes (590 tiles a map, 17.4% of its floor). What remains is a number the owner may overrule: its rays reach bow range in 81.7% of cases against the 62 to 78% the contract expected (only 6% of maps inside it), because the lakes make it the most open zone, and ice is at least 12% of its floor on 94.5% of seeds against a target of 95%. Lever: more headlands, or accept it. |
| Two Rime meres (Zone shapes, owner question 1) | The Rime has two meres of about 295 ice tiles each (590 a Rime, ice share 17%; each lake is grown to 400 tiles and the lanes, headlands and spire take the rest), the default. The alternative is one mere grown toward 700 tiles, which would hit the clearance of a camp's clearing at about 450 tiles and so read as a smaller share. |
| Loot density on the bigger map (Zone shapes, owner question 2) | The map has twice the area, and loot scales with its square root: 4 to 6 crates a zone (20 to 30 a map) and 30 to 45 ground spots a map (one pick for the whole map; the default), a density of 0.72 of before with the nearest loot about 17% farther. The alternative keeps the density: 6 to 8 crates a zone and 40 to 60 spots a map. |
| Longer spawn walks (Zone shapes, owner question 3) | A start to the coliseum centre is 57 / 62.6 / 67 tiles (10th / 50th / 90th percentile), 10.7 / 11.8 / 12.7 s, against 50 tiles and 9.4 s at the median on the 96 x 96 map, measured the same way (the walk the gate certifies and the planning screen shows). The patience timers (300 s first, 120 to 300 s after a death) and the teleport are unchanged (the default); in the tournament at the zone-shapes merge the teleport came in 92% of games (50% on the 64 x 64 map) and games lasted 327 s. Retune any of them if it feels slow. |
| The Rows' headroom (Zone shapes) | The Rows were approved on condition that Fire still beats Sentenced at a fence, and it does (96 of 96, hp margin +50 against +63 in the open), but the worst pocket has a margin of +24 at the built gate period of 12 and about +5 at 16. In the real Gallows the fenced Fire over Plague duel is 91% against 100% on open floor. The gate spacing is the lever if melee should have it easier; widen it only with the condition rerun. |
| Generation cost (Zone shapes) | A certified 136 x 136 map costs about 33 ms on average, 64 ms at p99 and 80 ms at worst in Node (300 seeds, the server's path; targets 45 and 120), 1.009 attempts a seed over 2,000 seeds. The styler stage reads 12.1 ms against a target of 10 and the landmark stage 2.5 ms against 1 (report-only). |

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
| **Signature weapon** | The weapon each faction starts with |
| **Wish** | A faction's once-a-run ability on `D` (Freeze, Swarm, Trial, Blaze Step, Last Stand): locked for 45 s, then a 300 s cooldown |
| **Cast** | Using an ability: validated, committed (cooldown spent, rooted if it has a cast time), then it lands and takes effect |
| **Status** | A timed effect on a fighter (stun, root, silence, slows, anti-heal, a burn, hidden, a zone, a death floor, haste), all from one table with caps and cleanse classes |
| **Hidden** | Untargetable and not drawn for others until its own attack or cast reveals it (Swarm) |
| **Engaged** | Fighting a specific enemy: you hit them recently or they hit you |
| **Planning** | The 12-second step between the lobby and the run: pick one of two dealt spawns, read the camps, draw a route |
| **Camp chest** | The shared chest a cleared camp drops: three passive skills for 15 s, one pick per player, each option to one player (12.5) |
| **Passive** | A skill with two ranks that works for the whole run once picked from a camp chest; 21 designed, 9 built (12.5) |
| **Skip** | Taking nothing from a camp chest: heals 15% of max HP, or pays 3 GV when it cannot heal. It counts as your pick |
| **Cleared** | A camp whose mobs are all dead. It never comes back |
| **Buff** | What a mob type gives its killer: stacks on an S-curve, one buff per mob type (12.2) |
| **Feed** | Your run's kill score (player kills + a quarter per mob kill); sets the mob reward curve and the catch-up. The bounty counts player kills only |
| **Bounty / shutdown** | GV and buffs paid for killing a player with several player kills |
| **Edge** | One "A beats B" relationship in a counter loop |
| **Margin** | Winner's remaining HP fraction minus the loser's, in points |
