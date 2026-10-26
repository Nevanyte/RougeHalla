// Who the viewer may see (render/visibility.ts), and that the effects that read positions through it stay off a hidden fighter.
import { describe, expect, it } from "vitest";
import { EFFECT_HIDDEN, EFFECT_STUNNED, EFFECT_UNTARGETABLE, type TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";
import { isHiddenRemote, visiblePosition } from "../src/render/visibility";
import { argsOf, fakeScene } from "./fakes";

const players = (m: Record<string, number>) => new Map(Object.entries(m).map(([id, effects]) => [id, { effects }]));
const drawn = (m: Record<string, [number, number]>) => new Map(Object.entries(m).map(([id, [x, y]]) => [id, { x, y }]));

describe("isHiddenRemote", () => {
  const ps = players({ me: EFFECT_HIDDEN, foe: EFFECT_HIDDEN, seen: 0, stunned: EFFECT_STUNNED, ghost: EFFECT_UNTARGETABLE });

  it("is true for another player with the hidden bit", () => {
    expect(isHiddenRemote(ps, "me", "foe")).toBe(true);
    expect(isHiddenRemote(ps, "me", "foe") && isHiddenRemote(players({ foe: EFFECT_HIDDEN | EFFECT_STUNNED }), "me", "foe")).toBe(true);
  });

  it("is never true for the viewer's own fighter, even while hidden", () => {
    expect(isHiddenRemote(ps, "me", "me")).toBe(false);
  });

  it("is false for a fighter without the bit, an unknown id (a mob), and other statuses", () => {
    expect(isHiddenRemote(ps, "me", "seen")).toBe(false);
    expect(isHiddenRemote(ps, "me", "stunned")).toBe(false);
    expect(isHiddenRemote(ps, "me", "ghost")).toBe(false); // untargetable, not hidden: still drawn
    expect(isHiddenRemote(ps, "me", "mob7")).toBe(false);
  });

  it("tolerates a state with no effects field", () => {
    expect(isHiddenRemote(new Map([["foe", {} as never]]), "me", "foe")).toBe(false);
  });
});

describe("visiblePosition", () => {
  const at = drawn({ me: [10, 20], foe: [200, 120], seen: [50, 60], mob7: [300, 40] });
  const ps = players({ me: EFFECT_HIDDEN, foe: EFFECT_HIDDEN, seen: 0 });

  it("gives where a visible fighter or a mob is drawn", () => {
    expect(visiblePosition(at, ps, "me", "seen")).toEqual({ x: 50, y: 60 });
    expect(visiblePosition(at, ps, "me", "mob7")).toEqual({ x: 300, y: 40 });
  });

  it("gives nowhere for a remote fighter that is hidden: nothing may point at it", () => {
    expect(visiblePosition(at, ps, "me", "foe")).toBeUndefined();
  });

  it("gives the viewer's own position while it is hidden", () => {
    expect(visiblePosition(at, ps, "me", "me")).toEqual({ x: 10, y: 20 });
  });

  it("gives nowhere for a fighter that is not drawn at all", () => {
    expect(visiblePosition(at, ps, "me", "nobody")).toBeUndefined();
  });

  it("follows a fighter into hiding and out again", () => {
    const live = players({ foe: 0 });
    expect(visiblePosition(at, live, "me", "foe")).toEqual({ x: 200, y: 120 });
    live.get("foe")!.effects = EFFECT_HIDDEN;
    expect(visiblePosition(at, live, "me", "foe")).toBeUndefined();
    live.get("foe")!.effects = 0;
    expect(visiblePosition(at, live, "me", "foe")).toEqual({ x: 200, y: 120 });
  });
});

// FxView reads positions only through its host, so with the scene's host answering through visiblePosition a hidden fighter
// gets no number, burst or mark, and one it already has stops following it.
describe("FxView on a fighter that turns hidden", () => {
  function rig() {
    const ps = players({ me: 0, foe: 0 });
    const at = drawn({ me: [0, 0], foe: [300, 200] });
    const { scene, made, ofKind } = fakeScene();
    const host: FxHost = {
      localId: "me", view: () => undefined, position: (id) => visiblePosition(at, ps, "me", id), name: () => undefined,
      projectileEnded: () => {},
    };
    const fx = new FxView(scene, host);
    const play = (e: TimedFx, now: number) => { fx.enqueue(e); fx.update(1000, now, true); };
    return { ps, at, made, ofKind, fx, play };
  }
  const burn = (): TimedFx => ({ kind: "hit", id: "foe", by: "fire", amount: 12, weapon: null, sig: "burn", t: 1000 }) as TimedFx;
  const blow = (): TimedFx => ({ kind: "hit", id: "foe", by: "me", amount: 40, weapon: "sword", t: 1000 });

  it("prints no number, no burst and no mark on a hidden fighter", () => {
    const { ps, made, play } = rig();
    ps.get("foe")!.effects = EFFECT_HIDDEN;
    play(burn(), 0);
    play(blow(), 10);
    play({ kind: "stagger", id: "foe", t: 1000 } as TimedFx, 20);
    play({ kind: "heal", id: "foe", amount: 30, t: 1000 } as TimedFx, 30);
    play({ kind: "buff", id: "foe", buff: "emberImp", stacks: 1, total: 1, t: 1000 } as TimedFx, 40);
    play({ kind: "block", id: "foe", by: "me", t: 1000 } as TimedFx, 50);
    expect(made).toEqual([]);
  });

  it("freezes a number that was printed at a visible fighter when the fighter turns hidden", () => {
    const { ps, at, ofKind, fx, play } = rig();
    play(burn(), 0);
    const text = ofKind("text")[0]!;
    const rise = (now: number) => { fx.update(1000, now, true); return text.state.position as [number, number]; };
    const first = rise(50)[0];
    at.set("foe", { x: 340, y: 210 });
    const moved = rise(100)[0];
    expect(moved - first).toBe(40); // it follows a fighter that is drawn
    ps.get("foe")!.effects = EFFECT_HIDDEN;
    at.set("foe", { x: 500, y: 400 });
    expect(rise(150)[0]).toBe(moved); // it stays where the fighter was last drawn
    at.set("foe", { x: 560, y: 420 });
    expect(rise(200)[0]).toBe(moved);
  });

  it("keeps a body-height burst off a hidden fighter's later positions too", () => {
    const { ps, at, ofKind, fx, play } = rig();
    play(blow(), 0);
    const burst = ofKind("graphics").find((g) => argsOf(g, "fillCircle").length > 0)!;
    ps.get("foe")!.effects = EFFECT_HIDDEN;
    at.set("foe", { x: 700, y: 500 });
    fx.update(1000, 60, true);
    const pos = burst.state.position as [number, number];
    expect(pos[0]).toBe(300);
  });
});
