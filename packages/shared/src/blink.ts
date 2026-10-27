// Blink (Blaze Step): where a jump toward the cursor lands. One pure function used by the server's cast and by the client's
// prediction, so both get the identical point. Everything here is +, -, *, / and Math.sqrt (correctly rounded in every
// engine, where Math.hypot is not), and the per-map tables are cached, because the sweep in the tests and the client's
// per-frame cursor read call it often.
import { BLAZE_MIN_DIST, BLAZE_RANGE, BLINK_STEP } from "./abilities";
import { PLAYER_RADIUS, TILE } from "./constants";
import { circleClear } from "./geometry";
import { REGION_COLISEUM, TILE_WALL, inColiseum, isSolidTile, moveComponents, withGates, worldToTile, type GameMap } from "./map";
import type { Vec2 } from "./messages";

const components = new WeakMap<GameMap, Int32Array>();

/**
 * The 4-connected floor components of the tile grid: 0 for a tile that is not floor (a wall or a LOW fence/lava: bodies cannot
 * stand on either), 1.. for the floor tiles of each component. Cached per
 * map object, so the locked copy from `withGates(map)` has its own (the locked gates seal the coliseum). Two tiles are the
 * same pocket of floor iff their labels are equal; a player (a disc wider than nothing, narrower than a tile) can walk
 * between 4-connected tiles but never cuts a corner between two diagonal ones. It is `moveComponents` (map.ts: -1 on solid
 * tiles, ids 0.. in row-major order of each component's first tile) shifted up by one, so a label is 0 for "not floor".
 */
export function floorComponents(map: GameMap): Int32Array {
  const cached = components.get(map);
  if (cached) return cached;
  const comp = moveComponents(map);
  const label = new Int32Array(comp.length);
  for (let i = 0; i < comp.length; i++) label[i] = comp[i] + 1;
  components.set(map, label);
  return label;
}

/** The ring's mask and the tile box it lies in (x0 > x1: no ring, a hand-built map without a coliseum). */
interface Ring { mask: Uint8Array; x0: number; y0: number; x1: number; y1: number }

// Keyed on the region grid, which a map and its locked copy share: both get the one ring.
const rings = new WeakMap<Uint8Array, Ring>();

function ringOf(map: GameMap): Ring {
  const cached = rings.get(map.regionGrid);
  if (cached) return cached;
  const { w, h, regionGrid } = map;
  const mask = new Uint8Array(w * h);
  const ring: Ring = { mask, x0: w, y0: h, x1: -1, y1: -1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (regionGrid[y * w + x] !== REGION_COLISEUM) continue;
      let edge = false;
      for (let j = -1; j <= 1 && !edge; j++) {
        for (let i = -1; i <= 1; i++) {
          if (i === 0 && j === 0) continue;
          const nx = x + i, ny = y + j;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || regionGrid[ny * w + nx] !== REGION_COLISEUM) { edge = true; break; }
        }
      }
      if (!edge) continue;
      mask[y * w + x] = 1;
      if (x < ring.x0) ring.x0 = x;
      if (x > ring.x1) ring.x1 = x;
      if (y < ring.y0) ring.y0 = y;
      if (y > ring.y1) ring.y1 = y;
    }
  }
  rings.set(regionGrid, ring);
  return ring;
}

/**
 * The coliseum's outer ring: the coliseum tiles with an 8-neighbour outside it (or off the map), gates included. The map
 * generator builds its wall ring the same way, so with the gates open the only floor tiles in the mask are the gate tiles.
 * Length w * h, 1 on a ring tile; cached per region grid.
 */
export function coliseumRingMask(map: GameMap): Uint8Array {
  return ringOf(map).mask;
}

/**
 * True if the segment a to b visits a ring tile that is a wall on `cmap` (the collision map: the open map or the locked copy).
 * A grid DDA; passing exactly through a tile vertex counts as visiting both neighbouring tiles, so the result does not depend
 * on which end it is walked from. A tile of the ring that is floor (an open gate) does not block: the coliseum's footprint
 * can be crossed only through an open gate. A non-finite end blocks.
 */
