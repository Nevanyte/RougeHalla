// Turns the Graphics a MapView drew (the floor and one per wall row) into baked textures shown as Images, from outside MapView.
//
// The map is static, yet every frame Phaser tessellated its ~1500 rectangles and lines again, and, worse, each wall row is a
// flat-triangle object y-sorted among the fighters and loot (which are textured quads): every time the draw order moved from a row
// to a fighter the renderer flushed. Baked rows are textured quads like their neighbours, so the whole y-sorted world is one batch.
// Only the Graphics MapView has already drawn are read (their command buffers), so a new look for the map keeps working; whatever
// this does not understand (a Graphics with a transform command, gate rows that are hidden until the coliseum locks, the floor
// marking of an open gate) is left exactly as it was.
//
// Memory and sharpness (the walls are the cost: a map has ~64 wall rows, and a row's drawing spans the whole map width where it
// holds a single wall at each end):
//  - A wall row is cut into its runs (its drawing commands clustered by x, separated by empty gaps), each shown by its own Image at
//    the row's depth, so y-sorting is unchanged. Only the runs are baked, about a third of a full-width row's texels.
//  - The runs of every row are packed into a few atlas pages (one texture each), not a texture a run: a frame draws with a handful
//    of texture units instead of one per row on screen, which also keeps the quad batch from flushing when its units run out. Each
//    run gets a one texel gutter that repeats its edge, so the texture filter never reads a neighbour (the same as the clamped edge
//    of a texture of its own: rows that meet at an edge show no seam).
//  - A page is painted on a canvas this file makes, uploaded once (`addImage`, so Phaser builds no CanvasTexture and its full-size
//    ImageData copy), and the canvas is shrunk to 1x1 afterwards: only the GPU copy stays. In WebGL the one thing that would want
//    the pixels again is a lost context: Phaser re-uploads from the canvas, so the bake listens for the renderer's restore event
//    and bakes again from the command buffers it keeps (a few thousand numbers). The Canvas renderer draws from the canvas every
//    frame, so there nothing is released.
//  - The wall density is fixed when it is baked, so the scene tells the bake the camera zoom each frame (`update`): when the zoom
//    rises past the baked density's half step and then stops changing for REBAKE_DEBOUNCE_MS, the walls are baked again. A zoom that
//    falls keeps the sharper bake.
import type Phaser from "phaser";
import { BAKE_SCALE, type Region } from "./bake";
import type { MapView } from "./MapView";

/** The command ids of Phaser's Graphics command buffer, and how many numbers follow each (Phaser.GameObjects.Graphics.Commands). */
const ARGS: Readonly<Record<number, number>> = {
  0: 7, // ARC x y radius start end anticlockwise overshoot
  1: 0, // BEGIN_PATH
  2: 0, // CLOSE_PATH
  3: 4, // FILL_RECT
  4: 2, // LINE_TO
  5: 2, // MOVE_TO
  6: 3, // LINE_STYLE width colour alpha
  7: 2, // FILL_STYLE colour alpha
  8: 0, // FILL_PATH
  9: 0, // STROKE_PATH
  10: 6, // FILL_TRIANGLE
  11: 6, // STROKE_TRIANGLE
};
const ARC = 0;
const BEGIN_PATH = 1;
const CLOSE_PATH = 2;
const FILL_RECT = 3;
const LINE_TO = 4;
const MOVE_TO = 5;
const LINE_STYLE = 6;
const FILL_STYLE = 7;
const FILL_PATH = 8;
const STROKE_PATH = 9;
const FILL_TRIANGLE = 10;
const STROKE_TRIANGLE = 11;

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * The box a command buffer draws into, padded for line widths, or null when the buffer holds a command this does not know (a
 * transform, a gradient) or draws nothing. Exported for tests.
 */
export function commandBounds(buffer: ArrayLike<number>): Region | null {
  const box = emptyBox();
  let line = 1;
  for (let i = 0; i < buffer.length;) {
    const id = buffer[i]!;
    const n = ARGS[id];
    if (n === undefined) return null;
    if (id === LINE_STYLE) line = buffer[i + 1]!;
    else addCommand(box, buffer, i, line);
    i += 1 + n;
  }
  return regionOf(box);
}

const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

