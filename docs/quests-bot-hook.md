# Quest bot interface

Bots quest through the same public state and inputs as a human client. This is an interface contract only: the quest system adds no bot-only message, and the headless bots in `packages/server/src/bots` do not choose quests (only the `questBench` policies do, and they read what a client reads).

**Fill bots take no part in quests.** A server-filled bot (`PlayerState.bot`, docs/BOTS.md) is ignored by the quest sim at every entry point, so the rest of this file describes a client a future quest decision module would drive, not what the fill bots do today. A fill bot gets no mob, player-kill, token or parcel progress, its `pickup` of a quest item is refused (the item stays), it cannot turn in or win an offer, it is never the finder of a hidden giver (the next human in range is) and receives no `questReveal`, and it is not counted as someone who could still finish a kill offer. Killing one advances "A Head for a Head" for nobody and pays nothing (a bot's death pays no kill GV, and bots touch no profile or GV), and a bot's kill of a human advances nothing either. The guard is `takesPart` in `sim/quests.ts`. A quest-playing bot would have to be exempted there on purpose. Rules a bot may rely on are in `docs/quests.md`; this file is what it reads and sends.

## Public information

Read the ordinary room state and shared catalog:

- `RaidState.quests`: visible offers by id. An entry is initially known or already revealed; hidden offers have no placeholder entries.
- `QuestState.def`: key into `QUEST_DEFS` / `questDefById`. The def provides `kind`, `name`, `text`, objective `count`, `region` and other objective data, `farZone`, `reward.gv` and `reward.card` (a base `CardId`: `cardTierOf(card)` is its worth in card power, and a fed player is paid one tier lower, `questRewardCard`). Value the card by its tier, not by a zone.
- `QuestState.x`, `.y`: the giver's world position. The giver also has a synced `MobState` of kind `quest`; never send a combat `target` for it. The giver exists only while its offer is open.
- `QuestState.progress`: map from player id to public kill/collect progress. Compare the bot's own id with the def's `count`; rival progress is public too.
- `QuestState.expiresAt`: absolute server-time deadline in ms. Compare it with `RaidState.serverTime`, not local wall time. When an offer closes early (done, or closed unpaid) the server clamps it to the close time.
- `QuestState.status` and `.doneBy`: `"open"`, `"done"` or `"expired"`, nothing else, and the name of who closed a done offer. Only `"open"` is actionable. Done and expired rows remain visible for a 20-second grace period (swept while the run is active) and then leave synced state; an offer closed while still hidden never gets a public row.
- `QuestState.carrier`: player id carrying a fetch parcel, or `""` while it is not carried. A carrier remains public through Swarm and Blaze Step. Completion, expiry, coliseum teleport and run end clear the carrier and remove the parcel; no parcel survives teleport closure.
- `RaidState.containers`: visible token and ground-parcel positions. Quest containers use kind `quest`; their first item's def is `QUEST_ITEM_PREFIX + quest id`, and their container ids are what `pickup` takes. A carried parcel has no ground container.
- `RaidState.players`: carrier positions and the bot's own position, buffs and feed inputs. Use public positions for ordinary navigation and combat decisions.
- `RaidState.unknownQuests`: how many offers remain hidden from everyone. It is only a count, with no defs, positions or per-player progress. It counts an offer a finder has previewed but that is not public yet. It falls when an offer is published, when a hidden offer's own deadline passes, and to 0 at the teleport and the run's end; a camp clear never moves it, and an impossible hidden offer is closed only after it goes public. A drop at a deadline only one def has (165, 220 or 280 s) names that def; no drop says where an offer stood.

During planning, the five known `QuestState` rows and `unknownQuests` are available for spawn/route policy. Giver mobs and item containers do not exist until `raidStarted`. The world is frozen; use the normal private `plan` deal and `plan` input, not quest movement or pickup inputs.

## Private messages

The standing player within `QUEST_REVEAL_RADIUS` (12 tiles) of an unknown giver with the lowest secret `tieRank` is its finder and receives `questReveal` before that offer enters synced state; join order does not choose the finder, and a bot cannot know it will be one. The `QuestRevealMessage` payload is `{ id, def, x, y, expiresAt }`: enough to identify the offer through the shared def, walk to its giver and read its active deadline. It gives only that finder a four-second (`QUEST_REVEAL_HEAD_START_MS`) information head start, not exclusive progress, after which the offer becomes public for everyone. A bot may use only reveal messages delivered to its own client. It must not assume another bot or player received the message, and it may act on the offer only when its own `questReveal` or the later synced entry makes it available. No new reveal starts once the coliseum gates are locked.

A previewed offer can still be closed before it is published, and then it never appears: its deadline, the teleport or the run's end delete it without a message. Drop a preview whose `expiresAt` has passed, and every preview at the teleport and the run's end.

Ordinary private `toast` messages can explain discovery, a pickup refusal or completion, but are not a separate quest command channel. The existing private `plan` message remains the only source of the bot's spawn deal.

## What counts toward an objective

The server decides all of it; a bot only needs to know what to aim for.

- A mob kill counts for the player the server credits (the one who did the mob the most damage, not necessarily the last hitter), if that player is still standing when the kill is paid. The hook the server evaluates carries `{ type, zone, camp, elite }`: the mob-type id, its zone, its camp's index in `map.camps` (-1 for a mob with no camp) and whether it was an elite. A region offer counts any mob of that zone, Worth the Walk any elite, the Grand Tour distinct zones.
- A player kill counts only when the victim's outcome is `died`; a rival who leaves (MIA) does not, and neither killer nor victim may be a fill bot.
- Tokens count on pickup, up to the offer's `count`. A fetch is done by the carrier standing at the giver.
- A kill offer closes early (unpaid) when no standing player could still finish it: nobody has the whole objective, and the live mobs it counts no longer cover what each lacks. Camp clears set this up; the server checks after the tick's damage. Hidden offers are not closed this way; one that is impossible is checked once when it goes public.

## Inputs

No accept, complete, drop or reveal input exists. A bot should:

- send `move` to walk to a giver, objective, token or parcel;
- send `pickup { containerId }` for a visible token or ground parcel, exactly as `F` does in the browser;
- send ordinary `target`, `move`, `stop`, `swap` and `cast` inputs for fights and travel;
- stand near the giver (`QUEST_TURN_IN_RANGE`, 64 u) with line of sight for automatic turn-in;
- send its normal `plan` input while planning.

The server validates positions, range, line of sight, objective progress and the one-parcel limit. `pickup` acts on exactly the container id sent (within 56 u of the server's position of the bot, a clear line on the movement mask, bot not stunned or casting); the server never picks another container for it. It refuses a quest item, leaving it in place, when its quest is not open and published, when the bot already carries any parcel, when the parcel is carried by someone else, or (tokens) when the bot's progress is already at the count. A bot should skip such items itself, as the browser's F pick does. Same-tick turn-ins and pickups are authoritative server decisions: the lowest secret `tieRank` among ready bots in range wins. Do not send positions, rewards, progress, completion, carrier changes or reveal requests. Re-read status before pursuing an objective: a camp clear can close a kill offer early, and teleport or run-end closure removes every giver and item without pay. Never chase a done/expired row during its 20-second cleanup window.

## Information a bot must not use

A bot must not read server runtime objects, either private quest/reward stream, hidden roster/placement data, another client's private messages, or files/memory unavailable to a human client. Before its own reveal it must not infer an unknown offer's def, giver, items, objective position, progress or carrier from the rumour count, known giver positions or quest-id gaps, the public map seed, RNG prediction, or a client-side copy of placement code. The quest stream is seeded from its own secret (not the public seed, and independent of the reward stream), and the hidden givers are placed in their own private pass: public known positions only rule out the ground within the giver gap of them, they do not determine the hidden set. Quest ids come out of a private shuffle, so an id says nothing about an offer's theme or whether it was known.

After publication, normal synced quest state and containers are fair game. Swarm does not make a parcel secret: its public carrier and marker remain usable. Conversely, a bot must not target quest givers, exploit their immunity as combatants, or use hidden information to path to an offer it has not legitimately revealed.
