// The fairness kit (docs/BOTS.md 3.7): seeded scenarios (a run of frames around one bot), perturbations that change only
// what a human at that seat cannot see, and the checks that an output did not move. perception.test.ts and
// fairness.test.ts run the kit through perception + frames. At integration the same scenarios and perturbations go through
// the whole brain (`assertBlind(run, ...)` with a `run` that returns the commands), so a leak anywhere downstream fails the
// same way. Plain states here satisfy perception's StateLike; toSchemaState builds the real schema objects from one.
import {
  CHEST_PANEL_SLACK, CHEST_RANGE, CHEST_SECONDS, FACTION_IDS, hasLineOfSight, INTERACT_RANGE, isWeaponId, mulberry32, packFx, SKILL_IDS, WEAPON_IDS,
  type FxBatch, type FxEvent, type GameMap, type ProjectileLaunch, type Rng, type Vec2, type WeaponId,
} from "@raid/shared";
import { CampState, ContainerState, ItemState, MobState, PlayerState, RaidState } from "@raid/shared/schema";
import { createBrain } from "../../src/bots/brain/brain";
import { createFrameRing } from "../../src/bots/brain/frames";
import { enabledModules } from "../../src/bots/brain/modules";
import { perceive, type PerceptionInput } from "../../src/bots/brain/perception";
import { createBotRunner } from "../../src/bots/brain/runner";
import { createPathBudget, createPathService } from "../../src/bots/brain/services";
import {
  BOT_VIEW, FRAME_MARGIN, MINIMAP_QUANT, PERSONAS, TIERS,
  type Brain, type BrainFactory, type ComposeConfig, type Features, type FeatureModule, type Goal, type MemoryView, type MinimapView,
  type Percept, type PersonaId, type TierId, type TimedCommand,
} from "../../src/bots/brain/types";
import { CORE_MESSAGES, features as featureSet, NO_LEARNING, testMap } from "./fixtures";

// ============================================================================================================ plain states

export interface PlainPlayer {
  name: string; look: number; bot: boolean; x: number; y: number; facing: number; hp: number; maxHp: number; status: string;
  faction: string; weapon0: string; weapon1: string; slot: number; moveSeq: number; attackTarget: string; drawStartedAt: number;
  readyAt: number; kills: number; gv: number; bounty: number; immuneUntil: number; sig: number; brand: number; mobKills: number;
  /** Buff stacks by mob type (the build strip): only the bot's own are ever read. */
  buffs: Map<string, number>;
  /** The stat mirrors in their wire form: multipliers are uint16 thousandths (1000 = x1), flats int16 tenths. */
  asMult: number; windupMult: number; speedMult: number; armorBonus: number;
  shieldBonus: number; barrier: number;
  /** Wishes' EFFECT_* bits: only set when a test plays a branch with status effects. */
  effects?: number;
}

export interface PlainMob {
  kind: string; name: string; x: number; y: number; facing: number; hp: number; maxHp: number; status: string; faction: string;
  weapon0: string; weapon1: string; slot: number; drawStartedAt: number; readyAt: number; sig: number; brand: number; effects?: number;
}

export interface PlainItem { uid: string; def: string }
export interface PlainContainer {
  id: string; kind: string; x: number; y: number; label: string; items: PlainItem[];
  /** A camp's reward chest (kind "reward"): when it vanishes, its cards, who took each ("" free) and who has picked. */
  camp?: number; expiresAt?: number; options?: string[]; takenBy?: string[]; pickers?: string[];
}
export interface PlainCamp { type: string; reward: string; alive: number; state: number }

export interface PlainState {
  phase: string; seed: number; serverTime: number; tick: number; lobbyEndsAt: number; raidStartedAt: number; minPlayers: number;
  startedWith: number; patienceEndsAt: number; inColiseum: boolean; gatesLocked: boolean; suddenDeathAt: number; winner: string;
  training: boolean;
  players: Map<string, PlainPlayer>;
  mobs: Map<string, PlainMob>;
  containers: Map<string, PlainContainer>;
  roster: string[];
  /** RaidState.camps, one per map camp. */
  camps?: PlainCamp[];
}

export function plainPlayer(over: Partial<PlainPlayer> = {}): PlainPlayer {
  return {
    name: "P", look: 0, bot: false, x: 0, y: 0, facing: 0, hp: 500, maxHp: 500, status: "alive", faction: "fire", weapon0: "axe",
    weapon1: "", slot: 0, moveSeq: 0, attackTarget: "", drawStartedAt: 0, readyAt: 0, kills: 0, gv: 0, bounty: 0, immuneUntil: 0, sig: 0,
    brand: 0, mobKills: 0, buffs: new Map(), asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0,
    barrier: 0, ...over,
  };
}

export function plainMob(over: Partial<PlainMob> = {}): PlainMob {
  return {
    kind: "mob", name: "Mob", x: 0, y: 0, facing: 0, hp: 200, maxHp: 200, status: "alive", faction: "fire", weapon0: "axe", weapon1: "",
    slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, ...over,
  };
}

export function plainContainer(over: Partial<PlainContainer> & { id: string }): PlainContainer {
  return { kind: "chest", x: 0, y: 0, label: "", items: [], ...over };
}

export function plainState(over: Partial<PlainState> = {}): PlainState {
  return {
    phase: "active", seed: 7, serverTime: 100_000, tick: 2000, lobbyEndsAt: 0, raidStartedAt: 60_000, minPlayers: 2, startedWith: 6,
    patienceEndsAt: 400_000, inColiseum: false, gatesLocked: false, suddenDeathAt: 0, winner: "", training: false,
    players: new Map(), mobs: new Map(), containers: new Map(), roster: [], ...over,
  };
}

