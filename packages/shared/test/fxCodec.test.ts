import { describe, expect, it } from "vitest";
import {
  BUFF_STATS, COMBOS, comboTier, formatStacks, FX_SCALE, mulberry32, packFx, unpackFx, unpackLaunches, WEAPON_IDS, WEAPONS,
  type FxBatch, type FxEvent, type ProjectileEnd, type ProjectileLaunch, type TimedFx,
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
/** No fighter is named by roster index in most tests: the roster is empty. */
const NONE: string[] = [];
const scale = FX_SCALE;
/** The most a field can move: half a step of its resolution (plus float noise). */
const within = (got: number, want: number, perUnit: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(0.5 / perUnit + 1e-9);
};

function roundTrip(fx: FxEvent, t = T): TimedFx {
  const out = unpackFx(packFx([fx], t), NONE);
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
    expect(roundTrip({ kind: "buff", id: "a", stat: "hp", stacks: 1.0664, total: 2.4996 })).toMatchObject({ stacks: 1.066, total: 2.5 });
    // ...except onto a combo threshold that has not been reached (see "a buff total never crosses a combo threshold")
    expect(roundTrip({ kind: "buff", id: "a", stat: "hp", stacks: 1.0664, total: 2.9996 })).toMatchObject({ stacks: 1.066, total: 2.999 });
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
    const ends: ProjectileEnd[] = ["hit", "wall", "range", "reflected", "blocked", "deleted", "destroyed", "cleared"];
    for (const reason of ends) {
      for (const proj of ["arrow", "ball"] as const) {
        expect(roundTrip({ kind: "projEnd", id: "p", proj, x0: 1, y0: 2, t0: 3, x: 4, y: 5, reason })).toMatchObject({ proj, reason });
      }
    }
  });

  it("carries a hit's signature and a block's passive flag, and leaves them off when absent", () => {
    for (const sig of ["burn", "backlash", "disease", "mark"] as const) {
      expect(roundTrip({ kind: "hit", id: "a", by: "b", amount: 5, weapon: "axe", sig })).toEqual(
        { kind: "hit", id: "a", by: "b", amount: 5, weapon: "axe", sig, t: T },
      );
    }
    const plain = packFx([{ kind: "hit", id: "a", by: "b", amount: 5, weapon: "axe" }], T).l[0]!;
    expect(plain).toHaveLength(5); // weapon and signature share the last element: a signature costs no extra byte
    expect(roundTrip({ kind: "block", id: "a", by: "b", weapon: "shield", passive: true })).toEqual(
      { kind: "block", id: "a", by: "b", weapon: "shield", passive: true, t: T },
    );
    expect(packFx([{ kind: "block", id: "a", by: "b", weapon: "shield" }], T).l[0]).toHaveLength(4);
    expect(roundTrip({ kind: "block", id: "a", by: "b", weapon: "shield", passive: false })).toEqual(
      { kind: "block", id: "a", by: "b", weapon: "shield", t: T },
    );
  });

  it("skips a hit whose signature code is unknown rather than dropping the signature silently", () => {
    expect(unpackFx({ t: T, l: [[2, "a", "b", 50, 99]] }, NONE)).toEqual([]);
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
    const out = unpackFx(packFx(Object.values(EXAMPLES), 98765.4321), NONE);
    expect(out).toHaveLength(Object.keys(EXAMPLES).length);
    for (const fx of out) expect(fx.t).toBe(98765.4321);
  });
});

