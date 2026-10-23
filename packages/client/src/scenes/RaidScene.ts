// Renders interpolated state and turns mouse/keyboard into input messages. No game rules here.
import Phaser from "phaser";
import { TICK_MS, generateMap, withGates, type ExtractZoneDef, type RaidResult, type TimedFx } from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";
import { sendInput, type RaidRoom } from "../net/connection";
import { EntityInterpolator } from "../net/interpolation";
import { ContainerHighlight } from "../render/ContainerHighlight";
import { ContainerView } from "../render/ContainerView";
import { FX_FUTURE_SLACK_MS, FxView } from "../render/FxView";
import { nearestContainer } from "../render/interact";
import { MapView } from "../render/MapView";
import { BODY_LIFT, PlayerView } from "../render/PlayerView";
import { projX, projY, unproject } from "../render/projection";
import { ZoneView } from "../render/ZoneView";
import { Hud } from "../ui/hud";
import { InventoryBar } from "../ui/inventory";
import { LootPanel } from "../ui/lootPanel";
import { Minimap } from "../ui/minimap";

export interface RaidSceneData {
  room: RaidRoom;
  /** Where short announcements ("<name> was killed") go; omitted, they are simply not shown. */
  toast?: (text: string) => void;
  /** True once the results panel is on screen; the "YOU DIED" line steps aside for it. Omitted, the line never yields. */
  resultsVisible?: () => boolean;
}

/** Right-button hold re-sends the move target at most this often. */
const MOVE_REPEAT_MS = 100;
/**
 * Left-button hold re-sends the attack this often: once per server tick, so an attack is always queued when a
 * cooldown ends (a slower repeat would fire up to a tick late). The server enforces the real weapon cooldown.
 */
const ATTACK_REPEAT_MS = TICK_MS;
/**
 * Shots travel at body height, so the cursor is read as a point BODY_LIFT pixels above the ground: clicking the
 * middle of a drawn player aims at that player's ground position instead of ~17 world units north of it.
 */
const AIM_HEIGHT = BODY_LIFT;

// Red screen flash when the local player loses hp: opacity scales with the hit, within these bounds.
const DAMAGE_FLASH_MS = 180;
const DAMAGE_FLASH_MIN = 0.12;
const DAMAGE_FLASH_MAX = 0.4;
const DAMAGE_FLASH_PER_HP = 0.012;
/** Hp lost in one frame at or above this restarts a flash already in progress (zone ticks are far below it). */
const DAMAGE_FLASH_FORCE_HP = 5;
/** Losses below this per frame (the zone's per-tick burn is ≤ 1.5 hp) don't flash. */
const DAMAGE_FLASH_MIN_HP = 2;

/** Shortcuts must never fire while the player is typing in a form control. */
function isTyping(target: EventTarget | null): boolean {
  for (const node of [target, document.activeElement]) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.isContentEditable || node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT") return true;
  }
  return false;
}

/** The extract zone whose circle (edge included) contains the point, or null. */
function extractZoneAt(zones: readonly ExtractZoneDef[], p: { x: number; y: number }): ExtractZoneDef | null {
  for (const z of zones) if (Math.hypot(p.x - z.x, p.y - z.y) <= z.r) return z;
  return null;
}

export class RaidScene extends Phaser.Scene {
  private room!: RaidRoom;
  private interp!: EntityInterpolator;
  private views = new Map<string, PlayerView>();
  private containerViews = new Map<string, ContainerView>();
  private mapView: MapView | null = null;
  private highlight!: ContainerHighlight;
  private zoneView!: ZoneView;
  private minimap!: Minimap;
  private hud!: Hud;
  private inventory!: InventoryBar;
  private lootPanel!: LootPanel;
  /** Container the local player could loot right now: alive, and in range with line of sight by the server's own rule. */
  private nearest: ContainerState | null = null;
  private marker!: Phaser.GameObjects.Ellipse;
  private lastMoveSentAt = 0;
  private lastAttackSentAt = 0;
  private fx!: FxView;
  private unbindFx: (() => void) | null = null;
  private unbindResult: (() => void) | null = null;
  /** Server time this frame is drawn at, captured in update(); inputs are stamped with it (see sendAttack). */
  private renderT = 0;
  private clockSynced = false;
  /** False until Phaser has seen the pointer, so Q cannot fire at its initial (0, 0). */
  private aimKnown = false;
  /** Local hp at the previous frame while alive, or -1 when unknown (not alive yet). */
  private lastHp = -1;
  /**
   * Players whose death fx is queued but not yet due, keyed by id. The death patch (status "dead", a new body) is
   * ahead of render time, so until renderT reaches `t` they are still drawn alive and their body stays hidden.
   */
  private readonly deaths = new Map<string, { t: number; x: number; y: number }>();
  private resultsVisible: (() => boolean) | undefined;
  private readonly tmp = { x: 0, y: 0 };
  /** Last rendered ground position per entity; read by dev tooling (window.__raid). */
  readonly rendered = new Map<string, { x: number; y: number }>();
  private readonly onState = (state: RaidState) => this.interp.onPatch(state, performance.now());
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor() {
    super("raid");
  }

