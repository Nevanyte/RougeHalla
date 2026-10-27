// Paints the whole map for the minimap, the lobby preview, the planning screen and the hold-Tab map: zone tints (with a pattern
// per zone, so a zone is never told apart by hue alone), the ground (floor hazards, LOW barriers), walls, the coliseum gates, camp markers (a shape per zone, a crown on
// an elite), weapon crates, the route and the player. It only talks to a 2D context, so a test can hand it a recorder.
//
// Every function takes `k`, the context's pixels per world unit (size / mapSpan()), and `px`, its pixels per reference
// overlay pixel (marks scale with the map's size). The static layer (`paintMapBase`) is painted once per map and size.
import {
  FACTIONS, FACTION_IDS, REGION_IDS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA,
  TERRAIN_LIGHT, TILE, TILE_FLOOR, TILE_LOW, isWallTile,
  type CampDef, type FactionId, type FeatureKind, type GameMap, type RegionId, type Vec2,
} from "@raid/shared";
import { floorLookOf } from "../render/zoneArt/featureArt";
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
/**
 * LOW tiles (they stop bodies, not shots or sight), by terrain kind: painted over the region tints and under the walls. Lava is a
 * hot orange block, a fence a thin pale line (a tile is only 1.5 to 3 px here), a crevasse a dark block with a blue edge.
 */
const COLOR_LOW_DEFAULT = "#7a808b";
const COLOR_LOW: Readonly<Record<number, string>> = {
  [TERRAIN_LAVA]: "#ff5a1f",
  [TERRAIN_FENCE]: "#f1ecff",
  [TERRAIN_CREVASSE]: "#0a1626",
};
const COLOR_CREVASSE_EDGE = "#4aa3df";
/** Floor hazards as faint tints over the region colour, under the LOW tiles and the walls (D 7.8). */
const COLOR_HAZARD: Readonly<Record<number, string>> = {
  [TERRAIN_EMBER]: "rgba(255, 138, 61, 0.8)",
  [TERRAIN_BOG]: "rgba(95, 143, 58, 0.55)",
  [TERRAIN_ICE]: "rgba(191, 233, 255, 0.55)",
  [TERRAIN_LIGHT]: "rgba(255, 243, 176, 0.7)",
};
/**
 * The walls of a named feature (zone-shapes contract 7.5) on the map screens, so the shapes read at a glance and not only as grey
 * lines: a crater's rim warm, a barrow's mound moss, the hall's piers gold, a headland or spire pale ice, the gallows timber, a
 * landmark's walls white. Walls with no feature (the border, the coliseum, a net's infill) stay COLOR_WALL.
 */
export const COLOR_FEATURE_WALL: Readonly<Partial<Record<FeatureKind, string>>> = {
  crater: "#e0a98c",
  barrow: "#b9d394",
  hall: "#f3dd8c",
  headland: "#e6f6ff",
  spire: "#e6f6ff",
  gallows: "#b99a72",
  landmark: "#ffffff",
};
/**
 * The floor a feature owns, as a tint over the zone's colour and hatch: a crater's bowl darkens (so each ring reads as a pen), a
 * tunnel is near black, the hall's aisles are warm, a lake's shore and a causeway pale, a landmark's inside bright. Keyed by the
 * feature's floor look (render/zoneArt/featureArt.ts).
 */
const COLOR_FEATURE_FLOOR: Readonly<Record<string, string>> = {
  bowl: "rgba(0, 0, 0, 0.26)",
  tunnel: "rgba(0, 0, 0, 0.5)",
  hall: "rgba(255, 224, 130, 0.14)",
  shore: "rgba(220, 244, 255, 0.28)",
  causeway: "rgba(255, 255, 255, 0.55)",
  forge: "rgba(255, 255, 255, 0.16)",
  guardHouse: "rgba(255, 255, 255, 0.16)",
  burrow: "rgba(255, 255, 255, 0.16)",
  watchtower: "rgba(255, 255, 255, 0.16)",
  shrine: "rgba(255, 255, 255, 0.16)",
};
export const COLOR_OUTLINE = "#0b0e11";
export const COLOR_CROWN = "#ffd54f";
export const COLOR_CRATE = "#c8a46a";
export const COLOR_ROUTE = "#80deea";
export const COLOR_PLAYER = "#69f0ae";
export const COLOR_PLAYER_DOWN = "#78909c";

const TAU = Math.PI * 2;
/** The size (px) the reference overlay pixel is taken against when a caller gives no `px` (the minimap's REF_SIZE). */
const REF_BASE_SIZE = 150;

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

/** Calls `fn(start, end)` (end exclusive) for each maximal run of equal non-negative values in `values`. */
function eachRun(values: ArrayLike<number>, fn: (start: number, end: number, value: number) => void): void {
  let start = 0;
  for (let i = 1; i <= values.length; i++) {
    if (i < values.length && values[i] === values[start]) continue;
    if (values[start]! >= 0) fn(start, i, values[start]!);
    start = i;
  }
}

