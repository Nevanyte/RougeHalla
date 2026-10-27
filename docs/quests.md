# Quests

*K1 quest play on the current roguelike architecture. The shared catalog and placement live in `packages/shared/src/quests.ts`, the authoritative runtime in `packages/server/src/sim/quests.ts`, and the bot-facing contract in [quests-bot-hook.md](quests-bot-hook.md).*

## 1. What quests add

A generated-map raid offers ten optional, standing quests: five known during planning and five rumoured until scouted. A giver and its objective are deliberately far apart, so an offer is a route and exposure decision rather than another camp beside the spawn. There is no accept button and no personal instance: everyone races for the same offer, and the first eligible turn-in closes it for the lobby.

The K1 rules are deliberately small:

| Rule | Current behavior |
| --- | --- |
| Roster | `QUEST_COUNT = 10`, with at least two kill, two collect and two fetch offers; `QUEST_KNOWN_COUNT = 5`. |
| Timing | Each def has its own fixed `expiresAtSec`, from 150 to 300 seconds of active play. Planning does not advance it. |
| Rewards | One card (`QuestDef.reward.card`, a base card of tier I-III by the quest's time, one tier lower for a fed player), granted through the chest's own `grantCard`, plus fixed GV from a separate per-run pot capped by `QUEST_GV_CAP = 24`. |
| Competition | Per-player progress, one global winner per offer, automatic turn-in at the giver. There is no per-player completion cap. |
| Hidden offers | Unknown offers stay server-side. The finder gets a private reveal four seconds before the offer enters synced state for everyone. |
| Items | Collect tokens advance progress on pickup. A fetch parcel has one public carrier at a time, and a player can carry only one parcel. |
| Fill bots | Server-filled bots (`bot === true`, docs/BOTS.md) take no part in quests at all: no progress of any kind, no pickup, turn-in, win or reveal. Killing one advances nothing and pays nothing (a bot's death pays no kill GV), and a bot's kill of a human advances nothing. One guard, `takesPart` (inside `standing`, `sim/quests.ts`), is asked by every entry point. |
| Training | No quests in training rooms. `QUESTS=0` (or `false`) disables them in arena rooms. |

The roster still has fixed size and fixed per-offer expiries. Carrying a parcel does not disable ordinary farm rewards, and carrier minimap markers are exact rather than fuzzy.

## 2. Planning and hidden information

The roster, quest-id order and every placement roll come from a separate private quest stream, `World.questRandom`. `createWorld` seeds it from its own `questSalt` option: four more crypto-random words the Room takes from `crypto.randomBytes`, independent of `rewardSalt`, so the stream shares no state with the reward stream whose early outputs (camp rosters, chest options) every client sees. Only a world built without a `questSalt` (tests, the harness, questBench) falls back to a mixed derivation of the reward salt (`questSaltFrom`, `sim/world.ts`). Quest code never draws from `world.rewardRandom`, `world.random` or the public map seed, so turning quests on or off does not move later reward or world rolls. Setup returns before making any draw when quests are disabled, in training, or on a map with no camps.

Rolling begins when planning starts so the five known offers can inform spawn and route choices. The planning screen shows each known offer's name, kind, giver position, fixed duration (`expiresAtSec`, not a countdown while the world is frozen) and reward; the remaining offers appear only as a rumour count. During planning these are `QuestState` rows only: giver mobs and item containers are created at `raidStarted`, not while the world is frozen. The quest simulation does not tick in `planning`: nobody moves, fights, picks up an item, reveals an offer, turns one in or consumes its active-run timer. Raid startup anchors every active deadline to `raidStartedAt`.

Placement (`placeQuests`) is two passes over the same private stream: the known offers first, then the hidden ones in their own random pass (`PlaceOptions.hiddenRandom` lets a test hold the known positions fixed and vary only the hidden pass). Each pass shuffles the candidate tiles once and takes spots greedily against the giver gap, and the hidden pass also keeps that gap to the known givers and stays clear of every spawn-pool start by more than the reveal radius (Placement, below). The returned offers are then shuffled privately and take quest ids in that order, so an id carries neither the offer's theme nor whether it is a known one. Consequently, generating the public map and observing the known givers or id gaps does not determine the hidden giver set: the known givers only rule out the ground within the gap of them. An unknown quest is not represented by a `QuestState` with `known: false`. Before reveal it has no synced quest entry, giver mob or item containers, so a modified client cannot read its def, position or progress from room state. `RaidState.unknownQuests`, the number still hidden from everyone, is its only public representation.

When standing players are within `QUEST_REVEAL_RADIUS` (12 tiles) of a hidden giver, the eligible player with the lowest secret `tieRank` is the finder; map iteration and join order do not decide the race, and a fill bot is never eligible (it is skipped, and the next human in range is the finder). Then:

1. the server records that finder and sends only that client `questReveal` (`QuestRevealMessage`: `id`, `def`, `x`, `y`, `expiresAt`);
2. for `QUEST_REVEAL_HEAD_START_MS = 4000` the offer remains absent from public synced state;
3. the server then publishes the offer, its giver and its items to everyone, and a public toast names the finder.

No new reveal starts once `gatesLocked` is set. The head start is information, not a reservation: no objective progress or items exist before publication, and another player can still win afterward. Multiple pending `questReveal` previews are kept independently, so discovering more than one hidden offer does not discard an earlier preview. The client drops a preview when its public entry arrives, when its deadline passes, and at the coliseum teleport and the run's end (the server deletes an offer that never went public at those moments without a word, so the preview would otherwise stay in the log as an open offer nobody can reach); the log's rumour count excludes a revealed preview. Reconnecting does not entitle a client to hidden runtime data or another player's private messages.

A hidden offer closes unpublished only on its own clock or with the raid: its deadline (`expiresAtSec` from the raid's start), the coliseum teleport or the run's end. It is deleted at once with no toast. The public `unknownQuests` count is the number of offers not yet public, a previewed one included, and exactly four things move it: publication lowers it by one, a hidden offer's deadline lowers it by one, and the teleport and the run's end take it to 0. A camp clear never moves it: the early closure of an impossible kill offer (section 3) skips hidden offers, because a drop on the tick a zone was emptied would tell everyone that a hidden offer of that zone existed (and a missing drop would tell them none did). A hidden offer that is already impossible when it goes public is checked once at that moment (for that offer only) and closes like any public one: an `expired` row for the log and one toast. What remains is a timing leak: a drop at a deadline only one def has (165, 220 or 280 s into the raid) names that def, and any drop says some hidden offer lapsed, never where it stood. That is the same class as a timed expiry and is known and accepted. The finder's preview and the offer share one deadline, so a preview never outlives its offer except through the teleport or the run's end, which the client handles.

## 3. Objectives and items

Every def in `QUEST_DEFS` supplies its display text, objective `count`, objective/travel estimates, reward and expiry. Progress is public per player in `QuestState.progress`; it is capped at the objective count. A standing offer needs both a finished objective and a turn-in within `QUEST_TURN_IN_RANGE`, with line of sight to the giver. Same-tick rivals use the sim's secret `tieRank`, not map iteration or join order.

### Kill

- **Region culls** require three mob kills in the named far zone; an elite of that zone counts like any other mob (`onMobKilled` checks only the zone).
- **Worth the Walk** requires an elite, from any zone. (`QuestDef.elite` together with `region` is not supported yet: neither `onMobKilled` nor `killSupplyLeft` reads the region of an elite def, and no def combines them.)
- **The Grand Tour** requires a mob kill in each of three different zones; server runtime keeps the visited-zone set and syncs its size as progress.
- **A Head for a Head** requires a player kill and uses the `playerKilled` hook with the victim and outcome. Only a victim outcome of `died` advances it; an MIA departure does not, even if ordinary kill/bounty rules credit a recent attacker. A fill bot is neither killer nor victim here: killing one advances nothing and pays nothing, and a bot's kill of a human advances nothing. Its small reward is intentional because the kill, bounty and removal of a rival already pay.

Mob objectives are fed by the chainable `mobKilled` hook, which `payMobKill` calls once the kill's spoils are paid (after the mob's weapon is dropped or armed, inside the deferred payout). Its payload is `{ type, zone, camp, elite }`: the mob-type id, its zone, its camp's index in `map.camps` (-1 for a mob placed with no camp) and whether it was an elite. A practice mob in a training room never reaches it (practice kills pay nothing, and quests are never installed there). Quest handlers chain rather than replace other hooks and never decide kill credit; a killer who is no longer standing when the payout runs gets no progress.

**Early closure.** Camps never respawn, so the mobs standing now are all the kills a kill offer will ever get. The chained `campCleared` hook does not close anything itself: it only sets a re-check flag, because it runs before the clearing kill's own `mobKilled` and would close an offer that kill has just finished. `questSystem` evaluates the flag after the ledger pass (`closeImpossible`). An open kill offer (not the player-kill one) closes only when no standing player could still finish it: each standing player either already has the whole objective (only the turn-in is left) or the live regional mobs the offer counts still cover what they lack (the offer's zone, any elite for Worth the Walk, zones not yet visited for the Grand Tour). A dead or departed player's progress counts for nothing, and with nobody standing nothing closes. Hidden offers are not checked here (section 2): one that is already impossible when it goes public is checked once then and closes like any public offer. Fill bots do not count as a player who could still finish an offer.

### Collect

Tokens are quest containers with more copies on the ground than the objective needs. Pickup uses the ordinary `F` interaction and increments that player's progress without occupying a weapon slot or the parcel slot. Once the player has the required count, further token pickup for that offer is refused and the excess token is not consumed (see Pickup below). Camp tokens avoid camp chest tiles and mob rest spots; the Quartermaster's Cache uses middle-camp sites and Offerings at the Edge uses outer starts and region poles rather than wedge-only rings.

### Fetch and carriers

A fetch offer places one parcel far from its giver. `F` picks it up if the player is not already carrying one. The ground container disappears, `QuestState.carrier` names the carrier, and everyone can see the carrier marker. The first carrier has no exclusive right to finish: on death the parcel drops where they fell and another player can steal it with the same ordinary pickup input. Completion, expiry, the coliseum teleport and run end remove a ground or carried parcel and clear its carrier link.

Displacement and concealment do not silently complete or destroy a delivery during ordinary active play:

- Swarm keeps the parcel. The honest client may hide the fighter, but the parcel and carrier marker remain drawn at the carrier's position.
- Blaze Step keeps the parcel through the blink.
- Going down still drops it. The coliseum teleport is different: it closes the offer without pay and removes the parcel rather than carrying it through the gates.

### Pickup

The server never chooses between containers. `pickup { containerId }` acts on exactly the id the client sent, if the player is not stunned or casting and stands within `INTERACT_RANGE` (56 u) of it by the server's position with a clear line on the movement mask. A quest item is then refused, and left where it lies, when its quest is not open and published ("That quest is over"), when the player already carries any parcel ("you can carry one quest item"), when the parcel is already carried by someone else, or (tokens) when the player's progress is already at the count. A camp's card chest is never taken this way (`choose` is its input).

The client's F pick (`render/interact.ts`: `nearestContainer`, `questItemEligible`) mirrors those cases from the synced state and never offers a quest item the server would refuse, so an unusable item cannot shadow a weapon lying next to it. It always skips them, with or without a weapon in reach, and with no quest context (a caller that passes none) every quest item is skipped.

## 4. Runtime and presentation

`installQuests` joins the normal module architecture. The pure sim owns all decisions; Colyseus only validates/enqueues inputs and forwards events and private messages. Known state uses `RaidState.quests`, keyed by quest id. `QuestState` holds `def`, giver `x/y`, `status` (`open`, `done` or `expired`), `doneBy`, `expiresAt`, `carrier` and per-player `progress`; the shared def keyed by `def` supplies the name, kind, objective count and reward. Quest items use ordinary synced containers. Completion and every kind of expiry share one `retire` step: it clears the carrier link and the carrier's entry, removes the ground items and the giver at once, and clamps `expiresAt` to the close time (so the log's timer stops). A public closed row then remains for **20 seconds** with `status: "done"` or `"expired"` (a row is `open`, `done` or `expired`, nothing else), and `questSystem` deletes it from both synced and runtime state; because that system runs only while the run is `active`, rows closed by the run's end stay until the room is disposed. An offer that closes before publication is deleted immediately and never appears publicly (section 2).

