// Paints the whole map for the minimap, the lobby preview, the planning screen and the hold-Tab map: zone tints (with a pattern
// per zone, so a zone is never told apart by hue alone), walls, the coliseum gates, camp markers (a shape per zone, a crown on
// an elite), weapon crates, the route and the player. It only talks to a 2D context, so a test can hand it a recorder.
//
// Every function takes `k`, the context's pixels per world unit (size / mapSpan()), and `px`, its pixels per reference
// overlay pixel (marks scale with the map's size). The static layer (`paintMapBase`) is painted once per map and size.
import {
  FACTIONS, FACTION_IDS, REGION_IDS, TILE, isWallTile,
  type CampDef, type FactionId, type GameMap, type RegionId, type Vec2,
} from "@raid/shared";
import { cssColor } from "./dom";

export const COLOR_BG = "rgba(20, 24, 30, 0.8)";
export const COLOR_WALL = "#9aa3ad";
/** Faction colours at low alpha, under the walls; "none" is left as the background. */
export const COLOR_REGION: Record<RegionId, string | null> = {
  none: null,
  fire: "rgba(255, 112, 67, 0.22)",
  sentenced: "rgba(149, 117, 205, 0.22)",
  plague: "rgba(156, 204, 101, 0.22)",
  frost: "rgba(79, 195, 247, 0.22)",
  holy: "rgba(255, 241, 118, 0.22)",
  coliseum: "rgba(200, 180, 138, 0.3)",
};
export const COLOR_OUTLINE = "#0b0e11";
export const COLOR_CROWN = "#ffd54f";
export const COLOR_CRATE = "#c8a46a";
export const COLOR_ROUTE = "#80deea";
export const COLOR_PLAYER = "#69f0ae";
export const COLOR_PLAYER_DOWN = "#78909c";

const TAU = Math.PI * 2;

/** The slice of a 2D context the painter uses. */
export type PaintCtx = CanvasRenderingContext2D;

// ------------------------------------------------------------------------------------------------------ zone identity

/** How a zone's floor is hatched on top of its tint. Five different marks, so a colour-blind player can still read the map. */
export type ZonePattern = "slash" | "backslash" | "dots" | "grid" | "bars";

export const ZONE_PATTERN: Readonly<Record<FactionId, ZonePattern>> = {
  fire: "slash",
  sentenced: "backslash",
  plague: "dots",
  frost: "grid",
  holy: "bars",
};

/** A zone's marker shape (camps, spawn labels, the legend). */
export type ZoneShape = "triangle" | "square" | "diamond" | "hexagon" | "cross";

export const ZONE_SHAPE: Readonly<Record<FactionId, ZoneShape>> = {
  fire: "triangle",
  sentenced: "square",
  plague: "diamond",
  frost: "hexagon",
  holy: "cross",
};

type Poly = ReadonlyArray<readonly [number, number]>;

/** Each shape as a polygon in a box from (-1, -1) to (1, 1); the same points drive the canvas path and the CSS clip-path. */
export const SHAPE_POLYGON: Readonly<Record<ZoneShape, Poly>> = {
  triangle: [[0, -1], [1, 0.8], [-1, 0.8]],
  square: [[-0.82, -0.82], [0.82, -0.82], [0.82, 0.82], [-0.82, 0.82]],
  diamond: [[0, -1], [1, 0], [0, 1], [-1, 0]],
  hexagon: [[-0.5, -0.87], [0.5, -0.87], [1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0]],
  cross: [
    [-0.36, -1], [0.36, -1], [0.36, -0.36], [1, -0.36], [1, 0.36], [0.36, 0.36],
    [0.36, 1], [-0.36, 1], [-0.36, 0.36], [-1, 0.36], [-1, -0.36], [-0.36, -0.36],
  ],
};

/** A three-spike crown on a unit base, sitting just above an elite camp's shape. */
const CROWN: Poly = [[-1, 0], [-1, -0.9], [-0.5, -0.4], [0, -1.1], [0.5, -0.4], [1, -0.9], [1, 0]];

