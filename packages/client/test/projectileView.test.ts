import { describe, expect, it } from "vitest";
import { packFx, unpackLaunches, Y_SCALE, type ProjectileLaunch, type TimedFx } from "@raid/shared";
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
    view.noteLaunch({ ...arrow, kind: "ball", targetId: "target", range: 4500 });
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
    view.noteLaunch({ ...arrow, kind: "ball", targetId: "target", range: 4500 });
    view.update(1000, () => false);
    view.update(6000, () => false);
    expect(made[0]!.state.destroyed).toBe(true);
  });
});

describe("local projectile previews", () => {
  it("uses local time so the owner's shot is visible before the delayed render clock reaches release", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(999_900, undefined, undefined, 1_000_100);
    expect(made).toHaveLength(1);
    expect(made[0]!.state.visible).toBe(true);
    expect(made[0]!.state.pos![0]).toBe(190);
  });

  it("keeps homing samples on the server clock while the projectile itself runs on local time", () => {
    const { view } = setup();
    view.predictLocal({ ...arrow, id: "preview-ball", kind: "ball", targetId: "foe", ownerId: "me", t: 1_000_000, range: 4500 });
    const times: number[] = [];
    view.update(1_000_050, (_id, t, out) => { times.push(t); out.x = 300; out.y = 200; return true; }, undefined, 1_000_050);
    expect(times[0]).toBe(1_000_010);
    expect(times.at(-1)).toBe(1_000_050);
  });

  it("reconciles a matching server launch in place without drawing a duplicate", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(999_900, undefined, undefined, 1_000_100);
    const authoritative = { ...arrow, id: "server-1", ownerId: "me", t: 1_000_000 };
    view.noteLocalLaunch(authoritative, "preview-1");
    view.noteLaunch(authoritative); // the normal launch path can also see the same FX batch
    view.update(999_900, undefined, undefined, 1_000_100);
    expect(made).toHaveLength(1);
    expect(made[0]!.state.destroyed).not.toBe(true);
    expect(made[0]!.state.pos![0]).toBe(190);
  });

  it("keeps a standalone local launch on its authoritative epoch so its end is not delayed by arrival time", () => {
    const { view, made } = setup();
    view.update(1_000_090, undefined, undefined, 1_000_090);
    view.noteLocalLaunch({ ...arrow, id: "server-standalone", ownerId: "me", t: 1_000_000 });
    view.noteEnd(end({ id: "server-standalone", x0: 100, x: 190, t0: 1_000_000, t: 1_000_100 }));
    view.update(1_000_099, undefined, undefined, 1_000_099);
    const beforeStop = made[0]!.state.pos![0];
    expect(beforeStop).toBeLessThan(190);
    view.update(1_000_100, undefined, undefined, 1_000_100);
    expect(made[0]!.state.pos![0]).toBe(190);
  });

  it("keeps the authoritative stop point as the local preview's cap", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(1_000_000, undefined, undefined, 1_000_100);
    view.noteLocalLaunch({ ...arrow, id: "server-1", ownerId: "me", t: 1_000_000 }, "preview-1");
    view.noteEnd(end({ id: "server-1", x0: 100, x: 190, t0: 1_000_000, t: 1_000_100 }));
    view.update(1_000_000, undefined, undefined, 1_000_100);
    const stopped = made[0]!.state.pos;
    view.update(1_000_000, undefined, undefined, 1_000_150);
    expect(made[0]!.state.pos).toEqual(stopped);
    expect(stopped![0]).toBe(190);
  });

  it("pins the authoritative stop point after a correction changes the trajectory", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(1_000_000, undefined, undefined, 1_000_100);
    view.noteLocalLaunch({ ...arrow, id: "server-1", ownerId: "me", vx: 0, vy: 900, t: 1_000_000 }, "preview-1");
    view.noteEnd(end({ id: "server-1", x0: 100, y0: 200, x: 180, y: 260, t0: 1_000_000, t: 1_000_150 }));
    view.update(1_000_000, undefined, undefined, 1_000_150);
    expect(made[0]!.state.pos).toEqual([180, 260 * Y_SCALE - 14]);
  });

  it("reconciles a launch and stop delivered in one FX without keeping a second preview", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(1_000_000, undefined, undefined, 1_000_000);
    const stoppedFx = end({ id: "server-short", x0: 100, y0: 200, t0: 1_000_050, x: 145, y: 200, t: 1_000_100 });
    view.update(1_000_000, undefined, undefined, 1_000_100);
    view.noteLocalEnd(stoppedFx, "preview-1");
    view.noteEnd(stoppedFx); // a normal FX handler may forward both launch/end paths
    view.update(1_000_000, undefined, undefined, 1_000_100);
    expect(view.has("server-short")).toBe(true);
    expect(view.has("preview-1")).toBe(false);
    expect(made).toHaveLength(1);
    expect(made[0]!.state.pos![0]).toBe(145);
  });

  it("finishes a preview immediately when the authoritative stop has no visible flight", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(1_000_000, undefined, undefined, 1_000_000);
    view.noteLocalEnd(end({ id: "server-still", x0: 100, y0: 200, t0: 1_000_000, x: 101, y: 200, t: 1_000_001 }), "preview-1");
    expect(view.has("server-still")).toBe(true);
    expect(view.has("preview-1")).toBe(true);
    expect(made[0]!.state.destroyed).toBe(true);
  });

  it("removes an unconfirmed preview after its bounded lifetime", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "preview-1", ownerId: "me", t: 1_000_000 });
    view.update(1_000_000, undefined, undefined, 1_000_000);
    expect(made).toHaveLength(1);
    view.update(1_000_000, undefined, undefined, 1_001_501);
    expect(made[0]!.state.destroyed).toBe(true);
  });

  it("does not let a missing launch token claim a newer live preview", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "expired-preview", ownerId: "me", t: 1_000_000 });
    view.update(1_000_000, undefined, undefined, 1_001_501); // expires the first token's visual
    view.predictLocal({ ...arrow, id: "new-preview", ownerId: "me", x: 500, t: 1_001_600 });
    view.update(1_001_600, undefined, undefined, 1_001_600);
    const newer = made.find((g) => !g.state.destroyed && (g.state.pos as number[] | null)?.[0] === 500)!;

    view.noteLocalLaunch({ ...arrow, id: "authoritative-old", ownerId: "me", t: 1_001_500 }, "expired-preview");
    view.update(1_001_600, undefined, undefined, 1_001_600);
    expect(newer.state.destroyed).not.toBe(true);
    expect(newer.state.pos![0]).toBe(500);
    expect(made.filter((g) => !g.state.destroyed)).toHaveLength(2);
  });

  it("does not let a missing end token claim a newer live preview", () => {
    const { view, made } = setup();
    view.predictLocal({ ...arrow, id: "new-preview", ownerId: "me", x: 500, t: 1_001_600 });
    view.update(1_001_600, undefined, undefined, 1_001_600);
    const newer = made[0]!;
    view.noteLocalEnd(end({ id: "authoritative-old", x0: 100, y0: 200, x: 145, y: 200,
      t0: 1_000_000, t: 1_000_050 }), "expired-preview");
    view.update(1_001_600, undefined, undefined, 1_001_600);
    expect(newer.state.destroyed).not.toBe(true);
    expect(newer.state.pos![0]).toBe(500);
    expect(made.filter((g) => !g.state.destroyed)).toHaveLength(2);
  });
});
