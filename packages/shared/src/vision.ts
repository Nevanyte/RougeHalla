import { BUSH_REVEAL_RADIUS, TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS } from "./constants";
import { inColiseum, isWallTile, MASK_SIGHT, type GameMap } from "./map";
import type { Vec2 } from "./messages";

/** First wall faces are visible, but walls and closed gates occlude everything behind them. No ray objects allocated. */
export function hasVisionLineOfSight(map: GameMap, from: Vec2, to: Vec2): boolean {
  return sightLine(map, from.x, from.y, to.x, to.y);
}

function sightLine(map: GameMap, x: number, y: number, endX: number, endY: number): boolean {
  if (!Number.isFinite(x + y + endX + endY)) return false;
  const tileSize = TILE, sightMask = MASK_SIGHT;
  let tx = Math.floor(x / tileSize), ty = Math.floor(y / tileSize);
  const ex = Math.floor(endX / tileSize), ey = Math.floor(endY / tileSize);
  if (ex < 0 || ey < 0 || ex >= map.w || ey >= map.h || isWallTile(map, tx, ty)) return false;
  return traceSightLine(map, x, y, endX, endY, tx, ty, ex, ey, sightMask, tileSize);
}

/** VisionMemory has already validated its origin and enumerates only in-bounds tile centers. */
function sightLineToTile(map: GameMap, x: number, y: number, tx: number, ty: number, ex: number, ey: number): boolean {
  const endX = (ex + 0.5) * TILE, endY = (ey + 0.5) * TILE;
  const fast = fastSightLine(map, x, y, endX, endY, tx, ty, ex, ey);
  return fast >= 0 ? fast === 1 : traceSightLine(map, x, y, endX, endY, tx, ty, ex, ey, MASK_SIGHT, TILE);
}

/** Crossings that differ by less than this are decided by the exact trace, which settles ties and rounding. */
const FAST_MARGIN = 1e-7;

/**
 * traceSightLine with the per-step division replaced by an incremental crossing time. It answers only when every
 * step's choice is far outside rounding error, so it takes exactly the tiles the exact trace takes; otherwise -1.
 */
function fastSightLine(map: GameMap, x: number, y: number, endX: number, endY: number, tx: number, ty: number, ex: number, ey: number): number {
  const dx = endX - x, dy = endY - y;
  if (dx === 0 || dy === 0) return -1;
  const tiles = map.tiles, width = map.w, tileSize = TILE;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const stepX = tileSize / Math.abs(dx), stepY = tileSize / Math.abs(dy);
  let crossX = ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
  let crossY = ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
  let index = ty * width + tx;
  const stepIndexY = sy * width;
  for (let guard = map.w + map.h; guard > 0; guard--) {
    if (crossX < crossY - FAST_MARGIN) {
      tx += sx; index += sx; crossX += stepX;
    } else if (crossY < crossX - FAST_MARGIN) {
      ty += sy; index += stepIndexY; crossY += stepY;
    } else return -1;
    if (tx === ex && ty === ey) return 1;
    if ((tiles[index]! & MASK_SIGHT) !== 0) return 0;
  }
  return -1;
}

function traceSightLine(
  map: GameMap, x: number, y: number, endX: number, endY: number, tx: number, ty: number, ex: number, ey: number,
  sightMask: number, tileSize: number,
): boolean {
  // Both ends are in bounds, so every crossed tile (and the two corner neighbors) is too.
  // Avoid repeating four bounds checks at every step of every field-of-view ray.
  const tiles = map.tiles, width = map.w;
  let index = ty * width + tx;
  const dx = endX - x, dy = endY - y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
  let crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
  while (tx !== ex || ty !== ey) {
    // Crossing exactly through a wall corner cannot reveal the diagonal floor beyond it.
    if (crossX === crossY) {
      if ((tiles[index + sx]! & sightMask) !== 0 || (tiles[index + sy * width]! & sightMask) !== 0) return false;
      tx += sx; ty += sy;
      index += sx + sy * width;
      crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
      crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
    } else if (crossX < crossY) {
      tx += sx;
      index += sx;
      crossX = ((tx + (sx > 0 ? 1 : 0)) * tileSize - x) / dx;
    } else {
      ty += sy;
      index += sy * width;
      crossY = ((ty + (sy > 0 ? 1 : 0)) * tileSize - y) / dy;
    }
    if (tx === ex && ty === ey) return true;
    if ((tiles[index]! & sightMask) !== 0) return false;
  }
  return true;
}

