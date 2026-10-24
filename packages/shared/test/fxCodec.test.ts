import { describe, expect, it } from "vitest";
import {
  BUFF_STATS, COMBOS, FX_SCALE, mulberry32, packFx, unpackFx, WEAPON_IDS, type FxBatch, type FxEvent, type ProjectileEnd,
  type TimedFx,
} from "../src/index";

type FxOf<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;
/** One example of every kind (typed so that a new FxEvent kind fails to compile until it is listed here and in the codec). */
const EXAMPLES: { [K in FxEvent["kind"]]: FxOf<K> } = {
  windup: { kind: "windup", by: "sess-001", weapon: "sword", a: -2.3456, ms: 233.3333 },
  swing: { kind: "swing", by: "m12", weapon: "axe", x: 1234.4, y: 87.6, a: 3.1 },
  hit: { kind: "hit", id: "sess-002", by: "m12", amount: 123.456, weapon: "bow" },
  block: { kind: "block", id: "sess-002", by: "sess-001", weapon: "shield" },
  stagger: { kind: "stagger", id: "sess-003" },
  projEnd: { kind: "projEnd", id: "p7", proj: "ball", x0: 100.2, y0: 2000.9, t0: 98765.4, x: 140.6, y: 1999.5, reason: "destroyed" },
  death: { kind: "death", id: "m3", x: 640.5, y: 12.2, by: "sess-001" },
  heal: { kind: "heal", id: "sess-001", amount: 7.77 },
  teleport: { kind: "teleport" },
  bounty: { kind: "bounty", id: "sess-001", name: "Rampager", bounty: 35 },
  buff: { kind: "buff", id: "sess-001", stat: "attackSpeed", stacks: 1.0667, total: 2.9964 },
  combo: { kind: "combo", id: "sess-001", combo: "cascade", proc: true },
  victory: { kind: "victory", id: "sess-001", name: "Rampager", draw: false },
};

const T = 123450;
const scale = FX_SCALE;
/** The most a field can move: half a step of its resolution (plus float noise). */
const within = (got: number, want: number, perUnit: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(0.5 / perUnit + 1e-9);
};

function roundTrip(fx: FxEvent, t = T): TimedFx {
  const out = unpackFx(packFx([fx], t));
  expect(out).toHaveLength(1);
  return out[0]!;
}

/** Decoded `got` equals `want` except for fields whose numbers may move by a half step. */
function expectSame(got: TimedFx, want: FxEvent, t = T): void {
  expect(Object.keys(got).sort()).toEqual([...Object.keys(want), "t"].sort());
  expect(got.t).toBe(t);
  const g = got as unknown as Record<string, unknown>;
  const w = want as unknown as Record<string, unknown>;
  const perUnit: Record<string, number> = {
    x: scale.pos, y: scale.pos, x0: scale.pos, y0: scale.pos, a: scale.angle, ms: scale.ms, t0: scale.ms,
    amount: scale.amount, stacks: scale.stacks, total: scale.stacks, bounty: 1,
  };
  for (const key of Object.keys(w)) {
    if (typeof w[key] === "number") within(g[key] as number, w[key] as number, perUnit[key] ?? Infinity);
    else expect(g[key], key).toEqual(w[key]);
  }
}

