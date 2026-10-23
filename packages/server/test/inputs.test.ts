import { describe, expect, it } from "vitest";
import { WORLD_H, WORLD_W } from "@raid/shared";
import {
  InputQueue, MAX_ACTIONS_PER_TICK, enqueueClientMessage, parseId, parsePoint,
  type ActionCommand,
} from "../src/sim/inputs";

describe("InputQueue", () => {
  it("starts empty", () => {
    const q = new InputQueue();
    expect(q.move).toBeNull();
    expect(q.actions).toEqual([]);
    expect(q.dropped).toBe(0);
  });

  it("keeps only the latest movement intent", () => {
    const q = new InputQueue();
    q.pushMove({ kind: "move", x: 1, y: 1 });
    q.pushMove({ kind: "move", x: 2, y: 2 });
    q.pushMove({ kind: "stop" });
    q.pushMove({ kind: "move", x: 3, y: 3 });
    expect(q.drain().move).toEqual({ kind: "move", x: 3, y: 3 });
  });

  it("lets a later stop override an earlier move", () => {
    const q = new InputQueue();
    q.pushMove({ kind: "move", x: 1, y: 1 });
    q.pushMove({ kind: "stop" });
    expect(q.drain().move).toEqual({ kind: "stop" });
  });

  it("preserves action order and caps actions at MAX_ACTIONS_PER_TICK", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 3; i++) q.pushAction({ kind: "use", uid: `u${i}` });
    expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
    expect(q.dropped).toBe(3);
    const { actions } = q.drain();
    expect(actions.map((a) => (a as { uid: string }).uid)).toEqual(
      Array.from({ length: MAX_ACTIONS_PER_TICK }, (_, i) => `u${i}`),
    );
  });

  it("keeps the earliest actions, not the latest, when over the cap", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) q.pushAction({ kind: "use", uid: "early" });
    q.pushAction({ kind: "drop", uid: "late" });
    expect(q.actions.every((a) => a.kind === "use")).toBe(true);
  });

  it("does not let move spam consume the action budget", () => {
    const q = new InputQueue();
    for (let i = 0; i < 100; i++) q.pushMove({ kind: "move", x: i, y: i });
    q.pushAction({ kind: "use", uid: "u" });
    const d = q.drain();
    expect(d.move).toEqual({ kind: "move", x: 99, y: 99 });
    expect(d.actions).toHaveLength(1);
    expect(q.dropped).toBe(0);
  });

  it("drain returns the buffered inputs and resets the queue", () => {
    const q = new InputQueue();
    q.pushMove({ kind: "move", x: 5, y: 6 });
    q.pushAction({ kind: "use", uid: "u" });
    const first = q.drain();
    expect(first.move).toEqual({ kind: "move", x: 5, y: 6 });
    expect(first.actions).toEqual([{ kind: "use", uid: "u" }]);
    expect(q.move).toBeNull();
    expect(q.actions).toEqual([]);
    expect(q.drain()).toEqual({ move: null, actions: [] });
  });

  it("returns an array that is not aliased by later pushes", () => {
    const q = new InputQueue();
    q.pushAction({ kind: "use", uid: "u" });
    const { actions } = q.drain();
    q.pushAction({ kind: "drop", uid: "x" });
    expect(actions).toEqual([{ kind: "use", uid: "u" }]);
  });

  it("accepts a full action budget again after a drain", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) q.pushAction({ kind: "use", uid: "u" });
    q.drain();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) q.pushAction({ kind: "use", uid: "u" });
    expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
  });

  it("keeps `dropped` as a running counter across drains", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 1; i++) q.pushAction({ kind: "use", uid: "u" });
    q.drain();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 2; i++) q.pushAction({ kind: "use", uid: "u" });
    expect(q.dropped).toBe(3);
  });
});

