// Shapes that do not change are drawn once into a texture and shown as Images.
//
// A Phaser Graphics (and every Shape: Arc, Ellipse, Rectangle) is tessellated again on every frame, however still it is, and it goes
// through the flat-triangle batch, while Text and Image go through the textured-quad batch. Each time the draw order alternates
// between the two the renderer flushes: a draw call, a vertex upload and a shader switch. A scene of fighters made of Graphics with a
// Text name each flushed about twice per fighter (142 draws a frame in an 8-player arena with 36 mobs, the GPU process at 99% of a
// core). Fighters, loot and walls made of Images with a Text name stay in one batch, and an Image costs a fraction of a Graphics on the
// CPU too. Baked textures live in the game's texture manager, so every fighter that looks the same shares one.
import type Phaser from "phaser";
import { getSettings } from "../settings";
import { computeLayout } from "../view/viewport";

/** Texels per world pixel in a baked texture, at least: 2 stays sharp up to a camera zoom of 2 (a 2560x1440 window zooms 1.6, a Retina one 2). */
export const BAKE_SCALE = 2;

/** The densest bake: sharp up to a camera zoom of 3 (the viewport never goes past about 2.5: a 16-inch MacBook Pro fullscreen, a 4K display). */
export const MAX_BAKE_SCALE = 3;

/** The density that keeps a camera at `zoom` sharp: one texel per screen pixel in half steps, from BAKE_SCALE to MAX_BAKE_SCALE. */
export const bakeScaleFor = (zoom: number): number =>
  Number.isFinite(zoom) ? Math.min(MAX_BAKE_SCALE, Math.max(BAKE_SCALE, Math.ceil(zoom * 2 - 1e-6) / 2)) : BAKE_SCALE;

/**
 * The highest camera zoom this window can reach: the zoom it has now, or fullscreen on its screen (a window dragged bigger,
 * Alt+Enter), whichever is larger. 0 where there is no window (tests).
 */
export function reachableZoom(): number {
  if (typeof window === "undefined" || !window.screen) return 0;
  const hiDpi = getSettings().hiDpi;
  const at = (w: number, h: number): number => computeLayout({ cssW: w, cssH: h, dpr: window.devicePixelRatio, hiDpi }).zoom;
  return Math.max(at(window.innerWidth, window.innerHeight), at(window.screen.width, window.screen.height));
}

let density: number | null = null;

/**
 * Texels per world pixel of every fighter, ring, chest and icon texture, for the whole page session: BAKE_SCALE, or denser where
 * this screen can zoom past 2. Fixed at first use (the hub bakes its avatar at boot) because a texture keeps the density it was
 * baked at, and the views size their Images from it; a window dragged to a denser screen later keeps it.
 */
export function bakeScale(): number {
  return (density ??= bakeScaleFor(reachableZoom()));
}

/** Fixes the density (tests), or with null picks it again from the screen at the next use. Textures already baked keep theirs. */
export function setBakeScale(value: number | null): void {
  density = value;
}

/** The rectangle of the drawing's own coordinates a bake covers; the drawing's origin (0, 0) is where the image will be placed. */
export interface Region {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A square region around the origin. */
export const around = (r: number): Region => ({ x0: -r, y0: -r, x1: r, y1: r });

const PREFIX = "bk:";
const PIXEL_KEY = `${PREFIX}pixel`;

type Draw = (g: Phaser.GameObjects.Graphics) => void;

/**
 * Draws into the texture `key` (prefixed, so it can't meet a loaded asset) unless it exists: `draw` gets a Graphics whose origin is
 * the region's (0, 0) and whose unit is a world pixel; the texture holds `scale` texels per pixel. Returns the key to use.
 */
export function ensureBake(scene: Phaser.Scene, key: string, region: Region, draw: Draw, scale = bakeScale()): string {
  const full = PREFIX + key;
  if (scene.textures.exists(full)) return full;
  const g = scene.make.graphics({}, false);
  // Canvas commands: the texture is painted by Phaser's Canvas renderer, which has real anti-aliasing. Scale first, so the shift is in world pixels.
  g.scaleCanvas(scale, scale);
  g.translateCanvas(-region.x0, -region.y0);
  draw(g);
  g.generateTexture(full, Math.ceil((region.x1 - region.x0) * scale), Math.ceil((region.y1 - region.y0) * scale));
  g.destroy();
  return full;
}

/** The size of a baked region in world pixels. */
export const regionSize = (r: Region): { w: number; h: number } => ({ w: r.x1 - r.x0, h: r.y1 - r.y0 });

/** Points an Image at a bake: its origin is the drawing's (0, 0) and it is drawn at the drawing's size. */
export function placeBake(image: Phaser.GameObjects.Image, region: Region, scale = bakeScale()): void {
  const { w, h } = regionSize(region);
  image.setOrigin(-region.x0 / w, -region.y0 / h);
  image.setScale(1 / scale);
}

/** An Image of a baked drawing, ready to be put in a container at the drawing's origin. */
export function bakedImage(scene: Phaser.Scene, key: string, region: Region, draw: Draw, scale = bakeScale()): Phaser.GameObjects.Image {
  const image = scene.add.image(0, 0, ensureBake(scene, key, region, draw, scale));
  placeBake(image, region, scale);
  return image;
}

/** Shows another bake (of the same region) on an Image; a no-op while it already shows it. */
export function swapBake(image: Phaser.GameObjects.Image, scene: Phaser.Scene, key: string, region: Region, draw: Draw, scale = bakeScale()): void {
  const full = ensureBake(scene, key, region, draw, scale);
  if (image.texture?.key !== full) image.setTexture(full);
}

/**
 * A 1x1 white texture: a flat rectangle is an Image of it, sized with `setDisplaySize` and coloured with `setTint`. The same quad batch
 * as everything else, where a Rectangle shape would be a flush.
 */
export function pixelImage(scene: Phaser.Scene): Phaser.GameObjects.Image {
  const key = ensureBake(scene, "pixel", { x0: 0, y0: 0, x1: 1, y1: 1 }, (g) => { g.fillStyle(0xffffff, 1).fillRect(0, 0, 1, 1); }, 1);
  return scene.add.image(0, 0, key);
}

/**
 * What FigureJuice poses a baked part through. A pose sets a scale of its own (1 at rest), but a baked image's base scale is
 * 1/bakeScale(), so the pose's is applied on top of it.
 */
export function scaledPart(image: Phaser.GameObjects.Image, base = 1 / bakeScale()): {
  setPosition(x?: number, y?: number): unknown;
  setScale(x?: number, y?: number): unknown;
} {
  return {
    setPosition: (x?: number, y?: number) => image.setPosition(x, y),
    setScale: (sx = 1, sy = sx) => image.setScale(sx * base, sy * base),
  };
}

/** Exposed for tests. */
export const PIXEL_TEXTURE_KEY = PIXEL_KEY;
