// The art of the zone shapes (zone-shapes contract 7.5) as pure draw functions, in the language of zoneStyle.ts: each takes a Pen and
// a TileSpot and paints one tile, nothing here touches Phaser, a scene or the map, so a recording stub can judge it.
//   * wall looks   a crater's rim (the lip lit on the face toward the camp), a barrow's mossy mound, a hall's pier (a column with a
//                  capital), the masonry of the five landmark designs, a gallows' timber;
//   * floor looks  the crater's ash bowl, a barrow's tunnel, the hall's paving, the mere's shore, the causeway's packed snow, a
//                  landmark's interior and doorway sill, a ford's slabs;
//   * props        the twelve kinds the zone shapes appended to the prop table.
// Colour is never the only cue: a rim has its lit lip and a broken crown, a mound its domed corners and moss tufts, a pier its
// capital and flutes, each masonry its own marks (ember cracks, window bars, timber posts, icicles, gold trim).
// A wall look draws the same footprint, top face and front face as the zone's own wall does (the bake's seam work rests on it):
// it adds marks to those faces, or paints them whole in its own colours; it never moves an edge.
import { EDGE_E, EDGE_N, EDGE_S, EDGE_W, TILE_H, TILE_W, bits, type Pen, type TileSpot } from "./artBase";
import { SHAPE_PALETTE, ZONE_PALETTE, darken, mix, type ZoneKey } from "./palette";
import type { FloorLook, MasonryLook, WallLook } from "./artBase";
import type { PropSpot, WallInfo } from "./zoneStyle";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------------------------------------------------------ walls

/** The wall looks that paint their whole tile (everything but the rim, which marks the zone's own wall, and the shard, which only lowers it). */
export function paintsWholeWall(look: WallLook | undefined): boolean {
  return look !== undefined && look !== "plain" && look !== "rim" && look !== "shard";
}

/**
 * A crater rim's marks, over the zone's own wall: the lip on the faces toward the camp lit like a rim in firelight (a bright band
 * along the top face's edge on that side, the front face's first rows when it faces south), a few heat flecks on it, and a dark
 * scorch along the face away from the camp, so the ring reads as a bowl from either side.
 */
export function drawRimLip(g: Pen, s: TileSpot, w: WallInfo): void {
  const c = SHAPE_PALETTE.crater;
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  const lit = (w.inward ?? 0) & w.open;
  // The outer face: a shade along the sides that look away from the camp.
  const away = ((w.inward ?? 0) & EDGE_N ? EDGE_S : 0) | ((w.inward ?? 0) & EDGE_S ? EDGE_N : 0) | ((w.inward ?? 0) & EDGE_E ? EDGE_W : 0) | ((w.inward ?? 0) & EDGE_W ? EDGE_E : 0);
  const dark = away & w.open;
  g.fillStyle(0x000000, 0.28);
  if (dark & EDGE_N) g.fillRect(s.x, top, TILE_W, 2);
  if (dark & EDGE_W) g.fillRect(s.x, top, 2, TILE_H);
  if (dark & EDGE_E) g.fillRect(s.x + TILE_W - 2, top, 2, TILE_H);
  if (dark & EDGE_S && !w.front) g.fillRect(s.x, top + TILE_H - 2, TILE_W, 2);
  if (lit === 0) return;
  g.fillStyle(c.lip, 0.72);
  if (lit & EDGE_N) g.fillRect(s.x, top, TILE_W, 3);
  if (lit & EDGE_W) g.fillRect(s.x, top, 3, TILE_H);
  if (lit & EDGE_E) g.fillRect(s.x + TILE_W - 3, top, 3, TILE_H);
  if (lit & EDGE_S) {
    if (w.front) {
      g.fillStyle(c.lipDeep, 0.9).fillRect(s.x, frontY, TILE_W, 4);
      g.fillStyle(c.lip, 0.85).fillRect(s.x, frontY, TILE_W, 1);
    } else g.fillRect(s.x, top + TILE_H - 3, TILE_W, 3);
  }
  // Heat flecks on the lit lip.
  if (bits(s.hash, 8, 2) === 0) {
    g.fillStyle(c.crack, 0.95);
    const fx = s.x + 4 + bits(s.hash, 10, 4) * 1.4;
    if (lit & (EDGE_N | EDGE_S)) g.fillRect(fx, (lit & EDGE_N) !== 0 ? top + 1 : (w.front ? frontY + 1 : top + TILE_H - 2), 3, 1);
    else g.fillRect((lit & EDGE_W) !== 0 ? s.x + 1 : s.x + TILE_W - 2, top + 4 + bits(s.hash, 10, 4), 1, 3);
  }
}

/** The corner radii of a rounded top: round where both sides of the corner are open. */
function corners(open: number, r: number): { tl: number; tr: number; bl: number; br: number } {
  return {
    tl: (open & EDGE_N) !== 0 && (open & EDGE_W) !== 0 ? r : 0, tr: (open & EDGE_N) !== 0 && (open & EDGE_E) !== 0 ? r : 0,
    bl: (open & EDGE_S) !== 0 && (open & EDGE_W) !== 0 ? r : 0, br: (open & EDGE_S) !== 0 && (open & EDGE_E) !== 0 ? r : 0,
  };
}

