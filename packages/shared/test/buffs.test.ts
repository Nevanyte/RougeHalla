import { describe, expect, it } from "vitest";
import {
  activeCombos, BOUNTY_STACK_SHARE, bountyFor, bountyStacks, BUFF_BMAX_ATTACK_SPEED, BUFF_BMAX_HP, BUFF_BMAX_MOVE_SPEED,
  BUFF_S0, BUFF_STATS, BUFF_W, buffBonus, buffMultiplier, CATCHUP_GAP, CATCHUP_MULT, catchUpMultiplier, COMBO_TIER1_STACKS,
  COMBO_TIER2_STACKS, comboFor, comboProgress, COMBOS, comboTier, FACTION_IDS, feedScore, GV_WIN, killEffects, median,
  mobRewardMultiplier, MOB_PRIMARY_BUFF_SHARE, mulberry32, REGION_BUFF, REWARD_FLOOR, REWARD_MID, REWARD_WIDTH, rewardCurve,
  rollBuffStat, zeroStacks, type BuffStat, type FactionId, type Stacks,
} from "../src/index";
import * as shared from "../src/index";

const BMAX: Record<BuffStat, number> = { hp: 0.7, attackSpeed: 0.5, moveSpeed: 0.3 };

/** GAME_DESIGN 12.2, in percentage points: [stacks, max hp, attack speed, move speed]. The 8 row is "8+, about". */
const BONUS_TABLE: Array<[number, number, number, number]> = [
  [1, 5, 4, 2], [2, 16, 11, 7], [3, 32, 23, 14], [4, 48, 34, 21], [5, 58, 42, 25], [6, 63, 45, 27], [8, 66, 47, 28],
];
/** The table is rounded to whole percent, so allow a bit over half a point. */
const TABLE_TOLERANCE_PP = 0.6;

/** GAME_DESIGN 12.3: [feed, mob reward multiplier]. */
const REWARD_TABLE: Array<[number, number]> = [
  [0, 0.98], [2, 0.92], [3, 0.85], [4, 0.76], [5, 0.65], [6, 0.54], [7, 0.45], [8, 0.38], [10, 0.32],
];

/** GAME_DESIGN 12.4: [feed, bounty GV]. */
const BOUNTY_TABLE: Array<[number, number]> = [[3, 10], [4, 28], [5, 52], [6, 80], [7, 112], [8, 147], [10, 226]];

const stacksOf = (hp = 0, attackSpeed = 0, moveSpeed = 0): Stacks => ({ hp, attackSpeed, moveSpeed });

describe("the tunables the buff formulas read", () => {
  it("are the design numbers", () => {
    expect([BUFF_BMAX_HP, BUFF_BMAX_ATTACK_SPEED, BUFF_BMAX_MOVE_SPEED]).toEqual([0.7, 0.5, 0.3]);
    expect([BUFF_S0, BUFF_W]).toEqual([3, 1]);
    expect([COMBO_TIER1_STACKS, COMBO_TIER2_STACKS]).toEqual([3, 5]);
    expect([REWARD_FLOOR, REWARD_MID, REWARD_WIDTH]).toEqual([0.3, 5, 1.5]);
    expect([CATCHUP_GAP, CATCHUP_MULT, BOUNTY_STACK_SHARE, MOB_PRIMARY_BUFF_SHARE]).toEqual([2, 1.25, 0.5, 0.6]);
  });

  it("are reachable from the shared index, with the formulas", () => {
    expect(shared.buffBonus).toBe(buffBonus);
    expect(shared.rewardCurve).toBe(rewardCurve);
    expect(shared.killEffects).toBe(killEffects);
    expect(BUFF_STATS).toEqual(["hp", "attackSpeed", "moveSpeed"]);
  });
});

