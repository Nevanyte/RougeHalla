// What the client knows about its own fighter's speed and roots (net/localPrediction.ts).
import { describe, expect, it } from "vitest";
import {
  attackInterval, buffMultiplier, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, FACTIONS, SIG_CHILLED, weaponTimings, type TimedFx,
} from "@raid/shared";
import { LocalPrediction, type LocalFighter, type OtherFighter } from "../src/net/localPrediction";

const ME = "me";
const fighter = (o: Partial<LocalFighter> = {}): LocalFighter => ({
  x: 100, y: 100, faction: "fire", sig: 0, stacksHp: 0, stacksAs: 0, stacksMs: 0, ...o,
});
const other = (o: Partial<OtherFighter> = {}): OtherFighter => ({ x: 150, y: 100, faction: "frost", status: "alive", ...o });
const windup = (t: number, ms: number, weapon: "axe" | "sword" = "axe", by = ME): TimedFx => ({ kind: "windup", by, weapon, a: 0, ms, t });

describe("order numbers", () => {
  it("count 1..255 and round again, never 0 (the state's default 'no order yet')", () => {
    const p = new LocalPrediction();
    const seen = Array.from({ length: 600 }, () => p.nextSeq());
    expect(seen[0]).toBe(1);
    expect(seen[254]).toBe(255);
    expect(seen[255]).toBe(1);
    expect(seen.every((n) => n >= 1 && n <= 255 && Number.isInteger(n))).toBe(true);
  });

  it("restart after a reset", () => {
    const p = new LocalPrediction();
    p.nextSeq();
    p.nextSeq();
    p.reset();
    expect(p.nextSeq()).toBe(1);
  });
});

describe("walk speed", () => {
  const p = new LocalPrediction();

  it("is 1 with nothing to know", () => {
    expect(p.speedMult(1000, fighter(), [])).toBe(1);
  });

  it("follows the move-speed stacks like the server's buff curve", () => {
    expect(p.speedMult(1000, fighter({ stacksMs: 3 }), [])).toBe(buffMultiplier("moveSpeed", 3));
    expect(p.speedMult(1000, fighter({ stacksMs: 3 }), [])).toBeGreaterThan(1.1);
  });

  it("is slowed only when chilled and a Frost is within the chill radius", () => {
    const chilled = fighter({ sig: SIG_CHILLED });
    expect(p.speedMult(0, chilled, [other({ x: 100 + CHILL_MOVE_RADIUS - 1 })])).toBe(CHILL_MOVE_MULT);
    expect(p.speedMult(0, chilled, [other({ x: 100 + CHILL_MOVE_RADIUS + 1 })])).toBe(1);
    expect(p.speedMult(0, chilled, [other({ faction: "fire" })])).toBe(1);
    expect(p.speedMult(0, chilled, [other({ status: "dead" })])).toBe(1);
    expect(p.speedMult(0, fighter(), [other()])).toBe(1); // not chilled: a Frost nearby does not slow it
    expect(p.speedMult(0, chilled, [])).toBe(1);
  });

  it("stacks multiply with the chill", () => {
    const f = fighter({ stacksMs: 3, sig: SIG_CHILLED });
    expect(p.speedMult(0, f, [other()])).toBeCloseTo(buffMultiplier("moveSpeed", 3) * CHILL_MOVE_MULT, 12);
  });
});

describe("a kill's burst", () => {
  const kill = (t: number, by = ME): TimedFx => ({ kind: "death", id: "foe", x: 0, y: 0, by, t });

  it("a kill by the local player with the dash combo (3 attack-speed stacks) is 2.5x for 400 ms from the kill's tick", () => {
    const p = new LocalPrediction();
    const me = fighter({ stacksAs: 3 });
    p.noteFx(kill(10_000), ME, me);
    expect(p.speedMult(9_999, me, [])).toBe(1);
    expect(p.speedMult(10_000, me, [])).toBe(2.5);
    expect(p.speedMult(10_399, me, [])).toBe(2.5);
    expect(p.speedMult(10_400, me, [])).toBe(1);
  });

  it("the strongest burst wins, times the stacks' own bonus; other fighters' kills and no combo give nothing", () => {
    const p = new LocalPrediction();
    const me = fighter({ stacksAs: 3, stacksMs: 3 }); // dash (2.5 x 0.4 s) and bloodrush (1.5 x 3 s)
    p.noteFx(kill(0), ME, me);
    expect(p.speedMult(100, me, [])).toBeCloseTo(buffMultiplier("moveSpeed", 3) * 2.5, 12);
    expect(p.speedMult(1000, me, [])).toBeCloseTo(buffMultiplier("moveSpeed", 3) * 1.5, 12);
    expect(p.speedMult(3001, me, [])).toBeCloseTo(buffMultiplier("moveSpeed", 3), 12);
    const q = new LocalPrediction();
    q.noteFx(kill(0, "someone else"), ME, me);
    q.noteFx(kill(0), ME, fighter());
    expect(q.speedMult(100, me, [])).toBe(buffMultiplier("moveSpeed", 3));
  });

  it("dying ends them", () => {
    const p = new LocalPrediction();
    const me = fighter({ stacksAs: 3 });
    p.noteFx(kill(0), ME, me);
    p.noteFx({ kind: "death", id: ME, x: 0, y: 0, by: "foe", t: 100 }, ME, me);
    expect(p.speedMult(150, me, [])).toBe(1);
  });
});