/** A barrow's mound: a domed top that greens toward the middle of the disc, moss tufts, and a rock front with a mossy fringe and drips. */
function drawMound(g: Pen, s: TileSpot, w: WallInfo): void {
  const m = SHAPE_PALETTE.mound;
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  const dome = clamp01(w.dome ?? 0);
  g.fillStyle(mix(m.rock, m.moss, 0.16 + 0.42 * dome), 1).fillRoundedRect(s.x, top, TILE_W, TILE_H, corners(w.open, 10));
  if ((w.open & EDGE_N) !== 0) g.lineStyle(1.5, m.moss, 0.75).lineBetween(s.x + 3, top + 0.5, s.x + TILE_W - 3, top + 0.5);
  // Tufts of moss: a lighter patch or two, bigger near the crown.
  const tufts = 1 + bits(s.hash, 0, 1);
  g.fillStyle(m.moss, 0.42 + 0.25 * dome);
  for (let k = 0; k < tufts; k++) g.fillEllipse(s.x + 8 + k * 9 + bits(s.hash, 2 + k * 5, 3), top + 6 + bits(s.hash, 6 + k * 5, 3) * 1.8, 8 + bits(s.hash, 14, 2) * 2, 5);
  if (w.front) {
    g.fillStyle(darken(m.rock, 0.3), 1).fillRect(s.x, frontY, TILE_W, w.lift);
    g.fillStyle(m.mossDark, 0.95).fillRect(s.x, frontY, TILE_W, 4);
    g.lineStyle(1.2, m.moss, 0.7);
    const a = s.x + 4 + bits(s.hash, 16, 4);
    g.lineBetween(a, frontY + 4, a, frontY + 5 + bits(s.hash, 20, 3));
    g.lineBetween(a + 13, frontY + 4, a + 13, frontY + 6 + bits(s.hash, 23, 3));
    g.fillStyle(0x000000, 0.22).fillRect(s.x + 2 + bits(s.hash, 26, 3) * 3, frontY + 7, 9, 1);
  }
}

/**
 * A hall's pier, one tile of a 3x3 column: the top face is a slab with a capital round its outer edge (a pale band and a gold line
 * inside it, a gold rivet at each corner), the front face the fluted shaft with a plinth at its foot. Which edges are capital and
 * which is shaft comes from `open`, so the nine tiles read as one column.
 */
function drawPier(g: Pen, s: TileSpot, w: WallInfo): void {
  const k = SHAPE_PALETTE.pier;
  const p = ZONE_PALETTE.holy;
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  g.fillStyle(p.wallTop, 1).fillRect(s.x, top, TILE_W, TILE_H);
  // The slab: faint diagonals, so a pier's roof is not a flat tile.
  g.lineStyle(1, k.slab, 0.16);
  g.lineBetween(s.x + 2, top + TILE_H - 2, s.x + TILE_W - 2, top + 2);
  const o = w.open;
  // The capital's step: a shadow line 9 px in from every outer edge with a lit line under it, so the roof is two levels (the abacus
  // round the edge, the slab inside), not one flat tile; at an outer corner the two lines meet.
  g.fillStyle(0x000000, 0.22);
  if (o & EDGE_N) g.fillRect(s.x + (o & EDGE_W ? 9 : 0), top + 9, TILE_W - (o & EDGE_W ? 9 : 0) - (o & EDGE_E ? 9 : 0), 1);
  if (o & EDGE_S && !w.front) g.fillRect(s.x + (o & EDGE_W ? 9 : 0), top + TILE_H - 10, TILE_W - (o & EDGE_W ? 9 : 0) - (o & EDGE_E ? 9 : 0), 1);
  if (o & EDGE_W) g.fillRect(s.x + 9, top + (o & EDGE_N ? 9 : 0), 1, TILE_H - (o & EDGE_N ? 9 : 0) - (o & EDGE_S && !w.front ? 9 : 0));
  if (o & EDGE_E) g.fillRect(s.x + TILE_W - 10, top + (o & EDGE_N ? 9 : 0), 1, TILE_H - (o & EDGE_N ? 9 : 0) - (o & EDGE_S && !w.front ? 9 : 0));
  g.fillStyle(0xffffff, 0.35);
  if (o & EDGE_N) g.fillRect(s.x + (o & EDGE_W ? 10 : 0), top + 10, TILE_W - (o & EDGE_W ? 10 : 0) - (o & EDGE_E ? 10 : 0), 1);
  if (o & EDGE_W) g.fillRect(s.x + 10, top + (o & EDGE_N ? 10 : 0), 1, TILE_H - (o & EDGE_N ? 10 : 0) - (o & EDGE_S && !w.front ? 10 : 0));
  g.fillStyle(k.cap, 1);
  if (o & EDGE_N) g.fillRect(s.x, top, TILE_W, 3);
  if (o & EDGE_W) g.fillRect(s.x, top, 3, TILE_H);
  if (o & EDGE_E) g.fillRect(s.x + TILE_W - 3, top, 3, TILE_H);
  if (o & EDGE_S && !w.front) g.fillRect(s.x, top + TILE_H - 3, TILE_W, 3);
  g.fillStyle(k.gold, 0.9);
  if (o & EDGE_N) g.fillRect(s.x, top + 3, TILE_W, 1);
  if (o & EDGE_W) g.fillRect(s.x + 3, top, 1, TILE_H);
  if (o & EDGE_E) g.fillRect(s.x + TILE_W - 4, top, 1, TILE_H);
  if (o & EDGE_S && !w.front) g.fillRect(s.x, top + TILE_H - 4, TILE_W, 1);
  // Rivets at the corners of the capital.
  const rivet = (cx: number, cy: number): void => { g.fillStyle(k.gold, 1).fillRect(cx - 1.5, cy - 1.5, 3, 3); };
  if ((o & EDGE_N) !== 0 && (o & EDGE_W) !== 0) rivet(s.x + 2, top + 2);
  if ((o & EDGE_N) !== 0 && (o & EDGE_E) !== 0) rivet(s.x + TILE_W - 2, top + 2);
  if (w.front) {
    g.fillStyle(k.shaft, 1).fillRect(s.x, frontY, TILE_W, w.lift);
    // Flutes: pale ribs between dark grooves every 6 px, and a lit left / shaded right edge on the column's outer tiles.
    g.fillStyle(darken(k.shaft, 0.28), 0.9);
    for (let fx = 4; fx < TILE_W - 2; fx += 6) g.fillRect(s.x + fx, frontY + 1, 1, w.lift - 4);
    if (o & EDGE_W) g.fillStyle(0xffffff, 0.35).fillRect(s.x, frontY, 2, w.lift);
    if (o & EDGE_E) g.fillStyle(0x000000, 0.28).fillRect(s.x + TILE_W - 3, frontY, 3, w.lift);
    g.fillStyle(k.base, 1).fillRect(s.x, frontY + w.lift - 3, TILE_W, 3);
    g.fillStyle(k.gold, 0.95).fillRect(s.x, frontY + w.lift - 3, TILE_W, 1);
  }
}

