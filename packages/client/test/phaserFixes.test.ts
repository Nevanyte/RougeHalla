// render/phaserFixes.ts: the Phaser 4.2.1 renderer workaround. Phaser is not loaded: a fake batch handler stands in for its own.
import { describe, expect, it, vi } from "vitest";
import { applyPhaserFixes, coerceLightingFlag } from "../src/render/phaserFixes";

function batch() {
  const seen: Array<[unknown, unknown]> = [];
  return { seen, node: { updateRenderOptions(this: unknown, lighting: unknown, alpha: unknown) { seen.push([lighting, alpha]); } } };
}

describe("coerceLightingFlag", () => {
  it("passes `false` where a Shape passes `undefined`, so the two stop looking like a change of render options", () => {
    const { seen, node } = batch();
    expect(coerceLightingFlag(node)).toBe(true);
    node.updateRenderOptions(undefined, "keep");
    node.updateRenderOptions(false, "keep");
    node.updateRenderOptions(null, "keep");
    expect(seen).toEqual([[false, "keep"], [false, "keep"], [false, "keep"]]);
  });

  it("leaves a real lighting setup and the alpha strategy as they are", () => {
    const { seen, node } = batch();
    coerceLightingFlag(node);
    const lights = { count: 3 };
    node.updateRenderOptions(lights, 0.5);
    expect(seen).toEqual([[lights, 0.5]]);
  });

  it("keeps the handler as `this` for the original", () => {
    let owner: unknown;
    const node = { updateRenderOptions(this: unknown, _lighting?: unknown, _alpha?: unknown) { owner = this; } };
    coerceLightingFlag(node);
    node.updateRenderOptions(undefined, "keep");
    expect(owner).toBe(node);
  });

  it("does nothing to a handler that is not there, or that has no such method (a Phaser that changed)", () => {
    expect(coerceLightingFlag(undefined)).toBe(false);
    expect(coerceLightingFlag(null)).toBe(false);
    expect(coerceLightingFlag({})).toBe(false);
  });
});

describe("applyPhaserFixes", () => {
  it("patches the flat-triangle handler at once when the render nodes exist", () => {
    const { seen, node } = batch();
    const getNode = vi.fn((name: string) => (name === "BatchHandlerTriFlat" ? node : undefined));
    const once = vi.fn();
    applyPhaserFixes({ renderer: { renderNodes: { getNode } }, events: { once } } as never);
    expect(once).not.toHaveBeenCalled();
    node.updateRenderOptions(undefined, "keep");
    expect(seen).toEqual([[false, "keep"]]);
  });

  it("waits for the game's `ready` when the render nodes are not registered yet", () => {
    const { seen, node } = batch();
    let ready: (() => void) | undefined;
    let registered = false;
    const game = {
      renderer: { renderNodes: { getNode: () => (registered ? node : undefined) } },
      events: { once: (name: string, fn: () => void) => { expect(name).toBe("ready"); ready = fn; } },
    };
    applyPhaserFixes(game as never);
    expect(ready).toBeDefined();
    registered = true;
    ready!();
    node.updateRenderOptions(undefined, "keep");
    expect(seen).toEqual([[false, "keep"]]);
  });

  it("copes with a Canvas renderer, which has no render nodes", () => {
    expect(() => applyPhaserFixes({ renderer: {}, events: { once: () => {} } } as never)).not.toThrow();
    expect(() => applyPhaserFixes({ renderer: null, events: { once: () => {} } } as never)).not.toThrow();
  });
});