/** The same state as real schema objects (what the server holds): for the encoder round trip and detectFeatures. */
export function toSchemaState(p: PlainState): RaidState {
  const s = new RaidState();
  s.phase = p.phase;
  s.seed = p.seed;
  s.serverTime = p.serverTime;
  s.tick = p.tick;
  s.lobbyEndsAt = p.lobbyEndsAt;
  s.raidStartedAt = p.raidStartedAt;
  s.minPlayers = p.minPlayers;
  s.startedWith = p.startedWith;
  s.patienceEndsAt = p.patienceEndsAt;
  s.inColiseum = p.inColiseum;
  s.gatesLocked = p.gatesLocked;
  s.suddenDeathAt = p.suddenDeathAt;
  s.winner = p.winner;
  s.training = p.training;
  for (const [id, src] of p.players) {
    const { effects: _effects, buffs, ...fields } = src;
    const ps = new PlayerState();
    Object.assign(ps, fields);
    for (const [buff, stacks] of buffs) ps.buffs.set(buff, stacks);
    s.players.set(id, ps);
  }
  for (const [id, src] of p.mobs) {
    const { effects: _effects, ...fields } = src;
    const ms = new MobState();
    Object.assign(ms, fields);
    s.mobs.set(id, ms);
  }
  for (const [id, src] of p.containers) {
    const cs = new ContainerState();
    cs.id = src.id;
    cs.kind = src.kind;
    cs.x = src.x;
    cs.y = src.y;
    cs.label = src.label;
    cs.camp = src.camp ?? 0;
    cs.expiresAt = src.expiresAt ?? 0;
    for (const o of src.options ?? []) cs.options.push(o);
    for (const o of src.takenBy ?? []) cs.takenBy.push(o);
    for (const o of src.pickers ?? []) cs.pickers.push(o);
    for (const it of src.items) {
      const item = new ItemState();
      item.uid = it.uid;
      item.def = it.def;
      cs.items.push(item);
    }
    s.containers.set(id, cs);
  }
  for (const id of p.roster) s.roster.push(id);
  for (const src of p.camps ?? []) {
    const cs = new CampState();
    Object.assign(cs, src);
    s.camps.push(cs);
  }
  return s;
}

// =============================================================================================================== scenarios

export const T0 = 100_000;
export const FRAME_MS = 50;
/** The in-process driver's delays (BotFillConfig latency 30, INTERP_DELAY_MS 100). */
export const IN_PROCESS = { selfDelayMs: 30, worldDelayMs: 130 } as const;

export interface ScenarioFrame {
  state: PlainState;
  /** This frame's fx, packed per frame into one batch against the state's roster. */
  events: FxEvent[];
  launches: ProjectileLaunch[];
  toasts: string[];
}

/** Who is what, for the perturbations: ids by role. "far" is off the frame's box (window + margin + slack) in every frame. */
export interface ScenarioRoles {
  onscreenPlayers: string[];
  onscreenMobs: string[];
  farPlayers: string[];
  farMobs: string[];
  /** Inside the margin band beyond the window's right edge in every frame: in Frames, never in a Percept. */
  ringPlayers: string[];
  ringMobs: string[];
  hidden: string[];
  farContainers: string[];
  /** On screen, out of interact range all along. */
  shutChests: string[];
  /** Reward chests (R5) out of pick range all along, one on screen and one far: their cards are shut to the bot. */
  rewardChests?: string[];
  /** Players named by an announcement (a death, a bounty) somewhere in the run. */
  announced: string[];
}

export interface Scenario {
  seed: number;
  map: GameMap;
  selfId: string;
  features: Features;
  frames: ScenarioFrame[];
  roles: ScenarioRoles;
}

export interface ScenarioOptions {
  frames?: number;
  /** Play a Wishes-like branch: `effects` on fighters, a hidden and an untargetable player. Default: every other seed. */
  statusEffects?: boolean;
  /** No off-screen deaths or bounties (the never-seen check). */
  quiet?: boolean;
}

const SLACK = 60;
/** How far (u) a long scenario lets the bot wander from its start, and an on-screen fighter from its own. */
const WANDER = 120;
const DRIFT = 60;
const HALF_W = BOT_VIEW.halfW;
const HALF_H = BOT_VIEW.halfH;

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
const chance = (rng: Rng, p: number): boolean => rng() < p;

function farFrom(selves: readonly Vec2[], p: Vec2, slack = SLACK): boolean {
  return selves.every((s) => Math.abs(p.x - s.x) > HALF_W + FRAME_MARGIN + slack || Math.abs(p.y - s.y) > HALF_H + FRAME_MARGIN + slack);
}

/** A point off every listed self's frame box (with `slack` more), inside the map when there is room. */
export function farPoint(rng: Rng, map: GameMap, selves: readonly Vec2[], slack = SLACK): Vec2 {
  const w = map.w * 32, h = map.h * 32;
  for (let i = 0; i < 400; i++) {
    const p = { x: Math.round(range(rng, 0, w) * 10) / 10, y: Math.round(range(rng, 0, h) * 10) / 10 };
    if (farFrom(selves, p, slack)) return p;
  }
  return { x: -4000 - Math.round(rng() * 1000), y: -4000 - Math.round(rng() * 1000) };
}

/** A point in the margin band right of the window around `self` (never in the window from any self within 20 u). */
function ringPoint(rng: Rng, self: Vec2): Vec2 {
  return { x: self.x + HALF_W + 30 + Math.round(rng() * 25), y: self.y + Math.round(range(rng, -(HALF_H - 120), HALF_H - 120)) };
}

const randomWeapon = (rng: Rng): WeaponId => pick(rng, WEAPON_IDS);

/** Three buffs held at random stacks (up to `max`): what a player's build strip shows, and nothing a bot may read of another. */
function randomBuffs(rng: Rng, max: number): Map<string, number> {
  return new Map([["emberImp", range(rng, 0, max)], ["plagueRat", range(rng, 0, max)], ["cinderHound", range(rng, 0, max)]]);
}

function randomPlayer(rng: Rng, name: string, at: Vec2, t: number): PlainPlayer {
  const maxHp = Math.round(range(rng, 380, 720));
  const slot = chance(rng, 0.3) ? 1 : 0;
  return plainPlayer({
    name, x: at.x, y: at.y, facing: range(rng, -3, 3), hp: Math.max(1, maxHp * range(rng, 0.05, 1)), maxHp,
    faction: pick(rng, FACTION_IDS), weapon0: randomWeapon(rng), weapon1: chance(rng, 0.6) ? randomWeapon(rng) : "", slot,
    moveSeq: Math.floor(rng() * 256), attackTarget: chance(rng, 0.4) ? "me" : "", drawStartedAt: chance(rng, 0.3) ? t - 120 : 0,
    readyAt: t + Math.round(range(rng, -300, 900)), kills: Math.floor(rng() * 4), gv: Math.floor(rng() * 90),
    bounty: chance(rng, 0.25) ? 10 * Math.floor(1 + rng() * 4) : 0, immuneUntil: chance(rng, 0.2) ? t + 800 : 0,
    sig: Math.floor(rng() * 16), brand: 5 * Math.floor(rng() * 6), mobKills: Math.floor(rng() * 9),
    buffs: randomBuffs(rng, 4), asMult: Math.round(range(rng, 1000, 1400)), speedMult: Math.round(range(rng, 1000, 1300)),
    barrier: chance(rng, 0.2) ? range(rng, 10, 120) : 0, look: Math.floor(rng() * 1e6), bot: chance(rng, 0.5),
  });
}

