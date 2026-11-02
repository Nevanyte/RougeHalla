# Telemetry and the balance dashboard

Status: **contract only.** This file, `packages/shared/src/telemetry.ts` (record types, constants, pure helpers) and
`packages/shared/test/fixtures/telemetryRun.example.ts` (one complete example record) are committed. Nothing records
yet. Section 11 splits the build between three implementers. The code is the source of truth for every number
named here: `telemetry.ts` holds the constants, and this document names them rather than repeating their values
where they may be tuned.

## 1. Goals and non-goals

Goals:

- Balance with evidence. Win rate by faction, duel win rate faction x faction, weapon win rate and weapon x weapon
  duel win rate, augment, stat-boost and Trophy pick rates and win rates (against those offered the same option who
  did not take it), mobs farmed and time to power, camp clear times and deaths by camp type, deaths by cause,
  first-blood timing, disengage, third-party and comeback rates. Every rate comes with its sample count and a Wilson
  95% interval.
- One record per finished run. A per-run SUMMARY (`RunRecord`) is written once at run end. It holds per-player
  records, per-DUEL segment records, the chest offers and the camp clears. The live dashboard and the offline
  analysis read the same records.
- No cost to the game. The recorder only bumps counters on existing sim hooks. Building the record, encoding,
  gzip and the network all happen off the tick, and the game never waits for any of it.
- Comparable data. Every record carries the build id. The dashboard never mixes builds, sources or the human and
  bot pools unless asked.

Non-goals:

- No replay and no per-tick event log. A 1 Hz tile sample is the only time series.
- No change to any simulation outcome, map hash, RNG stream, synced schema field or wire format.
- Training rooms are not recorded.
- No IP addresses or profile tokens, and no plain callsigns (section 5).

## 2. Overhead budget

These are acceptance criteria for implementer A. Each is checked by a test or a bench.

