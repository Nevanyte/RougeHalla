import { FACTIONS, isFactionId, type ClientMessages } from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { el, uiRoot } from "./dom";
import "./sentencedHuntHud.css";

type SendHunt = (message: ClientMessages["huntTarget"]) => void;

/** Small Sentenced-only target picker. Selection and completion remain server-authoritative. */
export class SentencedHuntHud {
  readonly root = el("section", "sentenced-hunt-hud");
  private readonly title = el("div", "sentenced-hunt-title");
  private readonly status = el("div", "sentenced-hunt-status");
  private readonly list = el("div", "sentenced-hunt-list");
  private signature = "";
  private pending = "";
  private pendingAt = 0;

  constructor(parent: HTMLElement = uiRoot()) {
    this.root.setAttribute("aria-label", "Sentenced hunt target");
    this.root.append(this.title, this.status, this.list);
    this.root.hidden = true;
    parent.append(this.root);
  }

  update(state: RaidState, localId: string, send: SendHunt): void {
    const me = state.players.get(localId);
    const active = state.phase === "active" && state.training !== true && me?.status === "alive" && me.faction === "sentenced";
    this.root.hidden = !active;
    if (!active || !me) { this.signature = ""; this.pending = ""; return; }

    const living: Array<{ id: string; name: string; faction: string }> = [];
    state.players.forEach((p: PlayerState, id: string) => {
      if (id !== localId && p.status === "alive") living.push({ id, name: p.name, faction: p.faction });
    });
    living.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const target = me.huntTarget ? state.players.get(me.huntTarget) : undefined;
    if (this.pending && (me.huntTarget === this.pending || Date.now() - this.pendingAt > 2500)) this.pending = "";
    const pendingPlayer = this.pending ? living.find((p) => p.id === this.pending) : undefined;
    const stacks = Number.isFinite(me.huntStacks) ? Math.max(0, me.huntStacks) : 0;
    const markBonus = Math.round(stacks * 2);
    const signature = [me.huntTarget, stacks, this.pending, target?.name ?? "", target?.status ?? "", ...living.flatMap((p) => [p.id, p.name, p.faction])].join("|");
    if (signature === this.signature) return;
    this.signature = signature;

    this.title.textContent = `Hunt · +${markBonus}% mark strength`;
    this.title.setAttribute("aria-label", `Sentenced hunt, completed hunts grant ${markBonus}% mark strength`);
    if (target?.status === "alive") {
      this.status.textContent = `Tracking ${target.name} · ${factionName(target.faction)}. +5% speed toward them; choose again when they fall.`;
      this.list.replaceChildren();
      return;
    }
    if (pendingPlayer) {
      this.status.textContent = `Selecting ${pendingPlayer.name}…`;
    } else {
      this.status.textContent = "Choose a living rival · +5% speed while moving toward them";
    }
    this.list.replaceChildren();
    for (const rival of living) {
      const button = el("button", "sentenced-hunt-choice");
      const faction = factionName(rival.faction);
      button.type = "button";
      button.textContent = `${rival.name} · ${faction}`;
      button.title = `Hunt ${rival.name} (${faction}): gain permanent vision of them and 5% movement speed while moving toward them.`;
      button.setAttribute("aria-label", button.title);
      button.disabled = !!this.pending;
      button.addEventListener("click", () => {
        if (this.pending) return;
        this.pending = rival.id;
        this.pendingAt = Date.now();
        this.signature = "";
        send({ id: rival.id });
      });
      this.list.append(button);
    }
  }

  destroy(): void { this.root.remove(); }
}

function factionName(id: string): string {
  return isFactionId(id) ? FACTIONS[id].displayName : "Rival";
}
