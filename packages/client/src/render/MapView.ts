// Static map rendering, built once from generateMap(seed): floor, extract zones, and walls with fake height.
import Phaser from "phaser";
import { TILE, Y_SCALE, isWallTile, type GameMap } from "@raid/shared";
import { depthFor, projX, projY } from "./projection";

/**
 * Screen pixels a wall's top face is lifted above its footprint. Keep it under one projected tile
 * (TILE * Y_SCALE = 25.6): a taller wall hides the whole tile north of it, loot included.
 */
export const WALL_HEIGHT = 14;

/**
 * Anything that stands (players, containers, wall rows) sorts by ground y, which is >= 0, so these
 * layers sit below every one of them. The extract zone and the loot highlight ring are painted on the
 * floor, never over a player.
 */
const DEPTH_FLOOR = -1e6;
const DEPTH_ZONE = -5e5;
export const DEPTH_HIGHLIGHT = -4e5;

const COLOR_OUTDOOR = 0x2a3038;
const COLOR_INDOOR = 0x3b3530;
const COLOR_WALL_TOP = 0x8a9099;
const COLOR_WALL_FRONT = 0x555b63;
const COLOR_ZONE = 0x26a69a;
const COLOR_ZONE_EDGE = 0x4db6ac;

/** Calls `fn(start, length)` for every maximal run of consecutive true flags. */
function forEachRun(flags: readonly boolean[], fn: (start: number, length: number) => void): void {
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (flags[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      fn(start, i - start);
      start = -1;
    }
  }
}

export class MapView {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene, readonly map: GameMap) {
    this.drawFloor();
    this.drawExtractZones();
    this.drawWalls();
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
  }

  private drawFloor(): void {
    const { map } = this;
    const worldW = map.w * TILE;
    const worldH = map.h * TILE;
    const g = this.scene.add.graphics().setDepth(DEPTH_FLOOR);
    this.objects.push(g);

    g.fillStyle(COLOR_OUTDOOR, 1).fillRect(projX(0), projY(0), worldW, worldH * Y_SCALE);
    g.fillStyle(COLOR_INDOOR, 1);
    for (const b of map.buildings) {
      g.fillRect(projX(b.x * TILE), projY(b.y * TILE), b.w * TILE, b.h * TILE * Y_SCALE);
    }

    // White at low alpha so one grid reads on both the outdoor and the indoor floor.
    g.lineStyle(1, 0xffffff, 0.05);
    for (let tx = 0; tx <= map.w; tx++) g.lineBetween(projX(tx * TILE), projY(0), projX(tx * TILE), projY(worldH));
    for (let ty = 0; ty <= map.h; ty++) g.lineBetween(projX(0), projY(ty * TILE), projX(worldW), projY(ty * TILE));
  }

  private drawExtractZones(): void {
    const g = this.scene.add.graphics().setDepth(DEPTH_ZONE);
    this.objects.push(g);
    for (const z of this.map.extracts) {
      const cx = projX(z.x);
      const cy = projY(z.y);
      const w = z.r * 2;
      const h = z.r * 2 * Y_SCALE;
      g.fillStyle(COLOR_ZONE, 0.15).fillEllipse(cx, cy, w, h);
      g.lineStyle(2, COLOR_ZONE_EDGE, 0.7).strokeEllipse(cx, cy, w, h);

      const label = this.scene.add.text(cx, cy, z.name, {
        fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#80cbc4",
      }).setOrigin(0.5, 0.5).setAlpha(0.9).setDepth(DEPTH_ZONE);
      this.objects.push(label);
    }
  }

  /**
   * One Graphics per tile row, depth = ground y of the row's south edge. An entity whose ground y is
   * north of that edge draws under the row (the wall hides it); one south of it draws over the row.
   */
  private drawWalls(): void {
    const { map } = this;
    const top: boolean[] = [];
    const front: boolean[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      let any = false;
      for (let tx = 0; tx < map.w; tx++) {
        const wall = isWallTile(map, tx, ty);
        top[tx] = wall;
        // Out-of-bounds counts as wall, so the last row needs its own test or it would show no front
        // face and leave a strip of floor drawn below the map's edge.
        front[tx] = wall && (ty + 1 >= map.h || !isWallTile(map, tx, ty + 1));
        any ||= wall;
      }
      if (!any) continue;

      const southEdge = (ty + 1) * TILE;
      const g = this.scene.add.graphics().setDepth(depthFor(southEdge));
      this.objects.push(g);

      // The top face is the footprint lifted by WALL_HEIGHT; the front face fills the gap below its south edge.
      const faceTop = projY(ty * TILE, WALL_HEIGHT);
      g.fillStyle(COLOR_WALL_FRONT, 1);
      forEachRun(front, (start, len) => {
        g.fillRect(projX(start * TILE), projY(southEdge, WALL_HEIGHT), len * TILE, WALL_HEIGHT);
      });
      g.fillStyle(COLOR_WALL_TOP, 1);
      forEachRun(top, (start, len) => {
        g.fillRect(projX(start * TILE), faceTop, len * TILE, TILE * Y_SCALE);
      });
    }
  }
}
