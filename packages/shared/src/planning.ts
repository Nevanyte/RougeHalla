// The planning screen's pure maths (roguelike R3), shared so the server's deal, the bots and the client's planning screen
// read the same numbers: how far each spawn of the pool walks to the coliseum, which two walks count as one tier, the
// camps near a spawn and how a faction fares against a camp. The deal itself (who is dealt what) is the server's
// (server/src/sim/planning.ts): it draws from a private stream, so nothing here can predict it.
import { PLAN_WALK_TOLERANCE, PLAYER_RADIUS, PLAYER_SPEED } from "./constants";
import { duel, FACTIONS, type FactionId } from "./factions";
import type { CampDef, GameMap } from "./map";
import type { Vec2 } from "./messages";
import { mobFaction } from "./mobs";
import { findPath } from "./pathfind";

const walksCache = new WeakMap<GameMap, readonly number[]>();

/** Length of a walk from `from` through `points` (findPath's waypoints, which leave `from` out). */
export function walkLength(from: Vec2, points: readonly Vec2[]): number {
  let total = 0;
  let at = from;
  for (const p of points) {
    total += Math.hypot(p.x - at.x, p.y - at.y);
    at = p;
  }
  return total;
}

/**
 * Walking distance (world units) from each `map.spawnPool` entry to the coliseum centre over the map as generated (gates
 * open), by the shared pathfinder: the same number on the server and every client. Infinity for a spawn with no path.
 * Cached per map object (24-32 path searches on a zone map, about 4 ms in all: the server's map worker primes it, see primeSpawnWalks).
 */
export function spawnWalks(map: GameMap): readonly number[] {
  let out = walksCache.get(map);
  if (!out) {
    const centre = map.coliseum.centre;
    out = map.spawnPool.map((s) => {
      const path = findPath(map, s, centre, PLAYER_RADIUS);
      return path.length === 0 ? Infinity : walkLength(s, path);
    });
    walksCache.set(map, out);
  }
  return out;
}

/**
 * Hands `map` the walks `spawnWalks` would compute, worked out elsewhere: the server's map worker computes them right
 * after certifying and ships them with the map, so the room's first planning tick (the deal) never runs the 30 path
 * searches on the event loop. Only a list with one finite-or-infinite number per pool spawn is taken, and never over walks
 * already cached; returns whether it was taken. The caller vouches that they are this map's own.
 */
export function primeSpawnWalks(map: GameMap, walks: readonly number[]): boolean {
  if (walksCache.has(map) || !Array.isArray(walks) || walks.length !== map.spawnPool.length) return false;
  for (const v of walks) if (typeof v !== "number" || Number.isNaN(v) || v < 0) return false;
  walksCache.set(map, walks.slice());
  return true;
}

/** Seconds a walk of `distance` takes at the base PLAYER_SPEED (the planning screen's ETA). */
export function walkSeconds(distance: number): number {
  return distance / PLAYER_SPEED;
}

/** The largest longer/shorter walk ratio of one tier: both within `tolerance` either side of one shared contour value. */
export function tierRatio(tolerance = PLAN_WALK_TOLERANCE): number {
  return (1 + tolerance) / (1 - tolerance);
}

/**
 * True when walks `a` and `b` lie in one walking-distance tier: there is a contour value c with both inside
 * [c(1 - t), c(1 + t)]. Two unreachable spawns are never one tier.
 */
export function sameTier(a: number, b: number, tolerance = PLAN_WALK_TOLERANCE): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  return Math.max(a, b) <= tierRatio(tolerance) * Math.min(a, b) * (1 + 1e-12);
}

/** The camps of `map` nearest `at` (straight line to the camp centre), nearest first, at most `n`. */
export function nearestCamps(map: GameMap, at: Vec2, n: number): CampDef[] {
  return map.camps
    .map((c) => ({ c, d: Math.hypot(c.x - at.x, c.y - at.y) }))
    .sort((p, q) => p.d - q.d || (p.c.id < q.c.id ? -1 : p.c.id > q.c.id ? 1 : 0))
    .slice(0, Math.max(0, n))
    .map((e) => e.c);
}

/** True for an elite camp (its elite rests at `eliteSpot`). */
export function isEliteCamp(camp: Pick<CampDef, "eliteSpot">): boolean {
  return camp.eliteSpot >= 0;
}

const shares = new Map<string, number>();

/**
 * The share of its own hp a player of `me` keeps after a straight duel with a mob of `region` (shared `duel` against the
 * mob's scaled faction: the table in GAME_DESIGN 11), 0 for a loss or a draw. It ignores weapons, leashes and kiting, so it
 * says who can afford a fight, not how it will go. Cached: a handful of 10 ms duels per process. The planning screen shows
 * it per camp; the bots farm and plan by it.
 */
export function matchupShare(me: FactionId, region: FactionId, elite: boolean): number {
  const key = `${me}/${region}/${elite ? "e" : "m"}`;
  let share = shares.get(key);
  if (share === undefined) {
    const d = duel(FACTIONS[me], mobFaction(region, elite), 0.01);
    share = d.winner === 0 ? d.hpA / FACTIONS[me].hp : 0;
    shares.set(key, share);
  }
  return share;
}

/** matchupShare against one camp: an elite camp counts as its elite (the harder fight). */
export function campMatchup(me: FactionId, camp: Pick<CampDef, "zone" | "eliteSpot">): number {
  return matchupShare(me, camp.zone, isEliteCamp(camp));
}
