// The weapon bar's keycaps (ui/weaponBar.ts): the slot numbers, the Q swap key and the F pickup hint are drawn as keycaps, the
// hint text changes only when it must, and the bar still shows and hides with the player's status. The pure cooldown helpers
// are in weaponBar.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WeaponId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { WeaponBar } from "../src/ui/weaponBar";
import { FEl, installChromeDom } from "./chromeDom";

afterEach(() => { vi.unstubAllGlobals(); });

function me(over: Partial<Record<keyof PlayerState, unknown>> = {}): PlayerState {
  return { status: "alive", weapon0: "sword", weapon1: "", slot: 0, readyAt: 0, ...over } as unknown as PlayerState;
}

function setup() {
  const { ui } = installChromeDom();
  const bar = new WeaponBar();
  const root = ui.children[0]!;
  const caps = (parent: FEl): string[] => parent.find((e) => e.tagName === "KBD").map((e) => e.textContent);
  const hint = root.byClass("wb-hint")[0]!;
  const hintText = root.byClass("wb-hint-text")[0]!;
  return { bar, root, hint, hintText, caps, ui };
}

describe("WeaponBar keycaps", () => {
  it("draws the slot numbers as keycaps in the slots", () => {
    const { root } = setup();
    const slotKeys = root.byClass("wb-key");
    expect(slotKeys.map((k) => k.textContent)).toEqual(["1", "2"]);
    for (const k of slotKeys) {
      expect(k.tagName).toBe("KBD");
      expect(k.className).toMatch(/\bkeycap\b/);
    }
    const slots = root.byClass("wb-slot");
    expect(slots).toHaveLength(2);
    slots.forEach((slot, i) => expect(slot.byClass("wb-key")[0]!.textContent).toBe(String(i + 1)));
  });

  it("shows Q as a keycap in the swap pill between the slots", () => {
    const { root } = setup();
    const swap = root.byClass("wb-swap")[0]!;
    const cap = swap.find((e) => e.tagName === "KBD");
    expect(cap).toHaveLength(1);
    expect(cap[0]!.textContent).toBe("Q");
    expect(cap[0]!.className).toMatch(/\bkeycap\b/);
    // Between slot 1 and slot 2.
    const row = root.byClass("wb-row")[0]!;
    expect(row.children.map((c) => c.byClass("wb-swap").length || (c === swap ? 1 : 0))).toEqual([0, 1, 0]);
  });

  it("starts hidden and shows only for a living player", () => {
    const { bar, root } = setup();
    expect(root.hidden).toBe(true);
    bar.update(undefined, 0, 0, null);
    expect(root.hidden).toBe(true);
    bar.update(me({ status: "lobby" }), 0, 0, null);
    expect(root.hidden).toBe(true);
    bar.update(me(), 0, 0, null);
    expect(root.hidden).toBe(false);
    bar.update(me({ status: "dead" }), 0, 0, null);
    expect(root.hidden).toBe(true);
  });

  it("marks the slot in hand and names the weapons", () => {
    const { bar, root } = setup();
    bar.update(me({ weapon0: "sword", weapon1: "bow", slot: 1 }), 0, 0, null);
    const [first, second] = root.byClass("wb-slot");
    expect(first!.classes.has("active")).toBe(false);
    expect(second!.classes.has("active")).toBe(true);
    expect(first!.byClass("wb-name")[0]!.textContent).toBe("Sword");
    expect(second!.byClass("wb-name")[0]!.textContent).toBe("Bow");
    bar.update(me({ weapon0: "sword", weapon1: "", slot: 0 }), 0, 0, null);
    expect(second!.byClass("wb-name")[0]!.textContent).toBe("Empty");
    expect(second!.classes.has("empty")).toBe(true);
  });
});

describe("WeaponBar pickup hint", () => {
  it("is hidden with nothing in reach, and has the F keycap when something is", () => {
    const { bar, hint, hintText, caps } = setup();
    expect(hint.hidden).toBe(true);
    expect(caps(hint)).toEqual(["F"]);
    bar.update(me(), 0, 0, null);
    expect(hint.hidden).toBe(true);
    bar.update(me(), 0, 0, "axe" as WeaponId);
    expect(hint.hidden).toBe(false);
    expect(hintText.textContent).toBe("take Axe");
    expect(hint.allText).toBe("Ftake Axe");
  });

  it("says swap when both slots are full, naming the weapon in hand", () => {
    const { bar, hint, hintText } = setup();
    bar.update(me({ weapon0: "sword", weapon1: "bow", slot: 1 }), 0, 0, "wand");
    expect(hint.hidden).toBe(false);
    expect(hintText.textContent).toBe("swap Bow for Wand");
    bar.update(me({ weapon0: "sword", weapon1: "bow", slot: 0 }), 0, 0, "wand");
    expect(hintText.textContent).toBe("swap Sword for Wand");
  });

  it("takes into an empty slot rather than swapping", () => {
    const { bar, hintText } = setup();
    bar.update(me({ weapon0: "sword", weapon1: "" }), 0, 0, "wand");
    expect(hintText.textContent).toBe("take Wand");
  });

  it("rewrites the text only when it changes, and hides again when the weapon is out of reach", () => {
    const { bar, hint, hintText } = setup();
    bar.update(me(), 0, 0, "bow");
    const writes = hintText.textWrites;
    for (let i = 0; i < 20; i++) bar.update(me(), 0, i * 50, "bow");
    expect(hintText.textWrites).toBe(writes);
    bar.update(me(), 0, 0, null);
    expect(hint.hidden).toBe(true);
    bar.update(me(), 0, 0, "bow");
    expect(hint.hidden).toBe(false);
  });
});

describe("WeaponBar cooldown sweep", () => {
  it("shows the shared cooldown on both slots and clears it when it is over", () => {
    const { bar, root } = setup();
    bar.update(me({ readyAt: 6000 }), 5000, 5000, null);
    const sweeps = root.byClass("wb-sweep");
    expect(sweeps).toHaveLength(2);
    for (const s of sweeps) {
      expect(s.hidden).toBe(false);
      expect(s.style.props["--cd"]).toBe("360deg");
    }
    bar.update(me({ readyAt: 6000 }), 5000, 5500, null);
    expect(sweeps[0]!.style.props["--cd"]).toBe("180deg");
    bar.update(me({ readyAt: 6000 }), 5000, 6100, null);
    for (const s of sweeps) expect(s.hidden).toBe(true);
  });

  it("destroy removes the bar", () => {
    const { bar, root } = setup();
    bar.destroy();
    expect(root.removed).toBe(true);
  });
});
