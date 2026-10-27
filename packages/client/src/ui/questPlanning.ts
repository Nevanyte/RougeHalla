import type { GameMap, Vec2 } from "@raid/shared";
import { el } from "./dom";
import { mapSpan } from "./minimapMath";
import { formatQuestTime, questKindCss, questRows, type QuestCollection } from "./questModel";
import "./questPlanning.css";

export interface PlanningQuestFrame {
  mode: string;
  serverNow: number;
  localId: string;
  quests?: QuestCollection;
  hiddenQuests?: number;
}

export class PlanningQuests {
  readonly element = el("section", "pl-box pl-quests");
  readonly markers = el("div", "pl-quest-marks");
  private map: GameMap | null = null;
  private quests: QuestCollection | null = null;
  private signature = "";

  constructor() {
    this.element.setAttribute("aria-label", "Known quests");
    this.element.hidden = true;
  }

  setMap(map: GameMap): void {
    this.map = map;
    this.signature = "";
    this.markers.replaceChildren();
  }

  update(frame: PlanningQuestFrame): void {
    this.quests = frame.quests ?? null;
    const planning = frame.mode === "planning";
    this.element.hidden = !planning;
    this.markers.hidden = !planning;
    if (!planning) return;
    const rows = this.quests ? questRows(this.quests, frame.localId, frame.serverNow).filter((row) => row.quest.status === "open" && !row.expired) : [];
    const hidden = Math.max(0, Math.floor(frame.hiddenQuests ?? 0));
    const signature = rows.map((r) => `${r.id}|${r.def.expiresAtSec}|${r.status}`).join("|") + `|${hidden}|${this.map?.seed ?? ""}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.element.replaceChildren(el("h3", "pl-h", "Known quests"));
    // Nothing counts before the player accepts, and accepting is a talk with the giver, so planning says where it happens.
    if (rows.length > 0) this.element.append(el("p", "pl-small pl-quest-accept", "Accept at the giver in the run: only accepted quests count."));
    if (rows.length === 0) this.element.append(el("p", "pl-small", "No public quest offers this run."));
    for (const row of rows) {
      const card = el("div", `pl-quest kind-${row.def.kind}`);
      card.style.setProperty("--quest-color", questKindCss(row.def.kind));
      const head = el("div", "pl-quest-head");
      head.append(el("strong", "pl-quest-name", row.def.name), el("span", "pl-quest-kind", row.def.kind), el("span", "pl-quest-time", formatQuestTime(row.def.expiresAtSec * 1000)));
      card.append(head, el("div", "pl-quest-giver", row.def.giver), el("div", "pl-quest-reward", row.reward));
      this.element.append(card);
    }
    if (hidden > 0) this.element.append(el("p", "pl-small pl-quest-hidden", `+${hidden} rumoured — reveal them by exploring`));
    this.paintMarkers(rows.map((r) => ({ x: r.quest.x, y: r.quest.y, name: r.def.name, kind: r.def.kind })));
  }

  private paintMarkers(quests: Array<Vec2 & { name: string; kind: "kill" | "collect" | "fetch" }>): void {
    this.markers.replaceChildren();
    const span = mapSpan();
    for (const quest of quests) {
      const mark = el("span", `pl-questmark kind-${quest.kind}`, "!");
      mark.style.setProperty("left", `${(quest.x / span) * 100}%`);
      mark.style.setProperty("top", `${(quest.y / span) * 100}%`);
      mark.style.setProperty("--quest-color", questKindCss(quest.kind));
      this.markers.append(mark);
    }
  }
}
