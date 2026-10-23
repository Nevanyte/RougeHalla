// The raid's shrinking safe zone, drawn in projected space: a tint over everything outside the current circle, the
// current boundary, and a dashed preview of the circle it is closing to. One Graphics, rebuilt only when the zone
// state changes (every tick while shrinking, never during a hold).
import Phaser from "phaser";
import { WORLD_H, WORLD_W, Y_SCALE } from "@raid/shared";
import type { ZoneState } from "@raid/shared/schema";
import { projX, projY } from "./projection";

/**
 * Above every y-sorted entity (ground y is a few thousand at most) so the tint covers players and walls, but below
 * FxView (8e5) and the click marker (1e6): tracers and hit flashes stay crisp.
 */
export const DEPTH_ZONE_VIEW = 7e5;

const COLOR_TINT = 0xc62828;
const ALPHA_TINT = 0.26;
const COLOR_EDGE = 0xff5252;
const COLOR_EDGE_GLOW = 0xff1744;
const COLOR_NEXT = 0xffffff;

/** Vertices of the polygon standing in for each ellipse. Chords stay under ~1 px of sagitta up to r ≈ 2200. */
const SEGMENTS = 96;
const COS = new Float64Array(SEGMENTS);
const SIN = new Float64Array(SEGMENTS);
for (let i = 0; i < SEGMENTS; i++) {
  const a = (i / SEGMENTS) * Math.PI * 2;
  COS[i] = Math.cos(a);
  SIN[i] = Math.sin(a);
}

/**
 * The tint is one polygon: a rectangle around the world with the zone cut out of it. Wider than any screen can see
 * past the map edge, so the dark void beyond the walls is tinted too.
 */
const OUTER_MARGIN = 4096;
const OUTER_LEFT = -OUTER_MARGIN;
const OUTER_TOP = -OUTER_MARGIN;
const OUTER_RIGHT = WORLD_W + OUTER_MARGIN;
const OUTER_BOTTOM = WORLD_H * Y_SCALE + OUTER_MARGIN;

/** Dashes of the next circle: about one dash-and-gap per DASH_PERIOD px of circumference, within these bounds. */
const DASH_PERIOD = 36;
const DASH_MIN = 24;
const DASH_MAX = 72;
const DASH_FILL = 0.55;

