// The animated part of the terrain art (part D 7.4): glows and shimmers over the baked floor, light beams, and closed-form
// particles. Cheap by construction:
//   * overlays: every animated kind is built ONCE as static Graphics, one per chunk, kind and phase bucket (4 buckets: a tile's
//     bucket is its hash), and animated by `setAlpha` per frame (no redraw). Only the groups in view are shown.
//   * particles: a position is a closed-form function of (now, emitter, i), one Graphics per kind cleared and redrawn each frame,
//     only for emitters in the camera rect, at most PARTICLE_CAP_PER_KIND per kind and PARTICLE_CAP_TOTAL in all.
// Presentation only. Juice gating: `juiceScale("flash")` scales every overlay (0 shows the baked art only), `juiceScale("motion")`
// scales the particles and the pulsing (0 under reduced motion: the overlays hold still at the middle of their range and no
// particle is drawn). Pulses stay at or under 1.2 Hz and swing their alpha by at most 0.25 (photosensitivity).
import Phaser from "phaser";
import {
  TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE, TILE_FLOOR, TILE_LOW, worldToTile,
  type GameMap,
} from "@raid/shared";
import { juiceScale } from "../juice";
import { life } from "../signatureLook";
import { CHUNK_TILES, DEPTH_FLOOR_FX } from "./bake";
import { planProps } from "./propsView";
import { TERRAIN_PALETTE, ZONE_PALETTE } from "./palette";
import {
  TILE_H, TILE_W, drawBogBubble, drawEmberGlow, drawIceShimmer, drawLavaGlow, drawLightBeam, hashTile, type Pen,
} from "./zoneStyle";

/** Phase buckets per overlay kind: the groups of one chunk and kind that pulse out of step. */
export const FX_BUCKETS = 4;
/** Particle caps (D 7.4). */
export const PARTICLE_CAP_PER_KIND = 24;
export const PARTICLE_CAP_TOTAL = 40;
/** Particles each emitter sends up. */
export const PARTICLES_PER_EMITTER = 3;
/** Beams and particles sit over the fighters and under the fx layer (DEPTH_FX = 8e5). */
export const DEPTH_FX_OVER = 7e5;
/** The most any pulse may swing its alpha, and the fastest it may beat (photosensitivity). */
export const MAX_PULSE_SWING = 0.25;
export const MAX_PULSE_HZ = 1.2;

export type OverlayKind = "lava" | "ember" | "bog" | "ice";
export type ParticleKind = "ember" | "spore" | "frost" | "mote";

export interface PulseSpec {
  hz: number;
  lo: number;
  hi: number;
}

/** How each overlay pulses (D 7.4). */
export const PULSE: Readonly<Record<OverlayKind | "light", PulseSpec>> = {
  lava: { hz: 0.6, lo: 0.15, hi: 0.3 },
  ember: { hz: 1.2, lo: 0.2, hi: 0.35 },
  bog: { hz: 0.5, lo: 0, hi: 0.22 },
  ice: { hz: 0.4, lo: 0, hi: 0.25 },
  light: { hz: 0.3, lo: 0.25, hi: 0.4 },
};

/**
 * The alpha of phase bucket `bucket` (of FX_BUCKETS) at `nowMs`, times `flash` (0 hides it). With `motion` at 0 the pulse holds
 * still at the middle of its range; otherwise `motion` (up to 1) scales how far it swings from there.
 */
export function bucketAlpha(spec: PulseSpec, nowMs: number, bucket: number, flash: number, motion = 1): number {
  const mid = (spec.lo + spec.hi) / 2;
  const half = ((spec.hi - spec.lo) / 2) * Math.min(1, Math.max(0, motion));
  const wave = Math.sin(2 * Math.PI * (spec.hz * nowMs / 1000 + bucket / FX_BUCKETS));
  return Math.max(0, mid + half * wave) * flash;
}

// ------------------------------------------------------------------------------------------------------------------ plan

export interface FxGroup {
  kind: OverlayKind;
  /** The chunk it belongs to (16x16 tiles), its phase bucket, and the tile indices (row-major) it paints. */
  cx: number;
  cy: number;
  bucket: number;
  tiles: number[];
}

