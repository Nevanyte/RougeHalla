// Sanctum (holy): The Hypostyle (zone-shapes contract 4.5, options doc 6.5 option 2). A pillared hall fills the heart of the zone: a
// strict grid of whole 3x3 piers on a 6-tile pitch (3-wide aisles) laid on the zone's main axis round the spot where the most piers
// fit near the zone's deepest tile, with long views only down the aisles and holy light in the central bays. Outside the hall, open
// ground: nothing else is built. Two shrines (the landmark) stand round it, doors toward it.
//
// Everything is integer arithmetic over fixed offset tables (no trig, no floats beyond Math.sqrt/round in the radius and the zone's
// own axis), and the styler draws no random number: the hall is an argmax, so a zone's hall depends on that zone's tiles alone.
//
// The hall frame. `u` runs along the zone's main axis (axis 0: u = x, axis 1: u = y), `v` across it, both from the hall centre tile
// (cx, cy), which is the centre of the central aisle crossing. A pier is the 3x3 at (u0..u0+2, v0..v0+2) with u0 = 2 + 6i, v0 = 2 +
// 6j, so the aisles are the strips u (or v) in [6a - 1, 6a + 1] and the crossings are centred on multiples of 6 from the centre.
// A pier is built whole (one placeFeature group each) or not at all. The feature "hall" records:
//   anchor (ax, ay) = the hall centre tile; p = [axis, 6, radius, piers, lightBays]
//   piers     = piers standing (the walls the feature owns are 9 x piers), lightBays = light bays the surface pass lights (the 3x3 round
//               each crossing's centre); floor = every tile within `radius` of the centre (and every planned pier's footprint) that is zone FLOOR,
//               unprotected and not owned yet: the aisles, plus the footprint of a pier that was left out.
// For the client art (WP6): the lattice is origin (cx, cy), pitch 6, pier offsets above; the standing piers are the hall's WALL
// tiles in featureGrid; the lit bays are its TERRAIN_LIGHT tiles.
import { TILE_FLOOR, TILE_WALL } from "../map";
import type { MapFeature } from "../map";
import { TERRAIN_LIGHT } from "../terrain";
import { randInt } from "../rng";
import { DIR16, ROUTE_STRETCH_MAX, dirSep16, dist2, isqrt } from "./features";
import { placeLandmark, stampFits, stampTemplate } from "./landmarks";
import type { LandmarkTemplate, Stamp } from "./landmarks";
import { chance, roomOf, wall } from "./kit";
import type { Rect } from "./kit";
import { PROP } from "./propKinds";
import { LANDMARKS_PER_ZONE, areaScale, lenScale, sizeScale } from "./scale";
import type { BaseCtx, BlockKind, LandmarkCtx, PropCtx, RouteGuard, ShapeCtx, SurfaceCtx, ZoneInfo, ZoneStyler } from "./types";

// ================================================================================================ the Hypostyle (WP5)
/** The aisle pitch: pier 3 + aisle 3 (fixed: sizes tied to a fighter do not scale with the zone). */
export const HALL_PITCH = 6;
/** The hall radius at the reference zone (1710 tiles): 13; it grows with the square root of the area, clamped to 11-19. */
const HALL_R_REF = 13;
const HALL_R_MIN = 11;
const HALL_R_MAX = 19;
/** Piers the guard must leave standing for the hall to exist (placeFeature `minGroups`). */
const HALL_MIN_PIERS = 4;
/** Score of a centre candidate: 8 per pier that fits whole, minus the distance to the pole in tiles, plus a bonus on the shrine line. */
const PIER_SCORE = 8;
const LINE_BONUS = 4;
/** Route-guard measurements a zone may spend (contract 3.9: at most 6): up to 4 while thinning, one for the corridor fallback, one for the record. */
const STRETCH_TRIES = 4;
const STRETCH_BUDGET = 6;
/** A shrine's box centre lies `R + SHRINE_GAP` out from the hall centre, or further by `SHRINE_EXTRAS` (cheapest first, see hallLandmarks). */
const SHRINE_GAP = 4;
const SHRINE_EXTRAS: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, -2, -4, -6, -8, -10, -12];
/** Cost of one DIR16 step (22.5 degrees) away from the wanted direction, in tiles; a tile closer in than R + 4 costs this many. */
const SHRINE_TURN_COST = 3;
const SHRINE_INWARD_COST = 3;

/** The shrine (zone-shapes contract 5.2; jobs landmark + rest): a closed hall with a lit nave, doors in its bottom row. */
export const SHRINE: LandmarkTemplate = {
  key: "shrine",
  jobs: ["landmark", "rest"],
  rows: [
    "#########",
    "#c.....c#",
    "#..lll..#",
    "#..lll..#",
    "#..lll..#",
    "##.....##",
    "###ddd###",
  ],
};
/** Sanctum's landmark templates (the generator's crates re-stamp a landmark from its feature record). */
export const SANCTUM_TEMPLATES: readonly LandmarkTemplate[] = [SHRINE];