| budget | limit | how it is checked |
|---|---|---|
| `step()` cost, recording on vs off | within 3% (avg and p99) on `bench/stepBench.ts` (8 players, the map's mobs), plus a 0.02 ms absolute slack | `npx tsx packages/server/bench/stepBench.ts --telemetry` vs without, best of five, CPU clock; and `--bots 8 --telemetry` |
| allocation per tick in steady state | zero: no objects, arrays, closures or strings on the tick when no segment opens, no offer is made and no sample is due | code review rule + a bench heap check under `--expose-gc` (heap after 2000 steady ticks within noise of after 200) |
| per-sample cost (1 Hz) | writes into preallocated typed arrays only | code review |
| memory per run | bounded by the caps: `TELEMETRY_MAX_DUELS`, `TELEMETRY_MAX_OFFERS`, `TELEMETRY_MAX_CAMP_CLEARS`, `TELEMETRY_MAX_SAMPLES` per player (a `Uint8Array(2 * TELEMETRY_MAX_SAMPLES)` each, allocated when the run starts) | unit test that drives past each cap and reads `truncated` |
| record size | p50 under 80 KB of JSON and 16 KB gzipped for an 8-player run of about 6 minutes; hard cap `TELEMETRY_RECORD_MAX_BYTES` (over it: resend without `tiles`, `truncated.tiles = true`, else drop and count) | sink unit test, and the size printed by the tournament run |
| sender | no `await` in `tick`; gzip uses async `zlib.gzip` from a `setImmediate`; queue bounded by `TELEMETRY_QUEUE_MAX_RECORDS` / `_BYTES` and drops the oldest | sink tests with a stalled fake fetch |
| server health | telemetry never touches `storageHealthy`, `/readyz` or the profile store | review + a sink test that a failing endpoint changes nothing else |
| determinism | a world with the recorder installed produces the same events and state, tick for tick, as one without | `test/telemetryDeterminism.test.ts` (A): two worlds, same seeds and salts, scripted inputs plus bots, compare `step()` events and a state digest every tick for about 3000 ticks, through a teleport and a run end |

The recorder lives in `packages/server/src/sim/telemetry.ts`. It is installed AFTER `createGameWorld` returns
(`installTelemetry(world)`) and is NOT one of `gameplay.ts`'s `MODULES`. A world without it has exactly today's
hook chains and systems. Being installed last puts its chained listeners at the end of every chain and its system
after `updateMods` and `updateZombies`, so it reads each tick's final state.

## 3. What is collected, and when

Times inside a record are integer ms from the run start (`raidStartedAt` = 0). Only `startedAtEpoch` and
`endedAtEpoch` are wall clock; the Room stamps them with `Date.now()` at the `raidStarted` and run-end events.
Damage and heals are rounded to 0.1. The types are in `telemetry.ts`, and the example record shows every field.

### 3.1 Run (`RunRecord`)

| field | source | when |
|---|---|---|
| `runId` | `crypto.randomUUID()` in the Room (never a sim stream) | at `raidStarted` |
| `source` | `TELEMETRY_SOURCE` env (`live` on Cloudflare, `dev` by default, `tournament`/`bench`/`test` from those drivers) | at install |
| `build.server` | `SERVER_BUILD_ID` (export it from `server/src/index.ts`, or pass it through `RoomContext`) | at boot |
| `build.commit` | `GAME_SOURCE_COMMIT` env, else `${CLIENT_DIR}/build-info.json` (`sourceCommit` or `commit`), else null; the Worker fills a null on ingest when `build.server` equals its own `serverBuild` | at boot |
| `seed`, `attempt`, `mapHash` | `world.state` | at install |
| `config` | the room's `SimConfig` plus `BOTS_FILL_TO` | at install |
| `humans`, `bots`, `players` | the players standing at `raidStarted` (planning leavers are only counted in `planningMia`) | at `raidStarted` |
| `durationMs`, `end` | run end: `winner` / `draw` from `endRun`; `void` from a shutdown (`bankVoided`); `abandoned` from `onDispose` mid-run | at the end |
| `winnerSlot`, `winBonusPaid` | the winner's `resolved` result (`!winBonusWithheld`) | at the end |
| `coliseum.teleports`, `.suddenDeath` | the `teleported` hook; the first tick with `serverTime >= suddenDeathAt` while locked | live |
| `firstBlood` | the first player down with outcome `died`: time, victim slot, credited killer slot (-1 none) | live |
| `duels`, `offers`, `camps` | sections 4, 3.6, 3.7 | live |
| `truncated` | what any cap dropped | at the end |

A run that never started (a lobby, or planning that ended with nobody) writes nothing.

### 3.2 Player (`PlayerRecord`)

Players get a slot 0..7 at `raidStarted`, in roster order. Every per-player counter is `slot * K + index` in a
preallocated `Float64Array`. Strings are resolved to slots once, through a `Map<string, number>` lookup (no
allocation).

| field | source |
|---|---|
| `pid` | section 5 (Room) |
| `bot`, `tier`, `persona` | `PlayerRuntime.bot`; `BotManager.specOf(id)` (a new public accessor) |
| `faction`, `spawn` | `PlayerState.faction`. Spawn: `regionAt` of the position at `raidStarted`, `worldToTile`, `picked` = `world.planning.deals.get(id).pick >= 0` (false with no planning) |
| `place`, `outcome`, `aliveMs`, `kills`, `botKills`, `gv`, `winBonusWithheld`, `winBonusWhy` | the player's `resolved` event (`RunResult`), taken BEFORE `RaidRoom.settle` returns early for bots; `gv` also adds the `gv` events' `skip` reason. A player never resolved (void, abandoned) gets outcome `alive` |
| `death` | section 3.5 |
| `weaponMs`, `mainWeapon` | 1 Hz sampler: `activeWeapon(p).id` (empty hand = fists) gets `TELEMETRY_SAMPLE_MS`. `weaponSwapped` does not fire on auto-arming, so do not rely on it |
| `zoneMs` | 1 Hz sampler: `regionAt(world.map, p.x, p.y)` |
| `tiles` | 1 Hz sampler: `(worldToTile(x), worldToTile(y))` bytes, or `TILE_ABSENT` twice when not standing, up to `TELEMETRY_MAX_SAMPLES`; `packTiles` at the end. Off with `TELEMETRY_POSITIONS=0` |
| `final` | at the player's resolve or at run end: `p.build`, `cardPower`, `p.extra.chestBoosts`, `p.extra.killStats`, `p.mobStats`, `decodeMirrors(p)` + `p.maxHp` |
| `snapshots` | the sampler, on the tick whose run time first reaches each `TELEMETRY_SNAPSHOT_MINUTES` minute, for standing players |
| `mobKills`, `eliteKills` | the `mobKilled` hook (`{type, elite}`): only credited kills, as the game counts them |
| `campsCleared` | the camp clears the player contributed to (3.7) |
| `farmMs` | 1 Hz sampler: a standing second counts when the player dealt or took regional-mob damage within `FARM_CONTACT_MS` (`lastMobContact[slot]`, written by the damage listener) |
| `dealt`, `taken`, `overkill` | section 3.4 |
| `healed` | section 3.5 |
| `wish` | `castAccepted` / `castEnded` hooks (new, 3.8); `hits` and `damage` from ability entries in `hitLanded` and ability statuses in `statusApplied` on an enemy |
| `potions` | `consumableUsed` hook (new): `small` / `large` drinks; `granted` from `grantConsumable` (camp clear potions included) |
| `quests` | `questAccepted` / `questCompleted` hooks (new): def ids |
| `net` | the Room: `onDrop` counts `drops`, `onReconnect` counts `reconnects` |
| `client` | the client's one `perf` message (3.9), sanitized by `sanitizeClientPerf` |
| `afkMs`, `afk` | the Room: per client, time of the last input `enqueueClientMessage` accepted. When an accepted input follows a gap over `AFK_IDLE_MS`, `afkMs += gap - AFK_IDLE_MS`, and the trailing gap is added at finalize. `afk` = `afkMs >= max(AFK_FLAG_MIN_MS, AFK_FLAG_SHARE * aliveMs)`. Bots: 0 |
| `quit` | outcome `mia` |

### 3.3 The 1 Hz sampler

The recorder's one system runs every tick. It does nothing unless `(now - raidStartedAt) % 1000 < TICK_MS`, the
same idiom as `regenZombies`. While at least one duel segment is open it also runs the duel gap check (4.4) and
the end-of-tick duel finalization (4.5). That is the recorder's only per-tick work outside the hooks.

### 3.4 Damage classification

Damage reaches the recorder through `hitLanded(world, e, amount)` (every non-arena entry with mitigated amount
above 0) and `arenaHurt(world, victim, by, hp)` (terrain and sudden death). `amount` is the hook's value: mitigated
and capped, overkill included, BEFORE `landedShare` trims a regional mob's overkill. On a killing blow on a
player, the part past the victim's hp before the pass is added to `overkill` as well. For a mob victim, multiply by
the same share as `landedShare` so the totals match `world.combat.landed`.

The source of an entry, in this order (`DAMAGE_SOURCES`):

1. `e.arena`: `suddenDeath` if `e.by.id === SUDDEN_DEATH_KILLER`, else `terrain`. Seen only by `arenaHurt`, and
   only ever `taken`.
2. `e.ability !== undefined`: `wish` (its DoT chunks included).
3. A zombie attacker (`e.by.ownerId !== undefined`, or `state.mobs.get(e.by.id)?.kind === "zombie"`): `zombie`,
   credited to `e.by.ownerId` (`creditedPlayerId`).
4. A regional mob attacker (`world.mobs.get(e.by.id)?.brain`): `mob`. Taken only. Its type, elite flag and camp
   are read from `state.mobs` for the death cause.
5. `e.sig`: `signature`. Per-kind totals are not split in the record. The duel side keeps `weaponsUsed` and the
   sources.
6. `e.derived`: `splash` (wand splash, Overkill).
7. `e.passive`: `returned` (riposte, Spiked Shell, reflected arrow).
8. `e.dot` with no `sig` and no `ability`: `card` (bleed, Festering Arcana).
9. Otherwise `weapon` (`e.weapon`, fists included).

The attacker side is credited to `dealt.players` or `dealt.mobs` by the victim kind. Dummies, quest givers and
zombies as victims are skipped, so damage to a zombie is not counted as damage to players. The victim side is
credited to `taken` with the same source.

### 3.5 Death cause and healing

**Death cause.** Never parse `killedBy`. `applyHits` / `killMob` run before the `hitLanded` loop of the same
victim, so `fighterOut(id, "down")` only marks the slot "down this tick". The killing pass's entries are kept per
slot in fixed scratch (largest player-credited entry, largest mob entry, any arena entry), and the recorder's
system resolves the cause after the pass (`DeathCause`):

- `player` (with `bySlot`, `weapon` / `sig` / `ability`): the credited killer is a player. This mirrors
  `applyHits`: the largest rival hit, or `recentRival` within `KILL_CREDIT_SECONDS` when a mob or terrain finished
  them.
- `zombie` (`bySlot` = owner): the largest killing entry was a zombie's.
- `mob` (`mobType`, `elite`, `camp`): no player credit and the largest killing entry was a regional mob's.
- `terrain`, `suddenDeath`: an arena entry was the killing blow with no player credit.
- `quit`: outcome `mia`.
- `unknown`: anything else (this should not happen; a test asserts it never does in the e2e bot run).

`zone` and `coliseum` are read at the death.

**Healing.** `heal()` (`sim/factions.ts`) gets an optional `source?: HealSource` in its options (a string-literal
union, so no allocation). A new chainable hook `healed?(world, c, gained, source)` fires when `gained > 0`. The call
sites are tagged as follows:

| source | call site |
|---|---|
| `lifesteal` | `afterDamage` lifesteal |
| `trigger` | Blood Saint / trigger heal, Second Wind steps |
| `lastStand` | `payDeathFloor` |
| `regen` | `regenPass` |
| `potion` | potion heal-over-time steps |
| `light` | terrain light |
| `chestSkip` | `paySkip` |
| `corpse` | Plague corpse |
| `other` | the default |

Mobs walking home are not players and are skipped.

### 3.6 Chest offers, picks and skips

There is one new hook, `rewardOffered?(world, box, kind, camp, eligible)`. It fires in `dropRewardChest`
(augment and stat chests) and in `killAugments`' `playerKilled` link (Trophies). `eligible` is
`eligibleContributors` at the drop for camp chests, the elite pickers' snapshot for an elite chest, and `[owner]`
for a Trophy. A crate's stat chest has no contributors: its eligible list is every standing player within
`CHEST_RANGE`, or empty (documented as such on the dashboard). A second hook,
`rewardChosen?(world, c, box, option)`, fires on every successful `handleChoose` (option -1 = skip). The recorder
keeps its own container-id to offer-index map, so expiry needs nothing.

`OfferRecord.options` is the option ids in order: card ids, `boost:<stat>`, `kill:<...>`. `picks` lists each
choice. An eligible slot that is missing from `picks` never chose. "Offered but not picked" for an option means an
eligible slot that picked another option, skipped, or never chose.

### 3.7 Camps

- `engagedAt`: the first landed damage on a mob whose `MobState.camp > 0` in the current cycle.
- `clearedAt`, `killerSlot`: from the `campCleared` hook (the killer is the credited killer of the last mob, from
  `mobKilled`).
- `contributors`: the recorder's own per-camp slot bitmask, set by its damage listener for every slot that landed
  damage on one of the camp's mobs in the current cycle, and reset at the clear. It does not read
  `world.campContrib`, because `campHeal` (an earlier link than the recorder's) forgets it before the recorder's
  `campCleared` link runs. The chest offer's `eligible` list (3.6) does read `eligibleContributors`, inside
  `rewardOffered`, which fires before `campHeal`.
- `playerDeaths`: player deaths whose cause is a mob of that camp, during the cycle.
- `cycle`: counts respawns per camp.

Each cycle is one `CampClearRecord`. A cycle that is not cleared by the end is not written.

### 3.8 New hooks (all optional, zero cost when unset)

Each hook is added to `WorldHooks` and to the `ChainableHook` union (`sim/world.ts`). It is fired as
`world.hooks.x?.(...)`, so its arguments are built only when the hook is set, and only the recorder chains it.

| hook | fired at |
|---|---|
| `healed(world, c, gained, source)` | `heal()` |
| `rewardOffered(world, box, kind, camp, eligible)` | `dropRewardChest`, `killAugments` |
| `rewardChosen(world, c, box, option)` | `handleChoose` success |
| `consumableUsed(world, c, id)` | `handleUseConsumable` success |
| `consumableGranted(world, c, id)` | `grantConsumable` |
| `questAccepted(world, c, defId)` | `handleQuestAccept` success |
| `questCompleted(world, c, defId)` | `completeQuest` |
| `castAccepted(world, c, ability)` | `handleCast` after `c.rt.cast = cast` |
| `castEnded(world, c, ability, reason)` | `landCasts` (`"landed"`) and `cancelCast` (`CastEndReason`) |

The recorder must never call `nextId`, `newItemUid`, `payLater`, `emit`, `heal`, `addStatus`, `recomputeMods`,
any RNG (`world.random`, `rewardRandom`, `questRandom`, the consumables' wind stream), any path search, or read
`map.props`. Its listeners only read state and write its own typed arrays.

### 3.9 Client perf sample (cheap, optional)

The client keeps an always-on frame-time histogram while in an arena run, independent of the FPS/ping readout
setting:

- a `Uint16Array` of 1 ms buckets up to 100 ms plus an overflow bucket, bumped once per frame from
  `RaidScene.update`;
- gaps over `FPS_GAP_MS` are added to `hiddenSec`;
- a 2 s `room.ping` RTT histogram, sharing `PingProbe`'s logic.

At the `result` message (before the death hold) it sends ONE room message `TELEMETRY_PERF_MESSAGE` with a
`ClientPerfSample`. Percentiles come from `histogramQuantile`. The UA bucket is coarse, never the full string.

The Room registers its own `onMessage(TELEMETRY_PERF_MESSAGE)`. It is NOT in `CLIENT_MESSAGE_TYPES`, it never
reaches `enqueueClientMessage` and it is not presence. It spends one order token, accepts one per session per run,
ignores training, and stores `sanitizeClientPerf(msg)`. A run is finalized `TELEMETRY_FINALIZE_GRACE_MS` after its
end so the winner's sample can join; later samples are dropped. Bots send none.

The client side of this (histogram + send) is part of implementer A's scope (it touches `packages/client`; keep it
to `net/perfSample.ts`, a 3-line hook in `RaidScene.update` and the send in `main.ts`'s result handler, with a
unit test).

## 4. Duel segmentation

A duel is a segment of combat between one unordered pair of players. A player can be in several open segments at
once, one per opponent. All of the rules below read the ledger's results after the pass, so they never depend on
`actionOrder`.

### 4.1 Contact between the pair

A **contact** from X to Y is any of:

- a `hitLanded` entry whose victim is player Y and whose credited attacker
  (`e.by.ownerId ?? creditedPlayerId(world, e.by.id)`) is player X (X != Y). This covers weapon hits, signatures
  (DoT ticks included), Wish damage, card DoTs, splash, returned damage, and X's zombie's hits;
- a `blocked(world, holder = Y, attacker = X, prevented, melee)` with `prevented > 0`. This counts as a trade with 0
  damage. It opens and extends a segment, and its attacker can be the first striker.

Not contacts: regional mob damage, terrain, sudden death, damage to dummies, givers or zombies, statuses with no
damage (a Freeze stun on its own), and heals.

### 4.2 Start

When a contact from X to Y lands and the pair has no open segment, a segment opens at that tick.

- `first`: the side that made the contact. If both made contacts in that tick, the larger total that tick wins.
  An exact tie is `2`.
- Each side's snapshot is taken then (`DuelSide`):
  - faction, the weapon in hand;
  - augment ids, sorted, up to `TELEMETRY_MAX_DUEL_CARDS` (cards whose catalog kind is an augment);
  - `cardPower`, `mobStatsTotal`, `boostsTotal`, `bot`;
  - `hp` = `rt.hpFracAtTickStart` (hp + barrier over max, at the start of the opening tick);
  - `terrain` = `terrainAt` kind name under it ("" for none).
- `zone` = `regionAt` of the pair's midpoint. `coliseum` = `state.gatesLocked`.
- Opening is the one allocation of a segment. It is bounded by `TELEMETRY_MAX_DUELS`. Past the cap, segments are
  tracked for `clean` but not written, and `truncated.duels` counts them.

### 4.3 During

- Each contact adds its amount to the dealer side's `dmg[source]` and its weapon to `weaponsUsed`, and sets
  `lastContact = now`.
- A `castAccepted` by either side while the segment is open adds 1 to that side's `wishes`.
- **Third party.** Any landed damage on either side from anyone else sets a bit of `third`:
  - `THIRD_PLAYER`: another player, or another player's zombie;
  - `THIRD_MOB`: a regional mob;
  - `THIRD_ARENA`: terrain or sudden death.
- `clean` = `(third & (THIRD_PLAYER | THIRD_MOB)) === 0`. Arena damage is kept apart: the coliseum's sudden death
  burns both sides equally.

### 4.4 End by gap

When `now - lastContact >= DUEL_GAP_MS`, the segment closes with `classifyDuelEnd({ gapExpired: true, ... })`, which
gives `disengage`. `end = lastContact` (so `end - start` is the fighting time, not the wait), and `hpEnd` is each
side's hp fraction at `lastContact` (kept at each contact).

### 4.5 End by an event (precedence in `classifyDuelEnd`)

These are resolved in the recorder's system after the pass, so a death's killing entries (reported by `hitLanded`
after `fighterOut`) are already attributed:

1. **Down.** Either side went down with outcome `died` this tick. For each downed side, its credit is:
   - `pair`: the credited killer is the other side, or the other side's zombie;
   - `third`: another player or its zombie;
   - `mob`;
   - `arena`.

   Both down gives `trade`, winner -1. One down gives:
   - `kill` (credit `pair`);
   - `thirdParty` (credit `third` or `mob`);
   - `hazard` (credit `arena`).

   For these three, `winner` = the surviving side. `end` = the death tick.
2. **Quit**: either side left or went MIA (`fighterOut "removed"` or outcome `mia`). Gives `quit`.
3. **Teleport**: the `teleported` hook closes every open segment as `teleport`.
4. **Run end**: `runEnded`, a void or an abandon closes the rest as `runEnd`.

`comeback` = `comebackOf(sides, winner)`. It compares card power first, then mob stats plus boosts, and is null
with no winner or equal power. A death credited to the pair while `third` has bits is still `kill`, just not
`clean`. The dashboard's duel win rates default to `outcome = kill AND clean`, with toggles for "all kills" and
"kills + thirdParty survivors".

### 4.6 Pair storage

The pair state is a fixed table of `MAX_PLAYERS * (MAX_PLAYERS - 1) / 2` = 28 entries indexed by the slot pair,
with typed fields: `open`, `start`, `lastContact`, the `first` scratch for the opening tick, `third`, the damage
per side per source in a `Float64Array`, and the hp at last contact. A closed segment's `DuelRecord` is built then
(an allocation per closed segment, bounded by the cap).

## 5. Privacy

- `pid` = `HMAC-SHA256(key = TELEMETRY_SALT, message = "callsign:" + callsign.toLowerCase())`, the first 16 hex
  characters (64 bits). It is computed in the Room or the sink with `node:crypto`, never in `sim/`.
  - Callsigns are public on the leaderboard, so an unsalted hash would be reversible by dictionary. The salt is a
    secret, and rotating it unlinks all history.
  - With no salt set, `pid` is null for everyone and the skill model (section 9) falls back to no per-player term.
- Bots: `pid` is null. Their display names can equal real callsigns. `bot`, `tier` and `persona` tag them.
- Never recorded: IP addresses (`guards/clientIp.ts`), profile tokens, passcodes, sign-in keys, user agents
  beyond the four-way bucket, chat, cosmetics.
- Bots are recorded for telemetry (tagged). This does not break rule (d): telemetry is not persistence of a
  profile, GV or the registry, and `RaidRoom.settle`'s early return for bots is untouched (the recorder takes the
  result from the event first).
- Training rooms install no recorder. `buildWorld` skips it when `this.training`.
- Raw records stay in the private R2 bucket. The dashboard shows aggregates only (no pid), and its run list shows
  run ids and slots, never names.

## 6. Ingest protocol

### 6.1 Container side (`packages/server/src/telemetry/`)

Configuration (env, parsed once at boot):

- `TELEMETRY_URL` + `TELEMETRY_TOKEN`: both set, or both unset. When unset, the remote sink is off. The token must
  be at least `TELEMETRY_SECRET_MIN_CHARS`. The URL must be https, except localhost when `allowHttpLocalhost` is
  passed (tests), and must hold no credentials and no fragment. These are the same rules as `RemoteSnapshot.ts`.
  A bad config logs one line and disables telemetry. It never throws at startup.
- `TELEMETRY_DIR`: a local NDJSON sink (dev, tests, the tournament). It appends one record per line to
  `<dir>/runs-<yyyy-mm-dd>.ndjson`, uncompressed, through a serialized async `fs.appendFile`.
- `TELEMETRY_SALT`, `TELEMETRY_SOURCE`, `TELEMETRY_POSITIONS` (default `1`), `GAME_SOURCE_COMMIT`.
- With no sink at all, the Room installs no recorder: entirely off, zero cost.

`TelemetrySink`:

```ts
export interface TelemetrySink {
  submit(record: RunRecord): void; // never throws, never blocks
  close(deadlineMs: number): Promise<void>; // flush what it can, then give up
  stats(): { sent: number; dropped: number; failed: number; queued: number };
}
```

The HTTP sink works like this:

- `submit` pushes onto a queue bounded by `TELEMETRY_QUEUE_MAX_RECORDS` and `TELEMETRY_QUEUE_MAX_BYTES`. When the
  queue is full it drops the OLDEST record and counts it.
- It arms an unref'd `TELEMETRY_FLUSH_DELAY_MS` timer. When the timer fires, it takes up to
  `TELEMETRY_INGEST_MAX_RECORDS` records, builds NDJSON (one `JSON.stringify(record)` per line, in a
  `setImmediate`, never inside `tick`), runs async `zlib.gzip`, and POSTs.
- One batch is in flight at a time.

```
POST <TELEMETRY_URL>                        (= https://<host>/_internal/telemetry)
Authorization: Bearer <TELEMETRY_TOKEN>
Content-Type: application/x-ndjson
Content-Encoding: gzip
X-Telemetry-Schema: 1
X-Telemetry-Batch: <uuid of this batch>
<gzip of NDJSON, at most TELEMETRY_INGEST_MAX_COMPRESSED_BYTES>
```

Responses:

- `200` with an `IngestResponse` body. Records in `accepted` or `duplicate` are done. `rejected` records are
  dropped and logged once each, without the record.
- `401`, `413`, `415` or `400`: the batch is dropped and logged (a config error; retrying will not help).
- Network error, timeout (`TELEMETRY_REQUEST_TIMEOUT_MS`, AbortController, timer unref'd), `429` or `5xx`: retry
  the same batch after `TELEMETRY_RETRY_DELAYS_MS` in turn, then drop it.

Retries are safe because ingest is idempotent by `runId`. Logs are at most one line a minute per kind of failure,
and never print a record or the token.

`close` runs in `stop()`'s `finally` chain next to the profile flush, with a 3 s deadline, inside the
container's 15 s drain. Anything unsent at a hard stop is lost, which is acceptable.

Room wiring (`rooms/RaidRoom.ts`, `RoomContext.telemetry?: TelemetryRuntime`):

- `buildWorld` installs the recorder for an arena room when a sink exists.
- `handleEvents` forwards `resolved`, `gv`, `raidStarted` and `raidEnded` to the recorder's Room-side collector
  (before `settle`'s bot early return).
- On `raidEnded`, a finalize timer of `TELEMETRY_FINALIZE_GRACE_MS` is armed, or `onDispose` finalizes, whichever
  comes first. Finalizing calls `telemetryDraft(world, rec, end)` (a pure read), fills the Room fields (`runId`,
  `source`, `build`, epochs, `pid`, `tier`/`persona`, `net`, `client`, `afk`) and calls `sink.submit`. Only one
  record is sent per run (a flag).
- `bankVoided` (shutdown) finalizes with `end: "void"` right away. `onDispose` mid-run finalizes with
  `end: "abandoned"`.

### 6.2 Worker side (`deployment/cloudflare/src/telemetry/ingest.ts`)

Route `POST /_internal/telemetry` is handled in the Worker's `fetch`, next to `/_internal/profiles`, BEFORE the
container fallthrough. Steps:

1. `TELEMETRY_TOKEN` unset: `404`. Missing or wrong Bearer (at least 32 chars, constant-time compare, as in
   `profileSnapshots.ts`): `401`. A method other than POST: `405`.
2. `Content-Length` over `TELEMETRY_INGEST_MAX_COMPRESSED_BYTES`: `413`. `Content-Encoding` must be `gzip` and
   `Content-Type` `application/x-ndjson` (`415` otherwise).
3. Stream through `DecompressionStream("gzip")`, counting compressed and decompressed bytes. Abort with `413` past
   `TELEMETRY_INGEST_MAX_DECOMPRESSED_BYTES` (a gzip bomb). A broken gzip gives `400`.
4. Split lines. More than `TELEMETRY_INGEST_MAX_RECORDS` gives `413`. Each line is parsed, checked against
   `TELEMETRY_RECORD_MAX_BYTES` and `validateRunRecord`, stamped with `build.commit ??= sourceCommit` when
   `build.server === serverBuild`, and given `receivedAt`.
5. Each valid record:
   - `PROFILES.put(telemetryObjectKey(build.server, endedAtEpoch, runId), gzip(JSON), { httpMetadata: { contentType: "application/json", contentEncoding: "gzip" }, customMetadata: { v, source, humans, bots } })`.
     The key is deterministic, so a retry overwrites the same bytes.
   - Then `TELEMETRY.get(idFromName("telemetry-v1")).ingest(rows)` (DO RPC). The Worker flattens the record into
     rows with the pure `toRows(record)` (6.3), so the DO only runs SQL.
6. Reply `200` with an `IngestResponse`. An R2 or DO failure for any record gives `503` for the whole batch (the
   container retries, and the duplicates are harmless).

### 6.3 Flattening

`deployment/cloudflare/src/telemetry/rows.ts` exports `toRows(record: RunRecord): IngestRows`. It is pure and
unit-tested on the example and the fixture. It produces one row object per table of section 7.2, plus the heat
cells:

- each player's `tiles` is decoded with `unpackTiles`;
- each standing sample adds 1 s to cell `(floor(tx / TELEMETRY_HEAT_CELL_TILES), floor(ty / ...))` of
  `(build, day, bot)`.

## 7. Storage

### 7.1 Raw records in R2

- Bucket `rougehalla-profiles` (binding `PROFILES`), keys
  `telemetry/v1/build=<server build>/date=<yyyy-mm-dd>/<runId>.json.gz` (`telemetryObjectKey`).
- One gzipped JSON `RunRecord` per object. These are the archive the summary tables can be rebuilt from.
- They are kept until the owner adds an R2 lifecycle rule.
- They never collide with `profiles/` or `bots/`.

### 7.2 Summary rows: the `TelemetryStore` Durable Object (SQLite)

A new class `TelemetryStore extends DurableObject<Env>` is exported from the Worker's main module. There is ONE
instance, `idFromName("telemetry-v1")`. It is declared in `wrangler.jsonc` with no `migrations` entry:

```jsonc
"durable_objects": { "bindings": [
  { "name": "GAME_CONTAINER", "class_name": "PublicGameContainer" },
  { "name": "TELEMETRY", "class_name": "TelemetryStore" } ] },
"exports": { "GameContainer": {...}, "PublicGameContainer": {...},
  "TelemetryStore": { "type": "durable-object", "storage": "sqlite" } }
```

The store logic is a pure module, `deployment/cloudflare/src/telemetry/store.ts`, over a tiny interface:

```ts
export interface Sql {
  all(query: string, ...bind: SqlValue[]): Record<string, SqlValue>[];
  run(query: string, ...bind: SqlValue[]): void;
  tx<T>(fn: () => T): T;
}
export type SqlValue = string | number | null;
```

There are two adapters:

- `ctx.storage.sql.exec(...).toArray()` with `ctx.storage.transactionSync(fn)`, in the DO;
- `node:sqlite` `DatabaseSync` `prepare(q).all(...b)` with `BEGIN` / `COMMIT`, in tests.

Booleans are stored as 0/1. Schema setup runs in the constructor inside `blockConcurrencyWhile`. Every query is
parameterised (`?`). Identifiers are never interpolated from a request; a request's dimension choice maps through
a fixed allow-list to a column name.

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- ('schema', '1'); a later version runs its ALTERs and bumps it.

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  v INTEGER NOT NULL,
  source TEXT NOT NULL,                 -- live | dev | tournament | bench | test
  build TEXT NOT NULL,
  commit_sha TEXT,
  day TEXT NOT NULL,                    -- yyyy-mm-dd (UTC) of ended_at
  started_at INTEGER NOT NULL,          -- epoch ms
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  end_reason TEXT NOT NULL,             -- winner | draw | void | abandoned
  seed INTEGER NOT NULL, attempt INTEGER NOT NULL, map_hash INTEGER NOT NULL,
  humans INTEGER NOT NULL, bots INTEGER NOT NULL,
  winner_slot INTEGER NOT NULL,         -- -1 none
  winner_faction TEXT,
  win_bonus_paid INTEGER NOT NULL,
  teleports INTEGER NOT NULL,
  first_teleport_ms INTEGER,
  first_blood_ms INTEGER,
  first_blood_victim_faction TEXT,
  duels INTEGER NOT NULL,
  truncated INTEGER NOT NULL,           -- 1 when any cap dropped something
  raw_key TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_build_day ON runs(build, day);
CREATE INDEX IF NOT EXISTS runs_day ON runs(day);
CREATE INDEX IF NOT EXISTS runs_source_day ON runs(source, day);

CREATE TABLE IF NOT EXISTS players (
  run_id TEXT NOT NULL, slot INTEGER NOT NULL,
  pid TEXT, bot INTEGER NOT NULL, tier TEXT, persona TEXT,
  faction TEXT NOT NULL, spawn_zone TEXT NOT NULL, spawn_picked INTEGER NOT NULL,
  place INTEGER NOT NULL, outcome TEXT NOT NULL, won INTEGER NOT NULL,    -- won = outcome 'won'
  alive_ms INTEGER NOT NULL,
  death_kind TEXT, death_detail TEXT,   -- mob type | killer faction | ''
  death_ms INTEGER, death_zone TEXT, death_coliseum INTEGER,
  death_camp INTEGER, death_camp_type TEXT,
  kills INTEGER NOT NULL, bot_kills INTEGER NOT NULL,
  mob_kills INTEGER NOT NULL, elite_kills INTEGER NOT NULL, camps_cleared INTEGER NOT NULL,
  farm_ms INTEGER NOT NULL, main_weapon TEXT NOT NULL,
  card_power REAL NOT NULL, mob_stats_total REAL NOT NULL, boosts_total REAL NOT NULL, max_hp REAL NOT NULL,
  dmg_players REAL NOT NULL, dmg_mobs REAL NOT NULL, dmg_taken REAL NOT NULL, overkill REAL NOT NULL,
  healed REAL NOT NULL,
  wish_casts INTEGER NOT NULL, wish_landed INTEGER NOT NULL,
  potions INTEGER NOT NULL, quests_accepted INTEGER NOT NULL, quests_completed INTEGER NOT NULL,
  gv_total REAL NOT NULL,
  drops INTEGER NOT NULL, reconnects INTEGER NOT NULL,
  fps_p50 REAL, frame_p95 REAL, rtt_p50 REAL, rtt_p95 REAL,
  afk INTEGER NOT NULL, afk_ms INTEGER NOT NULL, quit INTEGER NOT NULL,
  PRIMARY KEY (run_id, slot)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS players_faction ON players(faction, bot);
CREATE INDEX IF NOT EXISTS players_weapon ON players(main_weapon, bot);
CREATE INDEX IF NOT EXISTS players_pid ON players(pid) WHERE pid IS NOT NULL;
CREATE INDEX IF NOT EXISTS players_death ON players(death_kind, faction);

CREATE TABLE IF NOT EXISTS player_weapons (run_id TEXT NOT NULL, slot INTEGER NOT NULL, weapon TEXT NOT NULL,
  ms INTEGER NOT NULL, PRIMARY KEY (run_id, slot, weapon)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS player_weapons_w ON player_weapons(weapon);

CREATE TABLE IF NOT EXISTS player_zones (run_id TEXT NOT NULL, slot INTEGER NOT NULL, zone TEXT NOT NULL,
  ms INTEGER NOT NULL, PRIMARY KEY (run_id, slot, zone)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS player_cards (run_id TEXT NOT NULL, slot INTEGER NOT NULL, card TEXT NOT NULL,
  count INTEGER NOT NULL, PRIMARY KEY (run_id, slot, card)) WITHOUT ROWID;   -- final build; boost:<stat> and kill:<stat> rows too
CREATE INDEX IF NOT EXISTS player_cards_card ON player_cards(card);

CREATE TABLE IF NOT EXISTS player_mobs (run_id TEXT NOT NULL, slot INTEGER NOT NULL, mob_type TEXT NOT NULL,
  kills INTEGER NOT NULL, PRIMARY KEY (run_id, slot, mob_type)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS player_amounts (run_id TEXT NOT NULL, slot INTEGER NOT NULL,
  dir TEXT NOT NULL,                    -- dealtPlayers | dealtMobs | taken | healed | gv
  source TEXT NOT NULL, amount REAL NOT NULL,
  PRIMARY KEY (run_id, slot, dir, source)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS power_snaps (run_id TEXT NOT NULL, slot INTEGER NOT NULL, minute INTEGER NOT NULL,
  card_power REAL NOT NULL, mob_stats_total REAL NOT NULL, boosts_total REAL NOT NULL, max_hp REAL NOT NULL,
  ad REAL NOT NULL, ap REAL NOT NULL, armor REAL NOT NULL, shield REAL NOT NULL,
  as_mult REAL NOT NULL, speed_mult REAL NOT NULL,
  PRIMARY KEY (run_id, slot, minute)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS offers (run_id TEXT NOT NULL, i INTEGER NOT NULL, kind TEXT NOT NULL,
  at_ms INTEGER NOT NULL, camp INTEGER NOT NULL, elite INTEGER NOT NULL, options TEXT NOT NULL,  -- JSON array
  PRIMARY KEY (run_id, i)) WITHOUT ROWID;
-- one row per (offer, eligible slot, option position): what was on the table for whom, and what they did
CREATE TABLE IF NOT EXISTS offer_options (run_id TEXT NOT NULL, i INTEGER NOT NULL, slot INTEGER NOT NULL,
  pos INTEGER NOT NULL, kind TEXT NOT NULL, option TEXT NOT NULL,
  picked INTEGER NOT NULL,              -- 1 this slot took this option
  choice INTEGER NOT NULL,              -- this slot's choice on the offer: -2 none, -1 skip, else the pos taken
  PRIMARY KEY (run_id, i, slot, pos)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS offer_options_opt ON offer_options(kind, option);

CREATE TABLE IF NOT EXISTS camp_clears (run_id TEXT NOT NULL, camp INTEGER NOT NULL, cycle INTEGER NOT NULL,
  zone TEXT NOT NULL, mob_type TEXT NOT NULL, elite_type TEXT NOT NULL,
  engaged_ms INTEGER NOT NULL, cleared_ms INTEGER NOT NULL, clear_ms INTEGER NOT NULL,
  killer_slot INTEGER NOT NULL, killer_faction TEXT, killer_weapon TEXT, killer_bot INTEGER,
  contributors INTEGER NOT NULL, player_deaths INTEGER NOT NULL,
  PRIMARY KEY (run_id, camp, cycle)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS camp_clears_type ON camp_clears(mob_type, killer_faction);

CREATE TABLE IF NOT EXISTS duels (run_id TEXT NOT NULL, i INTEGER NOT NULL,
  start_ms INTEGER NOT NULL, dur_ms INTEGER NOT NULL,
  a_slot INTEGER NOT NULL, b_slot INTEGER NOT NULL,
  bots INTEGER NOT NULL,                -- bot sides: 0, 1 or 2
  a_faction TEXT NOT NULL, b_faction TEXT NOT NULL, a_weapon TEXT NOT NULL, b_weapon TEXT NOT NULL,
  a_power REAL NOT NULL, b_power REAL NOT NULL, a_stacks REAL NOT NULL, b_stacks REAL NOT NULL,  -- stacks = mob stats + boosts
  a_hp REAL NOT NULL, b_hp REAL NOT NULL, a_hp_end REAL NOT NULL, b_hp_end REAL NOT NULL,
  a_dmg REAL NOT NULL, b_dmg REAL NOT NULL, a_wishes INTEGER NOT NULL, b_wishes INTEGER NOT NULL,
  first INTEGER NOT NULL, outcome TEXT NOT NULL, winner INTEGER NOT NULL, third INTEGER NOT NULL,
  clean INTEGER NOT NULL, zone TEXT NOT NULL, coliseum INTEGER NOT NULL,
  comeback INTEGER,                     -- NULL = not applicable
  PRIMARY KEY (run_id, i)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS duels_factions ON duels(a_faction, b_faction, outcome, clean);
CREATE INDEX IF NOT EXISTS duels_weapons ON duels(a_weapon, b_weapon, outcome, clean);
CREATE INDEX IF NOT EXISTS duels_bots ON duels(bots, outcome);

CREATE TABLE IF NOT EXISTS duel_cards (run_id TEXT NOT NULL, i INTEGER NOT NULL, side INTEGER NOT NULL,
  card TEXT NOT NULL, PRIMARY KEY (run_id, i, side, card)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS duel_cards_card ON duel_cards(card);

-- cross-run heat, TELEMETRY_HEAT_CELL_TILES-square cells, seconds standing
CREATE TABLE IF NOT EXISTS heat_cells (build TEXT NOT NULL, day TEXT NOT NULL, bot INTEGER NOT NULL,
  cx INTEGER NOT NULL, cy INTEGER NOT NULL, secs INTEGER NOT NULL,
  PRIMARY KEY (build, day, bot, cx, cy)) WITHOUT ROWID;
```

Ingest is one transaction per record, idempotent by `run_id`:

```sql
INSERT INTO runs (run_id, v, source, build, ...) VALUES (?, ?, ?, ?, ...)
  ON CONFLICT(run_id) DO NOTHING RETURNING run_id;
-- no row returned => duplicate: stop, report "duplicate", touch nothing else.
INSERT INTO players (...) VALUES (...);              -- and every child table, plain INSERTs
INSERT INTO heat_cells (build, day, bot, cx, cy, secs) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(build, day, bot, cx, cy) DO UPDATE SET secs = secs + excluded.secs;
```

Because a duplicate stops at the first statement, a retried batch never double counts heat or rows.

Retention: a daily DO alarm deletes runs (and their child rows by `run_id`) older than
`TELEMETRY_RETAIN_DAYS` (Worker var, default 400) and heat rows by `day`. The R2 archive is untouched.

Rebuild: `POST /api/stats/admin/reindex` (dashboard auth, plus `confirm=1`) pages through the R2 prefix 200 objects
per call (cursor in, cursor out). It is used after a schema bump or a DO wipe.

A dashboard view must never scan everything:

- every query filters `runs` by `(build, day)` or `(source, day)` first and joins on `run_id`;
- matrices group on indexed columns;
- if a query reads over 200k rows (`cursor.rowsRead`), the response carries a note.

## 8. The dashboard

### 8.1 Serving and auth

Every route below is answered by the Worker BEFORE the container fallthrough, so viewing the dashboard never wakes
or pins the game container and still works in maintenance. With `DASHBOARD_TOKEN` unset, every `/stats*` and
`/api/stats/*` path is `404`.

| route | method | answer |
|---|---|---|
| `/stats` | GET | `dashboardHtml()` (the page shell, no data). It shows the login form when the API answers 401 |
| `/stats/app.js` | GET | `dashboardScript()` (`text/javascript`) |
| `/stats/app.css` | GET | `dashboardStyles()` (`text/css`) |
| `/stats/login` | POST | form `token=<DASHBOARD_TOKEN>` (see below) |
| `/stats/logout` | POST | clears the cookie, then `303 /stats` |
| `/api/stats/*` | GET (POST only for `admin/reindex`) | JSON, cookie or `Authorization: Bearer <DASHBOARD_TOKEN>`, else `401 {"error":"unauthorized"}` |

The login route works like this:

1. `Origin` must equal the request's own origin.
2. It is rate limited through `MATCHMAKE_LIMITER` with key `dashlogin:<CF-Connecting-IP>`.
3. The token is compared in constant time.
4. On success: `303 /stats` with
   `Set-Cookie: rh_stats=<exp>.<mac>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`, where
   `mac = base64url(HMAC-SHA256(key = DASHBOARD_TOKEN, "rh-stats-session:v1:" + exp))`. The session is stateless.
   Rotating `DASHBOARD_TOKEN` logs everyone out.
5. On failure: `303 /stats?login=failed`.

Every dashboard response carries these headers:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cache-Control: no-store
```

Rules for the page:

- No external scripts, fonts or CDNs. Charts are inline SVG built by the page script.
- Authenticated API calls are not rate limited. Each is a few indexed queries.

### 8.2 Query parameters (every `/api/stats/*` GET)

| param | values | default |
|---|---|---|
| `build` | a server build id from `/api/stats/meta` | the newest build with data |
| `from`, `to` | `yyyy-mm-dd` (UTC, inclusive) | the last 14 days |
| `pool` | `humans`, `bots`, `all` | `humans` |
| `source` | `live`, `dev`, `tournament`, `bench`, `test`, or `any` | `live` |
| `faction` | a faction id | none |
| `weapon` | a weapon id | none |

`pool` applies to rows, not to runs:

- player rows: `bot = 0`, `bot = 1`, or any;
- duels: `bots = 0` (both sides human), `bots = 2` (both bots), or any (1 = mixed, only in `all`);
- camp clears: by `killer_bot`;
- heat: by `bot`.

So humans and bots are never mixed by default, and human players who shared a lobby with fill bots still count as
humans. `faction` and `weapon` narrow player rows (and the duel row side). Bad values give `400` with the parameter
named.

Every response is a `StatsEnvelope<T>` (`telemetry.ts`) that echoes the resolved query. Every rate is a
`RateCell`, computed with `wilson95` on the server. Rows with `n < 5` are still returned, and the page greys them.

### 8.3 Endpoints (response row type in `telemetry.ts`)

| path | extra params | rows | what |
|---|---|---|---|
| `/api/stats/meta` | none | `StatsMeta` (not enveloped) | builds, days, seeds with data |
| `/api/stats/overview` | | `OverviewRow` (one) | counts, median duration and first blood |
| `/api/stats/factions` | | `FactionRow` | run win rate by faction (`won`), average place, kills, mob kills, alive time |
| `/api/stats/weapons` | | `WeaponRow` | run win rate by `main_weapon`, and the share of held seconds (`player_weapons`) |
| `/api/stats/duels/factions` | `clean=1\|0`, `outcomes=kill[,thirdParty,hazard]` | `MatrixCell` | faction x faction duel win rate from the row's side (both orientations of every duel; mirrors count each duel once as 1 of 2) |
| `/api/stats/duels/weapons` | same | `MatrixCell` | weapon x weapon (weapon in hand at the start) |
| `/api/stats/duels/summary` | | `DuelSummaryRow` (one) | outcome counts, clean, disengage, thirdParty, comeback, first-striker win rates, median duration |
| `/api/stats/offers` | `kind=augment\|stat\|trophy` (default augment) | `OfferRow` | per option: offered (eligible slot-offers), pick rate, run win rate of pickers vs offered-not-picked; `duelWin` for augments (clean kill duels won holding it, `duel_cards`) |
| `/api/stats/farming` | | `FarmingRow` | mobs farmed, elites, farming seconds, mean card power and stacks at each snapshot minute, per faction |
| `/api/stats/camps` | `by=faction\|weapon` (default faction) | `CampRow` | clears and median clear seconds per camp type x killer faction (or weapon), and player deaths to that camp type |
| `/api/stats/deaths` | | `DeathRow` | deaths by cause kind x victim faction, detail = mob type or killer faction |
| `/api/stats/firstblood` | | `FirstBloodBin` | first-blood time histogram, 15 s bins up to 5 min, then one bin |
| `/api/stats/heatmap` | | `HeatmapResponse` | cross-run cells (see the caveat) |
| `/api/stats/runs` | `limit` (at most 100), `before` (ended_at cursor) | `RunListRow` | recent runs |
| `/api/stats/run/:runId` | | `RunRecord` (not enveloped) | the raw record from R2 (decompressed), for one run's view and its full-resolution heatmap; ignores filters |
| `/api/stats/perf` | | `PerfRow` (one) | client fps and frame p95, RTT p50/p95 (medians over samples), reconnects per run, afk and quit rates |
| `/api/stats/export` | `cursor`, `limit` (at most 500) | NDJSON stream (`application/x-ndjson`), `X-Next-Cursor` | the raw records of the filter, for offline analysis |
| `/api/stats/admin/reindex` | POST, `confirm=1`, `cursor` | `{ indexed, cursor }` | rebuilds the DO from R2 |

Heatmap caveat: live maps use fresh seeds, so tile coordinates line up across runs only for the fixed coliseum
(and the map border). The cross-run heatmap is honest for the coliseum and coarse elsewhere, and the page says so.
The per-run view (`/api/stats/run/:runId`) is exact.

The page views are listed in section 11 (C).

## 9. Offline analysis

`testing/telemetry/analyze.py` reads NDJSON from any of these:

- the local sink's `runs-*.ndjson`;
- tournament output;
- a download from `/api/stats/export` (`--url https://play.roguehalla.com --token-env DASHBOARD_TOKEN`).

Usage:

```
python3 testing/telemetry/analyze.py <files or dirs...> [--build ID] [--from D] [--to D]
    [--pool humans|bots|all] [--source live] [--json out.json] [--model]
```

- With DuckDB installed (`import duckdb`), it loads the records into in-memory tables shaped like section 7.2 and
  runs the same aggregations as SQL. Otherwise it uses a stdlib path (dicts and `statistics`). Both paths print the
  same report, and a test runs the stdlib path on the fixture.
- The report covers every dashboard metric with `n` and Wilson 95% intervals, the same definitions as the
  endpoints, and the comparison of augments offered-and-picked against offered-and-not.
- `--model` (needs numpy) fits the skill-adjusted logistic model of clean kill duels:

  `P(a wins) = sigmoid( F[fa] - F[fb] + W[wa] - W[wb] + g * (log1p Pa - log1p Pb) + h * (Sa - Sb) / 10 + d * (hpa - hpb) + k * firstA + s[a] - s[b] )`

  The terms are:

  - `F`, `W`: faction and weapon effects, summing to 0;
  - `P`: card power; `S`: mob stats + boosts; `hp`: hp at the start;
  - `firstA`: +1 / -1 / 0 for who struck first;
  - `s[player]`: a per-`pid` skill term with a ridge penalty (lambda 1). Bots get one skill per tier (`bot:hard`).

  It is fit by Newton / IRLS with an L2 penalty on `s` only. It prints the faction and weapon coefficients with
  95% intervals from the inverse Hessian, the implied even-power faction x faction win rate, and the fit's log
  loss against a faction-only model. It also fits a run-level model of `won` on faction, main weapon, card power
  at minute 5 and `s[pid]`.
- The model is a reading aid, not a gate. Below 200 clean kill duels, the script says the intervals are too wide
  to act on.

## 10. Fixtures (shared by B and C)

- `packages/shared/test/fixtures/telemetryRun.example.ts` exports `EXAMPLE_RUN: RunRecord`, one small complete
  record. It is committed now, and `packages/shared/test/telemetry.test.ts` validates it. Everyone's first test
  starts from it.
- `testing/telemetry/make_fixture.py --runs N --seed S --out FILE` (C) uses only the stdlib and is deterministic.
  It writes N plausible records:
  - 5 factions with built-in edges, 6 weapons, bots and humans, duels with every outcome, offers of all three
    kinds, camps and tiles;
  - every record passes `validateRunRecord`;
  - `runIds` are UUID v4 derived from the seed.

  The committed output is `testing/telemetry/fixtures/runs-v1.ndjson` (40 runs, kept under 400 KB). B's store test
  ingests every line when the file exists, and falls back to `EXAMPLE_RUN` variations until C lands it.
- `deployment/cloudflare/src/dashboard/fixture.ts` (C) exports
  `DASHBOARD_FIXTURE: Record<string, unknown>`, keyed by endpoint path (`"/api/stats/factions"`, ...). Each value is
  typed as that endpoint's response (`StatsEnvelope<FactionRow>`, ...) through `satisfies`, so a contract change
  breaks C's build. B's endpoint test checks that its real responses have the same keys and row fields as the
  fixture's (a shape comparison, not a value comparison).

## 11. Implementation split

Three implementers work in parallel on separate files. Shared contract changes (`packages/shared/src/telemetry.ts`)
are additive only. An implementer who needs a breaking change stops and reports it instead of making it.

### A. Server (owner of `packages/server`, plus the small client perf sampler)

New files:

- `packages/server/src/sim/telemetry.ts`: the recorder.
  - `installTelemetry(world: World, opts?: { positions?: boolean }): TelemetryRecorder`.
  - `telemetryDraft(world, rec, end: RunEnd): RunDraft`, a pure read that returns the record minus the
    Room-owned fields.
  - `noteRoomEvent(rec, ev: SimEvent)` for `resolved` / `gv`.

  It is pure: no imports of `@colyseus/core`, `node:*` or the network, and no RNG.
- `packages/server/src/telemetry/config.ts`: `telemetryConfigFromEnv(env)`.
- `packages/server/src/telemetry/sink.ts`: `TelemetrySink`, `createHttpSink`, `createFileSink`, `multiSink`.
- `packages/server/src/telemetry/identity.ts`: `pidOf(salt, callsign)`, `readBuildInfo()`.
- `packages/server/src/telemetry/runtime.ts`: `TelemetryRuntime`, which the Room uses: it starts a run, completes
  the draft, holds the perf samples and AFK clocks, and submits.

Edits:

- the new optional hooks of 3.8 and their firing sites, plus `heal()`'s `source` option and its call sites;
- `rooms/RaidRoom.ts` (install, events, perf message, AFK clocks, drops/reconnects, finalize, void/abandon);
- `index.ts`: export `SERVER_BUILD_ID`, build the runtime from env, `close()` in `stop()`;
- `BotManager.specOf`;
- `bots/tournament/headlessRoom.ts` (`telemetry?` option) and `npm run tournament -- --telemetry DIR`
  (`source: "tournament"`, local sink);
- `bench/stepBench.ts --telemetry`.

Client:

- `packages/client/src/net/perfSample.ts` (histograms, `toSample()`);
- the `RaidScene.update` bump;
- the send in `main.ts`'s result handler.

Tests:

- `test/telemetryRecorder.test.ts`: the source classification table of 3.4, death causes, offers, camps, the
  sampler, snapshots, caps and `truncated`;
- `test/telemetryDuels.test.ts`: every rule of section 4 with scripted damage, including the death-ordering case
  and the third-party bits;
- `test/telemetryDeterminism.test.ts`: section 2;
- `test/telemetrySink.test.ts`: retries, backoff, drop-oldest, gzip, a 401 dropped, close deadline, never throws,
  config validation;
- `test/telemetryRoom.test.ts`: a real Room with a file sink. A bot game is recorded and tagged, training writes
  nothing, a void writes `end: "void"`, `pid` never equals a callsign, no IP or token appears in the file;
- a client test for `perfSample`.

Report the stepBench on/off numbers in the hand-off. Do not change `mapHash`, any RNG draw, the tick order, synced
schema fields or the fx wire format.

### B. Cloudflare (owner of `deployment/cloudflare`, `scripts/build-cloud-meta.mjs`, `docs/CLOUDFLARE_PUBLIC.md`)

New files:

- `deployment/cloudflare/src/telemetry/ingest.ts`: `handleTelemetryIngest(request, env)`.
- `deployment/cloudflare/src/telemetry/rows.ts`: `toRows(record)`.
- `deployment/cloudflare/src/telemetry/store.ts`: `Sql`, `migrate(sql)`, `ingestRows(sql, rows)`, and one pure
  query function per endpoint, `queryX(sql, q): StatsEnvelope<...>`.
- `deployment/cloudflare/src/telemetry/query.ts`: parse and validate the query params into a `StatsQuery`.
- `deployment/cloudflare/src/telemetry/auth.ts`: the session cookie, bearer and login.
- `deployment/cloudflare/src/telemetry/routes.ts`: `handleStats(request, env): Response | null`.
- `deployment/cloudflare/src/telemetry/durable.ts`: `class TelemetryStore extends DurableObject<Env>`, with RPC
  methods `ingest(rows)` and `query(name, q)`, the SQL adapter and the retention alarm.

Edits:

- `src/index.ts`: `Env` gets `TELEMETRY`, `TELEMETRY_TOKEN?`, `DASHBOARD_TOKEN?`, `TELEMETRY_SALT?` and
  `TELEMETRY_RETAIN_DAYS?`. Route the new paths before the container fallthrough, and re-export `TelemetryStore`.
  In `startAndWaitForReady`, pass `TELEMETRY_URL`, `TELEMETRY_TOKEN`, `TELEMETRY_SALT`, `TELEMETRY_SOURCE=live` and
  `GAME_SOURCE_COMMIT` ONLY when `TELEMETRY_TOKEN` is set (never throw on its absence). Bump `CONTROLLER_VERSION`
  so a running container picks the env up.
- `wrangler.jsonc` (the binding and the export).
- `build-cloud-meta.mjs`: add `sourceCommit` to `build-meta.json`.
- `docs/CLOUDFLARE_PUBLIC.md`: a Telemetry section with the steps of section 12.

The dashboard's three files are C's. B imports `dashboardHtml`, `dashboardScript` and `dashboardStyles` from
`./dashboard/page` and serves them. Until C lands, B serves a placeholder from a stub of the same exports.

Tests (`deployment/cloudflare/test/`, plain vitest):

- `telemetryStore.test.ts`: `node:sqlite` `DatabaseSync` behind the `Sql` adapter. Ingest the example and the
  fixture, check that a duplicate is a no-op, check every endpoint's numbers on a hand-checked mini set, and run
  an injection probe on every param;
- `telemetryRows.test.ts`;
- `telemetryIngest.test.ts` (Miniflare through `convertV4MiniflareOptions`, `useSQLite: true` DO, R2):
  401/404/413/415/400, the gzip bomb cap, the R2 key, the idempotent retry;
- `telemetryAuth.test.ts`: cookie flags, an expired or forged cookie, the Origin check on login, the CSP headers,
  404 with no token.

Gates: `npm run cf:typecheck` and `npx vitest run deployment/cloudflare/test/<file>`. Import the contract as
`@raid/shared/telemetry` (the package export added with this contract), never the shared index (it would bundle
the map generator into the Worker).

### C. Dashboard front-end and offline tools (owner of `deployment/cloudflare/src/dashboard/`, `testing/telemetry/`)

`deployment/cloudflare/src/dashboard/page.ts` exports:

- `dashboardHtml(): string`, the shell (header, filters, login form, view containers). It links
  `/stats/app.css` and `/stats/app.js`, with no inline script or style (CSP).
- `dashboardScript(): string`, the whole page script as one string. It is plain ES2020 with no imports, and is
  written inside a `String.raw` template, so it must contain no backtick and no `${`. A test enforces this, and
  parses the script with `new Function`.
- `dashboardStyles(): string`. Copy the client's `:root` tokens (`packages/client/src/style.css`). Dark, system
  font, tabular numbers, works at phone width.

The page:

- `fetch`es `/api/stats/*` with `credentials: "same-origin"`. A 401 shows the login form (a plain POST to
  `/stats/login`).
- Filters: build (from meta), date range, pool (humans default; bots and all labelled as such), source, faction,
  weapon. They are kept in the URL query.
- Views, each with `n` and the Wilson interval drawn as whiskers, and cells under `n = 5` greyed:
  - overview tiles;
  - faction win rate bars;
  - duel matrix faction x faction (a heat table with diverging colour around 50%, toggles clean/all and
    kill/+thirdParty);
  - weapon win rate and weapon x weapon matrix;
  - duel summary (outcome stack, disengage, third-party, comeback, first striker);
  - offers table per kind (pick rate, win picked vs win offered-not-picked, duel win), sortable;
  - farming / time to power line chart per faction over the snapshot minutes;
  - camps table;
  - deaths by cause stacked bars;
  - first-blood histogram;
  - heatmap (canvas or SVG rects over a 34 x 34 grid with the caveat text; a run picker opens the per-run tile
    heatmap from `/api/stats/run/:id`);
  - client perf;
  - recent runs list.
- Charts are inline SVG generated by the script. There are no libraries.

Also:

- `deployment/cloudflare/src/dashboard/fixture.ts`: `DASHBOARD_FIXTURE` (section 10).
- `deployment/cloudflare/scripts/dashboardDev.ts`: `npx tsx deployment/cloudflare/scripts/dashboardDev.ts`
  serves the three exports on `http://localhost:8788/stats` and answers `/api/stats/*` from `DASHBOARD_FIXTURE`
  (with the same headers), so the page is developed without B.
- `deployment/cloudflare/test/dashboardPage.test.ts`: the script rules, the CSP-safe HTML (no inline handlers or
  `<script>` bodies), and that every endpoint the script calls has a fixture.
- `testing/telemetry/make_fixture.py` and `testing/telemetry/fixtures/runs-v1.ndjson` (section 10).
- `testing/telemetry/analyze.py` (section 9).
- `testing/telemetry/test_analyze.py`: the stdlib path on the fixture, with Wilson values against known cases, plus
  the model on a synthetic set with a known faction edge, recovered within its interval, skipped without numpy.

Touch nothing outside these paths.

## 12. Owner setup

1. Generate three secrets (64 hex each), one per purpose, never reused:
   `openssl rand -hex 32` for each of `TELEMETRY_TOKEN`, `DASHBOARD_TOKEN` and `TELEMETRY_SALT`.
2. Store them as Worker secrets:
   ```
   npx wrangler secret put TELEMETRY_TOKEN  --config deployment/cloudflare/wrangler.jsonc
   npx wrangler secret put DASHBOARD_TOKEN  --config deployment/cloudflare/wrangler.jsonc
   npx wrangler secret put TELEMETRY_SALT   --config deployment/cloudflare/wrangler.jsonc
   ```
3. Publish as usual (docs/CLOUDFLARE_PUBLIC.md "Publish": `npm run cf:typecheck`, `npm run cf:test`,
   `npm run deploy`). The deploy creates the `TelemetryStore` namespace from `exports`. The bumped
   `CONTROLLER_VERSION` restarts the container with the telemetry env, which happens between runs, like any
   release.
4. Open `https://play.roguehalla.com/stats` and paste `DASHBOARD_TOKEN` once. The cookie lasts 7 days.
5. To turn telemetry off, delete `TELEMETRY_TOKEN` (`wrangler secret delete`) and redeploy. Ingest then answers
   404 and the container gets no URL. `DASHBOARD_TOKEN` alone controls the dashboard.
6. Local work:
   - `TELEMETRY_DIR=./.telemetry npm run dev` records dev runs to NDJSON;
   - `npm run tournament -- --games 200 --telemetry ./.telemetry` records bot games;
   - `python3 testing/telemetry/analyze.py ./.telemetry --pool bots` reads both.

Rotating `TELEMETRY_SALT` unlinks player history. Rotating `TELEMETRY_TOKEN` needs a container restart (bump
`CONTROLLER_VERSION` or release).

## 13. Best guesses to confirm (owner)

- The duel gap (`DUEL_GAP_MS` 8 s), and that a block counts as contact.
- That arena damage does not break `clean`.
- That a down credited to a third party is `thirdParty` with the survivor as `winner`. Default win rates use
  `kill` + `clean` only.
- That `won` means the run's winner only (a draw is not a win).
- The heat cell size (4 tiles).
- The snapshot minutes (1, 3, 5, 10).
- 400-day retention for summary rows, and R2 kept indefinitely.
- AFK as 30 s without an accepted input.
- One DO instance for all telemetry. At about 10k rows per day it stays far under the 10 GB DO limit for years; a
  second instance per year is the escape hatch.