/** Exact circular current sight, useful for ward sources that must vanish without leaving a trail. */
export function isInVision(map: GameMap, origin: Vec2, point: Vec2, radius = VISION_RADIUS): boolean {
  const dx = point.x - origin.x, dy = point.y - origin.y;
  return radius >= 0 && dx * dx + dy * dy <= radius * radius && hasVisionLineOfSight(map, origin, point);
}

/** Private, bounded tile memory. Values are absolute server milliseconds, with exclusive expiry. */
export class VisionMemory {
  readonly expiresAt: Float64Array;
  private lastMap: GameMap | null = null;
  private lastUpdate = -Infinity;
  private lastRadius = -1;
  private lastTtl = -1;
  private lastX = NaN;
  private lastY = NaN;
  private readonly visible: Uint32Array;
  private visibleCount = 0;
  private sat = new Int32Array(0);

  constructor(readonly width: number, readonly height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("Invalid vision grid");
    this.expiresAt = new Float64Array(width * height);
    this.visible = new Uint32Array(width * height + 1);
  }

  clear(): void {
    this.expiresAt.fill(0);
    this.lastMap = null;
    this.lastUpdate = -Infinity;
  }

  update(map: GameMap, origin: Vec2, now: number, ttl = VISION_TRAIL_MS, radius = VISION_RADIUS): void {
    if (map.w !== this.width || map.h !== this.height) throw new RangeError("Vision grid does not match map");
    if (!Number.isFinite(now + ttl + radius + origin.x + origin.y) || ttl <= 0 || radius < 0) return;
    if (map === this.lastMap && now >= this.lastUpdate && now - this.lastUpdate < VISION_UPDATE_MS
      && radius === this.lastRadius && ttl === this.lastTtl) return;
    // Maps (including their gate-closed variant) are immutable. A stationary source sees the same
    // cells, so refresh their deadlines without casting the same thousand rays again. Exact world
    // coordinates matter: moving within a tile can reveal a different side of a wall corner.
    const reuse = map === this.lastMap && radius === this.lastRadius && origin.x === this.lastX && origin.y === this.lastY;
    this.lastMap = map; this.lastUpdate = now; this.lastRadius = radius; this.lastTtl = ttl;
    this.lastX = origin.x; this.lastY = origin.y;
    const until = now + ttl;
    const arena = inColiseum(map, origin.x, origin.y) ? map.coliseum.rect : null;
    if (arena) {
      const { x, y, w, h } = arena;
      for (let ty = Math.max(0, y); ty < Math.min(map.h, y + h); ty++) {
        for (let tx = Math.max(0, x); tx < Math.min(map.w, x + w); tx++) {
          const i = ty * this.width + tx;
          this.expiresAt[i] = Math.max(this.expiresAt[i]!, until);
        }
      }
    }
    if (reuse) {
      for (let i = 0; i < this.visibleCount; i++) {
        const index = this.visible[i]!;
        if (until > this.expiresAt[index]!) this.expiresAt[index] = until;
      }
      return;
    }
    this.visibleCount = 0;
    const tileSize = TILE;
    const minX = Math.max(0, Math.floor((origin.x - radius) / tileSize));
    const maxX = Math.min(map.w - 1, Math.floor((origin.x + radius) / tileSize));
    const minY = Math.max(0, Math.floor((origin.y - radius) / tileSize));
    const maxY = Math.min(map.h - 1, Math.floor((origin.y + radius) / tileSize));
    const r2 = radius * radius;
    const originTx = Math.floor(origin.x / tileSize), originTy = Math.floor(origin.y / tileSize);
    const originCanSee = originTx >= 0 && originTy >= 0 && originTx < map.w && originTy < map.h
      && !isWallTile(map, originTx, originTy);
    // Summed wall counts over the update's window (rebuilt each time, so a map edited in place stays right): a tile
    // whose sight segment has no wall near any of its pieces cannot be blocked, so it skips the trace.
    const sw = maxX - minX + 2;
    const sat = this.satFor(sw * (maxY - minY + 2));
    if (originCanSee) {
      const tiles = map.tiles, mw = map.w;
      for (let ty = minY; ty <= maxY; ty++) {
        let row = 0;
        const above = (ty - minY) * sw, here = above + sw, base = ty * mw;
        for (let tx = minX; tx <= maxX; tx++) {
          if ((tiles[base + tx]! & MASK_SIGHT) !== 0) row++;
          sat[here + tx - minX + 1] = sat[above + tx - minX + 1]! + row;
        }
      }
    }
    if (originCanSee) for (let ty = minY; ty <= maxY; ty++) {
      const y = (ty + 0.5) * tileSize, dy = y - origin.y;
      for (let tx = minX; tx <= maxX; tx++) {
        // The full arena was already revealed above, regardless of its walls or the sight circle.
        if (arena && tx >= arena.x && tx < arena.x + arena.w && ty >= arena.y && ty < arena.y + arena.h) continue;
        const x = (tx + 0.5) * tileSize, dx = x - origin.x;
        if (dx * dx + dy * dy > r2) continue;
        const cx = (tx + 0.5) * tileSize;
        if (!this.wallFree(origin.x, origin.y, cx, y, minX, minY, maxX, maxY, sw)
          && !sightLineToTile(map, origin.x, origin.y, originTx, originTy, tx, ty)) continue;
        const i = ty * this.width + tx;
        this.visible[this.visibleCount++] = i;
        if (until > this.expiresAt[i]!) this.expiresAt[i] = until;
      }
    }
    // The standing tile is always retained, including when the player is just inside a radius boundary.
    if (originCanSee) {
      const i = originTy * this.width + originTx;
      this.visible[this.visibleCount++] = i;
      this.expiresAt[i] = Math.max(this.expiresAt[i]!, until);
    }
  }

