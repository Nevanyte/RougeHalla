// Canonical actual-source owner-combat farm witness: ONE ordinary credited kill of a real catalog nonelite
// plagueRat/frostbowSentry on a real generated, camp-bearing map with config.mobs:true, nontraining, and the complete
// createGameWorld module order. Pinned linux/amd64 Node 22.23.4.
//
// The farmer walks no direct state: the rack is a real sim/loot.ts dropWeapon container taken with an ordinary pickup
// message; the target is locked with an ordinary target message; every attack is the source's own wand trigger; the kill
// is the ledger's real applyLedger -> mobLife.killMob -> payMobKill -> grantMobStat -> recomputeMods -> writeMirrors chain.
// Declared SETUP only: the map seed, config, seat ids/factions, the owner's start position, the two allied seats' start
// positions, and the rack. NOT setup: the NPC roster/stats, the target's hp/death, the farm count, the build/mirrors and
// every RNG outcome. No direct writes to mob stats/hp/death, farm gain, build, mirrors, RNG or outcome occur.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const IMAGE = "node:22.23.4-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292";
const FORMAT = "rh-owner-combat-farm/1";
const BASE_COMMIT = "dbd70f9d810330099b754281b70d511a60f62cf8";
const BRANCH = "deepseek/owner-combat-farm";
const OUTPUT = "source.json";
const PINNED = process.env.RH_OWNER_COMBAT_FARM_PINNED === "1";
// A mutant run deliberately recaptures changed source. Expectations are recorded as booleans instead of aborting; the
// separate verifier is the check. The checked-in corpus is always captured without this flag.
const RECORD_MODE = process.env.RH_OWNER_COMBAT_FARM_RECORD === "1";
const expectSource = (condition, message) => { if (!RECORD_MODE) assert(condition, message); };

const args = process.argv.slice(2);
assert(args.length >= 2, "usage: capture.mts (--write|--check) <outDir> [--repo <root>]");
const mode = args[0];
assert(mode === "--write" || mode === "--check", "mode must be --write or --check");
const outDir = resolve(args[1]);
let repoRoot = "/repo";
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--repo") { assert(typeof args[i + 1] === "string", "--repo needs a path"); repoRoot = resolve(args[++i]); }
  else assert.fail("unknown argument " + args[i]);
}
if (PINNED) {
  assert.equal(process.version, "v22.23.4", "this corpus is captured under Node v22.23.4");
  assert.equal(process.platform, "linux", "this corpus is captured under linux");
  assert.equal(process.arch, "x64", "this corpus is captured under x64");
}
const repo = (p) => join(repoRoot, p);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const shaFile = (p) => sha256(readFileSync(repo(p)));
const plain = (v) => JSON.parse(JSON.stringify(v));
const isFile = (p) => existsSync(repo(p)) && statSync(repo(p)).isFile();
const jsonSafe = (v) => {
  if (v instanceof Map) return { entries: [...v.entries()].map(([k, count]) => [k, count]) };
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") { const out = {}; for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]); return out; }
  return v;
};
/** MapSchema-like maps (build, mobStats, threat) serialize their real entries only. */
const countsSafe = (m) => {
  if (!m) return null;
  if (typeof m.forEach === "function") {
    const entries = [];
    m.forEach((value, key) => entries.push([String(key), value]));
    return { entries };
  }
  return jsonSafe(m);
};
const entriesToRecord = (entries) => {
  if (!entries) return {};
  const out = {};
  for (const [k, v] of entries.entries || entries) out[String(k)] = v;
  return out;
};
const typed = (v) => {
  if (typeof v === "number") {
    if (Number.isFinite(v)) return Object.is(v, -0) ? "-0" : v;
    return Number.isNaN(v) ? "NaN" : v > 0 ? "+Infinity" : "-Infinity";
  }
  if (Array.isArray(v)) return v.map(typed);
  if (v && typeof v === "object") { const out = {}; for (const k of Object.keys(v)) out[k] = typed(v[k]); return out; }
  return v;
};

// --------------------------------------------------------------------------------------------------------- declared setup
const SEED = 20261101;
const RANDOM_SEED = 8;
const REWARD_SALT = [1, 2, 3, 4];
const QUEST_SALT = [5, 6, 7, 8];
const OWNER_ID = "own";
const OWNER_FACTION = "plague";
const OWNER_POS = { x: 2436, y: 3568 };
const ALLY_IDS = ["ally1", "ally2"];
const ALLY_FACTIONS = { ally1: "frost", ally2: "holy" };
const CAMP_INDEX = 20;
const CAMP_REF = CAMP_INDEX + 1;
const TARGET_TYPE = "plagueRat";
const TARGET_SLOT = 0;
const MAX_STEPS = 600;
const POST_STEPS = 30;
const CONFIG = {
  minPlayers: 3, lobbySeconds: 0, fillSeconds: 0, planSeconds: 0,
  patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, firstPatienceSeconds: 3600,
  mobs: true, quests: false, pvpRules: true, weaponSpecials: true, hazards: true, regen: true,
};
const MODULES = { signatures: true, walkHints: true };
const DECLARED_FEATURES = {
  messageTypes: [], wishes: false, statusEffects: true, fields: false, planning: false, chests: false,
  skills: false, relics: false, camps: true, hazards: true,
};
const SEATS = [
  { id: OWNER_ID, profile: "OWNER", faction: OWNER_FACTION, role: "farmer", placement: OWNER_POS },
  ...ALLY_IDS.map((id) => ({ id, profile: id.toUpperCase(), faction: ALLY_FACTIONS[id], role: "idle ally (kept alive; no combat input)" })),
];

// ------------------------------------------------------------------------------------------------------- source modules
const load = (p) => import(repo(p));
const shared = await load("packages/shared/src/index.ts");
const schemaMod = await load("packages/shared/src/schema.ts");
const schemaPkg = await import(repo("node_modules/@colyseus/schema/build/index.mjs"));
// The generated map holds ~194 regional mobs plus 50 camps: one full encodeAll of this state is larger than the SDK default
// buffer. This is the SDK's documented encoder configuration for the retained client, not a change to any source file.
schemaPkg.Encoder.BUFFER_SIZE = 8 * 1024 * 1024;
const gameplayMod = await load("packages/server/src/sim/gameplay.ts");
const stepMod = await load("packages/server/src/sim/step.ts");
const inputsMod = await load("packages/server/src/sim/inputs.ts");
const lootMod = await load("packages/server/src/sim/loot.ts");
const worldMod = await load("packages/server/src/sim/world.ts");
const visionMod = await load("packages/server/src/sim/vision.ts");
const perceptionMod = await load("packages/server/src/bots/brain/perception.ts");

