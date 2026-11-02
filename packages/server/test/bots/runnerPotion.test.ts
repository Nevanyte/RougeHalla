import { describe, expect, it, vi } from "vitest";
import { EFFECT_STUNNED, mapFromTiles } from "@raid/shared";
import { createBotRunner, shouldUsePotion } from "../../src/bots/brain/runner";
import type { Brain, Percept } from "../../src/bots/brain/types";
import { plainPlayer, plainState } from "./fairnessKit";
import { features } from "./fixtures";

describe("bot potion use", () => {
  it("heals at low health from its own synced inventory, respecting healing and action lockouts", () => {
    const map = mapFromTiles(24, 24, new Uint8Array(24 * 24));
    const me = plainPlayer({ hp: 300, maxHp: 500, potionLarge: 1 });
    const state = plainState({ serverTime: 1000, players: new Map([["me", me]]) });
    const sent: Array<{ cmd: unknown; at: number }> = [];
    const brain = { tick: (_p: Percept) => [], end: vi.fn() } as unknown as Brain;
    const runner = createBotRunner({
      brain, adapter: { selfId: "me", supports: type => type === "useConsumable", send: (cmd, at) => { sent.push({ cmd, at }); return true; } },
      cfg: { selfDelayMs: 0, worldDelayMs: 0 }, map, features: features(), tier: { attention: { central: 0.7 } as never },
    });
    runner.frame({ state });
    expect(sent).toEqual([{ cmd: { type: "useConsumable", msg: { kind: "heal" } }, at: 1000 }]);
    state.serverTime = 1500;
    runner.frame({ state });
    expect(sent).toHaveLength(1);
    me.healingUntil = 2600;
    state.serverTime = 2000;
    runner.frame({ state });
    expect(sent).toHaveLength(1);
    me.healingUntil = 0;
    me.effects = EFFECT_STUNNED;
    state.serverTime = 2700;
    runner.frame({ state });
    expect(sent).toHaveLength(1);
    me.effects = 0;
    state.serverTime = 2750;
    runner.frame({ state });
    expect(sent).toHaveLength(2);
    me.potionLarge = 0;
    state.serverTime = 4000;
    runner.frame({ state });
    expect(sent).toHaveLength(2);
  });

  it("does not spend above the threshold, while dead, or without potions", () => {
    expect(shouldUsePotion({ status: "alive", hp: 325, maxHp: 500, potionSmall: 1 }, 1000, -Infinity)).toBe(false);
    expect(shouldUsePotion({ status: "dead", hp: 100, maxHp: 500, potionSmall: 1 }, 1000, -Infinity)).toBe(false);
    expect(shouldUsePotion({ status: "alive", hp: 100, maxHp: 500 }, 1000, -Infinity)).toBe(false);
  });
});
