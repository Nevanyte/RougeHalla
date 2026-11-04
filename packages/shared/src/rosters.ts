// Camp rosters (ROGUELIKE_PLAN D5, balance contract 6.4): which mob type stands in which camp, and which stat its kills pay. Pure: the
// caller supplies the random stream, and the SERVER hands in `world.rewardRandom`, never `world.random` and never anything derived
// from the public seed (D16), so a client cannot read a camp's roster off the map. Every camp is mono-type: its normal mobs share
// one type of its own zone, and an elite camp holds one elite at its elite spot (the rest of that camp is its normal type).
//
// Camp buffs (owner request 2026-11: "each zone a theme of the buffs it gives, mob buffs with a max distance, as even a spread of
// camp buffs as possible"). A camp's BUFF is the stat kind its normal kills pay, one of the nine of MOB_STAT_KEYS; a zone's THEME is
// the four its own normal types pay. The roll, `rollCampRosters`:
//   1. The draw (2n - 1 numbers for n camps, whatever the map's zones): the camps in a shuffled order, each drawing its buff with
//      weight theme x need x balance: theme 1 for the zone's four and CAMP_BUFF_OFF_THEME_WEIGHT for the other five; need
//      1 + (d / REF)^2, d the distance to the nearest camp already given the buff (capped), so a buff nobody near has is likely;
//      balance (even share / (count + 1))^POWER, so no buff runs far past an even share.
//   2. The repair (no draws, at most CAMP_BUFF_REPAIR_STEPS moves): the best single change of one camp's buff, or swap of two camps'
//      buffs, by first the coverage excess (summed over camps and buffs: how far the nearest camp of the buff lies past the camp's
//      bound, `campBuffBounds`: CAMP_BUFF_MAX_DISTANCE_TILES, or the camp's ninth-nearest-camp distance where that is farther), then
//      the count band (every buff on floor(n / 9) to ceil(n / 9) camps), then the number of camps on their zone's theme. It stops
//      when no move improves that order, so a valid draw only gains theme, and the result is a local optimum near the draw.
//   3. The types: a camp whose buff is on its theme has the zone type that pays it (an Ember Imp camp still pays damage, buff "");
//      any other has the zone's type used least so far (camp order; a tie in catalog order counted from the camp's index: role
//      variety), and `buff` names the type that pays its stat in the zone nearest it that has it on theme (spill-over: an Offense
//      camp in the Fire zone pays the Sentenced Pardoner's stat). A camp's mob type is never another zone's: a mob's faction, role,
//      weapon and art come from it.
// The elite of an elite camp is no draw at all: the k-th elite camp of a zone (camps order, `eliteSpot >= 0`) holds the k-th of
// `elitesOf(zone)`, wrapping past the second. Elites pay no stat; an elite camp's normal mobs pay its buff.
import type { CampDef } from "./map";
import {
  CAMP_BUFF_BALANCE_POWER, CAMP_BUFF_MAX_DISTANCE_TILES, CAMP_BUFF_NEED_CAP_TILES, CAMP_BUFF_NEED_REF_TILES, CAMP_BUFF_OFF_THEME_WEIGHT,
  CAMP_BUFF_REPAIR_STEPS, TILE,
} from "./constants";
import { FACTION_IDS, type FactionId } from "./factions";
import { elitesOf, normalTypesOf, type MobTypeId } from "./mobs";
import { MOB_STAT_KEYS, mobStatKey, mobStatReward } from "./mobStats";
import { shuffle, type Rng } from "./rng";

/** What `rollCampRosters` reads of a camp: its zone and its centre (world units). */
export type CampSite = Pick<CampDef, "zone" | "x" | "y">;

/** One camp's roll. */
export interface CampRoll {
  /** The camp's normal mob type: always one of its own zone's four. */
  type: MobTypeId;
  /** The normal type whose stat its normal kills pay when that is not `type` (an out-of-theme buff), "" when it is. */
  buff: MobTypeId | "";
}

/** The stat kind (MOB_STAT_KEYS) a normal type pays; undefined for an elite or an unknown id. */
export function statKeyOf(id: string): string | undefined {
  const reward = mobStatReward(id);
  return reward ? mobStatKey(reward) : undefined;
}

/** The four stat kinds a zone's normal types pay: its theme. */
export function zoneTheme(zone: FactionId): string[] {
  return MOB_STAT_KEYS.filter((_k, b) => zoneStatTypes(zone)[b] !== undefined);
}