function randomMob(rng: Rng, name: string, at: Vec2, elite: boolean): PlainMob {
  const maxHp = elite ? 900 : Math.round(range(rng, 150, 400));
  return plainMob({
    kind: elite ? "elite" : "mob", name, x: at.x, y: at.y, facing: range(rng, -3, 3), hp: Math.max(1, maxHp * range(rng, 0.2, 1)), maxHp,
    faction: pick(rng, FACTION_IDS), weapon0: randomWeapon(rng), weapon1: chance(rng, 0.3) ? randomWeapon(rng) : "", slot: 0,
    drawStartedAt: 0, readyAt: Math.round(range(rng, 0, 200_000)), sig: Math.floor(rng() * 16), brand: 0,
  });
}

/** One bot's view of a few hundred ms of an active run, from `seed`: the same seed, the same scenario. */
export function buildScenario(seed: number, opts: ScenarioOptions = {}): Scenario {
  const rng = mulberry32(seed * 7919 + 13);
  const map = testMap();
  const n = opts.frames ?? 10;
  const statusEffects = opts.statusEffects ?? seed % 2 === 1;
  const spawns = map.spawns;
  const start = spawns[seed % spawns.length]!;
  // The bot walks a little each frame (up to 8 u: about PLAYER_SPEED over a tick), or stands.
  const pace = pick(rng, [0, 4, 8]);
  const selves: Vec2[] = [{ x: start.x, y: start.y }];
  let heading = range(rng, -Math.PI, Math.PI);
  for (let k = 1; k < n; k++) {
    heading += range(rng, -0.6, 0.6);
    const prev = selves[k - 1]!;
    // A long scenario keeps the bot near its start (turning home past WANDER), so the roles hold all along.
    if (Math.hypot(prev.x - start.x, prev.y - start.y) > WANDER) heading = Math.atan2(start.y - prev.y, start.x - prev.x);
    selves.push({ x: Math.round((prev.x + Math.cos(heading) * pace) * 4) / 4, y: Math.round((prev.y + Math.sin(heading) * pace) * 4) / 4 });
  }
  const t = (k: number) => T0 + k * FRAME_MS;
  // On screen all along: within the window less what both the bot and the fighter can walk.
  const onscreen = (): Vec2 => ({
    x: Math.round(start.x + range(rng, -(HALF_W - 220), HALF_W - 220)), y: Math.round(start.y + range(rng, -(HALF_H - 200), HALF_H - 200)),
  });

  const roles: ScenarioRoles = {
    onscreenPlayers: ["p1", "p2", "p3"], onscreenMobs: ["m1", "m2"], farPlayers: ["f1", "f2", "f3"], farMobs: ["fm1", "fm2", "fm3", "fe1"],
    ringPlayers: ["r1"], ringMobs: ["rm1"], hidden: statusEffects ? ["h1"] : [], farContainers: ["fc1", "fc2", "fc3"],
    shutChests: ["c1", "c3"], rewardChests: ["rc1", "rc2"], announced: [],
  };
  const playerIds = ["me", ...roles.onscreenPlayers, ...roles.farPlayers, ...roles.ringPlayers, ...roles.hidden, ...(statusEffects ? ["u1"] : [])];
  const mobIds = [...roles.onscreenMobs, ...roles.farMobs, ...roles.ringMobs];

  // Fixed per-fighter data; positions move per frame.
  const tracks = new Map<string, Vec2[]>();
  const walk = (from: Vec2): Vec2[] => {
    const out = [from];
    const near = (v: number, o: number) => Math.min(o + DRIFT, Math.max(o - DRIFT, v));
    for (let k = 1; k < n; k++) {
      const p = out[k - 1]!;
      out.push({
        x: near(Math.round((p.x + range(rng, -6, 6)) * 4) / 4, from.x), y: near(Math.round((p.y + range(rng, -6, 6)) * 4) / 4, from.y),
      });
    }
    return out;
  };
  for (const id of [...roles.onscreenPlayers, ...roles.onscreenMobs, ...roles.hidden, ...(statusEffects ? ["u1"] : [])]) {
    tracks.set(id, walk(onscreen()));
  }
  for (const id of [...roles.farPlayers, ...roles.farMobs]) {
    const p = farPoint(rng, map, selves, SLACK + 40);
    tracks.set(id, Array.from({ length: n }, () => p));
  }
  for (const id of [...roles.ringPlayers, ...roles.ringMobs]) {
    tracks.set(id, selves.map((s) => ringPoint(rng, s)));
  }

  const base = new Map<string, PlainPlayer>();
  for (const id of playerIds) {
    if (id === "me") continue;
    base.set(id, randomPlayer(rng, `${id.toUpperCase()}_${seed}`, tracks.get(id)![0]!, T0));
  }
  const me = plainPlayer({
    name: `Self_${seed}`, x: start.x, y: start.y, faction: pick(rng, FACTION_IDS), weapon0: randomWeapon(rng), weapon1: randomWeapon(rng),
    hp: 420, maxHp: 500, buffs: new Map([["emberImp", 1.25], ["plagueRat", 0.5]]), kills: 1, gv: 12, asMult: 1100, readyAt: T0 + 300, attackTarget: "p1", bot: true,
  });
  if (statusEffects) {
    base.get("h1")!.effects = 256;
    base.get("u1")!.effects = 128;
    for (const id of playerIds) if (id !== "h1" && id !== "u1" && id !== "me") base.get(id)!.effects = chance(rng, 0.3) ? 8 : 0;
    me.effects = 0;
  }
  const mobBase = new Map<string, PlainMob>();
  for (const id of mobIds) mobBase.set(id, randomMob(rng, `Mob_${id}_${seed}`, tracks.get(id)![0]!, id === "fe1"));
  if (statusEffects) for (const m of mobBase.values()) m.effects = chance(rng, 0.3) ? 16 : 0;

  // Containers: on screen a shut chest, an open one, a loose weapon, a body; maybe a chest in reach; three far away.
  const containers: PlainContainer[] = [
    plainContainer({ id: "c1", kind: "chest", ...onscreenFar(rng, start, selves), items: [{ uid: "i1", def: randomWeapon(rng) }] }),
    plainContainer({ id: "c2", kind: "chest", ...onscreenFar(rng, start, selves), items: [] }),
    plainContainer({ id: "c3", kind: "body", label: `Fallen_${seed}`, ...onscreenFar(rng, start, selves), items: [{ uid: "i3", def: randomWeapon(rng) }] }),
    plainContainer({ id: "g1", kind: "ground", ...onscreenFar(rng, start, selves), items: [{ uid: "i4", def: randomWeapon(rng) }] }),
  ];
  const reachSpot = inReach(map, selves);
  if (reachSpot) containers.push(plainContainer({ id: "c4", kind: "chest", ...reachSpot, items: [{ uid: "i5", def: randomWeapon(rng) }] }));
  for (const id of roles.farContainers) {
    const p = farPoint(rng, map, selves, SLACK + 40);
    containers.push(plainContainer({ id, kind: pick(rng, ["chest", "body", "ground"]), x: p.x, y: p.y, label: `Far_${id}`, items: [{ uid: `u_${id}`, def: randomWeapon(rng) }] }));
  }

  // Reward chests (R5): the minimap shows every one wherever it stands, so their places and expiry are public; their cards show only
  // within pick range and in sight. Two out of range all along (one on screen, one far) for the perturbations; one in reach of every
  // self (if the walls allow a spot) for the brain to pick at. A stream of their own, so the scenario above is the one it always was.
  const crng = mulberry32(seed * 104729 + 7);
  const cards = (): string[] => Array.from({ length: 3 }, () => pick(crng, SKILL_IDS));
  const reward = (id: string, at: Vec2): PlainContainer =>
    plainContainer({
      id, kind: "reward", x: at.x, y: at.y, camp: 1 + Math.floor(crng() * 5), expiresAt: T0 + CHEST_SECONDS * 1000 + 40_000,
      options: cards(), takenBy: ["", "", ""], pickers: [],
    });
  containers.push(reward("rc1", onscreenFar(crng, start, selves, CHEST_RANGE + WANDER + 20)));
  containers.push(reward("rc2", farPoint(crng, map, selves, SLACK + 40)));
  const pickSpot = inReach(map, selves, CHEST_RANGE - CHEST_PANEL_SLACK - 8);
  if (pickSpot) containers.push({ ...reward("rc3", pickSpot), expiresAt: T0 + 60_000 });

  // Off-screen news: a far player dies (announced by name), a far player's bounty rises.
  const deathFrame = opts.quiet ? -1 : 3 + Math.floor(rng() * Math.max(4, Math.floor(n * 0.4)));
  const bountyFrame = opts.quiet ? -1 : 2 + Math.floor(rng() * Math.max(6, Math.floor(n * 0.6)));
  const mobDeathFrame = Math.max(6, Math.floor(n / 2));
  if (!opts.quiet) roles.announced.push("f2", "f1");

  const frames: ScenarioFrame[] = [];
  let projSeq = 0;
  const flying: Array<{ id: string; from: string; endsAt: number }> = [];
  for (let k = 0; k < n; k++) {
    const state = plainState({ serverTime: t(k), tick: 2000 + k, seed: map.seed, camps: map.camps.map((c, i) => ({ type: "emberImp", reward: "", alive: 2 + (i % 3), state: i % 3 })) });
    // The bot's own HUD changes too: a lock it holds now and then, a cooldown that runs, and hp that drains (so it flees).
    const life = n > 1 ? k / (n - 1) : 0;
    state.players.set("me", {
      ...me, x: selves[k]!.x, y: selves[k]!.y, attackTarget: ["", "p1", "", "m1"][Math.floor(k / 40) % 4]!,
      readyAt: t(k) + ((k * 7) % 12) * 50, hp: Math.round(me.hp - (me.hp - 60) * life),
    });
    for (const id of playerIds) {
      if (id === "me") continue;
      const p = { ...base.get(id)!, ...tracks.get(id)![k]! };
      if (id === "f2" && deathFrame >= 0 && k >= deathFrame) { p.status = "dead"; p.hp = 0; }
      if (id === "f1" && bountyFrame >= 0 && k >= bountyFrame) p.bounty = 10;
      state.players.set(id, p);
    }
    for (const id of mobIds) {
      const m = { ...mobBase.get(id)!, ...tracks.get(id)![k]! };
      if (id === "m2" && k >= mobDeathFrame) { m.status = "dead"; m.hp = 0; }
      state.mobs.set(id, m);
    }
    for (const c of containers) state.containers.set(c.id, structuredClone(c));
    state.roster = [...playerIds, ...mobIds];

    const events: FxEvent[] = [];
    const launches: ProjectileLaunch[] = [];
    const toasts: string[] = [];
    const at = (id: string) => (id === "me" ? selves[k]! : tracks.get(id)![k]!);
    if (chance(rng, 0.5)) events.push({ kind: "windup", by: "p1", weapon: "axe", a: Math.round(range(rng, -3, 3) * 100) / 100, ms: 250 });
    if (chance(rng, 0.4)) events.push({ kind: "swing", by: "p2", weapon: "sword", x: at("p2").x, y: at("p2").y, a: 1.2 });
    if (chance(rng, 0.6)) events.push({ kind: "hit", id: "p2", by: "p1", amount: Math.round(range(rng, 1, 80) * 10) / 10, weapon: "axe" });
    if (chance(rng, 0.4)) events.push({ kind: "hit", id: "me", by: "f1", amount: 23.4, weapon: "bow" });
    if (chance(rng, 0.4)) events.push({ kind: "hit", id: "me", by: "p3", amount: 12.5, weapon: "sword" });
    if (chance(rng, 0.3)) events.push({ kind: "hit", id: "p3", by: "p2", amount: 4.2, weapon: null, sig: "burn" });
    if (chance(rng, 0.2)) events.push({ kind: "block", id: "p3", by: "f3", weapon: "bow" });
    if (chance(rng, 0.3)) events.push({ kind: "heal", id: "p2", amount: pick(rng, [0.4, 6.3]) });
    if (chance(rng, 0.2)) events.push({ kind: "buff", id: "p1", buff: "plagueRat", stacks: 0.734, total: 2.41 });
    if (chance(rng, 0.2)) events.push({ kind: "buff", id: "me", buff: "emberImp", stacks: 0.5, total: 1.75 });
    if (chance(rng, 0.15)) events.push({ kind: "stagger", id: "m1" });
    if (chance(rng, 0.15)) events.push({ kind: "cancel", id: "p1" });
    if (statusEffects && chance(rng, 0.5)) events.push({ kind: "windup", by: "h1", weapon: "wand", a: 0.5, ms: 400 });
    if (k === deathFrame) {
      const p = at("f2");
      events.push({ kind: "death", id: "f2", x: p.x, y: p.y, by: "f3" });
    }
    if (k === bountyFrame) events.push({ kind: "bounty", id: "f1", name: base.get("f1")!.name, bounty: 10 });
    if (k === mobDeathFrame) events.push({ kind: "death", id: "m2", x: at("m2").x, y: at("m2").y, by: "p1" });
    if (k === 4 && chance(rng, 0.5)) toasts.push("Too far away");
    // An arrow from p1 at the bot every few frames; each one ends two frames later.
    if (k % 3 === 0) {
      const from = at("p1"), to = selves[k]!;
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const id = `a${seed}_${++projSeq}`;
      launches.push({ id, kind: "arrow", x: from.x, y: from.y, vx: ((to.x - from.x) / len) * 900, vy: ((to.y - from.y) / len) * 900, t: t(k), range: 240 });
      flying.push({ id, from: "p1", endsAt: k + 2 });
    }
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i]!;
      if (f.endsAt !== k) continue;
      const end = at("p1");
      events.push({ kind: "projEnd", id: f.id, proj: "arrow", x0: end.x, y0: end.y, t0: t(k), x: end.x + 100, y: end.y, reason: "range" });
      flying.splice(i, 1);
    }
    frames.push({ state, events, launches, toasts });
  }
  const features = featureSet({ statusEffects, chests: true, camps: true, messageTypes: [...CORE_MESSAGES, "choose"] });
  return { seed, map, selfId: "me", features, frames, roles };
}

