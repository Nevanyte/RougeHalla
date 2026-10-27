// The planning screen's pure maths: the route through a player's waypoints (the shared pathfinder, the walking time at the
// base move speed), how far along it the player is, the sizes of the map views, and the words for a matchup. No DOM here.
import {
  PLAYER_RADIUS, TILE, WORLD_H, WORLD_W, findPath, walkLength, walkSeconds, type GameMap, type Vec2,
} from "@raid/shared";

/** How many stops a route may have. */
export const MAX_WAYPOINTS = 12;
/** A stop counts as reached once the player is this close to it (two tiles). */
export const ROUTE_REACH = 2 * TILE;

/** One reachable stop of a route and where its leg sits in the polyline. */
export interface RouteLeg {
  /** Index in the waypoint list the player drew. */
  wp: number;
  /** Where the leg ends: the waypoint itself, or the nearest floor point when it was drawn on a wall. */
  end: Vec2;
  /** Indexes into `RoutePlan.points`: the leg runs from `from` to `to`. */
  from: number;
  to: number;
}

export interface RoutePlan {
  /** Where the walk starts (the picked spawn), or null before there is one: the route then begins at its first stop. */
  start: Vec2 | null;
  /** The polyline: the start when known, then every leg's waypoints from the shared pathfinder. */
  points: Vec2[];
  legs: RouteLeg[];
  /** Waypoints (indexes in the list drawn) with no path to them; they are left out of the walk. */
  unreachable: number[];
  /** World units walked, and the seconds that takes at the base move speed. */
  length: number;
  seconds: number;
}

/** The route through `waypoints` from `start` over `map` (the gates open, as the planning screen sees it). */
export function planRoute(map: GameMap, start: Vec2 | null, waypoints: readonly Vec2[]): RoutePlan {
  const points: Vec2[] = [];
  const legs: RouteLeg[] = [];
  const unreachable: number[] = [];
  let at: Vec2 | null = start;
  if (start) points.push({ x: start.x, y: start.y });
  waypoints.forEach((wp, i) => {
    if (at === null) {
      // No start yet: the first reachable stop is where the route begins (its own snapped point).
      const snapped = findPath(map, wp, wp, PLAYER_RADIUS);
      if (snapped.length === 0) { unreachable.push(i); return; }
      at = snapped[snapped.length - 1]!;
      points.push(at);
      legs.push({ wp: i, end: at, from: 0, to: 0 });
      return;
    }
    const leg = findPath(map, at, wp, PLAYER_RADIUS);
    if (leg.length === 0) { unreachable.push(i); return; }
    const from = points.length - 1;
    for (const p of leg) points.push(p);
    at = leg[leg.length - 1]!;
    legs.push({ wp: i, end: at, from, to: points.length - 1 });
  });
  const length = points.length > 1 ? walkLength(points[0]!, points.slice(1)) : 0;
  return { start, points, legs, unreachable, length, seconds: walkSeconds(length) };
}

/** What the minimap and the in-run map draw of a route: the polyline still ahead, its stops, and which stop is next (0 = first). */
export interface RouteAhead {
  points: Vec2[];
  stops: Vec2[];
  next: number;
}

/** The part of `plan` from the stop at waypoint index `next` on. Empty once every stop is behind the player. */
export function routeAhead(plan: RoutePlan, next: number): RouteAhead {
  const legs = plan.legs.filter((l) => l.wp >= next);
  if (legs.length === 0) return { points: [], stops: [], next: 0 };
  const first = legs[0]!;
  return { points: plan.points.slice(first.from), stops: legs.map((l) => l.end), next: 0 };
}

/** The index of the stop the player is heading for: past every stop within ROUTE_REACH of `at`, in order, from `next`. */
export function advanceNext(waypoints: readonly Vec2[], next: number, at: Vec2, reach: number = ROUTE_REACH): number {
  let n = next;
  while (n < waypoints.length && Math.hypot(waypoints[n]!.x - at.x, waypoints[n]!.y - at.y) <= reach) n++;
  return n;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** A point inside the world: where a click on the map lands, whatever the pointer did. */
export function clampToWorld(p: Vec2): Vec2 {
  return { x: clamp(p.x, 0, WORLD_W), y: clamp(p.y, 0, WORLD_H) };
}

/**
 * Overlay px above and below the map in its column at the normal text size: the clearance under the top-right buttons, the
 * heading and the bar, the legend and the line that reads a camp, the gaps. A larger text size adds to it.
 */
const MAP_CHROME = 180;

/**
 * Side (overlay px) of the planning screen's map. Wide: beside a column `340 x textScale` wide; narrow (the overlay under 600
 * px): the map above the column, about half the height. The column (heading, map, legend, info) always fits the overlay's height.
 */
export function planningMapSize(uiW: number, uiH: number, textScale = 1): number {
  if (uiW < 600) return clamp(Math.floor(Math.min(uiW - 24, uiH * 0.46)), 180, 520);
  const side = Math.round(340 * textScale);
  const chrome = MAP_CHROME + Math.round((textScale - 1) * 80);
  return clamp(Math.floor(Math.min(uiH - chrome, uiW - side - 48)), 260, 780);
}

/** Side of the lobby preview's map, in the corner of the screen. */
export function previewMapSize(uiW: number, uiH: number): number {
  return clamp(Math.floor(Math.min(uiH * 0.36, uiW * 0.34)), 150, 300);
}

/** Side of the hold-Tab map, centred over the world: the room left under it holds the legend and clears the weapon bar. */
export function fullMapSize(uiW: number, uiH: number): number {
  return clamp(Math.floor(Math.min(uiH - 200, uiW - 48)), 240, 820);
}

/** m:ss for a count of milliseconds, rounded up, never negative. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** m:ss for a count of seconds (a walk's ETA), rounded to the nearest second. */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type MatchupTone = "good" | "even" | "risky" | "lose";

export interface Matchup {
  tone: MatchupTone;
  /** The short chip on the map: a sign, then the hp share left, or "lose". */
  chip: string;
  /** The same in words, for the info line and screen readers. */
  words: string;
}

/** How a duel with a camp's mobs reads: `share` is the part of its own hp the player keeps (0 for a loss or a draw). */
export function describeMatchup(share: number): Matchup {
  const pct = Math.round(share * 100);
  if (!(share > 0)) return { tone: "lose", chip: "lose", words: "you would lose a straight fight" };
  if (share >= 0.5) return { tone: "good", chip: `+${pct}%`, words: `you win a straight fight with ${pct}% hp left` };
  if (share >= 0.2) return { tone: "even", chip: `~${pct}%`, words: `a close fight: ${pct}% hp left` };
  return { tone: "risky", chip: `!${pct}%`, words: `a risky fight: only ${pct}% hp left` };
}

/** The next (dir 1) or previous (dir -1) index of a cycle of `n`, wrapping; -1 from nowhere starts at the ends. */
export function cycleIndex(current: number, n: number, dir: 1 | -1): number {
  if (n <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : n - 1;
  return (current + dir + n) % n;
}
