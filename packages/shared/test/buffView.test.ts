import { describe, expect, it } from "vitest";
import {
  barrierStrength, BUFF_LABELS, BUFF_STATS, buffBonus, buffRow, buffRows, buffToast, catchUpMultiplier, comboById, COMBOS,
  comboToast, feedView, formatBonus, formatGain, formatMult, formatStacks, hasAnyStacks, hpBarFractions, hpText,
  lobbyMedianFeed, MAX_BARRIER_SHARE, mobRewardMultiplier, rewardCurve, stacksOfPlayer, zeroStacks, type Stacks,
} from "../src/index";

const stacksOf = (hp = 0, attackSpeed = 0, moveSpeed = 0): Stacks => ({ hp, attackSpeed, moveSpeed });

describe("formatStacks", () => {
  it("shows one decimal, to the nearest tenth", () => {
    expect(formatStacks(0)).toBe("0.0");
    expect(formatStacks(1.1)).toBe("1.1");
    expect(formatStacks(1.078)).toBe("1.1");
    expect(formatStacks(2.156)).toBe("2.2");
    expect(formatStacks(1.04)).toBe("1.0");
    expect(formatStacks(3.2)).toBe("3.2");
    expect(formatStacks(5.04)).toBe("5.0");
    expect(formatStacks(7.46)).toBe("7.5");
  });

  it("reads a drop and the total it makes alike: nothing plus 1.078 is +1.1 and 1.1", () => {
    expect(formatGain(1.078)).toBe(formatStacks(1.078));
    expect(formatGain(1.078 * 2)).toBe(formatStacks(1.078 * 2));
  });

  it("never rounds up onto a combo threshold it has not reached", () => {
    expect(formatStacks(2.96)).toBe("2.9");
    expect(formatStacks(2.99)).toBe("2.9");
    expect(formatStacks(2.9999)).toBe("2.9");
    expect(formatStacks(4.97)).toBe("4.9");
    expect(formatStacks(4.99999)).toBe("4.9");
    expect(formatStacks(3)).toBe("3.0");
    expect(formatStacks(4.96)).toBe("4.9");
  });

  it("never reads 3.0 or 5.0 before the combo that threshold unlocks", () => {
    for (const stat of BUFF_STATS) {
      for (let n = 0; n <= 6; n += 0.01) {
        const text = formatStacks(n);
        const row = buffRow(stat, n);
        if (text === "3.0") expect(row.tier, `${n}`).toBeGreaterThanOrEqual(1);
        if (text === "5.0") expect(row.tier, `${n}`).toBe(2);
      }
    }
  });

  it("reads 3.0 for the float noise that still unlocks the combo", () => {
    expect(formatStacks(1.1 * 3 - 0.3)).toBe("3.0");
    expect(formatStacks(Math.fround(2.9999998))).toBe("3.0");
  });

  it("copes with junk", () => {
    expect(formatStacks(-1)).toBe("0.0");
    expect(formatStacks(Number.NaN)).toBe("0.0");
  });
});

describe("the small formatters", () => {
  it("rounds a gain to the nearest tenth", () => {
    expect(formatGain(1.1)).toBe("1.1");
    expect(formatGain(1.067)).toBe("1.1");
    expect(formatGain(0.33)).toBe("0.3");
    expect(formatGain(2.2)).toBe("2.2");
  });

  it("writes a bonus as a whole percent and a multiplier with two decimals", () => {
    expect(formatBonus(0.23)).toBe("+23%");
    expect(formatBonus(0)).toBe("+0%");
    expect(formatBonus(-1)).toBe("+0%");
    expect(formatMult(0.85)).toBe("x0.85");
    expect(formatMult(1.0625)).toBe("x1.06");
  });
});

