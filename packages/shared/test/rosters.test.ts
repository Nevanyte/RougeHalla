// Camp rosters (ROGUELIKE_PLAN D5, balance contract 6.4) and camp buffs (the owner's request of 2026-11: a theme per zone, a max
// distance to every buff, as even a spread as possible): rollCampRosters / rollCampElites / campMobs are pure functions of the stream
// they are given. The server feeds them world.rewardRandom (server/test/camps.test.ts); here a seeded mulberry32 stands in.
import { describe, expect, it } from "vitest";
import {
  CAMP_BUFF_MAX_DISTANCE_TILES, CAMPS_PER_ZONE, campBuffBounds, campBuffDistances, campMobs, campRewardId, elitesOf, FACTION_IDS, generateMap,
  MOB_STAT_KEYS, mobTypeById, mulberry32, normalTypesOf, rollCampElites, rollCampRosters, statKeyOf, TILE, zoneTheme,
  type CampSite, type FactionId, type GameMap, type MobTypeId, type Rng,
} from "../src/index";

/** A stream that counts how many numbers it gave. */
function counting(seed: number): { rng: Rng; draws: () => number } {
  const inner = mulberry32(seed);
  let n = 0;
  return { rng: () => { n++; return inner(); }, draws: () => n };
}

const normalIds = (zone: FactionId): MobTypeId[] => normalTypesOf(zone).map((t) => t.id);
const maps = new Map<number, GameMap>();
/** The first forty seeds' maps are kept: two describes read them. */
const mapOf = (seed: number): GameMap => {
  const hit = maps.get(seed);
  if (hit) return hit;
  const map = generateMap(seed, undefined, { decor: false });
  if (seed < 40) maps.set(seed, map);
  return map;
};

/** Ten camps a zone on a ring, as the generator lays a map out (zones as wedges round the centre), for the tests that need no map. */
function ringCamps(perZone = 10): CampSite[] {
  return FACTION_IDS.flatMap((zone, zi) => Array.from({ length: perZone }, (_, i) => {
    const turn = (zi + (i + 0.5) / perZone) / FACTION_IDS.length;
    const r = (30 + (i % 3) * 22) * TILE;
    return { zone, x: 80 * TILE + r * Math.cos(turn * 2 * Math.PI), y: 80 * TILE + r * Math.sin(turn * 2 * Math.PI) };
  }));
}

