// The shrinking safe zone: a plan made once per raid, then a pure function of elapsed time.
//
// Every circle lies fully inside the one before it, so the safe area only ever shrinks, and the last
// circle is centred on one extract: whoever is still alive ends up fighting over the same exit.
// Deterministic given the `random` it is handed (no Math.random here). The server plans with its
// private RNG and writes zoneAt() into state each tick; clients only ever read that state.

import {
  TILE, ZONE_DPS, ZONE_DRIFT_FRACTION, ZONE_FINAL_RADIUS, ZONE_HOLD_FRACTION, ZONE_STAGES,
  ZONE_TIMELINE_FRACTION,
} from "./constants";
import type { GameMap } from "./map";

export interface ZoneCircle { x: number; y: number; r: number }

/** One hold-then-shrink step. All times are ms from raid start. */
export interface ZoneStage {
  /** The circle this stage shrinks to. */
  target: ZoneCircle;
  holdStart: number;
  shrinkStart: number;
  end: number;
}

export interface ZonePlan {
  raidMs: number;
  /** The extract the zone collapses onto. */
  extractId: string;
  /** Covers the whole map, so nobody is outside before the first shrink. */
  start: ZoneCircle;
  final: ZoneCircle;
  /** ZONE_STAGES + 1 stages; the last one's target is `final`. */
  stages: ZoneStage[];
  /** When the final circle is reached (the last stage's end). It then stays until the raid ends. */
  timelineMs: number;
}

/**
 * What the sim writes into ZoneState. `stage` counts 1..stages.length from the first hold on and
 * stays at stages.length once the final circle is reached; `shrinking` tells the last stage's hold
 * from its collapse. 0 ("no zone yet") is never produced here: it is the state before the raid.
 */
export interface ZoneSnapshot {
  x: number;
  y: number;
  r: number;
  nextX: number;
  nextY: number;
  nextR: number;
  stage: number;
  shrinking: boolean;
  /** ms from raid start when the current hold or shrink ends (raidMs once the final circle is reached). */
  changeAtElapsed: number;
}

/** Centres stay this far inside the world edge: the outermost tile ring is always wall. */
const CENTRE_INSET = TILE;
/** Keeps float noise from pushing a centre a hair past the bound it was fitted to. */
const FIT_EPSILON = 1e-6;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Picks the final extract, then builds the circles forward:
 * - circle 1 is centred on the map and large enough to hold every extract zone, so the first stage
 *   reveals nothing about which extract the zone will close on;
 * - each later circle lies inside the previous one AND still contains the final circle, which pins
 *   the zone down gradually (the final extract only becomes obvious over the last stages);
 * - radii fall geometrically from circle 1 to ZONE_FINAL_RADIUS.
 */
export function planZone(map: GameMap, raidMs: number, random: () => number): ZonePlan {
  const extracts = map.extracts;
  if (extracts.length === 0) throw new RangeError("planZone: the map has no extracts");
  const extract = extracts[Math.min(extracts.length - 1, Math.floor(random() * extracts.length))]!;

  const worldW = map.w * TILE;
  const worldH = map.h * TILE;
  const final: ZoneCircle = { x: extract.x, y: extract.y, r: ZONE_FINAL_RADIUS };
  const centre = { x: worldW / 2, y: worldH / 2 };
  // Circle 1 must hold every extract's final circle (so it says nothing about which one is chosen).
  let farthest = 0;
  for (const e of extracts) farthest = Math.max(farthest, dist(e, centre) + Math.max(e.r, final.r));
  const first: ZoneCircle = { ...centre, r: farthest + TILE };
  const start: ZoneCircle = { ...centre, r: Math.max(Math.hypot(worldW, worldH) / 2 + TILE, first.r) };

  const count = ZONE_STAGES + 1;
  // circles[0] = start, circles[1] = first, ..., circles[count] = final.
  const circles: ZoneCircle[] = [start, first];
  for (let k = 2; k < count; k++) {
    const prev = circles[k - 1]!;
    const r = first.r * (final.r / first.r) ** ((k - 1) / (count - 1));
    circles.push({ ...placeNested(prev, r, final, worldW, worldH, random), r });
  }
  circles.push(final);

  const timelineMs = Number.isFinite(raidMs) && raidMs > 0 ? raidMs * ZONE_TIMELINE_FRACTION : 0;
  const stages: ZoneStage[] = [];
  let holdStart = 0;
  for (let i = 0; i < count; i++) {
    const end = i === count - 1 ? timelineMs : (timelineMs * (i + 1)) / count;
    stages.push({ target: { ...circles[i + 1]! }, holdStart, shrinkStart: holdStart + (end - holdStart) * ZONE_HOLD_FRACTION, end });
    holdStart = end;
  }

  return {
    raidMs: Number.isFinite(raidMs) && raidMs > 0 ? raidMs : 0,
    extractId: extract.id,
    start,
    final,
    stages,
    timelineMs,
  };
}