/** A spot on screen in every frame and farther than `min` (default: out of interact range) from every self. */
function onscreenFar(rng: Rng, start: Vec2, selves: readonly Vec2[], min = INTERACT_RANGE + 30): { x: number; y: number } {
  for (;;) {
    const p = { x: Math.round(start.x + range(rng, -(HALF_W - 150), HALF_W - 150)), y: Math.round(start.y + range(rng, -(HALF_H - 150), HALF_H - 150)) };
    if (selves.every((s) => Math.hypot(p.x - s.x, p.y - s.y) > min)) return p;
  }
}

/** A spot within `reach` (default: interact range) and sight of every self (near the middle of its walk), if the walls allow one. */
function inReach(map: GameMap, selves: readonly Vec2[], reach = INTERACT_RANGE): Vec2 | null {
  const cx = selves.reduce((a, s) => a + s.x, 0) / selves.length, cy = selves.reduce((a, s) => a + s.y, 0) / selves.length;
  for (const r of [0, 8, 16]) {
    for (let a = 0; a < 16; a++) {
      const p = { x: Math.round(cx + Math.cos((a / 16) * 2 * Math.PI) * r), y: Math.round(cy + Math.sin((a / 16) * 2 * Math.PI) * r) };
      if (selves.every((s) => Math.hypot(p.x - s.x, p.y - s.y) <= reach - 4 && hasLineOfSight(map, s, p))) return p;
    }
  }
  return null;
}

