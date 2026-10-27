// The brain's pathfinding (docs/BOTS.md 1, change 6): shared `findPath` behind a per-tick budget and a short cache. One budget
// is shared by every bot of a room (BOT_PATH_BUDGET_PER_TICK searches a tick, about 0.12 ms each camp to camp on a 136x136 zone-shapes map
// (0.3 ms on the 96x96 R2 ones, 0.1 ms on the old 64x64 one); about 6% of a game's walk answers are over budget), so eight bots thinking at once cannot add up
// to a long step. A search that does not fit the budget is answered with the straight line x 1.3
// (`exact: false`), or, when the same trip was worked out not long ago, with that answer: a walking distance to a camp barely
// moves, and a distance that flips between "A* says 410" and "line says 560" from one think to the next makes goals flap.
//
// The driver owns the clock: it calls `budget.startTick()` once per room step and `paths.setFrame(now, gatesLocked)` once per
// frame (the brain also calls setFrame from every percept it reads, which is the same two values for every bot of a room).
// Nothing here reads a clock or draws a random number.
import { findPath, hasLineOfSight, MASK_MOVE, PLAYER_RADIUS, segmentClear, withGates, type GameMap, type Vec2 } from "@raid/shared";
import { pathLength } from "../mobHunt";
import { BOT_PATH_BUDGET_PER_TICK, type PathService, type ServerMs } from "./types";

/** A cached search is answered without a new one for this long. */
export const PATH_CACHE_MS = 1000;
/** Endpoints are rounded to this (u) to make the cache key: two thinks from a few steps apart share an answer. */
export const PATH_KEY_U = 8;
/** Over budget, a search worked out this recently is still better than a straight-line guess. */
export const PATH_STALE_MS = 8000;
/** Worked-out trips older than this are dropped (swept every PRUNE_EVERY_MS). */
const PATH_KEEP_MS = 20_000;
const PRUNE_EVERY_MS = 4000;
/** The distance guess when a search does not fit the budget. */
export const STRAIGHT_FACTOR = 1.3;

export interface PathBudget {
  /** A new room step: the allowance is whole again. */
  startTick(): void;
  /** One search's worth; false when this step's allowance is spent. */
  take(): boolean;
  /** What is left this step (tests, stats). */
  readonly left: number;
}

export function createPathBudget(perTick: number = BOT_PATH_BUDGET_PER_TICK): PathBudget {
  let left = perTick;
  return {
    startTick() { left = perTick; },
    take() {
      if (left <= 0) return false;
      left--;
      return true;
    },
    get left() { return left; },
  };
}

export interface PathServiceStats {
  /** findPath calls made. */
  readonly searches: number;
  /** Answers served from the cache, fresh or stale. */
  readonly hits: number;
  /** Answers guessed because the budget was spent and nothing usable was cached. */
  readonly fallbacks: number;
}

export type RoomPathService = PathService & {
  /** The frame the next calls are answered for: its server time (the cache's clock) and whether the coliseum gates are locked. */
  setFrame(now: ServerMs, gatesLocked: boolean): void;
  readonly stats: PathServiceStats;
};

interface Trip {
  readonly at: ServerMs;
  /** null = no path (an exact answer, cached like any other). */
  readonly path: readonly Vec2[] | null;
  readonly dist: number;
}

export function createPathService(map: GameMap, budget: PathBudget): RoomPathService {
  let now: ServerMs = 0;
  let gated = false;
  let locked: GameMap | null = null;
  let prunedAt: ServerMs = 0;
  const trips = new Map<string, Trip>();
  const stats = { searches: 0, hits: 0, fallbacks: 0 };

  const collision = (): GameMap => {
    if (!gated) return map;
    locked ??= withGates(map);
    return locked;
  };

  const key = (from: Vec2, to: Vec2): string => {
    const r = (v: number): number => Math.round(v / PATH_KEY_U);
    return `${r(from.x)},${r(from.y)},${r(to.x)},${r(to.y)},${gated ? 1 : 0}`;
  };

  const finite = (a: Vec2, b: Vec2): boolean => Number.isFinite(a.x + a.y + b.x + b.y);

  /** The trip's answer: a fresh cached one, a new search if the budget allows, a stale cached one, else null (over budget). */
  function trip(from: Vec2, to: Vec2): Trip | null {
    const k = key(from, to);
    const cached = trips.get(k);
    if (cached && now - cached.at < PATH_CACHE_MS) {
      stats.hits++;
      return cached;
    }
    if (budget.take()) {
      stats.searches++;
      const path = findPath(collision(), from, to);
      const fresh: Trip = path.length === 0 ? { at: now, path: null, dist: Infinity } : { at: now, path, dist: pathLength(from, path) };
      trips.set(k, fresh);
      return fresh;
    }
    if (cached && now - cached.at < PATH_STALE_MS) {
      stats.hits++;
      return cached;
    }
    stats.fallbacks++;
    return null;
  }

  function prune(): void {
    prunedAt = now;
    for (const [k, t] of trips) if (now - t.at > PATH_KEEP_MS) trips.delete(k);
  }

  return {
    setFrame(t, gatesLocked) {
      now = t;
      gated = gatesLocked;
      if (now - prunedAt > PRUNE_EVERY_MS || now < prunedAt) prune();
    },
    walk(from, to) {
      if (!finite(from, to)) return null;
      const t = trip(from, to);
      if (t === null) return { dist: Math.hypot(to.x - from.x, to.y - from.y) * STRAIGHT_FACTOR, exact: false };
      return t.path === null ? null : { dist: t.dist, exact: true };
    },
    path(from, to) {
      if (!finite(from, to)) return null;
      return trip(from, to)?.path ?? null;
    },
    // Sight (walls only) for what is seen and shot; the move mask (walls and low ground) for where a body can walk in a line.
    los: (a, b) => hasLineOfSight(collision(), a, b),
    clear: (a, b) => segmentClear(collision(), a, b, PLAYER_RADIUS, MASK_MOVE),
    collisionMap: collision,
    get stats() { return stats; },
  };
}
