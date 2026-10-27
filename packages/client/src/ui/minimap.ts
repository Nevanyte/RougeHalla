// Bottom-right minimap: a plain top-down view of the whole map. The region tints and walls are painted once per map onto an
// offscreen canvas; the closed gates, the living regional mobs, the camera's view and the local player are repainted on top
// at a low rate, and only when one of them changed. It is also a control: right-click (or right-drag) sends the character
// there, and holding the left button peeks the camera at that spot until it is released.
import { FACTION_IDS, Y_SCALE, isFactionId, type GameMap, type Vec2 } from "@raid/shared";
import { getSettings } from "../settings";
import { currentView, onViewChange } from "../view/viewState";
import type { ViewLayout } from "../view/viewport";
import { el, uiRoot } from "./dom";
import {
  COLOR_PLAYER, COLOR_PLAYER_DOWN, COLOR_WALL, FACTION_CSS, gateRects, paintCamps, paintChests, paintMapBase, paintRoute,
  type ChestBlip,
} from "./mapPainter";
import {
  mapSpan, minimapBacking, minimapSize, minimapToWorld, viewRectOnMinimap, type Point,
} from "./minimapMath";
import "./minimap.css";
import { osPrefersReducedMotion, reducedMotionActive } from "./settingsPanel";
import { paintQuestBlips } from "./questMap";
import type { QuestMapBlip } from "./questModel";

/** Overlay pixels the dot radii and line widths were drawn for; they scale with the minimap's size. */
const REF_SIZE = 150;
/** Repaint cadence ceiling (ms): ~10 Hz is plenty for a map nobody drives. */
const REPAINT_MS = 100;
/** While the player is peeking or steering the view rectangle should follow the cursor, so it repaints faster. */
const REPAINT_ACTIVE_MS = 33;
/** A right-button hold re-sends its target at most this often (RaidScene's MOVE_REPEAT_MS). */
export const MOVE_REPEAT_MS = 100;

/** Closed gates only; open ones are just a gap in the coliseum ring. */
const COLOR_GATE = "#f44336";
const COLOR_ELITE_RIM = "#ffd54f";
/** What the camera sees. */
const COLOR_VIEW = "rgba(255, 255, 255, 0.85)";
/** More than this many mob dots are not drawn (a 40-camp map has up to 200 mobs: 3-5 spots a camp, 160 on average). */
const MAX_DOTS = 224;
/** Inputs that decide a repaint: player x, y, alive, gates, mob dots, camera x, y, route, chest blips (and their pulse), camp states, quests. */
const INPUTS = 11;
/** The chest blip's ring breathes through these steps (0 = at rest, 1 = widest); 0 throughout under reduced motion. */
const PULSE_STEPS: readonly number[] = [0, 0.33, 0.66, 1, 0.66, 0.33];
/** ms per pulse step. */
const PULSE_STEP_MS = 160;
/** More than this many chest blips are not drawn (a chest per cleared camp, each up 15 s: a map has 40 camps). */
const MAX_CHESTS = 48;
/** The route is drawn faint: the minimap is for steering, the route is a reminder. */
const ROUTE_ALPHA = 0.6;

const TAU = Math.PI * 2;

/** MouseEvent.buttons bits: left, right. */
const BUTTON_LEFT = 1;
const BUTTON_RIGHT = 2;

/** Where the local player is, in world units. */
export interface MinimapPlayer { x: number; y: number }

/** The fields of a synced mob the minimap reads. */
export interface MinimapMob { x: number; y: number; kind: string; status: string; faction: string }

/** The planned route as the minimap draws it, in world units. */
export interface MinimapRoute {
  points: readonly Vec2[];
  stops: readonly Vec2[];
  next: number;
}

export interface MinimapOptions {
  /** Whether the chest blip's pulse is off (reduced motion, by the settings or the system). A test passes its own. */
  reducedMotion?: () => boolean;
}

/** What the minimap asks of the scene, in world units. */
export interface MinimapHandlers {
  /** Right button went down, or is held and moved: walk there (the same order a right-click on the ground sends). */
  /** `first` is true for the press, false for the repeats while the right button stays down (a ground hold passes showMarker false too). */
  onMove(x: number, y: number, first?: boolean): void;
  /** Left button went down, or is held and moved: look at this point. */
  onPeek(x: number, y: number): void;
  /** The left button is up (or the press was lost): back to the character. Once per peek. */
  onPeekEnd(): void;
}

