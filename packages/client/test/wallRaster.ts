// A tiny software renderer for the baked walls, just enough of a Canvas 2D texture and of a GPU quad batch to see a seam without a
// browser (no dependency; wallSeams.test.ts uses it). The parts:
//  - `ShapePen`: a Pen (render/zoneArt/zoneStyle.ts) that keeps the filled shapes a strip paints, in order, and a horizontal or
//    vertical line as the rectangle of its stroke (a rim; a ClipPen paints the lines it cuts the same way, so a copy compares equal).
//    Other strokes, circles and ellipses are not kept (a crack or a window bar is a detail, and the tests look away from them), and
//    a rounded rectangle is kept square (its corners lie outside every window the tests look at).
//  - `paintFrame`: a strip's shapes painted into the texels of its frame. `area` is the anti-aliasing of Canvas 2D (exact coverage of
//    a rectangle, source-over, premultiplied), where an edge inside a texel leaves it partly covered; `centre` is a GPU's aliased
//    fill, where a texel is covered when its centre is inside.
//  - `renderPremult`: the Images (and the Graphics that are not baked, such as a closed gate) laid over each other in depth order as
//    a GPU draws them at a camera zoom: bilinear sampling at the pixel centre with nothing outside the frame (the pad around a strip
//    on the page is empty), and a quad's edge covered per multisample (the standard 4 sample pattern, or one sample at the centre).
import type { Pen } from "../src/render/zoneArt/zoneStyle";

export type Pt = readonly [number, number];

export interface Shape {
  readonly poly: readonly Pt[];
  readonly color: number;
  readonly alpha: number;
  /** The rectangle of a stroke (a rim or a drip), not a filled shape: details, which are not snapped to the texel grid. */
  readonly line?: true;
}

export class ShapePen implements Pen {
  readonly shapes: Shape[] = [];
  private color = 0;
  private alpha = 1;
  private path: Pt[] | null = null;
  private stroke: readonly [width: number, color: number, alpha: number] = [1, 0, 1];

  fillStyle(color: number, alpha = 1): this { this.color = color; this.alpha = alpha; return this; }
  lineStyle(width: number, color: number, alpha = 1): this { this.stroke = [width, color, alpha]; return this; }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.shapes.push({ poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color: this.color, alpha: this.alpha });
    return this;
  }
  strokeRect(): this { return this; }
  fillRoundedRect(x: number, y: number, w: number, h: number): this { return this.fillRect(x, y, w, h); }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    const [width, color, alpha] = this.stroke;
    const [xa, xb, ya, yb] = y1 === y2 ? [Math.min(x1, x2), Math.max(x1, x2), y1 - width / 2, y1 + width / 2] : x1 === x2 ? [x1 - width / 2, x1 + width / 2, Math.min(y1, y2), Math.max(y1, y2)] : [0, 0, 0, 0];
    if (xb > xa && yb > ya) this.shapes.push({ poly: [[xa, ya], [xb, ya], [xb, yb], [xa, yb]], color, alpha, line: true });
    return this;
  }
  fillCircle(): this { return this; }
  strokeCircle(): this { return this; }
  fillEllipse(): this { return this; }
  strokeEllipse(): this { return this; }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    this.shapes.push({ poly: [[x1, y1], [x2, y2], [x3, y3]], color: this.color, alpha: this.alpha });
    return this;
  }
  beginPath(): this { this.path = []; return this; }
  moveTo(x: number, y: number): this { this.path?.push([x, y]); return this; }
  lineTo(x: number, y: number): this { this.path?.push([x, y]); return this; }
  closePath(): this { return this; }
  fillPath(): this {
    if (this.path && this.path.length >= 3) this.shapes.push({ poly: this.path, color: this.color, alpha: this.alpha });
    this.path = null;
    return this;
  }
  strokePath(): this { this.path = null; return this; }
}

const channel = (c: number): [number, number, number] => [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];

