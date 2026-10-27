import { describe, expect, it } from "vitest";
import {
  BOUNTY_STACK_SHARE, bountyFor, bountyStacks, BUFF_PLATEAU, BUFF_REF_STACKS, BUFF_S0, BUFF_W, buffCurve, buffRowsOf, buffScale,
  buffText, CATCHUP_GAP, CATCHUP_MULT, catchUpMultiplier, effectsText, effectText, feedScore, GV_WIN, LIFESTEAL_MAX, LS_CAP,
  median, mobRewardMultiplier, mulberry32, REWARD_FLOOR, REWARD_MID, REWARD_WIDTH, rewardCurve, scaleEffect, stacksIn,
  type Effect,
} from "../src/index";
import * as shared from "../src/index";
import { PlayerState } from "../src/schema";

/** GAME_DESIGN 12.3: [feed, mob reward multiplier]. */
const REWARD_TABLE: Array<[number, number]> = [
  [0, 0.98], [2, 0.92], [3, 0.85], [4, 0.76], [5, 0.65], [6, 0.54], [7, 0.45], [8, 0.38], [10, 0.32],
];

/** GAME_DESIGN 12.4: [feed, bounty GV]. */
const BOUNTY_TABLE: Array<[number, number]> = [[3, 10], [4, 28], [5, 52], [6, 80], [7, 112], [8, 147], [10, 226]];

describe("the tunables the buff formulas read", () => {
  it("are the design numbers", () => {
    expect([BUFF_S0, BUFF_W, BUFF_REF_STACKS]).toEqual([3, 1, 3]);
    expect([LS_CAP, LIFESTEAL_MAX]).toEqual([0.25, 1]);
    expect([REWARD_FLOOR, REWARD_MID, REWARD_WIDTH]).toEqual([0.3, 5, 1.5]);
    expect([CATCHUP_GAP, CATCHUP_MULT, BOUNTY_STACK_SHARE]).toEqual([2, 1.25, 0.5]);
  });

  it("are reachable from the shared index, with the formulas", () => {
    expect(shared.buffScale).toBe(buffScale);
    expect(shared.buffRows).toBeTypeOf("function");
    expect(shared.rewardCurve).toBe(rewardCurve);
    expect(shared.BUFFS).toHaveLength(20);
  });

  it("no longer export the three-stat stacks, the combos or the region roll", () => {
    for (const gone of ["buffBonus", "buffMultiplier", "BUFF_STATS", "COMBOS", "comboTier", "killEffects", "REGION_BUFF", "rollBuffStat"]) {
      expect(gone in shared, gone).toBe(false);
    }
  });
});

