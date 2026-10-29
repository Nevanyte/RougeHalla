import { TILE, VISION_RADIUS, VISION_TRAIL_MS, VISION_UPDATE_MS } from "./constants";
import { isWallTile, type GameMap } from "./map";
import type { Vec2 } from "./messages";

/** First wall faces are visible, but walls and closed gates occlude everything behind them. No ray objects allocated. */
export function hasVisionLineOfSight(map: GameMap, from: Vec2, to: Vec2): boolean {
  return sightLine(map, from.x, from.y, to.x, to.y);
}

function sightLine(map: GameMap, x: number, y: number, endX: number, endY: number): boolean {
  if (!Number.isFinite(x + y + endX + endY)) return false;
  let tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const ex = Math.floor(endX / TILE), ey = Math.floor(endY / TILE);
  if (ex < 0 || ey < 0 || ex >= map.w || ey >= map.h || isWallTile(map, tx, ty)) return false;
  const dx = endX - x, dy = endY - y;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  let crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * TILE - x) / dx;
  let crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * TILE - y) / dy;
  while (tx !== ex || ty !== ey) {
    // Crossing exactly through a wall corner cannot reveal the diagonal floor beyond it.
    if (crossX === crossY) {
      if (isWallTile(map, tx + sx, ty) || isWallTile(map, tx, ty + sy)) return false;
      tx += sx; ty += sy;
      crossX = dx === 0 ? Infinity : ((tx + (sx > 0 ? 1 : 0)) * TILE - x) / dx;
      crossY = dy === 0 ? Infinity : ((ty + (sy > 0 ? 1 : 0)) * TILE - y) / dy;
    } else if (crossX < crossY) {
      tx += sx;
      crossX = ((tx + (sx > 0 ? 1 : 0)) * TILE - x) / dx;
    } else {
      ty += sy;
      crossY = ((ty + (sy > 0 ? 1 : 0)) * TILE - y) / dy;
    }
    if (tx === ex && ty === ey) return true;
    if (isWallTile(map, tx, ty)) return false;
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

  constructor(readonly width: number, readonly height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("Invalid vision grid");
    this.expiresAt = new Float64Array(width * height);
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
    this.lastMap = map; this.lastUpdate = now; this.lastRadius = radius; this.lastTtl = ttl;
    const minX = Math.max(0, Math.floor((origin.x - radius) / TILE));
    const maxX = Math.min(map.w - 1, Math.floor((origin.x + radius) / TILE));
    const minY = Math.max(0, Math.floor((origin.y - radius) / TILE));
    const maxY = Math.min(map.h - 1, Math.floor((origin.y + radius) / TILE));
    const r2 = radius * radius, until = now + ttl;
    for (let ty = minY; ty <= maxY; ty++) {
      const y = (ty + 0.5) * TILE, dy = y - origin.y;
      for (let tx = minX; tx <= maxX; tx++) {
        const x = (tx + 0.5) * TILE, dx = x - origin.x;
        if (dx * dx + dy * dy > r2 || !sightLine(map, origin.x, origin.y, x, y)) continue;
        const i = ty * this.width + tx;
        if (until > this.expiresAt[i]!) this.expiresAt[i] = until;
      }
    }
    // The standing tile is always retained, including when the player is just inside a radius boundary.
    const tx = Math.floor(origin.x / TILE), ty = Math.floor(origin.y / TILE);
    if (tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && !isWallTile(map, tx, ty)) {
      const i = ty * this.width + tx;
      this.expiresAt[i] = Math.max(this.expiresAt[i]!, until);
    }
  }

  canSee(point: Vec2, now: number): boolean {
    if (!Number.isFinite(point.x + point.y + now)) return false;
    const x = Math.floor(point.x / TILE), y = Math.floor(point.y / TILE);
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.expiresAt[y * this.width + x]! > now;
  }
}
