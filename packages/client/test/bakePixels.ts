// A tiny software renderer for the baked map, just enough of Canvas 2D and of a GPU quad batch to see a seam without a browser:
// no dependency, axis-aligned rectangles only (all a wall row is made of). Its parts:
//  - `recordMap`: the command buffers the real MapView draws, taken through a fake scene that records Phaser's Graphics calls.
//  - `paintItem`: a baked drawing painted into texels with exact area coverage, the anti-aliasing of Canvas 2D (source-over,
//    premultiplied), so a rectangle edge inside a texel leaves it partly covered.
//  - `composeTexels`: the baked Images laid over each other on one texel grid (the Images of a wall sit on it exactly).
//  - `renderBaked` / `renderUnbaked`: the picture of the baked Images as a GPU draws them (bilinear sampling clamped at the frame
//    edge, which is what the gutter gives on the page; a quad's edge covered per multisample) against the picture of the original
//    rectangles at the same sample points. `holes` finds the floor showing through, which is what a seam is.
import { generateMap, isWallTile, TILE, type GameMap } from "@raid/shared";
import { MapView, WALL_HEIGHT } from "../src/render/MapView";
import { projY } from "../src/render/projection";
import type { Item, Source } from "../src/render/mapBake";

const FILL_STYLE = 7;
const FILL_RECT = 3;
const ARGS: Record<number, number> = { 0: 7, 1: 0, 2: 0, 3: 4, 4: 2, 5: 2, 6: 3, 7: 2, 8: 0, 9: 0, 10: 6, 11: 6 };

// ------------------------------------------------------------------------------------------------------------------ recording

/** Phaser's Graphics as far as MapView uses it: the same command ids, in the same order, and nothing else. */
class RecordingGraphics {
  readonly type = "Graphics";
  commandBuffer: number[] = [];
  depth = 0;
  visible = true;
  setDepth(d: number): this { this.depth = d; return this; }
  setVisible(v: boolean): this { this.visible = v; return this; }
  fillStyle(color: number, alpha = 1): this { this.commandBuffer.push(7, color, alpha); return this; }
  lineStyle(w: number, color: number, alpha = 1): this { this.commandBuffer.push(6, w, color, alpha); return this; }
  fillRect(x: number, y: number, w: number, h: number): this { this.commandBuffer.push(3, x, y, w, h); return this; }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this { this.commandBuffer.push(1, 5, x1, y1, 4, x2, y2, 9); return this; }
  strokeRect(x: number, y: number, w: number, h: number): this {
    for (const [a, b, c, d] of [[x, y, x, y + h], [x + w, y, x + w, y + h], [x, y, x + w, y], [x, y + h, x + w, y + h]]) this.lineBetween(a!, b!, c!, d!);
    return this;
  }
  destroy(): void {}
}

/**
 * What `bakeMapView` makes of the map MapView draws for `map`: `walls` are the visible rows that stand (depth >= 0), which it bakes;
 * `gates` are the closed gates' rows, hidden until the coliseum locks, which it leaves as Graphics (as they look once shown).
 */
export function recordMap(map: GameMap): { walls: Source[]; gates: Source[] } {
  const made: RecordingGraphics[] = [];
  const scene = { add: { graphics: () => { const g = new RecordingGraphics(); made.push(g); return g; } } };
  const view = new MapView(scene as never, map);
  const standing = (g: RecordingGraphics): boolean => g.depth >= 0 && g.commandBuffer.length > 0;
  const toSource = (g: RecordingGraphics): Source => ({ depth: g.depth, floor: false, cmds: g.commandBuffer.slice() });
  const walls = made.filter((g) => g.visible && standing(g));
  view.setGatesLocked(true);
  const gates = made.filter((g) => g.visible && standing(g) && !walls.includes(g));
  return { walls: walls.map(toSource), gates: gates.map(toSource) };
}

export const mapOf = (seed: number): GameMap => generateMap(seed);