describe("fx codec: batches", () => {
  it("an empty batch decodes to nothing", () => {
    const batch = packFx([], T);
    expect(batch).toEqual({ t: T, l: [] });
    expect(unpackFx(batch, NONE)).toEqual([]);
  });

  it("keeps order across a batch of 100 mixed events", () => {
    const kinds = Object.keys(EXAMPLES) as FxEvent["kind"][];
    const list: FxEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const base = EXAMPLES[kinds[(i * 7) % kinds.length]!];
      list.push({ ...base, ...(base.kind === "hit" ? { amount: i + 0.5 } : {}) } as FxEvent);
    }
    const out = unpackFx(packFx(list, T), NONE);
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
    expect(unpackFx(JSON.parse(JSON.stringify(batch)) as FxBatch, NONE)).toEqual(unpackFx(batch, NONE));
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
    expect(unpackFx(batch, NONE)).toEqual([{ ...good, t: T }, { ...good, t: T }]);
  });

  it("skips a tuple that is not an array, is empty, or has a missing or mistyped field", () => {
    const l = [
      null, 7, "stagger", {}, [], [4], [4, 5],
      [0, "a", 1, 100],                    // windup, missing ms
      [0, "a", 77, 100, 200],              // windup, unknown weapon
      [0, "a", 1, "x", 200],               // windup, angle is a string
      [2, "a", "b", 10, 77],               // hit, unknown weapon (and signature)
      [2, "a", "b", 10, -1],               // hit, negative flags
      [2, "a", "b", 10, 1.5],              // hit, fractional flags
      [2, 7, "b", 10, 1],                  // hit, id is a roster index the roster does not have
      [2, -1, "b", 10, 1],                 // hit, id is a negative number
      [5, "p", 0, 9, 1, 2, 3, 4, 5],       // projEnd, unknown reason
      [11, "a", 0, 2],                     // combo, proc is not 0 or 1
      [12, null, null],                    // victory, no draw flag
      [4, Number.NaN],                     // stagger, id is a number
      [6, "a", Number.POSITIVE_INFINITY, 0, null], // death, infinite x
      goodTuple,
    ] as unknown as FxBatch["l"];
    expect(unpackFx({ t: T, l }, NONE)).toEqual([{ ...good, t: T }]);
  });

  it("returns nothing for a batch with no usable time or list", () => {
    expect(unpackFx({ t: Number.NaN, l: [goodTuple] }, NONE)).toEqual([]);
    expect(unpackFx({ t: "5", l: [goodTuple] } as unknown as FxBatch, NONE)).toEqual([]);
    expect(unpackFx({ t: T } as unknown as FxBatch, NONE)).toEqual([]);
    expect(unpackFx(null as unknown as FxBatch, NONE)).toEqual([]);
    expect(unpackFx(undefined as unknown as FxBatch, NONE)).toEqual([]);
  });

  it("packFx drops an event of a kind it does not know", () => {
    const alien = { kind: "meteor", x: 1 } as unknown as FxEvent;
    expect(packFx([good, alien, good], T).l).toHaveLength(2);
  });
});

describe("fx codec: fighter ids by roster index", () => {
  const roster = ["Ab3dEf9hI", "mob1a", "mob1b"];
  const index = new Map(roster.map((id, i) => [id, i]));

  it("sends a rostered id as its index and reads it back, and leaves other strings alone", () => {
    const fx: FxEvent[] = [
      { kind: "hit", id: "Ab3dEf9hI", by: "mob1a", amount: 12, weapon: "sword" },
      { kind: "hit", id: "mob1b", by: null, amount: 3, weapon: null, sig: "burn" },
      { kind: "death", id: "Zz9yXx8wV", x: 1, y: 2, by: "mob1a" }, // joined this tick: not in the roster yet
      { kind: "bounty", id: "Ab3dEf9hI", name: "mob1b", bounty: 20 }, // a callsign that looks like a roster id
    ];
    const batch = packFx(fx, T, { roster: index });
    expect(batch.l[0]).toEqual([2, 0, 1, 120, 1]);
    expect(batch.l[1]).toEqual([2, 2, null, 30, 0 + (0 + 1) * (WEAPON_IDS.length + 1)]);
    expect(batch.l[2]).toEqual([6, "Zz9yXx8wV", 1, 2, 1]);
    expect(unpackFx(batch, roster)).toEqual(fx.map((f) => ({ ...f, t: T })));
  });

  it("without a roster the ids stay whole", () => {
    const batch = packFx([{ kind: "stagger", id: "Ab3dEf9hI" }], T);
    expect(batch.l).toEqual([[4, "Ab3dEf9hI"]]);
    expect(unpackFx(batch, NONE)).toEqual([{ kind: "stagger", id: "Ab3dEf9hI", t: T }]);
  });

  it("skips an event whose index the client's roster does not have (yet)", () => {
    const batch = packFx([{ kind: "stagger", id: "mob1b" }, { kind: "teleport" }], T, { roster: index });
    expect(unpackFx(batch, roster.slice(0, 2))).toEqual([{ kind: "teleport", t: T }]);
    expect(unpackFx(batch, roster)).toHaveLength(2);
  });

  it("works with an array-like roster (a decoded ArraySchema is not an Array)", () => {
    const arrayLike = { length: 3, 0: "Ab3dEf9hI", 1: "mob1a", 2: "mob1b" };
    const batch = packFx([{ kind: "stagger", id: "mob1a" }], T, { roster: index });
    expect(unpackFx(batch, arrayLike)).toEqual([{ kind: "stagger", id: "mob1a", t: T }]);
  });
});

