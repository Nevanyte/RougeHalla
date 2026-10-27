// Warren (plague): a sewer swamp. Two bored tunnels (3 wide, rock banks with side openings), organic rock blobs from noise and
// cellular passes, five fungus clumps and bog pools of 9-40 tiles. Plague wants open chambers for its bow, so this is a
// swamp with two bores, not a tunnel maze. Plague is exempt from the bog (x0.7 for everyone else). Part D 4.3's recipe,
// scaled to the zone.
import { TILE_FLOOR, TILE_WALL } from "../map";
import { TERRAIN_BOG } from "../terrain";
import { randInt } from "../rng";
import { chance, DIR4, DIR8, pickOpen, pickTile, wall } from "./kit";
import { PROP } from "./propKinds";
import { sizeScale } from "./scale";
import type { PropCtx, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";

export interface WarrenPlan {
  /** Each tunnel's centre line (tile indices in walking order). */
  tunnels: number[][];
  /** Bank walls the styler wrote. */
  bank: number[];
  /** Fungus clump walls the styler wrote. */
  fungus: number[];
  /** The bog pools painted (tile indices), filled in by the surface pass. */
  pools: number[][];
}

/** Rock blobs: the share of the ZONE the noise starts from before the cellular passes (the banks and fungus add about 3.5% more). */
const ROCK_ZONE_SHARE = 0.03;
/** Bog: the share of the zone the noise starts from, before pools under 9 tiles are dropped and big ones trimmed (about 70% survives). */
const BOG_ZONE_SHARE = 0.105;

const FOUR: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function shape(c: ShapeCtx): WarrenPlan {
  const r = c.rng;
  const w = c.w;
  const sc = sizeScale(c.zone.painted);
  const plan: WarrenPlan = { tunnels: [], bank: [], fungus: [], pools: [] };
  // 1. tunnels: two drunkard's-walk corridors between chamber nodes, banked by rock on both sides (a 3-wide bore, one or two
  //    tiles of rock each side, a 2-tile side opening every 7-9 steps)
  const nodeGap = Math.max(9, Math.floor(14 * sc)), pairMax = Math.max(18, Math.floor(34 * sc));
  const nodes: Array<[number, number]> = [];
  for (let k = 0; k < 4; k++) {
    const g = pickTile(c, 200, (x, y) => c.edgeDist[y * w + x] >= 15 && nodes.every(([nx, ny]) => Math.abs(nx - x) + Math.abs(ny - y) > nodeGap));
    if (g) nodes.push(g);
  }
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < nodes.length && pairs.length < 2; a++) {
    for (let b = a + 1; b < nodes.length && pairs.length < 2; b++) {
      const d = Math.abs(nodes[a][0] - nodes[b][0]) + Math.abs(nodes[a][1] - nodes[b][1]);
      if (d >= nodeGap && d <= pairMax && !pairs.some(([p, q]) => p === a || q === a || p === b || q === b)) pairs.push([a, b]);
    }
  }
  const inBore = new Uint8Array(c.w * c.h);
  const bankSeen = new Uint8Array(c.w * c.h);
  for (const [a, b] of pairs) {
    const path: Array<[number, number]> = [];
    let [x, y] = nodes[a];
    const [tx, ty] = nodes[b];
    let last = -1;
    for (let st = 0; st < 300 && Math.abs(tx - x) + Math.abs(ty - y) > 1; st++) {
      const dx = tx - x, dy = ty - y;
      let dir: number;
      const roll = r();
      if (last >= 0 && roll < 0.65) dir = last;
      else if (roll < 0.9) dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
      else dir = randInt(r, 0, 4);
      const [mx, my] = FOUR[dir];
      const ni = c.at(x + mx, y + my);
      if (ni < 0 || !c.mask[ni]) { last = -1; continue; }
      x += mx; y += my; last = dir;
      path.push([x, y]);
    }
    plan.tunnels.push(path.map(([px, py]) => py * w + px));
    for (const [px, py] of path) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = c.at(px + dx, py + dy); if (j >= 0) inBore[j] = 1; }
    // door windows: 2 steps every 7-9
    const door = new Uint8Array(path.length);
    for (let k = randInt(r, 3, 6); k < path.length; k += randInt(r, 7, 10)) { door[k] = 1; if (k + 1 < path.length) door[k + 1] = 1; }
    const bank: Array<[number, number, number]> = []; // [pathIndex, x, y]
    path.forEach(([px, py], k) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
          const j = c.at(px + dx, py + dy);
          if (j < 0 || inBore[j] || bankSeen[j]) continue;
          bankSeen[j] = 1;
          if (door[k] || !c.mask[j]) continue;
          bank.push([k, px + dx, py + dy]);
          // a second layer on about 40% of the bank
          if (chance(r, 0.4)) bank.push([k, px + dx + (dx === 2 ? 1 : dx === -2 ? -1 : 0), py + dy + (dy === 2 ? 1 : dy === -2 ? -1 : 0)]);
        }
      }
    });
    bank.sort((p, q) => p[0] - q[0] || p[2] - q[2] || p[1] - q[1]);
    for (const [, bx, by] of bank) {
      const j = c.at(bx, by);
      if (j >= 0 && !inBore[j] && wall(c, bx, by)) plan.bank.push(j);
    }
  }
  // 2. organic rock blobs: the top share of a smooth noise over the open ground, two cellular-automaton passes where a tile
  //    turns to rock with 4 or more rock neighbours (rocks already standing count), placed densest first
  const n = c.w * c.h;
  const dens = new Float64Array(n);
  const cand: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!c.open(i)) continue;
    const x = i % w, y = (i - x) / w;
    dens[i] = 0.65 * c.noise.value(x, y, 8, 1) + 0.35 * c.noise.value(x, y, 3.5, 2);
    cand.push(i);
  }
  if (cand.length > 0) {
    const sorted = cand.map((i) => dens[i]).sort((p, q) => p - q);
    const share = Math.min(0.6, (ROCK_ZONE_SHARE * c.zone.painted * 1.3) / cand.length);
    const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - share)))];
    let rock = new Uint8Array(n);
    for (const i of cand) rock[i] = dens[i] >= thr ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      const next = new Uint8Array(n);
      for (const i of cand) {
        const x = i % w, y = (i - x) / w;
        let cnt = 0;
        for (const [dx, dy] of DIR8) { const j = c.at(x + dx, y + dy); if (j >= 0 && (rock[j] || c.tiles[j] === TILE_WALL)) cnt++; }
        next[i] = cnt >= 5 || (rock[i] && cnt >= 3) ? 1 : 0;
      }
      rock = next;
    }
    const order = cand.filter((i) => rock[i]).sort((p, q) => dens[q] - dens[p] || p - q);
    let placed = 0;
    for (const i of order) {
      if (placed >= ROCK_ZONE_SHARE * c.zone.painted * 1.4) break;
      if (wall(c, i % w, (i - (i % w)) / w)) placed++;
    }
  }
  // 3. fungus clumps: WALL blobs of 2-4 tiles in the open ground
  for (let k = 0; k < 5; k++) {
    const s = pickOpen(c);
    if (!s) continue;
    let [x, y] = s;
    const len = randInt(r, 2, 5);
    for (let q = 0; q < len; q++) {
      if (wall(c, x, y)) plan.fungus.push(c.at(x, y));
      const [dx, dy] = DIR8[randInt(r, 0, 4) * 2];
      x += dx; y += dy;
    }
  }
  return plan;
}

