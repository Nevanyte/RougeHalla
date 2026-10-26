// The zone art as pure draw functions (part D 7.3 and 7.4): each takes a Graphics-like `Pen` and a TileSpot (where the tile's
// ground footprint sits in the target space, its tile coordinates and a hash for the variants) and paints one tile. Nothing here
// touches Phaser, a scene or the map, so the shapes can be tested on a recording stub; bake.ts decides where they go.
//
// Shape language: colour is never the only cue. Ember = angular zigzag cracks, bog = circles and rings, ice = straight diagonals
// and chevrons, light = radial rays (and a vertical beam, which TerrainFx animates), fence = vertical bars, lava = flowing wavy
// lines, crevasse = a jagged slit.
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE, Y_SCALE,
} from "@raid/shared";
import { TERRAIN_PALETTE, ZONE_PALETTE, darken, mix, type ZoneKey } from "./palette";

/** One tile's ground footprint in projected pixels. */
export const TILE_W = TILE;
export const TILE_H = TILE * Y_SCALE;
/** Pixels a wall's top face is lifted above its footprint (MapView re-exports it). Under one projected tile so a wall never hides the tile north of it. */
export const WALL_HEIGHT = 14;
/** A LOW block (a fence) is knee-high: half a wall. */
export const LOW_HEIGHT = 7;
/** Rime rocks are shards at 70% of a wall (D 7.3). */
export const SHARD_HEIGHT = Math.round(WALL_HEIGHT * 0.7);

/** The Graphics methods the art uses, so a stub can stand in for Phaser's Graphics. */
export interface Pen {
  fillStyle(color: number, alpha?: number): this;
  lineStyle(width: number, color: number, alpha?: number): this;
  fillRect(x: number, y: number, w: number, h: number): this;
  strokeRect(x: number, y: number, w: number, h: number): this;
  fillRoundedRect(x: number, y: number, w: number, h: number, radius: number | { tl: number; tr: number; bl: number; br: number }): this;
  lineBetween(x1: number, y1: number, x2: number, y2: number): this;
  fillCircle(x: number, y: number, r: number): this;
  strokeCircle(x: number, y: number, r: number): this;
  fillEllipse(x: number, y: number, w: number, h: number): this;
  strokeEllipse(x: number, y: number, w: number, h: number): this;
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this;
  beginPath(): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  closePath(): this;
  fillPath(): this;
  strokePath(): this;
}

/** Sides of a tile, as a bit set: the side faces north (up the screen), east, south, west. */
export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;

/** Where one tile is painted. */
export interface TileSpot {
  /** Top-left of the tile's ground footprint in the target space (the texture being painted). */
  x: number;
  y: number;
  /** Tile coordinates: features that must run on across neighbouring tiles read their phase from these. */
  tx: number;
  ty: number;
  /** A 32-bit hash of the tile: which variant, how the marks fall. */
  hash: number;
  /** The sides whose neighbour is not the same kind of tile (an open edge gets the rim, the outline, the post). */
  open: number;
}

// ------------------------------------------------------------------------------------------------------------------ hashing

