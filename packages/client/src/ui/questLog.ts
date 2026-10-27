import { el, uiRoot } from "./dom";
import { questKindCss, questRows, type QuestCollection, type QuestRow } from "./questModel";
import "./questLog.css";

export interface QuestLogFrame {
  phase: string;
  training: boolean;
  quests: QuestCollection;
  hidden: number;
  localId: string;
  localName?: string;
  serverNow: number;
  hudBottom?: number;
}

function typing(target: EventTarget | null): boolean {
  const node = target as { tagName?: string; isContentEditable?: boolean } | null;
  return node?.isContentEditable === true || node?.tagName === "INPUT" || node?.tagName === "TEXTAREA" || node?.tagName === "SELECT";
}

function rowElement(row: QuestRow): HTMLElement {
  const root = el("article", `quest-log-row kind-${row.def.kind}${row.ready ? " ready" : ""}${row.expired ? " expired" : ""}`);
  root.style.setProperty("--quest-color", questKindCss(row.def.kind));
  const head = el("div", "quest-log-head");
  head.append(el("h3", "quest-log-name", row.def.name), el("span", "quest-log-kind", row.def.kind), el("time", "quest-log-time", row.time));
  const objective = el("p", "quest-log-objective", row.objective);
  const progress = el("div", "quest-log-progress");
  progress.append(el("span", undefined, `Your progress ${row.progress}`), el("span", "quest-log-status", row.status));
  root.append(head, el("div", "quest-log-giver", row.def.giver), objective, progress, el("div", "quest-log-reward", `Reward: ${row.reward}`));
  return root;
}

export class QuestLog {
  readonly element = el("section", "quest-log");
  private readonly list = el("div", "quest-log-list");
  private readonly rumoured = el("div", "quest-log-rumoured");
  private open = false;
  private enabled = false;
  private signature = "";

  constructor() {
    this.element.setAttribute("aria-label", "Quest log");
    this.element.setAttribute("aria-live", "off");
    const head = el("div", "quest-log-title");
    head.append(el("h2", undefined, "Quests"), el("span", "quest-log-key", "J"));
    this.element.append(head, this.list, this.rumoured);
    this.element.hidden = true;
    uiRoot().append(this.element);
    for (const type of ["pointerdown", "mousedown", "touchstart", "contextmenu", "wheel"]) {
      this.element.addEventListener(type, this.stopPointer, { passive: true });
    }
    window.addEventListener("keydown", this.onKeyDown);
  }

  get visible(): boolean {
    return this.open && this.enabled;
  }

  toggle(): void {
    if (!this.enabled) return;
    this.open = !this.open;
    this.signature = "";
    this.element.hidden = !this.open;
  }

  update(frame: QuestLogFrame): void {
    this.enabled = frame.phase === "active" || frame.phase === "planning";
    this.element.hidden = !this.visible;
    if (!this.visible) return;
    const top = Math.max(20, Math.ceil(frame.hudBottom ?? 84) + 8);
    this.element.style.setProperty("--quest-log-top", `${top}px`);
    if (frame.training) {
      if (this.signature !== "practice") {
        this.signature = "practice";
        this.list.replaceChildren(el("p", "quest-log-empty", "No quests in practice"));
        this.rumoured.textContent = "";
        this.rumoured.hidden = true;
      }
      return;
    }
    const rows = questRows(frame.quests, frame.localId, frame.serverNow, frame.localName);
    const signature = rows.map((r) => `${r.id}|${r.time}|${r.progress}|${r.status}`).join("|") + `|${frame.hidden}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.replaceChildren(...(rows.length > 0 ? rows.map(rowElement) : [el("p", "quest-log-empty", "No quests revealed yet.")]));
    this.rumoured.textContent = frame.hidden > 0 ? `+${frame.hidden} rumoured quest${frame.hidden === 1 ? "" : "s"} — explore to reveal them` : "";
    this.rumoured.hidden = frame.hidden === 0;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    for (const type of ["pointerdown", "mousedown", "touchstart", "contextmenu", "wheel"]) {
      this.element.removeEventListener(type, this.stopPointer);
    }
    this.element.remove();
  }

  private readonly stopPointer = (event: Event): void => { event.stopPropagation(); };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "KeyJ" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
    event.preventDefault();
    this.toggle();
  };
}
