// Top-right minimap: a plain top-down view of the whole map. The region tints and walls are painted once per map onto an
// offscreen canvas; the closed gates and the local player are repainted on top at a low rate, and only when one of them
// changed.
import { REGION_IDS, TILE, WORLD_H, WORLD_W, isWallTile, type GameMap, type RegionId } from "@raid/shared";
import { el, uiRoot } from "./dom";

/** CSS pixels; style.css sizes the element to match. */
const SIZE = 150;
/** Repaint cadence ceiling (ms): ~10 Hz is plenty for a 150 px map. */
const REPAINT_MS = 100;

const COLOR_BG = "rgba(20, 24, 30, 0.8)";
const COLOR_WALL = "#9aa3ad";
/** Faction colours at low alpha, under the walls; "none" is left as the background. */
const COLOR_REGION: Record<RegionId, string | null> = {
  none: null,
  fire: "rgba(255, 112, 67, 0.22)",
  sentenced: "rgba(149, 117, 205, 0.22)",
  plague: "rgba(156, 204, 101, 0.22)",
  frost: "rgba(79, 195, 247, 0.22)",
  holy: "rgba(255, 241, 118, 0.22)",
  coliseum: "rgba(200, 180, 138, 0.3)",
};
/** Closed gates only; open ones are just a gap in the coliseum ring. */
const COLOR_GATE = "#f44336";
const COLOR_PLAYER = "#69f0ae";
const COLOR_PLAYER_DOWN = "#78909c";

const TAU = Math.PI * 2;

/** Where the local player is, in world units. */
export interface MinimapPlayer { x: number; y: number }

export class Minimap {
  private readonly canvas = el("canvas", "minimap");
  private readonly ctx = this.canvas.getContext("2d");
  /** Region tints and walls. A separate canvas so a repaint is one drawImage instead of a few thousand fillRects. */
  private readonly layer = document.createElement("canvas");
  /** Backing-store pixels per world unit, and per CSS pixel. */
  private readonly k: number;
  private readonly px: number;
  private lastPaint = -Infinity;
  /**
   * Inputs of the last paint: player x, y (backing pixels); alive; gates locked.
   * An update whose inputs all match skips the repaint.
   */
  private readonly last = new Float64Array(4).fill(NaN);
  private readonly now = new Float64Array(4);
  private hasMap = false;
  private gatesLocked = false;
  /** Gate tiles as x, y, w, h in backing pixels (flat), precomputed per map. */
  private gateRects: number[] = [];

  constructor() {
    const size = Math.round(SIZE * Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = size;
    this.canvas.height = size;
    this.layer.width = size;
    this.layer.height = size;
    this.px = size / SIZE;
    // The canvas is square; a non-square world would simply leave the short side empty.
    this.k = size / Math.max(WORLD_W, WORLD_H);
    uiRoot().append(this.canvas);
  }

  /** Whether the coliseum gates are drawn closed; takes effect at the next update(). Cheap to call every frame. */
  setGatesLocked(locked: boolean): void {
    this.gatesLocked = locked;
  }

  /** Repaints the static layer for a (new) map; the next update() paints it regardless of the throttle. */
  setMap(map: GameMap): void {
    const g = this.layer.getContext("2d");
    if (!g) return;
    const w = this.layer.width;
    const h = this.layer.height;
    const tile = TILE * this.k;
    g.clearRect(0, 0, w, h);
    g.fillStyle = COLOR_BG;
    g.fillRect(0, 0, w, h);

    // Region tints first, so the walls stay readable on top. Edges are rounded to the nearest pixel (not outward) so
    // neighbouring runs share them exactly: translucent fills would otherwise double up on the overlap.
    const codes = map.regionGrid;
    for (let ty = 0; ty < map.h; ty++) {
      const top = Math.round(ty * tile);
      const bottom = Math.round((ty + 1) * tile);
      let start = 0;
      for (let tx = 1; tx <= map.w; tx++) {
        if (tx < map.w && codes[ty * map.w + tx] === codes[ty * map.w + start]) continue;
        const color = COLOR_REGION[REGION_IDS[codes[ty * map.w + start]] ?? "none"];
        if (color) {
          const left = Math.round(start * tile);
          g.fillStyle = color;
          g.fillRect(left, top, Math.round(tx * tile) - left, bottom - top);
        }
        start = tx;
      }
    }

    // Horizontal runs of wall tiles per row; edges are rounded outward so neighbouring rows leave no hairline gaps.
    g.fillStyle = COLOR_WALL;
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

    this.gateRects = [];
    for (const gate of map.coliseum.gates) {
      for (const t of gate.tiles) {
        const left = Math.floor(t.x * tile);
        const top = Math.floor(t.y * tile);
        this.gateRects.push(left, top, Math.ceil((t.x + 1) * tile) - left, Math.ceil((t.y + 1) * tile) - top);
      }
    }

    this.hasMap = true;
    this.lastPaint = -Infinity;
    this.last.fill(NaN);
  }

  /**
   * Call every frame; it paints at most every REPAINT_MS and only if something it shows moved.
   * `alive` only picks the dot's colour (a downed player's last position stays on the map).
   */
  update(now: number, player: MinimapPlayer | undefined, alive: boolean): void {
    if (!this.hasMap || !this.ctx || now - this.lastPaint < REPAINT_MS) return;
    const k = this.k;
    const cur = this.now;
    // Quantised to backing pixels: a sub-pixel step would repaint an identical image.
    cur[0] = player ? Math.round(player.x * k) : NaN;
    cur[1] = player ? Math.round(player.y * k) : NaN;
    cur[2] = alive ? 1 : 0;
    cur[3] = this.gatesLocked ? 1 : 0;
    this.lastPaint = now;
    if (this.sameAsLast()) return;
    this.last.set(cur);
    this.paint(player, alive);
  }

  destroy(): void {
    this.canvas.remove();
    // Releases the offscreen bitmap's memory right away rather than at the next collection.
    this.layer.width = 0;
    this.layer.height = 0;
  }

  /** NaN fields count as equal to NaN (an absent player), unlike `===`. */
  private sameAsLast(): boolean {
    for (let i = 0; i < this.now.length; i++) {
      const a = this.now[i];
      const b = this.last[i];
      if (a !== b && !(a !== a && b !== b)) return false;
    }
    return true;
  }

  private paint(player: MinimapPlayer | undefined, alive: boolean): void {
    const c = this.ctx;
    if (!c) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const { k, px } = this;
    c.clearRect(0, 0, w, h);
    c.drawImage(this.layer, 0, 0);

    if (this.gatesLocked) {
      c.fillStyle = COLOR_GATE;
      const r = this.gateRects;
      for (let i = 0; i < r.length; i += 4) c.fillRect(r[i], r[i + 1], r[i + 2], r[i + 3]);
    }

    if (player) {
      c.fillStyle = alive ? COLOR_PLAYER : COLOR_PLAYER_DOWN;
      c.strokeStyle = "#0b0e11";
      c.lineWidth = px;
      c.beginPath();
      c.arc(player.x * k, player.y * k, 2.6 * px, 0, TAU);
      c.fill();
      c.stroke();
    }
  }
}