/** A 32-bit integer mix of a tile and a salt; deterministic, integer maths only. */
export function hashTile(tx: number, ty: number, salt = 0): number {
  let h = Math.imul(tx + 0x9e37, 0x85ebca6b) ^ Math.imul(ty + 0x7f4a, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** `n` bits of `h` from bit `shift`, as 0..2^n-1. */
function bits(h: number, shift: number, n: number): number {
  return (h >>> shift) & ((1 << n) - 1);
}

/** A 0..1 value from 8 bits of `h`. */
function unit(h: number, shift: number): number {
  return bits(h, shift, 8) / 255;
}

// ------------------------------------------------------------------------------------------------------------------ plain floor

/** The base colour of a plain floor tile (a share of the tiles takes the alternate tint; Sanctum alternates as a checker). */
export function floorTileColor(zone: ZoneKey, spot: Pick<TileSpot, "tx" | "ty" | "hash">): number {
  const p = ZONE_PALETTE[zone];
  if (zone === "holy") return ((spot.tx + spot.ty) & 1) === 0 ? p.floor : p.floorAlt;
  return bits(spot.hash, 0, 2) === 0 ? p.floorAlt : p.floor;
}

/** One plain ground tile of a zone: its colour and the zone's marks (ash flecks, mortar, moss, frost scratches, grout). */
export function drawFloorTile(g: Pen, zone: ZoneKey, s: TileSpot): void {
  const p = ZONE_PALETTE[zone];
  const { x, y, hash: h } = s;
  g.fillStyle(floorTileColor(zone, s), 1).fillRect(x, y, TILE_W, TILE_H);
  switch (zone) {
    case "fire":
      // Ash flecks, and now and then a hairline crack.
      if (bits(h, 2, 2) === 0) {
        g.fillStyle(p.floorMark, 1);
        g.fillRect(x + 3 + bits(h, 4, 4), y + 3 + bits(h, 8, 4), 3, 1);
        g.fillRect(x + 14 + bits(h, 12, 3), y + 12 + bits(h, 15, 3), 2, 1);
      }
      if (bits(h, 18, 4) === 0) {
        g.lineStyle(1, p.floorMark, 0.8).lineBetween(x + 6, y + 5, x + 13, y + 11).lineBetween(x + 13, y + 11, x + 12, y + 19);
      }
      break;
    case "sentenced":
      // Flagstones: mortar under every tile and a joint that alternates by row.
      g.fillStyle(p.floorMark, 1);
      g.fillRect(x, y + TILE_H - 1, TILE_W, 1);
      g.fillRect(x + ((s.ty & 1) === 0 ? 0 : 16) + bits(h, 2, 2), y, 1, TILE_H);
      // A chipped corner on one flag in eight.
      if (bits(h, 4, 3) === 0) g.fillRect(x + 19 + bits(h, 7, 3), y + 4 + bits(h, 10, 3), 4, 2);
      break;
    case "plague":
      // Moss specks.
      g.fillStyle(p.floorMark, 1);
      g.fillRect(x + 4 + bits(h, 4, 4), y + 4 + bits(h, 8, 4), 3, 1);
      if (bits(h, 12, 1) === 0) g.fillRect(x + 18 + bits(h, 13, 3), y + 14 + bits(h, 16, 3), 2, 2);
      break;
    case "frost":
      // Faint frost scratches.
      if (bits(h, 2, 2) === 0) g.lineStyle(1, p.floorMark, 0.55).lineBetween(x + 6, y + TILE_H - 4, x + 20, y + 5);
      break;
    case "holy":
      // Tile joints in a worn gold.
      g.fillStyle(p.accent, 0.13);
      g.fillRect(x + TILE_W - 1, y, 1, TILE_H);
      g.fillRect(x, y + TILE_H - 1, TILE_W, 1);
      // A worn patch or a hairline crack on one tile in six.
      if (bits(h, 2, 3) === 0) g.fillStyle(p.floorMark, 0.8).fillEllipse(x + 8 + bits(h, 5, 4) * 1.2, y + 8 + bits(h, 9, 3) * 1.5, 9, 5);
      else if (bits(h, 2, 3) === 1) g.lineStyle(1, p.floorMark, 0.9).lineBetween(x + 5, y + 4, x + 12, y + 12).lineBetween(x + 12, y + 12, x + 11, y + 20);
      break;
  }
}

// ------------------------------------------------------------------------------------------------------------------ terrain, flat

/** A kind drawn flat into the floor (a floor kind, or a LOW kind that has no height: lava, crevasse). */
export function isFlatTerrain(kind: number): boolean {
  return kind === TERRAIN_LAVA || kind === TERRAIN_CREVASSE || kind === TERRAIN_EMBER || kind === TERRAIN_BOG || kind === TERRAIN_ICE || kind === TERRAIN_LIGHT;
}

/** Kinds that read as one heat for the rim: an ember bank has no outline against the lava it lines. */
export function terrainFamily(kind: number): number {
  return kind === TERRAIN_LAVA ? TERRAIN_EMBER : kind;
}

/** Paints one flat terrain tile (it replaces the plain floor tile). Kinds that are not flat are ignored. */
export function drawTerrainFloor(g: Pen, kind: number, s: TileSpot): void {
  switch (kind) {
    case TERRAIN_LAVA: drawLava(g, s); break;
    case TERRAIN_EMBER: drawEmber(g, s); break;
    case TERRAIN_BOG: drawBog(g, s); break;
    case TERRAIN_ICE: drawIce(g, s); break;
    case TERRAIN_LIGHT: drawLightPool(g, s); break;
    case TERRAIN_CREVASSE: drawCrevasse(g, s); break;
  }
}

/** A wavy line from (x, y) running right across one tile; the phase is a function of the tile's column, so it runs on into the next. */
function wavy(g: Pen, x: number, y: number, tx: number, line: number, amp: number): void {
  g.beginPath();
  for (let i = 0; i <= 4; i++) {
    const wx = tx * TILE_W + i * 8;
    const py = y + amp * Math.sin(wx * 0.19 + line * 1.9) + amp * 0.4 * Math.sin(wx * 0.43 + line);
    if (i === 0) g.moveTo(x, py);
    else g.lineTo(x + i * 8, py);
  }
  g.strokePath();
}

function drawLava(g: Pen, s: TileSpot): void {
  const c = TERRAIN_PALETTE.lava;
  const { x, y, hash: h } = s;
  g.fillStyle(c.body, 1).fillRect(x, y, TILE_W, TILE_H);
  // Three or four lighter flow lines.
  const lines = 3 + bits(h, 0, 1);
  g.lineStyle(1.5, c.core, 0.85);
  for (let j = 0; j < lines; j++) wavy(g, x, y + ((j + 0.6) * TILE_H) / lines, s.tx, j, 1.6);
  // A hot fleck now and then.
  if (bits(h, 3, 2) === 0) g.fillStyle(c.core, 0.9).fillRect(x + 6 + bits(h, 6, 4) * 1.5, y + 4 + bits(h, 10, 4), 3, 2);
  // The crust: a dark rim where the lava meets anything else, thicker on the near (south) side, a lip you see over.
  g.fillStyle(c.crust, 1);
  if ((s.open & EDGE_N) !== 0) g.fillRect(x, y, TILE_W, 2);
  if ((s.open & EDGE_S) !== 0) g.fillRect(x, y + TILE_H - 3, TILE_W, 3);
  if ((s.open & EDGE_W) !== 0) g.fillRect(x, y, 2, TILE_H);
  if ((s.open & EDGE_E) !== 0) g.fillRect(x + TILE_W - 2, y, 2, TILE_H);
}

/** A zigzag of `n` segments from (x, y) with x advancing by `dx` and y alternating by ±amp: sharp angles, the ember's cue. */
function zigzag(g: Pen, x: number, y: number, dx: number, amp: number, n: number, flip: boolean): void {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const py = y + (((i & 1) === 0) !== flip ? -amp : amp);
    if (i === 0) g.moveTo(x, py);
    else g.lineTo(x + i * dx, py);
  }
  g.strokePath();
}

function drawEmber(g: Pen, s: TileSpot): void {
  const c = TERRAIN_PALETTE.ember;
  const { x, y, hash: h } = s;
  g.fillStyle(c.base, 1).fillRect(x, y, TILE_W, TILE_H);
  // Three angular cracks, each drawn as a wide dim line and a thin bright one.
  const flip = bits(h, 0, 1) === 1;
  for (let k = 0; k < 3; k++) {
    const cy = y + ((k + 0.5) * TILE_H) / 3 + (bits(h, 2 + k * 3, 2) - 1.5) * 0.6;
    const cx = x + 1 + bits(h, 9 + k * 3, 1);
    g.lineStyle(3, c.glow, 0.35);
    zigzag(g, cx, cy, 5.5, 2.6, 5, flip !== (k === 1));
    g.lineStyle(1.2, c.cracks, 0.95);
    zigzag(g, cx, cy, 5.5, 2.6, 5, flip !== (k === 1));
  }
  // A bright 1 px outline where the ember meets plain ground: readable from far away.
  g.lineStyle(1, c.glow, 0.95);
  if ((s.open & EDGE_N) !== 0) g.lineBetween(x, y + 0.5, x + TILE_W, y + 0.5);
  if ((s.open & EDGE_S) !== 0) g.lineBetween(x, y + TILE_H - 0.5, x + TILE_W, y + TILE_H - 0.5);
  if ((s.open & EDGE_W) !== 0) g.lineBetween(x + 0.5, y, x + 0.5, y + TILE_H);
  if ((s.open & EDGE_E) !== 0) g.lineBetween(x + TILE_W - 0.5, y, x + TILE_W - 0.5, y + TILE_H);
}

function drawBog(g: Pen, s: TileSpot): void {
  const c = TERRAIN_PALETTE.bog;
  const { x, y, hash: h } = s;
  g.fillStyle(c.body, 1).fillRect(x, y, TILE_W, TILE_H);
  // Dark sludge, ripple rings (squashed circles) and a few bubbles: round things everywhere.
  g.fillStyle(c.sludge, 0.55);
  g.fillEllipse(x + 8 + bits(h, 0, 4), y + 6 + bits(h, 4, 3), 12, 8);
  g.fillEllipse(x + 20 + bits(h, 7, 3), y + 13 + bits(h, 10, 3) * 0.9, 10, 7);
  const rx = x + 10 + bits(h, 13, 4) * 0.8;
  const ry = y + 9 + bits(h, 17, 3);
  g.lineStyle(1.2, c.surface, 0.8);
  g.strokeEllipse(rx, ry, 11, 11 * Y_SCALE);
  g.strokeEllipse(rx, ry, 5, 5 * Y_SCALE);
  g.lineStyle(1, c.surface, 0.55).strokeEllipse(x + 22 - bits(h, 20, 3), y + 17 + bits(h, 23, 2), 8, 8 * Y_SCALE);
  g.fillStyle(c.bubbles, 0.9);
  g.fillCircle(x + 5 + bits(h, 25, 4), y + 18 + bits(h, 29, 2), 1.5);
  g.fillCircle(x + 24 - bits(h, 21, 3), y + 5 + bits(h, 24, 2), 1.2);
}

/** A 45 degree line `u + v = c` in tile-global projected space, clipped to the tile's footprint; nothing is drawn if it misses it. */
function diagonal(g: Pen, x: number, y: number, tx: number, ty: number, c: number): void {
  const gx = tx * TILE_W;
  const gy = ty * TILE_H;
  // Points of u + v = c inside [gx, gx+W] x [gy, gy+H]: u from max(gx, c-gy-H) to min(gx+W, c-gy).
  const u0 = Math.max(gx, c - gy - TILE_H);
  const u1 = Math.min(gx + TILE_W, c - gy);
  if (u1 - u0 < 1) return;
  g.lineBetween(x + (u0 - gx), y + (c - u0 - gy), x + (u1 - gx), y + (c - u1 - gy));
}

const ICE_SPACING = 13;

function drawIce(g: Pen, s: TileSpot): void {
  const c = TERRAIN_PALETTE.ice;
  const { x, y, hash: h } = s;
  g.fillStyle(c.body, 1).fillRect(x, y, TILE_W, TILE_H);
  // Straight diagonal specular streaks that run on across the lake, two weights.
  const gx = s.tx * TILE_W + s.ty * TILE_H;
  const first = Math.ceil((gx - TILE_H) / ICE_SPACING);
  g.lineStyle(1.5, c.highlight, 0.6);
  for (let k = first; k * ICE_SPACING <= gx + TILE_W + TILE_H; k++) {
    if ((k & 1) === 0) diagonal(g, x, y, s.tx, s.ty, k * ICE_SPACING);
  }
  g.lineStyle(1, c.highlight, 0.28);
  for (let k = first; k * ICE_SPACING <= gx + TILE_W + TILE_H; k++) {
    if ((k & 1) !== 0) diagonal(g, x, y, s.tx, s.ty, k * ICE_SPACING);
  }
  // A faint crack grid on the tile's east and south seams.
  g.lineStyle(1, c.crack, 0.4);
  g.lineBetween(x + TILE_W - 0.5, y, x + TILE_W - 0.5, y + TILE_H);
  g.lineBetween(x, y + TILE_H - 0.5, x + TILE_W, y + TILE_H - 0.5);
  // A chevron on one tile in four.
  if (bits(h, 0, 2) === 0) {
    const cx = x + 10 + bits(h, 2, 3) * 2;
    const cy = y + 12;
    g.lineStyle(1.5, c.highlight, 0.9).lineBetween(cx, cy - 5, cx + 5, cy).lineBetween(cx + 5, cy, cx, cy + 5);
  }
}

/** The centre of a tile's footprint. */
function centre(s: TileSpot): { cx: number; cy: number } {
  return { cx: s.x + TILE_W / 2, cy: s.y + TILE_H / 2 };
}

/** Rays of the light pool: radial lines from the centre. */
export const LIGHT_RAYS = 8;

function drawLightPool(g: Pen, s: TileSpot): void {
  const c = TERRAIN_PALETTE.light;
  const { cx, cy } = centre(s);
  g.fillStyle(c.warm, 0.14).fillRect(s.x, s.y, TILE_W, TILE_H);
  g.fillStyle(c.beam, 0.3).fillEllipse(cx, cy, 26, 26 * Y_SCALE);
  g.lineStyle(1.2, c.beam, 0.7);
  for (let i = 0; i < LIGHT_RAYS; i++) {
    const a = (i / LIGHT_RAYS) * Math.PI * 2 + 0.2;
    g.lineBetween(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4 * Y_SCALE, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14 * Y_SCALE);
  }
}

function drawCrevasse(g: Pen, s: TileSpot): void {
  const c = TERRAIN_PALETTE.crevasse;
  const { x, y, hash: h } = s;
  g.fillStyle(c.body, 1).fillRect(x, y, TILE_W, TILE_H);
  // The lip: a jagged lighter edge on every open side.
  g.lineStyle(1.5, c.edge, 0.9);
  const offset = bits(h, 0, 2);
  const jagH = (ly: number): void => {
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const py = ly + (((i + offset) & 1) === 0 ? 0 : 2);
      if (i === 0) g.moveTo(x, py);
      else g.lineTo(x + (i / 6) * TILE_W, py);
    }
    g.strokePath();
  };
  const jagV = (lx: number): void => {
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const px = lx + (((i + offset) & 1) === 0 ? 0 : 2);
      if (i === 0) g.moveTo(px, y);
      else g.lineTo(px, y + (i / 5) * TILE_H);
    }
    g.strokePath();
  };
  if ((s.open & EDGE_N) !== 0) jagH(y + 1);
  if ((s.open & EDGE_S) !== 0) jagH(y + TILE_H - 3);
  if ((s.open & EDGE_W) !== 0) jagV(x + 1);
  if ((s.open & EDGE_E) !== 0) jagV(x + TILE_W - 3);
  // A jagged dark slit through the middle, with a thin glint beside it.
  const sy = y + 6 + bits(h, 3, 3) * 1.5;
  g.lineStyle(2.5, c.deep, 1);
  zigzag(g, x + 1, sy, 5, 4, 6, bits(h, 6, 1) === 1);
  g.lineStyle(1, c.edge, 0.55);
  zigzag(g, x + 1, sy + 5, 5, 3, 6, bits(h, 6, 1) === 0);
}