/** `buttons` bit of a `button` index (the middle button is bit 4, the right is 2). */
function buttonBit(button: number): number {
  return button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : button > 2 ? 1 << button : 0;
}

export class Minimap {
  private readonly canvas = el("canvas", "minimap");
  private readonly ctx = this.canvas.getContext("2d");
  /** Region tints and walls. A separate canvas so a repaint is one drawImage instead of a few thousand fillRects. */
  private readonly layer = document.createElement("canvas");
  private readonly handlers: Partial<MinimapHandlers>;
  private readonly unsubView: () => void;
  /** The canvas backing store's side (device pixels); 0 until the first layout. */
  private backing = 0;
  /** Backing-store pixels per world unit, and per REF_SIZE overlay pixels (dots and lines scale with the map). */
  private k = 1;
  private px = 1;
  /** The visible world in projected pixels (the camera's view), from the layout. */
  private viewW = 0;
  private viewH = 0;
  private lastPaint = -Infinity;
  /**
   * Inputs of the last paint: player x, y (backing pixels); alive; gates locked; a hash of the mob dots; camera x, y.
   * An update whose inputs all match skips the repaint.
   */
  private readonly last = new Float64Array(INPUTS).fill(NaN);
  private readonly now = new Float64Array(INPUTS);
  /** Living regional mobs as x, y (backing pixels) and a code: (faction index + 1) * 2, plus 1 for an elite. */
  private readonly dots = new Float32Array(MAX_DOTS * 3);
  private dotCount = 0;
  private dotsHash = 0;
  private hasMap = false;
  private gatesLocked = false;
  private route: MinimapRoute | null = null;
  private routeHash = 0;
  private showRoute = true;
  /** Gate tiles as x, y, w, h in backing pixels (flat), precomputed per map. */
  private gateRects: number[] = [];
  /** Remembered so a resize can redraw them in the new scale. */
  private map: GameMap | null = null;
  private mobsSrc: { forEach(cb: (m: MinimapMob) => void): void } | null = null;
  /** Chests that are up (a cleared camp's shared chest), with the seconds each has left; drawn on top of the camps. */
  private chests: ChestBlip[] = [];
  private chestsHash = 0;
  /** Each camp's state (RaidState.camps[i].state): a cleared camp is crossed out, a disturbed one (fought at once) wears a muted ring. */
  private campStates: number[] = [];
  private campStatesHash = 0;
  private campsMarked = false;
  private questSource: readonly QuestMapBlip[] = [];
  private quests: QuestMapBlip[] = [];
  private questsHash = 0;
  private readonly reducedMotion: () => boolean;

  // Pointer state. A press is only ever started by a pointerdown on the canvas; the rest is followed on the window.
  private peeking = false;
  private peekX = NaN;
  private peekY = NaN;
  private steering = false;
  /** The last order sent (world units), and the time of its slot: the next may go MOVE_REPEAT_MS after it. */
  private sentX = NaN;
  private sentY = NaN;
  private sentAt = -Infinity;
  /** A point the throttle held back, sent when the slot opens so the drag always ends where the cursor stopped. */
  private pending: Point | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pointerId = -1;

  constructor(handlers: Partial<MinimapHandlers> = {}, options: MinimapOptions = {}) {
    this.handlers = handlers;
    this.reducedMotion = options.reducedMotion ?? (() => reducedMotionActive(getSettings(), osPrefersReducedMotion()));
    this.applyView(currentView());
    this.unsubView = onViewChange((layout) => this.applyView(layout));

    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    // Phaser listens for mousedown / touchstart on the window; stopping them here keeps a minimap press out of the world.
    // mouseup / pointerup are deliberately not stopped: a press that began on the canvas and ends here must reach Phaser.
    c.addEventListener("mousedown", this.stop);
    c.addEventListener("touchstart", this.stop);
    c.addEventListener("contextmenu", this.onContextMenu);
    c.addEventListener("lostpointercapture", this.onLostCapture);
    window.addEventListener("pointermove", this.onPointerFollow);
    window.addEventListener("pointerup", this.onPointerFollow);
    window.addEventListener("pointercancel", this.onAbort);
    window.addEventListener("blur", this.onAbort);
    document.addEventListener("visibilitychange", this.onVisibility);
    uiRoot().append(c);
  }