export class ZoneView {
  private readonly g: Phaser.GameObjects.Graphics;
  /** The state the Graphics currently shows; `shown` is false while nothing is drawn (stage 0). */
  private shown = false;
  private x = 0;
  private y = 0;
  private r = 0;
  private nextX = 0;
  private nextY = 0;
  private nextR = 0;
  /** Scratch for the current ellipse's vertices, reused by every redraw. */
  private readonly px = new Float64Array(SEGMENTS);
  private readonly py = new Float64Array(SEGMENTS);

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH_ZONE_VIEW).setVisible(false);
  }

  update(zone: ZoneState | undefined): void {
    if (!zone || zone.stage === 0) {
      if (this.shown) { this.g.clear().setVisible(false); this.shown = false; }
      return;
    }
    if (
      this.shown && zone.x === this.x && zone.y === this.y && zone.r === this.r
      && zone.nextX === this.nextX && zone.nextY === this.nextY && zone.nextR === this.nextR
    ) return;
    this.x = zone.x;
    this.y = zone.y;
    this.r = zone.r;
    this.nextX = zone.nextX;
    this.nextY = zone.nextY;
    this.nextR = zone.nextR;
    this.shown = true;
    this.redraw();
  }

  destroy(): void {
    this.g.destroy();
  }

  private redraw(): void {
    const g = this.g;
    g.clear().setVisible(true);

    const cx = projX(this.x);
    const cy = projY(this.y);
    const rx = Math.max(this.r, 1);
    const ry = rx * Y_SCALE;
    this.fillVertices(cx, cy, rx, ry);

    this.drawTint(cx, cy, rx, ry);
    if (this.nextR > 0) this.drawNext();

    // A soft wide line under a bright narrow one reads on both the tinted and the clear side.
    g.lineStyle(9, COLOR_EDGE_GLOW, 0.22);
    this.traceRing();
    g.strokePath();
    g.lineStyle(3, COLOR_EDGE, 1);
    this.traceRing();
    g.strokePath();
  }

  private fillVertices(cx: number, cy: number, rx: number, ry: number): void {
    for (let i = 0; i < SEGMENTS; i++) {
      this.px[i] = cx + rx * COS[i];
      this.py[i] = cy + ry * SIN[i];
    }
  }

  /**
   * Fills the rectangle minus the zone as a single keyhole polygon: out along a bridge to the ring, once round it
   * the opposite way to the rectangle, and back along the same bridge. Phaser triangulates a path in one pass, so
   * this costs one earcut per frame, and unlike a very wide translucent stroke no triangle overlaps another (which
   * would blend twice and show seams).
   */
  private drawTint(cx: number, cy: number, rx: number, ry: number): void {
    // A zone big enough to leave the rectangle would make the cut-out cross its edge; nothing visible is outside it.
    if (cx - rx <= OUTER_LEFT || cx + rx >= OUTER_RIGHT || cy - ry <= OUTER_TOP || cy + ry >= OUTER_BOTTOM) return;
    const { g, px, py } = this;

    // Bridge to the ring vertex nearest the rectangle's first corner: the nearest point of a convex shape is always
    // visible from outside it, so the bridge never crosses the ring.
    let k = 0;
    let best = Infinity;
    for (let i = 0; i < SEGMENTS; i++) {
      const d = (px[i] - OUTER_LEFT) ** 2 + (py[i] - OUTER_TOP) ** 2;
      if (d < best) { best = d; k = i; }
    }

    g.fillStyle(COLOR_TINT, ALPHA_TINT);
    g.beginPath();
    g.moveTo(OUTER_LEFT, OUTER_TOP);
    g.lineTo(OUTER_RIGHT, OUTER_TOP);
    g.lineTo(OUTER_RIGHT, OUTER_BOTTOM);
    g.lineTo(OUTER_LEFT, OUTER_BOTTOM);
    g.lineTo(OUTER_LEFT, OUTER_TOP);
    g.lineTo(px[k], py[k]);
    // Ring vertices run clockwise on screen, like the rectangle above, so the cut-out walks them backwards.
    for (let j = 1; j <= SEGMENTS; j++) {
      const i = (k - j + SEGMENTS) % SEGMENTS;
      g.lineTo(px[i], py[i]);
    }
    g.lineTo(OUTER_LEFT, OUTER_TOP);
    g.fillPath();
  }

  /** Starts a new path along the current ring's vertices, closed; the caller sets the line style and strokes it. */
  private traceRing(): void {
    const { g, px, py } = this;
    g.beginPath();
    g.moveTo(px[0], py[0]);
    for (let i = 1; i < SEGMENTS; i++) g.lineTo(px[i], py[i]);
    g.closePath();
  }

  /** The circle the zone is closing to: thin, light, dashed (short two-point strokes, one sub-path each). */
  private drawNext(): void {
    const g = this.g;
    const cx = projX(this.nextX);
    const cy = projY(this.nextY);
    const rx = this.nextR;
    const ry = rx * Y_SCALE;
    const dashes = Math.min(DASH_MAX, Math.max(DASH_MIN, Math.round((Math.PI * 2 * rx) / DASH_PERIOD)));
    const step = (Math.PI * 2) / dashes;
    const span = step * DASH_FILL;
    g.lineStyle(2, COLOR_NEXT, 0.75);
    g.beginPath();
    for (let i = 0; i < dashes; i++) {
      const a0 = i * step;
      const a1 = a0 + span;
      g.moveTo(cx + rx * Math.cos(a0), cy + ry * Math.sin(a0));
      g.lineTo(cx + rx * Math.cos(a1), cy + ry * Math.sin(a1));
    }
    g.strokePath();
  }
}
