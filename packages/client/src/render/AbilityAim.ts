// The aim preview of an ability that is placed in the world (AbilityDef.aim "preview": Frost Wall). While the player holds it
// up (R toggles it, a left click deploys it), this draws, translucent, exactly where it would land: its range round the caster,
// and the tiles the server's own rule (shared/barriers.ts) would turn to ice from the caster's predicted position toward the
// cursor, clamped to the range. Presentation only: the cast still carries just the cursor point, and the server decides.
import Phaser from "phaser";
import {
  rankOf, TILE, Y_SCALE, wallCells, wallSegmentFor, type AbilityDef, type GameMap, type Vec2, type WallSegment,
} from "@raid/shared";
import { projX, projY } from "./projection";

/** What the preview would place, from the shared rules alone (no Phaser): the wall's line and its tiles on `map`. */
export interface AimPlan {
  seg: WallSegment;
  cells: number[];
  range: number;
}

/** The plan of `def` aimed from `from` at `cursor` on `map`, or null when the ability is not a placed one. */
export function aimPlan(def: AbilityDef, rank: number, map: GameMap, from: Vec2, cursor: Vec2, facing = 0): AimPlan | null {
  const r = rankOf(def, rank);
  const t = r.targeting;
  if (t.kind !== "point" || r.shape.kind !== "wall") return null;
  const seg = wallSegmentFor(from, cursor, t.range, t.minRange, r.shape.length, facing);
  return { seg, cells: wallCells(map, seg), range: t.range };
}

/** Over the ground and the fighters' shadows, under the HUD's world marks. */
const DEPTH_AIM = 9e5;
const LIFT = 20;

export class AbilityAim {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH_AIM).setVisible(false);
  }

  /** Draws `plan` for a caster at `from` in `color`, pulsing gently with `now` unless motion is off. */
  draw(plan: AimPlan, from: Vec2, map: GameMap, color: number, now: number, moves: boolean): void {
    const g = this.g.clear().setVisible(true);
    const pulse = moves ? 0.5 + 0.5 * Math.sin(now * 0.008) : 0.5;
    // The reach: a ring on the ground round the caster.
    g.lineStyle(1.5, color, 0.35).strokeEllipse(projX(from.x), projY(from.y), plan.range * 2, plan.range * 2 * Y_SCALE);
    const ok = plan.cells.length > 0;
    const tint = ok ? color : 0xef5350;
    const h = TILE * Y_SCALE;
    for (const i of plan.cells) {
      const x = (i % map.w) * TILE;
      const y = Math.floor(i / map.w) * TILE;
      const top = projY(y, LIFT);
      g.fillStyle(tint, 0.18 + 0.1 * pulse).fillRect(projX(x), top, TILE, h + LIFT);
      g.lineStyle(1, 0xffffff, 0.35 + 0.2 * pulse).strokeRect(projX(x) + 0.5, top + 0.5, TILE - 1, h + LIFT - 1);
    }
    // The wall's line and where it is centred, so a wall that finds no floor (aimed into rock) still shows where it was meant.
    const s = plan.seg;
    g.lineStyle(2, tint, 0.55).lineBetween(projX(s.x1), projY(s.y1), projX(s.x2), projY(s.y2));
    g.fillStyle(tint, 0.8).fillCircle(projX(s.cx), projY(s.cy), 3);
  }

  hide(): void {
    this.g.clear().setVisible(false);
  }

  destroy(): void {
    this.g.destroy();
  }
}