  /** Whether the coliseum gates are drawn closed; takes effect at the next update(). Cheap to call every frame. */
  setGatesLocked(locked: boolean): void {
    this.gatesLocked = locked;
  }

  /**
   * Takes the living regional mobs (training dummies and the dead are left off) as small dots in their faction's colour,
   * an elite a bigger one with a gold rim; takes effect at the next update(). Cheap to call every frame: it only hashes
   * the quantised positions, and the repaint waits for a change.
   */
  setMobs(mobs: { forEach(cb: (m: MinimapMob) => void): void }): void {
    this.mobsSrc = mobs;
    const k = this.k;
    const dots = this.dots;
    let n = 0;
    let hash = 17;
    mobs.forEach((m) => {
      if (n >= MAX_DOTS || m.status !== "alive" || (m.kind !== "mob" && m.kind !== "elite")) return;
      const px = Math.round(m.x * k);
      const py = Math.round(m.y * k);
      const code = (isFactionId(m.faction) ? FACTION_IDS.indexOf(m.faction) + 1 : 0) * 2 + (m.kind === "elite" ? 1 : 0);
      dots[n * 3] = px;
      dots[n * 3 + 1] = py;
      dots[n * 3 + 2] = code;
      hash = (Math.imul(hash, 31) + px) | 0;
      hash = (Math.imul(hash, 31) + py) | 0;
      hash = (Math.imul(hash, 31) + code) | 0;
      n++;
    });
    this.dotCount = n;
    this.dotsHash = (Math.imul(hash, 31) + n) | 0;
  }

  /**
   * The chests that are up, each with the seconds it has left: a pulsing gold blip with that number, drawn over the camps.
   * Takes effect at the next update(). Cheap to call every frame: it hashes the quantised positions and the whole seconds, so
   * the repaint waits for a change (once a second while a chest drains).
   */
  setChests(chests: readonly ChestBlip[]): void {
    const k = this.k;
    const list = this.chests;
    list.length = 0;
    let hash = 19;
    for (const c of chests) {
      if (list.length >= MAX_CHESTS) break;
      const left = Math.max(0, Math.ceil(c.left));
      list.push({ x: c.x, y: c.y, left });
      hash = (Math.imul(hash, 31) + Math.round(c.x * k)) | 0;
      hash = (Math.imul(hash, 31) + Math.round(c.y * k)) | 0;
      hash = (Math.imul(hash, 31) + left) | 0;
    }
    this.chestsHash = list.length === 0 ? 0 : (Math.imul(hash, 31) + list.length) | 0;
  }

  /**
   * Each camp's state, in map.camps order (0 idle, 1 engaged, 2 cleared): a cleared camp is drawn dimmed and crossed out, an
   * engaged one (somebody has fought there; the state is sticky history) with a small muted ring. All idle (or none) draws the
   * plain markers. Takes effect at the next update().
   */
  setCampStates(states: ArrayLike<number>): void {
    const list = this.campStates;
    list.length = states.length;
    let hash = 23;
    let any = false;
    for (let i = 0; i < states.length; i++) {
      const v = states[i] === 1 || states[i] === 2 ? (states[i] as number) : 0;
      list[i] = v;
      if (v !== 0) any = true;
      hash = (Math.imul(hash, 31) + v) | 0;
    }
    this.campsMarked = any;
    this.campStatesHash = any ? hash : 0;
  }

  setQuests(blips: readonly QuestMapBlip[]): void {
    this.questSource = blips;
    this.quests = blips.slice(0, 64);
    let hash = 29;
    for (const b of this.quests) {
      hash = (Math.imul(hash, 31) + Math.round(b.x * this.k)) | 0;
      hash = (Math.imul(hash, 31) + Math.round(b.y * this.k)) | 0;
      hash = (Math.imul(hash, 31) + b.role.length + b.kind.length) | 0;
    }
    this.questsHash = this.quests.length === 0 ? 0 : (Math.imul(hash, 31) + this.quests.length) | 0;
  }

