// Hub menu: callsign → profile load → Glorious Victory balance, stats and the month's top players → Start Run or Training.
// The server owns the profile; this panel only shows the last loaded copy and sends { profile, token } at join.
// Over the walkable hub (scenes/HubScene.ts) it docks to the left; the scene's stations call back into `onStation`.
import {
  PROFILE_RE, WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, monthKey,
  type FactionId, type LeaderboardEntry, type ProfileDTO, type ProfileStats,
} from "@raid/shared";
import { factionOfStation, type HubStationId } from "../hub/hubLayout";
import { ProfileError, fetchLeaderboard, fetchProfile, formatNumber } from "../net/profile";
import { el, uiRoot } from "./dom";
import { HubPanels, type HubTabId } from "./hub/hubPanels";
import { equippedTitle, titleTag } from "./hub/hubUtil";
import { FactionPicker } from "./factionPicker";
import "./menuDock.css";

const PROFILE_KEY = "raid.profile";
const CALLSIGN_RULE = "Callsign: 2–16 letters, digits, _ or -";
const CALLSIGN_BUSY = "That callsign is still in a run (another tab, or your last run is still closing). Try again in a few seconds, or use another callsign.";
const LEADERBOARD_ROWS = 5;

const STAT_LABELS: ReadonlyArray<readonly [keyof ProfileStats, string]> = [
  ["runs", "Runs"], ["wins", "Wins"], ["draws", "Draws"], ["deaths", "Deaths"], ["kills", "Kills"],
];

type Tone = "info" | "warn" | "error";

const HUB_BUTTONS: ReadonlyArray<readonly [HubTabId, string]> = [
  ["shop", "Shop"], ["wardrobe", "Wardrobe"], ["achievements", "Achievements"], ["leaderboard", "Leaderboard"], ["counters", "Counters"],
];

const NOT_LOADED = "Load a callsign first";
/** Room left between the docked panel and the world, so the room is centred in what remains. */
const DOCK_GAP = 12;

