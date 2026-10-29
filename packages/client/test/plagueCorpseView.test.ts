import { describe, expect, it, vi } from "vitest";
import { Y_SCALE } from "@raid/shared";
import { PlagueCorpseView } from "../src/render/PlagueCorpseView";

function rig() {
  const graphics: any[] = [];
  const add = vi.fn(() => {
    const g: any = {
      fillStyle: vi.fn(() => g), fillEllipse: vi.fn(() => g), lineStyle: vi.fn(() => g), lineBetween: vi.fn(() => g),
      fillCircle: vi.fn(() => g), strokeEllipse: vi.fn(() => g), setPosition: vi.fn(() => g), setDepth: vi.fn(() => g),
      setVisible: vi.fn(() => g), destroy: vi.fn(),
    };
    graphics.push(g);
    return g;
  });
  const view = new PlagueCorpseView({ add: { graphics: add } } as any);
  const corpse = { id: "pc1", playerId: "dead", playerName: "Fallen", x: 220, y: 180, expiresAt: 10_000 } as any;
  const source = new Map([[corpse.id, corpse]]);
  return { view, add, graphics, corpse, source };
}

describe("Plague corpse world art", () => {
  it("creates a green puddle only in vision for an eligible local Plague player, then hides and removes it", () => {
    const r = rig();
    r.view.update(r.source, 1000, false, () => true);
    expect(r.add).not.toHaveBeenCalled();
    r.view.update(r.source, 1000, true, () => false);
    expect(r.add).not.toHaveBeenCalled();
    r.view.update(r.source, 1000, true, () => true);
    expect(r.add).toHaveBeenCalledOnce();
    const g = r.graphics[0]!;
    expect(g.fillEllipse).toHaveBeenCalled();
    expect(g.lineBetween).toHaveBeenCalled();
    expect(g.setPosition).toHaveBeenCalledWith(220, 180 * Y_SCALE);
    expect(g.setVisible).toHaveBeenLastCalledWith(true);

    r.view.update(r.source, 1100, true, () => false);
    expect(g.setVisible).toHaveBeenLastCalledWith(false);
    r.view.update(r.source, 10_000, true, () => true);
    expect(g.destroy).toHaveBeenCalledOnce();
    r.view.destroy();
    expect(r.graphics).toHaveLength(1);
  });

  it("destroys all visible remains as soon as the viewer loses Plague eligibility", () => {
    const r = rig();
    r.view.update(r.source, 1000, true, () => true);
    const g = r.graphics[0]!;
    r.view.update(r.source, 1100, false, () => true);
    expect(g.destroy).toHaveBeenCalledOnce();
  });
});
