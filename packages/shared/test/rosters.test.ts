// Camp rosters (ROGUELIKE_PLAN D5): rollZoneTypes / rollCampTypes / campMobs are pure functions of the stream they are
// given. The server feeds them world.rewardRandom (server/test/camps.test.ts); here a seeded mulberry32 stands in.
import { describe, expect, it } from "vitest";
import {
  campMobs, eliteTypeOf, FACTION_IDS, generateMap, mobTypeById, mulberry32, normalTypesOf, rollCampTypes, rollZoneTypes,
  type FactionId, type MobTypeId, type Rng,
} from "../src/index";

/** A stream that counts how many numbers it gave. */
function counting(seed: number): { rng: Rng; draws: () => number } {
  const inner = mulberry32(seed);
  let n = 0;
  return { rng: () => { n++; return inner(); }, draws: () => n };
}

const normalIds = (zone: FactionId): MobTypeId[] => normalTypesOf(zone).map((t) => t.id);
const counts = (types: readonly MobTypeId[]): Map<MobTypeId, number> => {
  const m = new Map<MobTypeId, number>();
  for (const t of types) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
};

describe("rollZoneTypes", () => {
  it.each(FACTION_IDS)("%s: 1, 2 and 3 camps never repeat a type, and every type is one of the zone's normals", (zone) => {
    for (let seed = 0; seed < 60; seed++) {
      for (const n of [1, 2, 3]) {
        const types = rollZoneTypes(zone, n, mulberry32(seed));
        expect(types).toHaveLength(n);
        expect(new Set(types).size).toBe(n);
        for (const t of types) expect(normalIds(zone)).toContain(t);
      }
    }
  });

  it("a 4-camp zone has all three types and repeats exactly one of them", () => {
    for (const zone of FACTION_IDS) {
      for (let seed = 0; seed < 60; seed++) {
        const c = counts(rollZoneTypes(zone, 4, mulberry32(seed)));
        expect([...c.keys()].sort()).toEqual(normalIds(zone).sort());
        expect([...c.values()].sort()).toEqual([1, 1, 2]);
      }
    }
  });

  it("further camps keep covering all three types", () => {
    for (let seed = 0; seed < 30; seed++) {
      const types = rollZoneTypes("plague", 6, mulberry32(seed));
      expect(types).toHaveLength(6);
      expect(new Set(types)).toEqual(new Set(normalIds("plague")));
    }
  });

  it("draws two numbers for the shuffle and one per camp past the third; nothing for no camps", () => {
    const draws = (n: number): number => { const c = counting(7); rollZoneTypes("frost", n, c.rng); return c.draws(); };
    expect(draws(0)).toBe(0);
    expect([1, 2, 3].map(draws)).toEqual([2, 2, 2]);
    expect([4, 5, 6].map(draws)).toEqual([3, 4, 5]);
    expect(rollZoneTypes("frost", 0, mulberry32(1))).toEqual([]);
    expect(rollZoneTypes("frost", -2, mulberry32(1))).toEqual([]);
  });

  it("is a function of the stream: the same state gives the same roster, other salts give other ones", () => {
    const a = rollZoneTypes("holy", 3, mulberry32(11));
    expect(rollZoneTypes("holy", 3, mulberry32(11))).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) seen.add(rollZoneTypes("holy", 3, mulberry32(seed)).join());
    expect(seen.size).toBe(6); // every ordering of the three types is reachable
    const pairs = new Set<string>();
    for (let seed = 0; seed < 200; seed++) pairs.add(rollZoneTypes("holy", 2, mulberry32(seed)).join());
    expect(pairs.size).toBe(6); // a 2-camp zone: every ordered pair, so any one type can be absent
  });
});

