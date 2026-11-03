// The planned route (RouteState.ahead, the one the minimap draws faintly) drawn ON THE GROUND, so a player steering with WASD can
// follow it: a dashed line along the pathfound polyline, and a cyan circle round every stop that sits on a camp. Both fade as
// the player walks over them (the maths, the timing and the walked-over rule are render/groundRouteModel.ts).
//
// Drawing, cheap by construction (see "Whatever keeps its shape is a baked texture" in CLAUDE.md for why a Graphics redrawn every
// frame is the thing to avoid):
//   - STEADY: one Graphics with every untouched piece in the camera's window. Redrawn only when a piece leaves it (the player
//     walked over it), the route changed, or the camera moved a step: at most once per chunk (200 ms), never per frame.
//   - COHORTS: the pieces the walk reached in one chunk are drawn once into a Graphics of their own, and from then on that
//     Graphics only has its alpha set (fadeAlpha of its age, over 1.2 s). A fading piece is therefore smooth to the frame, with no
//     geometry rebuilt, and it keeps fading if the route is rebuilt under it (a stop was reached). At most six are alive at once
//     and their Graphics are pooled.
//   - Under reduced motion (settings, or the OS) a walked piece just goes at the next chunk: no fade.
// Everything sits at one depth, above the floor and the camp outlines and below the ground fields, the weapon range, every y-sorted
// actor, wall and prop, and the fog.
import type Phaser from "phaser";
import { Y_SCALE, type CampDef, type Vec2 } from "@raid/shared";
import { cameraBox, type Box } from "./mapCull";
import { juiceScale } from "./juice";
import { projX, projY } from "./projection";
import {
  CHUNK_MS, FADE_MS, ChunkClock, GroundRouteModel, fadeAlpha, quantizeWindow,
  type Piece, type RouteGeometry,
} from "./groundRouteModel";

/** Above the floor (-1e6), the gate marks, the container highlight (-4e5) and the camp patience outlines; below the ground fields (-3e5). */
export const GROUND_ROUTE_DEPTH = -3.4e5;
/** The minimap's route colours (ui/mapPainter.ts COLOR_ROUTE and COLOR_OUTLINE), so the two read as one route. */
export const GROUND_ROUTE_COLOR = 0x80deea;
export const GROUND_ROUTE_RIM = 0x0b0e11;
/** Projected pixels. The rim is wider than the line so it shows as a dark edge on every zone's ground. */
export const LINE_WIDTH = 3;
export const RIM_WIDTH = 6.5;
const LINE_ALPHA = 0.92;
const RIM_ALPHA = 0.7;
/** A ring's soft tint over the clearing it marks. */
const RING_TINT_ALPHA = 0.1;

export interface GroundRouteFrame {
  /** performance.now(). */
  now: number;
  /** Drawn at all: the run is on, the local player alive, "Show route" on, no map screen over the world. */
  show: boolean;
  /** Where the local player is on the ground, or null (dead, not placed): the walked-over check follows it. */
  at: Vec2 | null;
}

export interface GroundRouteOptions {
  /** Whether a walked piece goes at once instead of fading; a test passes its own. Default: the juice "motion" switch is off. */
  reducedMotion?: () => boolean;
}

interface Cohort {
  g: Phaser.GameObjects.Graphics;
  /** When the walk reached its pieces. */
  at: number;
  alpha: number;
}