  /** Repaints the static layer for a (new) map; the next update() paints it regardless of the throttle. */
  setMap(map: GameMap): void {
    this.map = map;
    const g = this.layer.getContext("2d");
    if (!g) return;
    paintMapBase(g, map, this.layer.width, this.layer.height, this.k, { patterns: true });
    this.gateRects = gateRects(map, this.k);

    this.hasMap = true;
    this.lastPaint = -Infinity;
    this.last.fill(NaN);
  }

  /**
   * The planned route (RouteState.view): `points` is the polyline still ahead, `stops` its waypoints, `next` the index of the
   * stop the player is heading for. Null or empty clears it. Takes effect at the next update().
   */
  setRoute(route: MinimapRoute | null): void {
    this.route = route && (route.points.length > 0 || route.stops.length > 0) ? route : null;
    let hash = 0;
    if (this.route) {
      hash = 31 + this.route.next;
      for (const p of this.route.points) {
        hash = (Math.imul(hash, 31) + Math.round(p.x)) | 0;
        hash = (Math.imul(hash, 31) + Math.round(p.y)) | 0;
      }
      hash = (Math.imul(hash, 31) + this.route.stops.length) | 0;
    }
    this.routeHash = hash;
  }

  /** The "Show route" setting. */
  setShowRoute(show: boolean): void {
    this.showRoute = show;
  }

  /**
   * Call every frame; it paints at most every REPAINT_MS and only if something it shows moved.
   * `alive` only picks the dot's colour (a downed player's last position stays on the map). `camera` is the centre of
   * what the camera shows, in projected (drawn) coordinates; given, a thin rectangle marks the view.
   */
  update(now: number, player: MinimapPlayer | undefined, alive: boolean, camera?: Point): void {
    const gap = this.peeking || this.steering ? REPAINT_ACTIVE_MS : REPAINT_MS;
    if (!this.hasMap || !this.ctx || now - this.lastPaint < gap) return;
    const k = this.k;
    const cur = this.now;
    // Quantised to backing pixels: a sub-pixel step would repaint an identical image.
    cur[0] = player ? Math.round(player.x * k) : NaN;
    cur[1] = player ? Math.round(player.y * k) : NaN;
    cur[2] = alive ? 1 : 0;
    cur[3] = this.gatesLocked ? 1 : 0;
    cur[4] = this.dotsHash;
    cur[5] = camera ? Math.round(camera.x * k) : NaN;
    cur[6] = camera ? Math.round((camera.y / Y_SCALE) * k) : NaN;
    cur[7] = this.showRoute ? this.routeHash : 0;
    const pulse = this.chestsHash !== 0 && !this.reducedMotion() ? Math.floor(now / PULSE_STEP_MS) % PULSE_STEPS.length : 0;
    cur[8] = this.chestsHash === 0 ? 0 : (Math.imul(this.chestsHash, 8) + pulse) | 0;
    cur[9] = this.campStatesHash;
    cur[10] = this.questsHash;
    this.lastPaint = now;
    if (this.sameAsLast()) return;
    this.last.set(cur);
    this.paint(player, alive, camera, pulse);
  }

  destroy(): void {
    this.unsubView();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("mousedown", this.stop);
    c.removeEventListener("touchstart", this.stop);
    c.removeEventListener("contextmenu", this.onContextMenu);
    c.removeEventListener("lostpointercapture", this.onLostCapture);
    window.removeEventListener("pointermove", this.onPointerFollow);
    window.removeEventListener("pointerup", this.onPointerFollow);
    window.removeEventListener("pointercancel", this.onAbort);
    window.removeEventListener("blur", this.onAbort);
    document.removeEventListener("visibilitychange", this.onVisibility);
    // Lets the scene's camera come back if the scene is torn down mid-peek.
    this.abort();
    c.remove();
    // Releases the offscreen bitmap's memory right away rather than at the next collection.
    this.layer.width = 0;
    this.layer.height = 0;
  }

  // ------------------------------------------------------------------------------------------------------------ size

