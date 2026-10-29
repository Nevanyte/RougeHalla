// The local weapon's maximum reach, drawn on the ground. Reads no enemy or fog data.
import type Phaser from "phaser";
import { ARROW_RADIUS, FISTS, isWeaponId, PLAYER_RADIUS, WEAPONS, Y_SCALE, type Vec2, type WeaponId } from "@raid/shared";
import { projX, projY } from "./projection";

/** Above ground fields, below every y-sorted actor, wall and the vision fog. */
export const WEAPON_RANGE_DEPTH = -2.9e5;
export const WEAPON_RANGE_COLOR = 0xb6e6ef;
const TAU = Math.PI * 2;
const CIRCLE_STEPS = 64;

export interface WeaponRangeGeometry {
  kind: "arc" | "lane" | "circle";
  range: number;
  /** Local ground-plane coordinates. Projection happens only when the Graphics path is drawn. */
  points: readonly Vec2[];
}

/** Matches the weapon catalog; the bow lane includes the server's body/projectile collision tolerance. */
export function weaponRangeGeometry(weapon: WeaponId, aim = 0): WeaponRangeGeometry {
  const shape = WEAPONS[weapon].shape;
  const a = Number.isFinite(aim) ? aim : 0;
  if (shape.kind === "arc") {
    const points: Vec2[] = [{ x: 0, y: 0 }];
    const steps = Math.max(12, Math.ceil(shape.halfArc * 2 / TAU * CIRCLE_STEPS));
    for (let i = 0; i <= steps; i++) {
      const angle = a - shape.halfArc + shape.halfArc * 2 * i / steps;
      points.push({ x: Math.cos(angle) * shape.reach, y: Math.sin(angle) * shape.reach });
    }
    return { kind: "arc", range: shape.reach, points };
  }
  if (shape.projectile === "ball") {
    return { kind: "circle", range: shape.range, points: Array.from({ length: CIRCLE_STEPS }, (_, i) => ({
      x: Math.cos(i / CIRCLE_STEPS * TAU) * shape.range, y: Math.sin(i / CIRCLE_STEPS * TAU) * shape.range,
    })) };
  }
  const cos = Math.cos(a), sin = Math.sin(a);
  const hitReach = PLAYER_RADIUS + ARROW_RADIUS;
  return { kind: "lane", range: shape.range, points: [
    { x: 0, y: -hitReach }, { x: shape.range, y: -hitReach },
    { x: shape.range, y: hitReach }, { x: 0, y: hitReach },
  ].map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })) };
}

export interface WeaponRangeFrame {
  phase: string;
  me?: { status: string; weapon0: string; weapon1: string; slot: number; facing: number };
  /** The local fighter's drawn/predicted ground position. */
  at?: Vec2;
  /** Current cursor aim, or the fighter's facing when the cursor is over UI. */
  aim?: number | null;
  hidden?: boolean;
}

export class WeaponRangeView {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private signature = "";
  private shown = false;
  private x = NaN;
  private y = NaN;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(WEAPON_RANGE_DEPTH).setVisible(false);
  }

  update(frame: WeaponRangeFrame): void {
    const { me, at } = frame;
    const id = me?.slot === 1 ? me.weapon1 : me?.weapon0;
    const weapon = id === "" ? FISTS : isWeaponId(id) ? id : null;
    if (frame.hidden || frame.phase !== "active" || me?.status !== "alive" || !at || !Number.isFinite(at.x + at.y) || !weapon) {
      if (this.shown) this.graphics.setVisible(false);
      this.shown = false;
      return;
    }
    if (!this.shown) this.graphics.setVisible(true);
    this.shown = true;
    if (at.x !== this.x || at.y !== this.y) {
      this.x = at.x; this.y = at.y; this.graphics.setPosition(projX(at.x), projY(at.y));
    }
    const angle = Number.isFinite(frame.aim) ? frame.aim! : Number.isFinite(me.facing) ? me.facing : 0;
    const aim = WEAPONS[weapon].shape.kind === "projectile" && WEAPONS[weapon].shape.projectile === "ball" ? 0 : Math.atan2(Math.sin(angle), Math.cos(angle));
    const signature = `${weapon}|${aim}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const geometry = weaponRangeGeometry(weapon, aim), points = geometry.points;
    const g = this.graphics.clear().beginPath().moveTo(points[0]!.x, points[0]!.y * Y_SCALE);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i]!.x, points[i]!.y * Y_SCALE);
    g.closePath().fillStyle(WEAPON_RANGE_COLOR, geometry.kind === "circle" ? .018 : .04).fillPath();
    g.lineStyle(6, WEAPON_RANGE_COLOR, .055).strokePath();
    g.lineStyle(1, WEAPON_RANGE_COLOR, .23).strokePath();
  }

  destroy(): void { this.graphics.destroy(); }
}
