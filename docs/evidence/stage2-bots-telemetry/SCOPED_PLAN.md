# P-BOTS-6 telemetry remainder: the full docs/TELEMETRY.md RunRecord body

Status: SCOPED PLAN (deliberate stop at the assessment gate). The source record capture is DONE and committed; the
record's VALUE production for the Rust runner is not achievable in one bounded packet and was not approximated.

## Decision and evidence

The assessment gate asked whether the legacy recorder can be driven from the pinned linux/amd64 Node 22.23.4 container
for one short run, with the existing createGameWorld harness and a telemetry file sink, to produce a REAL source
RunRecord. It can, and it has been captured:

- Tool: tools/bot-telemetry-fixtures/capture.mts + capture.sh (pinned container, repository read-only).
- Fixture: parity/telemetry/run-record.json (11,346 bytes; the record line is 3,113 bytes of exact NDJSON, sha256 in the
  fixture profile), format rh-bot-telemetry-source/1, schema v1.
- Provenance: 14 hashed source files (docs/TELEMETRY.md, packages/shared/src/telemetry.ts, sim/telemetry.ts,
  telemetry/{runtime,sink,identity,config}.ts, sim/{gameplay,step,ledger,inputs,chests}.ts, the source telemetry rig)
  plus the tool hash; a declared scenario (open hand-built 60x40 map, declared sim config, seed 11, two human players,
  scripted duel/offer/kill/end script); a declared constant clock; the only normalized field is the random runId.
- The captured record passed the source validator (validateRunRecord returns null), and --check recaptures byte
  identically. It exercises the run header, config, players, firstBlood, coliseum, two PlayerRecords, a full DuelRecord
  (both sides), an OfferRecord with options/eligible/picks, and the empty camps section.
- Reproduce: tools/bot-telemetry-fixtures/capture.sh --check.

The capture proves feasibility. It does NOT certify value parity: values depend on the full source gameplay and bot
brains (P-BOTS-1/3/4 remainder), so a re-run cannot reproduce them field for field today.

## The record and its exact order

The source serializer is JSON.stringify of the object built in telemetry/runtime.ts finalize: the recorder draft first,
then the Room-owned fields appended, with no sorted keys. The captured instance's order is the authoritative order a
port must reproduce when serializing:

RunRecord top level (captured instance):
  v, kind, durationMs, end, seed, attempt, mapHash, config, humans, bots, players, winnerSlot, winBonusPaid, coliseum,
  firstBlood, [planningMia], duels, offers, camps, [truncated], runId, source, build, startedAtEpoch, endedAtEpoch.
  (The bracketed optional keys sit at their draft positions and are absent in this instance; config in the runtime object
  is a spread of the draft config plus botsFillTo last: planSeconds, quests, mobs, coliseumSchedule, botsFillTo.)

