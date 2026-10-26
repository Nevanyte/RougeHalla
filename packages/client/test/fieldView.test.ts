// The area view (render/FieldView.ts): the pure fade, centre and cloud smoothing, and the view's bookkeeping (a Graphics per
// field, hidden until due, gone with the field). The scene is fake (test/fakes.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetReducedMotionCache } from "../src/render/juice";
import { CLOUD_MAX_LAG, CLOUD_TAU_MS, CLOUD_WOBBLE, CloudSmoother, FIELD_FADE_MS, FieldView, fieldAlpha, fieldCentre, type FieldStateLike } from "../src/render/FieldView";
import { Y_SCALE, ABILITY_IDS } from "@raid/shared";
import { argsOf, fakeScene } from "./fakes";

afterEach(() => {
  vi.unstubAllGlobals();
  resetReducedMotionCache();
});

describe("fieldAlpha", () => {
  it("is 0 before the field starts on the render clock", () => {
    expect(fieldAlpha(1000, 6000, 999)).toBe(0);
    expect(fieldAlpha(1000, 6000, 0)).toBe(0);
  });

  it("is 1 from its start until its last 300 ms", () => {
    expect(fieldAlpha(1000, 6000, 1000)).toBe(1);
    expect(fieldAlpha(1000, 6000, 3500)).toBe(1);
    expect(fieldAlpha(1000, 6000, 6000 - FIELD_FADE_MS)).toBe(1);
  });

  it("fades linearly to 0 over the last 300 ms", () => {
    expect(fieldAlpha(1000, 6000, 6000 - FIELD_FADE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(fieldAlpha(1000, 6000, 6000 - FIELD_FADE_MS / 3)).toBeCloseTo(1 / 3, 9);
    expect(fieldAlpha(1000, 6000, 6000)).toBe(0);
    expect(fieldAlpha(1000, 6000, 7000)).toBe(0);
  });

  it("treats an end of 0 as no end", () => {
    expect(fieldAlpha(1000, 0, 50000)).toBe(1);
    expect(fieldAlpha(1000, 0, 999)).toBe(0);
  });

  it("fades a field shorter than the fade from the start", () => {
    expect(fieldAlpha(1000, 1100, 1000)).toBeCloseTo(100 / FIELD_FADE_MS, 9);
  });
});

describe("fieldCentre", () => {
  const f = { x: 100, y: 200, vx: 0, vy: 0, startedAt: 1000 };

  it("is (x, y) for an area that does not move", () => {
    expect(fieldCentre(f, 5000)).toEqual({ x: 100, y: 200 });
  });

  it("moves at its velocity in units per second from its start", () => {
    expect(fieldCentre({ ...f, vx: 40, vy: -20 }, 3000)).toEqual({ x: 180, y: 160 });
    expect(fieldCentre({ ...f, vx: 40, vy: -20 }, 1500)).toEqual({ x: 120, y: 190 });
  });

  it("does not run backwards before its start", () => {
    expect(fieldCentre({ ...f, vx: 40, vy: -20 }, 0)).toEqual({ x: 100, y: 200 });
  });
});

describe("CloudSmoother", () => {
  it("starts on its target", () => {
    const c = new CloudSmoother();
    expect(c.step({ x: 50, y: -20 }, 1000, 0)).toEqual({ x: 50, y: -20 });
  });

  it("closes 1 - 1/e of the gap in one time constant", () => {
    const c = new CloudSmoother(CLOUD_TAU_MS, CLOUD_WOBBLE, 1000);
    c.step({ x: 0, y: 0 }, 1000, 0);
    const at = c.step({ x: 30, y: 0 }, 1000 + CLOUD_TAU_MS, 0);
    expect(at.x).toBeCloseTo(30 * (1 - Math.exp(-1)), 9);
    expect(at.y).toBeCloseTo(0, 9);
  });

  it("settles on a target that stays put", () => {
    const c = new CloudSmoother(CLOUD_TAU_MS, CLOUD_WOBBLE, 1000);
    c.step({ x: 0, y: 0 }, 0, 0);
    let at = { x: 0, y: 0 };
    for (let t = 50; t <= 5000; t += 50) at = c.step({ x: 30, y: 12 }, t, 0);
    expect(at.x).toBeCloseTo(30, 3);
    expect(at.y).toBeCloseTo(12, 3);
  });

  it("never trails its owner by more than the leash, so the owner stays inside the swarm", () => {
    const c = new CloudSmoother();
    c.step({ x: 0, y: 0 }, 0, 0);
    // An owner running away at 170 u/s.
    let worst = 0;
    for (let t = 50; t <= 4000; t += 50) {
      const target = { x: 170 * (t / 1000), y: 0 };
      const at = c.step(target, t, 0);
      worst = Math.max(worst, Math.hypot(target.x - at.x, target.y - at.y));
    }
    expect(worst).toBeLessThanOrEqual(CLOUD_MAX_LAG + 1e-9);
    expect(worst).toBeGreaterThan(CLOUD_MAX_LAG - 1); // the plain smoothing would trail by about 68 u, so the leash is what holds it
  });

  it("wobbles by at most the wobble in each axis, and not at all when told to hold still", () => {
    const c = new CloudSmoother();
    const held = new CloudSmoother();
    for (let t = 0; t <= 6000; t += 37) {
      const at = c.step({ x: 0, y: 0 }, t);
      expect(Math.abs(at.x)).toBeLessThanOrEqual(CLOUD_WOBBLE + 1e-9);
      expect(Math.abs(at.y)).toBeLessThanOrEqual(CLOUD_WOBBLE + 1e-9);
      expect(held.step({ x: 0, y: 0 }, t, 0)).toEqual({ x: 0, y: 0 });
    }
  });

  it("does move (the wobble is not dead)", () => {
    const c = new CloudSmoother();
    const seen = new Set<string>();
    for (let t = 0; t <= 2000; t += 100) seen.add(JSON.stringify(c.step({ x: 0, y: 0 }, t)));
    expect(seen.size).toBeGreaterThan(5);
  });

  it("is deterministic and survives a clock that steps back", () => {
    const run = () => {
      const c = new CloudSmoother(CLOUD_TAU_MS, CLOUD_WOBBLE, CLOUD_MAX_LAG, 1.5);
      const out: unknown[] = [];
      for (const t of [0, 100, 50, 300, 300]) out.push(c.step({ x: t / 10, y: 0 }, t));
      return out;
    };
    expect(run()).toEqual(run());
    expect(JSON.stringify(run())).not.toContain("null");
  });
});

describe("FieldView", () => {
  const ZONE = 0;
  const CLOUD = 1;
  const TRAIL = 2;
  const field = (over: Partial<FieldStateLike> = {}): FieldStateLike => ({
    kind: ZONE, ability: ABILITY_IDS.indexOf("trial"), x: 100, y: 200, x2: 0, y2: 0, r: 300, vx: 0, vy: 0, owner: "p1", subject: "p2",
    startedAt: 1000, endsAt: 6000, ...over,
  });

  function setup(localId = "me") {
    const { scene, made, ofKind } = fakeScene();
    const view = new FieldView(scene);
    const fields = new Map<string, FieldStateLike>();
    const pos = new Map<string, { x: number; y: number }>();
    const frame = (renderT: number, now = renderT) => view.update(fields, renderT, now, (id) => pos.get(id), localId);
    return { view, fields, pos, frame, made, ofKind };
  }

  it("makes nothing for an empty map", () => {
    const { frame, made } = setup();
    frame(1000);
    expect(made).toEqual([]);
  });

  it("holds a field back until render time reaches its start", () => {
    const { fields, frame, made } = setup();
    fields.set("z", field());
    frame(900);
    expect(made).toHaveLength(0);
    frame(1000);
    expect(made).toHaveLength(1);
    expect(made[0]!.calls.length).toBeGreaterThan(0);
  });

  it("draws a zone as a dashed ring on the ground, flattened like the rest, at its centre, with a sweep of the time left", () => {
    const { fields, frame, ofKind } = setup();
    fields.set("z", field());
    frame(2000);
    const g = ofKind("graphics")[0]!;
    expect(g.state.position).toEqual([100, 200 * Y_SCALE]);
    const ellipses = argsOf(g, "strokeEllipse");
    expect(ellipses[0]).toEqual([0, 0, 600, 600 * Y_SCALE]); // the full ring, r = 300
    // The sweep arc closes 4/5 of the way round with 4000 of the 5000 ms left: its end is the angle -pi/2 + 2pi * 0.8.
    const lines = argsOf(g, "lineTo");
    expect(lines.length).toBeGreaterThan(20);
    frame(5000);
    const shorter = argsOf(g, "lineTo").length;
    expect(shorter).toBeLessThan(lines.length);
  });

  it("fades a field out over its last 300 ms and hides it once it is over", () => {
    const { fields, frame, ofKind } = setup();
    fields.set("z", field());
    frame(2000);
    const g = ofKind("graphics")[0]!;
    expect(g.state.alpha).toBe(1);
    frame(5850);
    expect(g.state.alpha as number).toBeCloseTo(0.5, 9);
    frame(6000);
    expect(g.state.visible).toBe(false);
  });

  it("destroys the Graphics of a field the server removed, and only that one", () => {
    const { fields, frame, ofKind } = setup();
    fields.set("a", field());
    fields.set("b", field({ kind: TRAIL, x2: 300, y2: 200, r: 20 }));
    frame(2000);
    const [ga, gb] = ofKind("graphics");
    fields.delete("a");
    frame(2050);
    expect(argsOf(ga!, "destroy")).toHaveLength(1);
    expect(argsOf(gb!, "destroy")).toHaveLength(0);
    frame(2100);
    expect(argsOf(ga!, "destroy")).toHaveLength(1); // once
  });

  it("makes one Graphics per field and reuses it frame after frame", () => {
    const { fields, frame, made } = setup();
    fields.set("a", field());
    fields.set("b", field({ kind: TRAIL, x2: 300, y2: 200, r: 20 }));
    fields.set("c", field({ kind: CLOUD, owner: "p1", r: 72 }));
    for (let t = 1000; t < 1500; t += 50) frame(t);
    expect(made).toHaveLength(3);
  });

  it("draws a trail as a band of the field's width between its ends, under the fighters", () => {
    const { fields, frame, ofKind } = setup();
    fields.set("t", field({ kind: TRAIL, ability: ABILITY_IDS.indexOf("blaze"), x: 100, y: 100, x2: 300, y2: 100, r: 20, endsAt: 3500 }));
    frame(1500);
    const g = ofKind("graphics")[0]!;
    expect(g.state.depth).toBeLessThan(0);
    const [first] = argsOf(g, "moveTo");
    // The band's first corner: the start offset by the half-width, along the normal (+y here), flattened.
    expect(first![0]).toBeCloseTo(100, 6);
    expect(first![1]).toBeCloseTo((100 + 20) * Y_SCALE, 6);
    expect(argsOf(g, "fillPath").length).toBeGreaterThan(0);
  });

  it("draws nothing for a trail with no length", () => {
    const { fields, frame, ofKind } = setup();
    fields.set("t", field({ kind: TRAIL, x: 100, y: 100, x2: 100, y2: 100, r: 20 }));
    frame(1500);
    expect(ofKind("graphics")[0]!.calls.filter(([n]) => n === "fillPath")).toHaveLength(0);
  });

  it("keeps a cloud on its owner's drawn position, lagging behind as it moves", () => {
    const { fields, pos, frame, ofKind } = setup();
    fields.set("c", field({ kind: CLOUD, ability: ABILITY_IDS.indexOf("swarm"), owner: "p1", r: 72, endsAt: 9000 }));
    pos.set("p1", { x: 400, y: 300 });
    frame(1000, 1000);
    const g = ofKind("graphics")[0]!;
    const [x0, y0] = g.state.position as [number, number];
    expect(Math.abs(x0 - 400)).toBeLessThanOrEqual(CLOUD_WOBBLE + 1e-6);
    expect(Math.abs(y0 - (300 * Y_SCALE - 14))).toBeLessThanOrEqual(CLOUD_WOBBLE + 1e-6);
    pos.set("p1", { x: 800, y: 300 });
    frame(1050, 1050);
    const [x1] = g.state.position as [number, number];
    expect(x1).toBeGreaterThan(x0 - CLOUD_WOBBLE * 2);
    expect(x1).toBeLessThan(800 - 20); // it has not jumped to the owner
  });

  it("falls back to the field's own point while its owner is not drawn", () => {
    const { fields, frame, ofKind } = setup();
    fields.set("c", field({ kind: CLOUD, owner: "gone", x: 250, y: 150, r: 72 }));
    frame(1000);
    const [x] = ofKind("graphics")[0]!.state.position as [number, number];
    expect(Math.abs(x - 250)).toBeLessThanOrEqual(CLOUD_WOBBLE + 1e-6);
  });

  it("draws the viewer's own cloud fainter than anyone else's", () => {
    const { fields, pos, frame, ofKind } = setup("p1");
    fields.set("mine", field({ kind: CLOUD, owner: "p1", r: 72, endsAt: 9000 }));
    fields.set("theirs", field({ kind: CLOUD, owner: "p2", r: 72, endsAt: 9000 }));
    pos.set("p1", { x: 0, y: 0 });
    pos.set("p2", { x: 100, y: 0 });
    frame(2000);
    const [mine, theirs] = ofKind("graphics");
    expect(mine!.state.alpha as number).toBeLessThan(theirs!.state.alpha as number);
    expect(theirs!.state.alpha).toBe(1);
  });

  it("buzzes a cloud's swarm with the clock", () => {
    const { fields, pos, frame, ofKind } = setup();
    fields.set("c", field({ kind: CLOUD, owner: "p1", r: 72, endsAt: 99000 }));
    pos.set("p1", { x: 0, y: 0 });
    frame(1000, 1000);
    const g = ofKind("graphics")[0]!;
    const dots = () => JSON.stringify(argsOf(g, "fillCircle"));
    const a = dots();
    frame(1700, 1700);
    expect(dots()).not.toBe(a);
  });

  it("holds a cloud's swarm still under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    resetReducedMotionCache();
    const { fields, pos, frame, ofKind } = setup();
    fields.set("c", field({ kind: CLOUD, owner: "p1", r: 72, endsAt: 99000 }));
    pos.set("p1", { x: 0, y: 0 });
    frame(1000, 1000);
    const g = ofKind("graphics")[0]!;
    const dots = () => JSON.stringify(argsOf(g, "fillCircle"));
    const a = dots();
    const where = JSON.stringify(g.state.position);
    expect(argsOf(g, "fillCircle").length).toBeGreaterThan(10);
    frame(1700, 1700);
    expect(dots()).toBe(a);
    expect(JSON.stringify(g.state.position)).toBe(where);
  });

  it("ignores a field of a kind it does not know, and destroys everything on destroy()", () => {
    const { view, fields, frame, made, ofKind } = setup();
    fields.set("odd", field({ kind: 99 }));
    fields.set("z", field());
    frame(2000);
    expect(made).toHaveLength(1);
    view.destroy();
    expect(argsOf(ofKind("graphics")[0]!, "destroy")).toHaveLength(1);
    frame(3000); // after destroy: nothing happens
    expect(made).toHaveLength(1);
  });
});