/** Plank lines across a face. */
function planks(g: Pen, x: number, y: number, w: number, h: number, step: number, color: number, alpha: number): void {
  g.fillStyle(color, alpha);
  for (let py = y + step; py < y + h; py += step) g.fillRect(x, py, w, 1);
}

/** The gallows block: timber decking on top, a dark post-and-plank front. */
function drawGallowsBlock(g: Pen, s: TileSpot, w: WallInfo): void {
  const k = SHAPE_PALETTE.gallows;
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  g.fillStyle(k.top, 1).fillRect(s.x, top, TILE_W, TILE_H);
  planks(g, s.x, top, TILE_W, TILE_H, 6.4, k.plank, 0.8);
  if ((w.open & EDGE_N) !== 0) g.lineStyle(1, k.rim, 0.7).lineBetween(s.x, top + 0.5, s.x + TILE_W, top + 0.5);
  if (w.front) {
    g.fillStyle(k.front, 1).fillRect(s.x, frontY, TILE_W, w.lift);
    g.fillStyle(k.plank, 1).fillRect(s.x + 4, frontY, 3, w.lift).fillRect(s.x + TILE_W - 7, frontY, 3, w.lift);
    g.fillStyle(k.rim, 0.5).fillRect(s.x + 4, frontY, 1, w.lift);
  }
}

// ------------------------------------------------------------------------------------------------------------------ masonry

interface MasonryColours { top: number; front: number; rim: number; mortar: number }

function drawCourses(g: Pen, s: TileSpot, w: WallInfo, m: MasonryColours): void {
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  // Top face: a joint line across the middle and offset joints, like laid blocks seen from above.
  g.fillStyle(m.mortar, 0.45);
  g.fillRect(s.x, top + TILE_H / 2, TILE_W, 1);
  const j = 6 + bits(s.hash, 0, 3);
  g.fillRect(s.x + j, top, 1, TILE_H / 2);
  g.fillRect(s.x + ((j + 15) % 28) + 2, top + TILE_H / 2, 1, TILE_H / 2);
  if (w.front) {
    g.fillStyle(m.mortar, 1);
    g.fillRect(s.x, frontY + w.lift / 3, TILE_W, 1);
    g.fillRect(s.x, frontY + (2 * w.lift) / 3, TILE_W, 1);
    g.fillRect(s.x + j, frontY, 1, w.lift / 3);
    g.fillRect(s.x + ((j + 14) % 28), frontY + w.lift / 3, 1, w.lift / 3);
    g.fillRect(s.x + j + 4, frontY + (2 * w.lift) / 3, 1, w.lift / 3);
  }
}