describe("parsePoint", () => {
  it("accepts finite in-range points unchanged", () => {
    expect(parsePoint({ x: 10.5, y: 20.25 })).toEqual({ x: 10.5, y: 20.25 });
    expect(parsePoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(parsePoint({ x: WORLD_W, y: WORLD_H })).toEqual({ x: WORLD_W, y: WORLD_H });
  });

  it("clamps to the world rectangle on every side", () => {
    expect(parsePoint({ x: -50, y: -1 })).toEqual({ x: 0, y: 0 });
    expect(parsePoint({ x: WORLD_W + 1, y: WORLD_H + 1e9 })).toEqual({ x: WORLD_W, y: WORLD_H });
    expect(parsePoint({ x: -1e12, y: 1e12 })).toEqual({ x: 0, y: WORLD_H });
    expect(parsePoint({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE })).toEqual({ x: WORLD_W, y: 0 });
  });

  it("does not return -0", () => {
    const p = parsePoint({ x: -0, y: -0 })!;
    expect(Object.is(p.x, 0)).toBe(true);
    expect(Object.is(p.y, 0)).toBe(true);
  });

  it.each([
    ["NaN x", { x: NaN, y: 1 }],
    ["NaN y", { x: 1, y: NaN }],
    ["Infinity x", { x: Infinity, y: 1 }],
    ["-Infinity y", { x: 1, y: -Infinity }],
    ["string x", { x: "10", y: 1 }],
    ["string y", { x: 1, y: "10" }],
    ["null y", { x: 1, y: null }],
    ["boolean x", { x: true, y: 1 }],
    ["object x", { x: {}, y: 1 }],
    ["bigint x", { x: 10n, y: 1 }],
    ["missing x", { y: 1 }],
    ["missing y", { x: 1 }],
    ["empty object", {}],
    ["array", [1, 2]],
  ])("rejects %s", (_name, msg) => {
    expect(parsePoint(msg)).toBeNull();
  });

  it.each([null, undefined, 5, "10,20", true, Symbol("s")])("rejects non-object message %s", (msg) => {
    expect(parsePoint(msg)).toBeNull();
  });

  it("ignores extra fields and does not mutate the input", () => {
    const msg = { x: -5, y: 5, extra: "ignored" };
    expect(parsePoint(msg)).toEqual({ x: 0, y: 5 });
    expect(msg.x).toBe(-5);
  });

  it("returns a fresh object, not the message", () => {
    const msg = { x: 1, y: 2 };
    expect(parsePoint(msg)).not.toBe(msg);
  });
});

describe("parseId", () => {
  it("accepts non-empty strings up to 64 chars", () => {
    expect(parseId("a")).toBe("a");
    expect(parseId("x".repeat(64))).toBe("x".repeat(64));
  });

  it("rejects the empty string and strings longer than 64", () => {
    expect(parseId("")).toBeNull();
    expect(parseId("x".repeat(65))).toBeNull();
    expect(parseId("x".repeat(10_000))).toBeNull();
  });

  it.each([undefined, null, 5, NaN, true, {}, [], ["abc"], Symbol("s")])("rejects non-string %s", (v) => {
    expect(parseId(v)).toBeNull();
  });
});

describe("enqueueClientMessage", () => {
  const fresh = () => new InputQueue();

  describe("move", () => {
    it("queues a validated, clamped move and returns true", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "move", { x: -10, y: WORLD_H + 10 })).toBe(true);
      expect(q.move).toEqual({ kind: "move", x: 0, y: WORLD_H });
    });

    it("strips extra fields from the queued command", () => {
      const q = fresh();
      enqueueClientMessage(q, "move", { x: 1, y: 2, hp: 9999, kind: "stop" });
      expect(q.move).toEqual({ kind: "move", x: 1, y: 2 });
    });

    it.each([
      ["NaN", { x: NaN, y: 0 }],
      ["Infinity", { x: 0, y: Infinity }],
      ["strings", { x: "1", y: "2" }],
      ["missing field", { x: 1 }],
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
    ])("rejects %s without touching the queue", (_n, msg) => {
      const q = fresh();
      q.pushMove({ kind: "move", x: 7, y: 7 });
      expect(enqueueClientMessage(q, "move", msg)).toBe(false);
      expect(q.move).toEqual({ kind: "move", x: 7, y: 7 });
      expect(q.actions).toEqual([]);
    });

    it("a rejected move does not cancel a previously queued stop", () => {
      const q = fresh();
      enqueueClientMessage(q, "stop", {});
      enqueueClientMessage(q, "move", { x: NaN, y: 0 });
      expect(q.move).toEqual({ kind: "stop" });
    });
  });

  describe("stop", () => {
    it("queues a stop regardless of payload", () => {
      for (const payload of [{}, null, undefined, 5, "junk"]) {
        const q = fresh();
        expect(enqueueClientMessage(q, "stop", payload)).toBe(true);
        expect(q.move).toEqual({ kind: "stop" });
      }
    });

    it("overrides an earlier move and is overridden by a later one", () => {
      const q = fresh();
      enqueueClientMessage(q, "move", { x: 1, y: 1 });
      enqueueClientMessage(q, "stop", {});
      expect(q.move).toEqual({ kind: "stop" });
      enqueueClientMessage(q, "move", { x: 2, y: 2 });
      expect(q.move).toEqual({ kind: "move", x: 2, y: 2 });
    });
  });

  describe("attack", () => {
    it("queues a clamped attack action and leaves movement alone", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "attack", { x: WORLD_W * 2, y: 5 })).toBe(true);
      expect(q.actions).toEqual([{ kind: "attack", x: WORLD_W, y: 5 }]);
      expect(q.move).toBeNull();
    });

    it("rejects malformed targets", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "attack", { x: NaN, y: 5 })).toBe(false);
      expect(enqueueClientMessage(q, "attack", { x: 5 })).toBe(false);
      expect(enqueueClientMessage(q, "attack", "5,5")).toBe(false);
      expect(q.actions).toEqual([]);
    });
  });

  describe("take", () => {
    it("queues containerId + uid", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "take", { containerId: "c1", uid: "i9" })).toBe(true);
      expect(q.actions).toEqual([{ kind: "take", containerId: "c1", uid: "i9" }]);
    });

    it("strips unknown fields", () => {
      const q = fresh();
      enqueueClientMessage(q, "take", { containerId: "c1", uid: "i9", count: 99 });
      expect(q.actions[0]).toEqual({ kind: "take", containerId: "c1", uid: "i9" });
    });

    it.each([
      ["missing uid", { containerId: "c1" }],
      ["missing containerId", { uid: "i9" }],
      ["empty uid", { containerId: "c1", uid: "" }],
      ["empty containerId", { containerId: "", uid: "i9" }],
      ["numeric ids", { containerId: 1, uid: 2 }],
      ["oversized uid", { containerId: "c1", uid: "u".repeat(65) }],
      ["oversized containerId", { containerId: "c".repeat(65), uid: "i9" }],
      ["null payload", null],
      ["string payload", "c1"],
    ])("rejects %s", (_n, msg) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "take", msg)).toBe(false);
      expect(q.actions).toEqual([]);
    });

    it("accepts ids of exactly 64 chars", () => {
      const q = fresh();
      const id = "z".repeat(64);
      expect(enqueueClientMessage(q, "take", { containerId: id, uid: id })).toBe(true);
    });
  });

  describe.each(["drop", "use"] as const)("%s", (type) => {
    it("queues the uid under the matching kind", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, { uid: "abc" })).toBe(true);
      expect(q.actions).toEqual([{ kind: type, uid: "abc" }]);
    });

    it.each([
      ["missing uid", {}],
      ["empty uid", { uid: "" }],
      ["numeric uid", { uid: 5 }],
      ["oversized uid", { uid: "u".repeat(65) }],
      ["null", null],
      ["undefined", undefined],
    ])("rejects %s", (_n, msg) => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, msg)).toBe(false);
      expect(q.actions).toEqual([]);
    });
  });

  describe("extract", () => {
    it("is no longer a message type: extraction is gone", () => {
      for (const payload of [{}, null, undefined, "junk"]) {
        const q = fresh();
        expect(enqueueClientMessage(q, "extract", payload)).toBe(false);
        expect(q.move).toBeNull();
        expect(q.actions).toEqual([]);
      }
    });
  });

  describe("unknown message types", () => {
    it.each(["", "MOVE", "Move", "move ", "teleport", "setPosition", "damage", "result", "fx",
      "__proto__", "constructor", "toString", "hasOwnProperty"])("rejects %j", (type) => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, { x: 1, y: 1, uid: "u", containerId: "c" })).toBe(false);
      expect(q.move).toBeNull();
      expect(q.actions).toEqual([]);
    });
  });

  describe("spam handling", () => {
    it("queues at most MAX_ACTIONS_PER_TICK actions from a flood of valid messages", () => {
      const q = fresh();
      for (let i = 0; i < 50; i++) enqueueClientMessage(q, "use", { uid: `u${i}` });
      expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
      expect(q.dropped).toBe(50 - MAX_ACTIONS_PER_TICK);
    });

    it("rejected messages never count toward the action cap", () => {
      const q = fresh();
      for (let i = 0; i < 50; i++) enqueueClientMessage(q, "take", { containerId: "c" });
      expect(q.dropped).toBe(0);
      expect(enqueueClientMessage(q, "drop", { uid: "u" })).toBe(true);
      expect(q.actions).toHaveLength(1);
    });

    it("mixed actions keep arrival order", () => {
      const q = fresh();
      enqueueClientMessage(q, "use", { uid: "a" });
      enqueueClientMessage(q, "attack", { x: 1, y: 2 });
      enqueueClientMessage(q, "drop", { uid: "b" });
      const kinds = q.drain().actions.map((a: ActionCommand) => a.kind);
      expect(kinds).toEqual(["use", "attack", "drop"]);
    });
  });
});
