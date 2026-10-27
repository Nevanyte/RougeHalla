// Builders for the brain's tests (docs/BOTS.md 10): plain-data Percepts, memories, services and contexts with sensible defaults,
// so each layer can be tested against types.ts alone. Pass only the fields a test cares about.
import {
  findPath, generateMap, hasLineOfSight, matchupScore, mulberry32, PLAYER_RADIUS, segmentClear, factionEdge, weaponEdge,
  type FactionId, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import {
  BOT_VIEW, PERSONAS, TIERS,
  type BrainConfig, type BrainContext, type BrainRngs, type BrainServices, type ContainerView, type FighterView,
  type Features, type HudView, type Knowledge, type LearnedBias, type MemoryView, type MinimapMob, type MobView, type OpponentSnapshot,
  type PathService, type PersonaId, type Percept, type SelfView, type TierId,
} from "../../src/bots/brain/types";
import { matchupShare, pathLength } from "../../src/bots/mobHunt";

/** The core message set of this branch. */
export const CORE_MESSAGES: readonly string[] = ["move", "stop", "target", "aim", "attack", "release", "swap", "pickup"];

let cachedMap: GameMap | null = null;
/** A real generated map (seed 7), built once per test file. */
export function testMap(): GameMap {
  cachedMap ??= generateMap(7);
  return cachedMap;
}

/** The i-th spawn of testMap(): a floor point nobody walls in. */
export function floorPoint(i = 0): Vec2 {
  const s = testMap().spawns;
  const p = s[i % s.length]!;
  return { x: p.x, y: p.y };
}

export function features(over: Partial<Features> = {}): Features {
  return {
    messageTypes: CORE_MESSAGES, wishes: false, statusEffects: false, fields: false, planning: false, chests: false,
    skills: false, relics: false, camps: false, hazards: false, ...over,
  };
}

export function selfView(over: Partial<SelfView> = {}): SelfView {
  const at = floorPoint(0);
  return {
    id: "me", name: "Me", x: at.x, y: at.y, facing: 0, status: "alive", hp: 100, maxHp: 100, barrier: 0, faction: "fire",
    weapons: ["axe", null], slot: 0, attackTarget: null, drawStartedAt: 0, readyAt: 0, immuneUntil: 0, sig: 0, brand: 0,
    stacks: 0, asMult: 1, speedMult: 1, kills: 0, mobKills: 0,
    gv: 0, bounty: 0, moveSeq: 0, ...over,
  };
}

export function hudView(over: Partial<HudView> = {}): HudView {
  return {
    phase: "active", training: false, lobbyEndsAt: 0, raidStartedAt: 0, patienceEndsAt: 300_000, suddenDeathAt: 0, inColiseum: false,
    gatesLocked: false, startedWith: 6, alive: 6, playerCount: 6, minPlayers: 2, winner: "", ...over,
  };
}

/** An enemy on screen, 200 u east of the default self. */
export function fighter(over: Partial<FighterView> = {}): FighterView {
  const me = selfView();
  const x = over.x ?? me.x + 200;
  const y = over.y ?? me.y;
  return {
    id: "foe", name: "Foe", bot: false, x, y, facing: Math.PI, status: "alive", hpFrac: 1, barrierFrac: 0, faction: "frost", inHand: "sword",
    drawStartedAt: 0, bounty: 0, immune: false, sig: 0, brand: 0, targetable: true,
    vx: 0, vy: 0, dist: Math.hypot(x - me.x, y - me.y), los: true, tint: 0, central: true, ...over,
  };
}

export function mobView(over: Partial<MobView> = {}): MobView {
  const me = selfView();
  const x = over.x ?? me.x + 150;
  const y = over.y ?? me.y;
  return {
    id: "mob1", kind: "mob", name: "Mob", faction: "fire", x, y, facing: Math.PI, status: "alive", hpFrac: 1, inHand: "axe",
    drawStartedAt: 0, sig: 0, brand: 0, vx: 0, vy: 0, dist: Math.hypot(x - me.x, y - me.y), los: true, central: true, ...over,
  };
}

export function container(over: Partial<ContainerView> = {}): ContainerView {
  const me = selfView();
  const x = over.x ?? me.x + 100;
  const y = over.y ?? me.y;
  return {
    id: "c1", kind: "ground", x, y, label: "", closed: true, weapon: "bow", interactable: false,
    dist: Math.hypot(x - me.x, y - me.y), ...over,
  };
}

export function minimapMob(over: Partial<MinimapMob> = {}): MinimapMob {
  return { id: "mob1", x: 0, y: 0, faction: "fire", elite: false, ...over };
}

export function percept(over: Partial<Percept> = {}): Percept {
  const now = over.now ?? 100_000;
  return {
    now, viewT: now - 130, self: selfView(), hud: hudView(), fighters: [], mobs: [], containers: [], projectiles: [],
    minimap: { t: now, mobs: [], gatesLocked: false }, events: [], extras: {}, features: features(), ...over,
  };
}

/** An empty MemoryView (no stimuli, nobody remembered). Override the maps a test needs. */
export function emptyMemory(over: Partial<MemoryView> = {}): MemoryView {
  return {
    fighters: new Map(), mobs: new Map(), camps: new Map(), containers: new Map(),
    self: {
      lastHitAt: null, lastHitByPlayerAt: null, lastDealtAt: null, recentDamage: 0, recentHits: [], teleportedAt: null, lastOrder: null,
      stillSince: 0,
    },
    stimuli: [], bounties: new Map(), choices: [], whereabouts: () => null, ...over,
  };
}

/** Real shared pathfinding on `map`, unbudgeted. */
export function pathService(map: GameMap = testMap()): PathService {
  return {
    walk(from, to) {
      const path = findPath(map, from, to);
      return path.length === 0 ? null : { dist: pathLength(from, path), exact: true };
    },
    path(from, to) {
      const path = findPath(map, from, to);
      return path.length === 0 ? null : path;
    },
    los: (a, b) => hasLineOfSight(map, a, b),
    clear: (a, b) => segmentClear(map, a, b, PLAYER_RADIUS),
    collisionMap: () => map,
  };
}

export function services(map: GameMap = testMap()): BrainServices {
  return { paths: pathService(map), log: () => {} };
}

/** A bot that knows every edge: the reference the tiers' knowledge is a noisy copy of. */
export function fullKnowledge(): Knowledge {
  const clamp = (v: number) => Math.max(-2, Math.min(2, v));
  return {
    factionEdge,
    weaponEdge,
    mobShare: (me: FactionId, region: FactionId, elite: boolean) => matchupShare(me, region, elite),
    odds(me: SelfView, them: OpponentSnapshot) {
      const w: WeaponId | null = me.weapons[me.slot];
      const score = me.faction ? matchupScore({ faction: me.faction, weapon: w }, { faction: them.faction ?? me.faction, weapon: them.inHand }) : 0;
      const lead = me.maxHp > 0 ? me.hp / me.maxHp - them.hpFrac : 0;
      return { edge: clamp(score + 2 * lead), score: clamp(score), known: them.faction !== null, why: "fixture" };
    },
  };
}

export const NO_LEARNING: LearnedBias = { enabled: false, bias: () => 0 };

export function rngs(seed = 1): BrainRngs {
  return { decide: mulberry32(seed), motor: mulberry32(seed + 1), lapse: mulberry32(seed + 2) };
}

export function brainConfig(tier: TierId = "normal", persona: PersonaId = "hunter", over: Partial<BrainConfig> = {}): BrainConfig {
  const map = over.map ?? testMap();
  return {
    id: "me", name: "Me", tier: TIERS[tier], persona: PERSONAS[persona], seed: 1, map, features: features(), learned: NO_LEARNING,
    services: services(map), modules: [], ...over,
  };
}

/** A BrainContext: a percept, an empty memory, full knowledge and fresh streams. Override any part. */
export function ctx(over: Partial<BrainContext> & { tier?: TierId; persona?: PersonaId } = {}): BrainContext {
  const { tier, persona, ...rest } = over;
  const cfg = rest.cfg ?? brainConfig(tier ?? "normal", persona ?? "hunter");
  return {
    cfg, p: percept(), mem: emptyMemory(), know: fullKnowledge(), svc: cfg.services, rng: rngs(cfg.seed), engaged: false, ...rest,
  };
}

/** The window's edge, for tests of what is on screen. */
export const VIEW = BOT_VIEW;
