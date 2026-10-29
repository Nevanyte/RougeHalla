// The synced areas (`RaidState.fields`: a Trial's zone, a Swarm's cloud, a Blaze Step's burning trail) drawn on the ground.
// Presentation only: the server owns what an area does; this reads the field and paints it. Fields are set once and never
// moved by the server, so a moving area is a position and a velocity (`fieldCentre`) and a cloud follows its owner as
// drawn. One Graphics per field, redrawn each frame while the field lives and destroyed when the server removes it.
// Times are server ms on the delayed render clock, so an area appears together with the bodies it concerns.
import Phaser from "phaser";
import { ABILITIES, ABILITY_IDS, Y_SCALE, fieldKindOf, type Vec2 } from "@raid/shared";
import { juiceScale } from "./juice";
import { BODY_LIFT, depthFor, projX, projY } from "./projection";
import { life, pulse } from "./signatureLook";
import { trialFieldRadius } from "./markPresentation";

/** A field fades out over its last this-many ms (render time). */
export const FIELD_FADE_MS = 300;

/** Above the floor and the gate marks, below every y-sorted entity: an area lies on the ground under the fighters. */
const DEPTH_GROUND_FIELD = -3e5;

/** The cloud lags its owner by this time constant, and its centre wobbles by this many units. */
export const CLOUD_TAU_MS = 400;
export const CLOUD_WOBBLE = 16;
/** The smoothed centre never trails the owner by more than this: at full speed a 400 ms lag alone is about 68 u, the cloud's radius. */
export const CLOUD_MAX_LAG = 40;

const TAU = Math.PI * 2;
const ZONE_FALLBACK = 0xb39ddb;
const ZONE_SWEEP = 0xede7f6;
const TRAIL_FILL = 0xff7043;
const TRAIL_CORE = 0xffd54f;
const CLOUD_DARK = 0x558b2f;
const CLOUD_LIGHT = 0xc5e1a5;
const CLOUD_HAZE = 0x9ccc65;
const CLOUD_FLIES = 28;
/** The viewer's own cloud is drawn fainter so their fighter stays readable inside it. */
const OWN_CLOUD_ALPHA = 0.7;

/** The synced fields of a `FieldState` this view reads (a structural type, so a test can pass plain objects). */
export interface FieldStateLike {
  kind: number;
  ability: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  vx: number;
  vy: number;
  owner: string;
  subject: string;
  startedAt: number;
  endsAt: number;
}

/**
 * How visible a field is at render time: 0 before it starts, 1 through its life and fading to 0 over its last
 * FIELD_FADE_MS. An `endsAt` of 0 means no end.
 */
export function fieldAlpha(startedAt: number, endsAt: number, renderT: number): number {
  if (renderT < startedAt) return 0;
  if (!(endsAt > 0)) return 1;
  const left = endsAt - renderT;
  if (left <= 0) return 0;
  return left >= FIELD_FADE_MS ? 1 : left / FIELD_FADE_MS;
}

/** Where a field is at render time: its (x, y) plus velocity (units per second) times the time since it started. */
export function fieldCentre(f: Pick<FieldStateLike, "x" | "y" | "vx" | "vy" | "startedAt">, renderT: number): Vec2 {
  const s = Math.max(0, renderT - f.startedAt) / 1000;
  return { x: f.x + f.vx * s, y: f.y + f.vy * s };
}

/**
 * The centre a cloud is drawn at: an exponential approach to its owner's drawn position (time constant `tauMs`, never more
 * than `maxLag` behind it) plus a slow wobble of up to `wobble` units in each axis. Pure bookkeeping: the caller supplies the
 * clock, so a test can step it.
 */
export class CloudSmoother {
  private x = 0;
  private y = 0;
  private last = Number.NaN;

  constructor(
    private readonly tauMs = CLOUD_TAU_MS, private readonly wobble = CLOUD_WOBBLE, private readonly maxLag = CLOUD_MAX_LAG,
    private readonly phase = 0,
  ) {}

  /** `wobbleScale`: 0 holds the wobble still (reduced motion), 1 is as designed. Returns the smoothed centre with the wobble added. */
  step(target: Vec2, now: number, wobbleScale = 1): Vec2 {
    if (Number.isNaN(this.last)) {
      this.x = target.x;
      this.y = target.y;
    } else {
      const dt = Math.max(0, now - this.last);
      const k = 1 - Math.exp(-dt / this.tauMs);
      this.x += (target.x - this.x) * k;
      this.y += (target.y - this.y) * k;
      const dx = this.x - target.x;
      const dy = this.y - target.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > this.maxLag) {
        this.x = target.x + (dx / d) * this.maxLag;
        this.y = target.y + (dy / d) * this.maxLag;
      }
    }
    this.last = now;
    const w = this.wobble * wobbleScale;
    return {
      x: this.x + Math.sin(now * 0.0031 + this.phase) * w,
      y: this.y + Math.cos(now * 0.0043 + this.phase * 1.7) * w,
    };
  }
}