/** The driver inputs of a scenario, one per frame: fx packed (ids by roster index) exactly as the Room sends them. */
export function scenarioInputs(s: Scenario): PerceptionInput[] {
  const announced = new Set<string>();
  return s.frames.map((f) => {
    const roster = new Map(f.state.roster.map((id, i) => [id, i] as const));
    const fxs: FxBatch[] = [];
    if (f.events.length > 0 || f.launches.length > 0) {
      fxs.push(packFx(f.events, f.state.serverTime, { roster, launches: f.launches, announced }));
    }
    for (const l of f.launches) announced.add(l.id);
    return { state: f.state, fxs, toasts: f.toasts };
  });
}

export interface PipelineOptions extends Partial<Pick<ComposeConfig, "selfDelayMs" | "worldDelayMs" | "attentionCentral">> {
  /** Map each input before perception (the parity test swaps in a decoded state). */
  mapInput?: (input: PerceptionInput, index: number) => PerceptionInput;
}

/** perception + frames over a scenario: every Percept composed, in order (none until the ring covers the delay). */
export function runPerception(s: Scenario, opts: PipelineOptions = {}): Percept[] {
  const ring = createFrameRing();
  const cfg: ComposeConfig = {
    selfDelayMs: opts.selfDelayMs ?? IN_PROCESS.selfDelayMs, worldDelayMs: opts.worldDelayMs ?? IN_PROCESS.worldDelayMs, map: s.map,
    features: s.features, attentionCentral: opts.attentionCentral ?? 0.65,
  };
  let lastMinimap: MinimapView | null = null;
  const out: Percept[] = [];
  scenarioInputs(s).forEach((raw, i) => {
    const input = opts.mapInput ? opts.mapInput(raw, i) : raw;
    const frame = perceive(input, { selfId: s.selfId, map: s.map, features: s.features, lastMinimap });
    lastMinimap = frame.minimap;
    ring.push(frame);
    const p = ring.compose(cfg);
    if (p) out.push(p);
  });
  return out;
}

// =========================================================================================================== perturbations

export interface Perturbation {
  readonly name: string;
  /** It flips what the [BOT] tag shows: compare with every `bot` field left out (the brain must not read it either). */
  readonly tagOnly?: boolean;
  /** Mutates `s` (already a private copy) in hidden information only. */
  apply(s: Scenario, rng: Rng): void;
}

/** A deep copy of everything but the map (read-only and shared). */
export function cloneScenario(s: Scenario): Scenario {
  const { map, ...rest } = s;
  return { ...structuredClone(rest), map };
}

