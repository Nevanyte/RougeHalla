import { describe, expect, it } from "vitest";
import {
  BOUNTY_EXPONENT, BOUNTY_FREE_FEED, BOUNTY_SCALE, FEED_MOB_KILL_WEIGHT, PATIENCE_FULL_ALIVE, PATIENCE_MIN_ALIVE,
  PATIENCE_MIN_SECONDS, PATIENCE_SECONDS,
} from "../src/constants";
import { bountyFor, feedScore, patienceSecondsFor } from "../src/rules";
import * as shared from "../src/index";

describe("the tunables the formulas read", () => {
  it("are the design numbers: 5:00 at 8 alive down to 2:00 at 3, bounty 10 × (feed − 2)^1.5, mobs worth a quarter", () => {
    expect([PATIENCE_SECONDS, PATIENCE_MIN_SECONDS, PATIENCE_FULL_ALIVE, PATIENCE_MIN_ALIVE]).toEqual([300, 120, 8, 3]);
    expect([BOUNTY_SCALE, BOUNTY_FREE_FEED, BOUNTY_EXPONENT, FEED_MOB_KILL_WEIGHT]).toEqual([10, 2, 1.5, 0.25]);
  });

  it("are reachable from the shared index, with the formulas", () => {
    expect(shared.patienceSecondsFor).toBe(patienceSecondsFor);
    expect(shared.bountyFor).toBe(bountyFor);
    expect(shared.feedScore).toBe(feedScore);
  });
});

describe("patienceSecondsFor", () => {
  const at = (alive: number) => patienceSecondsFor(alive, PATIENCE_SECONDS, PATIENCE_MIN_SECONDS);

  it("is 120 s at 3 or fewer alive, 300 s at 8 or more, and steps of 36 s in between", () => {
    const expected = [120, 120, 120, 120, 156, 192, 228, 264, 300, 300, 300];
    expect(Array.from({ length: 11 }, (_, alive) => at(alive))).toEqual(expected);
  });

  it("spells out each count", () => {
    expect(at(0)).toBe(120);
    expect(at(1)).toBe(120);
    expect(at(2)).toBe(120);
    expect(at(3)).toBe(120);
    expect(at(4)).toBe(156);
    expect(at(5)).toBe(192);
    expect(at(6)).toBe(228);
    expect(at(7)).toBe(264);
    expect(at(8)).toBe(300);
    expect(at(9)).toBe(300);
    expect(at(100)).toBe(300);
  });

  it("never decreases as more players stand, and stays inside [min, full]", () => {
    let last = -Infinity;
    for (let alive = 0; alive <= 20; alive++) {
      const s = at(alive);
      expect(s, `alive ${alive}`).toBeGreaterThanOrEqual(last);
      expect(s).toBeGreaterThanOrEqual(PATIENCE_MIN_SECONDS);
      expect(s).toBeLessThanOrEqual(PATIENCE_SECONDS);
      last = s;
    }
  });

  it("rises by the same amount for every player added between the ends", () => {
    const step = (PATIENCE_SECONDS - PATIENCE_MIN_SECONDS) / (PATIENCE_FULL_ALIVE - PATIENCE_MIN_ALIVE);
    for (let alive = PATIENCE_MIN_ALIVE; alive < PATIENCE_FULL_ALIVE; alive++) {
      expect(at(alive + 1) - at(alive), `${alive} → ${alive + 1}`).toBeCloseTo(step, 9);
    }
  });

  it("scales whatever pair of lengths it is given", () => {
    expect(patienceSecondsFor(8, 10, 2)).toBe(10);
    expect(patienceSecondsFor(3, 10, 2)).toBe(2);
    expect(patienceSecondsFor(4, 10, 2)).toBeCloseTo(3.6, 9); // 2 + 8 × 1/5
    expect(patienceSecondsFor(6, 10, 2)).toBeCloseTo(6.8, 9); // 2 + 8 × 3/5
    expect(patienceSecondsFor(5, 20, 8)).toBeCloseTo(8 + 12 * (2 / 5), 9);
  });

  it("is flat when the full and the minimum length are equal", () => {
    for (let alive = 0; alive <= 10; alive++) {
      expect(patienceSecondsFor(alive, 90, 90), `alive ${alive}`).toBe(90);
      expect(patienceSecondsFor(alive, 0.4, 0.4), `alive ${alive}`).toBe(0.4);
    }
  });

  it("is always between the two lengths it is given", () => {
    for (const [full, min] of [[300, 120], [10, 2], [60, 59], [5, 5], [3600, 3600]] as const) {
      for (let alive = 0; alive <= 12; alive++) {
        const s = patienceSecondsFor(alive, full, min);
        expect(s).toBeGreaterThanOrEqual(min);
        expect(s).toBeLessThanOrEqual(full);
      }
    }
  });
});

describe("feedScore", () => {
  it("is player kills plus a quarter of the mob kills", () => {
    expect(feedScore(0, 0)).toBe(0);
    expect(feedScore(3, 0)).toBe(3);
    expect(feedScore(0, 4)).toBe(1);
    expect(feedScore(0, 12)).toBe(3);
    expect(feedScore(2, 4)).toBe(3);
    expect(feedScore(1, 1)).toBe(1.25);
    expect(feedScore(5, 7)).toBe(5 + 7 * FEED_MOB_KILL_WEIGHT);
  });

  it("counts a player kill as four mob kills", () => {
    expect(feedScore(1, 0)).toBe(feedScore(0, 4));
  });
});

describe("bountyFor", () => {
  it("pays nothing until the feed passes 2, then round(10 × (feed − 2)^1.5)", () => {
    const cases: Array<[number, number]> = [[0, 0], [2, 0], [2.25, 1], [3, 10], [4, 28], [5, 52], [6, 80]];
    for (const [feed, bounty] of cases) expect(bountyFor(feed), `feed ${feed}`).toBe(bounty);
  });

  it("is never negative, whatever the feed", () => {
    for (const feed of [-100, -1, -0.5, -0, 0, 0.25, 1, 1.99, 2, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(bountyFor(feed), `feed ${feed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("rounds to a whole number of GV, to the nearest", () => {
    for (let feed = 0; feed <= 12; feed += 0.25) expect(Number.isInteger(bountyFor(feed)), `feed ${feed}`).toBe(true);
    expect(bountyFor(2.1)).toBe(0); // 0.316
    expect(bountyFor(2.2)).toBe(1); // 0.894
    expect(bountyFor(2.3)).toBe(2); // 1.643
    expect(bountyFor(3.5)).toBe(18); // 17.68
    expect(bountyFor(4.5)).toBe(40); // 39.53
    expect(bountyFor(2 + 1e-9)).toBe(0); // just over: still rounds down to nothing
  });

  it("never falls as the feed grows", () => {
    let last = 0;
    for (let feed = -2; feed <= 20; feed += 0.125) {
      const b = bountyFor(feed);
      expect(b, `feed ${feed}`).toBeGreaterThanOrEqual(last);
      last = b;
    }
  });

  it("follows the kill and mob counts it is fed from", () => {
    expect(bountyFor(feedScore(2, 0))).toBe(0); // two kills: not yet
    expect(bountyFor(feedScore(3, 0))).toBe(10);
    expect(bountyFor(feedScore(4, 0))).toBe(28);
    expect(bountyFor(feedScore(0, 12))).toBe(10); // twelve mobs are worth as much as three players
    expect(bountyFor(feedScore(2, 4))).toBe(10);
    expect(bountyFor(feedScore(0, 8))).toBe(0); // feed 2
    expect(bountyFor(feedScore(0, 9))).toBe(1); // feed 2.25
  });
});
