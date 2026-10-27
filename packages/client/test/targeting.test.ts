// The attack target on the client: which fighter a left click snaps to, which lock is drawn while the server catches up,
// and the two rings. The scene is fake (test/fakes.ts).
import { describe, expect, it } from "vitest";
import {
  EFFECT_ANTI_HEAL, EFFECT_CASTING, EFFECT_DOT, EFFECT_HASTE, EFFECT_HIDDEN, EFFECT_LAST_STAND, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_SLOWED,
  EFFECT_STUNNED, EFFECT_UNTARGETABLE, EFFECT_ZONED, PLAYER_RADIUS, TARGET_SNAP_RADIUS, Y_SCALE,
} from "@raid/shared";
import { TargetRings } from "../src/render/TargetRings";
import { LockDisplay, OPTIMISTIC_LOCK_MS, pickTarget, targetable, unitCastDenial } from "../src/render/targeting";
import { fakeScene, type FakeObject } from "./fakes";

const at = (id: string, x: number, y: number) => ({ id, x, y });

describe("pickTarget", () => {
  it("takes the fighter nearest the cursor, not the first in the list", () => {
    const list = [at("far", 40, 0), at("near", 10, 5), at("mid", 25, 0)];
    expect(pickTarget({ x: 0, y: 0 }, list)).toBe("near");
  });

  it("snaps from a click that misses, up to the snap radius", () => {
    const fighter = [at("a", TARGET_SNAP_RADIUS - 0.5, 0)];
    expect(pickTarget({ x: 0, y: 0 }, fighter)).toBe("a");
    expect(pickTarget({ x: 0, y: 0 }, [at("a", TARGET_SNAP_RADIUS + 0.5, 0)])).toBeNull();
  });

  it("measures on the ground plane in both axes", () => {
    const list = [at("a", 50, 50)];
    expect(pickTarget({ x: 0, y: 0 }, list)).toBeNull(); // 70.7 away
    expect(pickTarget({ x: 20, y: 20 }, list)).toBe("a");
  });

  it("does nothing on empty ground", () => {
    expect(pickTarget({ x: 0, y: 0 }, [])).toBeNull();
    expect(pickTarget({ x: 0, y: 0 }, [at("a", 500, 500)])).toBeNull();
  });

  it("uses the given radius", () => {
    expect(pickTarget({ x: 0, y: 0 }, [at("a", 30, 0)], 20)).toBeNull();
    expect(pickTarget({ x: 0, y: 0 }, [at("a", 30, 0)], 40)).toBe("a");
  });

  it("settles an exact tie on the lower id, whatever the order", () => {
    const a = at("a", 10, 0);
    const b = at("b", -10, 0);
    expect(pickTarget({ x: 0, y: 0 }, [a, b])).toBe("a");
    expect(pickTarget({ x: 0, y: 0 }, [b, a])).toBe("a");
  });

  it("takes any iterable", () => {
    expect(pickTarget({ x: 0, y: 0 }, new Set([at("a", 1, 1)]))).toBe("a");
  });
});

describe("LockDisplay", () => {
  it("shows the synced lock when nothing was ordered", () => {
    const d = new LockDisplay();
    expect(d.shown("", 1000)).toBe("");
    expect(d.shown("m1", 1000)).toBe("m1");
  });

  it("shows a fresh target at once, before the server's patch says so", () => {
    const d = new LockDisplay();
    d.note("m2", 1000);
    expect(d.shown("", 1000)).toBe("m2");
    expect(d.shown("m1", 1000 + OPTIMISTIC_LOCK_MS - 1)).toBe("m2");
  });

  it("shows a move or stop as no lock at once, though the synced one has not cleared yet", () => {
    const d = new LockDisplay();
    d.note("", 1000);
    expect(d.shown("m1", 1100)).toBe("");
  });

  it("hands over to the synced lock after the window: a refused order falls back to what the server holds", () => {
    const d = new LockDisplay();
    d.note("m2", 1000);
    expect(d.shown("m1", 1000 + OPTIMISTIC_LOCK_MS)).toBe("m1");
    expect(d.shown("", 5000)).toBe("");
  });

  it("the newest order wins", () => {
    const d = new LockDisplay();
    d.note("m2", 1000);
    d.note("", 1100);
    expect(d.shown("", 1200)).toBe("");
    d.note("m3", 1300);
    expect(d.shown("", 1400)).toBe("m3");
  });

  it("reset forgets the order", () => {
    const d = new LockDisplay();
    d.note("m2", 1000);
    d.reset();
    expect(d.shown("", 1001)).toBe("");
  });
});