describe("fx codec: unreadable tuples are reported", () => {
  const roster = ["Ab3dEf9hI", "mob1a", "mob1b", "mob1c"];
  const index = new Map(roster.map((id, i) => [id, i]));
  const stagger = (id: string): FxEvent => ({ kind: "stagger", id });

  it("tells a roster index the client does not have from a tuple that is simply unreadable", () => {
    const fx: FxEvent[] = [
      { kind: "hit", id: "mob1c", by: "mob1a", amount: 12, weapon: "sword" },
      { kind: "death", id: "mob1b", x: 1, y: 2, by: null },
      stagger("Ab3dEf9hI"),
    ];
    const batch = packFx(fx, T, { roster: index });
    batch.l.push([99, 1, 2], [2, 0, 1, "ten", 0]); // an unknown kind, and a hit whose amount is not a number
    const dropped: Array<[unknown, boolean]> = [];
    const out = unpackFx(batch, roster.slice(0, 3), (tuple, unresolved) => dropped.push([tuple, unresolved]));
    expect(out).toEqual([{ ...fx[1], t: T }, { ...fx[2], t: T }]);
    expect(dropped).toEqual([[batch.l[0], true], [[99, 1, 2], false], [[2, 0, 1, "ten", 0], false]]);
  });

  it("reports the review's batch of three events against a four entry roster: a death, a hit and a bounty, all gone", () => {
    const batch: FxBatch = { t: T, l: [[6, 4, 10, 10, null], [2, 0, 4, 50, 1], [9, 4, 4, 50]] };
    const unresolved: boolean[] = [];
    expect(unpackFx(batch, roster, (_tuple, missing) => unresolved.push(missing))).toEqual([]);
    expect(unresolved).toEqual([true, true, true]);
  });

  it("stays quiet when every tuple reads, and the callback is optional", () => {
    const batch = packFx([stagger("mob1a"), { kind: "teleport" }], T, { roster: index });
    let calls = 0;
    expect(unpackFx(batch, roster, () => calls++)).toHaveLength(2);
    expect(calls).toBe(0);
    expect(unpackFx({ t: T, l: [[4, 40]] }, roster)).toEqual([]);
  });

  it("counts a fractional or negative index as unresolved", () => {
    const flags: boolean[] = [];
    unpackFx({ t: T, l: [[4, 1.5], [4, -1], [4, Number.NaN], [4, 2]] }, roster, (_tuple, missing) => flags.push(missing));
    expect(flags).toEqual([true, true, true]);
  });

  it("a later tuple is not marked unresolved by an earlier one", () => {
    const flags: boolean[] = [];
    const l: FxBatch["l"] = [[4, 40], [99], [4, 1]];
    unpackFx({ t: T, l }, roster, (_tuple, missing) => flags.push(missing));
    expect(flags).toEqual([true, false]);
  });
});