export function perturbed(s: Scenario, p: Perturbation, salt = 0): Scenario {
  const copy = cloneScenario(s);
  let h = 2166136261;
  for (const ch of p.name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  p.apply(copy, mulberry32((h ^ (s.seed * 31 + salt)) >>> 0));
  return copy;
}

const selvesOf = (s: Scenario): Vec2[] => s.frames.map((f) => f.state.players.get(s.selfId)!);

/** Everything a player has that is not public (status: the HUD's Alive count; name: announcements and the winner line). */
function scramblePlayer(p: PlainPlayer, rng: Rng, opts: { keepEffects?: boolean } = {}): void {
  const fresh = randomPlayer(rng, p.name, { x: p.x, y: p.y }, T0 + Math.round(rng() * 1000));
  const { status, name, x, y, effects } = p;
  Object.assign(p, fresh, { status, name, x, y });
  if (opts.keepEffects) p.effects = effects;
  else if (effects !== undefined) p.effects = Math.floor(rng() * 4096);
}

/** A mob's hidden fields: all but where its minimap dot is, its kind, faction and status. */
function scrambleMob(m: PlainMob, rng: Rng): void {
  m.hp = Math.max(1, m.maxHp * range(rng, 0.01, 1));
  m.maxHp = m.maxHp + Math.round(range(rng, -50, 50));
  m.facing = range(rng, -3, 3);
  m.weapon0 = randomWeapon(rng);
  m.weapon1 = randomWeapon(rng);
  m.slot = chance(rng, 0.5) ? 1 : 0;
  m.drawStartedAt = Math.round(range(rng, 0, 200_000));
  m.readyAt = Math.round(range(rng, 0, 200_000));
  m.sig = Math.floor(rng() * 16);
  m.brand = 5 * Math.floor(rng() * 10);
  if (m.effects !== undefined) m.effects = Math.floor(rng() * 4096);
  // Off its minimap cell by less than half a cell: the dot does not move.
  const jitter = (v: number) => {
    const cell = Math.round(v / MINIMAP_QUANT) * MINIMAP_QUANT;
    return cell + range(rng, -0.45, 0.45) * MINIMAP_QUANT;
  };
  m.x = jitter(m.x);
  m.y = jitter(m.y);
}

function otherFarId(s: Scenario, rng: Rng, not: string): string {
  const others = s.roles.farPlayers.filter((id) => id !== not);
  return others.length > 0 ? pick(rng, others) : not;
}

/** Hidden-information-only changes (docs/BOTS.md 3.7). Each keeps the scenario's public facts. */
export const PERTURBATIONS: readonly Perturbation[] = [
  {
    name: "off-screen players: anything, anywhere off screen",
    apply(s, rng) {
      const selves = selvesOf(s);
      for (const [k, f] of s.frames.entries()) {
        for (const id of s.roles.farPlayers) {
          const p = f.state.players.get(id);
          if (!p) continue;
          scramblePlayer(p, rng);
          Object.assign(p, farPoint(rng, s.map, [selves[k]!]));
          if (id === "f2" && p.status === "dead") p.hp = 0;
        }
        // Who did it, and where, of what happened off screen: a death's place and killer, a far attacker's identity.
        for (const ev of f.events) {
          if (ev.kind === "death" && s.roles.farPlayers.includes(ev.id)) Object.assign(ev, farPoint(rng, s.map, [selves[k]!]), { by: otherFarId(s, rng, ev.id) });
          if ((ev.kind === "hit" || ev.kind === "block") && ev.by !== null && s.roles.farPlayers.includes(ev.by)) ev.by = otherFarId(s, rng, ev.by);
        }
      }
    },
  },
  {
    name: "on-screen players: the other slot, stacks, kills, gv, readyAt, lock, moveSeq, look, mirrors",
    apply(s, rng) {
      for (const f of s.frames) {
        for (const id of [...s.roles.onscreenPlayers, ...(s.roles.hidden.length > 0 ? ["u1"] : [])]) {
          const p = f.state.players.get(id)!;
          if (p.slot === 1) p.weapon0 = randomWeapon(rng); else p.weapon1 = chance(rng, 0.2) ? "" : randomWeapon(rng);
          p.buffs = randomBuffs(rng, 9);
          p.kills = Math.floor(rng() * 9); p.gv = Math.floor(rng() * 500); p.mobKills = Math.floor(rng() * 30);
          p.readyAt = Math.round(range(rng, 0, 300_000)); p.attackTarget = pick(rng, ["", "me", "p2", "m1", "f1"]);
          p.moveSeq = Math.floor(rng() * 256); p.look = Math.floor(rng() * 2 ** 31);
          p.asMult = Math.round(range(rng, 500, 2000)); p.windupMult = Math.round(range(rng, 500, 2000)); p.speedMult = Math.round(range(rng, 500, 2000));
          p.armorBonus = Math.round(range(rng, -50, 50)); p.shieldBonus = Math.round(range(rng, -50, 50));
        }
        for (const id of s.roles.onscreenMobs) {
          const m = f.state.mobs.get(id)!;
          m.readyAt = Math.round(range(rng, 0, 300_000));
          if (m.slot === 1) m.weapon0 = randomWeapon(rng); else m.weapon1 = randomWeapon(rng);
        }
      }
    },
  },
  {
    name: "off-screen containers: their items, labels, kinds and places",
    apply(s, rng) {
      const selves = selvesOf(s);
      const moved = new Map<string, Vec2>(s.roles.farContainers.map((id) => [id, farPoint(rng, s.map, selves)]));
      // Not "reward": the minimap draws every reward chest and its seconds, so that kind is public wherever it stands.
      const kinds = new Map<string, string>(s.roles.farContainers.map((id) => [id, pick(rng, ["chest", "body", "ground"])]));
      for (const f of s.frames) {
        for (const id of s.roles.farContainers) {
          const c = f.state.containers.get(id)!;
          Object.assign(c, moved.get(id)!, { kind: kinds.get(id)!, label: `L${Math.floor(rng() * 1e6)}` });
          c.items = Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({ uid: `x${i}`, def: pick(rng, [...WEAPON_IDS, "relic"]) }));
        }
      }
    },
  },
  {
    name: "chests and bodies out of reach: what they hold",
    apply(s, rng) {
      const held = (id: string) => s.frames[0]!.state.containers.get(id)!.items[0]?.def;
      const swaps = new Map<string, string>(s.roles.shutChests.map((id) => [id, pick(rng, WEAPON_IDS.filter((w) => w !== held(id)))]));
      for (const f of s.frames) {
        for (const id of s.roles.shutChests) {
          const c = f.state.containers.get(id)!;
          if (c.items.length > 0 && isWeaponId(c.items[0]!.def)) c.items[0]!.def = swaps.get(id)!;
        }
      }
    },
  },
  {
    name: "reward chests out of pick range: their cards, who took which, who picked, which camp",
    apply(s, rng) {
      const ids = s.roles.rewardChests ?? [];
      const who = ["", "p1", "p2", "f1", "f3"];
      const cards = new Map(ids.map((id) => [id, Array.from({ length: 3 }, () => pick(rng, SKILL_IDS))]));
      const taken = new Map(ids.map((id) => [id, Array.from({ length: 3 }, () => pick(rng, who))]));
      const pickers = new Map(ids.map((id) => [id, who.slice(1).filter(() => chance(rng, 0.5))]));
      const camp = new Map(ids.map((id) => [id, 1 + Math.floor(rng() * 5)]));
      for (const f of s.frames) {
        for (const id of ids) {
          const c = f.state.containers.get(id)!;
          c.options = cards.get(id)!;
          c.takenBy = taken.get(id)!;
          c.pickers = pickers.get(id)!;
          c.camp = camp.get(id)!;
        }
      }
    },
  },
  {
    name: "off-screen mobs: hp, weapons, timers, marks, names, and a jitter inside their minimap cell",
    apply(s, rng) {
      for (const f of s.frames) for (const id of s.roles.farMobs) scrambleMob(f.state.mobs.get(id)!, rng);
    },
  },
  {
    name: "fx off screen: blows, casts, heals, buffs, deaths, launches and stops nobody here can see",
    apply(s, rng) {
      const selves = selvesOf(s);
      const far = [...s.roles.farPlayers, ...s.roles.farMobs];
      for (const [k, f] of s.frames.entries()) {
        const subject = () => pick(rng, far);
        const extra: FxEvent[] = [
          { kind: "windup", by: subject(), weapon: randomWeapon(rng), a: 1, ms: 300 },
          { kind: "swing", by: subject(), weapon: "axe", x: 5, y: 5, a: 0.3 },
          { kind: "hit", id: subject(), by: pick(rng, [...far, "p1", "me"]), amount: 31, weapon: "bow" },
          { kind: "hit", id: subject(), by: null, amount: 3, weapon: null, sig: "disease" },
          { kind: "block", id: subject(), by: subject(), weapon: "sword" },
          { kind: "heal", id: subject(), amount: 9 },
          { kind: "buff", id: subject(), buff: "cinderHound", stacks: 1.1, total: 3.3 },
          { kind: "stagger", id: subject() },
          { kind: "cancel", id: subject() },
          { kind: "death", id: pick(rng, ["fm1", "fm2", "fm3"]), ...farPoint(rng, s.map, [selves[k]!]), by: subject() },
        ];
        // A projEnd whose whole flight is off screen (it never was announced, so it carries its start).
        const a = farPoint(rng, s.map, selves, SLACK + 300);
        extra.push({ kind: "projEnd", id: `ghost${k}`, proj: "ball", x0: a.x, y0: a.y, t0: f.state.serverTime - 20, x: a.x + 30, y: a.y, reason: "wall" });
        f.events.splice(Math.floor(rng() * (f.events.length + 1)), 0, ...extra.filter(() => chance(rng, 0.7)));
        const o = farPoint(rng, s.map, selves, SLACK + 300);
        const dir = range(rng, -Math.PI, Math.PI);
        f.launches.push({ id: `far${k}`, kind: "arrow", x: o.x, y: o.y, vx: Math.cos(dir) * 900, vy: Math.sin(dir) * 900, t: f.state.serverTime, range: 240 });
        for (const ev of f.events) {
          if ((ev.kind === "hit" || ev.kind === "block") && ev.by !== null && s.roles.farPlayers.includes(ev.by)) ev.by = otherFarId(s, rng, ev.by);
        }
      }
    },
  },
  {
    name: "hidden players: anything, anywhere, and what they do",
    apply(s, rng) {
      if (s.roles.hidden.length === 0) return;
      const w = s.map.w * 32, h = s.map.h * 32;
      for (const f of s.frames) {
        for (const id of s.roles.hidden) {
          const p = f.state.players.get(id)!;
          scramblePlayer(p, rng, { keepEffects: true });
          p.effects = 256 | (Math.floor(rng() * 16) << 9);
          p.x = Math.round(range(rng, 0, w));
          p.y = Math.round(range(rng, 0, h));
          f.events.push(
            { kind: "windup", by: id, weapon: "wand", a: range(rng, -3, 3), ms: 400 },
            { kind: "swing", by: id, weapon: "sword", x: p.x, y: p.y, a: 0 },
            { kind: "heal", id, amount: 12 },
          );
        }
        for (let i = f.events.length - 1; i >= 0; i--) {
          const ev = f.events[i]!;
          if (ev.kind === "windup" && s.roles.hidden.includes(ev.by) && chance(rng, 0.3)) f.events.splice(i, 1);
        }
      }
    },
  },
  {
    name: "fighters in the margin band: anything but status (frames hold them, percepts never do)",
    apply(s, rng) {
      const selves = selvesOf(s);
      for (const [k, f] of s.frames.entries()) {
        for (const id of s.roles.ringPlayers) {
          const p = f.state.players.get(id)!;
          scramblePlayer(p, rng);
          Object.assign(p, ringPoint(rng, selves[k]!));
        }
        for (const id of s.roles.ringMobs) scrambleMob(f.state.mobs.get(id)!, rng);
      }
    },
  },
  {
    name: "every [BOT] flag flipped",
    tagOnly: true,
    apply(s) {
      for (const f of s.frames) for (const p of f.state.players.values()) p.bot = !p.bot;
    },
  },
];

