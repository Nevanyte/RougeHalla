import { TILE, type GameMap } from "@raid/shared";
import { isTypingTarget } from "./chrome";
import { el, uiRoot } from "./dom";
import { canTalk } from "./questDialogMath";
import { placeQuestLog, type PlateBox, type UiSize } from "./questLogLayout";
import { questKindCss, questRows, type QuestCollection, type QuestPosition, type QuestMapBlip, type QuestRow } from "./questModel";
import "./questLog.css";

export interface QuestLogFrame {
  phase: string;
  training: boolean;
  quests: QuestCollection;
  hidden: number;
  localId: string;
  localName?: string;
  feed?: number;
  mobStats?: Readonly<Record<string, number>> | Map<string, number>;
  serverNow: number;
  ui?: UiSize;
  plate?: () => PlateBox | null;
  local?: QuestPosition;
  alive?: boolean;
  sight?: GameMap | null;
}

export interface QuestLogOptions {
  /** Opens the existing nearby-giver dialog. Acceptance remains server-validated at the giver. */
  onTalk?: (id: string) => void;
}

interface RowView {
  root: HTMLElement;
  time: HTMLElement;
  status: HTMLElement;
  progress: HTMLElement;
  acceptance: HTMLElement;
  reward: HTMLElement;
  meter: HTMLElement;
  fill: HTMLElement;
  track: HTMLButtonElement;
  talk: HTMLButtonElement;
}

/** Quests can be inspected during planning and during the run, including the practice explanation. */
export function questLogAvailable(phase: string): boolean {
  return phase === "active" || phase === "planning";
}

function insideDialog(node: unknown): boolean {
  const n = node as { closest?: (selector: string) => unknown } | null | undefined;
  return typeof n?.closest === "function" && n.closest('[role="dialog"]') !== null;
}

export class QuestLog {
  readonly element = el("section", "quest-log");
  readonly launcher = el("button", "quest-log-launcher", "Quests · J");
  readonly tracker = el("section", "quest-tracker");
  private readonly closeButton = el("button", "quest-log-close", "Close");
  private readonly untrackButton = el("button", "quest-tracker-untrack", "Untrack");
  private readonly trackerText = el("span", "quest-tracker-text");
  private readonly list = el("div", "quest-log-list");
  private readonly rumoured = el("div", "quest-log-rumoured");
  private readonly views = new Map<string, RowView>();
  private accepted = new Set<string>();
  private order = "";
  private open = false;
  private enabled = false;
  private placed = "";
  private tracked: string | null = null;
  private frame?: QuestLogFrame;
  private destination: QuestMapBlip | null = null;

  constructor(private readonly options: QuestLogOptions = {}) {
    this.element.setAttribute("aria-label", "Quest log");
    this.element.setAttribute("aria-live", "off");
    this.element.id = "quest-log";
    const head = el("div", "quest-log-title");
    head.append(el("h2", undefined, "Quests"), this.closeButton);
    this.closeButton.type = "button";
    this.closeButton.setAttribute("aria-label", "Close quest log");
    this.closeButton.addEventListener("click", () => this.setOpen(false));
    this.element.append(head, this.list, this.rumoured);
    this.element.hidden = true;
    this.launcher.type = "button";
    this.launcher.hidden = true;
    this.launcher.setAttribute("aria-controls", "quest-log");
    this.launcher.setAttribute("aria-expanded", "false");
    this.launcher.setAttribute("aria-keyshortcuts", "J");
    this.launcher.addEventListener("click", () => this.toggle());
    this.tracker.hidden = true;
    this.tracker.setAttribute("aria-label", "Tracked quest");
    this.untrackButton.type = "button";
    this.untrackButton.addEventListener("click", () => this.track(null));
    this.tracker.append(this.trackerText, this.untrackButton);
    uiRoot().append(this.launcher, this.element, this.tracker);
    for (const node of [this.element, this.launcher, this.tracker]) {
      for (const type of ["pointerdown", "mousedown", "touchstart", "wheel"]) node.addEventListener(type, this.stopPointer, { passive: true });
      node.addEventListener("contextmenu", this.noMenu);
    }
    // Capture Escape while this panel is open, before the scene reads it.
    window.addEventListener("keydown", this.onKeyDown, true);
  }

  get visible(): boolean { return this.open && this.enabled; }
  get trackedId(): string | null { return this.tracked; }

  toggle(): void {
    if (this.enabled) this.setOpen(!this.open);
  }

