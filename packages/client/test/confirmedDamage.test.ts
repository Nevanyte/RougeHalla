import { describe, expect, it, vi } from "vitest";
import type { TimedFx } from "@raid/shared";
import {
  ConfirmedDamage, isOwnArcBlow, shieldReturnsIn, type ConfirmedBlock, type ConfirmedFx, type ConfirmedHit,
} from "../src/net/confirmedDamage";

const hit = (t: number, over: Partial<ConfirmedHit> = {}): ConfirmedHit => ({
  kind: "hit", id: "me", by: "foe", amount: 20, weapon: "sword", t, ...over,
});

describe("ConfirmedDamage", () => {
  it("waits for the matching authoritative patch before presenting an incoming event", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    queue.enqueue(hit(120), 100);
    queue.drain(119, 120, present);
    expect(present).not.toHaveBeenCalled();
    queue.drain(120, 121, present);
    expect(present).toHaveBeenCalledExactlyOnceWith(hit(120));
  });

  it("presents an event on the next drain when its patch already applied", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    queue.enqueue(hit(120), 130);
    queue.drain(130, 131, present);
    expect(present).toHaveBeenCalledExactlyOnceWith(hit(120));
  });

  it("drains each event once", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    queue.enqueue(hit(120), 120);
    queue.drain(120, 121, present);
    queue.drain(120, 122, present);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("preserves identical multi-hit events in arrival order", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    const sameTickHit = hit(120);
    queue.enqueue(sameTickHit, 121);
    queue.enqueue(sameTickHit, 122);
    queue.drain(120, 123, present);
    expect(present.mock.calls.map(([fx]) => fx)).toEqual([sameTickHit, sameTickHit]);
  });

  it("drops events older than the receive timeout, including events still ahead of the patch", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    queue.enqueue(hit(5000), 100);
    queue.drain(2000, 2101, present); // ahead of patchT and more than 2 s since receipt
    queue.drain(5000, 2200, present);
    expect(present).not.toHaveBeenCalled();
  });

  it("drops events over 2 s behind the authoritative patch", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    queue.enqueue(hit(1000), 2900);
    queue.drain(3001, 3002, present);
    expect(present).not.toHaveBeenCalled();
  });

  it("drops the oldest pending hit when bounded capacity is exceeded", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    for (let t = 1; t <= 129; t++) queue.enqueue(hit(t), 0);
    queue.drain(129, 1, present);
    expect(present).toHaveBeenCalledTimes(128);
    expect(present.mock.calls[0]![0].t).toBe(2);
    expect(present.mock.calls.at(-1)![0].t).toBe(129);
  });

  it("clears pending hits on reset", () => {
    const queue = new ConfirmedDamage();
    queue.enqueue(hit(100), 100);
    queue.reset();
    const present = vi.fn();
    queue.drain(100, 101, present);
    expect(present).not.toHaveBeenCalled();
  });

  it("ignores invalid timestamps and invalid drain clocks", () => {
    const queue = new ConfirmedDamage();
    const present = vi.fn();
    queue.enqueue(hit(Number.NaN), 100);
    queue.enqueue(hit(100), Number.POSITIVE_INFINITY);
    queue.enqueue(hit(100), 100);
    queue.drain(Number.NaN, 101, present);
    queue.drain(100, Number.POSITIVE_INFINITY, present);
    expect(present).not.toHaveBeenCalled();
    queue.drain(100, 101, present);
    expect(present).toHaveBeenCalledExactlyOnceWith(hit(100));
  });
});

describe("ConfirmedDamage with own blows", () => {
  it("holds a block beside hits until its patch, and still refuses every other kind", () => {
    const queue = new ConfirmedDamage<ConfirmedFx>();
    const present = vi.fn();
    const block: ConfirmedBlock = { kind: "block", id: "foe", by: "me", weapon: "sword", t: 120 };
    queue.enqueue(block, 100);
    queue.enqueue(hit(120, { id: "foe", by: "me" }), 100);
    queue.enqueue({ kind: "stagger", id: "foe", t: 120 } as never, 100);
    queue.enqueue({ kind: "death", id: "foe", x: 0, y: 0, by: "me", t: 120 } as never, 100);
    queue.drain(119, 110, present);
    expect(present).not.toHaveBeenCalled();
    queue.drain(120, 111, present);
    expect(present.mock.calls.map(([fx]) => fx.kind)).toEqual(["block", "hit"]);
  });
});

