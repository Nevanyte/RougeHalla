// The quest catalog and placement (GAME_DESIGN 2.2; sim/quests.ts runs them in a raid). Five offers are public for planning;
// five stay server-side until scouted. Quests award a zone-matched normal-mob stat stack and GV when completed. Stack quantity is
// based on objective effort: count objective seconds fully, travel at the existing 40% incidental-farming rate, double the
// resulting normal-kill equivalent for a meaningful route premium, then keep each offer between 8 and 16 stacks. It is independent
// of feed; the old card identity/copy/tier fields remain tuning metadata only.
import {
  PLAYER_RADIUS, QUEST_COUNT, QUEST_KNOWN_COUNT, QUEST_NPC_GAP_TILES, QUEST_NPC_SPAWN_MIN_TILES, QUEST_REVEAL_RADIUS, TILE,
} from "./constants";
import { cardDef, type CardId, type CardTier } from "./cards";
import { MOB_STAT_REWARDS, mobStatText } from "./mobStats";
import type { MobTypeId } from "./mobs";
import type { FactionId } from "./factions";
import { circleClear } from "./geometry";
import {
  MASK_MOVE, blocksTile, moveComponents, tileIndex, tileToWorldCenter, worldToTile, type CampDef, type GameMap,
} from "./map";
import type { Vec2 } from "./messages";
import { rewardCurve } from "./rules";
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
  /** The zone whose mobs the objective is about (its colour in the log). It is explicit for objectives that visit several or any zone. */
  farZone: FactionId;
  /** Kill quest: only an elite counts, from any zone. (Combining it with `region` is not supported: the sim never reads the region of an elite def.) */
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
  /** Historical reward-card tuning metadata plus the GV it adds. Current mob-stat stacks derive from objective/travel effort. */
  reward: { card: CardId; copies: number; gv: number };
  /** The offer lapses this many seconds into the run (no farming first, turning in at leisure). */
  expiresAtSec: number;
}

// --- The time-parity formulas (see the header) ----------------------------------------------------------------------

/** All-in seconds of farming one mob: the fight, the walk to the next camp, the regen pause. */
export const FARM_SECONDS_PER_MOB = 12;
/** All-in seconds of clearing a camp of four: the unit a quest's time is counted in. */
export const CAMP_SECONDS = 4 * FARM_SECONDS_PER_MOB;
/** Tier points a normal camp's chest gives on average (70/25/5 base tiers, a third of the options being useful: 1.35). */
export const CARD_TIER_RATE = 1.35;
/** GV per second of flat-out farming (GV_MOB over FARM_SECONDS_PER_MOB). */
export const FARM_GV_RATE = 2 / FARM_SECONDS_PER_MOB;
/** Travel still earns this share of the farm rate (camps and loot met on the way). */
export const TRAVEL_RATE_SHARE = 0.4;
/** A quest pays this much over parity: the walker is the gank target, the camper is not. */
export const STACK_PREMIUM = 1.15;
/** A player whose mob reward curve is below this (fed: it is the curve at a feed of 5) gets a quest card one tier lower. */
export const QUEST_FEED_BRAKE = 0.65;

