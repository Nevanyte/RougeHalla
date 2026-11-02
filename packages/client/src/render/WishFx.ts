// Visual-only effects of casts: the telegraph of a cast in progress (`cast`), what it did when it landed (`castLand`), the
// puff of one that failed (`castEnd`) and the star burst of a stun (`status`). FxView hands these over at render time
// (it already holds each event until the render clock reaches it); like FxView, everything is driven from update(), pooled
// and gone with the scene. Presentation only: the server decided what the cast does, the picture follows.
//
// A telegraph is the warning the one it concerns gets: it lasts the cast's `ms` and follows the fighters as drawn. It is
// never dimmed by the juice settings (it is information, as FxView's windups are), but reduced motion makes it hold still
// where it would swirl or grow.
//
// The caster's own telegraph does not wait for render time: the scene draws it at the key press (`predictCast`), and the own
// `cast` fx confirms it when it arrives (`confirmPredicted`); a refusal (the cast's order number echoed with no cast fx) or no
// answer within PREDICTED_LIFE_MS lets it go quietly, and an own `castEnd` ends it at arrival (`endOwn`). It ramps over the
// true cast time from the press and then holds at full until the landing, which stays at render time with what it caused.
import Phaser from "phaser";
import {
  ABILITIES, MAX_INTERP_DELAY_MS, PLAYER_RADIUS, Y_SCALE, type AbilityDef, type AbilityId, type TelegraphArt, type TimedFx, type Vec2,
} from "@raid/shared";
import { easeOutCubic, juiceScale } from "./juice";
import { BODY_LIFT, projX, projY } from "./projection";
import { trialTelegraphRadius } from "./markPresentation";

/** What WishFx needs from the scene. */
export interface WishFxHost {
  /** The local player's id. */
  readonly localId: string;
  canSee?(point: { x: number; y: number }): boolean;
  /** Where a fighter is drawn right now (ground coordinates; the local fighter's is its predicted one). */
  position(id: string): Vec2 | undefined;
  /** Optional: true for a fighter that is hidden from the viewer (a remote one with the hidden bit); its telegraphs are not drawn. */
  hidden?(id: string): boolean;
}

type FxOf<K extends TimedFx["kind"]> = Extract<TimedFx, { kind: K }>;

/** Above every y-sorted entity, below the move marker: the same layer as FxView's effects. */
const DEPTH_FX = 8e5;
const POOL_MAX = 12;
/** A cap on live effects: the oldest finished-looking one is dropped past it. */
const MAX_ACTIVE = 32;
/** A telegraph lasts the cast's `ms`; these bound a malformed one. */
const MIN_MS = 40;
const MAX_MS = 1500;
/**
 * How long a telegraph drawn at the key press lives with no `cast` fx to confirm it: the prediction's ORDER_EXPIRE_MS
 * (net/localMotion.ts), when LocalPrediction gives up the cast root it predicted with it.
 */
export const PREDICTED_LIFE_MS = 600;
/**
 * A confirmed telegraph waits for its landing until its cast time plus this after the confirming fx arrived: the landing is
 * released at render time, at most the render delay (MAX_INTERP_DELAY_MS) after that, less the downlink. A margin covers the
 * clock's error. The landing, or the own castEnd, ends it sooner. (Measured with netProbe: the landing came 130-190 ms past the
 * press-based ramp at 0-30 ms RTT and 340-360 ms at 120 ms, so a fixed hold from the press would leave a gap on a slow link.)
 */
export const CONFIRMED_HOLD_MS = MAX_INTERP_DELAY_MS + 150;
const R = PLAYER_RADIUS;

const TAU = Math.PI * 2;
const STUN_STAR = 0xffee58;
const FIZZLE_GREY = 0x90a4ae;
const FIZZLE_RED = 0xef9a9a;

type EffectKind =
  // Telegraphs, one per TelegraphArt.
  | "beam" | "ring" | "swirl" | "flare" | "aura"
  // Landings and the rest.
  | "iceBurst" | "slam" | "puff" | "embers" | "goldBurst" | "plain" | "fizzle" | "stars";

