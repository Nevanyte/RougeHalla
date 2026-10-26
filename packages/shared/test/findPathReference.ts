// Test reference: src/pathfind.ts without its two optimisations (the O(1) unreachable-goal reject through moveComponents,
// and the PULL_WINDOW cap on string pulling). Everything else is a verbatim copy, so equal output on a map proves both
// optimisations change nothing there. Keep it in step with findPath.
import { PLAYER_RADIUS, TILE } from "../src/constants";
import { circleClear, segmentClear } from "../src/geometry";
import { isSolidTile, TILE_FLOOR, tileToWorldCenter, worldToTile } from "../src/map";
import type { GameMap } from "../src/map";
import type { Vec2 } from "../src/messages";

const SQRT2 = Math.SQRT2;
const isFloor = (map: GameMap, tx: number, ty: number): boolean =>
  tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.tiles[ty * map.w + tx] === TILE_FLOOR;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** Farthest BFS ring searched when snapping a wall endpoint onto floor. */
const SNAP_RADIUS = 4;

interface Scratch {
  n: number;
  g: Float64Array;
  parent: Int32Array;
  closed: Uint8Array;
  heapNode: Int32Array;
  heapF: Float64Array;
  heapG: Float64Array;
  len: number;
}

let scratch: Scratch | null = null;

function getScratch(n: number): Scratch {
  if (!scratch || scratch.n !== n) {
    // Lazy deletion: a node is pushed once per improving relaxation, at most 8 per node.
    const cap = n * 8 + 16;
    scratch = {
      n,
      g: new Float64Array(n),
      parent: new Int32Array(n),
      closed: new Uint8Array(n),
      heapNode: new Int32Array(cap),
      heapF: new Float64Array(cap),
      heapG: new Float64Array(cap),
      len: 0,
    };
  }
  scratch.g.fill(Infinity);
  scratch.closed.fill(0);
  scratch.len = 0;
  return scratch;
}

/** Lower f first; on ties prefer the deeper node (larger g), then the lower index. */
function before(f1: number, g1: number, n1: number, f2: number, g2: number, n2: number): boolean {
  if (Math.abs(f1 - f2) > 1e-9) return f1 < f2;
  if (g1 !== g2) return g1 > g2;
  return n1 < n2;
}

function heapPush(s: Scratch, node: number, f: number, g: number): void {
  let i = s.len++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!before(f, g, node, s.heapF[p], s.heapG[p], s.heapNode[p])) break;
    s.heapNode[i] = s.heapNode[p];
    s.heapF[i] = s.heapF[p];
    s.heapG[i] = s.heapG[p];
    i = p;
  }
  s.heapNode[i] = node;
  s.heapF[i] = f;
  s.heapG[i] = g;
}

function heapPop(s: Scratch): number {
  const top = s.heapNode[0];
  const last = --s.len;
  if (last > 0) {
    const node = s.heapNode[last];
    const f = s.heapF[last];
    const g = s.heapG[last];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= last) break;
      if (c + 1 < last && before(s.heapF[c + 1], s.heapG[c + 1], s.heapNode[c + 1], s.heapF[c], s.heapG[c], s.heapNode[c])) c++;
      if (!before(s.heapF[c], s.heapG[c], s.heapNode[c], f, g, node)) break;
      s.heapNode[i] = s.heapNode[c];
      s.heapF[i] = s.heapF[c];
      s.heapG[i] = s.heapG[c];
      i = c;
    }
    s.heapNode[i] = node;
    s.heapF[i] = f;
    s.heapG[i] = g;
  }
  return top;
}

function octile(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/** Tile indices from start to goal inclusive, or null when the goal is unreachable. */
function astar(map: GameMap, start: number, goal: number): number[] | null {
  const { w, h, tiles } = map;
  const s = getScratch(w * h);
  const gx = goal % w;
  const gy = (goal - gx) / w;
  s.g[start] = 0;
  s.parent[start] = -1;
  heapPush(s, start, octile(start % w, (start / w) | 0, gx, gy), 0);

  while (s.len > 0) {
    const node = heapPop(s);
    if (s.closed[node]) continue;
    s.closed[node] = 1;
    if (node === goal) {
      const path: number[] = [];
      for (let n = node; n !== -1; n = s.parent[n]) path.push(n);
      return path.reverse();
    }
    const x = node % w;
    const y = (node - x) / w;
    const g = s.g[node];
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (tiles[ni] !== TILE_FLOOR || s.closed[ni]) continue;
      const diagonal = d >= 4;
      // No corner cutting: a diagonal step needs both orthogonal neighbours open.
      if (diagonal && (tiles[y * w + nx] !== TILE_FLOOR || tiles[ny * w + x] !== TILE_FLOOR)) continue;
      const ng = g + (diagonal ? SQRT2 : 1);
      if (ng < s.g[ni]) {
        s.g[ni] = ng;
        s.parent[ni] = node;
        heapPush(s, ni, ng + octile(nx, ny, gx, gy), ng);
      }
    }
  }
  return null;
}