const {
  generateMap, TICK_MS, mulberry32, PLAYER_RADIUS, TARGET_RANGE, hasLineOfSight, circleClear, worldToTile,
  MOB_KILL_STACKS, mobStatReward, mobStatRows, foldRows, mirrorsFromFold, encodeMirrors, decodeMirrors, decodeMult,
} = shared;
const { RaidState, PlayerState } = schemaMod;
const { createGameWorld } = gameplayMod;
const { addPlayer, step: sourceStep } = stepMod;
const { enqueueClientMessage } = inputsMod;
const { dropWeapon } = lootMod;
const { chainHook, collisionMap } = worldMod;
const { canPlayerSee } = visionMod;
const { perceive } = perceptionMod;

// ------------------------------------------------------------------------------------------------------- world building
const MAP = generateMap(SEED);
assert.equal(MAP.seed, SEED, "generateMap returns the declared seed");
assert(MAP.camps.length > CAMP_INDEX, "the generated map has the declared target camp");
const OWNER_SPAWN = OWNER_POS;
const ownerToTargetDistance = Math.hypot(OWNER_SPAWN.x - MAP.camps[CAMP_INDEX].spots[TARGET_SLOT].x, OWNER_SPAWN.y - MAP.camps[CAMP_INDEX].spots[TARGET_SLOT].y);
assert(ownerToTargetDistance <= TARGET_RANGE, "declared owner placement is within TARGET_RANGE of the target spot");
assert(hasLineOfSight(MAP, OWNER_SPAWN, MAP.camps[CAMP_INDEX].spots[TARGET_SLOT]), "declared owner placement has line of sight to the target spot");
assert(circleClear(MAP, OWNER_SPAWN, PLAYER_RADIUS + 2), "declared owner placement is clear floor");

let itemUid = 0;
const world = createGameWorld({
  seed: MAP.seed,
  map: MAP,
  config: CONFIG,
  random: mulberry32(RANDOM_SEED),
  rewardSalt: REWARD_SALT,
  questSalt: QUEST_SALT,
  newItemUid: () => "item-" + (++itemUid),
}, MODULES);
// Real sim/loot.ts ground container, created before the first step (tick 0, as a hand-built arena rack is), taken by the
// ordinary pickup message in the first recorded step.
const rack = dropWeapon(world, OWNER_SPAWN, "wand");
for (const seat of SEATS) addPlayer(world, seat.id, seat.profile, { faction: seat.faction });
const raidStartEvents = sourceStep(world, TICK_MS);
assert.equal(world.state.phase, "active", "the ordinary lobby step starts the raid");
assert(world.state.mobs.size > 0, "config.mobs spawns the regional rosters");

// Declared SETUP placements, applied once after the raid started and before the first recorded combat input.
function place(id, p) {
  const s = world.state.players.get(id);
  const rt = world.players.get(id);
  assert(s && rt, "seat " + id);
  s.x = p.x; s.y = p.y;
  if (typeof p.facing === "number") s.facing = p.facing;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
}
place(OWNER_ID, { ...OWNER_POS, facing: 0 });
const allyPlacements = {};
for (let i = 0; i < ALLY_IDS.length; i++) {
  const spot = MAP.coliseum.innerSpawns[i % MAP.coliseum.innerSpawns.length];
  assert(spot, "the generated map has coliseum inner spawns");
  allyPlacements[ALLY_IDS[i]] = { x: spot.x, y: spot.y };
  place(ALLY_IDS[i], { ...spot, facing: 0 });
}

// The actual camp roster/stats/spawn, read from the source state, never written.
const campDef = MAP.camps[CAMP_INDEX];
const publishedCamp = world.state.camps[CAMP_INDEX];
assert.equal(campDef.zone, "plague", "the declared camp is in the plague zone");
assert.equal(campDef.spots.length, 5, "the declared camp has five spots");
assert.equal(publishedCamp.type, TARGET_TYPE, "the actual rewardRandom roll put a plagueRat roster at the camp");
assert.equal(publishedCamp.alive, campDef.spots.length, "every camp spot has a live mob after raid start");
assert.equal(campDef.eliteSpot, -1, "the chosen camp has no elite spot");
const targetHome = campDef.spots[TARGET_SLOT];
let targetId = null;
for (const [id, m] of world.state.mobs) {
  if (m.camp === CAMP_REF && m.type === TARGET_TYPE && m.kind === "mob" && m.status === "alive"
    && Math.hypot(m.x - targetHome.x, m.y - targetHome.y) <= 0.5) { targetId = id; break; }
}
assert(targetId, "the source spawned the declared normal plagueRat at the target slot");
const targetState0 = world.state.mobs.get(targetId);
const targetRuntime0 = world.mobs.get(targetId);
assert(targetState0 && targetRuntime0 && targetRuntime0.brain);
assert.equal(targetRuntime0.brain.elite, false, "the target is a nonelite camp mob");
assert.equal(targetState0.maxHp > 0, true, "the target has source hp");
const targetInitial = {
  id: targetId, kind: targetState0.kind, type: targetState0.type, name: targetState0.name,
  zone: campDef.zone, campIndex: CAMP_INDEX, campRef: CAMP_REF, campId: campDef.id, slot: TARGET_SLOT,
  home: { x: targetHome.x, y: targetHome.y }, elite: targetRuntime0.brain.elite,
  hp: targetState0.hp, maxHp: targetState0.maxHp, weapon0: targetState0.weapon0, faction: targetState0.faction,
  role: shared.mobTypeById(TARGET_TYPE).role,
};
const campMobIds = [];
for (const [id, m] of world.state.mobs) if (m.camp === CAMP_REF) campMobIds.push(id);
const reward = mobStatReward(TARGET_TYPE);
assert(reward && reward.effect.k === "stat" && reward.effect.stat === "attackSpeed" && reward.effect.v === 0.01, "the target type awards attackSpeed v=0.01 per stack");
assert.equal(MOB_KILL_STACKS, 3, "a credited normal kill grants three stacks");