function addPoint(box: Box, x: number, y: number, pad: number): void {
  if (x - pad < box.x0) box.x0 = x - pad;
  if (y - pad < box.y0) box.y0 = y - pad;
  if (x + pad > box.x1) box.x1 = x + pad;
  if (y + pad > box.y1) box.y1 = y + pad;
}

/** Grows `box` by what the command at `i` draws. A stroke's width is half outside the path; a fill has none. */
function addCommand(box: Box, b: ArrayLike<number>, i: number, line: number): void {
  const id = b[i]!;
  const a = i + 1;
  const pad = line / 2 + 1;
  if (id === FILL_RECT) { addPoint(box, b[a]!, b[a + 1]!, 0); addPoint(box, b[a]! + b[a + 2]!, b[a + 1]! + b[a + 3]!, 0); }
  else if (id === MOVE_TO || id === LINE_TO) addPoint(box, b[a]!, b[a + 1]!, pad);
  else if (id === ARC) { const r = b[a + 2]!; addPoint(box, b[a]! - r, b[a + 1]! - r, pad); addPoint(box, b[a]! + r, b[a + 1]! + r, pad); }
  else if (id === FILL_TRIANGLE || id === STROKE_TRIANGLE) for (let k = 0; k < 6; k += 2) addPoint(box, b[a + k]!, b[a + k + 1]!, pad);
}

const regionOf = (box: Box): Region | null =>
  box.x0 <= box.x1 && box.y0 <= box.y1 ? { x0: Math.floor(box.x0), y0: Math.floor(box.y0), x1: Math.ceil(box.x1), y1: Math.ceil(box.y1) } : null;

// ------------------------------------------------------------------------------------------------------------------ runs

/** One thing a command buffer draws (a rectangle, a triangle, or a path from BEGIN_PATH to its fill or stroke), with the styles in force. */
export interface DrawUnit {
  readonly box: Box;
  /** The commands that draw it, styles not included. */
  readonly cmds: readonly number[];
  /** The latest FILL_STYLE and LINE_STYLE commands before it (null: none yet). */
  readonly fill: readonly number[] | null;
  readonly line: readonly number[] | null;
}

/**
 * Splits a command buffer into the things it draws, or null when it is not made of whole units (a command this does not know, a
 * stray LINE_TO outside a path, a path never filled or stroked, a style inside a path): the caller then bakes the buffer whole.
 * A path is one unit from BEGIN_PATH through the fills and strokes that follow its geometry.
 */
export function splitUnits(buffer: ArrayLike<number>): DrawUnit[] | null {
  const units: DrawUnit[] = [];
  let fill: number[] | null = null;
  let line: number[] | null = null;
  let lineW = 1;
  const take = (i: number): number[] => Array.from({ length: 1 + ARGS[buffer[i]!]! }, (_, k) => buffer[i + k]!);
  for (let i = 0; i < buffer.length;) {
    const id = buffer[i]!;
    const n = ARGS[id];
    if (n === undefined) return null;
    if (id === FILL_STYLE) { fill = take(i); i += 1 + n; continue; }
    if (id === LINE_STYLE) { line = take(i); lineW = buffer[i + 1]!; i += 1 + n; continue; }
    if (id === FILL_RECT || id === FILL_TRIANGLE || id === STROKE_TRIANGLE) {
      const box = emptyBox();
      addCommand(box, buffer, i, lineW);
      units.push({ box, cmds: take(i), fill, line });
      i += 1 + n;
      continue;
    }
    if (id !== BEGIN_PATH) return null; // geometry or a fill with no path before it
    const box = emptyBox();
    const cmds: number[] = [BEGIN_PATH];
    let j = i + 1;
    let ended = false;
    for (; j < buffer.length; j += 1 + ARGS[buffer[j]!]!) {
      const c = buffer[j]!;
      if (ARGS[c] === undefined) return null;
      if (c === FILL_PATH || c === STROKE_PATH) { if (j === i + 1) return null; ended = true; cmds.push(c); continue; }
      if (ended) break;
      if (c !== MOVE_TO && c !== LINE_TO && c !== ARC && c !== CLOSE_PATH) return null;
      addCommand(box, buffer, j, lineW);
      for (let k = 0; k <= ARGS[c]!; k++) cmds.push(buffer[j + k]!);
    }
    if (!ended) return null;
    units.push({ box, cmds, fill, line });
    i = j;
  }
  return units;
}

