import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerState } from "@raid/shared/schema";
import { WEAPONS } from "@raid/shared";
import { weaponScalingText, weaponTipText } from "../src/ui/buildModel";
import { WeaponBar, isExtension, nextCooldown } from "../src/ui/weaponBar";
import { FakeEl, fakeEvent, installFakeDom } from "./fakes";

afterEach(() => { vi.unstubAllGlobals(); });

describe("weapon bar cooldown length", () => {
  it("a fresh attack after the last cooldown ended starts a new cooldown", () => {
    // Patch at t = 5000; the previous cooldown ended at 4900; the new one ends at 5900.
    expect(isExtension(4900, 5900, 5000)).toBe(false);
    expect(nextCooldown(4900, 1000, 5900, 5000)).toBe(900);
    // First patch of a scene: no previous readyAt.
    expect(nextCooldown(0, 1, 5900, 5000)).toBe(900);
  });

  it("a readyAt pushed later mid-cooldown (a chill) extends the length instead of restarting it", () => {
    let readyAt = 5900;
    let cooldown = nextCooldown(0, 1, readyAt, 5000);
    let patchT = 5000;
    let maxFraction = 1;
    for (let i = 0; i < 20; i++) {
      patchT += 50;
      const pushed = readyAt + 30; // 0.6 of a tick
      expect(isExtension(readyAt, pushed, patchT)).toBe(true);
      cooldown = nextCooldown(readyAt, cooldown, pushed, patchT);
      readyAt = pushed;
      expect(cooldown).toBe(900 + 30 * (i + 1));
      // The fraction left at the patch keeps falling overall (it never snaps back to ~1, as a restart would).
      const fraction = (readyAt - patchT) / cooldown;
      expect(fraction).toBeLessThan(maxFraction);
      maxFraction = fraction;
    }
    expect(maxFraction).toBeLessThan(0.7);
  });

  it("a readyAt that moves earlier is a restart", () => {
    expect(isExtension(6000, 5500, 5100)).toBe(false);
    expect(nextCooldown(6000, 1000, 5500, 5100)).toBe(400);
  });

  it("never returns a length under 1 ms", () => {
    expect(nextCooldown(0, 1, 5000, 5000)).toBe(1);
  });
});

describe("the weapon bar's scaling line and tooltip", () => {
  const me = (w0: string, w1: string, slot = 0): PlayerState =>
    ({ status: "alive", faction: "holy", weapon0: w0, weapon1: w1, slot, readyAt: 0 }) as unknown as PlayerState;

  function setup() {
    const dom = installFakeDom();
    const bar = new WeaponBar();
    const root = (bar as unknown as { root: FakeEl }).root;
    const row = (bar as unknown as { row: FakeEl }).row;
    const tip = (bar as unknown as { tip: FakeEl }).tip;
    const slots = (): FakeEl[] => (row.children as FakeEl[]).filter((c) => c.className.startsWith("wb-slot"));
    const part = (slot: FakeEl, cls: string): FakeEl => (slot.children as FakeEl[]).find((c) => c.className === cls)!;
    return { dom, bar, root, row, tip, slots, part };
  }

  it("names what each slot's weapon scales with under its name, and reads Fists for an empty slot", () => {
    const { bar, slots, part } = setup();
    bar.update(me("wand", ""), 0, 0, null);
    expect(part(slots()[0]!, "wb-name").textContent).toBe("Wand");
    expect(part(slots()[0]!, "wb-scale").textContent).toBe("SO 1.0 + Offense 0.3");
    expect(part(slots()[1]!, "wb-name").textContent).toBe("Fists");
    expect(part(slots()[1]!, "wb-scale").textContent).toBe(weaponScalingText("fists"));
    bar.update(me("sword", "axe"), 0, 0, null);
    expect(part(slots()[0]!, "wb-scale").textContent).toBe("Offense 1.0");
    expect(part(slots()[1]!, "wb-scale").textContent).toBe("Offense 1.0 + bonus HP 0.02");
  });

  it("shows the tooltip of the slot under the pointer (its scaling, tags and special) and hides it off the slots", () => {
    const { dom, bar, row, tip, slots } = setup();
    bar.update(me("wand", "shield"), 0, 0, null);
    expect(tip.hidden).toBe(true);
    row.rect = { left: 400, top: 560, width: 250, height: 76 };
    slots()[0]!.rect = { left: 400, top: 560, width: 104, height: 76 };
    slots()[1]!.rect = { left: 546, top: 560, width: 104, height: 76 };
    const canvas = { tagName: "CANVAS" };
    const move = (x: number, y: number): void => { dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: x, clientY: y, target: canvas })); };
    move(420, 600);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain(weaponTipText("wand"));
    expect(tip.textContent.split("\n")[1]).toBe("Scales with SO 1.0 + Offense 0.3");
    expect(tip.textContent).toContain("Current hit type: 100% physical");
    move(560, 600);
    expect(tip.textContent).toContain(weaponTipText("shield"));
    move(520, 600); // between the slots
    expect(tip.hidden).toBe(true);
    move(420, 600);
    bar.update(me("bow", "shield"), 0, 0, null); // the weapon changed: the old tooltip goes
    expect(tip.hidden).toBe(true);
    move(420, 600);
    expect(tip.textContent).toContain(weaponTipText("bow"));
  });

  it("gives an empty slot the tooltip of Fists", () => {
    const { dom, bar, row, tip, slots } = setup();
    bar.update(me("", ""), 0, 0, null);
    row.rect = { left: 400, top: 560, width: 250, height: 76 };
    slots()[0]!.rect = { left: 400, top: 560, width: 104, height: 76 };
    dom.win.dispatchEvent(fakeEvent("pointermove", { clientX: 420, clientY: 600, target: { tagName: "CANVAS" } }));
    expect(tip.textContent.split("\n")[0]).toBe(WEAPONS.fists.name);
    expect(tip.textContent).toContain("empty weapon slot fights with them");
  });

  it("hints F at a quest giver: a weapon in reach wins, then a quest item, then the giver", () => {
    const { bar } = setup();
    const hint = (bar as unknown as { hint: FakeEl }).hint;
    const label = (bar as unknown as { hintLabel: FakeEl }).hintLabel;
    bar.update(me("sword", ""), 0, 0, null);
    expect(hint.hidden).toBe(true);
    bar.update(me("sword", ""), 0, 0, null, "", "talk to Ashmother Vela");
    expect(hint.hidden).toBe(false);
    expect(label.textContent).toBe("talk to Ashmother Vela");
    bar.update(me("sword", ""), 0, 0, null, "Blight Blooms", "talk to Ashmother Vela");
    expect(label.textContent).toBe("take Blight Blooms");
    bar.update(me("sword", ""), 0, 0, "axe", "Blight Blooms", "talk to Ashmother Vela");
    expect(label.textContent).toBe("take Axe");
    bar.update(me("sword", ""), 0, 0, null);
    expect(hint.hidden).toBe(true);
  });

  it("never takes the pointer and stops listening when destroyed", () => {
    const { dom, bar, root, row, slots } = setup();
    bar.update(me("sword", ""), 0, 0, null);
    for (const type of ["pointerdown", "pointerup", "click", "contextmenu", "mousedown"]) {
      for (const node of [root, row, ...slots()]) expect(node.listenerCount(type), `${type} on ${node.className}`).toBe(0);
    }
    expect(dom.win.listenerCount("pointermove")).toBe(1);
    bar.destroy();
    expect(dom.win.listenerCount("pointermove")).toBe(0);
  });
});
