// What the HUD and the toasts say about buffs (R4a), the feed and the barrier. The buff maths is buffsRoguelike.test.ts and
// buffs.test.ts; this is the wording and the views built on it.
import { describe, expect, it } from "vitest";
import {
  barrierStrength, BARRIER_FULL_SHARE, BUFFS, buffScale, buffText, buffToast, buffView, buffViews, catchUpMultiplier,
  ELITE_BUFF_STACKS, feedView, formatBonus, formatGain, formatMult, formatStacks, hasAnyBuffs, hpBarFractions, hpText,
  lobbyMedianFeed, MOB_BUFF_STACKS, mobRewardMultiplier, rewardCurve,
} from "../src/index";
import { PlayerState } from "../src/schema";

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

  // The old combo thresholds (3 and 5 stacks) made 2.96 read 2.9. A buff has no threshold now: 3 stacks is only the value
  // its text quotes, and the number is plain rounding like the toast's.
  it("is plain rounding next to 3 and 5 stacks: no threshold to stay short of", () => {
    expect(formatStacks(2.96)).toBe("3.0");
    expect(formatStacks(2.94)).toBe("2.9");
    expect(formatStacks(4.99)).toBe("5.0");
    expect(formatStacks(3)).toBe("3.0");
    expect(formatStacks(Math.fround(3.1))).toBe("3.1");
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
    expect(formatGain(3.1)).toBe("3.1");
  });

  it("writes a bonus as a whole percent and a multiplier with two decimals", () => {
    expect(formatBonus(0.23)).toBe("+23%");
    expect(formatBonus(0)).toBe("+0%");
    expect(formatBonus(-1)).toBe("+0%");
    expect(formatMult(0.85)).toBe("x0.85");
    expect(formatMult(1.0625)).toBe("x1.06");
  });
});

describe("buffView", () => {
  it("reads one buff at the stacks held: the count, the scale, the line now and the quoted line", () => {
    const at3 = buffView("emberImp", 3)!;
    expect(at3).toMatchObject({
      id: "emberImp", name: "Ember Imp", zone: "fire", elite: false, stacks: 3, stacksText: "3.0", scale: 1,
      text: "+10% damage", quoted: "+10% damage", active: true,
    });
    const at6 = buffView("emberImp", 6)!;
    expect(at6.scale).toBe(buffScale(6));
    expect(at6.text).toBe(buffText("emberImp", 6));
    expect(at6.quoted).toBe("+10% damage"); // the quoted line never moves
    const at1 = buffView("emberImp", 1.1)!;
    expect(at1.stacksText).toBe("1.1");
    expect(at1.text).toBe(buffText("emberImp", 1.1));
  });

  it("knows an elite's buff by its flag and its zone", () => {
    expect(buffView("wyrmling", 1)).toMatchObject({ name: "Wyrmling", zone: "fire", elite: true });
    expect(buffView("bloodSaint", 1)).toMatchObject({ name: "Blood Saint", zone: "holy", elite: true });
    expect(buffView("penitent", 1)).toMatchObject({ zone: "holy", elite: false });
  });

  it("is active unless a row needs the status runtime (shown, not applied until R4b)", () => {
    for (const b of BUFFS) expect(buffView(b.id, 3)!.active, b.id).toBe(b.needs === undefined);
    expect(buffView("chainWarden", 3)!.active).toBe(false);
    expect(buffView("bloatfly", 3)!.active).toBe(false);
    expect(buffView("plagueRat", 3)!.active).toBe(true);
  });

  it("says what the next kill of its type adds: a mob's grant, or an elite type's own, times the reward", () => {
    const imp = buffView("emberImp", 2, 0.8)!;
    expect(imp.nextGain).toBeCloseTo(MOB_BUFF_STACKS * 0.8, 12);
    expect(imp.nextText).toBe(buffText("emberImp", 2 + MOB_BUFF_STACKS * 0.8));
    const wyrm = buffView("wyrmling", 0, 0.5)!;
    expect(wyrm.nextGain).toBeCloseTo(ELITE_BUFF_STACKS * 0.5, 12);
    // Reward defaults to a full one.
    expect(buffView("emberImp", 0)!.nextGain).toBe(MOB_BUFF_STACKS);
    expect(buffView("wyrmling", 0)!.nextGain).toBe(ELITE_BUFF_STACKS);
    // A kill always makes the line stronger.
    expect(buffScale(2 + imp.nextGain)).toBeGreaterThan(buffScale(2));
  });

  it("treats a bad reward as nothing to gain, not a loss", () => {
    for (const reward of [0, -1, Number.NaN]) {
      const v = buffView("emberImp", 2, reward)!;
      expect(v.nextGain, `${reward}`).toBe(0);
      expect(v.nextText, `${reward}`).toBe(v.text);
    }
  });

  it("is empty for no, negative or NaN stacks, but still says what a first kill gives", () => {
    for (const n of [0, -2, Number.NaN]) {
      const v = buffView("rimeStalker", n)!;
      expect([v.stacks, v.stacksText, v.scale], `${n}`).toEqual([0, "0.0", 0]);
      expect(v.nextGain, `${n}`).toBe(MOB_BUFF_STACKS);
      expect(v.nextText, `${n}`).toBe(buffText("rimeStalker", MOB_BUFF_STACKS));
    }
  });

  it("is null for an id that is not in the catalog (newer server content)", () => {
    for (const id of ["nope", "", "EmberImp", "constructor", "__proto__", "fire"]) expect(buffView(id, 3), `"${id}"`).toBeNull();
  });
});