// --------------------------------------------------------------------------------------------------- owner group + frames
const OWNER_GROUP_FIELDS = ["attackTarget", "drawStartedAt", "readyAt", "asMult", "windupMult", "speedMult"];
const OWNER_CONTEXT_FIELDS = ["status", "faction", "slot", "weapon0", "weapon1", "hp", "maxHp", "x", "y", "facing", "effects", "barrier", "kills", "mobKills", "gv"];
function ownerGroup(p) {
  const out = {};
  for (const f of OWNER_GROUP_FIELDS) out[f] = p[f];
  for (const f of OWNER_CONTEXT_FIELDS) out[f] = p[f];
  return out;
}
function mirrorsOf(p) {
  return {
    asMult: p.asMult, windupMult: p.windupMult, speedMult: p.speedMult, armorBonus: p.armorBonus,
    shieldBonus: p.shieldBonus, adBonus: p.adBonus, apBonus: p.apBonus,
  };
}
function decodedMirrors(p) {
  return mirrorsOf(decodeMirrors(p));
}
function playerRow(p) {
  return {
    id: undefined, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, status: p.status, faction: p.faction,
    weapon0: p.weapon0, weapon1: p.weapon1, slot: p.slot, attackTarget: p.attackTarget, drawStartedAt: p.drawStartedAt, readyAt: p.readyAt,
  };
}

class Tape {
  constructor(world, ownerId, targetId, campMobIds) {
    this.world = world;
    this.ownerId = ownerId;
    this.targetId = targetId;
    this.campMobIds = new Set(campMobIds);
    this.encoder = new schemaPkg.Encoder(world.state);
    this.clientState = new RaidState();
    this.decoder = new schemaPkg.Decoder(this.clientState);
    this.firstFrame = true;
    this.frames = [];
    this.actions = [];
    this.observers = [];
    this.stepObservers = [];
    this.pending = [];
    this.steps = 0;
    this.currentStep = 0;
    this.killObserver = null;
  }
  send(actorId, message, msg) {
    const rt = this.world.players.get(actorId);
    assert(rt, "actor " + actorId);
    const accepted = enqueueClientMessage(rt.inputs, message, msg, { training: false });
    const row = { step: this.steps + 1, actor: actorId, message, msg: jsonSafe(msg), accepted };
    this.actions.push(row);
    this.pending.push({ actor: actorId, message, msg: jsonSafe(msg), accepted });
    return accepted;
  }
  observe() {
    const w = this.world;
    const stepOf = () => this.currentStep || this.steps + 1;
    chainHook(w, "mobKilled", (_w, killer, mob) => {
      const ev = { kind: "mobKilled", step: stepOf(), serverTime: w.state.serverTime, killer: killer ? { id: killer.id, profile: killer.profile } : null, mob: plain(mob) };
      this.stepObservers.push(ev); this.observers.push(ev);
      if (this.killObserver === null) this.killObserver = ev;
    });
    chainHook(w, "hitLanded", (_w, entry, applied) => {
      if (!(entry.victim === this.targetId || entry.by.id === this.ownerId)) return;
      const v = w.state.players.get(entry.victim) ?? w.state.mobs.get(entry.victim);
      const ev = {
        kind: "hitLanded", step: stepOf(), serverTime: w.state.serverTime,
        by: { id: entry.by.id, name: entry.by.name, ownerId: entry.by.ownerId ?? null }, victim: entry.victim,
        applied, weapon: entry.weapon, ability: entry.ability ?? null, sig: entry.sig ?? null,
        raw: entry.packet ? entry.packet.raw : null, crit: entry.packet ? entry.packet.crit === true : false,
        victimHpAfter: v ? v.hp : null, victimStatusAfter: v ? v.status : null,
      };
      this.stepObservers.push(ev); this.observers.push(ev);
    });
    chainHook(w, "fighterOut", (_w, id, cause) => {
      if (id !== this.targetId && !this.campMobIds.has(id)) return;
      const ev = { kind: "fighterOut", step: stepOf(), serverTime: w.state.serverTime, id, cause };
      this.stepObservers.push(ev); this.observers.push(ev);
    });
  }
  step() {
    this.stepObservers = [];
    const stepNumber = this.steps + 1;
    this.currentStep = stepNumber;
    const events = sourceStep(this.world, TICK_MS);
    this.steps = stepNumber;
    const pending = this.pending;
    this.pending = [];
    this.capture(pending, events);
    return events;
  }
  capture(pending, events) {
    const w = this.world;
    const s = w.state;
    const me = s.players.get(this.ownerId);
    assert(me, "the owner is alive in the state");
    const hostGroup = ownerGroup(me);
    // (a) The retained client: a real full encodeAll at the first recorded step, then the real per-step patch decoded into
    //     one retained RaidState (exactly what a joined client holds). Patch bytes are hashed.
    let patch;
    let fullSnapshot = false;
    if (this.firstFrame) {
      patch = Buffer.from(this.encoder.encodeAll());
      this.firstFrame = false;
      fullSnapshot = true;
    } else {
      patch = Buffer.from(this.encoder.encode());
    }
    this.encoder.discardChanges();
    this.decoder.decode(patch);
    const decodedMe = this.clientState.players.get(this.ownerId);
    assert(decodedMe, "the retained client decoded the owner row");
    const decodedGroup = ownerGroup(decodedMe);
    // (b) The canonical owner group written into a fresh real PlayerState, full-encoded and decoded as a real snapshot.
    const snapRow = new PlayerState();
    for (const f of OWNER_GROUP_FIELDS.concat(OWNER_CONTEXT_FIELDS)) snapRow[f] = me[f];
    const snapState = new RaidState();
    snapState.players.set(this.ownerId, snapRow);
    const snapBytes = Buffer.from(new schemaPkg.Encoder(snapState).encodeAll());
    const snapDecoded = new RaidState();
    new schemaPkg.Decoder(snapDecoded).decode(snapBytes);
    const snapDecodedRow = snapDecoded.players.get(this.ownerId);
    const fullGroup = snapDecodedRow ? ownerGroup(snapDecodedRow) : null;
    // (c) The original bot perceive on the live host state and on the actually decoded client state.
    const perceptCtx = {
      selfId: this.ownerId, map: w.map, features: DECLARED_FEATURES, lastMinimap: null,
      canSee: (point) => canPlayerSee(w, this.ownerId, point),
    };
    const perceptHost = perceive({ state: s }, perceptCtx);
    const perceptDecoded = perceive({ state: this.clientState }, perceptCtx);
    const watched = (percept) => {
      const mobs = percept.mobs.filter((m) => m.id === this.targetId || this.campMobIds.has(m.id));
      return { t: percept.t, self: plain(percept.self), mobs: plain(mobs), fighters: plain(percept.fighters), alive: percept.hud.alive, playerCount: percept.hud.playerCount };
    };
    // (d) Source clocks, held state, the actual target mob/camp rows and the camp mates.
    const rt = w.players.get(this.ownerId);
    const weapon = rt.weapon;
    const action = weapon.action;
    const held = {
      lock: weapon.lock, lockSeen: weapon.lockSeen, lockLosLostAt: weapon.lockLosLostAt,
      held: weapon.held, pressedAt: weapon.pressedAt, bufferedUntil: weapon.bufferedUntil,
      aim: weapon.aim, aimAt: weapon.aimAt, lastShotAt: Number.isFinite(weapon.lastShotAt) ? weapon.lastShotAt : null,
      action: action ? { kind: action.kind, weapon: action.weapon, startedAt: action.startedAt, landsAt: action.landsAt, target: action.target ?? null } : null,
      pathLength: rt.path.length, rootUntil: weapon.rootUntil, attackMoveGoal: weapon.attackMoveGoal,
    };
    const target = s.mobs.get(this.targetId);
    const targetRt = w.mobs.get(this.targetId);
    const brain = targetRt ? targetRt.brain : null;
    const targetRow = target ? {
      id: this.targetId, present: true, kind: target.kind, name: target.name, type: target.type, camp: target.camp,
      faction: target.faction, x: target.x, y: target.y, facing: target.facing, hp: target.hp, maxHp: target.maxHp,
      status: target.status, weapon0: target.weapon0, slot: target.slot, readyAt: target.readyAt,
      drawStartedAt: target.drawStartedAt, effects: target.effects,
      brain: brain ? {
        region: brain.region, elite: brain.elite, home: plain(brain.home), mode: brain.mode, target: brain.target,
        lastCombatAt: brain.lastCombatAt, diedAt: brain.diedAt, threat: countsSafe(brain.threat),
      } : null,
      runtime: targetRt ? {
        pathLength: targetRt.path.length, held: targetRt.weapon.held, lock: targetRt.weapon.lock,
        action: targetRt.weapon.action ? { kind: targetRt.weapon.action.kind, weapon: targetRt.weapon.action.weapon, startedAt: targetRt.weapon.action.startedAt, landsAt: targetRt.weapon.action.landsAt } : null,
      } : null,
    } : { id: this.targetId, present: false };
    const camp = s.camps[CAMP_INDEX];
    const campRow = camp ? {
      index: CAMP_INDEX, campRef: CAMP_REF, id: campDef.id, zone: campDef.zone, eliteSpot: campDef.eliteSpot,
      spots: campDef.spots.length, type: camp.type, elite: camp.elite, alive: camp.alive, state: camp.state,
      reward: camp.reward, clearedAt: camp.clearedAt, respawnAt: camp.respawnAt, wardOwner: camp.wardOwner, wardExpiresAt: camp.wardExpiresAt,
    } : null;
    const campMates = [];
    for (const id of this.campMobIds) {
      const m = s.mobs.get(id);
      campMates.push(m ? { id, type: m.type, status: m.status, hp: m.hp, maxHp: m.maxHp, x: m.x, y: m.y } : { id, present: false });
    }
    let mobsAlive = 0;
    for (const m of s.mobs.values()) if (m.status === "alive") mobsAlive++;
    let playersAlive = 0;
    for (const p of s.players.values()) if (p.status === "alive") playersAlive++;
    const players = [];
    for (const [id, p] of s.players) players.push({ id, ...playerRow(p), faction: p.faction });
    const eventsPlain = plain(events);
    const projectiles = [];
    for (const pr of w.projectiles.values()) {
      if (pr.owner !== this.ownerId && pr.targetId !== this.targetId) continue;
      projectiles.push({ id: pr.id, kind: pr.kind, weapon: pr.weapon, owner: pr.owner, targetId: pr.targetId ?? null, x: pr.x, y: pr.y, traveled: pr.traveled, simT: pr.simT });
    }
    const out = {
      kind: "step",
      step: this.steps, tick: s.tick, serverTime: s.serverTime,
      inputs: pending,
      owner: hostGroup,
      ownerDecoded: decodedGroup,
      ownerMirrors: mirrorsOf(me),
      ownerDecodedWireMirrors: mirrorsOf(decodedMe),
      ownerDecodedMirrors: decodedMirrors(decodedMe),
      ownerBuild: countsSafe(me.build),
      ownerMobStats: countsSafe(me.mobStats),
      schema: {
        patch: { full: fullSnapshot, bytes: patch.length, sha256: sha256(patch) },
        fullGroup: { bytes: snapBytes.length, sha256: sha256(snapBytes), decoded: fullGroup },
      },
      bot: watched(perceptHost),
      botDecoded: watched(perceptDecoded),
      source: {
        phase: s.phase, serverTime: s.serverTime, tick: s.tick, raidStartedAt: s.raidStartedAt, gatesLocked: s.gatesLocked,
        owner: { ...playerRow(me), hpFracAtTickStart: rt.hpFracAtTickStart, down: rt.down, resolved: rt.resolved, killedBy: rt.killedBy, mobKills: rt.mobKills, gv: plain(rt.gv) },
        held,
        target: targetRow,
        camp: campRow,
        campMates,
        players,
        counts: { mobsTotal: s.mobs.size, mobsAlive, playersAlive, targetCampAlive: camp ? camp.alive : null },
      },
      observers: plain(this.stepObservers),
      events: eventsPlain,
      projectiles,
    };
    this.frames.push(out);
    return out;
  }
}

