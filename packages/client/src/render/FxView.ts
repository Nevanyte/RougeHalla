// Visual-only combat effects. The server stamps each event with the server time it happened (`t`); events wait in a
// queue until render time (the same delayed clock remote players are drawn at) reaches `t`, so a tracer appears
// together with the positions it was fired between. Effects are driven from update(), not tweens or timers: nothing
// outlives the scene, and finished effects hand their Graphics/Text back to a small pool instead of being re-created.
import Phaser from "phaser";
import { INTERP_DELAY_MS, MAX_REWIND_MS, PLAYER_RADIUS, PLAYER_SPEED, Y_SCALE, type TimedFx } from "@raid/shared";
import { BODY_LIFT } from "./PlayerView";
import { depthFor, projX, projY } from "./projection";

/** An event this far ahead of render time means the clock is not synced (or jumped): play it now rather than sit on it. */
export const FX_FUTURE_SLACK_MS = 1000;
/** Older than this behind render time, an event is not worth showing any more. */
const STALE_MS = 2000;
/** Backstop for a stalled render loop (hidden tab): messages keep arriving while update() does not run. */
const MAX_PENDING = 256;
/** Idle Graphics/Text kept for reuse; anything beyond this is destroyed on release. */
const POOL_MAX = 16;

const TRACER_MS = 120;
const SWIPE_MS = 150;
const DECAL_MS = 2000;
const HEAL_MS = 800;

/** Above every y-sorted entity (ground y is at most a few thousand) but below the click marker (1e6). */
const DEPTH_FX = 8e5;

const TRACER_GLOW = 0xffe082;
const TRACER_CORE = 0xfffde7;
const SWIPE_COLOR = 0xeceff1;
const DECAL_COLOR = 0xd32f2f;

/** Where a tracer leaves the shooter: the rim of the body disc, not its centre. */
const MUZZLE_OFFSET = PLAYER_RADIUS;
/**
 * A hit tracer ends on the victim as drawn when it plays (the server's endpoint is rewound to what the shooter saw and
 * trails a moving target). Further than a target can have travelled in that time, something is off: keep the server's point.
 */
const HIT_SNAP_MAX = ((MAX_REWIND_MS + INTERP_DELAY_MS) / 1000) * PLAYER_SPEED + PLAYER_RADIUS;
const SWIPE_RADIUS = PLAYER_RADIUS + 12;
const SWIPE_HALF_ARC = 0.8;
/** Half-extents of the death X in screen pixels; flattened by Y_SCALE because it lies on the ground. */
const DECAL_HALF_W = 14;
const DECAL_HALF_H = DECAL_HALF_W * Y_SCALE;
/** Fraction of the decal's life it stays fully opaque before fading. */
const DECAL_HOLD = 0.25;
/** Screen pixels above the ground where a heal number starts (clear of the name label) and how far it climbs. */
const HEAL_START_HEIGHT = BODY_LIFT + PLAYER_RADIUS + 38;
const HEAL_RISE = 28;

/** What FxView needs from the scene; kept as callbacks so it never reaches into scene internals. */
export interface FxHost {
  /** The drawn player, for hit flashes. */
  view(id: string): { flash(): void } | undefined;
  /** Where a player is drawn right now (ground coordinates), for effects that follow them. */
  position(id: string): { x: number; y: number } | undefined;
  name(id: string): string | undefined;
  /** Optional sink for short text such as "<name> was killed". */
  announce?(text: string): void;
}

type EffectKind = "tracer" | "swipe" | "decal" | "heal";

interface Active {
  kind: EffectKind;
  g: Phaser.GameObjects.Graphics | null;
  text: Phaser.GameObjects.Text | null;
  /** performance.now() when it began (effects run on the local clock once they have been released from the queue). */
  start: number;
  duration: number;
  /** heal only: the player it follows and the last ground position it was drawn at. */
  id: string;
  x: number;
  y: number;
}