describe("buffRow", () => {
  it("labels the stat, gives the bonus from the S-curve and the progress to the first combo", () => {
    const row = buffRow("attackSpeed", 1.5);
    expect(row.label).toBe("Attack speed");
    expect(row.stacksText).toBe("1.5");
    expect(row.bonus).toBeCloseTo(buffBonus("attackSpeed", 1.5), 12);
    expect(row.bonusText).toBe(formatBonus(buffBonus("attackSpeed", 1.5)));
    expect(row.tier).toBe(0);
    expect(row.next).toBe(3);
    expect(row.progress).toBeCloseTo(0.5, 12);
    expect(row.combo).toBeNull();
  });

  it("shows the design bonus at three stacks (+32% hp, +23% attack speed, +14% move speed)", () => {
    expect(buffRow("hp", 3).bonusText).toBe("+32%");
    expect(buffRow("attackSpeed", 3).bonusText).toBe("+23%");
    expect(buffRow("moveSpeed", 3).bonusText).toBe("+14%");
  });

  it("names the combo once reached and aims the bar at the second tier", () => {
    const at3 = buffRow("attackSpeed", 3.2);
    expect(at3.tier).toBe(1);
    expect(at3.combo?.name).toBe("Dash on kill");
    expect(at3.next).toBe(5);
    expect(at3.progress).toBeCloseTo(3.2 / 5, 12);
    expect(buffRow("hp", 3).combo?.id).toBe("shield");
    expect(buffRow("moveSpeed", 4.9).combo?.id).toBe("bloodrush");
  });

  it("is full at the top, with the tier-2 combo", () => {
    for (const [stat, id] of [["attackSpeed", "cascade"], ["hp", "bulwark"], ["moveSpeed", "frenzy"]] as const) {
      const row = buffRow(stat, 7.5);
      expect(row.tier).toBe(2);
      expect(row.next).toBeNull();
      expect(row.progress).toBe(1);
      expect(row.combo?.id).toBe(id);
    }
  });

  it("treats float noise just under a threshold as reached, like the server's combo check", () => {
    expect(buffRow("hp", 3 - 5e-7).tier).toBe(1);
    expect(buffRow("hp", 3 - 5e-5).tier).toBe(0);
  });

  it("is empty for no, negative or NaN stacks", () => {
    for (const n of [0, -2, Number.NaN]) {
      const row = buffRow("moveSpeed", n);
      expect([row.stacks, row.bonus, row.progress, row.tier]).toEqual([0, 0, 0, 0]);
      expect(row.combo).toBeNull();
    }
  });
});

describe("buffRows and hasAnyStacks", () => {
  it("lists Max HP, Attack speed, Move speed in that order", () => {
    expect(buffRows(stacksOf(1, 2, 3)).map((r) => r.label)).toEqual(["Max HP", "Attack speed", "Move speed"]);
    expect(buffRows(stacksOf(1, 2, 3)).map((r) => r.stacks)).toEqual([1, 2, 3]);
    expect(Object.values(BUFF_LABELS)).toHaveLength(BUFF_STATS.length);
  });

  it("is false only while every stat is at 0", () => {
    expect(hasAnyStacks(zeroStacks())).toBe(false);
    expect(hasAnyStacks(stacksOf(0, 0, 0.1))).toBe(true);
    expect(hasAnyStacks(stacksOf(1e-6, 0, 0))).toBe(true);
  });

  it("reads a player's three float fields", () => {
    expect(stacksOfPlayer({ stacksHp: 1, stacksAs: 2, stacksMs: 3 })).toEqual({ hp: 1, attackSpeed: 2, moveSpeed: 3 });
  });
});

describe("toasts", () => {
  it("says what dropped and the new total", () => {
    expect(buffToast("attackSpeed", 1.1, 3.2)).toBe("+1.1 Attack speed (3.2)");
    expect(buffToast("hp", 2.2, 2.2)).toBe("+2.2 Max HP (2.2)");
    expect(buffToast("moveSpeed", 0.33, 1.4)).toBe("+0.3 Move speed (1.4)");
  });

  it("does not choke on a stat from newer server content", () => {
    expect(buffToast("luck", 1, 1)).toBe("+1.0 luck (1.0)");
  });

  it("announces a combo by its catalog name, and every combo id resolves", () => {
    expect(comboToast(comboById("dash")!)).toBe("Combo unlocked: Dash on kill");
    expect(comboToast(comboById("frenzy")!)).toBe("Combo unlocked: Frenzy run");
    for (const c of COMBOS) expect(comboById(c.id)).toBe(c);
    expect(comboById("nope")).toBeUndefined();
  });
});

describe("feedView", () => {
  it("writes the feed score and the mob reward multiplier", () => {
    // 2 kills + 2 mobs / 4 = 2.5; a lone player: the median is their own feed, so no catch-up.
    const v = feedView(2, 2, 2.5);
    expect(v.feed).toBe(2.5);
    expect(v.feedText).toBe("2.5");
    expect(v.reward).toBeCloseTo(rewardCurve(2.5), 12);
    expect(v.catchUp).toBe(false);
    expect(v.line).toBe(`Feed 2.5 (kills + mobs/4) · mobs pay ${formatMult(rewardCurve(2.5))}`);
  });

  it("matches the GAME_DESIGN 12.3 table", () => {
    expect(feedView(3, 0, 3).line).toContain("x0.85");
    expect(feedView(0, 0, 0).line).toContain("x0.98");
    expect(feedView(5, 0, 5).line).toContain("x0.65");
    expect(feedView(10, 0, 10).line).toContain("x0.32");
  });

  it("trims the feed text and keeps quarters exact", () => {
    expect(feedView(3, 0, 3).feedText).toBe("3");
    expect(feedView(2, 1, 2).feedText).toBe("2.25");
    expect(feedView(0, 3, 0).feedText).toBe("0.75");
  });

  it("flags the catch-up bonus only when more than 2 behind the lobby median", () => {
    const behind = feedView(0, 0, 3);
    expect(behind.catchUp).toBe(true);
    expect(behind.reward).toBeCloseTo(mobRewardMultiplier(0, 3), 12);
    expect(behind.reward).toBeCloseTo(rewardCurve(0) * 1.25, 12);
    expect(behind.line).toMatch(/\(catch-up\)$/);
    // exactly 2 behind is not "more than"
    expect(feedView(1, 0, 3).catchUp).toBe(false);
    expect(catchUpMultiplier(1, 3)).toBe(1);
  });
});

