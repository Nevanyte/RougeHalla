// Puts a fighter's FigurePose on its display objects. PlayerView and MobView build one over the parts that make up the
// figure (body disc, skin core, weapon, rings); the shadow, hp bar and name stay put, so only the body seems to move.
import { PLAYER_RADIUS } from "@raid/shared";
import type { FighterArt } from "./FighterArt";
import { FigurePose, type Pose } from "./figurePose";
import { juiceScale } from "./juice";
import { BODY_LIFT } from "./projection";

/** The little Phaser surface a part needs; any game object with a transform has it. */
export interface PoseTarget {
  setPosition(x?: number, y?: number): unknown;
  setScale(x?: number, y?: number): unknown;
}

/**
 * One piece of the figure and where it rests (`y0`, its y in the view's container).
 * `scaled`: it squashes with the figure (a disc, or a graphics drawn around the body); otherwise it only follows the
 * body's centre (the weapon in hand, which turns on its own axis and would shear if scaled, and the aura layer).
 */
export interface PosePart {
  obj: PoseTarget;
  y0: number;
  scaled: boolean;
}

/** Where dust puffs go (FxView): `a` is the ground angle they drift toward. */
export interface DustSink {
  dust(x: number, y: number, a: number, n: number, now: number): void;
}

/** The squash is about the bottom of the body disc: it grows up from, and sinks toward, where it stands. */
const PIVOT_Y = -BODY_LIFT + PLAYER_RADIUS;
const EPS_PX = 0.01;
const EPS_SCALE = 0.001;

const atRest = (p: Pose): boolean => p.ox === 0 && p.oy === 0 && p.sx === 1 && p.sy === 1;

export class FigureJuice {
  readonly pose = new FigurePose();
  /** What the parts are set to now, so an unchanged pose costs no calls at all. */
  private readonly applied: Pose = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };

  constructor(
    private readonly parts: readonly PosePart[],
    private readonly art: FighterArt,
    private readonly puffs?: DustSink,
  ) {}

  /**
   * Once per frame, before the art is updated: `x`, `y` where the fighter is drawn, `renderT` the time that is drawn at,
   * `facing` its ground angle. Tracks the walk (dust on a start or a stop), then poses the figure.
   */
  frame(x: number, y: number, facing: number, renderT: number, now: number): void {
    const m = juiceScale("motion");
    const event = this.pose.track(x, y, renderT, now);
    if (event !== null && m > 0 && this.puffs) {
      // Kicked up behind a start, rolling on ahead of a stop.
      if (event === "start") this.puffs.dust(x, y, this.pose.moveAngle + Math.PI, 2, now);
      else this.puffs.dust(x, y, this.pose.moveAngle, 3, now);
    }
    const p = this.pose.sample(now, m, this.art.pull, facing);
    this.art.poseRot = p.rot;
    this.art.setCharge(this.pose.charge * juiceScale("flash"));
    this.apply(p);
  }

  /** The fighter is out of sight: drop every cue so none carries over. */
  reset(): void {
    this.pose.reset();
  }

  private apply(p: Pose): void {
    const a = this.applied;
    const differs = Math.abs(p.ox - a.ox) > EPS_PX || Math.abs(p.oy - a.oy) > EPS_PX
      || Math.abs(p.sx - a.sx) > EPS_SCALE || Math.abs(p.sy - a.sy) > EPS_SCALE;
    // A pose that settled on rest must reach it exactly, however small the last step was.
    if (!differs && !(atRest(p) && !atRest(a))) return;
    a.ox = p.ox;
    a.oy = p.oy;
    a.sx = p.sx;
    a.sy = p.sy;
    const lift = PLAYER_RADIUS * (1 - p.sy);
    for (const part of this.parts) {
      if (part.scaled) {
        part.obj.setPosition(p.ox, PIVOT_Y * (1 - p.sy) + part.y0 * p.sy + p.oy);
        part.obj.setScale(p.sx, p.sy);
      } else {
        part.obj.setPosition(p.ox, part.y0 + lift + p.oy);
      }
    }
  }
}
