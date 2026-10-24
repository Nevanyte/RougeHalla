// Renders interpolated state and turns mouse/keyboard into input messages. No game rules here.
import Phaser from "phaser";
import { angleBetween, generateMap, unpackFx, unpackLaunches, withGates, type FxBatch, type RunResult } from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";
import { sendInput, type RaidRoom } from "../net/connection";
import { EntityInterpolator } from "../net/interpolation";
import { ContainerHighlight } from "../render/ContainerHighlight";
import { ContainerView } from "../render/ContainerView";
import { FX_FUTURE_SLACK_MS, FxView } from "../render/FxView";
import { containerWeapon, nearestContainer } from "../render/interact";
import { MapView } from "../render/MapView";
import { MobView } from "../render/MobView";
import { PlayerView } from "../render/PlayerView";
import { ProjectileView } from "../render/ProjectileView";
import { BODY_LIFT, projX, projY, unproject } from "../render/projection";
import { Hud } from "../ui/hud";
import { Minimap } from "../ui/minimap";
import { ScreenFeedback, matchupTarget, suddenDeathLoss } from "../ui/screenFeedback";
import type { ToastTone } from "../ui/toast";
import { WeaponBar } from "../ui/weaponBar";

export interface RaidSceneData {
  room: RaidRoom;
  /** Where short announcements ("<name> was killed") go; omitted, they are simply not shown. */
  toast?: (text: string, tone?: ToastTone) => void;
  /** True once the results panel is on screen; the "YOU DIED" line steps aside for it. Omitted, the line never yields. */
  resultsVisible?: () => boolean;
}

/** Right-button hold re-sends the move target at most this often. */
const MOVE_REPEAT_MS = 100;
/** The cursor's aim is streamed at most this often, and only once it has turned by more than AIM_MIN_DELTA... */
const AIM_SEND_MS = 50;
const AIM_MIN_DELTA = 0.01;
/**
 * ...and re-sent unchanged after this long. The camera follows the drawn player, so a still cursor keeps its angle while
 * walking, yet the server turns a fighter to its path (and a shield away) once the aim is AIM_STALE_MS (1000) old.
 */
const AIM_KEEPALIVE_MS = 500;
/**
 * Attacks travel at body height, so the cursor is read as a point BODY_LIFT pixels above the ground: clicking the
 * middle of a drawn player aims at that player's ground position instead of ~17 world units north of it.
 */
