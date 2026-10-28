import { describe, expect, it } from "vitest";
import {
  ABILITIES, CARDS, duel, ELITE_K, elitesOf, FACTION_IDS, FACTIONS, isRegionalKind, isWeaponId, MOB_K, MOB_ROLE_DEFS, MOB_ROLES, MOB_TYPES,
  mobTypeById, mobTypeFaction, mobTypeIn, mobTypesOf, mobTypeWeapon, normalTypesOf, QUEST_DEFS,
  mobFaction, mobName, mobWeapon, pacedFaction, REGION_WEAPONS, scaledFaction, SIGNATURE_WEAPONS, WEAPON_IDS, WEAPONS,
  type FactionId, type FactionSpec, type MobKind, type MobRole, type MobTypeDef, type MobTypeId, type WeaponId,
} from "../src/index";
import * as shared from "../src/index";

const REGIONS = FACTION_IDS;

/** Every param the faction scaling treats as a point-damage number (factions.ts keeps the same list private). */
/** The point-damage params a mob type multiplies by dmgMult; mark_pct and mark_kill are shares of the player's hp, scaled by k in mobFaction and by dmgMult here. */
const DAMAGE_PARAMS = ["burn", "backlash", "plague", "execute", "mark_pct", "mark_kill"];

describe("the tunables the mob catalog reads", () => {
  it("are the contract's numbers", () => {
    expect([MOB_K, ELITE_K]).toEqual([0.22, 0.65]);
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

  /**
   * scaledFaction by k, with a signature's execute scaled by k once more (k squared overall, balance contract 6.1) and the mark's shares of
   * the player's max hp by k once (scaledFaction leaves them alone: a share of a pool already scales with the pool; the mob's target is a
   * full-scale player).
   */
  const scaledWithExecute = (region: FactionId, k: number): FactionSpec => {
    const spec = scaledFaction(FACTIONS[region], k);
    const params = { ...spec.params };
    if (params.execute !== undefined) params.execute *= k;
    if (params.mark_pct !== undefined) params.mark_pct *= k;
    if (params.mark_kill !== undefined) params.mark_kill *= k;
    return { ...spec, params };
  };

  it("is the region's faction scaled by MOB_K, an elite's by ELITE_K (an execute by k squared)", () => {
    for (const region of REGIONS) {
      expect(mobFaction(region, false)).toEqual(scaledWithExecute(region, MOB_K));
      expect(mobFaction(region, true)).toEqual(scaledWithExecute(region, ELITE_K));
      // A faction with no execute and no mark is exactly scaledFaction.
      if (FACTIONS[region].params.execute === undefined && FACTIONS[region].params.mark_pct === undefined) {
        expect(mobFaction(region, false)).toEqual(scaledFaction(FACTIONS[region], MOB_K));
        expect(mobFaction(region, true)).toEqual(scaledFaction(FACTIONS[region], ELITE_K));
      }
    }
  });

  it("scales an execute by k twice: it reads the PLAYER's hp fraction, whose pool is full-scale (the Plague fix)", () => {
    const execute = FACTIONS.plague.params.execute!;
    expect(execute).toBeGreaterThan(0);
    expect(mobFaction("plague", false).params.execute).toBeCloseTo(execute * MOB_K * MOB_K, 9);
    expect(mobFaction("plague", true).params.execute).toBeCloseTo(execute * ELITE_K * ELITE_K, 9);
    // Only the execute gets the second factor: the disease beside it, the hit and the hp scale by k alone.
    expect(mobFaction("plague", false).params.plague).toBeCloseTo(FACTIONS.plague.params.plague! * MOB_K, 9);
    expect(mobFaction("plague", false).hit).toBeCloseTo(FACTIONS.plague.hit * MOB_K, 9);
    expect(mobFaction("plague", false).hp).toBeCloseTo(FACTIONS.plague.hp * MOB_K, 9);
    // So the execute per unit of the player's missing hp is k squared of a player-sized Plague's, where every other number is k.
    expect(mobFaction("plague", false).params.execute! / execute).toBeCloseTo(MOB_K * MOB_K, 12);
    expect(mobFaction("plague", false).params.execute! / execute).toBeLessThan(mobFaction("plague", false).hp / FACTIONS.plague.hp);
    // At k = 1 nothing changes (the parity tests fight player-sized factions).
    expect(mobFaction("plague", false, 1)).toEqual(FACTIONS.plague);
    for (const region of REGIONS) expect(mobFaction(region, false, 1)).toEqual(FACTIONS[region]);
    // A sweep's k reaches the execute too.
    expect(mobFaction("plague", false, 0.5).params.execute).toBeCloseTo(execute * 0.25, 9);
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
          const want = DAMAGE_PARAMS.includes(key) ? base.params[key]! * k * (key === "execute" ? k : 1) : base.params[key]!;
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
    expect(mobFaction("frost", false).params).toEqual({ slow: FACTIONS.frost.params.slow });
    expect(mobFaction("frost", true).params).toEqual({ slow: FACTIONS.frost.params.slow });
    expect(mobFaction("holy", true).params).toEqual(FACTIONS.holy.params);
  });

  it("has concrete numbers: a Fire mob is 183.7 hp and a 22 hit, a Plague elite 893.75 hp (the balance sheet x MOB_K / ELITE_K)", () => {
    expect(mobFaction("fire", false).hp).toBeCloseTo(835 * 0.22, 9);
    expect(mobFaction("fire", false).hit).toBeCloseTo(22, 9);
    expect(mobFaction("fire", false).params.burn).toBeCloseTo(18 * 0.22, 9);
    expect(mobFaction("plague", true).hp).toBeCloseTo(1375 * 0.65, 9);
    expect(mobFaction("sentenced", false).params.mark_pct).toBeCloseTo(FACTIONS.sentenced.params.mark_pct! * MOB_K, 9);
    expect(mobFaction("sentenced", false).params.mark_kill).toBeCloseTo(FACTIONS.sentenced.params.mark_kill! * MOB_K, 9);
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
    expect(FACTIONS.fire.hp).toBe(835);
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

describe("MOB_TYPES (the roguelike roster: 30 types, six per zone, with roles and weapons)", () => {
  /** Balance contract 6.3, row by row: [id, name, role, weapon]. */
  const SPEC: Record<FactionId, { normals: [string, string, MobRole, WeaponId][]; elites: [string, string, MobRole, WeaponId][] }> = {
    fire: {
      normals: [["emberImp", "Ember Imp", "swarm", "axe"], ["cinderHound", "Cinder Hound", "skirmisher", "axe"], ["magmaBrute", "Magma Brute", "brute", "axe"], ["flameCaller", "Flame Caller", "caster", "wand"]],
      elites: [["wyrmling", "Wyrmling", "grunt", "axe"], ["ashDrake", "Ash Drake", "caster", "wand"]],
    },
    sentenced: {
      normals: [["bailiff", "Bailiff", "grunt", "sword"], ["chainWarden", "Chain Warden", "brute", "sword"], ["inquisitor", "Inquisitor", "skirmisher", "sword"], ["pardoner", "Pardoner", "caster", "bow"]],
      elites: [["executioner", "Executioner", "grunt", "sword"], ["gaoler", "Gaoler", "brute", "shield"]],
    },
    plague: {
      normals: [["plagueRat", "Plague Rat", "swarm", "bow"], ["bloatfly", "Bloatfly", "skirmisher", "bow"], ["rotMonk", "Rot Monk", "grunt", "bow"], ["miasmaWitch", "Miasma Witch", "caster", "wand"]],
      elites: [["ratOgre", "Rat Ogre", "brute", "bow"], ["poxBehemoth", "Pox Behemoth", "brute", "axe"]],
    },
    frost: {
      normals: [["frostWisp", "Frost Wisp", "swarm", "shield"], ["iceGolem", "Ice Golem", "brute", "shield"], ["rimeStalker", "Rime Stalker", "skirmisher", "shield"], ["frostbowSentry", "Frostbow Sentry", "caster", "bow"]],
      elites: [["glacialWarden", "Glacial Warden", "grunt", "shield"], ["avalancheTroll", "Avalanche Troll", "brute", "axe"]],
    },
    holy: {
      normals: [["acolyte", "Acolyte", "grunt", "wand"], ["seraphShard", "Seraph Shard", "swarm", "wand"], ["penitent", "Penitent", "skirmisher", "wand"], ["zealot", "Zealot", "brute", "sword"]],
      elites: [["bloodSaint", "Blood Saint", "grunt", "wand"], ["archon", "Archon", "skirmisher", "sword"]],
    },
  };

  it("has 30 types with unique ids and unique, non-empty, trimmed names", () => {
    expect(MOB_TYPES).toHaveLength(30);
    expect(new Set(MOB_TYPES.map((t) => t.id)).size).toBe(30);
    expect(new Set(MOB_TYPES.map((t) => t.name)).size).toBe(30);
    for (const t of MOB_TYPES) {
      expect(t.id.length, t.id).toBeGreaterThan(0);
      expect(t.name.length, t.id).toBeGreaterThan(0);
      expect(t.name, t.id).toBe(t.name.trim());
    }
  });

  it("has six types per zone: four normals, then exactly two elites, in zone order", () => {
    for (const zone of REGIONS) {
      const ofZone = MOB_TYPES.filter((t) => t.zone === zone);
      expect(ofZone, zone).toHaveLength(6);
      expect(ofZone.filter((t) => t.elite), zone).toHaveLength(2);
      expect(ofZone.filter((t) => !t.elite), zone).toHaveLength(4);
      expect(ofZone.map((t) => t.elite), `${zone}: normals first, the two elites last`).toEqual([false, false, false, false, true, true]);
    }
    expect(MOB_TYPES.map((t) => t.zone)).toEqual(REGIONS.flatMap((z) => [z, z, z, z, z, z]));
  });

  it("is the contract's roster: the ids, names, roles and weapons of 6.3, zone by zone", () => {
    for (const zone of REGIONS) {
      const spec = SPEC[zone];
      expect(normalTypesOf(zone).map((t) => [t.id, t.name, t.role, t.weapon]), zone).toEqual(spec.normals);
      expect(elitesOf(zone).map((t) => [t.id, t.name, t.role, t.weapon]), zone).toEqual(spec.elites);
      for (const e of elitesOf(zone)) expect(e.elite).toBe(true);
    }
  });

  it("looks types up: mobTypesOf, normalTypesOf, elitesOf, mobTypeById", () => {
    for (const zone of REGIONS) {
      expect(mobTypesOf(zone), zone).toEqual([...normalTypesOf(zone), ...elitesOf(zone)]);
      expect(normalTypesOf(zone), zone).toHaveLength(4);
      expect(elitesOf(zone), zone).toHaveLength(2);
      for (const t of mobTypesOf(zone)) expect(t.zone).toBe(zone);
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
    expect(shared.elitesOf).toBe(elitesOf);
    expect((shared as Record<string, unknown>).eliteTypeOf, "the one-elite alias is gone").toBeUndefined();
    expect(shared.mobTypeFaction).toBe(mobTypeFaction);
  });

  it("names no type after a quest, a Wish, a card, a faction, a weapon or a region's two-name fallback", () => {
    const reserved = new Set<string>([
      ...QUEST_DEFS.map((q) => q.name), ...Object.values(ABILITIES).map((a) => a.name), ...CARDS.map((c) => c.title),
      ...FACTION_IDS.flatMap((f) => [FACTIONS[f].name, FACTIONS[f].displayName, mobName(f, false), mobName(f, true)]), ...Object.values(WEAPONS).map((w) => w.name),
    ].map((n) => n.toLowerCase()));
    for (const t of MOB_TYPES) expect(reserved.has(t.name.toLowerCase()), `${t.id}: "${t.name}"`).toBe(false);
  });
});

describe("mob roles (balance contract 6.3)", () => {
  it("has the five roles with the contract's multipliers and behaviour tags", () => {
    expect(MOB_ROLES).toEqual(["grunt", "swarm", "brute", "skirmisher", "caster"]);
    const row = (r: MobRole) => [MOB_ROLE_DEFS[r].hpMult, MOB_ROLE_DEFS[r].dmgMult, MOB_ROLE_DEFS[r].moveMult];
    // Brute is tuned below the contract's provisional 1.5 / 0.85 (bench/campDuel.ts --types: at 1.5 no starter on the zone weapon
    // cleared the Pox Behemoth camp); the others are the contract's numbers.
    expect(row("grunt")).toEqual([1, 1, 1]);
    expect(row("swarm")).toEqual([0.7, 0.9, 1.1]);
    expect(row("brute")).toEqual([1.4, 0.8, 0.9]);
    expect(row("skirmisher")).toEqual([0.85, 1.1, 1.15]);
    expect(row("caster")).toEqual([0.75, 1.2, 1]);
    expect(MOB_ROLE_DEFS.swarm.tags).toEqual(["fast", "fragile"]);
    expect(MOB_ROLE_DEFS.brute.tags).toEqual(["tanky"]);
    expect(MOB_ROLE_DEFS.skirmisher.tags).toEqual(["chases"]);
    expect(MOB_ROLE_DEFS.caster.tags).toEqual(["ranged"]);
    expect(MOB_ROLE_DEFS.grunt.tags).toEqual([]);
    for (const r of MOB_ROLES) expect(MOB_ROLE_DEFS[r].id).toBe(r);
  });

  it("copies the role's numbers onto every type, so a consumer needs only the type", () => {
    for (const t of MOB_TYPES) {
      const r = MOB_ROLE_DEFS[t.role];
      expect([t.hpMult, t.dmgMult, t.moveMult, t.tags], t.id).toEqual([r.hpMult, r.dmgMult, r.moveMult, r.tags]);
    }
  });

  it("gives four zones one caster among their normals (a ranged weapon), and Holy none: its wand carriers all shoot already", () => {
    for (const zone of REGIONS) {
      const casters = normalTypesOf(zone).filter((t) => t.role === "caster");
      expect(casters, zone).toHaveLength(zone === "holy" ? 0 : 1);
    }
    for (const t of MOB_TYPES.filter((x) => x.role === "caster")) expect(["bow", "wand"], t.id).toContain(t.weapon);
  });

  it("gives every zone a skirmisher among its normals and four different roles, and no swarm among the elites", () => {
    for (const zone of REGIONS) {
      const roles = new Set(normalTypesOf(zone).map((t) => t.role));
      expect(roles.has("skirmisher"), zone).toBe(true);
      expect(roles.size, zone).toBe(4);
    }
    expect(MOB_TYPES.filter((t) => t.elite && t.role === "swarm")).toHaveLength(0);
  });

  it("makes every weapon drop in at least two zones, and every zone drop two or three weapon kinds", () => {
    const zonesOf = new Map<WeaponId, Set<FactionId>>();
    for (const t of MOB_TYPES) {
      if (!zonesOf.has(t.weapon)) zonesOf.set(t.weapon, new Set());
      zonesOf.get(t.weapon)!.add(t.zone);
    }
    for (const w of WEAPON_IDS) expect(zonesOf.get(w)?.size ?? 0, w).toBeGreaterThanOrEqual(2);
    for (const zone of REGIONS) {
      const kinds = new Set(mobTypesOf(zone).map((t) => t.weapon));
      expect(kinds.size, zone).toBeGreaterThanOrEqual(2);
      expect(kinds.size, zone).toBeLessThanOrEqual(3);
      // The zone's default weapon (REGION_WEAPONS) stays among them: a mob placed without a type carries it.
      expect(kinds.has(mobWeapon(zone)), zone).toBe(true);
    }
  });
});

describe("mobTypeFaction and mobTypeWeapon (a type on top of the zone faction)", () => {
  it("is exactly mobFaction for a grunt, a missing type and a type of another zone", () => {
    for (const zone of REGIONS) {
      for (const elite of [false, true]) {
        expect(mobTypeFaction(zone, elite), zone).toEqual(mobFaction(zone, elite));
        expect(mobTypeFaction(zone, elite, "nope"), zone).toEqual(mobFaction(zone, elite));
        expect(mobTypeFaction(zone, elite, ""), zone).toEqual(mobFaction(zone, elite));
      }
    }
    expect(mobTypeFaction("holy", false, "bailiff")).toEqual(mobFaction("holy", false)); // a grunt, and of another zone anyway
    expect(mobTypeFaction("holy", false, "emberImp")).toEqual(mobFaction("holy", false)); // a swarm of another zone: ignored
    expect(mobTypeFaction("fire", true, "wyrmling")).toEqual(mobFaction("fire", true));
  });

  it("multiplies hp by hpMult and the hit and every point-damage param by dmgMult, and leaves the rest", () => {
    for (const t of MOB_TYPES) {
      const base = mobFaction(t.zone, t.elite);
      const spec = mobTypeFaction(t.zone, t.elite, t.id);
      expect(spec.hp, t.id).toBeCloseTo(base.hp * t.hpMult, 9);
      expect(spec.hit, t.id).toBeCloseTo(base.hit * t.dmgMult, 9);
      for (const key of Object.keys(base.params)) {
        const want = DAMAGE_PARAMS.includes(key) ? base.params[key]! * t.dmgMult : base.params[key]!;
        expect(spec.params[key], `${t.id} ${key}`).toBeCloseTo(want, 9);
      }
      expect([spec.armor, spec.shield, spec.rate, spec.phys, spec.trueShare, spec.id], t.id).toEqual([base.armor, base.shield, base.rate, base.phys, base.trueShare, base.id]);
    }
  });

  it("takes the sweep's k like mobFaction, and does not touch the shared tables", () => {
    const before = JSON.stringify(FACTIONS);
    const spec = mobTypeFaction("plague", false, "miasmaWitch", 0.5);
    expect(spec.hp).toBeCloseTo(FACTIONS.plague.hp * 0.5 * 0.75, 9);
    expect(spec.params.execute).toBeCloseTo(FACTIONS.plague.params.execute! * 0.25 * 1.2, 9);
    expect(JSON.stringify(FACTIONS)).toBe(before);
    expect(mobTypeFaction("plague", false, "miasmaWitch").params).not.toBe(mobFaction("plague", false).params);
  });

  it("gives a swarm less hp than a grunt and a brute more, and a caster the hardest hit and a swarm the softest", () => {
    expect(mobTypeFaction("plague", false, "plagueRat").hp).toBeLessThan(mobFaction("plague", false).hp);
    expect(mobTypeFaction("frost", false, "iceGolem").hp).toBeGreaterThan(mobFaction("frost", false).hp);
    const hit = (id: MobTypeId) => mobTypeFaction(mobTypeById(id)!.zone, false, id).hit;
    expect(hit("miasmaWitch")).toBeGreaterThan(hit("bloatfly"));
    expect(hit("bloatfly")).toBeGreaterThan(hit("rotMonk"));
    expect(hit("rotMonk")).toBeGreaterThan(hit("plagueRat"));
  });

  it("carries the type's weapon, and the region's default for a missing type or one of another region", () => {
    for (const t of MOB_TYPES) expect(mobTypeWeapon(t.zone, t.id), t.id).toBe(t.weapon);
    for (const zone of REGIONS) {
      expect(mobTypeWeapon(zone), zone).toBe(mobWeapon(zone));
      expect(mobTypeWeapon(zone, "nope"), zone).toBe(mobWeapon(zone));
    }
    expect(mobTypeWeapon("sentenced", "flameCaller")).toBe("sword"); // a Fire type in a Sentenced mob: ignored
  });

  it("answers mobTypeIn only for a type of that zone", () => {
    expect(mobTypeIn("fire", "emberImp")?.id).toBe("emberImp");
    expect(mobTypeIn("holy", "emberImp")).toBeUndefined();
    expect(mobTypeIn("fire", undefined)).toBeUndefined();
    expect(mobTypeIn("fire", "")).toBeUndefined();
  });
});