/** One landmark design's wall: the masonry in its own colours, then what that design adds. */
function drawMasonry(g: Pen, look: MasonryLook, s: TileSpot, w: WallInfo): void {
  const m = SHAPE_PALETTE[look];
  const top = s.y - w.lift;
  const frontY = s.y + TILE_H - w.lift;
  g.fillStyle(m.top, 1).fillRect(s.x, top, TILE_W, TILE_H);
  if (w.front) g.fillStyle(m.front, 1).fillRect(s.x, frontY, TILE_W, w.lift);
  drawCourses(g, s, w, m);
  if ((w.open & EDGE_N) !== 0) g.lineStyle(1, m.rim, 0.85).lineBetween(s.x, top + 0.5, s.x + TILE_W, top + 0.5);
  switch (look) {
    case "forge": {
      const k = SHAPE_PALETTE.forge;
      // The hearth's heat: a glowing seam at the foot of the front and a crack through it now and then; flecks of fire on the roof.
      if (w.front) {
        g.fillStyle(k.glow, 0.55).fillRect(s.x, frontY + w.lift - 1.5, TILE_W, 1.5);
        if (bits(s.hash, 4, 2) === 0) {
          g.lineStyle(1.2, k.hot, 0.95);
          const x0 = s.x + 3 + bits(s.hash, 8, 2);
          g.beginPath().moveTo(x0, frontY + w.lift - 2).lineTo(x0 + 4, frontY + 4).lineTo(x0 + 7, frontY + w.lift / 2).lineTo(x0 + 11, frontY + 2).strokePath();
        }
      }
      if (bits(s.hash, 12, 3) === 0) g.fillStyle(k.glow, 0.9).fillRect(s.x + 5 + bits(s.hash, 15, 4) * 1.5, top + 6 + bits(s.hash, 19, 3) * 2, 3, 1);
      break;
    }
    case "guardHouse": {
      // Iron bands along the roof's rim and a barred window on one front in three.
      if ((w.open & EDGE_N) !== 0) g.fillStyle(SHAPE_PALETTE.guardHouse.iron, 0.9).fillRect(s.x, top + 1, TILE_W, 2);
      if (w.front && bits(s.hash, 4, 2) === 0) {
        g.fillStyle(SHAPE_PALETTE.guardHouse.iron, 1).fillRect(s.x + 10, frontY + 2, 10, w.lift - 5);
        g.fillStyle(0x8d93a3, 1).fillRect(s.x + 13, frontY + 2, 1, w.lift - 5).fillRect(s.x + 16, frontY + 2, 1, w.lift - 5);
      }
      break;
    }
    case "burrow": {
      const k = SHAPE_PALETTE.burrow;
      // Timber: a post on the front of every third tile column, a lintel along the front's head, earth speckle, a root.
      if (w.front) {
        g.fillStyle(k.timber, 1).fillRect(s.x, frontY, TILE_W, 3);
        g.fillStyle(k.timberHi, 0.7).fillRect(s.x, frontY, TILE_W, 1);
        if (s.tx % 3 === 1) {
          g.fillStyle(k.timber, 1).fillRect(s.x + 12, frontY, 7, w.lift);
          g.fillStyle(k.timberHi, 0.6).fillRect(s.x + 12, frontY, 2, w.lift);
        }
      }
      g.fillStyle(0x000000, 0.2);
      for (let q = 0; q < 3; q++) g.fillRect(s.x + 3 + bits(s.hash, 3 + q * 6, 4) * 1.6, top + 4 + bits(s.hash, 6 + q * 6, 4) * 1.2, 2, 1);
      if (bits(s.hash, 22, 2) === 0 && (w.open & EDGE_N) !== 0) g.lineStyle(1.2, k.root, 0.9).lineBetween(s.x + 8, top + 1, s.x + 11, top + 7).lineBetween(s.x + 11, top + 7, s.x + 9, top + 11);
      break;
    }
    case "watchtower": {
      const k = SHAPE_PALETTE.watchtower;
      // Ice-stone: a facet across the roof, a frosted rim and icicles hanging off the front's head.
      g.fillStyle(darken(k.top, 0.1), 0.7);
      if (bits(s.hash, 0, 1) === 1) g.fillTriangle(s.x, top, s.x + TILE_W, top + TILE_H, s.x, top + TILE_H);
      else g.fillTriangle(s.x + TILE_W, top, s.x + TILE_W, top + TILE_H, s.x, top + TILE_H);
      if (w.front) {
        g.fillStyle(k.ice, 0.95);
        const a = s.x + 4 + bits(s.hash, 8, 3);
        g.fillTriangle(a, frontY, a + 4, frontY, a + 2, frontY + 6 + bits(s.hash, 11, 2));
        g.fillTriangle(a + 14, frontY, a + 18, frontY, a + 16, frontY + 4 + bits(s.hash, 13, 2));
      }
      break;
    }
    case "shrine": {
      const k = SHAPE_PALETTE.shrine;
      // Marble: gold trim along the roof's rim and at the foot of the front, a vein or two.
      if ((w.open & EDGE_N) !== 0) g.fillStyle(k.gold, 0.95).fillRect(s.x, top, TILE_W, 2);
      g.lineStyle(1, k.vein, 0.5).lineBetween(s.x + 4 + bits(s.hash, 0, 3), top + TILE_H - 3, s.x + 15 + bits(s.hash, 3, 3), top + 3);
      if (w.front) {
        g.fillStyle(k.gold, 0.9).fillRect(s.x, frontY + w.lift - 2, TILE_W, 2);
        g.fillStyle(darken(k.front, 0.2), 0.9);
        for (let fx = 5; fx < TILE_W - 3; fx += 8) g.fillRect(s.x + fx, frontY + 2, 1, w.lift - 5);
      }
      break;
    }
  }
}

