// Synthetic zone shapes for the client's art tests and its dev page (test/dev/zoneart.html): a real generated map (zones, camps,
// coliseum, pool; the plain generator, so no old styler's tiles) with every feature kind of zone-shapes contract 2.5-2.6 stamped on
// it by hand, using the frozen `p` layouts. It exists because the five zone stylers land in the same phase as the art; it follows
// their contract, not their output, and nothing here is certified: a feature may cut a zone in two, which no test of the art cares
// about. Floats are fine here (test code); the real stylers are integer-only.
//   fire      eight crater rims round the camps (breaches toward the nearest camps), a lava river with fords, two forges
//   sentenced fence rows along the zone's long axis with staggered gates, a gallows block, two guard houses
//   plague    barrows between the camps (four with tunnels), bog crescents, two burrows
//   frost     two meres with shores, a causeway, headlands and a spire, two watchtowers
//   holy      the hypostyle (3x3 piers at pitch 6 with aisles and light bays), two shrines
import {
  PROP_KINDS, REGION_FACTIONS, TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE, TILE_FLOOR, TILE_LOW,
  TILE_WALL, generateMap, mulberry32, regionCode,
  type GameMap, type MapFeature, type RegionFaction,
} from "@raid/shared";

export interface SynthOptions {
  seed?: number;
  /** Zones to dress (all five by default). */
  zones?: readonly RegionFaction[];
  /** The Gallows' rows run along this axis whatever side of the map the zone is on (the real ones follow the zone's long axis). */
  gallowsAxis?: "x" | "y";
}

/** The landmark templates of contract 5.2 (orientation 0). */
export const LANDMARK_ROWS: Readonly<Record<string, readonly string[]>> = {
  forge: ["###dd####", "#c......#", "#.......#", "#..###..#", "#..###..d", "#c......d", "#########"],
  guardHouse: ["###dd###", "#c....c#", "#......#", "#......#", "#......d", "#c.....d", "########"],
  burrow: ["__#####__", "_##...##_", "##c....##", "#.......#", "d.......d", "d.......d", "##....c##", "_##...##_", "__#####__"],
  watchtower: ["_##dd##_", "##....##", "#c.....#", "#......#", "#.....c#", "##....##", "_##dd##_"],
  shrine: ["#########", "#c.....c#", "#..lll..#", "#..lll..#", "#..lll..#", "##.....##", "###ddd###"],
};
const LANDMARK_JOBS: Readonly<Record<string, MapFeature["jobs"]>> = {
  forge: ["landmark", "lee"], guardHouse: ["landmark", "lee"], burrow: ["landmark", "fork"], watchtower: ["landmark", "lee"], shrine: ["landmark", "rest"],
};
const LANDMARK_OF: Readonly<Record<RegionFaction, string>> = { fire: "forge", sentenced: "guardHouse", plague: "burrow", frost: "watchtower", holy: "shrine" };

const propKind = (key: string): number => {
  const k = PROP_KINDS.findIndex((p) => p.key === key);
  if (k < 0) throw new Error(`no prop kind ${key}`);
  return k;
};