const B = MOB_STAT_KEYS.length;
const FAR = 1 << 28;

/** Centre-to-centre distances in whole world units, row-major n x n. */
function distances(camps: readonly CampSite[]): Int32Array {
  const n = camps.length;
  const d = new Int32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = camps[i]!.x - camps[j]!.x, dy = camps[i]!.y - camps[j]!.y;
      const v = Math.round(Math.sqrt(dx * dx + dy * dy));
      d[i * n + j] = v;
      d[j * n + i] = v;
    }
  }
  return d;
}

function boundsOf(d: Int32Array, n: number): Int32Array {
  const out = new Int32Array(n);
  const floor = Math.round(CAMP_BUFF_MAX_DISTANCE_TILES * TILE);
  // A camp sees every buff within r only if nine camps (itself included) lie within r: the ninth nearest is the least any roll can do.
  const k = Math.min(B, n) - 1;
  const row: number[] = new Array(n);
  for (let c = 0; c < n; c++) {
    for (let j = 0; j < n; j++) row[j] = d[c * n + j]!;
    row.sort((a, b) => a - b);
    out[c] = Math.max(floor, row[k]!);
  }
  return out;
}

/**
 * The distance (world units, whole) each camp is held to: CAMP_BUFF_MAX_DISTANCE_TILES, or the distance to its ninth nearest camp
 * (itself the first) where that is farther, since no roll can put nine buffs within less.
 */
export function campBuffBounds(camps: readonly CampSite[]): number[] {
  return Array.from(boundsOf(distances(camps), camps.length));
}

/**
 * For every camp, the distance (world units, whole) to the nearest camp paying each stat kind, in MOB_STAT_KEYS order (0 for its
 * own; Infinity when no camp pays it). `rewards[i]` is camp i's reward type (`campRewardId`: the buff, else the type).
 */
export function campBuffDistances(camps: readonly CampSite[], rewards: readonly string[]): number[][] {
  const n = camps.length;
  const d = distances(camps);
  const stat = rewards.map((id) => MOB_STAT_KEYS.indexOf(statKeyOf(id) ?? ""));
  return camps.map((_, c) => MOB_STAT_KEYS.map((_k, b) => {
    let best = Infinity;
    for (let j = 0; j < n; j++) if (stat[j] === b && d[c * n + j]! < best) best = d[c * n + j]!;
    return best;
  }));
}

/** Phase 1: the weighted draw. Returns each camp's stat index (into MOB_STAT_KEYS). */
function drawBuffs(n: number, d: Int32Array, theme: Uint8Array, rng: Rng): Int32Array {
  const stat = new Int32Array(n).fill(-1);
  const count = new Int32Array(B);
  const cap = CAMP_BUFF_NEED_CAP_TILES * TILE;
  const ref = CAMP_BUFF_NEED_REF_TILES * TILE;
  // near[c * B + b]: distance from camp c to the nearest camp given b so far, capped.
  const near = new Float64Array(n * B).fill(cap);
  const share = n / B;
  const order = shuffle(rng, Array.from({ length: n }, (_, i) => i));
  const w = new Float64Array(B);
  for (const c of order) {
    let total = 0;
    for (let b = 0; b < B; b++) {
      const r = near[c * B + b]! / ref;
      const bal = share / (count[b]! + 1);
      let balance = 1;
      for (let p = 0; p < CAMP_BUFF_BALANCE_POWER; p++) balance *= bal;
      const v = (theme[c * B + b] ? 1 : CAMP_BUFF_OFF_THEME_WEIGHT) * (1 + r * r) * balance;
      w[b] = v;
      total += v;
    }
    let x = rng() * total;
    let pick = B - 1;
    for (let b = 0; b < B; b++) {
      x -= w[b]!;
      if (x < 0) { pick = b; break; }
    }
    stat[c] = pick;
    count[pick]!++;
    for (let j = 0; j < n; j++) {
      const v = d[j * n + c]!;
      if (v < near[j * B + pick]!) near[j * B + pick] = v;
    }
  }
  return stat;
}