// ------------------------------------------------------------------------------------------------------------------ walls

/** How a wall tile is drawn: part of a solid mass, a lone rock, a run of single stones, or a pillar standing in a LOW feature. */
export type WallStyle = "mass" | "rock" | "segment" | "pillar";

export interface WallInfo {
  style: WallStyle;
  /** Pixels the top face is lifted (WALL_HEIGHT, or SHARD_HEIGHT for a Rime rock). */
  lift: number;
  /** Sides with no wall neighbour (the top's rim and chamfers). */
  open: number;
  /** The south neighbour is not a wall: the front face shows. */
  front: boolean;
  /** For a pillar: the LOW kind it stands in (lava, fence, crevasse); 0 otherwise. */
  pillarKind: number;
}

function chamfered(g: Pen, x: number, y: number, w: number, h: number, c: number, open: number, color: number): void {
  const nw = (open & EDGE_N) !== 0 && (open & EDGE_W) !== 0 ? c : 0;
  const ne = (open & EDGE_N) !== 0 && (open & EDGE_E) !== 0 ? c : 0;
  const se = (open & EDGE_S) !== 0 && (open & EDGE_E) !== 0 ? c : 0;
  const sw = (open & EDGE_S) !== 0 && (open & EDGE_W) !== 0 ? c : 0;
  g.fillStyle(color, 1);
  if (nw + ne + se + sw === 0) {
    g.fillRect(x, y, w, h);
    return;
  }
  g.beginPath();
  g.moveTo(x + nw, y).lineTo(x + w - ne, y).lineTo(x + w, y + ne).lineTo(x + w, y + h - se).lineTo(x + w - se, y + h);
  g.lineTo(x + sw, y + h).lineTo(x, y + h - sw).lineTo(x, y + nw).closePath().fillPath();
}

