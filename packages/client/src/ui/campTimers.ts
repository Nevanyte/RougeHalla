import type { GameMap } from "@raid/shared";
import { campLabel } from "./chestMath";
import { el, uiRoot } from "./dom";
import "./vision.css";
export interface PublicCamp { state: number; alive: number; respawnAt: number; wardOwner: string; wardExpiresAt: number }
export function campTimerLine(camp: PublicCamp, now: number, ownerName: string, total = 0): string {
  const state = camp.state === 2 ? "Cleared" : camp.state === 1 ? "Engaged" : "Alive";
  const seconds = (end: number) => `${Math.max(0, Math.ceil((end - now) / 1000))}s`;
  const respawn = camp.state === 2 && camp.respawnAt > now ? ` · Respawn ${seconds(camp.respawnAt)}` : camp.state === 2 && camp.respawnAt > 0 ? " · Respawn ready" : "";
  const ward = camp.wardOwner && camp.wardExpiresAt > now ? ` · Ward ${ownerName || "player"} ${seconds(camp.wardExpiresAt)}` : "";
  const count = total > 0 ? ` ${Math.max(0, Math.min(total, camp.alive))}/${total}` : "";
  return state + count + respawn + ward;
}
/** Public route information is available across the entire map, including outside personal vision. */
export class CampTimers {
  private readonly root = el("details", "camp-timers");
  private readonly list = el("div", "camp-timer-list");
  private signature = "";
  constructor() { this.root.append(el("summary", "", "Camps & wards"), this.list); uiRoot().append(this.root); }
  update(map: GameMap | undefined, camps: ArrayLike<PublicCamp>, now: number, active: boolean, name: (id: string) => string): void {
    this.root.hidden = !active;
    if (!map || !active) return;
    const lines = map.camps.map((def, i) => `${campLabel(def) ?? def.id} (${def.id}): ${camps[i] ? campTimerLine(camps[i]!, now, name(camps[i]!.wardOwner), def.spots.length) : "Alive"}`);
    const signature = lines.join("\n");
    if (this.signature === signature) return;
    this.signature = signature;
    this.list.replaceChildren(...lines.map((line) => el("div", "camp-timer", line)));
  }
  destroy(): void { this.root.remove(); }
}
