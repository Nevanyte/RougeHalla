import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, attackInterval, backlashPerSwing, BOW_WINDUP, BOW_WINDUP_SHARE, damagePerHit, DUEL_PACE, FACTION_IDS, FACTIONS,
  FISTS, FISTS_WINDUP, isLoopWeapon, isRanged, isWeaponId, MAX_SIGHT_CORRIDOR, pacedFaction, PLAYER_RADIUS, RANGED_HIT_REACH,
  RANGED_SLACK, SIGNATURE_WEAPONS, WEAPON_BEATS, WEAPON_IDS, WEAPONS, WAND_WINDUP, WAND_WINDUP_SHARE, weaponEdge, weaponTimings,
  AXE_SHRED_ARMOR, AXE_SHRED_CAP, AXE_SHRED_MS, FISTS_ON_HIT_POWER, STATUS_RULES, SWORD_ON_HIT_POWER, WAND_SPLASH_RADIUS, WAND_SPLASH_SHARE,
  WEAPON_TAGS, type FactionId, type WeaponId,
} from "../src/index";

/**
 * Reference numbers from testing/realtime.py (the 20 Hz design model): [faction, weapon, interval s, per-hit raw at
 * k = 1]. Regenerate with `python3 testing/weapon_reference.py` if the design numbers change.
 */
const REFERENCE: Array<[FactionId, WeaponId, number, number]> = [
  ["fire", "sword", 0.775193798450, 34.883720930233],
  ["fire", "axe", 1.190476190476, 55.000000000000],
  ["fire", "bow", 0.854700854701, 41.025641025641],
  ["fire", "wand", 1.010101010101, 48.484848484848],
  ["fire", "shield", 1.041666666667, 46.875000000000],
  ["fire", "fists", 0.666666666667, 24.000000000000],
  ["sentenced", "sword", 0.516795865633, 3.488372093023],
  ["sentenced", "axe", 0.793650793651, 5.500000000000],
  ["sentenced", "bow", 0.569800569801, 4.102564102564],
  ["sentenced", "wand", 0.673400673401, 4.848484848485],
  ["sentenced", "shield", 0.694444444444, 4.687500000000],
  ["sentenced", "fists", 0.444444444444, 2.400000000000],
  ["plague", "sword", 0.251414204903, 6.976744186047],
  ["plague", "axe", 0.386100386100, 11.000000000000],
  ["plague", "bow", 0.277200277200, 8.205128205128],
  ["plague", "wand", 0.327600327600, 9.696969696970],
  ["plague", "shield", 0.337837837838, 9.375000000000],
  ["plague", "fists", 0.216216216216, 4.800000000000],
  ["frost", "sword", 1.033591731266, 61.046511627907],
  ["frost", "axe", 1.587301587302, 96.250000000000],
  ["frost", "bow", 1.139601139601, 71.794871794872],
  ["frost", "wand", 1.346801346801, 84.848484848485],
  ["frost", "shield", 1.388888888889, 82.031250000000],
  ["frost", "fists", 0.888888888889, 42.000000000000],
  ["holy", "sword", 0.489596083231, 33.488372093023],
  ["holy", "axe", 0.751879699248, 52.800000000000],
  ["holy", "bow", 0.539811066127, 39.384615384615],
  ["holy", "wand", 0.637958532695, 46.545454545455],
  ["holy", "shield", 0.657894736842, 45.000000000000],
  ["holy", "fists", 0.421052631579, 23.040000000000],
];

/** Fire's backlash per enemy swing: the same for every enemy faction, backlash / (1 + boost). */
const BACKLASH: Record<WeaponId, number> = {
  sword: 67.441860465116, axe: 103.571428571429, bow: 74.358974358974, wand: 87.878787878788, shield: 90.625000000000, fists: 58.000000000000,
};

/**
 * testing/realtime.py's weapon table: each weapon's damage multiplier and, for the two ranged ones, the range that sets the
 * kite check's free-fire time. The model and the game must be the same game (python3 testing/weapon_reference.py).
 */