  track(id: string | null): void {
    if (id !== null && !this.rows().some((row) => row.id === id && !row.closed)) return;
    this.tracked = id;
    this.destination = null;
    if (this.frame) this.update(this.frame);
  }

  /** The same reachable destination the minimap draws, so the HUD never quotes distance to a different step. */
  setDestination(at: QuestMapBlip | null): void {
    this.destination = at;
    this.updateTracker(this.rows());
  }

  update(frame: QuestLogFrame): void {
    this.frame = frame;
    this.enabled = questLogAvailable(frame.phase);
    if (!this.enabled) {
      const active = document.activeElement;
      if (this.element.contains(active) || active === this.launcher) {
        (active as HTMLElement | null)?.blur?.();
      }
      this.open = false;
    }
    this.element.hidden = !this.visible;
    this.launcher.hidden = !this.enabled;
    this.launcher.setAttribute("aria-expanded", String(this.visible));
    const rows = frame.training ? [] : this.rows();
    const newlyAccepted = rows.find((row) => row.accepted && !row.closed && !this.accepted.has(row.id));
    this.accepted = new Set(rows.filter((row) => row.accepted).map((row) => row.id));
    if (this.tracked && !rows.some((row) => row.id === this.tracked && !row.closed)) this.tracked = null;
    if (newlyAccepted && this.tracked === null) this.tracked = newlyAccepted.id;
    this.updateTracker(rows);
    this.restoreFocusFromHiddenControl();
    if (!this.visible) return;
    this.place(frame);
    if (frame.training) {
      if (this.order !== "practice") {
        this.order = "practice";
        this.list.replaceChildren(el("p", "quest-log-empty", "No quests in practice"));
      }
      this.rumoured.hidden = true;
      this.restoreFocusFromHiddenControl();
      return;
    }
    const order = rows.map((row) => row.id).join("|");
    for (const row of rows) {
      const view = this.views.get(row.id) ?? this.createRow(row);
      this.views.set(row.id, view);
      this.updateRow(view, row, frame);
    }
    if (order !== this.order || this.list.children.length === 0) {
      this.order = order;
      this.list.replaceChildren(...(rows.length ? rows.map((row) => this.views.get(row.id)!.root) : [el("p", "quest-log-empty", "No quests revealed yet.")]));
    }
    for (const [id] of this.views) if (!rows.some((row) => row.id === id)) this.views.delete(id);
    this.rumoured.textContent = frame.hidden > 0 ? `+${frame.hidden} rumoured quest${frame.hidden === 1 ? "" : "s"} — explore to reveal them` : "";
    this.rumoured.hidden = frame.hidden === 0;
    this.restoreFocusFromHiddenControl();
  }

  private rows(): QuestRow[] {
    const f = this.frame;
    return f ? questRows(f.quests, f.localId, f.serverNow, f.localName, f.phase === "planning", f.feed, f.mobStats) : [];
  }

  private createRow(row: QuestRow): RowView {
    const root = el("article", "quest-log-row");
    const head = el("div", "quest-log-head");
    const time = el("time", "quest-log-time");
    head.append(el("h3", "quest-log-name", row.def.name), el("span", "quest-log-kind", row.def.kind));
    if (!row.closed) head.append(time);
    const progress = el("div", "quest-log-progress");
    const status = el("span", "quest-log-status");
    const count = el("span");
    progress.append(count, status);
    const acceptance = el("div", "quest-log-accept");
    const reward = el("div", "quest-log-reward");
    const meter = el("div", "quest-log-meter");
    const fill = el("span", "quest-log-meter-fill");
    meter.setAttribute("role", "progressbar");
    meter.setAttribute("aria-label", `${row.def.name} progress`);
    meter.setAttribute("aria-valuemin", "0");
    meter.append(fill);
    const actions = el("div", "quest-log-actions");
    const track = el("button", "quest-log-track", "Track");
    track.type = "button";
    track.addEventListener("click", () => this.track(this.tracked === row.id ? null : row.id));
    const talk = el("button", "quest-log-talk", "Talk & accept");
    talk.type = "button";
    talk.addEventListener("click", () => {
      if (talk.hidden) return;
      this.setOpen(false);
      this.options.onTalk?.(row.id);
    });
    actions.append(track, talk);
    root.append(head, el("div", "quest-log-giver", row.def.giver), el("p", "quest-log-objective", row.objective), meter, progress);
    if (row.acceptance) root.append(acceptance);
    root.append(reward, actions);
    return { root, time, status, progress: count, acceptance, reward, meter, fill, track, talk };
  }

