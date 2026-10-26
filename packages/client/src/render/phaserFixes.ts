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
