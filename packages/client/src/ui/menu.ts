// Hub menu: callsign → profile load → Glorious Victory balance, stats and the month's top players → Start Run.
// The server owns the profile; this panel only shows the last loaded copy and sends { profile, token } at join.
import { PROFILE_RE, RUN_START_KIT, itemDef, monthKey, type LeaderboardEntry, type ProfileDTO, type ProfileStats } from "@raid/shared";
import { ProfileError, fetchLeaderboard, fetchProfile, formatNumber } from "../net/profile";
import { el, uiRoot } from "./dom";

const PROFILE_KEY = "raid.profile";
const CALLSIGN_RULE = "Callsign: 2–16 letters, digits, _ or -";
const CALLSIGN_BUSY = "That callsign is still in a run (another tab, or your last run is still closing). Try again in a few seconds, or use another callsign.";
const LEADERBOARD_ROWS = 5;

const STAT_LABELS: ReadonlyArray<readonly [keyof ProfileStats, string]> = [
  ["runs", "Runs"], ["wins", "Wins"], ["draws", "Draws"], ["deaths", "Deaths"], ["kills", "Kills"],
];

type Tone = "info" | "warn" | "error";

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
}

export interface MenuHandlers {
  onStart(request: RaidRequest): void;
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
  private readonly cosmetics = el("span", "hub-cosmetics-count");
  private readonly board = el("div", "hub-board");
  private readonly boardList = el("ol", "hub-board-list");
  private readonly startBtn = el("button", "btn primary", "Start Run");
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
    shop.append(el("span", "hub-cosmetics-title", "Cosmetics"), this.cosmetics, el("span", "hub-cosmetics-note", "Shop coming soon"));

    this.board.hidden = true;
    this.board.append(el("div", "hub-board-title", "Top this month"), this.boardList);

    const kit = RUN_START_KIT.map((id) => itemDef(id)?.name ?? id).join(", ");
    const rules = el("div", "menu-rules", `Last one standing wins. Every run starts with: ${kit}. GV you earn is yours to keep even if you die, and winning pays a bonus. Three kills put a bounty on your head: whoever ends your rampage collects it.`);
    this.body.append(gv, stats, shop, this.board, rules);

    this.root.append(el("h1", undefined, "RAID"), row, this.placeholder, this.body, this.startBtn, this.status, this.hint);

    this.loadBtn.addEventListener("click", () => void this.load());
    this.startBtn.addEventListener("click", () => this.start());
    // A held Enter repeats keydown; one load per press is plenty.
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.repeat) void this.load(); });
    this.input.addEventListener("input", () => this.onEdit());
    this.updateView();
  }

  /** Shows the menu and (re)loads the callsign's profile, so the balance includes the run that just ended. */
  show(message = ""): void {
    this.busy = false;
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
    this.busy = busy;
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

  private start(): void {
    const data = this.data;
    if (!data || this.busy || this.loading) return;
    saveCallsign(data.profile.name);
    this.handlers.onStart({ profile: data.profile.name, token: data.token });
  }

  private setProfile(profile: ProfileDTO, token: string): void {
    this.data = { profile, token };
    // `?? 0`: a month nothing was banked in is absent from gvByMonth.
    this.gvBalance.textContent = formatNumber(profile.gv);
    this.gvLifetime.textContent = formatNumber(profile.gvLifetime);
    this.gvMonth.textContent = formatNumber(profile.gvByMonth[monthKey(Date.now())] ?? 0);
    for (const [key] of STAT_LABELS) this.statEls.get(key)!.textContent = formatNumber(profile.stats[key] ?? 0);
    this.cosmetics.textContent = `${formatNumber(profile.cosmetics.owned.length)} owned`;
    void this.loadBoard();
  }

  private clearProfile(): void {
    this.data = null;
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
    this.loadBtn.disabled = this.busy || this.loading;
    this.startBtn.disabled = this.busy || this.loading || !loaded;
  }
}
