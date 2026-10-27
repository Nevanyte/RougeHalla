// The map screens of a run before and during the fight, one component in four modes (roguelike R3):
//   preview   the lobby: a small read-only map in the corner (zones, camps, crowns, matchups, who is here);
//   planning  load-in: the whole map, the two dealt spawns and their "taken" state, Ready, a countdown, and a route to draw;
//   map       hold Tab during the run: the map centred over the world with your route and where you are;
//   hidden    otherwise (the overlay is then `hidden`, so it takes no pointer and no key).
// It is not an Esc panel: nothing here is closed with Esc, and only the lobby corner and the planning screen take a click.
// The overlay is CSS-laid-out inside #ui (planning.css), so it follows a resize or fullscreen; the markers are real buttons
// placed by percent over the painted map (canvas), so the keyboard and screen readers reach them. Orders go out as `plan`
// inputs only; the deal and the route stay on this client (the route is never sent).
import {
  FACTIONS, campMatchup, isEliteCamp, isFactionId, nearestCamps, spawnWalks, walkSeconds,
  type CampDef, type ClientMessages, type FactionId, type GameMap, type PlanMessage, type Vec2,
} from "@raid/shared";
import { ORDER_EXPIRE_MS } from "../net/localMotion";
import { settings as appSettings, type Settings, type SettingsStore } from "../settings";
import { currentView, onViewChange } from "../view/viewState";
import type { ViewLayout } from "../view/viewport";
import { campTypeInfo, counterBuffs, counterHintLines } from "./campInfo";
import { el, uiRoot } from "./dom";
import {
  CROWN_CLIP_PATH, ZONE_PATTERN, paintCrates, paintMapBase, paintPlayer, paintRoute, zoneClipPath, zoneColor,
} from "./mapPainter";
import { mapSpan, minimapBacking, minimapToWorld } from "./minimapMath";
import {
  MAX_WAYPOINTS, ROUTE_REACH, cycleIndex, describeMatchup, formatClock, formatEta, fullMapSize, planningMapSize, previewMapSize,
  routeAhead, type RoutePlan,
} from "./planningMath";
import type { RouteState } from "./route";
import "./planning.css";

export type PlanningMode = "hidden" | "preview" | "planning" | "map";

/** Which mode the map screens are in for a room state: the lobby previews, planning plans, a run shows the map while Tab is held. */
export function planningModeFor(phase: string, o: { training: boolean; held: boolean }): PlanningMode {
  if (o.training) return "hidden";
  if (phase === "lobby") return "preview";
  if (phase === "planning") return "planning";
  if (phase === "active") return o.held ? "map" : "hidden";
  return "hidden";
}

export interface PlanningPlayer {
  faction: string;
  ready: boolean;
  /** The local player. */
  me: boolean;
}

/** What the scene hands the view each frame (only while the mode is not hidden). */
export interface PlanningFrame {
  mode: PlanningMode;
  /** The estimated server time now (the HUD's clock). */
  serverNow: number;
  /** RaidState.planEndsAt, 0 outside planning. */
  endsAt: number;
  /** The local player has pressed Ready (PlayerState.planReady). */
  meReady: boolean;
  players: readonly PlanningPlayer[];
  /** RaidState.camps[i].type for every camp, "" where unknown. */
  campTypes: readonly string[];
  /**
   * RaidState.camps[i].state for every camp (0 idle, 1 engaged, 2 cleared): a cleared camp is crossed out; an engaged one only
   * means somebody fought there once (the state never goes back), so it is marked as disturbed, not as a fight under way.
   * Absent: all idle.
   */
  campStates?: readonly number[];
  /** The local fighter's ground position, for the in-run map. */
  local: { x: number; y: number; alive: boolean } | null;
}

export interface PlanningViewOptions {
  map: GameMap;
  route: RouteState;
  /** Sends a `plan` input. */
  send: (msg: ClientMessages["plan"]) => void;
  /**
   * False while a send would be lost (the socket is reconnecting and drops what is typed meanwhile, net/connection.ts): a pick,
   * a boon or Ready is then neither sent nor shown as taken. Default: always.
   */
  canSend?: () => boolean;
  /** The clock for the pending orders' expiry, in ms (a test passes its own). Default: performance.now. */
  now?: () => number;
  /** The settings to follow (Show route, the text size); the app-wide store unless a test passes its own. */
  settings?: Pick<SettingsStore, "get" | "subscribe">;
}

/** Backing pixels per reference overlay pixel: marks drawn on the canvases (route, crates, you) scale with the map's size. */
const REF_PX = 320;
/** The route is faint in a run and in the lobby, full strength while it is being drawn. */
const ROUTE_ALPHA_RUN = 0.8;
/**
 * How long a click waits for the server's word (the next `plan` message for a pick or boon, `planReady` for Ready) before the
 * screen lets go of it: an order the server never applied (a socket that dropped it) must not lock the player out for the rest
 * of planning. The same wait the prediction gives a move order.
 */
export const PENDING_EXPIRE_MS = ORDER_EXPIRE_MS;
/** What the Ready button's title says while a send would be lost. */
export const RECONNECTING_TITLE = "Reconnecting... Ready is available again once the connection is back.";
const RECONNECTING_SAY = "Reconnecting: that was not sent. Try again once you are back.";
const NOT_CONFIRMED_SAY = "The server did not confirm your last choice. Check it and try again.";

/** A click on a camp within this many world units of an existing stop takes that stop out instead of adding another. */
const STOP_MERGE = ROUTE_REACH;

const campNumber = (camp: Pick<CampDef, "id">): string => /(\d+)$/.exec(camp.id)?.[1] ?? "";
const zoneName = (zone: FactionId): string => FACTIONS[zone].displayName;
const words = (id: string): string => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const pct = (v: number, span: number): string => `${Math.round((v / span) * 10000) / 100}%`;

