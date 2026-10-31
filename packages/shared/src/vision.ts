import { TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS } from "./constants";
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
  return traceSightLine(map, x, y, (ex + 0.5) * TILE, (ey + 0.5) * TILE, tx, ty, ex, ey, MASK_SIGHT, TILE);
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
    if (originCanSee) for (let ty = minY; ty <= maxY; ty++) {
      const y = (ty + 0.5) * tileSize, dy = y - origin.y;
      for (let tx = minX; tx <= maxX; tx++) {
        // The full arena was already revealed above, regardless of its walls or the sight circle.
        if (arena && tx >= arena.x && tx < arena.x + arena.w && ty >= arena.y && ty < arena.y + arena.h) continue;
        const x = (tx + 0.5) * tileSize, dx = x - origin.x;
        if (dx * dx + dy * dy > r2 || !sightLineToTile(map, origin.x, origin.y, originTx, originTy, tx, ty)) continue;
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

  canSee(point: Vec2, now: number): boolean {
    if (!Number.isFinite(point.x + point.y + now)) return false;
    const x = Math.floor(point.x / TILE), y = Math.floor(point.y / TILE);
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.expiresAt[y * this.width + x]! > now;
  }
}