/** What the Hypostyle built: handed from `shape` to `surface` and `props`, and read by the tests and printZone. */
export interface HypostylePlan {
  /** Did the hall stand (at least HALL_MIN_PIERS piers)? When false every other field is empty. */
  hall: boolean;
  /** The hall centre tile (x, y) and axis: 0 = u along x, 1 = u along y. */
  cx: number;
  cy: number;
  axis: 0 | 1;
  radius: number;
  /** Centre tiles of the piers that stand. */
  piers: number[];
  /** Piers the guard was asked for after the route guard's pruning (the guard may still refuse one). */
  planned: number;
  /** Centre tiles of the light bays (the feature's p[4]) and of those the surface pass lit. */
  bays: number[];
  lit: number[];
  /** Floor tiles the hall owns (the aisles). */
  floor: number[];
  /** Hall feature id in the attempt's log (-1 when none). */
  feature: number;
  /** The route guard's worst member stretch with the piers standing, permille (0 = not measured), and the measurements spent. */
  stretch: number;
  measures: number;
  /** Shrine light tiles the surface pass lit. */
  shrineLit: number;
}

interface HallLayout {
  readonly r: number;
  /** Pier offsets (u0, v0), centre first. */
  readonly piers: ReadonlyArray<readonly [number, number]>;
  /** (du, dv) of every tile of the hall's floor region. */
  readonly floor: ReadonlyArray<readonly [number, number]>;
  /** Light bay offsets (u, v) of the crossing centres. */
  readonly bays: ReadonlyArray<readonly [number, number]>;
}

const LAYOUTS = new Map<number, HallLayout>();

/** The hall's fixed offset tables for radius `r`: piers whose centre lies within r of the centre, the floor region, the light bays. */
export function hallLayout(r: number): HallLayout {
  let l = LAYOUTS.get(r);
  if (l) return l;
  const piers: Array<[number, number]> = [];
  for (let i = -4; i <= 3; i++) {
    for (let j = -4; j <= 3; j++) {
      const u0 = HALL_PITCH * i + 2, v0 = HALL_PITCH * j + 2;
      const cu = u0 + 1, cv = v0 + 1;
      if (cu * cu + cv * cv <= r * r) piers.push([u0, v0]);
    }
  }
  // centre out (squared distance of the pier centre), then u0, then v0: a total order, so the write order never depends on the loops
  piers.sort((a, b) => (a[0] + 1) * (a[0] + 1) + (a[1] + 1) * (a[1] + 1) - ((b[0] + 1) * (b[0] + 1) + (b[1] + 1) * (b[1] + 1)) || a[0] - b[0] || a[1] - b[1]);
  const SIDE = 49, OFF = 24;
  const mark = new Uint8Array(SIDE * SIDE);
  for (let dv = -OFF; dv <= OFF; dv++) for (let du = -OFF; du <= OFF; du++) if (du * du + dv * dv <= r * r) mark[(dv + OFF) * SIDE + du + OFF] = 1;
  for (const [u0, v0] of piers) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) mark[(v0 + b + OFF) * SIDE + u0 + a + OFF] = 1;
  const floor: Array<[number, number]> = [];
  for (let dv = -OFF; dv <= OFF; dv++) for (let du = -OFF; du <= OFF; du++) if (mark[(dv + OFF) * SIDE + du + OFF]) floor.push([du, dv]);
  const bays: Array<[number, number]> = [[0, 0], [HALL_PITCH, 0], [-HALL_PITCH, 0], [0, HALL_PITCH], [0, -HALL_PITCH]];
  if (r >= 16) bays.push([2 * HALL_PITCH, 0], [-2 * HALL_PITCH, 0], [0, 2 * HALL_PITCH], [0, -2 * HALL_PITCH]);
  l = { r, piers, floor, bays };
  LAYOUTS.set(r, l);
  return l;
}

/** The hall radius of a zone of `painted` tiles: round(13 x sqrt(painted / 1710)), clamped to 11-19 (19 at 136x136). */
export function hallRadius(painted: number): number {
  const r = Math.round(HALL_R_REF * lenScale(painted));
  return r < HALL_R_MIN ? HALL_R_MIN : r > HALL_R_MAX ? HALL_R_MAX : r;
}

/** u along x (0) when the zone's major axis leans more to x than to y, else along y (1). */
export function hallAxis(zone: ZoneInfo): 0 | 1 {
  return Math.abs(zone.axis.x) >= Math.abs(zone.axis.y) ? 0 : 1;
}

/** The scan of one pass: the centre it chose, how many piers fit there, and the 3x3 window map it scored them on. */
interface Scan {
  x: number;
  y: number;
  k: number;
  score: number;
  /** win[i] = 1 when the 3x3 whose top-left tile is i is all buildable. */
  win: Uint8Array;
  /** Summed-area table (bbox-sized, (bw + 1) x (bh + 1)) of the zone tiles that are NOT unprotected FLOOR: a box with sum 0 fits a shrine. */
  bad: Int32Array;
}

