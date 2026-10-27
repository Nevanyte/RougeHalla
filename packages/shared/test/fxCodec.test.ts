import { describe, expect, it } from "vitest";
import {
  ABILITY_IDS, ALL_WEAPON_IDS, BUFF_IDS, formatStacks, FX_SCALE, mulberry32, packFx, STATUS_KINDS, unpackFx, unpackLaunches, WEAPONS,
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
  cancel: { kind: "cancel", id: "sess-004" },
  projEnd: { kind: "projEnd", id: "p7", proj: "ball", x0: 100.2, y0: 2000.9, t0: 98765.4, x: 140.6, y: 1999.5, reason: "destroyed" },
  death: { kind: "death", id: "m3", x: 640.5, y: 12.2, by: "sess-001" },
  heal: { kind: "heal", id: "sess-001", amount: 7.77 },
  teleport: { kind: "teleport" },
  bounty: { kind: "bounty", id: "sess-001", name: "Rampager", bounty: 35 },
  buff: { kind: "buff", id: "sess-001", buff: "plagueRat", stacks: 1.0667, total: 2.9964 },
  victory: { kind: "victory", id: "sess-001", name: "Rampager", draw: false },
  cast: { kind: "cast", by: "sess-001", ability: "freeze", ms: 250, target: "sess-002", x: 640.4, y: 320.6 },
  castLand: { kind: "castLand", by: "sess-001", ability: "blaze", target: null, x: 100.2, y: 200.8, x2: 340.5, y2: 410.1 },
  castEnd: { kind: "castEnd", by: "sess-001", ability: "trial", reason: "interrupted" },
  status: { kind: "status", id: "sess-002", status: "stun", ms: 1250.4, by: "sess-001" },
  campCleared: { kind: "campCleared", camp: 7 },
  chestTaken: { kind: "chestTaken", chest: "c4f", by: "sess-001", option: 2 },
  campHeal: { kind: "campHeal", id: "sess-001", camp: 7, amount: 118.46 },
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
    x: scale.pos, y: scale.pos, x0: scale.pos, y0: scale.pos, x2: scale.pos, y2: scale.pos, a: scale.angle, ms: scale.ms, t0: scale.ms,
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
    expect(roundTrip({ kind: "buff", id: "a", buff: "iceGolem", stacks: 1.0664, total: 2.4996 })).toMatchObject({ stacks: 1.066, total: 2.5 });
    // There are no combo thresholds any more: a total is the nearest thousandth, 3.000 included.
    expect(roundTrip({ kind: "buff", id: "a", buff: "iceGolem", stacks: 1.0664, total: 2.9996 })).toMatchObject({ stacks: 1.066, total: 3 });
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

  it("covers every weapon, buff and end reason", () => {
    for (const weapon of ALL_WEAPON_IDS) {
      expect(roundTrip({ kind: "windup", by: "a", weapon, a: 1, ms: 100 })).toMatchObject({ weapon });
      expect(roundTrip({ kind: "hit", id: "a", by: "b", amount: 1, weapon })).toMatchObject({ weapon });
      expect(roundTrip({ kind: "block", id: "a", by: "b", weapon })).toMatchObject({ weapon });
    }
    for (const buff of BUFF_IDS) expect(roundTrip({ kind: "buff", id: "a", buff, stacks: 1, total: 2 })).toMatchObject({ buff });
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

  it("a cancel is its kind code (13, after victory) and the fighter, by roster index when it has one", () => {
    expect(packFx([{ kind: "cancel", id: "sess-004" }], T).l).toEqual([[13, "sess-004"]]);
    const roster = ["a", "b", "sess-004"];
    const batch = packFx([{ kind: "cancel", id: "sess-004" }], T, { roster: new Map(roster.map((id, i) => [id, i])) });
    expect(batch.l).toEqual([[13, 2]]);
    expect(unpackFx(batch, roster)).toEqual([{ kind: "cancel", id: "sess-004", t: T }]);
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
      [11, "a", 0, 1],                     // combo: retired, dropped even when well formed
      [10, "a", 20, 1000, 2000],           // buff, unknown buff code
      [12, null, null],                    // victory, no draw flag
      [4, Number.NaN],                     // stagger, id is a number
      [13, Number.NaN],                    // cancel, id is a number
      [13],                                // cancel, no id
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
    expect(batch.l[1]).toEqual([2, 2, null, 30, 0 + (0 + 1) * 7]); // HIT_RADIX: the six weapon codes and "none"
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

describe("fx codec: buffs (roguelike R4a)", () => {
  it("a buff names its BuffId by code, in MOB_TYPES order: [10, id, code, stacks, total]", () => {
    expect(BUFF_IDS).toHaveLength(20);
    BUFF_IDS.forEach((buff, code) => {
      expect(packFx([{ kind: "buff", id: "a", buff, stacks: 1.1, total: 3.3 }], T).l).toEqual([[10, "a", code, 1100, 3300]]);
    });
  });

  it("the totals are the nearest thousandth, and read the way the HUD reads them", () => {
    for (const total of [0, 0.0004, 1.0667, 2.9964, 2.9996, 3.4996, 4.2, 6.6666]) {
      const out = unpackFx(packFx([{ kind: "buff", id: "a", buff: "emberImp", stacks: 1, total }], T), NONE)[0]!;
      if (out.kind !== "buff") throw new Error("not a buff");
      expect(out.total).toBeCloseTo(Math.round(total * 1000) / 1000, 12);
      expect(formatStacks(out.total)).toBe(formatStacks(Math.round(total * 1000) / 1000));
    }
  });

  it("the retired combo code (11) is never emitted, and a client drops it through onDrop", () => {
    const alien = { kind: "combo", id: "a", combo: "dash", proc: true } as unknown as FxEvent;
    expect(packFx([alien], T).l).toEqual([]);
    const dropped: unknown[] = [];
    expect(unpackFx({ t: T, l: [[11, "a", 0, 1]] }, NONE, (tuple) => dropped.push(tuple))).toEqual([]);
    expect(dropped).toEqual([[11, "a", 0, 1]]);
  });
});

describe("fx codec: hit flags", () => {
  it("round trips every weapon (or none) with every signature (or none)", () => {
    const sigs = [undefined, "burn", "backlash", "disease", "mark"] as const;
    for (const weapon of [null, ...ALL_WEAPON_IDS]) {
      for (const sig of sigs) {
        const fx: FxEvent = sig ? { kind: "hit", id: "a", by: "b", amount: 4.5, weapon, sig } : { kind: "hit", id: "a", by: "b", amount: 4.5, weapon };
        expect(roundTrip(fx), `${weapon} ${sig}`).toEqual({ ...fx, t: T });
      }
    }
  });

  it("keeps weapon and signature in one element that fits a byte", () => {
    for (const weapon of ALL_WEAPON_IDS) {
      for (const sig of ["burn", "backlash", "disease", "mark"] as const) {
        const flags = packFx([{ kind: "hit", id: "a", by: "b", amount: 1, weapon, sig }], T).l[0]![4] as number;
        expect(flags).toBeLessThan(128);
      }
    }
  });
});

describe("fx codec: fists on the wire", () => {
  it("are weapon code 5, appended after the five loop weapons (the codes never move)", () => {
    const codeOf = (weapon: "sword" | "bow" | "wand" | "shield" | "axe" | "fists"): unknown =>
      packFx([{ kind: "windup", by: "a", weapon, a: 0, ms: 100 }], T).l[0]![2];
    expect(["sword", "bow", "wand", "shield", "axe", "fists"].map((w) => codeOf(w as "sword"))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keep the hit flags apart from the signatures: weapon + 7 x signature never collides", () => {
    const seen = new Set<number>();
    for (const weapon of [null, ...ALL_WEAPON_IDS]) {
      for (const sig of [undefined, "burn", "backlash", "disease", "mark"] as const) {
        const fx: FxEvent = sig ? { kind: "hit", id: "a", by: "b", amount: 1, weapon, sig } : { kind: "hit", id: "a", by: "b", amount: 1, weapon };
        const flags = packFx([fx], T).l[0]![4] as number;
        expect(seen.has(flags), `${weapon} ${sig}`).toBe(false);
        seen.add(flags);
      }
    }
    // A fists hit by a burn is code 5 + 1 = 6, plus (burn 0 + 1) x 7.
    expect(packFx([{ kind: "hit", id: "a", by: "b", amount: 1, weapon: "fists", sig: "burn" }], T).l[0]![4]).toBe(6 + 7);
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

describe("fx codec: abilities and statuses", () => {
  const fx = (e: FxEvent): FxEvent => e;
  const abilityCode = (id: (typeof ABILITY_IDS)[number]): number => ABILITY_IDS.indexOf(id);

  it("appends the four kinds after cancel (13): cast 14, castLand 15, castEnd 16, status 17", () => {
    const kinds = packFx(
      [
        fx({ kind: "cast", by: "a", ability: "freeze", ms: 250, target: null, x: 1, y: 2 }),
        fx({ kind: "castLand", by: "a", ability: "freeze", target: null, x: 1, y: 2 }),
        fx({ kind: "castEnd", by: "a", ability: "freeze", reason: "fizzle" }),
        fx({ kind: "status", id: "a", status: "stun", ms: 1000, by: null }),
      ],
      T,
    ).l.map((tuple) => tuple[0]);
    expect(kinds).toEqual([14, 15, 16, 17]);
  });

  it("uses the order of ABILITY_IDS and STATUS_KINDS as the codes (append-only tables)", () => {
    ABILITY_IDS.forEach((ability, i) => {
      expect(packFx([fx({ kind: "castEnd", by: "a", ability, reason: "fizzle" })], T).l[0]![2], ability).toBe(i);
    });
    STATUS_KINDS.forEach((status, i) => {
      expect(packFx([fx({ kind: "status", id: "a", status, ms: 1, by: null })], T).l[0]![2], status).toBe(i);
    });
    expect(ABILITY_IDS.slice(0, 5)).toEqual(["freeze", "swarm", "trial", "blaze", "lastStand"]);
    expect(STATUS_KINDS[0]).toBe("stun");
    expect(STATUS_KINDS[12]).toBe("haste");
  });

  it("cast: [by, AB, ms, target|null, x, y], with a target or without, for every ability", () => {
    for (const ability of ABILITY_IDS) {
      for (const target of [null, "mob7"]) {
        const e: FxEvent = { kind: "cast", by: "sess-1", ability, ms: 349.6, target, x: 12.4, y: -7.6 };
        expect(packFx([e], T).l[0]).toEqual([14, "sess-1", abilityCode(ability), 350, target, 12, -8]);
        expect(roundTrip(e)).toEqual({ ...e, ms: 350, x: 12, y: -8, t: T });
      }
    }
  });

  it("castLand: x2 and y2 come together, only for a blink, and are left off when absent", () => {
    const plain: FxEvent = { kind: "castLand", by: "a", ability: "freeze", target: "b", x: 5.2, y: 6.7 };
    expect(packFx([plain], T).l[0]).toEqual([15, "a", 0, "b", 5, 7]);
    expect(roundTrip(plain)).toEqual({ ...plain, x: 5, y: 7, t: T });

    const blink: FxEvent = { kind: "castLand", by: "a", ability: "blaze", target: null, x: 100.4, y: 200.5, x2: 340.5, y2: 410.4 };
    expect(packFx([blink], T).l[0]).toEqual([15, "a", 3, null, 100, 201, 341, 410]);
    expect(roundTrip(blink)).toEqual({ ...blink, x: 100, y: 201, x2: 341, y2: 410, t: T });

    // One end alone is not a blink: nothing half-sent.
    const half = { kind: "castLand", by: "a", ability: "blaze", target: null, x: 1, y: 2, x2: 3 } as unknown as FxEvent;
    expect(packFx([half], T).l[0]).toHaveLength(6);
    expect(roundTrip(half)).toEqual({ kind: "castLand", by: "a", ability: "blaze", target: null, x: 1, y: 2, t: T });
  });

  it("castEnd: every reason round trips", () => {
    for (const reason of ["fizzle", "interrupted", "cancelled"] as const) {
      const e: FxEvent = { kind: "castEnd", by: "a", ability: "lastStand", reason };
      expect(roundTrip(e)).toEqual({ ...e, t: T });
    }
    expect(packFx([{ kind: "castEnd", by: "a", ability: "freeze", reason: "fizzle" }], T).l[0]![3]).toBe(0);
    expect(packFx([{ kind: "castEnd", by: "a", ability: "freeze", reason: "interrupted" }], T).l[0]![3]).toBe(1);
    expect(packFx([{ kind: "castEnd", by: "a", ability: "freeze", reason: "cancelled" }], T).l[0]![3]).toBe(2);
  });

  it("status: every kind round trips, with a source or none", () => {
    for (const status of STATUS_KINDS) {
      for (const by of [null, "sess-9"]) {
        const e: FxEvent = { kind: "status", id: "m3", status, ms: 1250, by };
        expect(roundTrip(e), `${status} ${by}`).toEqual({ ...e, t: T });
      }
    }
  });

  it("hit: the ability is a fifth field, only when set, and decodes with the weapon null", () => {
    for (const ability of ABILITY_IDS) {
      const e: FxEvent = { kind: "hit", id: "a", by: "b", amount: 7.5, weapon: null, ability };
      const tuple = packFx([e], T).l[0]!;
      expect(tuple).toEqual([2, "a", "b", 75, 0, abilityCode(ability)]);
      expect(roundTrip(e)).toEqual({ ...e, t: T });
    }
    const plain: FxEvent = { kind: "hit", id: "a", by: "b", amount: 7.5, weapon: "sword" };
    expect(packFx([plain], T).l[0]).toHaveLength(5);
    expect(roundTrip(plain)).toEqual({ ...plain, t: T });
    expect("ability" in roundTrip(plain)).toBe(false);
    // The arena (by null) and a signature can ride along.
    const odd: FxEvent = { kind: "hit", id: "a", by: null, amount: 1, weapon: null, sig: "burn", ability: "blaze" };
    expect(roundTrip(odd)).toEqual({ ...odd, t: T });
  });

  it("names the fighters by roster index and reads them back", () => {
    const roster = ["sess-001", "sess-002", "mob1a"];
    const index = new Map(roster.map((id, i) => [id, i]));
    const list: FxEvent[] = [
      { kind: "cast", by: "sess-001", ability: "trial", ms: 350, target: "sess-002", x: 10, y: 20 },
      { kind: "castLand", by: "sess-001", ability: "blaze", target: null, x: 1, y: 2, x2: 3, y2: 4 },
      { kind: "castEnd", by: "sess-002", ability: "freeze", reason: "cancelled" },
      { kind: "status", id: "mob1a", status: "stun", ms: 1250, by: "sess-001" },
      { kind: "hit", id: "mob1a", by: "sess-001", amount: 3, weapon: null, ability: "blaze" },
    ];
    const batch = packFx(list, T, { roster: index });
    expect(batch.l[0]).toEqual([14, 0, 2, 350, 1, 10, 20]);
    expect(batch.l[1]).toEqual([15, 0, 3, null, 1, 2, 3, 4]);
    expect(batch.l[2]).toEqual([16, 1, 0, 2]);
    expect(batch.l[3]).toEqual([17, 2, 0, 1250, 0]);
    expect(batch.l[4]).toEqual([2, 2, 0, 30, 0, 3]);
    expect(unpackFx(batch, roster)).toEqual(list.map((e) => ({ ...e, t: T })));
  });

  it("skips a tuple with a bad ability or status code, or a bad shape, and reports it", () => {
    const bad = [
      [14, "a", 99, 250, null, 1, 2],        // cast, unknown ability
      [14, "a", 0, 250, null, 1],            // cast, no y
      [14, "a", 0, 250, undefined, 1, 2],    // cast, no target field (neither an id nor null)
      [15, "a", 99, null, 1, 2],             // castLand, unknown ability
      [15, "a", 0, null, 1, 2, 3],           // castLand, an x2 with no y2
      [15, "a", 0, null, 1, 2, 3, "four"],   // castLand, y2 is not a number
      [16, "a", 99, 0],                      // castEnd, unknown ability
      [16, "a", 0, 3],                       // castEnd, unknown reason
      [16, "a", 0],                          // castEnd, no reason
      [17, "a", 99, 1000, null],             // status, unknown kind
      [17, "a", 0, "long", null],            // status, ms is a string
      [17, "a", 0, 1000],                    // status, no source field
      [2, "a", "b", 10, 0, 99],              // hit, unknown ability
      [2, "a", "b", 10, 0, null],            // hit, a fifth field that is not a code
    ] as unknown as FxBatch["l"];
    const good = packFx([{ kind: "castEnd", by: "a", ability: "swarm", reason: "fizzle" }], T).l[0]!;
    const dropped: Array<[unknown, boolean]> = [];
    const out = unpackFx({ t: T, l: [...bad, good] }, NONE, (tuple, unresolved) => dropped.push([tuple, unresolved]));
    expect(out).toEqual([{ kind: "castEnd", by: "a", ability: "swarm", reason: "fizzle", t: T }]);
    expect(dropped).toHaveLength(bad.length);
    expect(dropped.every(([, unresolved]) => unresolved === false)).toBe(true);
  });

  it("counts a roster index the client does not have as unresolved", () => {
    const roster = ["a", "b"];
    const flags: boolean[] = [];
    const batch: FxBatch = { t: T, l: [[14, 5, 0, 250, null, 1, 2], [15, 0, 0, 9, 1, 2], [16, 7, 0, 0], [17, 6, 0, 1000, null]] };
    expect(unpackFx(batch, roster, (_tuple, unresolved) => flags.push(unresolved))).toEqual([]);
    expect(flags).toEqual([true, true, true, true]);
  });

  it("is plain integers, strings and null on the wire", () => {
    const batch = packFx(
      [EXAMPLES.cast, EXAMPLES.castLand, EXAMPLES.castEnd, EXAMPLES.status, { kind: "hit", id: "a", by: "b", amount: 3, weapon: null, ability: "blaze" }],
      T,
    );
    for (const tuple of batch.l) {
      for (const v of tuple) {
        if (typeof v === "number") expect(Number.isSafeInteger(v), JSON.stringify(tuple)).toBe(true);
        else expect(v === null || typeof v === "string").toBe(true);
      }
    }
    expect(unpackFx(JSON.parse(JSON.stringify(batch)) as FxBatch, NONE)).toEqual(unpackFx(batch, NONE));
  });
});

describe("fx codec: camps and chests (roguelike R5)", () => {
  it("campCleared is [18, camp] and chestTaken [19, chest, by, option], appended after the Wishes' status (17)", () => {
    const roster = ["sess-001", "sess-002"];
    const index = new Map(roster.map((id, i) => [id, i]));
    const batch = packFx([
      { kind: "campCleared", camp: 0 },
      { kind: "chestTaken", chest: "c1z", by: "sess-002", option: 1 },
      { kind: "chestTaken", chest: "c1z", by: "sess-001", option: -1 },
    ], T, { roster: index });
    // The chest id stays a string; the picker travels as its roster index.
    expect(batch.l).toEqual([[18, 0], [19, "c1z", 1, 1], [19, "c1z", 0, -1]]);
    expect(unpackFx(batch, roster)).toEqual([
      { kind: "campCleared", camp: 0, t: T },
      { kind: "chestTaken", chest: "c1z", by: "sess-002", option: 1, t: T },
      { kind: "chestTaken", chest: "c1z", by: "sess-001", option: -1, t: T },
    ]);
  });

  it("campHeal is [20, id, camp, amount x 10]: the healed fighter travels as its roster index", () => {
    const roster = ["sess-001", "sess-002"];
    const index = new Map(roster.map((id, i) => [id, i]));
    const batch = packFx([{ kind: "campHeal", id: "sess-002", camp: 7, amount: 118.46 }], T, { roster: index });
    expect(batch.l).toEqual([[20, 1, 7, 1185]]);
    expect(unpackFx(batch, roster)).toEqual([{ kind: "campHeal", id: "sess-002", camp: 7, amount: 118.5, t: T }]);
    // Without the roster the id stays a string, as every other id-bearing fx.
    expect(packFx([{ kind: "campHeal", id: "sess-002", camp: 0, amount: 0.3 }], T).l).toEqual([[20, "sess-002", 0, 3]]);
  });

  it("drops a malformed campHeal tuple (no camp, a fraction, a negative camp, a roster index past the roster, no amount)", () => {
    const dropped: boolean[] = [];
    const bad: FxBatch = { t: T, l: [[20, "a", -1, 10], [20, "a", 1.5, 10], [20, "a", "3", 10], [20, "a", 3], [20, "a", 3, "x"], [20, 9, 3, 10], [20]] };
    expect(unpackFx(bad, ["a"], (_tuple, unresolved) => dropped.push(unresolved))).toEqual([]);
    expect(dropped).toEqual([false, false, false, false, false, true, false]);
  });

  it("drops a malformed camp or chest tuple instead of guessing", () => {
    const dropped: unknown[] = [];
    const bad: FxBatch = { t: T, l: [[18, -1], [18, 1.5], [18], [19, 3, "a", 0], [19, "c1", "a", -2], [19, "c1", "a", 0.5], [19, "c1", "a"]] };
    expect(unpackFx(bad, NONE, (tuple) => dropped.push(tuple))).toEqual([]);
    expect(dropped).toHaveLength(7);
  });

  it("gives every kind its own code, in merge order: R0 and the Wishes unchanged, the R5 kinds after them", () => {
    const codes = Object.fromEntries(
      (Object.keys(EXAMPLES) as FxEvent["kind"][]).map((kind) => [kind, packFx([EXAMPLES[kind]], T).l[0]![0]]),
    );
    expect(codes).toEqual({
      windup: 0, swing: 1, hit: 2, block: 3, stagger: 4, projEnd: 5, death: 6, heal: 7, teleport: 8, bounty: 9, buff: 10,
      victory: 12, cancel: 13, cast: 14, castLand: 15, castEnd: 16, status: 17, campCleared: 18, chestTaken: 19, campHeal: 20,
    });
    expect(new Set(Object.values(codes)).size).toBe(Object.keys(codes).length);
    // 11 (the retired combo) stays unused.
    expect(Object.values(codes)).not.toContain(11);
  });
});