interface Active {
  kind: EffectKind;
  g: Phaser.GameObjects.Graphics;
  start: number;
  duration: number;
  /** The caster a telegraph belongs to; "" for the rest. For stars: the fighter they circle. */
  id: string;
  /** The target fighter a beam or a ring follows. */
  target: string | null;
  /** Anchor (ground) and, for a blink, the landing. */
  x: number;
  y: number;
  x2: number;
  y2: number;
  color: number;
  /** A ring's final radius. */
  radius: number;
  telegraph: boolean;
  /** Milliseconds it stays drawn at full past `duration` (none when absent). */
  hold?: number;
  /** A telegraph drawn at the key press: the cast's order number and ability, and whether the own `cast` fx has confirmed it. */
  seq?: number;
  ability?: AbilityId;
  confirmed?: boolean;
}

/** A cast the local player just sent, as the scene knows it at the key press. */
export interface PredictedCast {
  by: string;
  ability: AbilityId;
  ms: number;
  target: string | null;
  /** Where the cast fx will say it is: the target as drawn, else the caster as drawn. */
  x: number;
  y: number;
  seq: number;
}

function clampMs(ms: number): number {
  return Math.max(MIN_MS, Math.min(MAX_MS, ms));
}

/** The telegraph art of a def, falling back to nothing for an unknown ability. */
function artOf(def: AbilityDef | undefined): TelegraphArt {
  return def?.telegraph ?? "none";
}

/** The radius a ring telegraph and a slam grow to: the ability's circle, else a modest ring. */
function ringRadius(def: AbilityDef | undefined): number {
  const shape = def?.ranks[0]?.shape;
  return shape?.kind === "circle" ? shape.radius : 120;
}

export class WishFx {
  private readonly active: Active[] = [];
  private readonly free: Phaser.GameObjects.Graphics[] = [];
  private destroyed = false;
  /** The flash scale (0..1) of the frame being drawn: landing flashes are drawn only for the share of it that is on. */
  private fl = 1;

  constructor(private readonly scene: Phaser.Scene, private readonly host: WishFxHost) {}

  /** Called when render time reaches a `cast`, `castLand`, `castEnd` or `status` event (anything else is ignored). */
  play(fx: TimedFx, now: number): void {
    if (this.destroyed) return;
    if (this.host.canSee && "x" in fx && "y" in fx && !this.host.canSee(fx)) return;
    switch (fx.kind) {
      case "cast":
        this.cast(fx, now);
        break;
      case "castLand":
        this.land(fx, now);
        break;
      case "castEnd":
        this.end(fx, now);
        break;
      case "status":
        if (fx.status === "stun") this.stars(fx.id, now);
        break;
      default:
        break;
    }
  }

  update(now: number): void {
    if (this.destroyed) return;
    const a = this.active;
    // Backwards so swap-removing a finished effect never skips one.
    for (let i = a.length - 1; i >= 0; i--) {
      const e = a[i]!;
      const p = (now - e.start) / e.duration;
      const anchor = e.id ? this.host.position(e.id) : e;
      const ends = e.hold ? 1 + e.hold / e.duration : 1;
      if (p >= ends || (this.host.canSee && (!anchor || !this.host.canSee(anchor) || !this.host.canSee({ x: e.x2, y: e.y2 })))) {
        this.release(e);
        a[i] = a[a.length - 1]!;
        a.pop();
        continue;
      }
      if (this.draw(e, Math.min(p, 1)) === false) {
        this.release(e);
        a[i] = a[a.length - 1]!;
        a.pop();
      }
    }
  }