// ================================================================================================================= checks

/** JSON of `v`; with `noBotTag`, every `bot` field is left out (the [BOT] tag is drawn, but must change no decision). */
export function stableJson(v: unknown, noBotTag = false): string {
  return JSON.stringify(v, noBotTag ? (k, x) => (k === "bot" ? undefined : x) : undefined);
}

/** Where two JSON texts first differ, with some context. */
export function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `@${i}: ...${a.slice(Math.max(0, i - 120), i + 60)}... vs ...${b.slice(Math.max(0, i - 120), i + 60)}...`;
}

/**
 * Runs `run` (perception + frames today; the whole brain at integration) on the scenario and on a perturbed copy and throws
 * unless both outputs serialise to the same JSON. `baseline` reuses an output already computed for `base`.
 */
export function assertBlind(run: (s: Scenario) => unknown, base: Scenario, p: Perturbation, salt = 0, baseline?: unknown): void {
  const a = stableJson(baseline ?? run(base), p.tagOnly);
  const b = stableJson(run(perturbed(base, p, salt)), p.tagOnly);
  if (a !== b) throw new Error(`"${p.name}" changed what the bot sees (seed ${base.seed}) ${firstDiff(a, b)}`);
}

/** Records every place a watched id or name shows up in what a bot was given (strings and object keys, at any depth). */
export interface NeverSeenTracker {
  watch(...tokens: string[]): void;
  /** The bot legitimately learnt these (they came on screen, or were announced): no longer a leak from here on. */
  unwatch(...tokens: string[]): void;
  readonly watching: number;
  scan(label: string, value: unknown): void;
  readonly hits: readonly string[];
}

