// The cast effects (render/WishFx.ts): a telegraph per ability art while a cast is in progress, an impact when it lands, a puff
// when it fails, stars for a stun; pooled, bounded and gone with the scene. The scene is fake (test/fakes.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ABILITIES, Y_SCALE, type AbilityId, type TimedFx } from "@raid/shared";
import { resetReducedMotionCache } from "../src/render/juice";
import { DEFAULT_SETTINGS, updateSettings } from "../src/settings";
import { WishFx, type WishFxHost } from "../src/render/WishFx";
import { argsOf, fakeScene, type FakeObject } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
  updateSettings({ ...DEFAULT_SETTINGS });
});

const cast = (by: string, ability: AbilityId, ms: number, target: string | null = null, x = 100, y = 100): TimedFx => ({
  kind: "cast", by, ability, ms, target, x, y, t: 0,
});
const land = (by: string, ability: AbilityId, x = 100, y = 100, x2?: number, y2?: number): TimedFx =>
  ({ kind: "castLand", by, ability, target: null, x, y, ...(x2 !== undefined ? { x2, y2 } : {}), t: 0 }) as TimedFx;
const end = (by: string, ability: AbilityId, reason: "fizzle" | "interrupted" | "cancelled" = "fizzle"): TimedFx => ({
  kind: "castEnd", by, ability, reason, t: 0,
});
const status = (id: string, kind: "stun" | "root"): TimedFx => ({ kind: "status", id, status: kind, ms: 1000, by: "x", t: 0 });

function setup(host: Partial<WishFxHost> = {}) {
  const positions = new Map<string, { x: number; y: number }>([["me", { x: 10, y: 20 }], ["foe", { x: 200, y: 120 }], ["ally", { x: 50, y: 60 }]]);
  const { scene, made, ofKind } = fakeScene();
  const fx = new WishFx(scene, { localId: "me", position: (id) => positions.get(id), ...host });
  const live = () => made.filter((g) => g.state.visible !== false && g.calls.length > 0);
  return { fx, made, ofKind, positions, live };
}

describe("WishFx telegraphs", () => {
  it("draws nothing for events it does not know", () => {
    const { fx, made } = setup();
    fx.play({ kind: "hit", id: "foe", by: "me", amount: 5, weapon: "sword", t: 0 }, 0);
    fx.play(status("foe", "root"), 0);
    fx.update(10);
    expect(made).toHaveLength(0);
  });

  it("draws Freeze's telegraph as a beam from the caster to the target, over the cast's ms", () => {
    const { fx, made } = setup();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    expect(made).toHaveLength(1);
    fx.update(1100);
    const g = made[0]!;
    const [line] = argsOf(g, "lineBetween");
    expect(line![0]).toBeCloseTo(10, 6); // the caster as drawn, at body height
    expect(line![1]).toBeCloseTo(20 * Y_SCALE - 14, 6);
    expect(line![2]).toBeCloseTo(200, 6);
    expect(line![3]).toBeCloseTo(120 * Y_SCALE - 14, 6);
    // It grows with the cast: a thicker line late than early.
    const early = argsOf(g, "lineStyle")[0]![0] as number;
    fx.update(1240);
    expect(argsOf(g, "lineStyle")[0]![0] as number).toBeGreaterThan(early);
  });

  it("follows the fighters as they move", () => {
    const { fx, made, positions } = setup();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    fx.update(1050);
    positions.set("foe", { x: 260, y: 140 });
    fx.update(1100);
    const [line] = argsOf(made[0]!, "lineBetween");
    expect(line![2]).toBeCloseTo(260, 6);
  });

  it("draws Trial's telegraph as a ring that grows to the zone's radius at the target", () => {
    const { fx, made } = setup();
    fx.play(cast("me", "trial", 350, "foe", 200, 120), 1000);
    fx.update(1349);
    const g = made[0]!;
    expect(g.state.position).toEqual([200, 120 * Y_SCALE]);
    const [r] = argsOf(g, "strokeEllipse");
    expect(r![2]).toBeGreaterThan(550); // nearly the full 2 x 300 by the end of the cast
    expect(r![2]).toBeLessThanOrEqual(600);
    fx.update(1010);
    expect(argsOf(g, "strokeEllipse")[0]![2] as number).toBeLessThan(r![2] as number);
  });

  it("draws Swarm's telegraph as motes gathering on the caster", () => {
    const { fx, made } = setup();
    fx.play(cast("me", "swarm", 250, null, 10, 20), 1000);
    fx.update(1100);
    expect(argsOf(made[0]!, "fillCircle").length).toBeGreaterThanOrEqual(8);
    expect(made[0]!.state.position).toEqual([10, 20 * Y_SCALE - 14]);
  });

  it("holds the swirl and the ring still under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    resetReducedMotionCache();
    const { fx, made } = setup();
    fx.play(cast("me", "swarm", 250, null, 10, 20), 1000);
    fx.play(cast("foe", "trial", 350, "ally", 50, 60), 1000);
    fx.update(1050);
    const swirl = JSON.stringify(argsOf(made[0]!, "fillCircle").map((a) => a.slice(0, 3)));
    const ring = JSON.stringify(argsOf(made[1]!, "strokeEllipse"));
    fx.update(1200);
    expect(JSON.stringify(argsOf(made[0]!, "fillCircle").map((a) => a.slice(0, 3)))).toBe(swirl);
    expect(JSON.stringify(argsOf(made[1]!, "strokeEllipse"))).toBe(ring);
  });

  it("replaces a caster's earlier telegraph, and keeps two casters' apart", () => {
    const { fx, live } = setup();
    fx.play(cast("me", "swarm", 250), 1000);
    fx.play(cast("foe", "freeze", 250, "me"), 1000);
    fx.update(1010);
    expect(live()).toHaveLength(2);
    fx.play(cast("me", "swarm", 250), 1020);
    fx.update(1030);
    expect(live()).toHaveLength(2);
  });

  it("lets a telegraph run out by itself if nothing ends it", () => {
    const { fx, live } = setup();
    fx.play(cast("me", "freeze", 250, "foe"), 1000);
    fx.update(1200);
    expect(live()).toHaveLength(1);
    fx.update(1260);
    expect(live()).toHaveLength(0);
  });

  it("bounds a malformed duration", () => {
    const { fx, live } = setup();
    fx.play(cast("me", "freeze", 9_000_000, "foe"), 1000);
    fx.update(2600);
    expect(live()).toHaveLength(0);
    fx.play(cast("me", "freeze", Number.NaN, "foe"), 3000);
    fx.update(3010);
    expect(live()).toHaveLength(0);
  });

  it("does not draw a hidden remote caster's telegraph, but does draw the viewer's own", () => {
    const { fx, made } = setup({ hidden: () => true });
    fx.play(cast("foe", "swarm", 250, null, 200, 120), 1000);
    fx.update(1010);
    expect(made).toHaveLength(0);
    fx.play(cast("me", "swarm", 250, null, 10, 20), 1000);
    fx.update(1010);
    expect(made).toHaveLength(1);
  });

  it("anchors at where the cast said when the caster is not drawn", () => {
    const { fx, made } = setup();
    fx.play(cast("stranger", "swarm", 250, null, 300, 90), 1000);
    fx.update(1100);
    expect(made[0]!.state.position).toEqual([300, 90 * Y_SCALE - 14]);
  });
});