/** The lit rim along a top face's open north side. */
function rim(g: Pen, x: number, y: number, open: number, color: number, alpha = 0.7, inset = 0): void {
  if ((open & EDGE_N) !== 0) g.lineStyle(1, color, alpha).lineBetween(x + inset, y + 0.5, x + TILE_W - inset, y + 0.5);
}

/** Paints one wall tile's top face and (where the south is open) its front face, in the zone's wall style. */
export function drawWallTile(g: Pen, zone: ZoneKey, s: TileSpot, w: WallInfo): void {
  if (w.style === "pillar") {
    drawPillar(g, zone, s, w);
    return;
  }
  const p = ZONE_PALETTE[zone];
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  switch (zone) {
    case "fire": {
      // Obsidian: chamfered top (more faceted on a lone rock), a glassy front and a glowing crack on about a quarter of them.
      chamfered(g, s.x, top, TILE_W, TILE_H, w.style === "rock" ? 4 + bits(s.hash, 0, 1) : 1 + bits(s.hash, 0, 1), w.open, p.wallTop);
      rim(g, s.x, top, w.open, p.wallRim, 0.5);
      if (w.front) {
        g.fillStyle(p.wallFront, 1).fillRect(s.x, frontY, TILE_W, w.lift);
        g.fillStyle(0xffffff, 0.08).fillRect(s.x, frontY + 2, TILE_W, 2);
        if (bits(s.hash, 4, 2) === 0) {
          g.lineStyle(1.2, p.accent, 0.95);
          zigzag(g, s.x + 2 + bits(s.hash, 8, 2), frontY + w.lift / 2, 4.5, 3, 5, bits(s.hash, 11, 1) === 1);
        }
      }
      break;
    }
    case "sentenced": {
      // Cell stone: a flat top; the front is courses of brick with offset joints, and a barred window on one in ten.
      g.fillStyle(p.wallTop, 1).fillRect(s.x, top, TILE_W, TILE_H);
      rim(g, s.x, top, w.open, p.wallRim, 0.6);
      if (w.front) {
        g.fillStyle(p.wallFront, 1).fillRect(s.x, frontY, TILE_W, w.lift);
        g.fillStyle(p.floorMark, 1);
        g.fillRect(s.x, frontY + w.lift / 3, TILE_W, 1);
        g.fillRect(s.x, frontY + (2 * w.lift) / 3, TILE_W, 1);
        const j = 6 + bits(s.hash, 0, 3);
        g.fillRect(s.x + j, frontY, 1, w.lift / 3);
        g.fillRect(s.x + ((j + 14) % 28), frontY + w.lift / 3, 1, w.lift / 3);
        g.fillRect(s.x + j + 4, frontY + (2 * w.lift) / 3, 1, w.lift / 3);
        if (bits(s.hash, 4, 4) === 0) drawBarredWindow(g, s.x + 10, frontY + 2, w.lift - 5);
      }
      break;
    }
    case "plague": {
      // Fungus and rock: a rounded top (round where it is open), a moss front with drip streaks.
      const r = 6;
      const open = w.open;
      g.fillStyle(p.wallTop, 1).fillRoundedRect(s.x, top, TILE_W, TILE_H, {
        tl: (open & EDGE_N) !== 0 && (open & EDGE_W) !== 0 ? r : 0, tr: (open & EDGE_N) !== 0 && (open & EDGE_E) !== 0 ? r : 0,
        bl: (open & EDGE_S) !== 0 && (open & EDGE_W) !== 0 ? r : 0, br: (open & EDGE_S) !== 0 && (open & EDGE_E) !== 0 ? r : 0,
      });
      rim(g, s.x, top, w.open, p.wallRim, 0.4, 2);
      if (w.front) {
        g.fillStyle(p.wallFront, 1).fillRect(s.x, frontY, TILE_W, w.lift);
        g.fillStyle(p.wallTop, 0.8).fillRect(s.x, frontY, TILE_W, 3);
        g.lineStyle(1.2, p.accent, 0.55);
        const a = s.x + 5 + bits(s.hash, 0, 4);
        g.lineBetween(a, frontY + 3, a, frontY + 4 + bits(s.hash, 4, 3));
        g.lineBetween(a + 12, frontY + 3, a + 12, frontY + 5 + bits(s.hash, 7, 3));
      }
      break;
    }
    case "frost": {
      // Ice crystals: the top is split by a diagonal into a light and a dark facet; the front shades toward the foot.
      const dark = darken(p.wallTop, 0.16);
      const flip = bits(s.hash, 0, 1) === 1;
      g.fillStyle(p.wallTop, 1).fillRect(s.x, top, TILE_W, TILE_H);
      g.fillStyle(dark, 1);
      if (flip) g.fillTriangle(s.x, top, s.x + TILE_W, top + TILE_H, s.x, top + TILE_H);
      else g.fillTriangle(s.x + TILE_W, top, s.x + TILE_W, top + TILE_H, s.x, top + TILE_H);
      rim(g, s.x, top, w.open, p.wallRim, 0.9);
      if (w.front) {
        const band = w.lift / 3;
        g.fillStyle(mix(p.wallFront, p.wallTop, 0.35), 1).fillRect(s.x, frontY, TILE_W, band);
        g.fillStyle(p.wallFront, 1).fillRect(s.x, frontY + band, TILE_W, band);
        g.fillStyle(darken(p.wallFront, 0.22), 1).fillRect(s.x, frontY + 2 * band, TILE_W, w.lift - 2 * band);
      }
      break;
    }
    case "holy": {
      if (w.style === "rock") {
        drawColumn(g, s, w);
        break;
      }
      // Cathedral blocks with a gold trim line along the top rim and the foot of the front.
      g.fillStyle(p.wallTop, 1).fillRect(s.x, top, TILE_W, TILE_H);
      if ((w.open & EDGE_N) !== 0) g.fillStyle(p.accent, 0.9).fillRect(s.x, top, TILE_W, 2);
      if (w.front) {
        g.fillStyle(p.wallFront, 1).fillRect(s.x, frontY, TILE_W, w.lift);
        g.fillStyle(darken(p.wallFront, 0.25), 1);
        g.fillRect(s.x + 15, frontY, 1, w.lift / 2).fillRect(s.x + 7, frontY + w.lift / 2, 1, w.lift / 2).fillRect(s.x + 23, frontY + w.lift / 2, 1, w.lift / 2);
        g.fillRect(s.x, frontY + w.lift / 2, TILE_W, 1);
        g.fillStyle(p.accent, 0.85).fillRect(s.x, frontY + w.lift - 2, TILE_W, 2);
      }
      break;
    }
  }
}

