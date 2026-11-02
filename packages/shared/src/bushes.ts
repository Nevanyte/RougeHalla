// Bushes around elite camps: clumps of walkable floor that hide the player standing in them from viewers outside (vision.ts
// `bushConceals`). A bush is a FEATURE that owns floor tiles and changes no tile or terrain byte, so collision, paths, hazards,
// crates and ground spots are exactly what they were. Integer maths and a stream of its own only (mapgen's determinism rule).
import { hashSeed, mulberry32 } from "./rng";
import { TILE_FLOOR } from "./map";
import type { FeatureDraft } from "./zoneStyle/types";
import type { RegionFaction } from "./map";

export interface BushCamp { site: number; zone: number; elite: boolean }

export interface BushInput {
  w: number; h: number; seed: number; attempt: number;
  tiles: Uint8Array; terrain: Uint8Array; zone: Uint8Array; territoryGrid: Uint8Array;
  protect: Uint8Array; pool5: Uint8Array;
  camps: readonly BushCamp[];
  order: readonly RegionFaction[];
  features: FeatureDraft[]; featureOwner: Uint16Array;
  /** Terrain value meaning "none". */
  terrainNone: number;
}

/** Stream index of the bush stage (styler streams use 0..3). */
export const BUSH_STREAM = 4;
export const BUSH_CLUMPS_PER_CAMP = 3;
export const BUSH_MIN_TILES = 6;
const BAND_MIN_D2 = 16, BAND_MAX_D2 = 42, CLUMP_D2 = 10, CENTRE_SEP_D2 = 36;

/** Appends bush features (kind "bush", p [pre-records camp index, clump]) around every elite camp. Returns the number placed. */
export function placeEliteBushes(inp: BushInput): number {
  const { w, h, tiles, terrain, zone, territoryGrid, protect, pool5, features, featureOwner } = inp;
  let placed = 0;
  for (let ci = 0; ci < inp.camps.length; ci++) {
    const c = inp.camps[ci];
    if (!c.elite) continue;
    const cx = c.site % w, cy = (c.site - cx) / w;
    const rng = mulberry32(hashSeed(inp.seed, inp.attempt, c.zone - 1, BUSH_STREAM + ci * 8));
    const ok = (t: number): boolean => tiles[t] === TILE_FLOOR && terrain[t] === inp.terrainNone && zone[t] === c.zone
      && territoryGrid[t] === ci + 1 && featureOwner[t] === 0 && !protect[t] && !pool5[t];
    const band: number[] = [];
    for (let y = Math.max(1, cy - 7); y <= Math.min(h - 2, cy + 7); y++) {
      for (let x = Math.max(1, cx - 7); x <= Math.min(w - 2, cx + 7); x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 >= BAND_MIN_D2 && d2 <= BAND_MAX_D2 && ok(y * w + x)) band.push(y * w + x);
      }
    }
    if (band.length === 0) continue;
    const centres: number[] = [];
    for (let tries = 0; tries < 24 && centres.length < BUSH_CLUMPS_PER_CAMP; tries++) {
      const t = band[Math.floor(rng() * band.length)];
      const tx = t % w, ty = (t - tx) / w;
      if (centres.every((o) => { const ox = o % w, oy = (o - ox) / w; return (ox - tx) * (ox - tx) + (oy - ty) * (oy - ty) >= CENTRE_SEP_D2; })) centres.push(t);
    }
    let clump = 0;
    for (const centre of centres) {
      const mx = centre % w, my = (centre - mx) / w;
      const inClump = (t: number): boolean => {
        const x = t % w, y = (t - x) / w;
        const d2 = (x - mx) * (x - mx) + (y - my) * (y - my);
        const e2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        return d2 <= CLUMP_D2 && e2 >= BAND_MIN_D2 && e2 <= BAND_MAX_D2 && ok(t);
      };
      // The 4-connected piece of the centre, in tile order for determinism.
      const piece: number[] = [centre], seen = new Set<number>([centre]);
      for (let k = 0; k < piece.length; k++) {
        const t = piece[k];
        for (const n of [t - 1, t + 1, t - w, t + w]) if (!seen.has(n) && inClump(n)) { seen.add(n); piece.push(n); }
      }
      if (piece.length < BUSH_MIN_TILES) continue;
      piece.sort((a, b) => a - b);
      const ax = piece[0] % w, ay = (piece[0] - ax) / w;
      features.push({ kind: "bush", variant: "", zone: inp.order[c.zone - 1], jobs: ["cover"], ax, ay, p: [ci, clump++], bbox: { x: ax, y: ay, w: 0, h: 0 }, tiles: 0 });
      for (const t of piece) featureOwner[t] = features.length;
      placed++;
    }
  }
  return placed;
}