describe("WishFx landings", () => {
  it("drops the telegraph and plays an impact in the ability's style", () => {
    const { fx, live } = setup();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    fx.update(1100);
    fx.play(land("me", "freeze", 200, 120), 1250);
    fx.update(1260);
    expect(live()).toHaveLength(1);
    // The impact (shards, not the beam's line): it is a burst at the target's body height.
    const g = live()[0]!;
    expect(g.state.position).toEqual([200, 120 * Y_SCALE - 14]);
    expect(argsOf(g, "lineBetween").length).toBeGreaterThanOrEqual(8);
  });

  it("slams Trial's ring out to the zone's edge", () => {
    const { fx, made } = setup();
    fx.play(land("me", "trial", 200, 120), 1000);
    fx.update(1100);
    const [r] = argsOf(made[0]!, "strokeEllipse");
    expect(r![2]).toBeGreaterThan(400);
    expect(r![2]).toBeLessThanOrEqual(600);
  });

  it("flashes both ends of a Blaze Step and streaks between them", () => {
    const { fx, made } = setup();
    fx.play(land("me", "blaze", 100, 100, 250, 140), 1000);
    fx.update(1100);
    const g = made[0]!;
    expect(argsOf(g, "lineBetween")).toHaveLength(1);
    expect(argsOf(g, "fillCircle").length).toBeGreaterThanOrEqual(20); // flash, glow and eight embers at each end
    const xs = argsOf(g, "fillCircle").map((a) => a[0] as number);
    expect(xs.some((x) => Math.abs(x - 100) < 40)).toBe(true);
    expect(xs.some((x) => Math.abs(x - 250) < 40)).toBe(true);
  });

  it("draws a Blaze Step with no landing point once, not twice", () => {
    const { fx, made } = setup();
    fx.play(land("me", "blaze", 100, 100), 1000);
    fx.update(1100);
    expect(argsOf(made[0]!, "lineBetween")).toHaveLength(0);
    expect(argsOf(made[0]!, "fillCircle").length).toBeLessThan(20);
  });

  it("bursts gold for Last Stand and settles Swarm's puff on the caster", () => {
    const { fx, live } = setup();
    fx.play(land("me", "lastStand", 10, 20), 1000);
    fx.play(land("foe", "swarm", 200, 120), 1000);
    fx.update(1100);
    expect(live()).toHaveLength(2);
    fx.update(1700);
    expect(live()).toHaveLength(0);
  });

  it("styles every Wish: an impact for each, in the ability's colour", () => {
    for (const id of ["freeze", "swarm", "trial", "blaze", "lastStand"] as const) {
      const { fx, live } = setup();
      fx.play(land("me", id, 100, 100, id === "blaze" ? 200 : undefined, id === "blaze" ? 100 : undefined), 1000);
      fx.update(1050);
      const g = live()[0];
      expect(g, id).toBeDefined();
      const colours = [...argsOf(g!, "fillStyle"), ...argsOf(g!, "lineStyle")].map((a) => a[a.length === 3 ? 1 : 0]);
      expect(colours, id).toContain(ABILITIES[id].color);
    }
  });
});

