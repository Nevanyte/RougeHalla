// MobView (Phase 11): the death fade on render time, the elite marks, and when the bar and the name show. The scene is fake
// (test/fakes.ts); the views are found by their place in the container the view builds.
import { describe, expect, it } from "vitest";
import { EFFECT_DOT, EFFECT_STUNNED } from "@raid/shared";
import type { MobState } from "@raid/shared/schema";
import { MobView } from "../src/render/MobView";
import { NO_STATES, type TerrainStates } from "../src/render/zoneArt/terrainFeedback";
import { fakeScene, type FakeObject } from "./fakes";

/** Matches `scene.add.container(0, 0, [...])` in MobView's constructor. */
const CHILD = { eliteRing: 1, hpBar: 8, label: 9, eliteStar: 10, status: 11 } as const;
const DEATH_MS = 450;

function mob(over: Partial<Record<keyof MobState, unknown>> = {}): MobState {
  return {
    kind: "mob", name: "Grunt", x: 0, y: 0, facing: 0, hp: 300, maxHp: 300, status: "alive", faction: "sentenced", weapon0: "sword",
    weapon1: "", slot: 0, drawStartedAt: 0, readyAt: 0, sig: 0, brand: 0, ...over,
  } as unknown as MobState;
}

function setup() {
  const { scene, ofKind } = fakeScene();
  const view = new MobView(scene);
  const root = ofKind("container")[0]!;
  const kids = root.args[2] as FakeObject[];
  return {
    view, root,
    ring: kids[CHILD.eliteRing]!, bar: kids[CHILD.hpBar]!, label: kids[CHILD.label]!, star: kids[CHILD.eliteStar]!,
    status: kids[CHILD.status]!,
    /** One frame at render time `t` with the newest patch at `patchT`. */
    frame: (m: MobState, t: number, patchT = t) => view.update(0, 0, m, t, patchT),
  };
}

describe("MobView death fade", () => {
  it("keeps the body whole until render time reaches the patch that showed it dead, then fades it out by 450 ms", () => {
    const { root, frame } = setup();
    const dead = mob({ status: "dead", hp: 0 });
    frame(mob(), 900, 950);
    frame(dead, 950, 1000); // the state says dead; the body is drawn 50 ms behind it
    frame(dead, 1000, 1050);
    expect(root.state.visible).toBe(true);
    expect(root.state.alpha).toBeUndefined(); // untouched: still whole
    frame(dead, 1000 + DEATH_MS / 2, 1100);
    expect(root.state.visible).toBe(true);
    expect(root.state.alpha).toBeCloseTo(0.5, 9);
    expect(root.state.scale).toBeCloseTo(1 - 0.5 * (1 - 0.45), 9);
    frame(dead, 1000 + DEATH_MS - 1, 1500);
    expect(root.state.visible).toBe(true);
    frame(dead, 1000 + DEATH_MS, 1500);
    expect(root.state.visible).toBe(false);
    frame(dead, 5000, 5000);
    expect(root.state.visible).toBe(false);
  });

  it("dates the death by the first dead patch, not by later ones", () => {
    const { root, frame } = setup();
    const dead = mob({ status: "dead", hp: 0 });
    frame(dead, 1000, 1000);
    frame(dead, 1200, 1900); // patches keep coming for a corpse
    expect(root.state.alpha).toBeCloseTo(1 - 200 / DEATH_MS, 9);
  });

  it("resets the alpha and the scale when the mob is alive again", () => {
    const { root, frame } = setup();
    frame(mob({ status: "dead", hp: 0 }), 1000, 1000);
    frame(mob({ status: "dead", hp: 0 }), 1300, 1300);
    expect(root.state.alpha).toBeLessThan(0.5);
    expect(root.state.scale).toBeLessThan(0.8);
    frame(mob(), 1350, 1350);
    expect(root.state.visible).toBe(true);
    expect(root.state.alpha).toBe(1);
    expect(root.state.scale).toBe(1);
  });

  it("starts a new fade from the new death after a revival", () => {
    const { root, frame } = setup();
    frame(mob({ status: "dead", hp: 0 }), 1000, 1000);
    frame(mob(), 1100, 1100);
    frame(mob({ status: "dead", hp: 0 }), 2000, 2000);
    frame(mob({ status: "dead", hp: 0 }), 2225, 2225);
    expect(root.state.alpha).toBeCloseTo(0.5, 9);
  });
});

describe("MobView bar and name around a death", () => {
  it("keeps the elite's bar, name and star until render time reaches the death, not the first dead patch", () => {
    const { frame, bar, label, star } = setup();
    const elite = mob({ kind: "elite", name: "Warden", maxHp: 700, hp: 400 });
    const dead = mob({ kind: "elite", name: "Warden", maxHp: 700, hp: 0, status: "dead" });
    frame(elite, 900, 950);
    expect(bar.calls.length).toBeGreaterThan(0);
    expect(star.state.visible).toBe(true);
    // The dead patch (server time 1000) is 100 ms ahead of what is drawn: the body, the name and the bar still show.
    frame(dead, 900, 1000);
    expect(label.state.visible).toBe(true);
    expect(star.state.visible).toBe(true);
    expect(bar.calls.length).toBeGreaterThan(0);
    frame(dead, 999, 1100);
    expect(label.state.visible).toBe(true);
    expect(star.state.visible).toBe(true);
    // Render time reaches the death: the body starts to fade and the marks go.
    frame(dead, 1000, 1100);
    expect(label.state.visible).toBe(false);
    expect(star.state.visible).toBe(false);
    expect(bar.calls).toEqual([]);
  });
});