// The actual post-raid placement/state, read before the first recorded combat step (declared SETUP boundaries).
const seatsAfterPlacement = {};
for (const seat of SEATS) {
  const p = world.state.players.get(seat.id);
  seatsAfterPlacement[seat.id] = p ? { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, faction: p.faction, status: p.status } : null;
}
const tape = new Tape(world, OWNER_ID, targetId, campMobIds);
tape.observe();
let killStep = null;
let ended = false;
for (let i = 1; i <= MAX_STEPS; i++) {
  if (i === 1) tape.send(OWNER_ID, "pickup", { containerId: rack.id });
  if (i === 4) tape.send(OWNER_ID, "target", { id: targetId });
  tape.step();
  const m = world.state.mobs.get(targetId);
  if (killStep === null && (!m || m.status === "dead")) killStep = tape.steps;
  if (world.state.phase !== "active") { ended = true; break; }
  if (killStep !== null && tape.steps >= killStep + POST_STEPS) break;
}
const frames = tape.frames;
const killFrameIndex = killStep === null ? -1 : frames.findIndex((f) => f.step === killStep);
assert(killFrameIndex >= 0, RECORD_MODE ? "mutant capture: no kill frame (verifier will fail)" : "the real producer kill was recorded");
const preKillFrameIndex = killFrameIndex > 0 ? killFrameIndex - 1 : -1;
// The post-kill evidence frame is ten completed steps after the kill (the target is still a dead corpse and the lock has
// cleared); the corpus also keeps every completed step through kill+POST_STEPS, including the corpse reaping.
const postKillFrameIndex = Math.min(frames.length - 1, killFrameIndex + 10);
assert(preKillFrameIndex >= 0, "an initial/pre-kill completed-step frame precedes the kill");

