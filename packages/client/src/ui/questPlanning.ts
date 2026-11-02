import type { GameMap, Vec2 } from "@raid/shared";
import { el } from "./dom";
import { mapSpan } from "./minimapMath";
import { formatQuestTime, questKindCss, questRows, type QuestCollection, type QuestObjectiveMarker } from "./questModel";
import "./questPlanning.css";

export interface PlanningQuestFrame {
  mode: string;
  serverNow: number;
  localId: string;
  quests?: QuestCollection;
  hiddenQuests?: number;
  /** Private to localId: accepted fetch/collect objective points, not filtered by fog. */
  objectives?: readonly QuestObjectiveMarker[];
}

export class PlanningQuests {
  readonly element = el("section", "pl-box pl-quests");
  readonly markers = el("div", "pl-quest-marks");
  private map: GameMap | null = null;
  private quests: QuestCollection | null = null;
  private signature = "";
  private mode = "hidden";
  private readonly cards = new Map<string, { time: HTMLElement; progress: HTMLElement }>();

  constructor(private readonly onSelect: (at: Vec2) => void = () => {}) {
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
    this.mode = frame.mode;
    const interactiveMap = frame.mode === "map";
    const planning = frame.mode === "planning";
    this.element.hidden = !planning && !interactiveMap;
    this.markers.hidden = !planning && !interactiveMap;
    if (!planning && !interactiveMap) {
      if (this.markers.children.length) this.markers.replaceChildren();
      this.signature = "";
      return;
    }
    const rows = this.quests ? questRows(this.quests, frame.localId, frame.serverNow).filter((row) => row.quest.status === "open" && !row.expired) : [];
    if (interactiveMap) rows.sort((a, b) => Number(b.accepted) - Number(a.accepted));
    const hidden = Math.max(0, Math.floor(frame.hiddenQuests ?? 0));
    const objectives = interactiveMap ? frame.objectives ?? [] : [];
    const signature = `${frame.mode}|` + rows.map((r) => `${r.id}|${r.def.expiresAtSec}|${r.status}|${r.accepted}`).join("|")
      + `|${hidden}|${this.map?.seed ?? ""}|${objectives.map((o) => `${o.questId}:${o.itemId}:${o.action}:${o.x},${o.y}`).join(";")}`;
    if (signature === this.signature) {
      // Live countdowns must not rebuild the focused card or disturb the quest list's scroll position.
      if (interactiveMap) for (const row of rows) {
        const card = this.cards.get(row.id);
        if (!card) continue;
        const time = row.quest.expiresAt > 0 ? row.time : formatQuestTime(row.def.expiresAtSec * 1000);
        const progress = row.accepted ? `Accepted · ${row.progress}` : "Available · Talk to giver";
        if (card.time.textContent !== time) card.time.textContent = time;
        if (card.progress.textContent !== progress) card.progress.textContent = progress;
      }
      return;
    }
    this.signature = signature;
    this.cards.clear();
    this.element.replaceChildren(el("h3", "pl-h", "Known quests"));
    // Nothing counts before the player accepts, and accepting is a talk with the giver, so planning says where it happens.
    if (rows.length > 0) this.element.append(el("p", "pl-small pl-quest-accept", interactiveMap
      ? "Select a quest to add its giver to your route. Talk to the giver to accept."
      : "Accept at the giver in the run. The shown duration starts when the first player accepts; only accepted quests count."));
    if (rows.length === 0) this.element.append(el("p", "pl-small", "No public quest offers this run."));
    for (const row of rows) {
      const card = el("button", `pl-quest kind-${row.def.kind}${row.accepted ? " accepted" : ""}`);
      card.type = "button";
      card.title = `Add route stop for ${row.def.name}`;
      card.addEventListener("click", (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.mode === "planning" || this.mode === "map") this.onSelect(row.quest);
      });
      card.style.setProperty("--quest-color", questKindCss(row.def.kind));
      const head = el("div", "pl-quest-head");
      const duration = interactiveMap && row.quest.expiresAt > 0 ? row.time : formatQuestTime(row.def.expiresAtSec * 1000);
      const time = el("span", "pl-quest-time", duration);
      const progress = el("div", "pl-quest-progress", row.accepted ? `Accepted · ${row.progress}` : "Available · Talk to giver");
      this.cards.set(row.id, { time, progress });
      head.append(el("strong", "pl-quest-name", row.def.name), el("span", "pl-quest-kind", row.def.kind), time);
      card.append(head, el("div", "pl-quest-giver", row.def.giver), el("div", "pl-quest-reward", row.reward));
      if (interactiveMap) card.append(progress);
      this.element.append(card);
    }
    if (hidden > 0) this.element.append(el("p", "pl-small pl-quest-hidden", `+${hidden} rumoured — reveal them by exploring`));
    const returnIds = new Set(objectives.filter((o) => o.action === "return").map((o) => o.questId));
    const giverMarks = rows
      .filter((r) => !interactiveMap || !returnIds.has(r.id))
      .map((r) => ({ id: r.id, x: r.quest.x, y: r.quest.y, name: r.def.name, kind: r.def.kind }));
    this.paintMarkers(giverMarks, objectives);
  }

  private paintMarkers(
    quests: Array<Vec2 & { id: string; name: string; kind: "kill" | "collect" | "fetch" }>,
    objectives: readonly QuestObjectiveMarker[],
  ): void {
    this.markers.replaceChildren();
    const span = mapSpan();
    for (const quest of quests) {
      const mark = el("button", `pl-questmark kind-${quest.kind}`, "!");
      mark.type = "button";
      mark.setAttribute("aria-label", `Add route stop for quest: ${quest.name}`);
      mark.title = `Add route stop: ${quest.name}`;
      mark.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.mode === "planning" || this.mode === "map") this.onSelect(quest);
      });
      mark.style.setProperty("left", `${(quest.x / span) * 100}%`);
      mark.style.setProperty("top", `${(quest.y / span) * 100}%`);
      mark.style.setProperty("--quest-color", questKindCss(quest.kind));
      this.markers.append(mark);
    }
    for (const objective of objectives) {
      const action = objective.action === "return" ? "RETURN" : objective.marker === "parcel" ? "FETCH" : "TOKEN";
      const mark = el("button", `pl-questmark objective-item kind-${objective.kind} action-${objective.action}`, action);
      mark.type = "button";
      const intent = objective.action === "return"
        ? `return to the giver for ${objective.name}`
        : objective.marker === "parcel" ? `fetch the parcel for ${objective.name}` : `collect a token for ${objective.name}`;
      const label = `Add route stop to ${intent}`;
      mark.setAttribute("aria-label", label);
      mark.title = label;
      mark.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.mode === "planning" || this.mode === "map") this.onSelect(objective);
      });
      mark.style.setProperty("left", `${(objective.x / span) * 100}%`);
      mark.style.setProperty("top", `${(objective.y / span) * 100}%`);
      mark.style.setProperty("--quest-color", questKindCss(objective.kind));
      this.markers.append(mark);
    }
  }
}