  /**
   * The local player just sent a cast with a cast time: its telegraph starts now, ramps over the cast's `ms` and holds at full
   * until PREDICTED_LIFE_MS unless the own `cast` fx confirms it. Same art and guards as a `cast` fx's.
   */
  predictCast(spec: PredictedCast, now: number): void {
    if (this.destroyed || !Number.isFinite(spec.ms) || (this.host.canSee && !this.host.canSee(spec))) return;
    this.dropTelegraph(spec.by);
    if (this.hiddenRemote(spec.by)) return;
    const def = ABILITIES[spec.ability];
    const art = artOf(def);
    if (!def || art === "none" || (spec.target && this.hiddenRemote(spec.target))) return;
    const duration = clampMs(spec.ms);
    this.push({
      kind: art, start: now, duration, id: spec.by, target: spec.target, x: spec.x, y: spec.y, x2: spec.x, y2: spec.y, color: def.color,
      radius: ringRadius(def), telegraph: true, hold: Math.max(0, PREDICTED_LIFE_MS - duration), seq: spec.seq, ability: spec.ability,
      confirmed: false,
    });
  }

  /**
   * The own `cast` fx arrived at `now`: the telegraph drawn at the key press is the server's now (its start stays the press, its
   * length the fx's), and it holds at full until the landing, at most CONFIRMED_HOLD_MS past its cast time counted from `now`. False
   * when there is none to confirm (it ran out, or was never drawn): the fx then plays at render time as anyone's does.
   */
  confirmPredicted(fx: FxOf<"cast">, now: number): boolean {
    if (this.destroyed) return false;
    const e = this.active.find((a) => a.telegraph && a.id === fx.by && a.seq !== undefined && !a.confirmed && a.ability === fx.ability);
    if (!e) return false;
    e.confirmed = true;
    if (Number.isFinite(fx.ms)) e.duration = clampMs(fx.ms);
    if (fx.target) e.target = fx.target;
    e.hold = Math.max(0, now - e.start) + CONFIRMED_HOLD_MS;
    return true;
  }

  /**
   * The server refused the cast `seq` (its order number came back with no cast fx), or every one (`seq` omitted: the connection is
   * down): the telegraphs drawn at the press that nothing confirmed go quietly, since nothing happened. Returns how many went.
   */
  cancelPredicted(seq?: number): number {
    const a = this.active;
    let n = 0;
    for (let i = a.length - 1; i >= 0; i--) {
      const e = a[i]!;
      if (e.seq === undefined || e.confirmed || (seq !== undefined && e.seq !== seq)) continue;
      this.release(e);
      a[i] = a[a.length - 1]!;
      a.pop();
      n++;
    }
    return n;
  }

  /** The own `castEnd` arrived while the confirmed telegraph from the press is up: it ends now, with its puff. False when none is up. */
  endOwn(fx: FxOf<"castEnd">, now: number): boolean {
    if (this.destroyed || !this.active.some((e) => e.telegraph && e.id === fx.by && e.seq !== undefined && e.confirmed)) return false;
    this.end(fx, now);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    for (const e of this.active) e.g.destroy();
    this.active.length = 0;
    for (const g of this.free) g.destroy();
    this.free.length = 0;
  }

  /** Whether `id` is a remote fighter the viewer cannot see (so nothing may point at where it is). */
  private hiddenRemote(id: string): boolean {
    return id !== this.host.localId && this.host.hidden?.(id) === true;
  }

  // ---------------------------------------------------------------------------------------------------------- events

  /** A cast began: the telegraph its ability calls for, over `ms`, replacing the caster's earlier one. */
  private cast(fx: FxOf<"cast">, now: number): void {
    this.dropTelegraph(fx.by);
    if (this.hiddenRemote(fx.by) || !Number.isFinite(fx.ms)) return;
    const def = ABILITIES[fx.ability];
    const art = artOf(def);
    if (!def || art === "none") return;
    // Nothing may point at a hidden fighter (the server refuses such a target, but a patch can show it hidden first).
    if (fx.target && this.hiddenRemote(fx.target)) return;
    this.push({
      kind: art, start: now, duration: clampMs(fx.ms), id: fx.by, target: fx.target,
      x: fx.x, y: fx.y, x2: fx.x, y2: fx.y, color: def.color, radius: ringRadius(def), telegraph: true,
    });
  }