// Frame windows, set without changing any source value.
for (let i = 0; i < frames.length; i++) {
  frames[i].window = i === 0 ? "initial" : i < killFrameIndex ? "pre-kill" : i === killFrameIndex ? "kill" : "post-kill";
}
const killFrame = frames[killFrameIndex];
const preKillFrame = frames[preKillFrameIndex];
const postKillFrame = frames[postKillFrameIndex];
const finalFrame = frames[frames.length - 1];
const ownerMobStatsAt = (frame) => entriesToRecord(frame.ownerMobStats);
const targetHpAt = (frame) => (frame.source.target && frame.source.target.present ? frame.source.target.hp : null);
const killEvents = killFrame.events;
const deathEvent = killEvents.find((e) => e.type === "fx" && e.fx && e.fx.kind === "death" && e.fx.id === targetId) ?? null;
const grantToast = killEvents.find((e) => e.type === "toast" && e.to === OWNER_ID && typeof e.text === "string" && e.text.includes("kill stacks")) ?? null;
const gvEvent = killEvents.find((e) => e.type === "gv" && e.id === OWNER_ID && e.reason === "mob") ?? null;
const mobKilledObserver = killFrame.observers.find((o) => o.kind === "mobKilled") ?? null;
const hitsOnTarget = tape.observers.filter((o) => o.kind === "hitLanded" && o.victim === targetId);
const lethalHit = [...hitsOnTarget].reverse().find((h) => h.victimStatusAfter === "dead" || h.victimHpAfter === 0) ?? (hitsOnTarget.length ? hitsOnTarget[hitsOnTarget.length - 1] : null);
const allMobKilled = tape.observers.filter((o) => o.kind === "mobKilled");

// The expected mirror values are computed from the ACTUAL recorded farm count with the source's own shared fold/encode
// functions, never a copied formula: mobStatRows(mobStats) -> foldRows({farmRows}) -> mirrorsFromFold -> encodeMirrors.
const mobStatsAfter = ownerMobStatsAt(killFrame);
const mobStatsBefore = ownerMobStatsAt(preKillFrame);
const expectedFarmRows = mobStatRows(mobStatsAfter);
const expectedFolded = foldRows([], { farmRows: expectedFarmRows });
const expectedMirrors = encodeMirrors(mirrorsFromFold(expectedFolded));
const expectedBeforeMirrors = encodeMirrors(mirrorsFromFold(foldRows([], { farmRows: mobStatRows(mobStatsBefore) })));

// `readyAt` is a uint32 on the wire, so a fractional host readyAt decodes truncated (the D22 quantization); the mirrors and
// the integer lock fields are the wire-equality check here.
const WIRE_GROUP_FIELDS = ["asMult", "windupMult", "speedMult", "drawStartedAt", "attackTarget"];
const framesMatchDecoded = frames.every((f) => WIRE_GROUP_FIELDS.every((k) => f.owner[k] === f.ownerDecoded[k]));
const framesMatchFullGroup = frames.every((f) => f.schema.fullGroup.decoded && WIRE_GROUP_FIELDS.every((k) => f.owner[k] === f.schema.fullGroup.decoded[k]));
const botMatchesDecoded = frames.every((f) => f.bot.self.asMult === decodeMult(f.owner.asMult) && f.bot.self.windupMult === decodeMult(f.owner.windupMult) && f.bot.self.speedMult === decodeMult(f.owner.speedMult));
const botDecodedMatchesDecoded = frames.every((f) => f.botDecoded.self.asMult === decodeMult(f.ownerDecoded.asMult) && f.botDecoded.self.windupMult === decodeMult(f.ownerDecoded.windupMult) && f.botDecoded.self.speedMult === decodeMult(f.ownerDecoded.speedMult));
const expectedWire = expectedMirrors;
const sourceChecks = {
  mapGeneratedOnDeclaredSeed: MAP.seed === SEED,
  targetCampRolledFromActualRewardStream: publishedCamp.type === TARGET_TYPE,
  targetIsNoneliteCatalogMob: targetInitial.elite === false && shared.mobTypeById(TARGET_TYPE)?.elite === false,
  targetAwardsAttackSpeed: reward.effect.k === "stat" && reward.effect.stat === "attackSpeed" && reward.effect.v === 0.01,
  mobKillStacksAreThree: MOB_KILL_STACKS === 3,
  ownerWithinTargetRange: ownerToTargetDistance <= TARGET_RANGE,
  ownerHasLineOfSightAtSetup: hasLineOfSight(MAP, OWNER_SPAWN, targetHome),
  pickupAccepted: tape.actions.some((a) => a.message === "pickup" && a.accepted === true),
  targetOrderAccepted: tape.actions.some((a) => a.message === "target" && a.accepted === true),
  targetWasAliveBeforeKill: targetHpAt(preKillFrame) > 0,
  targetKilledByOwner: mobKilledObserver !== null && mobKilledObserver.killer && mobKilledObserver.killer.id === OWNER_ID,
  deathEventNamesOwner: deathEvent !== null && deathEvent.fx.by === OWNER_ID,
  oneActualMobKillOnly: allMobKilled.length === 1,
  grantToastRecorded: grantToast !== null,
  gvMobRecorded: gvEvent !== null,
  mobStatsBeforeEmpty: !mobStatsBefore[TARGET_TYPE],
  mobStatsAfterThree: mobStatsAfter[TARGET_TYPE] === MOB_KILL_STACKS,
  asMultBeforeExpected: preKillFrame.owner.asMult === expectedBeforeMirrors.asMult,
  asMultAfterExpected: killFrame.owner.asMult === expectedWire.asMult,
  asMultDecodedAfterExpected: killFrame.ownerDecoded.asMult === expectedWire.asMult,
  windupMultBeforeIdentity: preKillFrame.owner.windupMult === expectedBeforeMirrors.windupMult,
  windupMultAfterIdentity: killFrame.owner.windupMult === expectedWire.windupMult,
  speedMultBeforeIdentity: preKillFrame.owner.speedMult === expectedBeforeMirrors.speedMult,
  speedMultAfterIdentity: killFrame.owner.speedMult === expectedWire.speedMult,
  retainedClientMirrorsMatchHost: framesMatchDecoded,
  fullSnapshotGroupMatchesHost: framesMatchFullGroup,
  hostPerceiveMatchesHostMirrors: botMatchesDecoded,
  decodedPerceiveMatchesDecodedMirrors: botDecodedMatchesDecoded,
  runStillActiveAtLastFrame: finalFrame.source.phase === "active" && !ended,
  ownerAliveAtLastFrame: finalFrame.owner.status === "alive" && finalFrame.owner.hp > 0,
  enoughOtherSeatsAlive: finalFrame.source.counts.playersAlive >= 2,
  targetHpWentToZero: targetHpAt(killFrame) === 0 && killFrame.source.target.status === "dead",
};
for (const [k, v] of Object.entries(sourceChecks)) expectSource(v === true, "source check failed: " + k);
assert.equal(targetInitial.type, TARGET_TYPE, "the actual target is the declared catalog type");