/** A camp as one phrase: "Fire camp 2 (elite)". */
export function campTitle(camp: Pick<CampDef, "id" | "zone" | "eliteSpot">): string {
  const n = campNumber(camp);
  return `${zoneName(camp.zone)} camp${n ? ` ${n}` : ""}${isEliteCamp(camp) ? " (elite)" : ""}`;
}

interface CampMarker {
  camp: CampDef;
  button: HTMLButtonElement;
  chip: HTMLElement;
}

/** One dealt spawn: its card in the side column and its marker on the map. */
interface SpawnOption {
  index: 0 | 1;
  zone: FactionId | null;
  /** What the option is, before its state ("Spawn 1: Fire, 0:23 walk to the coliseum"). */
  label: string;
  card: HTMLButtonElement;
  badge: HTMLElement;
  marker: HTMLButtonElement | null;
}

/** A zone's shape as an element that clips itself to it, in the zone's colour (set through --zone on an ancestor). */
function glyph(zone: FactionId): HTMLElement {
  const g = el("span", "pl-glyph");
  g.style.setProperty("clip-path", zoneClipPath(zone));
  g.setAttribute("aria-hidden", "true");
  return g;
}

function crown(): HTMLElement {
  const c = el("span", "pl-crown");
  c.style.setProperty("clip-path", CROWN_CLIP_PATH);
  c.setAttribute("aria-hidden", "true");
  return c;
}

export class PlanningView {
  /** The overlay's root: put in #ui at construction. */
  readonly element = el("div", "planning");
  private readonly settings: Pick<SettingsStore, "get" | "subscribe">;
  private readonly route: RouteState;
  private readonly send: (msg: ClientMessages["plan"]) => void;
  private readonly canSend: () => boolean;
  private readonly now: () => number;
  private map: GameMap;

  // The map, layered: the painted base, the route and you, the labels, the markers.
  private readonly base = el("canvas", "pl-base");
  private readonly dyn = el("canvas", "pl-route");
  private readonly zones = el("div", "pl-zones");
  private readonly markers = el("div", "pl-markers");
  private readonly mapWrap = el("div", "pl-mapwrap");

  // Sections, shown per mode.
  private readonly head = el("div", "pl-head");
  private readonly title = el("h2", "pl-title", "Planning");
  private readonly timer = el("div", "pl-timer");
  private readonly bar = el("div", "pl-bar");
  private readonly mapCol = el("div", "pl-mapcol");
  private readonly legend = el("ul", "pl-legend");
  private readonly side = el("div", "pl-side");
  private readonly spawnBox = el("section", "pl-box pl-spawns");
  private readonly boonBox = el("section", "pl-box pl-boons");
  private readonly readyRow = el("div", "pl-readyrow");
  private readonly readyButton = el("button", "pl-ready", "Ready");
  private readonly readyCount = el("span", "pl-readycount");
  private readonly playerBox = el("section", "pl-box pl-people");
  private readonly hintBox = el("section", "pl-box pl-hint");
  private readonly routeBox = el("section", "pl-box pl-routebox");
  private readonly routeText = el("div", "pl-route-text");
  private readonly routeNote = el("div", "pl-route-note");
  private readonly undoButton = el("button", "pl-undo", "Undo stop");
  private readonly clearButton = el("button", "pl-clear", "Clear route");
  private readonly info = el("div", "pl-info");
  private readonly status = el("div", "pl-status");

  private readonly camps: CampMarker[] = [];
  private spawnOptions: SpawnOption[] = [];
  private boonCards: HTMLButtonElement[] = [];
  private stopMarkers: HTMLButtonElement[] = [];
  /** What the spawn and boon buttons were built for: they are built again only when that changes, so a focused button stays. */
  private spawnStruct = "";
  private boonStruct = "";

  private shownMode: PlanningMode = "hidden";
  private plan: PlanMessage | null = null;
  private frame: PlanningFrame | null = null;
  // What a click showed before the server answered. Each lives PENDING_EXPIRE_MS at most (-1 = none): the server's word wins.
  private pendingPick: 0 | 1 | null = null;
  private pendingPickAt = -1;
  private pendingBoon: 0 | 1 | null = null;
  private pendingBoonAt = -1;
  private readyPendingAt = -1;
  /** PlayerState.planReady as of the last frame: the truth Ready follows. */
  private serverReady = false;
  private totalMs = 0;
  /** The marker that holds the tab stop among the map's buttons (the others are reached with the arrow keys). */
  private rover: HTMLButtonElement | null = null;
  private lastInfo = "";

  // What was last drawn, so a frame that changes nothing writes nothing.
  private keyTimer = "";
  private keyPeople = "";
  private keyCamps = "";
  private keyPlan = "";
  private keyRoute = "";
  private keyHint: string | null = null;
  private backing = 0;
  private layout: ViewLayout;
  private textScale = 1;
  private showRoute = true;
  private routeDirty = true;
  private focused = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(options: PlanningViewOptions) {
    this.map = options.map;
    this.route = options.route;
    this.send = options.send;
    this.canSend = options.canSend ?? (() => true);
    this.now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.settings = options.settings ?? appSettings;
    this.layout = currentView();

    this.build();
    this.applySettings(this.settings.get());
    this.unsubscribers.push(this.settings.subscribe((s) => this.applySettings(s)));
    this.unsubscribers.push(onViewChange((layout) => { this.layout = layout; this.applyView(); }));
    this.unsubscribers.push(this.route.subscribe(() => this.onRouteChanged()));
    window.addEventListener("keydown", this.onWindowKey);
    this.element.hidden = true;
    this.setMap(options.map);
    uiRoot().append(this.element);
  }

