// How the browser window maps to the picture. Pure: no DOM, no Phaser (view/viewportManager.ts applies it).
//
// Everyone sees the same world height (REF_VIEW_H projected pixels); a wider window shows more to the sides, up to
// MAX_ASPECT (21:9). Beyond that the picture is a centred "stage" with bars either side, so an ultrawide gains nothing.
// A window narrower than MIN_ASPECT zooms out to keep that much width instead of shrinking the playfield.
// The canvas is rendered at the device's own resolution (dpr, capped), so the camera zoom is device pixels per world pixel.

/** Projected world pixels visible top to bottom at the stage's height. */
export const REF_VIEW_H = 900;
export const MAX_ASPECT = 21 / 9;
export const MIN_ASPECT = 4 / 3;
/** Beyond 2x a retina canvas costs fill rate for no visible gain. */
export const MAX_DPR = 2;
/** The canvas backing store never exceeds a 4K frame: a big window on a retina screen drops below MAX_DPR instead. */
export const MAX_PIXELS = 3840 * 2160;

/** The DOM overlay is laid out as if the window were this big, then scaled to fit (clamped). */
export const UI_BASE_W = 1280;
export const UI_BASE_H = 800;
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
/** The overlay's data-ui-short / data-ui-narrow attributes switch on below these laid-out sizes. */
export const UI_SHORT_H = 760;
export const UI_NARROW_W = 600;

/** Phaser Text is drawn at most this many canvas pixels per text pixel: crisp enough, and a bounded amount of texture memory. */
export const MAX_TEXT_RESOLUTION = 3;

export interface Rect { x: number; y: number; w: number; h: number }

export interface ViewInput {
  /** The window's inner size in CSS pixels. */
  cssW: number;
  cssH: number;
  /** window.devicePixelRatio. */
  dpr: number;
  /** false renders at 1 canvas pixel per CSS pixel regardless of the screen (faster, softer). */
  hiDpi: boolean;
}

export interface ViewLayout {
  cssW: number;
  cssH: number;
  /** The playfield in CSS pixels, relative to the window: the whole window, or the 21:9 strip centred in it. */
  stage: Rect;
  /** True when the window is wider than MAX_ASPECT and the stage has bars at its sides. */
  clamped: boolean;
  /** Canvas pixels per CSS pixel actually used (1..MAX_DPR). */
  dpr: number;
  /** The canvas backing size: stage size times dpr. */
  deviceW: number;
  deviceH: number;
  /** Camera zoom: canvas pixels per projected world pixel. */
  zoom: number;
  /** The projected world pixels the stage shows. */
  worldW: number;
  worldH: number;
  /** The DOM overlay's scale, and the size it is laid out at (stage size / scale). */
  uiScale: number;
  uiW: number;
  uiH: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A window dimension as a whole number of pixels, at least 1 (a zero-sized or detached window reports 0, or even NaN). */
function wholePixels(v: number): number {
  return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1;
}

/** The size of the stage for a window: whole, or the MAX_ASPECT strip when the window is wider than that. */
export function stageFor(cssW: number, cssH: number): Rect & { clamped: boolean } {
  const w = wholePixels(cssW);
  const h = wholePixels(cssH);
  if (w / h <= MAX_ASPECT) return { x: 0, y: 0, w, h, clamped: false };
  const sw = Math.floor(h * MAX_ASPECT);
  return { x: Math.floor((w - sw) / 2), y: 0, w: sw, h, clamped: true };
}

export function computeLayout(input: ViewInput): ViewLayout {
  const cssW = wholePixels(input.cssW);
  const cssH = wholePixels(input.cssH);
  const stage = stageFor(cssW, cssH);
  const rawDpr = Number.isFinite(input.dpr) && input.dpr > 0 ? input.dpr : 1;
  const budgetDpr = Math.sqrt(MAX_PIXELS / (stage.w * stage.h));
  const dpr = input.hiDpi ? clamp(Math.min(rawDpr, budgetDpr), 1, MAX_DPR) : 1;
  // CSS pixels per world pixel: fit the height, but never show less than MIN_ASPECT worth of width.
  const cssZoom = Math.min(stage.h / REF_VIEW_H, stage.w / (REF_VIEW_H * MIN_ASPECT));
  const uiScale = clamp(Math.min(stage.w / UI_BASE_W, stage.h / UI_BASE_H), UI_SCALE_MIN, UI_SCALE_MAX);
  return {
    cssW,
    cssH,
    stage: { x: stage.x, y: stage.y, w: stage.w, h: stage.h },
    clamped: stage.clamped,
    dpr,
    deviceW: Math.max(1, Math.round(stage.w * dpr)),
    deviceH: Math.max(1, Math.round(stage.h * dpr)),
    zoom: cssZoom * dpr,
    worldW: stage.w / cssZoom,
    worldH: stage.h / cssZoom,
    uiScale,
    uiW: stage.w / uiScale,
    uiH: stage.h / uiScale,
  };
}

/** The Text resolution that keeps text sharp under a camera at `zoom` (the epsilon: 1.0000000002 must not cost a 2x texture). */
export function textResolution(zoom: number): number {
  return Number.isFinite(zoom) ? clamp(Math.ceil(zoom - 1e-6), 1, MAX_TEXT_RESOLUTION) : 1;
}

export function layoutsEqual(a: ViewLayout, b: ViewLayout): boolean {
  return a.cssW === b.cssW && a.cssH === b.cssH && a.dpr === b.dpr && a.stage.x === b.stage.x && a.stage.w === b.stage.w
    && a.stage.h === b.stage.h && a.zoom === b.zoom && a.uiScale === b.uiScale;
}

/**
 * The camera scroll that puts world point (left, top) at the top-left of a camera `camW` x `camH` canvas pixels at `zoom`.
 * Phaser zooms about the camera's centre, so scroll is the world position of the top-left only at zoom 1.
 */
export function scrollForTopLeft(left: number, top: number, camW: number, camH: number, zoom: number): { x: number; y: number } {
  return { x: left - (camW - camW / zoom) / 2, y: top - (camH - camH / zoom) / 2 };
}

/** The reverse: the world point at the camera's top-left for a scroll. */
export function topLeftForScroll(scrollX: number, scrollY: number, camW: number, camH: number, zoom: number): { x: number; y: number } {
  return { x: scrollX + (camW - camW / zoom) / 2, y: scrollY + (camH - camH / zoom) / 2 };
}

/**
 * The world point under a pointer, given the camera it is read through. Same maths as Phaser's `camera.getWorldPoint`
 * (zoom about the centre, no rotation), without needing the camera's cached matrix to be fresh.
 */
export function screenToWorld(
  px: number, py: number, scrollX: number, scrollY: number, camW: number, camH: number, zoom: number,
): { x: number; y: number } {
  const tl = topLeftForScroll(scrollX, scrollY, camW, camH, zoom);
  return { x: tl.x + px / zoom, y: tl.y + py / zoom };
}