describe("buffBonus against the GAME_DESIGN 12.2 table", () => {
  const stats: Array<[BuffStat, number]> = [["hp", 1], ["attackSpeed", 2], ["moveSpeed", 3]];

  it.each(stats)("%s matches every row within 0.6 percentage points", (stat, column) => {
    for (const row of BONUS_TABLE) {
      const want = row[column]!;
      const got = buffBonus(stat, row[0]) * 100;
      expect(Math.abs(got - want), `${stat} x${row[0]}: ${got.toFixed(2)} vs ${want}`).toBeLessThanOrEqual(TABLE_TOLERANCE_PP);
    }
  });

  it("is exactly 0 at 0 stacks, and for negative, NaN and -Infinity stacks", () => {
    for (const stat of BUFF_STATS) {
      for (const n of [0, -0, -1, -0.5, -1000, Number.NEGATIVE_INFINITY, Number.NaN]) {
        expect(buffBonus(stat, n), `${stat} ${n}`).toBe(0);
      }
    }
  });

  it("grows from the very first sliver of a stack", () => {
    for (const stat of BUFF_STATS) expect(buffBonus(stat, 1e-6)).toBeGreaterThan(0);
  });

  it("strictly increases with stacks, fractions included", () => {
    for (const stat of BUFF_STATS) {
      let last = 0;
      for (let n = 0.25; n <= 20; n += 0.25) {
        const b = buffBonus(stat, n);
        expect(b, `${stat} ${n}`).toBeGreaterThan(last);
        last = b;
      }
    }
  });

  it("stays below Bmax forever and flattens out towards a plateau", () => {
    for (const stat of BUFF_STATS) {
      for (const n of [1, 3, 5, 8, 12, 20, 50, 1000, Number.POSITIVE_INFINITY]) {
        expect(buffBonus(stat, n), `${stat} ${n}`).toBeLessThan(BMAX[stat]);
      }
      // At 8 stacks the table already says "about", and 30 more stacks add under a point.
      expect(buffBonus(stat, 38) - buffBonus(stat, 8)).toBeLessThan(0.01);
      expect(buffBonus(stat, 38)).toBeGreaterThan(0.94 * BMAX[stat]);
    }
  });

  // The curve is shifted down by sigmoid(-S0 / W) so that 0 stacks is 0, which also pulls the plateau to 95.3% of Bmax
  // (66.7 / 47.6 / 28.6): "about" the 8+ row of the design, but not Bmax itself.
  it("has its plateau (the 8+ row) at about +66% / +47% / +28%, within a point", () => {
    expect(Math.abs(buffBonus("hp", 50) * 100 - 66)).toBeLessThan(1);
    expect(Math.abs(buffBonus("attackSpeed", 50) * 100 - 47)).toBeLessThan(1);
    expect(Math.abs(buffBonus("moveSpeed", 50) * 100 - 28)).toBeLessThan(1);
    const shift = 1 / (1 + Math.exp(BUFF_S0 / BUFF_W));
    for (const stat of BUFF_STATS) expect(buffBonus(stat, 50)).toBeCloseTo(BMAX[stat] * (1 - shift), 9);
  });

  it("orders the stats hp > attack speed > move speed at every stack count", () => {
    for (let n = 0.5; n <= 12; n += 0.5) {
      expect(buffBonus("hp", n)).toBeGreaterThan(buffBonus("attackSpeed", n));
      expect(buffBonus("attackSpeed", n)).toBeGreaterThan(buffBonus("moveSpeed", n));
    }
  });

  it("spikes in the middle: the biggest per-stack gain is between 2 and 4 stacks", () => {
    for (const stat of BUFF_STATS) {
      const gains = Array.from({ length: 9 }, (_, n) => buffBonus(stat, n + 1) - buffBonus(stat, n));
      const best = Math.max(...gains);
      const at = gains.indexOf(best);
      expect([2, 3], `${stat}: gains ${gains.map((g) => g.toFixed(3)).join(" ")}`).toContain(at);
      // 2->3 and 3->4 beat the first stack by a wide margin and the 5th stack too.
      expect(gains[2]).toBeGreaterThan(2 * gains[0]!);
      expect(gains[3]).toBeGreaterThan(2 * gains[0]!);
      expect(gains[3]).toBeGreaterThan(gains[4]!);
      expect(gains[1]).toBeLessThan(gains[2]!);
    }
  });

  it("also peaks inside (2, 4) when stacks are fractional", () => {
    for (const stat of BUFF_STATS) {
      let best = 0;
      let bestAt = 0;
      for (let n = 0; n < 10; n += 0.05) {
        const g = buffBonus(stat, n + 0.05) - buffBonus(stat, n);
        if (g > best) { best = g; bestAt = n; }
      }
      expect(bestAt).toBeGreaterThan(2);
      expect(bestAt).toBeLessThan(4);
    }
  });
});

