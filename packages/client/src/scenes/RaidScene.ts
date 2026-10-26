// Renders interpolated state and turns mouse/keyboard into input messages. No game rules here.
import Phaser from "phaser";
import {
  abilityInSlot, AIM_STALE_MS, angleBetween, blinkLanding, buildGameMap, CAST_RANGE_SLACK, hasLineOfSight, isAbilityDot, rankOf,
  slotReadyAt, TARGET_RANGE, unpackFx, unpackLaunches, withGates, type AbilityDef, type AbilitySlot, type FxBatch, type GameMap,
  type RunResult, type Vec2,
} from "@raid/shared";
import type { ContainerState, PlayerState, RaidState } from "@raid/shared/schema";
import { sendInput, type RaidRoom } from "../net/connection";
import { dropWarner, type FxInbox } from "../net/fxInbox";
import { EntityInterpolator } from "../net/interpolation";
import { clampToWorld, JUMP_ORDER_EXPIRE_MS, ORDER_EXPIRE_MS } from "../net/localMotion";
import {
  LocalPrediction, castUnanswered, inTeleportGrace, localDrawSource, type LocalDrawSource, type OtherFighter,
} from "../net/localPrediction";
import { ContainerHighlight } from "../render/ContainerHighlight";
import { ContainerView } from "../render/ContainerView";
import { FieldView } from "../render/FieldView";
import { FX_FUTURE_SLACK_MS, FxView } from "../render/FxView";
import { containerWeapon, nearestContainer } from "../render/interact";
import { MapView } from "../render/MapView";
import { MobView } from "../render/MobView";
import { PlayerView } from "../render/PlayerView";
import { ProjectileView } from "../render/ProjectileView";
import { BODY_LIFT, projX, projY, unproject } from "../render/projection";
import { ScreenJuice } from "../render/screenJuice";
import { TargetRings } from "../render/TargetRings";
import { isHiddenRemote, visiblePosition } from "../render/visibility";
import { WishFx } from "../render/WishFx";
import { LockDisplay, pickTarget, targetable, unitCastDenial, type TargetCandidate } from "../render/targeting";
import { AbilitySlotView, CooldownTracker, abilitySlotModel, castDenial, type AbilitySlotInput } from "../ui/abilitySlot";
import { isTypingTarget } from "../ui/chrome";
import { Hud } from "../ui/hud";
import { Minimap } from "../ui/minimap";
import { ScreenFeedback, matchupTarget, suddenDeathLoss } from "../ui/screenFeedback";
import type { ToastTone } from "../ui/toast";
import { TrainingBar } from "../ui/trainingBar";
import { WeaponBar } from "../ui/weaponBar";
import { screenToWorld } from "../view/viewport";