/** The box of a shape that is an axis-aligned rectangle, else null. */
function axisRect(poly: readonly Pt[]): [number, number, number, number] | null {
  if (poly.length !== 4) return null;
  const xs = [...new Set(poly.map((p) => p[0]))];
  const ys = [...new Set(poly.map((p) => p[1]))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Even-odd point in polygon. */
function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export type PaintMode = "area" | "centre";

const SUPER = 6;

/** The shapes painted into w x h premultiplied RGBA texels whose top left is (px, py) in the shapes' own coordinates. */
export function paintFrame(shapes: readonly Shape[], px: number, py: number, w: number, h: number, mode: PaintMode): Float64Array {
  const data = new Float64Array(w * h * 4);
  for (const sh of shapes) {
    const [cr, cg, cb] = channel(sh.color);
    const poly = sh.poly.map(([x, y]): Pt => [x - px, y - py]);
    const rect = axisRect(poly);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const j0 = Math.max(0, Math.floor(Math.min(...ys)));
    const j1 = Math.min(h, Math.ceil(Math.max(...ys)));
    const i0 = Math.max(0, Math.floor(Math.min(...xs)));
    const i1 = Math.min(w, Math.ceil(Math.max(...xs)));
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        let cov: number;
        if (mode === "centre") {
          cov = (rect ? i + 0.5 >= rect[0] && i + 0.5 < rect[2] && j + 0.5 >= rect[1] && j + 0.5 < rect[3] : inside(poly, i + 0.5, j + 0.5)) ? 1 : 0;
        } else if (rect) {
          cov = Math.max(0, Math.min(rect[2], i + 1) - Math.max(rect[0], i)) * Math.max(0, Math.min(rect[3], j + 1) - Math.max(rect[1], j));
        } else {
          let n = 0;
          for (let sy = 0; sy < SUPER; sy++) for (let sx = 0; sx < SUPER; sx++) if (inside(poly, i + (sx + 0.5) / SUPER, j + (sy + 0.5) / SUPER)) n++;
          cov = n / (SUPER * SUPER);
        }
        cov *= sh.alpha;
        if (cov <= 0) continue;
        const k = (j * w + i) * 4;
        const keep = 1 - cov;
        data[k] = cr * cov + data[k]! * keep;
        data[k + 1] = cg * cov + data[k + 1]! * keep;
        data[k + 2] = cb * cov + data[k + 2]! * keep;
        data[k + 3] = cov + data[k + 3]! * keep;
      }
    }
  }
  return data;
}

/** A baked Image: its frame's texels (one per world pixel) with the frame's top left at world (x, y). */
export interface Frame { x: number; y: number; w: number; h: number; data: Float64Array }

/** A plain rectangle of the original drawing (a closed gate): exact, drawn straight to the screen. */
export interface LooseRect { x0: number; y0: number; x1: number; y1: number; color: number; alpha: number }

export interface Layer {
  readonly depth: number;
  readonly frame?: Frame;
  readonly rects?: readonly LooseRect[];
}

export interface View {
  /** Screen pixels per world pixel. */
  zoom: number;
  /** The world point at the screen's (0, 0). */
  camX: number;
  camY: number;
  /** The window's size in screen pixels. */
  w: number;
  h: number;
  msaa: boolean;
}

const MSAA4: readonly Pt[] = [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]];
const CENTRE: readonly Pt[] = [[0.5, 0.5]];

/** Bilinear sample of a frame at texel coordinates (u, v), nothing (transparent) outside it: premultiplied RGBA. */
function sample(f: Frame, u: number, v: number): [number, number, number, number] {
  const fu = u - 0.5;
  const fv = v - 0.5;
  const i0 = Math.floor(fu);
  const j0 = Math.floor(fv);
  const a = fu - i0;
  const b = fv - j0;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  const at = (i: number, j: number, c: number): number => (i < 0 || j < 0 || i >= f.w || j >= f.h ? 0 : f.data[(j * f.w + i) * 4 + c]!);
  for (let c = 0; c < 4; c++) {
    out[c] = (at(i0, j0, c) * (1 - a) + at(i0 + 1, j0, c) * a) * (1 - b) + (at(i0, j0 + 1, c) * (1 - a) + at(i0 + 1, j0 + 1, c) * a) * b;
  }
  return out;
}