describe("MobView bar and name by state", () => {
  it("shows a calm mob's name faintly and no bar; hurt or fighting, the bar and the name at full strength", () => {
    const { frame, bar, label } = setup();
    frame(mob(), 1000, 1000);
    expect(bar.calls).toEqual([]);
    expect(label.state.alpha).toBe(0.5);
    expect(label.state.text).toBe("Grunt");
    frame(mob({ hp: 250 }), 1050, 1050);
    expect(bar.calls.length).toBeGreaterThan(0);
    expect(label.state.alpha).toBe(1);
    // Healed back to full and idle: the bar goes again.
    frame(mob(), 1100, 1100);
    expect(bar.calls).toEqual([]);
    expect(label.state.alpha).toBe(0.5);
    // Swinging (its cooldown is running) or drawing a bow counts as fighting, at full health.
    frame(mob({ readyAt: 1300 }), 1150, 1150);
    expect(bar.calls.length).toBeGreaterThan(0);
    frame(mob({ weapon0: "bow", drawStartedAt: 1160 }), 1200, 1200);
    expect(bar.calls.length).toBeGreaterThan(0);
  });

  it("always shows an elite's bar, gold ring, star and gold bold name; a normal mob has none of them", () => {
    const { frame, bar, label, star, ring } = setup();
    frame(mob({ kind: "elite", name: "Warden", maxHp: 700, hp: 700 }), 1000, 1000);
    expect(bar.calls.length).toBeGreaterThan(0);
    expect(star.state.visible).toBe(true);
    expect(ring.state.visible).toBe(true);
    expect(label.state.alpha).toBeUndefined(); // full strength from the start
    expect(label.state.color).toBe("#ffd54f");
    expect(label.state.fontStyle).toBe("bold");
    // The same view reused for a normal mob (ids are not reused, but the marks must follow the kind).
    frame(mob(), 1050, 1050);
    expect(star.state.visible).toBe(false);
    expect(ring.state.visible).toBe(false);
    expect(bar.calls).toEqual([]);
  });

  it("keeps a training dummy's bar and name on, and draws no bar for a mob without hp", () => {
    const { frame, bar, label } = setup();
    frame(mob({ kind: "dummy", name: "Dummy", maxHp: 500, hp: 500 }), 1000, 1000);
    expect(bar.calls.length).toBeGreaterThan(0);
    expect(label.state.alpha).toBeUndefined();
    const none = setup();
    none.frame(mob({ kind: "elite", maxHp: 0, hp: 0 }), 1000, 1000);
    expect(none.bar.calls).toEqual([]);
  });
});

describe("MobView status marks", () => {
  it("draws the status layers for the synced effects, and nothing for none", () => {
    const { frame, status } = setup();
    frame(mob({ effects: 0 }), 1000);
    expect(status.calls).toEqual([]);
    frame(mob({ effects: EFFECT_STUNNED | EFFECT_DOT }), 1050);
    expect(status.calls.length).toBeGreaterThan(0);
    frame(mob({ effects: 0 }), 1100);
    expect(status.calls).toEqual([]);
  });

  it("works for a mob state that has no effects field at all", () => {
    const { frame, status } = setup();
    expect(() => frame(mob(), 1000)).not.toThrow();
    expect(status.calls).toEqual([]);
  });

  it("clears the marks when the body has faded away", () => {
    const { frame, status } = setup();
    const stunned = { effects: EFFECT_STUNNED, status: "dead", hp: 0 } as const;
    frame(mob({ effects: EFFECT_STUNNED }), 900);
    expect(status.calls.length).toBeGreaterThan(0);
    frame(mob(stunned), 1000, 1000);
    frame(mob(stunned), 1450, 1450);
    expect(status.calls).toEqual([]);
  });
});

describe("MobView feet effects", () => {
  const burning: TerrainStates = { ...NO_STATES, kind: 4, burning: true };

  it("makes no Graphics for them until the mob first stands on a hazard, then once", () => {
    const { scene, ofKind } = fakeScene();
    const view = new MobView(scene);
    const made = ofKind("graphics").length;
    for (let i = 0; i < 3; i++) view.update(0, 0, mob(), 1000 + i, 1000 + i);
    view.update(0, 0, mob({ status: "dead", hp: 0 }), 5000, 5000); // faded out: hides a feet effect that was never made
    expect(ofKind("graphics")).toHaveLength(made);
    view.update(0, 0, mob(), 6000, 6000, false, burning);
    expect(ofKind("graphics")).toHaveLength(made + 1);
    view.update(0, 0, mob(), 6050, 6050, false, burning);
    expect(ofKind("graphics")).toHaveLength(made + 1);
    const feet = ofKind("graphics")[made]!;
    expect(feet.state.visible).toBe(true);
    view.update(0, 0, mob(), 6100, 6100);
    expect(feet.state.visible).toBe(false);
    view.destroy();
    expect(feet.calls.some(([n]) => n === "destroy")).toBe(true);
  });

  it("destroys cleanly when it never made them", () => {
    const { view } = setup();
    expect(() => view.destroy()).not.toThrow();
  });
});