const MODEL_WEAPONS: Record<WeaponId, { dps: number; range: number | null }> = {
  sword: { dps: 0.75, range: null },
  bow: { dps: 0.8, range: 240 },
  wand: { dps: 0.8, range: 220 },
  shield: { dps: 0.75, range: null },
  axe: { dps: 0.77, range: null },
  fists: { dps: 0.6, range: null },
};

describe("parity with testing/realtime.py", () => {
  it.each(ALL_WEAPON_IDS)("%s: damage multiplier and range are the design model's", (w) => {
    expect(WEAPONS[w].dpsMult).toBe(MODEL_WEAPONS[w].dps);
    const shape = WEAPONS[w].shape;
    expect(shape.kind === "projectile" ? shape.range : null).toBe(MODEL_WEAPONS[w].range);
  });

  it.each(REFERENCE)("%s %s: interval and per-hit damage", (f, w, interval, perHit) => {
    expect(attackInterval(FACTIONS[f], w)).toBeCloseTo(interval, 10);
    expect(damagePerHit(FACTIONS[f], w)).toBeCloseTo(perHit, 9);
  });

  it.each(FACTION_IDS)("Fire's backlash per swing of a %s enemy, on every weapon", (f) => {
    for (const w of ALL_WEAPON_IDS) {
      expect(backlashPerSwing(FACTIONS.fire.params.backlash!, FACTIONS[f], w)).toBeCloseTo(BACKLASH[w], 9);
    }
  });

  it("turns attack speed past the floor into damage per hit (Plague's sword at x1.3)", () => {
    expect(attackInterval(FACTIONS.plague, "sword", 1.3)).toBeCloseTo(0.25, 12);
    expect(damagePerHit(FACTIONS.plague, "sword", 1.3)).toBeCloseTo(9.018750000000, 9);
  });

  it("keeps every faction's damage per second x dpsMult on every weapon", () => {
    for (const f of FACTION_IDS) {
      for (const w of WEAPON_IDS) {
        const dps = damagePerHit(FACTIONS[f], w) / attackInterval(FACTIONS[f], w);
        expect(dps).toBeCloseTo(FACTIONS[f].rate * FACTIONS[f].hit * WEAPONS[w].dpsMult, 9);
      }
    }
  });
});

describe("duel pace", () => {
  it("doubles every hit and leaves hp alone", () => {
    expect(DUEL_PACE).toBe(2);
    for (const f of FACTION_IDS) {
      const paced = pacedFaction(FACTIONS[f]);
      expect(paced.hp).toBe(FACTIONS[f].hp);
      for (const w of WEAPON_IDS) expect(damagePerHit(paced, w)).toBeCloseTo(2 * damagePerHit(FACTIONS[f], w), 9);
    }
  });

  it("scales the damage params by k and the mark ramp by k squared", () => {
    expect(pacedFaction(FACTIONS.fire).params).toEqual({ burn: 36, backlash: 290 });
    expect(pacedFaction(FACTIONS.sentenced).params).toEqual({ mark_ramp: 70, mark_cap: 144 });
    expect(pacedFaction(FACTIONS.plague).params).toEqual({ plague: 86, execute: 830 });
    expect(pacedFaction(FACTIONS.frost).params).toEqual({ slow: 0.52 });
    expect(pacedFaction(FACTIONS.holy, 1)).toEqual(FACTIONS.holy);
  });
});