  /** A cast took effect: its telegraph goes, an impact in the ability's style plays where it landed. */
  private land(fx: FxOf<"castLand">, now: number): void {
    this.dropTelegraph(fx.by);
    const def = ABILITIES[fx.ability];
    const art = artOf(def);
    const kind: EffectKind = art === "beam" ? "iceBurst" : art === "ring" ? "slam" : art === "swirl" ? "puff"
      : art === "flare" ? "embers" : art === "aura" ? "goldBurst" : "plain";
    const base = {
      start: now, id: "", target: null, x: fx.x, y: fx.y, x2: fx.x2 ?? fx.x, y2: fx.y2 ?? fx.y, color: def?.color ?? 0xffffff,
      radius: ringRadius(def), telegraph: false,
    };
    // A heal-style cast (aura) and a blink are drawn where the caster is; a unit cast where the target was.
    this.push({ ...base, kind, duration: kind === "embers" ? 520 : kind === "goldBurst" ? 560 : kind === "slam" ? 320 : 440 });
  }

  /** A begun cast ended without landing: its telegraph goes with a small puff where it was. */
  private end(fx: FxOf<"castEnd">, now: number): void {
    const old = this.active.find((e) => e.telegraph && e.id === fx.by);
    const at = old ? this.anchorOf(old) : this.host.position(fx.by);
    this.dropTelegraph(fx.by);
    if (!at || this.hiddenRemote(fx.by)) return;
    this.push({
      kind: "fizzle", start: now, duration: 320, id: "", target: null, x: at.x, y: at.y, x2: at.x, y2: at.y,
      color: fx.reason === "interrupted" ? FIZZLE_RED : FIZZLE_GREY, radius: 0, telegraph: false,
    });
  }

  /** A stun landed: a burst of stars off the stunned fighter's head. */
  private stars(id: string, now: number): void {
    const pos = this.host.position(id);
    if (!pos || this.hiddenRemote(id)) return;
    this.push({
      kind: "stars", start: now, duration: 480, id, target: null, x: pos.x, y: pos.y, x2: pos.x, y2: pos.y, color: STUN_STAR, radius: 0,
      telegraph: false,
    });
  }

  private dropTelegraph(by: string): void {
    const a = this.active;
    for (let i = a.length - 1; i >= 0; i--) {
      const e = a[i]!;
      if (!e.telegraph || e.id !== by) continue;
      this.release(e);
      a[i] = a[a.length - 1]!;
      a.pop();
    }
  }

  /** Where a telegraph is anchored now: the caster as drawn, else where the cast said it was. */
  private anchorOf(e: Active): Vec2 {
    return this.host.position(e.id) ?? { x: e.x, y: e.y };
  }

  private push(init: Omit<Active, "g">): void {
    if (this.active.length >= MAX_ACTIVE) {
      // Past the cap, the oldest effect that is not a telegraph makes room; a telegraph is information.
      const i = this.active.findIndex((e) => !e.telegraph);
      if (i < 0) return;
      this.release(this.active[i]!);
      this.active.splice(i, 1);
    }
    const g = this.free.pop() ?? this.scene.add.graphics();
    g.clear().setVisible(true).setPosition(0, 0).setScale(1).setRotation(0).setAlpha(1).setDepth(DEPTH_FX);
    this.active.push({ ...init, g });
  }

  private release(e: Active): void {
    e.g.clear().setVisible(false);
    if (this.free.length < POOL_MAX) this.free.push(e.g);
    else e.g.destroy();
  }

  // --------------------------------------------------------------------------------------------------------- drawing

