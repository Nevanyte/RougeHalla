// The hub's modal: a tab strip over interchangeable panels (shop, wardrobe, titles, achievements, leaderboard, counters).
// The server owns the profile. A panel never edits one: it asks for a purchase or an equip, and what comes back from
// the server is stored, drawn in every panel and handed to the menu.
import type { FactionId, ProfileDTO } from "@raid/shared";
import { ShopRequestError, equipCosmetic, fetchProfile, formatNumber, purchaseCosmetic } from "../../net/profile";
import { el, uiRoot } from "../dom";
import { AchievementsPanel } from "./achievementsPanel";
import { CounterWheel } from "./counterWheel";
import { ChampionsPanel } from "./championsPanel";
import { LeaderboardPanel } from "./leaderboardPanel";
import { ShopPanel } from "./shopPanel";
import { TitlesPanel } from "./titlesPanel";
import { WardrobePanel } from "./wardrobePanel";
import { WeaponsPanel } from "./weaponsPanel";

export type HubTabId = "champions" | "weapons" | "shop" | "wardrobe" | "titles" | "achievements" | "leaderboard" | "counters";
export interface HubPanelContext { shiftKey?: boolean }

/** One tab's contents. Panels build their DOM once and `render` only updates it, so focus and scroll survive a purchase. */
export interface HubPanel {
  /** The tab label. */
  readonly title: string;
  readonly root: HTMLElement;
  /** Public reference panels can be read before a callsign is loaded. */
  readonly requiresProfile?: boolean;
  /** Called with the latest profile whenever the hub is opened or the profile changes while it is open. */
  render(profile: ProfileDTO): void;
  /** The tab became visible / hidden (switching tabs, closing the hub). */
  onShow?(context?: HubPanelContext): void;
  onHide?(): void;
}

/**
 * What panels may ask of the server. Both resolve with the server's reply. The hub shows it unless a request issued
 * later has already been shown (panels run their own requests, so replies can arrive out of order).
 */
export interface HubActions {
  /** Rejects with a ShopRequestError. */
  purchase(id: string): Promise<ProfileDTO>;
  /** `id: null` takes the slot off. Rejects with a ShopRequestError. */
  equip(slot: string, id: string | null): Promise<ProfileDTO>;
}

export interface HubHandlers {
  /** The server sent back a newer profile (after a purchase or equip); the menu refreshes its balance from it. */
  onProfile(profile: ProfileDTO): void;
  onFactionPick?(id: FactionId): void;
}

interface Tab {
  id: string;
  panel: HubPanel;
  button: HTMLButtonElement;
  pane: HTMLElement;
}

/** After these the screen may be showing a stale balance or ownership, so the profile is fetched again. */
const RESYNC_AFTER = new Set(["unavailable", "already_owned", "not_owned", "insufficient_gv"]);

export class HubPanels {
  private readonly backdrop = el("div", "hub-backdrop");
  private readonly root = el("div", "panel hub-panel");
  private readonly whoName = el("span", "hub-head-name");
  private readonly balance = el("span", "hub-head-gv");
  private readonly tabBar = el("div", "hub-tabs");
  private readonly body = el("div", "hub-body");
  private readonly tabs: Tab[] = [];
  private readonly wheel = new CounterWheel();
  private readonly champions: ChampionsPanel;
  /** The faction the menu has picked; the Counters tab shows it whenever it is opened. */
  private pick: { faction: FactionId | null } = { faction: null };
  private active: Tab | null = null;
  private profile: ProfileDTO | null = null;
  private opened = false;
  private returnFocus: Element | null = null;
  /** Bumped when the profile goes away or changes callsign, so a reply for the old one is dropped. */
  private generation = 0;
  /** Numbers every request (actions and re-fetches) in the order it is sent. */
  private issued = 0;
  /** The number of the newest request whose reply is on screen. A reply numbered lower is an older snapshot. */
  private shown = 0;

