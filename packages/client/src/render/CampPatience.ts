// The ground outline of a camp's chase limit. A camp's mobs share territory, but each has a
// separate leash centred on its own rest spot. The outline is the union of those leashes,
// sampled at tile centres; this keeps it aligned with the server's territory and range rules.
import type Phaser from "phaser";
import { leashOk, TILE, type GameMap } from "@raid/shared";
import { boxesOverlap, cameraBox, type Box } from "./mapCull";
import { projX, projY } from "./projection";
import { dashSpans } from "./zoneEdges";

export interface PatienceOutline {
  /** World tile-edge coordinates, four numbers per segment. */
  segments: number[];
  /** Projected bounds for camera culling. */
  box: Box;
}

/** Boundary of every place at least one member of this camp can chase to. */
export function campPatienceOutline(map: GameMap, campIndex: number): PatienceOutline | null {
  const camp = map.camps[campIndex];
  if (!camp || camp.area <= 0 || camp.spots.length === 0) return null;
  const ref = campIndex + 1;
  const { w, h } = map;
  const inside = new Uint8Array(w * h);
  let minTx = w, minTy = h, maxTx = -1, maxTy = -1;
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    const i = ty * w + tx;
    if (map.territoryGrid[i] !== ref) continue;
    const at = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    if (!camp.spots.some(home => leashOk(map, ref, home, at))) continue;
    inside[i] = 1;
    minTx = Math.min(minTx, tx); minTy = Math.min(minTy, ty);
    maxTx = Math.max(maxTx, tx); maxTy = Math.max(maxTy, ty);
  }
  if (maxTx < 0) return null;

  const segments: number[] = [];
  const has = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < w && ty < h && inside[ty * w + tx] === 1;
  for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++) {
    if (!has(tx, ty)) continue;
    const x0 = tx * TILE, x1 = (tx + 1) * TILE, y0 = ty * TILE, y1 = (ty + 1) * TILE;
    if (!has(tx - 1, ty)) segments.push(x0, y0, x0, y1);
    if (!has(tx + 1, ty)) segments.push(x1, y0, x1, y1);
    if (!has(tx, ty - 1)) segments.push(x0, y0, x1, y0);
    if (!has(tx, ty + 1)) segments.push(x0, y1, x1, y1);
  }
  return {
    segments,
    box: { x: projX(minTx * TILE), y: projY(minTy * TILE), w: (maxTx - minTx + 1) * TILE,
      h: projY((maxTy + 1) * TILE) - projY(minTy * TILE) },
  };
}

interface Mark { line: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; box: Box }

export class CampPatienceView {
  private readonly marks: Array<Mark | null> = [];
  constructor(private readonly scene: Phaser.Scene, map: GameMap) {
    for (let i = 0; i < map.camps.length; i++) {
      const outline = campPatienceOutline(map, i);
      if (!outline) { this.marks.push(null); continue; }
      const line = scene.add.graphics().setDepth(-480000).setVisible(false);
      // A dark rim keeps the faint cyan dashes visible on both light terrain and dark ground.
      line.lineStyle(3, 0x09242a, 0.72);
      for (let j = 0; j < outline.segments.length; j += 4) {
        line.lineBetween(projX(outline.segments[j]!), projY(outline.segments[j + 1]!),
          projX(outline.segments[j + 2]!), projY(outline.segments[j + 3]!));
      }
      line.lineStyle(1.5, 0x8feef0, 0.82);
      for (let j = 0; j < outline.segments.length; j += 4) {
        const x0 = projX(outline.segments[j]!), y0 = projY(outline.segments[j + 1]!);
        const x1 = projX(outline.segments[j + 2]!), y1 = projY(outline.segments[j + 3]!);
        const vertical = x0 === x1;
        for (const [a, b] of dashSpans(vertical ? y0 : x0, vertical ? y1 : x1, [9, 7])) {
          if (vertical) line.lineBetween(x0, a, x0, b);
          else line.lineBetween(a, y0, b, y0);
        }
      }
      const camp = map.camps[i]!;
      const label = scene.add.text(projX(camp.x), projY(camp.y) + 25, "PATIENCE RANGE", {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "10px", color: "#a9f4f5",
        stroke: "#081a20", strokeThickness: 3,
      }).setOrigin(0.5, 0.5).setDepth(-479999).setVisible(false);
      this.marks.push({ line, label, box: outline.box });
    }
  }

  /** Cleared camps have no chase range until their mobs respawn. */
  update(camps: ArrayLike<{ alive: number }> | undefined, active: boolean): void {
    const cam = this.scene.cameras?.main;
    const view = cam ? cameraBox(cam.scrollX, cam.scrollY, cam.width, cam.height, cam.zoom) : null;
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i];
      if (!mark) continue;
      const show = active && (camps?.[i]?.alive ?? 0) > 0 && (view === null || boxesOverlap(mark.box, view));
      mark.line.setVisible(show);
      mark.label.setVisible(show);
    }
  }

  destroy(): void {
    for (const mark of this.marks) { mark?.line.destroy(); mark?.label.destroy(); }
    this.marks.length = 0;
  }
}