Givers remain neutral `MobState` entries of kind `quest`, but are not combatants for gameplay purposes. Explicit guards keep them immune to target lock, mob AI, melee, projectiles and Wish targeting/effects. They do not wake camps, take damage or receive statuses. Clients should render them as quest NPCs, never as valid enemies, and only while their offer is open.

The quest system is a `world.systems` entry after mob AI and before the final stat-mod update. It runs only for an active raid, after the damage ledger and its deferred payouts. It handles closed-row cleanup, early closure, delayed reveals, expiry and automatic turn-in without changing the fixed combat order. A completion therefore cannot change who survives the tick's damage pass. Chained `teleported` and `runEnded` hooks close every open offer without pay: published rows become expired, hidden offers are deleted, and givers, tokens, parcels and carried links are removed. These hooks use the same closure path as ordinary expiry; no hidden reveal can begin behind locked gates. Announcements: expiries that happen in one tick are batched into one line ("Quest expired: name", or "N quests expired"); the teleport announces its closures once, in the same form; the run's end is silent. Completion is announced once, to everyone, naming the completer.

### Rewards

Every def has an explicit `farZone` (it places the far end of the route) and `QuestDef.reward = { card, gv }`: one **base card** (`ad2`, `haste1`, `vitality2`... `shared/src/cards.ts`, GAME_DESIGN 12) and fixed GV. The old per-kill buffs are gone, and so is the stack arithmetic that paid them.