export function segmentCrossesRing(map: GameMap, cmap: GameMap, a: Vec2, b: Vec2): boolean {
  const ring = ringOf(map);
  if (ring.x1 < ring.x0) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!Number.isFinite(a.x + a.y + dx + dy)) return true;
  let tx = worldToTile(a.x), ty = worldToTile(a.y);
  const bx = worldToTile(b.x), by = worldToTile(b.y);
  // Every tile the segment visits lies in the box of its two end tiles.
  if (Math.max(tx, bx) < ring.x0 || Math.min(tx, bx) > ring.x1 || Math.max(ty, by) < ring.y0 || Math.min(ty, by) > ring.y1) return false;

  const { w, h } = cmap;
  const { mask } = ring;
  const blocks = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return mask[i] === 1 && cmap.tiles[i] === TILE_WALL;
  };
  if (blocks(tx, ty)) return true;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  // The segment parameter in [0, 1] at which the next vertical and horizontal grid lines are crossed.
  let tMaxX = stepX === 0 ? Infinity : ((tx + (stepX > 0 ? 1 : 0)) * TILE - a.x) / dx;
  let tMaxY = stepY === 0 ? Infinity : ((ty + (stepY > 0 ? 1 : 0)) * TILE - a.y) / dy;
  for (;;) {
    const t = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (t > 1) return false;
    const crossX = tMaxX <= t;
    const crossY = tMaxY <= t;
    if (crossX && crossY && (blocks(tx + stepX, ty) || blocks(tx, ty + stepY))) return true;
    if (crossX) {
      tx += stepX;
      tMaxX = ((tx + (stepX > 0 ? 1 : 0)) * TILE - a.x) / dx;
    }
    if (crossY) {
      ty += stepY;
      tMaxY = ((ty + (stepY > 0 ? 1 : 0)) * TILE - a.y) / dy;
    }
    if (blocks(tx, ty)) return true;
  }
}

/**
 * Where a blink from `from` toward the cursor point `toward` lands, or null (refused, at no cost). Up to `maxDist` along the
 * ray, through walls: the landing is the FARTHEST valid point on the ray between min(max(len, minDist), maxDist) and
 * `minDist`, in BLINK_STEP steps (a cursor nearer than `minDist` still blinks `minDist`; one within 1 u has no direction).
 * A point is valid when
 *   (a) a player disc fits on the collision map there (never off the map, never in rock);
 *   (b) it is in the same 4-connected floor component as `from` (no sealed pocket; locked gates seal the coliseum);
 *   (c) the segment from `from` never visits a coliseum ring tile that is a wall on the collision map, so the coliseum's
 *       footprint is crossed only through an open gate;
 *   (d) with the gates locked, it is on the same side of the coliseum footprint as `from`.
 * An origin inside a wall gets null.
 */
export function blinkLanding(
  map: GameMap, gatesLocked: boolean, from: Vec2, toward: Vec2, maxDist: number = BLAZE_RANGE, minDist: number = BLAZE_MIN_DIST,
): Vec2 | null {
  const dx = toward.x - from.x, dy = toward.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(len) || len < 1) return null;
  const want = Math.min(maxDist, Math.max(len, minDist));

  const cmap = gatesLocked ? withGates(map) : map;
  const tx0 = worldToTile(from.x), ty0 = worldToTile(from.y);
  if (isSolidTile(cmap, tx0, ty0)) return null;
  const labels = floorComponents(cmap);
  const home = labels[ty0 * cmap.w + tx0];
  const homeInside = gatesLocked && inColiseum(map, from.x, from.y);

  const ux = dx / len, uy = dy / len;
  const p: Vec2 = { x: 0, y: 0 };
  for (let k = 0; ; k++) {
    const d = want - k * BLINK_STEP;
    if (d < minDist) return null;
    p.x = from.x + ux * d;
    p.y = from.y + uy * d;
    if (!circleClear(cmap, p, PLAYER_RADIUS)) continue;
    // A clear disc stands on a floor tile, so the label is a real component.
    if (labels[worldToTile(p.y) * cmap.w + worldToTile(p.x)] !== home) continue;
    if (gatesLocked && inColiseum(map, p.x, p.y) !== homeInside) continue;
    if (segmentCrossesRing(map, cmap, from, p)) continue;
    return { x: p.x, y: p.y };
  }
}