export function createNeverSeenTracker(): NeverSeenTracker {
  const tokens = new Set<string>();
  const hits: string[] = [];
  const visit = (v: unknown, path: string, depth: number): void => {
    if (depth > 32 || hits.length > 50) return;
    if (typeof v === "string") {
      if (tokens.has(v)) hits.push(`${path} = ${v}`);
      return;
    }
    if (v === null || typeof v !== "object") return;
    if (v instanceof Map) {
      for (const [k, x] of v) {
        if (typeof k === "string" && tokens.has(k)) hits.push(`${path} key ${k}`);
        visit(x, `${path}.${String(k)}`, depth + 1);
      }
      return;
    }
    if (v instanceof Set) {
      for (const x of v) visit(x, `${path}[]`, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (tokens.has(k)) hits.push(`${path} key ${k}`);
      visit(x, `${path}.${k}`, depth + 1);
    }
  };
  return {
    watch(...ts) { for (const t of ts) tokens.add(t); },
    unwatch(...ts) { for (const t of ts) tokens.delete(t); },
    get watching() { return tokens.size; },
    scan(label, value) { if (tokens.size > 0) visit(value, label, 0); },
    get hits() { return hits; },
  };
}

// ================================================================================================================ the brain

export interface BrainSpec {
  readonly tier: TierId;
  readonly persona: PersonaId;
  readonly seed: number;
}

/** What a whole brain did on one frame of a scenario: the commands it clicked (as sent), and the goal it held after. */
export interface BrainFrame {
  readonly sent: readonly TimedCommand[];
  readonly goal: Goal;
  /** The percept it decided on (null before the ring covered the delay). */
  readonly percept: Percept | null;
}

/**
 * The real brain over a scenario, the way BotManager seats one: createBrain + createBotRunner with the in-process delays, a
 * room path budget renewed every frame, and the modules the features enable. Same scenario and spec, same output.
 */
export function runBrain(s: Scenario, spec: BrainSpec): BrainFrame[] {
  const budget = createPathBudget();
  const tier = TIERS[spec.tier];
  let percept: Percept | null = null;
  const brain = recordingBrain(createBrain, { onTick: (_id, p) => { percept = p; } })({
    id: s.selfId, name: "Self", tier, persona: PERSONAS[spec.persona], seed: spec.seed, map: s.map, features: s.features, learned: NO_LEARNING,
    services: { paths: createPathService(s.map, budget), log: () => {} }, modules: enabledModules(s.features),
  });
  const runner = createBotRunner({
    brain, adapter: { selfId: s.selfId, supports: (t) => s.features.messageTypes.includes(t), send: () => true }, cfg: IN_PROCESS, map: s.map,
    features: s.features, tier,
  });
  return scenarioInputs(s).map((input) => {
    budget.startTick();
    percept = null;
    const sent = runner.frame(input);
    return { sent, goal: brain.goal, percept };
  });
}

/** What a recording brain reports after each tick: the percept, the live memory view it decided with, its goal and its clicks. */
export interface BrainTap {
  onTick(id: string, p: Percept, mem: MemoryView | null, goal: Goal, sent: readonly TimedCommand[]): void;
}

/**
 * Wraps a brain factory so every tick is reported. The memory view is read through a feature module that only observes (it
 * offers no goal and no intent, so the brain decides exactly as without it).
 */
export function recordingBrain(base: BrainFactory, tap: BrainTap): BrainFactory {
  return (cfg) => {
    let mem: MemoryView | null = null;
    const probe: FeatureModule = { id: "fairness-probe", enabled: () => true, observe: (ctx) => { mem = ctx.mem; } };
    const inner = base({ ...cfg, modules: [...cfg.modules, probe] });
    const brain: Brain = {
      id: inner.id,
      get goal() { return inner.goal; },
      get stats() { return inner.stats; },
      end: (result) => inner.end(result),
      tick(p) {
        const sent = inner.tick(p);
        tap.onTick(cfg.id, p, mem, inner.goal, sent);
        return sent;
      },
    };
    return brain;
  };
}

/**
 * Every way a command names something must be on the bot's screen when it clicked (docs/BOTS.md 2.3): a lock resolves to a
 * standing, targetable fighter in the window of the percept that released it (no mob behind locked gates), F only on the
 * container that percept marks interactable, a unit cast on a fighter in the window. Returns what broke the rule.
 */
export function clickViolations(p: Percept, sent: readonly TimedCommand[]): string[] {
  const bad: string[] = [];
  for (const tc of sent) {
    const c = tc.cmd;
    if (tc.at > p.now) bad.push(`${c.type} clicked at ${tc.at}, after the percept's now ${p.now}`);
    if (c.type === "target") {
      const f = p.fighters.find((x) => x.id === c.msg.id);
      const m = p.mobs.find((x) => x.id === c.msg.id);
      if (f) {
        if (f.status !== "alive" || !f.targetable) bad.push(`target ${c.msg.id}: on screen but ${f.status}, targetable ${f.targetable}`);
      } else if (m) {
        if (m.status !== "alive" || p.hud.gatesLocked) bad.push(`target ${c.msg.id}: a mob ${m.status}, gates locked ${p.hud.gatesLocked}`);
      } else bad.push(`target ${c.msg.id}: not in the window at ${p.now}`);
    } else if (c.type === "pickup") {
      const box = p.containers.find((x) => x.id === c.msg.containerId);
      if (!box?.interactable) bad.push(`pickup ${c.msg.containerId}: ${box ? "not interactable" : "not on screen"} at ${p.now}`);
    } else if (c.type === "cast" && c.msg.id !== undefined) {
      if (!p.fighters.some((x) => x.id === c.msg.id) && !p.mobs.some((x) => x.id === c.msg.id)) bad.push(`cast on ${c.msg.id}: not in the window`);
    }
  }
  return bad;
}
