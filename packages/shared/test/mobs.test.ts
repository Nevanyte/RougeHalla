import { describe, expect, it } from "vitest";
import {
  BUFF_REF_STACKS, buffScale, duel, ELITE_BUFF_STACKS, ELITE_K, eliteTypeOf, FACTION_IDS, FACTIONS, isRegionalKind, isWeaponId, MOB_BUFF_STACKS, MOB_K, MOB_TYPES,
  mobBuffStacks, mobTypeById, mobTypesOf, normalTypesOf, rewardCurve,
  mobFaction, mobName, mobWeapon, pacedFaction, REGION_WEAPONS, scaledFaction, SIGNATURE_WEAPONS, WEAPON_IDS, WEAPONS,
  type FactionId, type FactionSpec, type MobKind, type MobTypeDef, type MobTypeId, type WeaponId,
} from "../src/index";
import * as shared from "../src/index";

const REGIONS = FACTION_IDS;

/** Every param the faction scaling treats as a point-damage number (factions.ts keeps the same list private). */
const DAMAGE_PARAMS = ["burn", "backlash", "plague", "execute", "mark_ramp", "mark_cap"];

describe("the tunables the mob catalog reads", () => {
  it("are the contract's numbers", () => {
    expect([MOB_K, ELITE_K]).toEqual([0.22, 0.65]);
    expect([MOB_BUFF_STACKS, ELITE_BUFF_STACKS]).toEqual([1.1, 3.1]);
  });

  it("are reachable from the shared index, with the catalog", () => {
    expect(shared.mobFaction).toBe(mobFaction);
    expect(shared.mobWeapon).toBe(mobWeapon);
    expect(shared.isRegionalKind).toBe(isRegionalKind);
  });
});

describe("isRegionalKind", () => {
  it("is true for mobs and elites, false for the training dummy and anything else", () => {
    expect(isRegionalKind("mob")).toBe(true);
    expect(isRegionalKind("elite")).toBe(true);
    expect(isRegionalKind("dummy")).toBe(false);
    for (const kind of ["", "Mob", "ELITE", "boss", " mob", "mobs"]) expect(isRegionalKind(kind), `"${kind}"`).toBe(false);
  });

  it("picks the regional kinds out of every MobKind", () => {
    const kinds: MobKind[] = ["dummy", "mob", "elite"];
    expect(kinds.filter(isRegionalKind)).toEqual(["mob", "elite"]);
  });
});

