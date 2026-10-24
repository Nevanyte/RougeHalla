import { describe, expect, it } from "vitest";
import {
  attackInterval, backlashPerSwing, damagePerHit, drawDamageScale, DUEL_PACE, FACTION_IDS, FACTIONS, MAX_SIGHT_CORRIDOR,
  pacedFaction, PLAYER_RADIUS, RANGED_HIT_REACH, RANGED_SLACK, SIGNATURE_WEAPONS, WEAPON_BEATS, WEAPON_IDS, WEAPONS,
  weaponEdge, weaponTimings, type FactionId, type WeaponId,
} from "../src/index";

/**
 * Reference numbers from testing/realtime.py (the 20 Hz design model): [faction, weapon, interval s, per-hit raw at
 * k = 1]. Regenerate with `python3 testing/weapon_reference.py` if the design numbers change.
 */
const REFERENCE: Array<[FactionId, WeaponId, number, number]> = [
  ["fire", "sword", 0.775193798450, 52.325581395349],
  ["fire", "axe", 1.190476190476, 85.714285714286],
  ["fire", "bow", 0.854700854701, 61.538461538462],
  ["fire", "wand", 1.010101010101, 68.181818181818],
  ["fire", "shield", 1.041666666667, 70.312500000000],
  ["sentenced", "sword", 0.516795865633, 1.744186046512],
  ["sentenced", "axe", 0.793650793651, 2.857142857143],
  ["sentenced", "bow", 0.569800569801, 2.051282051282],
  ["sentenced", "wand", 0.673400673401, 2.272727272727],
  ["sentenced", "shield", 0.694444444444, 2.343750000000],
  ["plague", "sword", 0.251414204903, 6.976744186047],
  ["plague", "axe", 0.386100386100, 11.428571428571],
  ["plague", "bow", 0.277200277200, 8.205128205128],
  ["plague", "wand", 0.327600327600, 9.090909090909],
  ["plague", "shield", 0.337837837838, 9.375000000000],
  ["frost", "sword", 1.033591731266, 31.395348837209],
  ["frost", "axe", 1.587301587302, 51.428571428571],
  ["frost", "bow", 1.139601139601, 36.923076923077],
  ["frost", "wand", 1.346801346801, 40.909090909091],
  ["frost", "shield", 1.388888888889, 42.187500000000],
  ["holy", "sword", 0.489596083231, 22.674418604651],
  ["holy", "axe", 0.751879699248, 37.142857142857],
  ["holy", "bow", 0.539811066127, 26.666666666667],
  ["holy", "wand", 0.637958532695, 29.545454545455],
  ["holy", "shield", 0.657894736842, 30.468750000000],
];

/** Fire's backlash per enemy swing: the same for every enemy faction, 200 / (1 + boost). */
const BACKLASH: Record<WeaponId, number> = {
  sword: 93.023255813953, axe: 142.857142857143, bow: 102.564102564103, wand: 121.212121212121, shield: 125.000000000000
};