  constructor(private readonly handlers: HubHandlers) {
    this.champions = new ChampionsPanel({ onPick: id => handlers.onFactionPick?.(id), onWeapons: () => this.show("weapons", true) });
    const actions: HubActions = {
      purchase: (id) => this.act((name) => purchaseCosmetic(name, id)),
      equip: (slot, id) => this.act((name) => equipCosmetic(name, slot, id)),
    };

    const close = el("button", "hub-close", "×");
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.close());

    const head = el("div", "hub-head");
    const who = el("div", "hub-head-who");
    who.append(this.whoName, this.balance);
    head.append(who, close);

    this.tabBar.setAttribute("role", "tablist");
    this.tabBar.addEventListener("keydown", (e) => this.onTabKey(e));
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Champions and player hub");
    this.root.append(head, this.tabBar, this.body);
    this.backdrop.append(this.root);
    // mousedown, not click: dragging a text selection out of the panel would otherwise end in a click on the backdrop.
    this.backdrop.addEventListener("mousedown", (e) => { if (e.target === this.backdrop) this.close(); });

    this.register("champions", this.champions);
    this.register("weapons", new WeaponsPanel());
    this.register("shop", new ShopPanel(actions));
    this.register("wardrobe", new WardrobePanel(actions));
    this.register("titles", new TitlesPanel(actions));
    this.register("achievements", new AchievementsPanel());
    this.register("leaderboard", new LeaderboardPanel());
    this.register("counters", this.wheel);
    this.setPick(this.pick);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The faction picked on the menu (null for none yet). The Counters tab highlights it and its signature weapon. */
  setPick(pick: { faction: FactionId | null }): void {
    this.pick = { faction: pick.faction };
    this.wheel.setPick(this.pick);
    this.champions.setPick(this.pick);
  }