describe("rollCampRosters: what each camp is and what it pays", () => {
  it("gives every camp a normal type of its own zone, and a buff only off its zone's theme, paid by another zone's type", () => {
    const camps = ringCamps();
    for (let seed = 0; seed < 20; seed++) {
      const rolls = rollCampRosters(camps, mulberry32(seed));
      expect(rolls).toHaveLength(camps.length);
      rolls.forEach((r, c) => {
        const zone = camps[c]!.zone;
        expect(normalIds(zone), `seed ${seed} camp ${c}`).toContain(r.type);
        if (r.buff === "") return;
        const by = mobTypeById(r.buff)!;
        expect(by.elite).toBe(false);
        expect(by.zone, `seed ${seed} camp ${c}`).not.toBe(zone);
        expect(zoneTheme(zone), `seed ${seed} camp ${c}: an on-theme buff is the camp's own type`).not.toContain(statKeyOf(r.buff));
      });
    }
  });

  it("names the spill-over buff by the zone nearest the camp that has the stat on theme", () => {
    const camps = ringCamps();
    let spills = 0;
    for (let seed = 0; seed < 20; seed++) {
      rollCampRosters(camps, mulberry32(seed)).forEach((r, c) => {
        if (r.buff === "") return;
        spills++;
        const key = statKeyOf(r.buff)!;
        let best = Infinity, zone: FactionId | null = null;
        camps.forEach((o) => {
          const d = Math.round(Math.hypot(o.x - camps[c]!.x, o.y - camps[c]!.y));
          if (zoneTheme(o.zone).includes(key) && d < best) { best = d; zone = o.zone; }
        });
        expect(mobTypeById(r.buff)!.zone, `seed ${seed} camp ${c}`).toBe(zone);
      });
    }
    expect(spills).toBeGreaterThan(0);
  });

  it("gives an off-theme camp the zone's type used least so far (camp order; a tie in catalog order from the camp's index)", () => {
    const camps = ringCamps();
    for (let seed = 0; seed < 20; seed++) {
      const rolls = rollCampRosters(camps, mulberry32(seed));
      const used = new Map<MobTypeId, number>();
      rolls.forEach((r) => { if (r.buff === "") used.set(r.type, (used.get(r.type) ?? 0) + 1); });
      rolls.forEach((r, c) => {
        if (r.buff === "") return;
        const ids = normalIds(camps[c]!.zone);
        const rotated = ids.map((_id, k) => ids[(c + k) % ids.length]!);
        const counts = rotated.map((id) => used.get(id) ?? 0);
        expect(rotated[counts.indexOf(Math.min(...counts))], `seed ${seed} camp ${c}`).toBe(r.type);
        used.set(r.type, (used.get(r.type) ?? 0) + 1);
      });
    }
  });

  it("draws 2n - 1 numbers for n camps, whatever the zones; nothing for no camps", () => {
    const draws = (camps: CampSite[]): number => { const c = counting(7); rollCampRosters(camps, c.rng); return c.draws(); };
    expect(draws([])).toBe(0);
    expect(rollCampRosters([], mulberry32(1))).toEqual([]);
    const ring = ringCamps();
    expect(draws(ring)).toBe(2 * ring.length - 1);
    expect(draws(ring.slice(0, 7))).toBe(13);
    expect(draws(ring.map((c) => ({ ...c, zone: "frost" as FactionId })))).toBe(2 * ring.length - 1);
  });

  it("is a function of the stream: the same state gives the same roll, other states other rolls", () => {
    const camps = ringCamps();
    const a = rollCampRosters(camps, mulberry32(11));
    expect(rollCampRosters(camps, mulberry32(11))).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) seen.add(rollCampRosters(camps, mulberry32(seed)).map(campRewardId).join());
    expect(seen.size).toBe(40);
  });

  it("keeps every buff on an even share of a small map: fewer camps than buffs means nine distinct buffs at most once each", () => {
    const camps = ringCamps(1); // five camps, one a zone
    for (let seed = 0; seed < 30; seed++) {
      const keys = rollCampRosters(camps, mulberry32(seed)).map((r) => statKeyOf(campRewardId(r)));
      expect(new Set(keys).size, `seed ${seed}`).toBe(keys.length);
    }
    const two = ringCamps(2); // ten camps: one buff twice, the other eight once
    for (let seed = 0; seed < 30; seed++) {
      const keys = rollCampRosters(two, mulberry32(seed)).map((r) => statKeyOf(campRewardId(r))!);
      const counts = MOB_STAT_KEYS.map((k) => keys.filter((x) => x === k).length);
      expect([...counts].sort(), `seed ${seed}`).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2]);
    }
  });

  it("reads campRewardId as the buff, else the type", () => {
    expect(campRewardId({ type: "flameCaller", buff: "pardoner" })).toBe("pardoner");
    expect(campRewardId({ type: "flameCaller", buff: "" })).toBe("flameCaller");
    expect(campRewardId({ type: "flameCaller" })).toBe("flameCaller");
    expect(campRewardId(undefined)).toBe("");
  });
});

