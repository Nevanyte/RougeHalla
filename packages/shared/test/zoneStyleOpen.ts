// Synthetic OPEN maps for the stylers, shaped like the zone generator's hook input: 96x96, a solid border, a coliseum disc in the
// middle, five organic zones around it of about 1700 tiles each (the contract's areaScale 1 at 1710 tiles), and per zone four camp
// clearings (9x9 with halo), three spawns (5x5) and three chests (3x3) as protected ground.
//  - `openFixture(seed)` is the plain one the stylers were first measured on (no camps, no pool members: nothing for a camp graph or a
//    route guard to read). Its output is pinned (mapPins OPEN_PINNED), so its geometry is part of the input: changing it moves every pin.
//  - `openFixtureFull(seed)` adds what the generator hands a styler besides the ground: the camps (two elite per zone, the two farthest
//    from the middle), the pool members (the spawn pads), their walk field to the coliseum centre and a feature log, so the shape
//    pass has camps to build craters around and corridors to keep dry, and the ownership of every wall can be checked.
// Test scaffolding only (it may use Math.sin; no recipe does).
import { walkField16 } from "../src/gridTopology";
import { hash2, vnoise } from "../src/zoneStyle/kit";
import { REGION_FACTIONS, TILE_WALL, mapFromTiles } from "../src/map";
import type { CampDef, GameMap, RegionFaction } from "../src/map";
import { TERRAIN_ICE } from "../src/terrain";
import type { ZoneStyleState } from "../src/zoneStyle";

export const OPEN_W = 96;

export interface OpenFixture {
  st: ZoneStyleState;
  w: number;
  h: number;
  /** The tiles before styling. */
  tiles0: Uint8Array;
}

export interface OpenFull extends OpenFixture {
  /** Pool members (tile indices), the spawn pads' centres. */
  members: number[];
  /** Camp centres (tile indices) in `st.camps` order. */
  campSites: number[];
  /** walkField16 to the coliseum centre over the tiles before styling (the pool pick's field). */
  centreWalk: Int32Array;
}

interface Placed { camps: Array<[number, number, number]>; spawns: Array<[number, number, number]> }

function build(seed: number, w: number, h: number): { st: ZoneStyleState; tiles0: Uint8Array; placed: Placed } {
  const n = w * h;
  const tiles = new Uint8Array(n);
  const zone = new Uint8Array(n);
  const protect = new Uint8Array(n);
  const cx = w / 2, cy = h / 2;
  const a0 = hash2(seed, 1, 1) * 6.2832;
  const seeds = REGION_FACTIONS.map((_, k) => {
    const a = a0 + (k * 6.2832) / 5 + (hash2(seed, k, 2) - 0.5) * 0.5;
    return [cx + 0.3 * w * Math.cos(a), cy + 0.3 * h * Math.sin(a)] as const;
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) { tiles[i] = TILE_WALL; protect[i] = 1; continue; }
      const d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
      if (d < 14) { protect[i] = 1; continue; }
      let best = 1e9, bk = 0;
      seeds.forEach(([sx, sy], k) => {
        const dd = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy)) + 7 * (vnoise(x, y, 10, 100 + k + seed * 7) - 0.5);
        if (dd < best) { best = dd; bk = k; }
      });
      zone[i] = bk + 1;
    }
  }
  // protected ground inside each zone: camps (9x9), spawns (5x5), chests (3x3), on tiles well inside the zone
  const stamp = (px: number, py: number, r: number): void => {
    for (let y = py - r; y <= py + r; y++) for (let x = px - r; x <= px + r; x++) if (x >= 0 && y >= 0 && x < w && y < h && zone[y * w + x]) protect[y * w + x] = 1;
  };
  const placed: Placed = { camps: [], spawns: [] };
  for (let k = 1; k <= 5; k++) {
    const want = [[4, 4], [3, 2], [3, 1]] as const; // [count, radius]
    const spots: Array<[number, number]> = [];
    for (const [count, r] of want) {
      for (let t = 0, got = 0; t < 600 && got < count; t++) {
        const x = 4 + Math.floor(hash2(seed * 131 + k, t * 7 + r, 3) * (w - 8)), y = 4 + Math.floor(hash2(seed * 131 + k, t * 7 + r, 4) * (h - 8));
        if (zone[y * w + x] !== k) continue;
        let inside = true;
        for (let dy = -r - 3; dy <= r + 3 && inside; dy++) for (let dx = -r - 3; dx <= r + 3; dx++) { const j = (y + dy) * w + x + dx; if (zone[j] !== k) { inside = false; break; } }
        if (!inside || spots.some(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) < 7 + r)) continue;
        spots.push([x, y]);
        stamp(x, y, r);
        if (r === 4) placed.camps.push([k, x, y]);
        if (r === 2) placed.spawns.push([k, x, y]);
        got++;
      }
    }
  }
  const st: ZoneStyleState = {
    w, h, seed, attempt: 0, tiles, terrain: new Uint8Array(n), props: [], zone, zoneFaction: REGION_FACTIONS, protect,
    territory: null, camps: [], keepLow: new Uint8Array(n),
  };
  return { st, tiles0: tiles.slice(), placed };
}

export function openFixture(seed: number, w = OPEN_W, h = OPEN_W): OpenFixture {
  const { st, tiles0 } = build(seed, w, h);
  return { st, w, h, tiles0 };
}