/** The wall look that paints its whole tile (mound, pier, masonry, gallows). The rim and the shard are the zone's own wall; see zoneStyle.drawWallTile. */
export function drawFeatureWall(g: Pen, _zone: ZoneKey, s: TileSpot, w: WallInfo): void {
  switch (w.look) {
    case "mound": drawMound(g, s, w); break;
    case "pier": drawPier(g, s, w); break;
    case "gallows": drawGallowsBlock(g, s, w); break;
    case "forge":
    case "guardHouse":
    case "burrow":
    case "watchtower":
    case "shrine": drawMasonry(g, w.look, s, w); break;
    default: break;
  }
}

// ------------------------------------------------------------------------------------------------------------------ floors

/** What a floor tile's look needs to know of its place. `open` = the sides with a wall beside them (the shore: the sides beside ice). */
export interface FloorSpot extends TileSpot {
  /** Its distance from the feature's centre in tiles, and the feature's radius (a crater's bowl shades toward its rim). */
  dist: number;
  radius: number;
}

/** The inner shade along the sides of a floor tile that a wall stands beside, so a bowl, a hall or a room is set down into its walls. */
function wallShade(g: Pen, s: TileSpot, alpha: number): void {
  g.fillStyle(0x000000, alpha);
  if (s.open & EDGE_N) g.fillRect(s.x, s.y, TILE_W, 5);
  if (s.open & EDGE_W) g.fillRect(s.x, s.y, 3, TILE_H);
  if (s.open & EDGE_E) g.fillRect(s.x + TILE_W - 3, s.y, 3, TILE_H);
}

/**
 * Paints a feature's floor over the zone's floor tile (and over its terrain art, for a ford). `look` "plain" paints nothing.
 * The tile's own footprint only: the bake draws these in a floor chunk, one per tile.
 */