// ------------------------------------------------------------------------------------------------------------------ rectangles

export interface FilledRect { x0: number; y0: number; x1: number; y1: number; color: number; alpha: number }

/** The rectangles of a command buffer, in drawing order, with the fill in force. */
export function rectsOf(cmds: readonly number[]): FilledRect[] {
  const out: FilledRect[] = [];
  let color = 0;
  let alpha = 1;
  for (let i = 0; i < cmds.length;) {
    const id = cmds[i]!;
    if (id === FILL_STYLE) { color = cmds[i + 1]!; alpha = cmds[i + 2]!; }
    else if (id === FILL_RECT) out.push({ x0: cmds[i + 1]!, y0: cmds[i + 2]!, x1: cmds[i + 1]! + cmds[i + 3]!, y1: cmds[i + 2]! + cmds[i + 4]!, color, alpha });
    i += 1 + ARGS[id]!;
  }
  return out;
}

const channel = (c: number): [number, number, number] => [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];

/** The colour the unbaked drawing has at a world point (the last rectangle over it, in depth order), or the floor's. */
export function unbakedColour(sources: readonly Source[], x: number, y: number, floor: number): number {
  const order = sources.map((s, i) => ({ s, i })).sort((a, b) => a.s.depth - b.s.depth || a.i - b.i);
  let colour = floor;
  for (const { s } of order) for (const q of rectsOf(s.cmds)) if (x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1) colour = q.color;
  return colour;
}

// -------------------------------------------------------------------------------------------------------------------- texels

/** Premultiplied RGBA texels of a drawing, `scale` per world pixel, its top left at world (x0, y0). */
export interface Texels { x0: number; y0: number; w: number; h: number; scale: number; data: Float64Array }