  get mode(): PlanningMode {
    return this.shownMode;
  }

  /** The spawn the player holds, as an index into the two dealt (-1 for none): the server's, or the click it has not answered yet. */
  get pick(): -1 | 0 | 1 {
    return this.pendingPick ?? this.plan?.pick ?? -1;
  }

  /** The player pressed Ready (the server says so, or the click still waits for its answer). */
  get ready(): boolean {
    return this.readyLatched;
  }

  /** Ready as the screen shows it: the server's word, or a click it has not answered yet (and has not outlived PENDING_EXPIRE_MS). */
  private get readyLatched(): boolean {
    return this.serverReady || this.readyPendingAt >= 0;
  }

  // ------------------------------------------------------------------------------------------------------ building

  private build(): void {
    const root = this.element;
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Match planning");

    this.timer.setAttribute("role", "timer");
    this.timer.setAttribute("aria-live", "off");
    this.head.append(this.title, this.timer);
    this.bar.setAttribute("aria-hidden", "true");

    this.base.setAttribute("aria-hidden", "true");
    this.dyn.setAttribute("aria-hidden", "true");
    this.zones.setAttribute("aria-hidden", "true");
    this.markers.setAttribute("role", "group");
    this.markers.setAttribute("aria-label", "Map markers. Arrow keys move between them.");
    this.mapWrap.append(this.base, this.dyn, this.zones, this.markers);
    this.dyn.addEventListener("click", this.onMapClick);
    this.dyn.addEventListener("contextmenu", (e: Event) => { if (this.shownMode === "planning") e.preventDefault(); });
    this.markers.addEventListener("keydown", this.onMarkerKey);

    this.legend.setAttribute("aria-label", "Zones");
    this.buildLegend();
    this.mapCol.append(this.head, this.bar, this.mapWrap, this.legend, this.info);

    this.spawnBox.setAttribute("aria-label", "Spawn options");
    this.boonBox.setAttribute("aria-label", "Start boons");
    this.playerBox.setAttribute("aria-label", "Players");
    this.hintBox.setAttribute("aria-label", "Counter buffs");
    this.routeBox.setAttribute("aria-label", "Route");

    this.readyButton.type = "button";
    this.readyButton.addEventListener("click", () => this.pressReady());
    this.readyRow.append(this.readyButton, this.readyCount);

    for (const b of [this.undoButton, this.clearButton]) b.type = "button";
    this.undoButton.addEventListener("click", () => { this.route.removeLast(); });
    this.clearButton.addEventListener("click", () => { this.route.clear(); });
    const routeButtons = el("div", "pl-routebuttons");
    routeButtons.append(this.undoButton, this.clearButton);
    this.routeBox.append(
      el("h3", "pl-h", "Your route"), this.routeText, routeButtons, this.routeNote,
      el("p", "pl-small", "Click the map or a camp to add a stop; click a stop to take it out. Only you see it, and it shows faintly in the run."),
    );

    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.side.append(this.spawnBox, this.boonBox, this.readyRow, this.playerBox, this.hintBox, this.routeBox, this.status);
    const body = el("div", "pl-body");
    body.append(this.mapCol, this.side);
    this.element.append(body);
  }

  private buildLegend(): void {
    this.legend.replaceChildren();
    for (const zone of ["fire", "sentenced", "plague", "frost", "holy"] as const) {
      const item = el("li", `pl-legend-item pattern-${ZONE_PATTERN[zone]}`);
      item.style.setProperty("--zone", zoneColor(zone));
      const swatch = el("span", "pl-swatch");
      swatch.setAttribute("aria-hidden", "true");
      item.append(glyph(zone), swatch, el("span", "pl-legend-name", zoneName(zone)));
      this.legend.append(item);
    }
  }

  /** Builds the markers and labels for a (new) map and paints it. */
  setMap(map: GameMap): void {
    this.map = map;
    this.camps.length = 0;
    this.markers.replaceChildren();
    this.zones.replaceChildren();
    this.spawnOptions = [];
    this.stopMarkers = [];
    this.spawnStruct = "";
    const span = mapSpan();
    const place = (node: HTMLElement, p: Vec2): void => {
      node.style.setProperty("left", pct(p.x, span));
      node.style.setProperty("top", pct(p.y, span));
    };
    for (const region of map.regions) {
      const label = el("div", "pl-zone");
      label.style.setProperty("--zone", zoneColor(region.id));
      label.append(glyph(region.id), el("span", "pl-zone-name", zoneName(region.id)));
      place(label, region.pole);
      this.zones.append(label);
    }
    map.camps.forEach((camp, i) => {
      const button = el("button", `pl-camp${isEliteCamp(camp) ? " elite" : ""}`);
      button.type = "button";
      button.style.setProperty("--zone", zoneColor(camp.zone));
      place(button, camp);
      if (isEliteCamp(camp)) button.append(crown());
      const chip = el("span", "pl-chip");
      chip.setAttribute("aria-hidden", "true");
      button.append(glyph(camp.zone), chip);
      button.addEventListener("click", () => this.onCampClick(i));
      for (const type of ["mouseenter", "focus"]) button.addEventListener(type, () => { this.setRover(button); this.showInfo(i); });
      for (const type of ["mouseleave", "blur"]) button.addEventListener(type, () => this.showInfo(-1));
      this.markers.append(button);
      this.camps.push({ camp, button, chip });
    });
    this.rover = null;
    this.keyCamps = "";
    this.keyPlan = "";
    this.keyRoute = "";
    this.routeDirty = true;
    this.backing = 0;
    this.applyView();
    this.refreshRover();
  }

