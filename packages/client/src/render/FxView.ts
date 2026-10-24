// Visual-only combat effects. The server stamps each event with the server time it happened (`t`); events wait in a
// queue until render time (the same delayed clock remote players are drawn at) reaches `t`, so a swing appears
// together with the positions it was made between. Effects are driven from update(), not tweens or timers: nothing
// outlives the scene, and finished effects hand their Graphics/Text back to a small pool instead of being re-created.
import Phaser from "phaser";
import {
  BUFF_LABELS, PLAYER_RADIUS, WEAPONS, Y_SCALE, buffToast, comboById, comboToast, formatGain, isDot, type ProjectileEnd,
  type SignatureKind, type TimedFx,
} from "@raid/shared";
import { ELITE_COLOR, STAT_COLOR } from "../ui/buffTheme";
import { cssColor } from "../ui/dom";
import type { ToastTone } from "../ui/toast";
import { traceRim, traceSector } from "./groundShapes";
import { BODY_LIFT, depthFor, projX, projY } from "./projection";

/** An event this far ahead of render time means the clock is not synced (or jumped): play it now rather than sit on it. */
export const FX_FUTURE_SLACK_MS = 1000;
/** Older than this behind render time, an event is not worth showing any more. */
const STALE_MS = 2000;
/** Backstop for a stalled render loop (hidden tab): messages keep arriving while update() does not run. */
const MAX_PENDING = 256;
/** Idle Graphics/Text kept for reuse; anything beyond this is destroyed on release. */
const POOL_MAX = 16;

const SWING_MS = 180;
const DECAL_MS = 2000;
const HEAL_MS = 800;
const FLOAT_MS = 1100;
const RING_MS = 380;
const HIT_NUMBER_MS = 700;
const STAGGER_MS = 500;
const FLAME_MS = 380;
const TELEPORT_FLASH_MS = 400;
/** Peak opacity of the teleport flash; the camera's default of 1 would white the screen out. */
const TELEPORT_FLASH_ALPHA = 0.7;
/** A telegraph lasts the server's windup; these bound a malformed `ms`. */
const MIN_WINDUP_MS = 40;
const MAX_WINDUP_MS = 1000;

/** Above every y-sorted entity (ground y is at most a few thousand) but below the click marker (1e6). */
const DEPTH_FX = 8e5;

const DECAL_COLOR = 0xd32f2f;
const SWING_RIM = 0xffffff;

/** Half-extents of the death X in screen pixels; flattened by Y_SCALE because it lies on the ground. */
const DECAL_HALF_W = 14;
const DECAL_HALF_H = DECAL_HALF_W * Y_SCALE;
/** Fraction of the decal's life it stays fully opaque before fading. */
const DECAL_HOLD = 0.25;
/** Screen pixels above the ground where a heal number starts (clear of the name label) and how far it climbs. */
const HEAL_START_HEIGHT = BODY_LIFT + PLAYER_RADIUS + 38;
const HEAL_RISE = 28;
const HIT_START_HEIGHT = BODY_LIFT + PLAYER_RADIUS + 20;
/** Other players' buff and combo news floats above the heal numbers' lane. */
const FLOAT_START_HEIGHT = HEAL_START_HEIGHT + 14;
const FLOAT_RISE = 22;
/** Floats that follow one another (a drop and the combo it unlocks) stack this many pixels apart, over this many lanes. */
const FLOAT_LANES = 3;
const FLOAT_LANE_PX = 13;
const HIT_RISE = 34;
/** Hit numbers fan out over this many lanes, this many pixels apart, so simultaneous ones don't overprint. */
const HIT_LANES = 5;
const HIT_LANE_PX = 9;