  /** True when no wall lies in the tile box of the segment's ends, grown by one tile for the corner checks: the trace cannot be blocked. */
  private wallFree(ax: number, ay: number, bx: number, by: number, minX: number, minY: number, maxX: number, maxY: number, sw: number): boolean {
    const sat = this.sat;
    const ta = Math.floor(ax / TILE), tb = Math.floor(ay / TILE), tc = Math.floor(bx / TILE), td = Math.floor(by / TILE);
    const x0 = Math.max(minX, Math.min(ta, tc) - 1) - minX, x1 = Math.min(maxX, Math.max(ta, tc) + 1) - minX + 1;
    const y0 = Math.max(minY, Math.min(tb, td) - 1) - minY, y1 = Math.min(maxY, Math.max(tb, td) + 1) - minY + 1;
    return sat[y1 * sw + x1]! - sat[y0 * sw + x1]! - sat[y1 * sw + x0]! + sat[y0 * sw + x0]! === 0;
  }

  private satFor(n: number): Int32Array {
    if (this.sat.length < n) this.sat = new Int32Array(n);
    else this.sat.fill(0, 0, n);
    return this.sat;
  }

  canSee(point: Vec2, now: number): boolean {
    if (!Number.isFinite(point.x + point.y + now)) return false;
    const x = Math.floor(point.x / TILE), y = Math.floor(point.y / TILE);
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.expiresAt[y * this.width + x]! > now;
  }
}

const bushIds = new WeakMap<GameMap, Uint8Array | null>();
function bushTable(map: GameMap): Uint8Array | null {
  let t = bushIds.get(map);
  if (t !== undefined) return t;
  t = null;
  map.features.forEach((f, i) => { if (f.kind === "bush") { t ??= new Uint8Array(map.features.length + 1); t[i + 1] = 1; } });
  bushIds.set(map, t);
  return t;
}

/** The featureGrid value (1 + feature index) of the bush under `p`, else 0. */
export function bushAt(map: GameMap, p: Vec2): number {
  const table = bushTable(map);
  if (!table) return 0;
  const x = Math.floor(p.x / TILE), y = Math.floor(p.y / TILE);
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return 0;
  const v = map.featureGrid[y * map.w + x];
  return v !== undefined && table[v] ? v : 0;
}

/**
 * LoL-style brush: a player standing in a bush is hidden from a viewer who is not in the same bush, unless within
 * BUSH_REVEAL_RADIUS or exposed (`revealUntil` > now: an attack or cast). Presentation and targeting only: it changes no sight line.
 */
export function bushConceals(map: GameMap, viewer: Vec2, actor: Vec2, revealUntil = 0, now = 0): boolean {
  const b = bushAt(map, actor);
  if (b === 0 || revealUntil > now || bushAt(map, viewer) === b) return false;
  const dx = actor.x - viewer.x, dy = actor.y - viewer.y;
  return dx * dx + dy * dy > BUSH_REVEAL_RADIUS * BUSH_REVEAL_RADIUS;
}