  private updateRow(view: RowView, row: QuestRow, frame: QuestLogFrame): void {
    const tracked = row.id === this.tracked;
    view.root.className = `quest-log-row kind-${row.def.kind}${row.ready ? " ready" : ""}${row.closed ? " closed" : ""}${row.expired ? " expired" : ""}${tracked ? " tracked" : ""}`;
    view.root.style.setProperty("--quest-color", questKindCss(row.def.kind));
    view.time.textContent = row.time;
    // A closing row loses its timer and acceptance nodes, matching the server's history view.
    if (row.closed) { view.time.remove(); view.acceptance.remove(); }
    view.progress.textContent = `Your progress ${row.progress}`;
    view.status.textContent = row.status;
    view.acceptance.className = `quest-log-accept${row.accepted ? " yes" : " no"}`;
    view.acceptance.textContent = row.acceptance;
    view.reward.textContent = `Reward: ${row.reward}`;
    const [done, count] = row.progress.split("/").map(Number);
    view.meter.setAttribute("aria-valuemax", String(count));
    view.meter.setAttribute("aria-valuenow", String(done));
    view.fill.style.width = `${Math.max(0, Math.min(100, done! / count! * 100))}%`;
    view.track.hidden = row.closed;
    view.track.textContent = tracked ? "Untrack" : "Track";
    view.track.setAttribute("aria-pressed", String(tracked));
    view.talk.hidden = !this.options.onTalk || row.closed || frame.phase !== "active" || frame.alive === false || !frame.local || !row.quest.accepted || !canTalk(frame.sight ?? null, frame.local, row.quest);
    view.talk.textContent = row.accepted ? "View offer" : "Talk & accept";
  }

  private updateTracker(rows: QuestRow[]): void {
    const f = this.frame;
    const row = rows.find((r) => r.id === this.tracked && !r.closed);
    this.tracker.hidden = !f || f.phase !== "active" || f.training || f.alive === false || !row;
    if (!f || !row) return;
    const destination = this.destination;
    const step = !row.accepted ? `Talk to ${row.def.giver} to accept` : row.ready ? `Return to ${row.def.giver}` : destination?.waypoint?.label ?? row.objective;
    let length = 0;
    const route = destination?.route;
    if (route && f.local) {
      let from: QuestPosition = f.local;
      for (const point of route) { length += Math.hypot(point.x - from.x, point.y - from.y); from = point; }
    }
    const distance = destination && route ? ` · ${Math.ceil(length / TILE)} tiles along route` : "";
    this.trackerText.textContent = `${row.def.name} · ${step} · ${row.progress}${distance}`;
    this.trackerText.title = this.trackerText.textContent;
  }

  /** Keep keyboard focus out of controls that a live frame has just hidden. */
  private restoreFocusFromHiddenControl(): void {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    if (active === this.untrackButton) {
      if (!this.tracker.hidden) return;
      if (this.visible) this.closeButton.focus();
      else if (this.enabled) this.launcher.focus();
      else active.blur?.();
      return;
    }
    if (!this.visible || !this.element.contains(active)) return;
    const row = [...this.views.values()].find((view) => view.track === active || view.talk === active);
    if (!row || !active.hidden) return;
    const other = row.track === active ? row.talk : row.track;
    if (!other.hidden) {
      other.focus();
      return;
    }
    const next = [...this.views.values()].flatMap((view) => [view.track, view.talk]).find((button) => !button.hidden);
    (next ?? this.closeButton).focus();
  }

  private setOpen(open: boolean): void {
    if (!this.enabled || this.open === open) return;
    this.open = open;
    this.element.hidden = !open;
    this.launcher.setAttribute("aria-expanded", String(open));
    (open ? this.closeButton : this.launcher).focus();
  }

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
  private readonly noMenu = (event: Event): void => { event.preventDefault(); event.stopPropagation(); };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !this.enabled || isTypingTarget(event.target) || insideDialog(event.target)) return;
    if (event.code === "Escape" && this.visible) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setOpen(false);
    } else if (event.code === "KeyJ") {
      event.preventDefault();
      this.toggle();
    }
  };

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    for (const node of [this.element, this.launcher, this.tracker]) {
      for (const type of ["pointerdown", "mousedown", "touchstart", "wheel"]) node.removeEventListener(type, this.stopPointer);
      node.removeEventListener("contextmenu", this.noMenu);
      node.remove();
    }
  }
}
