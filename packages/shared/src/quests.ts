// The quest catalog and its placement (GAME_DESIGN 2.2; sim/quests.ts runs these in a raid). Quests are standing
// offers to the whole lobby: five public offers support spawn planning, while five private offers stay out of synced
// state until scouted. Every objective pulls players away from their spawn and pays a buff from the zone it visits.
//
// Balance ("roughly time parity with farming, slightly more for the risk"): FARM_SECONDS_PER_MOB is the all-in
// seconds of farming one mob (fight, walk between camps, regen), so a player farming flat out earns
// FARM_STACK_RATE stacks and FARM_GV_RATE GV per second. A quest costs objSec at the objective plus travelSec of
// pure walking; walking only earns TRAVEL_RATE_SHARE of the farm rate (camps met on the way), so the time-parity
// reward is parityStacks / parityGv, and a quest should pay a little OVER that — the STACK_PREMIUM — because the
// walker is exposed (a gank target carrying a parcel) in a way a camper is not. The catalog test holds every quest
// (headhunter excepted: a player kill has no mob parity) inside a band around its parity, so the numbers below and
// this formula cannot drift apart.
import {
  PLAYER_RADIUS, QUEST_COUNT, QUEST_KNOWN_COUNT, QUEST_NPC_GAP_TILES, QUEST_NPC_SPAWN_MIN_TILES, TILE,
} from "./constants";
import { buffDef, buffText, rewardCurve, type BuffId } from "./buffs";
import type { FactionId } from "./factions";
import { circleClear } from "./geometry";
import {
  MASK_MOVE, blocksTile, moveComponents, tileIndex, tileToWorldCenter, worldToTile, type CampDef, type GameMap,
} from "./map";
import type { Vec2 } from "./messages";
import { TERRAIN_NONE, terrainAt } from "./terrain";

export type QuestKind = "kill" | "collect" | "fetch";

export interface QuestDef {
  id: string;
  kind: QuestKind;
  /** Display name of the offer ("Cinder Cull"). */
  name: string;
  /** The NPC who offers it (the giver mob's name). */
  giver: string;
  /** The giver's one-line brief. */
  text: string;
  /** Objective size: kills, tokens, or distinct tour regions (fetch quests carry one parcel: 1). */
  count: number;
  /** The region the objective sits in (kill/collect/fetch): the giver is placed far from its pole. */
  region?: FactionId;
  /** The zone whose mob buff this quest pays. It is explicit for objectives that visit several or any zone. */
  farZone: FactionId;
  /** Kill quest: elites count (with region, one elite of it; without, any elite). */
  elite?: boolean;
  /** Kill quest: player kills count (the gank offer; nothing else does). */
  players?: boolean;
  /** Kill quest: a mob killed in this many DIFFERENT regions. */
  tour?: number;
  /** Collect quest: where its tokens lie — scattered at the region's farthest camp, near outer starts, or middle camps. */
  tokens?: "camp" | "rim" | "mid";
  /** Collect quest: tokens on the ground (always more than `count`, so one contest doesn't starve the offer). */
  tokenSpawns?: number;
  /** Expected seconds at the objective itself (fights, pickups); feeds the parity maths above. */
  objSec: number;
  /** Expected seconds of pure travel the offer asks for; feeds the parity maths above. */
  travelSec: number;
  /** Nominal reward before the server applies rewardCurve(feed) to the buff stacks. */
  reward: { buff: BuffId; stacks: number; gv: number };
  /** The offer lapses this many seconds into the run (no farming first, turning in at leisure). */
  expiresAtSec: number;
}

// --- The time-parity formula (see the header) ------------------------------------------------------------------------

/** All-in seconds of farming one mob: the fight, the walk to the next camp, the regen pause. */
export const FARM_SECONDS_PER_MOB = 12;
/** Stacks per second of flat-out farming (MOB_BUFF_STACKS over FARM_SECONDS_PER_MOB). */
export const FARM_STACK_RATE = 1.1 / FARM_SECONDS_PER_MOB;
/** GV per second of flat-out farming (GV_MOB over FARM_SECONDS_PER_MOB). */
export const FARM_GV_RATE = 2 / FARM_SECONDS_PER_MOB;
/** Travel still earns this share of the farm rate (camps and loot met on the way). */
export const TRAVEL_RATE_SHARE = 0.4;
/** Stacks pay this much over parity: the walker is the gank target, the camper is not. */
export const STACK_PREMIUM = 1.15;