/** A group of units that are drawn into one texture: they lie within `gap` of each other along x. */
export interface Cluster {
  readonly region: Region;
  readonly units: readonly DrawUnit[];
}

/** Groups units by x: sorted by their left edge, a unit that starts within `gap` of the group so far joins it. Empty boxes are dropped. */
export function clusterUnits(units: readonly DrawUnit[], gap: number): Cluster[] {
  const live = units.map((u, i) => ({ u, i })).filter(({ u }) => u.box.x0 <= u.box.x1 && u.box.y0 <= u.box.y1);
  live.sort((a, b) => a.u.box.x0 - b.u.box.x0 || a.i - b.i);
  const groups: { box: Box; members: { u: DrawUnit; i: number }[] }[] = [];
  for (const m of live) {
    const g = groups[groups.length - 1];
    if (g && m.u.box.x0 <= g.box.x1 + gap) {
      g.box.x1 = Math.max(g.box.x1, m.u.box.x1);
      g.box.y0 = Math.min(g.box.y0, m.u.box.y0);
      g.box.y1 = Math.max(g.box.y1, m.u.box.y1);
      g.members.push(m);
    } else groups.push({ box: { ...m.u.box }, members: [m] });
  }
  return groups.map((g) => ({
    region: regionOf(g.box)!,
    units: g.members.sort((a, b) => a.i - b.i).map((m) => m.u),
  }));
}