export class FxView {
  private pending: TimedFx[] = [];
  private readonly active: Active[] = [];
  private readonly freeGraphics: Phaser.GameObjects.Graphics[] = [];
  private readonly freeText: Phaser.GameObjects.Text[] = [];
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly host: FxHost) {}

  /** Called for every `fx` message as it arrives; nothing is drawn until update() finds it due. */
  enqueue(fx: TimedFx): void {
    if (this.destroyed || !fx || !Number.isFinite(fx.t)) return;
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push(fx);
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

  private play(fx: TimedFx, now: number): void {
    switch (fx.kind) {
      case "shot": {
        let ex = fx.x2;
        let ey = fx.y2;
        if (fx.hit) {
          this.host.view(fx.hit)?.flash();
          const pos = this.host.position(fx.hit);
          if (pos && Math.hypot(pos.x - ex, pos.y - ey) <= HIT_SNAP_MAX) { ex = pos.x; ey = pos.y; }
        }
        if (fx.melee) this.swipe(fx.x1, fx.y1, ex, ey, now);
        else this.tracer(fx.x1, fx.y1, ex, ey, fx.hit !== null, now);
        break;
      }
      case "death": {
        this.decal(fx.x, fx.y, now);
        const name = this.host.name(fx.id);
        if (name) this.host.announce?.(`${name} was killed`);
        break;
      }
      case "heal":
        this.heal(fx.id, fx.amount, now);
        break;
      case "extracted":
        break;
    }
  }

  private tracer(x1: number, y1: number, x2: number, y2: number, hit: boolean, now: number): void {
    const g = this.acquireGraphics(DEPTH_FX);
    let sx = projX(x1);
    let sy = projY(y1, BODY_LIFT);
    const ex = projX(x2);
    const ey = projY(y2, BODY_LIFT);
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy);
    if (len > MUZZLE_OFFSET * 2) {
      sx += (dx / len) * MUZZLE_OFFSET;
      sy += (dy / len) * MUZZLE_OFFSET;
    }
    g.lineStyle(4, TRACER_GLOW, 0.35).lineBetween(sx, sy, ex, ey);
    g.lineStyle(1.5, TRACER_CORE, 1).lineBetween(sx, sy, ex, ey);
    if (hit) g.fillStyle(0xffffff, 0.9).fillCircle(ex, ey, 3.5);
    this.active.push({ kind: "tracer", g, text: null, start: now, duration: TRACER_MS, id: "", x: 0, y: 0 });
  }

  /** A crescent around the attacker's body, opening toward the target. */
  private swipe(x1: number, y1: number, x2: number, y2: number, now: number): void {
    const g = this.acquireGraphics(DEPTH_FX);
    g.setPosition(projX(x1), projY(y1, BODY_LIFT));
    // The aim angle in screen space, so the crescent faces where the target is drawn.
    const a = Math.atan2((y2 - y1) * Y_SCALE, x2 - x1);
    g.lineStyle(6, SWIPE_COLOR, 0.3).beginPath().arc(0, 0, SWIPE_RADIUS, a - SWIPE_HALF_ARC, a + SWIPE_HALF_ARC).strokePath();
    g.lineStyle(2.5, SWIPE_COLOR, 1).beginPath().arc(0, 0, SWIPE_RADIUS, a - SWIPE_HALF_ARC, a + SWIPE_HALF_ARC).strokePath();
    this.active.push({ kind: "swipe", g, text: null, start: now, duration: SWIPE_MS, id: "", x: 0, y: 0 });
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
    this.active.push({ kind: "decal", g, text: null, start: now, duration: DECAL_MS, id: "", x: 0, y: 0 });
  }

  private heal(id: string, amount: number, now: number): void {
    const pos = this.host.position(id);
    const rounded = Math.round(amount);
    if (!pos || !(rounded > 0)) return;
    const text = this.freeText.pop() ?? this.scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", fontStyle: "bold",
      color: "#81f78b", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1);
    text.setText(`+${rounded}`).setVisible(true).setAlpha(1).setDepth(DEPTH_FX)
      .setPosition(projX(pos.x), projY(pos.y, HEAL_START_HEIGHT));
    this.active.push({ kind: "heal", g: null, text, start: now, duration: HEAL_MS, id, x: pos.x, y: pos.y });
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
        case "tracer":
          e.g!.setAlpha(1 - p);
          break;
        case "swipe":
          e.g!.setAlpha(1 - p).setScale(0.9 + 0.35 * p);
          break;
        case "decal":
          e.g!.setAlpha(p < DECAL_HOLD ? 1 : 1 - (p - DECAL_HOLD) / (1 - DECAL_HOLD));
          break;
        case "heal": {
          const pos = this.host.position(e.id);
          if (pos) { e.x = pos.x; e.y = pos.y; }
          const rise = HEAL_RISE * (1 - (1 - p) * (1 - p));
          e.text!.setPosition(projX(e.x), projY(e.y, HEAL_START_HEIGHT + rise)).setAlpha(p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5);
          break;
        }
      }
    }
  }

  private acquireGraphics(depth: number): Phaser.GameObjects.Graphics {
    const g = this.freeGraphics.pop() ?? this.scene.add.graphics();
    return g.clear().setVisible(true).setPosition(0, 0).setScale(1).setAlpha(1).setDepth(depth);
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