export function drawFloorLook(g: Pen, look: FloorLook, s: FloorSpot): void {
  const { x, y, hash: h } = s;
  switch (look) {
    case "bowl": {
      // The ash ring: pale dust in the middle of the bowl, darkening toward the rim, cracked where it is darkest.
      const c = SHAPE_PALETTE.crater;
      const ring = clamp01((s.dist - (s.radius - 3.4)) / 2.6);
      const step = Math.round(ring * 8) / 8;
      if (step > 0) g.fillStyle(c.ash, 0.12 + 0.5 * step).fillRect(x, y, TILE_W, TILE_H);
      else if (bits(h, 6, 2) === 0) g.fillStyle(c.dust, 0.14).fillRect(x, y, TILE_W, TILE_H);
      if (step >= 0.5 && bits(h, 2, 2) === 0) {
        g.lineStyle(1, c.crack, 0.55);
        g.beginPath().moveTo(x + 4, y + 4 + bits(h, 8, 3)).lineTo(x + 12, y + 12).lineTo(x + 10, y + 20).lineTo(x + 20, y + 22).strokePath();
      }
      wallShade(g, s, 0.22);
      break;
    }
    case "tunnel": {
      // A slot under the mound: dark, damp, with a pale drip of light at the walls' foot.
      const t = SHAPE_PALETTE.tunnel;
      g.fillStyle(t.dark, 0.52).fillRect(x, y, TILE_W, TILE_H);
      if (bits(h, 3, 2) === 0) g.fillStyle(t.damp, 0.25).fillEllipse(x + 8 + bits(h, 5, 4) * 1.2, y + 12, 10, 4);
      wallShade(g, s, 0.3);
      break;
    }
    case "hall": {
      // Aisle paving: a lighter flag with a gold joint, a shade beside a pier.
      const p = ZONE_PALETTE.holy;
      g.fillStyle(0xf0e6c0, 0.07).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(p.accent, 0.2);
      g.fillRect(x + TILE_W - 1, y, 1, TILE_H);
      g.fillRect(x, y + TILE_H - 1, TILE_W, 1);
      if (bits(h, 4, 3) === 0) g.fillStyle(p.accent, 0.35).fillRect(x + TILE_W / 2 - 2, y + TILE_H / 2 - 2, 4, 4);
      wallShade(g, s, 0.2);
      break;
    }
    case "shore": {
      // The shore of a mere: slush over the ground, and a bright rim along each side that meets the ice.
      const k = SHAPE_PALETTE.shore;
      g.fillStyle(k.slush, 0.16).fillRect(x, y, TILE_W, TILE_H);
      if (bits(h, 2, 2) === 0) g.fillStyle(k.rim, 0.3).fillEllipse(x + 10 + bits(h, 5, 4), y + 11, 12, 5);
      g.fillStyle(k.rim, 0.85);
      if (s.open & EDGE_N) g.fillRect(x, y, TILE_W, 2);
      if (s.open & EDGE_S) g.fillRect(x, y + TILE_H - 2, TILE_W, 2);
      if (s.open & EDGE_W) g.fillRect(x, y, 2, TILE_H);
      if (s.open & EDGE_E) g.fillRect(x + TILE_W - 2, y, 2, TILE_H);
      break;
    }
    case "causeway": {
      // Packed snow across the lake: pale, with two trodden ruts and drifted specks.
      const k = SHAPE_PALETTE.snow;
      g.fillStyle(k.packed, 0.85).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(k.shade, 0.55);
      g.fillRect(x + 4, y + 7, 9, 1).fillRect(x + 17 + bits(h, 2, 3), y + 7, 8, 1);
      g.fillRect(x + 3 + bits(h, 5, 3), y + 17, 10, 1).fillRect(x + 18, y + 17, 8, 1);
      if (bits(h, 8, 2) === 0) g.fillStyle(0xffffff, 0.9).fillEllipse(x + 12 + bits(h, 10, 4), y + 12, 7, 3);
      break;
    }
    case "forge": {
      // Scorched flags with embers in the joints.
      const k = SHAPE_PALETTE.forge;
      g.fillStyle(k.floor, 0.5).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(0xff7a2a, 0.07).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(k.mortar, 0.8).fillRect(x, y + TILE_H - 1, TILE_W, 1).fillRect(x + TILE_W - 1, y, 1, TILE_H);
      if (bits(h, 3, 3) === 0) g.fillStyle(k.glow, 0.7).fillRect(x + 4 + bits(h, 6, 4) * 1.5, y + 8 + bits(h, 10, 3), 3, 1);
      wallShade(g, s, 0.25);
      break;
    }
    case "guardHouse": {
      const k = SHAPE_PALETTE.guardHouse;
      g.fillStyle(k.floor, 0.4).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(0xffffff, 0.08).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(k.mortar, 0.7).fillRect(x, y + TILE_H - 1, TILE_W, 1).fillRect(x + ((s.ty & 1) === 0 ? 0 : 16), y, 1, TILE_H);
      wallShade(g, s, 0.25);
      break;
    }
    case "burrow": {
      const k = SHAPE_PALETTE.burrow;
      g.fillStyle(k.floor, 0.4).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(0x000000, 0.22);
      for (let q = 0; q < 3; q++) g.fillRect(x + 3 + bits(h, q * 6, 4) * 1.7, y + 3 + bits(h, 3 + q * 6, 4) * 1.2, 2, 1);
      if (bits(h, 20, 3) === 0) g.fillStyle(k.root, 0.6).fillRect(x + 6 + bits(h, 23, 3) * 2, y + 10, 5, 1);
      wallShade(g, s, 0.25);
      break;
    }
    case "watchtower": {
      const k = SHAPE_PALETTE.watchtower;
      g.fillStyle(k.floor, 0.4).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(k.ice, 0.22).fillRect(x, y + TILE_H - 1, TILE_W, 1).fillRect(x + TILE_W - 1, y, 1, TILE_H);
      if (bits(h, 2, 2) === 0) g.lineStyle(1, k.ice, 0.5).lineBetween(x + 6, y + TILE_H - 4, x + 20, y + 5);
      wallShade(g, s, 0.25);
      break;
    }
    case "shrine": {
      // Marble underfoot: a pale checker with a gold joint.
      const k = SHAPE_PALETTE.shrine;
      g.fillStyle(((s.tx + s.ty) & 1) === 0 ? 0xf2ecd8 : 0xcdc29f, ((s.tx + s.ty) & 1) === 0 ? 0.55 : 0.4).fillRect(x, y, TILE_W, TILE_H);
      g.fillStyle(k.gold, 0.3).fillRect(x, y + TILE_H - 1, TILE_W, 1).fillRect(x + TILE_W - 1, y, 1, TILE_H);
      wallShade(g, s, 0.2);
      break;
    }
    case "door": {
      // A sill across the doorway: a worn stone slab between two dark jambs, along the way through.
      const across = (s.open & EDGE_W) !== 0 && (s.open & EDGE_E) !== 0;
      g.fillStyle(0xcfc8b4, 0.5);
      if (across) {
        g.fillRect(x, y + TILE_H / 2 - 4, TILE_W, 8);
        g.fillStyle(0x000000, 0.3).fillRect(x, y + TILE_H / 2 + 3, TILE_W, 1);
      } else {
        g.fillRect(x + TILE_W / 2 - 4, y, 8, TILE_H);
        g.fillStyle(0x000000, 0.3).fillRect(x + TILE_W / 2 + 3, y, 1, TILE_H);
      }
      break;
    }
    case "ford": {
      // Flat slabs set across the ember bank: a crossing you can see from far off.
      const k = SHAPE_PALETTE.ford;
      g.fillStyle(k.slab, 1).fillRoundedRect(x + 3, y + 3, TILE_W - 6, TILE_H - 6, 4);
      g.fillStyle(k.slabHi, 0.9).fillRect(x + 5, y + 4, TILE_W - 10, 2);
      g.fillStyle(k.slabLo, 0.8).fillRect(x + 4, y + TILE_H - 6, TILE_W - 8, 2);
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------------------------------------------------------ props

/** The props that are painted into the floor, of the zone shapes' twelve. `anvil` ... `brazier` (contract 7.5). */
export const SHAPE_FLAT_PROPS: ReadonlySet<string> = new Set(["anvil", "slag_heap", "stocks", "burrow_rubble", "reed", "ice_crack", "altar", "brazier"]);
/** The ones that are part of a wall's face, or stand on a LOW tile: `crater_lip`, `gate_post`, `tunnel_beam`, `tower_frost`. */
export const SHAPE_WALL_PROPS: ReadonlySet<string> = new Set(["crater_lip", "gate_post", "tunnel_beam", "tower_frost"]);

/** A flat prop of the zone shapes; false for any other key. x, y is the prop's ground point. */
export function drawShapeFlatProp(g: Pen, p: PropSpot): boolean {
  const { x, y, v } = p;
  switch (p.key) {
    case "anvil": {
      g.fillStyle(0x000000, 0.35).fillEllipse(x, y + 1, 24, 7);
      g.fillStyle(0xff7a2a, 0.18).fillEllipse(x, y, 30, 11);
      g.fillStyle(0x2b2d33, 1).fillRect(x - 4, y - 5, 8, 6);
      g.fillStyle(0x383b44, 1).fillRect(x - 7, y - 9, 14, 4);
      g.fillStyle(0x4b4f59, 1).fillRect(x - 11, y - 13, 22, 4);
      g.fillTriangle(x + 11, y - 13, x + 11, y - 9, x + 18, y - 12);
      g.fillStyle(0x8d93a3, 0.9).fillRect(x - 11, y - 13, 22, 1);
      g.fillStyle(0xff8a2a, 0.9).fillRect(x - 2, y - 14, 4, 1);
      return true;
    }
    case "slag_heap": {
      g.fillStyle(0xff7a2a, 0.14).fillEllipse(x, y, 34, 12);
      g.fillStyle(0x1e1816, 1).fillEllipse(x, y, 28, 10);
      g.fillStyle(0x2c2320, 1).fillEllipse(x - 5, y - 3, 15, 9);
      g.fillStyle(0x362b26, 1).fillEllipse(x + 6, y - 4, 13, 8);
      g.fillStyle(0xff8a2a, 0.95);
      for (let k = 0; k < 3; k++) g.fillRect(x - 9 + bits(v, k * 2, 3) * 3, y - 6 + (k % 2) * 3, 2, 1);
      return true;
    }
    case "stocks": {
      g.fillStyle(0x000000, 0.3).fillEllipse(x, y + 1, 26, 6);
      g.fillStyle(0x4a3826, 1).fillRect(x - 11, y - 11, 3, 12).fillRect(x + 8, y - 11, 3, 12);
      g.fillStyle(0x6d4c2e, 1).fillRect(x - 12, y - 8, 24, 3);
      g.fillStyle(0x5a3e24, 1).fillRect(x - 12, y - 5, 24, 3);
      g.fillStyle(0x15110d, 1).fillCircle(x - 5, y - 5, 1.6).fillCircle(x, y - 5, 1.6).fillCircle(x + 5, y - 5, 1.6);
      g.fillStyle(0xa07f58, 0.7).fillRect(x - 12, y - 8, 24, 1);
      return true;
    }
    case "burrow_rubble": {
      g.fillStyle(0x000000, 0.25).fillEllipse(x, y + 1, 24, 7);
      g.fillStyle(0x5b4630, 1).fillEllipse(x - 4, y - 1, 14, 8);
      g.fillStyle(0x6d5539, 1).fillEllipse(x + 5, y - 2, 11, 7);
      g.fillStyle(0x7a7466, 1).fillRect(x - 8, y - 5, 4, 3).fillRect(x + 2, y - 6 - (v & 1), 3, 3);
      g.lineStyle(1.2, 0x6f8f3c, 0.9).lineBetween(x + 8, y - 1, x + 12, y - 6).lineBetween(x - 10, y, x - 12, y - 4);
      return true;
    }
    case "reed": {
      g.fillStyle(0x1f2a1a, 0.4).fillEllipse(x, y + 1, 18, 6);
      for (let k = 0; k < 5; k++) {
        const bx = x + (k - 2) * 3;
        const lean = ((bits(v, k * 2, 2) - 1.5) * 1.6);
        const tip = y - 10 - bits(v, k * 3, 2);
        g.lineStyle(1.4, k % 2 === 0 ? 0x7ea34a : 0x5f8438, 0.95).lineBetween(bx, y, bx + lean, tip);
        if (k === 1 || k === 3) g.fillStyle(0x5a3e24, 1).fillRect(bx + lean - 1, tip - 1, 2, 5);
      }
      return true;
    }
    case "ice_crack": {
      g.lineStyle(1.6, 0xeaf8ff, 0.85);
      g.beginPath().moveTo(x - 12, y - 2).lineTo(x - 5, y - 6).lineTo(x - 1, y).lineTo(x + 6, y - 4).lineTo(x + 12, y + 1).strokePath();
      g.lineStyle(1, 0x9ac8e2, 0.8);
      g.beginPath().moveTo(x - 1, y).lineTo(x + 1, y + 6).lineTo(x - 3, y + 9).strokePath();
      g.beginPath().moveTo(x + 6, y - 4).lineTo(x + 8, y - 9).strokePath();
      g.fillStyle(0xffffff, 0.9).fillRect(x - 1, y - 1, 2, 2);
      return true;
    }
    case "altar": {
      g.fillStyle(0x000000, 0.3).fillEllipse(x, y + 1, 32, 8);
      g.fillStyle(0xcdc29f, 1).fillRect(x - 12, y - 6, 24, 8);
      g.fillStyle(0xf2ecd8, 1).fillRect(x - 13, y - 11, 26, 5);
      g.fillStyle(0xffffff, 0.6).fillRect(x - 13, y - 11, 26, 1);
      g.fillStyle(0xd4af37, 1).fillRect(x - 13, y - 6, 26, 1.5).fillRect(x - 12, y + 1, 24, 1);
      g.fillStyle(0x8e1b1b, 1).fillRect(x - 7, y - 11, 14, 3).fillRect(x - 7, y - 8, 14, 1);
      g.fillStyle(0xffffff, 1).fillRect(x - 11, y - 16, 2, 5).fillRect(x + 9, y - 16, 2, 5);
      g.fillStyle(0xffe28a, 1).fillCircle(x - 10, y - 17, 1.4).fillCircle(x + 10, y - 17, 1.4);
      return true;
    }
    case "brazier": {
      g.fillStyle(0x000000, 0.3).fillEllipse(x, y + 1, 18, 5);
      g.fillStyle(0xffd27a, 0.18).fillEllipse(x, y - 11, 34, 15);
      g.lineStyle(1.6, 0x5a4326, 1).lineBetween(x - 6, y, x - 1, y - 8).lineBetween(x + 6, y, x + 1, y - 8).lineBetween(x, y, x, y - 8);
      g.fillStyle(0x8c6a2c, 1).fillEllipse(x, y - 9, 15, 6);
      g.fillStyle(0xd4af37, 1).fillRect(x - 7, y - 10, 14, 1.5);
      g.fillStyle(0xff8a2a, 0.95).fillTriangle(x - 5, y - 10, x + 5, y - 10, x + ((v & 1) === 0 ? 1 : -1), y - 20);
      g.fillStyle(0xffd27a, 1).fillTriangle(x - 2.5, y - 10, x + 2.5, y - 10, x, y - 16);
      return true;
    }
    default: return false;
  }
}

/** A wall-face prop of the zone shapes; false for any other key. x, y is the tile footprint's centre, lift the tile's lift. */
export function drawShapeWallProp(g: Pen, p: PropSpot): boolean {
  const { x, y, lift, v } = p;
  const top = y - lift;
  switch (p.key) {
    case "crater_lip": {
      // A crown of three lit teeth on the rim.
      const c = SHAPE_PALETTE.crater;
      g.fillStyle(c.crack, 0.2).fillEllipse(x, top + 6, 30, 10);
      const teeth: ReadonlyArray<readonly [number, number, number]> = [[-9, 6, 5], [-3, 8, 9], [4, 6, 4 + (v & 3)]];
      for (const [dx, wd, h] of teeth) {
        g.fillStyle(c.lipDeep, 1).fillTriangle(x + dx, top + 7, x + dx + wd, top + 7, x + dx + wd / 2, top + 7 - h);
        g.fillStyle(c.lip, 0.95).fillTriangle(x + dx, top + 7, x + dx + wd / 2, top + 7, x + dx + wd / 2, top + 7 - h);
      }
      return true;
    }
    case "gate_post": {
      // A tall stone post with a cap and a lit lantern on a fence line: the gate you can find from far off.
      g.fillStyle(0x000000, 0.3).fillEllipse(x, y + 3, 16, 6);
      g.fillStyle(0x6a6d79, 1).fillRect(x - 4, y - 14, 8, 18);
      g.fillStyle(0x9097a6, 1).fillRect(x - 4, y - 14, 2, 18);
      g.fillStyle(0x3a3d46, 1).fillRect(x + 2, y - 14, 2, 18);
      g.fillStyle(0x4b4e58, 1).fillRect(x - 6, y - 17, 12, 4);
      g.fillStyle(0xa4a8b6, 1).fillRect(x - 6, y - 17, 12, 1);
      g.fillStyle(0xffd27a, 0.28).fillEllipse(x, y - 21, 18, 7);
      g.fillStyle(0x15161a, 1).fillRect(x - 3, y - 24, 6, 7);
      g.fillStyle(0xffd27a, 1).fillRect(x - 2, y - 23, 4, 4);
      return true;
    }
    case "tunnel_beam": {
      // A timber frame at a tunnel's mouth: a lintel over the wall's top and a post down its front, moss on both.
      g.fillStyle(0x654526, 1).fillRect(x - 14, top - 1, 28, 5);
      g.fillStyle(0xa87a4a, 0.8).fillRect(x - 14, top - 1, 28, 1);
      g.fillStyle(0x654526, 1).fillRect(x - 3, top + 3, 6, lift + TILE_H / 2 - 3);
      g.fillStyle(0xa87a4a, 0.6).fillRect(x - 3, top + 3, 2, lift + TILE_H / 2 - 3);
      g.fillStyle(0x9bc05a, 0.75).fillRect(x - 10, top + 3, 6, 2).fillRect(x + 4, top + 3, 5, 2);
      return true;
    }
    case "tower_frost": {
      // A cluster of ice crystals grown on the tower's roof.
      g.fillStyle(0xffffff, 0.2).fillEllipse(x, top + 4, 26, 9);
      const crystals: ReadonlyArray<readonly [number, number]> = [[-7, 8], [0, 13], [6, 7 + (v & 3)]];
      for (const [dx, h] of crystals) {
        g.fillStyle(0xeaf8ff, 1).fillTriangle(x + dx - 3, top + 6, x + dx + 3, top + 6, x + dx, top + 6 - h);
        g.fillStyle(0x9ac8e2, 1).fillTriangle(x + dx, top + 6, x + dx + 3, top + 6, x + dx, top + 6 - h);
      }
      return true;
    }
    default: return false;
  }
}