  /** Sizes the element and both canvases for a layout, and repaints from the remembered map and mobs. */
  private applyView(layout: ViewLayout): void {
    const size = minimapSize(layout.uiW, layout.uiH);
    const backing = minimapBacking(size, layout.uiScale, layout.dpr);
    this.viewW = layout.worldW;
    this.viewH = layout.worldH;
    this.canvas.style.setProperty("--mm-size", `${size}px`);
    if (backing !== this.backing) {
      this.backing = backing;
      this.canvas.width = backing;
      this.canvas.height = backing;
      this.layer.width = backing;
      this.layer.height = backing;
      // The canvas is square; a non-square world would simply leave the short side empty.
      this.k = backing / mapSpan();
      this.px = backing / REF_SIZE;
      if (this.map) this.setMap(this.map);
      if (this.mobsSrc) this.setMobs(this.mobsSrc);
      this.setQuests(this.questSource);
    }
    // The view rectangle depends on the visible world, which a resize changes even when the backing store stays.
    this.lastPaint = -Infinity;
    this.last.fill(NaN);
  }

  /** NaN fields count as equal to NaN (an absent player), unlike `===`. */
  private sameAsLast(): boolean {
    for (let i = 0; i < this.now.length; i++) {
      const a = this.now[i];
      const b = this.last[i];
      if (a !== b && !(a !== a && b !== b)) return false;
    }
    return true;
  }

