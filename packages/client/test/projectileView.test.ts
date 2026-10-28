import { describe, expect, it } from "vitest";
import { packFx, unpackLaunches, type ProjectileLaunch, type TimedFx } from "@raid/shared";
import { ProjectileView } from "../src/render/ProjectileView";

/** A Graphics that draws nothing and remembers where it was last put. */
function fakeGraphic() {
  const state = { pos: null as [number, number] | null, visible: false, destroyed: false };
  const g: unknown = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => {
      if (prop === "setPosition") state.pos = [args[0] as number, args[1] as number];
      if (prop === "setVisible") state.visible = args[0] as boolean;
      if (prop === "destroy") state.destroyed = true;
      return g;
    },
  });
  return { g, state };
}

function setup() {
  const made: Array<ReturnType<typeof fakeGraphic>> = [];
  const scene = { add: { graphics: () => { const f = fakeGraphic(); made.push(f); return f.g; } } };
  return { view: new ProjectileView(scene as never), made };
}

const arrow: ProjectileLaunch = { id: "p1", kind: "arrow", x: 100, y: 200, vx: 900, vy: 0, t: 1000, range: 240 };
const end = (over: Partial<Extract<TimedFx, { kind: "projEnd" }>> = {}): Extract<TimedFx, { kind: "projEnd" }> => ({
  kind: "projEnd", id: "p1", proj: "arrow", x0: 130, y0: 200, t0: 1300, x: 130, y: 200, reason: "hit", t: 1300, ...over,
});

describe("ProjectileView launches", () => {
  it("flies a projectile a batch announced, from where and when it left", () => {
    const { view, made } = setup();
    view.noteLaunch(arrow);
    view.update(1000); // just left: the start
    expect(made).toHaveLength(1);
    const first = made[0]!.state.pos!;
    view.update(1100); // 100 ms on at 900 u/s: 90 u further east
    const second = made[0]!.state.pos!;
    expect(second[0] - first[0]).toBeGreaterThan(0);
    expect(made[0]!.state.visible).toBe(true);
  });

  it("does not show it before it left as drawn (the batch is ahead of render time)", () => {
    const { view, made } = setup();
    view.noteLaunch(arrow);
    view.update(900);
    expect(made).toHaveLength(0);
  });

  it("stops it at the end point its projEnd reported, even before that fx plays", () => {
    const { view, made } = setup();
    view.noteLaunch(arrow);
    view.noteEnd(end());
    view.update(1250); // 250 ms at 900 u/s would be 225 u: past the 30 u to the stop point
    const pinned = made[0]!.state.pos!;
    view.update(1280);
    expect(made[0]!.state.pos).toEqual(pinned);
  });

  it("takes an announcement once, and not again for one that already ended", () => {
    const { view, made } = setup();
    view.noteLaunch(arrow);
    view.noteLaunch({ ...arrow, x: 999 }); // a repeat: ignored
    view.update(1100);
    expect(made).toHaveLength(1);
    view.finish("p1");
    view.noteLaunch(arrow); // a late announcement of something already done
    view.update(1200);
    expect(made).toHaveLength(1);
    expect(made[0]!.state.destroyed).toBe(true);
  });

  it("flies one a joining client was sent in a batch of its own, from where it left, and does not double it when a batch announces it again", () => {
    const { view, made } = setup();
    const [sent] = unpackLaunches(packFx([], 1250, { launches: [arrow] })); // already 250 ms on its way
    view.noteLaunch(sent!);
    view.noteLaunch(arrow); // a batch queued behind the full state carried it too
    view.update(1100);
    expect(made).toHaveLength(1);
    expect(made[0]!.state.pos![0]).toBeGreaterThan(0);
  });

  it("draws a projectile whose launch it never saw from the start its projEnd carries", () => {
    const { view, made } = setup();
    view.noteEnd(end({ x0: 100, y0: 200, t0: 1000, x: 130, y: 200, t: 1100 }));
    view.update(1020);
    expect(made).toHaveLength(1);
  });

  it("has nothing to draw for an end without a start (the client has the launch, or there was no flight)", () => {
    const { view, made } = setup();
    view.noteEnd(end({ x0: 130, y0: 200, t0: 1300, x: 130, y: 200 })); // a start equal to the stop point
    view.update(1300);
    expect(made).toHaveLength(0);
  });

  it("turns a target-locked arrow toward each safe target sample", () => {
    const { view, made } = setup();
    view.noteLaunch({ ...arrow, targetId: "target", range: 4500 });
    view.update(1000, () => false);
    const start = made[0]!.state.pos!;
    view.update(1200, (id, t, out) => {
      expect(id).toBe("target");
      out.x = 400;
      out.y = 200 + (t - 1000) * 0.4;
      return true;
    });
    const turned = made[0]!.state.pos!;
    expect(turned[0]).toBeGreaterThan(start[0]);
    expect(turned[1]).not.toBe(start[1]);
  });

  it("cleans up a guided shot at its finite lifetime when its end message is lost", () => {
    const { view, made } = setup();
    view.noteLaunch({ ...arrow, targetId: "target", range: 4500 });
    view.update(1000, () => false);
    view.update(6000, () => false);
    expect(made[0]!.state.destroyed).toBe(true);
  });
});