describe("buffMultiplier", () => {
  it("is 1 plus the bonus, and exactly 1 without stacks", () => {
    for (const stat of BUFF_STATS) {
      expect(buffMultiplier(stat, 0)).toBe(1);
      expect(buffMultiplier(stat, -2)).toBe(1);
      expect(buffMultiplier(stat, Number.NaN)).toBe(1);
      for (const n of [0.5, 1, 2, 3, 3.7, 5, 8, 20]) expect(buffMultiplier(stat, n), `${stat} ${n}`).toBe(1 + buffBonus(stat, n));
    }
  });

  it("reads as the table's percentages (3 stacks of hp: x1.32, of attack speed: x1.23, of move speed: x1.14)", () => {
    expect(buffMultiplier("hp", 3)).toBeCloseTo(1.32, 2);
    expect(buffMultiplier("attackSpeed", 3)).toBeCloseTo(1.23, 2);
    expect(buffMultiplier("moveSpeed", 3)).toBeCloseTo(1.14, 2);
  });

  it("strictly increases with stacks", () => {
    for (const stat of BUFF_STATS) {
      let last = 1;
      for (let n = 0.5; n <= 15; n += 0.5) {
        const m = buffMultiplier(stat, n);
        expect(m, `${stat} ${n}`).toBeGreaterThan(last);
        last = m;
      }
    }
  });
});

describe("comboTier", () => {
  it("is 0 below 3 stacks, 1 from 3, 2 from 5", () => {
    const cases: Array<[number, 0 | 1 | 2]> = [
      [0, 0], [1, 0], [2, 0], [2.5, 0], [2.999, 0], [3, 1], [3.001, 1], [4, 1], [4.999, 1], [5, 2], [5.001, 2], [6, 2], [8, 2], [100, 2],
    ];
    for (const [stacks, tier] of cases) expect(comboTier(stacks), `stacks ${stacks}`).toBe(tier);
  });

  it("counts 1.5 + 1.5 as 3 and 2.999 as 2", () => {
    expect(comboTier(1.5 + 1.5)).toBe(1);
    expect(comboTier(2.999)).toBe(0);
    expect(comboTier(2.5 + 2.5)).toBe(2);
    expect(comboTier(2.4999 + 2.5)).toBe(1);
  });

  it("forgives the float error of stacks gained a sliver at a time", () => {
    let s = 0;
    for (let i = 0; i < 10; i++) s += 0.3;
    expect(s).toBeLessThan(3); // the sum really is short of 3 in floating point
    expect(comboTier(s)).toBe(1);
    let t = 0;
    for (let i = 0; i < 50; i++) t += 0.1;
    expect(t).toBeLessThan(5);
    expect(comboTier(t)).toBe(2);
    expect(comboTier(3 - 1e-9)).toBe(1);
    expect(comboTier(5 - 1e-9)).toBe(2);
    expect(comboTier(3 - 1e-4)).toBe(0);
    expect(comboTier(5 - 1e-4)).toBe(1);
  });

  it("is 0 for negative and NaN stacks, 2 for infinite", () => {
    for (const n of [-1, -100, Number.NEGATIVE_INFINITY, Number.NaN]) expect(comboTier(n), `${n}`).toBe(0);
    expect(comboTier(Number.POSITIVE_INFINITY)).toBe(2);
  });

  it("never falls as stacks grow", () => {
    let last = 0;
    for (let n = -1; n <= 10; n += 0.01) {
      const tier = comboTier(n);
      expect(tier, `stacks ${n}`).toBeGreaterThanOrEqual(last);
      last = tier;
    }
  });
});

describe("comboProgress", () => {
  it("reports the stacks held, the tier reached and what the next tier needs", () => {
    expect(comboProgress(0)).toEqual({ stacks: 0, tier: 0, next: COMBO_TIER1_STACKS });
    expect(comboProgress(2.5)).toEqual({ stacks: 2.5, tier: 0, next: 3 });
    expect(comboProgress(3)).toEqual({ stacks: 3, tier: 1, next: COMBO_TIER2_STACKS });
    expect(comboProgress(4.9)).toEqual({ stacks: 4.9, tier: 1, next: 5 });
    expect(comboProgress(5)).toEqual({ stacks: 5, tier: 2, next: null });
    expect(comboProgress(12)).toEqual({ stacks: 12, tier: 2, next: null });
  });

  it("agrees with comboTier, and the next tier is always strictly more stacks than held", () => {
    for (let n = 0; n <= 8; n += 0.125) {
      const p = comboProgress(n);
      expect(p.tier).toBe(comboTier(n));
      if (p.next !== null) expect(p.next, `stacks ${n}`).toBeGreaterThan(n - 1e-6);
    }
  });
});