/** Phase 2: the repair. Changes `stat` in place by the best improving move until none improves (or the step budget runs out). */
function repairBuffs(n: number, d: Int32Array, theme: Uint8Array, stat: Int32Array): void {
  // With fewer camps than buffs some buff is missing whatever the roll: coverage cannot hold, so only the counts and theme count.
  const cover = n >= B;
  const bound = boundsOf(d, n);
  const lo = Math.floor(n / B), hi = Math.ceil(n / B);
  const count = new Int32Array(B);
  for (let c = 0; c < n; c++) count[stat[c]!]!++;
  // Per buff b and camp c: the nearest camp of b (index, distance) and the second nearest's distance.
  const nearI = new Int32Array(B * n), d1 = new Int32Array(B * n), d2 = new Int32Array(B * n);
  const ex = new Float64Array(B);
  const rebuild = (b: number): void => {
    let sum = 0;
    for (let c = 0; c < n; c++) {
      let bi = -1, bd = FAR, sd = FAR;
      for (let j = 0; j < n; j++) {
        if (stat[j] !== b) continue;
        const v = d[c * n + j]!;
        if (v < bd) { sd = bd; bd = v; bi = j; } else if (v < sd) sd = v;
      }
      nearI[b * n + c] = bi; d1[b * n + c] = bd; d2[b * n + c] = sd;
      if (cover && bd > bound[c]!) sum += bd - bound[c]!;
    }
    ex[b] = sum;
  };
  for (let b = 0; b < B; b++) rebuild(b);
  // The excess of buff b once camp `rem` (or -1) leaves it and camp `add` (or -1) joins it.
  const exAfter = (b: number, rem: number, add: number): number => {
    if (!cover) return 0;
    let sum = 0;
    for (let c = 0; c < n; c++) {
      let v = rem >= 0 && nearI[b * n + c] === rem ? d2[b * n + c]! : d1[b * n + c]!;
      if (add >= 0 && d[c * n + add]! < v) v = d[c * n + add]!;
      if (v > bound[c]!) sum += v - bound[c]!;
    }
    return sum;
  };
  const band = (k: number): number => (k < lo ? lo - k : k > hi ? k - hi : 0);
  for (let step = 0; step < CAMP_BUFF_REPAIR_STEPS; step++) {
    // The best move by (coverage excess, count band, -theme) changes, folded into one whole number: the excess is whole world units,
    // the band change lies in -2..2 and the theme change in -2..2, so key = 25 dEx + 5 dCv - dTh orders them as that triple.
    // Only a move below 0 improves; the first found wins a tie (camp order, then buff order, then the swap's other camp).
    let bestKey = 0, bestK = -1, bestL = -1, bestB = -1;
    // A move's excess change is at least minus the excess of the buffs it gives a camp (a buff that loses a camp only gets worse):
    // a move that could not win even at that bound is not costed, which leaves the coverage sums to the few moves that can.
    for (let k = 0; k < n; k++) {
      const a = stat[k]!;
      const thA = theme[k * B + a]!;
      let exLeft = NaN;
      for (let b = 0; b < B; b++) {
        if (b === a) continue;
        const rest = 5 * (band(count[a]! - 1) + band(count[b]! + 1) - band(count[a]!) - band(count[b]!)) - (theme[k * B + b]! - thA);
        if (!(rest - 25 * ex[b]! < bestKey)) continue;
        if (exLeft !== exLeft) exLeft = exAfter(a, k, -1) - ex[a]!;
        const key = 25 * (exLeft + exAfter(b, -1, k) - ex[b]!) + rest;
        if (key < bestKey) { bestKey = key; bestK = k; bestL = -1; bestB = b; }
      }
      for (let l = k + 1; l < n; l++) {
        const b = stat[l]!;
        if (b === a) continue;
        // A swap keeps the counts.
        const rest = thA + theme[l * B + b]! - theme[k * B + b]! - theme[l * B + a]!;
        if (!(rest - 25 * (ex[a]! + ex[b]!) < bestKey)) continue;
        const key = 25 * (exAfter(a, k, l) - ex[a]! + exAfter(b, l, k) - ex[b]!) + rest;
        if (key < bestKey) { bestKey = key; bestK = k; bestL = l; bestB = b; }
      }
    }
    if (bestK < 0) return;
    const a = stat[bestK]!;
    stat[bestK] = bestB;
    if (bestL >= 0) stat[bestL] = a;
    else { count[a]!--; count[bestB]!++; }
    rebuild(a);
    rebuild(bestB);
  }
}

/**
 * Every camp's roll, in camp order: its normal type and, when the buff its normal kills pay is off its zone's theme, the type that
 * pays it (the header has the rule). Draws 2n - 1 numbers for n camps (n - 1 for the shuffle, one buff draw a camp), so the draw
 * count is fixed by the map alone; nothing for a map with no camps.
 */