/**
 * The floor the map's features own, as runs of one tint per row (rounded outward like the walls'): drawn after the hazards and before
 * the hatch and the walls. A map with no features makes no call here.
 */
function paintFeatureFloors(g: PaintCtx, map: GameMap, tile: number): void {
  if (map.features.length === 0) return;
  const tints = map.features.map((f) => COLOR_FEATURE_FLOOR[floorLookOf(f)] ?? "");
  const classes: number[] = new Array(map.w);
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * tile);
    const bottom = Math.ceil((ty + 1) * tile);
    let any = false;
    for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx;
      const f = map.featureGrid[i]!;
      // A lake's ice already has its own tint; the shore and causeway are the lake's owned floor that has none.
      const c = f !== 0 && map.tiles[i] === TILE_FLOOR && tints[f - 1] !== "" && !(map.terrain[i] === TERRAIN_ICE) ? f - 1 : -1;
      classes[tx] = c;
      any ||= c >= 0;
    }
    if (!any) continue;
    eachRun(classes, (start, end, c) => {
      const left = Math.floor(start * tile);
      g.fillStyle = tints[c]!;
      g.fillRect(left, top, Math.ceil(end * tile) - left, bottom - top);
    });
  }
}

/** Floor hazard tiles as runs of one kind per row, rounded outward like the walls'. */
function paintHazards(g: PaintCtx, map: GameMap, tile: number): void {
  const kinds: number[] = new Array(map.w);
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * tile);
    const bottom = Math.ceil((ty + 1) * tile);
    let any = false;
    for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx;
      const k = map.tiles[i] === TILE_FLOOR && COLOR_HAZARD[map.terrain[i]!] !== undefined ? map.terrain[i]! : -1;
      kinds[tx] = k;
      any ||= k >= 0;
    }
    if (!any) continue;
    eachRun(kinds, (start, end, k) => {
      const left = Math.floor(start * tile);
      g.fillStyle = COLOR_HAZARD[k]!;
      g.fillRect(left, top, Math.ceil(end * tile) - left, bottom - top);
    });
  }
}

/** Whether a LOW tile is part of a fence line (a fence, or a LOW tile with a fence beside it counts through its own kind only). */
function isFence(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const i = ty * map.w + tx;
  return map.tiles[i] === TILE_LOW && map.terrain[i] === TERRAIN_FENCE;
}

/**
 * LOW tiles: lava, a crevasse (with a blue edge) and any other kind as blocks, runs of one kind per row; fences as thin lines along
 * the line they make (a horizontal run per row, a vertical run per column where the line goes up and down, a short stroke for a lone
 * tile). `px` is the context's pixels per reference overlay pixel, for the crevasse's edge width.
 */
function paintLow(g: PaintCtx, map: GameMap, tile: number, px: number): void {
  const kinds: number[] = new Array(map.w);
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * tile);
    const bottom = Math.ceil((ty + 1) * tile);
    let any = false;
    for (let tx = 0; tx < map.w; tx++) {
      const low = map.tiles[ty * map.w + tx] === TILE_LOW;
      const k = low ? map.terrain[ty * map.w + tx]! : -1;
      kinds[tx] = low && !isFence(map, tx, ty) ? k : -1;
      any ||= kinds[tx]! >= 0;
    }
    if (!any) continue;
    eachRun(kinds, (start, end, k) => {
      const left = Math.floor(start * tile);
      const width = Math.ceil(end * tile) - left;
      g.fillStyle = COLOR_LOW[k] ?? COLOR_LOW_DEFAULT;
      g.fillRect(left, top, width, bottom - top);
      if (k === TERRAIN_CREVASSE) {
        g.strokeStyle = COLOR_CREVASSE_EDGE;
        g.lineWidth = Math.max(1, px * 0.7);
        g.strokeRect(left + g.lineWidth / 2, top + g.lineWidth / 2, width - g.lineWidth, bottom - top - g.lineWidth);
      }
    });
  }

  // Fences: thin lines.
  const thick = Math.max(1, Math.round(tile * 0.4));
  // Set at the first fence drawn, not before: a map without any makes no call here (the painter's golden test pins that).
  let fenceStyle = false;
  const useFenceStyle = (): void => {
    if (fenceStyle) return;
    fenceStyle = true;
    g.fillStyle = COLOR_LOW[TERRAIN_FENCE]!;
  };
  const sideways = (tx: number, ty: number): boolean => isFence(map, tx - 1, ty) || isFence(map, tx + 1, ty);
  const updown = (tx: number, ty: number): boolean => isFence(map, tx, ty - 1) || isFence(map, tx, ty + 1);
  const row: number[] = new Array(map.w);
  for (let ty = 0; ty < map.h; ty++) {
    let any = false;
    for (let tx = 0; tx < map.w; tx++) {
      // A tile that joins others sideways, or stands alone, is drawn in its row; a tile that only goes up and down in its column.
      const f = isFence(map, tx, ty) && (sideways(tx, ty) || !updown(tx, ty));
      row[tx] = f ? 0 : -1;
      any ||= f;
    }
    if (!any) continue;
    useFenceStyle();
    const top = Math.floor(ty * tile) + Math.floor((Math.ceil((ty + 1) * tile) - Math.floor(ty * tile) - thick) / 2);
    eachRun(row, (start, end) => {
      const left = Math.floor(start * tile);
      g.fillRect(left, top, Math.ceil(end * tile) - left, thick);
    });
  }
  const col: number[] = new Array(map.h);
  for (let tx = 0; tx < map.w; tx++) {
    let any = false;
    for (let ty = 0; ty < map.h; ty++) {
      const f = isFence(map, tx, ty) && updown(tx, ty) && !sideways(tx, ty);
      col[ty] = f ? 0 : -1;
      any ||= f;
    }
    if (!any) continue;
    useFenceStyle();
    const left = Math.floor(tx * tile) + Math.floor((Math.ceil((tx + 1) * tile) - Math.floor(tx * tile) - thick) / 2);
    eachRun(col, (start, end) => {
      const top = Math.floor(start * tile);
      g.fillRect(left, top, thick, Math.ceil(end * tile) - top);
    });
  }
}