describe("COMBOS", () => {
  it("has exactly one spec per (stat, tier)", () => {
    expect(COMBOS).toHaveLength(6);
    for (const stat of BUFF_STATS) {
      for (const tier of [1, 2] as const) {
        expect(COMBOS.filter((c) => c.stat === stat && c.tier === tier), `${stat} tier ${tier}`).toHaveLength(1);
      }
    }
    expect(new Set(COMBOS.map((c) => c.id)).size).toBe(6);
    expect(new Set(COMBOS.map((c) => c.name)).size).toBe(6);
    for (const c of COMBOS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("follows the design sheet at 3 stacks: attack speed is a dash on kill, hp is a shield on kill", () => {
    const dash = COMBOS.find((c) => c.stat === "attackSpeed" && c.tier === 1)!;
    expect(dash.id).toBe("dash");
    expect(dash.onKill.bursts).toHaveLength(1);
    expect(dash.onKill.bursts[0]!.mult).toBeGreaterThan(1);
    expect(dash.onKill.shield).toBeNull();
    const shield = COMBOS.find((c) => c.stat === "hp" && c.tier === 1)!;
    expect(shield.id).toBe("shield");
    expect(shield.onKill.shield).not.toBeNull();
    expect(shield.onKill.bursts).toEqual([]);
  });

  it("has the tier-2 attack speed combo repeat tier 1's burst and add the cooldown reset", () => {
    const t1 = COMBOS.find((c) => c.stat === "attackSpeed" && c.tier === 1)!;
    const t2 = COMBOS.find((c) => c.stat === "attackSpeed" && c.tier === 2)!;
    expect(t2.onKill.bursts).toEqual(t1.onKill.bursts);
    expect(t1.onKill.resetCooldown).toBe(false);
    expect(t2.onKill.resetCooldown).toBe(true);
  });

  it("makes every tier-2 combo at least as strong as its tier 1, since it replaces it", () => {
    for (const stat of BUFF_STATS) {
      const t1 = COMBOS.find((c) => c.stat === stat && c.tier === 1)!.onKill;
      const t2 = COMBOS.find((c) => c.stat === stat && c.tier === 2)!.onKill;
      expect(t2.bursts.length, stat).toBeGreaterThanOrEqual(t1.bursts.length);
      t1.bursts.forEach((b, i) => {
        expect(t2.bursts[i]!.mult, `${stat} burst ${i} speed`).toBeGreaterThanOrEqual(b.mult);
        expect(t2.bursts[i]!.ms, `${stat} burst ${i} duration`).toBeGreaterThanOrEqual(b.ms);
      });
      if (t1.shield) {
        expect(t2.shield).not.toBeNull();
        expect(t2.shield!.share).toBeGreaterThanOrEqual(t1.shield.share);
        expect(t2.shield!.ms).toBeGreaterThanOrEqual(t1.shield.ms);
      }
      if (t1.resetCooldown) expect(t2.resetCooldown).toBe(true);
    }
  });

  it("doubles the hp shield at tier 2 ('the kill shield doubles')", () => {
    const t1 = COMBOS.find((c) => c.stat === "hp" && c.tier === 1)!.onKill.shield!;
    const t2 = COMBOS.find((c) => c.stat === "hp" && c.tier === 2)!.onKill.shield!;
    expect(t2.share).toBeCloseTo(2 * t1.share, 12);
  });

  // Phase 11 guesses the owner has to confirm (contract, "Guesses to report" 3): pinned so a retune is a deliberate edit.
  it("has the contract's numbers", () => {
    const by = (id: string) => COMBOS.find((c) => c.id === id)!;
    expect(by("dash").onKill).toEqual({ bursts: [{ mult: 2.5, ms: 400 }], shield: null, resetCooldown: false });
    expect(by("cascade").onKill).toEqual({ bursts: [{ mult: 2.5, ms: 400 }], shield: null, resetCooldown: true });
    expect(by("shield").onKill).toEqual({ bursts: [], shield: { share: 0.15, ms: 5000 }, resetCooldown: false });
    expect(by("bulwark").onKill).toEqual({ bursts: [], shield: { share: 0.3, ms: 8000 }, resetCooldown: false });
    expect(by("bloodrush").onKill).toEqual({ bursts: [{ mult: 1.5, ms: 3000 }], shield: null, resetCooldown: false });
    expect(by("frenzy").onKill).toEqual({ bursts: [{ mult: 1.8, ms: 5000 }], shield: null, resetCooldown: false });
  });
});

describe("comboFor and activeCombos", () => {
  it("returns no combo below 3 stacks, the tier-1 combo from 3 and the tier-2 combo from 5", () => {
    for (const stat of BUFF_STATS) {
      expect(comboFor(stat, 0)).toBeNull();
      expect(comboFor(stat, 2.999)).toBeNull();
      expect(comboFor(stat, -4)).toBeNull();
      expect(comboFor(stat, Number.NaN)).toBeNull();
      for (const n of [3, 3.5, 4.999]) {
        const c = comboFor(stat, n);
        expect(c, `${stat} ${n}`).toMatchObject({ stat, tier: 1 });
      }
      for (const n of [5, 6, 40]) {
        const c = comboFor(stat, n);
        expect(c, `${stat} ${n}`).toMatchObject({ stat, tier: 2 });
      }
    }
    expect(comboFor("attackSpeed", 3)!.id).toBe("dash");
    expect(comboFor("attackSpeed", 5)!.id).toBe("cascade");
    expect(comboFor("hp", 3)!.id).toBe("shield");
    expect(comboFor("hp", 5)!.id).toBe("bulwark");
    expect(comboFor("moveSpeed", 3)!.id).toBe("bloodrush");
    expect(comboFor("moveSpeed", 5)!.id).toBe("frenzy");
  });

  it("picks the highest tier only, so a tier-2 stat never also lists its tier-1 combo", () => {
    expect(activeCombos(stacksOf(8, 0, 0)).map((c) => c.id)).toEqual(["bulwark"]);
  });

  it("lists no combo for fresh stacks", () => {
    expect(activeCombos(zeroStacks())).toEqual([]);
    expect(activeCombos(stacksOf(2.9, 2.9, 2.9))).toEqual([]);
  });

  it("lists one combo per stat, in hp, attack speed, move speed order", () => {
    expect(activeCombos(stacksOf(3, 5, 2.9)).map((c) => c.id)).toEqual(["shield", "cascade"]);
    expect(activeCombos(stacksOf(3, 3, 3)).map((c) => c.id)).toEqual(["shield", "dash", "bloodrush"]);
    expect(activeCombos(stacksOf(5, 5, 5)).map((c) => c.id)).toEqual(["bulwark", "cascade", "frenzy"]);
  });

  it("never lists two combos for one stat, over 300 random sets of stacks", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const s = stacksOf(rng() * 8, rng() * 8, rng() * 8);
      const combos = activeCombos(s);
      expect(new Set(combos.map((c) => c.stat)).size).toBe(combos.length);
      for (const c of combos) expect(c.tier).toBe(comboTier(s[c.stat]));
      expect(combos.length).toBe(BUFF_STATS.filter((stat) => comboTier(s[stat]) > 0).length);
    }
  });
});

describe("killEffects", () => {
  const nothing = { bursts: [], shield: null, resetCooldown: false };

  it("is nothing below 3 stacks of every stat", () => {
    expect(killEffects(zeroStacks())).toEqual(nothing);
    expect(killEffects(stacksOf(2.99, 2.99, 2.99))).toEqual(nothing);
    expect(killEffects(stacksOf(-3, Number.NaN, 0))).toEqual(nothing);
  });

  it("gives each stat's combo alone", () => {
    expect(killEffects(stacksOf(0, 3, 0))).toEqual({ bursts: [{ mult: 2.5, ms: 400 }], shield: null, resetCooldown: false });
    expect(killEffects(stacksOf(3, 0, 0))).toEqual({ bursts: [], shield: { share: 0.15, ms: 5000 }, resetCooldown: false });
    expect(killEffects(stacksOf(0, 0, 3))).toEqual({ bursts: [{ mult: 1.5, ms: 3000 }], shield: null, resetCooldown: false });
  });

  it("resets the attack cooldown on the cascade only", () => {
    expect(killEffects(stacksOf(0, 3, 0)).resetCooldown).toBe(false);
    expect(killEffects(stacksOf(0, 4.99, 0)).resetCooldown).toBe(false);
    expect(killEffects(stacksOf(0, 5, 0)).resetCooldown).toBe(true);
    expect(killEffects(stacksOf(5, 2.9, 5)).resetCooldown).toBe(false);
  });

  it("upgrades a stat's effects at tier 2 instead of adding to tier 1's", () => {
    expect(killEffects(stacksOf(5, 0, 0)).shield).toEqual({ share: 0.3, ms: 8000 });
    expect(killEffects(stacksOf(0, 0, 5)).bursts).toEqual([{ mult: 1.8, ms: 5000 }]);
    expect(killEffects(stacksOf(0, 5, 0)).bursts).toEqual([{ mult: 2.5, ms: 400 }]);
  });

  it("merges stat by stat: bursts concatenate, the shield and the reset come from their own stat", () => {
    const three = killEffects(stacksOf(3, 3, 3));
    expect(three.bursts).toEqual([{ mult: 2.5, ms: 400 }, { mult: 1.5, ms: 3000 }]);
    expect(three.shield).toEqual({ share: 0.15, ms: 5000 });
    expect(three.resetCooldown).toBe(false);
    const five = killEffects(stacksOf(5, 5, 5));
    expect(five.bursts).toEqual([{ mult: 2.5, ms: 400 }, { mult: 1.8, ms: 5000 }]);
    expect(five.shield).toEqual({ share: 0.3, ms: 8000 });
    expect(five.resetCooldown).toBe(true);
    const mixed = killEffects(stacksOf(5, 3, 0));
    expect(mixed.bursts).toEqual([{ mult: 2.5, ms: 400 }]);
    expect(mixed.shield).toEqual({ share: 0.3, ms: 8000 });
  });

  it("equals the union of the active combos' effects", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const s = stacksOf(rng() * 7, rng() * 7, rng() * 7);
      const combos = activeCombos(s);
      const fx = killEffects(s);
      expect(fx.bursts).toEqual(combos.flatMap((c) => c.onKill.bursts));
      expect(fx.resetCooldown).toBe(combos.some((c) => c.onKill.resetCooldown));
      const shares = combos.flatMap((c) => (c.onKill.shield ? [c.onKill.shield.share] : []));
      expect(fx.shield?.share ?? null).toBe(shares.length ? Math.max(...shares) : null);
    }
  });

  it("hands out a fresh bursts list, so a caller cannot change the catalog through it", () => {
    const a = killEffects(stacksOf(0, 5, 5));
    a.bursts.length = 0;
    a.bursts.push({ mult: 99, ms: 1 });
    expect(killEffects(stacksOf(0, 5, 5)).bursts).toEqual([{ mult: 2.5, ms: 400 }, { mult: 1.8, ms: 5000 }]);
  });
});

