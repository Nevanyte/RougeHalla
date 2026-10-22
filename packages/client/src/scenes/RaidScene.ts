// Renders interpolated state and turns mouse/keyboard into input messages. No game rules here.
import Phaser from "phaser";
import { TILE, WORLD_H, WORLD_W } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { sendInput, type RaidRoom } from "../net/connection";
import { EntityInterpolator } from "../net/interpolation";
import { PlayerView } from "../render/PlayerView";
import { projX, projY, unproject } from "../render/projection";
import { Hud } from "../ui/hud";

export interface RaidSceneData {
  room: RaidRoom;
}

/** Right-button hold re-sends the move target at most this often. */
const MOVE_REPEAT_MS = 100;

export class RaidScene extends Phaser.Scene {
  private room!: RaidRoom;
  private interp!: EntityInterpolator;
  private views = new Map<string, PlayerView>();
  private hud!: Hud;
  private marker!: Phaser.GameObjects.Ellipse;
  private lastMoveSentAt = 0;
  private readonly tmp = { x: 0, y: 0 };
  /** Last rendered ground position per entity; read by dev tooling (window.__raid). */
  readonly rendered = new Map<string, { x: number; y: number }>();
  private readonly onState = (state: RaidState) => this.interp.onPatch(state, performance.now());

  constructor() {
    super("raid");
  }

  create(data: RaidSceneData): void {
    this.room = data.room;
    this.interp = new EntityInterpolator();
    this.views = new Map();
    this.hud = new Hud();
    this.drawGround();

    this.marker = this.add.ellipse(0, 0, 18, 9).setStrokeStyle(2, 0x80deea, 1).setVisible(false).setDepth(1e6);

    this.room.onStateChange(this.onState);
    this.onState(this.room.state);

    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.sendMove(pointer, true);
    });
    this.input.keyboard?.on("keydown-S", () => sendInput(this.room, "stop", {}));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) (window as unknown as { __raid?: unknown }).__raid = { scene: this, room: this.room };
  }

  update(time: number): void {
    const state = this.room.state;
    const pointer = this.input.activePointer;
    if (pointer.rightButtonDown() && time - this.lastMoveSentAt >= MOVE_REPEAT_MS) this.sendMove(pointer, false);

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

    this.hud.update(state, state.players.get(this.room.sessionId));
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

  private drawGround(): void {
    const g = this.add.graphics().setDepth(-1e6);
    g.fillStyle(0x2a3038, 1).fillRect(0, 0, projX(WORLD_W), projY(WORLD_H));
    g.lineStyle(1, 0x343b45, 1);
    for (let x = 0; x <= WORLD_W; x += TILE) g.lineBetween(projX(x), 0, projX(x), projY(WORLD_H));
    for (let y = 0; y <= WORLD_H; y += TILE) g.lineBetween(0, projY(y), projX(WORLD_W), projY(y));
  }

  private teardown(): void {
    this.room.onStateChange.remove(this.onState);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.hud.destroy();
  }
}