/** Stacks a quest taking (objSec at the objective + travelSec walking) should pay to beat farming by the premium. */
export function parityStacks(objSec: number, travelSec: number): number {
  return (objSec * FARM_STACK_RATE + travelSec * FARM_STACK_RATE * TRAVEL_RATE_SHARE) * STACK_PREMIUM;
}

/** GV the same quest should pay for time parity (no premium: GV is the consolation half of a reward). */
export function parityGv(objSec: number, travelSec: number): number {
  return objSec * FARM_GV_RATE + travelSec * FARM_GV_RATE * TRAVEL_RATE_SHARE;
}

// --- The catalog: 20 quests ------------------------------------------------------------------------------------------

export const QUEST_DEFS: readonly QuestDef[] = [
  // Kill (7)
  {
    id: "cull-fire", kind: "kill", name: "Cinder Cull", giver: "Ashmother Vela",
    text: "The ashwoods breed vermin faster than we can burn them. Cull three.", count: 3, region: "fire", farZone: "fire",
    objSec: 36, travelSec: 60, reward: { buff: "emberImp", stacks: 7, gv: 10 }, expiresAtSec: 150,
  },
  {
    id: "cull-sentenced", kind: "kill", name: "Break the Chains", giver: "Magistrate Ohm",
    text: "Three convicts walk free who shouldn't. Remind them what chains are for.", count: 3, region: "sentenced", farZone: "sentenced",
    objSec: 36, travelSec: 60, reward: { buff: "executioner", stacks: 7, gv: 10 }, expiresAtSec: 150,
  },
  {
    id: "cull-plague", kind: "kill", name: "Plague Purge", giver: "Sister Mercia",
    text: "The rats carry it further every night. Three fewer carriers, please.", count: 3, region: "plague", farZone: "plague",
    objSec: 36, travelSec: 60, reward: { buff: "plagueRat", stacks: 7, gv: 10 }, expiresAtSec: 150,
  },
  {
    id: "cull-frost", kind: "kill", name: "Thaw the Watch", giver: "Warden Sigur",
    text: "Rimeguards on the far ridge, three of them. End their watch.", count: 3, region: "frost", farZone: "frost",
    objSec: 36, travelSec: 75, reward: { buff: "iceGolem", stacks: 7.5, gv: 11 }, expiresAtSec: 165,
  },
  {
    id: "elite-hunt", kind: "kill", name: "Worth the Walk", giver: "Huntmaster Brack",
    text: "Any elite, anywhere. Prove you can bring down something that fights back.", count: 1, elite: true, farZone: "fire",
    objSec: 20, travelSec: 60, reward: { buff: "wyrmling", stacks: 5, gv: 7 }, expiresAtSec: 240,
  },
  {
    id: "headhunter", kind: "kill", name: "A Head for a Head", giver: "The Broker",
    text: "One of your fellow champions. Any of them. I don't deal in specifics.", count: 1, players: true, farZone: "sentenced",
    objSec: 30, travelSec: 60, reward: { buff: "executioner", stacks: 3, gv: 5 }, expiresAtSec: 300,
  },
  {
    id: "grand-tour", kind: "kill", name: "The Grand Tour", giver: "Cartographer Ines",
    text: "Blood on your blade in three different lands. Bring me the itinerary.", count: 3, tour: 3, farZone: "fire",
    objSec: 36, travelSec: 100, reward: { buff: "cinderHound", stacks: 8.5, gv: 13 }, expiresAtSec: 300,
  },
  // Collect (7)
  {
    id: "bloom-plague", kind: "collect", name: "Blight Blooms", giver: "Apothecary Nyx",
    text: "Pale blooms grow where the rats nest. Three, stems and all.", count: 3, region: "plague", farZone: "plague", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { buff: "plagueRat", stacks: 5, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "shards-frost", kind: "collect", name: "Shards of the Watch", giver: "Smith Halvar",
    text: "Rimeshard splinters litter the far camp. Three will reforge nicely.", count: 3, region: "frost", farZone: "frost", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { buff: "rimeStalker", stacks: 5, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "ashcap-fire", kind: "collect", name: "Ashcaps", giver: "Cook Farrell",
    text: "Ashcap mushrooms, the big grey ones, from the ember camp. Three. Don't ask what for.", count: 3, region: "fire", farZone: "fire", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { buff: "magmaBrute", stacks: 5, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "chains-sentenced", kind: "collect", name: "Loose Links", giver: "Warden Ohm the Younger",
    text: "Broken links from the chain camp, three of them. Evidence, you understand.", count: 3, region: "sentenced", farZone: "sentenced", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { buff: "bailiff", stacks: 5, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "tithe-holy", kind: "collect", name: "The Tithe", giver: "Cantor Lucien",
    text: "Blood tokens the imps hoard at their camp. Three, for the collection plate.", count: 3, region: "holy", farZone: "holy", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { buff: "penitent", stacks: 5, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "cache", kind: "collect", name: "The Quartermaster's Cache", giver: "Quartermaster Bly",
    text: "I scattered supply stubs around the middle camps. Four of them buy you my gratitude.", count: 4, farZone: "plague", tokens: "mid", tokenSpawns: 6,
    objSec: 20, travelSec: 90, reward: { buff: "plagueRat", stacks: 6.5, gv: 10 }, expiresAtSec: 220,
  },
  {
    id: "tithe-rim", kind: "collect", name: "Offerings at the Edge", giver: "Pilgrim Saoirse",
    text: "Five shrines by the outer starts, an offering at each. The long way round is the point.", count: 5, farZone: "frost", tokens: "rim", tokenSpawns: 8,
    objSec: 25, travelSec: 110, reward: { buff: "iceGolem", stacks: 8, gv: 12 }, expiresAtSec: 240,
  },
  // Fetch (6)
  {
    id: "banner-fire", kind: "fetch", name: "The Ember Banner", giver: "Herald Kest",
    text: "My banner stands in the ashlands. Carry it back and mind the carrier's curse: everyone sees you.", count: 1, region: "fire", farZone: "fire",
    objSec: 8, travelSec: 100, reward: { buff: "cinderHound", stacks: 5.5, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-frost", kind: "fetch", name: "The Frozen Standard", giver: "Skald Runa",
    text: "A standard lost on the glacier. Bring it home and I'll sing of you.", count: 1, region: "frost", farZone: "frost",
    objSec: 8, travelSec: 100, reward: { buff: "iceGolem", stacks: 5.5, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-plague", kind: "fetch", name: "The Physician's Satchel", giver: "Physician Aldous",
    text: "My satchel, left behind in the sicklands. Fetch it and try not to touch anything.", count: 1, region: "plague", farZone: "plague",
    objSec: 8, travelSec: 100, reward: { buff: "plagueRat", stacks: 5.5, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-sentenced", kind: "fetch", name: "The Warden's Seal", giver: "Clerk Demain",
    text: "The old seal lies in the prison yards. Bureaucracy demands its return.", count: 1, region: "sentenced", farZone: "sentenced",
    objSec: 8, travelSec: 100, reward: { buff: "executioner", stacks: 5.5, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-holy", kind: "fetch", name: "The Reliquary", giver: "Abbot Gavril",
    text: "A reliquary abandoned at the blood shrine. Handle with reverence. And haste.", count: 1, region: "holy", farZone: "holy",
    objSec: 8, travelSec: 100, reward: { buff: "acolyte", stacks: 5.5, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "long-haul", kind: "fetch", name: "The Long Haul", giver: "Freight Captain Mora",
    text: "One parcel, the whole way across. Nobody who matters will carry it. Will you?", count: 1, farZone: "plague",
    objSec: 8, travelSec: 150, reward: { buff: "plagueRat", stacks: 8, gv: 12 }, expiresAtSec: 280,
  },
];

const QUEST_DEF_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUEST_DEFS.map((d) => [d.id, d]));

/** Undefined for an id that is not in the catalog. */
export function questDefById(id: string): QuestDef | undefined {
  return QUEST_DEF_BY_ID.get(id);
}

/** Nominal reward wording for the quest log and planning screen, including the buff's scaled effect. */
export function questRewardText(def: QuestDef): string {
  const buff = buffDef(def.reward.buff);
  const stacks = String(Math.round(def.reward.stacks * 100) / 100);
  if (!buff) return `${def.reward.gv} GV`;
  return `${stacks} ${buff.name} stacks (${buffText(buff.id, def.reward.stacks)}) and ${def.reward.gv} GV`;
}

/** Actual buff stacks to grant at completion: the nominal quest reward through the same feed brake as mob rewards. */
export function questRewardStacks(def: QuestDef, feed: number): number {
  return def.reward.stacks * rewardCurve(feed);
}

// --- The roster ------------------------------------------------------------------------------------------------------

export interface RosterEntry { def: QuestDef; known: boolean }

function shuffled<T>(xs: readonly T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The run's offers: `count` quests, at least two of each kind (a run always has something to kill, gather and carry),
 * the rest dealt from a shuffled kind cycle; `known` of them public from the start. Deterministic per random stream.
 */
export function selectQuests(random: () => number, count = QUEST_COUNT, known = QUEST_KNOWN_COUNT): RosterEntry[] {
  const kinds: QuestKind[] = ["kill", "collect", "fetch"];
  const pools = new Map<QuestKind, QuestDef[]>(kinds.map((k) => [k, shuffled(QUEST_DEFS.filter((d) => d.kind === k), random)]));
  const picked: QuestDef[] = [];
  const take = (k: QuestKind): boolean => {
    const next = pools.get(k)!.pop();
    if (!next) return false;
    picked.push(next);
    return true;
  };
  for (const k of kinds) { take(k); take(k); }
  const cycle = shuffled(kinds, random);
  for (let i = 0; picked.length < count && poolsSize(pools) > 0; i++) take(cycle[i % cycle.length]!);
  const order = shuffled(picked, random);
  return order.map((def, i) => ({ def, known: i < known }));
}

function poolsSize(pools: Map<QuestKind, QuestDef[]>): number {
  let n = 0;
  for (const p of pools.values()) n += p.length;
  return n;
}

// --- Placement -------------------------------------------------------------------------------------------------------

export interface QuestPlacement { def: QuestDef; known: boolean; at: Vec2; tokens?: Vec2[]; parcel?: Vec2 }

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A clear floor tile near `want` (ring search out to `maxTiles`), not yet `used`, reachable from `origin` when one is
 * given. radius is the body that must fit there (a player's by default).
 */
export function freeTileNear(
  map: GameMap, want: Vec2, used: Set<number>, origin?: Vec2, maxTiles = 16, radius = PLAYER_RADIUS,
): Vec2 | null {
  const cx = worldToTile(want.x);
  const cy = worldToTile(want.y);
  const components = origin ? moveComponents(map) : null;
  const source = origin && components ? components[tileIndex(map, worldToTile(origin.x), worldToTile(origin.y))] : -1;
  for (let r = 0; r <= maxTiles; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        const index = tileIndex(map, tx, ty);
        if (used.has(index) || (components && (source < 0 || components[index] !== source))) continue;
        const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
        if (!circleClear(map, at, radius, MASK_MOVE)) continue;
        used.add(index);
        return at;
      }
    }
  }
  return null;
}

/** Chebyshev distance in tiles. */
const tileDist = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(worldToTile(a.x) - worldToTile(b.x)), Math.abs(worldToTile(a.y) - worldToTile(b.y)));

function outsideColiseum(map: GameMap, tx: number, ty: number, margin = 2): boolean {
  const r = map.coliseum.rect;
  return tx < r.x - margin || tx >= r.x + r.w + margin || ty < r.y - margin || ty >= r.y + r.h + margin;
}

/**
 * Givers stand on clear, plain floor outside the coliseum, at least three tiles beyond camp clearings and away from
 * spawnPool entries. Dense maps get a second pass at half the doorstep distance; safety clearances are never relaxed.
 */
export function npcCandidates(map: GameMap): Vec2[] {
  if (map.camps.length === 0 && map.spawnPool.length === 0 && map.regions.length === 0) return [];
  const scan = (spawnMinTiles: number): Vec2[] => {
    const out: Vec2[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!outsideColiseum(map, tx, ty) || blocksTile(map, tx, ty, MASK_MOVE)) continue;
        const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
        if (!circleClear(map, at, PLAYER_RADIUS, MASK_MOVE) || terrainAt(map, at.x, at.y) !== TERRAIN_NONE) continue;
        if (map.camps.some((c) => distance(c, at) < c.r + 3 * TILE)) continue;
        if (map.spawnPool.some((s) => distance(s, at) < spawnMinTiles * TILE)) continue;
        out.push(at);
      }
    }
    return out;
  };
  const strict = scan(QUEST_NPC_SPAWN_MIN_TILES);
  if (strict.length >= QUEST_COUNT * 4) return strict;
  const seen = new Set(strict.map((p) => `${p.x},${p.y}`));
  const relaxed = scan(Math.floor(QUEST_NPC_SPAWN_MIN_TILES / 2)).filter((p) => !seen.has(`${p.x},${p.y}`));
  return [...strict, ...relaxed];
}

/** Up to `n` privately shuffled candidates, accepted greedily with a gap relaxed only as far as the dense fallback. */
export function spreadSpots(candidates: Vec2[], n: number, random: () => number): Vec2[] {
  if (candidates.length === 0 || n <= 0) return [];
  const target = Math.min(n, candidates.length);
  let best: Vec2[] = [];
  for (let gap = QUEST_NPC_GAP_TILES * TILE; gap >= Math.floor(QUEST_NPC_GAP_TILES / 2) * TILE; gap -= TILE) {
    const taken: Vec2[] = [];
    for (const candidate of shuffled(candidates, random)) {
      if (taken.some((spot) => distance(spot, candidate) < gap)) continue;
      taken.push(candidate);
      if (taken.length >= target) break;
    }
    if (taken.length > best.length) best = taken;
    if (taken.length >= target) break;
  }
  return best;
}

function campItemExclusions(map: GameMap): Set<number> {
  const used = new Set<number>();
  const exclude = (at: Vec2, halo: number): void => {
    const cx = worldToTile(at.x);
    const cy = worldToTile(at.y);
    for (let dy = -halo; dy <= halo; dy++) {
      for (let dx = -halo; dx <= halo; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h) used.add(tileIndex(map, tx, ty));
      }
    }
  };
  for (const camp of map.camps) {
    exclude(camp.chest, 1);
    for (const spot of camp.spots) exclude(spot, 2);
  }
  return used;
}

/** A collect quest's tokens around the region's camp farthest from the giver, clear of every camp's protected tiles. */
function campTokens(map: GameMap, region: FactionId, giver: Vec2, spawns: number, random: () => number): Vec2[] {
  const camps = map.camps.filter((c: CampDef) => c.zone === region);
  if (camps.length === 0) return [];
  const camp = camps.reduce((a, b) => distance(a, giver) >= distance(b, giver) ? a : b);
  const used = campItemExclusions(map);
  const out: Vec2[] = [];
  const add = (want: Vec2): void => {
    const at = freeTileNear(map, want, used, giver, 8);
    if (at) out.push(at);
  };
  for (let tries = 0; tries < spawns * 6 && out.length < spawns; tries++) {
    const a = random() * Math.PI * 2;
    const d = camp.r * (0.3 + 0.9 * random());
    add({ x: camp.x + Math.cos(a) * d, y: camp.y + Math.sin(a) * d });
  }
  for (let i = 0; out.length < spawns && i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add({ x: camp.x + Math.cos(a) * camp.r, y: camp.y + Math.sin(a) * camp.r });
  }
  return out;
}

function uniqueSites(sites: readonly Vec2[]): Vec2[] {
  const seen = new Set<string>();
  return sites.filter((p) => {
    const key = `${worldToTile(p.x)},${worldToTile(p.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Middle-camp and outer-start token placement, expressed entirely in the map contract rather than wedge rings. */
function siteTokens(map: GameMap, giver: Vec2, ring: "rim" | "mid", spawns: number, random: () => number): Vec2[] {
  const centre = map.coliseum.centre;
  const byCentre = (a: Vec2, b: Vec2): number => distance(a, centre) - distance(b, centre);
  let sites: Vec2[];
  if (ring === "rim") {
    sites = uniqueSites([
      ...[...map.spawnPool].sort((a, b) => byCentre(b, a)),
      ...map.regions.map((r) => r.pole).sort((a, b) => byCentre(b, a)),
    ]);
  } else {
    const camps = [...map.camps].sort(byCentre);
    const from = Math.floor(camps.length / 3);
    const to = Math.max(from + 1, Math.ceil(camps.length * 2 / 3));
    sites = uniqueSites(camps.slice(from, to));
  }
  if (sites.length === 0) return [];
  const used = campItemExclusions(map);
  const out: Vec2[] = [];
  const start = Math.floor(random() * sites.length);
  for (let i = 0; i < spawns * 4 && out.length < spawns; i++) {
    const site = sites[(start + i) % sites.length]!;
    const at = freeTileNear(map, site, used, giver, 10);
    if (at) out.push(at);
  }
  return out;
}

/**
 * A fetch parcel uses only zone-tagged camps and starts (plus the region pole), never regionGrid or wedge radii.
 * The farthest reachable candidate at least QUEST_FETCH_MIN_TILES away wins; cramped maps keep the farthest fallback.
 */
function parcelSpot(map: GameMap, giver: Vec2, region: FactionId | null, random: () => number): Vec2 | null {
  const camps = region === null ? map.camps : map.camps.filter((c) => c.zone === region);
  const starts = region === null ? map.spawnPool : map.spawnPool.filter((s) => s.zone === region);
  const pole = region === null ? [] : map.regions.filter((r) => r.id === region).map((r) => r.pole);
  const sites = uniqueSites([...camps, ...starts, ...pole]);
  if (sites.length === 0) return null;
  const used = campItemExclusions(map);
  const start = Math.floor(random() * sites.length);
  let best: Vec2 | null = null;
  let bestD = -1;
  for (let i = 0; i < sites.length; i++) {
    const at = freeTileNear(map, sites[(start + i) % sites.length]!, used, giver, 12);
    if (!at) continue;
    const d = tileDist(at, giver);
    if (d > bestD) { best = at; bestD = d; }
  }
  return best;
}

/**
 * Lays the roster out on the map. Region-themed placement is internal only; the returned order is privately shuffled so
 * quest ids reveal neither theme nor placement order. A quest whose pieces will not place is dropped rather than placed badly.
 */
export function placeQuests(map: GameMap, roster: RosterEntry[], random: () => number): QuestPlacement[] {
  const spots = spreadSpots(npcCandidates(map), roster.length * 4, random);
  if (spots.length === 0) return [];
  const remaining = [...spots];
  const ordered = [...roster].sort((a, b) => Number(!!b.def.region) - Number(!!a.def.region));
  const out: QuestPlacement[] = [];
  for (const entry of ordered) {
    if (remaining.length === 0) break;
    let at: Vec2;
    if (entry.def.region) {
      const pole = map.regions.find((r) => r.id === entry.def.region)?.pole ?? map.coliseum.centre;
      let bestI = 0;
      let bestD = -1;
      for (let i = 0; i < remaining.length; i++) {
        const d = distance(remaining[i]!, pole);
        if (d > bestD) { bestD = d; bestI = i; }
      }
      at = remaining.splice(bestI, 1)[0]!;
    } else {
      at = remaining.shift()!;
    }
    const placement: QuestPlacement = { def: entry.def, known: entry.known, at };
    if (entry.def.kind === "collect") {
      const spawns = entry.def.tokenSpawns ?? entry.def.count;
      const tokens = entry.def.tokens === "camp" && entry.def.region
        ? campTokens(map, entry.def.region, at, spawns, random)
        : siteTokens(map, at, entry.def.tokens === "rim" ? "rim" : "mid", spawns, random);
      if (tokens.length < entry.def.count) continue;
      placement.tokens = tokens;
    } else if (entry.def.kind === "fetch") {
      const parcel = parcelSpot(map, at, entry.def.region ?? null, random);
      if (!parcel) continue;
      placement.parcel = parcel;
    }
    out.push(placement);
  }
  return shuffled(out, random);
}