PlayerRecord order (captured instance):
  slot, bot, faction, spawn, place, outcome, aliveMs, death, kills, botKills, weaponMs, mainWeapon, zoneMs, final,
  snapshots, mobKills, eliteKills, campsCleared, farmMs, dealt, taken, overkill, healed, wish, potions, quests, gv,
  [winBonusWithheld, winBonusWhy], quit, tiles, pid, [tier, persona], net, [client], afkMs, afk.
  (The bracketed keys are optional and sit at their spread positions: winBonus* from the draft; pid/net/afk*/tier/persona/
  client appended by the runtime after the draft's tiles.)

Nested shapes (all in packages/shared/src/telemetry.ts; the fixture pins instance order):
- BuildInfo {server, commit}; BuildSnapshot/TelemetryStats {maxHp, ad, ap, armor, shield, asMult, speedMult, cards,
  cardPower, boosts, boostsTotal, trophies, mobStats, mobStatsTotal}; PowerSnapshot adds minute.
- DeathCause {kind, at, bySlot?, weapon?, sig?, ability?, mobType?, elite?, camp?, zone, coliseum} | null.
- WishStats {casts, landed, fizzled, interrupted, cancelled, hits, damage}; ClientPerfSample (all optional, v:1);
  NetStats {drops, reconnects}; spawn {zone, tx, ty, picked}; maps are by-name objects with absent = zero.
- DuelRecord {i, start, end, sides:[DuelSide,DuelSide], first, outcome, winner, third, clean, zone, coliseum,
  comeback}; DuelSide {slot, bot, faction, weapon, weaponsUsed, augments, cardPower, mobStatsTotal, boostsTotal, hp,
  hpEnd, dmg, wishes, terrain}.
- OfferRecord {i, kind, at, camp, elite, options, eligible, picks:[{slot, option, at}]}.
- CampClearRecord {camp, cycle, zone, type, elite, engagedAt, clearedAt, killerSlot, contributors, playerDeaths}.
- truncated {duels?, offers?, camps?, samples?, tiles?}.
- Enum vocabularies: DAMAGE_SOURCES (weapon, signature, wish, zombie, card, splash, returned, mob, terrain,
  suddenDeath), HEAL_SOURCES (lifesteal, regen, potion, trigger, lastStand, light, chestSkip, corpse, other),
  GV_SOURCES (kills, mobs, bounty, quest, win, skip), DeathKind, OfferKind, RecordSource, RunEnd, PlayerOutcome (+alive),
  DuelOutcome, BotTierId, BotPersonaId, FirstStriker, THIRD_* bits, RegionId, WeaponId, FactionId, SignatureKind,
  AbilityId, WinBonusWhy, ChestBoostStat.

Coverage gaps in this one captured instance (add scenarios, not fields, to widen): non-null death causes, camps,
snapshots, bot tier/persona, client perf, planningMia, truncated, and non-empty tiles (the declared run is 250 ms, so the
1 Hz sampler recorded no second). The capture tool's scenario is the place to extend them; no source fixture changes are
needed for a wider corpus.

## Sinks and the current Rust writer

Source sinks (packages/server/src/telemetry/sink.ts):
- serializeRecord(record, maxBytes = TELEMETRY_RECORD_MAX_BYTES=512 KiB): one JSON line; if over the cap, retry once
  without per-player tiles and with truncated.tiles = true; still over -> null (dropped).
- createFileSink({dir}): appends one line to <dir>/runs-<yyyy-mm-dd>.ndjson (day of endedAtEpoch), async chain.
- createSyncFileSink({dir}): the same file format for callers that never yield between records (the tournament path).
- createHttpSink: gzip NDJSON batches to TELEMETRY_INGEST_PATH, bounded queue with retries and drop.
- multiSink: fan-out.
Rust writer today (crates/rh-headless): the CLI writes the reduced per-game summary line through
tournament_cli::write_telemetry (generic Write, every write/flush error propagated to the failure exit code) into
runs-<day>.ndjson. That path, the reduced printed report and the --json payloads are intentionally unchanged by this
plan.

## Producer map: why the values cannot be produced in this packet

The recorder (sim/telemetry.ts, 1,021 lines) obtains values from sim-internal hooks/system and the Room later fills its
own fields. For each area: what the Rust runner exposes today.

Sim-recorder producers (source hook/system -> Rust public surface today):
- raidStarted / teleported / raidEnded / resolved / gv: Env public Event stream has these (Resolved carries RunResult,
  Gv carries amount/reason) - usable.
- damage classification (hitLanded from the ledger: weapon/signature/wish/zombie/card/splash/returned, overkill,
  mob-vs-player contact): Env events expose Hit {victim, by, amount, weapon, passive} only; the ledger's source
  classification, mitigated/overkill split, zombie/card ownership and mob contact times are not public - gap.
- heals by source (HEAL_SOURCES): no public event with the source - gap.
- deaths/kill credit/first blood causes (player/zombie/mob/terrain/suddenDeath/quit/unknown, weapon/sig/ability/mob
  type/camp/zone/coliseum): Death event exposes victim/killer only; cause classification is inside ledger/settle - gap.
- mob kills/elite kills/credited mob stats: no public credited-kill event - gap.
- offers/picks (augment/stat/trophy options, eligible slots, per-slot picks): no public offer event stream - gap.
- camp clears (camp/cycle/zone/type/elite/engaged/cleared/killer/contributors/playerDeaths): no public camp-clear
  record (CampCleared event has only the camp index) - gap.
- 1 Hz sampler (weapons in hand, zone per second, tile pairs, farm-contact seconds): not exposed per tick/second - gap.
- power snapshots at minutes 1/3/5/10 (TelemetryStats, cardPower, mobStatsTotal, boostsTotal): build/card internals not
  exposed through Env - gap.
- duel segmentation (first contact, gap 8 s, third-party/mob/arena bits, side weapons/augments/hp/dmg, comeback):
  derivable only from classified damage/death internals - gap (reduced approximation forbidden).
- wish/potion/quest/mob-stat counters: no public ability/consumable/quest event stream with those fields - gap.
- truncated caps/sampling counters: no equivalents.
Room/runtime-owned producers (runtime.ts finalize -> Rust runner today):
- runId, source, build {server, commit}, startedAtEpoch/endedAtEpoch, humans/bots counts, winnerSlot/winBonusPaid:
  derivable in the Rust CLI writer from declared build/source/run metadata and RunResult, except the epoch stamps are
  wall-clock (a declared-clock normalization would be needed for parity replay).
- pid HMAC-SHA256(salt,"callsign:"+lowercase) first 16 hex: no salt/HMAC surface in the runner (crypto dependency;
  Cargo.lock is frozen in this packet) - gap/decision needed.
- bot tier/persona tags: available from the seat lineup - usable.
- net drops/reconnects, afkMs/afk, client perf sample: Room/connection concerns; the tournament runner has none - gap
  (honest values are zero/absent, but absence vs zero is a shape decision, not approximation).
- config {planSeconds,quests,mobs,coliseumSchedule,botsFillTo}: plan/build config could fill this honestly once mapped -
  usable.

Constraints: this packet's write scopes are crates/rh-headless/src, parity, tools, docs/evidence. The read-only recorder
must live with the simulation internals (crates/rh-sim/src) to see ledger/settle/sampler values; that crate is out of
scope here, and adding a public producer surface would also touch observation/event surfaces this packet forbids. That
is the precise blocker: not capture, but the producer seam.

## Proposed bounded follow-ups

A. Read-only recorder seam in rh-sim (needs lead write-scope extension to crates/rh-sim/src; no gameplay rule changes,
   no observation/schema/protocol changes; installed explicitly like the source installTelemetry, listening on existing
   internal hooks): port the recorder's container + run/player/death/duel/offer/camp/truncated sections against this
   captured record for SHAPE parity (serde types, exact order/optionality; a deserialize->serialize byte-equality test
   on parity/telemetry/run-record.json), plus unit tests from the source recorder's declared hook scenarios (scripted
   ledger hits/heals/offers, like packages/server/test/telemetryRecorder.test.ts). Acceptance: shape parity fixture
   test, no outcome change (a determinism run with the recorder on/off equal), focused tests.
B. Room-owned fill + writer in rh-headless (this scope): build/source/epochs/config/humans/bots/winner, pid decision,
   net/afk/client honest zeros/absence, RunRecord serializer with the 512 KiB tiles rule, written on the existing
   error-propagating path; the reduced printed report and --json payloads stay as they are. Acceptance: writer tests,
   existing corpus untouched.
C. Declared scripted-state VALUE parity (after A): replay the source capture scenario's declared script against the Rust
   sim (public commands or an explicitly approved test seam) and compare the record field-for-field, normalizing only
   the declared environment/clock fields; scenarios extended to cover death kinds, camps, snapshots, bots, truncation.
   May remain partially blocked by sim-mechanics/bot-brain parity; only declared scripted states would be claimed.
Each follow-up is bounded and testable; none fabricates a field.

## Preserved by this packet

- No Rust code change: the reduced printed report, the --json payloads, the existing telemetry writer and its
  error-propagating path, and every existing fixture/corpus are untouched.
- The only added artifacts are the two tool files, the captured protocol-clean fixture and this plan; the fixture is
  additive (no existing payload edited) and capture --check is byte-identical.