describe("rollCampTypes", () => {
  it("rolls each zone in the order it first appears, whatever the camp order of the map", () => {
    const zones: FactionId[] = ["fire", "fire", "sentenced", "fire", "sentenced", "holy"];
    const rng = mulberry32(5);
    const got = rollCampTypes(zones, rng);
    const by = mulberry32(5);
    const fire = rollZoneTypes("fire", 3, by);
    const sentenced = rollZoneTypes("sentenced", 2, by);
    const holy = rollZoneTypes("holy", 1, by);
    expect(got).toEqual([fire[0], fire[1], sentenced[0], fire[2], sentenced[1], holy[0]]);
    expect(rng()).toBe(by()); // and it drew exactly what those three rolls drew
  });

  it("gives every camp a type of its own zone, and nothing for no camps", () => {
    const zones: FactionId[] = ["frost", "holy", "frost", "plague", "holy", "frost"];
    const types = rollCampTypes(zones, mulberry32(9));
    types.forEach((t, i) => expect(mobTypeById(t)?.zone).toBe(zones[i]));
    const c = counting(1);
    expect(rollCampTypes([], c.rng)).toEqual([]);
    expect(c.draws()).toBe(0);
  });
});

describe("campMobs", () => {
  const camp = (zone: FactionId, n: number, eliteSpot: number) => ({
    zone, eliteSpot, spots: Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })),
  });

  it("puts the zone's elite at the elite spot and the camp's type everywhere else, in spot order", () => {
    expect(campMobs(camp("fire", 4, 0), "magmaBrute")).toEqual([
      { type: "wyrmling", elite: true }, { type: "magmaBrute", elite: false }, { type: "magmaBrute", elite: false },
      { type: "magmaBrute", elite: false },
    ]);
    const mid = campMobs(camp("holy", 3, 2), "penitent");
    expect(mid.map((m) => m.elite)).toEqual([false, false, true]);
    expect(mid[2]!.type).toBe(eliteTypeOf("holy").id);
  });

  it("has no elite on a camp without an elite spot, or when the spot is past the last mob", () => {
    expect(campMobs(camp("plague", 3, -1), "rotMonk").every((m) => !m.elite && m.type === "rotMonk")).toBe(true);
    expect(campMobs(camp("plague", 3, 3), "rotMonk").every((m) => !m.elite)).toBe(true);
    expect(campMobs(camp("plague", 0, 0), "rotMonk")).toEqual([]);
  });
});

describe("D5 on generated wedge maps (seeds 0..199)", () => {
  it("every zone's camps follow the rules, with mono-type camps and one elite", () => {
    let twoCamp = 0;
    let threeCamp = 0;
    let fourCamp = 0;
    for (let seed = 0; seed < 200; seed++) {
      const map = generateMap(seed);
      const types = rollCampTypes(map.camps.map((c) => c.zone), mulberry32(seed * 7 + 1));
      expect(types).toHaveLength(map.camps.length);
      for (const zone of FACTION_IDS) {
        const idx = map.camps.flatMap((c, i) => (c.zone === zone ? [i] : []));
        const zoneTypes = idx.map((i) => types[i]!);
        for (const t of zoneTypes) expect(normalIds(zone), `seed ${seed} ${zone}`).toContain(t);
        if (idx.length <= 3) expect(new Set(zoneTypes).size, `seed ${seed} ${zone}`).toBe(idx.length);
        else expect([...counts(zoneTypes).values()].sort(), `seed ${seed} ${zone}`).toEqual([1, 1, 2]);
        if (idx.length === 2) twoCamp++;
        else if (idx.length === 3) threeCamp++;
        else if (idx.length === 4) fourCamp++;

        let elites = 0;
        for (const i of idx) {
          const camp = map.camps[i]!;
          const mobs = campMobs(camp, types[i]!);
          expect(mobs).toHaveLength(camp.spots.length);
          mobs.forEach((m, spot) => {
            if (m.elite) {
              elites++;
              expect(spot).toBe(camp.eliteSpot);
              expect(m.type).toBe(eliteTypeOf(zone).id);
            } else {
              expect(m.type, `seed ${seed} ${camp.id} spot ${spot}`).toBe(types[i]);
            }
          });
        }
        expect(elites, `seed ${seed} ${zone}`).toBe(1);
      }
    }
    expect(twoCamp + threeCamp).toBeGreaterThan(900); // the wedge maps: 2 or 3 camps per zone
    expect(fourCamp).toBe(0);
  }, 180_000); // 200 maps through the generator
});