/** Paints a drawing's rectangles into w x h texels with exact area coverage (what Canvas 2D does), the origin being the region's. */
export function paintRects(cmds: readonly number[], x0: number, y0: number, w: number, h: number, scale: number): Texels {
  const data = new Float64Array(w * h * 4);
  for (const r of rectsOf(cmds)) {
    const [cr, cg, cb] = channel(r.color);
    const tx0 = (r.x0 - x0) * scale;
    const tx1 = (r.x1 - x0) * scale;
    const ty0 = (r.y0 - y0) * scale;
    const ty1 = (r.y1 - y0) * scale;
    for (let j = Math.max(0, Math.floor(ty0)); j < Math.min(h, Math.ceil(ty1)); j++) {
      const cy = Math.min(ty1, j + 1) - Math.max(ty0, j);
      for (let i = Math.max(0, Math.floor(tx0)); i < Math.min(w, Math.ceil(tx1)); i++) {
        const cov = (Math.min(tx1, i + 1) - Math.max(tx0, i)) * cy * r.alpha;
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
  return { x0, y0, w, h, scale, data };
}

/** The texels of a bake item at density `scale`: its region's size in texels, its commands painted. */
export function paintItem(item: Item, scale: number): Texels {
  const w = Math.ceil((item.region.x1 - item.region.x0) * scale - 1e-7);
  const h = Math.ceil((item.region.y1 - item.region.y0) * scale - 1e-7);
  return paintRects(item.cmds, item.region.x0, item.region.y0, w, h, scale);
}

export interface Placed { texels: Texels; depth: number }

/** The Images of some bake items, painted: what a bake puts on its pages. */
export const placeItems = (items: readonly Item[], scale: number): Placed[] => items.map((it) => ({ texels: paintItem(it, scale), depth: it.depth }));

/**
 * The Images laid over each other (depth order, then bake order) on one grid of `scale` texels per pixel whose top left is world
 * (gx0, gy0). Each Image must sit on the grid: that is what the alignment is for. Premultiplied RGBA, 4 numbers a texel.
 */
export function composeTexels(images: readonly Placed[], gx0: number, gy0: number, gw: number, gh: number, scale: number): Float64Array {
  const out = new Float64Array(gw * gh * 4);
  const order = images.map((p, i) => ({ p, i })).sort((a, b) => a.p.depth - b.p.depth || a.i - b.i);
  for (const { p: { texels: t } } of order) {
    const ox = (t.x0 - gx0) * scale;
    const oy = (t.y0 - gy0) * scale;
    if (Math.abs(ox - Math.round(ox)) > 1e-6 || Math.abs(oy - Math.round(oy)) > 1e-6) throw new Error(`an Image at (${t.x0}, ${t.y0}) is off the ${scale} texel grid`);
    for (let j = 0; j < t.h; j++) {
      const gj = Math.round(oy) + j;
      if (gj < 0 || gj >= gh) continue;
      for (let i = 0; i < t.w; i++) {
        const gi = Math.round(ox) + i;
        if (gi < 0 || gi >= gw) continue;
        const s = (j * t.w + i) * 4;
        const d = (gj * gw + gi) * 4;
        const keep = 1 - t.data[s + 3]!;
        for (let c = 0; c < 4; c++) out[d + c] = t.data[s + c]! + out[d + c]! * keep;
      }
    }
  }
  return out;
}

/** Bilinear sample at texel coordinates (u, v), clamped at the frame edge (the gutter repeats the edge texel): premultiplied RGBA. */
export function sampleTexels(t: Texels, u: number, v: number): [number, number, number, number] {
  const fu = Math.min(t.w - 1, Math.max(0, u - 0.5));
  const fv = Math.min(t.h - 1, Math.max(0, v - 0.5));
  const i0 = Math.floor(fu);
  const j0 = Math.floor(fv);
  const i1 = Math.min(t.w - 1, i0 + 1);
  const j1 = Math.min(t.h - 1, j0 + 1);
  const a = fu - i0;
  const b = fv - j0;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const p = (i: number, j: number): number => t.data[(j * t.w + i) * 4 + c]!;
    out[c] = (p(i0, j0) * (1 - a) + p(i1, j0) * a) * (1 - b) + (p(i0, j1) * (1 - a) + p(i1, j1) * a) * b;
  }
  return out;
}

// -------------------------------------------------------------------------------------------------------------------- pictures

export interface View {
  /** Screen pixels per world pixel. */
  zoom: number;
  /** The world point at the screen's (0, 0). */
  camX: number;
  camY: number;
  /** The window to render, in screen pixels (the top left, and the size). */
  px: number;
  py: number;
  w: number;
  h: number;
  /** 4x multisampling (the standard 4-sample pattern) or one sample at the pixel centre. */
  msaa: boolean;
  /** What lies under the map (the floor colour). */
  floor: number;
}

const MSAA4: readonly (readonly [number, number])[] = [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]];
const CENTRE: readonly (readonly [number, number])[] = [[0.5, 0.5]];

/** The world rectangle a window covers, a pixel wider each way. */
const worldOf = (v: View): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: v.camX + (v.px - 1) / v.zoom, y0: v.camY + (v.py - 1) / v.zoom, x1: v.camX + (v.px + v.w + 1) / v.zoom, y1: v.camY + (v.py + v.h + 1) / v.zoom,
});

/** RGB 0..255 per pixel of the window, 3 numbers a pixel. `shade(wx, wy, cx, cy)` colours one multisample; (cx, cy) is the pixel centre. */
function render(view: View, shade: (wx: number, wy: number, cx: number, cy: number) => [number, number, number]): Float64Array {
  const out = new Float64Array(view.w * view.h * 3);
  const samples = view.msaa ? MSAA4 : CENTRE;
  for (let j = 0; j < view.h; j++) {
    for (let i = 0; i < view.w; i++) {
      // The fragment shader runs once, at the pixel centre; coverage is decided per multisample.
      const cx = view.camX + (view.px + i + 0.5) / view.zoom;
      const cy = view.camY + (view.py + j + 0.5) / view.zoom;
      let r = 0, g = 0, b = 0;
      for (const [sx, sy] of samples) {
        const [pr, pg, pb] = shade(view.camX + (view.px + i + sx) / view.zoom, view.camY + (view.py + j + sy) / view.zoom, cx, cy);
        r += pr; g += pg; b += pb;
      }
      const k = (j * view.w + i) * 3;
      out[k] = (r / samples.length) * 255;
      out[k + 1] = (g / samples.length) * 255;
      out[k + 2] = (b / samples.length) * 255;
    }
  }
  return out;
}