interface Entry {
  g: Phaser.GameObjects.Graphics;
  smoother: CloudSmoother | null;
  seen: boolean;
}

/** FNV-ish hash of a field id, so every cloud's flies and wobble start at their own phase. */
function hashPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 6283) / 1000;
}

export class FieldView {
  private readonly entries = new Map<string, Entry>();
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Once per frame. `fields`: `RaidState.fields`; `renderT`: the render time; `now`: performance.now(); `at`: where a fighter is
   * drawn (the local fighter's predicted position, which a cloud follows); `localId`: the viewer's own id.
   */
  update(
    fields: { forEach(cb: (f: FieldStateLike, id: string) => void): void }, renderT: number, now: number,
    at: (id: string) => Vec2 | undefined, localId: string, canSee?: (point: Vec2) => boolean,
  ): void {
    if (this.destroyed) return;
    for (const e of this.entries.values()) e.seen = false;
    fields.forEach((f, id) => {
      let e = this.entries.get(id);
      const kind = fieldKindOf(f.kind);
      if (kind === undefined) return;
      const centre = kind === "cloud" && f.owner ? at(f.owner) : fieldCentre(f, renderT);
      if (canSee && (!centre || !canSee(centre) || (kind === "trail" && !canSee({ x: f.x2, y: f.y2 })))) return;
      const alpha = fieldAlpha(f.startedAt, f.endsAt, renderT);
      if (!e) {
        // Not yet due on the render clock: it appears when the bodies it concerns do.
        if (alpha <= 0) return;
        const smoother = kind === "cloud" ? new CloudSmoother(CLOUD_TAU_MS, CLOUD_WOBBLE, CLOUD_MAX_LAG, hashPhase(id)) : null;
        e = { g: this.scene.add.graphics().setDepth(DEPTH_GROUND_FIELD), smoother, seen: true };
        this.entries.set(id, e);
      }
      e.seen = true;
      if (alpha <= 0) {
        e.g.clear().setVisible(false);
        return;
      }
      const g = e.g.clear().setVisible(true);
      const mo = juiceScale("motion") > 0 ? now : 0;
      const fl = juiceScale("flash") > 0 ? now : 0;
      if (kind === "zone") this.drawZone(g, f, renderT, alpha, mo);
      else if (kind === "trail") this.drawTrail(g, f, alpha, mo, fl);
      else this.drawCloud(g, e.smoother!, f, id, at, localId, alpha, renderT, now, mo);
    });
    for (const [id, e] of this.entries) {
      if (e.seen) continue;
      e.g.destroy();
      this.entries.delete(id);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const e of this.entries.values()) e.g.destroy();
    this.entries.clear();
  }

  /** A Trial: a purple dashed ring on the ground that turns slowly, a faint tint inside, and a bright arc that shortens as the time runs out. */
  private drawZone(g: Phaser.GameObjects.Graphics, f: FieldStateLike, renderT: number, alpha: number, mo: number): void {
    const color = abilityColor(f.ability, ZONE_FALLBACK);
    const c = fieldCentre(f, renderT);
    g.setPosition(projX(c.x), projY(c.y)).setAlpha(alpha);
    const r = mo > 0 ? trialFieldRadius(f.r, renderT - f.startedAt) : f.r;
    g.fillStyle(color, 0.1).fillEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    g.lineStyle(2, color, 0.5).strokeEllipse(0, 0, r * 2, r * 2 * Y_SCALE);
    // Dashes: one every ~40 px of rim (at least 16), turning with motion.
    const dashes = Math.max(16, Math.round((r * TAU) / 40));
    const turn = mo * 0.00012;
    g.lineStyle(4, color, 0.9);
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * TAU + turn;
      this.arc(g, r, a0, a0 + (TAU / dashes) * 0.5, 4);
    }
    // The sweep, just inside the rim: the share of the zone's time still to run, from the top clockwise.
    const total = f.endsAt - f.startedAt;
    const left = total > 0 ? Math.min(1, Math.max(0, (f.endsAt - renderT) / total)) : 1;
    if (left > 0) {
      g.lineStyle(3, ZONE_SWEEP, 0.9);
      this.arc(g, r - 9, -Math.PI / 2, -Math.PI / 2 + TAU * left, Math.max(3, Math.ceil(72 * left)));
    }
  }

