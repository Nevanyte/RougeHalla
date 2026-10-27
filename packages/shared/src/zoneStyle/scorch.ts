// Scorch (fire): volcanic badlands. Jagged obsidian ridges with 2-3 tile passes, one meandering lava river with fords and an
// ember bank, two basalt pillar fields, open ash. The ridge passes and the fords are the chokepoints; Fire is exempt from
// the embers. Parameters are part D 4.1's, scaled down to the zone's size (a wedge zone is a third of an R1 zone).
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../map";
import { TERRAIN_EMBER, TERRAIN_LAVA, TERRAIN_NONE } from "../terrain";
import { breakLowRuns, chance, DIR8, flowPath, low, pickOpen, roomOf, steer, wall } from "./kit";
import { PROP } from "./propKinds";
import { randInt } from "../rng";
import type { PropCtx, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";
import { sizeScale } from "./scale";

export interface ScorchPlan {
  /** Tiles of the lava river's kept stretch, in flow order (empty when no river fitted). */
  riverPath: number[];
  /** Centre tile of each ford (a gap in the river). */
  fords: number[];
  ridges: number;
  pillarFields: number;
}

function shape(c: ShapeCtx): ScorchPlan {
  const r = c.rng;
  const sc = sizeScale(c.zone.painted);
  const plan: ScorchPlan = { riverPath: [], fords: [], ridges: 0, pillarFields: 0 };
  // 1. jagged obsidian ridges: 8-direction polylines, 1-2 thick, a 2-3 tile pass every 9-14 steps. A walk steers along the
  //    ground a finished map leaves free and ends where there is none.
  // 3 ridges (4 in a big zone) on open ground; a finished map leaves ground in strips, so more walks, each short
  const nR = roomOf(c) > 0.4 ? (c.zone.painted > 1900 ? 4 : 3) : 5;
  const lenLo = Math.max(10, Math.floor(12 * sc)), lenHi = Math.max(lenLo + 4, Math.floor(22 * sc));
  for (let k = 0; k < nR; k++) {
    const s = pickOpen(c);
    if (!s) continue;
    plan.ridges++;
    let [x, y] = s;
    let h = randInt(r, 0, 8);
    const len = randInt(r, lenLo, lenHi);
    let since = randInt(r, 0, 5), gap = 0, nextGap = randInt(r, 9, 15);
    for (let st = 0; st < len; st++) {
      if (gap > 0) gap--;
      else {
        wall(c, x, y);
        if (chance(r, 0.6)) { const [sx, sy] = DIR8[(h + 2) & 7]; wall(c, x + sx, y + sy); }
        if (++since >= nextGap) { gap = randInt(r, 2, 4); since = 0; nextGap = randInt(r, 9, 15); }
      }
      if (chance(r, 0.22)) h = (h + (chance(r, 0.5) ? 1 : 7)) & 7;
      const nh = steer(c, x, y, h, chance(r, 0.5));
      if (nh < 0) break;
      h = nh;
      x += DIR8[h][0]; y += DIR8[h][1];
    }
  }
  // 2. one lava river: a flow path between two free tiles on opposite sides of the zone's box, a stretch of it kept (2-3
  //    wide, two fords)
  const bb = c.zone.bbox;
  const nearestFree = (cx: number, cy: number): number => {
    let best = -1, bd = 1e9;
    for (let y = bb.y; y < bb.y + bb.h; y++) {
      for (let x = bb.x; x < bb.x + bb.w; x++) {
        const i = y * c.w + x;
        if (!c.mask[i] || c.tiles[i] !== TILE_FLOOR || c.hard[i]) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };
  const KEEP = Math.max(14, Math.floor(36 * sc));
  const fordLen = sc < 0.8 ? 3 : 4;
  let full: number[] = [];
  for (let attempt = 0; attempt < 3 && full.length < KEEP; attempt++) {
    const horizontal = chance(r, 0.5);
    const a0 = horizontal ? nearestFree(bb.x, randInt(r, bb.y + 6, Math.max(bb.y + 7, bb.y + bb.h - 6))) : nearestFree(randInt(r, bb.x + 6, Math.max(bb.x + 7, bb.x + bb.w - 6)), bb.y);
    const b0 = horizontal ? nearestFree(bb.x + bb.w - 1, randInt(r, bb.y + 6, Math.max(bb.y + 7, bb.y + bb.h - 6))) : nearestFree(randInt(r, bb.x + 6, Math.max(bb.x + 7, bb.x + bb.w - 6)), bb.y + bb.h - 1);
    const p = a0 < 0 || b0 < 0 ? [] : flowPath(c, a0, b0, 11, (j) => (c.open(j) ? 0 : 50));
    if (p.length > full.length) full = p;
  }
  if (full.length >= 8) {
    const keep = Math.min(KEEP, full.length);
    const s0 = full.length > keep ? randInt(r, 0, full.length - keep + 1) : 0;
    const path = full.slice(s0, s0 + keep);
    const f1 = Math.floor(path.length * (0.22 + r() * 0.1)), f2 = Math.floor(path.length * (0.62 + r() * 0.1));
    plan.riverPath = path;
    // a ford stays open: no stamp of the river may take its tiles
    for (const f of [f1, f2]) for (let k = f; k < Math.min(path.length, f + fordLen); k++) c.reserve(path[k]);
    for (let s = 0; s < path.length; s++) {
      if ((s >= f1 && s < f1 + fordLen) || (s >= f2 && s < f2 + fordLen)) continue;
      const wd = c.noise.value(s / 5, 3.3, 1, 13) > 0.65 ? 3 : 2;
      const x = path[s] % c.w, y = (path[s] - x) / c.w;
      for (let oy = 0; oy < wd; oy++) {
        for (let ox = 0; ox < wd; ox++) {
          const tx = x + ox - (wd >> 1), ty = y + oy - (wd >> 1);
          low(c, tx, ty, "lava");
        }
      }
    }
    for (const f of [f1, f2]) {
      const mid = path[Math.min(path.length - 1, f + (fordLen >> 1))];
      plan.fords.push(mid);
    }
  }
  // 3. basalt pillar fields (two, 5x5 lattice cells at pitch 3, scaled)
  const half = sc < 0.8 ? 1 : 2;
  for (let p = 0; p < 2; p++) {
    const s = pickOpen(c);
    if (!s) continue;
    plan.pillarFields++;
    for (let b = -half; b <= half; b++) {
      for (let a = -half; a <= half; a++) {
        if (!chance(r, 0.7)) continue;
        const x = s[0] + a * 3 + randInt(r, 0, 2), y = s[1] + b * 3 + randInt(r, 0, 2);
        if (wall(c, x, y) && chance(r, 0.25)) wall(c, x + (chance(r, 0.5) ? 1 : 0), y + 1);
      }
    }
  }
  // 4. no straight LOW run over 12 tiles: a basalt pillar stands in the river
  breakLowRuns(c, 12);
  return plan;
}

/** The ember bank: every free floor tile touching lava (8 neighbours) is EMBER, fords included. */
function surface(c: SurfaceCtx): void {
  for (let i = 0; i < c.w * c.h; i++) {
    if (c.terrain[i] !== TERRAIN_LAVA || c.tiles[i] !== TILE_LOW) continue;
    const x = i % c.w, y = (i - x) / c.w;
    for (const [dx, dy] of DIR8) {
      const j = c.at(x + dx, y + dy);
      if (j >= 0) c.surface(j, "ember");
    }
  }
}

function props(c: PropCtx): void {
  const n = c.w * c.h;
  for (let i = 0; i < n; i++) {
    if (!c.mask[i]) continue;
    const x = i % c.w, y = (i - x) / c.w;
    const v = Math.floor(c.noise.hash(x, y, 90) * 4);
    const t = c.tiles[i], k = c.terrain[i];
    if (t === TILE_FLOOR) {
      if (k === TERRAIN_EMBER) { if (c.noise.hash(x, y, 1) < 0.12) c.prop(PROP.ember_vent, x, y, v); }
      else if (k === TERRAIN_NONE && c.noise.hash(x, y, 2) < 0.02) c.prop(PROP.ash_drift, x, y, v);
    } else if (t === TILE_WALL) {
      const u = c.noise.hash(x, y, 3);
      if (u < 0.12) c.prop(PROP.glow_crack, x, y, v);
      else if (u < 0.17) c.prop(PROP.basalt_shard, x, y, v);
    }
  }
}

export const scorch: ZoneStyler<ScorchPlan> = { id: "scorch", faction: "fire", version: 1, shape, surface, props };
