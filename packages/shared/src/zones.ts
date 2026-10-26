// The zone partition: which faction region every tile belongs to. The wedge layout: five sectors whose boundaries are
// wobbling rays from the map centre, with a ridge of wall along each boundary broken by one or two passes.
import { MAP_TILES_H, MAP_TILES_W } from "./constants";
import { TWO_PI, detCos, detSin } from "./cover";
import { REGION_FACTIONS, regionCode } from "./map";
import type { RegionFaction } from "./map";
import { randRange, shuffle } from "./rng";
import type { Rng } from "./rng";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
/** The corner shared by tiles CX-1 and CX; also the index of the centre tile. */
const CX = W / 2;
const CY = H / 2;
const SECTORS = REGION_FACTIONS.length;

const RIDGE_START = 5;
const RIDGE_HALF = 1.0;
const PASS_HALF = 1.6;
const PASS_MIN_GAP = 8;
const LONG_RIDGE = 22;

interface Boundary { sin: number; cos: number; amp: number; phase: number }

/** The five sectors: faction order, the sector of every tile, and the boundary bands the ridges run along. */
export interface WedgeSectors {
  /** Faction of sector k. */
  order: RegionFaction[];
  /** REGION_IDS code of sector k. */
  sectorCode: number[];
  sector: Uint8Array;
  /** 1 on the band (within RIDGE_HALF of a boundary, past RIDGE_START from the footprint) where a ridge may stand. */
  band: Uint8Array;
  /** The boundary a band tile belongs to. */
  bandK: Uint8Array;
  /** Distance of each tile centre from the map centre. */
  rad: Float64Array;
  /** Radial extent of each boundary's band. */
  rMin: Float64Array;
  rMax: Float64Array;
}

/** Draws the boundaries and the faction order (rng: theta0, then jitter, amplitude and phase per boundary, then the shuffle). */
export function wedgeSectors(rng: Rng, fp: Uint8Array, border: Uint8Array, distFp: Uint8Array): WedgeSectors {
  const theta0 = rng() * TWO_PI;
  const bounds: Boundary[] = [];
  for (let k = 0; k < SECTORS; k++) {
    const theta = theta0 + (k * TWO_PI) / SECTORS + randRange(rng, -0.12, 0.12);
    const amp = randRange(rng, 0.04, 0.1);
    const phase = rng() * TWO_PI;
    bounds.push({ sin: detSin(theta), cos: detCos(theta), amp, phase });
  }
  const order = shuffle(rng, [...REGION_FACTIONS]);
  const sectorCode = order.map((f) => regionCode(f));

  const sector = new Uint8Array(N);
  const band = new Uint8Array(N);
  const bandK = new Uint8Array(N);
  const rad = new Float64Array(N);
  const bx = new Float64Array(SECTORS), by = new Float64Array(SECTORS);
  const rMin = new Float64Array(SECTORS).fill(Infinity), rMax = new Float64Array(SECTORS).fill(-Infinity);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
      const r = Math.sqrt(dx * dx + dy * dy);
      rad[i] = r;
      for (let k = 0; k < SECTORS; k++) {
        const b = bounds[k];
        // Rotate the base direction by the small wobble angle with short Taylor series (|delta| <= 0.1).
        const delta = b.amp * detSin(0.35 * r + b.phase);
        const e = delta * delta;
        const sd = delta * (1 - e * (1 / 6 - e / 120));
        const cd = 1 - e * (0.5 - e / 24);
        bx[k] = b.cos * cd - b.sin * sd;
        by[k] = b.sin * cd + b.cos * sd;
      }
      let s = SECTORS - 1;
      for (let k = 0; k < SECTORS; k++) {
        const k2 = k + 1 === SECTORS ? 0 : k + 1;
        if (bx[k] * dy - by[k] * dx >= 0 && dx * by[k2] - dy * bx[k2] > 0) { s = k; break; }
      }
      sector[i] = s;
      if (fp[i] || border[i] || distFp[i] < RIDGE_START) continue;
      let bestLat = RIDGE_HALF, bestK = -1;
      for (let k = 0; k < SECTORS; k++) {
        if (bx[k] * dx + by[k] * dy <= 0) continue;
        const lat = Math.abs(bx[k] * dy - by[k] * dx);
        if (lat < bestLat) { bestLat = lat; bestK = k; }
      }
      if (bestK >= 0) {
        band[i] = 1;
        bandK[i] = bestK;
        if (r < rMin[bestK]) rMin[bestK] = r;
        if (r > rMax[bestK]) rMax[bestK] = r;
      }
    }
  }
  return { order, sectorCode, sector, band, bandK, rad, rMin, rMax };
}

/** The ridge walls along the boundary bands, each broken by one pass (two on a long ridge); rng: the passes, per boundary. */
export function wedgeRidges(rng: Rng, s: WedgeSectors): Uint8Array {
  const { band, bandK, rad, rMin, rMax } = s;
  const ridge = new Uint8Array(N);
  {
    const passes: number[][] = [];
    for (let k = 0; k < SECTORS; k++) {
      const len = rMax[k] - rMin[k];
      const lo = rMin[k] + 0.25 * len, hi = rMax[k] - 0.25 * len;
      if (len > LONG_RIDGE) {
        const mid = (lo + hi) / 2;
        passes.push([randRange(rng, lo, mid - PASS_MIN_GAP / 2), randRange(rng, mid + PASS_MIN_GAP / 2, hi)]);
      } else {
        passes.push([randRange(rng, lo, hi)]);
      }
    }
    for (let i = 0; i < N; i++) {
      if (!band[i]) continue;
      ridge[i] = 1;
      for (const p of passes[bandK[i]]) if (Math.abs(rad[i] - p) < PASS_HALF) { ridge[i] = 0; break; }
    }
  }
  return ridge;
}
