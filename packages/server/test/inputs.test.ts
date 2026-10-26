import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGE_TYPES, WORLD_H, WORLD_W, type ClientMessageType } from "@raid/shared";
import {
  InputQueue, MAX_ACTIONS_PER_TICK, enqueueClientMessage, parseAngle, parseId, parsePlan, parsePoint, parseSeq,
  type ActionCommand,
} from "../src/sim/inputs";

const pickup = (containerId: string): ActionCommand => ({ kind: "pickup", containerId });

describe("InputQueue", () => {
  it("starts empty", () => {
    const q = new InputQueue();
    expect(q.move).toBeNull();
    expect(q.aim).toBeNull();
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

  it("keeps only the latest aim", () => {
    const q = new InputQueue();
    q.pushAim(1);
    q.pushAim(2);
    q.pushAim(-0.5);
    expect(q.drain().aim).toBe(-0.5);
  });

  it("keeps an aim of exactly 0: null is the only 'no aim'", () => {
    const q = new InputQueue();
    q.pushAim(1);
    q.pushAim(0);
    expect(q.drain().aim).toBe(0);
    expect(q.drain().aim).toBeNull();
  });

  it("notes how many actions had arrived when the latest aim did, so the sim can apply it in arrival order", () => {
    const attack: ActionCommand = { kind: "attack", a: 0 };
    const release: ActionCommand = { kind: "release", a: 0 };
    const after = new InputQueue();
    after.pushAction(attack);
    after.pushAim(1);
    after.pushAction(release);
    expect(after.drain()).toMatchObject({ aim: 1, aimBefore: 1, actions: [attack, release] });

    const before = new InputQueue();
    before.pushAim(1);
    before.pushAction(attack);
    before.pushAction(release);
    expect(before.drain()).toMatchObject({ aim: 1, aimBefore: 0 });

    const last = new InputQueue();
    last.pushAction(attack);
    last.pushAction(release);
    last.pushAim(1);
    expect(last.drain()).toMatchObject({ aim: 1, aimBefore: 2 });
  });

  it("notes how many actions had arrived when the latest move did, so an order and a move replace each other in arrival order", () => {
    const target: ActionCommand = { kind: "target", id: "mob1" };
    const first = new InputQueue();
    first.pushMove({ kind: "move", x: 1, y: 1 });
    first.pushAction(target);
    expect(first.drain()).toMatchObject({ move: { kind: "move", x: 1, y: 1 }, moveBefore: 0, actions: [target] });

    const after = new InputQueue();
    after.pushAction(target);
    after.pushMove({ kind: "stop" });
    expect(after.drain()).toMatchObject({ move: { kind: "stop" }, moveBefore: 1, actions: [target] });

    // Only the latest move counts, and its place is where it arrived last.
    const twice = new InputQueue();
    twice.pushMove({ kind: "move", x: 1, y: 1 });
    twice.pushAction(target);
    twice.pushMove({ kind: "move", x: 2, y: 2 });
    twice.pushAction({ kind: "attack", a: 0 });
    expect(twice.drain()).toMatchObject({ move: { kind: "move", x: 2, y: 2 }, moveBefore: 1 });

    const empty = new InputQueue();
    empty.pushMove({ kind: "stop" });
    expect(empty.drain()).toMatchObject({ moveBefore: 0, actions: [] });
    expect(empty.moveBefore).toBe(0);
  });

  it("only the latest aim counts: an earlier one's place among the actions is forgotten", () => {
    const q = new InputQueue();
    q.pushAim(0.5);
    q.pushAction({ kind: "attack", a: 0 });
    q.pushAction({ kind: "release", a: 0 });
    q.pushAim(1.5);
    q.pushAction({ kind: "swap" });
    expect(q.drain()).toMatchObject({ aim: 1.5, aimBefore: 2 });
  });

  it("counts the actions kept, not those dropped over the cap, and starts again after a drain", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 2; i++) q.pushAction(pickup("c"));
    q.pushAim(1);
    expect(q.drain().aimBefore).toBe(MAX_ACTIONS_PER_TICK);
    q.pushAim(2); // no actions: before all of nothing
    expect(q.drain()).toMatchObject({ aim: 2, aimBefore: 0, actions: [] });
    expect(q.aimBefore).toBe(0);
  });

  it("records the order of real messages too: attack, aim, release", () => {
    const q = new InputQueue();
    enqueueClientMessage(q, "attack", { a: 0 });
    enqueueClientMessage(q, "aim", { a: 1 });
    enqueueClientMessage(q, "release", { a: 0 });
    expect(q.drain()).toMatchObject({ aim: 1, aimBefore: 1 });
  });

  it("preserves action order and caps actions at MAX_ACTIONS_PER_TICK", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 3; i++) q.pushAction(pickup(`c${i}`));
    expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
    expect(q.dropped).toBe(3);
    const { actions } = q.drain();
    expect(actions.map((a) => (a as { containerId: string }).containerId)).toEqual(
      Array.from({ length: MAX_ACTIONS_PER_TICK }, (_, i) => `c${i}`),
    );
  });

  it("keeps the earliest actions, not the latest, when over the cap", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) q.pushAction(pickup("early"));
    q.pushAction({ kind: "swap" });
    q.pushAction({ kind: "release", a: 0 });
    expect(q.actions.every((a) => a.kind === "pickup")).toBe(true);
    expect(q.dropped).toBe(2);
  });

  it("does not let move or aim spam consume the action budget", () => {
    const q = new InputQueue();
    for (let i = 0; i < 100; i++) {
      q.pushMove({ kind: "move", x: i, y: i });
      q.pushAim(i / 10);
    }
    q.pushAction(pickup("c"));
    const d = q.drain();
    expect(d.move).toEqual({ kind: "move", x: 99, y: 99 });
    expect(d.aim).toBeCloseTo(9.9, 9);
    expect(d.actions).toHaveLength(1);
    expect(q.dropped).toBe(0);
  });

  it("drain returns the buffered inputs and resets the queue", () => {
    const q = new InputQueue();
    q.pushMove({ kind: "move", x: 5, y: 6 });
    q.pushAim(1.5);
    q.pushAction(pickup("c"));
    const first = q.drain();
    expect(first.move).toEqual({ kind: "move", x: 5, y: 6 });
    expect(first.aim).toBe(1.5);
    expect(first.actions).toEqual([pickup("c")]);
    expect(q.move).toBeNull();
    expect(q.aim).toBeNull();
    expect(q.actions).toEqual([]);
    expect(q.drain()).toEqual({ move: null, moveBefore: 0, aim: null, aimBefore: 0, actions: [] });
  });

  it("returns an array that is not aliased by later pushes", () => {
    const q = new InputQueue();
    q.pushAction(pickup("c"));
    const { actions } = q.drain();
    q.pushAction({ kind: "swap" });
    expect(actions).toEqual([pickup("c")]);
  });

  it("accepts a full action budget again after a drain", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) q.pushAction(pickup("c"));
    q.drain();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) q.pushAction(pickup("c"));
    expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
  });

  it("keeps `dropped` as a running counter across drains", () => {
    const q = new InputQueue();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 1; i++) q.pushAction(pickup("c"));
    q.drain();
    for (let i = 0; i < MAX_ACTIONS_PER_TICK + 2; i++) q.pushAction(pickup("c"));
    expect(q.dropped).toBe(3);
  });

  it("allows six actions a tick: three quick taps (press and release) fit, a fourth is dropped", () => {
    expect(MAX_ACTIONS_PER_TICK).toBe(6);
    const q = new InputQueue();
    for (let tap = 0; tap < 4; tap++) {
      q.pushAction({ kind: "attack", a: tap });
      q.pushAction({ kind: "release", a: tap });
    }
    expect(q.actions.map((a) => a.kind)).toEqual(["attack", "release", "attack", "release", "attack", "release"]);
    expect(q.dropped).toBe(2);
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

describe("parseAngle", () => {
  it.each([0, 1, -1, 3, -3, Math.PI / 2, -Math.PI / 2, 1e-9, Math.PI])("accepts the in-range angle %d unchanged", (a) => {
    expect(parseAngle(a)).toBe(a);
  });

  it("covers (-PI, PI]: PI stays, -PI becomes PI", () => {
    expect(parseAngle(Math.PI)).toBe(Math.PI);
    expect(parseAngle(-Math.PI)).toBe(Math.PI);
    expect(parseAngle(3 * Math.PI)).toBe(Math.PI);
  });

  it.each([
    [7, 7 - 2 * Math.PI],
    [-7, -7 + 2 * Math.PI],
    [2 * Math.PI, 0],
    [-2 * Math.PI, 0],
    [2 * Math.PI + 1, 1],
    [-2 * Math.PI - 1, -1],
    [10 * Math.PI + 0.5, 0.5],
    [100, 100 - 32 * Math.PI],
  ])("wraps %d to %d", (a, want) => {
    expect(parseAngle(a)).toBeCloseTo(want, 9);
  });

  it("always lands in (-PI, PI] for angles of ordinary size", () => {
    for (let a = -50; a <= 50; a += 0.37) {
      const w = parseAngle(a)!;
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
    }
    for (const a of [1e6, -1e6, 123456.789, -987654.321]) {
      const w = parseAngle(a)!;
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
    }
  });

  // SRC ISSUE (not fixed here: tests don't edit src). wrapAngle() in shared/src/interactions.ts subtracts
  // 2*PI*floor((a+PI)/(2*PI)), which loses all precision once |a| reaches about 1e14: parseAngle(1e16) is -4 and
  // parseAngle(1e18) is 128, and for some values near MAX_VALUE the result is around 7e283. A client could stamp
  // that into w.aim and the synced `facing`. Minimal patch in parseAngle: wrapAngle(v % (2 * Math.PI)); an exact
  // fmod first brought 2 million random angles up to 1e300 back into range.
  it("wraps huge finite angles into (-PI, PI] too", () => {
    for (const a of [1e16, 1.5e16, 3e16, 1e18, -1e16, -1.5e16]) {
      const w = parseAngle(a)!;
      expect(w, `parseAngle(${a})`).toBeGreaterThan(-Math.PI);
      expect(w, `parseAngle(${a})`).toBeLessThanOrEqual(Math.PI);
    }
  });

  it.each([NaN, Infinity, -Infinity, "1", "", null, undefined, true, {}, [], [1], 1n, Symbol("a")])(
    "rejects %s",
    (v) => {
      expect(parseAngle(v)).toBeNull();
    },
  );
});

describe("parseSeq", () => {
  it.each([0, 1, 7, 128, 254, 255])("accepts the order number %d", (n) => {
    expect(parseSeq({ x: 1, y: 2, seq: n })).toBe(n);
  });

  it("does not return -0", () => {
    expect(Object.is(parseSeq({ seq: -0 }), 0)).toBe(true);
  });

  it.each([
    ["negative", -1], ["256", 256], ["a fraction", 1.5], ["NaN", NaN], ["Infinity", Infinity], ["a string", "3"], ["null", null],
    ["a boolean", true], ["an object", {}], ["a bigint", 3n], ["huge", 1e9],
  ])("gives undefined for %s", (_n, seq) => {
    expect(parseSeq({ seq })).toBeUndefined();
  });

  it.each([null, undefined, 5, "seq", {}, []])("gives undefined for the message %s", (msg) => {
    expect(parseSeq(msg)).toBeUndefined();
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

    it("keeps a valid seq on the command, and only a valid one", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "move", { x: 1, y: 2, seq: 42 })).toBe(true);
      expect(q.move).toStrictEqual({ kind: "move", x: 1, y: 2, seq: 42 });
      for (const seq of [-1, 256, 1.5, "7", NaN, null, {}]) {
        const p = fresh();
        expect(enqueueClientMessage(p, "move", { x: 1, y: 2, seq }), String(seq)).toBe(true); // the order still counts
        expect(p.move, String(seq)).toStrictEqual({ kind: "move", x: 1, y: 2 });
      }
    });

    it("a rejected move (bad point) queues nothing, whatever its seq", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "move", { x: NaN, y: 0, seq: 3 })).toBe(false);
      expect(q.move).toBeNull();
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

    it("keeps a valid seq, and drops a bad one without losing the stop", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "stop", { seq: 255 })).toBe(true);
      expect(q.move).toStrictEqual({ kind: "stop", seq: 255 });
      expect(enqueueClientMessage(q, "stop", { seq: 256 })).toBe(true);
      expect(q.move).toStrictEqual({ kind: "stop" });
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

  describe("aim", () => {
    it("queues the angle, not an action, and leaves movement alone", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "aim", { a: 1.25 })).toBe(true);
      expect(q.aim).toBe(1.25);
      expect(q.actions).toEqual([]);
      expect(q.move).toBeNull();
    });

    it("wraps the angle into (-PI, PI]", () => {
      const q = fresh();
      enqueueClientMessage(q, "aim", { a: 7 });
      expect(q.aim).toBeCloseTo(7 - 2 * Math.PI, 9);
      enqueueClientMessage(q, "aim", { a: -Math.PI });
      expect(q.aim).toBe(Math.PI);
    });

    it("keeps an aim of exactly 0", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "aim", { a: 0 })).toBe(true);
      expect(q.aim).toBe(0);
    });

    it("the latest aim wins, within a tick and against rejected ones", () => {
      const q = fresh();
      enqueueClientMessage(q, "aim", { a: 1 });
      enqueueClientMessage(q, "aim", { a: 2 });
      expect(enqueueClientMessage(q, "aim", { a: NaN })).toBe(false);
      expect(q.aim).toBe(2);
      expect(q.drain().aim).toBe(2);
      expect(q.aim).toBeNull(); // drained: the next tick starts with no aim
    });

    it("a flood of aims never fills the action budget", () => {
      const q = fresh();
      for (let i = 0; i < 200; i++) expect(enqueueClientMessage(q, "aim", { a: i / 100 })).toBe(true);
      expect(q.dropped).toBe(0);
      expect(q.actions).toEqual([]);
      expect(q.aim).toBeCloseTo(1.99, 9);
      expect(enqueueClientMessage(q, "swap", {})).toBe(true);
      expect(q.actions).toHaveLength(1);
    });

    it.each([
      ["NaN", { a: NaN }],
      ["Infinity", { a: Infinity }],
      ["string", { a: "1" }],
      ["null", { a: null }],
      ["missing", {}],
      ["a point, as the old attack sent", { x: 1, y: 2 }],
      ["null payload", null],
      ["number payload", 1.5],
      ["string payload", "1.5"],
      ["undefined payload", undefined],
    ])("rejects %s without touching the queue", (_n, msg) => {
      const q = fresh();
      q.pushAim(0.5);
      expect(enqueueClientMessage(q, "aim", msg)).toBe(false);
      expect(q.aim).toBe(0.5);
      expect(q.actions).toEqual([]);
    });
  });

  describe.each(["attack", "release"] as const)("%s", (type) => {
    it("queues the angle as an action and leaves movement and aim alone", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, { a: 0.75 })).toBe(true);
      expect(q.actions).toEqual([{ kind: type, a: 0.75 }]);
      expect(q.move).toBeNull();
      expect(q.aim).toBeNull(); // the handler aims from the action; it isn't also an aim message
    });

    it("keeps an angle of exactly 0", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, { a: 0 })).toBe(true);
      expect(q.actions).toEqual([{ kind: type, a: 0 }]);
    });

    it("wraps the angle into (-PI, PI]", () => {
      const q = fresh();
      enqueueClientMessage(q, type, { a: 2 * Math.PI + 1 });
      enqueueClientMessage(q, type, { a: -7 });
      enqueueClientMessage(q, type, { a: -Math.PI });
      const [a, b, c] = q.actions as Array<{ a: number }>;
      expect(a!.a).toBeCloseTo(1, 9);
      expect(b!.a).toBeCloseTo(-7 + 2 * Math.PI, 9);
      expect(c!.a).toBe(Math.PI);
    });

    it("carries a finite timestamp `t` through unchanged", () => {
      const q = fresh();
      enqueueClientMessage(q, type, { a: 1, t: 12_345.5 });
      expect(q.actions).toEqual([{ kind: type, a: 1, t: 12_345.5 }]);
    });

    it("clamping `t` is the sim's job: any finite number is queued as sent", () => {
      const q = fresh();
      enqueueClientMessage(q, type, { a: 1, t: -5 });
      enqueueClientMessage(q, type, { a: 1, t: 0 });
      enqueueClientMessage(q, type, { a: 1, t: 1e15 });
      expect(q.actions.map((x) => (x as { t?: number }).t)).toEqual([-5, 0, 1e15]);
    });

    it.each([
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["a string", "100"],
      ["null", null],
      ["a boolean", true],
      ["an object", {}],
      ["a bigint", 5n],
    ])("drops a bad `t` (%s) but still queues the input, without lag compensation", (_n, t) => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, { a: 1, t })).toBe(true);
      expect(q.actions).toEqual([{ kind: type, a: 1 }]);
      expect("t" in q.actions[0]!).toBe(false);
    });

    it("omits `t` when none is sent", () => {
      const q = fresh();
      enqueueClientMessage(q, type, { a: 1 });
      expect("t" in q.actions[0]!).toBe(false);
    });

    it("strips unknown fields and cannot be made another kind", () => {
      const q = fresh();
      enqueueClientMessage(q, type, { a: 1, t: 5, kind: "swap", hp: 9999, slot: 1, containerId: "c" });
      expect(q.actions).toEqual([{ kind: type, a: 1, t: 5 }]);
    });

    it.each([
      ["the old point target", { x: 5, y: 5 }],
      ["NaN", { a: NaN }],
      ["Infinity", { a: -Infinity }],
      ["a string angle", { a: "0.5" }],
      ["null angle", { a: null }],
      ["a missing angle", { t: 100 }],
      ["an empty object", {}],
      ["a bare number", 0.5],
      ["a string", "0.5"],
      ["null", null],
      ["undefined", undefined],
    ])("rejects %s without queueing anything", (_n, msg) => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, msg)).toBe(false);
      expect(q.actions).toEqual([]);
      expect(q.dropped).toBe(0);
      expect(q.aim).toBeNull();
      expect(q.move).toBeNull();
    });
  });

  describe("swap", () => {
    it("without a slot queues a plain swap (to the other slot)", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "swap", {})).toBe(true);
      expect(q.actions).toEqual([{ kind: "swap" }]);
      expect("slot" in q.actions[0]!).toBe(false);
    });

    it("needs no payload at all, like stop", () => {
      for (const payload of [undefined, null, 5, "junk"]) {
        const q = fresh();
        expect(enqueueClientMessage(q, "swap", payload)).toBe(true);
        expect(q.actions).toEqual([{ kind: "swap" }]);
      }
    });

    it.each([0, 1] as const)("queues slot %i", (slot) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "swap", { slot })).toBe(true);
      expect(q.actions).toEqual([{ kind: "swap", slot }]);
    });

    it("treats a slot explicitly set to undefined as omitted", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "swap", { slot: undefined })).toBe(true);
      expect(q.actions).toEqual([{ kind: "swap" }]);
    });

    it("strips unknown fields", () => {
      const q = fresh();
      enqueueClientMessage(q, "swap", { slot: 1, a: 3, containerId: "c", hp: 9 });
      expect(q.actions).toEqual([{ kind: "swap", slot: 1 }]);
    });

    it.each([
      ["2", 2],
      ["-1", -1],
      ["0.5", 0.5],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["the string '0'", "0"],
      ["the string '1'", "1"],
      ["null", null],
      ["true", true],
      ["a bigint", 1n],
      ["an array", [0]],
      ["an object", {}],
    ])("rejects slot %s without queueing anything", (_n, slot) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "swap", { slot })).toBe(false);
      expect(q.actions).toEqual([]);
      expect(q.dropped).toBe(0);
    });
  });

  describe("target", () => {
    it("queues the id of the fighter to lock", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "target", { id: "mob7" })).toBe(true);
      expect(q.actions).toEqual([{ kind: "target", id: "mob7" }]);
    });

    it("strips unknown fields", () => {
      const q = fresh();
      enqueueClientMessage(q, "target", { id: "p1", x: 5, y: 5, a: 1, kind: "swap" });
      expect(q.actions).toEqual([{ kind: "target", id: "p1" }]);
    });

    it.each([
      ["missing id", {}],
      ["empty id", { id: "" }],
      ["numeric id", { id: 1 }],
      ["null id", { id: null }],
      ["oversized id", { id: "c".repeat(65) }],
      ["array id", { id: ["p1"] }],
      ["null payload", null],
      ["undefined payload", undefined],
      ["string payload", "p1"],
    ])("rejects %s", (_n, msg) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "target", msg)).toBe(false);
      expect(q.actions).toEqual([]);
    });

    it("accepts an id of exactly 64 chars and counts toward the action cap", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "target", { id: "z".repeat(64) })).toBe(true);
      for (let i = 0; i < 20; i++) enqueueClientMessage(q, "target", { id: `p${i}` });
      expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
    });
  });

  describe("pickup", () => {
    it("queues the containerId", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "pickup", { containerId: "c1" })).toBe(true);
      expect(q.actions).toEqual([{ kind: "pickup", containerId: "c1" }]);
    });

    it("strips unknown fields", () => {
      const q = fresh();
      enqueueClientMessage(q, "pickup", { containerId: "c1", uid: "i9", count: 99, kind: "swap" });
      expect(q.actions).toEqual([{ kind: "pickup", containerId: "c1" }]);
    });

    it.each([
      ["missing containerId", {}],
      ["only a uid, as the old take sent", { uid: "i9" }],
      ["empty containerId", { containerId: "" }],
      ["numeric containerId", { containerId: 1 }],
      ["null containerId", { containerId: null }],
      ["oversized containerId", { containerId: "c".repeat(65) }],
      ["array containerId", { containerId: ["c1"] }],
      ["null payload", null],
      ["undefined payload", undefined],
      ["string payload", "c1"],
    ])("rejects %s", (_n, msg) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "pickup", msg)).toBe(false);
      expect(q.actions).toEqual([]);
    });

    it("accepts an id of exactly 64 chars", () => {
      const q = fresh();
      expect(enqueueClientMessage(q, "pickup", { containerId: "z".repeat(64) })).toBe(true);
    });
  });

  describe("plan", () => {
    it.each([
      [{ spawn: 0 }, { kind: "plan", spawn: 0 }],
      [{ spawn: 1 }, { kind: "plan", spawn: 1 }],
      [{ boon: 1 }, { kind: "plan", boon: 1 }],
      [{ ready: true }, { kind: "plan", ready: true }],
      [{ ready: false }, { kind: "plan", ready: false }],
      [{ spawn: 1, boon: 0, ready: true }, { kind: "plan", spawn: 1, boon: 0, ready: true }],
      [{ spawn: 0, x: 99, pick: 5, kind: "move" }, { kind: "plan", spawn: 0 }],
    ])("queues %j", (msg, want) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "plan", msg)).toBe(true);
      expect(q.actions).toEqual([want]);
      expect(parsePlan(msg)).toEqual(want);
    });

    it.each([
      ["an empty object", {}],
      ["only unknown fields", { pick: 0 }],
      ["a spawn of 2", { spawn: 2 }],
      ["a negative spawn", { spawn: -1 }],
      ["a fractional spawn", { spawn: 0.5 }],
      ["a spawn as a string", { spawn: "1" }],
      ["a pool index", { spawn: 7 }],
      ["a boon of 2", { boon: 2 }],
      ["a null spawn", { spawn: null }],
      ["ready as a number", { ready: 1 }],
      ["ready as a string", { ready: "true" }],
      ["a good spawn with a bad ready", { spawn: 0, ready: "yes" }],
      ["a good ready with a bad spawn", { spawn: 3, ready: true }],
      ["null payload", null],
      ["a number payload", 1],
    ])("rejects %s whole", (_n, msg) => {
      const q = fresh();
      expect(enqueueClientMessage(q, "plan", msg)).toBe(false);
      expect(q.actions).toEqual([]);
      expect(parsePlan(msg)).toBeNull();
    });
  });

  describe("message types that no longer exist", () => {
    it.each(["take", "drop", "use", "extract"])("%s is not a message type any more", (type) => {
      for (const payload of [{}, null, undefined, "junk", { uid: "u", containerId: "c", x: 1, y: 2, a: 1 }]) {
        const q = fresh();
        expect(enqueueClientMessage(q, type, payload)).toBe(false);
        expect(q.move).toBeNull();
        expect(q.aim).toBeNull();
        expect(q.actions).toEqual([]);
      }
    });
  });

  describe("the message contract", () => {
    // Typed over every client message: adding a message type breaks this until it has a valid example.
    const VALID: Record<ClientMessageType, unknown> = {
      move: { x: 10, y: 20 },
      stop: {},
      target: { id: "mob1" },
      aim: { a: 0.5 },
      attack: { a: 0.5, t: 100 },
      release: { a: 0.5, t: 100 },
      swap: { slot: 1 },
      pickup: { containerId: "c1" },
      plan: { spawn: 1, ready: true },
    };

    it("every client message type is accepted with a valid payload", () => {
      for (const type of CLIENT_MESSAGE_TYPES) {
        expect(enqueueClientMessage(fresh(), type, VALID[type]), type).toBe(true);
      }
    });

    it("lists exactly the message types the examples cover", () => {
      expect([...CLIENT_MESSAGE_TYPES].sort()).toEqual(Object.keys(VALID).sort());
    });
  });

  describe("unknown message types", () => {
    it.each(["", "MOVE", "Move", "move ", "Attack", "teleport", "setPosition", "damage", "result", "fx",
      "__proto__", "constructor", "toString", "hasOwnProperty"])("rejects %j", (type) => {
      const q = fresh();
      expect(enqueueClientMessage(q, type, { x: 1, y: 1, a: 1, slot: 0, uid: "u", containerId: "c" })).toBe(false);
      expect(q.move).toBeNull();
      expect(q.aim).toBeNull();
      expect(q.actions).toEqual([]);
    });
  });

  describe("spam handling", () => {
    it("queues at most MAX_ACTIONS_PER_TICK actions from a flood of valid messages", () => {
      const q = fresh();
      for (let i = 0; i < 50; i++) enqueueClientMessage(q, "pickup", { containerId: `c${i}` });
      expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
      expect(q.dropped).toBe(50 - MAX_ACTIONS_PER_TICK);
    });

    it("counts every action kind toward the cap, but never move, stop or aim", () => {
      const q = fresh();
      for (let i = 0; i < 20; i++) {
        enqueueClientMessage(q, "move", { x: i, y: i });
        enqueueClientMessage(q, "stop", {});
        enqueueClientMessage(q, "aim", { a: 1 });
      }
      expect(q.dropped).toBe(0);
      for (const [type, msg] of [
        ["attack", { a: 1 }], ["release", { a: 1 }], ["swap", {}], ["pickup", { containerId: "c" }],
        ["attack", { a: 2 }], ["release", { a: 2 }], ["swap", { slot: 0 }], ["pickup", { containerId: "d" }],
      ] as const) {
        enqueueClientMessage(q, type, msg);
      }
      expect(q.actions).toHaveLength(MAX_ACTIONS_PER_TICK);
      expect(q.dropped).toBe(8 - MAX_ACTIONS_PER_TICK);
    });

    it("rejected messages never count toward the action cap", () => {
      const q = fresh();
      for (let i = 0; i < 50; i++) enqueueClientMessage(q, "pickup", { uid: "x" });
      for (let i = 0; i < 50; i++) enqueueClientMessage(q, "attack", { x: 1, y: 2 });
      for (let i = 0; i < 50; i++) enqueueClientMessage(q, "swap", { slot: 2 });
      expect(q.dropped).toBe(0);
      expect(enqueueClientMessage(q, "release", { a: 1 })).toBe(true);
      expect(q.actions).toHaveLength(1);
    });

    it("mixed actions keep arrival order", () => {
      const q = fresh();
      enqueueClientMessage(q, "swap", { slot: 1 });
      enqueueClientMessage(q, "attack", { a: 1 });
      enqueueClientMessage(q, "release", { a: 1.5 });
      enqueueClientMessage(q, "pickup", { containerId: "b" });
      const kinds = q.drain().actions.map((a: ActionCommand) => a.kind);
      expect(kinds).toEqual(["swap", "attack", "release", "pickup"]);
    });
  });
});