  /** Adds a tab (the built-in ones are added by the constructor); works before and while the hub is open. */
  register(id: string, panel: HubPanel): void {
    const button = el("button", "hub-tab-btn", panel.title);
    button.type = "button";
    button.disabled = !this.profile && panel.requiresProfile !== false;
    button.id = `hub-tab-${id}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-controls", `hub-pane-${id}`);
    button.tabIndex = -1;
    button.addEventListener("click", event => this.show(id, false, { shiftKey: event.shiftKey }));

    const pane = el("div", "hub-pane");
    pane.id = `hub-pane-${id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", button.id);
    pane.hidden = true;
    pane.append(panel.root);

    this.tabs.push({ id, panel, button, pane });
    this.tabBar.append(button);
    this.body.append(pane);
    if (this.opened && this.profile) this.renderPanel(this.tabs[this.tabs.length - 1]!, this.profile);
  }

  /** The loaded profile. Account tabs require one; the champion reference remains available without it. */
  setProfile(profile: ProfileDTO | null): void {
    if (!profile) {
      this.generation++;
      this.profile = null;
      this.syncAvailability();
      this.close();
      return;
    }
    if (this.profile && this.profile.name !== profile.name) this.generation++;
    this.profile = profile;
    this.syncAvailability();
    if (this.opened) this.renderAll();
  }

  open(tab: HubTabId = "champions", context?: HubPanelContext): void {
    const target = this.tabs.find(t => t.id === tab);
    if (!target || !this.profile && target.panel.requiresProfile !== false) return;
    if (!this.opened) {
      this.opened = true;
      this.returnFocus = document.activeElement;
      uiRoot().append(this.backdrop);
      document.addEventListener("keydown", this.onKeyDown, true);
      this.renderAll();
    }
    this.show(tab, true, context);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.active?.panel.onHide?.();
    this.active = null;
    for (const t of this.tabs) {
      t.pane.hidden = true;
      t.button.setAttribute("aria-selected", "false");
      t.button.tabIndex = -1;
    }
    this.backdrop.remove();
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }

  /** Runs a request for the loaded callsign and stores what the server answers with. Never touches the profile itself. */
  private async act(request: (name: string) => Promise<ProfileDTO>): Promise<ProfileDTO> {
    const profile = this.profile;
    if (!profile) throw new ShopRequestError("unavailable", "No profile is loaded");
    const generation = this.generation;
    const seq = ++this.issued;
    try {
      const next = await request(profile.name);
      if (generation === this.generation) this.adopt(next, seq);
      return next;
    } catch (err) {
      if (err instanceof ShopRequestError && RESYNC_AFTER.has(err.code)) void this.resync(profile.name, generation);
      throw err;
    }
  }

  /** Shows a reply unless one from a request sent after it is already on screen (that one is the newer snapshot). */
  private adopt(profile: ProfileDTO, seq: number): void {
    if (seq <= this.shown) return;
    this.shown = seq;
    this.profile = profile;
    if (this.opened) this.renderAll();
    this.handlers.onProfile(profile);
  }

  /** Best effort: the request may or may not have landed, so ask the server what the profile is now. */
  private async resync(name: string, generation: number): Promise<void> {
    const seq = ++this.issued;
    try {
      const res = await fetchProfile(name);
      if (generation === this.generation && this.profile?.name === res.profile.name) this.adopt(res.profile, seq);
    } catch {
      // The status line already says what went wrong; the screen stays as it was.
    }
  }

  private renderAll(): void {
    const profile = this.profile;
    this.syncAvailability();
    this.whoName.textContent = profile?.name ?? "Champion guide";
    this.balance.hidden = !profile;
    this.balance.textContent = profile ? `${formatNumber(profile.gv)} GV` : "";
    if (!profile) return;
    for (const t of this.tabs) this.renderPanel(t, profile);
  }

  /** One broken panel must not take the others down with it. */
  private renderPanel(tab: Tab, profile: ProfileDTO): void {
    try {
      tab.panel.render(profile);
    } catch (err) {
      console.error(`Hub panel "${tab.id}" failed to render`, err);
    }
  }

  private syncAvailability(): void {
    for (const tab of this.tabs) tab.button.disabled = !this.profile && tab.panel.requiresProfile !== false;
  }

  private show(id: string, focus = false, context?: HubPanelContext): void {
    const next = this.tabs.find((t) => t.id === id && !t.button.disabled);
    if (!next) return;
    if (this.active !== next) {
      const prev = this.active;
      if (prev) {
        prev.pane.hidden = true;
        prev.button.setAttribute("aria-selected", "false");
        prev.button.tabIndex = -1;
        prev.panel.onHide?.();
      }
      this.active = next;
      next.pane.hidden = false;
      next.button.setAttribute("aria-selected", "true");
      next.button.tabIndex = 0;
      this.body.scrollTop = 0;
      next.panel.onShow?.(context);
    }
    if (focus) next.button.focus({ preventScroll: true });
  }

  private onTabKey(e: KeyboardEvent): void {
    const tabs = this.tabs.filter(t => !t.button.disabled);
    const at = tabs.findIndex((t) => t === this.active);
    if (at < 0) return;
    let to = at;
    if (e.key === "ArrowRight") to = (at + 1) % tabs.length;
    else if (e.key === "ArrowLeft") to = (at - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = tabs.length - 1;
    else return;
    e.preventDefault();
    this.show(tabs[to]!.id, true, { shiftKey: e.shiftKey });
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === "Tab") {
      this.trapFocus(e);
    }
  };

  /** Tab cycles inside the dialog, so the menu behind it can't be reached from the keyboard. */
  private trapFocus(e: KeyboardEvent): void {
    const stops = Array.from(this.root.querySelectorAll<HTMLButtonElement>("button")).filter((b) => !b.disabled && b.tabIndex >= 0 && b.offsetParent !== null);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (!at || !this.root.contains(at)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