describe("TargetRings", () => {
  function setup() {
    const { scene, ofKind, baked } = fakeScene();
    const rings = new TargetRings(scene);
    // Images of baked ellipses: hover, lock, flash. `drawn(ring)` is what the texture each shows was drawn with.
    const [hover, lock] = ofKind("image") as [FakeObject, FakeObject];
    const drawn = (ring: FakeObject) => ({ calls: baked.get(String(ring.state.texture))?.calls ?? [] });
    return { rings, hover, lock, drawn };
  }

  it("starts hidden", () => {
    const { hover, lock } = setup();
    expect(hover.state.visible).toBe(false);
    expect(lock.state.visible).toBe(false);
  });

  it("draws each ring as a ground ellipse, the lock one stronger and red", () => {
    const { hover: hoverImage, lock: lockImage, drawn } = setup();
    const [hover, lock] = [drawn(hoverImage), drawn(lockImage)];
    const widthOf = (g: { calls: readonly (readonly [string, readonly unknown[]])[] }, call: string) => (g.calls.find(([n]) => n === call)![1] as number[])[2]!;
    expect(widthOf(hover, "strokeEllipse")).toBeCloseTo(PLAYER_RADIUS * 3.1, 9);
    expect(widthOf(lock, "strokeEllipse")).toBeCloseTo(PLAYER_RADIUS * 3.1, 9);
    const heightOf = (g: typeof hover) => (g.calls.find(([n]) => n === "strokeEllipse")![1] as number[])[3]!;
    expect(heightOf(lock)).toBeCloseTo(PLAYER_RADIUS * 3.1 * Y_SCALE, 9);
    const strokes = (g: typeof hover) => g.calls.filter(([n]) => n === "lineStyle").map(([, a]) => a as number[]);
    expect(strokes(hover)[0]![1]).toBe(0xeceff1);
    expect(strokes(lock)[0]![1]).toBe(0xff5252);
    expect(strokes(lock)[0]![0]!).toBeGreaterThan(strokes(hover)[0]![0]!);
    expect(lock.calls.some(([n]) => n === "fillEllipse")).toBe(true);
    expect(hover.calls.some(([n]) => n === "fillEllipse")).toBe(false);
  });

  it("follows the fighter's ground position, just under it", () => {
    const { rings, hover, lock } = setup();
    rings.update({ x: 100, y: 200 }, { x: 300, y: 50 });
    expect(hover.state.visible).toBe(true);
    expect(hover.state.position).toEqual([100, 200 * Y_SCALE]);
    expect(lock.state.position).toEqual([300, 50 * Y_SCALE]);
    // Under the fighter (whose own depth is its y) and over the ground.
    expect(hover.state.depth as number).toBeLessThan(200);
    expect(hover.state.depth as number).toBeGreaterThan(200 - PLAYER_RADIUS - 1);
    rings.update({ x: 110, y: 210 }, { x: 310, y: 60 });
    expect(hover.state.position).toEqual([110, 210 * Y_SCALE]);
    expect(lock.state.position).toEqual([310, 60 * Y_SCALE]);
  });

  it("hides a ring when its fighter is gone, and the other stays", () => {
    const { rings, hover, lock } = setup();
    rings.update({ x: 1, y: 1 }, { x: 2, y: 2 });
    rings.update(null, { x: 2, y: 2 });
    expect(hover.state.visible).toBe(false);
    expect(lock.state.visible).toBe(true);
    rings.update(null, null);
    expect(lock.state.visible).toBe(false);
  });

  it("destroy removes both", () => {
    const { rings, hover, lock } = setup();
    rings.destroy();
    expect(hover.calls.some(([n]) => n === "destroy")).toBe(true);
    expect(lock.calls.some(([n]) => n === "destroy")).toBe(true);
  });
});

describe("targetable", () => {
  it("is false for a hidden fighter (Swarm) and for an untargetable one, alone or among other bits", () => {
    expect(targetable(EFFECT_HIDDEN)).toBe(false);
    expect(targetable(EFFECT_UNTARGETABLE)).toBe(false);
    expect(targetable(EFFECT_HIDDEN | EFFECT_UNTARGETABLE)).toBe(false);
    expect(targetable(EFFECT_STUNNED | EFFECT_HIDDEN | EFFECT_HASTE)).toBe(false);
    expect(targetable(EFFECT_DOT | EFFECT_UNTARGETABLE)).toBe(false);
  });

  it("is true with no bits and with every other bit: crowd control and buffs do not hide a fighter", () => {
    expect(targetable(0)).toBe(true);
    for (const bit of [
      EFFECT_STUNNED, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_SLOWED, EFFECT_ANTI_HEAL, EFFECT_DOT, EFFECT_ZONED, EFFECT_LAST_STAND,
      EFFECT_HASTE, EFFECT_CASTING,
    ]) expect(targetable(bit), `${bit}`).toBe(true);
    expect(targetable(EFFECT_STUNNED | EFFECT_ROOTED | EFFECT_ZONED | EFFECT_LAST_STAND)).toBe(true);
  });
});

describe("unitCastDenial", () => {
  const base = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, range: 450, slack: 32, los: true, sight: () => true, immuneUntil: 0, serverNow: 10_000 };

  it("lets a cast through on a target in reach, in sight and not immune", () => {
    expect(unitCastDenial(base)).toBeNull();
    expect(unitCastDenial({ ...base, to: { x: 482, y: 0 } })).toBeNull(); // range + slack exactly
  });

  it("names a target out of range, past the server's own slack", () => {
    expect(unitCastDenial({ ...base, to: { x: 483, y: 0 } })).toBe("Out of range");
  });

  it("names a wall in the way, only when the ability needs sight", () => {
    expect(unitCastDenial({ ...base, sight: () => false })).toBe("No line of sight");
    expect(unitCastDenial({ ...base, sight: () => false, los: false })).toBeNull();
  });

  it("names a target still under teleport immunity (its immuneUntil is ahead of the client's server time), and not one that has just lost it", () => {
    expect(unitCastDenial({ ...base, immuneUntil: 10_001 })).toBe("Immune");
    expect(unitCastDenial({ ...base, immuneUntil: 10_000 })).toBeNull();
    expect(unitCastDenial({ ...base, immuneUntil: 9_000 })).toBeNull();
  });

  it("asks for sight between the two drawn positions", () => {
    const seen: unknown[] = [];
    unitCastDenial({ ...base, sight: (a, b) => { seen.push([a, b]); return true; } });
    expect(seen).toEqual([[base.from, base.to]]);
  });
});