const AIM_HEIGHT = BODY_LIFT;

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
  private mobViews = new Map<string, MobView>();
  private containerViews = new Map<string, ContainerView>();
  private projectiles!: ProjectileView;
  private mapView: MapView | null = null;
  private highlight!: ContainerHighlight;
  private minimap!: Minimap;
  private hud!: Hud;
  private weaponBar!: WeaponBar;
  private feedback!: ScreenFeedback;
  /** Container with a weapon the local player could take right now: alive, and in range with line of sight by the server's own rule. */
  private nearest: ContainerState | null = null;
  private marker!: Phaser.GameObjects.Ellipse;
  private lastMoveSentAt = 0;
  private fx!: FxView;
  private unbindFx: (() => void) | null = null;
  private unbindResult: (() => void) | null = null;
  /** Server time this frame is drawn at, captured in update(); inputs are stamped with it (see stamped). */
  private renderT = 0;
  /** Server time of the latest teleport fx (0 = none): inputs wait until it is drawn. */
  private teleportAt = 0;
  /** The teleport whose cut was last reached, so the held trigger is re-sent once after it. */
  private teleportHandled = 0;
  private clockSynced = false;
  /** False until Phaser has seen the pointer, so Q cannot fire at its initial (0, 0). */
  private aimKnown = false;
  /** The left button is down (a press that began on the canvas). The server repeats attacks while it holds the trigger. */
  private attackHeld = false;
  /** The server has been told about the held trigger; false while an attack is waiting (a teleport cut). */
  private attackSent = false;
  /** Last aim angle streamed or attached to an attack or release, and when. */
  private lastAimSent: number | null = null;
  private lastAimSentAt = 0;
  /** Server time of the newest patch the sudden-death vignette has looked at: one pulse per patch, not per frame. */
  private lastArenaPatchT = 0;
  /**
   * Players whose death fx is queued but not yet due, keyed by id. The death patch (status "dead", a new body) is
   * ahead of render time, so until renderT reaches `t` they are still drawn alive and their body stays hidden.
   */
  private readonly deaths = new Map<string, { t: number; x: number; y: number }>();
  /** The weapon in hand per player (slot and what it holds) at the previous patch, to notice a swap or a replacing pickup. */
  private readonly inHand = new Map<string, string>();
  private resultsVisible: (() => boolean) | undefined;
  private readonly tmp = { x: 0, y: 0 };
  private readonly sampleMatchup = () => matchupTarget(this.room.state, this.room.sessionId, this.rendered, this.mapView?.map);
  /** Last rendered ground position per fighter (players and mobs); read by dev tooling (window.__raid). */
  readonly rendered = new Map<string, { x: number; y: number }>();
  private readonly onState = (state: RaidState) => {
    this.interp.onPatch(state, performance.now());
    if (state.projectiles) this.projectiles.sync(state.projectiles);
    this.noteWeaponChanges(state);
  };
  // maxEnqueuedMessages is 0 (connection.ts), so whatever was sent while the socket was down is gone, a release included.
  private readonly onReconnect = () => {
    this.attackSent = false;
    // Held: the next frame presses again, as after a teleport. Not held: say so, whatever the server remembers.
    if (this.attackHeld || !this.localAlive()) return;
    const a = this.lastAimSent ?? this.cursorAngle(this.input.activePointer);
    if (a === null) return;
    sendInput(this.room, "release", this.stamped(a));
    this.noteAimSent(a);
  };
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKey(e);
  // The trigger release must never be lost: listen on the window (the button may come up off the canvas) and let
  // anything that could swallow the mouse-up (focus loss, a hidden tab, a cancelled pointer, one that left or moved
  // with the button already up) release too. Leaving with the button still down keeps the trigger: the mouse-up follows.
  private readonly onPointerUp = (e: PointerEvent) => { if (e.button === 0) this.releaseAttack(); };
  private readonly onButtonsCheck = (e: MouseEvent) => { if ((e.buttons & 1) === 0) this.releaseAttack(); };
  private readonly onReleaseEvent = () => this.releaseAttack();
  private readonly onVisibility = () => { if (document.hidden) this.releaseAttack(); };

  constructor() {
    super("raid");
  }

  create(data: RaidSceneData): void {
    this.room = data.room;
    this.resultsVisible = data.resultsVisible;
    this.deaths.clear();
    this.inHand.clear();
    this.interp = new EntityInterpolator();
    this.views = new Map();
    this.mobViews = new Map();
    this.containerViews = new Map();
    this.rendered.clear();
    this.nearest = null;
    this.lastMoveSentAt = 0;
    this.renderT = 0;
    this.teleportAt = 0;
    this.teleportHandled = 0;
    this.clockSynced = false;
    this.aimKnown = false;
    this.attackHeld = false;
    this.attackSent = false;
    this.lastAimSent = null;
    this.lastAimSentAt = 0;
    this.lastArenaPatchT = 0;
    this.hud = new Hud();
    this.weaponBar = new WeaponBar();
    this.feedback = new ScreenFeedback();
    // Before buildMap: building a map repaints the minimap's static layer.
    this.minimap = new Minimap();
    this.buildMap(this.room.state.seed);
    this.highlight = new ContainerHighlight(this);
    this.projectiles = new ProjectileView(this);
    this.fx = new FxView(this, {
      localId: this.room.sessionId,
      view: (id) => this.views.get(id) ?? this.mobViews.get(id),
      position: (id) => this.rendered.get(id),
      name: (id) => this.room.state.players.get(id)?.name ?? this.room.state.mobs.get(id)?.name,
      mobKind: (id) => this.room.state.mobs.get(id)?.kind,
      projectileEnded: (id) => this.projectiles.finish(id),
      // At render time with the flash and the number, not on arrival (~INTERP_DELAY_MS earlier): damageFlash judges the hit against max hp.
      localHit: (fx) => this.feedback.hit(fx.amount, this.room.state.players.get(fx.id)?.maxHp ?? 0, fx.sig),
      announce: data.toast,
    });
    // One message per server step; unpackFx stamps each event with the step's time and skips what it can't read. The
    // patches carry no projectiles: the batch of the step that loosed one announces it.
    this.unbindFx = this.room.onMessage("fxs", (batch: FxBatch) => {
      for (const launch of unpackLaunches(batch)) this.projectiles.noteLaunch(launch);
      for (const fx of unpackFx(batch, this.room.state.roster)) {
        if (fx.kind === "death") this.noteDeath(fx.id, fx.t, fx.x, fx.y);
        if (fx.kind === "teleport") this.noteTeleport(fx.t);
        // The stop point is known on arrival, though the fx plays later: it caps the projectile's drawn flight.
        if (fx.kind === "projEnd") this.projectiles.noteEnd(fx);
        this.fx.enqueue(fx);
      }
    });
    // The killing result reaches the client before the dead-status patch, so the death line is driven from it.
    // main.ts holds the results panel back for a moment after a death; update() hides the line once it shows.
    this.unbindResult = this.room.onMessage("result", (r: RunResult) => {
      if (r.outcome === "died") this.hud.showDeath();
    });

    this.marker = this.add.ellipse(0, 0, 18, 9).setStrokeStyle(2, 0x80deea, 1).setVisible(false).setDepth(1e6);

    this.room.onStateChange(this.onState);
    this.room.onReconnect(this.onReconnect);
    this.onState(this.room.state);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.aimKnown = true;
      if (!this.pointerStartedOnCanvas(pointer)) return;
      // The button that went down, not the buttons held: a second press while one is held must not read as the first.
      // macOS reports ctrl+click (a context click) as button 0 with only the right button in `buttons`: not a trigger.
      if (pointer.button === 2) this.sendMove(pointer, true);
      else if (pointer.button === 0 && pointer.leftButtonDown()) this.pressAttack();
    });
    this.input.on("pointermove", () => { this.aimKnown = true; });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onButtonsCheck);
    window.addEventListener("pointercancel", this.onReleaseEvent);
    window.addEventListener("blur", this.onReleaseEvent);
    document.addEventListener("mouseleave", this.onButtonsCheck);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) (window as unknown as { __raid?: unknown }).__raid = { scene: this, room: this.room };
  }

  update(time: number): void {
    const state = this.room.state;
    if (state.seed !== this.mapView?.map.seed) this.buildMap(state.seed);
    const gatesLocked = state.gatesLocked;
    this.mapView?.setGatesLocked(gatesLocked);
    this.minimap.setGatesLocked(gatesLocked);

    const now = performance.now();
    // The one place render time is read: it consumes the clock's pending patch, so everything else this frame
    // (fx playback, input timestamps between frames) reuses these values.
    const renderT = this.interp.renderTime(now);
    this.renderT = renderT;
    this.clockSynced = this.interp.clock.synced;
    // The estimated present, not renderT (100 ms behind it): deadlines and cooldowns are server-time values about now.
    const serverNow = this.clockSynced ? this.interp.clock.now(now) : state.serverTime;
    for (const [id, d] of this.deaths) if (renderT >= d.t) this.deaths.delete(id);
    // The server dropped the held trigger at the teleport; once the cut is drawn, hold it again if the button is still down.
    if (this.teleportAt > this.teleportHandled && renderT >= this.teleportAt) {
      this.teleportHandled = this.teleportAt;
      this.attackSent = false;
    }

    const pointer = this.input.activePointer;
    if (pointer.rightButtonDown() && this.pointerStartedOnCanvas(pointer) && time - this.lastMoveSentAt >= MOVE_REPEAT_MS) {
      this.sendMove(pointer, false);
    }

    const patchT = state.serverTime;
    // The sim freezes `sig` and `brand` when a run ends, so the signature marks are only drawn while it is active.
    const signatures = state.phase === "active";
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      let view = this.views.get(id);
      if (!view) { view = new PlayerView(this, id === this.room.sessionId); this.views.set(id, view); }
      this.sampleDrawn(id, renderT, p);
      view.update(this.tmp.x, this.tmp.y, p, renderT, patchT, this.deathPending(id), signatures);
      if (id === this.room.sessionId) this.cameras.main.centerOn(projX(this.tmp.x), projY(this.tmp.y));
    });
    for (const [id, view] of this.views) {
      if (!seen.has(id)) { view.destroy(); this.views.delete(id); this.rendered.delete(id); this.deaths.delete(id); this.inHand.delete(id); }
    }
    const seenMobs = new Set<string>();
    state.mobs.forEach((m, id) => {
      seenMobs.add(id);
      let view = this.mobViews.get(id);
      if (!view) { view = new MobView(this); this.mobViews.set(id, view); }
      this.sampleDrawn(id, renderT, m);
      view.update(this.tmp.x, this.tmp.y, m, renderT, patchT, signatures);
    });
    for (const [id, view] of this.mobViews) {
      if (!seenMobs.has(id)) { view.destroy(); this.mobViews.delete(id); this.rendered.delete(id); }
    }
    this.projectiles.update(renderT);

    // Interaction range is checked against the latest synced position (what the server uses), not the
    // interpolated one the player is drawn at, which trails it by INTERP_DELAY_MS.
    const me = state.players.get(this.room.sessionId);
    const map = this.mapView?.map;
    // Line of sight (pickup) follows the server's walls, closed gates included. mapView.map stays the open map.
    const sightMap = gatesLocked && map ? withGates(map) : map;
    this.nearest = me?.status === "alive" && sightMap ? nearestContainer(state.containers, sightMap, me) : null;
    this.syncContainers(state);

    // After the camera is centred and the drawn positions are set: the cursor's ground point and the aim angle derive from them.
    this.updateTrigger(me, now);

    // After the views are updated: hit flashes target them and heal numbers follow where they are drawn.
    this.fx.update(renderT, now, this.clockSynced);
    this.trackArenaDamage(me, state);
    this.feedback.update(now, this.sampleMatchup);

    // Redraws only when the player's dot (or the gates) actually changed.
    this.minimap.setMobs(state.mobs);
    this.minimap.update(now, this.rendered.get(this.room.sessionId), me?.status === "alive" || me?.status === "lobby");

    if (this.resultsVisible?.()) this.hud.noteResultShown();
    this.hud.update(state, me, serverNow);
    this.weaponBar.update(me, patchT, serverNow, this.nearest ? containerWeapon(this.nearest) : null);
  }

  /** Writes where fighter `id` is drawn this frame into `tmp` and `rendered` (the latest patch while it has no history yet). */
  private sampleDrawn(id: string, renderT: number, latest: { x: number; y: number }): void {
    if (!this.interp.sample(id, renderT, this.tmp)) { this.tmp.x = latest.x; this.tmp.y = latest.y; }
    let drawn = this.rendered.get(id);
    if (!drawn) { drawn = { x: 0, y: 0 }; this.rendered.set(id, drawn); }
    drawn.x = this.tmp.x;
    drawn.y = this.tmp.y;
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

  /**
   * Until render time reaches a teleport, the screen still shows everyone where they were: a click there would aim from
   * (or walk back to) the old spot, so inputs wait for the cut. The interpolator snaps even a short jump.
   */
  private noteTeleport(t: number): void {
    if (!Number.isFinite(t)) return;
    this.interp.markCut(t);
    this.teleportAt = Math.max(this.teleportAt, t);
  }

  private beforeTeleport(): boolean {
    return this.renderT < this.teleportAt;
  }

  private sendMove(pointer: Phaser.Input.Pointer, showMarker: boolean): void {
    if (this.beforeTeleport()) return;
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
   * The angle on the ground from the local player, where it is drawn, to the cursor; null before it is drawn. The
   * camera is centred on the drawn player at zoom 1 every frame, so the cursor's screen position plus the scroll is
   * its world point, with no lag behind the camera's own matrix.
   */
  private cursorAngle(pointer: Phaser.Input.Pointer): number | null {
    const me = this.rendered.get(this.room.sessionId);
    if (!me) return null;
    const cam = this.cameras.main;
    const target = unproject(cam.scrollX + pointer.x, cam.scrollY + pointer.y + AIM_HEIGHT);
    return Math.atan2(target.y - me.y, target.x - me.x);
  }

  /**
   * A swap, or a pickup that replaces the weapon in hand, cancels the fighter's action on the server without an fx, so
   * its telegraph would play to the end. FxView drops it once render time reaches this patch, i.e. after any windup
   * stamped at or before it.
   */
  private noteWeaponChanges(state: RaidState): void {
    state.players?.forEach((p, id) => {
      const hand = `${p.slot}:${p.slot === 1 ? p.weapon1 : p.weapon0}`;
      const before = this.inHand.get(id);
      this.inHand.set(id, hand);
      if (before !== undefined && before !== hand) this.fx.cancelWindups(id, state.serverTime);
    });
  }

  /**
   * `t` is the server time this frame is drawn at, i.e. the world the player is looking at when they act; the server
   * rewinds targets to it (clamped to MAX_REWIND_MS). Omitted while the clock is unsynced, when it would be
   * meaningless, so the server just uses the present.
   */
  private stamped(a: number): { a: number; t?: number } {
    return this.clockSynced ? { a, t: this.renderT } : { a };
  }

  private noteAimSent(a: number): void {
    this.lastAimSent = a;
    this.lastAimSentAt = performance.now();
  }

  /** The left button went down on the canvas. */
  private pressAttack(): void {
    this.attackHeld = true;
    this.attackSent = false;
    this.sendHeldAttack();
  }

  /**
   * Tells the server the trigger is down, once: it repeats the attack itself while held. Waits (called again every
   * frame) while the player is not alive or the screen still shows the world from before a teleport.
   */
  private sendHeldAttack(): void {
    if (!this.attackHeld || this.attackSent || !this.localAlive() || this.beforeTeleport()) return;
    const a = this.cursorAngle(this.input.activePointer);
    if (a === null) return;
    sendInput(this.room, "attack", this.stamped(a));
    this.attackSent = true;
    this.noteAimSent(a);
  }

  /** The trigger came up (or may have): the bow looses, other weapons stop repeating. A no-op unless it was held. */
  private releaseAttack(): void {
    if (!this.attackHeld) return;
    this.attackHeld = false;
    if (!this.attackSent) return;
    this.attackSent = false;
    const a = this.cursorAngle(this.input.activePointer) ?? this.lastAimSent;
    if (a === null) return;
    sendInput(this.room, "release", this.stamped(a));
    this.noteAimSent(a);
  }

  /** Once per frame: drops a trigger that outlived the player or the button, sends a waiting attack, and streams the aim. */
  private updateTrigger(me: PlayerState | undefined, now: number): void {
    const alive = me?.status === "alive";
    if (this.attackHeld) {
      if (!alive) {
        // Nothing to release: the server drops a dead player's trigger itself.
        this.attackHeld = false;
        this.attackSent = false;
      } else if (!this.input.activePointer.leftButtonDown()) {
        // The mouse-up never reached us (or the press and release landed in one frame).
        this.releaseAttack();
      }
    }
    this.sendHeldAttack();
    // The shield follows the cursor and held attacks aim at it, so the aim goes out whether or not the trigger is down.
    // isOver: the last pointer position is stale (and meaningless) while the cursor is over a DOM panel.
    if (!alive || !this.aimKnown || this.beforeTeleport() || (!this.input.isOver && !this.attackHeld)) return;
    const a = this.cursorAngle(this.input.activePointer);
    if (a === null || now - this.lastAimSentAt < AIM_SEND_MS) return;
    const turned = this.lastAimSent === null || angleBetween(a, this.lastAimSent) > AIM_MIN_DELTA;
    if (!turned && now - this.lastAimSentAt < AIM_KEEPALIVE_MS) return;
    sendInput(this.room, "aim", { a });
    this.noteAimSent(a);
  }

  private localAlive(): boolean {
    return this.room.state.players.get(this.room.sessionId)?.status === "alive";
  }

  /**
   * Sudden death hurts everyone every tick but sends no `hit` fx (the arena isn't an attacker). The hp the state loses
   * can't stand in for it: that also holds damage over time (which never flashes) and hits that already did. So each
   * new patch pulses the vignette with what sudden death alone takes from the local player that tick.
   */
  private trackArenaDamage(me: PlayerState | undefined, state: RaidState): void {
    const fresh = state.serverTime > this.lastArenaPatchT;
    this.lastArenaPatchT = state.serverTime;
    if (!fresh || me?.status !== "alive" || !state.gatesLocked) return;
    const lost = suddenDeathLoss(me.maxHp, state.serverTime, state.suddenDeathAt);
    if (lost > 0) this.feedback.hit(lost, me.maxHp);
  }

  /**
   * Phaser also listens for mouse events on the window, so a press on a DOM overlay (results panel, menus)
   * still reaches the scene's input; only presses that began on the canvas may issue a move or an attack.
   */
  private pointerStartedOnCanvas(pointer: Phaser.Input.Pointer): boolean {
    return pointer.downElement === this.game.canvas;
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    // Physical keys (e.code), not the produced character, so shortcuts keep working on non-Latin layouts.
    if (e.code === "KeyS") {
      sendInput(this.room, "stop", {});
      return;
    }
    if (!this.localAlive()) return;
    if (e.code === "KeyQ") sendInput(this.room, "swap", {});
    else if (e.code === "KeyF") {
      if (this.nearest) sendInput(this.room, "pickup", { containerId: this.nearest.id });
    } else {
      const digit = /^(?:Digit|Numpad)([12])$/.exec(e.code);
      if (digit) sendInput(this.room, "swap", { slot: Number(digit[1]) - 1 });
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
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onButtonsCheck);
    window.removeEventListener("pointercancel", this.onReleaseEvent);
    window.removeEventListener("blur", this.onReleaseEvent);
    document.removeEventListener("mouseleave", this.onButtonsCheck);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.room.onStateChange.remove(this.onState);
    this.room.onReconnect.remove(this.onReconnect);
    this.unbindFx?.();
    this.unbindFx = null;
    this.unbindResult?.();
    this.unbindResult = null;
    this.fx.destroy();
    this.projectiles.destroy();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    for (const v of this.mobViews.values()) v.destroy();
    this.mobViews.clear();
    for (const v of this.containerViews.values()) v.destroy();
    this.containerViews.clear();
    this.mapView?.destroy();
    this.mapView = null;
    this.highlight.destroy();
    this.minimap.destroy();
    this.rendered.clear();
    this.deaths.clear();
    this.inHand.clear();
    this.hud.destroy();
    this.weaponBar.destroy();
    this.feedback.destroy();
    if (import.meta.env.DEV) {
      const w = window as unknown as { __raid?: { scene?: unknown } };
      if (w.__raid?.scene === this) delete w.__raid;
    }
  }
}
