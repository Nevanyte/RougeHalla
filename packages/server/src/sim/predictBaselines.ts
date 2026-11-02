// Movement-prediction baselines and how they are scored against a trace (sim/trace.ts rows; bench/predictBench.ts runs it).
// The question a learned predictor has to answer is "where will this player be h ms from now?", and these are the answers it
// must beat. Pure: a predictor sees only the present row, a short past and the walk order in force, never a later row.
//
// What each baseline knows: `hold` and `constantVelocity` use only what a remote client sees (positions), so they are the only two it
// could run today. `holdLastSteer` and `pathFollow` read server-only information (the orders and the path in hand), so they are an
// upper bound on what a remote client could do if the walk goal were synced. On main a WASD walk is a stream of ordinary `move`
// orders to a goal 8 to 64 u ahead (about 375 ms of walking), so `holdLastSteer` saturates beyond the default 300 ms horizon.
import { FISTS, isRanged, PLAYER_SPEED, TICK_MS, type Vec2 } from "@raid/shared";
import type { TraceRow } from "./trace";

/** The point of the last applied move or attack-move order. */
export interface MoveIntent { x: number; y: number }

export interface PredictContext {
  /** The present: the player at the end of the tick the prediction is made from. */
  row: TraceRow;
  /** Up to PAST_TICKS of this player's earlier rows, oldest first, ending with `row` (contiguous ticks of one life). */
  past: readonly TraceRow[];
  /** The last applied move/attackMove still in force: null after a stop, after a lock that took, or before any. */
  lastMove: MoveIntent | null;
}

/** Where the player will be `horizonMs` after `ctx.row`. */
export type Predictor = (ctx: PredictContext, horizonMs: number) => Vec2;

/** How much past a predictor is handed (ticks). */
export const PAST_TICKS = 20;
/** Above this speed (u/s, over the last 100 ms) a player counts as moving. */
export const MOVING_SPEED = 20;
/** A tick's step shorter than this (u) is standing still (10 u/s). */
export const STEP_EPS = 0.5;
/** A one-tick jump longer than this (u) is a forced move (blink, teleport), not a walk: no predictor is scored across one. */
export const DISPLACE_JUMP = 40;
/** A heading change beyond this (rad) within the horizon is a turn: straight-line extrapolation must miss it. */
export const TURN_ANGLE = Math.PI / 4;
/** A hit landed or taken this recently (ms) counts as in combat. */
export const COMBAT_WINDOW_MS = 1000;

/** The speed the player walks at now when it walks: the move modifiers' product, or the speed mirror when a stun zeroes it. */
export function walkingSpeed(row: TraceRow): number {
  return PLAYER_SPEED * (row.walkMult > 0 ? row.walkMult : row.speedMult);
}

/**
 * How many ms of the next `horizonMs` the player can walk, given the root it is known to have ahead. Tick by tick, as the sim
 * walks: the step that ends at server time T is walked unless rootFrom <= T < rootUntil.
 */
export function walkMs(row: TraceRow, horizonMs: number): number {
  if (row.rootUntil === null || row.rootFrom === null) return row.rooted ? 0 : horizonMs;
  let walk = 0;
  for (let t = 0; t < horizonMs; t += TICK_MS) {
    const at = row.serverTime + t + TICK_MS;
    if (!(at >= row.rootFrom && at < row.rootUntil)) walk += Math.min(TICK_MS, horizonMs - t);
  }
  return walk;
}

/** `dist` along the waypoints from `from`, stopping at the last one (advanceAlongPath without the facing). */
export function walkAlong(from: Vec2, path: readonly Vec2[], dist: number): Vec2 {
  let x = from.x;
  let y = from.y;
  let budget = dist;
  for (const q of path) {
    if (!(budget > 0)) break;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d <= budget) { x = q.x; y = q.y; budget -= d; }
    else { x += ((q.x - x) / d) * budget; y += ((q.y - y) / d) * budget; budget = 0; }
  }
  return { x, y };
}

/** Stays where it is. */
export const hold: Predictor = ({ row }) => ({ x: row.x, y: row.y });

/** Keeps the velocity of the last 100 ms (movement.ts velocityOf): dead reckoning, all a remote client can do. */
export const constantVelocity: Predictor = ({ row }, h) => ({ x: row.x + (row.vx * h) / 1000, y: row.y + (row.vy * h) / 1000 });