export interface FxBeam {
  /** The beam's centre x, its base (the pool's south edge) and width in projected px, and its phase bucket. */
  x: number;
  baseY: number;
  w: number;
  bucket: number;
  /** Tile bounds of its pool (inclusive). */
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

export interface Emitter {
  /** Ground position in projected px (the particle's origin sits at the feet of the effect). */
  x: number;
  y: number;
  /** 0..1, offsets the emitter's particles so a field of them does not breathe together. */
  phase: number;
}

export interface FxPlan {
  groups: FxGroup[];
  beams: FxBeam[];
  /** Per particle kind, in priority order: the first N in view are the ones drawn, so the choice is stable as the camera moves. */
  emitters: Record<ParticleKind, Emitter[]>;
}

const PARTICLE_KINDS: readonly ParticleKind[] = ["ember", "spore", "frost", "mote"];


/** Which tiles of a kind take part: all lava and ember, half the bog (bubble pops), a third of the ice (shimmers). */
function overlayTile(kind: OverlayKind, hash: number): boolean {
  if (kind === "bog") return (hash >>> 2 & 1) === 0;
  if (kind === "ice") return (hash >>> 2) % 3 === 0;
  return true;
}

/** Every Nth tile of a floor kind is an emitter of its particles. */
function emitterEvery(kind: ParticleKind): number {
  return kind === "ember" ? 5 : kind === "spore" ? 6 : kind === "frost" ? 9 : 2;
}

/** Plans the overlays, the light beams and the emitters of a map. Pure. */
export function planFx(map: GameMap): FxPlan {
  const { w, h, tiles, terrain } = map;
  const groups = new Map<string, FxGroup>();
  const emitters: Record<ParticleKind, Array<Emitter & { rank: number }>> = { ember: [], spore: [], frost: [], mote: [] };
  const lightTiles: number[] = [];
  const kindOf = (k: number, t: number): OverlayKind | null => {
    if (k === TERRAIN_LAVA && t === TILE_LOW) return "lava";
    if (t !== TILE_FLOOR) return null;
    return k === TERRAIN_EMBER ? "ember" : k === TERRAIN_BOG ? "bog" : k === TERRAIN_ICE ? "ice" : null;
  };
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      const k = terrain[i];
      if (k === 0) continue;
      const hash = hashTile(tx, ty, map.seed);
      const kind = kindOf(k, tiles[i]);
      if (kind !== null && overlayTile(kind, hash)) {
        const cx = Math.floor(tx / CHUNK_TILES);
        const cy = Math.floor(ty / CHUNK_TILES);
        const bucket = hash & (FX_BUCKETS - 1);
        const key = `${kind}:${cx}:${cy}:${bucket}`;
        let g = groups.get(key);
        if (!g) { g = { kind, cx, cy, bucket, tiles: [] }; groups.set(key, g); }
        g.tiles.push(i);
      }
      if (tiles[i] === TILE_FLOOR && k === TERRAIN_LIGHT) lightTiles.push(i);
      const pk: ParticleKind | null = tiles[i] !== TILE_FLOOR ? null : k === TERRAIN_EMBER ? "ember" : k === TERRAIN_BOG ? "spore" : k === TERRAIN_ICE ? "frost" : k === TERRAIN_LIGHT ? "mote" : null;
      if (pk !== null && (hash >>> 7) % emitterEvery(pk) === 0) {
        emitters[pk].push({ x: tx * TILE_W + TILE_W / 2, y: ty * TILE_H + TILE_H * 0.7, phase: (hash & 255) / 255, rank: hash >>> 12 });
      }
    }
  }
  for (const { prop: p, kind: pk } of planProps(map).emitters) {
    const hash = hashTile(worldToTile(p.x), worldToTile(p.y), map.seed + 1);
    // A vent is a strong emitter: it ranks ahead of the tiles.
    emitters[pk].push({ x: p.x, y: p.y * (TILE_H / TILE), phase: (hash & 255) / 255, rank: (hash >>> 12) % 4096 - 4096 });
  }

  // Light pools: 4-connected components of LIGHT floor, one beam each.
  const beams: FxBeam[] = [];
  const seen = new Uint8Array(w * h);
  for (const start of lightTiles) {
    if (seen[start]) continue;
    let tx0 = w, ty0 = h, tx1 = -1, ty1 = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x); ty0 = Math.min(ty0, y); ty1 = Math.max(ty1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && tiles[j] === TILE_FLOOR && terrain[j] === TERRAIN_LIGHT) { seen[j] = 1; stack.push(j); }
      }
    }
    beams.push({
      x: ((tx0 + tx1 + 1) / 2) * TILE_W, baseY: (ty1 + 1) * TILE_H - TILE_H * 0.25, w: (tx1 - tx0 + 1) * TILE_W * 0.9,
      bucket: beams.length & (FX_BUCKETS - 1), tx0, ty0, tx1, ty1,
    });
  }

  const sortedEmitters = {} as Record<ParticleKind, Emitter[]>;
  for (const pk of PARTICLE_KINDS) {
    emitters[pk].sort((a, b) => a.rank - b.rank || a.x - b.x || a.y - b.y);
    sortedEmitters[pk] = emitters[pk].map(({ x, y, phase }) => ({ x, y, phase }));
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.kind.localeCompare(b.kind) || a.bucket - b.bucket),
    beams,
    emitters: sortedEmitters,
  };
}

