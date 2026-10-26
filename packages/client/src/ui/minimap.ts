// Bottom-right minimap: a plain top-down view of the whole map. The region tints and walls are painted once per map onto an
// offscreen canvas; the closed gates, the living regional mobs, the camera's view and the local player are repainted on top
// at a low rate, and only when one of them changed. It is also a control: right-click (or right-drag) sends the character
// there, and holding the left button peeks the camera at that spot until it is released.
import {
  FACTIONS, FACTION_IDS, REGION_IDS, TERRAIN_CREVASSE, TERRAIN_FENCE, TERRAIN_LAVA, TILE, TILE_LOW, Y_SCALE, isFactionId,
  isWallTile, type GameMap, type RegionId,
} from "@raid/shared";
import { currentView, onViewChange } from "../view/viewState";
import type { ViewLayout } from "../view/viewport";
import { cssColor, el, uiRoot } from "./dom";
import {
  mapSpan, minimapBacking, minimapSize, minimapToWorld, viewRectOnMinimap, type Point,
} from "./minimapMath";
import "./minimap.css";

/** Overlay pixels the dot radii and line widths were drawn for; they scale with the minimap's size. */
const REF_SIZE = 150;
/** Repaint cadence ceiling (ms): ~10 Hz is plenty for a map nobody drives. */
const REPAINT_MS = 100;
/** While the player is peeking or steering the view rectangle should follow the cursor, so it repaints faster. */
const REPAINT_ACTIVE_MS = 33;
/** A right-button hold re-sends its target at most this often (RaidScene's MOVE_REPEAT_MS). */
export const MOVE_REPEAT_MS = 100;

const COLOR_BG = "rgba(20, 24, 30, 0.8)";
const COLOR_WALL = "#9aa3ad";
/** LOW tiles (they stop bodies, not shots or sight), by terrain kind: painted over the region tints and under the walls. */
const COLOR_LOW_DEFAULT = "#7a808b";
const COLOR_LOW: Readonly<Record<number, string>> = {
  [TERRAIN_LAVA]: "#ff5a14",
  [TERRAIN_FENCE]: "#b4aed2",
  [TERRAIN_CREVASSE]: "#0a1626",
};
/** Faction colours at low alpha, under the walls; "none" is left as the background. */
const COLOR_REGION: Record<RegionId, string | null> = {
  none: null,
  fire: "rgba(255, 112, 67, 0.22)",
  sentenced: "rgba(149, 117, 205, 0.22)",
  plague: "rgba(156, 204, 101, 0.22)",
  frost: "rgba(79, 195, 247, 0.22)",
  holy: "rgba(255, 241, 118, 0.22)",
  coliseum: "rgba(200, 180, 138, 0.3)",
};
/** Closed gates only; open ones are just a gap in the coliseum ring. */
const COLOR_GATE = "#f44336";
const COLOR_PLAYER = "#69f0ae";
const COLOR_PLAYER_DOWN = "#78909c";
const COLOR_ELITE_RIM = "#ffd54f";
/** What the camera sees. */
const COLOR_VIEW = "rgba(255, 255, 255, 0.85)";
/** Faction colours as CSS, in FACTION_IDS order. */
const FACTION_CSS = FACTION_IDS.map((id) => cssColor(FACTIONS[id].color));
/** More than this many mob dots are not drawn (a map has about 40 mobs). */
const MAX_DOTS = 128;
/** Inputs that decide a repaint: player x, y, alive, gates, mob dots, camera x, y. */
const INPUTS = 7;

const TAU = Math.PI * 2;

/** MouseEvent.buttons bits: left, right. */
const BUTTON_LEFT = 1;
const BUTTON_RIGHT = 2;

/** Where the local player is, in world units. */
export interface MinimapPlayer { x: number; y: number }