// ------------------------------------------------------------------------------------------------------------- transitions
function transitions(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) if (values[i].value !== values[i - 1].value) out.push({ frameIndex: i, step: values[i].step, from: values[i - 1].value, to: values[i].value });
  return out;
}
const series = (read) => frames.map((f) => ({ frameIndex: frames.indexOf(f), step: f.step, value: read(f) }));
const transitionsOut = {
  asMult: transitions(series((f) => f.owner.asMult)),
  windupMult: transitions(series((f) => f.owner.windupMult)),
  speedMult: transitions(series((f) => f.owner.speedMult)),
  attackTarget: transitions(series((f) => f.owner.attackTarget)),
  readyAt: transitions(series((f) => f.owner.readyAt)),
  targetHp: transitions(series((f) => targetHpAt(f))),
  mobStatsCount: transitions(series((f) => ownerMobStatsAt(f)[TARGET_TYPE] ?? 0)),
  ownerHp: transitions(series((f) => f.owner.hp)),
};

// ----------------------------------------------------------------------------------------------------------------- corpus
const setup = {
  map: {
    source: "packages/shared/src/mapgen.ts generateMap(seed)",
    seed: MAP.seed, attempt: MAP.attempt, hashU32: world.state.mapHash,
    width: MAP.w, height: MAP.h, camps: MAP.camps.length, spawns: MAP.spawns.length,
    tilesSha256: sha256(Buffer.from(MAP.tiles)),
    targetCamp: { index: CAMP_INDEX, id: campDef.id, zone: campDef.zone, eliteSpot: campDef.eliteSpot, spots: campDef.spots.length, slot: TARGET_SLOT, home: targetHome },
  },
  config: plain(CONFIG),
  modules: { assembler: "createGameWorld", signatures: MODULES.signatures, walkHints: MODULES.walkHints, note: "the complete canonical module order is installed" },
  seats: SEATS.map((seat) => {
    const p = world.state.players.get(seat.id);
    const ally = allyPlacements[seat.id] ?? null;
    return {
      id: seat.id, profile: seat.profile, faction: seat.faction, role: seat.role,
      declaredPlacement: seat.id === OWNER_ID ? { ...OWNER_POS, facing: 0 } : { ...ally, facing: 0 },
      afterRaid: seatsAfterPlacement[seat.id],
      finalState: p ? { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, faction: p.faction, status: p.status } : null,
    };
  }),
  owner: {
    id: OWNER_ID, faction: OWNER_FACTION,
    declaredPlacement: { ...OWNER_POS, facing: 0 },
    afterRaid: seatsAfterPlacement[OWNER_ID],
    declaredLoadout: { source: "real sim/loot.ts dropWeapon ground container taken by ordinary pickup", rackId: rack.id, rackDef: "wand", rackAt: OWNER_POS, pickupStep: 1 },
    afterPickup: { step: 1, weapon0: frames[0].owner.weapon0, slot: frames[0].owner.slot, readyAt: frames[0].owner.readyAt },
  },
  target: {
    expected: { campIndex: CAMP_INDEX, campRef: CAMP_REF, campId: campDef.id, zone: campDef.zone, slot: TARGET_SLOT, type: TARGET_TYPE, elite: false },
    actual: targetInitial,
    reward: { id: reward.id, name: reward.name, zone: reward.zone, effect: plain(reward.effect), text: reward.text, killStacks: MOB_KILL_STACKS },
  },
  rng: {
    random: "mulberry32(" + RANDOM_SEED + ")",
    orderSalt: world.orderSalt,
    rewardSalt: REWARD_SALT,
    questSalt: QUEST_SALT,
    rewardStream: "server/sim/world.ts rewardStream(rewardSalt) -> sim/camps.ts rollCampTypes",
    hashSalt: Array.from(world.hashSalt),
    itemUid: "item-N incrementing from item-1",
    note: "camp rosters and every loot/map draw are actual source RNG output; the corpus records them, it does not install them",
  },
  perceiveFeatures: DECLARED_FEATURES,
  raidStartEvents: plain(raidStartEvents),
  clocks: { tickMs: TICK_MS, firstRecordedStep: frames[0].step, killStep, lastRecordedStep: frames[frames.length - 1].step, raidStartedAt: frames[0].source.raidStartedAt },
};