/**
 * The baked Images as a GPU draws them over the floor, in depth order and then bake order. `loose` are Graphics that were not baked
 * (the locked gates): drawn in the same depth order, their rectangles exact.
 */
export function renderBaked(images: readonly Placed[], view: View, loose: readonly Source[] = []): Float64Array {
  const floor = channel(view.floor);
  const win = worldOf(view);
  type Layer = { depth: number; order: number; image?: Texels; rects?: FilledRect[] };
  const layers: Layer[] = [
    ...images.filter(({ texels: t }) => t.x0 < win.x1 && t.x0 + t.w / t.scale > win.x0 && t.y0 < win.y1 && t.y0 + t.h / t.scale > win.y0)
      .map((p, i): Layer => ({ depth: p.depth, order: i, image: p.texels })),
    ...loose.map((s, i): Layer => ({ depth: s.depth, order: 1e6 + i, rects: rectsOf(s.cmds).filter((q) => q.x0 < win.x1 && q.x1 > win.x0 && q.y0 < win.y1 && q.y1 > win.y0) })),
  ].sort((a, b) => a.depth - b.depth || a.order - b.order);
  return render(view, (wx, wy, cx, cy) => {
    let [r, g, b] = floor;
    for (const layer of layers) {
      const t = layer.image;
      if (t) {
        if (!(wx >= t.x0 && wx < t.x0 + t.w / t.scale && wy >= t.y0 && wy < t.y0 + t.h / t.scale)) continue;
        const [pr, pg, pb, pa] = sampleTexels(t, (cx - t.x0) * t.scale, (cy - t.y0) * t.scale);
        r = pr + r * (1 - pa); g = pg + g * (1 - pa); b = pb + b * (1 - pa);
      } else {
        for (const q of layer.rects!) {
          if (wx < q.x0 || wx >= q.x1 || wy < q.y0 || wy >= q.y1) continue;
          const [cr, cg, cb] = channel(q.color);
          r = cr * q.alpha + r * (1 - q.alpha); g = cg * q.alpha + g * (1 - q.alpha); b = cb * q.alpha + b * (1 - q.alpha);
        }
      }
    }
    return [r, g, b];
  });
}

/** The original rectangles of the sources, drawn in depth order and command order over the floor: the picture the bake must match. */
export function renderUnbaked(sources: readonly Source[], view: View): Float64Array {
  const floor = channel(view.floor);
  const win = worldOf(view);
  const order = sources.map((s, i) => ({ s, i })).sort((a, b) => a.s.depth - b.s.depth || a.i - b.i);
  const rects = order.flatMap(({ s }) => rectsOf(s.cmds)).filter((q) => q.x0 < win.x1 && q.x1 > win.x0 && q.y0 < win.y1 && q.y1 > win.y0);
  return render(view, (wx, wy) => {
    let [r, g, b] = floor;
    for (const q of rects) {
      if (wx < q.x0 || wx >= q.x1 || wy < q.y0 || wy >= q.y1) continue;
      const [cr, cg, cb] = channel(q.color);
      r = cr * q.alpha + r * (1 - q.alpha); g = cg * q.alpha + g * (1 - q.alpha); b = cb * q.alpha + b * (1 - q.alpha);
    }
    return [r, g, b];
  });
}

/**
 * How much of each pixel the floor shows through, 0..1: a picture on a black floor and the same on a white one differ by 255 times
 * the part nothing covers (the green channel is read). A seam is a hole where the unbaked drawing has none; a colour that merely
 * flips at an edge is not one.
 */
