// Bottom-center weapon bar: the two slots (weapon, key, which one is in hand), the shared attack cooldown sweeping over
// them, and a hint line when a weapon is within reach. The keys are drawn as keycaps (1, 2, Q, F). It only reflects the
// synced state; the keys themselves are the scene's. Other HUD modules dock into its slot row (`dock`): the Wish slot.
import { FISTS, WEAPONS, isWeaponId, type WeaponId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import "./weaponBar.css";
import { cssColor, el, uiRoot } from "./dom";
import { keycap } from "./keycap";

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

/**
 * A `readyAt` that moved later while its cooldown was still running (as of the patch stamped `patchT`) extends that
 * cooldown instead of starting a new one. A chill does this every tick; treating each step as a fresh cooldown would
 * pin the sweep near full until the chill ended.
 */
export function isExtension(prevReadyAt: number, readyAt: number, patchT: number): boolean {
  return prevReadyAt > patchT && readyAt > prevReadyAt;
}

/** The length (ms) the sweep counts down from once `readyAt` has changed from `prevReadyAt` (see isExtension). */
export function nextCooldown(prevReadyAt: number, prevCooldown: number, readyAt: number, patchT: number): number {
  return isExtension(prevReadyAt, readyAt, patchT) ? prevCooldown + (readyAt - prevReadyAt) : Math.max(1, readyAt - patchT);
}

export class WeaponBar {
  private readonly root = el("div", "weapon-bar");
  private readonly row = el("div", "wb-row");
  private readonly hint = el("div", "wb-hint");
  private readonly hintLabel = el("span", "wb-hint-text");
  private readonly slots: Slot[] = [];
  /** Starts as a value no real signature can equal so the first update always renders. */
  private signature: string | null = null;
  /** The hint line now shown (without its F keycap). */
  private hintText = "";
  /** The ready time last seen, and the length of the cooldown it started (the sweep shows the share still left). */
  private readyAt = 0;
  private cooldown = 1;
  private sweepDeg = -1;
  /** The sweep may not grow back within one cooldown: an extension steps the length a little ahead of the clock. */
  private maxDeg = 360;

  constructor() {
    const row = this.row;
    for (let i = 0; i < 2; i++) {
      const root = el("div", "wb-slot empty");
      const swatch = el("span", "wb-swatch");
      const name = el("span", "wb-name");
      const sweep = el("span", "wb-sweep");
      sweep.hidden = true;
      root.append(keycap(String(i + 1), "wb-key"), swatch, name, sweep);
      this.slots.push({ root, swatch, name, sweep });
      row.append(root);
      if (i === 0) {
        const swap = el("span", "wb-swap");
        swap.append(keycap("Q"));
        row.append(swap);
      }
    }
    this.hint.append(keycap("F"), this.hintLabel);
    this.hint.hidden = true;
    this.root.append(this.hint, row);
    this.root.hidden = true;
    uiRoot().append(this.root);
  }

  /** Another HUD module's element (an ability slot), docked at the right end of the slot row: it hides and scales with the bar. */
  dock(node: HTMLElement): void {
    this.row.append(node);
  }

  /**
   * `patchT`: the server time of the newest patch (when a changed `readyAt` was set). `serverNow`: the estimated current
   * server time, which the cooldown counts down against. `pickup`: the weapon F would take, if one is in reach.
   * `questLabel`: the quest token or parcel F would take instead.
   */
  update(me: PlayerState | undefined, patchT: number, serverNow: number, pickup: WeaponId | null, questLabel = ""): void {
    // The lobby hands out nothing yet: weapons arrive with the run.
    const show = me?.status === "alive";
    if (this.root.hidden === show) this.root.hidden = !show;
    if (!me || !show) return;
    this.render(me, patchT, serverNow, pickup, questLabel);
  }

  private render(me: PlayerState, patchT: number, serverNow: number, pickup: WeaponId | null, questLabel: string): void {
    const signature = `${me.weapon0}|${me.weapon1}|${me.slot}`;
    if (signature !== this.signature) {
      this.signature = signature;
      [me.weapon0, me.weapon1].forEach((id, i) => {
        const slot = this.slots[i]!;
        const w = weaponOf(id);
        slot.root.classList.toggle("empty", w === null);
        slot.root.classList.toggle("active", me.slot === i);
        // An empty slot is fists (what the hand fights with): dimmed, with a dashed swatch, but named.
        slot.swatch.style.background = w ? cssColor(WEAPONS[w].color) : "";
        slot.name.textContent = WEAPONS[w ?? FISTS].name;
      });
    }

    const hand = weaponOf(me.slot === 1 ? me.weapon1 : me.weapon0);
    let hint = "";
    if (pickup) {
      const take = WEAPONS[pickup].name;
      // With both slots full a pickup replaces the weapon in hand, which drops where the player stands.
      hint = me.weapon0 !== "" && me.weapon1 !== "" && hand ? `swap ${WEAPONS[hand].name} for ${take}` : `take ${take}`;
    } else if (questLabel) {
      hint = `take ${questLabel}`;
    }
    if (hint !== this.hintText) {
      this.hintText = hint;
      this.hintLabel.textContent = hint;
      this.hint.hidden = hint === "";
    }

    if (me.readyAt !== this.readyAt) {
      if (!isExtension(this.readyAt, me.readyAt, patchT)) this.maxDeg = 360;
      this.cooldown = nextCooldown(this.readyAt, this.cooldown, me.readyAt, patchT);
      this.readyAt = me.readyAt;
    }
    const left = this.readyAt - serverNow;
    const deg = Math.min(this.maxDeg, left > 0 ? Math.round(Math.min(1, left / this.cooldown) * 360) : 0);
    this.maxDeg = deg > 0 ? deg : 360;
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