describe("the weapon table (GAME_DESIGN 9.1)", () => {
  it("has the designed boosts, floors, damage multipliers, shapes and ranges", () => {
    const table = WEAPON_IDS.map((w) => [w, WEAPONS[w].boost, WEAPONS[w].floor, WEAPONS[w].dpsMult]);
    expect(table).toEqual([
      ["sword", 1.15, 0.25, 0.75], ["bow", 0.95, 0.25, 0.8], ["wand", 0.65, 0.3, 0.8],
      ["shield", 0.6, 0.3, 0.75], ["axe", 0.4, 0.35, 0.77],
    ]);
    expect(WEAPONS.sword.shape).toEqual({ kind: "arc", reach: 64, halfArc: Math.PI / 4 });
    expect(WEAPONS.axe.shape).toEqual({ kind: "arc", reach: 60, halfArc: Math.PI / 2 });
    expect(WEAPONS.shield.shape).toEqual({ kind: "arc", reach: 44, halfArc: Math.PI / 3 });
    expect(WEAPONS.bow.shape).toEqual({ kind: "projectile", projectile: "arrow", speed: 900, range: 240 });
    expect(WEAPONS.wand.shape).toEqual({ kind: "projectile", projectile: "ball", speed: 380, range: 220 });
  });

  it("keeps the ranged weapons short and light enough for a melee winner to survive the approach (9.1 tuning)", () => {
    // testing/TUNING_9_1.md: ranged dpsMult is no higher than the melee weapons it must beat in a close trade (the bow
    // wins the sword and the axe on the lead its range gives it), and the ranges bound the free fire on a charge.
    const bow = WEAPONS.bow;
    const wand = WEAPONS.wand;
    for (const m of ["sword", "axe"] as const) expect(bow.dpsMult).toBeGreaterThanOrEqual(WEAPONS[m].dpsMult);
    // L6: the bow out-trades the axe by a margin, which is what keeps Bow > Axe standing against a zigzag approach
    // (axe 0.8: 44% against the jink; 0.77: 82%); the axe may sit under the wand's by at most 0.04 (Axe > Wand holds
    // down to 0.76 and loses its Frost column at 0.75) and not under the shield's it pierces.
    expect(bow.dpsMult - WEAPONS.axe.dpsMult).toBeGreaterThanOrEqual(0.03 - 1e-9);
    expect(wand.dpsMult - WEAPONS.axe.dpsMult).toBeLessThanOrEqual(0.04 + 1e-9);
    expect(WEAPONS.axe.dpsMult).toBeGreaterThanOrEqual(WEAPONS.shield.dpsMult);
    expect(wand.dpsMult).toBeGreaterThanOrEqual(WEAPONS.shield.dpsMult);
    if (bow.shape.kind !== "projectile" || wand.shape.kind !== "projectile") throw new Error("projectile");
    expect(bow.shape.range).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR);
    expect(wand.shape.range).toBeLessThan(bow.shape.range);
    // Projectile bodies stay within what the spawn screens assume (RANGED_HIT_REACH).
    expect(PLAYER_RADIUS + RANGED_SLACK).toBe(RANGED_HIT_REACH);
  });

  it("keeps a signature weapon per faction as the design's reference weapon (a run itself starts on fists)", () => {
    expect(SIGNATURE_WEAPONS).toEqual({ fire: "axe", sentenced: "bow", plague: "bow", frost: "shield", holy: "wand" });
  });

  it("is a loop where each weapon beats exactly two and loses to exactly two", () => {
    expect(WEAPON_BEATS).toHaveLength(10);
    for (const w of WEAPON_IDS) {
      expect(WEAPON_BEATS.filter(([a]) => a === w)).toHaveLength(2);
      expect(WEAPON_BEATS.filter(([, b]) => b === w)).toHaveLength(2);
      expect(weaponEdge(w, w)).toBe(0);
    }
    for (const [a, b] of WEAPON_BEATS) {
      expect(weaponEdge(a, b)).toBe(1);
      expect(weaponEdge(b, a)).toBe(-1);
    }
  });
});

