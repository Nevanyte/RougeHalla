// Renders interpolated state and turns mouse/keyboard into input messages. No game rules here.
import Phaser from "phaser";
import { generateMap } from "@raid/shared";
import type { ContainerState, RaidState } from "@raid/shared/schema";
import { sendInput, type RaidRoom } from "../net/connection";
import { EntityInterpolator } from "../net/interpolation";
import { ContainerHighlight } from "../render/ContainerHighlight";
import { ContainerView } from "../render/ContainerView";
import { nearestContainer } from "../render/interact";
import { MapView } from "../render/MapView";
import { PlayerView } from "../render/PlayerView";
import { projX, projY, unproject } from "../render/projection";
import { Hud } from "../ui/hud";
import { InventoryBar } from "../ui/inventory";
import { LootPanel } from "../ui/lootPanel";

export interface RaidSceneData {
  room: RaidRoom;
}

/** Right-button hold re-sends the move target at most this often. */
const MOVE_REPEAT_MS = 100;

/** Shortcuts must never fire while the player is typing in a form control. */
function isTyping(target: EventTarget | null): boolean {
  for (const node of [target, document.activeElement]) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.isContentEditable || node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT") return true;
  }
  return false;
}

export class RaidScene extends Phaser.Scene {
  private room!: RaidRoom;
  private interp!: EntityInterpolator;
  private views = new Map<string, PlayerView>();
  private containerViews = new Map<string, ContainerView>();
  private mapView: MapView | null = null;
  private highlight!: ContainerHighlight;
  private hud!: Hud;
  private inventory!: InventoryBar;
  private lootPanel!: LootPanel;
  /** Container the local player could loot right now: alive, and in range with line of sight by the server's own rule. */
  private nearest: ContainerState | null = null;
  private marker!: Phaser.GameObjects.Ellipse;
  private lastMoveSentAt = 0;
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
    this.interp = new EntityInterpolator();
    this.views = new Map();
    this.containerViews = new Map();
    this.rendered.clear();
    this.nearest = null;
    this.lastMoveSentAt = 0;
    this.hud = new Hud();
    this.inventory = new InventoryBar({
      onUse: (uid) => sendInput(this.room, "use", { uid }),
      onDrop: (uid) => sendInput(this.room, "drop", { uid }),
    });
    this.lootPanel = new LootPanel({
      onTake: (containerId, uid) => sendInput(this.room, "take", { containerId, uid }),
    });
    this.buildMap(this.room.state.seed);
    this.highlight = new ContainerHighlight(this);

    this.marker = this.add.ellipse(0, 0, 18, 9).setStrokeStyle(2, 0x80deea, 1).setVisible(false).setDepth(1e6);

    this.room.onStateChange(this.onState);
    this.onState(this.room.state);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() && this.pointerStartedOnCanvas(pointer)) this.sendMove(pointer, true);
    });
    window.addEventListener("keydown", this.onKeyDown);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) (window as unknown as { __raid?: unknown }).__raid = { scene: this, room: this.room };
  }

  update(time: number): void {
    const state = this.room.state;
    if (state.seed !== this.mapView?.map.seed) this.buildMap(state.seed);

    const pointer = this.input.activePointer;
    if (pointer.rightButtonDown() && this.pointerStartedOnCanvas(pointer) && time - this.lastMoveSentAt >= MOVE_REPEAT_MS) {
      this.sendMove(pointer, false);
    }

    const now = performance.now();
    const renderT = this.interp.renderTime(now);
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      let view = this.views.get(id);
      if (!view) { view = new PlayerView(this, id === this.room.sessionId); this.views.set(id, view); }
      if (!this.interp.sample(id, renderT, this.tmp)) { this.tmp.x = p.x; this.tmp.y = p.y; }
      view.update(this.tmp.x, this.tmp.y, p);
      this.rendered.set(id, { x: this.tmp.x, y: this.tmp.y });
      if (id === this.room.sessionId) this.cameras.main.centerOn(projX(this.tmp.x), projY(this.tmp.y));
    });
    for (const [id, view] of this.views) {
      if (!seen.has(id)) { view.destroy(); this.views.delete(id); this.rendered.delete(id); }
    }

    // Interaction range is checked against the latest synced position (what the server uses), not the
    // interpolated one the player is drawn at, which trails it by INTERP_DELAY_MS.
    const me = state.players.get(this.room.sessionId);
    const map = this.mapView?.map;
    this.nearest = me?.status === "alive" && map ? nearestContainer(state.containers, map, me) : null;
    this.syncContainers(state);

    this.hud.update(state, me);
    this.inventory.update(me);
    this.lootPanel.update(state, me, map);
  }

  private syncContainers(state: RaidState): void {
    const seen = new Set<string>();
    state.containers.forEach((c, id) => {
      seen.add(id);
      let view = this.containerViews.get(id);
      if (!view) { view = new ContainerView(this); this.containerViews.set(id, view); }
      view.update(c);
    });
    const nearestId = this.nearest?.id;
    for (const [id, view] of this.containerViews) {
      if (!seen.has(id)) { view.destroy(); this.containerViews.delete(id); continue; }
      view.setHighlight(id === nearestId);
    }
    if (this.nearest) this.highlight.show(this.nearest.x, this.nearest.y);
    else this.highlight.hide();
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
    this.mapView = new MapView(this, generateMap(seed));
  }

  private teardown(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.room.onStateChange.remove(this.onState);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    for (const v of this.containerViews.values()) v.destroy();
    this.containerViews.clear();
    this.mapView?.destroy();
    this.mapView = null;
    this.highlight.destroy();
    this.rendered.clear();
    this.hud.destroy();
    this.inventory.destroy();
    this.lootPanel.destroy();
    if (import.meta.env.DEV) {
      const w = window as unknown as { __raid?: { scene?: unknown } };
      if (w.__raid?.scene === this) delete w.__raid;
    }
  }
}
