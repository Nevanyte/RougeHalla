// Sectors on the ground plane, as the server's swing and block cones (shared inArc): the points are projected one by
// one, so a half circle reads as a flattened half ellipse instead of a rotated screen-space arc.
import type Phaser from "phaser";
import { Y_SCALE } from "@raid/shared";

const SECTOR_STEPS = 14;

/** Starts a new path along the pie slice of radius `reach` around ground angle `a`, apex at screen (cx, cy). */
export function traceSector(g: Phaser.GameObjects.Graphics, cx: number, cy: number, reach: number, a: number, halfArc: number): void {
  g.beginPath();
  g.moveTo(cx, cy);
  for (let i = 0; i <= SECTOR_STEPS; i++) {
    const th = a - halfArc + (2 * halfArc * i) / SECTOR_STEPS;
    g.lineTo(cx + Math.cos(th) * reach, cy + Math.sin(th) * reach * Y_SCALE);
  }
  g.closePath();
}

/** Starts a new path along only the outer rim of that slice. */
export function traceRim(g: Phaser.GameObjects.Graphics, cx: number, cy: number, reach: number, a: number, halfArc: number): void {
  g.beginPath();
  for (let i = 0; i <= SECTOR_STEPS; i++) {
    const th = a - halfArc + (2 * halfArc * i) / SECTOR_STEPS;
    const x = cx + Math.cos(th) * reach;
    const y = cy + Math.sin(th) * reach * Y_SCALE;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}