describe("rewardCurve against the GAME_DESIGN 12.3 table", () => {
  it.each(REWARD_TABLE)("feed %s pays x%s (within 0.01)", (feed, want) => {
    expect(Math.abs(rewardCurve(feed) - want)).toBeLessThanOrEqual(0.01);
  });

  it("never goes below 30%, however fed, and never above 100%", () => {
    for (const feed of [-1000, -50, -1, 0, 5, 10, 15, 30, 100, 1e6, Number.POSITIVE_INFINITY]) {
      expect(rewardCurve(feed), `feed ${feed}`).toBeGreaterThanOrEqual(REWARD_FLOOR);
      expect(rewardCurve(feed), `feed ${feed}`).toBeLessThanOrEqual(1);
    }
  });

  it("is half way between 1 and the floor at a feed of REWARD_MID", () => {
    expect(rewardCurve(REWARD_MID)).toBeCloseTo((1 + REWARD_FLOOR) / 2, 12);
  });

  it("never rises as the feed grows, and falls most steeply around the middle", () => {
    let last = Infinity;
    for (let feed = -5; feed <= 30; feed += 0.1) {
      const r = rewardCurve(feed);
      expect(r, `feed ${feed}`).toBeLessThanOrEqual(last);
      last = r;
    }
    const drop = (a: number) => rewardCurve(a) - rewardCurve(a + 1);
    expect(drop(4)).toBeGreaterThan(drop(0));
    expect(drop(4)).toBeGreaterThan(drop(9));
  });

  it("flattens to the floor for a very fed player and to the full reward for a starving one", () => {
    expect(rewardCurve(25)).toBeCloseTo(REWARD_FLOOR, 3);
    expect(rewardCurve(-25)).toBeCloseTo(1, 3);
  });
});

