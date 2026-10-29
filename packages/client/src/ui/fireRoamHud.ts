import type { PlayerState } from "@raid/shared/schema";
import { FIRE_ROAM_CHARGE_MAX } from "@raid/shared";
import { el } from "./dom";
import "./fireRoamHud.css";

/** Boxless Fire-only progress and ready cue. The caller feeds the latest synced player state. */
export class FireRoamHud {
  readonly root = el("section", "fire-roam-hud");
  private readonly label = el("span", "fire-roam-label", "Roaming charge");
  private readonly value = el("span", "fire-roam-value", "0%");
  private readonly track = el("span", "fire-roam-track");
  private readonly fill = el("span", "fire-roam-fill");
  private readonly ready = el("span", "fire-roam-ready", "Burst ready");

  constructor(parent: HTMLElement) {
    this.root.setAttribute("aria-label", "Fire roaming charge");
    this.track.setAttribute("role", "meter");
    this.track.setAttribute("aria-label", "Roaming charge");
    this.track.setAttribute("aria-valuemin", "0");
    this.track.setAttribute("aria-valuemax", String(FIRE_ROAM_CHARGE_MAX));
    this.track.append(this.fill);
    const head = el("div", "fire-roam-head");
    head.append(this.label, this.value);
    this.ready.hidden = true;
    this.root.append(head, this.track, this.ready);
    this.root.hidden = true;
    parent.append(this.root);
  }

  update(me: PlayerState | undefined, phase: string, training: boolean): void {
    const active = me?.faction === "fire" && me.status === "alive" && (phase === "active" || training);
    this.root.hidden = !active;
    if (!active || !me) return;
    const syncedCharge = Number.isFinite(me.roamCharge) ? me.roamCharge : 0;
    const charge = Math.max(0, Math.min(FIRE_ROAM_CHARGE_MAX, syncedCharge));
    const percent = Math.round((charge / FIRE_ROAM_CHARGE_MAX) * 100);
    this.fill.style.setProperty("transform", `scaleX(${charge / FIRE_ROAM_CHARGE_MAX})`);
    this.value.textContent = `${String(percent).padStart(3, " ")}%`;
    this.track.setAttribute("aria-valuenow", String(charge));
    const isReady = me.roamReady === true;
    this.ready.hidden = !isReady;
    this.root.classList.toggle("ready", isReady);
    this.label.textContent = isReady ? "Fire roaming" : "Roaming charge";
  }

  destroy(): void {
    this.root.remove();
  }
}