describe("fx codec: a buff total never crosses a combo threshold", () => {
  const buff = (total: number): FxEvent => ({ kind: "buff", id: "a", stat: "hp", stacks: 1, total });
  const decodedTotal = (total: number): number => {
    const out = unpackFx(packFx([buff(total)], T), NONE)[0]!;
    if (out.kind !== "buff") throw new Error("not a buff");
    return out.total;
  };

  // Just short of a threshold the server has not unlocked its combo (comboTier carries a slack of 1e-6), but the nearest
  // thousandth of 2.9996 is 3.000, which the toast would read as "(3.0)" while the HUD, from the real stacks, says "2.9".
  const cases: ReadonlyArray<[number, 0 | 1 | 2]> = [
    [2.9995, 0], [2.9996, 0], [2.99989, 0], [2.999998, 0], [2.9999985, 0], [2.9999995, 1], [3, 1], [3.0004, 1],
    [4.9995, 1], [4.9996, 1], [4.99989, 1], [4.999998, 1], [4.9999995, 2], [5, 2], [5.0004, 2],
  ];
  it.each(cases)("%s decodes to tier %i", (total, tier) => {
    expect(comboTier(total), "the table is right about the server").toBe(tier);
    const got = decodedTotal(total);
    expect(comboTier(got), `decoded ${got}`).toBe(tier);
    expect(Math.abs(got - total)).toBeLessThanOrEqual(0.001);
    expect(formatStacks(got), "the toast reads the way the HUD does").toBe(formatStacks(total));
  });

  it("holds over every total in a sweep around both thresholds, and stays within a thousandth everywhere", () => {
    for (const centre of [3, 5]) {
      for (let d = -3000; d <= 3000; d++) {
        const total = centre + d * 1e-7;
        const got = decodedTotal(total);
        expect(comboTier(got), `${total}`).toBe(comboTier(total));
        expect(Math.abs(got - total), `${total}`).toBeLessThanOrEqual(0.001);
      }
    }
  });

  it("is still the nearest thousandth away from a threshold", () => {
    for (const total of [0, 0.0004, 1.0667, 2.9964, 3.4996, 4.2, 6.6666]) expect(decodedTotal(total)).toBeCloseTo(Math.round(total * 1000) / 1000, 12);
  });
});

describe("fx codec: hit flags", () => {
  it("round trips every weapon (or none) with every signature (or none)", () => {
    const sigs = [undefined, "burn", "backlash", "disease", "mark"] as const;
    for (const weapon of [null, ...WEAPON_IDS]) {
      for (const sig of sigs) {
        const fx: FxEvent = sig ? { kind: "hit", id: "a", by: "b", amount: 4.5, weapon, sig } : { kind: "hit", id: "a", by: "b", amount: 4.5, weapon };
        expect(roundTrip(fx), `${weapon} ${sig}`).toEqual({ ...fx, t: T });
      }
    }
  });

  it("keeps weapon and signature in one element that fits a byte", () => {
    for (const weapon of WEAPON_IDS) {
      for (const sig of ["burn", "backlash", "disease", "mark"] as const) {
        const flags = packFx([{ kind: "hit", id: "a", by: "b", amount: 1, weapon, sig }], T).l[0]![4] as number;
        expect(flags).toBeLessThan(128);
      }
    }
  });
});

describe("fx codec: projEnd start", () => {
  const end: FxEvent = { kind: "projEnd", id: "p9", proj: "arrow", x0: 512, y0: 640, t0: 7000, x: 530, y: 641, reason: "hit" };

  it("is left off for a projectile whose launch was announced, and decodes as no flight from the stop point at the batch time", () => {
    const batch = packFx([end], T, { announced: new Set(["p9"]) });
    expect(batch.l[0]).toHaveLength(6);
    expect(unpackFx(batch, NONE)).toEqual([{ ...end, x0: 530, y0: 641, t0: T, t: T }]);
  });

  it("is kept for any other projectile", () => {
    for (const announced of [undefined, new Set<string>(), new Set(["p1"])]) {
      const batch = packFx([end], T, { announced });
      expect(batch.l[0]).toHaveLength(9);
      expect(unpackFx(batch, NONE)).toEqual([{ ...end, t: T }]);
    }
  });
});