describe("median", () => {
  it("takes the middle value of an odd count", () => {
    expect(median([7])).toBe(7);
    expect(median([1, 2, 3])).toBe(2);
    expect(median([5, 1, 3, 9, 7])).toBe(5);
  });

  it("takes the mean of the middle two of an even count", () => {
    expect(median([1, 2])).toBe(1.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([0, 0, 0, 3])).toBe(0);
    expect(median([2, 2, 2, 2])).toBe(2);
  });

  it("is 0 for no values", () => {
    expect(median([])).toBe(0);
  });

  it("sorts numerically, not as text", () => {
    expect(median([10, 9, 100, 1])).toBe(9.5);
    expect(median([10, 9, 100])).toBe(10);
    expect(median([-3, -1, -2])).toBe(-2);
  });

  it("does not reorder or change its input, frozen or not", () => {
    const values = [9, 1, 5, 3];
    expect(median(values)).toBe(4);
    expect(values).toEqual([9, 1, 5, 3]);
    expect(median(Object.freeze([9, 1, 5]))).toBe(5);
  });

  it("matches a brute-force reference over 200 seeded lists", () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rng() * 9);
      const values = Array.from({ length: n }, () => Math.round(rng() * 40) / 4);
      const sorted = [...values].sort((a, b) => a - b);
      const want = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
      expect(median(values), values.join(",")).toBe(want);
    }
  });
});