const kill = {
  frameIndex: killFrameIndex, step: killFrame.step, tick: killFrame.tick, serverTime: killFrame.serverTime,
  preFrameIndex: preKillFrameIndex, preStep: preKillFrame.step,
  postFrameIndex: postKillFrameIndex, postStep: postKillFrame.step,
  targetId, type: TARGET_TYPE, role: targetInitial.role, zone: campDef.zone, campIndex: CAMP_INDEX, campRef: CAMP_REF, campId: campDef.id, slot: TARGET_SLOT,
  targetHpBefore: targetHpAt(preKillFrame), targetHpAtKill: targetHpAt(killFrame), targetStatusAtKill: killFrame.source.target.status,
  ownerHpBefore: preKillFrame.owner.hp, ownerHpAfter: killFrame.owner.hp,
  deathEvent, mobKilledObserver, fighterOutObserver: killFrame.observers.find((o) => o.kind === "fighterOut" && o.id === targetId) ?? null,
  grantToast, gvEvent, lethalHit, hitsOnTarget,
  before: {
    frameIndex: preKillFrameIndex, step: preKillFrame.step, serverTime: preKillFrame.serverTime,
    mirrors: { host: preKillFrame.ownerMirrors, decoded: preKillFrame.ownerDecodedMirrors },
    mobStats: mobStatsBefore, build: entriesToRecord(preKillFrame.ownerBuild),
    target: preKillFrame.source.target, camp: preKillFrame.source.camp, counts: preKillFrame.source.counts,
    attackTarget: preKillFrame.owner.attackTarget, readyAt: preKillFrame.owner.readyAt, held: preKillFrame.source.held,
    schemaPatch: preKillFrame.schema.patch, fullGroup: preKillFrame.schema.fullGroup,
  },
  at: {
    frameIndex: killFrameIndex, step: killFrame.step, serverTime: killFrame.serverTime,
    mirrors: { host: killFrame.ownerMirrors, decoded: killFrame.ownerDecodedMirrors },
    mobStats: mobStatsAfter, build: entriesToRecord(killFrame.ownerBuild),
    attackTarget: killFrame.owner.attackTarget, readyAt: killFrame.owner.readyAt, held: killFrame.source.held,
    target: killFrame.source.target, camp: killFrame.source.camp, counts: killFrame.source.counts,
    schemaPatch: killFrame.schema.patch, fullGroup: killFrame.schema.fullGroup,
    botSelf: killFrame.bot.self, botDecodedSelf: killFrame.botDecoded.self,
  },
  after: {
    frameIndex: postKillFrameIndex, step: postKillFrame.step, serverTime: postKillFrame.serverTime,
    mirrors: { host: postKillFrame.ownerMirrors, decoded: postKillFrame.ownerDecodedMirrors },
    mobStats: ownerMobStatsAt(postKillFrame), build: entriesToRecord(postKillFrame.ownerBuild),
    attackTarget: postKillFrame.owner.attackTarget, readyAt: postKillFrame.owner.readyAt, held: postKillFrame.source.held,
    target: postKillFrame.source.target, camp: postKillFrame.source.camp, counts: postKillFrame.source.counts,
    schemaPatch: postKillFrame.schema.patch, fullGroup: postKillFrame.schema.fullGroup,
  },
  expected: {
    mobStats: mobStatsAfter, farmRows: plain(expectedFarmRows), fold: { farmSums: plain(expectedFolded.farmSums), sums: plain(expectedFolded.sums) },
    mirrors: expectedWire, beforeMirrors: expectedBeforeMirrors,
    sourceFunctions: "mobStatRows -> foldRows({farmRows}) -> mirrorsFromFold -> encodeMirrors (actual shared source)",
  },
  transitions: {
    asMult: transitionsOut.asMult, windupMult: transitionsOut.windupMult, speedMult: transitionsOut.speedMult,
    attackTarget: transitionsOut.attackTarget, mobStatsCount: transitionsOut.mobStatsCount, targetHp: transitionsOut.targetHp,
  },
};

// ------------------------------------------------------------------------------------------------------- source closure
const ENTRY_SOURCES = [
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/inputs.ts",
  "packages/server/src/sim/loot.ts",
  "packages/server/src/sim/world.ts",
  "packages/server/src/sim/vision.ts",
  "packages/server/src/sim/mobStats.ts",
  "packages/server/src/sim/mods.ts",
  "packages/server/src/sim/mobLife.ts",
  "packages/server/src/sim/camps.ts",
  "packages/server/src/bots/brain/perception.ts",
  "packages/shared/src/index.ts",
  "packages/shared/src/schema.ts",
];
const IMPORT_RE = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^'"]+)["']\s*\)/g;
const importsOf = (text) => {
  const out = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
  }
  return out;
};
const tryTs = (base) => {
  for (const cand of [base, base + ".ts", base + ".tsx", base + ".mts", base.replace(/\.js$/, ".ts"), base + "/index.ts", base + "/index.tsx"]) if (isFile(cand)) return cand;
  return null;
};
function resolveSpecifier(fromRel, spec) {
  if (spec.charAt(0) === ".") {
    const base = join(dirname(fromRel), spec).split("\\").join("/");
    if (spec.endsWith(".css")) return { kind: "style", path: base };
    const ts = tryTs(base);
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: base };
  }
  if (spec === "@raid/shared") return { kind: "ts", path: "packages/shared/src/index.ts" };
  if (spec.indexOf("@raid/shared/") === 0) {
    const ts = tryTs("packages/shared/src/" + spec.slice("@raid/shared/".length));
    return ts ? { kind: "ts", path: ts } : { kind: "unresolved", path: spec };
  }
  return { kind: "external", path: spec };
}
const sourceFiles = new Set();
const styleFiles = new Set();
const externalImports = new Set();
const unresolvedImports = new Set();
{
  const stack = ENTRY_SOURCES.slice();
  while (stack.length > 0) {
    const rel = stack.pop();
    if (sourceFiles.has(rel)) continue;
    sourceFiles.add(rel);
    for (const spec of importsOf(readFileSync(repo(rel), "utf8"))) {
      const r = resolveSpecifier(rel, spec);
      if (r.kind === "ts") stack.push(r.path);
      else if (r.kind === "style") styleFiles.add(r.path);
      else if (r.kind === "external") externalImports.add(r.path);
      else unresolvedImports.add(spec + " (from " + rel + ")");
    }
  }
}
assert.equal(unresolvedImports.size, 0, "the source closure has no unresolved imports");
const sourceFileHashes = Object.fromEntries(Array.from(sourceFiles).sort().map((p) => [p, shaFile(p)]));
const styleFileHashes = Object.fromEntries(Array.from(styleFiles).sort().map((p) => [p, shaFile(p)]));
const externalVersions = {};
for (const name of ["@colyseus/schema", "tsx", "typescript"]) {
  const p = repo("node_modules/" + name + "/package.json");
  if (existsSync(p)) externalVersions[name] = String(JSON.parse(readFileSync(p, "utf8")).version);
}
const TOOL_FILES = [
  "tools/owner-combat-farm-fixtures/capture.mts",
  "tools/owner-combat-farm-fixtures/capture.sh",
  "tools/owner-combat-farm-fixtures/verify.mjs",
  "tools/owner-combat-farm-fixtures/apply-patch.mjs",
  "tools/owner-combat-farm-fixtures/run-mutants.sh",
  "tools/owner-combat-farm-fixtures/hash-of.mjs",
  "tools/owner-combat-farm-fixtures/README.md",
  "tools/owner-combat-farm-fixtures/mutants/01-writemirrors-asmirror-omit.patch",
  "tools/owner-combat-farm-fixtures/mutants/02-provenance-only-comment.patch",
  "tools/owner-combat-farm-fixtures/mutants/expected.txt",
];
const toolHashes = {};
for (const p of TOOL_FILES) if (isFile(p)) toolHashes[p] = shaFile(p);
const manifests = {
  "package.json": shaFile("package.json"),
  "package-lock.json": shaFile("package-lock.json"),
  "tsconfig.base.json": isFile("tsconfig.base.json") ? shaFile("tsconfig.base.json") : null,
  ...Object.fromEntries(["packages/server/tsconfig.json", "packages/shared/tsconfig.json", "packages/client/tsconfig.json"].filter(isFile).map((p) => [p, shaFile(p)])),
  "Cargo.lock": isFile("Cargo.lock") ? shaFile("Cargo.lock") : null,
  "rust-toolchain.toml": isFile("rust-toolchain.toml") ? shaFile("rust-toolchain.toml") : null,
};

