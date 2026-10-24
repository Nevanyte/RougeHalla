// Bottom-center weapon bar: the two slots (weapon, key, which one is in hand), the shared attack cooldown sweeping over
// them, and a hint line when a weapon is within reach. It only reflects the synced state; the keys are the scene's.
import { WEAPONS, isWeaponId, type WeaponId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { cssColor, el, uiRoot } from "./dom";

interface Slot {
  root: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  /** The cooldown wipe: a dark wedge that shrinks clockwise as the cooldown runs out. */
  sweep: HTMLElement;
}

function weaponOf(id: string): WeaponId | null {
  return isWeaponId(id) ? id : null;
}

export class WeaponBar {
  private readonly root = el("div", "weapon-bar");
  private readonly hint = el("div", "wb-hint");
  private readonly slots: Slot[] = [];
  /** Starts as a value no real signature can equal so the first update always renders. */
  private signature: string | null = null;
  private hintText = "";
  /** The ready time last seen, and the length of the cooldown it started (the sweep shows the share still left). */
  private readyAt = 0;
  private cooldown = 1;
  private sweepDeg = -1;

  constructor() {
    const row = el("div", "wb-row");
    for (let i = 0; i < 2; i++) {
      const root = el("div", "wb-slot empty");
      const swatch = el("span", "wb-swatch");
      const name = el("span", "wb-name");
      const sweep = el("span", "wb-sweep");
      sweep.hidden = true;
      root.append(el("span", "wb-key", String(i + 1)), swatch, name, sweep);
      this.slots.push({ root, swatch, name, sweep });
      row.append(root);
      if (i === 0) row.append(el("span", "wb-swap", "Q"));
    }
    this.hint.hidden = true;
    this.root.append(this.hint, row);
    this.root.hidden = true;
    uiRoot().append(this.root);
  }

  /**
   * `patchT`: the server time of the newest patch (when a changed `readyAt` was set). `serverNow`: the estimated current
   * server time, which the cooldown counts down against. `pickup`: the weapon F would take, if one is in reach.
   */
  update(me: PlayerState | undefined, patchT: number, serverNow: number, pickup: WeaponId | null): void {
    // The lobby hands out nothing yet: weapons arrive with the run.
    const show = me?.status === "alive";
    if (this.root.hidden === show) this.root.hidden = !show;
    if (!me || !show) return;
    this.render(me, patchT, serverNow, pickup);
  }

  private render(me: PlayerState, patchT: number, serverNow: number, pickup: WeaponId | null): void {
    const signature = `${me.weapon0}|${me.weapon1}|${me.slot}`;
    if (signature !== this.signature) {
      this.signature = signature;
      [me.weapon0, me.weapon1].forEach((id, i) => {
        const slot = this.slots[i]!;
        const w = weaponOf(id);
        slot.root.classList.toggle("empty", w === null);
        slot.root.classList.toggle("active", me.slot === i);
        slot.swatch.style.background = w ? cssColor(WEAPONS[w].color) : "";
        slot.name.textContent = w ? WEAPONS[w].name : "Empty";
      });
    }

    const hand = weaponOf(me.slot === 1 ? me.weapon1 : me.weapon0);
    let hint = "";
    if (pickup) {
      const take = WEAPONS[pickup].name;
      // With both slots full a pickup replaces the weapon in hand, which drops where the player stands.
      hint = me.weapon0 !== "" && me.weapon1 !== "" && hand ? `F: swap ${WEAPONS[hand].name} for ${take}` : `F: take ${take}`;
    }
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hint.textContent = hint;
      this.hint.hidden = hint === "";
    }

    if (me.readyAt !== this.readyAt) {
      this.readyAt = me.readyAt;
      this.cooldown = Math.max(1, me.readyAt - patchT);
    }
    const left = this.readyAt - serverNow;
    const deg = left > 0 ? Math.round(Math.min(1, left / this.cooldown) * 360) : 0;
    if (deg !== this.sweepDeg) {
      this.sweepDeg = deg;
      // The cooldown is shared, so both slots show it: swapping doesn't dodge it.
      for (const slot of this.slots) {
        slot.sweep.style.setProperty("--cd", `${deg}deg`);
        slot.sweep.hidden = deg === 0;
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