describe("catchUpMultiplier", () => {
  it("is x1.25 only for a feed strictly more than 2 below the median", () => {
    expect(catchUpMultiplier(4, 6)).toBe(1); // exactly 2 below
    expect(catchUpMultiplier(3.99, 6)).toBe(1.25); // 2.01 below
    expect(catchUpMultiplier(0, 3)).toBe(1.25);
    expect(catchUpMultiplier(0, 2)).toBe(1); // exactly 2 below, at the bottom
    expect(catchUpMultiplier(0, 2.01)).toBe(1.25);
  });

  it("is 1 at, near and above the median", () => {
    expect(catchUpMultiplier(5, 5)).toBe(1);
    expect(catchUpMultiplier(4.5, 5)).toBe(1);
    expect(catchUpMultiplier(9, 5)).toBe(1);
    expect(catchUpMultiplier(0, 0)).toBe(1);
  });

  it("only ever returns 1 or CATCHUP_MULT, and leaves a lobby with no leader alone", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 300; i++) {
      const feed = Math.round(rng() * 40) / 4;
      const med = Math.round(rng() * 40) / 4;
      const m = catchUpMultiplier(feed, med);
      expect([1, CATCHUP_MULT]).toContain(m);
      expect(m === CATCHUP_MULT).toBe(med - feed > CATCHUP_GAP);
    }
  });
});

describe("mobRewardMultiplier", () => {
  it("is the reward curve times the catch-up", () => {
    for (let feed = 0; feed <= 10; feed += 0.5) {
      for (let med = 0; med <= 12; med += 1.5) {
        const behind = med - feed > 2;
        expect(mobRewardMultiplier(feed, med), `feed ${feed} median ${med}`).toBeCloseTo(rewardCurve(feed) * (behind ? 1.25 : 1), 12);
      }
    }
  });

  it("pays more than a full reward to a starving player far behind the lobby, and the plain curve otherwise", () => {
    expect(mobRewardMultiplier(0, 3)).toBeCloseTo(rewardCurve(0) * 1.25, 12);
    expect(mobRewardMultiplier(0, 3)).toBeGreaterThan(1);
    expect(mobRewardMultiplier(0, 0)).toBe(rewardCurve(0));
    expect(mobRewardMultiplier(6, 6)).toBe(rewardCurve(6));
  });

  it("never drops below the floor", () => {
    for (let feed = 0; feed <= 40; feed += 2) expect(mobRewardMultiplier(feed, feed + 10)).toBeGreaterThanOrEqual(REWARD_FLOOR);
  });
});

describe("bountyStacks", () => {
  it("is half the victim's stacks, fractions and all", () => {
    expect(bountyStacks(0)).toBe(0);
    expect(bountyStacks(4)).toBe(2);
    expect(bountyStacks(3)).toBe(1.5);
    expect(bountyStacks(1.3)).toBeCloseTo(0.65, 12);
    expect(bountyStacks(7.25)).toBe(3.625);
  });

  it("splits a victim's stacks exactly in two", () => {
    for (const n of [0.5, 1, 2.7, 3, 5, 11.1]) expect(n - bountyStacks(n)).toBeCloseTo(bountyStacks(n), 12);
  });
});

describe("REGION_BUFF", () => {
  it("has an entry for every faction, and each entry is a buff stat", () => {
    expect(Object.keys(REGION_BUFF).sort()).toEqual([...FACTION_IDS].sort());
    for (const id of FACTION_IDS) expect(BUFF_STATS).toContain(REGION_BUFF[id]);
  });

  it("is the contract's map, and every stat is some region's own", () => {
    expect(REGION_BUFF).toEqual({ fire: "attackSpeed", sentenced: "moveSpeed", plague: "hp", frost: "hp", holy: "attackSpeed" });
    expect(new Set(Object.values(REGION_BUFF))).toEqual(new Set(BUFF_STATS));
  });
});