  /**
   * Redraws one effect at progress `p` (0..1). Each effect owns its Graphics, positioned in projected space. Returns false when
   * the effect has to end quietly now (what it pointed at turned hidden).
   */
  private draw(e: Active, p: number): boolean | void {
    const g = e.g.clear();
    const moves = juiceScale("motion") > 0;
    // Brightness (a white bloom, a glow) rides its own setting; the shapes below stay when it is off.
    this.fl = Math.min(1, juiceScale("flash"));
    switch (e.kind) {
      case "beam": return this.drawBeam(g, e, p);
      case "ring": return this.drawRing(g, e, p, moves);
      case "swirl": return this.drawSwirl(g, e, p, moves);
      case "flare": return this.drawFlare(g, e, p, moves);
      case "aura": return this.drawAura(g, e, p, moves);
      case "iceBurst": return this.drawIceBurst(g, e, p, moves);
      case "slam": return this.drawSlam(g, e, p, moves);
      case "puff": return this.drawPuff(g, e, p, moves, 8, 28, 2.4);
      case "embers": return this.drawEmbers(g, e, p, moves);
      case "goldBurst": return this.drawGoldBurst(g, e, p, moves);
      case "plain": return this.drawPlain(g, e, p, moves);
      case "fizzle": return this.drawPuff(g, e, p, moves, 6, 16, 1.8);
      case "stars": return this.drawStars(g, e, p, moves);
    }
  }

  /** Freeze: an ice line from the caster to the one it will freeze, brightening and thickening as the cast gathers, a snowflake blooming at the target. */
  private drawBeam(g: Phaser.GameObjects.Graphics, e: Active, p: number): boolean {
    // The target turned hidden: stop pointing at it (the cast's own end follows from the server).
    if (e.target && this.hiddenRemote(e.target)) return false;
    const from = this.anchorOf(e);
    const to = (e.target ? this.host.position(e.target) : undefined) ?? { x: e.x, y: e.y };
    const ax = projX(from.x);
    const ay = projY(from.y, BODY_LIFT);
    const bx = projX(to.x);
    const by = projY(to.y, BODY_LIFT);
    g.lineStyle(2 + 4 * p, e.color, 0.25 + 0.4 * p).lineBetween(ax, ay, bx, by);
    g.lineStyle(1 + p, 0xffffff, 0.35 + 0.6 * p).lineBetween(ax, ay, bx, by);
    const len = 5 + 9 * p;
    g.lineStyle(2, e.color, 0.3 + 0.7 * p);
    for (let i = 0; i < 3; i++) {
      const th = (i / 3) * Math.PI;
      g.lineBetween(bx - Math.cos(th) * len, by - Math.sin(th) * len, bx + Math.cos(th) * len, by + Math.sin(th) * len);
    }
    return true;
  }

  /** Trial: a ring on the ground round the accused, growing to the zone's radius as the cast lands. */
  private drawRing(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): boolean {
    if (e.target && this.hiddenRemote(e.target)) return false;
    const at = (e.target ? this.host.position(e.target) : undefined) ?? { x: e.x, y: e.y };
    const r = e.telegraph
      ? trialTelegraphRadius(p, e.radius, moves)
      : e.radius * (moves ? easeOutCubic(p) : 1);
    g.setPosition(projX(at.x), projY(at.y));
    g.fillStyle(e.color, 0.04 + 0.08 * p).fillEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    g.lineStyle(3, e.color, 0.35 + 0.6 * p).strokeEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    g.lineStyle(1.5, e.color, 0.4).strokeEllipse(0, 0, r * 1.2, r * 1.2 * Y_SCALE);
    return true;
  }

  /** Swarm: motes spiralling in on the caster. */
  private drawSwirl(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    const at = this.anchorOf(e);
    g.setPosition(projX(at.x), projY(at.y, BODY_LIFT));
    const n = 10;
    for (let i = 0; i < n; i++) {
      const rho = moves ? (1 - p) * 34 + 8 : 18;
      const th = (i / n) * TAU + (moves ? p * TAU * 1.5 : 0);
      g.fillStyle(i % 2 === 0 ? 0xc5e1a5 : e.color, 0.35 + 0.6 * p).fillCircle(Math.cos(th) * rho, Math.sin(th) * rho * Y_SCALE, 1.8 + (i % 3) * 0.4);
    }
  }