/** Two shrines' box centres in doubled tile units (a tile centre is odd), or null unless two stand. */
type ShrineLine = readonly [number, number, number, number] | null;

function shrineLandmarks(c: BaseCtx): MapFeature[] {
  return c.zoneFeatures().filter((f) => f.kind === "landmark" && f.variant === "shrine");
}

function lineOfShrines(c: BaseCtx): ShrineLine {
  const s = shrineLandmarks(c);
  if (s.length !== 2) return null;
  const a = s[0].bbox, b = s[1].bbox;
  return [2 * a.x + a.w, 2 * a.y + a.h, 2 * b.x + b.w, 2 * b.y + b.h];
}

/**
 * The hall's centre by argmax (contract 4.5.3): candidates every 2 tiles of the zone's box from 2 tiles in, whose 3x3 is zone FLOOR
 * and not protected; k = piers whose nine tiles are buildable (`isOpen`); score = 8k - the distance to the pole (floor of the root),
 * + 4 within 2 tiles of the line through the two shrines. Ties: the lowest tile index. `k` is 0 (and the centre the pole) when fewer
 * than HALL_MIN_PIERS piers fit anywhere. The windows come from two passes over the zone's box (a 3x3 AND per tile), so a candidate
 * costs 32 lookups.
 */
function scanCentre(c: BaseCtx, isOpen: (i: number) => boolean, axis: 0 | 1, r: number, line: ShrineLine): Scan {
  const { w, h, mask, tiles, hard, zone } = c;
  const n = w * h;
  const bb = zone.bbox;
  const ok = new Uint8Array(n), floor = new Uint8Array(n);
  const x0 = bb.x, y0 = bb.y, x1 = bb.x + bb.w, y1 = bb.y + bb.h;
  const bad = new Int32Array((bb.w + 1) * (bb.h + 1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      let nf = 1;
      if (mask[i] === 1) {
        if (tiles[i] === TILE_FLOOR && hard[i] === 0) { floor[i] = 1; nf = 0; }
        if (nf === 0 && isOpen(i)) ok[i] = 1; // open implies unprotected zone FLOOR
      }
      const s = (y - y0 + 1) * (bb.w + 1) + x - x0 + 1;
      bad[s] = bad[s - 1] + bad[s - bb.w - 1] - bad[s - bb.w - 2] + nf;
    }
  }
  // 3x3 windows by their top-left tile
  const win = new Uint8Array(n), cwin = new Uint8Array(n);
  for (let y = y0; y < y1 - 2; y++) {
    for (let x = x0; x < x1 - 2; x++) {
      const i = y * w + x;
      if (ok[i] && ok[i + 1] && ok[i + 2] && ok[i + w] && ok[i + w + 1] && ok[i + w + 2] && ok[i + 2 * w] && ok[i + 2 * w + 1] && ok[i + 2 * w + 2]) win[i] = 1;
      if (floor[i] && floor[i + 1] && floor[i + 2] && floor[i + w] && floor[i + w + 1] && floor[i + w + 2] && floor[i + 2 * w] && floor[i + 2 * w + 1] && floor[i + 2 * w + 2]) cwin[i] = 1;
    }
  }
  const piers = hallLayout(r).piers;
  const np = piers.length;
  // flat offsets of the piers' top-left tiles from the centre tile, valid while the whole hall is inside the grid
  const delta = new Int32Array(np);
  for (let q = 0; q < np; q++) delta[q] = axis === 0 ? piers[q][1] * w + piers[q][0] : piers[q][0] * w + piers[q][1];
  const reach = 4 * HALL_PITCH; // every pier tile lies within 22 of the centre
  const px = zone.pole.x, py = zone.pole.y;
  let best: Scan = { x: px, y: py, k: 0, score: 0, win, bad };
  for (let y = y0 + 2; y < y1 - 2; y += 2) {
    for (let x = x0 + 2; x < x1 - 2; x += 2) {
      if (!cwin[(y - 1) * w + x - 1]) continue;
      let k = 0;
      if (x >= reach && y >= reach && x < w - reach && y < h - reach) {
        const base = y * w + x;
        for (let q = 0; q < np; q++) k += win[base + delta[q]];
      } else {
        for (let q = 0; q < np; q++) {
          const tx = x + (axis === 0 ? piers[q][0] : piers[q][1]), ty = y + (axis === 0 ? piers[q][1] : piers[q][0]);
          if (tx >= 0 && ty >= 0 && tx < w && ty < h) k += win[ty * w + tx];
        }
      }
      let score = PIER_SCORE * k - isqrt(dist2(x, y, px, py));
      if (line !== null) {
        // within 2 tiles of the line through the shrines: cross^2 <= (4 |ab|)^2 in doubled units
        const ax = line[0], ay = line[1], bx = line[2] - ax, by = line[3] - ay;
        const cross = (2 * x + 1 - ax) * by - (2 * y + 1 - ay) * bx;
        if (cross * cross <= 16 * (bx * bx + by * by)) score += LINE_BONUS;
      }
      if (k >= HALL_MIN_PIERS && (best.k === 0 || score > best.score)) best = { x, y, k, score, win, bad };
    }
  }
  return best;
}