/** The open fixture with camps (clearing 2.5 tiles; the two camps of a zone farthest from the middle are elite), pool members, their walk field and a feature log. */
export function openFixtureFull(seed: number, w = OPEN_W, h = OPEN_W): OpenFull {
  const { st, tiles0, placed } = build(seed, w, h);
  const mid = (h >> 1) * w + (w >> 1);
  const far = (x: number, y: number): number => (x - w / 2) * (x - w / 2) + (y - h / 2) * (y - h / 2);
  const camps = placed.camps.map(([k, x, y], index) => {
    const same = placed.camps.filter(([kk]) => kk === k).sort((a, b) => far(b[1], b[2]) - far(a[1], a[2]) || 0);
    const elite = same.slice(0, 2).some((c) => c[1] === x && c[2] === y);
    return { site: y * w + x, r: 2.5, territory: index + 1, elite };
  });
  const members = placed.spawns.map(([, x, y]) => y * w + x);
  const centreWalk = walkField16(tiles0, w, h, [mid]);
  const full: ZoneStyleState = { ...st, camps, spawns: members, centreWalk, features: [], featureOwner: new Uint16Array(w * h) };
  return { st: full, w, h, tiles0, members, campSites: camps.map((c) => c.site), centreWalk };
}

/** A 32-bit FNV-1a of a zone's tiles and terrain (row-major, the zone's own tiles only). */
export function openZoneHash(f: OpenFixture, faction: RegionFaction): number {
  const zone = REGION_FACTIONS.indexOf(faction) + 1;
  const { st, w, h } = f;
  let hash = 0x811c9dc5;
  for (let i = 0; i < w * h; i++) {
    if (st.zone[i] !== zone) continue;
    hash = Math.imul(hash ^ st.tiles[i], 0x01000193) >>> 0;
    hash = Math.imul(hash ^ st.terrain[i], 0x01000193) >>> 0;
  }
  return hash;
}

/** The (seed, zone) pairs whose styled output is pinned (mapPins OPEN_PINNED): eight pairs, every zone at least once. */
export const OPEN_PIN_CASES: ReadonlyArray<readonly [number, RegionFaction]> = [
  [1, "fire"], [2, "fire"], [3, "sentenced"], [4, "sentenced"], [5, "plague"], [6, "plague"], [7, "frost"], [8, "holy"],
];

/**
 * The styled fixture as a GameMap the certifier can read: tiles, terrain, the zones as regions, and the feature log as `features` /
 * `featureGrid` (tile counts and boxes recomputed from the ownership, as the generator's `records()` does, which also puts the camps
 * in contract order, renumbers a crater's camp index to match and counts a mere's ICE). `featureOwner` and `features` come from the
 * state, so only a fixture that carries them (openFixtureFull) has any.
 */
export function openMap(f: OpenFixture): GameMap {
  const { st, w, h } = f;
  const m = mapFromTiles(w, h, st.tiles.slice(), st.seed, st.terrain.slice());
  m.regionGrid = st.zone.slice();
  m.props = st.props.slice();
  const owner = st.featureOwner, log = st.features;
  if (owner && log) {
    m.features = log.map((d) => ({ ...d, p: d.p.slice(), jobs: [...d.jobs], tiles: 0, bbox: { x: w, y: h, w: 0, h: 0 } }));
    const box = m.features.map(() => ({ x0: w, y0: h, x1: -1, y1: -1 }));
    for (let i = 0; i < w * h; i++) {
      const o = owner[i];
      if (o === 0 || o > m.features.length) continue;
      m.featureGrid[i] = o;
      const x = i % w, y = (i - x) / w, b = box[o - 1];
      m.features[o - 1].tiles++;
      b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
    }
    box.forEach((b, k) => { if (b.x1 >= 0) m.features[k].bbox = { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }; });
    // the camps in contract order (by zone, then the state's order) and the craters' camp index renumbered to it
    const zoneOf = (site: number): number => st.zone[site];
    const order = st.camps.map((_, i) => i).sort((a, b) => zoneOf(st.camps[a].site) - zoneOf(st.camps[b].site) || a - b);
    const renumber = new Int32Array(st.camps.length);
    const perZone = REGION_FACTIONS.map(() => 0);
    m.camps = order.map((ci, n) => {
      renumber[ci] = n;
      const c = st.camps[ci], z = zoneOf(c.site) - 1;
      const x = (c.site % w) * 32 + 16, y = Math.floor(c.site / w) * 32 + 16;
      return { id: `${REGION_FACTIONS[z]}-${++perZone[z]}`, zone: REGION_FACTIONS[z], x, y, r: c.r * 32, spots: [], eliteSpot: c.elite ? 0 : -1, chest: { x, y }, area: 0, radius: 0 } as CampDef;
    });
    const ice = m.features.map(() => 0);
    for (let i = 0; i < w * h; i++) if (m.featureGrid[i] !== 0 && m.terrain[i] === TERRAIN_ICE) ice[m.featureGrid[i] - 1]++;
    m.features.forEach((d, k) => {
      if (d.kind === "crater" && d.p.length > 0 && d.p[0] >= 0 && d.p[0] < st.camps.length) d.p[0] = renumber[d.p[0]];
      if (d.kind === "mere" && d.p.length > 1) d.p[1] = ice[k];
    });
  }
  return m;
}
