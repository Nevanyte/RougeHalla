// Static map rendering, built once from generateMap(seed): region-tinted floor, walls with fake height, and the
// coliseum gates (built once, shown or hidden by setGatesLocked).
import Phaser from "phaser";
import { REGION_IDS, TILE, Y_SCALE, isWallTile, withGates, type GameMap, type RegionId } from "@raid/shared";
import { depthFor, projX, projY } from "./projection";

/**
 * Screen pixels a wall's top face is lifted above its footprint. Keep it under one projected tile
 * (TILE * Y_SCALE = 25.6): a taller wall hides the whole tile north of it, loot included.
 */
export const WALL_HEIGHT = 14;

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

  constructor(private readonly scene: Phaser.Scene, readonly map: GameMap) {
    this.drawFloor();
    this.drawWalls();
    this.drawGates();
  }

  /** Shows the closed gates (portcullis walls) or the open-gate floor marking. Cheap to call every frame. */
  setGatesLocked(locked: boolean): void {
    if (locked === this.gatesLocked) return;
    this.gatesLocked = locked;
    for (const g of this.lockedGates) g.setVisible(locked);
    this.openGates?.setVisible(!locked);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.lockedGates.length = 0;
    this.openGates = null;
  }

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