// sessionStorage can throw (blocked site data); the callsign then just isn't remembered.
function savedCallsign(): string | null {
  try {
    return sessionStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

function saveCallsign(name: string): void {
  try {
    sessionStorage.setItem(PROFILE_KEY, name);
  } catch {
    // Ignored: see savedCallsign.
  }
}

function randomCallsign(): string {
  return `op-${Math.random().toString(36).slice(2, 6)}`;
}

/** `chosen`: the name came from ?profile= or this tab's earlier session, not from the random default. */
export function initialProfile(): { name: string; chosen: boolean } {
  const fromUrl = new URLSearchParams(location.search).get("profile");
  if (fromUrl && PROFILE_RE.test(fromUrl)) return { name: fromUrl, chosen: true };
  const saved = savedCallsign();
  if (saved && PROFILE_RE.test(saved)) return { name: saved, chosen: true };
  return { name: randomCallsign(), chosen: false };
}

export interface RaidRequest {
  profile: string;
  /** Proof of ownership returned with the loaded profile. */
  token: string;
  /** The faction picked in the hub; the server starts the player with it. Null before a first pick: none is asked for. */
  faction: FactionId | null;
}

export interface MenuHandlers {
  onStart(request: RaidRequest): void;
  /** A private practice room: nothing in it is recorded. */
  onTraining(request: RaidRequest): void;
}

interface Loaded {
  profile: ProfileDTO;
  token: string;
}

export class Menu {
  private readonly root = el("div", "panel menu");
  private readonly input = el("input", "menu-profile");
  private readonly loadBtn = el("button", "btn", "Load");
  private readonly placeholder = el("div", "menu-placeholder");
  private readonly body = el("div", "menu-body");
  private readonly gvBalance = el("span", "hub-gv-n", "0");
  private readonly gvLifetime = el("span", "hub-gv-sub-n", "0");
  private readonly gvMonth = el("span", "hub-gv-sub-n", "0");
  private readonly statEls = new Map<keyof ProfileStats, HTMLElement>();
  private readonly who = el("div", "hub-who");
  private readonly cosmetics = el("span", "hub-cosmetics-count");
  private readonly hubButtons: HTMLButtonElement[] = [];
  private readonly hub = new HubPanels({ onProfile: (profile) => this.showProfile(profile) });
  private readonly board = el("div", "hub-board");
  private readonly boardList = el("ol", "hub-board-list");
  private readonly picker = new FactionPicker();
  private readonly startBtn = el("button", "btn primary", "Start Run");
  private readonly trainBtn = el("button", "btn", "Training");
  private readonly stripName = el("span", "menu-strip-name");
  private readonly stripGv = el("span", "menu-strip-gv");
  private readonly dockToggle = el("button", "menu-dock-toggle");
  private readonly status = el("div", "menu-status");
  private readonly hint = el("div", "menu-hint", "Playing in two tabs? Open each with ?profile=name in the URL.");

  private data: Loaded | null = null;
  private loading = false;
  /** The callsign the current in-flight load is for; meaningful only while `loading`. */
  private loadingName = "";
  private busy = false;
  /** Bumped to abandon an in-flight load (a newer one started, the callsign was edited, or the menu closed). */
  private loadSeq = 0;
  /** Same idea for the leaderboard fetch, which starts after a load and never delays it. */
  private boardSeq = 0;
  /** The status line holds a message about the typed callsign (a load error or the invalid-callsign warning); the next edit or load clears it, other messages stay. */
  private statusIsTransient = false;
  /** True once this callsign is one the player picked, so returning to the menu reloads it without a click. */
  private chosen: boolean;
  /** Docked over the walkable hub (a compact panel on the left), and within that, folded to the callsign/GV strip. */
  private docked = false;
  private collapsed = false;
  private readonly profileListeners: Array<(profile: ProfileDTO | null) => void> = [];
  private readonly factionListeners: Array<(faction: FactionId) => void> = [];
  private readonly busyListeners: Array<(busy: boolean) => void> = [];

  constructor(private readonly handlers: MenuHandlers) {
    const initial = initialProfile();
    this.chosen = initial.chosen;
    this.input.value = initial.name;
    this.input.maxLength = 16;
    this.input.placeholder = "callsign";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;

    const row = el("div", "menu-row");
    const label = el("label", "menu-label", "Callsign");
    label.append(this.input);
    row.append(label, this.loadBtn);

    const gv = el("div", "hub-gv");
    const balance = el("div", "hub-gv-main");
    balance.append(this.gvBalance, el("span", "hub-gv-l", "Glorious Victory"));
    const subs = el("div", "hub-gv-subs");
    for (const [value, text] of [[this.gvLifetime, "Lifetime"], [this.gvMonth, "This month"]] as const) {
      const cell = el("div", "hub-gv-sub");
      cell.append(value, el("span", "hub-gv-sub-l", text));
      subs.append(cell);
    }
    gv.append(balance, subs);

    const stats = el("div", "menu-stats");
    for (const [key, text] of STAT_LABELS) {
      const n = el("span", "stat-n", "0");
      this.statEls.set(key, n);
      const cell = el("div", "stat");
      cell.append(n, el("span", "stat-l", text));
      stats.append(cell);
    }

    const shop = el("div", "hub-cosmetics");
    const hubActions = el("div", "hub-cosmetics-actions");
    for (const [tab, text] of HUB_BUTTONS) {
      const btn = el("button", "btn small", text);
      btn.addEventListener("click", () => this.hub.open(tab));
      this.hubButtons.push(btn);
      hubActions.append(btn);
    }
    shop.append(el("span", "hub-cosmetics-title", "Cosmetics"), this.cosmetics, hubActions);

    this.board.hidden = true;
    this.board.append(el("div", "hub-board-title", "Top this month"), this.boardList);

    const rules = el("div", "menu-rules", `Last one standing wins. Pick a faction before each run; you start with its signature weapon, and a second slot is yours to fill from chests and the ground. GV you earn is yours to keep even if you die. Winning a run of ${WIN_BONUS_MIN_PLAYERS}+ players pays a bonus if you damaged at least ${WIN_BONUS_MIN_OPPONENTS} of them. Three kills put a bounty on your head: whoever ends your rampage collects it.`);
    const controls = el("div", "menu-rules", "Right-click: move. Left-click: attack (hold to keep attacking; with a bow, hold to draw and release to loose). Q or 1/2: swap weapons. F: take a weapon. S: stop.");
    const hubControls = el("div", "menu-rules", "In the hub: right-click or WASD to walk, E (or a click) at a station to use it. The pedestals by the south wall pick your faction.");
    this.body.append(this.who, gv, stats, shop, this.board, this.picker.element, rules, hubControls, controls);

    const head = el("div", "menu-head");
    const strip = el("div", "menu-strip");
    strip.append(this.stripName, this.stripGv);
    this.dockToggle.type = "button";
    this.dockToggle.addEventListener("click", () => this.setCollapsed(!this.collapsed));
    head.append(el("h1", undefined, "RAID"), strip, this.dockToggle);

    const actions = el("div", "menu-actions");
    actions.append(this.startBtn, this.trainBtn);
    this.trainBtn.title = "A private room with practice dummies and every weapon. Nothing is recorded.";

    this.root.append(head, row, this.placeholder, this.body, actions, this.status, this.hint);

    this.loadBtn.addEventListener("click", () => void this.load());
    this.startBtn.addEventListener("click", () => this.startRun());
    this.trainBtn.addEventListener("click", () => this.startTraining());
    this.picker.onChange = (id) => {
      this.syncPick();
      for (const cb of this.factionListeners) cb(id);
    };
    this.syncPick();
    // A held Enter repeats keydown; one load per press is plenty.
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.repeat) void this.load(); });
    this.input.addEventListener("input", () => this.onEdit());
    this.clearStrip();
    this.updateDock();
    this.updateView();
  }

  // ---- the walkable hub

  /** The faction picked now (or on an earlier visit), or null before a first pick. */
  get faction(): FactionId | null {
    return this.picker.selected;
  }

  /** The profile on screen, or null while none is loaded. */
  get profile(): ProfileDTO | null {
    return this.data?.profile ?? null;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** True while the shop/wardrobe/... modal is open; the world ignores keys and clicks meanwhile. */
  get modalOpen(): boolean {
    return this.hub.isOpen;
  }

  /** Called whenever the profile on screen changes: a load, a purchase or equip, or it going away (null). */
  onProfileChange(cb: (profile: ProfileDTO | null) => void): void {
    this.profileListeners.push(cb);
  }

  /** Called when the player picks a different faction (the hub scene mirrors it on its pedestals and wheels). */
  onFactionChange(cb: (faction: FactionId) => void): void {
    this.factionListeners.push(cb);
  }

  /** Called when the menu goes busy (joining a room) or free again. */
  onBusyChange(cb: (busy: boolean) => void): void {
    this.busyListeners.push(cb);
  }

  /** Docks the panel to the left over the world (compact, with a fold-away toggle), or restores the centred panel. */
  setDocked(docked: boolean): void {
    this.docked = docked;
    if (!docked) this.collapsed = false;
    this.updateDock();
  }

  /** Pixels from the window's left edge the docked panel covers (0 when it isn't docked or shown). */
  dockInset(): number {
    if (!this.docked || !this.root.isConnected) return 0;
    return Math.ceil(this.root.getBoundingClientRect().right) + DOCK_GAP;
  }

  /** A station in the world was used. The panels and the picker work only with a loaded profile and a free menu. */
  onStation(id: HubStationId): void {
    if (this.busy) return;
    if (!this.data) {
      this.setStatus(this.loading ? "Loading profile…" : NOT_LOADED, "warn", true);
      return;
    }
    if (id === "arena") this.startRun();
    else if (id === "training") this.startTraining();
    else if (id === "shop" || id === "wardrobe" || id === "achievements" || id === "leaderboard" || id === "counters") this.hub.open(id);
    else {
      const faction = factionOfStation(id);
      if (faction) this.picker.select(faction);
    }
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = this.docked && collapsed;
    this.updateDock();
  }

  private updateDock(): void {
    this.root.classList.toggle("docked", this.docked);
    this.root.classList.toggle("collapsed", this.docked && this.collapsed);
    this.dockToggle.hidden = !this.docked;
    const folded = this.docked && this.collapsed;
    this.dockToggle.textContent = folded ? "›" : "‹";
    this.dockToggle.title = folded ? "Expand the menu" : "Fold the menu away";
    this.dockToggle.setAttribute("aria-label", this.dockToggle.title);
    this.dockToggle.setAttribute("aria-expanded", String(!folded));
  }

  private syncPick(): void {
    this.hub.setPick({ faction: this.picker.selected });
  }

  private emitProfile(profile: ProfileDTO | null): void {
    for (const cb of this.profileListeners) cb(profile);
  }

  private setBusyFlag(busy: boolean): void {
    if (busy === this.busy) return;
    this.busy = busy;
    for (const cb of this.busyListeners) cb(busy);
  }

  private clearStrip(): void {
    this.stripName.textContent = "RAID";
    this.stripGv.textContent = "";
  }

  /** Shows the menu and (re)loads the callsign's profile, so the balance includes the run that just ended. */
  show(message = ""): void {
    this.setBusyFlag(false);
    this.setStatus(message, "warn");
    uiRoot().append(this.root);
    if (this.chosen && PROFILE_RE.test(this.callsign)) void this.load();
    else this.updateView();
  }

  /**
   * The server says this callsign is already in a run: either another tab (usually "Duplicate tab" copied
   * sessionStorage, so both loaded the same name), or this tab's own run still holding its seat for a few
   * seconds after a dropped connection. Keep the name (the second case resolves itself) and just explain both.
   * Claiming a different name stays the player's call.
   */
  showCallsignBusy(): void {
    this.show();
    this.setStatus(CALLSIGN_BUSY, "warn", true);
  }

  /** The run is starting: what was loaded is stale by the time it ends (show() reloads it). */
  hide(): void {
    this.root.remove();
    this.loadSeq++;
    this.loading = false;
    this.clearProfile();
  }

  setBusy(busy: boolean, message = ""): void {
    this.setBusyFlag(busy);
    if (message) this.setStatus(message, "info");
    this.updateView();
  }

  private get callsign(): string {
    return this.input.value.trim();
  }

  private async load(): Promise<void> {
    if (this.busy) return;
    const name = this.callsign;
    if (!PROFILE_RE.test(name)) {
      this.setStatus(CALLSIGN_RULE, "warn", true);
      return;
    }
    // Already loading this very name (Enter during the auto-load, a double click): the result is on its way.
    if (this.loading && this.loadingName === name) return;
    const seq = ++this.loadSeq;
    this.loading = true;
    this.loadingName = name;
    if (this.statusIsTransient) this.setStatus("", "info");
    this.updateView();
    try {
      const res = await fetchProfile(name);
      if (seq !== this.loadSeq) return;
      this.chosen = true;
      saveCallsign(name);
      this.setProfile(res.profile, res.token);
      if (res.created) this.setStatus("New callsign claimed.", "info");
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.clearProfile();
      const message = err instanceof ProfileError ? err.message : "Could not load the profile";
      if (!(err instanceof ProfileError)) console.error(err);
      this.setStatus(message, "error", true);
    } finally {
      if (seq === this.loadSeq) {
        this.loading = false;
        this.updateView();
      }
    }
  }

  /** The callsign was typed in: whatever was loaded (or loading) belongs to the old text. */
  private onEdit(): void {
    const wasLoading = this.loading;
    if (wasLoading) { this.loadSeq++; this.loading = false; }
    if (this.data && (wasLoading || this.data.profile.name !== this.callsign)) this.clearProfile();
    if (this.statusIsTransient) this.setStatus("", "info");
    this.updateView();
  }

  /** What the Start Run button does: join a run with the loaded profile and the picked faction. */
  startRun(): void {
    const request = this.request();
    if (request) this.handlers.onStart(request);
  }

  /** The Training button: the same request, answered with a private practice room. */
  startTraining(): void {
    const request = this.request();
    if (request) this.handlers.onTraining(request);
  }

  /** The request for a room, or null while there is no loaded profile or the menu is busy or loading. */
  private request(): RaidRequest | null {
    const data = this.data;
    if (!data || this.busy || this.loading) return null;
    saveCallsign(data.profile.name);
    return { profile: data.profile.name, token: data.token, faction: this.picker.selected };
  }

  private setProfile(profile: ProfileDTO, token: string): void {
    this.data = { profile, token };
    this.showProfile(profile);
    this.hub.setProfile(profile);
    this.syncPick();
    void this.loadBoard();
    // The callsign box keeps focus after Enter, and the world ignores keys while a text field has it.
    if (this.docked && document.activeElement === this.input) this.input.blur();
  }

  /** Draws a profile; also how the hub panels hand back the newer copy a purchase or equip returns. */
  private showProfile(profile: ProfileDTO): void {
    if (this.data) this.data.profile = profile;
    const title = equippedTitle(profile);
    this.who.replaceChildren(el("span", "hub-who-name", profile.name), ...(title ? [titleTag(title)] : []));
    // `?? 0`: a month nothing was banked in is absent from gvByMonth.
    this.gvBalance.textContent = formatNumber(profile.gv);
    this.gvLifetime.textContent = formatNumber(profile.gvLifetime);
    this.gvMonth.textContent = formatNumber(profile.gvByMonth[monthKey(Date.now())] ?? 0);
    for (const [key] of STAT_LABELS) this.statEls.get(key)!.textContent = formatNumber(profile.stats[key] ?? 0);
    this.cosmetics.textContent = `${formatNumber(profile.cosmetics.owned.length)} owned`;
    this.stripName.textContent = profile.name;
    this.stripGv.textContent = `${formatNumber(profile.gv)} GV`;
    this.emitProfile(this.data?.profile ?? null);
  }

  private clearProfile(): void {
    this.data = null;
    this.clearStrip();
    this.emitProfile(null);
    this.hub.setProfile(null);
    this.boardSeq++;
    this.board.hidden = true;
    this.boardList.replaceChildren();
  }

  /** Best effort: no board (failure, or nobody has banked GV yet) just leaves the section hidden. */
  private async loadBoard(): Promise<void> {
    const seq = ++this.boardSeq;
    const res = await fetchLeaderboard(monthKey(Date.now()), LEADERBOARD_ROWS);
    if (seq !== this.boardSeq) return;
    this.showBoard(res?.entries ?? []);
  }

  private showBoard(entries: readonly LeaderboardEntry[]): void {
    const me = this.data?.profile.name;
    const rows = entries.slice(0, LEADERBOARD_ROWS).map((e, i) => {
      const row = el("li", e.name === me ? "hub-board-row me" : "hub-board-row");
      row.append(el("span", "hub-board-rank", String(i + 1)), el("span", "hub-board-name", e.name), el("span", "hub-board-gv", formatNumber(e.gv)));
      return row;
    });
    this.boardList.replaceChildren(...rows);
    this.board.hidden = rows.length === 0;
  }

  /** `transient`: tied to the callsign text as typed, so the next edit or load removes it. */
  private setStatus(text: string, tone: Tone, transient = false): void {
    this.status.textContent = text;
    this.status.className = `menu-status ${tone}`;
    this.statusIsTransient = transient;
  }

  /** Which half of the panel shows, and what is clickable; cheap enough to call after any state change. */
  private updateView(): void {
    const loaded = this.data !== null;
    this.body.hidden = !loaded;
    this.placeholder.hidden = loaded;
    this.placeholder.textContent = this.loading
      ? "Loading profile…"
      : "Press Load to open this callsign's hub.";
    this.root.classList.toggle("loading", this.loading);
    this.input.disabled = this.busy;
    this.picker.setDisabled(this.busy);
    this.loadBtn.disabled = this.busy || this.loading;
    this.startBtn.disabled = this.busy || this.loading || !loaded;
    this.trainBtn.disabled = this.busy || this.loading || !loaded;
    for (const btn of this.hubButtons) btn.disabled = this.busy;
  }
}