describe("fists (what an empty hand fights with)", () => {
  it("are a weapon id of their own, outside the loop of five", () => {
    expect(FISTS).toBe("fists");
    expect(WEAPON_IDS).not.toContain("fists");
    expect(ALL_WEAPON_IDS).toEqual([...WEAPON_IDS, "fists"]);
    expect(isWeaponId("fists")).toBe(true);
    expect(isWeaponId("fist")).toBe(false);
    expect(isLoopWeapon("fists")).toBe(false);
    for (const w of WEAPON_IDS) expect(isLoopWeapon(w), w).toBe(true);
    for (const [a, b] of WEAPON_BEATS) expect([a, b]).not.toContain("fists");
    for (const w of ALL_WEAPON_IDS) expect(weaponEdge("fists", w), w).toBe(0);
  });

  it("have the designed numbers: reach 40, a 120 degree arc, +150% speed, floor 0.2 s, 0.60 of a faction's damage", () => {
    const f = WEAPONS.fists;
    expect([f.id, f.name, f.color, f.boost, f.floor, f.dpsMult]).toEqual(["fists", "Fists", 0xffcc80, 1.5, 0.2, 0.6]);
    expect(f.shape).toEqual({ kind: "arc", reach: 40, halfArc: Math.PI / 3 });
    expect(isRanged("fists")).toBe(false);
    // The shortest reach of any melee weapon, and the fastest cadence on every faction.
    for (const w of ["sword", "axe", "shield"] as const) {
      const shape = WEAPONS[w].shape;
      if (shape.kind !== "arc") throw new Error("arc");
      expect(f.shape.kind === "arc" && f.shape.reach).toBeLessThan(shape.reach);
      for (const id of FACTION_IDS) expect(attackInterval(FACTIONS[id], "fists"), `${id} ${w}`).toBeLessThan(attackInterval(FACTIONS[id], w));
    }
  });

  it("windup 0.1 s (or the whole interval when shorter), no root, so a swing lands two ticks in", () => {
    expect(FISTS_WINDUP).toBe(0.1);
    expect(weaponTimings("fists", 0.67)).toEqual({ interval: 0.67, windup: 0.1, root: 0, ranged: false });
    expect(weaponTimings("fists", 0.05)).toMatchObject({ windup: 0.05, root: 0 });
    // A missing case in the switch would give a windup of 0 without any error.
    for (const id of FACTION_IDS) expect(weaponTimings("fists", attackInterval(FACTIONS[id], "fists")).windup, id).toBeGreaterThan(0);
  });

  it("hit for the faction's rate x hit x 0.60 per second at the cadence the formula gives", () => {
    for (const id of FACTION_IDS) {
      const faction = FACTIONS[id];
      const interval = Math.max(0.2, 1 / (faction.rate * 2.5));
      expect(attackInterval(faction, "fists"), id).toBeCloseTo(interval, 12);
      expect(damagePerHit(faction, "fists"), id).toBeCloseTo(faction.rate * faction.hit * 0.6 * interval, 9);
      expect(backlashPerSwing(200, faction, "fists"), id).toBeCloseTo(80, 9);
    }
  });
});

describe("the weapon specials (BALANCE_CONTRACT 3.3) and their tags", () => {
  it("the axe shreds 8 armor per hit for 3 s up to 24, the wand splashes 30% within 48 u, nothing else has a special", () => {
    expect(WEAPONS.axe.special).toEqual({ kind: "shred", armor: AXE_SHRED_ARMOR, ms: AXE_SHRED_MS, cap: AXE_SHRED_CAP });
    expect([AXE_SHRED_ARMOR, AXE_SHRED_MS, AXE_SHRED_CAP]).toEqual([8, 3000, 24]);
    expect(WEAPONS.wand.special).toEqual({ kind: "splash", share: WAND_SPLASH_SHARE, radius: WAND_SPLASH_RADIUS });
    expect([WAND_SPLASH_SHARE, WAND_SPLASH_RADIUS]).toEqual([0.3, 48]);
    for (const w of ["sword", "bow", "shield", "fists"] as const) expect(WEAPONS[w].special, w).toBeUndefined();
    // The cap is three hits' worth, and the shred status is capped by the same number in the status table.
    expect(AXE_SHRED_CAP).toBe(3 * AXE_SHRED_ARMOR);
    expect(STATUS_RULES.shred).toMatchObject({ cap: AXE_SHRED_CAP, maxMs: AXE_SHRED_MS });
  });

  it("on-hit power: the sword 1.5, fists 1.2, every other weapon 1", () => {
    expect(Object.fromEntries(ALL_WEAPON_IDS.map((w) => [w, WEAPONS[w].onHitPower]))).toEqual({
      sword: SWORD_ON_HIT_POWER, bow: 1, wand: 1, shield: 1, axe: 1, fists: FISTS_ON_HIT_POWER,
    });
    expect([SWORD_ON_HIT_POWER, FISTS_ON_HIT_POWER]).toEqual([1.5, 1.2]);
  });

  it("the glossary's weapon tags carry the specials, from the same numbers", () => {
    const note = (w: WeaponId): string => WEAPON_TAGS.find((r) => r.weapon === w)!.note;
    expect(note("axe")).toContain(`${AXE_SHRED_ARMOR} armor for ${AXE_SHRED_MS / 1000} s, up to ${AXE_SHRED_CAP}`);
    expect(note("wand")).toContain("30%");
    expect(note("wand")).toContain(`${WAND_SPLASH_RADIUS} u`);
    expect(note("sword")).toContain("1.5x");
    expect(note("fists")).toContain("1.2x");
    expect(WEAPON_TAGS.find((r) => r.weapon === "sword")!.tags).toContain("onHit");
    expect(WEAPON_TAGS.find((r) => r.weapon === "axe")!.tags).toContain("onHit");
    expect(WEAPON_TAGS.find((r) => r.weapon === "wand")!.tags).toContain("area");
    expect(WEAPON_TAGS.find((r) => r.weapon === "fists")!.tags).toContain("onHit");
  });
});