describe("mobFaction", () => {
  const damageKeys = (spec: FactionSpec) => Object.keys(spec.params).filter((k) => DAMAGE_PARAMS.includes(k));

  it("is the region's faction scaled by MOB_K, an elite's by ELITE_K", () => {
    for (const region of REGIONS) {
      expect(mobFaction(region, false)).toEqual(scaledFaction(FACTIONS[region], MOB_K));
      expect(mobFaction(region, true)).toEqual(scaledFaction(FACTIONS[region], ELITE_K));
    }
  });

  it("scales hp, hit and the damage params, and nothing else", () => {
    for (const region of REGIONS) {
      const base = FACTIONS[region];
      for (const [elite, k] of [[false, MOB_K], [true, ELITE_K]] as const) {
        const mob = mobFaction(region, elite);
        const label = `${region}${elite ? " elite" : ""}`;
        expect(mob.hp, label).toBeCloseTo(base.hp * k, 9);
        expect(mob.hit, label).toBeCloseTo(base.hit * k, 9);
        for (const key of Object.keys(base.params)) {
          const want = DAMAGE_PARAMS.includes(key) ? base.params[key]! * k : base.params[key]!;
          expect(mob.params[key], `${label} ${key}`).toBeCloseTo(want, 9);
        }
        expect(Object.keys(mob.params).sort(), label).toEqual(Object.keys(base.params).sort());
        // The defences, the rhythm, the damage split and the signature stay: that is what keeps the counter graph.
        expect(mob.armor, label).toBe(base.armor);
        expect(mob.shield, label).toBe(base.shield);
        expect(mob.rate, label).toBe(base.rate);
        expect(mob.phys, label).toBe(base.phys);
        expect(mob.trueShare, label).toBe(base.trueShare);
        expect(mob.mechanic, label).toBe(base.mechanic);
        expect(mob.id, label).toBe(base.id);
        expect(mob.aura, label).toBe(base.aura);
        expect(mob.sustain, label).toBe(base.sustain);
      }
    }
  });

  it("leaves the non-damage params alone (Frost's slow, Holy's lifesteal)", () => {
    expect(mobFaction("frost", false).params).toEqual({ slow: 0.6 });
    expect(mobFaction("frost", true).params).toEqual({ slow: 0.6 });
    expect(mobFaction("holy", true).params).toEqual(FACTIONS.holy.params);
  });

  it("has concrete numbers: a Fire mob is 110 hp and a 33 hit, a Plague elite 650 hp", () => {
    expect(mobFaction("fire", false).hp).toBeCloseTo(110, 9);
    expect(mobFaction("fire", false).hit).toBeCloseTo(33, 9);
    expect(mobFaction("fire", false).params.burn).toBeCloseTo(2.2, 9);
    expect(mobFaction("plague", true).hp).toBeCloseTo(650, 9);
    expect(mobFaction("sentenced", false).params.mark_cap).toBeCloseTo(275 * MOB_K, 9);
  });

  it("makes every mob weaker than the player's faction and every elite strictly stronger than the normal mob", () => {
    expect(MOB_K).toBeGreaterThan(0);
    expect(MOB_K).toBeLessThan(ELITE_K);
    expect(ELITE_K).toBeLessThan(1);
    for (const region of REGIONS) {
      const base = FACTIONS[region];
      const mob = mobFaction(region, false);
      const elite = mobFaction(region, true);
      expect(mob.hp, region).toBeLessThan(base.hp);
      expect(mob.hit, region).toBeLessThan(base.hit);
      expect(elite.hp, region).toBeGreaterThan(mob.hp);
      expect(elite.hit, region).toBeGreaterThan(mob.hit);
      expect(elite.hp, region).toBeLessThan(base.hp);
      expect(damageKeys(elite), region).toEqual(damageKeys(mob));
      for (const key of damageKeys(mob)) expect(elite.params[key]!, `${region} ${key}`).toBeGreaterThan(mob.params[key]!);
    }
  });

  it("does not touch the shared faction table or share its params object", () => {
    const before = JSON.stringify(FACTIONS);
    for (const region of REGIONS) {
      const mob = mobFaction(region, true);
      expect(mob.params).not.toBe(FACTIONS[region].params);
      (mob.params as Record<string, number>).burn = 12345;
    }
    expect(JSON.stringify(FACTIONS)).toBe(before);
    expect(FACTIONS.fire.hp).toBe(500);
  });

  it("composes with the arena pace like any faction: hit and damage params doubled, hp unchanged", () => {
    for (const region of REGIONS) {
      const mob = mobFaction(region, false);
      const paced = pacedFaction(mob);
      expect(paced.hp, region).toBe(mob.hp);
      expect(paced.hit, region).toBeCloseTo(2 * mob.hit, 9);
    }
  });
});

describe("mobWeapon", () => {
  it("is the region's weapon, for all five regions", () => {
    for (const region of REGIONS) expect(mobWeapon(region), region).toBe(REGION_WEAPONS[region]);
  });

  it("is the contract's map, and every weapon is carried by the mobs of exactly one region", () => {
    expect(Object.fromEntries(REGIONS.map((r) => [r, mobWeapon(r)]))).toEqual({
      fire: "axe", sentenced: "sword", plague: "bow", frost: "shield", holy: "wand",
    });
    expect(REGIONS.map(mobWeapon).sort()).toEqual([...WEAPON_IDS].sort());
    for (const region of REGIONS) expect(isWeaponId(mobWeapon(region))).toBe(true);
  });
});

describe("mobName", () => {
  it("is distinct for every (region, elite) pair", () => {
    const names = REGIONS.flatMap((r) => [mobName(r, false), mobName(r, true)]);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    for (const n of names) {
      expect(n.length).toBeGreaterThan(0);
      expect(n).toBe(n.trim());
    }
  });

  it("gives an elite a different name from the normal mob of its region", () => {
    for (const region of REGIONS) expect(mobName(region, true), region).not.toBe(mobName(region, false));
  });

  it("is stable between calls", () => {
    for (const region of REGIONS) {
      expect(mobName(region, false)).toBe(mobName(region, false));
      expect(mobName(region, true)).toBe(mobName(region, true));
    }
  });
});

describe("mobBuffStacks", () => {
  it("three hungry kills of one camp reach the quoted value (the reward curve never exceeds 0.976)", () => {
    const feeds = [0, 0.25, 0.5];
    const stacks = feeds.reduce((sum, f) => sum + mobBuffStacks(false) * rewardCurve(f), 0);
    expect(stacks).toBeGreaterThanOrEqual(BUFF_REF_STACKS);
    expect(buffScale(stacks)).toBeGreaterThanOrEqual(1);
  });

  it("gives an elite's buff its quoted value in one hungry kill (3.1 x 0.976 is a little over 3 stacks)", () => {
    const stacks = mobBuffStacks(true) * rewardCurve(0);
    expect(stacks).toBeGreaterThanOrEqual(BUFF_REF_STACKS);
    expect(buffScale(stacks)).toBeCloseTo(1, 1);
  });

  it("is MOB_BUFF_STACKS for a mob and ELITE_BUFF_STACKS for an elite: 1.1 and 3.1", () => {
    expect(mobBuffStacks(false)).toBe(MOB_BUFF_STACKS);
    expect(mobBuffStacks(true)).toBe(ELITE_BUFF_STACKS);
    expect(mobBuffStacks(false)).toBe(1.1);
    expect(mobBuffStacks(true)).toBe(3.1);
  });

  it("pays an elite more than a mob", () => {
    expect(mobBuffStacks(true)).toBeGreaterThan(mobBuffStacks(false));
  });
});

