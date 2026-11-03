// MobView's elite emblems (render/eliteArt.ts): an elite's type shows its own sprite, two baked layers (one under the body disc, one over it)
// that follow the type, flash white with the body, fade and shrink with the container and are posed with the figure; a normal mob, a normal
// type and a type this build does not know have none. The scene is fake (test/fakes.ts); the layers are found by their place in the container.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOB_TYPES } from "@raid/shared";
import type { MobState } from "@raid/shared/schema";
import { MobView } from "../src/render/MobView";
import { ELITE_LAYERS, eliteArtKey, eliteArtOf } from "../src/render/eliteArt";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

/** Matches `scene.add.container(0, 0, [...])` in MobView's constructor. */
const CHILD = { eliteRing: 1, eliteBack: 2, body: 5, roleGlyph: 6, eliteFront: 7, eliteStar: 13, label: 12 } as const;
const DEATH_MS = 450;
const elites = MOB_TYPES.filter((t) => t.elite);

afterEach(() => { vi.restoreAllMocks(); });

function mob(over: Partial<Record<keyof MobState, unknown>> = {}): MobState {
  return {
    kind: "mob", name: "Grunt", x: 0, y: 0, facing: 0, hp: 300, maxHp: 300, status: "alive", faction: "sentenced", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, ...over,
  } as unknown as MobState;
}

const eliteMob = (type: string, over: Partial<Record<keyof MobState, unknown>> = {}): MobState =>
  mob({ kind: "elite", type, name: "Elite", faction: MOB_TYPES.find((t) => t.id === type)?.zone ?? "fire", maxHp: 700, hp: 700, ...over });

function setup() {
  const { scene, ofKind, baked } = fakeScene();
  const view = new MobView(scene);
  const root = ofKind("container").at(-1)!;
  const kids = root.args[2] as FakeObject[];
  return {
    view, root, kids, baked,
    back: kids[CHILD.eliteBack]!, front: kids[CHILD.eliteFront]!, body: kids[CHILD.body]!, glyph: kids[CHILD.roleGlyph]!,
    ring: kids[CHILD.eliteRing]!, star: kids[CHILD.eliteStar]!, label: kids[CHILD.label]!,
    frame: (m: MobState, t: number, patchT = t) => view.update(0, 0, m, t, patchT),
  };
}

const key = (image: FakeObject): string => String(image.state.texture);