function drawBarredWindow(g: Pen, x: number, y: number, h: number): void {
  g.fillStyle(0x0d0e12, 1).fillRect(x, y, 10, h);
  g.fillStyle(0x6b6f7c, 1).fillRect(x + 3, y, 1, h).fillRect(x + 6, y, 1, h);
}

/** A cathedral column: the wall tile alone, drawn as a round shaft with a gold base and capital. */
function drawColumn(g: Pen, s: TileSpot, w: WallInfo): void {
  const p = ZONE_PALETTE.holy;
  const cx = s.x + TILE_W / 2;
  const base = s.y + TILE_H * 0.78;
  g.fillStyle(p.accent, 1).fillEllipse(cx, base, 24, 9);
  g.fillStyle(p.wallFront, 1).fillRect(cx - 8, base - w.lift, 16, w.lift);
  g.fillStyle(darken(p.wallFront, 0.3), 1).fillRect(cx - 3, base - w.lift, 1, w.lift).fillRect(cx + 2, base - w.lift, 1, w.lift);
  g.fillStyle(p.wallTop, 1).fillRect(cx - 8, base - w.lift, 5, w.lift);
  g.fillStyle(p.accent, 1).fillEllipse(cx, base - w.lift, 24, 9);
  g.fillStyle(p.wallTop, 1).fillEllipse(cx, base - w.lift - 1, 19, 7);
}

/**
 * A wall tile that stands in a LOW feature (map.terrain keeps the feature's kind on a WALL tile, D 7.6): a basalt column rising
 * from the lava, a gatepost with a chain loop and a banner on a fence line, an ice bridge pier over a crevasse.
 */