  private paint(player: MinimapPlayer | undefined, alive: boolean, camera: Point | undefined, pulseStep = 0): void {
    const c = this.ctx;
    if (!c) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const { k, px } = this;
    c.clearRect(0, 0, w, h);
    c.drawImage(this.layer, 0, 0);

    if (this.gatesLocked) {
      c.fillStyle = COLOR_GATE;
      const r = this.gateRects;
      for (let i = 0; i < r.length; i += 4) c.fillRect(r[i], r[i + 1], r[i + 2], r[i + 3]);
    }

    // Under the mob dots and the player: a camp is a place, the dots are who is there.
    if (this.map && this.map.camps.length > 0) paintCamps(c, this.map.camps, k, px, this.campsMarked ? this.campStates : undefined);
    if (this.route && this.showRoute) paintRoute(c, this.route.points, this.route.stops, k, px, { alpha: ROUTE_ALPHA, next: this.route.next });
    if (this.chests.length > 0) paintChests(c, this.chests, k, px, PULSE_STEPS[pulseStep] ?? 0);
    if (this.quests.length > 0) paintQuestBlips(c, this.quests, k, px);

    if (camera && this.viewW > 0) {
      // Clipped to the map: near an edge the camera sees past it, and the rectangle shows what of the map is in view.
      const r = viewRectOnMinimap(camera, this.viewW, this.viewH);
      const line = Math.max(1, Math.round(px));
      const x0 = Math.max(r.x * w, line / 2);
      const y0 = Math.max(r.y * h, line / 2);
      const x1 = Math.min((r.x + r.w) * w, w - line / 2);
      const y1 = Math.min((r.y + r.h) * h, h - line / 2);
      if (x1 > x0 && y1 > y0) {
        c.strokeStyle = COLOR_VIEW;
        c.lineWidth = line;
        c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    const dots = this.dots;
    c.lineWidth = px;
    for (let i = 0; i < this.dotCount; i++) {
      const code = dots[i * 3 + 2]!;
      const elite = code % 2 === 1;
      c.fillStyle = FACTION_CSS[(code >> 1) - 1] ?? COLOR_WALL;
      c.beginPath();
      c.arc(dots[i * 3]!, dots[i * 3 + 1]!, (elite ? 2.4 : 1.4) * px, 0, TAU);
      c.fill();
      if (elite) {
        c.strokeStyle = COLOR_ELITE_RIM;
        c.stroke();
      }
    }

    if (player) {
      c.fillStyle = alive ? COLOR_PLAYER : COLOR_PLAYER_DOWN;
      c.strokeStyle = "#0b0e11";
      c.lineWidth = px;
      c.beginPath();
      c.arc(player.x * k, player.y * k, 2.6 * px, 0, TAU);
      c.fill();
      c.stroke();
    }
  }

  // ---------------------------------------------------------------------------------------------------------- pointer

  private readonly stop = (e: Event): void => { e.stopPropagation(); };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    try {
      // Keeps the drag on the minimap when the cursor leaves it, and ends it on release wherever that is.
      this.canvas.setPointerCapture(e.pointerId);
      this.pointerId = e.pointerId;
    } catch { /* the pointer is already gone; the window listeners still end the press */ }
    this.sync(e, e.buttons || buttonBit(e.button), true);
  };

  /** The pointer moved or a button went up, during a press that began on the minimap (the window sees it wherever it is). */
  private readonly onPointerFollow = (e: PointerEvent): void => {
    if (!this.peeking && !this.steering) return;
    this.sync(e, e.type === "pointerup" ? e.buttons & ~buttonBit(e.button) : e.buttons, false);
  };

  private readonly onLostCapture = (): void => {
    // Normally fires after the pointerup that ended the press, when there is nothing left to end.
    if (this.peeking || this.steering) this.abort();
  };

  private readonly onAbort = (): void => { this.abort(); };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === "hidden") this.abort();
  };

  /**
   * Brings the peek and the steering in line with the buttons held. A chord (the second button pressed while one is
   * held) arrives as a pointermove, so both are derived from `held` rather than from which event came.
   * `pressed`: a pointerdown, which always sends its order at once.
   */
  private sync(e: PointerEvent, held: number, pressed: boolean): void {
    const at = minimapToWorld(e.clientX, e.clientY, this.canvas.getBoundingClientRect());

    if (held & BUTTON_LEFT) {
      if (!this.peeking) {
        this.peeking = true;
        this.canvas.classList.toggle("peeking", true);
      }
      if (pressed || at.x !== this.peekX || at.y !== this.peekY) {
        this.peekX = at.x;
        this.peekY = at.y;
        this.handlers.onPeek?.(at.x, at.y);
      }
    } else if (this.peeking) {
      this.endPeek();
    }

    if (held & BUTTON_RIGHT) {
      const started = !this.steering;
      if (started) {
        this.steering = true;
        this.canvas.classList.toggle("steering", true);
      }
      if (pressed || started) this.send(at, e.timeStamp, true);
      else this.sendThrottled(at, e.timeStamp);
    } else if (this.steering) {
      // A point the throttle is holding stays queued: the drag ended there.
      this.steering = false;
      this.canvas.classList.toggle("steering", false);
    }
  }

  private send(at: Point, t: number, first = false): void {
    this.sentX = at.x;
    this.sentY = at.y;
    this.sentAt = t;
    this.dropPending();
    this.handlers.onMove?.(at.x, at.y, first);
  }

  /** A held right button: re-sent when the point moved, at most every MOVE_REPEAT_MS; the last point waits for its slot. */
  private sendThrottled(at: Point, t: number): void {
    if (at.x === this.sentX && at.y === this.sentY) {
      this.dropPending();
      return;
    }
    const wait = this.sentAt + MOVE_REPEAT_MS - t;
    if (wait <= 0) {
      this.send(at, t);
      return;
    }
    this.pending = at;
    this.timer ??= setTimeout(this.flush, wait);
  }

  private readonly flush = (): void => {
    this.timer = null;
    const at = this.pending;
    if (at) this.send(at, this.sentAt + MOVE_REPEAT_MS);
  };

  /** Forgets a held-back point and its timer (an older timer must never release a newer point early). */
  private dropPending(): void {
    this.pending = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private endPeek(): void {
    this.peeking = false;
    this.peekX = NaN;
    this.peekY = NaN;
    this.canvas.classList.toggle("peeking", false);
    this.handlers.onPeekEnd?.();
  }

  /** Ends whatever press is in progress and drops an order still waiting for its slot (blur, cancel, hidden, destroy). */
  private abort(): void {
    if (this.peeking) this.endPeek();
    if (this.steering) {
      this.steering = false;
      this.canvas.classList.toggle("steering", false);
    }
    this.dropPending();
    if (this.pointerId >= 0) {
      try { this.canvas.releasePointerCapture(this.pointerId); } catch { /* not captured any more */ }
      this.pointerId = -1;
    }
  }
}