export class GroundRouteView {
  private readonly model = new GroundRouteModel();
  private readonly clock = new ChunkClock(CHUNK_MS);
  private readonly steady: Phaser.GameObjects.Graphics;
  private readonly cohorts: Cohort[] = [];
  private readonly pool: Phaser.GameObjects.Graphics[] = [];
  private readonly reducedMotion: () => boolean;
  private shown = false;
  /** The steady layer must be redrawn at the next chunk (the route changed, or it was hidden while pieces went). */
  private dirty = true;
  private windowKey = "";
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, options: GroundRouteOptions = {}) {
    this.reducedMotion = options.reducedMotion ?? (() => juiceScale("motion") <= 0);
    this.steady = scene.add.graphics().setDepth(GROUND_ROUTE_DEPTH).setVisible(false);
  }

  /** The map's camps: a stop on one gets its ring. */
  setCamps(camps: readonly CampDef[]): void {
    this.model.setCamps(camps);
    this.dirty = true;
  }

  /**
   * The route still ahead (null or empty clears it). `at` is where the player stands: a stretch of a rebuilt route that is under
   * their feet is gone at once, never shown again for the walk to take away.
   */
  setRoute(route: RouteGeometry | null, at: Vec2 | null = null): void {
    const empty = route === null || (route.points.length === 0 && route.stops.length === 0);
    this.model.setRoute(empty ? null : route, at);
    this.dirty = true;
    this.clock.reset();
  }

  /** A new run: no route, nothing walked, nothing fading. */
  reset(): void {
    this.model.clear();
    for (const c of this.cohorts.splice(0)) this.release(c.g);
    this.steady.clear();
    this.dirty = true;
    this.windowKey = "";
    this.clock.reset();
  }

  /** Once a frame. The walked-over check and every redraw happen in chunks; a frame between two only sets alphas. */
  update(frame: GroundRouteFrame): void {
    if (this.destroyed || !Number.isFinite(frame.now)) return;
    // Coming back from hidden: bring the layers up to date first, so no piece walked over meanwhile shows for a chunk.
    if (frame.show && !this.shown) this.clock.reset();
    if (this.clock.due(frame.now)) this.chunk(frame);
    this.setShown(frame.show);
    if (!this.shown) return;
    for (const c of this.cohorts) {
      const a = fadeAlpha(frame.now - c.at);
      if (a !== c.alpha) { c.alpha = a; c.g.setAlpha(a); }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.steady.destroy();
    for (const c of this.cohorts) c.g.destroy();
    this.cohorts.length = 0;
    for (const g of this.pool) g.destroy();
    this.pool.length = 0;
  }

  // ------------------------------------------------------------------------------------------------------------- chunks

  private chunk(frame: GroundRouteFrame): void {
    // The walk is followed even while the route is hidden (a held map, "Show route" off), so what was walked stays walked.
    const reached = this.model.step(frame.at, frame.now);
    while (this.cohorts.length > 0 && frame.now - this.cohorts[0]!.at >= FADE_MS) this.release(this.cohorts.shift()!.g);
    if (!frame.show) {
      // Nothing is drawn for a hidden route; it is drawn afresh when it comes back.
      this.dirty = true;
      return;
    }
    const reduced = this.reducedMotion();
    if (reduced) for (const c of this.cohorts.splice(0)) this.release(c.g);
    else if (reached.length > 0) this.addCohort(reached, frame.now);
    const window = this.window();
    const key = window ? `${window.x},${window.y},${window.w},${window.h}` : "all";
    if (this.dirty || reached.length > 0 || key !== this.windowKey) {
      this.windowKey = key;
      this.dirty = false;
      drawPieces(this.steady.clear(), this.model.pristine(window));
    }
  }

  private addCohort(pieces: readonly Piece[], now: number): void {
    const g = this.pool.pop() ?? this.scene.add.graphics().setDepth(GROUND_ROUTE_DEPTH);
    drawPieces(g.clear(), pieces);
    g.setAlpha(1).setVisible(this.shown);
    this.cohorts.push({ g, at: now, alpha: 1 });
  }

  private release(g: Phaser.GameObjects.Graphics): void {
    g.clear().setVisible(false);
    this.pool.push(g);
  }

  private setShown(show: boolean): void {
    if (show === this.shown) return;
    this.shown = show;
    this.steady.setVisible(show);
    for (const c of this.cohorts) c.g.setVisible(show);
  }

  /** The camera's box in projected pixels, snapped to a grid so the steady layer is rebuilt only when the camera has moved a step. */
  private window(): Box | null {
    const cam = this.scene.cameras?.main;
    const view = cam ? cameraBox(cam.scrollX, cam.scrollY, cam.width, cam.height, cam.zoom) : null;
    return view ? quantizeWindow(view) : null;
  }
}

/** Draws pieces into a cleared Graphics: the rings' tint, then every dark rim, then every cyan stroke. */
export function drawPieces(g: Phaser.GameObjects.Graphics, pieces: readonly Piece[]): void {
  if (pieces.length === 0) return;
  g.fillStyle(GROUND_ROUTE_COLOR, RING_TINT_ALPHA);
  for (const p of pieces) if (p.kind === "ring") g.fillEllipse(projX(p.x), projY(p.y), 2 * p.radius, 2 * p.radius * Y_SCALE);
  for (const [width, color, alpha] of [[RIM_WIDTH, GROUND_ROUTE_RIM, RIM_ALPHA], [LINE_WIDTH, GROUND_ROUTE_COLOR, LINE_ALPHA]] as const) {
    g.lineStyle(width, color, alpha);
    for (const p of pieces) {
      if (p.kind === "ring") {
        g.strokeEllipse(projX(p.x), projY(p.y), 2 * p.radius, 2 * p.radius * Y_SCALE);
        continue;
      }
      g.beginPath();
      g.moveTo(projX(p.pts[0]!), projY(p.pts[1]!));
      for (let i = 2; i < p.pts.length; i += 2) g.lineTo(projX(p.pts[i]!), projY(p.pts[i + 1]!));
      g.strokePath();
    }
  }
}