export interface BaseOptions {
  /** Hatch each zone with its own pattern (ZONE_PATTERN) on top of the tint. Off keeps the minimap's original look. */
  patterns?: boolean;
  /** The context's pixels per reference overlay pixel (the crevasse's edge width); the minimap's 150 px reference when absent. */
  px?: number;
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
 * Paints the map's static layer into `w` x `h` pixels: the background, the zone tints, the ground (hazards, LOW), the zone patterns, the walls. `k` is
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

  // The ground: floor hazards (ember, bog, ice, light) as faint tints over the zone colour, so the zone's hatch stays readable on
  // them; LOW tiles (lava, fence, crevasse) below, after the hatch. A barrier that is not drawn is an invisible wall to the player.
  paintHazards(g, map, tile);
  paintFeatureFloors(g, map, tile);

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

  paintLow(g, map, tile, opts.px ?? Math.max(1, w / REF_BASE_SIZE));

  // Horizontal runs of wall tiles per row; edges are rounded outward so neighbouring rows leave no hairline gaps.
  g.fillStyle = COLOR_WALL;
  if (map.features.length > 0) {
    paintFeatureWalls(g, map, tile);
    return;
  }
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

/**
 * The walls of a map that has features: horizontal runs per row like the plain pass, split where the colour changes (a wall of a
 * feature takes its kind's colour, COLOR_FEATURE_WALL; any other wall COLOR_WALL).
 */
function paintFeatureWalls(g: PaintCtx, map: GameMap, tile: number): void {
  const colours = map.features.map((f) => COLOR_FEATURE_WALL[f.kind] ?? COLOR_WALL);
  const palette = [COLOR_WALL, ...new Set(colours.filter((c) => c !== COLOR_WALL))];
  const classOf = colours.map((c) => palette.indexOf(c));
  const row: number[] = new Array(map.w);
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * tile);
    const bottom = Math.ceil((ty + 1) * tile);
    let any = false;
    for (let tx = 0; tx < map.w; tx++) {
      const wall = isWallTile(map, tx, ty);
      const f = wall ? map.featureGrid[ty * map.w + tx]! : 0;
      row[tx] = wall ? (f === 0 ? 0 : classOf[f - 1] ?? 0) : -1;
      any ||= wall;
    }
    if (!any) continue;
    eachRun(row, (start, end, c) => {
      const left = Math.floor(start * tile);
      g.fillStyle = palette[c]!;
      g.fillRect(left, top, Math.ceil(end * tile) - left, bottom - top);
    });
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
/**
 * The mark of a camp somebody has fought at (CampState.state 1). That state is sticky history, not a live fight (mobs that
 * lose their target walk home and heal, and nothing sets it back), so the mark is a small muted ring, never an alert colour.
 */
export const COLOR_DISTURBED = "#b0bec5";
const DISTURBED_ALPHA = 0.7;

/**
 * Camp markers: the zone's shape in its colour with a dark outline, an elite bigger and crowned. With `states` (one number per
 * camp, CAMP_*), a cleared camp is dimmed and crossed out so everyone reads what was taken, and a disturbed one (somebody has
 * fought there; the state never goes back) wears a small muted ring; without them (or with 0s) the calls are exactly the plain
 * markers'.
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
      g.globalAlpha = DISTURBED_ALPHA;
      g.strokeStyle = COLOR_DISTURBED;
      g.lineWidth = 1.4 * px;
      g.beginPath();
      g.arc(cx + r * 0.95, cy - r * 0.85, r * 0.32, 0, TAU);
      g.stroke();
      g.globalAlpha = 1;
      g.strokeStyle = COLOR_OUTLINE;
      g.lineWidth = px;
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
