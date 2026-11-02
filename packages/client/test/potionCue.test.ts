// The potion key's local side (net/potionCue.ts): a press is checked with the server's own rule and words, a press it will take
// shows in the counters at once, and the patch (or a refusal toast, or ORDER_EXPIRE_MS) answers it. Pure: no scene.
import { describe, expect, it } from "vitest";
import { CONSUMABLES, POTION_HEAL_MS, POTION_MAX_CONCURRENT, POTION_REFUSAL } from "@raid/shared";
import { ORDER_EXPIRE_MS } from "../src/net/localMotion";
import { PotionCue, type PotionFighter } from "../src/net/potionCue";

const me = (o: Partial<PotionFighter> = {}): PotionFighter => ({
  hp: 100, maxHp: 1000, potionLarge: 0, potionSmall: 0, potionsHealing: 0, healingUntil: 0, ...o,
});

describe("PotionCue.press", () => {
  it("denies with the server's words, in its order", () => {
    const cue = new PotionCue();
    expect(cue.press(me(), false, 0, 0)).toEqual({ deny: POTION_REFUSAL.empty });
    expect(cue.press(me({ potionSmall: 1, hp: 1000 }), false, 0, 0)).toEqual({ deny: POTION_REFUSAL.full });
    expect(cue.press(me({ potionSmall: 1, potionsHealing: POTION_MAX_CONCURRENT }), false, 0, 0)).toEqual({ deny: POTION_REFUSAL.busy });
    expect(cue.press(me({ potionSmall: 1 }), true, 0, 0)).toEqual({ deny: POTION_REFUSAL.blocked });
    expect(cue.waiting).toBe(0); // a denied press is not sent, so nothing waits
  });

  it("takes the large potion first, as the server does, and answers its colour", () => {
    const cue = new PotionCue();
    expect(cue.press(me({ potionLarge: 1, potionSmall: 1 }), false, 0, 0)).toEqual({ color: CONSUMABLES.potionLarge.color, large: true });
    expect(cue.press(me({ potionLarge: 1, potionSmall: 1 }), false, 10, 10)).toEqual({ color: CONSUMABLES.potionSmall.color, large: false });
  });

  it("counts the presses in flight: a second press with one potion left is empty, a fourth at once is busy", () => {
    const one = new PotionCue();
    expect(one.press(me({ potionSmall: 1 }), false, 0, 0)).toHaveProperty("color");
    expect(one.press(me({ potionSmall: 1 }), false, 20, 20)).toEqual({ deny: POTION_REFUSAL.empty });
    const many = new PotionCue();
    for (let i = 0; i < POTION_MAX_CONCURRENT; i++) expect(many.press(me({ potionSmall: 5 }), false, i, i)).toHaveProperty("color");
    expect(many.press(me({ potionSmall: 5 }), false, 5, 5)).toEqual({ deny: POTION_REFUSAL.busy });
    const two = new PotionCue();
    expect(two.press(me({ potionSmall: 5, potionsHealing: 2 }), false, 0, 0)).toHaveProperty("color");
    expect(two.press(me({ potionSmall: 5, potionsHealing: 2 }), false, 5, 5)).toEqual({ deny: POTION_REFUSAL.busy });
  });
});

describe("PotionCue answers", () => {
  it("a patch whose stock fell answers the oldest press", () => {
    const cue = new PotionCue();
    cue.reconcile(me({ potionSmall: 3 }), 0);
    cue.press(me({ potionSmall: 3 }), false, 0, 0);
    cue.press(me({ potionSmall: 3 }), false, 10, 10);
    cue.reconcile(me({ potionSmall: 3 }), 30); // not applied yet
    expect(cue.waiting).toBe(2);
    cue.reconcile(me({ potionSmall: 2, potionsHealing: 1 }), 60);
    expect(cue.waiting).toBe(1);
    cue.reconcile(me({ potionSmall: 1, potionsHealing: 2 }), 110);
    expect(cue.waiting).toBe(0);
  });

  it("a stock that rose (a pickup) answers nothing", () => {
    const cue = new PotionCue();
    cue.reconcile(me({ potionSmall: 1 }), 0);
    cue.press(me({ potionSmall: 1 }), false, 0, 0);
    cue.reconcile(me({ potionSmall: 2 }), 50);
    expect(cue.waiting).toBe(1);
  });

  it("a press nothing answers is given up after ORDER_EXPIRE_MS", () => {
    const cue = new PotionCue();
    cue.press(me({ potionSmall: 1 }), false, 1000, 0);
    expect(cue.view(me({ potionSmall: 1 }), 1000 + ORDER_EXPIRE_MS - 1)).toBeDefined();
    expect(cue.view(me({ potionSmall: 1 }), 1000 + ORDER_EXPIRE_MS)).toBeUndefined();
  });

  it("a potion refusal toast answers the oldest press; any other toast does not", () => {
    const cue = new PotionCue();
    cue.press(me({ potionSmall: 2 }), false, 0, 0);
    cue.press(me({ potionSmall: 2 }), false, 1, 1);
    cue.noteToast("Small potion · healing over 5s");
    cue.noteToast("Too far away");
    expect(cue.waiting).toBe(2);
    cue.noteToast(POTION_REFUSAL.blocked);
    expect(cue.waiting).toBe(1);
  });

  it("reset forgets the presses and the stock it saw", () => {
    const cue = new PotionCue();
    cue.reconcile(me({ potionSmall: 2 }), 0);
    cue.press(me({ potionSmall: 2 }), false, 0, 0);
    cue.reset();
    expect(cue.waiting).toBe(0);
    cue.press(me({ potionSmall: 1 }), false, 0, 0);
    cue.reconcile(me({ potionSmall: 1 }), 10); // the first stock seen after a reset answers nothing
    expect(cue.waiting).toBe(1);
  });
});

describe("PotionCue.view", () => {
  it("is undefined while nothing is in flight", () => {
    expect(new PotionCue().view(me({ potionLarge: 2 }), 0)).toBeUndefined();
  });

  it("shows the stock and the healing as the press will leave them, and the same object every frame", () => {
    const cue = new PotionCue();
    cue.press(me({ potionLarge: 1, potionSmall: 2, potionsHealing: 1, healingUntil: 3000 }), false, 100, 2000);
    const a = cue.view(me({ potionLarge: 1, potionSmall: 2, potionsHealing: 1, healingUntil: 3000 }), 110);
    expect(a).toEqual({ large: 0, small: 2, healing: 2, healingUntil: 2000 + POTION_HEAL_MS });
    const b = cue.view(me({ potionLarge: 1, potionSmall: 2, potionsHealing: 1, healingUntil: 9000 }), 120);
    expect(b).toBe(a);
    expect(b!.healingUntil).toBe(9000); // a later one already healing ends last
  });
});