The card's tier is the quest's time, in camps. `questTierPoints(objSec, travelSec) = (objSec + TRAVEL_RATE_SHARE x travelSec) / CAMP_SECONDS x CARD_TIER_RATE x STACK_PREMIUM`: the seconds the quest costs (travel counted at 40%, because the route can incidentally farm), over the 48 s of a camp, times the 1.35 tier points a normal camp's chest gives on average, times the 15% risk premium (the walker is the gank target). The nominal tier is that value rounded into 1-3 (`questTier`), and **a player-kill quest (`players`) is capped at tier I**: its objective already pays a kill, a bounty and a rival's removal. The catalog test holds every def to its stated `card`.

Completion pays in this order: the GV (`awardQuestGv`, below), then the card through `grantCard(world, combatant, questRewardCard(def, feed))`, then the toast `Quest complete: <Card title>`. `questRewardCard` is the **feed brake**: a player whose mob reward curve at their feed (`rewardCurve(feedOfPlayer)`) is below `QUEST_FEED_BRAKE` (0.65, the curve at a feed of 5) gets the card one tier lower, never below tier I. The catch-up needs no rule of its own: a player behind the lobby median is not braked. The card is a base card, so it always stacks and `grantCard` never refuses it. The planning screen and the quest log show the nominal card (`questRewardText`, from the card's own `cardText`); a fed player is paid one tier less than the line says. There are no quest heals.

Quest GV is fixed by the def and paid through `awardQuestGv`. It has a separate per-run pot capped at **24 GV** (`QUEST_GV_CAP`), independent of `GV_MOB_CAP`; completions after the pot is exhausted still pay their card. Results show the `quest` breakdown row separately from kills, mobs, bounty and the win bonus.

### Placement

Placement reads only the map contract: `camps` (zone, centre, clearing radius, mob rest `spots`, `chest`), `spawnPool`, `regions[].pole`, the coliseum, the tiles with their `TILE_LOW` collision, zone `terrain`, and reachability. It assumes no zone shape, camp count or map size, never runs inside map generation, changes no hashed layer, and adds no draw to the public map stream. It runs once, at planning start (or at raid start when planning is off), never in a tick of the running raid.

- **Reachability** is the coliseum centre's movement component (`questHomeComponent`, from `moveComponents`: one flood per map, cached on the map, exactly the tiles `findPath` can walk between, so there is no path search per candidate). A hand-built map whose centre is a wall uses the component holding most spawn-pool starts, and a map with neither has no restriction.
- **Givers** (`npcCandidates`) stand on plain floor that fits `circleClear(..., PLAYER_RADIUS)` on the movement mask (no wall, `TILE_LOW` or hazard terrain: ember, bog, ice or light), in that component, outside the coliseum footprint (2-tile margin), three tiles beyond every camp clearing (`r` plus 3 tiles), three tiles from every camp chest and mob rest spot, and at least `QUEST_NPC_SPAWN_MIN_TILES` (8) from a spawn-pool start; a dense map gets a second pass at half that start distance, the only clearance that relaxes. A hidden giver additionally stays `QUEST_REVEAL_RADIUS` + 2 tiles (14) from every spawn-pool start: the reveal is a plain distance test with no line of sight, and without this a third of the hidden givers (66 of 200 on seeds 1..40) lay inside the 12-tile radius of some start and revealed themselves on the first tick to whoever spawned there. The known givers keep only the 8-tile rule, since they are public anyway. On a cramped map the hidden pass steps this clearance down (`QUEST_HIDDEN_START_CLEARANCES`: 14, 12, 6, 0 tiles) until at least two spots per hidden offer remain; which step applies depends on the public map alone. Givers keep `QUEST_NPC_GAP_TILES` (7 tiles) apart, relaxed tile by tile down to 3 when the map runs out of room.
- **Passes.** Known offers first, then the hidden ones (section 2). A region-themed offer takes its pass's spot farthest from that region's pole; the other offers take the next spot in the pass's private shuffle.
- **Pieces.** Tokens and parcels stay off hazard floor, off a one-tile halo round every camp chest and a two-tile halo round every mob rest spot, inside the giver's component, and never share a tile with each other or any giver. Camp tokens scatter round the region's camp farthest from the giver; the Quartermaster's Cache uses the middle third of the camps by distance from the coliseum; Offerings at the Edge uses the outer spawn-pool starts and region poles. A fetch parcel takes the farthest reachable tile (Chebyshev) from its giver among the zone's camps, starts and pole (any zone for the Long Haul). `QUEST_FETCH_MIN_TILES` (36) is a target, not a guard: generated maps clear it (a shared test checks it), and a cramped map would just take the farthest tile.
- An offer whose pieces will not place is dropped rather than placed badly. The ids come out shuffled (section 2).

**Measurements on the R2 maps** (themed `generateMap` seeds, the finished code). The audit placed every roster of ten offers on seeds 1..150 and checked each giver, token and parcel: none was dropped, none lay unreachable from the coliseum, on hazard terrain or `TILE_LOW`, inside a camp clearing, within three tiles (giver) of a camp chest or mob rest spot, on a chest or rest tile, or on a tile shared with another piece. The numbers come from scratch scripts that are not kept in the repository (the timings are single-machine wall time); the audit was repeated while this section was written with identical counts, and the timings with a difference under 0.5 ms.

| Measurement | Result |
| --- | --- |
| Offers placed / dropped, and seed set | 1500 / 0, seeds 1..150 (10 per seed) |
| Hidden givers within 14 tiles of a spawn-pool start; seeds that needed a relaxed clearance | 0 of 750 (nearest 14.0 tiles); 0 of 150 |
| Givers inside clearings, on chest/rest tiles, on LOW, or on hazard terrain | 0 of 1500 givers (0 within three tiles of a chest or rest spot) |
| Tokens/parcels on chest/rest tiles, unreachable, on hazard or LOW, or sharing a tile | 0 |
| `placeQuests` synchronous cost, seeds 1..30, cold map object | median 0.8 ms, max 7.4 ms |
| `spawnQuests` end to end (roster, placement, runtime rows), seeds 1..30 | median 0.9 ms, max 3.9 ms |
| For comparison, the first version (a path search per candidate) | 48.5 ms median, 76 ms max |

### Browser UI

- **J** toggles the scrolling quest log in planning and in the active phase (`questLogAvailable`; training is active, and there it opens with `No quests in practice`). It ignores J while a text field has the focus or a `[role=dialog]` (the help or settings card) does. The log is placed live by `ui/questLogLayout.ts` (`placeQuestLog`, pure): its top is the measured bottom of the HUD plate (`Hud.plate`: status, vitals, the cards row, the build strip, arena lines) plus 8 px, so it never covers the coliseum countdown or the cards row however tall it grows; its width is 34% of the overlay width clamped to 260..370 px; its height stops short of the weapon-bar reserve (108 px from the bottom) and it scrolls. It reads `--ui-w` and `--ui-h`, not the window. Rows are grouped open first, then done, then expired; a closed row (done, or expired by the server's word or by the clock) gets a `closed` class, shows no timer and is dimmed, and leaves when the server removes it after the grace period. Unrevealed offers contribute only to the rumour count, which excludes a preview the finder already holds.
- The world view gives open givers a distinct NPC shape and `!`, gives tokens and parcels distinct shapes, and marks a parcel carrier. Closed offers leave no phantom giver or open-offer marker.
- The minimap shows open givers and exact carrier positions, but only one objective marker: the current objective nearest the local player (the ready turn-in point, a visible item or a kill region).
- Lifecycle toasts name the finder when a reveal becomes public, announce completion and public expiry, and report parcels dropped or stolen. The server sends the completion once, to everyone, and batches the expiries of one tick into one line, so the completer gets one completion toast and the +GV toast stays visible in the three-slot stack. The client folds them too (`ui/questToasts.ts`, in front of the toast stack): expiry lines that arrive within 150 ms become one line, and a completer's second line for the same offer within 2 s (a private "Quest complete" next to the public one) is dropped. The one-item refusal says exactly `you can carry one quest item`. A nearby open giver shows a turn-in hint when the local objective is ready.
- The planning screen and these run views use the same public quest information; none reconstructs server-only offers. Planning shows rows and markers only, while actual giver bodies and items appear at raid start.

## 5. Balance worksheet

These are design calculations, **not measured completion times or a questBench result** (the questBench section below has measurements; the objective and travel seconds here were estimated before the larger R2 maps and have not been re-fitted to them). The original per-quest `objSec` and `travelSec` estimates are retained as explicit assumptions so they can be replaced by harness measurements later.

Assumptions:

1. One normal mob costs 12 seconds all-in (`FARM_SECONDS_PER_MOB`), including fighting, walking and recovery; a camp of four costs `CAMP_SECONDS = 48`.
2. Only 40% of pure quest travel is charged as lost farm time (`TRAVEL_RATE_SHARE = 0.4`), because the route can incidentally farm and loot.
3. A camp's chest gives 1.35 tier points on average (`CARD_TIER_RATE`: 70/25/5 base tiers, balance contract 4.8). The reward carries a 15% risk premium (`STACK_PREMIUM = 1.15`). GV has no risk premium.
4. A card's tier is its power: a tier-II card is worth two tier points, and the PvP factor reads `cardPower` (the sum of tier x count), so a tier is the one yardstick for quests, chests and farming. Different stats are not equally good for every faction or weapon; the tier is a rough common measure, not a claim of equal value.
5. The feed brake lowers the paid tier by one for a fed player (`rewardCurve < 0.65`), so a quest keeps paying a hungry player in full and pays a leader less.

For a def:

```text
effective seconds = objSec + 0.4 x travelSec
tier points       = effective seconds / 48 x 1.35 x 1.15
nominal tier      = clamp(round(tier points), 1, 3), and 1 for the player-kill quest
parityGv          = effective seconds x (2 / 12)
paid card(feed)   = the nominal card, one tier lower when rewardCurve(feed) < 0.65 (never below I)
```

The twenty offers (`packages/shared/src/quests.ts`; the last column is nominal GV / parity GV):

| Offer | Reward card | Obj s | Travel s | Tier points | Nominal tier | Card at feed 5+ | GV / parity GV |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| Cinder Cull | Attack Damage II (`ad2`) | 36 | 60 | 1.94 | 2 | Attack Damage I | 10 / 10.0 |
| Break the Chains | Attack Damage II (`ad2`) | 36 | 60 | 1.94 | 2 | Attack Damage I | 10 / 10.0 |
| Plague Purge | Haste II (`haste2`) | 36 | 60 | 1.94 | 2 | Haste I | 10 / 10.0 |
| Thaw the Watch | Vitality II (`vitality2`) | 36 | 75 | 2.13 | 2 | Vitality I | 11 / 11.0 |
| Worth the Walk | Ability Power I (`ap1`) | 20 | 60 | 1.42 | 1 | Ability Power I | 7 / 7.3 |
| A Head for a Head | Attack Damage I (`ad1`) | 30 | 60 | 1.75 | 1 | Attack Damage I | 5 / 9.0 |
| The Grand Tour | Fleet II (`fleet2`) | 36 | 100 | 2.46 | 2 | Fleet I | 13 / 12.7 |
| Blight Blooms | Haste I (`haste1`) | 15 | 75 | 1.46 | 1 | Haste I | 8 / 7.5 |
| Shards of the Watch | Armor I (`armor1`) | 15 | 75 | 1.46 | 1 | Armor I | 8 / 7.5 |
| Ashcaps | Magic Resist I (`mr1`) | 15 | 75 | 1.46 | 1 | Magic Resist I | 8 / 7.5 |
| Loose Links | Ability Power I (`ap1`) | 15 | 75 | 1.46 | 1 | Ability Power I | 8 / 7.5 |
| The Tithe | Ability Power I (`ap1`) | 15 | 75 | 1.46 | 1 | Ability Power I | 8 / 7.5 |
| The Quartermaster's Cache | Haste II (`haste2`) | 20 | 90 | 1.81 | 2 | Haste I | 10 / 9.3 |
| Offerings at the Edge | Vitality II (`vitality2`) | 25 | 110 | 2.23 | 2 | Vitality I | 12 / 11.5 |
| The Ember Banner | Fleet II (`fleet2`) | 8 | 100 | 1.55 | 2 | Fleet I | 8 / 8.0 |
| The Frozen Standard | Vitality II (`vitality2`) | 8 | 100 | 1.55 | 2 | Vitality I | 8 / 8.0 |
| The Physician's Satchel | Haste II (`haste2`) | 8 | 100 | 1.55 | 2 | Haste I | 8 / 8.0 |
| The Warden's Seal | Attack Damage II (`ad2`) | 8 | 100 | 1.55 | 2 | Attack Damage I | 8 / 8.0 |
| The Reliquary | Leech II (`leech2`) | 8 | 100 | 1.55 | 2 | Leech I | 8 / 8.0 |
| The Long Haul | Haste II (`haste2`) | 8 | 150 | 2.20 | 2 | Haste I | 12 / 11.3 |

Headhunter (A Head for a Head) is the deliberate low outlier: its objective already has a player-kill payout, so it pays tier I and 5 GV against a parity of 9. The Ember Banner family of eight-second fetches round up to tier II on their long walk; their GV sits at parity.

This worksheet does not establish that questing wins real runs. Travel danger, contested pickups, which stat a card is, camp rosters, existing builds and deaths need larger headless samples and broader browser playtests.

### questBench: usage and report

`questBench` runs the real sim headlessly and is report-only: harness failures are printed and never fail CI. A smoke test (`packages/server/test/questBench.test.ts`) runs it end to end at its smallest size (1 seed, 2 seats, a 20 s cap) and fails when the quest runtime is not seen, no quest is offered, no row is produced, a lobby errors or the printed definitions go missing, so a rename in the quest runtime cannot leave the harness printing an empty report.

```bash
npm run questbench -w @raid/server
npm run questbench -w @raid/server -- --quick
npm run questbench -w @raid/server -- --seeds 6 --players 8
```

The defaults are three generated-map seeds and five seats per policy (one per faction); `--seeds N` uses seeds 1..N and `--players N` accepts 2..8. `--quick` uses one seed, five seats and a 120-second cap instead of the normal 300 seconds. Solo seats rotate factions as well as mixed-lobby seats. The default run took 26-28 s of wall time. The printed header defines every metric.

- **Live power** is `cardPower` (the sum of tier x count) over the cards that are live in the sim (`cardLive`; a phase-B card with no effect yet is excluded, so it cannot inflate quest rewards, farm references, timelines or policy valuations). A card is its tier in power; the fields in the report are `powerBefore`, `powerAfter` and `powerGain`. A chest in the farm baseline is worth the expected tier of its pick (`ELITE_CHEST_TIER_RATE` for an elite camp).
- **Completion rate** is completions by the player who chose the quest divided by attempts (quests the policy actually took, one per player and quest), not by every offered lobby. Completion-only times and nearby deaths/fights remain separate observations; site events can overlap. A kill-a-player quest is marked † and skipped in solo seats (only the mixed lobby can attempt it).
- **Ratio** is `quest's own seconds / farm-only seconds needed to reach the same live-power gain`. **BELOW 1 means the quest is faster than farming (too generous), above 1 that it costs more; the target band is 1.0-1.35.** The quest's own cost is the time from the player's first choice of the quest to the turn-in (the walk to it is charged, farming before the choice is not), not total raid elapsed time. A completion by a player who never chose the quest has no cost and is left out. This is an opportunity-cost estimate, not a paired counterfactual.
- **Marginal** is the same ratio with the farm time measured from the moment each farm run reached the power the player already had before the quest, because a quest done late in a build gains its delta where the S-curve and the camps are different. It needs three farm runs that got that far. The two agree for a quest done from nothing.
- **No Δ:** a completion that gained under 0.5 live power has no ratio (the reward is worth about nothing to that build, which is the finding); it is marked "no Δ" and counted apart.
- **Censoring.** The farm-only baseline farms by the cost of a whole camp as measured by `bench/campDuel.ts` (camp-wide aggro makes a camp a far bigger fight than its mobs), retreats only when it is losing (under 30% hp with mobs about, unless the fight is about to be won), and takes a camp's chest. A farm run that dies, makes no kill for 75 s (stalls) or hits the cap before reaching the gain is right-censored at that moment: its final power is never carried flat. The farm time is the Kaplan-Meier median over all farm-only runs (all factions, all seeds), and it is unknown when it rests on under 30% of the runs still in observation: the farm column then shows `>` the longest run seen and the ratio an upper bound `<`, and the `cens` column counts those completions.

Per quest the report includes done/attempts, the seeds covered, completion-only median/p90 time, the quest's own cost, observed completion-tick live-power before/after and delta, farm time to equal gain, ratio and marginal ratio, censored count, and nearby deaths/fights. A farm-only baseline section says how its runs ended. Per policy it reports live power at minutes 1, 2, 3 and 5, plus mixed-lobby win rates. Reports remain early, small-sample evidence for questions and regressions, **not final balance evidence, and not permission by themselves to change quest counts, waves, caps or carrier rules**. Reports produced before these definitions and before R2 must not be quoted as measurements of the merged build.

**First result on the R2 maps** (default run: 3 seeds, 5 seats per policy, 300 s cap, quests on). The cells are the ratio from the start / the marginal ratio; a "-" is a value the summary does not have (a ratio the report could not give, or a count that was not copied from the run). **n is effectively 1-3 completions per quest here: run `--seeds 6` or more before any balance decision.**

| Offer | Ratio (from start / marginal) | Done / attempts |
| --- | ---: | ---: |
| Long Haul | 0.81 / 0.74 | 31 / 32 |
| Ember Banner | 1.09 / 0.96 | 17 / 22 |
| Ashcaps | 1.10 / 1.10 | 23 / 28 |
| Loose Links | 1.12 / 1.22 | - |
| Frozen Standard | 1.13 / 1.13 | 32 / 35 |
| Shards of the Watch | 1.19 / 1.08 | 6 / 13 |
| Reliquary | 1.34 / 0.67 | - |
| Grand Tour | 1.37 / 12.4 | 9 / 18 |
| The Tithe | 1.55 / 1.28 | 17 / 24 |
| Blight Blooms | 1.63 / 1.58 | - |
| Break the Chains | 2.01 / - | 2 / 5 |
| A Head for a Head | 2.27 / 2.38 | - |
| Thaw the Watch | 3.16 / 1.91 | - |
| Cinder Cull | - | 0 / 4 |

The Quartermaster's Cache gains almost nothing (a power delta of 0.05) and shows "no Δ" instead of a ratio. Read against the 1.0-1.35 band: the Long Haul is below 1 (faster than farming); Ember Banner, Ashcaps, Loose Links, Frozen Standard, Shards of the Watch and the Reliquary sit inside it; the Grand Tour, The Tithe, Blight Blooms, Break the Chains, A Head for a Head and Thaw the Watch sit above it. These are one small run, so none of it is a finding yet.

**Reward balance was not retuned in this round, and the measurements above predate the cards.** They were taken against the per-kill buffs that the balance pass removed (their ratios were in buff power, with nominal stacks of 6.5 to 8.5 per offer). Quests now pay a card whose tier is the time-parity formula in section 5, so those ratios must be measured again with `questBench` before any is quoted. The numbers above are history, kept for the shape of the table, not for the values.

## 6. Browser verification

A two-tab Chromium check was run on the first quest build, before the R2 maps and the second round of fixes. It covered:

- Both planning screens showing five known quests and `+5 rumoured`.
- The **J** quest log, quest world drawing and minimap markers.
- Three hidden quests revealed through the scouting/head-start flow.
- **Offerings at the Edge** completed using real movement and **F** pickup inputs, including its buff and GV reward (the buff has since become a card) and both clients' completed row.

No screenshots of it are kept in the repository. Live Swarm/carrier was not separately exercised in it, and it is not evidence for the private stream, placement, lifecycle, J layout, toast folding, F eligibility or training behaviour.

**Browser check of the current build: PENDING, not yet run.** The changes since then are covered by unit and headless tests only (the client quest suites against fakes, the server quest suites, `questRealMap.test.ts` through a whole quest life on a generated map), not by a browser. Replace this line with the scenarios exercised when one runs.

## 7. Changing quests safely

Keep defs data-driven and preserve the private/public boundary. New hidden rolls belong on the private quest stream, never `world.rewardRandom` or `world.random`; no quest code may import Colyseus in the sim. Add hooks with `chainHook`, leave the fixed tick order intact, defer rewards through the existing ledger-safe payout paths, and append any future fx code at the next free wire code (20 today; the quest system adds none, it uses toasts and the private `questReveal` message).

Useful focused checks after a change are the shared and server quest suites, the client quest UI suites, then the repository gates:

```bash
npm test -w @raid/shared -- quests
npm test -w @raid/server -- quest
npm test -w @raid/client -- quest
npm run typecheck
npm test
npm run build
```

**Cost of the quests on the R2 maps** (the shipped default is quests on; both benches leave them off unless asked, `stepBench.ts --quests` and `bandwidth.ts quests=1`, and both print the number of quest offers in the state so a run can be told apart). Quests on against off: `step()` averages 0.204 ms against 0.218 ms and its p99 is 0.409 ms against 0.526 ms (the same run, within noise: the quests do not show up in the tick). Bandwidth per client on seed 1 is 6.84 against 6.52 KB/s typical and 10.55 against 10.91 KB/s heavy (the fights differ a little, since the bench players never target a giver), and a joiner's first sync is 15.1 against 12.9 KB. The idle case has no quests to measure: the coliseum teleport closes them. The gates cover both: `perf.test.ts` has a case with quests on (givers, items and the lifecycle in the tick), and `bandwidth.test.ts` requires typical and heavy with quests on to stay under 20 KB/s and within 1.5 KB/s of the same runs without.
