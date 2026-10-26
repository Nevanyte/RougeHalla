// Static map rendering, built once from generateMap(seed) and the coliseum gates (built once, shown or hidden by setGatesLocked).
// Two ways to draw the ground and walls:
//   * a styled map (it has zone terrain or props; zoneArt/) is baked into textures once: floor chunks and wall strips with the
//     zone's art, plus the animated overlays (TerrainFx). If baking fails (no dynamic textures, a lost context) it falls back to
//   * the plain way: region-tinted floor, walls with fake height and LOW tiles (lava, fence, crevasse: low blocks that stop bodies
//     but not sight) as a few Graphics rows that Phaser replays every frame. A map with no zone art always takes this path.
import Phaser from "phaser";
import {
  REGION_IDS, TERRAIN_CREVASSE, TERRAIN_FENCE, TERRAIN_LAVA, TILE, TILE_LOW, Y_SCALE, isWallTile, withGates,
  type GameMap, type RegionId,
} from "@raid/shared";
import { depthFor, projX, projY } from "./projection";
import { BakedArt, bakeZoneArt, hasZoneArt, makeContext, type BakeStats } from "./zoneArt/bake";
import { TerrainFx } from "./zoneArt/TerrainFx";
import { LOW_HEIGHT, WALL_HEIGHT } from "./zoneArt/zoneStyle";

/**
 * Screen pixels a wall's top face is lifted above its footprint. Keep it under one projected tile
 * (TILE * Y_SCALE = 25.6): a taller wall hides the whole tile north of it, loot included. A LOW tile's top face is lifted
 * LOW_HEIGHT, half a wall, so a body can be seen to stand behind it. Both live in zoneArt/zoneStyle.ts.
 */
export { LOW_HEIGHT, WALL_HEIGHT };

/** How a LOW tile looks by terrain kind (map.terrain): the top face, the front face and the lighter rim round the top. */
interface LowLook { top: number; front: number; rim: number }
const LOW_DEFAULT: LowLook = { top: 0x5a606a, front: 0x3a3f46, rim: 0x9aa0aa };
const LOW_BY_KIND: Readonly<Record<number, LowLook>> = {
  [TERRAIN_LAVA]: { top: 0xff5a14, front: 0xa63a0c, rim: 0xffa060 },
  [TERRAIN_FENCE]: LOW_DEFAULT,
  [TERRAIN_CREVASSE]: { top: 0x0a1626, front: 0x050b14, rim: 0x2a4a6a },
};

/**
 * Anything that stands (players, containers, wall rows) sorts by ground y, which is >= 0, so these
 * layers sit below every one of them. The open-gate marking and the loot highlight ring are painted on
 * the floor, never over a player.
 */
const DEPTH_FLOOR = -1e6;
const DEPTH_GATE_MARK = -5e5;
export const DEPTH_HIGHLIGHT = -4e5;

const COLOR_OUTDOOR = 0x2a3038;
/** Laid over a ruin's footprint on top of the region tint, so a ruin reads as indoors in every region. */
const COLOR_INDOOR = 0x1c1612;
const ALPHA_INDOOR = 0.45;
const COLOR_WALL_TOP = 0x8a9099;
const COLOR_WALL_FRONT = 0x555b63;
/** Closed gates: a portcullis in the wall ring. */
const COLOR_GATE_TOP = 0xb85c4a;
const COLOR_GATE_FRONT = 0x7a2e2b;
/** Open gates: a faint doorway marking on the floor. */
const ALPHA_GATE_FILL = 0.18;
const ALPHA_GATE_EDGE = 0.35;
/** How far a wall's top face leans toward its region's accent colour. */
const WALL_TINT = 0.12;

