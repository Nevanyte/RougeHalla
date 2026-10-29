import { describe, expect, it } from "vitest";
import {
  SENTENCED_HUNT_MARK_PER_STACK, SENTENCED_HUNT_MOVE_BONUS, SENTENCED_HUNT_TOWARD_DOT,
  isMovingTowardHuntTarget, sentencedHuntMarkMultiplier,
} from "../src/sentencedHunt";

describe("Sentenced hunt shared rules", () => {
  it("adds an uncapped relative mark multiplier for completed hunts", () => {
    expect(sentencedHuntMarkMultiplier(0)).toBe(1);
    expect(sentencedHuntMarkMultiplier(5)).toBe(1.1);
    expect(SENTENCED_HUNT_MARK_PER_STACK).toBe(0.02);
  });

  it("grants the directional move bonus only past the heading threshold", () => {
    expect(SENTENCED_HUNT_MOVE_BONUS).toBe(0.05);
    expect(SENTENCED_HUNT_TOWARD_DOT).toBe(0.3);
    expect(isMovingTowardHuntTarget({ x: 10, y: 0 }, { x: 100, y: 0 })).toBe(true);
    expect(isMovingTowardHuntTarget({ x: -10, y: 0 }, { x: 100, y: 0 })).toBe(false);
    expect(isMovingTowardHuntTarget({ x: 0, y: 10 }, { x: 100, y: 0 })).toBe(false);
    expect(isMovingTowardHuntTarget({ x: 1, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(isMovingTowardHuntTarget({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(false);
  });
});