/**
 * The shrine whose box is centred `d` tiles from (cx, cy) along DIR16 direction `k`, turned toward that point: the cardinal side
 * that faces back at it carries the doors (the template's bottom row). The box is 7 deep along the facing and 9 across, so a shrine
 * on the hall's axis meets the central aisle with its three doors.
 */
function shrineSpot(cx: number, cy: number, k: number, d: number): { x0: number; y0: number; rot: 0 | 1 | 2 | 3 } {
  const sx = cx + Math.floor((DIR16[k][0] * d + 512) / 1024), sy = cy + Math.floor((DIR16[k][1] * d + 512) / 1024);
  const vx = cx - sx, vy = cy - sy;
  // the hall lies west of the shrine: the doors face west, which is the template turned once; east, three times; north, twice
  const horizontal = (vx < 0 ? -vx : vx) >= (vy < 0 ? -vy : vy);
  const rot = horizontal ? (vx < 0 ? 1 : 3) : vy < 0 ? 2 : 0;
  return horizontal ? { x0: sx - 3, y0: sy - 4, rot } : { x0: sx - 4, y0: sy - 3, rot };
}

/**
 * The landmark pass (contract 4.5.8): up to two shrines round the hall's estimated centre (the scan of step 3 on the static rules,
 * no corridors yet), doors toward it. The first goes to an end of the hall's axis, `R + 4` out, else 2 further, then 2 more (the
 * contract), else the cheapest slot that fits; the second to the opposite side. A slot costs 3 per 22.5 degrees off the wanted
 * direction plus its distance beyond `R + 4` (3 per tile inside it). Deviation from the contract, which tries only the three slots
 * on the axis: a zone is a wedge or an L about 60 tiles across, rarely deep enough on its axis for a hall and two shrines (2 of 60
 * seeds keep the three-slot rule).
 */
function hallLandmarks(c: LandmarkCtx): void {
  const axis = hallAxis(c.zone), r = hallRadius(c.zone.painted);
  const est = scanCentre(c, c.open, axis, r, null);
  const ax = est.x, ay = est.y; // the pole when no hall fits
  const bb = c.zone.bbox, bw1 = bb.w + 1;
  const want = Math.max(1, Math.min(LANDMARKS_PER_ZONE, Math.round(areaScale(c.zone.painted))));
  const uDir = axis === 0 ? 0 : 4;
  let first = -1;
  for (let n = 0; n < want; n++) {
    const slots: Array<{ cost: number; k: number; d: number }> = [];
    for (let k = 0; k < 16; k++) {
      const sep = n === 0 ? Math.min(dirSep16(k, uDir), dirSep16(k, uDir + 8)) : dirSep16(k, (first + 8) & 15);
      for (const extra of SHRINE_EXTRAS) slots.push({ cost: SHRINE_TURN_COST * sep + (extra >= 0 ? extra : -SHRINE_INWARD_COST * extra), k, d: r + SHRINE_GAP + extra });
    }
    slots.sort((a, b) => a.cost - b.cost || a.k - b.k || a.d - b.d);
    for (const slot of slots) {
      const spot = shrineSpot(ax, ay, slot.k, slot.d);
      // cheap reject: the whole box must be unprotected zone FLOOR (summed-area table of the tiles that are not)
      const sw = spot.rot & 1 ? 7 : 9, sh = spot.rot & 1 ? 9 : 7;
      const rx = spot.x0 - bb.x, ry = spot.y0 - bb.y;
      if (rx < 0 || ry < 0 || rx + sw > bb.w || ry + sh > bb.h) continue;
      if (est.bad[(ry + sh) * bw1 + rx + sw] - est.bad[ry * bw1 + rx + sw] - est.bad[(ry + sh) * bw1 + rx] + est.bad[ry * bw1 + rx] !== 0) continue;
      const stamp = stampTemplate(SHRINE, spot.x0, spot.y0, spot.rot, false, c.w, c.h);
      if (stamp === null || !stampFits(c, stamp) || placeLandmark(c, SHRINE, stamp, spot.rot, false) === null) continue;
      if (n === 0) first = slot.k;
      break;
    }
  }
}

/** The tile of offset (u, v) from the hall centre. */
function hallTile(c: BaseCtx, cx: number, cy: number, axis: 0 | 1, u: number, v: number): number {
  return c.at(cx + (axis === 0 ? u : v), cy + (axis === 0 ? v : u));
}

/** The shrines' stamps in the zone, re-stamped from their feature records. */
function shrineStamps(c: BaseCtx): Stamp[] {
  const out: Stamp[] = [];
  for (const f of shrineLandmarks(c)) {
    const s = stampTemplate(SHRINE, f.ax, f.ay, (f.p[0] & 3) as 0 | 1 | 2 | 3, f.p[1] === 1, c.w, c.h);
    if (s !== null) out.push(s);
  }
  return out;
}