/** The commands that draw a cluster alone: its units in their original order, each preceded by the styles it was drawn with. */
export function replayCluster(units: readonly DrawUnit[]): number[] {
  const out: number[] = [];
  let fill: readonly number[] | null = null;
  let line: readonly number[] | null = null;
  const same = (a: readonly number[] | null, b: readonly number[] | null): boolean => a === b || (!!a && !!b && a.length === b.length && a.every((v, k) => v === b[k]));
  for (const u of units) {
    if (u.fill && !same(u.fill, fill)) { out.push(...u.fill); fill = u.fill; }
    if (u.line && !same(u.line, line)) { out.push(...u.line); line = u.line; }
    out.push(...u.cmds);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------------- packing

export interface Cell { readonly w: number; readonly h: number }
export interface Placed { readonly page: number; readonly x: number; readonly y: number }

/**
 * Lays cells out on pages of at most `pageMax` texels a side, in shelves: tallest first, left to right, a new shelf under the last
 * when a row is full, a new page when the last is. Each cell gets `pad` texels of room on every side (the position is where its
 * content starts). A page is only as big as what it holds. Every cell must fit a page with its padding.
 */
export function packShelves(cells: readonly Cell[], pageMax: number, pad: number): { pages: Cell[]; placed: Placed[] } {
  const order = cells.map((_, i) => i).sort((a, b) => cells[b]!.h - cells[a]!.h || a - b);
  const pages: { w: number; h: number }[] = [];
  const placed: Placed[] = new Array(cells.length);
  let page = -1;
  let x = 0;
  let shelfY = 0;
  let shelfH = 0;
  for (const i of order) {
    const cw = cells[i]!.w + 2 * pad;
    const ch = cells[i]!.h + 2 * pad;
    if (cw > pageMax || ch > pageMax) throw new Error(`a ${cw}x${ch} cell does not fit a ${pageMax} page`);
    if (page < 0) { page = 0; pages.push({ w: 0, h: 0 }); }
    else if (x + cw > pageMax) { shelfY += shelfH; x = 0; shelfH = 0; }
    if (shelfY + ch > pageMax) { page++; pages.push({ w: 0, h: 0 }); x = 0; shelfY = 0; shelfH = 0; }
    placed[i] = { page, x: x + pad, y: shelfY + pad };
    x += cw;
    shelfH = Math.max(shelfH, ch);
    const p = pages[page]!;
    p.w = Math.max(p.w, x);
    p.h = Math.max(p.h, shelfY + ch);
  }
  return { pages, placed };
}

// ------------------------------------------------------------------------------------------------------------ density and gate

/** Texels along one side of a baked page; wider drawings are cut into chunks (every GPU takes 4096). */
export const MAX_TEXELS = 4096;

/** Texels of repeated edge around each run (what a bilinear filter can reach beyond a frame). */
const GUTTER = 1;

/**
 * Runs closer than this (world pixels) share a texture: a gap costs texels (a texel row of the gap is a texel row of a wall row,
 * about 40 world px tall), an extra Image costs the CPU a little every frame. Two tiles.
 */
export const RUN_GAP = 64;

/** A floor layer is so low in contrast that half the texels do not show; walls have hard edges against it and need them. */
const FLOOR_DEPTH_BELOW = -9e5;

/** Texels per world pixel for the walls at camera `zoom`: 1 to BAKE_SCALE in half steps (a sharp map takes one texel per screen pixel). */
export const wallScaleFor = (zoom: number): number => Math.min(BAKE_SCALE, Math.max(1, Math.ceil(zoom * 2) / 2));

/** How long the camera zoom must hold still before a denser bake starts (a window being dragged changes it every frame). */
export const REBAKE_DEBOUNCE_MS = 300;

/** When to bake the walls again. Pure: the scene tells it the zoom every frame and acts when it answers true. */
export class RebakeGate {
  private seen = NaN;
  private since = 0;
  constructor(private baked: number) {}

  /** True when `zoom` asks for a denser bake than the one that was made and has held for REBAKE_DEBOUNCE_MS. A zoom that falls never does. */
  check(zoom: number, nowMs: number): boolean {
    if (zoom !== this.seen) { this.seen = zoom; this.since = nowMs; }
    return wallScaleFor(zoom) > this.baked && nowMs - this.since >= REBAKE_DEBOUNCE_MS;
  }

  /** A bake at this density was made. */
  rebaked(scale: number): void { this.baked = scale; }
}

// ------------------------------------------------------------------------------------------------------------------- baking

export interface BakeStats {
  /** Texels per world pixel of the walls. */
  scale: number;
  pages: number;
  images: number;
  /** Texels over every page (4 bytes each on the GPU). */
  texels: number;
  /** Milliseconds the last bake took. */
  ms: number;
  /** How many times the walls were baked again after the first bake (zoom rises, a restored WebGL context). */
  rebakes: number;
}

export interface BakedMap {
  /** Frees the images and textures. */
  destroy(): void;
  /**
   * Called every frame with the camera zoom and the time in ms: bakes the walls again when the zoom has risen past the baked
   * density and held for REBAKE_DEBOUNCE_MS. True on the frame it did.
   */
  update(zoom: number, nowMs: number): boolean;
  readonly stats: BakeStats;
}

/** What the bake needs from the outside; tests replace the canvas. */
export interface BakeOptions {
  makeCanvas?: (w: number, h: number) => HTMLCanvasElement;
  now?: () => number;
}

type GraphicsObject = Phaser.GameObjects.Graphics & { commandBuffer: number[] };

/** The part of Phaser's renderer this uses: the WebGL one has `gl` and an event for a restored context. */
interface RendererEvents {
  gl?: unknown;
  on(event: string, fn: () => void): unknown;
  off(event: string, fn: () => void): unknown;
}

const isGraphics = (o: Phaser.GameObjects.GameObject): o is GraphicsObject =>
  o.type === "Graphics" && Array.isArray((o as Partial<GraphicsObject>).commandBuffer);

/** A Graphics MapView drew, kept as plain numbers: its commands survive the Graphics, so a bake can be repeated. */
interface Source {
  readonly depth: number;
  readonly floor: boolean;
  readonly cmds: readonly number[];
}

/** One drawing in a texture: where it goes in the world (integers), its commands and the depth of its Image. */
interface Item {
  readonly region: Region;
  readonly cmds: readonly number[];
  readonly depth: number;
}

const defaultCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** A drawing cut into chunks of at most `side` world pixels each way. */
function chunks(region: Region, side: number): Region[] {
  const out: Region[] = [];
  for (let y = region.y0; y < region.y1; y += side) {
    for (let x = region.x0; x < region.x1; x += side) {
      out.push({ x0: x, y0: y, x1: Math.min(region.x1, x + side), y1: Math.min(region.y1, y + side) });
    }
  }
  return out;
}

/** What each source bakes: the floor whole (in chunks), a wall row as its runs. */
function itemsOf(sources: readonly Source[], scale: number): { floor: Item[]; walls: Item[] } {
  const floor: Item[] = [];
  const walls: Item[] = [];
  for (const src of sources) {
    const whole = commandBounds(src.cmds);
    if (!whole) continue;
    // A floor chunk has no gutter, a wall run has two texels of it: a run is cut so that it still fits a page.
    const side = Math.floor((MAX_TEXELS - (src.floor ? 0 : 2 * GUTTER)) / (src.floor ? Math.min(1, scale) : scale));
    const parts: { region: Region; cmds: readonly number[] }[] = [];
    const units = src.floor ? null : splitUnits(src.cmds);
    if (units) for (const c of clusterUnits(units, RUN_GAP)) parts.push({ region: c.region, cmds: replayCluster(c.units) });
    else parts.push({ region: whole, cmds: src.cmds });
    for (const part of parts) {
      for (const region of chunks(part.region, side)) (src.floor ? floor : walls).push({ region, cmds: part.cmds, depth: src.depth });
    }
  }
  return { floor, walls };
}

/** The world rectangle of a run's texels is `scale` per world pixel, rounded up. */
const texelsOf = (r: Region, scale: number): Cell => ({ w: Math.ceil((r.x1 - r.x0) * scale), h: Math.ceil((r.y1 - r.y0) * scale) });

/**
 * Bakes what it can of `mapView`'s objects at `zoom` (the camera's: texels per world pixel are picked from it, 1 to BAKE_SCALE in
 * half steps, and the floor takes at most 1). The originals are destroyed; the result owns the Images and the textures, bakes the
 * walls again when `update` sees the zoom rise, and frees everything in `destroy`.
 */
export function bakeMapView(scene: Phaser.Scene, mapView: MapView, zoom: number, id = "map", options: BakeOptions = {}): BakedMap {
  const objects = (mapView as unknown as { objects?: Phaser.GameObjects.GameObject[] }).objects ?? [];
  const makeCanvas = options.makeCanvas ?? defaultCanvas;
  const now = options.now ?? (() => performance.now());
  const sources: Source[] = [];

  for (const obj of objects) {
    // Floor (far below everything) and wall rows (y-sorted, depth >= 0); hidden ones are the closed gates, and the open-gate mark
    // lies between the two depth ranges: both are toggled by MapView and stay as they are.
    if (!isGraphics(obj) || !obj.visible || obj.commandBuffer.length === 0) continue;
    const floor = obj.depth <= FLOOR_DEPTH_BELOW;
    if (!floor && obj.depth < 0) continue;
    if (!commandBounds(obj.commandBuffer)) continue;
    sources.push({ depth: obj.depth, floor, cmds: obj.commandBuffer.slice() });
    obj.destroy();
  }

  const stats: BakeStats = { scale: 0, pages: 0, images: 0, texels: 0, ms: 0, rebakes: 0 };
  const images: Phaser.GameObjects.Image[] = [];
  const keys: string[] = [];
  let generation = 0;
  let destroyed = false;
  let gate = new RebakeGate(0);

  const renderer = scene.sys?.game?.renderer as RendererEvents | undefined;
  // Only the WebGL renderer uploads a copy and leaves the canvas unread; the Canvas renderer draws from it every frame.
  const gpuCopy = !!renderer?.gl;

  /** Paints the cells of one page onto a canvas and uploads it as a texture of its own, with a frame per cell (`r0`, `r1`...). */
  function bakePage(key: string, page: Cell, cells: { item: Item; x: number; y: number }[], scale: number, pad: number, painter: GraphicsObject): void {
    const canvas = makeCanvas(page.w, page.h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    // Each drawing is painted on a canvas of its own size first: its overshoot is cut by the canvas edge, and its gutter is made on a
    // small canvas (a canvas drawn onto itself is copied whole first, which on a page is megabytes a call).
    const scratch = makeCanvas(1, 1);
    const sctx = scratch.getContext("2d", { willReadFrequently: true })!;
    for (const { item, x, y } of cells) {
      const { w, h } = texelsOf(item.region, scale);
      const cw = w + 2 * pad;
      const ch = h + 2 * pad;
      scratch.width = cw; // resizing clears it
      scratch.height = ch;
      painter.clear();
      painter.scaleCanvas(scale, scale);
      painter.translateCanvas(pad / scale - item.region.x0, pad / scale - item.region.y0);
      for (let i = 0; i < item.cmds.length; i += 4096) painter.commandBuffer.push(...item.cmds.slice(i, i + 4096));
      painter.generateTexture(scratch, cw, ch);
      if (pad > 0) {
        // The gutter repeats the content's edge row and column (sides first, so the corners follow).
        sctx.drawImage(scratch, pad, pad, 1, h, 0, pad, 1, h);
        sctx.drawImage(scratch, pad + w - 1, pad, 1, h, pad + w, pad, 1, h);
        sctx.drawImage(scratch, 0, pad, cw, 1, 0, 0, cw, 1);
        sctx.drawImage(scratch, 0, pad + h - 1, cw, 1, 0, pad + h, cw, 1);
      }
      ctx.drawImage(scratch, 0, 0, cw, ch, x - pad, y - pad, cw, ch);
    }
    scratch.width = 1;
    scratch.height = 1;
    // addImage is typed for an HTMLImageElement, but its TextureSource takes a canvas and uploads it (addCanvas would make a CanvasTexture).
    const texture = scene.textures.addImage(key, canvas as unknown as HTMLImageElement);
    cells.forEach(({ item, x, y }, i) => {
      const { w, h } = texelsOf(item.region, scale);
      texture?.add(`r${i}`, 0, x, y, w, h);
    });
    // The pixels are on the GPU now; a lost context is answered by a new bake, not by this canvas.
    if (gpuCopy) { canvas.width = 1; canvas.height = 1; }
  }

  function build(wallScale: number): void {
    const t0 = now();
    const gen = generation++;
    const { floor, walls } = itemsOf(sources, wallScale);
    const painter = scene.make.graphics({}, false) as GraphicsObject;
    let pages = 0;
    let texels = 0;
    for (const [group, scale, pad, tag] of [[floor, Math.min(1, wallScale), 0, "f"], [walls, wallScale, GUTTER, "w"]] as const) {
      if (group.length === 0) continue;
      const packed = packShelves(group.map((it) => texelsOf(it.region, scale)), MAX_TEXELS, pad);
      const frameOf: { key: string; name: string }[] = new Array(group.length);
      packed.pages.forEach((page, p) => {
        const key = `bk:${id}:${gen}:${tag}${p}`;
        const cells: { item: Item; x: number; y: number }[] = [];
        group.forEach((item, i) => {
          const at = packed.placed[i]!;
          if (at.page === p) { frameOf[i] = { key, name: `r${cells.length}` }; cells.push({ item, x: at.x, y: at.y }); }
        });
        bakePage(key, page, cells, scale, pad, painter);
        keys.push(key);
        pages++;
        texels += page.w * page.h;
      });
      // In source order: rows are drawn by depth, and the Images of one depth never overlap.
      group.forEach((item, i) => {
        const f = frameOf[i]!;
        images.push(scene.add.image(item.region.x0, item.region.y0, f.key, f.name).setOrigin(0, 0).setScale(1 / scale).setDepth(item.depth));
      });
    }
    painter.destroy();
    stats.scale = wallScale;
    stats.pages = pages;
    stats.images = images.length;
    stats.texels = texels;
    stats.ms = now() - t0;
    gate = new RebakeGate(wallScale);
  }

  function release(): void {
    for (const img of images) img.destroy();
    for (const key of keys) if (scene.textures.exists(key)) scene.textures.remove(key);
    images.length = 0;
    keys.length = 0;
  }

  let zoomNow = zoom;
  const rebake = (z: number): void => {
    if (destroyed) return;
    release();
    build(wallScaleFor(z));
    stats.rebakes++;
  };
  // The WebGL context came back with the pages' canvases already shrunk: bake again.
  const onRestore = (): void => rebake(zoomNow);
  if (gpuCopy) renderer!.on("restorewebgl", onRestore);

  build(wallScaleFor(zoom));

  return {
    stats,
    update(z: number, nowMs: number): boolean {
      zoomNow = z;
      if (destroyed || !gate.check(z, nowMs)) return false;
      rebake(z);
      return true;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (gpuCopy) renderer!.off("restorewebgl", onRestore);
      release();
    },
  };
}