  // ---------------------------------------------------------------------------------------------------------- size

  private applySettings(s: Readonly<Settings>): void {
    const scaleChanged = s.textScale !== this.textScale;
    if (s.showRoute !== this.showRoute) this.routeDirty = true;
    this.textScale = s.textScale;
    this.showRoute = s.showRoute;
    this.element.style.setProperty("--pl-text", String(this.textScale));
    if (scaleChanged) this.applyView();
  }

  /** The side of the map in overlay pixels for the current mode, and the canvases' backing store to match. */
  private applyView(): void {
    if (this.shownMode === "hidden") return;
    const { uiW, uiH, uiScale, dpr } = this.layout;
    const size = this.shownMode === "map" ? fullMapSize(uiW, uiH)
      : this.shownMode === "preview" ? previewMapSize(uiW, uiH) : planningMapSize(uiW, uiH, this.textScale);
    this.element.style.setProperty("--pl-size", `${size}px`);
    this.element.style.setProperty("--pl-glyph", String(Math.round(Math.min(1.25, Math.max(0.55, size / 640)) * 100) / 100));
    const backing = minimapBacking(size, uiScale, dpr);
    if (backing === this.backing) return;
    this.backing = backing;
    for (const c of [this.base, this.dyn]) { c.width = backing; c.height = backing; }
    const g = this.base.getContext("2d");
    if (g) {
      const k = backing / mapSpan();
      paintMapBase(g, this.map, backing, backing, k, { patterns: true });
      paintCrates(g, this.map.crateSpots, k, Math.max(1, backing / REF_PX));
    }
    this.routeDirty = true;
  }

  // -------------------------------------------------------------------------------------------------------- frames

  /** Hides the overlay (and gives back the keyboard if a button in it had it). */
  hide(): void {
    this.applyMode("hidden");
  }

  /** Call every frame while the mode is not "hidden". Writes only what changed. */
  update(frame: PlanningFrame): void {
    this.frame = frame;
    this.applyMode(frame.mode);
    if (frame.mode === "hidden") return;
    this.renderTimer(frame);
    this.renderPeople(frame);
    this.renderCamps(frame);
    this.renderPlan(frame);
    this.renderRoute(frame);
    this.renderHint(frame);
  }

  private applyMode(mode: PlanningMode): void {
    if (mode === this.shownMode) return;
    const wasPlanning = this.shownMode === "planning";
    this.shownMode = mode;
    this.element.setAttribute("data-mode", mode);
    this.element.hidden = mode === "hidden";
    const planning = mode === "planning";
    this.head.hidden = mode === "map";
    this.bar.hidden = !planning;
    this.timer.hidden = !planning;
    this.title.textContent = planning ? "Planning" : "Map preview";
    this.legend.hidden = mode === "hidden";
    this.info.hidden = mode === "map";
    this.side.hidden = mode === "map";
    // The camps stay on the held map (read-only); the dealt spawns and the route's stop buttons are for planning.
    this.markers.hidden = mode === "hidden";
    for (const o of this.spawnOptions) if (o.marker) o.marker.hidden = !planning;
    this.playerBox.hidden = mode === "map";
    for (const b of [this.spawnBox, this.readyRow, this.routeBox]) b.hidden = !planning;
    this.syncBoonBox();
    this.hintBox.hidden = !planning;
    this.showInfo(-1);
    this.keyPeople = "";
    this.keyRoute = "";
    this.keyHint = null;
    this.routeDirty = true;
    this.applyView();
    if (wasPlanning && !planning) {
      this.keyTimer = "";
      this.pendingPick = null;
      this.pendingPickAt = -1;
      this.pendingBoon = null;
      this.pendingBoonAt = -1;
      this.readyPendingAt = -1;
    }
    if (mode === "hidden") this.releaseFocus();
    else if (planning) this.focusFirst();
  }

  private syncBoonBox(): void {
    this.boonBox.hidden = this.shownMode !== "planning" || (this.plan?.boons.length ?? 0) === 0;
  }

  /** Planning starts with the first spawn option under the keyboard, so Tab, Enter and the arrow keys work at once. */
  private focusFirst(): void {
    if (this.focused) return;
    const first = this.spawnOptions[0]?.card;
    if (!first) return;
    const active = document.activeElement as { tagName?: string } | null;
    // Not from under something the player is using (an open settings card).
    if (active && active !== document.body && !this.element.contains(active as Node)) return;
    first.focus();
    this.focused = true;
  }

  private releaseFocus(): void {
    const active = document.activeElement as { blur?: () => void } | null;
    if (active && this.element.contains(active as Node)) active.blur?.();
  }

  private renderTimer(frame: PlanningFrame): void {
    if (this.shownMode !== "planning") return;
    const endsAt = frame.endsAt > 0 ? frame.endsAt : this.plan?.endsAt ?? 0;
    const left = endsAt > 0 ? endsAt - frame.serverNow : 0;
    if (left > this.totalMs) this.totalMs = left;
    const text = endsAt > 0 ? formatClock(left) : "";
    if (text === this.keyTimer) return;
    this.keyTimer = text;
    this.timer.textContent = text;
    this.bar.style.setProperty("--pl-progress", String(this.totalMs > 0 ? Math.round(Math.max(0, Math.min(1, left / this.totalMs)) * 1000) / 1000 : 0));
  }