export function rollCampRosters(camps: readonly CampSite[], rng: Rng): CampRoll[] {
  const n = camps.length;
  if (n === 0) return [];
  const d = distances(camps);
  const theme = new Uint8Array(n * B);
  camps.forEach((camp, c) => {
    const own = zoneStatTypes(camp.zone);
    for (let b = 0; b < B; b++) theme[c * B + b] = own[b] !== undefined ? 1 : 0;
  });
  const stat = drawBuffs(n, d, theme, rng);
  repairBuffs(n, d, theme, stat);

  // Phase 3: types. On theme: the zone's type that pays the buff. Off theme: the zone's least used type, the buff from the nearest zone.
  const used = new Map<MobTypeId, number>();
  const out: CampRoll[] = new Array(n);
  for (let c = 0; c < n; c++) {
    const t = zoneStatTypes(camps[c]!.zone)[stat[c]!];
    if (t === undefined) continue;
    out[c] = { type: t, buff: "" };
    used.set(t, (used.get(t) ?? 0) + 1);
  }
  for (let c = 0; c < n; c++) {
    if (out[c] !== undefined) continue;
    let type: MobTypeId | undefined;
    let least = Infinity;
    // A tie goes to the first in catalog order counted from the camp's index, so ties do not always favour the zone's first type.
    const types = normalTypesOf(camps[c]!.zone);
    for (let k = 0; k < types.length; k++) {
      const t = types[(c + k) % types.length]!;
      const u = used.get(t.id) ?? 0;
      if (u < least) { least = u; type = t.id; }
    }
    used.set(type!, least + 1);
    out[c] = { type: type!, buff: spillType(camps, d, c, stat[c]!) };
  }
  return out;
}

const zoneStats = new Map<FactionId, ReadonlyArray<MobTypeId | undefined>>();

/** By stat index (MOB_STAT_KEYS), the zone's normal type that pays it, or undefined off its theme. */
function zoneStatTypes(zone: FactionId): ReadonlyArray<MobTypeId | undefined> {
  let row = zoneStats.get(zone);
  if (!row) {
    const types = normalTypesOf(zone);
    row = MOB_STAT_KEYS.map((key) => types.find((t) => statKeyOf(t.id) === key)?.id);
    zoneStats.set(zone, row);
  }
  return row;
}

/** The type that pays stat `b` in the zone of the nearest camp (camp order on a tie) whose zone has it on theme. */
function spillType(camps: readonly CampSite[], d: Int32Array, c: number, b: number): MobTypeId {
  const n = camps.length;
  let best: MobTypeId | undefined;
  let bestD = Infinity;
  for (let j = 0; j < n; j++) {
    const t = zoneStatTypes(camps[j]!.zone)[b];
    if (t !== undefined && d[c * n + j]! < bestD) { bestD = d[c * n + j]!; best = t; }
  }
  // No zone of this map has it on theme (a hand-built map): the first zone's in catalog order.
  for (let z = 0; best === undefined && z < FACTION_IDS.length; z++) best = zoneStatTypes(FACTION_IDS[z]!)[b];
  return best!;
}

/**
 * The elite type of every camp, in camp order: "" for a camp without an elite (`eliteSpot < 0`), else the k-th of the zone's
 * elites, k counting the zone's elite camps in camp order (so with two elite camps in a zone they hold one each, and with a
 * single one it holds the first). Draws nothing.
 */
export function rollCampElites(camps: ReadonlyArray<Pick<CampDef, "zone" | "eliteSpot">>): Array<MobTypeId | ""> {
  const seen = new Map<FactionId, number>();
  return camps.map((camp) => {
    if (!(camp.eliteSpot >= 0)) return "";
    const k = seen.get(camp.zone) ?? 0;
    seen.set(camp.zone, k + 1);
    const elites = elitesOf(camp.zone);
    return elites[k % elites.length]!.id;
  });
}

/**
 * What stands at each of the camp's spots, in `spots` order: the camp's elite (`eliteType`, the zone's first elite when left
 * out) at `eliteSpot` (none for -1), the camp's normal type everywhere else.
 */
export function campMobs(
  camp: Pick<CampDef, "zone" | "spots" | "eliteSpot">, campType: MobTypeId, eliteType?: MobTypeId,
): Array<{ type: MobTypeId; elite: boolean }> {
  const elite = eliteType ?? elitesOf(camp.zone)[0]!.id;
  return camp.spots.map((_, i) => (i === camp.eliteSpot ? { type: elite, elite: true } : { type: campType, elite: false }));
}