/** Nearest floor tile to the world point within SNAP_RADIUS BFS steps (4-neighbour rings), or null. */
function snapToFloor(map: GameMap, x: number, y: number): { tx: number; ty: number } | null {
  const cx = worldToTile(x);
  const cy = worldToTile(y);
  for (let ring = 1; ring <= SNAP_RADIUS; ring++) {
    let best: { tx: number; ty: number } | null = null;
    let bestD = Infinity;
    for (let dy = -ring; dy <= ring; dy++) {
      const rest = ring - Math.abs(dy);
      for (const dx of rest === 0 ? [0] : [-rest, rest]) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (!isFloor(map, tx, ty)) continue;
        const d = (tileToWorldCenter(tx) - x) ** 2 + (tileToWorldCenter(ty) - y) ** 2;
        if (d < bestD) { bestD = d; best = { tx, ty }; }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Pulls `p`, which lies in floor tile (gx, gy), just far enough from its solid neighbours (walls, LOW) that a disc of
 * `radius` fits: each orthogonal solid neighbour clamps that axis to the tile's inner band. A disc that still
 * touches a diagonal corner falls back to the tile centre, which is always clear while
 * radius <= TILE / 2. A target that already fits is returned as is.
 */
function clampClear(map: GameMap, p: Vec2, gx: number, gy: number, radius: number): Vec2 {
  if (circleClear(map, p, radius)) return p;
  const x0 = gx * TILE;
  const y0 = gy * TILE;
  let x = p.x;
  let y = p.y;
  if (isSolidTile(map, gx - 1, gy)) x = Math.max(x, x0 + radius);
  if (isSolidTile(map, gx + 1, gy)) x = Math.min(x, x0 + TILE - radius);
  if (isSolidTile(map, gx, gy - 1)) y = Math.max(y, y0 + radius);
  if (isSolidTile(map, gx, gy + 1)) y = Math.min(y, y0 + TILE - radius);
  const clamped = { x, y };
  return circleClear(map, clamped, radius) ? clamped : { x: tileToWorldCenter(gx), y: tileToWorldCenter(gy) };
}

/**
 * Waypoints (world space, excluding `from`) that walk a disc of `radius` from `from` to `to`.
 * `to` inside a wall snaps to the nearest floor tile within 4 steps; unreachable or unsnappable
 * targets return []. The final waypoint is `to` itself when a disc of `radius` fits there, otherwise
 * the nearest in-tile point where it does (see clampClear), so the walker never ends overlapping a wall.
 * Wall clearance is only guaranteed for radius <= TILE / 2.
 */
export function findPathReference(map: GameMap, from: Vec2, to: Vec2, radius: number = PLAYER_RADIUS): Vec2[] {
  if (!Number.isFinite(from.x + from.y + to.x + to.y)) return [];

  let sx = worldToTile(from.x);
  let sy = worldToTile(from.y);
  const startInWall = !isFloor(map, sx, sy);
  if (startInWall) {
    const snap = snapToFloor(map, from.x, from.y);
    if (!snap) return [];
    sx = snap.tx;
    sy = snap.ty;
  }

  let gx = worldToTile(to.x);
  let gy = worldToTile(to.y);
  let target: Vec2 = to;
  const goalInWall = !isFloor(map, gx, gy);
  if (goalInWall) {
    const snap = snapToFloor(map, to.x, to.y);
    if (!snap) return [];
    gx = snap.tx;
    gy = snap.ty;
    target = { x: tileToWorldCenter(gx), y: tileToWorldCenter(gy) };
  }

  if (!goalInWall) target = clampClear(map, to, gx, gy, radius);

  // Within one tile the valid centres are not convex (a diagonal wall corner bites a disc out of
  // them), so even the same-tile shortcut needs the swept check.
  if (!startInWall && segmentClear(map, from, target, radius)) return [target];

  const tilePath = astar(map, sy * map.w + sx, gy * map.w + gx);
  if (!tilePath) return [];

  // Candidate waypoints: start tile centre (so an off-centre start never has to cut a corner), the
  // interior tile centres, the goal tile centre, then the exact target.
  const cand: Vec2[] = [];
  const center = (i: number): Vec2 => ({ x: tileToWorldCenter(i % map.w), y: tileToWorldCenter(Math.floor(i / map.w)) });
  // (A one-tile route has the start centre as its goal centre, pushed below.)
  if (tilePath.length > 1 && (startInWall || Math.abs(from.x - tileToWorldCenter(sx)) > 0.5 || Math.abs(from.y - tileToWorldCenter(sy)) > 0.5)) {
    cand.push(center(tilePath[0]));
  }
  for (let i = 1; i < tilePath.length - 1; i++) cand.push(center(tilePath[i]));
  const goalCenter = center(tilePath[tilePath.length - 1]);
  cand.push(goalCenter);
  if (target.x !== goalCenter.x || target.y !== goalCenter.y) cand.push(target);

  // String pulling: from each anchor jump to the farthest candidate with a clear swept segment. The
  // immediate successor is always accepted; consecutive tile centres are clear by construction.
  const out: Vec2[] = [];
  let anchor: Vec2 = from;
  let i = 0;
  while (i < cand.length) {
    let j = cand.length - 1;
    while (j > i && !segmentClear(map, anchor, cand[j], radius)) j--;
    out.push(cand[j]);
    anchor = cand[j];
    i = j + 1;
  }
  return out;
}