/**
 * The guard's worst member stretch (permille) if the piers with these top-left tiles stood. The route guard reads the LIVE tiles, so
 * the piers are written for the measurement and given back at once: nothing runs in between, and the feature log, the owners and the
 * counters are never touched (the real piers go through placeFeature afterwards). Needs a pier-free ground: every top-left tile is
 * an `open` window, so FLOOR before and after.
 */
function stretchWith(guard: RouteGuard, live: Uint8Array, corners: readonly number[], w: number): number {
  for (const k of corners) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) live[k + b * w + a] = TILE_WALL;
  try {
    return guard.worstStretch();
  } finally {
    for (const k of corners) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) live[k + b * w + a] = TILE_FLOOR;
  }
}

const EMPTY_PLAN = (): HypostylePlan => ({
  hall: false, cx: -1, cy: -1, axis: 0, radius: 0, piers: [], planned: 0, bays: [], lit: [], floor: [], feature: -1, stretch: 0, measures: 0, shrineLit: 0,
});

function hallShape(c: ShapeCtx): HypostylePlan {
  const plan = EMPTY_PLAN();
  const axis = hallAxis(c.zone), r = hallRadius(c.zone.painted), w = c.w;
  const best = scanCentre(c, c.open, axis, r, lineOfShrines(c));
  if (best.k === 0) return plan;
  const { x: cx, y: cy, win } = best;
  const layout = hallLayout(r);
  // the piers that fit whole (top-left tiles), centre out
  let kept: number[] = [];
  for (const [u0, v0] of layout.piers) {
    const tx = cx + (axis === 0 ? u0 : v0), ty = cy + (axis === 0 ? v0 : u0);
    if (tx >= 0 && ty >= 0 && tx < w && ty < c.h && win[ty * w + tx]) kept.push(ty * w + tx);
  }
  // The route guard (contract 3.9, 4.5.4). The contract skips every pier that touches a member's corridor up front; measured, that
  // costs about a third of the hall (13 piers a zone against 23), and the lattice mostly leaves the walks alone anyway. So the
  // whole lattice goes in first and the guard's own stretch decides: while a member's walk would stretch past ROUTE_STRETCH_MAX the
  // piers touching that member's corridor come out, the worst member first (at most STRETCH_TRIES measurements).
  let guard: RouteGuard | null = null;
  try { guard = c.routeGuard(); } catch { guard = null; }
  let stretch = 0, measures = 0;
  if (guard !== null && guard.members.length > 0) {
    const live = c.tiles as Uint8Array;
    const touch = new Uint8Array(w * c.h);
    const touches = (corner: number): boolean => {
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) if (touch[corner + b * w + a] === 1) return true;
      return false;
    };
    for (; measures < STRETCH_TRIES;) {
      stretch = stretchWith(guard, live, kept, w);
      measures++;
      if (stretch <= ROUTE_STRETCH_MAX) break;
      touch.fill(0);
      for (const i of guard.corridorOf(guard.worstMember())) touch[i] = 1;
      const next = kept.filter((k) => !touches(k));
      if (next.length === kept.length || next.length < HALL_MIN_PIERS) break;
      kept = next;
    }
    if (stretch > ROUTE_STRETCH_MAX) {
      // still too long: the contract's rule, every pier off every corridor
      const g = guard;
      const next = kept.filter((k) => { for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) if (g.corridor[k + b * w + a] === 1) return false; return true; });
      if (next.length >= HALL_MIN_PIERS) { kept = next; stretch = stretchWith(guard, live, kept, w); measures++; }
    }
  }
  if (kept.length < HALL_MIN_PIERS) return plan;
  const blocks: Array<readonly [number, BlockKind]> = [];
  const groups: number[] = [];
  kept.forEach((corner, g) => {
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { blocks.push([corner + b * w + a, "wall"]); groups.push(g); }
  });
  const floor: number[] = [];
  for (const [du, dv] of layout.floor) {
    const i = hallTile(c, cx, cy, axis, du, dv);
    if (i >= 0 && c.mask[i] === 1 && c.hard[i] === 0) floor.push(i);
  }
  // the bays that will be lit: the crossing's centre tile is zone FLOOR, unprotected and plain ground (no pier stands on a crossing);
  // the surface pass lights every tile of the 3x3 the guard allows
  const bays: number[] = [];
  for (const [u, v] of layout.bays) {
    const i = hallTile(c, cx, cy, axis, u, v);
    if (i >= 0 && c.mask[i] === 1 && c.hard[i] === 0 && c.tiles[i] === TILE_FLOOR && c.terrain[i] === 0) bays.push(i);
  }
  const placed = c.placeFeature({
    kind: "hall", jobs: ["cover", "rest"], anchor: [cx, cy], params: [axis, HALL_PITCH, r, kept.length, bays.length],
    blocks, groups, floor, mode: "groups", minGroups: HALL_MIN_PIERS,
  });
  if (placed === null) return plan;
  plan.hall = true;
  plan.cx = cx; plan.cy = cy; plan.axis = axis; plan.radius = r;
  plan.planned = kept.length;
  plan.feature = placed.id;
  plan.floor = floor;
  plan.bays = bays;
  for (const corner of kept) if (c.tiles[corner] === TILE_WALL) plan.piers.push(corner + w + 1);
  if (plan.piers.length !== kept.length) {
    // The guard refused a pier (a territory's floor would have been cut): the record says what stands.
    const rec = c.zoneFeatures().filter((f) => f.kind === "hall").pop();
    try { if (rec) rec.p[3] = plan.piers.length; } catch { /* a read-only log keeps the count the guard was asked for */ }
    if (guard !== null && guard.members.length > 0 && measures < STRETCH_BUDGET) { stretch = guard.worstStretch(); measures++; }
  }
  plan.stretch = stretch;
  plan.measures = measures;
  return plan;
}