/**
 * A centre for a circle of radius `r` that lies inside `prev` and contains `final`: a random point of
 * the lens disc(prev, prev.r − r) ∩ disc(final, r − final.r). The lens is never empty because `final`
 * lies inside `prev`. Sampled directly (no rejection): a position along the final→prev axis inside
 * the lens, then a sideways offset within the lens' half-width there, both shrunk by
 * ZONE_DRIFT_FRACTION so the result sits strictly inside.
 */
function placeNested(
  prev: ZoneCircle, r: number, final: ZoneCircle, worldW: number, worldH: number, random: () => number,
): { x: number; y: number } {
  const a = Math.max(0, prev.r - r);
  const b = Math.max(0, r - final.r);
  const d = dist(prev, final);
  const inWorld = (c: { x: number; y: number }) =>
    c.x >= CENTRE_INSET && c.x <= worldW - CENTRE_INSET && c.y >= CENTRE_INSET && c.y <= worldH - CENTRE_INSET;
  if (d < FIT_EPSILON) {
    const angle = random() * Math.PI * 2;
    const m = Math.min(a, b) * ZONE_DRIFT_FRACTION * Math.sqrt(random());
    const c = { x: final.x + Math.cos(angle) * m, y: final.y + Math.sin(angle) * m };
    return inWorld(c) ? c : { x: final.x, y: final.y };
  }
  const ux = (prev.x - final.x) / d;
  const uy = (prev.y - final.y) / d;
  // Distance from final along the axis: inside disc(final, b) and inside disc(prev, a).
  const lo = Math.max(0, d - a);
  const hi = Math.min(b, d);
  const mid = (lo + hi) / 2;
  const along = mid + (hi - lo) / 2 * ZONE_DRIFT_FRACTION * (random() * 2 - 1);
  const halfWidth = Math.min(
    Math.sqrt(Math.max(0, b * b - along * along)),
    Math.sqrt(Math.max(0, a * a - (d - along) ** 2)),
  );
  const side = halfWidth * ZONE_DRIFT_FRACTION * (random() * 2 - 1);
  const onAxis = { x: final.x + ux * along, y: final.y + uy * along };
  const c = { x: onAxis.x - uy * side, y: onAxis.y + ux * side };
  return inWorld(c) ? c : onAxis;
}

/** The zone at `elapsedMs` after raid start (clamped to >= 0). Continuous in time; see ZoneSnapshot. */
export function zoneAt(plan: ZonePlan, elapsedMs: number): ZoneSnapshot {
  const t = elapsedMs > 0 ? elapsedMs : 0;
  let prev = plan.start;
  for (let i = 0; i < plan.stages.length; i++) {
    const s = plan.stages[i]!;
    if (t < s.end) {
      const stage = i + 1;
      if (t < s.shrinkStart) {
        return {
          x: prev.x, y: prev.y, r: prev.r,
          nextX: s.target.x, nextY: s.target.y, nextR: s.target.r,
          stage, shrinking: false, changeAtElapsed: s.shrinkStart,
        };
      }
      // t is in [shrinkStart, end), so end > shrinkStart.
      const k = (t - s.shrinkStart) / (s.end - s.shrinkStart);
      return {
        x: prev.x + (s.target.x - prev.x) * k,
        y: prev.y + (s.target.y - prev.y) * k,
        r: prev.r + (s.target.r - prev.r) * k,
        nextX: s.target.x, nextY: s.target.y, nextR: s.target.r,
        stage, shrinking: true, changeAtElapsed: s.end,
      };
    }
    prev = s.target;
  }
  const f = plan.final;
  return {
    x: f.x, y: f.y, r: f.r, nextX: f.x, nextY: f.y, nextR: f.r,
    stage: plan.stages.length, shrinking: false, changeAtElapsed: plan.raidMs,
  };
}

/** Every circle in order: the start circle, then each stage's target (the last is the final circle). */
export function zoneCircles(plan: ZonePlan): ZoneCircle[] {
  return [plan.start, ...plan.stages.map((s) => s.target)];
}

/**
 * Damage per second outside the zone: ZONE_DPS times the stage, so it ramps from ZONE_DPS in the
 * first stage to ZONE_DPS * (ZONE_STAGES + 1) at the final circle. Stage 0 (no zone yet) is harmless.
 */
export function zoneDps(stage: number): number {
  return stage > 0 ? ZONE_DPS * stage : 0;
}

/**
 * True when (x, y) is beyond the circle's edge. A zone with r = 0 (stage 0, before the raid) is
 * "no zone", not a point: callers check the stage before treating "outside" as dangerous.
 */
export function isOutside(zone: ZoneCircle, x: number, y: number): boolean {
  return Math.hypot(x - zone.x, y - zone.y) > zone.r;
}