/** `polygon(...)` for a CSS clip-path (percent of the element's box), from the same points the canvas draws. */
export function clipPathOf(poly: Poly): string {
  const pct = (v: number): string => `${Math.round(((v + 1) / 2) * 1000) / 10}%`;
  return `polygon(${poly.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`;
}

export const zoneClipPath = (zone: FactionId): string => clipPathOf(SHAPE_POLYGON[ZONE_SHAPE[zone]]);
export const CROWN_CLIP_PATH = clipPathOf(CROWN);

/** The zone's own colour as CSS. */
export const zoneColor = (zone: FactionId): string => cssColor(FACTIONS[zone].color);

/** Adds a closed polygon to the current path, centred at (cx, cy) and `r` pixels from the centre to the widest point. */
function polyPath(g: PaintCtx, poly: Poly, cx: number, cy: number, r: number): void {
  poly.forEach(([x, y], i) => {
    if (i === 0) g.moveTo(cx + x * r, cy + y * r);
    else g.lineTo(cx + x * r, cy + y * r);
  });
  g.closePath();
}

// -------------------------------------------------------------------------------------------------------- the base layer

/** Calls `fn` for every maximal horizontal run of one region code, as the tile rect it covers in context pixels. */
function forEachRegionRun(
  map: GameMap, tile: number, fn: (left: number, top: number, width: number, height: number, code: number) => void,
): void {
  const codes = map.regionGrid;
  // Edges are rounded to the nearest pixel (not outward) so neighbouring runs share them exactly: translucent fills would
  // otherwise double up on the overlap.
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.round(ty * tile);
    const bottom = Math.round((ty + 1) * tile);
    let start = 0;
    for (let tx = 1; tx <= map.w; tx++) {
      if (tx < map.w && codes[ty * map.w + tx] === codes[ty * map.w + start]) continue;
      const left = Math.round(start * tile);
      fn(left, top, Math.round(tx * tile) - left, bottom - top, codes[ty * map.w + start]!);
      start = tx;
    }
  }
}

export interface BaseOptions {
  /** Hatch each zone with its own pattern (ZONE_PATTERN) on top of the tint. Off keeps the minimap's original look. */
  patterns?: boolean;
}

/** Pixels per repeat of the pattern tile for a map painted `size` pixels wide. */
export function patternPeriod(size: number): number {
  return Math.min(22, Math.max(4, Math.round(size / 44)));
}