  private renderPeople(frame: PlanningFrame): void {
    const key = frame.players.map((p) => `${p.faction}${p.ready ? "!" : ""}${p.me ? "*" : ""}`).join("|");
    if (key === this.keyPeople) return;
    this.keyPeople = key;
    const ready = frame.players.filter((p) => p.ready).length;
    this.readyCount.textContent = frame.players.length > 0 ? `Ready ${ready}/${frame.players.length}` : "";
    this.playerBox.replaceChildren(el("h3", "pl-h", "In this run"));
    const list = el("ul", "pl-peoplelist");
    for (const p of frame.players) {
      const faction: FactionId | null = isFactionId(p.faction) ? p.faction : null;
      const item = el("li", `pl-person${p.me ? " me" : ""}${p.ready ? " ready" : ""}`);
      if (faction) {
        item.style.setProperty("--zone", zoneColor(faction));
        item.append(glyph(faction));
      }
      const name = faction ? zoneName(faction) : "Unknown";
      item.append(el("span", "pl-person-name", p.me ? `${name} (you)` : name));
      if (this.shownMode === "planning") item.append(el("span", "pl-person-ready", p.ready ? "ready" : "planning"));
      list.append(item);
    }
    this.playerBox.append(list);
  }

  /** The matchup chips and the type lines of the camps: they follow the local faction and what the room says of each camp. */
  private renderCamps(frame: PlanningFrame): void {
    const me = this.myFaction(frame);
    const states = frame.campStates;
    const key = `${me ?? ""}|${frame.campTypes.join(",")}|${states ? states.join("") : ""}`;
    if (key === this.keyCamps) return;
    this.keyCamps = key;
    this.camps.forEach(({ camp, button, chip }, i) => {
      const m = me ? describeMatchup(campMatchup(me, camp)) : null;
      const state = states?.[i] ?? 0;
      button.classList.toggle("cleared", state === 2);
      button.classList.toggle("disturbed", state === 1);
      chip.textContent = m?.chip ?? "";
      chip.className = `pl-chip${m ? ` tone-${m.tone}` : ""}`;
      // A cleared camp has nothing left to weigh up: no matchup chip.
      chip.hidden = m === null || state === 2;
      const label = this.campLine(i, frame);
      button.setAttribute("aria-label", label);
      button.title = label;
    });
    this.lastInfo = "";
  }

  private myFaction(frame: PlanningFrame | null): FactionId | null {
    const me = frame?.players.find((p) => p.me);
    return me && isFactionId(me.faction) ? me.faction : null;
  }

  /** The full sentence for camp `i`: its name for screen readers, its tooltip and the info line. */
  private campLine(i: number, frame: PlanningFrame | null = this.frame): string {
    const marker = this.camps[i];
    if (!marker) return "";
    const { camp } = marker;
    const me = this.myFaction(frame);
    const info = campTypeInfo(frame?.campTypes[i]);
    const parts = [campTitle(camp)];
    if (info) parts.push(info.buff ? `${info.name}: ${info.buff}` : info.name);
    const state = frame?.campStates?.[i] ?? 0;
    if (state === 2) parts.push("Cleared");
    else if (state === 1) parts.push("Someone has fought here"); // history: the state is sticky, not a live fight
    if (me && state !== 2) parts.push(`For ${zoneName(me)}: ${describeMatchup(campMatchup(me, camp)).words}`);
    return parts.join(". ");
  }

  private showInfo(i: number): void {
    const text = i >= 0 ? this.campLine(i) : this.defaultInfo();
    if (text === this.lastInfo) return;
    this.lastInfo = text;
    this.info.textContent = text;
  }

  private defaultInfo(): string {
    if (this.shownMode === "planning") return "Hover or focus a camp to read it. Its chip is your matchup: the share of your hp left after a straight fight.";
    return "Hover or focus a camp to read it. Planning starts when the lobby fills.";
  }

  // -------------------------------------------------------------------------------------------------- the deal

  /** Takes the newest `plan` message (null clears it: a new room). The buttons are rebuilt only if the options themselves changed. */
  setPlan(plan: PlanMessage | null): void {
    const before = this.plan;
    this.plan = plan;
    this.pendingPick = null;
    this.pendingPickAt = -1;
    this.pendingBoon = null;
    this.pendingBoonAt = -1;
    // No plan at all is a new room: nothing pressed there is waiting for an answer here.
    if (!plan) this.readyPendingAt = -1;
    this.announceChanges(before, plan);
    this.keyPlan = "";
    if (this.frame && this.shownMode !== "hidden") this.renderPlan(this.frame);
    else this.syncBoonBox();
  }