/**
 * Walks straight at the point of the last move order still in force, at the player's walking speed with its known root
 * ahead, and stops there: it knows the intent (as the local client does) but not the path around walls. Holds without one.
 */
export const holdLastSteer: Predictor = ({ row, lastMove }, h) =>
  lastMove ? walkAlong(row, [lastMove], (walkingSpeed(row) * walkMs(row, h)) / 1000) : { x: row.x, y: row.y };

/**
 * Walks the server's own path in hand at the player's walking speed with its known root ahead, and stops at its end. The
 * strongest prediction the server can make without guessing the next order: what a learned model has to beat.
 */
export const pathFollow: Predictor = ({ row }, h) => walkAlong(row, row.path, (walkingSpeed(row) * walkMs(row, h)) / 1000);

export const BASELINES: Readonly<Record<string, Predictor>> = { hold, constantVelocity, holdLastSteer, pathFollow };

/** The splits every error is also reported under. */
export const SPLITS = ["all", "melee", "ranged", "unarmed", "combat", "calm", "moving", "still"] as const;
export type Split = (typeof SPLITS)[number];

export interface ErrorStats { n: number; mean: number; p95: number }

export interface HorizonReport {
  horizonMs: number;
  /** Samples scored (rows with a truth `horizonMs` later in the same life and no forced move in between). */
  samples: number;
  /** Rows not scored: the life or the run ended within the horizon, or a forced move happened in it. */
  dropped: { ended: number; displaced: number };
  /**
   * Of the scored samples: `moving` ones, of which `turned` changed heading by more than TURN_ANGLE and `stopped` stood still
   * for a tick within the horizon; `still` ones, of which `started` walked.
   */
  heading: { moving: number; turned: number; stopped: number; still: number; started: number };
  /** Displacement error (u) by predictor, then split. */
  errors: Record<string, Record<Split, ErrorStats>>;
}

export interface EvalReport {
  rows: number;
  runs: number;
  /** Player lives traced (a run and a player id). */
  players: number;
  horizons: HorizonReport[];
}

export interface EvalOptions {
  horizons: readonly number[];
  predictors?: Readonly<Record<string, Predictor>>;
  combatWindowMs?: number;
}

/** Rows grouped by (run, player), each in tick order. */
export function seriesOf(rows: Iterable<TraceRow>): TraceRow[][] {
  const by = new Map<string, TraceRow[]>();
  for (const r of rows) {
    const key = `${r.run}\u0000${r.id}`;
    const list = by.get(key);
    if (list) list.push(r);
    else by.set(key, [r]);
  }
  const out = [...by.values()];
  for (const list of out) list.sort((a, b) => a.tick - b.tick);
  return out;
}

/** The walk order in force after `row`'s own orders, given the one in force before. */
export function nextMove(before: MoveIntent | null, row: TraceRow): MoveIntent | null {
  let m = before;
  for (const o of row.orders) {
    if (o.k === "move" || o.k === "attackMove") m = { x: o.x, y: o.y };
    else if (o.k === "stop") m = null;
    // A lock that took replaces the walk (a refused one, e.g. any weapon but the wand, leaves it).
    else if (o.k === "target" && row.lock === o.id) m = null;
  }
  return m;
}

function isJump(a: TraceRow, b: TraceRow): boolean {
  return a.displaceSeq !== b.displaceSeq || Math.hypot(b.x - a.x, b.y - a.y) > DISPLACE_JUMP;
}

/** An empty hand fights with fists on main (`weapon` is "fists", not null), and that is unarmed, not melee. */
function weaponSplit(row: TraceRow): Split {
  return row.weapon === null || row.weapon === FISTS ? "unarmed" : isRanged(row.weapon) ? "ranged" : "melee";
}

function inCombat(row: TraceRow, windowMs: number): boolean {
  return row.lock !== null || row.action !== null || (row.lastHitAt !== null && row.serverTime - row.lastHitAt <= windowMs);
}

function statsOf(errors: number[]): ErrorStats {
  const n = errors.length;
  if (n === 0) return { n: 0, mean: 0, p95: 0 };
  let sum = 0;
  for (const e of errors) sum += e;
  const sorted = errors.slice().sort((a, b) => a - b);
  return { n, mean: sum / n, p95: sorted[Math.max(0, Math.ceil(0.95 * n) - 1)]! };
}

