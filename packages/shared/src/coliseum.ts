// The fixed layout every generated map shares: the border ring, the walled coliseum at the centre with its four gates,
// the lanes in front of the gates, the inner spawns, the pillar variants, the ring road around the footprint and the
// painted set (every tile a zone may own). The coliseum is fixed (ROGUELIKE_PLAN D2), so all of it is built once per
// process and only read afterwards; generateMap copies what a map hands out.
import { MAP_TILES_H, MAP_TILES_W, MAX_PLAYERS } from "./constants";
import { TWO_PI, detCos, detSin } from "./cover";
import { tileToWorldCenter } from "./map";
import type { GateDef, GateSide, TilePt, TileRect } from "./map";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
/** The corner shared by tiles CX-1 and CX; also the index of the centre tile. */
export const CX = W / 2;
export const CY = H / 2;

const COL_HALF = 9;
const COL_CHAMFER = 13;
const GATE_W = 4;
const LANE_DEPTH = 3;
/** The ring road: tiles within this Chebyshev distance of the footprint, outside it. */
export const RING_ROAD = 3;
const INNER_SPAWN_R = 5.5;

/**
 * The coliseum's pillar layouts: tiles of the 64x64 map (whose centre was (32, 32)), each copied by `turns` equal turns
 * about the centre (4: quarter turns, 2: half turns), twenty single-tile pillars in all, used as listed or transposed.
 * Found offline by searching sets of turn orbits that keep the arena clear where it must stay clear. With the gates
 * open, a sight line can run from outside through a gate and across the arena, so the lattice lanes through coliseum
 * floor, gate tiles and the first four tiles in front of each gate (ground the cover pass may not touch) must be cut
 * to the lane target by pillars alone. No set of four quarter-turn orbits does it; of the five-orbit sets only the first
 * layout below (and its transpose) does; the others are half-turn layouts found by annealing. Each keeps the longest of
 * those lanes at 437 to 470 u, the centre tile, the inner spawns' 3x3 and the lanes inside the gates clear, and the
 * sealed floor in one piece. On a bigger map they are shifted with the centre, and the sight lattice is anchored with
 * them (cover.ts LATTICE_ORIGIN), so they stay certified.
 */
const PILLAR_LAYOUTS: readonly { turns: number; gens: readonly (readonly [number, number])[] }[] = [
  { turns: 4, gens: [[27, 27], [28, 28], [29, 29], [31, 29], [32, 30]] },
  { turns: 2, gens: [[33, 30], [34, 30], [28, 28], [35, 28], [32, 31], [29, 29], [35, 29], [36, 27], [27, 27], [30, 30]] },
  { turns: 2, gens: [[28, 28], [27, 27], [35, 28], [32, 31], [34, 29], [31, 30], [29, 28], [33, 30], [30, 29], [36, 27]] },
  { turns: 2, gens: [[29, 29], [35, 28], [33, 30], [28, 28], [34, 29], [29, 30], [36, 27], [32, 31], [30, 31], [27, 27]] },
];

export interface FixedLayout {
  border: Uint8Array;
  /** The coliseum footprint, wall ring included. */
  fp: Uint8Array;
  /** Chebyshev distance to the footprint, capped: 0 on it, 255 beyond 6. */
  distFp: Uint8Array;
  ring: Uint8Array;
  wallRing: Uint8Array;
  coFloor: Uint8Array;
  coRect: TileRect;
  /** n, e, s, w. Shared: copy before handing out. */
  gates: readonly GateDef[];
  /** The strip inside each gate, gate wide and LANE_DEPTH deep: kept free of pillars. */
  laneIn: Uint8Array;
  /** The strip outside each gate, one tile wider on each side and LANE_DEPTH deep: always floor, never a rock. */
  laneOut: readonly TilePt[];
  innerTiles: readonly TilePt[];
  /** The 8 pillar variants (each layout as listed, then transposed), as masks. */
  pillars: readonly Uint8Array[];
  /** Every tile off the border and outside the footprint: what the zones share out. */
  painted: Int32Array;
  paintedMask: Uint8Array;
  ringTiles: Int32Array;
}

let FIXED: FixedLayout | null = null;

