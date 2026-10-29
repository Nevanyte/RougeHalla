import type { Vec2 } from "./messages";

/** Movement bonus applies only when the fighter's real last-tick velocity is clearly aimed at the chosen rival. */
export const SENTENCED_HUNT_MOVE_BONUS = 0.05;
export const SENTENCED_HUNT_TOWARD_DOT = 0.3;
/** Each completed hunt permanently adds this much relative mark strength. */
export const SENTENCED_HUNT_MARK_PER_STACK = 0.02;

/** Relative mark multiplier from completed hunts; empty/fresh hunts preserve the existing mark baseline. */
export function sentencedHuntMarkMultiplier(stacks: number): number {
  const safeStacks = Number.isFinite(stacks) ? Math.max(0, stacks) : 0;
  return 1 + SENTENCED_HUNT_MARK_PER_STACK * safeStacks;
}

/** Whether a real movement vector heads sufficiently toward a target. Both vectors need not be normalized. */
export function isMovingTowardHuntTarget(velocity: Vec2, toTarget: Vec2): boolean {
  const speed = Math.hypot(velocity.x, velocity.y);
  const distance = Math.hypot(toTarget.x, toTarget.y);
  if (!(speed > 1e-6) || !(distance > 1e-6)) return false;
  const dot = (velocity.x * toTarget.x + velocity.y * toTarget.y) / (speed * distance);
  return dot > SENTENCED_HUNT_TOWARD_DOT;
}