describe("camp buffs on generated maps (seeds 0..39, four rolls each)", () => {
  it("puts every buff on 5 or 6 camps, every buff within the bound of every camp, and about 70% of camps on their zone's theme", () => {
    expect(CAMP_BUFF_MAX_DISTANCE_TILES).toBe(65);
    let themed = 0, total = 0, worstTheme = 1;
    for (let seed = 0; seed < 40; seed++) {
      const map = mapOf(seed);
      expect(map.camps).toHaveLength(CAMPS_PER_ZONE * FACTION_IDS.length);
      const bounds = campBuffBounds(map.camps);
      for (const b of bounds) expect(b).toBeGreaterThanOrEqual(CAMP_BUFF_MAX_DISTANCE_TILES * TILE);
      for (let r = 0; r < 4; r++) {
        const rolls = rollCampRosters(map.camps, mulberry32(seed * 1009 + r));
        const rewards = rolls.map(campRewardId);
        const keys = rewards.map((id) => statKeyOf(id)!);
        for (const k of MOB_STAT_KEYS) {
          const n = keys.filter((x) => x === k).length;
          expect(n, `seed ${seed} roll ${r} ${k}`).toBeGreaterThanOrEqual(5);
          expect(n, `seed ${seed} roll ${r} ${k}`).toBeLessThanOrEqual(6);
        }
        campBuffDistances(map.camps, rewards).forEach((row, c) => row.forEach((d, b) => {
          expect(d, `seed ${seed} roll ${r} ${map.camps[c]!.id} ${MOB_STAT_KEYS[b]}`).toBeLessThanOrEqual(bounds[c]!);
        }));
        const onTheme = keys.filter((k, c) => zoneTheme(map.camps[c]!.zone).includes(k)).length;
        themed += onTheme;
        total += keys.length;
        worstTheme = Math.min(worstTheme, onTheme / keys.length);
      }
    }
    // Measured at 0.713 a roll on average, 0.62 at worst (docs/MOB_PROGRESSION.md).
    expect(themed / total).toBeGreaterThan(0.68);
    expect(worstTheme).toBeGreaterThanOrEqual(0.56);
  }, 120_000);

  it("holds a corner camp only to its ninth nearest camp: the bound is the larger of the constant and that distance", () => {
    for (let seed = 0; seed < 10; seed++) {
      const map = mapOf(seed);
      const bounds = campBuffBounds(map.camps);
      map.camps.forEach((a, c) => {
        const ninth = map.camps.map((b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y))).sort((x, y) => x - y)[8]!;
        expect(bounds[c]).toBe(Math.max(Math.round(CAMP_BUFF_MAX_DISTANCE_TILES * TILE), ninth));
      });
    }
  }, 60_000);
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
  it("every zone's camps follow the rules, with mono-type camps of the zone's own types and the elites of the elite camps (two per zone)", () => {
    let fullZones = 0;
    for (let seed = 0; seed < 200; seed++) {
      const map = mapOf(seed);
      const rolls = rollCampRosters(map.camps, mulberry32(seed * 7 + 1));
      const elites = rollCampElites(map.camps);
      expect(rolls).toHaveLength(map.camps.length);
      expect(elites).toHaveLength(map.camps.length);
      for (const zone of FACTION_IDS) {
        const idx = map.camps.flatMap((c, i) => (c.zone === zone ? [i] : []));
        for (const i of idx) {
          expect(normalIds(zone), `seed ${seed} ${zone}`).toContain(rolls[i]!.type);
          // A buff on the zone's theme is its own type's; one off it is another zone's type.
          if (rolls[i]!.buff !== "") expect(mobTypeById(rolls[i]!.buff)!.zone, `seed ${seed} ${map.camps[i]!.id}`).not.toBe(zone);
        }
        if (idx.length === CAMPS_PER_ZONE) fullZones++;

        let elitesSeen = 0;
        idx.forEach((i) => {
          const camp = map.camps[i]!;
          const mobs = campMobs(camp, rolls[i]!.type, elites[i] === "" ? undefined : elites[i] as MobTypeId);
          expect(mobs).toHaveLength(camp.spots.length);
          mobs.forEach((m, spot) => {
            if (m.elite) {
              expect(spot).toBe(camp.eliteSpot);
              expect(m.type).toBe(elitesOf(zone)[elitesSeen % 2]!.id);
              elitesSeen++;
            } else {
              expect(m.type, `seed ${seed} ${camp.id} spot ${spot}`).toBe(rolls[i]!.type);
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
  }, 240_000); // 200 maps through the generator
});
