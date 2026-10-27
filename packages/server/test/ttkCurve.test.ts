// A reduced run of bench/ttkCurve.ts (BALANCE_CONTRACT 1.4): five ordered pairs x three setups, so the early-fight length the
// balance pass fixed cannot drift unnoticed. Minute 0 is two fighters on fists (an empty hand), no cards: its median TTK must stay
// within 0.6x-1.6x of the 20 s target. Minute 5 holds cards (the kit of BALANCE_CONTRACT 1.3) and is judged once the card
// catalog can grant them (`grantCard`; agent A3): then median(m0) / median(m5) >= 3 and minute 5 within 0.6x-1.6x of 5 s.
import { describe, expect, it } from "vitest";
import { BEATS } from "@raid/shared";
import { fullSetups } from "../src/harness/matrix";
import { median, playDuel } from "../bench/lib/balance";
import { kitCards, kitsAvailable, kitWeapon, type Minute } from "../bench/kits";

const PAIRS = BEATS.slice(0, 10).filter((_, i) => i % 2 === 0); // fire>sentenced, sentenced>plague, plague>frost, frost>holy, holy>fire
const SETUPS = fullSetups().filter((_, i) => i % 6 === 0); // one per start distance

function medianTtk(minute: Minute): number {
  const ttks: number[] = [];
  for (const [a, b] of PAIRS) {
    SETUPS.forEach((setup, i) => {
      const wa = kitWeapon(a, minute);
      const wb = kitWeapon(b, minute);
      const r = playDuel({ a, b, weapons: [wa, wb], setup, setupIndex: i * 6, style: "lock", cap: 200, cards: [kitCards(minute, wa), kitCards(minute, wb)] });
      expect(r.end, `${a} vs ${b} setup ${i} finished`).not.toBe("cap");
      ttks.push(r.ttk);
    });
  }
  return median(ttks);
}

describe("the TTK curve (reduced)", () => {
  it("minute 0 on fists: the median fight lasts about 20 s (0.6x-1.6x)", () => {
    const m0 = medianTtk(0);
    expect(m0).toBeGreaterThan(0.6 * 20);
    expect(m0).toBeLessThan(1.6 * 20);
  });

  it.runIf(kitsAvailable(5))("minute 5 with the kit: about 5 s (0.6x-1.6x), and at least 3x shorter than minute 0", () => {
    const m0 = medianTtk(0);
    const m5 = medianTtk(5);
    expect(m5).toBeGreaterThan(0.6 * 5);
    expect(m5).toBeLessThan(1.6 * 5);
    expect(m0 / m5).toBeGreaterThanOrEqual(3);
  });
});
