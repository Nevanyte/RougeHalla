// In-raid DOM overlay: phase/timer line, player vitals with equipped gear, and the "you died" line.
import { bestArmor, bestWeapon, type WeaponDef } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { el, uiRoot } from "./dom";

function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Pistol 16dmg range 260": the numbers are the catalog's own (world units), same as the inventory tooltips. */
function fmtWeapon(w: WeaponDef): string {
  return `${w.name} ${w.damage}dmg range ${w.range}`;
}

export class Hud {
  private readonly root = el("div", "hud");
  private readonly status = el("div", "hud-status");
  private readonly vitals = el("div", "hud-vitals");
  /** Centered over the world; a sibling of the HUD block (not a child) so it can sit mid-screen. */
  private readonly deathLine = el("div", "death-line", "YOU DIED");
  private lastStatus = "";
  private lastVitals = "";
  /** Set by showDeath(): the server's `result`/death fx arrive before the dead-status patch, so status alone is too late. */
  private deathRequested = false;
  private resultShown = false;
  private deathShown = false;

  constructor() {
    this.root.append(this.status, this.vitals);
    this.deathLine.hidden = true;
    uiRoot().append(this.root, this.deathLine);
  }

  /** The local player has died (killing result or death fx): show the line now, ahead of the results panel. */
  showDeath(): void {
    this.deathRequested = true;
    this.setDeathShown(!this.resultShown);
  }

  /** The results panel is actually on screen; the death line must not show through or reappear behind it. */
  noteResultShown(): void {
    this.resultShown = true;
    this.setDeathShown(false);
  }

  update(state: RaidState, me: PlayerState | undefined): void {
    let status: string;
    if (state.phase === "lobby") {
      status = `Waiting for players ${state.players.size}/${state.minPlayers} — raid starts in ${fmtSeconds(state.lobbyEndsAt - state.serverTime)}`;
    } else if (state.phase === "active") {
      status = `Raid ends in ${fmtSeconds(state.raidEndsAt - state.serverTime)} · ${state.players.size} in raid`;
    } else {
      status = "Raid over";
    }
    if (status !== this.lastStatus) { this.status.textContent = status; this.lastStatus = status; }

    let vitals = "";
    if (me) {
      // Equipped = best carried by the shared rules (items.ts); there is no equip action.
      const defs = me.inventory.map((it) => it.def);
      vitals = `${me.name} · HP ${Math.ceil(me.hp)}/${me.maxHp} · ${me.status}`
        + ` · Weapon: ${fmtWeapon(bestWeapon(defs))} · Armor: ${bestArmor(defs)?.name ?? "none"}`;
    }
    if (vitals !== this.lastVitals) { this.vitals.textContent = vitals; this.lastVitals = vitals; }

    this.setDeathShown((this.deathRequested || me?.status === "dead") && !this.resultShown);
  }

  private setDeathShown(shown: boolean): void {
    if (shown === this.deathShown) return;
    this.deathShown = shown;
    this.deathLine.hidden = !shown;
  }

  destroy(): void {
    this.root.remove();
    this.deathLine.remove();
  }
}