function drawPillar(g: Pen, zone: ZoneKey, s: TileSpot, w: WallInfo): void {
  const p = ZONE_PALETTE[zone];
  const cx = s.x + TILE_W / 2;
  const base = s.y + TILE_H * 0.8;
  const lift = w.lift;
  switch (w.pillarKind) {
    case TERRAIN_LAVA: {
      // A glowing ring where the column meets the lava, a dark prism with a hot crack, a faceted cap.
      g.fillStyle(TERRAIN_PALETTE.lava.core, 0.55).fillEllipse(cx, base, 30, 30 * Y_SCALE);
      g.lineStyle(1.5, TERRAIN_PALETTE.ember.glow, 0.95).strokeEllipse(cx, base, 26, 26 * Y_SCALE);
      g.fillStyle(p.wallFront, 1).fillRect(cx - 9, base - lift, 18, lift);
      g.fillStyle(darken(p.wallFront, 0.3), 1).fillRect(cx + 3, base - lift, 6, lift);
      g.lineStyle(1.2, p.accent, 0.95).lineBetween(cx - 3, base - 1, cx - 1, base - lift * 0.5).lineBetween(cx - 1, base - lift * 0.5, cx - 4, base - lift + 2);
      g.fillStyle(p.wallTop, 1).fillEllipse(cx, base - lift, 20, 12);
      break;
    }
    case TERRAIN_FENCE: {
      // A stone gatepost, a chain looping off its side and a banner hanging on its front.
      const f = TERRAIN_PALETTE.gallows;
      g.fillStyle(0x000000, 0.3).fillEllipse(cx, base, 20, 7);
      g.fillStyle(p.wallFront, 1).fillRect(cx - 7, base - lift, 14, lift);
      g.fillStyle(p.wallTop, 1).fillRect(cx - 8, base - lift - 3, 16, 4);
      g.fillStyle(p.wallRim, 1).fillRect(cx - 8, base - lift - 3, 16, 1);
      g.fillStyle(f.banner, 1).fillRect(cx - 3, base - lift + 2, 7, 8);
      g.fillTriangle(cx - 3, base - lift + 10, cx + 4, base - lift + 10, cx + 0.5, base - lift + 13);
      g.lineStyle(1.2, f.chain, 0.95);
      g.beginPath().moveTo(cx + 7, base - lift + 2).lineTo(cx + 12, base - lift + 6).lineTo(cx + 16, base - lift + 5).strokePath();
      g.strokeCircle(cx + 17, base - lift + 6, 1.8);
      break;
    }
    case TERRAIN_CREVASSE: {
      // An ice pier: tapered, pale, with a dark foot in the crevasse and a frosted cap.
      g.fillStyle(TERRAIN_PALETTE.crevasse.deep, 0.85).fillEllipse(cx, base + 1, 28, 11);
      g.fillStyle(p.wallFront, 1);
      g.fillTriangle(cx - 9, base, cx + 9, base, cx + 6, base - lift);
      g.fillTriangle(cx - 9, base, cx + 6, base - lift, cx - 6, base - lift);
      g.fillStyle(p.wallTop, 1).fillRect(cx - 7, base - lift - 2, 14, 4);
      g.fillStyle(0xffffff, 0.9).fillRect(cx - 7, base - lift - 2, 14, 1);
      break;
    }
    default: {
      g.fillStyle(p.wallFront, 1).fillRect(cx - 8, base - lift, 16, lift);
      g.fillStyle(p.wallTop, 1).fillEllipse(cx, base - lift, 20, 10);
    }
  }
}

/** The LOW block of a fence: iron bars under a top rail, with posts where the line ends (D 7.4). `open` = sides with no fence neighbour. */
export function drawFenceTile(g: Pen, s: TileSpot, front: boolean): void {
  const c = TERRAIN_PALETTE.fence;
  const top = s.y - LOW_HEIGHT;
  g.fillStyle(c.iron, 1).fillRect(s.x, top, TILE_W, TILE_H);
  // The rail runs along the line: east-west when it continues sideways, north-south when it continues up or down.
  const lineH = (s.open & EDGE_E) === 0 || (s.open & EDGE_W) === 0;
  const lineV = (s.open & EDGE_N) === 0 || (s.open & EDGE_S) === 0;
  const cx = s.x + TILE_W / 2;
  const cy = top + TILE_H / 2;
  g.lineStyle(2, c.highlight, 0.9);
  if (lineH) g.lineBetween((s.open & EDGE_W) === 0 ? s.x : cx, cy, (s.open & EDGE_E) === 0 ? s.x + TILE_W : cx, cy);
  if (lineV) g.lineBetween(cx, (s.open & EDGE_N) === 0 ? top : cy, cx, (s.open & EDGE_S) === 0 ? top + TILE_H : cy);
  // A post at each tile end along the line, or one in the middle of a lone tile.
  g.fillStyle(c.highlight, 1);
  if (lineH && !lineV) g.fillRect(s.x, cy - 2.5, 4, 5).fillRect(s.x + TILE_W - 4, cy - 2.5, 4, 5);
  else if (lineV && !lineH) g.fillRect(cx - 2.5, top, 5, 4).fillRect(cx - 2.5, top + TILE_H - 4, 5, 4);
  else g.fillRect(cx - 3, cy - 3, 6, 6);
  if (front) {
    const fy = s.y + TILE_H - LOW_HEIGHT;
    g.fillStyle(darken(c.iron, 0.25), 1).fillRect(s.x, fy, TILE_W, LOW_HEIGHT);
    g.fillStyle(c.highlight, 0.95).fillRect(s.x, fy, TILE_W, 1);
    // Vertical bars every 8 px.
    for (let i = 0; i < 4; i++) g.fillRect(s.x + 3 + i * 8, fy + 1, 2, LOW_HEIGHT - 1);
  }
}

// ------------------------------------------------------------------------------------------------------------------ props

/** A cosmetic prop to paint: its kind key (propKinds.ts), the spot of its tile and its variant byte. */
export interface PropSpot {
  key: string;
  /** The anchor in the target space (a world position projected, minus the texture's origin). */
  x: number;
  y: number;
  /** 0..255. */
  v: number;
  /** For props on a wall: how far the tile's top is lifted. */
  lift: number;
}

/** The props that are painted into the floor: flat decals and small fixtures. */
export const FLAT_PROPS: ReadonlySet<string> = new Set(["ember_vent", "ash_drift", "lantern", "bubble", "snow_drift", "frost_sparkle", "candelabra", "rubble", "stained_glass"]);

/** The props that are part of a wall's face (baked into the strip) or stand on a LOW tile. */
export const WALL_PROPS: ReadonlySet<string> = new Set([
  "glow_crack", "basalt_shard", "banner", "gallows", "cell_bars", "fungus_cap", "drip", "pipe", "ice_spire", "icicle", "column_cap", "banner_red", "chain",
]);