const HIT_OTHERS = "#cfd8dc";
const HIT_BY_ME = "#ffd54f";
const HIT_ON_ME = "#ff5252";
const HEAL_COLOR = "#81f78b";
const COMBO_FLOAT_COLOR = "#ffe082";
/** Signature damage over time arrives as one small number per 500 ms chunk, in the signature's colour. */
const DOT_COLORS: Readonly<Record<SignatureKind, string>> = {
  burn: "#ffa040",
  disease: "#b2d96c",
  mark: "#d1a8ff",
  backlash: "#ff7043",
};
const DOT_NUMBER_SIZE = 11;
/** The backlash flame's layers, outer to inner: size relative to the tongue, and colour. */
const FLAME_LAYERS: ReadonlyArray<readonly [number, number]> = [[1, 0xff5722], [0.62, 0xffc107]];
/** A heal under this is not drawn: Holy's lifesteal pays in fractions on most ticks. */
const MIN_HEAL_SHOWN = 1;

/** What FxView needs from the scene; kept as callbacks so it never reaches into scene internals. */
export interface FxHost {
  /** The local player's id: damage to it is red, its hits on others gold. */
  readonly localId: string;
  /** The drawn fighter (player or mob), for hit flashes. */
  view(id: string): { flash(): void } | undefined;
  /** What a mob id is ("dummy" | "mob" | "elite"), or undefined for a player or an unknown id: mob deaths are quieter than players'. */
  mobKind?(id: string): string | undefined;
  /** Where a fighter is drawn right now (ground coordinates), for effects that follow them. */
  position(id: string): { x: number; y: number } | undefined;
  name(id: string): string | undefined;
  /** A projectile's end is due: stop drawing it (the impact is FxView's). */
  projectileEnded(id: string): void;
  /** A hit on the local player is due (at render time, together with its flash and number): drives the screen vignette. */
  localHit?(fx: FxOf<"hit">): void;
  /**
   * Optional sink for short text such as "<name> was killed", "<name> is on a rampage — bounty N GV" or "To the coliseum!".
   * `tone` marks the local player's buff and combo news.
   */
  announce?(text: string, tone?: ToastTone): void;
}

type FxOf<K extends TimedFx["kind"]> = Extract<TimedFx, { kind: K }>;

/** Not a server event: a client-side cancel queued among them so it plays in render-time order (see cancelWindups). */
interface CancelWindups { kind: "cancelWindups"; id: string; t: number }
type Queued = TimedFx | CancelWindups;

type EffectKind = "windup" | "cast" | "swing" | "burst" | "mark" | "decal" | "heal" | "number" | "flame" | "float" | "ring";

interface Active {
  kind: EffectKind;
  g: Phaser.GameObjects.Graphics | null;
  text: Phaser.GameObjects.Text | null;
  /** performance.now() when it began (effects run on the local clock once they have been released from the queue). */
  start: number;
  duration: number;
  /** The fighter it follows (everything but swing, burst and decal). */
  id: string;
  /** Last ground position it was drawn at. */
  x: number;
  y: number;
  /** Ground angle (windup, cast), horizontal pixel offset (number), extra start height in pixels (float) or the size the ring ends at, in body radii (ring). */
  a: number;
}

interface BurstStyle {
  color: number;
  radius: number;
  rays: number;
  ring: boolean;
  ms: number;
}

const MOB_DEATH_BURST: BurstStyle = { color: 0xcfd8dc, radius: 15, rays: 6, ring: true, ms: 300 };
const ELITE_DEATH_BURST: BurstStyle = { color: ELITE_COLOR, radius: 26, rays: 10, ring: true, ms: 460 };
const BLOCK_BURST: BurstStyle = { color: 0xb3e5fc, radius: 14, rays: 7, ring: true, ms: 240 };
const IMPACT_BURSTS: Readonly<Record<ProjectileEnd, BurstStyle>> = {
  hit: { color: 0xffe0b2, radius: 11, rays: 6, ring: false, ms: 200 },
  wall: { color: 0xcfd8dc, radius: 9, rays: 5, ring: false, ms: 220 },
  range: { color: 0x90a4ae, radius: 6, rays: 0, ring: true, ms: 180 },
  reflected: { color: 0x80deea, radius: 12, rays: 8, ring: true, ms: 260 },
  blocked: { color: 0x80deea, radius: 10, rays: 5, ring: false, ms: 220 },
  deleted: { color: WEAPONS.wand.color, radius: 13, rays: 6, ring: true, ms: 240 },
  destroyed: { color: 0xff8a80, radius: 17, rays: 8, ring: true, ms: 280 },
  cleared: { color: 0x90a4ae, radius: 5, rays: 0, ring: true, ms: 150 },
};