export interface RaidSceneData {
  room: RaidRoom;
  /** The room's `fxs` batches, held since the join (main.ts) so none that arrived before this scene started is lost. */
  fxs: FxInbox;
  /** Where short announcements ("<name> was killed") go; omitted, they are simply not shown. */
  toast?: (text: string, tone?: ToastTone) => void;
  /** True once the results panel is on screen; the "YOU DIED" line steps aside for it. Omitted, the line never yields. */
  resultsVisible?: () => boolean;
  /** Only for a training room: takes the player back to the hub. It is called at most once. */
  leaveTraining?: () => void;
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
  return isTypingTarget(target) || isTypingTarget(document.activeElement);
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
  private rings!: TargetRings;
  private minimap!: Minimap;
  private hud!: Hud;
  private weaponBar!: WeaponBar;
  /** The Wish slot (key D), docked in the weapon bar, and what gives its cooldown a length: the server syncs only when it ends. */
  private wishSlot!: AbilitySlotView;
  private readonly wishCooldown = new CooldownTracker();
  /**
   * The cast just sent and not yet answered: until the patch shows the slot's new ready time or the server echoes the cast's
   * order number (a refusal), a second press is ignored, so a double tap cannot predict a second blink the server will refuse.
   * The wait is capped at JUMP_ORDER_EXPIRE_MS for a blink (its order waits that long, however slow the link), else ORDER_EXPIRE_MS.
   */
  private pendingCast: { slot: AbilitySlot; seq: number; readyAt: number; until: number } | null = null;
  private feedback!: ScreenFeedback;
  /** Created the first frame the room says it is a training room (state.training); null in an arena run. */
  private trainingBar: TrainingBar | null = null;
  private leaveTraining: (() => void) | undefined;
  private announce: ((text: string) => void) | undefined;
  /** Container with a weapon the local player could take right now: alive, and in range on the move mask by the server's own rule. */
  private nearest: ContainerState | null = null;
  private marker!: Phaser.GameObjects.Ellipse;
  private lastMoveSentAt = 0;
  /** Where the camera looks while the minimap is held with the left button (ground units); null = at the local player. */
  private peek: { x: number; y: number } | null = null;
  /** What the player just ordered (target, move, stop), shown until the synced `attackTarget` catches up. */
  private readonly lockDisplay = new LockDisplay();
  /**
   * Where the local fighter is drawn: a prediction (net/localMotion.ts), walked at once on an order and kept in line with the
   * server's samples, instead of the delayed snapshot everyone else is drawn from. Orders carry its `seq`.
   */
  private readonly predict = new LocalPrediction();
  private lastFrameAt = 0;
  /** Scratch: the other fighters (players and mobs), handed to the prediction while the local fighter is chilled. */
  private readonly others: OtherFighter[] = [];
  /**
   * Where the local fighter was last drawn from its prediction. While its death (or the teleport's cut) is still ahead of
   * what is drawn, the patch has already moved the state on: it stays here, not thrown back to the delayed snapshots.
   */
  private readonly frozen = { x: 0, y: 0 };
  private hasFrozen = false;
  /** Dev tooling (window.__raid.latency): ms from each right-click to the first frame the local fighter's drawn position moved. */
  private readonly latency: number[] = [];
  private clickAt = 0;
  private readonly clickFrom = { x: 0, y: 0 };
  /** Scratch list for pickTarget; refilled by targetCandidates(). */
  private readonly candidates: TargetCandidate[] = [];
  /** The fighter a left click would lock right now, and the one drawn as locked ("" = none); read by dev tooling (window.__raid). */
  hoverId = "";
  lockId = "";
  private fx!: FxView;
  /** The areas the state carries (a Trial's zone, a Swarm's cloud, Blaze Step's trail), and the casts' telegraphs and impacts. */
  private fieldView!: FieldView;
  private wishFx!: WishFx;
  /** Juice (render/juice.ts): the hit-stop that holds the world's draw time and the camera shake. */
  private juice!: ScreenJuice;
  private unbindFx: (() => void) | null = null;
  private readonly warnDropped = dropWarner();
  private unbindResult: (() => void) | null = null;
  /** Server time this frame is drawn at, captured in update(). */
  private renderT = 0;
  /** Server time of the latest teleport fx (0 = none): inputs wait until it is drawn. */
  private teleportAt = 0;
  private clockSynced = false;
  /** False until Phaser has seen the pointer, so the aim and the hover ring never read its initial (0, 0). */
  private aimKnown = false;
  /** Last aim angle streamed, and when. */
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
    this.noteWeaponChanges(state);
    this.observeLocal(state);
  };
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKey(e);

  constructor() {
    super("raid");
  }

  create(data: RaidSceneData): void {
    this.room = data.room;
    this.resultsVisible = data.resultsVisible;
    this.leaveTraining = data.leaveTraining;
    this.announce = data.toast;
    this.trainingBar?.destroy();
    this.trainingBar = null;
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
    this.clockSynced = false;
    this.aimKnown = false;
    this.lockDisplay.reset();
    this.hasFrozen = false;
    this.predict.reset();
    this.lastFrameAt = 0;
    this.latency.length = 0;
    this.clickAt = 0;
    this.hoverId = "";
    this.lockId = "";
    this.lastAimSent = null;
    this.lastAimSentAt = 0;
    this.lastArenaPatchT = 0;
    this.hud = new Hud();
    this.weaponBar = new WeaponBar();
    this.wishSlot = new AbilitySlotView({ key: "D" });
    this.weaponBar.dock(this.wishSlot.element);
    this.wishCooldown.reset();
    this.pendingCast = null;
    this.feedback = new ScreenFeedback();
    this.peek = null;
    // Before buildMap: building a map repaints the minimap's static layer.
    this.minimap = new Minimap({
      onMove: (x, y, first) => this.moveTo({ x, y }, first !== false),
      onPeek: (x, y) => { this.peek = { x, y }; },
      onPeekEnd: () => { this.peek = null; },
    });
    this.buildMap(this.room.state.seed);
    this.highlight = new ContainerHighlight(this);
    this.rings = new TargetRings(this);
    this.projectiles = new ProjectileView(this);
    this.juice = new ScreenJuice(this.cameras.main);
    this.fx = new FxView(this, {
      localId: this.room.sessionId,
      view: (id) => this.views.get(id) ?? this.mobViews.get(id),
      // Never where a hidden (Swarm) remote fighter is: no number, burst or mark may be drawn on it, nor keep following it.
      position: (id) => this.visiblePosition(id),
      localLanded: () => this.juice.landed(performance.now()),
      localHurt: (fx) => this.juice.hurt(fx.amount, this.room.state.players.get(fx.id)?.maxHp ?? 0),
      nearestFighter: (x, y, within) => this.nearestFighter(x, y, within),
      name: (id) => this.room.state.players.get(id)?.name ?? this.room.state.mobs.get(id)?.name,
      mobKind: (id) => this.room.state.mobs.get(id)?.kind,
      projectileEnded: (id) => this.projectiles.finish(id),
      // At render time with the flash and the number, not on arrival (~INTERP_DELAY_MS earlier): damageFlash judges the hit against max hp.
      // A burn tick from an ability (Blaze Step's trail) is a drip: no vignette.
      localHit: (fx) => { if (!isAbilityDot(fx.ability)) this.feedback.hit(fx.amount, this.room.state.players.get(fx.id)?.maxHp ?? 0, fx.sig); },
      announce: data.toast,
      wishFx: (fx, now) => this.wishFx.play(fx, now),
    });
    this.fieldView = new FieldView(this);
    this.wishFx = new WishFx(this, {
      localId: this.room.sessionId,
      position: (id) => this.visiblePosition(id),
      // A remote fighter that is hidden (Swarm) shows no telegraph: nothing may point at where it is.
      hidden: (id) => isHiddenRemote(this.room.state.players, this.room.sessionId, id),
    });
    // One message per server step; unpackFx stamps each event with the step's time and skips what it can't read. The state
    // has no projectiles: the batch of the step that loosed one announces it, and a client that joined or reconnected while
    // some flew was sent them as a batch of its own. Batches that came before this scene did are replayed first.
    this.unbindFx = data.fxs.attach((batch) => this.onFxBatch(batch));
    // The killing result reaches the client before the dead-status patch, so the death line is driven from it.
    // main.ts holds the results panel back for a moment after a death; update() hides the line once it shows.
    this.unbindResult = this.room.onMessage("result", (r: RunResult) => {
      if (r.outcome === "died") this.hud.showDeath();
    });

    this.marker = this.add.ellipse(0, 0, 18, 9).setStrokeStyle(2, 0x80deea, 1).setVisible(false).setDepth(1e6);

    this.room.onStateChange(this.onState);
    this.onState(this.room.state);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.aimKnown = true;
      if (!this.pointerStartedOnCanvas(pointer)) return;
      // The button that went down, not the buttons held: a second press while one is held must not read as the first.
      // macOS reports ctrl+click (a context click) as button 0 with only the right button in `buttons`: not a lock.
      if (pointer.button === 2) this.sendMove(pointer, true);
      else if (pointer.button === 0 && pointer.leftButtonDown()) this.sendTarget(pointer);
    });
    this.input.on("pointermove", () => { this.aimKnown = true; });
    window.addEventListener("keydown", this.onKeyDown);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) {
      // latency: ms from a right-click to the first frame the local fighter moved on screen; motion: the prediction's state.
      const motion = this.predict.motion;
      const tools = {
        scene: this,
        room: this.room,
        latency: this.latency,
        get motion() {
          return {
            delay: motion.delay, mode: motion.mode, visual: motion.visualOffset, walking: motion.walking, pending: motion.pendingOrders,
            ready: motion.ready,
          };
        },
      };
      (window as unknown as { __raid?: unknown }).__raid = tools;
    }
  }

  update(time: number): void {
    const state = this.room.state;
    if (state.seed !== this.mapView?.map.seed) this.buildMap(state.seed);
    const gatesLocked = state.gatesLocked;
    this.mapView?.setGatesLocked(gatesLocked);
    this.minimap.setGatesLocked(gatesLocked);

    const now = performance.now();
    // Not read in create(): tolerate the flag arriving with a later patch.
    if (state.training && !this.trainingBar) this.trainingBar = new TrainingBar(this.leaveTraining);
    this.trainingBar?.update(now);
    // The one place render time is read: it consumes the clock's pending patch, so everything else this frame
    // (fx playback, input timestamps between frames) reuses these values.
    const trueT = this.interp.renderTime(now);
    // Juice: the world (remote fighters, projectiles, fx) is drawn at renderT, which a hit-stop holds briefly behind trueT
    // after the local player lands a hit. The local fighter is drawn from trueT, so its movement and turning never stall.
    const renderT = this.juice.worldTime(trueT, now);
    this.renderT = renderT;
    this.clockSynced = this.interp.clock.synced;
    // The estimated present, not renderT (100 ms behind it): deadlines and cooldowns are server-time values about now.
    const serverNow = this.clockSynced ? this.interp.clock.now(now) : state.serverTime;
    for (const [id, d] of this.deaths) if (renderT >= d.t) this.deaths.delete(id);

    const pointer = this.input.activePointer;
    if (pointer.rightButtonDown() && this.pointerStartedOnCanvas(pointer) && time - this.lastMoveSentAt >= MOVE_REPEAT_MS) {
      this.sendMove(pointer, false);
    }
    // After this frame's orders, before anything reads the local fighter's position.
    this.stepLocal(now, state);

    const patchT = state.serverTime;
    // The sim freezes `sig` and `brand` when a run ends, so the signature marks are only drawn while it is active.
    const signatures = state.phase === "active";
    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      let view = this.views.get(id);
      if (!view) { view = new PlayerView(this, id === this.room.sessionId, this.fx); this.views.set(id, view); }
      const drawT = id === this.room.sessionId ? trueT : renderT; // juice: the local fighter is not held by a hit-stop
      // The local fighter is drawn from its prediction while it fights on its feet; everyone else, and it when it does not, from the snapshots.
      const local = id === this.room.sessionId;
      const source = local ? this.localSource(p, state) : "snapshot";
      if (source === "predicted") {
        const at = this.predict.motion.drawn;
        this.placeDrawn(id, at);
        this.frozen.x = at.x;
        this.frozen.y = at.y;
        this.hasFrozen = true;
      } else if (source === "frozen") {
        this.placeDrawn(id, this.frozen);
      } else {
        if (local) this.hasFrozen = false;
        this.sampleDrawn(id, drawT, p);
      }
      view.update(this.tmp.x, this.tmp.y, p, drawT, patchT, this.deathPending(id), signatures, source === "predicted" ? this.predict.motion.facing() : null);
      if (id === this.room.sessionId) this.cameras.main.centerOn(projX(this.peek?.x ?? this.tmp.x), projY(this.peek?.y ?? this.tmp.y));
    });
    for (const [id, view] of this.views) {
      if (!seen.has(id)) { view.destroy(); this.views.delete(id); this.rendered.delete(id); this.deaths.delete(id); this.inHand.delete(id); }
    }
    const seenMobs = new Set<string>();
    state.mobs.forEach((m, id) => {
      seenMobs.add(id);
      let view = this.mobViews.get(id);
      if (!view) { view = new MobView(this, this.fx); this.mobViews.set(id, view); }
      this.sampleDrawn(id, renderT, m);
      view.update(this.tmp.x, this.tmp.y, m, renderT, patchT, signatures);
    });
    for (const [id, view] of this.mobViews) {
      if (!seenMobs.has(id)) { view.destroy(); this.mobViews.delete(id); this.rendered.delete(id); }
    }
    this.projectiles.update(renderT);
    this.fieldView.update(state.fields, renderT, now, (id) => this.rendered.get(id), this.room.sessionId);

    // Interaction range is checked against the latest synced position (what the server uses), not the
    // interpolated one the player is drawn at, which trails it by INTERP_DELAY_MS.
    const me = state.players.get(this.room.sessionId);
    const map = this.mapView?.map;
    // Pickup reach uses the move mask (a fence stops a hand), on the server's map: closed gates included. mapView.map stays the open map.
    const pickupMap = gatesLocked && map ? withGates(map) : map;
    this.nearest = me?.status === "alive" && pickupMap ? nearestContainer(state.containers, pickupMap, me) : null;
    this.syncContainers(state);

    // After the camera is centred and the drawn positions are set: the cursor's ground point and the aim angle derive from them.
    this.updateTargets(me, now);
    this.streamAim(me, now);

    // After the views are updated: hit flashes target them and heal numbers follow where they are drawn.
    this.fx.update(renderT, now, this.clockSynced);
    this.wishFx.update(now);
    this.trackArenaDamage(me, state);
    this.feedback.update(now, this.sampleMatchup);

    // Redraws only when the player's dot (or the gates) actually changed.
    this.minimap.setMobs(state.mobs);
    const cam = this.cameras.main;
    this.minimap.update(now, this.rendered.get(this.room.sessionId), me?.status === "alive" || me?.status === "lobby", {
      x: cam.scrollX + cam.width / 2,
      y: cam.scrollY + cam.height / 2,
    });

    if (this.resultsVisible?.()) this.hud.noteResultShown();
    this.hud.update(state, me, serverNow);
    this.weaponBar.update(me, patchT, serverNow, this.nearest ? containerWeapon(this.nearest) : null);
    this.updateWishSlot(me, state, serverNow, now);
  }

  /** Writes where fighter `id` is drawn this frame into `tmp` and `rendered` (the latest patch while it has no history yet). */
  private sampleDrawn(id: string, renderT: number, latest: { x: number; y: number }): void {
    if (!this.interp.sample(id, renderT, this.tmp)) { this.tmp.x = latest.x; this.tmp.y = latest.y; }
    let drawn = this.rendered.get(id);
    if (!drawn) { drawn = { x: 0, y: 0 }; this.rendered.set(id, drawn); }
    drawn.x = this.tmp.x;
    drawn.y = this.tmp.y;
  }

  /** Like sampleDrawn for a position already known: the local fighter's prediction. */
  private placeDrawn(id: string, at: { x: number; y: number }): void {
    this.tmp.x = at.x;
    this.tmp.y = at.y;
    let drawn = this.rendered.get(id);
    if (!drawn) { drawn = { x: 0, y: 0 }; this.rendered.set(id, drawn); }
    drawn.x = at.x;
    drawn.y = at.y;
  }

  /** Where the local fighter is drawn from this frame: its prediction, where it was last drawn (death or teleport pending), or the snapshots. */
  private localSource(p: PlayerState, state: RaidState): LocalDrawSource {
    return localDrawSource({
      alive: p.status === "alive", running: state.phase === "active", ready: this.predict.motion.ready,
      beforeCut: this.beforeTeleport(), deathPending: this.deathPending(this.room.sessionId), hasFrozen: this.hasFrozen,
    });
  }

  /** The client clock that stamps orders and patches: the estimated server time now. */
  private localClock(now: number): number {
    return this.interp.clock.synced ? this.interp.clock.now(now) : this.room.state.serverTime;
  }

  /** The walls the server walks and plans on: the gates are walls from the first teleport. Null before the map is built. */
  private planMap(): GameMap | null {
    const map = this.mapView?.map;
    return map ? (this.room.state.gatesLocked ? withGates(map) : map) : null;
  }

  /** The cursor's aim is being streamed: the server turns the fighter to the cursor, not to the way it walks. */
  private aimStreaming(now: number): boolean {
    return this.lastAimSentAt > 0 && now - this.lastAimSentAt < AIM_STALE_MS;
  }

  /** A patch arrived: the local fighter's server state (position, last applied order) goes to the prediction. */
  private observeLocal(state: RaidState): void {
    const me = state.players?.get(this.room.sessionId);
    if (me) {
      this.predict.observe(
        { x: me.x, y: me.y, t: state.serverTime, moveSeq: me.moveSeq, locked: me.attackTarget !== "", displaceSeq: me.displaceSeq },
        this.localClock(performance.now()),
      );
    }
  }

  /** Once per frame, after the orders this frame sent: walks the prediction on. */
  private stepLocal(now: number, state: RaidState): void {
    const dt = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    const me = state.players.get(this.room.sessionId);
    if (!me) return;
    // No patches arrive while the connection is down, and what is sent is dropped: nothing to predict from until it is back.
    if (this.room.reconnection?.isReconnecting) {
      this.predict.motion.reset();
      return;
    }
    // Only a chilled fighter needs to know where the others are (a Frost mob chills as a Frost player does).
    const others = this.others;
    others.length = 0;
    if (me.sig !== 0) {
      state.players.forEach((p, id) => { if (id !== this.room.sessionId) others.push(p); });
      state.mobs.forEach((m) => { others.push(m); });
    }
    const c = this.localClock(now);
    const active = me.status === "alive" && state.phase === "active";
    const motion = this.predict.motion;
    // The planning map carries the terrain: the bog slows the model where it will be, and the ice lets it slide.
    motion.frame(c, dt, this.predict.frameInput(c, active, me, others, this.aimStreaming(now), this.planMap()));
    if (import.meta.env.DEV && this.clickAt > 0 && Math.hypot(motion.drawn.x - this.clickFrom.x, motion.drawn.y - this.clickFrom.y) > 0.05) {
      this.latency.push(Math.round(now - this.clickAt));
      this.clickAt = 0;
    }
  }

  /**
   * The player ordered a walk (`move` to a point) or a halt (`stop`): the prediction takes it at once, the server hears it
   * with the same order number (it echoes it back when it applies it), and the telegraph of an attack the lock was winding up
   * goes now, as the server cancels the attack.
   */
  private orderMove(kind: "move" | "stop", point?: { x: number; y: number }): void {
    const now = performance.now();
    const c = this.localClock(now);
    const seq = this.predict.nextSeq();
    const map = this.planMap();
    // Clamped to the world as the server clamps it, so both plan to the same place from an edge click.
    const to = point ? clampToWorld(point) : undefined;
    if (map) this.predict.motion.order(kind, seq, c, to, map);
    if (kind === "move" && to) sendInput(this.room, "move", { x: to.x, y: to.y, seq });
    else sendInput(this.room, "stop", { seq });
    this.fx.dropWindups(this.room.sessionId, c, now);
  }

  /**
   * A lock on `id` was ordered. What the old lock was winding up goes now (the server cancels it when it takes the order), and
   * the walk in hand stops being predicted: the server chases from here on. If the server refuses the lock, the state never
   * shows it and the prediction takes the walk up again (net/localMotion.ts `expectLock`).
   */
  private orderTarget(id: string): void {
    // The one already locked is ignored by the server; one too far away is refused: neither cancels anything.
    const me = this.rendered.get(this.room.sessionId);
    const at = this.rendered.get(id);
    if (id === this.lockId || !me || !at || Math.hypot(at.x - me.x, at.y - me.y) > TARGET_RANGE) return;
    const now = performance.now();
    const c = this.localClock(now);
    this.predict.motion.expectLock(c);
    this.fx.dropWindups(this.room.sessionId, c, now);
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
    pointer.updateWorldPoint(this.cameras.main);
    this.moveTo(unproject(pointer.worldX, pointer.worldY), showMarker);
  }

  /** A walk to a ground point, from a ground click or the minimap: one path, so the prediction (orderMove) covers both. */
  private moveTo(target: { x: number; y: number }, showMarker: boolean): void {
    if (this.beforeTeleport()) return;
    this.orderMove("move", target);
    if (import.meta.env.DEV && showMarker) {
      const me = this.rendered.get(this.room.sessionId);
      this.clickAt = performance.now();
      this.clickFrom.x = me?.x ?? 0;
      this.clickFrom.y = me?.y ?? 0;
    }
    this.lockDisplay.note("", performance.now());
    this.lastMoveSentAt = this.time.now;
    if (showMarker) {
      this.marker.setPosition(projX(target.x), projY(target.y)).setVisible(true).setAlpha(1).setScale(1);
      this.tweens.killTweensOf(this.marker);
      this.tweens.add({ targets: this.marker, alpha: 0, scale: 0.4, duration: 450 });
      this.fx.ripple(target.x, target.y, performance.now()); // juice: a ring spreading from the marker
    }
  }

  /**
   * The angle on the ground from the local player, where it is drawn, to the cursor; null before it is drawn. The
   * camera is centred on the drawn player every frame, so the cursor's world point comes from the scroll and the zoom
   * (cursorGround), with no lag behind the camera's own matrix.
   */
  private cursorAngle(pointer: Phaser.Input.Pointer): number | null {
    const me = this.rendered.get(this.room.sessionId);
    if (!me) return null;
    const target = this.cursorGround(pointer);
    return Math.atan2(target.y - me.y, target.x - me.x);
  }

  /**
   * The cursor's ground point, read at body height (see AIM_HEIGHT): clicking a drawn fighter's body lands on its feet.
   * The camera zooms about its centre, so the pointer (canvas pixels) goes through the zoom before the lift, which is
   * in projected world pixels.
   */
  private cursorGround(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const cam = this.cameras.main;
    const w = screenToWorld(pointer.x, pointer.y, cam.scrollX, cam.scrollY, cam.width, cam.height, cam.zoom);
    return unproject(w.x, w.y + AIM_HEIGHT);
  }

  /** The fighter (player or mob) drawn nearest ground point (x, y), within `within` units; the one an arrow or a ball left from. */
  private nearestFighter(x: number, y: number, within: number): string | undefined {
    let best: string | undefined;
    let bestSq = within * within;
    for (const [id, at] of this.rendered) {
      const sq = (at.x - x) * (at.x - x) + (at.y - y) * (at.y - y);
      if (sq < bestSq) { best = id; bestSq = sq; }
    }
    return best;
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
      if (before !== undefined && before !== hand) {
        this.fx.cancelWindups(id, state.serverTime);
        if (id === this.room.sessionId) this.predict.noteWeaponChange(state.serverTime);
      }
    });
  }

  private noteAimSent(a: number): void {
    this.lastAimSent = a;
    this.lastAimSentAt = performance.now();
  }

  /**
   * Every fighter a left click could lock: the other players and the mobs (training dummies are mobs) the state calls
   * alive, at the ground position they are drawn at. The server decides the rest (range, line of sight, evading).
   */
  private targetCandidates(): TargetCandidate[] {
    const list = this.candidates;
    list.length = 0;
    // A hidden (Swarm) or untargetable fighter cannot be locked or picked by an ability: the server refuses it, so it is not offered.
    const add = (id: string, status: string, effects: number) => {
      const at = status === "alive" && targetable(effects) ? this.rendered.get(id) : undefined;
      if (at) list.push({ id, x: at.x, y: at.y });
    };
    const selfId = this.room.sessionId;
    this.room.state.players.forEach((p, id) => { if (id !== selfId) add(id, p.status, p.effects); });
    // Behind the locked coliseum gates every mob is out of reach (the server refuses them), so a click can't snap to one.
    if (!this.room.state.gatesLocked) this.room.state.mobs.forEach((m, id) => add(id, m.status, m.effects));
    return list;
  }

  /** A left click: lock the fighter nearest the cursor (within TARGET_SNAP_RADIUS). A click on empty ground does nothing. */
  private sendTarget(pointer: Phaser.Input.Pointer): void {
    if (this.beforeTeleport() || !this.localAlive()) return;
    const id = pickTarget(this.cursorGround(pointer), this.targetCandidates());
    if (id === null) return;
    sendInput(this.room, "target", { id });
    this.orderTarget(id);
    this.lockDisplay.note(id, performance.now());
  }

  /** What the slot's model reads, from the synced state and the prediction's cast root. */
  private slotInput(me: PlayerState, state: RaidState, slot: AbilitySlot, serverNow: number): AbilitySlotInput {
    const entry = abilityInSlot(me, slot);
    const readyAt = slotReadyAt(me, slot);
    return {
      phase: state.phase, alive: me.status === "alive", ability: entry?.def ?? null, rank: entry?.rank, readyAt,
      cooldownLen: this.slotCooldown(slot).observe(readyAt, state.serverTime), effects: me.effects, blockedBy: entry?.def.blockedBy ?? [],
      castUntil: this.predict.castEndsAt(serverNow),
    };
  }

  /** The slot's view and its cooldown tracker. Only the Wish has one until skills fill Q and E. */
  private slotView(slot: AbilitySlot): AbilitySlotView | undefined {
    return slot === "wish" ? this.wishSlot : undefined;
  }

  private slotCooldown(_slot: AbilitySlot): CooldownTracker {
    return this.wishCooldown;
  }

  /** Once per frame: the Wish slot's picture. */
  private updateWishSlot(me: PlayerState | undefined, state: RaidState, serverNow: number, now: number): void {
    if (!me) return;
    this.wishSlot.update(abilitySlotModel(this.slotInput(me, state, "wish", serverNow), serverNow), now);
  }

  /**
   * The player pressed the key of an ability slot (D: the Wish). Nothing is decided here: the cast carries the cursor's ground
   * point (and the target the cursor picked), and the server validates all of it. The client only keeps a cast that cannot work
   * off the wire (cooling down, stunned, no target, out of range, behind a wall) and says why on the slot; the prediction
   * (`LocalPrediction.noteCast`) roots the model for a cast with a telegraph and moves it at once for a blink, which the
   * server computes from the same pure `blinkLanding`. Generic over the slot: a skill's Q and E use it as is.
   */
  private castSlot(slot: AbilitySlot): void {
    const state = this.room.state;
    const me = state.players.get(this.room.sessionId);
    const entry = me ? abilityInSlot(me, slot) : null;
    const view = this.slotView(slot);
    if (!me || !entry || !view || this.beforeTeleport()) return;
    const { def, rank } = entry;
    const r = rankOf(def, rank);
    const t = r.targeting;
    // While the camera looks at the minimap's peek the cursor's ground point is not where the player means; only a self cast stands.
    if (this.peek && t.kind !== "self") return;
    const now = performance.now();
    const pending = this.pendingCast;
    if (castUnanswered(pending, slot, now, slotReadyAt(me, slot), pending !== null && this.predict.motion.orderPending(pending.seq))) return;
    const serverNow = this.clockSynced ? this.interp.clock.now(now) : state.serverTime;
    // The server refuses every cast that reaches it within CAST_TELEPORT_GRACE_MS of the teleport (aimed at the world before it).
    if (inTeleportGrace(this.teleportAt, serverNow)) return;
    const m = abilitySlotModel(this.slotInput(me, state, slot, serverNow), serverNow);
    if (m.state === "hidden" || m.state === "empty") return;
    const denial = castDenial(m);
    if (denial) {
      view.deny(denial, now);
      return;
    }
    const self = this.rendered.get(this.room.sessionId);
    // The cursor, as a right-click's move reads it (zoom-aware); stale while it is over a DOM panel or has never been seen.
    const aimed = this.aimKnown && this.input.isOver;
    const pointer = this.input.activePointer;
    let aim: Vec2;
    if (aimed) {
      pointer.updateWorldPoint(this.cameras.main);
      aim = clampToWorld(unproject(pointer.worldX, pointer.worldY));
    } else if (t.kind === "self" && self) {
      aim = clampToWorld(self);
    } else {
      view.deny(t.kind === "unit" ? "No target" : "Aim with the cursor", now);
      return;
    }
    const c = this.localClock(now);
    const blink = t.kind === "point" ? r.effects.find((e) => e.do === "blink") : undefined;
    // Every cast carries an order number: the server echoes it for a refused cast too, which frees the slot and drops a predicted root.
    let seq = 0;

    if (blink?.do === "blink") {
      const map = this.mapView?.map;
      const from = this.predict.motion.ready ? this.predict.motion.predicted : self;
      const landing = map && from ? blinkLanding(map, state.gatesLocked, from, aim, blink.maxDist, blink.minDist) : null;
      if (!landing) {
        view.deny("Can't blink there", now);
        return;
      }
      seq = this.predict.nextSeq();
      this.predict.noteCast(c, { castMs: r.castMs, seq, blink: { landing } });
      sendInput(this.room, "cast", { slot, x: aim.x, y: aim.y, seq });
    } else if (t.kind === "unit") {
      const id = pickTarget(this.cursorGround(pointer), this.targetCandidates(), t.snapRadius);
      const at = id === null ? undefined : this.rendered.get(id);
      if (id === null || !at || !self) {
        view.deny("No target", now);
        return;
      }
      const sight = this.planMap();
      const denial = unitCastDenial({
        from: self, to: at, range: t.range, slack: CAST_RANGE_SLACK, los: t.los, sight: (a, b) => !sight || hasLineOfSight(sight, a, b),
        immuneUntil: state.players.get(id)?.immuneUntil ?? 0, serverNow,
      });
      if (denial) {
        view.deny(denial, now);
        return;
      }
      seq = this.predict.nextSeq();
      sendInput(this.room, "cast", { slot, x: aim.x, y: aim.y, id, seq });
      this.predict.noteCast(c, { castMs: r.castMs, seq });
    } else {
      seq = this.predict.nextSeq();
      sendInput(this.room, "cast", { slot, x: aim.x, y: aim.y, seq });
      this.predict.noteCast(c, { castMs: r.castMs, seq });
    }
    // Until the server answers (the ready time changes, or it echoes `seq`: a refusal), a second press is ignored; a blink waits longer.
    this.pendingCast = { slot, seq, readyAt: slotReadyAt(me, slot), until: now + (blink?.do === "blink" ? JUMP_ORDER_EXPIRE_MS : ORDER_EXPIRE_MS) };
    this.afterCast(def, r.castMs, c, now);
  }

  /**
   * A cast the server will take cancels the attack the lock was winding up (a telegraph or an own order do), so its telegraph
   * goes now rather than a round trip later. An own order (the blink) and a lock-dropper (Swarm: its hiding would be undone by a
   * locked auto-attack) also end the lock, so no ring is drawn on it; only the own order stops the walk (the model does that in
   * `LocalMotion.blink`): a lock-dropper's walk in hand goes on after the cast root, on the server and so in the prediction.
   */
  private afterCast(def: AbilityDef, castMs: number, c: number, now: number): void {
    if (castMs > 0 || def.ownOrder) this.fx.dropWindups(this.room.sessionId, c, now);
    if (def.ownOrder || def.dropsLock) this.lockDisplay.note("", now);
  }

  /** Once per frame: which fighter is hovered and which locked, and where their rings are drawn. */
  private updateTargets(me: PlayerState | undefined, now: number): void {
    const alive = me?.status === "alive";
    // isOver: the last pointer position is stale (and meaningless) while the cursor is over a DOM panel.
    this.hoverId = alive && this.aimKnown && this.input.isOver && !this.peek
      ? pickTarget(this.cursorGround(this.input.activePointer), this.targetCandidates()) ?? ""
      : "";
    this.lockId = alive ? this.liveFighter(this.lockDisplay.shown(me.attackTarget, now)) : "";
    // The lock ring already marks the hovered fighter.
    this.rings.update(
      this.hoverId && this.hoverId !== this.lockId ? this.rendered.get(this.hoverId) ?? null : null,
      this.lockId ? this.rendered.get(this.lockId) ?? null : null,
      this.lockId, now,
    );
  }

  /** `id` if it names another fighter that is alive and drawn, else "" (a lock outlives its target for a patch or two). */
  private liveFighter(id: string): string {
    // visiblePosition: a lock ordered just before its target turned hidden keeps no ring on it.
    if (!id || id === this.room.sessionId || !this.visiblePosition(id)) return "";
    const status = (this.room.state.players.get(id) ?? this.room.state.mobs.get(id))?.status;
    return status === "alive" ? id : "";
  }

  /** Where fighter `id` is drawn, or undefined if it is not, or is a remote fighter that is hidden: nothing may point at those. */
  private visiblePosition(id: string): { x: number; y: number } | undefined {
    return visiblePosition(this.rendered, this.room.state.players, this.room.sessionId, id);
  }

  /** Once per frame: streams the aim. The shield faces the cursor while nothing is locked; the server ignores it while one is. */
  private streamAim(me: PlayerState | undefined, now: number): void {
    // isOver: the last pointer position is stale (and meaningless) while the cursor is over a DOM panel.
    if (me?.status !== "alive" || !this.aimKnown || this.beforeTeleport() || !this.input.isOver || this.peek) return;
    const a = this.cursorAngle(this.input.activePointer);
    if (a === null || now - this.lastAimSentAt < AIM_SEND_MS) return;
    const turned = this.lastAimSent === null || angleBetween(a, this.lastAimSent) > AIM_MIN_DELTA;
    if (!turned && now - this.lastAimSentAt < AIM_KEEPALIVE_MS) return;
    sendInput(this.room, "aim", { a });
    this.noteAimSent(a);
  }

  /** This room is a training room (nothing recorded, no results). Read from the state, so it follows the server. */
  private get training(): boolean {
    return this.room.state.training === true;
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
   * still reaches the scene's input; only presses that began on the canvas may issue a move or a lock.
   */
  private pointerStartedOnCanvas(pointer: Phaser.Input.Pointer): boolean {
    // Not while peeking either: the camera is elsewhere, so the cursor's ground point would be wrong.
    return pointer.downElement === this.game.canvas && !this.peek;
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    // Esc has no other use in a run; leaving a practice room costs nothing, so one press is enough.
    if (e.code === "Escape") {
      this.trainingBar?.leave();
      return;
    }
    // Physical keys (e.code), not the produced character, so shortcuts keep working on non-Latin layouts.
    if (e.code === "KeyS") {
      this.orderMove("stop");
      this.lockDisplay.note("", performance.now());
      return;
    }
    if (!this.localAlive()) return;
    if (e.code === "KeyD") {
      this.castSlot("wish");
      return;
    }
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
    const map = buildGameMap(seed);
    this.mapView = new MapView(this, map);
    this.minimap.setMap(map);
  }

  private onFxBatch(batch: FxBatch): void {
    for (const launch of unpackLaunches(batch)) {
      this.projectiles.noteLaunch(launch);
      this.fx.noteLaunch(launch); // juice: the shooter's recoil
    }
    for (const fx of unpackFx(batch, this.room.state.roster, this.warnDropped)) {
      this.predict.noteFx(fx, this.room.sessionId, this.room.state.players.get(this.room.sessionId));
      // Training puts a fighter who goes down back on its feet: no body, no decal, no "was killed" line, no death screen.
      if (fx.kind === "death" && this.training && fx.id === this.room.sessionId) {
        this.fx.cancelWindups(fx.id, fx.t);
        this.announce?.("Knocked down — back on your feet");
        continue;
      }
      if (fx.kind === "death") this.noteDeath(fx.id, fx.t, fx.x, fx.y);
      if (fx.kind === "teleport") this.noteTeleport(fx.t);
      // The stop point is known on arrival, though the fx plays later: it caps the projectile's drawn flight.
      if (fx.kind === "projEnd") this.projectiles.noteEnd(fx);
      this.fx.enqueue(fx);
    }
  }

  private teardown(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.room.onStateChange.remove(this.onState);
    this.unbindFx?.();
    this.unbindFx = null;
    this.unbindResult?.();
    this.unbindResult = null;
    this.fx.destroy();
    this.wishFx.destroy();
    this.fieldView.destroy();
    this.predict.reset();
    this.juice.reset();
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
    this.rings.destroy();
    this.minimap.destroy();
    this.peek = null;
    this.rendered.clear();
    this.deaths.clear();
    this.inHand.clear();
    this.hud.destroy();
    this.trainingBar?.destroy();
    this.trainingBar = null;
    this.weaponBar.destroy();
    this.wishSlot.destroy();
    this.feedback.destroy();
    if (import.meta.env.DEV) {
      const w = window as unknown as { __raid?: { scene?: unknown } };
      if (w.__raid?.scene === this) delete w.__raid;
    }
  }
}