/** A zone colour at `alpha`, as the rgba() the pattern marks are drawn in. */
function zoneAlpha(zone: FactionId, alpha: number): string {
  const c = FACTIONS[zone].color;
  return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${alpha})`;
}

/**
 * One repeat of a zone's pattern, drawn so that tiles meet without a seam (marks that cross an edge are drawn again on the
 * opposite one). Null when the platform cannot make a canvas or a pattern.
 */
export function makePatternTile(zone: FactionId, period: number, g: PaintCtx): CanvasPattern | null {
  if (typeof document === "undefined") return null;
  const tile = document.createElement("canvas");
  tile.width = period;
  tile.height = period;
  const t = tile.getContext("2d");
  if (!t) return null;
  const line = Math.max(1, period / 8);
  t.strokeStyle = zoneAlpha(zone, 0.45);
  t.fillStyle = zoneAlpha(zone, 0.45);
  t.lineWidth = line;
  t.beginPath();
  switch (ZONE_PATTERN[zone]) {
    case "slash":
      for (const d of [-period, 0, period]) { t.moveTo(d, period); t.lineTo(d + period, 0); }
      t.stroke();
      break;
    case "backslash":
      for (const d of [-period, 0, period]) { t.moveTo(d, 0); t.lineTo(d + period, period); }
      t.stroke();
      break;
    case "dots":
      t.arc(period / 2, period / 2, Math.max(0.9, period * 0.17), 0, TAU);
      t.fill();
      break;
    case "grid":
      t.moveTo(0, period / 2); t.lineTo(period, period / 2);
      t.moveTo(period / 2, 0); t.lineTo(period / 2, period);
      t.stroke();
      break;
    case "bars":
      t.lineWidth = line * 1.4;
      t.moveTo(period / 2, 0); t.lineTo(period / 2, period);
      t.stroke();
      break;
  }
  return g.createPattern(tile, "repeat");
}

/**
 * Paints the map's static layer into `w` x `h` pixels: the background, the zone tints (and their patterns), the walls. `k` is
 * pixels per world unit. Call it once per map and size; the dynamic marks go on top of the result.
 */
export function paintMapBase(g: PaintCtx, map: GameMap, w: number, h: number, k: number, opts: BaseOptions = {}): void {
  const tile = TILE * k;
  g.clearRect(0, 0, w, h);
  g.fillStyle = COLOR_BG;
  g.fillRect(0, 0, w, h);

  // Region tints first, so the walls stay readable on top.
  forEachRegionRun(map, tile, (left, top, width, height, code) => {
    const color = COLOR_REGION[REGION_IDS[code] ?? "none"];
    if (!color) return;
    g.fillStyle = color;
    g.fillRect(left, top, width, height);
  });

  if (opts.patterns) {
    // The pattern tile is anchored to the context's origin, so a hatch line continues across runs and rows.
    const period = patternPeriod(w);
    const tiles = new Map<number, CanvasPattern | null>();
    forEachRegionRun(map, tile, (left, top, width, height, code) => {
      const id = REGION_IDS[code];
      if (!id || id === "none" || id === "coliseum") return;
      let pattern = tiles.get(code);
      if (pattern === undefined) {
        pattern = makePatternTile(id, period, g);
        tiles.set(code, pattern);
      }
      if (!pattern) return;
      g.fillStyle = pattern;
      g.fillRect(left, top, width, height);
    });
  }

  // Horizontal runs of wall tiles per row; edges are rounded outward so neighbouring rows leave no hairline gaps.
  g.fillStyle = COLOR_WALL;
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * tile);
    const bottom = Math.ceil((ty + 1) * tile);
    let start = -1;
    for (let tx = 0; tx <= map.w; tx++) {
      if (tx < map.w && isWallTile(map, tx, ty)) {
        if (start < 0) start = tx;
      } else if (start >= 0) {
        const left = Math.floor(start * tile);
        g.fillRect(left, top, Math.ceil(tx * tile) - left, bottom - top);
        start = -1;
      }
    }
  }
}

/** The coliseum's gate tiles as x, y, w, h in context pixels (flat), for drawing the closed gates over the base layer. */
export function gateRects(map: GameMap, k: number): number[] {
  const tile = TILE * k;
  const out: number[] = [];
  for (const gate of map.coliseum.gates) {
    for (const t of gate.tiles) {
      const left = Math.floor(t.x * tile);
      const top = Math.floor(t.y * tile);
      out.push(left, top, Math.ceil((t.x + 1) * tile) - left, Math.ceil((t.y + 1) * tile) - top);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the dynamic marks

/** Half-size of a camp's mark in reference pixels; an elite's is bigger and wears a crown. */
const CAMP_R = 3.4;
const ELITE_R = 4.6;

/** A camp's state as the room syncs it (RaidState.camps[i].state): nobody has hurt a member / a member has / every member died. */
export const CAMP_IDLE = 0;
export const CAMP_ENGAGED = 1;
export const CAMP_CLEARED = 2;

/** A cleared camp's marker is drawn this faint, under a cross. */
const CLEARED_ALPHA = 0.38;
const COLOR_CLEARED_CROSS = "#eceff1";
const COLOR_ENGAGED = "#ff7043";
/** A small flame on a unit base, at an engaged camp's upper right. */
const FLAME: Poly = [[0, -1], [0.7, -0.1], [0.45, 0.9], [-0.45, 0.9], [-0.7, -0.1]];

/**
 * Camp markers: the zone's shape in its colour with a dark outline, an elite bigger and crowned. With `states` (one number per
 * camp, CAMP_*), a cleared camp is dimmed and crossed out so everyone reads what was taken, and an engaged one wears a small
 * flame; without them (or with 0s) the calls are exactly the plain markers'.
 */
export function paintCamps(
  g: PaintCtx, camps: readonly Pick<CampDef, "zone" | "x" | "y" | "eliteSpot">[], k: number, px: number, states?: ArrayLike<number>,
): void {
  g.lineWidth = px;
  g.strokeStyle = COLOR_OUTLINE;
  g.lineJoin = "round";
  for (let i = 0; i < camps.length; i++) {
    const camp = camps[i]!;
    const state = states?.[i] ?? CAMP_IDLE;
    const elite = camp.eliteSpot >= 0;
    const r = (elite ? ELITE_R : CAMP_R) * px;
    const cx = camp.x * k;
    const cy = camp.y * k;
    if (state === CAMP_CLEARED) g.globalAlpha = CLEARED_ALPHA;
    g.fillStyle = zoneColor(camp.zone);
    g.beginPath();
    polyPath(g, SHAPE_POLYGON[ZONE_SHAPE[camp.zone]], cx, cy, r);
    g.fill();
    g.stroke();
    if (elite) {
      g.fillStyle = COLOR_CROWN;
      g.beginPath();
      polyPath(g, CROWN, cx, cy - r * 1.05 - r * 0.15, r * 0.7);
      g.fill();
      g.stroke();
    }
    if (state === CAMP_CLEARED) {
      g.globalAlpha = 1;
      // A cross over the marker: a dark line under a light one, so it reads on any tint.
      const reach = r * 1.15;
      for (const [c, w] of [[COLOR_OUTLINE, 2.6], [COLOR_CLEARED_CROSS, 1.3]] as const) {
        g.strokeStyle = c;
        g.lineWidth = w * px;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(cx - reach, cy - reach);
        g.lineTo(cx + reach, cy + reach);
        g.moveTo(cx + reach, cy - reach);
        g.lineTo(cx - reach, cy + reach);
        g.stroke();
      }
      g.strokeStyle = COLOR_OUTLINE;
      g.lineWidth = px;
    } else if (state === CAMP_ENGAGED) {
      g.fillStyle = COLOR_ENGAGED;
      g.beginPath();
      polyPath(g, FLAME, cx + r * 0.95, cy - r * 0.85, r * 0.55);
      g.fill();
      g.stroke();
    }
  }
}

/** One chest on the map: where it is and the seconds it has left. */
export interface ChestBlip {
  x: number;
  y: number;
  /** Seconds to live (the number drawn beside it). */
  left: number;
}

export const COLOR_CHEST = "#ffd54f";
const COLOR_CHEST_DARK = "#2a1d05";

/**
 * Chest blips: a ringed gold chest (a box with a lid line) and the seconds left as a number, so a chest is never mistaken for a
 * camp (a zone-coloured polygon) or a mob dot. `pulse` (0..1) breathes the outer ring; pass 0 for no motion (reduced motion).
 */
export function paintChests(g: PaintCtx, chests: readonly ChestBlip[], k: number, px: number, pulse = 0): void {
  if (chests.length === 0) return;
  g.lineJoin = "round";
  g.textAlign = "center";
  g.textBaseline = "top";
  g.font = `700 ${Math.max(8, Math.round(7.5 * px))}px system-ui, sans-serif`;
  for (const chest of chests) {
    const cx = chest.x * k;
    const cy = chest.y * k;
    g.lineWidth = 1.2 * px;
    g.strokeStyle = COLOR_CHEST;
    g.globalAlpha = 0.45 + 0.45 * (1 - pulse);
    g.beginPath();
    g.arc(cx, cy, (4.4 + 2.2 * pulse) * px, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = COLOR_CHEST_DARK;
    g.beginPath();
    g.arc(cx, cy, 3.9 * px, 0, TAU);
    g.fill();
    g.strokeStyle = COLOR_CHEST;
    g.lineWidth = px;
    g.stroke();
    // The box and its lid line.
    g.fillStyle = COLOR_CHEST;
    g.fillRect(cx - 2.1 * px, cy - 1.5 * px, 4.2 * px, 3 * px);
    g.fillStyle = COLOR_CHEST_DARK;
    g.fillRect(cx - 2.1 * px, cy - 0.5 * px, 4.2 * px, 0.7 * px);
    const text = String(Math.max(0, Math.ceil(chest.left)));
    g.lineWidth = 2.6 * px;
    g.strokeStyle = COLOR_OUTLINE;
    g.strokeText(text, cx, cy + 5.4 * px);
    g.fillStyle = "#fff8e1";
    g.fillText(text, cx, cy + 5.4 * px);
  }
}

/** Weapon crates as small squares. */
export function paintCrates(g: PaintCtx, spots: readonly Vec2[], k: number, px: number): void {
  g.lineWidth = px * 0.8;
  g.strokeStyle = COLOR_OUTLINE;
  g.fillStyle = COLOR_CRATE;
  const half = 1.7 * px;
  for (const s of spots) {
    g.fillRect(s.x * k - half, s.y * k - half, half * 2, half * 2);
    g.strokeRect(s.x * k - half, s.y * k - half, half * 2, half * 2);
  }
}

export interface RouteStyle {
  /** 0..1 multiplier on the line's opacity (the in-run route is faint). */
  alpha: number;
  /** Index into `waypoints` that is the next stop (drawn as a ring), or -1. */
  next: number;
}

/** The route as a dashed polyline with a small ring at each stop; the next stop's ring is bigger and filled. */
export function paintRoute(g: PaintCtx, points: readonly Vec2[], stops: readonly Vec2[], k: number, px: number, style: RouteStyle): void {
  if (points.length === 0 && stops.length === 0) return;
  const prev = g.globalAlpha;
  g.globalAlpha = prev * style.alpha;
  g.lineJoin = "round";
  g.lineCap = "round";
  if (points.length > 1) {
    g.strokeStyle = COLOR_OUTLINE;
    g.lineWidth = 2.6 * px;
    g.setLineDash([]);
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(p.x * k, p.y * k) : g.lineTo(p.x * k, p.y * k)));
    g.stroke();
    g.strokeStyle = COLOR_ROUTE;
    g.lineWidth = 1.5 * px;
    g.setLineDash([4 * px, 3 * px]);
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(p.x * k, p.y * k) : g.lineTo(p.x * k, p.y * k)));
    g.stroke();
    g.setLineDash([]);
  }
  stops.forEach((s, i) => {
    const next = i === style.next;
    g.beginPath();
    g.arc(s.x * k, s.y * k, (next ? 3.6 : 2.4) * px, 0, TAU);
    g.lineWidth = px * (next ? 1.8 : 1.2);
    g.strokeStyle = COLOR_ROUTE;
    if (next) { g.fillStyle = "rgba(128, 222, 234, 0.45)"; g.fill(); }
    g.stroke();
  });
  g.globalAlpha = prev;
}

/** The local player's dot (the green one on the minimap). */
export function paintPlayer(g: PaintCtx, at: Vec2, alive: boolean, k: number, px: number): void {
  g.fillStyle = alive ? COLOR_PLAYER : COLOR_PLAYER_DOWN;
  g.strokeStyle = COLOR_OUTLINE;
  g.lineWidth = px;
  g.beginPath();
  g.arc(at.x * k, at.y * k, 2.6 * px, 0, TAU);
  g.fill();
  g.stroke();
}

/** Every faction's colour as CSS, in FACTION_IDS order. */
export const FACTION_CSS: readonly string[] = FACTION_IDS.map((id) => cssColor(FACTIONS[id].color));