/** Bog pools on open floor: the highest 15% of a smooth noise, components under 9 tiles dropped, big ones trimmed to the 40 tiles nearest their centroid. */
function surface(c: SurfaceCtx, plan: WarrenPlan): void {
  const w = c.w, n = c.w * c.h;
  const val = new Float64Array(n);
  const fl: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!c.canSurface(i, "bog")) continue;
    const x = i % w, y = (i - x) / w;
    val[i] = 0.85 * c.noise.value(x, y, 6.5, 7) + 0.15 * c.noise.value(x, y, 3, 8);
    fl.push(i);
  }
  if (fl.length === 0) return;
  const sorted = fl.map((i) => val[i]).sort((p, q) => p - q);
  const bogShare = Math.min(0.6, (BOG_ZONE_SHARE * c.zone.painted) / fl.length);
  const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - bogShare)))];
  const eligible = new Uint8Array(n);
  for (const i of fl) eligible[i] = val[i] >= thr ? 1 : 0;
  const components = (member: Uint8Array, from: readonly number[]): number[][] => {
    const out: number[][] = [];
    const mark = new Uint8Array(n);
    for (const i of from) {
      if (!member[i] || mark[i]) continue;
      const comp: number[] = [];
      const stack = [i];
      mark[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        comp.push(j);
        const x = j % w, y = (j - x) / w;
        for (const [dx, dy] of DIR4) {
          const k = c.at(x + dx, y + dy);
          if (k >= 0 && member[k] && !mark[k]) { mark[k] = 1; stack.push(k); }
        }
      }
      out.push(comp);
    }
    return out;
  };
  for (const comp of components(eligible, fl)) {
    if (comp.length < 9) continue;
    let cx = 0, cy = 0;
    for (const j of comp) { cx += j % w; cy += Math.floor(j / w); }
    cx /= comp.length; cy /= comp.length;
    const d2 = (j: number): number => ((j % w) - cx) * ((j % w) - cx) + (Math.floor(j / w) - cy) * (Math.floor(j / w) - cy);
    const kept = comp.slice().sort((p, q) => d2(p) - d2(q) || p - q).slice(0, 40);
    // trimming can split a pool: keep the pieces of 9 tiles or more
    const member = new Uint8Array(n);
    for (const j of kept) member[j] = 1;
    for (const piece of components(member, kept.slice().sort((p, q) => p - q))) {
      if (piece.length < 9) continue;
      const painted: number[] = [];
      for (const j of piece) if (c.surface(j, "bog")) painted.push(j);
      if (painted.length > 0) plan.pools.push(painted);
    }
  }
}

function props(c: PropCtx, plan: WarrenPlan): void {
  const n = c.w * c.h;
  const bank = new Uint8Array(n), fungus = new Uint8Array(n);
  for (const i of plan.bank) bank[i] = 1;
  for (const i of plan.fungus) fungus[i] = 1;
  for (let i = 0; i < n; i++) {
    if (!c.mask[i]) continue;
    const x = i % c.w, y = (i - x) / c.w;
    const v = Math.floor(c.noise.hash(x, y, 90) * 3);
    if (c.tiles[i] === TILE_WALL) {
      if (fungus[i]) c.prop(PROP.fungus_cap, x, y, v);
      else if (bank[i]) { const u = c.noise.hash(x, y, 1); if (u < 0.06) c.prop(PROP.drip, x, y, v); else if (u < 0.09) c.prop(PROP.pipe, x, y, v); }
    } else if (c.tiles[i] === TILE_FLOOR && c.terrain[i] === TERRAIN_BOG && c.noise.hash(x, y, 2) < 0.15) {
      c.prop(PROP.bubble, x, y, v);
    }
  }
}

export const warren: ZoneStyler<WarrenPlan> = { id: "warren", faction: "plague", version: 1, shape, surface, props };