describe("animation timings scale with the interval (GAME_DESIGN 10.3)", () => {
  it("caps the axe root at 0.5 s or half the interval, and its windup at 0.25 s or a quarter", () => {
    expect(weaponTimings("axe", 1.19)).toMatchObject({ windup: 0.25, root: 0.5, interval: 1.19 });
    const fast = weaponTimings("axe", 0.386);
    expect(fast.windup).toBeCloseTo(0.0965, 12);
    expect(fast.root).toBeCloseTo(0.193, 12);
  });

  it("caps the wand cast at 0.4 s or 80% of the interval, with no slow after it", () => {
    expect([WAND_WINDUP, WAND_WINDUP_SHARE]).toEqual([0.4, 0.8]);
    expect(weaponTimings("wand", 1.01)).toEqual({ interval: 1.01, windup: 0.4, root: 0, ranged: true });
    const fast = weaponTimings("wand", 0.3276);
    expect(fast.windup).toBeCloseTo(0.26208, 12);
    expect(fast).not.toHaveProperty("castSlow");
  });

  it("makes the bow's draw a fixed windup inside its interval: min(0.6 s, 92%), the same every shot", () => {
    expect([BOW_WINDUP, BOW_WINDUP_SHARE]).toEqual([0.6, 0.92]);
    expect(weaponTimings("bow", 1.14)).toEqual({ interval: 1.14, windup: 0.6, root: 0, ranged: true });
    expect(weaponTimings("bow", 0.2772).windup).toBeCloseTo(0.255024, 12);
    // No partial draws, no cooldown after the loose: the whole interval is the cycle.
    for (const key of ["fullDraw", "minDraw", "cooldown", "castSlow"]) expect(weaponTimings("bow", 1.14)).not.toHaveProperty(key);
  });

  it("carries no per-weapon floor: a windup mod shortens melee only, by scaleWindup's own rule (owner ruling \"Melee windups only\")", () => {
    for (const w of ["sword", "shield", "axe", "bow", "wand"] as const) expect(weaponTimings(w, 1)).not.toHaveProperty("windupFloor");
    expect(weaponTimings("bow", 0.3).ranged).toBe(true);
    expect(weaponTimings("wand", 0.3).ranged).toBe(true);
    for (const w of ["sword", "shield", "axe"] as const) expect(weaponTimings(w, 1).ranged).toBe(false);
  });

  it("lands sword and bash hits 0.1 s in", () => {
    expect(weaponTimings("sword", 0.78)).toEqual({ interval: 0.78, windup: 0.1, root: 0, ranged: false });
    expect(weaponTimings("shield", 1.04)).toMatchObject({ windup: 0.1, ranged: false });
    expect(weaponTimings("bow", 0.85).ranged).toBe(true);
    expect(weaponTimings("wand", 1.0).ranged).toBe(true);
  });

  it("every windup fits inside its interval", () => {
    for (const w of ALL_WEAPON_IDS) {
      for (const interval of [0.1, 0.25, 0.4, 0.8, 1.2, 2]) {
        const t = weaponTimings(w, interval);
        expect(t.windup, `${w} ${interval}`).toBeLessThanOrEqual(interval);
        expect(t.windup + t.root, `${w} ${interval}`).toBeLessThanOrEqual(interval + 1e-12);
      }
    }
  });
});