/** The tier points a quest taking (objSec at the objective + travelSec walking) should pay to beat farming by the premium. */
export function questTierPoints(objSec: number, travelSec: number): number {
  return ((objSec + TRAVEL_RATE_SHARE * travelSec) / CAMP_SECONDS) * CARD_TIER_RATE * STACK_PREMIUM;
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
    objSec: 36, travelSec: 60, reward: { card: "ad2", copies: 2, gv: 10 }, expiresAtSec: 150,
  },
  {
    id: "cull-sentenced", kind: "kill", name: "Break the Chains", giver: "Magistrate Ohm",
    text: "Three convicts walk free who shouldn't. Remind them what chains are for.", count: 3, region: "sentenced", farZone: "sentenced",
    objSec: 36, travelSec: 60, reward: { card: "ad2", copies: 3, gv: 10 }, expiresAtSec: 150,
  },
  {
    id: "cull-plague", kind: "kill", name: "Plague Purge", giver: "Sister Mercia",
    text: "The rats carry it further every night. Three fewer carriers, please.", count: 3, region: "plague", farZone: "plague",
    objSec: 36, travelSec: 60, reward: { card: "haste2", copies: 4, gv: 10 }, expiresAtSec: 150,
  },
  {
    id: "cull-frost", kind: "kill", name: "Thaw the Watch", giver: "Warden Sigur",
    text: "Rimeguards on the far ridge, three of them. End their watch.", count: 3, region: "frost", farZone: "frost",
    objSec: 36, travelSec: 75, reward: { card: "vitality2", copies: 3, gv: 11 }, expiresAtSec: 165,
  },
  {
    id: "elite-hunt", kind: "kill", name: "Worth the Walk", giver: "Huntmaster Brack",
    text: "Any elite, anywhere. Prove you can bring down something that fights back.", count: 1, elite: true, farZone: "fire",
    objSec: 20, travelSec: 60, reward: { card: "ap1", copies: 5, gv: 7 }, expiresAtSec: 240,
  },
  {
    id: "headhunter", kind: "kill", name: "A Head for a Head", giver: "The Broker",
    text: "One of your fellow champions. Any of them. I don't deal in specifics.", count: 1, players: true, farZone: "sentenced",
    objSec: 30, travelSec: 60, reward: { card: "ad1", copies: 3, gv: 5 }, expiresAtSec: 300,
  },
  {
    id: "grand-tour", kind: "kill", name: "The Grand Tour", giver: "Cartographer Ines",
    text: "Blood on your blade in three different lands. Bring me the itinerary.", count: 3, tour: 3, farZone: "fire",
    objSec: 36, travelSec: 100, reward: { card: "fleet2", copies: 2, gv: 13 }, expiresAtSec: 300,
  },
  // Collect (7)
  {
    id: "bloom-plague", kind: "collect", name: "Blight Blooms", giver: "Apothecary Nyx",
    text: "Pale blooms grow where the rats nest. Three, stems and all.", count: 3, region: "plague", farZone: "plague", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { card: "haste1", copies: 6, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "shards-frost", kind: "collect", name: "Shards of the Watch", giver: "Smith Halvar",
    text: "Rimeshard splinters litter the far camp. Three will reforge nicely.", count: 3, region: "frost", farZone: "frost", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { card: "armor1", copies: 4, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "ashcap-fire", kind: "collect", name: "Ashcaps", giver: "Cook Farrell",
    text: "Ashcap mushrooms, the big grey ones, from the ember camp. Three. Don't ask what for.", count: 3, region: "fire", farZone: "fire", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { card: "mr1", copies: 6, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "chains-sentenced", kind: "collect", name: "Loose Links", giver: "Warden Ohm the Younger",
    text: "Broken links from the chain camp, three of them. Evidence, you understand.", count: 3, region: "sentenced", farZone: "sentenced", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { card: "ap1", copies: 6, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "tithe-holy", kind: "collect", name: "The Tithe", giver: "Cantor Lucien",
    text: "Blood tokens the imps hoard at their camp. Three, for the collection plate.", count: 3, region: "holy", farZone: "holy", tokens: "camp", tokenSpawns: 5,
    objSec: 15, travelSec: 75, reward: { card: "ap1", copies: 5, gv: 8 }, expiresAtSec: 180,
  },
  {
    id: "cache", kind: "collect", name: "The Quartermaster's Cache", giver: "Quartermaster Bly",
    text: "I scattered supply stubs around the middle camps. Four of them buy you my gratitude.", count: 4, farZone: "plague", tokens: "mid", tokenSpawns: 6,
    objSec: 20, travelSec: 90, reward: { card: "haste2", copies: 2, gv: 10 }, expiresAtSec: 220,
  },
  {
    id: "tithe-rim", kind: "collect", name: "Offerings at the Edge", giver: "Pilgrim Saoirse",
    text: "Five shrines by the outer starts, an offering at each. The long way round is the point.", count: 5, farZone: "frost", tokens: "rim", tokenSpawns: 8,
    objSec: 25, travelSec: 110, reward: { card: "vitality2", copies: 3, gv: 12 }, expiresAtSec: 240,
  },
  // Fetch (6)
  {
    id: "banner-fire", kind: "fetch", name: "The Ember Banner", giver: "Herald Kest",
    text: "My banner stands in the ashlands. Carry it back and mind the carrier's curse: everyone sees you.", count: 1, region: "fire", farZone: "fire",
    objSec: 8, travelSec: 100, reward: { card: "fleet2", copies: 4, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-frost", kind: "fetch", name: "The Frozen Standard", giver: "Skald Runa",
    text: "A standard lost on the glacier. Bring it home and I'll sing of you.", count: 1, region: "frost", farZone: "frost",
    objSec: 8, travelSec: 100, reward: { card: "vitality2", copies: 4, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-plague", kind: "fetch", name: "The Physician's Satchel", giver: "Physician Aldous",
    text: "My satchel, left behind in the sicklands. Fetch it and try not to touch anything.", count: 1, region: "plague", farZone: "plague",
    objSec: 8, travelSec: 100, reward: { card: "haste2", copies: 4, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-sentenced", kind: "fetch", name: "The Warden's Seal", giver: "Clerk Demain",
    text: "The old seal lies in the prison yards. Bureaucracy demands its return.", count: 1, region: "sentenced", farZone: "sentenced",
    objSec: 8, travelSec: 100, reward: { card: "ad2", copies: 4, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "banner-holy", kind: "fetch", name: "The Reliquary", giver: "Abbot Gavril",
    text: "A reliquary abandoned at the blood shrine. Handle with reverence. And haste.", count: 1, region: "holy", farZone: "holy",
    objSec: 8, travelSec: 100, reward: { card: "leech2", copies: 5, gv: 8 }, expiresAtSec: 200,
  },
  {
    id: "long-haul", kind: "fetch", name: "The Long Haul", giver: "Freight Captain Mora",
    text: "One parcel, the whole way across. Nobody who matters will carry it. Will you?", count: 1, farZone: "plague",
    objSec: 8, travelSec: 150, reward: { card: "haste2", copies: 4, gv: 12 }, expiresAtSec: 280,
  },
];

const QUEST_DEF_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUEST_DEFS.map((d) => [d.id, d]));

/** Undefined for an id that is not in the catalog. */
export function questDefById(id: string): QuestDef | undefined {
  return QUEST_DEF_BY_ID.get(id);
}

/** The nominal tier of a quest's card: its tier points rounded into 1-3, and at most 1 for the player-kill quest (no mob parity). */
export function questTier(def: Pick<QuestDef, "objSec" | "travelSec" | "players">): CardTier {
  if (def.players) return 1;
  const points = questTierPoints(def.objSec, def.travelSec);
  return Math.max(1, Math.min(3, Math.round(points))) as CardTier;
}

/** The base stat of a quest's card ("ad" for "ad2"). */
export function questBase(def: Pick<QuestDef, "reward">): string {
  return def.reward.card.replace(/[123]$/, "");
}

/**
 * The card a player is paid for completing the quest with this feed: the quest's nominal card, one tier lower (at least 1) once the
 * mob reward curve at their feed has fallen below QUEST_FEED_BRAKE.
 */
export function questRewardCard(def: Pick<QuestDef, "reward">, feed: number): CardId {
  const base = questBase(def);
  const tier = Number(def.reward.card.slice(base.length)) as CardTier;
  const lowered = rewardCurve(feed) < QUEST_FEED_BRAKE ? Math.max(1, tier - 1) : tier;
  return `${base}${lowered}` as CardId;
}

/** Number of copies paid; every quest reward is a stackable base card. */
export function questRewardCopies(def: Pick<QuestDef, "reward">): number {
  return def.reward.copies;
}

/** Quest stat awards count toward substantial farming progress, based on objective and travel effort. */
export const QUEST_MIN_STAT_STACKS = 8;
export const QUEST_MAX_STAT_STACKS = 16;
export const QUEST_STAT_STACKS_PER_FARM_EQUIVALENT = 2;

/**
 * The zone's normal-mob stat and a time-based stack payout. A stack is one ordinary mob kill's fixed reward; objective time counts
 * fully, travel counts at the existing 40% parity rate (camps can be met on the way), and a 2x route premium makes questing a
 * worthwhile alternative to farming. Every offer lands between 8 and 16 stacks, independent of feed/card rewards.
 */
export function questRewardStats(def: Pick<QuestDef, "reward" | "farZone" | "objSec" | "travelSec">): { id: MobTypeId; stacks: number } {
  const desired = { ad: "damage", ap: "ap", haste: "attackSpeed", vitality: "maxHp", armor: "armor", mr: "shield", leech: "lifesteal", fleet: "moveSpeed" };
  const base = cardDef(def.reward.card)?.base;
  const zone = MOB_STAT_REWARDS.filter((reward) => reward.zone === def.farZone);
  const reward = zone.find((row) => row.effect.stat === (base ? desired[base] : "")) ?? zone[0]!;
  const farmEquivalentStacks = (def.objSec + def.travelSec * TRAVEL_RATE_SHARE) / FARM_SECONDS_PER_MOB;
  const stacks = Math.max(QUEST_MIN_STAT_STACKS, Math.min(
    QUEST_MAX_STAT_STACKS, Math.ceil(farmEquivalentStacks * QUEST_STAT_STACKS_PER_FARM_EQUIVALENT),
  ));
  return { id: reward.id, stacks };
}

/** Fixed reward wording for the quest log and planning screen; all advertised stacks are granted. */
export function questRewardText(def: QuestDef): string {
  const reward = questRewardStats(def);
  const name = MOB_STAT_REWARDS.find((row) => row.id === reward.id)!.name;
  return `${reward.stacks} ${name} stacks (${mobStatText(reward.id, reward.stacks)}) and ${def.reward.gv} GV`;
}

/**
 * The toasts the server sends a player whose `questAccept` was refused (sim/quests.ts handleQuestAccept): one list, so the client can
 * tell a refusal of its accept from any other toast without guessing at wording. The first three are the chest's and the pickup's
 * own words.
 */
export const QUEST_REFUSAL = {
  busy: "Can't do that now",
  far: "Too far away",
  blocked: "Can't reach that",
  over: "That quest is over",
  already: "You already accepted that quest",
} as const;
export const QUEST_REFUSALS: readonly string[] = Object.values(QUEST_REFUSAL);

/** The private toast of a successful accept. */
export const questAcceptedText = (def: Pick<QuestDef, "name">): string => `Quest accepted: ${def.name}`;

/** The refusal of a quest token or parcel that its picker has not accepted the offer for. */
export const questAcceptFirstText = (def: Pick<QuestDef, "name" | "giver">): string => `Accept ${def.name} at ${def.giver} first`;

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
// Everything here reads the map contract only (camps, spawnPool, regions[].pole, the coliseum, tiles and terrain), so it
// holds for any zone shape. Reachability is moveComponents: exactly the tiles findPath can walk between, in one flood per
// map (cached), not a path search per candidate. Every position comes from the stream the caller hands in; the server's is
// the private quest stream, and the known and unknown offers draw from their own passes (placeQuests).

export interface QuestPlacement { def: QuestDef; known: boolean; at: Vec2; tokens?: Vec2[]; parcel?: Vec2 }

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Flat tile index of a world point, or -1 off the map. */
function indexAt(map: GameMap, at: Vec2): number {
  const tx = worldToTile(at.x);
  const ty = worldToTile(at.y);
  return tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? -1 : tileIndex(map, tx, ty);
}

/** The walkable component (moveComponents id) of the tile under `at`, -1 on a wall or off the map. */
function componentAt(map: GameMap, at: Vec2): number {
  const i = indexAt(map, at);
  return i < 0 ? -1 : moveComponents(map)[i]!;
}

/**
 * The walkable component every quest piece must lie in: the one holding the coliseum centre, where everyone is sent when
 * the gates lock. A hand-built map whose centre is a wall uses the component with most spawnPool starts instead, and -1
 * (no restriction) when it has neither.
 */
export function questHomeComponent(map: GameMap): number {
  const home = componentAt(map, map.coliseum.centre);
  if (home >= 0) return home;
  const votes = new Map<number, number>();
  for (const start of map.spawnPool) {
    const c = componentAt(map, start);
    if (c >= 0) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  let best = -1;
  let most = 0;
  for (const [c, n] of votes) if (n > most || (n === most && c < best)) { best = c; most = n; }
  return best;
}

/**
 * The first clear plain-floor tile in a ring search around `want` (out to `maxTiles`) that is not `used`, is no hazard
 * and, when `component` is a number, lies in that walkable component. Nothing is claimed.
 */
function scanFreeTile(
  map: GameMap, want: Vec2, used: ReadonlySet<number>, component: number | null, maxTiles: number, radius: number,
): { at: Vec2; index: number } | null {
  if (component !== null && component < 0) return null;
  const comps = component === null ? null : moveComponents(map);
  const cx = worldToTile(want.x);
  const cy = worldToTile(want.y);
  for (let r = 0; r <= maxTiles; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        const index = tileIndex(map, tx, ty);
        if (used.has(index) || (comps && comps[index] !== component)) continue;
        const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
        if (terrainAt(map, at.x, at.y) !== TERRAIN_NONE || !circleClear(map, at, radius, MASK_MOVE)) continue;
        return { at, index };
      }
    }
  }
  return null;
}

/**
 * A clear plain-floor tile near `want` (ring search out to `maxTiles`; no zone hazard, so a token never lies in embers),
 * not yet `used` and claimed in it, reachable from `origin` when one is given (a floor tile of the same walkable
 * component, so findPath succeeds). radius is the body that must fit there (a player's by default).
 */
export function freeTileNear(
  map: GameMap, want: Vec2, used: Set<number>, origin?: Vec2, maxTiles = 16, radius = PLAYER_RADIUS,
): Vec2 | null {
  const found = scanFreeTile(map, want, used, origin ? componentAt(map, origin) : null, maxTiles, radius);
  if (!found) return null;
  used.add(found.index);
  return found.at;
}

/** Chebyshev distance in tiles. */
const tileDist = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(worldToTile(a.x) - worldToTile(b.x)), Math.abs(worldToTile(a.y) - worldToTile(b.y)));

function outsideColiseum(map: GameMap, tx: number, ty: number, margin = 2): boolean {
  const r = map.coliseum.rect;
  return tx < r.x - margin || tx >= r.x + r.w + margin || ty < r.y - margin || ty >= r.y + r.h + margin;
}

/** Marks every tile whose centre lies within `radius` of `at` (the same test as `distance(at, tile centre) < radius`). */
function markDisc(mask: Uint8Array, map: GameMap, at: Vec2, radius: number): void {
  const reach = Math.ceil(radius / TILE) + 1;
  const cx = worldToTile(at.x);
  const cy = worldToTile(at.y);
  for (let ty = Math.max(0, cy - reach); ty <= Math.min(map.h - 1, cy + reach); ty++) {
    for (let tx = Math.max(0, cx - reach); tx <= Math.min(map.w - 1, cx + reach); tx++) {
      if (Math.hypot(tileToWorldCenter(tx) - at.x, tileToWorldCenter(ty) - at.y) < radius) mask[ty * map.w + tx] = 1;
    }
  }
}

/**
 * Where a giver may stand: plain floor (no wall, low ground or zone hazard) that a player can walk to from the coliseum,
 * outside it, at least three tiles beyond every camp clearing and from every camp chest and mob rest tile, and away from
 * spawnPool entries. Dense maps get a second pass at half the doorstep distance; safety clearances are never relaxed.
 * The camp and start clearances are stamped into one mask first, so the scan itself is a few cheap tests per tile.
 */
export function npcCandidates(map: GameMap): Vec2[] {
  if (map.camps.length === 0 && map.spawnPool.length === 0 && map.regions.length === 0) return [];
  const comps = moveComponents(map);
  const home = questHomeComponent(map);
  const margin = 3 * TILE;
  const camps = new Uint8Array(map.w * map.h);
  for (const c of map.camps) {
    markDisc(camps, map, c, c.r + margin);
    markDisc(camps, map, c.chest, margin);
    for (const spot of c.spots) markDisc(camps, map, spot, margin);
  }
  const scan = (spawnMinTiles: number): Vec2[] => {
    const starts = new Uint8Array(map.w * map.h);
    for (const s of map.spawnPool) markDisc(starts, map, s, spawnMinTiles * TILE);
    const out: Vec2[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const index = tileIndex(map, tx, ty);
        if (camps[index] || starts[index] || !outsideColiseum(map, tx, ty) || blocksTile(map, tx, ty, MASK_MOVE)) continue;
        if (home >= 0 && comps[index] !== home) continue;
        const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
        if (terrainAt(map, at.x, at.y) !== TERRAIN_NONE || !circleClear(map, at, PLAYER_RADIUS, MASK_MOVE)) continue;
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

/**
 * Up to `n` spots: the candidates privately shuffled once, then taken greedily when they keep the gap to every spot
 * already taken and to every `avoid` spot (givers placed earlier). The gap relaxes tile by tile down to half of
 * QUEST_NPC_GAP_TILES when the map runs out of room. Each pick depends on the whole shuffle, never on a single draw.
 */
export function spreadSpots(candidates: Vec2[], n: number, random: () => number, avoid: readonly Vec2[] = []): Vec2[] {
  if (candidates.length === 0 || n <= 0) return [];
  const target = Math.min(n, candidates.length);
  const order = shuffled(candidates, random);
  let best: Vec2[] = [];
  for (let gap = QUEST_NPC_GAP_TILES * TILE; gap >= Math.floor(QUEST_NPC_GAP_TILES / 2) * TILE; gap -= TILE) {
    const taken: Vec2[] = [];
    for (const candidate of order) {
      if (avoid.some((spot) => distance(spot, candidate) < gap) || taken.some((spot) => distance(spot, candidate) < gap)) continue;
      taken.push(candidate);
      if (taken.length >= target) break;
    }
    if (taken.length > best.length) best = taken;
    if (taken.length >= target) break;
  }
  return best;
}

/** Tiles no token or parcel may take: a halo round every camp's chest (1 tile) and mob rest spots (2 tiles). */
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
function campTokens(
  map: GameMap, region: FactionId, giver: Vec2, spawns: number, random: () => number, used: Set<number>,
): Vec2[] {
  const camps = map.camps.filter((c: CampDef) => c.zone === region);
  if (camps.length === 0) return [];
  const camp = camps.reduce((a, b) => distance(a, giver) >= distance(b, giver) ? a : b);
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
function siteTokens(
  map: GameMap, giver: Vec2, ring: "rim" | "mid", spawns: number, random: () => number, used: Set<number>,
): Vec2[] {
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
 * The farthest reachable candidate wins; only that tile is claimed in `used` (the probes of the other sites are not).
 */
function parcelSpot(
  map: GameMap, giver: Vec2, region: FactionId | null, random: () => number, used: Set<number>,
): Vec2 | null {
  const camps = region === null ? map.camps : map.camps.filter((c) => c.zone === region);
  const starts = region === null ? map.spawnPool : map.spawnPool.filter((s) => s.zone === region);
  const pole = region === null ? [] : map.regions.filter((r) => r.id === region).map((r) => r.pole);
  const sites = uniqueSites([...camps, ...starts, ...pole]);
  const source = componentAt(map, giver);
  if (sites.length === 0 || source < 0) return null;
  const start = Math.floor(random() * sites.length);
  let best: { at: Vec2; index: number } | null = null;
  let bestD = -1;
  for (let i = 0; i < sites.length; i++) {
    const found = scanFreeTile(map, sites[(start + i) % sites.length]!, used, source, 12, PLAYER_RADIUS);
    if (!found) continue;
    const d = tileDist(found.at, giver);
    if (d > bestD) { best = found; bestD = d; }
  }
  if (best) used.add(best.index);
  return best ? best.at : null;
}

/** Spots one pass keeps per quest it places, so a region-themed quest can take the one farthest from its pole. */
const SPOT_OVERSAMPLE = 4;

/**
 * How far from every spawn-pool start a hidden giver must stand: the reveal radius plus two tiles. The reveal is a plain
 * distance test with no line of sight, so a giver inside it would reveal itself on the first tick to whoever spawned there
 * and "hidden" would be nominal. A cramped map relaxes this step by step (see hiddenSpots); the known givers keep only the
 * ordinary start clearance of npcCandidates, since they are public anyway.
 */
export const QUEST_HIDDEN_START_CLEARANCES: readonly number[] = [
  QUEST_REVEAL_RADIUS + 2 * TILE, QUEST_REVEAL_RADIUS, QUEST_REVEAL_RADIUS / 2, 0,
];
/** The strictest clearance that leaves this many spots per hidden offer is used (two: the themed pick still has a choice). */
const HIDDEN_MIN_SPOTS_PER_OFFER = 2;

/**
 * Where the hidden pass takes its giver spots: the candidates beyond the strictest start clearance that still leaves room
 * for every hidden offer (HIDDEN_MIN_SPOTS_PER_OFFER each), else the clearance with the most spots. Which clearance applies
 * depends only on the public map, never on the stream; the spots within it come from the private stream as before.
 */
function hiddenSpots(
  map: GameMap, open: readonly Vec2[], offers: number, random: () => number, avoid: readonly Vec2[],
): Vec2[] {
  const want = offers * SPOT_OVERSAMPLE;
  const enough = Math.min(want, offers * HIDDEN_MIN_SPOTS_PER_OFFER);
  let best: Vec2[] = [];
  for (const clearance of QUEST_HIDDEN_START_CLEARANCES) {
    const pool = clearance > 0
      ? open.filter((c) => map.spawnPool.every((s) => distance(c, s) >= clearance))
      : [...open];
    const spots = spreadSpots(pool, want, random, avoid);
    if (spots.length >= enough) return spots;
    if (spots.length > best.length) best = spots;
  }
  return best;
}

export interface PlaceOptions {
  /**
   * The stream the UNKNOWN offers (their givers and pieces) draw from; the known ones draw from `random`. It defaults to
   * `random`: the server passes one private stream, and the split exists so a test can hold the known positions fixed and
   * vary only the hidden pass, proving the five public givers do not determine the five hidden ones.
   */
  hiddenRandom?: () => number;
}

/**
 * Lays the roster out on the map in two passes, the known offers first and then the unknown ones. Each pass shuffles
 * the candidate tiles with its stream and takes spots greedily against the gap (the unknown pass also keeps the gap to the
 * known givers, and stays QUEST_REVEAL_RADIUS + 2 tiles from every spawn-pool start, relaxed only on a cramped map, so it
 * cannot reveal itself to a player on the first tick: see hiddenSpots), so no giver is a function of the public map and the
 * other givers. A region-themed quest takes the pass's spot farthest from its region's pole; its pieces follow. Every piece
 * lies on the giver's walkable component, off the camps' chest and mob-rest halos and off zone hazards, and no two share a
 * tile. A quest whose pieces will not place is dropped rather than placed badly. The returned order is privately shuffled
 * with `random`, so a quest's place in it (the id the server hands out) reveals neither its theme nor its pass.
 */
export function placeQuests(
  map: GameMap, roster: RosterEntry[], random: () => number, options: PlaceOptions = {},
): QuestPlacement[] {
  const candidates = npcCandidates(map);
  if (candidates.length === 0 || roster.length === 0) return [];
  const hiddenRandom = options.hiddenRandom ?? random;
  const used = campItemExclusions(map);
  const givers: Vec2[] = [];
  const out: QuestPlacement[] = [];
  for (const known of [true, false]) {
    const group = roster.filter((entry) => entry.known === known);
    if (group.length === 0) continue;
    const rand = known ? random : hiddenRandom;
    const open = candidates.filter((c) => !used.has(indexAt(map, c)));
    const remaining = known
      ? spreadSpots(open, group.length * SPOT_OVERSAMPLE, rand, givers)
      : hiddenSpots(map, open, group.length, rand, givers);
    const ordered = [...group].sort((a, b) => Number(!!b.def.region) - Number(!!a.def.region));
    const placed: QuestPlacement[] = [];
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
      givers.push(at);
      used.add(indexAt(map, at));
      placed.push({ def: entry.def, known, at });
    }
    for (const placement of placed) {
      const { def, at } = placement;
      if (def.kind === "collect") {
        const spawns = def.tokenSpawns ?? def.count;
        const tokens = def.tokens === "camp" && def.region
          ? campTokens(map, def.region, at, spawns, rand, used)
          : siteTokens(map, at, def.tokens === "rim" ? "rim" : "mid", spawns, rand, used);
        if (tokens.length < def.count) continue;
        placement.tokens = tokens;
      } else if (def.kind === "fetch") {
        const parcel = parcelSpot(map, at, def.region ?? null, rand, used);
        if (!parcel) continue;
        placement.parcel = parcel;
      }
      out.push(placement);
    }
  }
  return shuffled(out, random);
}