export class FxView {
  private pending: Queued[] = [];
  private readonly active: Active[] = [];
  private readonly freeGraphics: Phaser.GameObjects.Graphics[] = [];
  private readonly freeText: Phaser.GameObjects.Text[] = [];
  private lane = 0;
  private floatLane = 0;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly host: FxHost) {}

  /** Called for every `fx` message as it arrives; nothing is drawn until update() finds it due. */
  enqueue(fx: TimedFx): void {
    if (this.destroyed || !fx || !Number.isFinite(fx.t)) return;
    this.push(fx);
  }

  /**
   * Drops fighter `id`'s telegraphs once render time reaches `t`. For what cancels an action on the server without an fx
   * (a swap, or a pickup that replaced the weapon in hand): the caller sees it in the state, which is ahead of render
   * time, so the cancel waits behind any windup stamped before it.
   */
  cancelWindups(id: string, t: number): void {
    if (this.destroyed || !Number.isFinite(t)) return;
    this.push({ kind: "cancelWindups", id, t });
  }

  private push(item: Queued): void {
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push(item);
  }

  /**
   * Once per frame. `renderT` is the server time being rendered this frame (the value remote players are sampled at).
   * An event plays when renderT >= fx.t; if the clock is unsynced, or the event claims to be more than a second in
   * the future, it plays at once; if it is more than two seconds in the past it is dropped.
   */
  update(renderT: number, now: number, clockSynced: boolean): void {
    if (this.destroyed) return;
    const q = this.pending;
    if (q.length > 0) {
      let keep = 0;
      for (let i = 0; i < q.length; i++) {
        const fx = q[i]!;
        if (!clockSynced || fx.t > renderT + FX_FUTURE_SLACK_MS) this.play(fx, now);
        else if (fx.t > renderT) q[keep++] = fx;
        else if (fx.t >= renderT - STALE_MS) this.play(fx, now);
      }
      q.length = keep;
    }
    this.advance(now);
  }

  destroy(): void {
    this.destroyed = true;
    this.pending.length = 0;
    for (const e of this.active) { e.g?.destroy(); e.text?.destroy(); }
    this.active.length = 0;
    for (const g of this.freeGraphics) g.destroy();
    this.freeGraphics.length = 0;
    for (const t of this.freeText) t.destroy();
    this.freeText.length = 0;
  }

  private play(fx: Queued, now: number): void {
    switch (fx.kind) {
      case "cancelWindups":
        this.cancelWindup(fx.id);
        break;
      case "windup":
        this.windup(fx, now);
        break;
      case "swing":
        this.swing(fx, now);
        break;
      case "hit":
        this.hit(fx, now);
        break;
      case "block":
        this.block(fx, now);
        break;
      case "stagger":
        this.cancelWindup(fx.id);
        this.mark(fx.id, now);
        break;
      case "projEnd": {
        this.host.projectileEnded(fx.id);
        const style = IMPACT_BURSTS[fx.reason];
        const color = fx.proj === "ball" && (fx.reason === "hit" || fx.reason === "wall") ? WEAPONS.wand.color : style.color;
        this.burst(fx.x, fx.y, { ...style, color }, now);
        break;
      }
      case "death": {
        this.cancelWindup(fx.id);
        const mob = this.host.mobKind?.(fx.id);
        if (mob === "mob" || mob === "elite") {
          this.mobDeath(fx, mob === "elite", now);
          break;
        }
        this.decal(fx.x, fx.y, now);
        const name = this.host.name(fx.id);
        if (name) this.host.announce?.(`${name} was killed`);
        break;
      }
      case "heal":
        this.heal(fx.id, fx.amount, now);
        break;
      case "teleport": {
        // Everyone jumps at once: the flash covers the cut, and plays when render time reaches the teleport tick, the
        // same moment the interpolator snaps the bodies. The server cancelled every action in progress with no fx each.
        this.cancelWindup();
        const cam = this.scene.cameras.main;
        cam.flashEffect.alpha = TELEPORT_FLASH_ALPHA;
        cam.flash(TELEPORT_FLASH_MS, 255, 255, 255, true);
        this.host.announce?.("To the coliseum!");
        break;
      }
      case "bounty": {
        // The server only sends it when the bounty rose, but a malformed event must not announce a nonsense line.
        const bounty = Math.round(fx.bounty);
        const name = fx.name || this.host.name(fx.id);
        if (name && bounty > 0) this.host.announce?.(`${name} is on a rampage — bounty ${bounty} GV`);
        break;
      }
      case "buff":
        this.buff(fx, now);
        break;
      case "combo":
        this.combo(fx, now);
        break;
      case "victory":
        if (fx.name) this.host.announce?.(`${fx.name} is victorious`);
        else if (fx.draw) this.host.announce?.("Draw");
        break;
    }
  }

  /**
   * The swing sector (or the wand's gathering glow) that will land `ms` later, anchored to the attacker as drawn: it
   * grows and brightens until the swing lands, and a stagger (or the swing itself) clears it.
   */
  private windup(fx: FxOf<"windup">, now: number): void {
    this.cancelWindup(fx.by);
    const pos = this.host.position(fx.by);
    const spec = WEAPONS[fx.weapon];
    if (!pos || !spec || !Number.isFinite(fx.a) || !Number.isFinite(fx.ms)) return;
    const duration = Math.max(MIN_WINDUP_MS, Math.min(MAX_WINDUP_MS, fx.ms));
    const g = this.acquireGraphics(DEPTH_FX);
    if (spec.shape.kind === "arc") {
      g.fillStyle(spec.color, 0.2).lineStyle(1.5, spec.color, 0.85);
      traceSector(g, 0, 0, spec.shape.reach + PLAYER_RADIUS, fx.a, spec.shape.halfArc);
      g.fillPath().strokePath();
      this.active.push({ kind: "windup", g, text: null, start: now, duration, id: fx.by, x: pos.x, y: pos.y, a: fx.a });
    } else {
      g.fillStyle(spec.color, 0.3).fillCircle(0, 0, 12);
      g.fillStyle(spec.color, 0.9).fillCircle(0, 0, 5);
      this.active.push({ kind: "cast", g, text: null, start: now, duration, id: fx.by, x: pos.x, y: pos.y, a: fx.a });
    }
    this.place(this.active[this.active.length - 1]!);
  }

  /** The landed swing: the swept sector, from where the attacker was drawn when it swung. */
  private swing(fx: FxOf<"swing">, now: number): void {
    this.cancelWindup(fx.by);
    const shape = WEAPONS[fx.weapon]?.shape;
    if (shape?.kind !== "arc" || !Number.isFinite(fx.x) || !Number.isFinite(fx.y) || !Number.isFinite(fx.a)) return;
    const color = WEAPONS[fx.weapon].color;
    const reach = shape.reach + PLAYER_RADIUS;
    const g = this.acquireGraphics(DEPTH_FX);
    g.setPosition(projX(fx.x), projY(fx.y));
    g.fillStyle(color, 0.4);
    traceSector(g, 0, 0, reach, fx.a, shape.halfArc);
    g.fillPath();
    g.lineStyle(3, SWING_RIM, 0.9);
    traceRim(g, 0, 0, reach, fx.a, shape.halfArc);
    g.strokePath();
    this.active.push({ kind: "swing", g, text: null, start: now, duration: SWING_MS, id: "", x: 0, y: 0, a: 0 });
  }

  private hit(fx: FxOf<"hit">, now: number): void {
    if (fx.id === this.host.localId) this.host.localHit?.(fx);
    const dot = isDot(fx.sig);
    // Damage over time is a steady drip, not a blow: no body flash for it.
    if (!dot) this.host.view(fx.id)?.flash();
    // Fire's backlash: the swinger (`id`) is scorched by its own swing.
    if (fx.sig === "backlash") this.flame(fx.id, now);
    // Damage with no attacker (the arena) would print a number every tick.
    if (fx.by === null || !(fx.amount > 0)) return;
    const pos = this.host.position(fx.id);
    if (!pos) return;
    let amount = Math.max(1, Math.round(fx.amount));
    let color: string;
    let size: number;
    if (dot) {
      // A chunk that rounds to nothing isn't worth a number.
      amount = Math.round(fx.amount);
      if (amount < 1) return;
      color = DOT_COLORS[fx.sig!];
      size = DOT_NUMBER_SIZE;
    } else {
      color = fx.id === this.host.localId ? HIT_ON_ME : fx.by === this.host.localId ? HIT_BY_ME : HIT_OTHERS;
      size = 13 + Math.min(7, Math.floor(amount / 40));
    }
    const lane = this.lane++ % HIT_LANES;
    const text = this.acquireText(color, size);
    text.setText(String(amount)).setDepth(DEPTH_FX).setPosition(projX(pos.x), projY(pos.y, HIT_START_HEIGHT));
    this.active.push({
      kind: "number", g: null, text, start: now, duration: HIT_NUMBER_MS, id: fx.id, x: pos.x, y: pos.y,
      a: (lane - (HIT_LANES - 1) / 2) * HIT_LANE_PX,
    });
  }

  /**
   * Fire's backlash: a crown of flames flaring up around the swinger's body, brighter core inside the orange. Flames
   * rise, so every tongue leans toward the top of the screen. It follows the fighter for its short life.
   */
  private flame(id: string, now: number): void {
    const pos = this.host.position(id);
    if (!pos) return;
    const g = this.acquireGraphics(DEPTH_FX);
    const R = PLAYER_RADIUS;
    g.fillStyle(0xff9100, 0.3).fillCircle(0, 0, R + 3);
    g.lineStyle(3, 0xff9100, 0.9).strokeCircle(0, 0, R + 2);
    const tongues = 9;
    for (let i = 0; i < tongues; i++) {
      // Rooted along the upper rim, left round to right; the middle ones are the tallest.
      const root = -Math.PI + ((i + 0.5) / tongues) * Math.PI;
      const rx = Math.cos(root) * (R - 1);
      const ry = Math.sin(root) * (R - 1);
      const lean = Math.cos(root) * 0.45;
      const height = 13 + 11 * Math.sin(-root) + (i % 2) * 5;
      for (const [scale, color] of FLAME_LAYERS) {
        const h = height * scale;
        const w = 4.6 * scale;
        const tipX = rx + lean * h * 0.8;
        const tipY = ry - h;
        // A teardrop: wide near the base, swaying a little toward the tip.
        g.fillStyle(color, 0.95).beginPath()
          .moveTo(rx - w, ry).lineTo(rx - w * 0.9 + lean * h * 0.25, ry - h * 0.45).lineTo(tipX, tipY)
          .lineTo(rx + w * 0.9 + lean * h * 0.25, ry - h * 0.45).lineTo(rx + w, ry).closePath().fillPath();
      }
    }
    g.setPosition(projX(pos.x), projY(pos.y, BODY_LIFT));
    this.active.push({ kind: "flame", g, text: null, start: now, duration: FLAME_MS, id, x: pos.x, y: pos.y, a: 0 });
  }

  /** A spark on the holder's shield, on the side the hit came from. */
  private block(fx: FxOf<"block">, now: number): void {
    const holder = this.host.position(fx.id);
    if (!holder) return;
    const from = this.host.position(fx.by);
    const a = from && (from.x !== holder.x || from.y !== holder.y) ? Math.atan2(from.y - holder.y, from.x - holder.x) : 0;
    const d = PLAYER_RADIUS + 8;
    this.burst(holder.x + Math.cos(a) * d, holder.y + Math.sin(a) * d, BLOCK_BURST, now);
  }

  /** A small burst at a ground point, drawn at body height (projectiles fly there). */
  private burst(x: number, y: number, style: BurstStyle, now: number): void {
    const g = this.acquireGraphics(DEPTH_FX);
    g.setPosition(projX(x), projY(y, BODY_LIFT));
    const r = style.radius;
    g.lineStyle(2, style.color, 1);
    for (let i = 0; i < style.rays; i++) {
      const th = (i / style.rays) * Math.PI * 2 + 0.3;
      g.lineBetween(Math.cos(th) * r * 0.35, Math.sin(th) * r * 0.35, Math.cos(th) * r, Math.sin(th) * r);
    }
    if (style.ring) g.lineStyle(1.5, style.color, 0.8).strokeCircle(0, 0, r * 0.55);
    g.fillStyle(0xffffff, 0.9).fillCircle(0, 0, Math.max(2, r * 0.2));
    this.active.push({ kind: "burst", g, text: null, start: now, duration: style.ms, id: "", x, y, a: 0 });
  }

  /** Three little stars circling the target's head. */
  private mark(id: string, now: number): void {
    const pos = this.host.position(id);
    if (!pos) return;
    const g = this.acquireGraphics(DEPTH_FX);
    g.lineStyle(2, 0xffee58, 1);
    for (let i = 0; i < 3; i++) {
      const th = (i / 3) * Math.PI * 2;
      const cx = Math.cos(th) * 11;
      const cy = Math.sin(th) * 11;
      g.lineBetween(cx - 3.5, cy, cx + 3.5, cy).lineBetween(cx, cy - 3.5, cx, cy + 3.5);
    }
    g.setPosition(projX(pos.x), projY(pos.y, BODY_LIFT + PLAYER_RADIUS + 8));
    this.active.push({ kind: "mark", g, text: null, start: now, duration: STAGGER_MS, id, x: pos.x, y: pos.y, a: 0 });
  }

  /**
   * A red X on the ground. Sorted like a flat ground object (ContainerView's rule) so players standing on it draw
   * over it; the 0.1 keeps it just above the body lying there.
   */
  private decal(x: number, y: number, now: number): void {
    const g = this.acquireGraphics(depthFor(y, -PLAYER_RADIUS + 0.1));
    g.setPosition(projX(x), projY(y));
    g.lineStyle(3, DECAL_COLOR, 1);
    g.lineBetween(-DECAL_HALF_W, -DECAL_HALF_H, DECAL_HALF_W, DECAL_HALF_H);
    g.lineBetween(-DECAL_HALF_W, DECAL_HALF_H, DECAL_HALF_W, -DECAL_HALF_H);
    this.active.push({ kind: "decal", g, text: null, start: now, duration: DECAL_MS, id: "", x: 0, y: 0, a: 0 });
  }

  private heal(id: string, amount: number, now: number): void {
    const pos = this.host.position(id);
    if (!pos || !(amount >= MIN_HEAL_SHOWN)) return;
    const rounded = Math.round(amount);
    const text = this.acquireText(HEAL_COLOR, 14 + Math.min(6, Math.floor(rounded / 25)));
    text.setText(`+${rounded}`).setDepth(DEPTH_FX).setPosition(projX(pos.x), projY(pos.y, HEAL_START_HEIGHT));
    this.active.push({ kind: "heal", g: null, text, start: now, duration: HEAL_MS, id, x: pos.x, y: pos.y, a: 0 });
  }

  /**
   * A regional mob went down. Its body fades itself (MobView); no red X, which would lie over the weapon it drops, and no
   * toast for the crowd of them. An elite gets a bigger gold burst and a line, since it is one of five on the map.
   */
  private mobDeath(fx: FxOf<"death">, elite: boolean, now: number): void {
    this.burst(fx.x, fx.y, elite ? ELITE_DEATH_BURST : MOB_DEATH_BURST, now);
    if (!elite) return;
    const name = this.host.name(fx.id);
    if (!name) return;
    const killer = fx.by ? this.host.name(fx.by) : undefined;
    this.host.announce?.(killer ? `${name} was slain by ${killer}` : `${name} was slain`);
  }

  /** Stacks gained: a toast for the local player, a small floating line over anyone else. */
  private buff(fx: FxOf<"buff">, now: number): void {
    if (!(fx.stacks > 0)) return;
    if (fx.id === this.host.localId) {
      this.host.announce?.(buffToast(fx.stat, fx.stacks, fx.total), "buff");
      return;
    }
    const color = (STAT_COLOR as Readonly<Record<string, number>>)[fx.stat];
    const label = (BUFF_LABELS as Readonly<Record<string, string>>)[fx.stat] ?? fx.stat;
    if (color !== undefined) this.floatText(fx.id, `+${formatGain(fx.stacks)} ${label}`, cssColor(color), now);
  }

  /**
   * A combo tier reached (`proc` false) or set off by a kill (`proc` true). The local player is told by a toast for a new
   * combo; everyone sees a ring on the fighter, in the stat's colour, bigger for the second tier.
   */
  private combo(fx: FxOf<"combo">, now: number): void {
    const spec = comboById(fx.combo);
    if (!spec) return;
    const color = STAT_COLOR[spec.stat];
    if (fx.proc) {
      this.ring(fx.id, color, spec.tier === 2 ? 2.4 : 2, now);
      return;
    }
    this.ring(fx.id, color, 3.2, now);
    if (fx.id === this.host.localId) this.host.announce?.(comboToast(spec), "combo");
    else this.floatText(fx.id, `${spec.name}!`, COMBO_FLOAT_COLOR, now);
  }

  /** A ring around the fighter that grows to `size` body radii while it fades. */
  private ring(id: string, color: number, size: number, now: number): void {
    const pos = this.host.position(id);
    if (!pos) return;
    const g = this.acquireGraphics(DEPTH_FX);
    g.lineStyle(3, color, 1).strokeCircle(0, 0, PLAYER_RADIUS + 2);
    g.fillStyle(color, 0.18).fillCircle(0, 0, PLAYER_RADIUS + 2);
    g.setPosition(projX(pos.x), projY(pos.y, BODY_LIFT));
    this.active.push({ kind: "ring", g, text: null, start: now, duration: RING_MS, id, x: pos.x, y: pos.y, a: size });
  }

  /** A short line rising over a fighter, above the heal numbers. */
  private floatText(id: string, text: string, color: string, now: number): void {
    const pos = this.host.position(id);
    if (!pos) return;
    const lift = (this.floatLane++ % FLOAT_LANES) * FLOAT_LANE_PX;
    const t = this.acquireText(color, 12);
    t.setText(text).setDepth(DEPTH_FX).setPosition(projX(pos.x), projY(pos.y, FLOAT_START_HEIGHT + lift));
    this.active.push({ kind: "float", g: null, text: t, start: now, duration: FLOAT_MS, id, x: pos.x, y: pos.y, a: lift });
  }

  /** Drops the telegraph a fighter is showing (its swing landed, or a stagger, a death or a swap cancelled it); everyone's when `by` is omitted. */
  private cancelWindup(by?: string): void {
    const a = this.active;
    for (let i = a.length - 1; i >= 0; i--) {
      const e = a[i]!;
      if ((e.kind !== "windup" && e.kind !== "cast") || (by !== undefined && e.id !== by)) continue;
      this.release(e);
      a[i] = a[a.length - 1]!;
      a.pop();
    }
  }

  /** Re-reads the followed fighter's drawn position into `e` and moves its graphics there. */
  private place(e: Active): void {
    const pos = this.host.position(e.id);
    if (pos) { e.x = pos.x; e.y = pos.y; }
    if (e.kind === "windup") e.g!.setPosition(projX(e.x), projY(e.y));
    else if (e.kind === "cast") {
      const d = PLAYER_RADIUS + 16;
      e.g!.setPosition(projX(e.x + Math.cos(e.a) * d), projY(e.y + Math.sin(e.a) * d, BODY_LIFT));
    }
  }

  private advance(now: number): void {
    const a = this.active;
    // Backwards so swap-removing a finished effect never skips one.
    for (let i = a.length - 1; i >= 0; i--) {
      const e = a[i]!;
      const p = (now - e.start) / e.duration;
      if (p >= 1) {
        this.release(e);
        a[i] = a[a.length - 1]!;
        a.pop();
        continue;
      }
      switch (e.kind) {
        case "windup":
          this.place(e);
          e.g!.setAlpha(0.3 + 0.7 * p).setScale(0.55 + 0.45 * p);
          break;
        case "cast":
          this.place(e);
          e.g!.setAlpha(0.4 + 0.6 * p).setScale(0.5 + 0.5 * p);
          break;
        case "swing":
          e.g!.setAlpha(1 - p).setScale(1 + 0.06 * p);
          break;
        case "burst":
          e.g!.setAlpha(1 - p).setScale(0.6 + 0.8 * p);
          break;
        case "mark": {
          const pos = this.host.position(e.id);
          if (pos) { e.x = pos.x; e.y = pos.y; }
          e.g!.setPosition(projX(e.x), projY(e.y, BODY_LIFT + PLAYER_RADIUS + 8)).setRotation(p * Math.PI * 3).setAlpha(p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4);
          break;
        }
        case "flame": {
          const pos = this.host.position(e.id);
          if (pos) { e.x = pos.x; e.y = pos.y; }
          e.g!.setPosition(projX(e.x), projY(e.y, BODY_LIFT)).setScale(0.75 + 0.6 * p).setAlpha(1 - p * p);
          break;
        }
        case "decal":
          e.g!.setAlpha(p < DECAL_HOLD ? 1 : 1 - (p - DECAL_HOLD) / (1 - DECAL_HOLD));
          break;
        case "ring": {
          const pos = this.host.position(e.id);
          if (pos) { e.x = pos.x; e.y = pos.y; }
          const grow = 1 - (1 - p) * (1 - p);
          e.g!.setPosition(projX(e.x), projY(e.y, BODY_LIFT)).setScale(1 + (e.a - 1) * grow).setAlpha(1 - p);
          break;
        }
        case "heal":
        case "float":
        case "number": {
          const pos = this.host.position(e.id);
          if (pos) { e.x = pos.x; e.y = pos.y; }
          const start = e.kind === "heal" ? HEAL_START_HEIGHT : e.kind === "float" ? FLOAT_START_HEIGHT + e.a : HIT_START_HEIGHT;
          const rise = (e.kind === "heal" ? HEAL_RISE : e.kind === "float" ? FLOAT_RISE : HIT_RISE) * (1 - (1 - p) * (1 - p));
          e.text!.setPosition(projX(e.x) + (e.kind === "number" ? e.a : 0), projY(e.y, start + rise)).setAlpha(p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5);
          break;
        }
      }
    }
  }

  private acquireGraphics(depth: number): Phaser.GameObjects.Graphics {
    const g = this.freeGraphics.pop() ?? this.scene.add.graphics();
    return g.clear().setVisible(true).setPosition(0, 0).setScale(1).setRotation(0).setAlpha(1).setDepth(depth);
  }

  private acquireText(color: string, size: number): Phaser.GameObjects.Text {
    const text = this.freeText.pop() ?? this.scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1);
    return text.setColor(color).setFontSize(size).setVisible(true).setAlpha(1);
  }

  private release(e: Active): void {
    if (e.g) {
      e.g.clear().setVisible(false);
      if (this.freeGraphics.length < POOL_MAX) this.freeGraphics.push(e.g);
      else e.g.destroy();
      e.g = null;
    }
    if (e.text) {
      e.text.setVisible(false);
      if (this.freeText.length < POOL_MAX) this.freeText.push(e.text);
      else e.text.destroy();
      e.text = null;
    }
  }
}
