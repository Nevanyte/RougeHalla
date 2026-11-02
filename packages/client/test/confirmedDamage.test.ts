import { describe, expect, it, vi } from "vitest";
import { ConfirmedDamage, type ConfirmedHit } from "../src/net/confirmedDamage";

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
