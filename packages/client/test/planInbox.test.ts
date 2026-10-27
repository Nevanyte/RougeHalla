// The private `plan` message held until the scene is there (net/planInbox.ts): the newest message replaces the older ones, one
// that arrives before the scene starts is not lost, a message that is not a plan is ignored.
import { describe, expect, it } from "vitest";
import type { PlanMessage } from "@raid/shared";
import { PlanInbox, sanitizePlan } from "../src/net/planInbox";

const msg = (over: Partial<PlanMessage> = {}): PlanMessage => ({
  endsAt: 12_000, spawns: [3, 9], taken: [false, false], pick: -1, boons: [], boon: -1, ...over,
});

describe("PlanInbox: a deal that comes before the scene is listening", () => {
  it("holds it and hands it over when the scene attaches", () => {
    const inbox = new PlanInbox();
    inbox.push(msg());
    const got: PlanMessage[] = [];
    inbox.attach((m) => got.push(m));
    expect(got).toEqual([msg()]);
  });

  it("keeps only the newest of several that came first", () => {
    const inbox = new PlanInbox();
    inbox.push(msg({ taken: [false, false] }));
    inbox.push(msg({ taken: [false, true] }));
    inbox.push(msg({ taken: [false, true], pick: 0 }));
    const got: PlanMessage[] = [];
    inbox.attach((m) => got.push(m));
    expect(got).toEqual([msg({ taken: [false, true], pick: 0 })]);
    expect(inbox.current).toEqual(msg({ taken: [false, true], pick: 0 }));
  });

  it("hands over nothing when nothing came, and every later message as it arrives", () => {
    const inbox = new PlanInbox();
    const got: PlanMessage[] = [];
    inbox.attach((m) => got.push(m));
    expect(got).toEqual([]);
    inbox.push(msg({ pick: 1 }));
    inbox.push(msg({ pick: 0 }));
    expect(got.map((m) => m.pick)).toEqual([1, 0]);
  });

  it("stops handing over after the scene lets go, but keeps the newest for the next scene on the same room", () => {
    const inbox = new PlanInbox();
    const got: PlanMessage[] = [];
    const off = inbox.attach((m) => got.push(m));
    off();
    inbox.push(msg({ pick: 1 }));
    expect(got).toEqual([]);
    const again: PlanMessage[] = [];
    inbox.attach((m) => again.push(m));
    expect(again.map((m) => m.pick)).toEqual([1]);
  });

  it("an older scene letting go late does not cut off the newer one", () => {
    const inbox = new PlanInbox();
    const first = inbox.attach(() => {});
    const got: PlanMessage[] = [];
    inbox.attach((m) => got.push(m));
    first();
    inbox.push(msg());
    expect(got).toHaveLength(1);
  });

  it("ignores a message that is not a plan, and keeps the one it had", () => {
    const inbox = new PlanInbox();
    inbox.push(msg({ pick: 1 }));
    for (const bad of [null, undefined, 5, "x", {}, { spawns: [1], taken: [false, false], endsAt: 1 }, { ...msg(), endsAt: "soon" }, { ...msg(), spawns: ["a", "b"] }]) inbox.push(bad);
    expect(inbox.current).toEqual(msg({ pick: 1 }));
  });
});

describe("sanitizePlan", () => {
  it("returns a well-formed plan as it is, and fills what is missing or wrong with the plain defaults", () => {
    expect(sanitizePlan(msg({ boons: ["a", "b"], boon: 1, pick: 0 }))).toEqual(msg({ boons: ["a", "b"], boon: 1, pick: 0 }));
    const odd = sanitizePlan({ endsAt: 5, spawns: [1, 2], taken: [1, true], pick: 7, boons: ["x", 3, null], boon: "left" });
    expect(odd).toEqual({ endsAt: 5, spawns: [1, 2], taken: [false, true], pick: -1, boons: ["x"], boon: -1 });
    expect(sanitizePlan({ endsAt: 5, spawns: [1, 2], taken: [false, false] })).toEqual({ endsAt: 5, spawns: [1, 2], taken: [false, false], pick: -1, boons: [], boon: -1 });
  });

  it("keeps -1 as the index of a map with no spawn pool, and refuses fractions and non-numbers", () => {
    expect(sanitizePlan(msg({ spawns: [-1, -1] }))?.spawns).toEqual([-1, -1]);
    expect(sanitizePlan({ ...msg(), spawns: [1.5, 2] })).toBeNull();
    expect(sanitizePlan({ ...msg(), endsAt: Number.NaN })).toBeNull();
  });
});