function hallSurface(c: SurfaceCtx, plan: HypostylePlan): void {
  const w = c.w;
  // light: the 3x3 round each bay's centre, where the guard allows it (a camp's halo or a pool pad can bite a corner out)
  for (const centre of plan.bays) {
    const x = centre % w, y = (centre - x) / w;
    let n = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (c.surface(c.at(x + a, y + b), "light")) n++;
    if (n > 0) plan.lit.push(centre);
  }
  // the shrines' light cells ("l" of the template): lit where the guard allows it
  for (const s of shrineStamps(c)) for (const i of s.lights) if (c.surface(i, "light")) plan.shrineLit++;
}

function hallProps(c: PropCtx, plan: HypostylePlan): void {
  const w = c.w;
  const variant = (x: number, y: number): number => Math.floor(c.noise.hash(x, y, 90) * 3);
  if (plan.hall) {
    for (const pc of plan.piers) { const x = pc % w, y = (pc - x) / w; c.prop(PROP.column_cap, x, y, variant(x, y)); }
    for (const bc of plan.lit) { const x = bc % w, y = (bc - x) / w; c.prop(PROP.candelabra, x, y, variant(x, y)); }
    for (const i of plan.floor) {
      const x = i % w, y = (i - x) / w;
      if (c.noise.hash(x, y, 5) < 0.05) c.prop(PROP.stained_glass, x, y, variant(x, y));
    }
  }
  // a shrine: the altar on its middle light cell, a brazier at each end of the back row, banners on the back wall
  for (const s of shrineStamps(c)) {
    const put = (kind: number, i: number | undefined): void => { if (i !== undefined) c.prop(kind, i % w, (i - (i % w)) / w, variant(i % w, (i - (i % w)) / w)); };
    put(PROP.altar, s.lights[4]);
    put(PROP.brazier, s.floor[0]);
    put(PROP.brazier, s.floor[4]);
    put(PROP.banner_red, s.walls[2]);
    put(PROP.banner_red, s.walls[4]);
    put(PROP.banner_red, s.walls[6]);
  }
}

/** The new Sanctum styler (version 400). Phase B: registered by nobody yet; WP7 swaps it in as `sanctum` in phase C. */
export const hypostyle: ZoneStyler<HypostylePlan> = {
  id: "sanctum", faction: "holy", version: 400, landmark: hallLandmarks, shape: hallShape, surface: hallSurface, props: hallProps,
};

// ================================================================================================ the old styler (v1)
// Kept as `sanctum` until phase C swaps the registry (styleZones.ts, index.ts) to `hypostyle`; WP7 deletes everything below then
// (and renames HypostylePlan to SanctumPlan, hypostyle to sanctum).
// Sanctum (holy): cathedral ruins. Symmetric colonnades, broken arches and cloister courtyards with a light shaft each.
// Symmetry is per structure (each colonnade and cloister mirrors about its own axis): four camp clearings, spawns and ruins
// make a zone-wide mirror impossible. Colonnade rows are the most efficient lane cutters (0.9 rock tile per pillar tile).
// Holy heals double in light: an economy advantage (a rest chain), not a duel one. Part D 4.5's recipe, scaled to the zone.
// A structure is a list of pillar sites computed from its centre, size and axis alone; where it goes is chosen by sampling
// centres and keeping the one whose sites fall on the most open ground (a finished map leaves little clean ground, so a free
// rectangle is rare), and a cloister needs a clean 3x3 of floor for its shaft.
export type StructureKind = "nave" | "cloister" | "avenue";

export interface StructurePlan {
  kind: StructureKind;
  rect: Rect;
  /** The structure's long axis is horizontal; its mirror line runs along it. */
  horizontal: boolean;
  cx: number;
  cy: number;
  /** Pillar positions before any break coin: mirror-symmetric by construction (tile indices). */
  planned: number[];
  /** The pillars (and walls) the styler actually wrote. */
  placed: number[];
  /** Centre tile of the 3x3 light shaft, or -1 when no clean 3x3 fitted. */
  shaft: number;
  /** Altar wall tiles (the nave). */
  altar: number[];
}

export interface SanctumPlan {
  structures: StructurePlan[];
}

