// A Pen (render/zoneArt/zoneStyle.ts) that records every call and the polylines drawn between beginPath and strokePath/fillPath,
// for judging what the zone art paints without a Graphics.
import type { Pen } from "../src/render/zoneArt/zoneStyle";

export type Pt = readonly [number, number];
export interface Op { name: string; args: number[] }

/** A Pen that records every call and the polylines drawn between beginPath and strokePath/fillPath. */
export class RecordPen implements Pen {
  readonly ops: Op[] = [];
  readonly paths: Pt[][] = [];
  private current: Pt[] | null = null;
  private rec(name: string, args: number[]): this {
    this.ops.push({ name, args });
    return this;
  }
  fillStyle(color: number, alpha = 1): this { return this.rec("fillStyle", [color, alpha]); }
  lineStyle(width: number, color: number, alpha = 1): this { return this.rec("lineStyle", [width, color, alpha]); }
  fillRect(x: number, y: number, w: number, h: number): this { return this.rec("fillRect", [x, y, w, h]); }
  strokeRect(x: number, y: number, w: number, h: number): this { return this.rec("strokeRect", [x, y, w, h]); }
  fillRoundedRect(x: number, y: number, w: number, h: number): this { return this.rec("fillRect", [x, y, w, h]); }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this { return this.rec("lineBetween", [x1, y1, x2, y2]); }
  fillCircle(x: number, y: number, r: number): this { return this.rec("fillCircle", [x, y, r]); }
  strokeCircle(x: number, y: number, r: number): this { return this.rec("strokeCircle", [x, y, r]); }
  fillEllipse(x: number, y: number, w: number, h: number): this { return this.rec("fillEllipse", [x, y, w, h]); }
  strokeEllipse(x: number, y: number, w: number, h: number): this { return this.rec("strokeEllipse", [x, y, w, h]); }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this { return this.rec("fillTriangle", [x1, y1, x2, y2, x3, y3]); }
  beginPath(): this { this.current = []; this.paths.push(this.current); return this.rec("beginPath", []); }
  moveTo(x: number, y: number): this { this.current?.push([x, y]); return this.rec("moveTo", [x, y]); }
  lineTo(x: number, y: number): this { this.current?.push([x, y]); return this.rec("lineTo", [x, y]); }
  closePath(): this { return this.rec("closePath", []); }
  fillPath(): this { return this.rec("fillPath", []); }
  strokePath(): this { return this.rec("strokePath", []); }

  count(name: string): number { return this.ops.filter((o) => o.name === name).length; }
  of(name: string): number[][] { return this.ops.filter((o) => o.name === name).map((o) => o.args); }
  /** Every point the pen reached, as [x, y] and a padding radius for shapes. */
  extents(): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    for (const o of this.ops) {
      const a = o.args;
      if (o.name === "fillRect" || o.name === "strokeRect") out.push([a[0]!, a[1]!, a[0]! + a[2]!, a[1]! + a[3]!]);
      else if (o.name === "lineBetween") out.push([Math.min(a[0]!, a[2]!), Math.min(a[1]!, a[3]!), Math.max(a[0]!, a[2]!), Math.max(a[1]!, a[3]!)]);
      else if (o.name === "fillCircle" || o.name === "strokeCircle") out.push([a[0]! - a[2]!, a[1]! - a[2]!, a[0]! + a[2]!, a[1]! + a[2]!]);
      else if (o.name === "fillEllipse" || o.name === "strokeEllipse") out.push([a[0]! - a[2]! / 2, a[1]! - a[3]! / 2, a[0]! + a[2]! / 2, a[1]! + a[3]! / 2]);
      else if (o.name === "fillTriangle") out.push([Math.min(a[0]!, a[2]!, a[4]!), Math.min(a[1]!, a[3]!, a[5]!), Math.max(a[0]!, a[2]!, a[4]!), Math.max(a[1]!, a[3]!, a[5]!)]);
    }
    for (const path of this.paths) {
      if (path.length === 0) continue;
      out.push([Math.min(...path.map((p) => p[0])), Math.min(...path.map((p) => p[1])), Math.max(...path.map((p) => p[0])), Math.max(...path.map((p) => p[1]))]);
    }
    return out;
  }
  /** The signature of everything drawn: equal for equal drawings. */
  signature(): string { return JSON.stringify(this.ops); }
}