// The curve's own numbers (S(x), 0.16x at 1 stack ... 2.1x plateau) are pinned in buffsRoguelike.test.ts; these are its
// shape, which the three-stat bonus used to be tested for.
describe("the S-curve", () => {
  it("is exactly 0 at 0 stacks, and for negative, NaN and -Infinity stacks", () => {
    for (const n of [0, -0, -1, -0.5, -1000, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(buffCurve(n), `curve ${n}`).toBe(0);
      expect(buffScale(n), `scale ${n}`).toBe(0);
    }
  });

  it("is S(n) / S(3): 1 at the quoted 3 stacks, whatever the buff", () => {
    expect(buffScale(BUFF_REF_STACKS)).toBe(1);
    for (const n of [0.5, 1, 2, 4, 5.5, 9]) expect(buffScale(n), `${n}`).toBeCloseTo(buffCurve(n) / buffCurve(3), 12);
    expect(BUFF_PLATEAU).toBeCloseTo(buffCurve(1e6) / buffCurve(3), 12);
  });

  it("grows from the very first sliver of a stack", () => {
    expect(buffCurve(1e-6)).toBeGreaterThan(0);
    expect(buffScale(1e-6)).toBeGreaterThan(0);
  });

  it("strictly increases with stacks, fractions included", () => {
    let last = 0;
    for (let n = 0.25; n <= 20; n += 0.25) {
      const k = buffScale(n);
      expect(k, `${n}`).toBeGreaterThan(last);
      last = k;
    }
  });

  it("stays below the plateau and flattens out towards it", () => {
    for (const n of [1, 3, 5, 8, 12, 20]) expect(buffScale(n), `${n}`).toBeLessThan(BUFF_PLATEAU);
    for (const n of [50, 1000, Number.POSITIVE_INFINITY]) expect(buffScale(n), `${n}`).toBeLessThanOrEqual(BUFF_PLATEAU);
    // 30 more stacks after 8 add well under a hundredth of a quoted value.
    expect(buffScale(38) - buffScale(8)).toBeLessThan(0.02);
    expect(buffScale(38)).toBeGreaterThan(0.99 * BUFF_PLATEAU);
  });

  it("spikes in the middle: the biggest per-stack gain is between 2 and 4 stacks", () => {
    const gains = Array.from({ length: 9 }, (_, n) => buffScale(n + 1) - buffScale(n));
    const best = Math.max(...gains);
    const at = gains.indexOf(best);
    expect([2, 3], `gains ${gains.map((g) => g.toFixed(3)).join(" ")}`).toContain(at);
    // 2->3 and 3->4 beat the first stack by a wide margin and the 5th stack too.
    expect(gains[2]).toBeGreaterThan(2 * gains[0]!);
    expect(gains[3]).toBeGreaterThan(2 * gains[0]!);
    expect(gains[3]).toBeGreaterThan(gains[4]!);
    expect(gains[1]).toBeLessThan(gains[2]!);
  });

  it("also peaks inside (2, 4) when stacks are fractional", () => {
    let best = 0;
    let bestAt = 0;
    for (let n = 0; n < 10; n += 0.05) {
      const g = buffScale(n + 0.05) - buffScale(n);
      if (g > best) { best = g; bestAt = n; }
    }
    expect(bestAt).toBeGreaterThan(2);
    expect(bestAt).toBeLessThan(4);
  });
});

describe("stacksIn", () => {
  it("reads a Map, a plain record and a player's synced buffs map", () => {
    const p = new PlayerState();
    p.buffs.set("emberImp", 2.5);
    expect(stacksIn(p.buffs, "emberImp")).toBe(2.5);
    expect(stacksIn(new Map([["emberImp", 2.5]]), "emberImp")).toBe(2.5);
    expect(stacksIn({ emberImp: 2.5 }, "emberImp")).toBe(2.5);
  });

  it("is 0 for none held, an id that is not there and no map at all (a state from a server without buffs)", () => {
    expect(stacksIn(null, "emberImp")).toBe(0);
    expect(stacksIn(undefined, "emberImp")).toBe(0);
    expect(stacksIn(new PlayerState().buffs, "emberImp")).toBe(0);
    expect(stacksIn({}, "emberImp")).toBe(0);
    expect(stacksIn(new Map<string, number>(), "emberImp")).toBe(0);
  });

  it("is 0 for a bad value: zero, negative, NaN, text, and names an Object has", () => {
    const bad = { zero: 0, neg: -2, nan: Number.NaN, text: "3" as unknown as number };
    for (const id of Object.keys(bad)) expect(stacksIn(bad, id), id).toBe(0);
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(stacksIn({}, id), id).toBe(0);
  });
});

describe("buffRowsOf for ids and stacks it cannot give rows for", () => {
  it("is empty for an unknown id and for no, negative or NaN stacks", () => {
    expect(buffRowsOf("nope", 3)).toEqual([]);
    for (const n of [0, -1, Number.NaN]) expect(buffRowsOf("emberImp", n), `${n}`).toEqual([]);
  });
});

describe("scaleEffect", () => {
  const rows: Array<[string, Effect, Effect]> = [
    ["stat", { k: "stat", stat: "attackSpeed", v: 0.1 }, { k: "stat", stat: "attackSpeed", v: 0.2 }],
    ["flat", { k: "flat", stat: "armor", v: 10 }, { k: "flat", stat: "armor", v: 20 }],
    ["vs", { k: "vs", test: "hpBelow", arg: 0.3, v: 0.15 }, { k: "vs", test: "hpBelow", arg: 0.3, v: 0.3 }],
    [
      "while", { k: "while", cond: "chasingLock", arg: 0, stat: "moveSpeed", v: 0.05, ms: 800 },
      { k: "while", cond: "chasingLock", arg: 0, stat: "moveSpeed", v: 0.1, ms: 800 },
    ],
    ["scale", { k: "scale", src: "ownMissingHp", per: 0.01, step: 0.1 }, { k: "scale", src: "ownMissingHp", per: 0.02, step: 0.1 }],
    [
      "onHit", { k: "onHit", status: "dot", per: 2, cap: 1, ms: 3000, needs: "status" },
      { k: "onHit", status: "dot", per: 4, cap: 1, ms: 3000, needs: "status" },
    ],
    [
      "trigger heal", { k: "trigger", on: "hpBelow", arg: 0.3, once: true, do: { do: "heal", share: 0.1, ignoreLockout: true } },
      { k: "trigger", on: "hpBelow", arg: 0.3, once: true, do: { do: "heal", share: 0.2, ignoreLockout: true } },
    ],
    [
      "trigger barrier", { k: "trigger", on: "kill", arg: 0, do: { do: "barrier", share: 0.1, ms: 4000 } },
      { k: "trigger", on: "kill", arg: 0, do: { do: "barrier", share: 0.2, ms: 4000 } },
    ],
    [
      "trigger status", { k: "trigger", on: "hitTaken", arg: 0, do: { do: "status", to: "target", status: "slowAttack", ms: 1000, value: 0.1 } },
      { k: "trigger", on: "hitTaken", arg: 0, do: { do: "status", to: "target", status: "slowAttack", ms: 1000, value: 0.2 } },
    ],
  ];

  it.each(rows)("doubles a %s row's numbers and nothing else", (_kind, row, doubled) => {
    expect(scaleEffect(row, 2)).toEqual(doubled);
  });

  it("leaves a status trigger with no value, a cleanse and a cooldown as they are", () => {
    const unchanged: Effect[] = [
      { k: "trigger", on: "kill", arg: 0, do: { do: "status", to: "self", status: "haste", ms: 2000 } },
      { k: "trigger", on: "hpBelow", arg: 0.3, do: { do: "cleanse", to: "self", classes: ["soft"] } },
      { k: "trigger", on: "kill", arg: 0, do: { do: "cooldown", ms: 2000 } },
    ];
    for (const row of unchanged) expect(scaleEffect(row, 3)).toEqual(row);
  });

  it("keeps a row's `requires` and `needs`, and never changes the row it was given", () => {
    const row: Effect = { k: "stat", stat: "damage", v: 0.1, requires: ["glassFang"], needs: "status" };
    expect(scaleEffect(row, 0.5)).toEqual({ k: "stat", stat: "damage", v: 0.05, requires: ["glassFang"], needs: "status" });
    expect(row).toEqual({ k: "stat", stat: "damage", v: 0.1, requires: ["glassFang"], needs: "status" });
  });

  it("makes a row's numbers 0 at 0 stacks (buffText of nothing held reads +0%)", () => {
    expect(scaleEffect({ k: "stat", stat: "damage", v: 0.05 }, 0)).toEqual({ k: "stat", stat: "damage", v: 0 });
    expect(buffText("emberImp", 0)).toBe("+0% damage");
  });
});

describe("effectText", () => {
  it("writes a stat row with its sign: fractions as percent, one decimal at most", () => {
    expect(effectText({ k: "stat", stat: "damageTaken", v: -0.1 })).toBe("-10% damage taken");
    expect(effectText({ k: "stat", stat: "windup", v: -0.08 })).toBe("-8% windup time");
    expect(effectText({ k: "stat", stat: "healTaken", v: 0.0539 })).toBe("+5.4% healing taken");
    expect(effectText({ k: "stat", stat: "cooldown", v: -0.2 })).toBe("-20% cooldown time");
    expect(effectText({ k: "stat", stat: "maxHp", v: 0.03 })).toBe("+3% max HP");
  });

  it("writes a flat row in points, a minus for a loss", () => {
    expect(effectText({ k: "flat", stat: "armor", v: -4 })).toBe("-4 armor");
    expect(effectText({ k: "flat", stat: "shield", v: 7.5 })).toBe("+7.5 magic resist");
    expect(effectText({ k: "flat", stat: "shield", v: 10.84 })).toBe("+10.8 magic resist");
  });

  it("writes every vs test", () => {
    const vs = (test: Extract<Effect, { k: "vs" }>["test"], arg = 0): Effect => ({ k: "vs", test, arg, v: 0.1 });
    expect(effectText(vs("hpAbove", 0.7))).toBe("+10% damage to targets above 70% HP");
    expect(effectText(vs("hpBelow", 0.3))).toBe("+10% damage to targets below 30% HP");
    expect(effectText(vs("slowed"))).toBe("+10% damage to slowed or chilled targets");
    expect(effectText(vs("rooted"))).toBe("+10% damage to rooted targets");
    expect(effectText(vs("streak", 3))).toBe("+10% damage to a target you have kept hitting for 3 s");
    expect(effectText(vs("thirdParty"))).toBe("+10% damage to targets fighting someone else");
    expect(effectText(vs("higherFeed"))).toBe("+10% damage to targets with a higher feed");
  });

  it("writes every while condition, points for armor and shield", () => {
    expect(effectText({ k: "while", cond: "chasingLock", arg: 0, stat: "moveSpeed", v: 0.05 })).toBe("+5% move speed while chasing your target");
    expect(effectText({ k: "while", cond: "hpBelow", arg: 0.3, stat: "attackSpeed", v: 0.25 })).toBe("+25% attack speed while below 30% HP");
    expect(effectText({ k: "while", cond: "afterCast", arg: 0, stat: "armor", v: 4, ms: 2500 })).toBe("+4 armor for 2.5 s after a cast");
    expect(effectText({ k: "while", cond: "hpBelow", arg: 0.5, stat: "shield", v: -2 })).toBe("-2 magic resist while below 50% HP");
  });

  it("writes every trigger action and event, 'once per run' only for a once row", () => {
    expect(effectText({ k: "trigger", on: "kill", arg: 0, do: { do: "heal", share: 0.05 } })).toBe("On a kill: heal 5% of max HP");
    expect(effectText({ k: "trigger", on: "hitTaken", arg: 0, once: true, do: { do: "barrier", share: 0.2, ms: 4000 } }))
      .toBe("When hit: a barrier of 20% of max HP for 4 s (once per run)");
    expect(effectText({ k: "trigger", on: "hpBelow", arg: 0.3, do: { do: "cleanse", to: "self", classes: ["soft"] } })).toBe("Below 30% HP: cleanse");
    expect(effectText({ k: "trigger", on: "kill", arg: 0, do: { do: "cooldown", ms: 2000 } })).toBe("On a kill: cooldowns 2 s shorter");
    expect(effectText({ k: "trigger", on: "kill", arg: 0, do: { do: "status", to: "self", status: "haste", ms: 1500 } })).toBe("On a kill: haste for 1.5 s");
  });

  it("joins a buff's rows with 'and'", () => {
    const rows: Effect[] = [{ k: "stat", stat: "maxHp", v: 0.03 }, { k: "flat", stat: "shield", v: 10 }];
    expect(effectsText(rows)).toBe("+3% max HP and +10 magic resist");
    expect(effectsText([])).toBe("");
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
  it("is half the victim's stacks of one buff, fractions and all", () => {
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