/** One pillar site: its offset from the structure's centre along (v) and across (u) the long axis, and the chance it is broken. */
interface Site { u: number; v: number; broken: number }

interface Layout {
  kind: StructureKind;
  /** Half extent along and across the long axis. */
  halfLong: number;
  halfShort: number;
  sites: Site[];
  /** Sites mirrored about the axis: (u, v) and (-u, v) both exist. */
  altar: Array<[number, number]>;
  /** The shaft's centre offset (u, v). */
  shaft: [number, number];
}

/** A cloister: a ring of pillars at pitch 2 with four 2-tile gaps and a light shaft in the middle. */
function cloister(hs: number): Layout {
  const sites: Site[] = [];
  for (let a = -hs; a <= hs; a++) {
    for (let b = -hs; b <= hs; b++) {
      const edge = Math.abs(a) === hs || Math.abs(b) === hs;
      if (!edge || (Math.abs(a) <= 1 && Math.abs(b) === hs) || (Math.abs(b) <= 1 && Math.abs(a) === hs)) continue;
      if ((Math.abs(a) === hs && ((b + hs) & 1) !== 0) || (Math.abs(b) === hs && ((a + hs) & 1) !== 0)) continue;
      sites.push({ u: a, v: b, broken: 0.12 });
    }
  }
  return { kind: "cloister", halfLong: hs, halfShort: hs, sites, altar: [], shaft: [0, 0] };
}

/** An avenue (two pillar rows) or a nave (two colonnades, arches near the ends, an altar). */
function colonnade(kind: "nave" | "avenue", half: number, U: number): Layout {
  const sites: Site[] = [];
  for (let v = -half + 1; v <= half - 1; v += 2) { sites.push({ u: U, v, broken: 0.15 }); sites.push({ u: -U, v, broken: 0.15 }); }
  const altar: Array<[number, number]> = [];
  if (kind === "nave") {
    for (const v of [-half + 2, half - 2]) { sites.push({ u: 2, v, broken: 0.35 }); sites.push({ u: -2, v, broken: 0.35 }); }
    for (const du of [-1, 0, 1]) altar.push([du, half - 1]);
  }
  return { kind, halfLong: half, halfShort: U + 1, sites, altar, shaft: kind === "nave" ? [0, -3] : [0, 0] };
}

interface Step { kind: StructureKind; layouts: Layout[] }

function plan(sc: number): Step[] {
  const big = sc >= 0.85;
  const clo: Layout[] = big ? [cloister(4), cloister(3)] : [cloister(3)];
  const nave: Layout[] = big ? [colonnade("nave", 12, 4), colonnade("nave", 9, 4)] : [colonnade("nave", 8, 4), colonnade("nave", 6, 3)];
  const avenue: Layout[] = [colonnade("avenue", big ? 8 : 6, 3), colonnade("avenue", big ? 6 : 5, 2)];
  return [
    { kind: "nave", layouts: nave },
    { kind: "cloister", layouts: clo },
    { kind: "cloister", layouts: clo },
    { kind: "avenue", layouts: avenue },
    { kind: "cloister", layouts: clo },
    { kind: "avenue", layouts: avenue },
  ];
}