/**
 * The layers over each other in depth order (ties: as given), over nothing: premultiplied RGBA, 0..1, 4 numbers a pixel. Laid over
 * a floor colour, `rgb + floor * (1 - a)`; the floor shows through where `a` is under 1, which is what a seam is.
 */
export function renderPremult(layers: readonly Layer[], view: View): Float64Array {
  const win = {
    x0: view.camX - 1, y0: view.camY - 1, x1: view.camX + (view.w + 1) / view.zoom, y1: view.camY + (view.h + 1) / view.zoom,
  };
  const live = layers
    .map((layer, order) => ({ layer, order }))
    .filter(({ layer: l }) => (l.frame
      ? l.frame.x < win.x1 && l.frame.x + l.frame.w > win.x0 && l.frame.y < win.y1 && l.frame.y + l.frame.h > win.y0
      : (l.rects ?? []).some((q) => q.x0 < win.x1 && q.x1 > win.x0 && q.y0 < win.y1 && q.y1 > win.y0)))
    .sort((p, q) => p.layer.depth - q.layer.depth || p.order - q.order)
    .map(({ layer }) => layer);
  const samples = view.msaa ? MSAA4 : CENTRE;
  const out = new Float64Array(view.w * view.h * 4);
  const shaded: Array<[number, number, number, number] | null> = live.map(() => null);
  for (let j = 0; j < view.h; j++) {
    for (let i = 0; i < view.w; i++) {
      // The fragment shader runs once, at the pixel centre; coverage is decided per multisample.
      const cx = view.camX + (i + 0.5) / view.zoom;
      const cy = view.camY + (j + 0.5) / view.zoom;
      shaded.fill(null);
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sx, sy] of samples) {
        const wx = view.camX + (i + sx) / view.zoom;
        const wy = view.camY + (j + sy) / view.zoom;
        let pr = 0, pg = 0, pb = 0, pa = 0;
        const over = (sr: number, sg: number, sb: number, sa: number): void => {
          const keep = 1 - sa;
          pr = sr + pr * keep; pg = sg + pg * keep; pb = sb + pb * keep; pa = sa + pa * keep;
        };
        live.forEach((layer, n) => {
          const f = layer.frame;
          if (f) {
            if (wx < f.x || wx >= f.x + f.w || wy < f.y || wy >= f.y + f.h) return;
            const px = (shaded[n] ??= sample(f, cx - f.x, cy - f.y));
            over(px[0], px[1], px[2], px[3]);
            return;
          }
          for (const q of layer.rects!) {
            if (wx < q.x0 || wx >= q.x1 || wy < q.y0 || wy >= q.y1) continue;
            const [qr, qg, qb] = channel(q.color);
            over(qr * q.alpha, qg * q.alpha, qb * q.alpha, q.alpha);
          }
        });
        r += pr; g += pg; b += pb; a += pa;
      }
      const k = (j * view.w + i) * 4;
      out[k] = r / samples.length;
      out[k + 1] = g / samples.length;
      out[k + 2] = b / samples.length;
      out[k + 3] = a / samples.length;
    }
  }
  return out;
}

/** The picture of a premultiplied render over a floor colour: RGB 0..255, 3 numbers a pixel. */
export function overFloor(premult: Float64Array, floor: number): Float64Array {
  const [fr, fg, fb] = channel(floor);
  const out = new Float64Array((premult.length / 4) * 3);
  for (let k = 0; k < premult.length / 4; k++) {
    const keep = 1 - premult[k * 4 + 3]!;
    out[k * 3] = (premult[k * 4]! + fr * keep) * 255;
    out[k * 3 + 1] = (premult[k * 4 + 1]! + fg * keep) * 255;
    out[k * 3 + 2] = (premult[k * 4 + 2]! + fb * keep) * 255;
  }
  return out;
}

/** The most of any pixel that the floor shows through, 0..1. */
export function worstHole(premult: Float64Array): number {
  let max = 0;
  for (let k = 0; k < premult.length / 4; k++) max = Math.max(max, 1 - premult[k * 4 + 3]!);
  return max;
}
