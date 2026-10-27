// Workarounds for Phaser 4.2.1 renderer behaviour that costs frames, applied once when the game boots.
import type Phaser from "phaser";

/** The one method of Phaser's flat-triangle batch handler this file touches (the Graphics and Shape renderers submit through it). */
export interface LightingAwareBatch {
  updateRenderOptions(lighting: unknown, alphaStrategy: unknown): void;
}

/**
 * `BatchHandlerTriFlat.updateRenderOptions` flushes the batch whenever `lighting` differs from the last call's, and compares with
 * `!==`. Graphics pass `false`; the Shape objects (Arc, Ellipse, Rectangle) pass `undefined`. A fighter mixes both, so in the real
 * scene the batch was flushed between nearly every pair of objects: an extra draw call, buffer upload and shader switch each
 * (measured: 142 draws a frame with 8 players and 36 mobs, 82 with this fixed). Treating both as "no lighting" restores the batching.
 * Returns false when the handler is not what this expects, so a Phaser upgrade that changes it leaves it alone.
 */
export function coerceLightingFlag(batch: Partial<LightingAwareBatch> | undefined | null): boolean {
  if (!batch || typeof batch.updateRenderOptions !== "function") return false;
  const original = batch.updateRenderOptions;
  batch.updateRenderOptions = function (this: LightingAwareBatch, lighting: unknown, alphaStrategy: unknown): void {
    original.call(this, lighting || false, alphaStrategy);
  };
  return true;
}

/**
 * Whether the canvas should be multisampled (Phaser's `antialiasGL`, fixed when the context is made). A 4x multisampled target costs
 * GPU time in proportion to its pixels: a busy arena held 144 fps at 2560x1233 and dropped to 124-131 at 2880x1800 (a 1440x900 window
 * on a Retina screen), and held 140+ there without it. A dense screen needs the multisampling least, its pixels being half the size.
 * So it is dropped only for a canvas over `MSAA_MAX_PIXELS` on a screen of at least 1.5 device pixels per CSS pixel.
 */
export const MSAA_MAX_PIXELS = 4.2e6;
export function wantsMsaa(devicePixels: number, devicePixelRatio: number): boolean {
  return !(devicePixels > MSAA_MAX_PIXELS && devicePixelRatio >= 1.5);
}

interface RenderNodesLike {
  getNode?(name: string): Partial<LightingAwareBatch> | undefined;
}

/**
 * Applies every workaround to a game that was just constructed. Phaser registers its render nodes during boot, so when they are
 * not there yet this waits for the `ready` event, which comes before any scene starts. With a Canvas renderer there is nothing to patch.
 */
export function applyPhaserFixes(game: Phaser.Game): void {
  const patch = (): boolean => {
    const nodes = (game.renderer as unknown as { renderNodes?: RenderNodesLike } | null)?.renderNodes;
    return coerceLightingFlag(nodes?.getNode?.("BatchHandlerTriFlat"));
  };
  if (!patch()) game.events.once("ready", patch);
}