function shape(c: ShapeCtx): SanctumPlan {
  const r = c.rng;
  const w = c.w;
  const sc = sizeScale(c.zone.painted);
  const out: SanctumPlan = { structures: [] };
  // on open ground a structure must stand wholly on ground it can take; a finished map leaves strips, so a third of it will do
  const minOpen = roomOf(c) > 0.4 ? 0.9 : 0.3;
  const taken: Rect[] = [];
  const bb = c.zone.bbox;
  const apart = (a: Rect, b: Rect): boolean => a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y;
  /** A clean 3x3 of floor (LIGHT stands on any unprotected floor, the ring band included) around (sx, sy) or one tile off it; the centre index or -1. */
  const shaftAt = (sx: number, sy: number): number => {
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let clean = true;
      for (let b = -1; b <= 1 && clean; b++) {
        for (let a = -1; a <= 1; a++) {
          const i = c.at(sx + ox + a, sy + oy + b);
          if (i < 0 || c.tiles[i] !== TILE_FLOOR || c.hard[i] || !c.mask[i] || c.isReserved(i)) { clean = false; break; }
        }
      }
      if (clean) return c.at(sx + ox, sy + oy);
    }
    return -1;
  };
  // centres of the clean 3x3 patches of floor: where a shaft can stand (a cloister is built around one)
  const patches: number[] = [];
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      const i = c.at(x, y);
      if (c.tiles[i] === TILE_FLOOR && c.mask[i] && !c.hard[i] && shaftAt(x, y) === i) patches.push(i);
    }
  }
  for (const step of plan(sc)) {
    let best: { layout: Layout; cx: number; cy: number; horizontal: boolean; score: number; rect: Rect; shaft: number } | null = null;
    for (let t = 0; t < 160; t++) {
      const layout = step.layouts[randInt(r, 0, step.layouts.length)];
      const horizontal = chance(r, 0.5);
      let cx = bb.x + randInt(r, 0, bb.w), cy = bb.y + randInt(r, 0, bb.h);
      if (layout.kind !== "avenue" && patches.length > 0 && chance(r, 0.75)) {
        const p = patches[randInt(r, 0, patches.length)];
        const px = p % w, py = (p - px) / w;
        cx = layout.kind === "cloister" || !horizontal ? px : px + 3;
        cy = layout.kind === "cloister" || horizontal ? py : py + 3;
      }
      const at = (u: number, v: number): number => (horizontal ? c.at(cx + v, cy + u) : c.at(cx + u, cy + v));
      const hl = layout.halfLong, hsh = layout.halfShort;
      const rect: Rect = horizontal ? { x: cx - hl, y: cy - hsh, w: 2 * hl + 1, h: 2 * hsh + 1 } : { x: cx - hsh, y: cy - hl, w: 2 * hsh + 1, h: 2 * hl + 1 };
      if (taken.some((o) => !apart(o, rect))) continue;
      let open = 0, inZone = 0;
      for (const s of layout.sites) {
        const i = at(s.u, s.v);
        if (i >= 0 && c.mask[i]) inZone++;
        if (i >= 0 && c.open(i)) open++;
      }
      if (inZone < Math.ceil(layout.sites.length * 0.8) || open < Math.ceil(layout.sites.length * minOpen)) continue;
      // a cloister or nave wants a light shaft: a clean 3x3 of floor is worth six pillars, but a structure without one stands
      let shaft = -1;
      if (layout.kind !== "avenue") {
        const si = at(layout.shaft[0], layout.shaft[1]);
        if (si >= 0) shaft = shaftAt(si % w, (si - (si % w)) / w);
      }
      const score = open + (shaft >= 0 ? 6 : 0);
      if (!best || score > best.score) best = { layout, cx, cy, horizontal, score, rect, shaft };
    }
    if (!best) continue;
    const { layout, cx, cy, horizontal } = best;
    const at = (u: number, v: number): number => (horizontal ? c.at(cx + v, cy + u) : c.at(cx + u, cy + v));
    const st: StructurePlan = { kind: layout.kind, rect: best.rect, horizontal, cx, cy, planned: [], placed: [], shaft: best.shaft, altar: [] };
    if (best.shaft >= 0) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) c.reserve(c.at((best.shaft % w) + a, Math.floor(best.shaft / w) + b));
    for (const s of layout.sites) {
      const i = at(s.u, s.v);
      if (i < 0) continue;
      st.planned.push(i);
      if (chance(r, s.broken)) continue;
      if (wall(c, i % w, (i - (i % w)) / w)) st.placed.push(i);
    }
    for (const [u, v] of layout.altar) {
      const i = at(u, v);
      if (i >= 0 && wall(c, i % w, (i - (i % w)) / w)) { st.placed.push(i); st.altar.push(i); }
    }
    out.structures.push(st);
    taken.push(best.rect);
  }
  return out;
}

function surface(c: SurfaceCtx, plan: SanctumPlan): void {
  for (const st of plan.structures) {
    if (st.shaft < 0) continue;
    const sx = st.shaft % c.w, sy = (st.shaft - sx) / c.w;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) c.surface(c.at(sx + a, sy + b), "light");
  }
}

function props(c: PropCtx, plan: SanctumPlan): void {
  const n = c.w * c.h;
  const pillar = new Uint8Array(n);
  for (const st of plan.structures) for (const i of st.placed) pillar[i] = 1;
  const nearAltar = new Uint8Array(n);
  for (const st of plan.structures) {
    for (const i of st.altar) {
      const x = i % c.w, y = (i - x) / c.w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = c.at(x + dx, y + dy); if (j >= 0) nearAltar[j] = 1; }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!c.mask[i]) continue;
    const x = i % c.w, y = (i - x) / c.w;
    const v = Math.floor(c.noise.hash(x, y, 90) * 3);
    const t = c.tiles[i];
    if (t === TILE_WALL) {
      if (pillar[i] && c.noise.hash(x, y, 1) < 0.35) c.prop(PROP.column_cap, x, y, v);
      else if (c.noise.hash(x, y, 2) < 0.04) c.prop(PROP.banner_red, x, y, v);
    } else if (t === TILE_FLOOR) {
      if (nearAltar[i] && c.noise.hash(x, y, 3) < 0.4) c.prop(PROP.candelabra, x, y, v);
      else if (c.terrain[i] === 0 && c.noise.hash(x, y, 4) < 0.01) c.prop(PROP.rubble, x, y, v);
      else if (c.terrain[i] === 0) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = c.at(x + dx, y + dy);
          if (j >= 0 && c.terrain[j] === TERRAIN_LIGHT) { if (c.noise.hash(x, y, 5) < 0.3) c.prop(PROP.stained_glass, x, y, v); break; }
        }
      }
    }
  }
}

export const sanctum: ZoneStyler<SanctumPlan> = { id: "sanctum", faction: "holy", version: 1, shape, surface, props };
