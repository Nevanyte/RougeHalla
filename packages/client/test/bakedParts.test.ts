// The fighter and loot parts that are Images of baked drawings (render/FighterArt.ts, render/ContainerView.ts): which bake each look
// names, that equal looks share one texture, and what a change (colour, rim, flash, facing) swaps. The scene is fake (test/fakes.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { BAKE_SCALE } from "../src/render/bake";
import { ContainerView } from "../src/render/ContainerView";
import { BodyDisc, BodyFlash, FighterArt, facingIndexOf, shadowImage, weaponTexture, type FighterFields } from "../src/render/FighterArt";
import { argsOf, fakeScene, fk, type FakeObject } from "./fakes";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BodyDisc", () => {
  const RIM = { width: 2, color: 0x111111, alpha: 0.8 };

  it("is a disc of its fill with a rim, drawn once and shared by every disc that looks the same", () => {
    const { scene, baked } = fakeScene();
    const a = new BodyDisc(scene, PLAYER_RADIUS, 0xff7043, RIM);
    const b = new BodyDisc(scene, PLAYER_RADIUS, 0xff7043, RIM);
    expect(fk(a.image).state.texture).toBe(fk(b.image).state.texture);
    const discs = [...baked.keys()].filter((k) => k.startsWith("bk:disc:"));
    expect(discs).toHaveLength(1);
    const calls = baked.get(discs[0]!)!.calls.map(([n]) => n);
    expect(calls).toEqual(expect.arrayContaining(["fillStyle", "fillCircle", "lineStyle", "strokeCircle"]));
  });

  it("has no rim at width 0", () => {
    const { scene, baked } = fakeScene();
    const core = new BodyDisc(scene, 6, 0xffffff);
    const calls = baked.get(String(fk(core.image).state.texture))!.calls.map(([n]) => n);
    expect(calls).toContain("fillCircle");
    expect(calls).not.toContain("strokeCircle");
  });

  it("swaps to another bake for another colour or rim, and not for the same", () => {
    const { scene } = fakeScene();
    const d = new BodyDisc(scene, PLAYER_RADIUS, 0xff7043, RIM);
    const sets = () => argsOf(fk(d.image), "setTexture").length;
    const base = sets(); // the first look, set while it was built
    const first = fk(d.image).state.texture;
    d.setFill(0xff7043);
    d.setRim(RIM.width, RIM.color, RIM.alpha);
    expect(sets()).toBe(base);
    d.setFill(0x4fc3f7);
    expect(sets()).toBe(base + 1);
    expect(fk(d.image).state.texture).not.toBe(first);
    d.setRim(3, 0xffd54f, 1);
    expect(sets()).toBe(base + 2);
  });
});

describe("BodyFlash", () => {
  it("shows the disc white for the flash, then its colour again", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { scene } = fakeScene();
    const disc = new BodyDisc(scene, PLAYER_RADIUS, 0xff7043);
    const colour = fk(disc.image).state.texture;
    const flash = new BodyFlash(disc, 0xff7043);
    flash.trigger(120);
    const white = fk(disc.image).state.texture;
    expect(white).not.toBe(colour);
    expect(String(white)).toContain(":ffffff:");
    now = 1100;
    flash.tick();
    expect(fk(disc.image).state.texture).toBe(white);
    now = 1121;
    flash.tick();
    expect(fk(disc.image).state.texture).toBe(colour);
  });

  it("takes a new colour at once, or after the flash when one is on", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { scene } = fakeScene();
    const disc = new BodyDisc(scene, PLAYER_RADIUS, 0xff7043);
    const flash = new BodyFlash(disc, 0xff7043);
    flash.setColor(0x4fc3f7);
    expect(String(fk(disc.image).state.texture)).toContain(":4fc3f7:");
    flash.trigger(100);
    flash.setColor(0x9ccc65);
    expect(String(fk(disc.image).state.texture)).toContain(":ffffff:");
    now = 1200;
    flash.tick();
    expect(String(fk(disc.image).state.texture)).toContain(":9ccc65:");
  });
});

describe("weaponTexture and the weapon in hand", () => {
  const fighter = (over: Partial<FighterFields> = {}): FighterFields => ({
    facing: 0, faction: "fire", weapon0: "sword", weapon1: "", slot: 0, drawStartedAt: 0, ...over,
  });

  it("gives every look its own bake and the same look the same one", () => {
    const { scene, baked } = fakeScene();
    const sword = weaponTexture(scene, "sword");
    expect(weaponTexture(scene, "sword")).toBe(sword);
    const keys = new Set([sword, weaponTexture(scene, "axe"), weaponTexture(scene, "bow", 8), weaponTexture(scene, "bow", 16), weaponTexture(scene, "sword", -1, true)]);
    expect(keys.size).toBe(5);
    expect(baked.size).toBe(5);
  });

  it("draws the weapon pointing along +x from the body, so one bake serves every facing", () => {
    const { scene, baked } = fakeScene();
    weaponTexture(scene, "axe");
    const calls = baked.get("bk:weapon:axe:-1:0:0:0")!.calls;
    expect(calls[0]![0]).toBe("scaleCanvas");
    expect(calls[1]![1]).toEqual([22, 24]);
  });

  it("shares a texture between two fighters holding the same thing", () => {
    const { scene } = fakeScene();
    const a = new FighterArt(scene);
    const b = new FighterArt(scene);
    a.update(fighter(), 1000, 1000);
    b.update(fighter(), 1000, 1000);
    expect(fk(a.held).state.texture).toBe(fk(b.held).state.texture);
    expect(fk(a.held).state.visible).toBe(true);
  });

  it("draws two fists for the empty hand of a fighter with a faction", () => {
    const { scene, baked } = fakeScene();
    const art = new FighterArt(scene);
    art.update(fighter(), 1000, 1000);
    expect(art.update(fighter({ weapon0: "" }), 1016, 1016)).toBe("fists");
    expect(fk(art.held).state.visible).toBe(true);
    const calls = baked.get(String(fk(art.held).state.texture))!.calls;
    // Two round fists, each filled and outlined, plus the two knuckle highlights.
    expect(calls.filter(([n]) => n === "strokeCircle")).toHaveLength(2);
    expect(calls.filter(([n]) => n === "fillCircle")).toHaveLength(4);
    // The swapped-to empty slot reads the same way.
    expect(art.update(fighter({ weapon0: "sword", slot: 1 }), 1032, 1032)).toBe("fists");
  });

  it("hides the weapon when nothing is in hand of a fighter with no faction (a training dummy)", () => {
    const { scene } = fakeScene();
    const art = new FighterArt(scene);
    art.update(fighter(), 1000, 1000);
    expect(art.update(fighter({ weapon0: "", faction: "" }), 1016, 1016)).toBeNull();
    expect(fk(art.held).state.visible).toBe(false);
  });
});