describe("isOwnArcBlow", () => {
  const own = (over: Partial<ConfirmedHit> = {}): TimedFx => ({ kind: "hit", id: "foe", by: "me", amount: 20, weapon: "sword", t: 1, ...over });
  const block = (over: Partial<ConfirmedBlock> = {}): TimedFx => ({ kind: "block", id: "foe", by: "me", weapon: "sword", t: 1, ...over });

  it("takes the local player's melee hits on someone else", () => {
    for (const weapon of ["sword", "axe", "fists"] as const) expect(isOwnArcBlow(own({ weapon }), "me")).toBe(true);
    expect(isOwnArcBlow(own({ crit: true }), "me")).toBe(true);
    expect(isOwnArcBlow(own({ id: "mob7" }), "me")).toBe(true);
  });

  it("takes a shield bash only when the batch cannot hold a riposte or a reflected arrow", () => {
    expect(isOwnArcBlow(own({ weapon: "shield" }), "me", false)).toBe(true);
    expect(isOwnArcBlow(own({ weapon: "shield" }), "me", true)).toBe(false);
    expect(isOwnArcBlow(own({ weapon: "shield" }), "me")).toBe(false); // the safe default
  });

  it("leaves projectiles, damage over time, signatures, abilities and bleeds on the render clock", () => {
    expect(isOwnArcBlow(own({ weapon: "bow" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(own({ weapon: "wand" }), "me", false)).toBe(false);
    for (const sig of ["burn", "disease", "mark", "backlash"] as const) expect(isOwnArcBlow(own({ sig }), "me", false)).toBe(false);
    expect(isOwnArcBlow(own({ ability: "freeze" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(own({ weapon: null }), "me", false)).toBe(false);
  });

  it("never takes a hit on the local player or anyone else's hit", () => {
    expect(isOwnArcBlow(own({ id: "me" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(own({ by: "foe", id: "me" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(own({ by: "ally" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(own({ by: null }), "me", false)).toBe(false);
  });

  it("takes a block of the local player's melee swing, and no passive, ranged or own-shield block", () => {
    expect(isOwnArcBlow(block(), "me", true)).toBe(true);
    expect(isOwnArcBlow(block({ weapon: "shield" }), "me", true)).toBe(true); // a bash met a shield
    expect(isOwnArcBlow(block({ weapon: "shield", passive: true }), "me", false)).toBe(false); // a reflected arrow
    expect(isOwnArcBlow(block({ weapon: "bow" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(block({ id: "me", by: "foe" }), "me", false)).toBe(false);
    expect(isOwnArcBlow(block({ by: "foe" }), "me", false)).toBe(false);
  });

  it("refuses every other kind", () => {
    expect(isOwnArcBlow({ kind: "swing", by: "me", weapon: "sword", x: 0, y: 0, a: 0, t: 1 }, "me", false)).toBe(false);
    expect(isOwnArcBlow({ kind: "stagger", id: "foe", t: 1 }, "me", false)).toBe(false);
  });
});

describe("shieldReturnsIn", () => {
  const end = (ownerId?: string): TimedFx => ({
    kind: "projEnd", id: "p", proj: "arrow", x0: 0, y0: 0, t0: 0, x: 1, y: 1, reason: "hit", t: 1, ...(ownerId ? { ownerId } : {}),
  });

  it("flags a block on the local player (a riposte follows it) and a reflected arrow's end (it names no owner)", () => {
    expect(shieldReturnsIn([{ kind: "block", id: "me", by: "foe", weapon: "sword", t: 1 }], "me")).toBe(true);
    expect(shieldReturnsIn([end()], "me")).toBe(true);
  });

  it("does not flag an owned projectile's end, a block of someone else or a plain hit", () => {
    expect(shieldReturnsIn([
      end("foe"), end("me"), { kind: "block", id: "foe", by: "me", weapon: "sword", t: 1 },
      { kind: "hit", id: "foe", by: "me", amount: 5, weapon: "shield", t: 1 },
    ], "me")).toBe(false);
  });
});
