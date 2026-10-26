// Stub written by the lead so tactics.ts can import it while the real file is being written (owner: T2). Replace it whole.
import type { BrainContext, Goal, TacticsOutput } from "../types";

export type WorldGoal = Extract<Goal, { kind: "loot" | "roam" | "hold" | "idle" }>;

export interface WorldTactics {
  act(ctx: BrainContext, goal: WorldGoal): TacticsOutput;
}

export function createWorldTactics(): WorldTactics {
  return {
    act: () => ({ intents: [], status: { state: "running", why: "stub" }, attacking: false }),
  };
}
