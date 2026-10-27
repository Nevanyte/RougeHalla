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

// ---------------------------------------------------------------------------------------------------- legibility on a big map
// A 136 x 136 map has 40 camps (at least 9 tiles apart, two elites a zone), 5 zone labels and, while planning, 2 spawn marks. On the
// small corner preview the marks are about as big as the room between camps (a camp is 1.1 to 2.2 px a tile there, so nine tiles are
// 10 to 20 px against a 12 px marker), so the screen decides what fits: a camp's matchup chip hides
// when its box would meet another mark (it shows again while its camp is hovered or focused), and a zone's name moves off the
// camps to the nearest free spot inside its zone. All of it in overlay pixels from the sizes planning.css gives the marks.

/** A rectangle in overlay pixels, from its top-left corner. */
export interface PxBox { x: number; y: number; w: number; h: number }

const boxesMeet = (a: PxBox, b: PxBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `--pl-glyph`: how big the marks are for a map `size` overlay pixels wide (planning.ts writes it, planning.css reads it). */
export function glyphScale(size: number): number {
  return Math.round(Math.min(1.25, Math.max(0.55, size / 640)) * 100) / 100;
}

/** The side of a camp's marker (planning.css: 22 px, an elite's 30, never under 12 and 16). */
export function campMarkerPx(elite: boolean, glyph: number): number {
  return Math.max(elite ? 16 : 12, (elite ? 30 : 22) * glyph);
}

/** A matchup chip's box for a text `chars` long: the font is max(9, 10.5 x text x glyph), tabular figures, 4 px of padding a side. */
export function chipSizePx(chars: number, glyph: number, textScale: number): { w: number; h: number } {
  const font = Math.max(9, 10.5 * textScale * glyph);
  return { w: Math.ceil(chars * 0.62 * font + 10), h: Math.ceil(font * 1.35 + 2) };
}

/** A camp as the layout sees it: its centre on the map in overlay pixels, whether it is an elite, and how long its chip's text is. */
export interface CampSpot { x: number; y: number; elite: boolean; chars: number }

/** A camp's marker box, with an elite's crown above it. */
function markerBox(c: CampSpot, glyph: number): PxBox {
  const m = campMarkerPx(c.elite, glyph);
  const crown = c.elite ? m * 0.4 : 0;
  return { x: c.x - m / 2, y: c.y - m / 2 - crown, w: m, h: m + crown };
}

/**
 * Which camps' chips are crowded out: true at the index of a camp whose chip (just under its marker) would sit on another camp's
 * marker, on a shown chip, or on one of `marks` (the dealt spawns). Elites are placed first, then the rest in order, so the chips
 * that stay are the same on every client for one map and size. A chip with no text (no faction yet) never takes room.
 */
export function crowdedChips(camps: readonly CampSpot[], marks: readonly PxBox[], glyph: number, textScale: number): boolean[] {
  const markers = camps.map((c) => markerBox(c, glyph));
  const crowded = camps.map(() => false);
  const placed: PxBox[] = [];
  const order = camps.map((_c, i) => i).sort((a, b) => Number(camps[b]!.elite) - Number(camps[a]!.elite) || a - b);
  for (const i of order) {
    const c = camps[i]!;
    if (c.chars === 0) continue;
    const { w, h } = chipSizePx(c.chars, glyph, textScale);
    const box = { x: c.x - w / 2, y: c.y + campMarkerPx(c.elite, glyph) / 2 + 1, w, h };
    const blocked = markers.some((m, j) => j !== i && boxesMeet(box, m)) || marks.some((m) => boxesMeet(box, m)) || placed.some((p) => boxesMeet(box, p));
    if (blocked) crowded[i] = true;
    else placed.push(box);
  }
  return crowded;
}

/** Every box the camps take on the map: each marker, and each chip that is not crowded out. */
export function campBoxes(camps: readonly CampSpot[], crowded: readonly boolean[], glyph: number, textScale: number): PxBox[] {
  const out: PxBox[] = [];
  camps.forEach((c, i) => {
    out.push(markerBox(c, glyph));
    if (c.chars > 0 && !crowded[i]) {
      const { w, h } = chipSizePx(c.chars, glyph, textScale);
      out.push({ x: c.x - w / 2, y: c.y + campMarkerPx(c.elite, glyph) / 2 + 1, w, h });
    }
  });
  return out;
}

/** A zone's name to place: where it would like to be (its pole), and how big the text is. */
export interface LabelWish { x: number; y: number; w: number; h: number; inside: (x: number, y: number) => boolean }

/** The size of a zone label's box for a name `chars` long (planning.css: bold, uppercase, 0.1 em of letter spacing, a glyph before it). */
export function labelSizePx(chars: number, glyph: number, textScale: number): { w: number; h: number } {
  const font = Math.max(9, 11 * textScale * glyph);
  return { w: Math.ceil(chars * 0.8 * font + font + 6), h: Math.ceil(font * 1.3) };
}

/**
 * Where each zone's label goes (its centre, overlay pixels): its wish if the box is free, else the nearest spot on rings around the
 * wish (every 12 px, up to 120) where the whole box lies inside the map and the zone (`inside` is asked at its centre, ends and
 * middle top and bottom) and meets no obstacle and no label placed before it. A zone with no free spot keeps its wish.
 */
export function placeLabels(wishes: readonly LabelWish[], obstacles: readonly PxBox[], size: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const taken: PxBox[] = [];
  const fits = (wish: LabelWish, x: number, y: number): PxBox | null => {
    const box = { x: x - wish.w / 2, y: y - wish.h / 2, w: wish.w, h: wish.h };
    if (box.x < 0 || box.y < 0 || box.x + box.w > size || box.y + box.h > size) return null;
    const samples: Array<[number, number]> = [[x, y], [box.x, y], [box.x + box.w, y], [x, box.y], [x, box.y + box.h]];
    if (!samples.every(([sx, sy]) => wish.inside(sx, sy))) return null;
    return obstacles.some((o) => boxesMeet(box, o)) || taken.some((t) => boxesMeet(box, t)) ? null : box;
  };
  for (const wish of wishes) {
    let best = fits(wish, wish.x, wish.y) ? { x: wish.x, y: wish.y } : null;
    for (let r = 12; !best && r <= 120; r += 12) {
      const steps = Math.max(8, Math.round((2 * Math.PI * r) / 14));
      let bestAt = Infinity;
      for (let k = 0; k < steps; k++) {
        const a = (2 * Math.PI * k) / steps;
        const x = wish.x + Math.cos(a) * r;
        const y = wish.y + Math.sin(a) * r;
        if (!fits(wish, x, y)) continue;
        // On one ring they are all about r away; the one nearest the map's centre keeps the name off the border.
        const d = Math.hypot(x - size / 2, y - size / 2);
        if (d < bestAt) { bestAt = d; best = { x, y }; }
      }
    }
    const at = best ?? { x: wish.x, y: wish.y };
    out.push(at);
    taken.push({ x: at.x - wish.w / 2, y: at.y - wish.h / 2, w: wish.w, h: wish.h });
  }
  return out;
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

/**
 * Page Down / Page Up on the map's markers: `zones` names the zone of each marker in reading order ("" for a marker that is no camp:
 * a spawn, a route stop). Returns the index of the first marker of the next (dir 1) or previous (dir -1) zone, in the order the
 * zones first appear, wrapping; from a marker with no zone, the first zone going on and the last going back. -1 when no marker has one.
 */
export function zoneJump(zones: readonly string[], current: number, dir: 1 | -1): number {
  const order: string[] = [];
  for (const z of zones) if (z !== "" && !order.includes(z)) order.push(z);
  if (order.length === 0) return -1;
  const here = current >= 0 && current < zones.length ? order.indexOf(zones[current]!) : -1;
  const to = here < 0 ? (dir === 1 ? 0 : order.length - 1) : (here + dir + order.length) % order.length;
  return zones.indexOf(order[to]!);
}

/** The next (dir 1) or previous (dir -1) index of a cycle of `n`, wrapping; -1 from nowhere starts at the ends. */
export function cycleIndex(current: number, n: number, dir: 1 | -1): number {
  if (n <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : n - 1;
  return (current + dir + n) % n;
}