describe("the shield's block arc", () => {
  const shield = (facing: number): FighterFields => ({ facing, faction: "frost", weapon0: "shield", weapon1: "", slot: 0, drawStartedAt: 0 });

  it("is shown only with a shield in hand", () => {
    const { scene } = fakeScene();
    const art = new FighterArt(scene);
    art.update({ ...shield(0), weapon0: "sword" }, 1000, 1000);
    expect(fk(art.ground).state.visible).toBe(false);
    art.update(shield(0), 1016, 1016);
    expect(fk(art.ground).state.visible).toBe(true);
    art.update({ ...shield(0), weapon0: "axe" }, 1032, 1032);
    expect(fk(art.ground).state.visible).toBe(false);
  });

  it("turns in steps: a facing inside the same step keeps the bake, the next step takes another", () => {
    const { scene } = fakeScene();
    const art = new FighterArt(scene);
    art.update(shield(0), 1000, 1000);
    const first = fk(art.ground).state.texture;
    art.update(shield(0.01), 1016, 1016);
    expect(fk(art.ground).state.texture).toBe(first);
    art.update(shield(0.2), 1032, 1032);
    expect(fk(art.ground).state.texture).not.toBe(first);
  });

  it("snaps a ground angle to a whole step of the circle, and wraps", () => {
    const turn = 2 * Math.PI;
    expect(facingIndexOf(0)).toBe(0);
    expect(facingIndexOf(turn)).toBe(0);
    expect(facingIndexOf(turn - 0.001)).toBe(0);
    expect(facingIndexOf(-turn / 4)).toBe(facingIndexOf((3 * turn) / 4));
    for (const a of [-7, -1, 0.3, 2, 5, 12]) {
      const i = facingIndexOf(a);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(96);
    }
  });
});

describe("shadowImage", () => {
  it("is one bake for every fighter", () => {
    const { scene, baked } = fakeScene();
    const a = shadowImage(scene);
    const b = shadowImage(scene);
    expect(fk(a).state.texture).toBe(fk(b).state.texture);
    expect([...baked.keys()].filter((k) => k.includes("shadow"))).toHaveLength(1);
    expect(fk(a).state.scale).toBe(1 / BAKE_SCALE);
  });
});

describe("ContainerView", () => {
  const container = (over: Partial<ContainerState> & { weapon?: string | null }): ContainerState => {
    const items = over.weapon ? [{ def: over.weapon }] : [];
    return { x: 100, y: 100, kind: "chest", label: "", ...over, items: { length: items.length, at: (i: number) => items[i] } } as unknown as ContainerState;
  };

  function setup() {
    const { scene, ofKind, baked } = fakeScene();
    const view = new ContainerView(scene);
    const root = ofKind("container").at(-1)!;
    const [shape, icon, label] = root.args[2] as FakeObject[];
    const look = () => String(shape!.state.texture);
    return { view, root, shape: shape!, icon: icon!, label: label!, baked, look };
  }

  it("shows a shut chest while it holds a weapon and an open one after", () => {
    const { view, look, label } = setup();
    view.update(container({ weapon: "sword" }));
    expect(look()).toBe("bk:chest:closed");
    const closedY = label.state.y;
    view.update(container({ weapon: null }));
    expect(look()).toBe("bk:chest:open");
    // The open lid stands higher: the name goes up with it.
    expect(label.state.y as number).toBeLessThan(closedY as number);
  });

  it("shows a loose weapon as its glow with the weapon's own bake tilted over it", () => {
    const { view, shape, icon } = setup();
    view.update(container({ kind: "ground", weapon: "bow" }));
    expect(String(shape.state.texture)).toBe("bk:ground:bow");
    expect(icon.state.visible).toBe(true);
    expect(String(icon.state.texture)).toBe(weaponTexture(fakeScene().scene, "bow"));
    expect(icon.state.rotation).toBeCloseTo(-0.6, 9);
    expect(icon.state.scale).toBeCloseTo(0.85 / BAKE_SCALE, 9);
  });

  it("shows a body without an icon", () => {
    const { view, look, icon } = setup();
    view.update(container({ kind: "body", weapon: null }));
    expect(look()).toBe("bk:body");
    expect(icon.state.visible).toBe(false);
  });

  it("bakes a look once however many containers have it", () => {
    const { scene, baked } = fakeScene();
    const a = new ContainerView(scene);
    const b = new ContainerView(scene);
    a.update(container({ weapon: "axe" }));
    b.update(container({ weapon: "axe", x: 300 }));
    expect([...baked.keys()].filter((k) => k.startsWith("bk:chest:"))).toEqual(["bk:chest:closed"]);
  });
});