const PROFILE = {
  format: FORMAT,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  pinned: PINNED,
  image: IMAGE,
  imageDigest: "sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292",
  imagePlatform: "linux/amd64",
  asserts: PINNED ? { node: "v22.23.4", platform: "linux", arch: "x64" } : { node: "local development (not the pinned corpus run)", platform: process.platform, arch: process.arch },
  base: { commit: BASE_COMMIT, branch: BRANCH, immutableBase: true },
  repoRoot,
  capture: {
    api: ["generateMap", "createGameWorld", "addPlayer", "dropWeapon", "enqueueClientMessage", "step", "perceive", "@colyseus/schema Encoder/Decoder"],
    inputs: "ordinary enqueueClientMessage messages only; no direct lifecycle call",
    canonicalization: "JSON.stringify(typed(corpus)) + newline",
    captureSha256Excludes: ["profile.captureSha256"],
  },
  install: {
    command: "npm ci --ignore-scripts --no-audit --no-fund",
    order: ["bind the repo read-only at /repo", "tmpfs /repo/node_modules", "npm ci", "node --import tsx /capture/capture.mts"],
  },
  sourceClosure: "static import/export + dynamic-import graph from the entry list below, TypeScript files only",
  entrySources: ENTRY_SOURCES,
  sourceFileCount: Object.keys(sourceFileHashes).length,
  sourceFiles: sourceFileHashes,
  styleFileCount: Object.keys(styleFileHashes).length,
  styleFiles: styleFileHashes,
  externalImports: Array.from(externalImports).sort(),
  externalVersions,
  externalVersionsNote: "external package contents are not part of this hash graph; they are pinned by package-lock.json and the installed version recorded here",
  manifests,
  tool: toolHashes,
  declared: {
    map: setup.map,
    config: setup.config,
    modules: setup.modules,
    seats: setup.seats,
    owner: setup.owner,
    target: setup.target,
    rng: setup.rng,
    clocks: setup.clocks,
    constants: {
      TICK_MS, TARGET_RANGE, PLAYER_RADIUS, MOB_KILL_STACKS,
      targetReward: plain(reward),
      attackSpeedPerStack: reward.effect.v,
      expectedAttackSpeedFromOneKill: reward.effect.v * MOB_KILL_STACKS,
      asMultWireIdentity: 1000,
      asMultDecodedIdentity: 1,
    },
  },
};

const corpus = {
  format: FORMAT,
  note: "one actual ordinary player kill of a real catalog nonelite plagueRat on a real generated camp-bearing map (config.mobs, nontraining, complete createGameWorld order). Initial/pre-kill/kill/post-kill completed-step frames; host owner group, retained @colyseus/schema encodeAll then per-step patch decode, full-group snapshot encode/decode, the original perceive on both states, source clocks/held state, all three mirrors, actual mob/camp/slot/death and the real grantMobStat toast.",
  provenance: "actual-producer ordinary inputs on the actual generated source map; declared setup only for seed/config/seats/positions/loadout",
  setup,
  target: targetInitial,
  frames,
  kill,
  actions: tape.actions,
  observers: tape.observers,
  transitions: transitionsOut,
  sourceChecks,
  windows: {
    initialFrameIndex: 0, initialStep: frames[0].step,
    preKillFrameIndex, preKillStep: preKillFrame.step,
    killFrameIndex, killStep: killFrame.step,
    postKillFrameIndex, postKillStep: postKillFrame.step,
    lastFrameIndex: frames.length - 1, lastStep: finalFrame.step, frameCount: frames.length,
  },
  limits: [
    "source and owner-projection proof only: no native/Rust parity, no Unity/DOM/rendering/GPU, no socket/Room/join/reconnect, no protocol or public-field admission",
    "one kill on one generated map seed/attempt; this is not a whole-map, workspace, previous-owner or quest campaign",
    "declared setup: map seed, config, seat ids/factions, owner/ally start positions, and the ground rack/loadout; every NPC stat, roster, death, farm gain, build, mirror and RNG outcome is actual source output",
    "the retained client decode is the real full encodeAll at the first recorded step plus the real per-step patch decoded into one retained RaidState; it is not a delta-stream benchmark",
    "perceive runs inside Node with the original server and decoded state; no client rendering or DOM lifecycle is exercised",
    "the optional second move-speed farm case was not attempted; the required attack-speed case is complete",
  ],
  profile: PROFILE,
};

function finalize(c) {
  const unsigned = typed(c);
  c.profile.captureSha256 = sha256(JSON.stringify(unsigned));
  return JSON.stringify(typed(c)) + "\n";
}
const corpusText = finalize(corpus);

if (mode === "--write") {
  writeFileSync(join(outDir, OUTPUT), corpusText);
  console.log("captured " + OUTPUT + " bytes=" + Buffer.byteLength(corpusText) + " sha256=" + sha256(Buffer.from(corpusText)));
} else {
  const expected = readFileSync(join(outDir, OUTPUT), "utf8");
  if (expected !== corpusText) {
    console.log("MISMATCH " + OUTPUT + " expectedSha=" + sha256(Buffer.from(expected)) + " recapturedSha=" + sha256(Buffer.from(corpusText)));
    process.exitCode = 1;
  } else {
    console.log("checked " + OUTPUT + " byte for byte sha256=" + sha256(Buffer.from(corpusText)));
  }
}
console.log("kill step=" + kill.step + " frame=" + kill.frameIndex + " t=" + kill.serverTime + " target=" + targetId + " (" + TARGET_TYPE + " camp=" + CAMP_REF + " slot=" + TARGET_SLOT + ")");
console.log("mirrors before=" + JSON.stringify(kill.before.mirrors.host) + " after=" + JSON.stringify(kill.at.mirrors.host));
console.log("mobStats before=" + JSON.stringify(kill.before.mobStats) + " after=" + JSON.stringify(kill.at.mobStats));
console.log("expected wire=" + JSON.stringify(kill.expected.mirrors) + " frames=" + frames.length + " sourceChecks=" + (Object.values(sourceChecks).every((v) => v === true) ? "PASS" : "FAIL"));
if (mode === "--check" && process.exitCode) process.exit(1);