  /** A flare gathering at the caster (a cast whose art is "flare" and which takes time). */
  private drawFlare(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    const at = this.anchorOf(e);
    g.setPosition(projX(at.x), projY(at.y, BODY_LIFT));
    const r = 8 + (moves ? 14 * p : 10);
    g.fillStyle(e.color, 0.2 + 0.4 * p).fillCircle(0, 0, r).fillStyle(0xffffff, 0.3 + 0.5 * p).fillCircle(0, 0, r * 0.35);
  }

  /** An aura gathering round the caster (an "aura" cast that takes time). */
  private drawAura(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    const at = this.anchorOf(e);
    g.setPosition(projX(at.x), projY(at.y, BODY_LIFT));
    const r = R + (moves ? 2 + 10 * p : 8);
    g.lineStyle(3, e.color, 0.3 + 0.6 * p).strokeCircle(0, 0, r).fillStyle(e.color, 0.08 + 0.12 * p).fillCircle(0, 0, r);
  }

  /** Freeze lands: ice shards bursting out of the frozen fighter. */
  private drawIceBurst(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    g.setPosition(projX(e.x), projY(e.y, BODY_LIFT));
    const k = moves ? easeOutCubic(p) : 1;
    const r = 26 * (0.4 + 0.6 * k);
    g.lineStyle(2.5, e.color, 1 - p);
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * TAU + 0.2;
      g.lineBetween(Math.cos(th) * r * 0.3, Math.sin(th) * r * 0.3, Math.cos(th) * r, Math.sin(th) * r);
    }
    if (this.fl > 0) {
      g.lineStyle(1.5, 0xffffff, 0.8 * (1 - p) * this.fl).strokeCircle(0, 0, r * 0.6);
      g.fillStyle(0xffffff, 0.7 * (1 - p) * this.fl).fillCircle(0, 0, 5 * (1 - p) + 2);
    }
  }

  /** Trial lands: the ring slams out to the zone's edge and a flash fills it. */
  private drawSlam(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    g.setPosition(projX(e.x), projY(e.y));
    const r = e.radius * (moves ? 0.7 + 0.3 * easeOutCubic(p) : 1);
    g.lineStyle(5 * (1 - p) + 1, e.color, 1 - p * p).strokeEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    if (this.fl > 0) {
      g.fillStyle(e.color, 0.2 * (1 - p) * this.fl).fillEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
      g.lineStyle(2, 0xffffff, 0.8 * (1 - p) * this.fl).strokeEllipse(0, 0, r * 2 * 0.96, r * 2 * 0.96 * Y_SCALE);
    }
  }

  /** A little cloud of dots drifting outward and fading (Swarm settling; a failed cast's puff). */
  private drawPuff(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean, dots: number, reach: number, size: number): void {
    g.setPosition(projX(e.x), projY(e.y, BODY_LIFT));
    const k = moves ? easeOutCubic(p) : 1;
    for (let i = 0; i < dots; i++) {
      const th = (i / dots) * TAU + 0.4;
      const rr = reach * (0.35 + 0.65 * k) * (0.7 + 0.3 * ((i * 7) % 3) / 2);
      g.fillStyle(i % 2 === 0 || this.fl <= 0 ? e.color : 0xffffff, (1 - p) * 0.85).fillCircle(Math.cos(th) * rr, Math.sin(th) * rr * Y_SCALE, size * (1 - 0.5 * p));
    }
  }

  /** Blaze Step: a flash and rising embers at both ends of the blink, and a streak between them. */
  private drawEmbers(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    g.setPosition(0, 0);
    if (e.x2 !== e.x || e.y2 !== e.y) {
      g.lineStyle(4 * (1 - p) + 1, e.color, 0.8 * (1 - p)).lineBetween(projX(e.x), projY(e.y, BODY_LIFT), projX(e.x2), projY(e.y2, BODY_LIFT));
    }
    const ends: ReadonlyArray<readonly [number, number]> = [[e.x, e.y], [e.x2, e.y2]];
    ends.forEach(([x, y], end) => {
      if (end === 1 && x === e.x && y === e.y) return;
      const cx = projX(x);
      const cy = projY(y, BODY_LIFT);
      if (this.fl > 0) {
        g.fillStyle(0xffffff, 0.8 * (1 - p) * (1 - p) * this.fl).fillCircle(cx, cy, 6 + 8 * (1 - p));
        g.fillStyle(e.color, 0.45 * (1 - p) * this.fl).fillCircle(cx, cy, 12 + (moves ? 8 * p : 4));
      }
      for (let i = 0; i < 8; i++) {
        const th = (i / 8) * TAU + end;
        const rr = (moves ? 6 + 20 * easeOutCubic(p) : 14) * (0.6 + 0.4 * (i % 3) / 2);
        const rise = moves ? 18 * p : 0;
        g.fillStyle(i % 2 === 0 ? 0xffca28 : e.color, 1 - p).fillCircle(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr * Y_SCALE - rise, 2 * (1 - 0.6 * p));
      }
    });
  }

  /** Last Stand: a golden burst of rays and a ring out of the caster. */
  private drawGoldBurst(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    g.setPosition(projX(e.x), projY(e.y, BODY_LIFT));
    const k = moves ? easeOutCubic(p) : 1;
    const r = R + 6 + 28 * k;
    if (this.fl > 0) {
      g.fillStyle(e.color, 0.22 * (1 - p) * this.fl).fillCircle(0, 0, R + 4 + 10 * k);
      g.fillStyle(0xffffff, 0.45 * (1 - p) * (1 - p) * this.fl).fillCircle(0, 0, R * 0.8);
    }
    g.lineStyle(3, e.color, 1 - p).strokeCircle(0, 0, r);
    g.lineStyle(2.5, 0xfff8e1, 0.9 * (1 - p));
    for (let i = 0; i < 10; i++) {
      const th = (i / 10) * TAU - Math.PI / 2;
      g.lineBetween(Math.cos(th) * (R + 2), Math.sin(th) * (R + 2), Math.cos(th) * (r - 2), Math.sin(th) * (r - 2));
    }
  }

  /** An ability with no style of its own: a ring in its colour. */
  private drawPlain(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): void {
    g.setPosition(projX(e.x), projY(e.y, BODY_LIFT));
    const k = moves ? easeOutCubic(p) : 1;
    g.lineStyle(3, e.color, 1 - p).strokeCircle(0, 0, R + 4 + 16 * k);
    if (this.fl > 0) g.fillStyle(0xffffff, 0.8 * (1 - p) * this.fl).fillCircle(0, 0, 4);
  }

  /** A stun: little stars thrown out from the head, spinning as they fade. */
  private drawStars(g: Phaser.GameObjects.Graphics, e: Active, p: number, moves: boolean): boolean {
    // The fighter turned hidden while the burst was in the air: let it go rather than follow it.
    if (this.hiddenRemote(e.id)) return false;
    const pos = this.host.position(e.id) ?? { x: e.x, y: e.y };
    g.setPosition(projX(pos.x), projY(pos.y, BODY_LIFT + R + 8));
    const k = moves ? easeOutCubic(p) : 1;
    const spin = moves ? p * Math.PI : 0;
    for (let i = 0; i < 6; i++) {
      const th = (i / 6) * TAU + spin;
      const rr = 6 + 20 * k;
      const x = Math.cos(th) * rr;
      const y = Math.sin(th) * rr * 0.5;
      const s = 4 * (1 - 0.4 * p);
      g.lineStyle(2, e.color, 1 - p * p).lineBetween(x - s, y, x + s, y).lineBetween(x, y - s, x, y + s);
    }
    if (this.fl > 0) g.fillStyle(0xffffff, 0.7 * (1 - p) * this.fl).fillCircle(0, 0, 3 * (1 - p) + 1);
    return true;
  }
}