function mix(base: number, tint: number, amount: number): number {
  const ch = (shift: number) => {
    const a = (base >> shift) & 0xff;
    const b = (tint >> shift) & 0xff;
    return Math.round(a + (b - a) * amount);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The accent each region is known by (faction colours; sand for the coliseum). "none" has no accent. */
const REGION_ACCENT: Record<RegionId, number> = {
  none: COLOR_OUTDOOR,
  fire: 0xff7043,
  sentenced: 0x9575cd,
  plague: 0x9ccc65,
  frost: 0x4fc3f7,
  holy: 0xfff176,
  coliseum: 0xc8b48a,
};

/** Floor colour per region: the outdoor base with the accent blended in. Retune the amounts here. */
const REGION_FLOOR: Record<RegionId, number> = {
  none: COLOR_OUTDOOR,
  fire: mix(COLOR_OUTDOOR, REGION_ACCENT.fire, 0.18),
  sentenced: mix(COLOR_OUTDOOR, REGION_ACCENT.sentenced, 0.18),
  plague: mix(COLOR_OUTDOOR, REGION_ACCENT.plague, 0.18),
  frost: mix(COLOR_OUTDOOR, REGION_ACCENT.frost, 0.18),
  holy: mix(COLOR_OUTDOOR, REGION_ACCENT.holy, 0.18),
  coliseum: mix(COLOR_OUTDOOR, REGION_ACCENT.coliseum, 0.22),
};

/**
 * Per-tile lookups indexed by `map.regionGrid` values. Wall tops lean only slightly toward the accent so
 * walls stay neutral grey; "none" (ridges, the border) stays fully neutral.
 */
const FLOOR_BY_CODE: readonly number[] = REGION_IDS.map((id) => REGION_FLOOR[id]);
const WALL_TOP_BY_CODE: readonly number[] = REGION_IDS.map((id) =>
  id === "none" ? COLOR_WALL_TOP : mix(COLOR_WALL_TOP, REGION_ACCENT[id], WALL_TINT));

/** Calls `fn(start, length, value)` for every maximal run of equal values >= 0; negative values break runs and are skipped. */
function forEachRun(values: ArrayLike<number>, fn: (start: number, length: number, value: number) => void): void {
  let start = -1;
  let cur = -1;
  for (let i = 0; i <= values.length; i++) {
    const v = i < values.length ? values[i] : -1;
    if (start >= 0 && v !== cur) {
      fn(start, i - start, cur);
      start = -1;
    }
    if (v >= 0 && start < 0) {
      start = i;
      cur = v;
    }
  }
}

export class MapView {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  /** Closed-gate wall rows and the open-gate floor marking; setGatesLocked only flips their visibility. */
  private readonly lockedGates: Phaser.GameObjects.Graphics[] = [];
  private openGates: Phaser.GameObjects.Graphics | null = null;
  private gatesLocked = false;
  /** The baked ground and walls of a styled map; null on the plain way. */
  private art: BakedArt | null = null;
  /** The animated overlays and particles over the baked ground; null on the plain way. */
  private fx: TerrainFx | null = null;
  private terrainFx = true;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, readonly map: GameMap) {
    if (hasZoneArt(map)) this.bake();
    if (!this.art) {
      this.drawFloor();
      this.drawWalls();
      this.drawLow();
    }
    this.drawGates();
    scene.events?.on?.("postupdate", this.onPostUpdate);
    scene.game?.canvas?.addEventListener?.("webglcontextrestored", this.onContextRestored);
    this.verifyBake();
  }

  /** How the bake went (time, textures, images), or null when the map is drawn the plain way. */
  get bakeStats(): Readonly<BakeStats> | null {
    return this.art?.stats ?? null;
  }

  /** Shows the closed gates (portcullis walls) or the open-gate floor marking. Cheap to call every frame. */
  setGatesLocked(locked: boolean): void {
    if (locked === this.gatesLocked) return;
    this.gatesLocked = locked;
    for (const g of this.lockedGates) g.setVisible(locked);
    this.openGates?.setVisible(!locked);
  }

  /** Shows or hides the animated terrain overlays and particles (the baked art stays). */
  setTerrainFx(visible: boolean): void {
    this.terrainFx = visible;
    this.fx?.setVisible(visible);
  }

  destroy(): void {
    this.destroyed = true;
    this.scene.events?.off?.("postupdate", this.onPostUpdate);
    this.scene.game?.canvas?.removeEventListener?.("webglcontextrestored", this.onContextRestored);
    this.fx?.destroy();
    this.fx = null;
    this.art?.destroy();
    this.art = null;
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.lockedGates.length = 0;
    this.openGates = null;
  }

  /** Bakes the zone art; any failure leaves `art` null so the plain way draws the map. */
  private bake(): void {
    try {
      this.art = bakeZoneArt(this.scene, this.map, makeContext(this.map));
      if (this.fx === null) {
        this.fx = new TerrainFx(this.scene, this.map);
        this.fx.setVisible(this.terrainFx);
      }
    } catch (e) {
      console.warn("MapView: baking the zone art failed, drawing the map the plain way", e);
      this.art?.destroy();
      this.art = null;
      this.fx?.destroy();
      this.fx = null;
    }
  }

  /**
   * A smoke test of the bake, once: Phaser 4 draws into a texture through a command buffer, so a texture that was never rendered (an
   * unsupported renderer, a lost context) comes out empty. Reads one pixel of the first floor chunk (always opaque ground); a clear
   * pixel sends the map to the plain way. A scene or renderer that cannot read it leaves the bake as it is.
   */
  private verifyBake(): void {
    const probe = this.art?.probe;
    const texture = probe ? this.scene.textures?.get?.(probe.key) : null;
    const read = (texture as { snapshotPixel?: (x: number, y: number, cb: (c: { alpha: number }) => void) => void } | null)?.snapshotPixel;
    if (!probe || typeof read !== "function") return;
    const art = this.art;
    try {
      read.call(texture, probe.x + 8, probe.y + 8, (color) => {
        if (this.destroyed || this.art !== art || color.alpha !== 0) return;
        console.warn("MapView: the baked zone art came out empty, drawing the map the plain way");
        this.fallBack();
      });
    } catch {
      /* a renderer that cannot read pixels: trust the bake */
    }
  }

  /** Drops the baked art and draws the plain way. */
  private fallBack(): void {
    this.art?.destroy();
    this.art = null;
    this.fx?.destroy();
    this.fx = null;
    this.drawFloor();
    this.drawWalls();
    this.drawLow();
  }

  /** A restored WebGL context has lost every texture's contents: bake again (after Phaser has rebuilt its own resources). */
  private readonly onContextRestored = (): void => {
    setTimeout(() => {
      if (this.destroyed || !this.art) return;
      this.art.destroy();
      this.art = null;
      this.bake();
      if (!this.art) {
        this.drawFloor();
        this.drawWalls();
        this.drawLow();
      }
      this.verifyBake();
    }, 0);
  };

  /** Each frame after the scene's update (the camera has moved): show only the baked images in view, then the overlays. */
  private readonly onPostUpdate = (): void => {
    const cam = this.scene.cameras?.main;
    if (!this.art || !cam || typeof cam.width !== "number" || !(cam.zoom > 0)) return;
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    const hw = cam.width / cam.zoom / 2;
    const hh = cam.height / cam.zoom / 2;
    this.art.cull(cx - hw - 48, cy - hh - 48, cx + hw + 48, cy + hh + 48);
    this.fx?.update(performance.now(), { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh });
  };

  private drawFloor(): void {
    const { map } = this;
    const worldW = map.w * TILE;
    const worldH = map.h * TILE;
    const g = this.scene.add.graphics().setDepth(DEPTH_FLOOR);
    this.objects.push(g);

    g.fillStyle(COLOR_OUTDOOR, 1).fillRect(projX(0), projY(0), worldW, worldH * Y_SCALE);

    // One fillRect per horizontal run of equal region code; "none" is the base fill already drawn.
    const codes: number[] = new Array(map.w);
    for (let ty = 0; ty < map.h; ty++) {
      let any = false;
      for (let tx = 0; tx < map.w; tx++) {
        const code = map.regionGrid[ty * map.w + tx];
        codes[tx] = code > 0 && code < FLOOR_BY_CODE.length ? code : -1;
        any ||= codes[tx] >= 0;
      }
      if (!any) continue;
      const top = projY(ty * TILE);
      const height = projY((ty + 1) * TILE) - top;
      forEachRun(codes, (start, len, code) => {
        g.fillStyle(FLOOR_BY_CODE[code], 1).fillRect(projX(start * TILE), top, len * TILE, height);
      });
    }

    g.fillStyle(COLOR_INDOOR, ALPHA_INDOOR);
    for (const b of map.buildings) {
      g.fillRect(projX(b.x * TILE), projY(b.y * TILE), b.w * TILE, b.h * TILE * Y_SCALE);
    }

    // White at low alpha so one grid reads on both the outdoor and the indoor floor.
    g.lineStyle(1, 0xffffff, 0.05);
    for (let tx = 0; tx <= map.w; tx++) g.lineBetween(projX(tx * TILE), projY(0), projX(tx * TILE), projY(worldH));
    for (let ty = 0; ty <= map.h; ty++) g.lineBetween(projX(0), projY(ty * TILE), projX(worldW), projY(ty * TILE));
  }

  /**
   * One Graphics per tile row, depth = ground y of the row's south edge. An entity whose ground y is
   * north of that edge draws under the row (the wall hides it); one south of it draws over the row.
   */
  private drawWalls(): void {
    const { map } = this;
    // Per tile: the region code for a wall (the top face's tint; runs split where it changes), else -1.
    const top: number[] = [];
    const front: number[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      let any = false;
      for (let tx = 0; tx < map.w; tx++) {
        const wall = isWallTile(map, tx, ty);
        const code = map.regionGrid[ty * map.w + tx];
        top[tx] = wall ? (code < WALL_TOP_BY_CODE.length ? code : 0) : -1;
        // Out-of-bounds counts as wall, so the last row needs its own test or it would show no front
        // face and leave a strip of floor drawn below the map's edge.
        front[tx] = wall && (ty + 1 >= map.h || !isWallTile(map, tx, ty + 1)) ? 0 : -1;
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
      forEachRun(top, (start, len, code) => {
        g.fillStyle(WALL_TOP_BY_CODE[code], 1).fillRect(projX(start * TILE), faceTop, len * TILE, TILE * Y_SCALE);
      });
    }
  }

  /**
   * LOW tiles, the same way as the walls: one Graphics per tile row at the row's south-edge depth (so fighters y-sort against
   * them), runs of one terrain kind per row. A block LOW_HEIGHT tall with its top face lifted, a front face under it where the
   * tile to the south is not LOW, and a lighter rim round each run's top. A wall's front face is not touched: it is decided by
   * isWallTile alone, so a wall north of a LOW tile keeps all of it (the LOW block, standing in front, covers its lowest 7 px).
   */
  private drawLow(): void {
    const { map } = this;
    const kind: number[] = [];
    const front: number[] = [];
    for (let ty = 0; ty < map.h; ty++) {
      let any = false;
      for (let tx = 0; tx < map.w; tx++) {
        const low = map.tiles[ty * map.w + tx] === TILE_LOW;
        kind[tx] = low ? map.terrain[ty * map.w + tx] : -1;
        front[tx] = low && (ty + 1 >= map.h || map.tiles[(ty + 1) * map.w + tx] !== TILE_LOW) ? kind[tx]! : -1;
        any ||= low;
      }
      if (!any) continue;

      const southEdge = (ty + 1) * TILE;
      const g = this.scene.add.graphics().setDepth(depthFor(southEdge));
      this.objects.push(g);

      const faceTop = projY(ty * TILE, LOW_HEIGHT);
      forEachRun(front, (start, len, k) => {
        g.fillStyle((LOW_BY_KIND[k] ?? LOW_DEFAULT).front, 1).fillRect(projX(start * TILE), projY(southEdge, LOW_HEIGHT), len * TILE, LOW_HEIGHT);
      });
      forEachRun(kind, (start, len, k) => {
        const look = LOW_BY_KIND[k] ?? LOW_DEFAULT;
        g.fillStyle(look.top, 1).fillRect(projX(start * TILE), faceTop, len * TILE, TILE * Y_SCALE);
        g.lineStyle(1, look.rim, 1).strokeRect(projX(start * TILE), faceTop, len * TILE, TILE * Y_SCALE);
      });
    }
  }

  /**
   * Both gate states are built here once. Closed: the gate tiles drawn as walls, one Graphics per tile row
   * at the row's south-edge depth like drawWalls, so players y-sort against the portcullis. Open: a faint
   * floor marking under everything that stands. Walls decide the front faces from the locked copy of the map, so a gate
   * tile above another gate tile (the side gates span several rows) shows no front face between them.
   */
  private drawGates(): void {
    const { map } = this;
    if (map.coliseum.gates.length === 0) return;
    const closed = withGates(map);

    const rows = new Map<number, number[]>();
    for (const gate of map.coliseum.gates) {
      for (const t of gate.tiles) {
        let row = rows.get(t.y);
        if (!row) { row = new Array<number>(map.w).fill(-1); rows.set(t.y, row); }
        row[t.x] = 0;
      }
    }
    for (const [ty, top] of [...rows].sort((a, b) => a[0] - b[0])) {
      const front = top.map((v, tx) => (v >= 0 && (ty + 1 >= map.h || !isWallTile(closed, tx, ty + 1)) ? 0 : -1));
      const southEdge = (ty + 1) * TILE;
      // The same depth as the wall row, so a player sorts against a gate exactly as against a wall. The two
      // never overlap on screen except under the previous row's front face, which has the lower depth.
      const g = this.scene.add.graphics().setDepth(depthFor(southEdge)).setVisible(this.gatesLocked);
      this.objects.push(g);
      this.lockedGates.push(g);
      g.fillStyle(COLOR_GATE_FRONT, 1);
      forEachRun(front, (start, len) => {
        g.fillRect(projX(start * TILE), projY(southEdge, WALL_HEIGHT), len * TILE, WALL_HEIGHT);
      });
      g.fillStyle(COLOR_GATE_TOP, 1);
      forEachRun(top, (start, len) => {
        g.fillRect(projX(start * TILE), projY(ty * TILE, WALL_HEIGHT), len * TILE, TILE * Y_SCALE);
      });
    }

    const mark = this.scene.add.graphics().setDepth(DEPTH_GATE_MARK).setVisible(!this.gatesLocked);
    this.objects.push(mark);
    this.openGates = mark;
    for (const gate of map.coliseum.gates) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      mark.fillStyle(COLOR_GATE_TOP, ALPHA_GATE_FILL);
      for (const t of gate.tiles) {
        mark.fillRect(projX(t.x * TILE), projY(t.y * TILE), TILE, TILE * Y_SCALE);
        x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
        x1 = Math.max(x1, t.x + 1); y1 = Math.max(y1, t.y + 1);
      }
      if (x0 > x1) continue;
      mark.lineStyle(1, COLOR_GATE_TOP, ALPHA_GATE_EDGE);
      mark.strokeRect(projX(x0 * TILE), projY(y0 * TILE), (x1 - x0) * TILE, (y1 - y0) * TILE * Y_SCALE);
    }
  }
}
