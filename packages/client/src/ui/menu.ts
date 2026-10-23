// Main menu: callsign → profile load → stash (click items into the loadout) → Start Raid.
// The server owns the stash; this panel only shows the last loaded copy and sends the chosen uids at join.
import { INVENTORY_SLOTS, PROFILE_RE, itemDef, type ItemDTO, type ItemKind, type ProfileDTO, type ProfileStats } from "@raid/shared";
import { ProfileError, fetchProfile, formatValue, itemValue, totalValue } from "../net/profile";
import { el, uiRoot } from "./dom";
import { describeItem } from "./inventory";

const PROFILE_KEY = "raid.profile";
const CALLSIGN_RULE = "Callsign: 2–16 letters, digits, _ or -";
const CALLSIGN_BUSY = "That callsign is still in a raid (another tab, or your last raid is still closing). Try again in a few seconds, or use another callsign.";

/** Stash display order: gear first, then consumables, then valuables; dearer first within a kind. */
const KIND_ORDER: Record<ItemKind, number> = { weapon: 0, armor: 1, healing: 2, valuable: 3 };
const UNKNOWN_KIND_ORDER = 4;

const STAT_LABELS: ReadonlyArray<readonly [keyof ProfileStats, string]> = [
  ["raids", "Raids"], ["extracts", "Extracts"], ["deaths", "Deaths"], ["kills", "Kills"],
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

function stashOrder(a: ItemDTO, b: ItemDTO): number {
  const ka = itemDef(a.def)?.kind, kb = itemDef(b.def)?.kind;
  const byKind = (ka ? KIND_ORDER[ka] : UNKNOWN_KIND_ORDER) - (kb ? KIND_ORDER[kb] : UNKNOWN_KIND_ORDER);
  return byKind || itemValue(b.def) - itemValue(a.def) || a.def.localeCompare(b.def) || a.uid.localeCompare(b.uid);
}

export interface RaidRequest {
  profile: string;
  /** Proof of ownership returned with the loaded profile. */
  token: string;
  /** Stash item uids to bring (≤ INVENTORY_SLOTS). */
  loadout: string[];
}

export interface MenuHandlers {
  onStart(request: RaidRequest): void;
}

interface Loaded {
  profile: ProfileDTO;
  token: string;
  /** uid → def id, for the value at risk in the current loadout. */
  defs: Map<string, string>;
}

export class Menu {
  private readonly root = el("div", "panel menu");
  private readonly input = el("input", "menu-profile");
  private readonly loadBtn = el("button", "btn", "Load");
  private readonly placeholder = el("div", "menu-placeholder");
  private readonly body = el("div", "menu-body");
  private readonly statEls = new Map<keyof ProfileStats, HTMLElement>();
  private readonly stashTitle = el("span", "menu-stash-title", "Stash");
  private readonly stashValue = el("span", "menu-stash-value");
  private readonly grid = el("div", "stash-grid");
  private readonly emptyNote = el("div", "stash-empty", "Your stash is empty. You will go in empty-handed.");
  private readonly loadoutCount = el("span", "menu-loadout-count");
  private readonly loadoutRisk = el("span", "menu-loadout-risk");
  private readonly startBtn = el("button", "btn primary", "Start Raid");
  private readonly status = el("div", "menu-status");
  private readonly hint = el("div", "menu-hint", "Playing in two tabs? Open each with ?profile=name in the URL.");

  private data: Loaded | null = null;
  private readonly selected = new Set<string>();
  private cards = new Map<string, HTMLElement>();
  private loading = false;
  /** The callsign the current in-flight load is for; meaningful only while `loading`. */
  private loadingName = "";
  private busy = false;
  /** Bumped to abandon an in-flight load (a newer one started, the callsign was edited, or the menu closed). */
  private loadSeq = 0;
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

    const stats = el("div", "menu-stats");
    for (const [key, text] of STAT_LABELS) {
      const n = el("span", "stat-n", "0");
      this.statEls.set(key, n);
      const cell = el("div", "stat");
      cell.append(n, el("span", "stat-l", text));
      stats.append(cell);
    }
    const stashHead = el("div", "menu-stash-head");
    stashHead.append(this.stashTitle, this.stashValue);
    const loadout = el("div", "menu-loadout");
    loadout.append(this.loadoutCount, this.loadoutRisk);
    const risk = el("div", "menu-risk", "Items you bring are lost if you die.");
    this.body.append(stats, stashHead, this.grid, this.emptyNote, loadout, risk);

    this.root.append(el("h1", undefined, "RAID"), row, this.placeholder, this.body, this.startBtn, this.status, this.hint);

    this.loadBtn.addEventListener("click", () => void this.load());
    this.startBtn.addEventListener("click", () => this.start());
    // A held Enter repeats keydown; one load per press is plenty.
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.repeat) void this.load(); });
    this.input.addEventListener("input", () => this.onEdit());
    this.grid.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".stash-item");
      if (card?.dataset.uid) this.toggle(card.dataset.uid);
    });
    this.updateView();
  }

  /** Shows the menu and (re)loads the callsign's profile, so the stash reflects the raid that just ended. */
  show(message = ""): void {
    this.busy = false;
    this.setStatus(message, "warn");
    uiRoot().append(this.root);
    if (this.chosen && PROFILE_RE.test(this.callsign)) void this.load();
    else this.updateView();
  }

  /**
   * The server refused the join because this callsign is already in a raid, usually because "Duplicate tab" copied
   * sessionStorage and both tabs loaded the same name. Swaps in a fresh suggestion but does not load it: claiming a
   * name is the player's call.
   */
  /**
   * The server says this callsign is already in a raid: either another tab, or this tab's own raid
   * still holding its seat for a few seconds after a dropped connection. Keep the name (the second
   * case resolves itself) and just explain both.
   */
  showCallsignBusy(): void {
    this.show();
    this.setStatus(CALLSIGN_BUSY, "warn", true);
  }

  /** The raid is starting: the loadout has left the stash, so drop the selection and the now-stale stash. */
  hide(): void {
    this.root.remove();
    this.loadSeq++;
    this.loading = false;
    this.selected.clear();
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
      if (res.created) this.setStatus("New callsign claimed. Your starter kit is in the stash.", "info");
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
    this.handlers.onStart({ profile: data.profile.name, token: data.token, loadout: [...this.selected] });
  }

  private setProfile(profile: ProfileDTO, token: string): void {
    const defs = new Map<string, string>();
    for (const it of profile.stash) defs.set(it.uid, it.def);
    this.data = { profile, token, defs };
    // Items that left the stash since (lost in a raid, or a stale selection) can't stay selected.
    for (const uid of [...this.selected]) if (!defs.has(uid)) this.selected.delete(uid);

    for (const [key] of STAT_LABELS) this.statEls.get(key)!.textContent = formatValue(profile.stats[key] ?? 0);
    const n = profile.stash.length;
    this.stashTitle.textContent = `Stash · ${n} ${n === 1 ? "item" : "items"}`;
    this.stashValue.textContent = `Total value ${formatValue(totalValue(profile.stash))}`;

    const cards = new Map<string, HTMLElement>();
    const frag = document.createDocumentFragment();
    for (const it of [...profile.stash].sort(stashOrder)) {
      const card = this.buildCard(it);
      cards.set(it.uid, card);
      frag.append(card);
    }
    this.cards = cards;
    this.grid.replaceChildren(frag);
    this.emptyNote.hidden = n > 0;
    this.grid.hidden = n === 0;
    this.updateLoadout();
  }

  private clearProfile(): void {
    this.data = null;
    this.cards = new Map();
    this.grid.replaceChildren();
    this.selected.clear();
  }

  private buildCard(it: ItemDTO): HTMLElement {
    const d = describeItem(it.def);
    const card = el("button", "stash-item");
    card.type = "button";
    card.dataset.uid = it.uid;
    card.title = `${d.name}${d.info ? ` — ${d.info}` : ""}\nClick to bring it into the raid`;
    const swatch = el("span", "item-swatch");
    swatch.style.background = d.color;
    const main = el("span", "item-main");
    main.append(el("span", "item-name", d.name), el("span", "item-kind", itemDef(it.def)?.kind ?? "unknown"));
    card.append(swatch, main, el("span", "item-value", formatValue(itemValue(it.def))));
    const on = this.selected.has(it.uid);
    card.classList.toggle("selected", on);
    card.setAttribute("aria-pressed", String(on));
    return card;
  }

  /** Touches one card and the counter, not the whole grid. */
  private toggle(uid: string): void {
    if (this.busy || this.loading) return;
    const card = this.cards.get(uid);
    if (!card) return;
    if (this.selected.has(uid)) this.selected.delete(uid);
    else if (this.selected.size < INVENTORY_SLOTS) this.selected.add(uid);
    else return;
    const on = this.selected.has(uid);
    card.classList.toggle("selected", on);
    card.setAttribute("aria-pressed", String(on));
    this.updateLoadout();
  }

  private updateLoadout(): void {
    const n = this.selected.size;
    const full = n >= INVENTORY_SLOTS;
    this.grid.classList.toggle("full", full);
    this.loadoutCount.textContent = `Loadout ${n}/${INVENTORY_SLOTS}${full ? " (full)" : ""}`;
    let atRisk = 0;
    for (const uid of this.selected) atRisk += itemValue(this.data?.defs.get(uid) ?? "");
    this.loadoutRisk.textContent = n > 0 ? `${formatValue(atRisk)} value at risk` : "Click items to bring them";
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
      ? "Loading stash…"
      : "Press Load to see this callsign's stash and pick a loadout.";
    this.root.classList.toggle("loading", this.loading);
    this.input.disabled = this.busy;
    this.loadBtn.disabled = this.busy || this.loading;
    this.startBtn.disabled = this.busy || this.loading || !loaded;
    this.grid.classList.toggle("locked", this.busy || this.loading);
  }
}