  create(data: RaidSceneData): void {
    this.room = data.room;
    this.resultsVisible = data.resultsVisible;
    this.deaths.clear();
    this.interp = new EntityInterpolator();
    this.views = new Map();
    this.containerViews = new Map();
    this.rendered.clear();
    this.nearest = null;
    this.lastMoveSentAt = 0;
    this.lastAttackSentAt = 0;
    this.renderT = 0;
    this.clockSynced = false;
    this.aimKnown = false;
    this.lastHp = -1;
    this.hud = new Hud();
    this.inventory = new InventoryBar({
      onUse: (uid) => sendInput(this.room, "use", { uid }),
      onDrop: (uid) => sendInput(this.room, "drop", { uid }),
    });
    this.lootPanel = new LootPanel({
      onTake: (containerId, uid) => sendInput(this.room, "take", { containerId, uid }),
    });
    // Before buildMap: building a map repaints the minimap's static layer.
    this.minimap = new Minimap();
    this.buildMap(this.room.state.seed);
    this.highlight = new ContainerHighlight(this);
    this.zoneView = new ZoneView(this);
    this.fx = new FxView(this, {
      view: (id) => this.views.get(id),
      position: (id) => this.rendered.get(id),
      name: (id) => this.room.state.players.get(id)?.name,
      announce: data.toast,
    });
    this.unbindFx = this.room.onMessage("fx", (fx: TimedFx) => {
      if (fx?.kind === "death") this.noteDeath(fx.id, fx.t, fx.x, fx.y);
      this.fx.enqueue(fx);
    });
    // The killing result reaches the client before the dead-status patch, so the death line is driven from it.
    // main.ts holds the results panel back for a moment after a death; update() hides the line once it shows.
    this.unbindResult = this.room.onMessage("result", (r: RaidResult) => {
      if (r.outcome === "died") this.hud.showDeath();
    });

    this.marker = this.add.ellipse(0, 0, 18, 9).setStrokeStyle(2, 0x80deea, 1).setVisible(false).setDepth(1e6);

    this.room.onStateChange(this.onState);
    this.onState(this.room.state);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.aimKnown = true;
      if (!this.pointerStartedOnCanvas(pointer)) return;
      // The button that went down, not the buttons held: a second press while one is held must not read as the first.
      if (pointer.button === 2) this.sendMove(pointer, true);
      else if (pointer.button === 0) this.sendAttack(pointer);
    });
    this.input.on("pointermove", () => { this.aimKnown = true; });
    window.addEventListener("keydown", this.onKeyDown);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) (window as unknown as { __raid?: unknown }).__raid = { scene: this, room: this.room };
  }

  update(time: number): void {
    const state = this.room.state;
    if (state.seed !== this.mapView?.map.seed) this.buildMap(state.seed);
    // Read defensively: older servers' RaidState has no gatesLocked, and an absent flag means open gates.
    const gatesLocked = (state as { gatesLocked?: unknown }).gatesLocked === true;
    this.mapView?.setGatesLocked(gatesLocked);
    this.minimap.setGatesLocked(gatesLocked);

    const now = performance.now();
    // The one place render time is read: it consumes the clock's pending patch, so everything else this frame
    // (fx playback, attack timestamps between frames) reuses these values.
    const renderT = this.interp.renderTime(now);
    this.renderT = renderT;
    this.clockSynced = this.interp.clock.synced;
    for (const [id, d] of this.deaths) if (renderT >= d.t) this.deaths.delete(id);

    const pointer = this.input.activePointer;
    if (pointer.rightButtonDown() && this.pointerStartedOnCanvas(pointer) && time - this.lastMoveSentAt >= MOVE_REPEAT_MS) {
      this.sendMove(pointer, false);
    }
    if (pointer.leftButtonDown() && this.pointerStartedOnCanvas(pointer) && now - this.lastAttackSentAt >= ATTACK_REPEAT_MS) {
      this.sendAttack(pointer, true);
    }

    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      let view = this.views.get(id);
      if (!view) { view = new PlayerView(this, id === this.room.sessionId); this.views.set(id, view); }
      if (!this.interp.sample(id, renderT, this.tmp)) { this.tmp.x = p.x; this.tmp.y = p.y; }
      view.update(this.tmp.x, this.tmp.y, p, this.deathPending(id));
      let drawn = this.rendered.get(id);
      if (!drawn) { drawn = { x: 0, y: 0 }; this.rendered.set(id, drawn); }
      drawn.x = this.tmp.x;
      drawn.y = this.tmp.y;
      if (id === this.room.sessionId) this.cameras.main.centerOn(projX(this.tmp.x), projY(this.tmp.y));
    });
    for (const [id, view] of this.views) {
      if (!seen.has(id)) { view.destroy(); this.views.delete(id); this.rendered.delete(id); this.deaths.delete(id); }
    }

    // Interaction range is checked against the latest synced position (what the server uses), not the
    // interpolated one the player is drawn at, which trails it by INTERP_DELAY_MS.
    const me = state.players.get(this.room.sessionId);
    const map = this.mapView?.map;
    // Line of sight (looting) follows the server's walls, closed gates included. mapView.map stays the open map.
    const sightMap = gatesLocked && map ? withGates(map) : map;
    this.nearest = me?.status === "alive" && sightMap ? nearestContainer(state.containers, sightMap, me) : null;
    this.syncContainers(state);

    // After the views are updated: hit flashes target them and heal numbers follow where they are drawn.
    this.fx.update(renderT, now, this.clockSynced);
    this.trackDamage(me);

    // Both redraw only when the zone (or, for the minimap, the player's dot) actually moved.
    this.zoneView.update(state.zone);
    this.minimap.update(now, state.zone, this.rendered.get(this.room.sessionId), me?.status === "alive" || me?.status === "lobby");

    if (this.resultsVisible?.()) this.hud.noteResultShown();
    // Like interaction range, the zone test uses the latest synced position, which is what the server checks.
    this.hud.update(state, me, me?.status === "alive" && map ? extractZoneAt(map.extracts, me) : null);
    this.inventory.update(me);
    this.lootPanel.update(state, me, sightMap);
  }

  private syncContainers(state: RaidState): void {
    const seen = new Set<string>();
    state.containers.forEach((c, id) => {
      seen.add(id);
      let view = this.containerViews.get(id);
      if (!view) { view = new ContainerView(this); this.containerViews.set(id, view); }
      view.update(c);
      view.setHidden(this.bodyPending(c));
    });
    const nearestId = this.nearest?.id;
    for (const [id, view] of this.containerViews) {
      if (!seen.has(id)) { view.destroy(); this.containerViews.delete(id); continue; }
      view.setHighlight(id === nearestId);
    }
    if (this.nearest) this.highlight.show(this.nearest.x, this.nearest.y);
    else this.highlight.hide();
  }

  /** Remembers a death that FxView will play later, so the victim stays on screen until then (see `deaths`). */
  private noteDeath(id: string, t: number, x: number, y: number): void {
    if (id === this.room.sessionId) this.hud.showDeath();
    // FxView plays such an event at once (unsynced clock, or a stamp implausibly far ahead); there is nothing to wait for.
    if (!this.clockSynced || !Number.isFinite(t) || t > this.renderT + FX_FUTURE_SLACK_MS) return;
    this.deaths.set(id, { t, x, y });
  }

  /** True while this frame still shows the world from before `id` died. */
  private deathPending(id: string): boolean {
    const d = this.deaths.get(id);
    return d !== undefined && this.renderT < d.t;
  }

  /** The body a pending death will leave is synced ahead of what is drawn; it appears with the death, at the same spot. */
  private bodyPending(c: ContainerState): boolean {
    if (c.kind !== "body") return false;
    for (const d of this.deaths.values()) {
      if (this.renderT < d.t && Math.abs(c.x - d.x) < 1 && Math.abs(c.y - d.y) < 1) return true;
    }
    return false;
  }

  private sendMove(pointer: Phaser.Input.Pointer, showMarker: boolean): void {
    pointer.updateWorldPoint(this.cameras.main);
    const target = unproject(pointer.worldX, pointer.worldY);
    sendInput(this.room, "move", target);
    this.lastMoveSentAt = this.time.now;
    if (showMarker) {
      this.marker.setPosition(projX(target.x), projY(target.y)).setVisible(true).setAlpha(1).setScale(1);
      this.tweens.killTweensOf(this.marker);
      this.tweens.add({ targets: this.marker, alpha: 0, scale: 0.4, duration: 450 });
    }
  }

  /**
   * Attack toward the pointer. `t` is the server time this frame is drawn at, i.e. the world the player is looking
   * at when they click; the server rewinds targets to it (clamped to MAX_REWIND_MS). Omitted while the clock is
   * unsynced, when it would be meaningless, so the server just uses the present.
   */
  private sendAttack(pointer: Phaser.Input.Pointer, repeat = false): void {
    if (!this.localAlive()) return;
    pointer.updateWorldPoint(this.cameras.main);
    const target = unproject(pointer.worldX, pointer.worldY + AIM_HEIGHT);
    sendInput(this.room, "attack", this.clockSynced ? { x: target.x, y: target.y, t: this.renderT } : target);
    const now = performance.now();
    // Held repeats keep their phase on the tick grid: restarting the interval at `now` would stretch each one to a
    // whole number of frames (50 ms becomes 67 at 60 fps) and leave some ticks without an attack. A stall resets it.
    const onGrid = repeat && now - this.lastAttackSentAt < ATTACK_REPEAT_MS * 2;
    this.lastAttackSentAt = onGrid ? this.lastAttackSentAt + ATTACK_REPEAT_MS : now;
  }

  private localAlive(): boolean {
    return this.room.state.players.get(this.room.sessionId)?.status === "alive";
  }

  /** Red flash on the camera whenever the local player's hp drops between frames (shots, zone ticks). */
  private trackDamage(me: PlayerState | undefined): void {
    if (!me) { this.lastHp = -1; return; }
    // The drop is measured before the status check: the killing blow arrives as hp 0 together with status "dead".
    const lost = this.lastHp >= 0 ? this.lastHp - me.hp : 0;
    this.lastHp = me.status === "alive" ? me.hp : -1;
    // Small per-tick losses (zone burn) already have the tint and the HUD warning; only real hits flash.
    if (lost < DAMAGE_FLASH_MIN_HP) return;
    const cam = this.cameras.main;
    const force = lost >= DAMAGE_FLASH_FORCE_HP;
    // Writing alpha while a flash runs would pin it at the peak every frame (a constant red flicker).
    if (!force && cam.flashEffect.isRunning) return;
    // flashEffect.alpha is the flash's peak opacity; start() reads it, and the default of 1 would white-out the screen.
    cam.flashEffect.alpha = Math.min(DAMAGE_FLASH_MAX, DAMAGE_FLASH_MIN + lost * DAMAGE_FLASH_PER_HP);
    cam.flash(DAMAGE_FLASH_MS, 220, 20, 20, force);
  }

  /**
   * Phaser also listens for mouse events on the window, so a press on a DOM overlay (loot panel, inventory)
   * still reaches the scene's input; only presses that began on the canvas may issue a move.
   */
  private pointerStartedOnCanvas(pointer: Phaser.Input.Pointer): boolean {
    return pointer.downElement === this.game.canvas;
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    // Physical keys (e.code), not the produced character, so shortcuts keep working on non-Latin layouts.
    // Shift+digit drops the slot; a plain digit uses it.
    if (e.code === "KeyS") sendInput(this.room, "stop", {});
    else if (e.code === "KeyF") this.lootPanel.toggle(this.nearest);
    // The server decides whether this player is in a zone; the HUD hint only says when it is worth pressing.
    else if (e.code === "KeyX") { if (this.localAlive()) sendInput(this.room, "extract", {}); }
    // isOver: the last pointer position is stale (and meaningless) while the cursor is over a DOM panel.
    else if (e.code === "KeyQ") { if (this.aimKnown && this.input.isOver) this.sendAttack(this.input.activePointer); }
    else if (e.code === "Escape") this.lootPanel.close();
    else {
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!digit) return;
      const slot = Number(digit[1]) - 1;
      if (e.shiftKey) this.inventory.dropSlot(slot);
      else this.inventory.useSlot(slot);
    }
  }

  /** The map is never synced, only its seed; both sides derive it with generateMap. */
  private buildMap(seed: number): void {
    this.mapView?.destroy();
    const map = generateMap(seed);
    this.mapView = new MapView(this, map);
    this.minimap.setMap(map);
  }

  private teardown(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.room.onStateChange.remove(this.onState);
    this.unbindFx?.();
    this.unbindFx = null;
    this.unbindResult?.();
    this.unbindResult = null;
    this.fx.destroy();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    for (const v of this.containerViews.values()) v.destroy();
    this.containerViews.clear();
    this.mapView?.destroy();
    this.mapView = null;
    this.highlight.destroy();
    this.zoneView.destroy();
    this.minimap.destroy();
    this.rendered.clear();
    this.deaths.clear();
    this.hud.destroy();
    this.inventory.destroy();
    this.lootPanel.destroy();
    if (import.meta.env.DEV) {
      const w = window as unknown as { __raid?: { scene?: unknown } };
      if (w.__raid?.scene === this) delete w.__raid;
    }
  }
}