/** Props that emit particles (TerrainFx): embers from a vent, spores from a bubble, sparkles from frost. */
export const EMITTER_PROPS: ReadonlySet<string> = new Set(["ember_vent", "bubble", "frost_sparkle"]);

/** A flat prop painted into a floor chunk. */
export function drawFlatProp(g: Pen, p: PropSpot): void {
  const { x, y, v } = p;
  switch (p.key) {
    case "ember_vent":
      g.fillStyle(0x1a0c06, 1).fillEllipse(x, y, 14, 14 * Y_SCALE);
      g.lineStyle(1.5, TERRAIN_PALETTE.ember.glow, 0.95).strokeEllipse(x, y, 14, 14 * Y_SCALE);
      g.fillStyle(TERRAIN_PALETTE.ember.cracks, 0.85).fillEllipse(x, y, 6, 6 * Y_SCALE);
      break;
    case "ash_drift":
      g.fillStyle(0x4a3f38, 0.7).fillEllipse(x, y, 20 + (v & 7), 7);
      g.fillStyle(0x5a4d44, 0.6).fillEllipse(x - 2, y - 1, 11, 4);
      break;
    case "lantern":
      g.fillStyle(0x15161a, 1).fillCircle(x, y, 3.5);
      g.fillStyle(0xffd27a, 0.35).fillEllipse(x, y, 22, 22 * Y_SCALE);
      g.fillStyle(0xffd27a, 1).fillCircle(x, y - 1, 2);
      break;
    case "bubble":
      g.lineStyle(1.2, TERRAIN_PALETTE.bog.surface, 0.9).strokeEllipse(x, y, 10, 10 * Y_SCALE).strokeEllipse(x, y, 4, 4 * Y_SCALE);
      g.fillStyle(TERRAIN_PALETTE.bog.bubbles, 0.85).fillCircle(x + 5, y - 3, 1.4);
      break;
    case "snow_drift":
      g.fillStyle(0xe8f4fb, 0.85).fillEllipse(x, y, 22 + (v & 7), 9);
      g.fillStyle(0xffffff, 0.9).fillEllipse(x - 3, y - 1.5, 12, 4);
      break;
    case "frost_sparkle":
      g.lineStyle(1, 0xffffff, 0.9).lineBetween(x - 4, y, x + 4, y).lineBetween(x, y - 4, x, y + 4);
      g.lineStyle(1, 0xffffff, 0.5).lineBetween(x - 2.5, y - 2.5, x + 2.5, y + 2.5).lineBetween(x - 2.5, y + 2.5, x + 2.5, y - 2.5);
      break;
    case "candelabra": {
      const gold = TERRAIN_PALETTE.sanctum.gold;
      g.fillStyle(gold, 1).fillEllipse(x, y + 1, 12, 5);
      g.fillStyle(gold, 1).fillRect(x - 1, y - 7, 2, 8);
      g.fillRect(x - 5, y - 6, 10, 1.5);
      g.fillStyle(0xffe28a, 1).fillCircle(x - 5, y - 8, 1.6).fillCircle(x, y - 9, 1.8).fillCircle(x + 5, y - 8, 1.6);
      break;
    }
    case "rubble":
      g.fillStyle(0x6a5f49, 1).fillRect(x - 6, y - 2, 5, 3).fillRect(x + 1, y, 6, 3).fillRect(x - 2, y + 2, 4, 2);
      g.fillStyle(0x8a7d62, 1).fillRect(x - 6, y - 2, 5, 1).fillRect(x + 1, y, 6, 1);
      break;
    case "stained_glass": {
      const blood = TERRAIN_PALETTE.sanctum.blood;
      g.fillStyle(0x2a2418, 0.9).fillRect(x - 9, y - 6, 18, 12);
      g.fillStyle(blood, 0.85).fillRect(x - 8, y - 5, 5, 10);
      g.fillStyle(0x2c5aa0, 0.85).fillRect(x - 2, y - 5, 5, 10);
      g.fillStyle(0xd4af37, 0.85).fillRect(x + 4, y - 5, 4, 10);
      break;
    }
  }
}

