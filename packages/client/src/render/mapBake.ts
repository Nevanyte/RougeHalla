// Turns the Graphics a MapView drew (the floor and one per wall row) into baked textures shown as Images, from outside MapView.
//
// The map is static, yet every frame Phaser tessellated its ~1500 rectangles and lines again, and, worse, each wall row is a
// flat-triangle object y-sorted among the fighters and loot (which are textured quads): every time the draw order moved from a row
// to a fighter the renderer flushed. Baked rows are textured quads like their neighbours, so the whole y-sorted world is one batch.
// Only the Graphics MapView has already drawn are read (their command buffers), so a new look for the map keeps working; whatever
// this does not understand (a Graphics with a transform command, gate rows that are hidden until the coliseum locks, the floor
// marking of an open gate) is left exactly as it was.
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
const FILL_RECT = 3;
const LINE_TO = 4;
const MOVE_TO = 5;
const LINE_STYLE = 6;
const FILL_TRIANGLE = 10;
const STROKE_TRIANGLE = 11;

/**
 * The box a command buffer draws into, padded for line widths, or null when the buffer holds a command this does not know (a
 * transform, a gradient) or draws nothing. Exported for tests.
 */
export function commandBounds(buffer: ArrayLike<number>): Region | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let line = 1;
  const add = (x: number, y: number, pad = 0): void => {
    if (x - pad < x0) x0 = x - pad;
    if (y - pad < y0) y0 = y - pad;
    if (x + pad > x1) x1 = x + pad;
    if (y + pad > y1) y1 = y + pad;
  };
  for (let i = 0; i < buffer.length;) {
    const id = buffer[i]!;
    const n = ARGS[id];
    if (n === undefined) return null;
    const a = i + 1;
    // A stroke's width is half outside the path; a fill has none.
    if (id === LINE_STYLE) line = buffer[a]!;
    else if (id === FILL_RECT) { add(buffer[a]!, buffer[a + 1]!); add(buffer[a]! + buffer[a + 2]!, buffer[a + 1]! + buffer[a + 3]!); }
    else if (id === MOVE_TO || id === LINE_TO) add(buffer[a]!, buffer[a + 1]!, line / 2 + 1);
    else if (id === ARC) { const r = buffer[a + 2]!; add(buffer[a]! - r, buffer[a + 1]! - r, line / 2 + 1); add(buffer[a]! + r, buffer[a + 1]! + r, line / 2 + 1); }
    else if (id === FILL_TRIANGLE || id === STROKE_TRIANGLE) for (let k = 0; k < 6; k += 2) add(buffer[a + k]!, buffer[a + k + 1]!, line / 2 + 1);
    i += 1 + n;
  }
  return x0 <= x1 && y0 <= y1 ? { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) } : null;
}

/** Texels along one side of a baked texture; wider drawings are cut into chunks (every GPU takes 4096, and 2 chunks cost nothing). */
const MAX_TEXELS = 4096;

/** A floor layer is so low in contrast that half the texels do not show; walls have hard edges against it and need them. */
const FLOOR_DEPTH_BELOW = -9e5;

export interface BakedMap {
  destroy(): void;
}

type GraphicsObject = Phaser.GameObjects.Graphics & { commandBuffer: number[] };

const isGraphics = (o: Phaser.GameObjects.GameObject): o is GraphicsObject =>
  o.type === "Graphics" && Array.isArray((o as Partial<GraphicsObject>).commandBuffer);

/**
 * Bakes what it can of `mapView`'s objects at `zoom` (the camera's: texels per world pixel are picked from it, 1 to BAKE_SCALE in
 * half steps, and the floor takes at most 1). The originals are destroyed; the result owns the Images and the textures.
 */
export function bakeMapView(scene: Phaser.Scene, mapView: MapView, zoom: number, id = "map"): BakedMap {
  const objects = (mapView as unknown as { objects?: Phaser.GameObjects.GameObject[] }).objects ?? [];
  const wallScale = Math.min(BAKE_SCALE, Math.max(1, Math.ceil(zoom * 2) / 2));
  const images: Phaser.GameObjects.Image[] = [];
  const keys: string[] = [];
  let serial = 0;

  for (const obj of objects) {
    // Floor (far below everything) and wall rows (y-sorted, depth >= 0); hidden ones are the closed gates, and the open-gate mark
    // lies between the two depth ranges: both are toggled by MapView and stay as they are.
    if (!isGraphics(obj) || !obj.visible || obj.commandBuffer.length === 0) continue;
    const floor = obj.depth <= FLOOR_DEPTH_BELOW;
    if (!floor && obj.depth < 0) continue;
    const region = commandBounds(obj.commandBuffer);
    if (!region) continue;
    const scale = floor ? Math.min(1, wallScale) : wallScale;
    const chunkW = Math.floor(MAX_TEXELS / scale);
    const chunkH = Math.floor(MAX_TEXELS / scale);
    for (let cy = region.y0; cy < region.y1; cy += chunkH) {
      for (let cx = region.x0; cx < region.x1; cx += chunkW) {
        const cw = Math.min(chunkW, region.x1 - cx);
        const ch = Math.min(chunkH, region.y1 - cy);
        const key = `bk:${id}:${serial++}`;
        const g = scene.make.graphics({}, false) as GraphicsObject;
        g.scaleCanvas(scale, scale);
        g.translateCanvas(-cx, -cy);
        for (let i = 0; i < obj.commandBuffer.length; i += 4096) g.commandBuffer.push(...obj.commandBuffer.slice(i, i + 4096));
        g.generateTexture(key, Math.ceil(cw * scale), Math.ceil(ch * scale));
        g.destroy();
        keys.push(key);
        images.push(scene.add.image(cx, cy, key).setOrigin(0, 0).setScale(1 / scale).setDepth(obj.depth));
      }
    }
    obj.destroy();
  }

  return {
    destroy(): void {
      for (const img of images) img.destroy();
      for (const key of keys) if (scene.textures.exists(key)) scene.textures.remove(key);
      images.length = 0;
      keys.length = 0;
    },
  };
}