describe("fx codec: projectile launches", () => {
  const arrowRange = (WEAPONS.bow.shape as { range: number }).range;
  const ballRange = (WEAPONS.wand.shape as { range: number }).range;
  const arrow: ProjectileLaunch = { id: "p1a", kind: "arrow", x: 812.345, y: 1234.567, vx: 612.25, vy: -301.55, t: T, range: arrowRange };
  const ball: ProjectileLaunch = { id: "p1b", kind: "ball", x: -3.04, y: 0.01, vx: -380, vy: 0, t: T, range: ballRange };

  it("round trips within a tenth of a unit, and a step's launches share the batch time", () => {
    const batch = packFx([], T, { launches: [arrow, ball] });
    expect(batch.l).toEqual([]);
    const out = unpackLaunches(batch);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "p1a", kind: "arrow", t: T, range: arrowRange });
    for (const key of ["x", "y", "vx", "vy"] as const) {
      expect(Math.abs(out[0]![key] - arrow[key]), key).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(Math.abs(out[1]![key] - ball[key]), key).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    expect(out[1]).toMatchObject({ id: "p1b", kind: "ball", t: T, range: ballRange });
  });

  it("leaves off the launch time and range when they are the usual ones, and sends them when they are not", () => {
    const usual = packFx([], T, { launches: [arrow] }).p![0]!;
    expect(usual).toHaveLength(6);
    const shortened = packFx([], T, { launches: [{ ...arrow, range: 61.4 }] }).p![0]!;
    expect(shortened).toHaveLength(8);
    expect(unpackLaunches({ t: T, l: [], p: [shortened] })[0]).toMatchObject({ range: 61, t: T });
    const earlier = packFx([], T, { launches: [{ ...arrow, t: T - 50 }] });
    expect(unpackLaunches(earlier)[0]).toMatchObject({ t: T - 50, range: arrowRange });
  });

  it("is plain integers apart from the id, and absent when nothing left", () => {
    const batch = packFx([], T, { launches: [arrow, ball, { ...arrow, range: 12.6, t: T - 100 }] });
    for (const tuple of batch.p!) for (const v of tuple.slice(1)) expect(Number.isSafeInteger(v), JSON.stringify(tuple)).toBe(true);
    expect(JSON.parse(JSON.stringify(batch))).toEqual(batch);
    expect("p" in packFx([], T)).toBe(false);
    expect("p" in packFx([], T, { launches: [] })).toBe(false);
    expect(unpackLaunches(packFx([], T))).toEqual([]);
  });

  it("skips a launch it cannot read, and reads none from a bad batch", () => {
    const good = packFx([], T, { launches: [arrow] }).p![0]!;
    const bad = [
      null, 5, "p", [], ["p1", 7, 1, 2, 3, 4], ["p1", 0, 1, 2, 3], [4, 0, 1, 2, 3, 4], ["p1", 0, "1", 2, 3, 4],
      ["p1", 0, 1, 2, 3, 4, "x", 5], ["p1", 0, 1, 2, 3, 4, 0],
    ] as unknown as FxBatch["l"];
    expect(unpackLaunches({ t: T, l: [], p: [...bad, good] })).toHaveLength(1);
    expect(unpackLaunches({ t: Number.NaN, l: [], p: [good] })).toEqual([]);
    expect(unpackLaunches({ t: T, l: [], p: "nope" } as unknown as FxBatch)).toEqual([]);
    expect(unpackLaunches(null as unknown as FxBatch)).toEqual([]);
  });
});