/** Scores every predictor at every horizon on every row that has a truth to compare with. */
export function evaluate(rows: readonly TraceRow[], opts: EvalOptions): EvalReport {
  const predictors = opts.predictors ?? BASELINES;
  const names = Object.keys(predictors);
  const combatWindowMs = opts.combatWindowMs ?? COMBAT_WINDOW_MS;
  const series = seriesOf(rows);
  const acc = opts.horizons.map((horizonMs) => ({
    horizonMs,
    samples: 0,
    dropped: { ended: 0, displaced: 0 },
    heading: { moving: 0, turned: 0, stopped: 0, still: 0, started: 0 },
    errors: Object.fromEntries(names.map((n) => [n, Object.fromEntries(SPLITS.map((s) => [s, [] as number[]]))])) as Record<string, Record<Split, number[]>>,
  }));

  for (const list of series) {
    let lastMove: MoveIntent | null = null;
    let lifeStart = 0;
    for (let i = 0; i < list.length; i++) {
      const row = list[i]!;
      if (i > 0 && row.tick !== list[i - 1]!.tick + 1) { lifeStart = i; lastMove = null; }
      lastMove = nextMove(lastMove, row);
      const ctx: PredictContext = { row, past: list.slice(Math.max(lifeStart, i - PAST_TICKS), i + 1), lastMove };
      const moving = Math.hypot(row.vx, row.vy) > MOVING_SPEED;
      const splits: Split[] = ["all", weaponSplit(row), inCombat(row, combatWindowMs) ? "combat" : "calm", moving ? "moving" : "still"];
      for (const a of acc) {
        const steps = Math.ceil(a.horizonMs / TICK_MS);
        const last = list[i + steps];
        if (!last || last.tick !== row.tick + steps) { a.dropped.ended++; continue; }
        let jumped = false;
        let turned = false;
        let stopped = false;
        let started = false;
        for (let j = i + 1; j <= i + steps; j++) {
          const p = list[j - 1]!;
          const q = list[j]!;
          if (isJump(p, q)) { jumped = true; break; }
          const sx = q.x - p.x;
          const sy = q.y - p.y;
          const len = Math.hypot(sx, sy);
          if (!moving) { if (len >= STEP_EPS) started = true; continue; }
          if (len < STEP_EPS) { stopped = true; continue; }
          const cos = (sx * row.vx + sy * row.vy) / (len * Math.hypot(row.vx, row.vy));
          if (Math.acos(Math.max(-1, Math.min(1, cos))) > TURN_ANGLE) turned = true;
        }
        if (jumped) { a.dropped.displaced++; continue; }
        a.samples++;
        if (moving) {
          a.heading.moving++;
          if (turned) a.heading.turned++;
          if (stopped) a.heading.stopped++;
        } else {
          a.heading.still++;
          if (started) a.heading.started++;
        }
        const truth = truthAt(list, i, a.horizonMs);
        for (const name of names) {
          const p = predictors[name]!(ctx, a.horizonMs);
          const err = Math.hypot(p.x - truth.x, p.y - truth.y);
          const bySplit = a.errors[name]!;
          for (const s of splits) bySplit[s].push(err);
        }
      }
    }
  }

  return {
    rows: rows.length,
    runs: new Set(rows.map((r) => r.run)).size,
    players: series.length,
    horizons: acc.map((a) => ({
      horizonMs: a.horizonMs,
      samples: a.samples,
      dropped: a.dropped,
      heading: a.heading,
      errors: Object.fromEntries(names.map((n) => [
        n, Object.fromEntries(SPLITS.map((s) => [s, statsOf(a.errors[n]![s])])) as Record<Split, ErrorStats>,
      ])),
    })),
  };
}

/** The true position `horizonMs` after list[i], between ticks if the horizon is not a whole number of them. */
function truthAt(list: readonly TraceRow[], i: number, horizonMs: number): Vec2 {
  const whole = Math.floor(horizonMs / TICK_MS);
  const frac = horizonMs / TICK_MS - whole;
  const a = list[i + whole]!;
  if (frac === 0) return { x: a.x, y: a.y };
  const b = list[i + whole + 1]!;
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}