describe("fx codec: round trip", () => {
  for (const kind of Object.keys(EXAMPLES) as FxEvent["kind"][]) {
    it(`${kind} comes back whole, numbers within half a step`, () => {
      expectSame(roundTrip(EXAMPLES[kind]), EXAMPLES[kind]);
    });
  }

  it("is exact for values already on the grid", () => {
    const fx: FxEvent = { kind: "swing", by: "a", weapon: "sword", x: 300, y: -45, a: -1.57 };
    expect(roundTrip(fx)).toEqual({ ...fx, t: T });
    const hit: FxEvent = { kind: "hit", id: "a", by: "b", amount: 12.5, weapon: "wand" };
    expect(roundTrip(hit)).toEqual({ ...hit, t: T });
  });

  it("rounds to the stated resolution", () => {
    expect(roundTrip({ kind: "swing", by: "a", weapon: "sword", x: 10.4, y: 10.6, a: 1.5749 })).toMatchObject({ x: 10, y: 11, a: 1.57 });
    expect(roundTrip({ kind: "hit", id: "a", by: "b", amount: 3.14159, weapon: "sword" })).toMatchObject({ amount: 3.1 });
    expect(roundTrip({ kind: "windup", by: "a", weapon: "sword", a: 0, ms: 349.6 })).toMatchObject({ ms: 350 });
    expect(roundTrip({ kind: "buff", id: "a", stat: "hp", stacks: 1.0664, total: 2.9996 })).toMatchObject({ stacks: 1.066, total: 3 });
  });

  it("handles negative coordinates and angles, and never produces -0", () => {
    const a = roundTrip({ kind: "death", id: "a", x: -12.4, y: -0.3, by: null }) as FxOf<"death"> & { t: number };
    expect(a.x).toBe(-12);
    expect(Object.is(a.y, 0)).toBe(true);
    const s = roundTrip({ kind: "swing", by: "a", weapon: "axe", x: -400.5, y: -1, a: -3.14159 }) as FxOf<"swing"> & { t: number };
    expect(s.x).toBe(-400); // Math.round: halves go up
    expect(s.y).toBe(-1);
    expect(s.a).toBe(-3.14);
    const p = roundTrip({ kind: "projEnd", id: "p", proj: "arrow", x0: -3, y0: -0.2, t0: 5, x: -90.5, y: -0.6, reason: "wall" }) as FxOf<"projEnd">;
    expect(p).toMatchObject({ x0: -3, y0: 0, x: -90, y: -1 });
  });

  it("keeps the null of the nullable fields, and reads an absent one as null", () => {
    expect(roundTrip({ kind: "hit", id: "a", by: null, amount: 2, weapon: null })).toEqual({ kind: "hit", id: "a", by: null, amount: 2, weapon: null, t: T });
    expect(roundTrip({ kind: "death", id: "m1", x: 1, y: 2, by: null })).toEqual({ kind: "death", id: "m1", x: 1, y: 2, by: null, t: T });
    const draw: FxEvent = { kind: "victory", id: null, name: null, draw: true };
    expect(roundTrip(draw)).toEqual({ ...draw, t: T });
    const nobody: FxEvent = { kind: "victory", id: null, name: null, draw: false };
    expect(roundTrip(nobody)).toEqual({ ...nobody, t: T });
    // A field a caller left out (undefined) travels as null.
    const sloppy = { kind: "hit", id: "a", amount: 1 } as unknown as FxEvent;
    expect(roundTrip(sloppy)).toMatchObject({ kind: "hit", by: null, weapon: null });
    const sloppyVictory = { kind: "victory", draw: true } as unknown as FxEvent;
    expect(roundTrip(sloppyVictory)).toMatchObject({ kind: "victory", id: null, name: null, draw: true });
  });

  it("covers every weapon, buff stat, combo and end reason", () => {
    for (const weapon of WEAPON_IDS) {
      expect(roundTrip({ kind: "windup", by: "a", weapon, a: 1, ms: 100 })).toMatchObject({ weapon });
      expect(roundTrip({ kind: "hit", id: "a", by: "b", amount: 1, weapon })).toMatchObject({ weapon });
      expect(roundTrip({ kind: "block", id: "a", by: "b", weapon })).toMatchObject({ weapon });
    }
    for (const stat of BUFF_STATS) expect(roundTrip({ kind: "buff", id: "a", stat, stacks: 1, total: 2 })).toMatchObject({ stat });
    for (const c of COMBOS) {
      expect(roundTrip({ kind: "combo", id: "a", combo: c.id, proc: false })).toMatchObject({ combo: c.id, proc: false });
    }
    const ends: ProjectileEnd[] = ["hit", "wall", "range", "reflected", "deleted", "destroyed", "cleared"];
    for (const reason of ends) {
      for (const proj of ["arrow", "ball"] as const) {
        expect(roundTrip({ kind: "projEnd", id: "p", proj, x0: 1, y0: 2, t0: 3, x: 4, y: 5, reason })).toMatchObject({ proj, reason });
      }
    }
  });

  it("keeps a reflected arrow's start (it can start and stop inside one tick)", () => {
    const fx: FxEvent = { kind: "projEnd", id: "p9", proj: "arrow", x0: 512, y0: 640, t0: 7000, x: 530, y: 641, reason: "reflected" };
    expect(roundTrip(fx)).toEqual({ ...fx, t: T });
  });

  it("holds to the resolution over random values", () => {
    const r = mulberry32(42);
    const span = (n: number): number => (r() - 0.5) * 2 * n;
    for (let i = 0; i < 500; i++) {
      const swing: FxEvent = { kind: "swing", by: "a", weapon: "axe", x: span(2100), y: span(2100), a: span(Math.PI) };
      expectSame(roundTrip(swing), swing);
      const hit: FxEvent = { kind: "hit", id: "a", by: "b", amount: r() * 600, weapon: "sword" };
      expectSame(roundTrip(hit), hit);
      const end: FxEvent = { kind: "projEnd", id: "p", proj: "arrow", x0: span(2100), y0: span(2100), t0: r() * 1e6, x: span(2100), y: span(2100), reason: "hit" };
      expectSame(roundTrip(end), end);
    }
  });

  it("stamps every event with the batch time, unrounded", () => {
    const out = unpackFx(packFx(Object.values(EXAMPLES), 98765.4321));
    expect(out).toHaveLength(Object.keys(EXAMPLES).length);
    for (const fx of out) expect(fx.t).toBe(98765.4321);
  });
});

