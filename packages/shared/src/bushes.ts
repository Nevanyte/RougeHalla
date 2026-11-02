// Bushes around elite camps: small patches of walkable floor that hide the player standing in them from viewers outside (vision.ts
// `bushConceals`). A bush is a FEATURE that owns floor tiles and changes no tile or terrain byte, so walls, fences, landmarks,
// craters and every other piece of the zone's architecture are exactly what they are without bushes; collision, paths, hazards,
// crates and ground spots too. The patches hug the architecture round the elite camp (walls, low ground, other features' floor,
// hazards): brush grows in the lee of things, in a few light clusters rather than rings. Integer maths and a stream of its own
// only (mapgen's determinism rule).
import { hashSeed, mulberry32 } from "./rng";
import { TILE_FLOOR } from "./map";
import type { FeatureDraft } from "./zoneStyle/types";
import type { RegionFaction } from "./map";

export interface BushCamp { site: number; zone: number; elite: boolean }

export interface BushInput {
  w: number; h: number; seed: number; attempt: number;
  tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; territoryGrid: Uint8Array;
  protect: Uint8Array; pool5: Uint8Array;
  /** Tiles a bush must not take (the 3x3 of every weapon crate). */
  avoid?: Uint8Array;
  camps: readonly BushCamp[];
  order: readonly RegionFaction[];
  features: FeatureDraft[]; featureOwner: Uint16Array;
  /** Terrain value meaning "none". */
  terrainNone: number;
}

/** Stream index of the bush stage (styler streams use 0..3). */
export const BUSH_STREAM = 4;
/** Patches per elite camp (best guess: a few light clusters), tiles per patch, and how far from the camp a patch may reach. */
export const BUSH_PATCHES_MIN = 2;
export const BUSH_PATCHES_MAX = 4;
export const BUSH_MIN_TILES = 4;
export const BUSH_MAX_TILES = 10;
const NEAR_MIN_D2 = 16, NEAR_MAX_D2 = 100, CENTRE_SEP_D2 = 49;

/** Appends bush features (kind "bush", p [pre-records camp index, patch]) around every elite camp. Returns the number placed. */
export function placeEliteBushes(inp: BushInput): number {
  const { w, h, tiles, terrain, zone, territoryGrid, protect, pool5, avoid, features, featureOwner } = inp;
  const isBush = (t: number): boolean => featureOwner[t] > 0 && features[featureOwner[t] - 1].kind === "bush";
  let placed = 0;
  for (let ci = 0; ci < inp.camps.length; ci++) {
    const c = inp.camps[ci];
    if (!c.elite) continue;
    const cx = c.site % w, cy = (c.site - cx) / w;
    const rng = mulberry32(hashSeed(inp.seed, inp.attempt, c.zone - 1, BUSH_STREAM + ci * 8));
    const near = (t: number): boolean => {
      const x = t % w, y = (t - x) / w;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      return d2 >= NEAR_MIN_D2 && d2 <= NEAR_MAX_D2;
    };
    // Plain floor of the camp's own territory that nothing owns, away from every bush already down (patches never touch).
    const ok = (t: number): boolean => {
      if (tiles[t] !== TILE_FLOOR || terrain[t] !== inp.terrainNone || zone[t] !== c.zone || territoryGrid[t] !== ci + 1) return false;
      if (featureOwner[t] !== 0 || protect[t] || pool5[t] || (avoid !== undefined && avoid[t]) || !near(t)) return false;
      return !(isBush(t - 1) || isBush(t + 1) || isBush(t - w) || isBush(t + w));
    };
    // How much architecture a floor tile leans on: walls and low ground, other features' floor and hazards among its 8 neighbours.
    const lee = (t: number): number => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const u = t + dy * w + dx;
          if (tiles[u] !== TILE_FLOOR || terrain[u] !== inp.terrainNone || (featureOwner[u] > 0 && !isBush(u))) n++;
        }
      }
      return n;
    };
    const all: number[] = [], hugging: number[] = [];
    for (let y = Math.max(1, cy - 10); y <= Math.min(h - 2, cy + 10); y++) {
      for (let x = Math.max(1, cx - 10); x <= Math.min(w - 2, cx + 10); x++) {
        const t = y * w + x;
        if (!ok(t)) continue;
        all.push(t);
        if (lee(t) > 0) hugging.push(t);
      }
    }
    if (all.length === 0) continue;
    const pool = hugging.length >= BUSH_MIN_TILES ? hugging : all;
    const want = BUSH_PATCHES_MIN + Math.floor(rng() * (BUSH_PATCHES_MAX - BUSH_PATCHES_MIN + 1));
    const centres: number[] = [];
    let patch = 0;
    for (let tries = 0; tries < want * 6 && patch < want; tries++) {
      const centre = pool[Math.floor(rng() * pool.length)];
      const mx = centre % w, my = (centre - mx) / w;
      if (!ok(centre)) continue;
      if (!centres.every((o) => { const ox = o % w, oy = (o - ox) / w; return (ox - mx) * (ox - mx) + (oy - my) * (oy - my) >= CENTRE_SEP_D2; })) continue;
      const target = BUSH_MIN_TILES + Math.floor(rng() * (BUSH_MAX_TILES - BUSH_MIN_TILES + 1));
      // Grow the patch one tile at a time from the centre, along the architecture where it can: candidates in discovery order.
      const piece: number[] = [centre], inPiece = new Set<number>([centre]);
      while (piece.length < target) {
        const cand: number[] = [], seen = new Set<number>();
        for (const t of piece) {
          for (const n of [t - 1, t + 1, t - w, t + w]) {
            if (inPiece.has(n) || seen.has(n)) continue;
            seen.add(n);
            if (ok(n)) cand.push(n);
          }
        }
        if (cand.length === 0) break;
        const leaning = cand.filter((n) => lee(n) > 0);
        const from = leaning.length > 0 ? leaning : cand;
        const pick = from[Math.floor(rng() * from.length)];
        piece.push(pick);
        inPiece.add(pick);
      }
      if (piece.length < BUSH_MIN_TILES) continue;
      piece.sort((a, b) => a - b);
      const ax = piece[0] % w, ay = (piece[0] - ax) / w;
      features.push({ kind: "bush", variant: "", zone: inp.order[c.zone - 1], jobs: ["cover"], ax, ay, p: [ci, patch++], bbox: { x: ax, y: ay, w: 0, h: 0 }, tiles: 0 });
      for (const t of piece) featureOwner[t] = features.length;
      centres.push(centre);
      placed++;
    }
  }
  return placed;
}