// ------------------------------------------------------------------------------------------------------------------ particles

export interface Particle {
  x: number;
  y: number;
  alpha: number;
  r: number;
}

/** Particle `i` of `n` of an emitter at `nowMs`, as a closed-form function of its life: where, how bright, how big. `drift` scales the movement (0 = still). */
export function particleAt(kind: ParticleKind, e: Emitter, nowMs: number, i: number, n: number, drift: number, out: Particle): Particle {
  const p = life(nowMs, PERIOD[kind], i + e.phase * n, n);
  const side = Math.sin(i * 2.4 + e.phase * 6.28);
  switch (kind) {
    case "ember": {
      out.x = e.x + side * 7 + Math.sin(p * 6 + i) * 2 * drift;
      out.y = e.y - 3 - p * 40 * drift;
      out.alpha = (1 - 0.7 * p) * (0.6 + 0.4 * Math.sin(nowMs / 90 + i * 5 + e.phase * 9));
      out.r = 1 + 1.6 * (1 - p);
      break;
    }
    case "spore": {
      out.x = e.x + side * 8 + Math.sin(p * 4 + i) * 3 * drift;
      out.y = e.y - 2 - p * 24 * drift;
      out.alpha = Math.sin(Math.PI * p) * 0.55;
      out.r = 1.3 + 1.2 * Math.sin(Math.PI * p);
      break;
    }
    case "frost": {
      // A twinkle in place: it comes and goes, it does not travel.
      out.x = e.x + side * 9;
      out.y = e.y - 4 - ((i * 7) % 5) * 1.5 - p * 4 * drift;
      out.alpha = Math.sin(Math.PI * p) * 0.9;
      out.r = 1.1 + 1.6 * Math.sin(Math.PI * p);
      break;
    }
    case "mote": {
      out.x = e.x + side * 9 + Math.sin(p * 3 + i * 2) * 3 * drift;
      out.y = e.y - 2 - p * 34 * drift;
      out.alpha = Math.sin(Math.PI * p) * 0.7;
      out.r = 1 + 0.9 * Math.sin(Math.PI * p);
      break;
    }
  }
  return out;
}

/** The period of one life, in ms: slow things drift slowly. */
const PERIOD: Readonly<Record<ParticleKind, number>> = { ember: 1600, spore: 3200, frost: 1800, mote: 4200 };

const PARTICLE_COLOR: Readonly<Record<ParticleKind, number>> = {
  ember: ZONE_PALETTE.fire.particle,
  spore: ZONE_PALETTE.plague.particle,
  frost: ZONE_PALETTE.frost.particle,
  mote: TERRAIN_PALETTE.light.beam,
};

/** The emitters of `list` that lie in the rectangle (padded), first in priority order, at most `max` of them. */
export function emittersInView(list: readonly Emitter[], left: number, top: number, right: number, bottom: number, max: number, out: Emitter[]): Emitter[] {
  out.length = 0;
  for (let k = 0; k < list.length && out.length < max; k++) {
    const e = list[k]!;
    if (e.x >= left && e.x <= right && e.y >= top && e.y <= bottom) out.push(e);
  }
  return out;
}

/** How many emitters a kind may show: PARTICLE_CAP_PER_KIND particles, and what is left of PARTICLE_CAP_TOTAL. */
export function emitterBudget(usedParticles: number): number {
  const room = Math.min(PARTICLE_CAP_PER_KIND, PARTICLE_CAP_TOTAL - usedParticles);
  return Math.max(0, Math.floor(room / PARTICLES_PER_EMITTER));
}

// ------------------------------------------------------------------------------------------------------------------ Phaser

export interface FxView {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Shown {
  g: Phaser.GameObjects.Graphics;
  spec: PulseSpec;
  bucket: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  visible: boolean;
}

export class TerrainFx {
  private readonly plan: FxPlan;
  private readonly overlays: Shown[] = [];
  private readonly beams: Shown[] = [];
  private readonly particleG: Partial<Record<ParticleKind, Phaser.GameObjects.Graphics>> = {};
  private enabled = true;
  private readonly scratch: Emitter[] = [];
  private readonly particle: Particle = { x: 0, y: 0, alpha: 0, r: 0 };
  private particlesDrawn = false;

