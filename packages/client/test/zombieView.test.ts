import { describe, expect, it, vi } from "vitest";
import { Y_SCALE } from "@raid/shared";
import type { MobState } from "@raid/shared/schema";
import { ZombieView, zombieScale, ZOMBIE_FRIEND_COLOR, ZOMBIE_OTHER_COLOR } from "../src/render/ZombieView";
import { fakeScene, fk, type FakeObject } from "./fakes";

const zombie = (over: Partial<MobState> = {}): MobState => ({
  kind: "zombie", ownerId: "plague", name: "Zombie", x: 200, y: 300, hp: 350, maxHp: 350, status: "alive", facing: 0, effects: 0, ...over,
} as MobState);

function rig() {
  const fake = fakeScene();
  const view = new ZombieView(fake.scene);
  const root = fake.ofKind("container").at(-1)!;
  const kids = root.args[2] as FakeObject[];
  return { ...fake, view, root, bond: kids[1]!, figure: kids[2]!, hp: kids[3]!, label: kids[4]!,
    frame: (m = zombie(), renderT = 1000, patchT = renderT, local = true, corpses = 1) =>
      view.update(m.x, m.y, m, renderT, patchT, { name: "Morrow", corpses, local }),
  };
}

describe("Plague zombie world art", () => {
  it("shows an undead figure, owner bond and full-health bar, with different ownership labels", () => {
    const r = rig();
    r.frame();
    expect(r.root.state.position).toEqual([200, 300 * Y_SCALE]);
    expect(r.root.state.depth).toBe(300);
    expect(r.hp.state.visible).toBe(true);
    expect(r.label.state.text).toBe("Your zombie");
    expect(r.label.state.color).toBe(ZOMBIE_FRIEND_COLOR);
    expect(r.bond.state.tint).toBe(0xc7ffad);
    const figure = r.baked.get("bk:zombie:figure")!;
    expect(figure.calls.some(([name, args]) => name === "fillStyle" && args[0] === 0x75a650)).toBe(true);
    expect(figure.calls.filter(([name]) => name === "lineBetween").length).toBeGreaterThan(8);

    r.frame(zombie(), 1100, 1100, false);
    expect(r.label.state.text).toBe("Morrow's zombie");
    expect(r.label.state.color).toBe(ZOMBIE_OTHER_COLOR);
    expect(r.bond.state.tint).toBe(0x7f9965);
    r.view.destroy();
    expect(r.root.calls.filter(([name]) => name === "destroy")).toHaveLength(1);
  });

  it("grows with corpses and moves its name and health bar clear of the larger figure", () => {
    const r = rig();
    r.frame();
    const firstTop = r.label.state.y as number;
    r.frame(zombie({ hp: 1e12, maxHp: 2e12 }), 1100, 1100, true, 6);
    const size = zombieScale(6);
    expect(r.figure.state.scale).toEqual([size, size]);
    expect(r.label.state.y).toBeLessThan(firstTop);
    const fill = (r.hp.args[2] as FakeObject[])[1]!;
    expect(fill.state.displaySize).toEqual([Math.round(0.5 * (34 + (size - 1) * 10) * 2) / 2, 4]);
    expect(zombieScale(1)).toBe(1);
    expect(zombieScale(1000)).toBe(1.65);
    expect(zombieScale(NaN)).toBe(1);
  });

  it("fades after render time reaches death and restores the same companion on revival", () => {
    const r = rig(), dead = zombie({ hp: 0, status: "dead" });
    r.frame(dead, 900, 1000);
    expect(r.root.state.alpha).toBe(1);
    expect(r.label.state.visible).toBe(true);
    r.frame(dead, 1225, 1300);
    expect(r.root.state.alpha).toBe(0.5);
    expect(r.label.state.visible).toBe(false);
    expect(r.hp.state.visible).toBe(false);
    r.frame(dead, 1450, 1500);
    expect(r.root.state.visible).toBe(false);
    r.frame(zombie(), 1600, 1600, true, 2);
    expect(r.root.state.visible).toBe(true);
    expect(r.root.state.alpha).toBe(1);
    expect(r.hp.state.visible).toBe(true);
  });

  it("uses combat cues for its strike and flashes only while the hit is fresh", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    try {
      const r = rig();
      r.frame();
      r.view.cues.swing(0, 950);
      r.view.flash();
      r.frame();
      expect((r.figure.state.position as number[])[0]).toBeGreaterThan(0);
      const body = fk((r.figure.args[2] as unknown[])[0]);
      expect(body.state.tintMode).toBe(1);
      clock.mockReturnValue(1200);
      r.frame(zombie(), 1200);
      expect(body.state.tintMode).toBe(0);
    } finally { clock.mockRestore(); }
  });
});