/** A prop that is part of a wall tile's face: x, y is the footprint's centre; `lift` the tile's lift. */
export function drawWallProp(g: Pen, p: PropSpot): void {
  const { x, y, lift } = p;
  const top = y - lift;
  switch (p.key) {
    case "glow_crack":
      g.lineStyle(3, ZONE_PALETTE.fire.accent, 0.3);
      zigzag(g, x - 9, top + TILE_H * 0.4, 4.5, 3, 4, (p.v & 1) === 1);
      g.lineStyle(1.2, 0xffd27a, 0.95);
      zigzag(g, x - 9, top + TILE_H * 0.4, 4.5, 3, 4, (p.v & 1) === 1);
      break;
    case "basalt_shard":
      g.fillStyle(0x3a2f46, 1).fillTriangle(x - 6, top + 8, x + 6, top + 8, x + ((p.v & 1) === 0 ? 2 : -2), top - 9);
      g.fillStyle(0x6a5878, 1).fillTriangle(x - 6, top + 8, x - 0.5, top + 8, x + ((p.v & 1) === 0 ? 2 : -2), top - 9);
      break;
    case "banner": {
      const b = TERRAIN_PALETTE.gallows;
      const fy = y + TILE_H / 2 - lift;
      g.fillStyle(b.banner, 1).fillRect(x - 4, fy + 1, 8, lift - 3);
      g.fillStyle(b.bannerDark, 1).fillTriangle(x - 4, fy + lift - 2, x + 4, fy + lift - 2, x, fy + lift + 2);
      g.fillStyle(0xe1d5f0, 0.9).fillRect(x - 1, fy + 3, 2, 4);
      break;
    }
    case "banner_red": {
      const fy = y + TILE_H / 2 - lift;
      g.fillStyle(TERRAIN_PALETTE.sanctum.blood, 1).fillRect(x - 4, fy + 1, 8, lift - 3);
      g.fillStyle(TERRAIN_PALETTE.sanctum.gold, 1).fillRect(x - 4, fy + 1, 8, 1.5).fillTriangle(x - 4, fy + lift - 2, x + 4, fy + lift - 2, x, fy + lift + 2);
      break;
    }
    case "gallows":
      g.fillStyle(0x4a3a2c, 1).fillRect(x - 7, top - 9, 3, 18).fillRect(x - 7, top - 9, 14, 3);
      g.lineStyle(1, 0xcbb28a, 0.95).lineBetween(x + 4, top - 6, x + 4, top + 1);
      g.strokeCircle(x + 4, top + 3, 2.2);
      break;
    case "cell_bars":
      g.fillStyle(0x0d0e12, 1).fillRect(x - 7, y + TILE_H / 2 - lift + 2, 14, lift - 5);
      g.fillStyle(0x8d93a3, 1);
      for (let i = 0; i < 4; i++) g.fillRect(x - 6 + i * 4, y + TILE_H / 2 - lift + 2, 1, lift - 5);
      break;
    case "fungus_cap": {
      const cap = (p.v & 1) === 0 ? 0xb5e35a : 0x8fc25a;
      g.fillStyle(0x1f2a1a, 0.55).fillEllipse(x + 1, top + 11, 18, 6);
      g.fillStyle(cap, 1).fillEllipse(x, top + 4, 17, 9);
      g.fillStyle(0xe9ffbf, 0.85).fillCircle(x - 3, top + 2.5, 1.3).fillCircle(x + 2, top + 4.5, 1.1);
      break;
    }
    case "drip":
      g.lineStyle(1.5, 0x8fc25a, 0.8).lineBetween(x - 6, y + TILE_H / 2 - lift + 1, x - 6, y + TILE_H / 2 - 1);
      g.fillStyle(0xc5e1a5, 0.95).fillCircle(x - 6, y + TILE_H / 2, 1.6);
      break;
    case "pipe":
      g.fillStyle(0x5a6a4a, 1).fillRect(x - 14, y + TILE_H / 2 - lift + 3, 28, 4);
      g.fillStyle(0x9bb066, 0.9).fillRect(x - 14, y + TILE_H / 2 - lift + 3, 28, 1);
      g.fillStyle(0x3a4a2a, 1).fillRect(x + 3, y + TILE_H / 2 - lift + 2, 3, 6);
      break;
    case "ice_spire":
      g.fillStyle(0xeaf8ff, 1).fillTriangle(x - 5, top + 7, x + 5, top + 7, x, top - 11);
      g.fillStyle(0x9ac8e2, 1).fillTriangle(x, top + 7, x + 5, top + 7, x, top - 11);
      break;
    case "icicle":
      g.fillStyle(0xeaf8ff, 0.95);
      g.fillTriangle(x - 8, y + TILE_H / 2 - lift + 1, x - 4, y + TILE_H / 2 - lift + 1, x - 6, y + TILE_H / 2 - lift + 8);
      g.fillTriangle(x + 2, y + TILE_H / 2 - lift + 1, x + 7, y + TILE_H / 2 - lift + 1, x + 4.5, y + TILE_H / 2 - lift + 10);
      break;
    case "column_cap":
      g.fillStyle(TERRAIN_PALETTE.sanctum.gold, 1).fillEllipse(x, top + 1, 22, 8);
      g.fillStyle(ZONE_PALETTE.holy.wallRim, 1).fillEllipse(x, top, 16, 5);
      break;
    case "chain":
      g.lineStyle(1.5, TERRAIN_PALETTE.gallows.chain, 0.95);
      g.beginPath().moveTo(x - 8, y - LOW_HEIGHT).lineTo(x - 3, y - LOW_HEIGHT + 4).lineTo(x + 3, y - LOW_HEIGHT + 4).lineTo(x + 8, y - LOW_HEIGHT).strokePath();
      break;
  }
}

// ------------------------------------------------------------------------------------------------------------------ overlays

/** The glow laid over a lava tile (TerrainFx draws one Graphics of these per phase bucket). */
export function drawLavaGlow(g: Pen, x: number, y: number): void {
  g.fillStyle(TERRAIN_PALETTE.lava.core, 1).fillRect(x + 2, y + 2, TILE_W - 4, TILE_H - 5);
}

/** The glow over an ember tile. */
export function drawEmberGlow(g: Pen, x: number, y: number): void {
  g.fillStyle(TERRAIN_PALETTE.ember.glow, 1).fillRect(x + 1, y + 1, TILE_W - 2, TILE_H - 2);
}

/** A bubble pop on a bog tile: a ring and a speck. */
export function drawBogBubble(g: Pen, x: number, y: number, hash: number): void {
  const cx = x + 8 + bits(hash, 5, 4) * 1.1;
  const cy = y + 6 + bits(hash, 9, 3) * 1.6;
  g.lineStyle(1.2, TERRAIN_PALETTE.bog.bubbles, 1).strokeEllipse(cx, cy, 8, 8 * Y_SCALE);
  g.fillStyle(TERRAIN_PALETTE.bog.bubbles, 1).fillCircle(cx + 1, cy, 1.2);
}

/** The shimmer of an ice tile: a bright diagonal streak. */
export function drawIceShimmer(g: Pen, x: number, y: number, hash: number): void {
  const o = bits(hash, 3, 3) * 2;
  g.lineStyle(2, TERRAIN_PALETTE.ice.highlight, 1).lineBetween(x + 6 + o, y + TILE_H - 4, x + 6 + o + 12, y + 4);
}

/** A beam of light over a rectangle of tiles `w` x `h` px: a trapezoid hovering up from its centre. */
export function drawLightBeam(g: Pen, cx: number, baseY: number, w: number, height: number): void {
  const half = w / 2;
  g.fillStyle(TERRAIN_PALETTE.light.beam, 1);
  g.beginPath().moveTo(cx - half, baseY).lineTo(cx - half * 0.55, baseY - height).lineTo(cx + half * 0.55, baseY - height).lineTo(cx + half, baseY).closePath().fillPath();
}