describe("the axe's root", () => {
  const me = fighter({ faction: "fire" });
  const windupMs = weaponTimings("axe", attackInterval(FACTIONS.fire, "axe")).windup * 1000;
  const input = (p: LocalPrediction, t: number) => p.frameInput(t - p.motion.delay, true, me, [], false);

  it("holds the fighter from the swing's landing for as long again as the windup, in the model's time", () => {
    const p = new LocalPrediction();
    p.noteFx(windup(10_000, windupMs), ME, me); // starts this tick: lands windupMs later
    expect(input(p, 10_000).rooted).toBe(false); // winding up: the order that follows cancels it, so the model walks
    expect(input(p, 10_000 + windupMs - 1).rooted).toBe(false);
    expect(input(p, 10_000 + windupMs).rooted).toBe(true);
    expect(input(p, 10_000 + 2 * windupMs - 1).rooted).toBe(true);
    expect(input(p, 10_000 + 2 * windupMs).rooted).toBe(false);
  });

  it("uses the model's time: the delay ahead of the client clock", () => {
    const p = new LocalPrediction();
    p.noteFx(windup(10_000, windupMs), ME, me);
    const d = p.motion.delay;
    expect(p.frameInput(10_000 + windupMs - d, true, me, [], false).rooted).toBe(true);
    expect(p.frameInput(10_000 + windupMs - d - 1, true, me, [], false).rooted).toBe(false);
  });

  it("goes with a cancel, a stagger or a swap before it landed; stays after", () => {
    for (const how of ["cancel", "stagger", "swap"] as const) {
      const p = new LocalPrediction();
      p.noteFx(windup(10_000, windupMs), ME, me);
      if (how === "swap") p.noteWeaponChange(10_000 + windupMs - 10);
      else p.noteFx({ kind: how, id: ME, t: 10_000 + windupMs - 10 }, ME, me);
      expect(input(p, 10_000 + windupMs + 10).rooted, how).toBe(false);
      const q = new LocalPrediction();
      q.noteFx(windup(10_000, windupMs), ME, me);
      if (how === "swap") q.noteWeaponChange(10_000 + windupMs + 10);
      else q.noteFx({ kind: how, id: ME, t: 10_000 + windupMs + 10 }, ME, me);
      expect(input(q, 10_000 + windupMs + 20).rooted, `${how} after`).toBe(true);
    }
  });

  it("ignores other weapons and other fighters, and a death or a teleport clears it", () => {
    const p = new LocalPrediction();
    p.noteFx(windup(10_000, windupMs, "sword"), ME, me);
    p.noteFx(windup(10_000, windupMs, "axe", "someone"), ME, me);
    expect(input(p, 10_000 + windupMs + 10).rooted).toBe(false);
    p.noteFx(windup(10_000, windupMs), ME, me);
    p.noteFx({ kind: "teleport", t: 10_050 }, ME, me);
    expect(input(p, 10_000 + windupMs + 10).rooted).toBe(false);
    p.noteFx(windup(20_000, windupMs), ME, me);
    p.noteFx({ kind: "death", id: ME, x: 0, y: 0, by: null, t: 20_010 }, ME, me);
    expect(input(p, 20_000 + windupMs + 10).rooted).toBe(false);
  });
});

describe("frameInput", () => {
  it("passes alive and aiming through, and a lone default is 1 / not rooted", () => {
    const p = new LocalPrediction();
    expect(p.frameInput(0, true, fighter(), [], true)).toEqual({ alive: true, speedMult: 1, rooted: false, aiming: true });
    expect(p.frameInput(0, false, undefined, [], false)).toEqual({ alive: false, speedMult: 1, rooted: false, aiming: false });
  });
});