describe("buffViews and hasAnyBuffs", () => {
  it("lists the buffs held in catalog order, whatever order they were gained in", () => {
    const views = buffViews({ bloodSaint: 1, wyrmling: 2, acolyte: 0.5, emberImp: 3.3 });
    expect(views.map((v) => v.id)).toEqual(["emberImp", "wyrmling", "acolyte", "bloodSaint"]);
    expect(views.map((v) => v.stacksText)).toEqual(["3.3", "2.0", "0.5", "1.0"]);
  });

  it("skips what is not held: zero, negative and NaN stacks and ids the catalog does not know", () => {
    const views = buffViews({ emberImp: 1, iceGolem: 0, plagueRat: -3, bailiff: Number.NaN, junk: 5 });
    expect(views.map((v) => v.id)).toEqual(["emberImp"]);
    expect(buffViews({})).toEqual([]);
  });

  it("hands the reward to every view's next kill", () => {
    for (const v of buffViews({ emberImp: 1, wyrmling: 1 }, 0.5)) {
      expect(v.nextGain, v.id).toBeCloseTo((v.elite ? ELITE_BUFF_STACKS : MOB_BUFF_STACKS) * 0.5, 12);
    }
  });

  it("reads a Map, a plain record and a player's synced buffs map alike", () => {
    const p = new PlayerState();
    p.buffs.set("iceGolem", 2.5);
    p.buffs.set("emberImp", 1.5);
    const ids = (s: Parameters<typeof buffViews>[0]) => buffViews(s).map((v) => [v.id, v.stacks]);
    const want = [["emberImp", 1.5], ["iceGolem", 2.5]];
    expect(ids(p.buffs)).toEqual(want);
    expect(ids(new Map([["iceGolem", 2.5], ["emberImp", 1.5]]))).toEqual(want);
    expect(ids({ iceGolem: 2.5, emberImp: 1.5 })).toEqual(want);
  });

  it("is false only while nothing is held", () => {
    expect(hasAnyBuffs({})).toBe(false);
    expect(hasAnyBuffs(new PlayerState().buffs)).toBe(false);
    expect(hasAnyBuffs({ emberImp: 0, junk: 4 })).toBe(false);
    expect(hasAnyBuffs({ emberImp: 1e-6 })).toBe(true);
    expect(hasAnyBuffs(new Map([["acolyte", 0.4]]))).toBe(true);
  });
});

describe("buffToast", () => {
  it("says what dropped, the new total and the line at that total", () => {
    expect(buffToast("emberImp", 1.1, 3.2)).toBe(`Ember Imp +1.1 (3.2): ${buffText("emberImp", 3.2)}`);
    expect(buffToast("emberImp", 1.1, 3)).toBe("Ember Imp +1.1 (3.0): +10% damage");
    expect(buffToast("bloodSaint", 3.1, 3.1)).toBe(`Blood Saint +3.1 (3.1): ${buffText("bloodSaint", 3.1)}`);
    expect(buffToast("acolyte", 0.33, 1.4)).toBe(`Acolyte +0.3 (1.4): ${buffText("acolyte", 1.4)}`);
  });

  it("reads the gain and the total the way the HUD does", () => {
    // A first drop of 1.078 is +1.1, and the HUD's count right after it reads 1.1.
    const toast = buffToast("plagueRat", 1.078, 1.078);
    expect(toast.startsWith(`Plague Rat +${formatGain(1.078)} (${formatStacks(1.078)})`)).toBe(true);
    expect(buffView("plagueRat", 1.078)!.stacksText).toBe(formatStacks(1.078));
  });

  it("does not choke on a buff from newer server content: its id, no line", () => {
    expect(buffToast("newThing", 1, 1)).toBe("newThing +1.0 (1.0)");
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

  it("is the reward a buff view's next kill is scaled by", () => {
    const feed = feedView(3, 0, 3);
    expect(buffView("emberImp", 0, feed.reward)!.nextGain).toBeCloseTo(MOB_BUFF_STACKS * rewardCurve(3), 12);
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

// The kill combos that gave a barrier are gone (R6's skills bring them back); the HUD's draw scale and bar maths stay.
describe("the barrier", () => {
  it("is a full ring at BARRIER_FULL_SHARE of max hp (the old Bulwark's 30%) and proportional below it", () => {
    expect(BARRIER_FULL_SHARE).toBeCloseTo(0.3, 12);
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

  it("writes the hp readout with the barrier when there is one", () => {
    expect(hpText(400, 500, 0)).toBe("HP 400/500");
    expect(hpText(399.2, 500, 74.3)).toBe("HP 400/500 +75 barrier");
    expect(hpText(400, 500, 0.0001)).toBe("HP 400/500 +1 barrier");
    expect(hpText(400, 500, -3)).toBe("HP 400/500");
  });
});