// THE k GUESS (contract, "Guesses to report" 1). MOB_K = 0.22 (0.45 before the owner's "weaker mobs" ruling, which R5's camp-wide aggro called for: bench/campDuel.ts) and ELITE_K = 0.65 are the owner-pending values. The fixed
// target they were picked for: a starting player (its faction with its signature weapon) beats the normal mob of every
// region (each with that region's weapon) and keeps most of its hp, while an elite is a real fight that the faction which
// counters the player can win. This runs the reference duel on all 25 starting matchups and fails if a retune breaks that.
describe("the k guess: a starting player against a regional mob, 25 matchups", () => {
  /**
   * The duel engine treats rate x hit as a faction's damage per second, which a weapon scales by dpsMult (a faster weapon
   * hits proportionally lighter, GAME_DESIGN 10.2). The signature bonuses scale with it too, or a weapon's discount would
   * hit some factions harder than others. The mark ramp and cap are damage per second, so both are scaled.
   */
  function armed(f: FactionSpec, weapon: WeaponId): FactionSpec {
    const mult = WEAPONS[weapon].dpsMult;
    const params: Record<string, number> = { ...f.params };
    for (const key of DAMAGE_PARAMS) if (key in params) params[key] = params[key]! * mult;
    return { ...f, hit: f.hit * mult, params };
  }

  interface Outcome { player: FactionId; region: FactionId; winner: 0 | 1 | null; left: number; seconds: number }

  /** The player's share of its hp left when the duel ends; 0 when it did not win. */
  function fight(player: FactionId, region: FactionId, elite: boolean): Outcome {
    const a = armed(pacedFaction(FACTIONS[player]), SIGNATURE_WEAPONS[player]);
    const b = armed(pacedFaction(mobFaction(region, elite)), mobWeapon(region));
    const r = duel(a, b, 0.005, 300);
    return { player, region, winner: r.winner, left: r.winner === 0 ? r.hpA / a.hp : 0, seconds: r.t };
  }

  const pairs = FACTION_IDS.flatMap((player) => REGIONS.map((region) => [player, region] as const));
  const normal = pairs.map(([p, r]) => fight(p, r, false));
  const elite = pairs.map(([p, r]) => fight(p, r, true));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it("covers all 25 pairs", () => {
    expect(pairs).toHaveLength(25);
    expect(new Set(pairs.map(([p, r]) => `${p}/${r}`)).size).toBe(25);
  });

  it.each(normal.map((o) => [o.player, SIGNATURE_WEAPONS[o.player], o.region, mobWeapon(o.region), o] as const))(
    "%s (%s) beats the %s mob (%s) with at least 20% hp left",
    (_player, _pw, _region, _mw, o) => {
      expect(o.winner).toBe(0);
      expect(o.left).toBeGreaterThanOrEqual(0.2);
      expect(o.seconds).toBeLessThan(300);
    },
  );

  it("wins all 25 normal-mob duels with at least 30% hp left on average and 20% in the worst", () => {
    expect(normal.filter((o) => o.winner === 0)).toHaveLength(25);
    expect(mean(normal.map((o) => o.left))).toBeGreaterThanOrEqual(0.3);
    expect(Math.min(...normal.map((o) => o.left))).toBeGreaterThanOrEqual(0.2);
  });

  it("never stalls: every duel, normal or elite, has a winner inside the time limit", () => {
    for (const o of [...normal, ...elite]) expect(o.winner, `${o.player} vs ${o.region}`).not.toBeNull();
  });

  it("makes an elite a real fight: the player still wins at least 20 of 25", () => {
    expect(elite.filter((o) => o.winner === 0).length).toBeGreaterThanOrEqual(20);
  });

  it("leaves the player with less hp against every elite than against the same region's normal mob", () => {
    elite.forEach((e, i) => {
      const n = normal[i]!;
      expect(e.left, `${e.player} vs ${e.region}: elite ${e.left.toFixed(3)} vs mob ${n.left.toFixed(3)}`).toBeLessThan(n.left);
    });
  });

  it("makes an elite cost the player more on average than a normal mob", () => {
    expect(mean(elite.map((o) => o.left))).toBeLessThan(mean(normal.map((o) => o.left)));
  });
});

