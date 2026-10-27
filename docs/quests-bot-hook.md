# Quest bot interface

Bots quest through the same public state and inputs as a human client. This is an interface contract only: K1 does not add a quest bot brain or any bot-only message.

## Public information

Read the ordinary room state and shared catalog:

- `RaidState.quests`: visible offers by id. An entry is initially known or already revealed; hidden offers have no placeholder entries.
- `QuestState.def`: key into `QUEST_DEFS` / `questDefById`. The def provides `kind`, `name`, `text`, objective `count`, `region` and other objective data, `farZone`, nominal `reward.stacks`, `reward.gv`, and `reward.buff` (the real `BuffId`). Validate the buff's zone against `farZone`; do not value it as a retired generic stat.
- `QuestState.x`, `.y`: the giver's world position. The giver also has a synced `MobState` of kind `quest`; never send a combat `target` for it.
- `QuestState.progress`: map from player id to public kill/collect progress. Compare the bot's own id with the def's `count`; rival progress is public too.
- `QuestState.expiresAt`: absolute server-time deadline in ms. Compare it with `RaidState.serverTime`, not local wall time.
- `QuestState.status` and `.doneBy`: `"open"`, `"done"` or `"expired"`, and who closed a done offer. Only `"open"` is actionable. Done and expired rows remain visible for a 20-second grace period and then leave synced state; an offer closed while still hidden never gets a public row.
- `QuestState.carrier`: player id carrying a fetch parcel, or `""` while it is not carried. A carrier remains public through Swarm and Blaze Step. Completion, expiry, coliseum teleport and run end clear the carrier and remove the parcel; no parcel survives teleport closure.
- `RaidState.containers`: visible token and ground-parcel positions. Quest containers use kind `quest`; their first item's def is `QUEST_ITEM_PREFIX + quest id`, and their container ids are what `pickup` takes. A carried parcel has no ground container.
- `RaidState.players`: carrier positions and the bot's own position, buffs and feed inputs. Use public positions for ordinary navigation and combat decisions.
- `RaidState.unknownQuests`: how many offers remain hidden from everyone. It is only a count, with no defs, positions or per-player progress.

During planning, the five known `QuestState` rows and `unknownQuests` are available for spawn/route policy. Giver mobs and item containers do not exist until `raidStarted`. The world is frozen; use the normal private `plan` deal and `plan` input, not quest movement or pickup inputs.

## Private messages

The standing in-range player with the lowest secret `tieRank` who finds an unknown giver receives `questReveal` before that offer enters synced state; join order does not choose the finder. Its `QuestRevealMessage` payload is `{ id, def, x, y, expiresAt }`: enough to identify the offer through the shared def, walk to its giver and read its active deadline. It gives only that finder the four-second information head start, not exclusive progress. A bot may use only reveal messages delivered to its own client. It must not assume another bot or player received the message, and it may act on the offer only when its own `questReveal` or the later synced entry makes it available. No new reveal starts once the coliseum gates are locked.

Ordinary private `toast` messages can explain discovery, a pickup refusal or completion, but are not a separate quest command channel. The existing private `plan` message remains the only source of the bot's spawn deal.

## Inputs

No accept, complete, drop or reveal input exists. A bot should:

- send `move` to walk to a giver, objective, token or parcel;
- send `pickup { containerId }` for a visible token or ground parcel, exactly as `F` does in the browser;
- send ordinary `target`, `move`, `stop`, `swap` and `cast` inputs for fights and travel;
- stand near the giver with line of sight for automatic turn-in;
- send its normal `plan` input while planning.

The server validates positions, range, line of sight, objective progress and the one-parcel limit. Same-tick turn-ins and pickups are authoritative server decisions. Do not send positions, rewards, progress, completion, carrier changes or reveal requests. Re-read status before pursuing an objective: a camp clear can expire a kill offer early, and teleport or run-end closure removes every giver and item without pay. Never chase a done/expired row during its 20-second cleanup window.

## Information a bot must not use

A bot must not read server runtime objects, either private quest/reward stream, hidden roster/placement data, another client's private messages, or files/memory unavailable to a human client. Before its own reveal it must not infer an unknown offer's def, giver, items, objective position, progress or carrier from the rumour count, known giver positions or quest-id gaps, the public map seed, RNG prediction, or a client-side copy of placement code. Every hidden giver pick uses fresh private entropy, so public known placement does not determine the hidden set.

After publication, normal synced quest state and containers are fair game. Swarm does not make a parcel secret: its public carrier and marker remain usable. Conversely, a bot must not target quest givers, exploit their immunity as combatants, or use hidden information to path to an offer it has not legitimately revealed.
