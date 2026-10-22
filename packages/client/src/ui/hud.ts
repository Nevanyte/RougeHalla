// In-raid DOM overlay: phase/timer line and player vitals with equipped gear.
import { bestArmor, bestWeapon } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { el, uiRoot } from "./dom";

function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class Hud {
  private readonly root = el("div", "hud");
  private readonly status = el("div", "hud-status");
  private readonly vitals = el("div", "hud-vitals");
  private lastStatus = "";
  private lastVitals = "";

  constructor() {
    this.root.append(this.status, this.vitals);
    uiRoot().append(this.root);
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
        + ` · Weapon: ${bestWeapon(defs).name} · Armor: ${bestArmor(defs)?.name ?? "none"}`;
    }
    if (vitals !== this.lastVitals) { this.vitals.textContent = vitals; this.lastVitals = vitals; }
  }

  destroy(): void {
    this.root.remove();
  }
}