export function fixedLayout(): FixedLayout {
  if (FIXED) return FIXED;
  const border = new Uint8Array(N);
  for (let x = 0; x < W; x++) { border[x] = 1; border[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { border[y * W] = 1; border[y * W + W - 1] = 1; }

  const fp = new Uint8Array(N);
  let fx0 = W, fy0 = H, fx1 = -1, fy1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ax = Math.abs(x + 0.5 - CX), ay = Math.abs(y + 0.5 - CY);
      if (ax <= COL_HALF - 0.5 && ay <= COL_HALF - 0.5 && ax + ay <= COL_CHAMFER) {
        fp[y * W + x] = 1;
        fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x);
        fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y);
      }
    }
  }
  const coRect: TileRect = { x: fx0, y: fy0, w: fx1 - fx0 + 1, h: fy1 - fy0 + 1 };

  // Chebyshev distance to the footprint, capped at 6 (breadth-first over 8-neighbours).
  const distFp = new Uint8Array(N).fill(255);
  {
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) if (fp[i]) { distFp[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], d = distFp[i];
      if (d >= 6) continue;
      const x = i % W, y = (i - x) / W;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (distFp[j] === 255) { distFp[j] = d + 1; queue[tail++] = j; }
        }
      }
    }
  }
  const ring = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!fp[i] && distFp[i] <= RING_ROAD) ring[i] = 1;

  // The wall ring is every footprint tile with an 8-neighbour off the footprint; the rest is arena floor.
  const wallRing = new Uint8Array(N), coFloor = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!fp[y * W + x]) continue;
      let edge = false;
      for (let oy = -1; oy <= 1 && !edge; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !fp[ny * W + nx]) { edge = true; break; }
        }
      }
      if (edge) wallRing[y * W + x] = 1; else coFloor[y * W + x] = 1;
    }
  }

  const SIDES: readonly GateSide[] = ["n", "e", "s", "w"];
  const OUT: Record<GateSide, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const gates: GateDef[] = SIDES.map((side) => {
    const g0x = CX - GATE_W / 2, g0y = CY - GATE_W / 2;
    const tiles: TilePt[] = [];
    for (let j = 0; j < GATE_W; j++) {
      tiles.push(
        side === "n" ? { x: g0x + j, y: coRect.y } :
        side === "s" ? { x: g0x + j, y: coRect.y + coRect.h - 1 } :
        side === "w" ? { x: coRect.x, y: g0y + j } :
        { x: coRect.x + coRect.w - 1, y: g0y + j },
      );
    }
    let sx = 0, sy = 0;
    for (const t of tiles) { sx += tileToWorldCenter(t.x); sy += tileToWorldCenter(t.y); }
    return { side, tiles, x: sx / tiles.length, y: sy / tiles.length };
  });

  const laneIn = new Uint8Array(N);
  const laneOut: TilePt[] = [];
  for (const g of gates) {
    const [ox, oy] = OUT[g.side];
    const alongX = g.side === "n" || g.side === "s";
    const t0 = g.tiles[0];
    for (let d = 1; d <= LANE_DEPTH; d++) {
      for (let j = -1; j <= GATE_W; j++) {
        const ax = alongX ? j : 0, ay = alongX ? 0 : j;
        laneOut.push({ x: t0.x + ax + ox * d, y: t0.y + ay + oy * d });
        if (j >= 0 && j < GATE_W) laneIn[(t0.y + ay - oy * d) * W + t0.x + ax - ox * d] = 1;
      }
    }
  }

  // Inner spawns on a ring, each snapped to the tile it falls in.
  const innerTiles: TilePt[] = [];
  for (let j = 0; j < MAX_PLAYERS; j++) {
    const a = ((j + 0.5) * TWO_PI) / MAX_PLAYERS;
    innerTiles.push({ x: Math.floor(CX + INNER_SPAWN_R * detCos(a)), y: Math.floor(CY + INNER_SPAWN_R * detSin(a)) });
  }

  const shift = CX - 32;
  const rot = (p: TilePt): TilePt => ({ x: CX + CY - 1 - p.y, y: p.x - CX + CY });
  const pillars: Uint8Array[] = [];
  for (let variant = 0; variant < PILLAR_LAYOUTS.length * 2; variant++) {
    const mask = new Uint8Array(N);
    const transposed = (variant & 1) === 1;
    const { turns, gens } = PILLAR_LAYOUTS[variant >> 1];
    for (const [gx, gy] of gens) {
      let p: TilePt = transposed ? { x: gy + shift, y: gx + shift } : { x: gx + shift, y: gy + shift };
      for (let q = 0; q < turns; q++) {
        if (coFloor[p.y * W + p.x]) mask[p.y * W + p.x] = 1;
        for (let r = 0; r < 4 / turns; r++) p = rot(p);
      }
    }
    pillars.push(mask);
  }

  const paintedMask = new Uint8Array(N);
  const painted: number[] = [], ringTiles: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!border[i] && !fp[i]) { paintedMask[i] = 1; painted.push(i); }
    if (ring[i]) ringTiles.push(i);
  }

  FIXED = {
    border, fp, distFp, ring, wallRing, coFloor, coRect, gates, laneIn, laneOut, innerTiles, pillars,
    painted: Int32Array.from(painted), paintedMask, ringTiles: Int32Array.from(ringTiles),
  };
  return FIXED;
}