  private announceChanges(before: PlanMessage | null, now: PlanMessage | null): void {
    if (!now || !before) return;
    for (const i of [0, 1] as const) {
      if (now.taken[i] && !before.taken[i]) this.say(`Spawn ${i + 1} was taken by another player.`);
      else if (!now.taken[i] && before.taken[i]) this.say(`Spawn ${i + 1} is free again.`);
    }
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  /** Lets go of a click the server has not answered within PENDING_EXPIRE_MS; true when it did. */
  private expirePending(): boolean {
    const at = this.now();
    let expired = false;
    const stale = (since: number): boolean => since >= 0 && at - since >= PENDING_EXPIRE_MS;
    if (stale(this.pendingPickAt)) { this.pendingPick = null; this.pendingPickAt = -1; expired = true; }
    if (stale(this.pendingBoonAt)) { this.pendingBoon = null; this.pendingBoonAt = -1; expired = true; }
    if (stale(this.readyPendingAt)) { this.readyPendingAt = -1; expired = true; }
    return expired;
  }

  private renderPlan(frame: PlanningFrame): void {
    const plan = this.plan;
    // Ready follows the server: its word clears the click that waited for it, and a frame that says "not ready" lets go of the latch.
    this.serverReady = frame.meReady;
    if (frame.meReady) this.readyPendingAt = -1;
    if (this.expirePending()) this.say(NOT_CONFIRMED_SAY);
    const latched = this.readyLatched;
    const connected = this.canSend();
    const me = this.myFaction(frame);
    const key = `${plan ? `${plan.spawns.join(",")}|${plan.taken.join(",")}|${plan.pick}|${plan.boons.join(",")}|${plan.boon}` : "none"}|${this.pendingPick}|${this.pendingBoon}|${latched}|${connected}|${me ?? ""}|${this.shownMode}`;
    if (key === this.keyPlan) return;
    this.keyPlan = key;
    this.syncSpawns(me);
    this.syncBoons();
    const planning = this.shownMode === "planning";
    for (const o of this.spawnOptions) this.styleSpawn(o, latched);
    this.readyButton.textContent = latched ? "Ready ✓" : "Ready";
    // Not while a press would be lost: the server would never hear it.
    this.readyButton.disabled = latched || !connected;
    this.readyButton.title = connected || latched ? "" : RECONNECTING_TITLE;
    this.readyButton.setAttribute("aria-pressed", String(latched));
    this.syncBoonBox();
    // The route starts where the player will: the spawn they hold (nowhere until they hold one).
    if (planning) this.route.setStart(this.pickedSpawn());
    if (planning) this.focusFirst();
  }

  /** The world position of the spawn the player holds, or null. */
  private pickedSpawn(): Vec2 | null {
    const pick = this.pick;
    if (!this.plan || pick === -1) return null;
    return this.map.spawnPool[this.plan.spawns[pick]] ?? null;
  }

  /** Builds the two spawn cards and their markers for the options dealt (again only when the options or the faction change). */
  private syncSpawns(me: FactionId | null): void {
    const plan = this.plan;
    const struct = plan ? `${plan.spawns.join(",")}|${me ?? ""}` : "none";
    if (struct === this.spawnStruct) return;
    this.spawnStruct = struct;
    for (const o of this.spawnOptions) o.marker?.remove();
    this.spawnOptions = [];
    this.spawnBox.replaceChildren(el("h3", "pl-h", "Pick a spawn"));
    if (!plan) {
      this.spawnBox.append(el("p", "pl-small", "Waiting for your spawn options…"));
      this.refreshRover();
      return;
    }
    const span = mapSpan();
    const walks = spawnWalks(this.map);
    const marks: HTMLButtonElement[] = [];
    ([0, 1] as const).forEach((index) => {
      const poolIndex = plan.spawns[index];
      const spawn = this.map.spawnPool[poolIndex];
      const zone = spawn?.zone ?? null;
      let label = `Spawn ${index + 1}: ${zone ? zoneName(zone) : "none"}`;

      const card = el("button", "pl-spawn");
      card.type = "button";
      if (zone) card.style.setProperty("--zone", zoneColor(zone));
      const head = el("span", "pl-spawn-head");
      const num = el("span", "pl-spawn-num", String(index + 1));
      num.setAttribute("aria-hidden", "true");
      head.append(num);
      if (zone) head.append(glyph(zone));
      head.append(el("span", "pl-spawn-zone", zone ? `${zoneName(zone)} edge` : "No spawn"));
      const badge = el("span", "pl-badge");
      head.append(badge);
      card.append(head);
      if (spawn) {
        const walk = walks[poolIndex];
        if (walk !== undefined && Number.isFinite(walk)) {
          const eta = formatEta(walkSeconds(walk));
          card.append(el("span", "pl-spawn-walk", `${eta} walk to the coliseum`));
          label += `, ${eta} walk to the coliseum`;
        }
        const near = el("span", "pl-near");
        near.append(el("span", "pl-near-label", "Nearest camps"));
        for (const camp of nearestCamps(this.map, spawn, 2)) {
          const item = el("span", "pl-near-item");
          item.style.setProperty("--zone", zoneColor(camp.zone));
          item.append(glyph(camp.zone));
          if (isEliteCamp(camp)) item.append(crown());
          if (me) {
            const m = describeMatchup(campMatchup(me, camp));
            item.append(el("span", `pl-chip tone-${m.tone}`, m.chip));
          }
          near.append(item);
        }
        card.append(near);
      }
      card.addEventListener("click", () => this.pickSpawn(index));
      this.spawnBox.append(card);

      let marker: HTMLButtonElement | null = null;
      if (spawn) {
        marker = el("button", "pl-spawnmark");
        marker.type = "button";
        marker.hidden = this.shownMode !== "planning";
        marker.style.setProperty("--zone", zoneColor(spawn.zone));
        marker.style.setProperty("left", pct(spawn.x, span));
        marker.style.setProperty("top", pct(spawn.y, span));
        marker.append(el("span", "pl-spawnmark-num", String(index + 1)));
        const m = marker;
        marker.addEventListener("click", () => this.pickSpawn(index));
        marker.addEventListener("focus", () => this.setRover(m));
        marks.push(marker);
      }
      this.spawnOptions.push({ index, zone, label, card, badge, marker });
    });
    // Before the camps in reading order (and in the tab order).
    this.markers.prepend(...marks);
    this.refreshRover();
  }

  /** Classes, text and ARIA of a spawn's card and marker for the state it is in: held by the player, taken, or free. */
  private styleSpawn(o: SpawnOption, latched: boolean): void {
    const plan = this.plan;
    if (!plan) return;
    const mine = this.pick === o.index;
    const taken = plan.taken[o.index] && !mine;
    const state = mine ? "your pick" : taken ? "taken by another player" : "free";
    const locked = (latched || taken) && !mine;
    const label = `${o.label}, ${state}`;
    for (const node of [o.card, o.marker]) {
      if (!node) continue;
      node.className = `${node === o.card ? "pl-spawn" : "pl-spawnmark"}${mine ? " picked" : ""}${taken ? " taken" : ""}`;
      node.setAttribute("aria-pressed", String(mine));
      node.setAttribute("aria-disabled", String(locked));
      node.setAttribute("aria-label", label);
      node.title = label;
    }
    o.badge.className = `pl-badge ${mine ? "mine" : taken ? "taken" : "free"}`;
    o.badge.textContent = mine ? "Your pick" : taken ? "Taken" : "Free";
  }

  private syncBoons(): void {
    const plan = this.plan;
    const struct = plan ? plan.boons.join(",") : "";
    if (struct !== this.boonStruct) {
      this.boonStruct = struct;
      this.boonBox.replaceChildren();
      this.boonCards = [];
      if (plan && plan.boons.length > 0) {
        this.boonBox.append(el("h3", "pl-h", "Start boon"));
        plan.boons.forEach((id, i) => {
          const card = el("button", "pl-boon", words(id));
          card.type = "button";
          card.addEventListener("click", () => this.pickBoon(i as 0 | 1));
          this.boonBox.append(card);
          this.boonCards.push(card);
        });
      }
    }
    if (!plan) return;
    const chosen = this.pendingBoon ?? plan.boon;
    this.boonCards.forEach((card, i) => {
      card.className = `pl-boon${chosen === i ? " picked" : ""}`;
      card.setAttribute("aria-pressed", String(chosen === i));
      card.setAttribute("aria-disabled", String(this.readyLatched && chosen !== i));
    });
  }

  private pickSpawn(i: 0 | 1): void {
    const plan = this.plan;
    if (!plan || this.readyLatched || this.shownMode !== "planning" || this.pick === i) return;
    if (plan.taken[i]) {
      this.say(`Spawn ${i + 1} is taken by another player.`);
      return;
    }
    if (!this.canSend()) {
      this.say(RECONNECTING_SAY);
      return;
    }
    this.pendingPick = i;
    this.pendingPickAt = this.now();
    this.send({ spawn: i });
    this.say(`You picked spawn ${i + 1}.`);
    this.keyPlan = "";
    if (this.frame) this.renderPlan(this.frame);
  }

  private pickBoon(i: 0 | 1): void {
    const plan = this.plan;
    if (!plan || this.readyLatched || this.shownMode !== "planning" || (this.pendingBoon ?? plan.boon) === i) return;
    if (!this.canSend()) {
      this.say(RECONNECTING_SAY);
      return;
    }
    this.pendingBoon = i;
    this.pendingBoonAt = this.now();
    this.send({ boon: i });
    this.keyPlan = "";
    if (this.frame) this.renderPlan(this.frame);
  }

  private pressReady(): void {
    if (this.readyLatched || this.shownMode !== "planning") return;
    if (!this.canSend()) {
      this.say(RECONNECTING_SAY);
      return;
    }
    // Shown at once, and kept only until the server's planReady says so (or PENDING_EXPIRE_MS passes without it).
    this.readyPendingAt = this.now();
    this.send({ ready: true });
    this.say("You are ready. Your picks are locked.");
    this.keyPlan = "";
    if (this.frame) this.renderPlan(this.frame);
  }

  // ------------------------------------------------------------------------------------------------------ route

  /** A stop was added or taken out (a click, a key, a button): drawn at once, so focus can move to a stop that is still there. */
  private onRouteChanged(): void {
    this.routeDirty = true;
    if (this.frame && this.shownMode !== "hidden") this.renderRoute(this.frame);
  }

  private renderRoute(frame: PlanningFrame): void {
    const planning = this.shownMode === "planning";
    const local = frame.local;
    const key = `${this.route.version}|${this.shownMode}|${this.showRoute}|${this.backing}${this.shownMode === "map" && local ? `|${Math.round(local.x / 8)},${Math.round(local.y / 8)},${local.alive}` : ""}`;
    if (key === this.keyRoute && !this.routeDirty) return;
    this.keyRoute = key;
    this.routeDirty = false;

    const plan = this.route.plan(this.map);
    const g = this.dyn.getContext("2d");
    if (g) {
      g.clearRect(0, 0, this.dyn.width, this.dyn.height);
      const k = this.backing / mapSpan();
      const px = Math.max(1, this.backing / REF_PX);
      if (planning) {
        // The stops are buttons while planning; the line is all the canvas draws.
        paintRoute(g, plan.points, [], k, px, { alpha: 1, next: -1 });
      } else if (this.showRoute) {
        const ahead = this.shownMode === "map"
          ? routeAhead(plan, this.route.next)
          : { points: plan.points, stops: plan.legs.map((l) => l.end), next: -1 };
        paintRoute(g, ahead.points, ahead.stops, k, px, { alpha: ROUTE_ALPHA_RUN, next: ahead.next });
      }
      if (this.shownMode === "map" && local) paintPlayer(g, local, local.alive, k, px);
    }

    if (planning) {
      this.renderStops();
      this.renderRouteText(plan);
    } else {
      this.clearStops();
    }
  }

  private clearStops(): void {
    if (this.stopMarkers.length === 0) return;
    for (const m of this.stopMarkers) m.remove();
    this.stopMarkers = [];
    this.refreshRover();
  }

  /** One numbered button per stop: clicking it (or Enter, or Delete, on it) takes the stop out. */
  private renderStops(): void {
    for (const m of this.stopMarkers) m.remove();
    this.stopMarkers = [];
    const span = mapSpan();
    this.route.waypoints.forEach((wp, i) => {
      const b = el("button", "pl-stop", String(i + 1));
      b.type = "button";
      b.style.setProperty("left", pct(wp.x, span));
      b.style.setProperty("top", pct(wp.y, span));
      const label = `Route stop ${i + 1}. Press Enter or Delete to take it out.`;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.addEventListener("click", () => this.removeStop(i));
      b.addEventListener("focus", () => this.setRover(b));
      this.markers.append(b);
      this.stopMarkers.push(b);
    });
    this.refreshRover();
  }

  /** Takes stop `i` out, and hands the keyboard to the stop that takes its place (or to the first camp) when it had it. */
  private removeStop(i: number): void {
    const hadFocus = this.stopMarkers[i] !== undefined && document.activeElement === this.stopMarkers[i];
    this.route.removeAt(i);
    if (!hadFocus) return;
    const next = this.stopMarkers[Math.min(i, this.stopMarkers.length - 1)] ?? this.camps[0]?.button;
    if (next) { this.setRover(next); next.focus(); }
  }

  private renderRouteText(plan: RoutePlan): void {
    const stops = this.route.waypoints.length;
    this.undoButton.disabled = stops === 0;
    this.clearButton.disabled = stops === 0;
    if (stops === 0) {
      this.routeText.textContent = "No stops yet";
      this.routeNote.textContent = "";
      return;
    }
    this.routeText.textContent = `${stops} stop${stops === 1 ? "" : "s"}${plan.start ? ` · ${formatEta(plan.seconds)} walk` : ""}`;
    const notes: string[] = [];
    if (!plan.start) notes.push("Pick a spawn to see the whole walk.");
    const skipped = plan.unreachable.length;
    if (skipped > 0) notes.push(`${skipped} stop${skipped === 1 ? " has" : "s have"} no way in and ${skipped === 1 ? "is" : "are"} skipped.`);
    if (stops >= MAX_WAYPOINTS) notes.push(`A route holds ${MAX_WAYPOINTS} stops.`);
    this.routeNote.textContent = notes.join(" ");
  }

  private renderHint(frame: PlanningFrame): void {
    if (this.shownMode !== "planning") return;
    const others = frame.players.filter((p) => !p.me).map((p) => p.faction);
    const key = others.join(",");
    if (key === this.keyHint) return;
    this.keyHint = key;
    const lines = counterHintLines(counterBuffs(others));
    this.hintBox.replaceChildren();
    this.hintBox.hidden = lines.length === 0;
    if (lines.length === 0) return;
    this.hintBox.append(el("h3", "pl-h", "Buffs that counter them"));
    for (const line of lines) this.hintBox.append(el("p", "pl-small", line));
  }

  /** A click on the map while planning: a stop where the pointer is. */
  private readonly onMapClick = (e: MouseEvent): void => {
    if (this.shownMode !== "planning") return;
    const at = minimapToWorld(e.clientX, e.clientY, this.dyn.getBoundingClientRect());
    if (!this.route.add(at)) this.say(`A route holds ${MAX_WAYPOINTS} stops.`);
  };

  /** A click on a camp's marker: while planning, a stop at the camp (or the stop already there, taken out). */
  private onCampClick(i: number): void {
    if (this.shownMode !== "planning") return;
    const camp = this.camps[i]?.camp;
    if (!camp) return;
    const at = this.route.waypoints.findIndex((w) => Math.hypot(w.x - camp.x, w.y - camp.y) <= STOP_MERGE);
    if (at >= 0) { this.route.removeAt(at); return; }
    if (!this.route.add({ x: camp.x, y: camp.y })) this.say(`A route holds ${MAX_WAYPOINTS} stops.`);
  }

  // -------------------------------------------------------------------------------------------------------- keys

  /** The map's buttons in reading order: the spawns, the camps, the route's stops. */
  private markerList(): HTMLButtonElement[] {
    const spawns = this.spawnOptions.flatMap((o) => (o.marker ? [o.marker] : []));
    return [...spawns, ...this.camps.map((c) => c.button), ...this.stopMarkers];
  }

  /** Roving tab stop: one marker is reachable with Tab, the arrow keys go between the rest. */
  private setRover(b: HTMLButtonElement): void {
    if (this.rover === b) return;
    this.rover = b;
    this.refreshRover();
  }

  private refreshRover(): void {
    const list = this.markerList();
    if (list.length === 0) return;
    if (!this.rover || !list.includes(this.rover)) this.rover = list[0]!;
    for (const b of list) b.tabIndex = b === this.rover ? 0 : -1;
  }

  private readonly onMarkerKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const list = this.markerList();
    const at = list.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    let to = -1;
    if (e.code === "ArrowRight" || e.code === "ArrowDown") to = cycleIndex(at, list.length, 1);
    else if (e.code === "ArrowLeft" || e.code === "ArrowUp") to = cycleIndex(at, list.length, -1);
    else if (e.code === "Home") to = 0;
    else if (e.code === "End") to = list.length - 1;
    else if (e.code === "Delete" || e.code === "Backspace") {
      const stop = this.stopMarkers.indexOf(list[at]!);
      if (stop < 0) return;
      e.preventDefault();
      this.removeStop(stop);
      return;
    }
    if (to < 0) return;
    e.preventDefault();
    const target = list[to];
    if (target) { this.setRover(target); target.focus(); }
  };

  /** 1 and 2 pick the spawns while planning (not while typing); everything else is the buttons'. */
  private readonly onWindowKey = (e: KeyboardEvent): void => {
    if (this.shownMode !== "planning" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (t && (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.tagName === "INPUT")) return;
    const m = /^(?:Digit|Numpad)([12])$/.exec(e.code);
    if (m) this.pickSpawn((Number(m[1]) - 1) as 0 | 1);
  };

  destroy(): void {
    window.removeEventListener("keydown", this.onWindowKey);
    for (const off of this.unsubscribers.splice(0)) off();
    this.releaseFocus();
    this.element.remove();
    this.base.width = 0;
    this.base.height = 0;
  }
}