  constructor(private readonly scene: Phaser.Scene, readonly map: GameMap) {
    this.plan = planFx(map);
    for (const grp of this.plan.groups) {
      const g = scene.add.graphics().setDepth(DEPTH_FLOOR_FX).setVisible(false);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of grp.tiles) {
        const tx = i % map.w, ty = (i - tx) / map.w;
        const x = tx * TILE_W, y = ty * TILE_H;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + TILE_W); y1 = Math.max(y1, y + TILE_H);
        paintOverlay(g, grp.kind, x, y, hashTile(tx, ty, map.seed));
      }
      this.overlays.push({ g, spec: PULSE[grp.kind], bucket: grp.bucket, x0, y0, x1, y1, visible: false });
    }
    for (const b of this.plan.beams) {
      const g = scene.add.graphics().setDepth(DEPTH_FX_OVER).setVisible(false);
      drawLightBeam(g, b.x, b.baseY, b.w, 58);
      this.beams.push({
        g, spec: PULSE.light, bucket: b.bucket, x0: b.x - b.w / 2, y0: b.baseY - 58, x1: b.x + b.w / 2, y1: b.baseY, visible: false,
      });
    }
    for (const pk of PARTICLE_KINDS) {
      if (this.plan.emitters[pk].length > 0) this.particleG[pk] = scene.add.graphics().setDepth(DEPTH_FX_OVER + 1).setVisible(false);
    }
  }

  /** Counts for the budget report. */
  get stats(): { overlayGraphics: number; beams: number; emitters: number } {
    return {
      overlayGraphics: this.overlays.length, beams: this.beams.length,
      emitters: PARTICLE_KINDS.reduce((n, k) => n + this.plan.emitters[k].length, 0),
    };
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    if (!visible) this.hideAll();
  }

  /** Each frame: shows and pulses the groups in view, redraws the particles of the emitters in view. */
  update(nowMs: number, view: FxView): void {
    if (!this.enabled) return;
    const flash = juiceScale("flash");
    const motion = juiceScale("motion");
    if (!(flash > 0)) {
      this.hideAll();
      return;
    }
    for (const list of [this.overlays, this.beams]) {
      for (const s of list) {
        const inView = s.x1 >= view.left && s.x0 <= view.right && s.y1 >= view.top && s.y0 <= view.bottom;
        if (inView !== s.visible) { s.visible = inView; s.g.setVisible(inView); }
        if (inView) s.g.setAlpha(bucketAlpha(s.spec, nowMs, s.bucket, flash, motion));
      }
    }
    this.drawParticles(nowMs, view, motion);
  }

  destroy(): void {
    for (const s of [...this.overlays, ...this.beams]) s.g.destroy();
    for (const g of Object.values(this.particleG)) g?.destroy();
    this.overlays.length = 0;
    this.beams.length = 0;
  }

  private hideAll(): void {
    for (const list of [this.overlays, this.beams]) {
      for (const s of list) {
        if (s.visible) { s.visible = false; s.g.setVisible(false); }
      }
    }
    this.clearParticles();
  }

  private clearParticles(): void {
    if (!this.particlesDrawn) return;
    this.particlesDrawn = false;
    for (const g of Object.values(this.particleG)) g?.clear().setVisible(false);
  }

  private drawParticles(nowMs: number, view: FxView, motion: number): void {
    if (!(motion > 0)) {
      this.clearParticles();
      return;
    }
    let used = 0;
    const pad = 24;
    for (const pk of PARTICLE_KINDS) {
      const g = this.particleG[pk];
      if (!g) continue;
      const room = emitterBudget(used);
      const inView = room > 0 ? emittersInView(this.plan.emitters[pk], view.left - pad, view.top - pad, view.right + pad, view.bottom + pad + 40, room, this.scratch) : [];
      g.clear();
      if (inView.length === 0) {
        g.setVisible(false);
        continue;
      }
      g.setVisible(true);
      const color = PARTICLE_COLOR[pk];
      const p = this.particle;
      for (const e of inView) {
        for (let i = 0; i < PARTICLES_PER_EMITTER; i++) {
          particleAt(pk, e, nowMs, i, PARTICLES_PER_EMITTER, motion, p);
          if (p.alpha <= 0.02) continue;
          if (pk === "frost") {
            g.lineStyle(1, color, p.alpha * motion).lineBetween(p.x - p.r * 1.6, p.y, p.x + p.r * 1.6, p.y).lineBetween(p.x, p.y - p.r * 1.6, p.x, p.y + p.r * 1.6);
          } else {
            g.fillStyle(color, p.alpha * motion).fillCircle(p.x, p.y, p.r);
          }
        }
      }
      used += inView.length * PARTICLES_PER_EMITTER;
      this.particlesDrawn = true;
    }
  }
}

/** Paints one tile's overlay shape for its kind (absolute projected coordinates). */
function paintOverlay(g: Pen, kind: OverlayKind, x: number, y: number, hash: number): void {
  switch (kind) {
    case "lava": drawLavaGlow(g, x, y); break;
    case "ember": drawEmberGlow(g, x, y); break;
    case "bog": drawBogBubble(g, x, y, hash); break;
    case "ice": drawIceShimmer(g, x, y, hash); break;
  }
}