export function holes(onBlack: Float64Array, onWhite: Float64Array): Float64Array {
  const out = new Float64Array(onBlack.length / 3);
  for (let k = 0; k < out.length; k++) out[k] = (onWhite[k * 3 + 1]! - onBlack[k * 3 + 1]!) / 255;
  return out;
}

/** Both pictures of the baked Images and of the unbaked sources on the black and the white floor: their holes and the black one's colours. */
export function compare(placed: readonly Placed[], unbaked: readonly Source[], view: View, loose: readonly Source[] = []): {
  bakedHoles: Float64Array; unbakedHoles: Float64Array; baked: Float64Array; reference: Float64Array;
} {
  const black: View = { ...view, floor: 0x000000 };
  const white: View = { ...view, floor: 0xffffff };
  const baked = renderBaked(placed, view, loose);
  const reference = renderUnbaked(unbaked, view);
  return {
    baked, reference,
    bakedHoles: holes(renderBaked(placed, black, loose), renderBaked(placed, white, loose)),
    unbakedHoles: holes(renderUnbaked(unbaked, black), renderUnbaked(unbaked, white)),
  };
}

/** The largest amount (0..1) by which the baked picture's holes exceed the unbaked one's among the pixels `only` admits, and where. */
export function worstHole(r: { bakedHoles: Float64Array; unbakedHoles: Float64Array }, view: View, only: (i: number, j: number) => boolean = () => true): { max: number; i: number; j: number } {
  let max = 0, bi = -1, bj = -1;
  for (let j = 0; j < view.h; j++) {
    for (let i = 0; i < view.w; i++) {
      if (!only(i, j)) continue;
      const d = r.bakedHoles[j * view.w + i]! - r.unbakedHoles[j * view.w + i]!;
      if (d > max) { max = d; bi = i; bj = j; }
    }
  }
  return { max, i: bi, j: bj };
}

/** The largest per-channel difference (levels of 255) between two pictures of the same window among the pixels `only` admits, and where. */
export function worstDifference(a: Float64Array, b: Float64Array, view: View, only: (i: number, j: number) => boolean = () => true): { max: number; i: number; j: number } {
  let max = 0, bi = -1, bj = -1;
  for (let j = 0; j < view.h; j++) {
    for (let i = 0; i < view.w; i++) {
      if (!only(i, j)) continue;
      const k = (j * view.w + i) * 3;
      const d = Math.max(Math.abs(a[k]! - b[k]!), Math.abs(a[k + 1]! - b[k + 1]!), Math.abs(a[k + 2]! - b[k + 2]!));
      if (d > max) { max = d; bi = i; bj = j; }
    }
  }
  return { max, i: bi, j: bj };
}

// ---------------------------------------------------------------------------------------------------------------------- walls

/** The projected y of the top face of tile row `ty`: its top edge, and its bottom edge (where the next row's top face begins). */
export const faceTop = (ty: number): number => projY(ty * TILE, WALL_HEIGHT);
export const faceBottom = (ty: number): number => projY((ty + 1) * TILE, WALL_HEIGHT);

/** Walls one tile wide and at least `minRows` tall away from the map's edge: the tile column and the first and last row. */
export function findStackedWalls(map: GameMap, minRows: number): { tx: number; r0: number; r1: number }[] {
  const out: { tx: number; r0: number; r1: number }[] = [];
  for (let tx = 2; tx < map.w - 2; tx++) {
    let run = 0;
    for (let ty = 1; ty <= map.h - 1; ty++) {
      const wall = ty < map.h - 1 && isWallTile(map, tx, ty);
      const lone = wall && !isWallTile(map, tx - 1, ty) && !isWallTile(map, tx + 1, ty);
      if (lone) run++;
      else {
        if (run >= minRows) out.push({ tx, r0: ty - run, r1: ty - 1 });
        run = 0;
      }
    }
  }
  return out;
}

export { TILE };