/** The fields of a synced mob the minimap reads. */
export interface MinimapMob { x: number; y: number; kind: string; status: string; faction: string }

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
  /** Gate tiles as x, y, w, h in backing pixels (flat), precomputed per map. */
  private gateRects: number[] = [];
  /** Remembered so a resize can redraw them in the new scale. */
  private map: GameMap | null = null;
  private mobsSrc: { forEach(cb: (m: MinimapMob) => void): void } | null = null;

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

  constructor(handlers: Partial<MinimapHandlers> = {}) {
    this.handlers = handlers;
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

  /** Repaints the static layer for a (new) map; the next update() paints it regardless of the throttle. */
  setMap(map: GameMap): void {
    this.map = map;
    const g = this.layer.getContext("2d");
    if (!g) return;
    const w = this.layer.width;
    const h = this.layer.height;
    const tile = TILE * this.k;
    g.clearRect(0, 0, w, h);
    g.fillStyle = COLOR_BG;
    g.fillRect(0, 0, w, h);

    // Region tints first, so the walls stay readable on top. Edges are rounded to the nearest pixel (not outward) so
    // neighbouring runs share them exactly: translucent fills would otherwise double up on the overlap.
    const codes = map.regionGrid;
    for (let ty = 0; ty < map.h; ty++) {
      const top = Math.round(ty * tile);
      const bottom = Math.round((ty + 1) * tile);
      let start = 0;
      for (let tx = 1; tx <= map.w; tx++) {
        if (tx < map.w && codes[ty * map.w + tx] === codes[ty * map.w + start]) continue;
        const color = COLOR_REGION[REGION_IDS[codes[ty * map.w + start]] ?? "none"];
        if (color) {
          const left = Math.round(start * tile);
          g.fillStyle = color;
          g.fillRect(left, top, Math.round(tx * tile) - left, bottom - top);
        }
        start = tx;
      }
    }

    // LOW tiles (lava, fence, crevasse) as runs of one terrain kind per row, rounded outward like the walls'; a barrier
    // that is not drawn is an invisible wall to the player.
    const kinds: number[] = new Array(map.w);
    for (let ty = 0; ty < map.h; ty++) {
      const top = Math.floor(ty * tile);
      const bottom = Math.ceil((ty + 1) * tile);
      for (let tx = 0; tx < map.w; tx++) kinds[tx] = map.tiles[ty * map.w + tx] === TILE_LOW ? map.terrain[ty * map.w + tx] : -1;
      let start = 0;
      for (let tx = 1; tx <= map.w; tx++) {
        if (tx < map.w && kinds[tx] === kinds[start]) continue;
        if (kinds[start]! >= 0) {
          const left = Math.floor(start * tile);
          g.fillStyle = COLOR_LOW[kinds[start]!] ?? COLOR_LOW_DEFAULT;
          g.fillRect(left, top, Math.ceil(tx * tile) - left, bottom - top);
        }
        start = tx;
      }
    }

    // Horizontal runs of wall tiles per row; edges are rounded outward so neighbouring rows leave no hairline gaps.
    g.fillStyle = COLOR_WALL;
    for (let ty = 0; ty < map.h; ty++) {
      const top = Math.floor(ty * tile);
      const bottom = Math.ceil((ty + 1) * tile);
      let start = -1;
      for (let tx = 0; tx <= map.w; tx++) {
        if (tx < map.w && isWallTile(map, tx, ty)) {
          if (start < 0) start = tx;
        } else if (start >= 0) {
          const left = Math.floor(start * tile);
          g.fillRect(left, top, Math.ceil(tx * tile) - left, bottom - top);
          start = -1;
        }
      }
    }

    this.gateRects = [];
    for (const gate of map.coliseum.gates) {
      for (const t of gate.tiles) {
        const left = Math.floor(t.x * tile);
        const top = Math.floor(t.y * tile);
        this.gateRects.push(left, top, Math.ceil((t.x + 1) * tile) - left, Math.ceil((t.y + 1) * tile) - top);
      }
    }

    this.hasMap = true;
    this.lastPaint = -Infinity;
    this.last.fill(NaN);
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
    this.lastPaint = now;
    if (this.sameAsLast()) return;
    this.last.set(cur);
    this.paint(player, alive, camera);
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

  private paint(player: MinimapPlayer | undefined, alive: boolean, camera: Point | undefined): void {
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