describe("WishFx fizzles and stuns", () => {
  it("drops the telegraph with a small puff where it was", () => {
    const { fx, live } = setup();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    fx.update(1100);
    fx.play(end("me", "freeze", "interrupted"), 1150);
    fx.update(1160);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.state.position).toEqual([10, 20 * Y_SCALE - 14]); // the caster, where the telegraph was anchored
    fx.update(1500);
    expect(live()).toHaveLength(0);
  });

  it("makes a puff for a cast that ended before anything was drawn, at the caster as drawn", () => {
    const { fx, live } = setup();
    fx.play(end("ally", "trial", "cancelled"), 1000);
    fx.update(1050);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.state.position).toEqual([50, 60 * Y_SCALE - 14]);
  });

  it("makes no puff for a caster it cannot place, or a hidden remote one", () => {
    const { fx, made } = setup({ hidden: (id) => id === "ally" });
    fx.play(end("stranger", "trial"), 1000);
    fx.play(end("ally", "trial"), 1000);
    fx.update(1050);
    expect(made).toHaveLength(0);
  });

  it("bursts stars off a stunned fighter's head, and ignores other statuses", () => {
    const { fx, live, made } = setup();
    fx.play(status("foe", "root"), 1000);
    fx.update(1010);
    expect(made).toHaveLength(0);
    fx.play(status("foe", "stun"), 1000);
    fx.update(1100);
    expect(live()).toHaveLength(1);
    expect(argsOf(live()[0]!, "lineBetween").length).toBeGreaterThanOrEqual(12); // six stars, two strokes each
    expect(live()[0]!.state.position).toEqual([200, 120 * Y_SCALE - (14 + 12 + 8)]);
    fx.update(1600);
    expect(live()).toHaveLength(0);
  });

  it("follows the stunned fighter as it is drawn", () => {
    const { fx, live, positions } = setup();
    fx.play(status("foe", "stun"), 1000);
    fx.update(1050);
    positions.set("foe", { x: 240, y: 130 });
    fx.update(1100);
    expect(live()[0]!.state.position).toEqual([240, 130 * Y_SCALE - 34]);
  });

  it("ignores a stun on a fighter it cannot place", () => {
    const { fx, made } = setup();
    fx.play(status("stranger", "stun"), 1000);
    expect(made).toHaveLength(0);
  });
});

describe("WishFx pool and teardown", () => {
  it("reuses a finished effect's Graphics for the next one", () => {
    const { fx, made } = setup();
    fx.play(land("me", "lastStand", 10, 20), 1000);
    fx.update(1010);
    fx.update(1700);
    expect(made).toHaveLength(1);
    fx.play(land("me", "lastStand", 10, 20), 2000);
    fx.update(2010);
    expect(made).toHaveLength(1);
    expect(made[0]!.state.visible).toBe(true);
  });

  it("caps the effects alive at once and keeps a telegraph over a burst", () => {
    const { fx, made, live } = setup();
    fx.play(cast("me", "freeze", 1500, "foe"), 1000);
    for (let i = 0; i < 100; i++) fx.play(status("foe", "stun"), 1000);
    fx.update(1010);
    expect(made.length).toBeLessThanOrEqual(33);
    expect(live().length).toBeLessThanOrEqual(33);
    // The telegraph (the first Graphics made) survived the flood.
    expect(made[0]!.state.visible).not.toBe(false);
    expect(argsOf(made[0]!, "lineBetween").length).toBeGreaterThan(0);
  });

  it("destroys everything on destroy() and ignores later events", () => {
    const { fx, made } = setup();
    fx.play(cast("me", "freeze", 250, "foe"), 1000);
    fx.play(land("foe", "lastStand", 10, 10), 1000);
    fx.update(1010);
    fx.update(1700);
    const before = made.length;
    fx.destroy();
    for (const g of made) expect(argsOf(g as FakeObject, "destroy").length).toBeGreaterThanOrEqual(1);
    fx.play(cast("me", "freeze", 250, "foe"), 2000);
    fx.update(2010);
    expect(made).toHaveLength(before);
  });
});

