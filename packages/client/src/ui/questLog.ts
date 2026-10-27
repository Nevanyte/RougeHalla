import { isTypingTarget } from "./chrome";
import { el, uiRoot } from "./dom";
import { placeQuestLog, type PlateBox, type UiSize } from "./questLogLayout";
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
  /** The overlay's laid-out size (`--ui-w` x `--ui-h`). */
  ui?: UiSize;
  /** The HUD plate's box; asked for only while the log is up, since it reads layout. */
  plate?: () => PlateBox | null;
}

/** The log opens in planning (the world is frozen, the known offers are public) and in the run, practice included. */
export function questLogAvailable(phase: string): boolean {
  return phase === "active" || phase === "planning";
}

/** The page's focus is inside one of its dialogs (the help card, the settings card): J is theirs, not the log's. */
function insideDialog(node: unknown): boolean {
  const n = node as { closest?: (selector: string) => unknown } | null | undefined;
  return typeof n?.closest === "function" && n.closest('[role="dialog"]') !== null;
}

function rowElement(row: QuestRow): HTMLElement {
  const root = el("article", `quest-log-row kind-${row.def.kind}${row.ready ? " ready" : ""}${row.closed ? " closed" : ""}${row.expired ? " expired" : ""}`);
  root.style.setProperty("--quest-color", questKindCss(row.def.kind));
  const head = el("div", "quest-log-head");
  head.append(el("h3", "quest-log-name", row.def.name), el("span", "quest-log-kind", row.def.kind));
  if (row.time !== "") head.append(el("time", "quest-log-time", row.time));
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
  private placed = "";

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
    this.enabled = questLogAvailable(frame.phase);
    this.element.hidden = !this.visible;
    if (!this.visible) return;
    this.place(frame);
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

  /** Under the HUD plate wherever it ends this frame; the style is written only when the box moved. */
  private place(frame: QuestLogFrame): void {
    if (!frame.ui) return;
    const box = placeQuestLog(frame.ui, frame.plate?.() ?? null);
    const key = `${box.left}|${box.top}|${box.width}|${box.maxHeight}`;
    if (key === this.placed) return;
    this.placed = key;
    const style = this.element.style;
    style.setProperty("--quest-log-left", `${box.left}px`);
    style.setProperty("--quest-log-top", `${box.top}px`);
    style.setProperty("--quest-log-width", `${box.width}px`);
    style.setProperty("--quest-log-max-h", `${box.maxHeight}px`);
  }

  private readonly stopPointer = (event: Event): void => { event.stopPropagation(); };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "KeyJ" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || !this.enabled) return;
    if (isTypingTarget(event.target) || insideDialog(event.target)) return;
    event.preventDefault();
    this.toggle();
  };
}