describe("parity with testing/realtime.py", () => {
  it.each(REFERENCE)("%s %s: interval and per-hit damage", (f, w, interval, perHit) => {
    expect(attackInterval(FACTIONS[f], w)).toBeCloseTo(interval, 10);
    expect(damagePerHit(FACTIONS[f], w)).toBeCloseTo(perHit, 9);
  });

  it.each(FACTION_IDS)("Fire's backlash per swing of a %s enemy, on every weapon", (f) => {
    for (const w of WEAPON_IDS) {
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
    expect(pacedFaction(FACTIONS.fire).params).toEqual({ burn: 20, backlash: 400 });
    expect(pacedFaction(FACTIONS.sentenced).params).toEqual({ mark_ramp: 140, mark_cap: 550 });
    expect(pacedFaction(FACTIONS.plague).params).toEqual({ plague: 80, execute: 4100 });
    expect(pacedFaction(FACTIONS.frost).params).toEqual({ slow: 0.6 });
    expect(pacedFaction(FACTIONS.holy, 1)).toEqual(FACTIONS.holy);
  });
});

describe("the weapon table (GAME_DESIGN 9.1)", () => {
  it("has the designed boosts, floors, damage multipliers, shapes and ranges", () => {
    const table = WEAPON_IDS.map((w) => [w, WEAPONS[w].boost, WEAPONS[w].floor, WEAPONS[w].dpsMult]);
    expect(table).toEqual([
      ["sword", 1.15, 0.25, 0.75], ["bow", 0.95, 0.25, 0.8], ["wand", 0.65, 0.3, 0.75],
      ["shield", 0.6, 0.3, 0.75], ["axe", 0.4, 0.35, 0.8],
    ]);
    expect(WEAPONS.sword.shape).toEqual({ kind: "arc", reach: 64, halfArc: Math.PI / 4 });
    expect(WEAPONS.axe.shape).toEqual({ kind: "arc", reach: 60, halfArc: Math.PI / 2 });
    expect(WEAPONS.shield.shape).toEqual({ kind: "arc", reach: 44, halfArc: Math.PI / 3 });
    expect(WEAPONS.bow.shape).toEqual({ kind: "projectile", projectile: "arrow", speed: 900, range: 260 });
    expect(WEAPONS.wand.shape).toEqual({ kind: "projectile", projectile: "ball", speed: 380, range: 240 });
  });

  it("keeps the ranged weapons short and light enough for a melee winner to survive the approach (9.1 tuning)", () => {
    // testing/TUNING_9_1.md: ranged dpsMult is no higher than the melee weapons it must beat in a close trade (the bow
    // wins the sword and the axe on the lead its range gives it), and the ranges bound the free fire on a charge.
    const bow = WEAPONS.bow;
    const wand = WEAPONS.wand;
    for (const m of ["sword", "axe"] as const) expect(bow.dpsMult).toBeGreaterThanOrEqual(WEAPONS[m].dpsMult);
    expect(WEAPONS.axe.dpsMult).toBeGreaterThan(wand.dpsMult); // axe > wand needs the closer's dps to be higher
    expect(wand.dpsMult).toBeGreaterThanOrEqual(WEAPONS.shield.dpsMult);
    if (bow.shape.kind !== "projectile" || wand.shape.kind !== "projectile") throw new Error("projectile");
    expect(bow.shape.range).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR);
    expect(wand.shape.range).toBeLessThan(bow.shape.range);
    // Projectile bodies stay within what the spawn screens assume (RANGED_HIT_REACH).
    expect(PLAYER_RADIUS + RANGED_SLACK).toBe(RANGED_HIT_REACH);
  });

  it("starts every faction with its signature weapon", () => {
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

describe("animation timings scale with the interval (GAME_DESIGN 10.3)", () => {
  it("caps the axe root at 0.5 s or half the interval, and its windup at 0.25 s or a quarter", () => {
    expect(weaponTimings("axe", 1.19)).toMatchObject({ windup: 0.25, root: 0.5, cooldown: 1.19 });
    const fast = weaponTimings("axe", 0.386);
    expect(fast.windup).toBeCloseTo(0.0965, 12);
    expect(fast.root).toBeCloseTo(0.193, 12);
  });

  it("caps the wand cast at 0.2 s or 40% and its self-slow at 0.4 s or 45%", () => {
    expect(weaponTimings("wand", 1.01)).toMatchObject({ windup: 0.2, castSlow: 0.4 });
    const fast = weaponTimings("wand", 0.3276);
    expect(fast.windup).toBeCloseTo(0.13104, 12);
    expect(fast.castSlow).toBeCloseTo(0.14742, 12);
  });

  it("makes the bow's draw part of its interval: full draw min(0.6 s, 70%), minimum a quarter of it", () => {
    const slow = weaponTimings("bow", 1.14);
    expect(slow).toMatchObject({ fullDraw: 0.6, minDraw: 0.15, windup: 0 });
    expect(slow.cooldown).toBeCloseTo(0.54, 12);
    const fast = weaponTimings("bow", 0.2772);
    expect(fast.fullDraw).toBeCloseTo(0.19404, 12);
    expect(fast.minDraw).toBeCloseTo(0.04851, 12);
    expect(fast.cooldown + fast.fullDraw).toBeCloseTo(0.2772, 12);
  });

  it("lands sword and bash hits 0.1 s in, and only the ranged weapons slow after the attack", () => {
    expect(weaponTimings("sword", 0.78)).toMatchObject({ windup: 0.1, root: 0, castSlow: 0, ranged: false });
    expect(weaponTimings("shield", 1.04)).toMatchObject({ windup: 0.1, ranged: false });
    expect(weaponTimings("bow", 0.85).ranged).toBe(true);
    expect(weaponTimings("wand", 1.0).ranged).toBe(true);
  });

  it("scales bow damage linearly from 40% at the minimum draw to 100% at the full draw", () => {
    const t = weaponTimings("bow", 1.14);
    expect(drawDamageScale(0, t)).toBe(0.4);
    expect(drawDamageScale(0.15, t)).toBe(0.4);
    expect(drawDamageScale(0.375, t)).toBeCloseTo(0.7, 12);
    expect(drawDamageScale(0.6, t)).toBe(1);
    expect(drawDamageScale(5, t)).toBe(1);
  });

  it("a full draw every interval is the bow's best damage per second", () => {
    const t = weaponTimings("bow", 0.85);
    let best = 0;
    let bestDraw = 0;
    for (let d = t.minDraw; d <= t.fullDraw + 1e-9; d += 0.01) {
      const dps = drawDamageScale(d, t) / (t.cooldown + d);
      if (dps > best) { best = dps; bestDraw = d; }
    }
    expect(bestDraw).toBeCloseTo(t.fullDraw, 1);
  });
});