// A hidden (Swarm) remote fighter is not drawn, so nothing may be drawn on it or follow it either.
describe("WishFx and a hidden fighter", () => {
  function hiding() {
    const hiddenIds = new Set<string>();
    const rig = setup({ hidden: (id) => hiddenIds.has(id) });
    return { ...rig, hiddenIds };
  }

  it("bursts no stars on a hidden remote fighter, and draws them on the viewer's own", () => {
    const { fx, made, hiddenIds } = hiding();
    hiddenIds.add("foe");
    hiddenIds.add("me"); // the viewer's own fighter is never a hidden remote one
    fx.play(status("foe", "stun"), 1000);
    fx.update(1050);
    expect(made).toHaveLength(0);
    fx.play(status("me", "stun"), 1000);
    fx.update(1050);
    expect(made).toHaveLength(1);
  });

  it("ends a star burst quietly when its fighter turns hidden", () => {
    const { fx, live, hiddenIds } = hiding();
    fx.play(status("foe", "stun"), 1000);
    fx.update(1100);
    expect(live()).toHaveLength(1);
    hiddenIds.add("foe");
    fx.update(1150);
    expect(live()).toHaveLength(0);
  });

  it("ends a Freeze beam quietly when its target turns hidden mid-cast, instead of following it", () => {
    const { fx, made, live, positions, hiddenIds } = hiding();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    fx.update(1050);
    expect(live()).toHaveLength(1);
    hiddenIds.add("foe");
    positions.set("foe", { x: 260, y: 160 }); // the hidden foe walks on
    fx.update(1100);
    expect(live()).toHaveLength(0);
    const drawn = JSON.stringify(made.flatMap((g) => g.calls));
    expect(drawn).not.toContain("260");
  });

  it("ends a Trial ring quietly when its target turns hidden mid-cast", () => {
    const { fx, live, positions, hiddenIds } = hiding();
    fx.play(cast("me", "trial", 350, "foe", 200, 120), 1000);
    fx.update(1050);
    expect(live()).toHaveLength(1);
    hiddenIds.add("foe");
    positions.set("foe", { x: 260, y: 160 });
    fx.update(1100);
    expect(live()).toHaveLength(0);
  });

  it("draws no telegraph at all for a cast whose target is already hidden", () => {
    const { fx, made, hiddenIds } = hiding();
    hiddenIds.add("foe");
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    fx.play(cast("me", "trial", 350, "foe", 200, 120), 1000);
    fx.update(1050);
    expect(made).toHaveLength(0);
  });

  it("still draws a beam at a visible target, and the target keeps being followed", () => {
    const { fx, made, positions } = hiding();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    positions.set("foe", { x: 260, y: 160 });
    fx.update(1100);
    expect(argsOf(made[0]!, "lineBetween")[0]![2]).toBeCloseTo(260, 6);
  });
});

// Landing flashes (white blooms and glows) are brightness: they honour the flash scale (juice off); the shapes stay.
describe("WishFx landing flashes under the juice setting", () => {
  const whites = (g: FakeObject) =>
    [...argsOf(g, "fillStyle").map((a) => a[0]), ...argsOf(g, "lineStyle").map((a) => a[1])].filter((c) => c === 0xffffff).length;
  const IDS = ["freeze", "swarm", "trial", "blaze", "lastStand"] as const;
  const landed = (id: (typeof IDS)[number]) => land("me", id, 100, 100, id === "blaze" ? 220 : undefined, id === "blaze" ? 130 : undefined);

  it("draws white flashes at the default setting", () => {
    for (const id of ["freeze", "trial", "blaze", "swarm", "lastStand"] as const) {
      const { fx, live } = setup();
      fx.play(landed(id), 1000);
      fx.update(1050);
      expect(live().reduce((n, g) => n + whites(g), 0), id).toBeGreaterThan(0);
    }
  });

  it("draws none of them with juice off, but still the burst itself", () => {
    updateSettings({ juice: 0 });
    for (const id of IDS) {
      const { fx, live } = setup();
      fx.play(landed(id), 1000);
      fx.update(1050);
      const g = live();
      expect(g.length, id).toBe(1);
      expect(g.reduce((n, o) => n + whites(o), 0), id).toBe(0);
      expect(g[0]!.calls.length, id).toBeGreaterThan(0);
    }
  });

  it("leaves a telegraph alone: it is information, not a flash", () => {
    updateSettings({ juice: 0 });
    const { fx, live } = setup();
    fx.play(cast("me", "freeze", 250, "foe", 200, 120), 1000);
    fx.update(1100);
    expect(live()).toHaveLength(1);
    expect(whites(live()[0]!)).toBeGreaterThan(0);
  });
});