describe("fx codec: batches", () => {
  it("an empty batch decodes to nothing", () => {
    const batch = packFx([], T);
    expect(batch).toEqual({ t: T, l: [] });
    expect(unpackFx(batch)).toEqual([]);
  });

  it("keeps order across a batch of 100 mixed events", () => {
    const kinds = Object.keys(EXAMPLES) as FxEvent["kind"][];
    const list: FxEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const base = EXAMPLES[kinds[(i * 7) % kinds.length]!];
      list.push({ ...base, ...(base.kind === "hit" ? { amount: i + 0.5 } : {}) } as FxEvent);
    }
    const out = unpackFx(packFx(list, T));
    expect(out).toHaveLength(100);
    out.forEach((fx, i) => expectSame(fx, list[i]!));
    expect(out.map((f) => f.kind)).toEqual(list.map((f) => f.kind));
  });

  it("is plain data a msgpack or JSON wire carries unchanged: only integers, strings and null in the tuples", () => {
    const batch = packFx(Object.values(EXAMPLES), T);
    for (const tuple of batch.l) {
      for (const v of tuple) {
        if (typeof v === "number") expect(Number.isSafeInteger(v), `${v} in ${JSON.stringify(tuple)}`).toBe(true);
        else expect(v === null || typeof v === "string").toBe(true);
      }
    }
    expect(JSON.parse(JSON.stringify(batch))).toEqual(batch);
    expect(unpackFx(JSON.parse(JSON.stringify(batch)) as FxBatch)).toEqual(unpackFx(batch));
  });

  it("a teleport is one number", () => {
    expect(packFx([{ kind: "teleport" }], T).l).toEqual([[8]]);
  });
});

describe("fx codec: bad input is skipped, not thrown on", () => {
  const good: FxEvent = { kind: "stagger", id: "ok" };
  const goodTuple = packFx([good], T).l[0]!;

  it("skips an unknown kind code and keeps the rest", () => {
    const batch: FxBatch = { t: T, l: [goodTuple, [99, "x", 1, 2], goodTuple, [-1], [1.5, "x"]] };
    expect(unpackFx(batch)).toEqual([{ ...good, t: T }, { ...good, t: T }]);
  });

  it("skips a tuple that is not an array, is empty, or has a missing or mistyped field", () => {
    const l = [
      null, 7, "stagger", {}, [], [4], [4, 5],
      [0, "a", 1, 100],                    // windup, missing ms
      [0, "a", 77, 100, 200],              // windup, unknown weapon
      [0, "a", 1, "x", 200],               // windup, angle is a string
      [2, "a", "b", 10, 77],               // hit, unknown weapon
      [5, "p", 0, 9, 1, 2, 3, 4, 5],       // projEnd, unknown reason
      [11, "a", 0, 2],                     // combo, proc is not 0 or 1
      [12, null, null],                    // victory, no draw flag
      [4, Number.NaN],                     // stagger, id is a number
      [6, "a", Number.POSITIVE_INFINITY, 0, null], // death, infinite x
      goodTuple,
    ] as unknown as FxBatch["l"];
    expect(unpackFx({ t: T, l })).toEqual([{ ...good, t: T }]);
  });

  it("returns nothing for a batch with no usable time or list", () => {
    expect(unpackFx({ t: Number.NaN, l: [goodTuple] })).toEqual([]);
    expect(unpackFx({ t: "5", l: [goodTuple] } as unknown as FxBatch)).toEqual([]);
    expect(unpackFx({ t: T } as unknown as FxBatch)).toEqual([]);
    expect(unpackFx(null as unknown as FxBatch)).toEqual([]);
    expect(unpackFx(undefined as unknown as FxBatch)).toEqual([]);
  });

  it("packFx drops an event of a kind it does not know", () => {
    const alien = { kind: "meteor", x: 1 } as unknown as FxEvent;
    expect(packFx([good, alien, good], T).l).toHaveLength(2);
  });
});