describe("MobView elite emblems (an elite type's own sprite, two baked layers)", () => {
  it("puts each elite type's emblem under the disc and over it, each layer a baked texture of that type", () => {
    for (const t of elites) {
      const { frame, back, front, baked } = setup();
      frame(eliteMob(t.id), 1000);
      const art = eliteArtOf(t.id)!;
      for (const [layer, image] of [["back", back], ["front", front]] as const) {
        expect(image.state.visible, `${t.id} ${layer}`).toBe(art[layer] !== null);
        if (art[layer] === null) continue;
        expect(key(image), `${t.id} ${layer}`).toBe(`bk:${eliteArtKey(t.id, layer)}`);
        expect(baked.get(key(image))?.calls.length, `${t.id} ${layer} is drawn`).toBeGreaterThan(0);
      }
    }
  });

  it("draws ten different emblems: no two elite types show the same textures", () => {
    const pairs = new Set<string>();
    for (const t of elites) {
      const { frame, back, front } = setup();
      frame(eliteMob(t.id), 1000);
      pairs.add(`${back.state.visible ? key(back) : "-"}|${front.state.visible ? key(front) : "-"}`);
    }
    expect(pairs.size).toBe(10);
  });

  it("shows nothing for a normal mob, a normal type, a type this build does not know and an elite with no type", () => {
    const cases = [
      { kind: "mob", type: "wyrmling" }, { kind: "mob", type: "emberImp" }, { kind: "elite", type: "newElite" }, { kind: "elite", type: "" },
      { kind: "elite" }, { kind: "elite", type: "emberImp" }, { kind: "dummy" },
    ];
    for (const over of cases) {
      const { frame, back, front } = setup();
      frame(mob(over), 1000);
      expect(back.state.visible, JSON.stringify(over)).toBe(false);
      expect(front.state.visible, JSON.stringify(over)).toBe(false);
    }
  });

  it("follows the mob: swaps to the next type's textures, hides a layer the type has none of, and goes with the elite kind", () => {
    const { frame, back, front } = setup();
    frame(eliteMob("ashDrake"), 1000);
    expect(key(back)).toBe("bk:elite:ashDrake:back");
    expect(key(front)).toBe("bk:elite:ashDrake:front");
    frame(eliteMob("ratOgre"), 1050);
    expect(key(back)).toBe("bk:elite:ratOgre:back");
    expect(key(front)).toBe("bk:elite:ratOgre:front");
    frame(eliteMob("gaoler"), 1100); // nothing under the disc
    expect(back.state.visible).toBe(false);
    expect(key(front)).toBe("bk:elite:gaoler:front");
    frame(mob({ type: "gaoler" }), 1150); // the same view reused for a normal mob
    expect(front.state.visible).toBe(false);
    frame(eliteMob("archon"), 1200); // nothing over the disc
    expect(back.state.visible).toBe(true);
    expect(front.state.visible).toBe(false);
  });

  it("keeps the gold marks an elite has (ring, star, gold bold name, gold-rimmed body) beside its emblem", () => {
    const { frame, ring, star, label, body } = setup();
    frame(eliteMob("poxBehemoth"), 1000);
    expect(ring.state.visible).toBe(true);
    expect(star.state.visible).toBe(true);
    expect(label.state.color).toBe("#ffd54f");
    expect(String(body.state.texture)).toContain(":ffd54f:");
  });

  it("flashes the emblem white with the body for as long as the hit flash lasts, then back", () => {
    let now = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { view, frame, back, front, body } = setup();
    frame(eliteMob("avalancheTroll"), 1000);
    expect(key(back)).toBe("bk:elite:avalancheTroll:back");
    view.flash(120);
    frame(eliteMob("avalancheTroll"), 1016);
    expect(key(back)).toBe("bk:elite:avalancheTroll:back:flash");
    expect(key(front)).toBe("bk:elite:avalancheTroll:front:flash");
    expect(String(body.state.texture)).toContain(":ffffff:"); // the disc turns white at the same time
    now += 119;
    frame(eliteMob("avalancheTroll"), 1032);
    expect(key(back)).toBe("bk:elite:avalancheTroll:back:flash");
    now += 2;
    frame(eliteMob("avalancheTroll"), 1048);
    expect(key(back)).toBe("bk:elite:avalancheTroll:back");
    expect(key(front)).toBe("bk:elite:avalancheTroll:front");
    // A flash on a mob with no emblem does nothing to it.
    const plain = setup();
    plain.view.flash(120);
    plain.frame(mob(), 1000);
    expect(plain.back.state.visible).toBe(false);
    expect(plain.front.state.visible).toBe(false);
  });

  it("is drawn in the container (under the body disc and over it and its role mark), so the death fade and shrink carry it away with the body", () => {
    const { frame, root, kids, back, front } = setup();
    expect(kids.indexOf(back)).toBeGreaterThan(CHILD.eliteRing - 1);
    expect(kids.indexOf(back)).toBeLessThan(CHILD.body);
    expect(kids.indexOf(front)).toBeGreaterThan(CHILD.roleGlyph);
    expect(kids.indexOf(front)).toBeLessThan(kids.indexOf(kids[CHILD.label]!));
    frame(eliteMob("bloodSaint"), 1000);
    frame(eliteMob("bloodSaint", { status: "dead", hp: 0 }), 1000, 1000);
    frame(eliteMob("bloodSaint", { status: "dead", hp: 0 }), 1000 + DEATH_MS / 2, 1100);
    expect(root.state.alpha).toBeCloseTo(0.5, 9);
    expect(front.state.visible).toBe(true);
    frame(eliteMob("bloodSaint", { status: "dead", hp: 0 }), 1000 + DEATH_MS, 1500);
    expect(root.state.visible).toBe(false);
  });

  it("is posed with the figure: a lunge or squash moves and scales the emblem layers as it does the body", () => {
    const { view, frame, back, front, body } = setup();
    frame(eliteMob("executioner"), 1000); // an axe on the back and a cowl: both layers
    for (const image of [back, front, body]) image.calls.length = 0;
    view.cues.launch(0, performance.now());
    for (let t = 1016; t < 1400; t += 16) frame(eliteMob("executioner"), t);
    expect(argsOf(body, "setScale").length).toBeGreaterThan(0);
    expect(argsOf(back, "setScale").length).toBe(argsOf(body, "setScale").length);
    expect(argsOf(front, "setScale").length).toBe(argsOf(body, "setScale").length);
    expect(argsOf(back, "setPosition").length).toBe(argsOf(body, "setPosition").length);
  });

  it("bakes each texture once however many elites of a type there are, and only the layers the type has", () => {
    const { scene, baked } = fakeScene();
    const a = new MobView(scene);
    const b = new MobView(scene);
    a.update(0, 0, eliteMob("wyrmling"), 1000, 1000);
    const after = baked.size;
    b.update(0, 0, eliteMob("wyrmling"), 1000, 1000);
    expect(baked.size).toBe(after);
    expect([...baked.keys()].filter((k) => k.startsWith("bk:elite:"))).toEqual(
      ELITE_LAYERS.filter((l) => eliteArtOf("wyrmling")![l] !== null).map((l) => `bk:${eliteArtKey("wyrmling", l)}`),
    );
  });
});