describe("MOB_TYPES (the roguelike roster, data only)", () => {
  const SPEC: Record<FactionId, { normals: [string, string][]; elite: [string, string] }> = {
    fire: { normals: [["emberImp", "Ember Imp"], ["cinderHound", "Cinder Hound"], ["magmaBrute", "Magma Brute"]], elite: ["wyrmling", "Wyrmling"] },
    sentenced: { normals: [["bailiff", "Bailiff"], ["chainWarden", "Chain Warden"], ["inquisitor", "Inquisitor"]], elite: ["executioner", "Executioner"] },
    plague: { normals: [["plagueRat", "Plague Rat"], ["bloatfly", "Bloatfly"], ["rotMonk", "Rot Monk"]], elite: ["ratOgre", "Rat Ogre"] },
    frost: { normals: [["frostWisp", "Frost Wisp"], ["iceGolem", "Ice Golem"], ["rimeStalker", "Rime Stalker"]], elite: ["glacialWarden", "Glacial Warden"] },
    holy: { normals: [["acolyte", "Acolyte"], ["seraphShard", "Seraph Shard"], ["penitent", "Penitent"]], elite: ["bloodSaint", "Blood Saint"] },
  };

  it("has 20 types with unique ids and unique, non-empty, trimmed names", () => {
    expect(MOB_TYPES).toHaveLength(20);
    expect(new Set(MOB_TYPES.map((t) => t.id)).size).toBe(20);
    expect(new Set(MOB_TYPES.map((t) => t.name)).size).toBe(20);
    for (const t of MOB_TYPES) {
      expect(t.id.length, t.id).toBeGreaterThan(0);
      expect(t.name.length, t.id).toBeGreaterThan(0);
      expect(t.name, t.id).toBe(t.name.trim());
    }
  });

  it("has four types per zone: three normals and exactly one elite, in zone order", () => {
    for (const zone of REGIONS) {
      const ofZone = MOB_TYPES.filter((t) => t.zone === zone);
      expect(ofZone, zone).toHaveLength(4);
      expect(ofZone.filter((t) => t.elite), zone).toHaveLength(1);
      expect(ofZone.filter((t) => !t.elite), zone).toHaveLength(3);
      expect(ofZone[3].elite, `${zone}: the elite is last`).toBe(true);
    }
    expect(MOB_TYPES.map((t) => t.zone)).toEqual(REGIONS.flatMap((z) => [z, z, z, z]));
  });

  it("is the contract's roster: the ids and names of the plan, zone by zone", () => {
    for (const zone of REGIONS) {
      const spec = SPEC[zone];
      expect(normalTypesOf(zone).map((t) => [t.id, t.name]), zone).toEqual(spec.normals);
      const elite = eliteTypeOf(zone);
      expect([elite.id, elite.name], zone).toEqual(spec.elite);
      expect(elite.elite).toBe(true);
    }
  });

  it("looks types up: mobTypesOf, normalTypesOf, eliteTypeOf, mobTypeById", () => {
    for (const zone of REGIONS) {
      expect(mobTypesOf(zone), zone).toEqual([...normalTypesOf(zone), eliteTypeOf(zone)]);
      expect(normalTypesOf(zone), zone).toHaveLength(3);
      for (const t of mobTypesOf(zone)) expect(t.zone).toBe(zone);
      expect(eliteTypeOf(zone).zone).toBe(zone);
    }
  });

  it("round-trips every id through mobTypeById and answers undefined for anything else", () => {
    for (const t of MOB_TYPES) expect(mobTypeById(t.id), t.id).toBe(t);
    for (const id of ["", "unknown", "EmberImp", "emberimp", " emberImp", "constructor", "toString", "__proto__", "fire"]) {
      expect(mobTypeById(id), `"${id}"`).toBeUndefined();
    }
  });

  it("types an id as a union: the literal ids in the table are all MobTypeId", () => {
    const ids: MobTypeId[] = MOB_TYPES.map((t) => t.id);
    const defs: MobTypeDef[] = [...MOB_TYPES];
    expect(ids).toHaveLength(defs.length);
  });

  it("leaves mobName and the old two-name behaviour as they were", () => {
    expect(mobName("fire", false)).toBe("Cinderling");
    expect(mobName("fire", true)).toBe("Ember Warlord");
    expect(mobName("holy", true)).toBe("Demon Herald");
  });

  it("is reachable from the shared index", () => {
    expect(shared.MOB_TYPES).toBe(MOB_TYPES);
    expect(shared.mobTypeById).toBe(mobTypeById);
    expect(shared.mobTypesOf).toBe(mobTypesOf);
    expect(shared.normalTypesOf).toBe(normalTypesOf);
    expect(shared.eliteTypeOf).toBe(eliteTypeOf);
  });
});