describe("rollBuffStat", () => {
  it("consumes exactly one random() call", () => {
    for (const region of FACTION_IDS) {
      for (const r of [0, 0.3, 0.59, 0.6, 0.7, 0.9, 0.999999]) {
        let calls = 0;
        rollBuffStat(region, () => { calls++; return r; });
        expect(calls, `${region} r ${r}`).toBe(1);
      }
    }
    const rng = mulberry32(1);
    let calls = 0;
    const counted = () => { calls++; return rng(); };
    for (let i = 0; i < 25; i++) rollBuffStat("holy", counted);
    expect(calls).toBe(25);
  });

  it("gives the region's own stat for r < 0.6", () => {
    for (const region of FACTION_IDS) {
      for (const r of [0, 0.01, 0.3, 0.5, 0.59, 0.5999999]) {
        expect(rollBuffStat(region, () => r), `${region} r ${r}`).toBe(REGION_BUFF[region]);
      }
    }
  });

  it("gives the two other stats for the rest of the range, in equal halves", () => {
    for (const region of FACTION_IDS) {
      const own = REGION_BUFF[region];
      const lowerHalf = [0.6, 0.65, 0.7, 0.79].map((r) => rollBuffStat(region, () => r));
      const upperHalf = [0.81, 0.9, 0.95, 0.999999].map((r) => rollBuffStat(region, () => r));
      expect(new Set(lowerHalf).size, `${region} lower half`).toBe(1);
      expect(new Set(upperHalf).size, `${region} upper half`).toBe(1);
      expect(lowerHalf[0], region).not.toBe(own);
      expect(upperHalf[0], region).not.toBe(own);
      expect(lowerHalf[0], region).not.toBe(upperHalf[0]);
      expect(new Set([own, lowerHalf[0], upperHalf[0]]), region).toEqual(new Set(BUFF_STATS));
    }
  });

  it("is deterministic for a seed", () => {
    const run = (seed: number) => {
      const rng = mulberry32(seed);
      return Array.from({ length: 50 }, () => rollBuffStat("plague", rng));
    };
    expect(run(8)).toEqual(run(8));
    expect(run(8)).not.toEqual(run(9));
  });

  it("is close to 60 / 20 / 20 for every region over 10000 seeded draws", () => {
    const N = 10_000;
    FACTION_IDS.forEach((region, i) => {
      const rng = mulberry32(1000 + i);
      const counts: Record<BuffStat, number> = { hp: 0, attackSpeed: 0, moveSpeed: 0 };
      for (let n = 0; n < N; n++) counts[rollBuffStat(region, rng)]++;
      const own = REGION_BUFF[region];
      expect(Math.abs(counts[own] / N - 0.6), `${region} own`).toBeLessThan(0.03);
      for (const stat of BUFF_STATS.filter((s) => s !== own)) {
        expect(Math.abs(counts[stat] / N - 0.2), `${region} ${stat}`).toBeLessThan(0.03);
      }
    });
  });

  it("is a stat the game knows, for any random() inside [0, 1)", () => {
    const rng = mulberry32(77);
    for (let i = 0; i < 500; i++) {
      const region: FactionId = FACTION_IDS[i % FACTION_IDS.length]!;
      expect(BUFF_STATS).toContain(rollBuffStat(region, rng));
    }
  });
});

describe("the bounty and feed it pairs with (GAME_DESIGN 12.4)", () => {
  it.each(BOUNTY_TABLE)("feed %s is worth a %s GV bounty", (feed, gv) => {
    expect(bountyFor(feed)).toBe(gv);
  });

  it("pays nothing at a feed of 2 or less", () => {
    for (const feed of [0, 1, 2]) expect(bountyFor(feed)).toBe(0);
  });

  it("can out-pay a win: 52 GV at feed 5 against the win bonus", () => {
    expect(bountyFor(5)).toBeGreaterThan(GV_WIN);
  });

  it("lets mob kills lift the bounty a quarter-kill at a time", () => {
    expect(bountyFor(feedScore(3, 0))).toBe(10);
    expect(bountyFor(feedScore(0, 20))).toBe(52); // 20 mobs = feed 5
  });
});
