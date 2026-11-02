// The potion rule (shared/consumables.ts): the server refuses a potion with these words in this order, and the client checks a
// press against the same function before it sends it.
import { describe, expect, it } from "vitest";
import { POTION_MAX_CONCURRENT, POTION_REFUSAL, POTION_REFUSALS, potionRefusal, type PotionCheck } from "../src";

const ok: PotionCheck = { actionBlocked: false, healing: 0, hp: 100, maxHp: 1000, large: 1, small: 0 };

describe("potionRefusal", () => {
  it("lets a potion through when nothing stops it, from either stock", () => {
    expect(potionRefusal(ok)).toBeNull();
    expect(potionRefusal({ ...ok, large: 0, small: 2 })).toBeNull();
    expect(potionRefusal({ ...ok, healing: POTION_MAX_CONCURRENT - 1 })).toBeNull();
  });

  it("refuses in the server's order: blocked, then busy, then full, then empty", () => {
    const all = { actionBlocked: true, healing: POTION_MAX_CONCURRENT, hp: 1000, maxHp: 1000, large: 0, small: 0 };
    expect(potionRefusal(all)).toBe(POTION_REFUSAL.blocked);
    expect(potionRefusal({ ...all, actionBlocked: false })).toBe(POTION_REFUSAL.busy);
    expect(potionRefusal({ ...all, actionBlocked: false, healing: 0 })).toBe(POTION_REFUSAL.full);
    expect(potionRefusal({ ...all, actionBlocked: false, healing: 0, hp: 999 })).toBe(POTION_REFUSAL.empty);
    // Each on its own.
    expect(potionRefusal({ ...ok, actionBlocked: true })).toBe(POTION_REFUSAL.blocked);
    expect(potionRefusal({ ...ok, healing: POTION_MAX_CONCURRENT })).toBe(POTION_REFUSAL.busy);
    expect(potionRefusal({ ...ok, hp: 1000 })).toBe(POTION_REFUSAL.full);
    expect(potionRefusal({ ...ok, hp: 1001 })).toBe(POTION_REFUSAL.full);
    expect(potionRefusal({ ...ok, large: 0 })).toBe(POTION_REFUSAL.empty);
  });

  it("only ever answers one of POTION_REFUSALS, and the busy line names the cap", () => {
    expect([...POTION_REFUSALS].sort()).toEqual(Object.values(POTION_REFUSAL).sort());
    expect(POTION_REFUSALS).toHaveLength(4);
    expect(POTION_REFUSAL.busy).toContain(String(POTION_MAX_CONCURRENT));
    for (const blocked of [false, true]) for (const healing of [0, POTION_MAX_CONCURRENT]) for (const hp of [10, 1000]) for (const large of [0, 1]) {
      const r = potionRefusal({ actionBlocked: blocked, healing, hp, maxHp: 1000, large, small: 0 });
      if (r !== null) expect(POTION_REFUSALS).toContain(r);
    }
  });
});