/** Builds the synthetic map. Deterministic in the seed. */
export function synthMap(opts: SynthOptions = {}): GameMap {
  const seed = opts.seed ?? 3;
  const base = generateMap(seed, undefined, { styleZones: null });
  const { w, h } = base;
  const tiles = base.tiles.slice();
  const terrain = new Uint8Array(w * h);
  const featureGrid = new Uint8Array(w * h);
  const features: MapFeature[] = [];
  const props: GameMap["props"] = [];
  const buildings: GameMap["buildings"] = base.buildings.map((b) => ({ ...b }));
  const rng = mulberry32(seed * 7919 + 13);
  const rint = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo));

  // What the features must keep off: camp clearings, pool pads, the coliseum, the border, and any tile that is not deep in its own zone.
  const protect = new Uint8Array(w * h);
  const stamp = (x: number, y: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < w && ty < h && dx * dx + dy * dy <= r * r + r) protect[ty * w + tx] = 1;
    }
  };
  for (const c of base.camps) stamp(Math.floor(c.x / TILE), Math.floor(c.y / TILE), 3);
  for (const p of base.spawnPool) stamp(Math.floor(p.x / TILE), Math.floor(p.y / TILE), 2);
  const co = base.coliseum.rect;
  for (let y = co.y - 4; y < co.y + co.h + 4; y++) for (let x = co.x - 4; x < co.x + co.w + 4; x++) if (x >= 0 && y >= 0 && x < w && y < h) protect[y * w + x] = 1;
  const inZone = (x: number, y: number, code: number): boolean => {
    if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) return false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (base.regionGrid[(y + dy) * w + x + dx] !== code) return false;
    return true;
  };

  const zones = opts.zones ?? REGION_FACTIONS;
  for (const zone of zones) {
    const code = regionCode(zone);
    const camps = base.camps.map((c, index) => ({ c, index })).filter(({ c }) => c.zone === zone);
    const own: number[] = [];
    for (let i = 0; i < w * h; i++) if (base.regionGrid[i] === code && base.tiles[i] === TILE_FLOOR) own.push(i);
    let sx = 0, sy = 0;
    for (const i of own) { sx += i % w; sy += Math.floor(i / w); }
    const cx = Math.round(sx / own.length), cy = Math.round(sy / own.length);
    const centre = { x: w / 2, y: h / 2 };
    const out = { x: cx - centre.x, y: cy - centre.y };

    const owned = new Uint8Array(w * h);
    const floorOwned: number[] = [];
    const wallsOwned: number[] = [];
    const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === TILE_FLOOR && protect[y * w + x] === 0 && owned[y * w + x] === 0 && inZone(x, y, code);
    const closeFeature = (f: Omit<MapFeature, "bbox" | "tiles"> & { bbox?: MapFeature["bbox"] }): MapFeature => {
      let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
      const id = features.length + 1;
      for (const i of [...wallsOwned, ...floorOwned]) {
        featureGrid[i] = id;
        const x = i % w, y = Math.floor(i / w);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); n++;
      }
      const done: MapFeature = { ...f, bbox: n > 0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { x: f.ax, y: f.ay, w: 0, h: 0 }, tiles: n };
      features.push(done);
      wallsOwned.length = 0; floorOwned.length = 0;
      return done;
    };
    const wall = (x: number, y: number, kind = 0): boolean => {
      if (!free(x, y)) return false;
      tiles[y * w + x] = TILE_WALL; terrain[y * w + x] = kind; owned[y * w + x] = 1; wallsOwned.push(y * w + x);
      return true;
    };
    const low = (x: number, y: number, kind: number): boolean => {
      if (!free(x, y)) return false;
      tiles[y * w + x] = TILE_LOW; terrain[y * w + x] = kind; owned[y * w + x] = 1; wallsOwned.push(y * w + x);
      return true;
    };
    const own1 = (x: number, y: number): void => { if (free(x, y)) { owned[y * w + x] = 1; floorOwned.push(y * w + x); } };
    const surface = (x: number, y: number, kind: number): void => { if (x >= 0 && y >= 0 && x < w && y < h && tiles[y * w + x] === TILE_FLOOR && terrain[y * w + x] === 0 && protect[y * w + x] === 0 && inZone(x, y, code)) terrain[y * w + x] = kind; };
    const prop = (key: string, tx: number, ty: number): void => {
      props.push({ kind: propKind(key), x: tx * TILE + TILE / 2 + (rng() - 0.5) * 8, y: ty * TILE + TILE / 2 + (rng() - 0.5) * 8, v: rint(0, 256) });
    };

    const landmarks = (count: number, where: (n: number) => { x: number; y: number }): void => {
      const rows = LANDMARK_ROWS[LANDMARK_OF[zone]]!;
      for (let n = 0; n < count; n++) {
        const at = where(n);
        for (let attempt = 0; attempt < 8 * 81; attempt++) {
          const rot = attempt % 4, mirror = (attempt >> 2) % 2;
          const th = rows.length, tw = rows[0]!.length;
          const cells: Array<{ x: number; y: number; ch: string }> = [];
          for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
            const ch = rows[y]![x]!;
            if (ch === "_") continue;
            const mx = mirror ? tw - 1 - x : x;
            const [dx, dy] = rot === 0 ? [mx, y] : rot === 1 ? [th - 1 - y, mx] : rot === 2 ? [tw - 1 - mx, th - 1 - y] : [y, tw - 1 - mx];
            cells.push({ x: dx, y: dy, ch });
          }
          const bw = rot % 2 ? th : tw, bh = rot % 2 ? tw : th;
          // Candidate origins spiral out from the wanted centre in steps of two tiles.
          const ring = Math.floor(attempt / 8), k = ring % 9;
          const x0 = at.x - Math.floor(bw / 2) + ((k % 3) - 1) * 2 * Math.ceil((ring + 1) / 3), y0 = at.y - Math.floor(bh / 2) + (Math.floor(k / 3) - 1) * 2 * Math.ceil((ring + 1) / 3);
          if (!cells.every((c) => free(x0 + c.x, y0 + c.y))) continue;
          // A gap round the box: keep other landmarks and features off.
          let clear = true;
          for (let y = y0 - 2; y < y0 + bh + 2 && clear; y++) for (let x = x0 - 2; x < x0 + bw + 2; x++) if (x >= 0 && y >= 0 && x < w && y < h && owned[y * w + x]) { clear = false; break; }
          if (!clear) continue;
          const doors: number[] = [];
          for (const c of cells) {
            const x = x0 + c.x, y = y0 + c.y;
            if (c.ch === "#") wall(x, y);
            else { own1(x, y); if (c.ch === "d") doors.push(y * w + x); if (c.ch === "l") surface(x, y, TERRAIN_LIGHT); }
          }
          doors.sort((a, b) => a - b);
          const variant = LANDMARK_OF[zone];
          buildings.push({ x: x0, y: y0, w: bw, h: bh });
          closeFeature({ kind: "landmark", variant, zone, jobs: [...LANDMARK_JOBS[variant]!], ax: x0, ay: y0, p: [rot, mirror, ...doors] });
          if (zone === "fire") { prop("anvil", x0 + Math.floor(bw / 2), y0 + 2); prop("slag_heap", x0 + 2, y0 + bh - 2); }
          if (zone === "sentenced") prop("stocks", x0 + Math.floor(bw / 2), y0 + 2);
          if (zone === "plague") prop("burrow_rubble", x0 + Math.floor(bw / 2), y0 + Math.floor(bh / 2));
          if (zone === "holy") { prop("altar", x0 + Math.floor(bw / 2), y0 + 5); prop("brazier", x0 + 2, y0 + 4); prop("brazier", x0 + bw - 3, y0 + 4); }
          break;
        }
      }
    };
    const wallProps = (key: string, every: number, list: readonly number[]): void => {
      for (const i of list) if (rng() * every < 1) prop(key, i % w, Math.floor(i / w));
    };
    const floorProps = (keys: readonly string[], count: number): void => {
      for (let n = 0; n < count; n++) {
        const i = own[rint(0, own.length)]!;
        const x = i % w, y = Math.floor(i / w);
        if (tiles[i] === TILE_FLOOR && protect[i] === 0 && inZone(x, y, code)) prop(keys[rint(0, keys.length)]!, x, y);
      }
    };

    if (zone === "fire") {
      landmarks(2, (n) => ({ x: cx + (n === 0 ? -9 : 9), y: cy + (n === 0 ? 5 : -5) }));
      for (const { c, index } of camps) {
        const ccx = Math.floor(c.x / TILE), ccy = Math.floor(c.y / TILE);
        const near = Math.min(...camps.filter((o) => o.c !== c).map((o) => Math.hypot(o.c.x - c.x, o.c.y - c.y) / TILE));
        const elite = c.eliteSpot >= 0;
        const R = Math.min(elite ? 7.5 : 6.5, Math.max(5, near / 2 - 0.8));
        const dirs: number[] = [];
        const others = camps.filter((o) => o.c !== c).sort((a, b) => Math.hypot(a.c.x - c.x, a.c.y - c.y) - Math.hypot(b.c.x - c.x, b.c.y - c.y));
        const beams: Array<[number, number]> = [];
        for (const o of others.slice(0, 3)) {
          const dx = o.c.x - c.x, dy = o.c.y - c.y, d = Math.hypot(dx, dy);
          const dir = Math.round(Math.atan2(dy, dx) / (Math.PI / 8) + 16) % 16;
          if (dirs.some((k) => Math.min((k - dir + 16) % 16, (dir - k + 16) % 16) < 3)) continue;
          dirs.push(dir);
          beams.push([dx / d, dy / d]);
        }
        const rim: number[] = [];
        for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
          const d = Math.hypot(dx, dy);
          const jit = (Math.sin(dx * 1.7 + dy * 0.9 + index) + Math.cos(dx * 0.6 - dy * 1.3)) * 0.35;
          const onRim = d >= R + jit - 0.5 && d < R + jit + 0.5;
          const second = d >= R + jit + 0.5 && d < R + jit + 1.3 && Math.sin(dx * 2.3 + dy * 1.1) > 0.45;
          if (!onRim && !second) continue;
          const inBeam = beams.some(([ux, uy]) => dx * ux + dy * uy > 0 && Math.abs(dx * uy - dy * ux) <= 2.6);
          if (!inBeam) rim.push((ccy + dy) * w + ccx + dx);
        }
        rim.sort((a, b) => Math.atan2(Math.floor(a / w) - ccy, (a % w) - ccx) - Math.atan2(Math.floor(b / w) - ccy, (b % w) - ccx));
        const placed: number[] = [];
        for (const i of rim) if (wall(i % w, Math.floor(i / w))) placed.push(i);
        if (placed.length < rim.length * 0.5) { // not enough of it fits: leave the camp open
          for (const i of placed) { tiles[i] = TILE_FLOOR; terrain[i] = 0; owned[i] = 0; }
          wallsOwned.length = 0;
          continue;
        }
        for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) if (Math.hypot(dx, dy) < R - 0.5) own1(ccx + dx, ccy + dy);
        closeFeature({ kind: "crater", variant: "", zone, jobs: ["pen"], ax: ccx, ay: ccy, p: [index, Math.floor(R * 4), dirs.length, ...dirs] });
        wallProps("crater_lip", 5, placed);
      }
      // The lava river: a wobbling line across the zone, 2-3 wide, with fords of four steps.
      const west = own.filter((i) => inZone(i % w, Math.floor(i / w), code)).sort((a, b) => (a % w) - (b % w));
      if (west.length > 100) {
        const a = west[0]!, b = west[west.length - 1]!;
        let px = a % w, py = Math.floor(a / w);
        const tx = b % w, ty = Math.floor(b / w);
        const riverTiles: number[] = [];
        const fords: number[] = [];
        let step = 0;
        while ((Math.abs(tx - px) > 1 || Math.abs(ty - py) > 1) && step < 400) {
          const dx = Math.sign(tx - px), dy = Math.sign(ty - py);
          const wob = Math.round(Math.sin(step * 0.31) * 1.4);
          if (step % 3 === 2) py += dy; else px += dx;
          const cyy = py + wob, cxx = px;
          const isFord = step % 22 >= 9 && step % 22 < 13;
          if (isFord) { if (step % 22 === 11) fords.push(cyy * w + cxx); }
          else for (let k = 0; k < 2 + (step % 7 === 0 ? 1 : 0); k++) riverTiles.push((cyy + k) * w + cxx);
          step++;
        }
        let n = 0;
        for (const i of riverTiles) if (low(i % w, Math.floor(i / w), TERRAIN_LAVA)) n++;
        if (n > 20) {
          for (const i of riverTiles) {
            const x = i % w, y = Math.floor(i / w);
            if (tiles[i] !== TILE_LOW) continue;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) surface(x + dx, y + dy, TERRAIN_EMBER);
          }
          closeFeature({ kind: "lavaRiver", variant: "", zone, jobs: ["crossing"], ax: a % w, ay: Math.floor(a / w), p: [2, fords.length, ...fords] });
        }
      }
      floorProps(["ember_vent", "ash_drift"], 14);
      wallProps("glow_crack", 12, (() => { const l: number[] = []; for (const i of own) if (tiles[i] === TILE_WALL) l.push(i); return l; })());
    } else if (zone === "sentenced") {
      landmarks(2, (n) => ({ x: cx + (n === 0 ? -10 : 10), y: cy + (n === 0 ? 8 : -8) }));
      const alongX = opts.gallowsAxis ? opts.gallowsAxis === "x" : Math.abs(out.x) >= Math.abs(out.y);
      const lo = alongX ? Math.min(...own.map((i) => Math.floor(i / w))) : Math.min(...own.map((i) => i % w));
      const hi = alongX ? Math.max(...own.map((i) => Math.floor(i / w))) : Math.max(...own.map((i) => i % w));
      let rowIndex = 0;
      for (let t = lo + 5; t < hi - 4; t += 8) {
        const run: number[] = [];
        const phase = rowIndex % 2 === 0 ? 2 : 8;
        const first = alongX ? own.filter((i) => Math.floor(i / w) === t).reduce((m, i) => Math.min(m, i % w), w) : own.filter((i) => i % w === t).reduce((m, i) => Math.min(m, Math.floor(i / w)), h);
        for (let s = 0; s < 70; s++) {
          const x = alongX ? first + s : t, y = alongX ? t : first + s;
          if (((s - phase) % 12 + 12) % 12 < 3) continue;
          if (low(x, y, TERRAIN_FENCE)) run.push(y * w + x);
        }
        if (run.length >= 10) {
          closeFeature({ kind: "fenceRow", variant: "", zone, jobs: ["lane"], ax: alongX ? first : t, ay: alongX ? t : first, p: [alongX ? 0 : 1, rowIndex, phase] });
          // Gate posts: the fence tile on each side of a gap, and a lantern beside it.
          for (const i of run) {
            const x = i % w, y = Math.floor(i / w);
            const nx = alongX ? [x - 1, x + 1] : [x, x], ny = alongX ? [y, y] : [y - 1, y + 1];
            const edge = [0, 1].some((k) => tiles[ny[k]! * w + nx[k]!] === TILE_FLOOR && owned[ny[k]! * w + nx[k]!] === 0);
            if (edge) prop("gate_post", x, y);
          }
          rowIndex++;
        }
      }
      // The gallows: a 3x3 block, and the guard houses.
      for (let k = 0; k < 30; k++) {
        const gx = cx - 1 + (k % 5) - 2, gy = cy - 1 + Math.floor(k / 5) - 3;
        let okAll = true;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (!free(gx + dx, gy + dy)) okAll = false;
        if (!okAll) continue;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) wall(gx + dx, gy + dy);
        closeFeature({ kind: "gallows", variant: "", zone, jobs: ["landmark"], ax: gx, ay: gy, p: [] });
        prop("gallows", gx + 1, gy + 1);
        break;
      }
      floorProps(["lantern"], 10);
    } else if (zone === "plague") {
      landmarks(2, (n) => ({ x: cx + (n === 0 ? -8 : 8), y: cy + (n === 0 ? -9 : 9) }));
      const edges: Array<[number, number, number]> = [];
      for (let a = 0; a < camps.length; a++) for (let b = a + 1; b < camps.length; b++) {
        const d = Math.hypot(camps[a]!.c.x - camps[b]!.c.x, camps[a]!.c.y - camps[b]!.c.y) / TILE;
        if (d >= 15 && d <= 34) edges.push([a, b, d]);
      }
      edges.sort((p, q) => q[2] - p[2]);
      let tunnels = 0;
      for (const [a, b, d] of edges.slice(0, 14)) {
        const ca = camps[a]!.c, cb = camps[b]!.c;
        const mx = Math.round((ca.x + cb.x) / 2 / TILE), my = Math.round((ca.y + cb.y) / 2 / TILE);
        const ux = (cb.x - ca.x) / TILE / d, uy = (cb.y - ca.y) / TILE / d;
        const R = Math.min(4.6, Math.max(2.6, 0.2 * d));
        const tunnel = tunnels < 4 && R >= 3.4;
        let okDisc = 0, total = 0;
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (Math.hypot(dx, dy) <= R) { total++; if (free(mx + dx, my + dy)) okDisc++; }
        if (okDisc < total * 0.8) continue;
        const wet = rng() < 0.5 ? 1 : -1;
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
          const dd = Math.hypot(dx, dy);
          const across = dx * -uy + dy * ux;
          if (dd <= R + (Math.sin(dx * 1.9 + dy * 0.8) * 0.4)) {
            if (tunnel && Math.abs(across) < 1.5) own1(mx + dx, my + dy);
            else wall(mx + dx, my + dy);
          } else if (dd >= R + 0.8 && dd <= R + 4.5 && across * wet >= 1 && Math.abs(dx * ux + dy * uy) <= R + 1.5) own1(mx + dx, my + dy);
        }
        const dir = Math.round(Math.atan2(uy, ux) / (Math.PI / 8) + 16) % 16;
        const ownedWalls = [...wallsOwned];
        const mouths: number[] = [];
        if (tunnel) {
          tunnels++;
          for (const i of ownedWalls) {
            const x = i % w, y = Math.floor(i / w);
            const nbr = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => tiles[ny! * w + nx!] === TILE_FLOOR && owned[ny! * w + nx!] === 1 && Math.hypot(nx! - mx, ny! - my) < R + 0.5);
            if (nbr) mouths.push(i);
          }
        }
        const flank = floorOwned.filter((i) => Math.hypot((i % w) - mx, Math.floor(i / w) - my) > R + 0.5);
        for (const i of flank) surface(i % w, Math.floor(i / w), TERRAIN_BOG);
        closeFeature({ kind: "barrow", variant: "", zone, jobs: tunnel ? ["fork", "choke"] : ["fork"], ax: mx, ay: my, p: [Math.floor(R * 4), tunnel ? 1 : 0, dir, wet] });
        wallProps("fungus_cap", 3, ownedWalls);
        wallProps("drip", 4, ownedWalls);
        for (const i of mouths) if (rng() < 0.5) prop("tunnel_beam", i % w, Math.floor(i / w));
        for (const i of flank) if (rng() < 0.12) prop("reed", i % w, Math.floor(i / w));
      }
      floorProps(["bubble"], 12);
    } else if (zone === "frost") {
      landmarks(2, (n) => ({ x: cx + (n === 0 ? -2 : 3), y: cy + (n === 0 ? 17 : -17) }));
      const seeds: Array<[number, number]> = [[cx - 10, cy - 8], [cx + 12, cy + 9]];
      let lakeIndex = 0;
      for (const [lx, ly] of seeds) {
        const lake: number[] = [];
        for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
          const d = Math.hypot(dx / 1.25, dy);
          if (d < 8.5 + Math.sin(dx * 0.7 + dy * 0.5 + lakeIndex) * 1.6 && free(lx + dx, ly + dy)) lake.push((ly + dy) * w + lx + dx);
        }
        if (lake.length < 60) { lakeIndex++; continue; }
        const set = new Set(lake);
        // A causeway: a one-tile row of packed snow across the middle.
        const causeway = lake.filter((i) => Math.floor(i / w) === ly);
        let iceCount = 0;
        for (const i of lake) own1(i % w, Math.floor(i / w));
        for (const i of lake) {
          const x = i % w, y = Math.floor(i / w);
          const shore = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => !set.has(ny! * w + nx!));
          if (!shore && Math.floor(i / w) !== ly) { terrain[i] = TERRAIN_ICE; iceCount++; }
        }
        // A headland or three on the shore, a spire in the middle.
        const headlands: number[][] = [];
        for (let hIdx = 0; hIdx < 3; hIdx++) {
          const angle = (hIdx / 3) * Math.PI * 2 + lakeIndex;
          const hx = Math.round(lx + Math.cos(angle) * 11), hy = Math.round(ly + Math.sin(angle) * 9);
          const cells: number[] = [];
          for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) * 1.4 <= 3 && free(hx + dx, hy + dy) && terrain[(hy + dy) * w + hx + dx] === 0) cells.push((hy + dy) * w + hx + dx);
          headlands.push(cells);
        }
        closeFeature({ kind: "mere", variant: "", zone, jobs: ["crossing"], ax: lx, ay: ly, p: [lakeIndex, iceCount] });
        if (causeway.length > 3) {
          for (const i of causeway) { terrain[i] = 0; floorOwned.push(i); }
          closeFeature({ kind: "causeway", variant: "", zone, jobs: ["crossing"], ax: causeway[0]! % w, ay: ly, p: [] });
        }
        headlands.forEach((cells, hIdx) => {
          for (const i of cells) wall(i % w, Math.floor(i / w));
          if (wallsOwned.length >= 6) closeFeature({ kind: "headland", variant: "", zone, jobs: ["lee"], ax: lx, ay: ly, p: [(hIdx * 5 + 3) % 16] });
          else { for (const i of wallsOwned) { tiles[i] = TILE_FLOOR; owned[i] = 0; } wallsOwned.length = 0; }
        });
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) wall(lx + dx + 2, ly + dy + 3);
        if (wallsOwned.length >= 6) {
          const spireWalls = [...wallsOwned];
          closeFeature({ kind: "spire", variant: "", zone, jobs: ["landmark"], ax: lx + 2, ay: ly + 3, p: [] });
          prop("ice_spire", lx + 2, ly + 3);
          void spireWalls;
        } else { for (const i of wallsOwned) { tiles[i] = TILE_FLOOR; owned[i] = 0; } wallsOwned.length = 0; }
        lakeIndex++;
      }
      floorProps(["snow_drift", "frost_sparkle", "ice_crack"], 24);
    } else {
      // The hypostyle: piers 3x3 at pitch 6, aisles of three between them, light in the middle bays.
      const R = 19;
      let hx = cx, hy = cy;
      for (let tries = 0; tries < 60; tries++) {
        const ox = cx + ((tries % 7) - 3) * 2, oy = cy + (Math.floor(tries / 7) - 3) * 2;
        if (free(ox, oy) && free(ox + 8, oy + 8) && free(ox - 8, oy - 8)) { hx = ox; hy = oy; break; }
      }
      const piers: number[][] = [];
      for (let j = -4; j <= 3; j++) for (let i = -4; i <= 3; i++) {
        const u0 = 2 + 6 * i, v0 = 2 + 6 * j;
        if ((u0 + 1) ** 2 + (v0 + 1) ** 2 > R * R) continue;
        const cells: number[] = [];
        let all = true;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) { if (!free(hx + u0 + dx, hy + v0 + dy)) all = false; cells.push((hy + v0 + dy) * w + hx + u0 + dx); }
        if (all) piers.push(cells);
      }
      const walls: number[] = [];
      for (const cells of piers) for (const i of cells) { wall(i % w, Math.floor(i / w)); walls.push(i); }
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) own1(hx + dx, hy + dy);
      let bays = 0;
      for (const [a, b] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
        const bx = hx + 6 * a, by = hy + 6 * b;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) surface(bx + dx, by + dy, TERRAIN_LIGHT);
        bays++;
        prop("candelabra", bx, by);
      }
      if (piers.length >= 4) {
        closeFeature({ kind: "hall", variant: "", zone, jobs: ["cover", "rest"], ax: hx, ay: hy, p: [0, 6, R, piers.length, bays] });
        for (const cells of piers) prop("column_cap", cells[4]! % w, Math.floor(cells[4]! / w));
      } else { wallsOwned.length = 0; floorOwned.length = 0; }
      landmarks(2, (n) => ({ x: hx + (n === 0 ? -R - 6 : R + 6), y: hy }));
      floorProps(["stained_glass", "rubble"], 14);
      wallProps("banner_red", 4, walls);
    }
  }

  return {
    ...base, tiles, terrain, props, buildings, features, featureGrid,
  };
}