describe("lobbyMedianFeed", () => {
  it("is the median feed of the players alive, as the server counts it", () => {
    const players = [
      { status: "alive", kills: 0, mobKills: 0 },
      { status: "alive", kills: 2, mobKills: 0 },
      { status: "alive", kills: 6, mobKills: 4 },
      { status: "dead", kills: 9, mobKills: 9 },
      { status: "mia", kills: 9, mobKills: 9 },
    ];
    expect(lobbyMedianFeed(players)).toBe(2);
  });

  it("counts a mob kill as a quarter of a kill: they decide the median here", () => {
    // Feeds 0, 3 (1 + 8 / 4), 2: the median is 2. Counting player kills only it would be 1; adding the mobs of the dead and the MIA, 3.
    const odd = [
      { status: "alive", kills: 0, mobKills: 0 },
      { status: "alive", kills: 1, mobKills: 8 },
      { status: "alive", kills: 2, mobKills: 0 },
      { status: "dead", kills: 0, mobKills: 40 },
      { status: "mia", kills: 0, mobKills: 40 },
    ];
    expect(lobbyMedianFeed(odd)).toBe(2);
    // Four alive: the mean of the middle two, 2 and 3 -> 2.5 (kills alone: 0, 0, 1, 2 -> 0.5).
    expect(lobbyMedianFeed([...odd.slice(0, 3), { status: "alive", kills: 0, mobKills: 12 }])).toBe(2.5);
  });

  it("is 0 for nobody", () => {
    expect(lobbyMedianFeed([])).toBe(0);
    expect(lobbyMedianFeed([{ status: "dead", kills: 3, mobKills: 0 }])).toBe(0);
  });
});

describe("the kill barrier", () => {
  it("is full at the biggest combo shield and proportional below it", () => {
    expect(MAX_BARRIER_SHARE).toBeCloseTo(0.3, 12);
    expect(barrierStrength(150, 500)).toBe(1);
    expect(barrierStrength(75, 500)).toBeCloseTo(0.5, 12);
    expect(barrierStrength(9999, 500)).toBe(1);
    expect(barrierStrength(0, 500)).toBe(0);
    expect(barrierStrength(10, 0)).toBe(0);
    expect(barrierStrength(Number.NaN, 500)).toBe(0);
  });

  it("splits the hp bar into hp and barrier shares of max hp", () => {
    expect(hpBarFractions(400, 500, 0)).toEqual({ hp: 0.8, barrier: 0 });
    const a = hpBarFractions(250, 500, 75);
    expect(a.hp).toBeCloseTo(0.5, 12);
    expect(a.barrier).toBeCloseTo(0.15, 12);
  });

  it("shrinks both segments when hp plus the barrier is more than max hp", () => {
    const a = hpBarFractions(500, 500, 100);
    expect(a.hp + a.barrier).toBeCloseTo(1, 12);
    expect(a.hp).toBeCloseTo(500 / 600, 12);
    expect(a.barrier).toBeCloseTo(100 / 600, 12);
  });

  it("is 0 for nothing and survives junk", () => {
    expect(hpBarFractions(0, 0, 0)).toEqual({ hp: 0, barrier: 0 });
    expect(hpBarFractions(-5, 100, -5)).toEqual({ hp: 0, barrier: 0 });
    expect(hpBarFractions(Number.NaN, 100, Number.NaN)).toEqual({ hp: 0, barrier: 0 });
  });

  it("writes the hp readout with the shield when there is one", () => {
    expect(hpText(400, 500, 0)).toBe("HP 400/500");
    expect(hpText(399.2, 500, 74.3)).toBe("HP 400/500 +75 shield");
    expect(hpText(400, 500, 0.0001)).toBe("HP 400/500 +1 shield");
    expect(hpText(400, 500, -3)).toBe("HP 400/500");
  });
});