  /** A polyline along the ground ellipse of horizontal radius `r` from angle `a0` to `a1`. */
  private arc(g: Phaser.GameObjects.Graphics, r: number, a0: number, a1: number, steps: number): void {
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const th = a0 + ((a1 - a0) * i) / steps;
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r * Y_SCALE;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /** A Blaze Step's trail: a flickering orange band from the blink's origin to its landing, `r` either side of the line, with embers rising off it. */
  private drawTrail(g: Phaser.GameObjects.Graphics, f: FieldStateLike, alpha: number, mo: number, fl: number): void {
    g.setPosition(0, 0).setAlpha(alpha);
    const dx = f.x2 - f.x;
    const dy = f.y2 - f.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0.01)) return;
    const nx = (-dy / len) * f.r;
    const ny = (dx / len) * f.r;
    const flicker = pulse(fl, 7, 0, 1) * 0.6 + pulse(fl, 13, 0, 1) * 0.4;
    const corners = [[f.x + nx, f.y + ny], [f.x2 + nx, f.y2 + ny], [f.x2 - nx, f.y2 - ny], [f.x - nx, f.y - ny]] as const;
    g.fillStyle(TRAIL_FILL, 0.22 + 0.14 * flicker).beginPath();
    corners.forEach(([x, y], i) => {
      if (i === 0) g.moveTo(projX(x!), projY(y!));
      else g.lineTo(projX(x!), projY(y!));
    });
    g.closePath().fillPath();
    g.lineStyle(1.5, TRAIL_FILL, 0.5 + 0.25 * flicker).beginPath();
    corners.forEach(([x, y], i) => {
      if (i === 0) g.moveTo(projX(x!), projY(y!));
      else g.lineTo(projX(x!), projY(y!));
    });
    g.closePath().strokePath();
    g.lineStyle(3, TRAIL_CORE, 0.3 + 0.25 * flicker).lineBetween(projX(f.x), projY(f.y), projX(f.x2), projY(f.y2));
    // Embers: one per ~26 u along the band, rising and fading.
    const n = Math.max(2, Math.min(14, Math.round(len / 26)));
    for (let i = 0; i < n; i++) {
      const p = life(mo, 650, i, n);
      const t = (i + 0.5) / n;
      const side = Math.sin(i * 2.7) * f.r * 0.7;
      const ex = f.x + dx * t + (-dy / len) * side;
      const ey = f.y + dy * t + (dx / len) * side;
      const colour = i % 2 === 0 ? TRAIL_CORE : 0xff9800;
      g.fillStyle(colour, (1 - p) * 0.85).fillCircle(projX(ex), projY(ey, 2 + 14 * p), 1.2 + 1.6 * (1 - p));
    }
  }

  /** A Swarm: a haze on the ground and a handful of flies buzzing around the owner's smoothed position. */
  private drawCloud(
    g: Phaser.GameObjects.Graphics, smoother: CloudSmoother, f: FieldStateLike, id: string, at: (id: string) => Vec2 | undefined,
    localId: string, alpha: number, renderT: number, now: number, mo: number,
  ): void {
    const owner = f.owner ? at(f.owner) : undefined;
    const target = owner ?? fieldCentre(f, renderT);
    const c = smoother.step(target, now, mo > 0 ? 1 : 0);
    const a = alpha * (f.owner === localId ? OWN_CLOUD_ALPHA : 1);
    // Over the owner's body (depth of the ground point, a hair above it), not under the floor layer.
    g.setPosition(projX(c.x), projY(c.y, BODY_LIFT)).setDepth(depthFor(c.y, 1)).setAlpha(a);
    const r = f.r;
    g.fillStyle(CLOUD_HAZE, 0.16).fillEllipse(0, BODY_LIFT, r * 2, r * 2 * Y_SCALE);
    g.lineStyle(1.5, CLOUD_HAZE, 0.3).strokeEllipse(0, BODY_LIFT, r * 2, r * 2 * Y_SCALE);
    const seed = hashPhase(id);
    for (let i = 0; i < CLOUD_FLIES; i++) {
      const rho = r * (0.2 + 0.8 * ((i * 0.618 + seed) % 1));
      const dir = i % 2 === 0 ? 1 : -1;
      const th = seed * (i + 1) + dir * mo * (0.0012 + (i % 5) * 0.0005);
      // The buzz: a fast shake on top of the orbit.
      const bx = mo > 0 ? Math.sin(mo * 0.021 + i * 3.1) * 2.4 : 0;
      const by = mo > 0 ? Math.cos(mo * 0.027 + i * 1.7) * 2.4 : 0;
      const x = Math.cos(th) * rho + bx;
      const y = Math.sin(th) * rho * Y_SCALE - 4 * Math.sin(i * 1.3) + by;
      g.fillStyle(i % 3 === 0 ? CLOUD_LIGHT : CLOUD_DARK, 0.95).fillCircle(x, y, 1.8 + (i % 3) * 0.6);
    }
  }
}

function abilityColor(code: number, fallback: number): number {
  const id = ABILITY_IDS[code];
  return id ? ABILITIES[id].color : fallback;
}
