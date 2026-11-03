// Camp rosters (ROGUELIKE_PLAN D5, balance contract 6.4): rollZoneTypes / rollCampTypes / rollCampElites / campMobs are pure
// functions of the stream they are given. The server feeds them world.rewardRandom (server/test/camps.test.ts); here a seeded
// mulberry32 stands in.
import { describe, expect, it } from "vitest";
import {
  BAG_COPIES, CAMPS_PER_ZONE, campMobs, elitesOf, FACTION_IDS, generateMap, mobTypeById, mulberry32, normalTypesOf, rollCampElites, rollCampTypes,
  rollZoneTypes, type FactionId, type MobTypeId, type Rng,
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

describe("rollZoneTypes: the bag of the zone's four normal types, three rounds", () => {
  it("is three copies of four types", () => {
    expect(BAG_COPIES).toBe(3);
    for (const zone of FACTION_IDS) expect(normalTypesOf(zone)).toHaveLength(4);
  });

  it.each(FACTION_IDS)("%s: ten camps show every normal type in two or three of them (two types thrice, two twice)", (zone) => {
    for (let seed = 0; seed < 300; seed++) {
      const types = rollZoneTypes(zone, 10, mulberry32(seed));
      expect(types).toHaveLength(10);
      const c = counts(types);
      expect([...c.keys()].sort(), `seed ${seed}`).toEqual(normalIds(zone).sort());
      expect([...c.values()].sort(), `seed ${seed}`).toEqual([2, 2, 3, 3]);
    }
  });

  it.each(FACTION_IDS)("%s: every group of four camps in a row shows each type once, so twelve camps show each exactly three times", (zone) => {
    for (let seed = 0; seed < 300; seed++) {
      const twelve = rollZoneTypes(zone, 12, mulberry32(seed));
      for (let round = 0; round < 3; round++) {
        expect(twelve.slice(round * 4, round * 4 + 4).sort(), `seed ${seed} round ${round}`).toEqual(normalIds(zone).sort());
      }
      expect([...counts(twelve).values()], `seed ${seed}`).toEqual([3, 3, 3, 3]);
    }
  });

  it.each(FACTION_IDS)("%s: eight camps show every type in exactly two of them", (zone) => {
    for (let seed = 0; seed < 100; seed++) {
      const types = rollZoneTypes(zone, 8, mulberry32(seed));
      expect([...counts(types).values()], `seed ${seed}`).toEqual([2, 2, 2, 2]);
    }
  });

  it.each(FACTION_IDS)("%s: fewer camps take the first entries of the same bag, so no camp count shows a type more than ceil(n / 4) times", (zone) => {
    for (let seed = 0; seed < 100; seed++) {
      const twelve = rollZoneTypes(zone, 12, mulberry32(seed));
      for (let n = 1; n <= 12; n++) {
        const types = rollZoneTypes(zone, n, mulberry32(seed));
        expect(types, `seed ${seed} n ${n}`).toEqual(twelve.slice(0, n));
        for (const t of types) expect(normalIds(zone)).toContain(t);
        const c = counts(types);
        for (const v of c.values()) expect(v).toBeLessThanOrEqual(Math.ceil(n / 4));
        // the spread across the four types is never more than one camp
        const per = normalIds(zone).map((id) => c.get(id) ?? 0);
        expect(Math.max(...per) - Math.min(...per), `seed ${seed} n ${n}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("wraps the bag past twelve camps: thirteen camps repeat the first entry, twenty-four show every type six times", () => {
    for (let seed = 0; seed < 50; seed++) {
      const thirteen = rollZoneTypes("plague", 13, mulberry32(seed));
      expect(thirteen.slice(0, 12)).toEqual(rollZoneTypes("plague", 12, mulberry32(seed)));
      expect(thirteen[12]).toBe(thirteen[0]);
      const twentyFour = rollZoneTypes("plague", 24, mulberry32(seed));
      expect([...counts(twentyFour).values()]).toEqual([6, 6, 6, 6]);
    }
  });

  it("a 4-camp zone shows every type once, a 3-camp zone misses one: never a type twice before all four are out", () => {
    for (let seed = 0; seed < 300; seed++) {
      const four = counts(rollZoneTypes("frost", 4, mulberry32(seed)));
      expect([...four.values()]).toEqual([1, 1, 1, 1]);
      const three = counts(rollZoneTypes("frost", 3, mulberry32(seed)));
      expect(three.size).toBe(3);
    }
  });

  it("always draws nine numbers for a zone with a camp, however many camps it has; nothing for no camps", () => {
    const draws = (n: number): number => { const c = counting(7); rollZoneTypes("frost", n, c.rng); return c.draws(); };
    expect(draws(0)).toBe(0);
    expect([1, 2, 3, 4, 8, 10, 12, 20].map(draws)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(rollZoneTypes("frost", 0, mulberry32(1))).toEqual([]);
    expect(rollZoneTypes("frost", -2, mulberry32(1))).toEqual([]);
  });

  it("is a function of the stream: the same state gives the same roster, other salts give other ones", () => {
    const a = rollZoneTypes("holy", 10, mulberry32(11));
    expect(rollZoneTypes("holy", 10, mulberry32(11))).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 0; seed < 600; seed++) seen.add(rollZoneTypes("holy", 10, mulberry32(seed)).join());
    // 4! x 4! x 12 = 6912 orderings of the first ten entries are possible; 600 seeds reach about 570 of them.
    expect(seen.size).toBeGreaterThan(400);
    // The first camp can be any of the four types.
    const first = new Set<string>();
    for (let seed = 0; seed < 100; seed++) first.add(rollZoneTypes("holy", 1, mulberry32(seed))[0]!);
    expect(first.size).toBe(4);
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

  it("draws nine numbers per zone present and takes the zone's camps in camp order", () => {
    const zones: FactionId[] = ["frost", "holy", "frost", "plague", "holy", "frost"];
    const c = counting(9);
    const types = rollCampTypes(zones, c.rng);
    expect(c.draws()).toBe(3 * 9);
    types.forEach((t, i) => expect(mobTypeById(t)?.zone).toBe(zones[i]));
    const none = counting(1);
    expect(rollCampTypes([], none.rng)).toEqual([]);
    expect(none.draws()).toBe(0);
  });

  it("gives a map of ten camps per zone (the ids fire-1 to holy-10) each type two or three times per zone", () => {
    const zones = FACTION_IDS.flatMap((z) => Array.from({ length: 10 }, () => z));
    for (let seed = 0; seed < 40; seed++) {
      const types = rollCampTypes(zones, mulberry32(seed));
      FACTION_IDS.forEach((zone, zi) => {
        const mine = types.slice(zi * 10, zi * 10 + 10);
        expect([...counts(mine).values()].sort(), `seed ${seed} ${zone}`).toEqual([2, 2, 3, 3]);
      });
    }
  });
});

describe("rollCampElites: the k-th elite camp of a zone holds the k-th elite", () => {
  const camp = (zone: FactionId, eliteSpot: number) => ({ zone, eliteSpot });

  it("gives no elite to a camp without an elite spot, and the first elite to a zone's only elite camp", () => {
    const camps = [camp("fire", -1), camp("fire", 0), camp("fire", -1), camp("fire", -1)];
    expect(rollCampElites(camps)).toEqual(["", elitesOf("fire")[0]!.id, "", ""]);
  });

  it("gives two elite camps one elite each, in camp order: ten camps per zone with two elite camps", () => {
    const camps = FACTION_IDS.flatMap((z) => Array.from({ length: 10 }, (_, i) => camp(z, i === 2 || i === 6 ? 0 : -1)));
    const got = rollCampElites(camps);
    FACTION_IDS.forEach((zone, zi) => {
      const mine = got.slice(zi * 10, zi * 10 + 10);
      expect(mine.filter((e) => e !== ""), zone).toEqual(elitesOf(zone).map((t) => t.id));
      expect(mine[2], zone).toBe(elitesOf(zone)[0]!.id);
      expect(mine[6], zone).toBe(elitesOf(zone)[1]!.id);
    });
  });

  it("counts elite camps per zone, whatever the order of the map, and wraps past the second", () => {
    const camps = [camp("holy", 0), camp("fire", 1), camp("holy", 0), camp("fire", 0), camp("holy", 2), camp("fire", -1)];
    expect(rollCampElites(camps)).toEqual([
      elitesOf("holy")[0]!.id, elitesOf("fire")[0]!.id, elitesOf("holy")[1]!.id, elitesOf("fire")[1]!.id, elitesOf("holy")[0]!.id, "",
    ]);
    expect(rollCampElites([])).toEqual([]);
  });
});

describe("campMobs", () => {
  const camp = (zone: FactionId, n: number, eliteSpot: number) => ({
    zone, eliteSpot, spots: Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })),
  });

  it("puts the camp's elite at the elite spot and the camp's type everywhere else, in spot order", () => {
    expect(campMobs(camp("fire", 4, 0), "magmaBrute", "ashDrake")).toEqual([
      { type: "ashDrake", elite: true }, { type: "magmaBrute", elite: false }, { type: "magmaBrute", elite: false },
      { type: "magmaBrute", elite: false },
    ]);
    const mid = campMobs(camp("holy", 3, 2), "penitent", "archon");
    expect(mid.map((m) => m.elite)).toEqual([false, false, true]);
    expect(mid[2]!.type).toBe("archon");
  });

  it("takes the zone's first elite when no elite type is given", () => {
    expect(campMobs(camp("fire", 4, 0), "magmaBrute")[0]).toEqual({ type: "wyrmling", elite: true });
    expect(campMobs(camp("holy", 3, 2), "penitent")[2]!.type).toBe(elitesOf("holy")[0]!.id);
  });

  it("has no elite on a camp without an elite spot, or when the spot is past the last mob", () => {
    expect(campMobs(camp("plague", 3, -1), "rotMonk").every((m) => !m.elite && m.type === "rotMonk")).toBe(true);
    expect(campMobs(camp("plague", 3, 3), "rotMonk", "poxBehemoth").every((m) => !m.elite)).toBe(true);
    expect(campMobs(camp("plague", 0, 0), "rotMonk")).toEqual([]);
  });
});

describe("D5 on generated zone maps (seeds 0..199)", () => {
  it("every zone's camps follow the rules, with mono-type camps and the elites of the elite camps (two per zone)", () => {
    let fullZones = 0;
    for (let seed = 0; seed < 200; seed++) {
      const map = generateMap(seed);
      const types = rollCampTypes(map.camps.map((c) => c.zone), mulberry32(seed * 7 + 1));
      const elites = rollCampElites(map.camps);
      expect(types).toHaveLength(map.camps.length);
      expect(elites).toHaveLength(map.camps.length);
      for (const zone of FACTION_IDS) {
        const idx = map.camps.flatMap((c, i) => (c.zone === zone ? [i] : []));
        const zoneTypes = idx.map((i) => types[i]!);
        for (const t of zoneTypes) expect(normalIds(zone), `seed ${seed} ${zone}`).toContain(t);
        // The first idx.length entries of a bag of three rounds: every type two or three times when the zone has its ten camps.
        for (const v of counts(zoneTypes).values()) expect(v, `seed ${seed} ${zone}`).toBeLessThanOrEqual(BAG_COPIES);
        if (idx.length === CAMPS_PER_ZONE) {
          fullZones++;
          expect([...counts(zoneTypes).values()].sort(), `seed ${seed} ${zone}`).toEqual([2, 2, 3, 3]);
        }

        let elitesSeen = 0;
        idx.forEach((i) => {
          const camp = map.camps[i]!;
          const mobs = campMobs(camp, types[i]!, elites[i] === "" ? undefined : elites[i] as MobTypeId);
          expect(mobs).toHaveLength(camp.spots.length);
          mobs.forEach((m, spot) => {
            if (m.elite) {
              expect(spot).toBe(camp.eliteSpot);
              expect(m.type).toBe(elitesOf(zone)[elitesSeen % 2]!.id);
              elitesSeen++;
            } else {
              expect(m.type, `seed ${seed} ${camp.id} spot ${spot}`).toBe(types[i]);
            }
          });
          expect(elites[i] === "", `seed ${seed} ${camp.id}`).toBe(camp.eliteSpot < 0);
        });
        // The map's elite camps: two per zone (zone shapes), one elite each.
        expect(elitesSeen, `seed ${seed} ${zone}`).toBe(idx.filter((i) => map.camps[i]!.eliteSpot >= 0).length);
      }
    }
    // The zone maps: CAMPS_PER_ZONE camps in every zone, two of them elite.
    expect(fullZones).toBe(200 * FACTION_IDS.length);
  }, 180_000); // 200 maps through the generator
});
