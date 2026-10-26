// An independent certifier for generated maps: every guarantee of the map contract (map.ts) and the R2 gates
// (ROGUELIKE_PLAN R2), checked from the GameMap alone with checkers written apart from the generator (ports of the R1
// certifier and of the wedge-era mapgen tests). It never reads the generator's bookkeeping: the contract's numbers are
// written out here. Movement and sight go through the masks of map.ts: walkable is `(tile & MASK_MOVE) === 0` (TILE_LOW
// blocks it), see-through is `(tile & MASK_SIGHT) === 0` (TILE_LOW lets sight through).
import { MAX_PLAYERS, MAX_SIGHT_CORRIDOR, RANGED_HIT_REACH, TILE } from "../src/constants";
import { raycast } from "../src/geometry";
import {
  MASK_MOVE, MASK_SIGHT, REGION_COLISEUM, REGION_FACTIONS, REGION_NONE, REGION_WEAPONS, TILE_FLOOR, TILE_LOW, TILE_WALL, isWallTile, tileToWorldCenter,
  withGates, worldToTile,
} from "../src/map";
import type { GameMap, GateSide, TilePt, TileRect } from "../src/map";
import type { Vec2 } from "../src/messages";
import { styleRng } from "../src/mapgen";
import type { ZoneStyleHook } from "../src/mapgen";
import { findPath } from "../src/pathfind";
import { randInt } from "../src/rng";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TERRAIN_NONE, validateTerrain,
} from "../src/terrain";

// ---- The contract's numbers (not read from the generator) ----
export const MAP_SIZE = 96;
/** The certifying lattice: 48 directions, lines a quarter tile apart, anchored at the coliseum centre less (32, 32). */
export const LATTICE = { dirs: 48, step: 0.25, target: MAX_SIGHT_CORRIDOR / TILE - 0.02 };
export const LATTICE_ANCHOR = MAP_SIZE / 2 - 32;
const LANE_EPS = 1e-9;
/** Float slack so a corridor of exactly the bound, summed from tile crossings, never reads as a hair over. */
export const LANE_SLACK_U = 1e-6;
export const ZONE_COUNT = 5;
export const AREA_SPREAD_MAX = 8;
export const FLOOR_SHARE_MAX = 1.15;
export const RING_CONTACT_MIN = 24;
export const SLIVER_MAX = 100;
export const CAMPS_PER_ZONE = 4;
export const CAMP_GAP_TILES = 9;
export const TERRITORY_RADIUS_TILES = 30;
export const SPAWN_SEP_TILES = 5;
export const SPAWN_CAMP_TILES = 5;
export const POOL_MIN = 24;
export const POOL_MAX = 32;
export const POOL_ZONES = 4;
export const WALK_BAND = 0.08;
const FAN_RAYS = 801;

export interface MapStats {
  lane: number;
  sealedLane: number;
  painted: number[];
  floor: number[];
  contact: number[];
  slivers: number[];
  radius: number[];
  leashShare: number[];
  pool: number;
  poolZones: number;
  walkRatio57: number;
  pairsNear: number;
  rocks: number;
  wallRun: number;
}

/**
 * Runs every per-map check; returns the failures (empty when the map certifies) and the measured numbers. `styled`
 * maps (zone stylers ran) skip the rule that outdoor walls are small rock blobs: a styler's structures may be long.
 */
export function certifyMap(m: GameMap, opts: { styled?: boolean } = {}): { failures: string[]; stats: MapStats } {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, why?: () => string): void => {
    if (!ok) failures.push(`${name}${why ? `: ${why()}` : ""}`);
  };
  const W = m.w, H = m.h, N = W * H;
  const move = (t: Uint8Array, i: number): boolean => (t[i] & MASK_MOVE) === 0;
  const locked = withGates(m);
  const centre = worldToTile(m.coliseum.centre.y) * W + worldToTile(m.coliseum.centre.x);
  const tIdx = (p: Vec2): number => worldToTile(p.y) * W + worldToTile(p.x);
  const isTileCentre = (p: Vec2): boolean => p.x === tileToWorldCenter(worldToTile(p.x)) && p.y === tileToWorldCenter(worldToTile(p.y));
  const codes = REGION_FACTIONS.map((_, z) => z + 1);
  const isZone = (c: number): boolean => c >= 1 && c <= ZONE_COUNT;

  // --- Grid ----------------------------------------------------------------------------------------------------------
  let gridBad = "";
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i - x) / W, b = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (m.tiles[i] !== TILE_FLOOR && m.tiles[i] !== TILE_WALL && m.tiles[i] !== TILE_LOW) gridBad = `tile value ${m.tiles[i]} at ${x},${y}`;
    else if (b && (m.tiles[i] !== TILE_WALL || m.regionGrid[i] !== REGION_NONE)) gridBad = `border ${x},${y}`;
    else if (!b && m.regionGrid[i] === REGION_NONE) gridBad = `no region at ${x},${y}`;
    else if (m.regionGrid[i] > REGION_COLISEUM) gridBad = `region code ${m.regionGrid[i]}`;
  }
  check("grid: 96x96, tiles 0/1/2, border wall and none, every other tile in a zone or the coliseum", m.w === MAP_SIZE && m.h === MAP_SIZE && gridBad === "", () => gridBad);
  check("grid: territoryGrid and regionGrid are w*h Uint8Arrays", m.territoryGrid instanceof Uint8Array && m.territoryGrid.length === N && m.regionGrid.length === N);

  // --- Connectivity ----------------------------------------------------------------------------------------------------
  const open = components(W, H, (i) => move(m.tiles, i));
  check("connectivity: all walkable floor is one 4-connected component, gates open", open.count === 1, () => `${open.count} components`);
  const lc = components(W, H, (i) => move(locked.tiles, i));
  let escaped = false, stranded = false;
  for (let i = 0; i < N; i++) {
    if (lc.label[i] === lc.label[centre] && m.regionGrid[i] !== REGION_COLISEUM) escaped = true;
    if (move(locked.tiles, i) && m.regionGrid[i] === REGION_COLISEUM && lc.label[i] !== lc.label[centre]) stranded = true;
  }
  check("connectivity: gates closed, the arena is sealed and in one piece, and the rest is one component", move(locked.tiles, centre) && !escaped && !stranded && lc.count === 2, () => `escaped ${escaped}, stranded ${stranded}, ${lc.count} components`);

  // --- Gates and the coliseum ------------------------------------------------------------------------------------------
  const OUT: Record<GateSide, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const gateSet = new Set(m.coliseum.gates.flatMap((g) => g.tiles.map((t) => t.y * W + t.x)));
  let gatesOK = m.coliseum.gates.map((g) => g.side).join("") === "nesw" && gateSet.size === 16;
  for (const g of m.coliseum.gates) {
    const horizontal = g.side === "n" || g.side === "s";
    const along = g.tiles.map((t) => (horizontal ? t.x : t.y));
    if (g.tiles.length !== 4 || new Set(g.tiles.map((t) => (horizontal ? t.y : t.x))).size !== 1) gatesOK = false;
    along.forEach((v, i) => { if (v !== along[0] + i) gatesOK = false; });
    for (const t of g.tiles) if (m.tiles[t.y * W + t.x] !== TILE_FLOOR || locked.tiles[t.y * W + t.x] !== TILE_WALL || m.regionGrid[t.y * W + t.x] !== REGION_COLISEUM) gatesOK = false;
    if (Math.abs(g.x - g.tiles.reduce((a, t) => a + tileToWorldCenter(t.x), 0) / 4) > 1e-9) gatesOK = false;
    if (Math.abs(g.y - g.tiles.reduce((a, t) => a + tileToWorldCenter(t.y), 0) / 4) > 1e-9) gatesOK = false;
  }
  check("gates: four straight 4-wide gates n, e, s, w, open, walled by withGates and nothing else", gatesOK && m.tiles.every((v, i) => gateSet.has(i) || locked.tiles[i] === v));
  let links = "";
  for (let i = 0; i < N; i++) {
    if (!move(m.tiles, i) || m.regionGrid[i] !== REGION_COLISEUM) continue;
    for (const d of [1, -1, W, -W]) if (move(m.tiles, i + d) && m.regionGrid[i + d] !== REGION_COLISEUM && !gateSet.has(i)) links = `${i % W},${Math.floor(i / W)}`;
  }
  check("gates: the only links between the arena floor and the rest", links === "", () => `arena tile ${links} touches outside floor`);
  let lanes = "";
  for (const g of m.coliseum.gates) {
    const [ox, oy] = OUT[g.side];
    for (const t of g.tiles) for (let k = -3; k <= 3; k++) if (k !== 0 && !move(m.tiles, (t.y + oy * k) * W + t.x + ox * k)) lanes = `${g.side} ${k}`;
    const first = g.tiles[0], last = g.tiles[3], ux = Math.sign(last.x - first.x), uy = Math.sign(last.y - first.y);
    for (const [e, dir] of [[first, -1], [last, 1]] as const) for (let k = 1; k <= 3; k++) if (!move(m.tiles, (e.y + oy * k + uy * dir) * W + e.x + ox * k + ux * dir)) lanes = `${g.side} outer ${k}`;
  }
  check("gates: a clear floor lane 3 deep in front of and behind every gate, one wider outside", lanes === "", () => lanes);
  const rc = m.coliseum.rect;
  let rectOK = 2 * rc.x + rc.w === W && 2 * rc.y + rc.h === H, sym = true, ringLeak = false;
  const isColi = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && m.regionGrid[y * W + x] === REGION_COLISEUM;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = isColi(x, y);
      if (c && (x < rc.x || y < rc.y || x >= rc.x + rc.w || y >= rc.y + rc.h)) rectOK = false;
      if (c !== isColi(W - 1 - x, y) || c !== isColi(x, H - 1 - y) || c !== isColi(y, x)) sym = false;
      if (!c) continue;
      let edge = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isColi(x + dx, y + dy)) edge = true;
      if (edge && m.tiles[y * W + x] !== TILE_WALL && !gateSet.has(y * W + x)) ringLeak = true;
    }
  }
  check("coliseum: centred footprint inside its rect, symmetric, walled all round except the gates", rectOK && sym && !ringLeak, () => `rect ${rectOK} sym ${sym} leak ${ringLeak}`);
  const cTile = { x: worldToTile(m.coliseum.centre.x), y: worldToTile(m.coliseum.centre.y) };
  const fromCentre = components(W, H, (i) => move(locked.tiles, i)).label;
  let innerOK = isTileCentre(m.coliseum.centre) && [W / 2 - 1, W / 2].includes(cTile.x) && [H / 2 - 1, H / 2].includes(cTile.y) && m.coliseum.innerSpawns.length >= MAX_PLAYERS;
  const keepClear = new Set<number>([centre]);
  for (const p of m.coliseum.innerSpawns) {
    const t = { x: worldToTile(p.x), y: worldToTile(p.y) };
    if (!isTileCentre(p) || !isColi(t.x, t.y) || fromCentre[t.y * W + t.x] !== fromCentre[centre]) innerOK = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { keepClear.add((t.y + dy) * W + t.x + dx); if (!move(locked.tiles, (t.y + dy) * W + t.x + dx)) innerOK = false; }
  }
  for (const g of m.coliseum.gates) { const [ox, oy] = OUT[g.side]; for (const t of g.tiles) for (let k = 1; k <= 3; k++) keepClear.add((t.y - oy * k) * W + t.x - ox * k); }
  let pillars = 0, pillarBad = false;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (m.tiles[y * W + x] !== TILE_WALL) continue;
      let inner = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isColi(x + dx, y + dy)) inner = false;
      if (!inner) continue;
      pillars++;
      if (keepClear.has(y * W + x)) pillarBad = true;
    }
  }
  check("coliseum: centre tile floor, MAX_PLAYERS inner spawns with a clear 3x3 reachable sealed, pillars present and off the centre, inner spawns and gate lanes", innerOK && pillars > 0 && !pillarBad, () => `inner ${innerOK} pillars ${pillars} misplaced ${pillarBad}`);

  // --- Sight: lattice lanes (open and sealed); the exact strip and disc checks are separate (costly) --------------------
  const sightOpen = new Uint8Array(N), sealedOpen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    sightOpen[i] = (m.tiles[i] & MASK_SIGHT) === 0 && m.regionGrid[i] !== REGION_NONE ? 1 : 0;
    sealedOpen[i] = (locked.tiles[i] & MASK_SIGHT) === 0 && m.regionGrid[i] === REGION_COLISEUM ? 1 : 0;
  }
  const lane = fatLane(sightOpen, W, H, LATTICE.dirs, LATTICE.step, LATTICE_ANCHOR, LATTICE_ANCHOR);
  const sealedLane = fatLane(sealedOpen, W, H, LATTICE.dirs, LATTICE.step, LATTICE_ANCHOR, LATTICE_ANCHOR);
  check("sight: every lattice lane (48 dirs, 1/4-tile lines, anchored at the coliseum) <= 14.98 tiles, gates open", lane * TILE <= LATTICE.target * TILE + LANE_SLACK_U, () => `${(lane * TILE).toFixed(1)} u`);
  check("sight: the same inside the coliseum with the gates closed", sealedLane * TILE <= LATTICE.target * TILE + LANE_SLACK_U, () => `${(sealedLane * TILE).toFixed(1)} u`);

  // --- Zones -------------------------------------------------------------------------------------------------------------
  const painted = codes.map((c) => { let k = 0; for (let i = 0; i < N; i++) if (m.regionGrid[i] === c) k++; return k; });
  const floor = codes.map((c) => { let k = 0; for (let i = 0; i < N; i++) if (m.regionGrid[i] === c && move(m.tiles, i)) k++; return k; });
  check("zones: five, each one 4-connected painted piece", codes.every((c) => painted[c - 1] > 0 && components(W, H, (i) => m.regionGrid[i] === c).count === 1));
  check("zones: painted areas within 8 tiles of each other", Math.max(...painted) - Math.min(...painted) <= AREA_SPREAD_MAX, () => painted.join("/"));
  check("zones: walkable floor share max/min <= 1.15", Math.max(...floor) <= FLOOR_SHARE_MAX * Math.min(...floor), () => floor.join("/"));
  const fpd = new Uint8Array(N).fill(255);
  for (let i = 0; i < N; i++) {
    if (m.regionGrid[i] !== REGION_COLISEUM) continue;
    const x = i % W, y = (i - x) / W;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const j = (y + dy) * W + x + dx; fpd[j] = Math.min(fpd[j], Math.max(Math.abs(dx), Math.abs(dy))); }
  }
  const contact = codes.map((c) => { let k = 0; for (let i = 0; i < N; i++) if (m.regionGrid[i] === c && fpd[i] >= 1 && fpd[i] <= 3) k++; return k; });
  check(`zones: ring-road contact >= ${RING_CONTACT_MIN} tiles each`, Math.min(...contact) >= RING_CONTACT_MIN, () => contact.join("/"));
  const slivers = codes.map((c) => sliverTiles(m, c));
  check(`zones: sliver tiles <= ${SLIVER_MAX} per zone`, Math.max(...slivers) <= SLIVER_MAX, () => slivers.join("/"));
  let ringRoad = "";
  {
    const ring = (i: number): boolean => fpd[i] >= 1 && fpd[i] <= 3;
    const rcmp = components(W, H, (i) => ring(i) && move(m.tiles, i));
    const reached = new Set<number>();
    for (let i = 0; i < N; i++) if (ring(i) && move(m.tiles, i)) reached.add(m.regionGrid[i]);
    if (rcmp.count !== 1) ringRoad = `${rcmp.count} pieces`;
    else if (codes.some((c) => !reached.has(c))) ringRoad = "a zone has no ring-road floor";
  }
  check("zones: the ring road's floor is one piece touching all five zones", ringRoad === "", () => ringRoad);

  // --- Camps and territories -------------------------------------------------------------------------------------------
  const camps = m.camps;
  const perZone = REGION_FACTIONS.map((f) => camps.filter((c) => c.zone === f));
  check("camps: 4 per zone, exactly one elite camp per zone", perZone.every((cs) => cs.length === CAMPS_PER_ZONE && cs.filter((c) => c.eliteSpot >= 0).length === 1), () => perZone.map((cs) => cs.length).join("/"));
  check("camps: ids in zone order, then index from 1", JSON.stringify(camps.map((c) => c.id)) === JSON.stringify(perZone.flatMap((cs, z) => cs.map((_, k) => `${REGION_FACTIONS[z]}-${k + 1}`))) && camps.every((c, i) => i === 0 || REGION_FACTIONS.indexOf(c.zone) >= REGION_FACTIONS.indexOf(camps[i - 1].zone)));
  let spacing = Infinity;
  for (let i = 0; i < camps.length; i++) for (let j = i + 1; j < camps.length; j++) spacing = Math.min(spacing, dist(camps[i], camps[j]));
  check("camps: centres at least 9 tiles apart, map-wide", spacing >= CAMP_GAP_TILES * TILE - 1e-9, () => `${(spacing / TILE).toFixed(2)} tiles`);
  let partition = "";
  for (let i = 0; i < N; i++) {
    const c = m.regionGrid[i], T = m.territoryGrid[i];
    if (isZone(c)) { if (!T || T > camps.length || camps[T - 1].zone !== REGION_FACTIONS[c - 1]) partition = `${i % W},${Math.floor(i / W)}`; }
    else if (T) partition = `${i % W},${Math.floor(i / W)} outside the zones`;
  }
  check("territories: partition every painted tile of each zone (1 + camp index, same zone), 0 elsewhere", partition === "", () => partition);
  const radius: number[] = [], leashShare: number[] = [];
  camps.forEach((c, ci) => {
    const T = ci + 1, cx = worldToTile(c.x), cy = worldToTile(c.y);
    const clearing: number[] = [], halo = new Set<number>();
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx * TILE, dy * TILE) <= c.r + 1e-9) clearing.push((cy + dy) * W + cx + dx);
    for (const t of clearing) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) halo.add(t + dy * W + dx);
    const spotT = c.spots.map(tIdx), chestT = tIdx(c.chest), inClear = new Set(clearing);
    check(`camps: ${c.id} on a tile centre, clearing 2.5 tiles, chest at the centre`, isTileCentre(c) && c.r === 2.5 * TILE && chestT === cy * W + cx && isTileCentre(c.chest));
    check(`camps: ${c.id} clearing grown by one tile all floor in its territory, off the ring road`, [...halo].every((i) => move(m.tiles, i) && m.territoryGrid[i] === T && fpd[i] >= 4));
    check(`camps: ${c.id} 3-5 distinct tile-centre spots in the clearing, never the chest`, spotT.length >= 3 && spotT.length <= 5 && new Set(spotT).size === spotT.length && spotT.every((i) => inClear.has(i) && i !== chestT) && c.spots.every(isTileCentre));
    const nearest = Math.min(...c.spots.map((s) => dist(s, c)));
    check(`camps: ${c.id} eliteSpot is -1, or 0 on the elite camp: the spot nearest the centre`, c.eliteSpot === -1 || (c.eliteSpot === 0 && dist(c.spots[0], c) <= nearest + 1e-9));
    const tf = components(W, H, (i) => move(m.tiles, i) && m.territoryGrid[i] === T);
    check(`territories: ${c.id} walkable floor is one 4-connected piece`, tf.count === 1, () => `${tf.count} pieces`);
    let area = 0, far = 0, near = 0;
    for (let i = 0; i < N; i++) {
      if (m.territoryGrid[i] !== T || !move(m.tiles, i)) continue;
      area++;
      const d = Math.hypot((i % W) - cx, Math.floor(i / W) - cy);
      far = Math.max(far, d);
      if (d <= 12) near++;
    }
    check(`camps: ${c.id} area and radius match its territory's floor`, area === c.area && Math.abs(far * TILE - c.radius) < 1e-6, () => `${area} vs ${c.area}, ${far * TILE} vs ${c.radius}`);
    check(`territories: ${c.id} reaches at most ${TERRITORY_RADIUS_TILES} tiles from its camp`, far <= TERRITORY_RADIUS_TILES + 1e-9, () => `${far.toFixed(2)} tiles`);
    radius.push(far);
    leashShare.push(near / area);
  });
  for (const f of REGION_FACTIONS) {
    const zc = camps.filter((c) => c.zone === f), elite = zc.find((c) => c.eliteSpot >= 0);
    if (elite) check(`camps: ${f} elite camp is the zone's camp farthest from the centre`, zc.every((c) => dist(elite, m.coliseum.centre) >= dist(c, m.coliseum.centre) - 1e-9));
  }

  // --- Spawn pool --------------------------------------------------------------------------------------------------------
  const pool = m.spawnPool;
  const zonesIn = new Set(pool.map((s) => s.zone));
  check("spawns: pool of 24-32 in 4+ zones", pool.length >= POOL_MIN && pool.length <= POOL_MAX && zonesIn.size >= POOL_ZONES, () => `${pool.length} in ${zonesIn.size}`);
  let poolTile = "";
  for (const s of pool) {
    const x = worldToTile(s.x), y = worldToTile(s.y);
    if (!isTileCentre(s)) poolTile = "not a tile centre";
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!move(m.tiles, (y + dy) * W + x + dx)) poolTile = `3x3 at ${x},${y}`;
    if (REGION_FACTIONS[m.regionGrid[y * W + x] - 1] !== s.zone) poolTile = `zone tag at ${x},${y}`;
    if (m.buildings.some((b) => inRect(b, x, y))) poolTile = `in a ruin at ${x},${y}`;
  }
  check("spawns: tile centres with a clear 3x3 of floor, outside ruins, tagged with their tile's zone", poolTile === "", () => poolTile);
  let sepMin = Infinity, campMin = Infinity;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) sepMin = Math.min(sepMin, dist(pool[i], pool[j]));
    for (const c of camps) campMin = Math.min(campMin, dist(pool[i], c));
  }
  check("spawns: 5+ tiles apart, pool-wide", sepMin >= SPAWN_SEP_TILES * TILE - 1e-9, () => `${(sepMin / TILE).toFixed(2)}`);
  check("spawns: 5+ tiles from every camp centre", campMin >= SPAWN_CAMP_TILES * TILE - 1e-9, () => `${(campMin / TILE).toFixed(2)}`);
  const offenders: string[] = [];
  let pairsNear = 0;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (dist(pool[i], pool[j]) > MAX_SIGHT_CORRIDOR) continue;
      pairsNear++;
      for (const [a, b] of [[pool[i], pool[j]], [pool[j], pool[i]]] as const) {
        const fan = hittableAim(m, a, b, RANGED_HIT_REACH), exact = firstOpenSlope(m, a, b, RANGED_HIT_REACH);
        if (fan !== null || exact !== null) offenders.push(`${a.x},${a.y} -> ${b.x},${b.y} (fan ${fan?.toFixed(3)}, exact ${exact?.toFixed(3)})`);
      }
    }
  }
  check("spawns: no member can shoot another within 480 u, both ways (raycast fan and exact cone)", offenders.length === 0, () => offenders.slice(0, 3).join("; "));
  const w57 = walk57(m, centre);
  const walks = pool.map((s) => w57[tIdx(s)]);
  const walkRatio57 = Math.max(...walks) / Math.min(...walks);
  check("spawns: all within 8% of one walking distance to the centre (BFS 5/7, after cover)", walks.every((v) => v > 0 && v < 1 << 29) && walkRatio57 <= (1 + WALK_BAND) / (1 - WALK_BAND) + 1e-12, () => walkRatio57.toFixed(4));

  // --- Views and records --------------------------------------------------------------------------------------------------
  check("regions: five in REGION_FACTIONS order", JSON.stringify(m.regions.map((r) => r.id)) === JSON.stringify(REGION_FACTIONS));
  let views = "";
  m.regions.forEach((r, z) => {
    const mc = camps.filter((c) => c.zone === r.id).map((c) => ({ id: c.id, region: r.id, x: c.x, y: c.y, r: c.r, spots: c.spots, elite: c.eliteSpot >= 0, weapon: REGION_WEAPONS[r.id] }));
    if (JSON.stringify(r.mobCamps) !== JSON.stringify(mc)) views = `${r.id} mobCamps`;
    if (JSON.stringify(r.spawns) !== JSON.stringify(pool.filter((s) => s.zone === r.id).map((s) => ({ x: s.x, y: s.y })))) views = `${r.id} spawns`;
    if (r.area !== painted[z]) views = `${r.id} area ${r.area} vs ${painted[z]}`;
    const pt = tIdx(r.pole);
    if (!isTileCentre(r.pole) || !move(m.tiles, pt) || m.regionGrid[pt] !== z + 1 || m.buildings.some((b) => inRect(b, pt % W, Math.floor(pt / W)))) views = `${r.id} pole`;
  });
  const interleaved: Vec2[] = [];
  for (let n = 0; interleaved.length < pool.length; n++) for (const r of m.regions) if (r.spawns[n]) interleaved.push(r.spawns[n]);
  if (JSON.stringify(m.spawns) !== JSON.stringify(interleaved)) views = "spawns not interleaved by zone";
  if (JSON.stringify(m.crateSpots) !== JSON.stringify(m.regions.flatMap((r) => r.chestSpots))) views = "crateSpots";
  check("views: mobCamps, region spawns, spawns, crateSpots derive from camps and the pool; area is painted; pole is outdoor floor in the zone", views === "", () => views);

  // --- Crates, ground spots, ruins, outdoor walls -----------------------------------------------------------------------
  const allSpots = camps.flatMap((c) => c.spots.map(tIdx));
  const chebT = (a: number, b: number): number => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));
  let crates = "";
  const seenCrates = new Set<number>();
  for (const r of m.regions) {
    if (r.chestSpots.length < 3 || r.chestSpots.length > 4) crates = `${r.id}: ${r.chestSpots.length}`;
    r.chestSpots.forEach((p, i) => {
      const t = tIdx(p), x = t % W, y = Math.floor(t / W);
      if (!isTileCentre(p) || !move(m.tiles, t) || REGION_FACTIONS[m.regionGrid[t] - 1] !== r.id || fpd[t] <= 3 || x < 2 || y < 2 || x > W - 3 || y > H - 3) crates = `${r.id} crate ${x},${y} placement`;
      if (!(isWallTile(m, x - 1, y) || isWallTile(m, x + 1, y) || isWallTile(m, x, y - 1) || isWallTile(m, x, y + 1))) crates = `${r.id} crate ${x},${y} not against a wall`;
      if (pool.some((s) => chebT(tIdx(s), t) < 3) || allSpots.some((s) => chebT(s, t) < 2) || camps.some((c) => chebT(tIdx(c), t) < 3)) crates = `${r.id} crate ${x},${y} too near a spawn, spot or camp`;
      if (seenCrates.has(t)) crates = "duplicate";
      seenCrates.add(t);
      for (let j = 0; j < i; j++) if (chebT(tIdx(r.chestSpots[j]), t) < 2) crates = `${r.id} crates touch`;
    });
  }
  check("crates: 3-4 per zone, floor against a wall, in the zone, off the ring road and the border ring, apart from spawns, spots, camps and each other", crates === "", () => crates);
  const clearingSet = new Set<number>();
  for (const c of camps) { const cx = worldToTile(c.x), cy = worldToTile(c.y); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 6.25) clearingSet.add((cy + dy) * W + cx + dx); }
  let ground = m.groundSpots.length >= 20 && m.groundSpots.length <= 30 ? "" : `${m.groundSpots.length} spots`;
  if (new Set(m.groundSpots.map(tIdx)).size !== m.groundSpots.length) ground = "duplicates";
  for (const p of m.groundSpots) {
    const t = tIdx(p), x = t % W, y = Math.floor(t / W);
    if (!isTileCentre(p) || !move(m.tiles, t) || m.regionGrid[t] === REGION_COLISEUM || m.buildings.some((b) => inRect(b, x, y)) || clearingSet.has(t)) ground = `${x},${y} placement`;
    if (pool.some((s) => dist(s, p) < 3 * TILE) || m.crateSpots.some((c) => chebT(tIdx(c), t) < 2)) ground = `${x},${y} near a spawn or crate`;
  }
  check("ground: 20-30 distinct floor spots outside ruins, camp clearings and the coliseum, off spawns and crates", ground === "", () => ground);
  let ruins = "";
  const perZoneRuins = new Array<number>(ZONE_COUNT + 1).fill(0);
  m.buildings.forEach((b, bi) => {
    const code = m.regionGrid[b.y * W + b.x];
    perZoneRuins[code]++;
    if (!isZone(code) || b.w < 7 || b.w > 9 || b.h < 7 || b.h > 9 || b.x < 4 || b.y < 4 || b.x + b.w > W - 4 || b.y + b.h > H - 4) ruins = `ruin ${bi} size or place`;
    for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (m.regionGrid[y * W + x] !== code || fpd[y * W + x] < 4) ruins = `ruin ${bi} margin`;
    for (const t of clearingSet) { const x = t % W, y = Math.floor(t / W); if (x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 2 && y < b.y + b.h + 2) ruins = `ruin ${bi} near a camp clearing`; }
    for (let j = 0; j < bi; j++) { const o = m.buildings[j]; if (Math.max(o.x - (b.x + b.w), b.x - (o.x + o.w), o.y - (b.y + b.h), b.y - (o.y + o.h)) < 2) ruins = `ruins ${j},${bi} touch`; }
    const doors = doorRuns(m, b);
    if (doors.length < 1 || doors.length > 3 || new Set(doors.map((d) => d.side)).size !== doors.length || doors.some((d) => d.len !== 2 || d.start < 1 || d.start + d.len > (d.side % 2 === 0 ? b.w : b.h) - 1)) ruins = `ruin ${bi} doors`;
    for (const [cx, cy] of [[b.x, b.y], [b.x + b.w - 1, b.y], [b.x, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]]) if (!isWallTile(m, cx, cy)) ruins = `ruin ${bi} corner`;
    let interior = 0, free = 0;
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) { interior++; if (move(m.tiles, y * W + x)) free++; }
    if (free / interior <= 0.6) ruins = `ruin ${bi} interior ${free}/${interior}`;
  });
  if (perZoneRuins.slice(1).some((k) => k > 2)) ruins = `ruins per zone ${perZoneRuins.slice(1).join("/")}`;
  check("ruins: 0-2 per zone, 7-9 a side inside one zone (+1 margin), off the ring road, apart, clear of camps, 1-3 doors, open inside", ruins === "", () => ruins);
  const wallRun = longestOutdoorWallRun(m);
  if (!opts.styled) check("cover: outdoor walls stay small blobs: no straight run of 15 tiles", wallRun <= MAX_SIGHT_CORRIDOR / TILE - 1, () => `${wallRun}`);

  // --- Terrain (zone-terrain contract) ----------------------------------------------------------------------------------------
  const terrainErrors = validateTerrain(m, { styled: opts.styled });
  check("terrain: validateTerrain clean (T1-T10)", terrainErrors.length === 0, () => terrainErrors.slice(0, 2).join("; "));
  check("terrain: an unstyled map has no terrain, no low ground and no props", !!opts.styled || (m.terrain.every((v) => v === TERRAIN_NONE) && m.tiles.every((v) => v !== TILE_LOW) && m.props.length === 0));
  let hazard = "";
  // A square of radius r; with `halo`, the clearing grown by one tile (the square of radius 3 less its four corners).
  const plain = (cx: number, cy: number, r: number, what: string, halo = false): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (halo && Math.abs(dx) === 3 && Math.abs(dy) === 3) continue;
        if (m.terrain[(cy + dy) * W + cx + dx] !== TERRAIN_NONE) hazard = `${what} at ${cx},${cy}`;
      }
    }
  };
  for (const s of pool) plain(worldToTile(s.x), worldToTile(s.y), 2, "spawn 5x5");
  for (const c of m.crateSpots) plain(worldToTile(c.x), worldToTile(c.y), 1, "crate 3x3");
  for (const c of camps) plain(worldToTile(c.x), worldToTile(c.y), 3, "camp clearing and halo", true);
  for (const g of m.groundSpots) plain(worldToTile(g.x), worldToTile(g.y), 0, "ground spot");
  check("terrain: no kind on a spawn 5x5, a crate 3x3, a camp clearing and halo or a ground spot", hazard === "", () => hazard);

  // --- Reachability -----------------------------------------------------------------------------------------------------------
  const lab = open.label, home = lab[centre];
  const points: [string, Vec2][] = [
    ...m.coliseum.innerSpawns.map((p) => ["inner spawn", p] as [string, Vec2]),
    ...m.regions.map((r) => [`${r.id} pole`, r.pole] as [string, Vec2]),
    ...pool.map((p) => ["spawn", p] as [string, Vec2]),
    ...m.crateSpots.map((p) => ["crate", p] as [string, Vec2]),
    ...m.groundSpots.map((p) => ["ground spot", p] as [string, Vec2]),
    ...camps.flatMap((c) => [c, c.chest, ...c.spots].map((p) => [c.id, p] as [string, Vec2])),
  ];
  const lost = points.filter(([, p]) => lab[tIdx(p)] !== home);
  check("reachability: every spawn, crate, ground spot, camp spot and chest, pole and inner spawn is on the one open floor", lost.length === 0, () => lost.slice(0, 3).map(([w, p]) => `${w} ${p.x},${p.y}`).join("; "));

  let rocks = 0;
  for (let i = 0; i < N; i++) if (isZone(m.regionGrid[i]) && m.tiles[i] === TILE_WALL) rocks++;
  return {
    failures,
    stats: { lane, sealedLane, painted, floor, contact, slivers, radius, leashShare, pool: pool.length, poolZones: zonesIn.size, walkRatio57, pairsNear, rocks, wallRun },
  };
}

// ---- Checkers -----------------------------------------------------------------------------------------------------------

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const inRect = (b: TileRect, x: number, y: number): boolean => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

export function components(w: number, h: number, ok: (i: number) => boolean): { count: number; label: Int32Array } {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (label[i] >= 0 || !ok(i)) continue;
    let top = 0;
    stack[top++] = i;
    label[i] = count;
    while (top > 0) {
      const c = stack[--top], x = c % w, y = (c - x) / w;
      if (x > 0 && label[c - 1] < 0 && ok(c - 1)) { label[c - 1] = count; stack[top++] = c - 1; }
      if (x < w - 1 && label[c + 1] < 0 && ok(c + 1)) { label[c + 1] = count; stack[top++] = c + 1; }
      if (y > 0 && label[c - w] < 0 && ok(c - w)) { label[c - w] = count; stack[top++] = c - w; }
      if (y < h - 1 && label[c + w] < 0 && ok(c + w)) { label[c + w] = count; stack[top++] = c + w; }
    }
    count++;
  }
  return { count, label };
}

/**
 * Painted tiles of zone `code` farther than 2.5 tiles from every point where a disc of radius 2.5 fits in the zone,
 * measured exactly on tile squares: a "core" tile is one whose centre is at least 2.5 from every tile of another
 * region (or the border); a core tile covers the tiles within 2.5 of it, centre to centre.
 */
function sliverTiles(m: GameMap, code: number): number {
  const W = m.w, N = W * m.h;
  const cov = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (m.regionGrid[i] !== code) continue;
    const x = i % W, y = (i - x) / W;
    let fits = true;
    for (let dy = -3; dy <= 3 && fits; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < m.h && m.regionGrid[ny * W + nx] === code) continue;
        const qx = Math.max(Math.abs(dx) - 0.5, 0), qy = Math.max(Math.abs(dy) - 0.5, 0);
        if (qx * qx + qy * qy < 2.5 * 2.5) { fits = false; break; }
      }
    }
    if (!fits) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 6.25) cov[(y + dy) * W + x + dx] = 1;
  }
  let s = 0;
  for (let i = 0; i < N; i++) if (m.regionGrid[i] === code && !cov[i]) s++;
  return s;
}

const snapZero = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v);

/**
 * The longest lattice lane in tiles: for `dirs` directions (angle k*pi/dirs) the lines {p : n.(p - origin) = j*step} are
 * walked tile by tile (Amanatides-Woo); a lane is an interval along which both of two adjacent lines run through open
 * tiles only. Crossings shorter than 1e-9 (a corner touch) neither break nor extend a run.
 */
export function fatLane(open: Uint8Array, w: number, h: number, dirs: number, step: number, ox = 0, oy = 0): number {
  let prev = new Float64Array(1024), cur = new Float64Array(1024);
  let best = 0;
  for (let k = 0; k < dirs; k++) {
    const a = (k * Math.PI) / dirs;
    const dx = snapZero(Math.cos(a)), dy = snapZero(Math.sin(a));
    const nx = -dy, ny = dx;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : 1 / Math.abs(dx), tdy = dy === 0 ? Infinity : 1 / Math.abs(dy);
    const corners = [-ox * nx - oy * ny, (w - ox) * nx - oy * ny, -ox * nx + (h - oy) * ny, (w - ox) * nx + (h - oy) * ny];
    const jMin = Math.ceil(Math.min(...corners) / step), jMax = Math.floor(Math.max(...corners) / step);
    const walk = (j: number, out: Float64Array): number => {
      const bx = ox + j * step * nx, by = oy + j * step * ny;
      let t0 = -Infinity, t1 = Infinity;
      if (dx !== 0) { const p = -bx / dx, q = (w - bx) / dx; t0 = Math.max(t0, Math.min(p, q)); t1 = Math.min(t1, Math.max(p, q)); }
      else if (bx < 0 || bx > w) return 0;
      if (dy !== 0) { const p = -by / dy, q = (h - by) / dy; t0 = Math.max(t0, Math.min(p, q)); t1 = Math.min(t1, Math.max(p, q)); }
      else if (by < 0 || by > h) return 0;
      if (!(t1 - t0 > LANE_EPS)) return 0;
      const e = Math.min(1e-7, (t1 - t0) / 2);
      let cx = Math.min(w - 1, Math.max(0, Math.floor(bx + (t0 + e) * dx)));
      let cy = Math.min(h - 1, Math.max(0, Math.floor(by + (t0 + e) * dy)));
      let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? cx + 1 : cx) - bx) / dx;
      let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? cy + 1 : cy) - by) / dy;
      let t = t0, runStart = NaN, runEnd = 0, n = 0;
      for (;;) {
        const tn = Math.min(tMaxX, tMaxY, t1);
        if (tn - t >= LANE_EPS) {
          if (open[cy * w + cx]) { if (Number.isNaN(runStart)) runStart = t; runEnd = tn; }
          else if (!Number.isNaN(runStart)) { if (n < 500) { out[2 * n] = runStart; out[2 * n + 1] = runEnd; n++; } runStart = NaN; }
        }
        if (tn >= t1) break;
        if (tMaxX < tMaxY) { cx += sx; tMaxX += tdx; } else { cy += sy; tMaxY += tdy; }
        t = tn;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      }
      if (!Number.isNaN(runStart) && n < 500) { out[2 * n] = runStart; out[2 * n + 1] = runEnd; n++; }
      return n;
    };
    let prevN = 0;
    for (let j = jMin; j <= jMax; j++) {
      const n = walk(j, cur);
      for (let i = 0, q = 0; i < n && q < prevN;) {
        const lo = Math.max(cur[2 * i], prev[2 * q]), hi = Math.min(cur[2 * i + 1], prev[2 * q + 1]);
        if (hi - lo > best) best = hi - lo;
        if (cur[2 * i + 1] < prev[2 * q + 1]) i++; else q++;
      }
      const tmp = prev; prev = cur; cur = tmp; prevN = n;
    }
  }
  return best;
}

/**
 * The longest strip of width `wt` tiles, at the angles `thetas` and offsets `ostep` apart, whose interior meets no
 * blocked tile, in tiles. Every blocked tile is clipped against each slab it meets; a free strip is a gap between the
 * stretches they block. Slabs shrink by 1e-7 so a wall touching only the side does not count. Sampling only under-reports.
 */
export function longestFreeStrip(blocked: Uint8Array, w: number, h: number, wt: number, thetas: readonly number[], ostep: number): { len: number; deg: number } {
  const bx: number[] = [], by: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (blocked[y * w + x]) { bx.push(x); by.push(y); }
  const nb = bx.length, SHRINK = 1e-7, range = new Float64Array(2);
  const i0s = new Int32Array(nb), i1s = new Int32Array(nb);
  let best = 0, bestDeg = 0;
  for (const th of thetas) {
    const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
    const oMin = Math.min(0, nx * w, ny * h, nx * w + ny * h) - wt, oMax = Math.max(0, nx * w, ny * h, nx * w + ny * h);
    const nO = Math.ceil((oMax - oMin) / ostep) + 1;
    const start = new Int32Array(nO + 1);
    for (let t = 0; t < nb; t++) {
      const p0 = nx * bx[t] + ny * by[t];
      const pmin = Math.min(p0, p0 + nx, p0 + ny, p0 + nx + ny), pmax = Math.max(p0, p0 + nx, p0 + ny, p0 + nx + ny);
      const i0 = Math.max(0, Math.floor((pmin - wt - oMin) / ostep)), i1 = Math.min(nO - 1, Math.ceil((pmax - oMin) / ostep));
      i0s[t] = i0; i1s[t] = i1;
      for (let i = i0; i <= i1; i++) start[i + 1]++;
    }
    for (let i = 0; i < nO; i++) start[i + 1] += start[i];
    const from = new Float64Array(start[nO]), to = new Float64Array(start[nO]);
    const fill = start.slice(0, nO);
    for (let t = 0; t < nb; t++) {
      for (let i = i0s[t]; i <= i1s[t]; i++) {
        const lo = oMin + i * ostep + SHRINK, hi = oMin + i * ostep + wt - SHRINK;
        if (clipSquare(bx[t], by[t], nx, ny, dx, dy, lo, hi, range)) { const f = fill[i]++; from[f] = range[0]; to[f] = range[1]; }
      }
    }
    for (let i = 0; i < nO; i++) {
      const a = start[i], b = fill[i];
      if (b - a < 2) continue;
      for (let p = a + 1; p < b; p++) {
        const f = from[p], e = to[p];
        let q = p - 1;
        while (q >= a && from[q] > f) { from[q + 1] = from[q]; to[q + 1] = to[q]; q--; }
        from[q + 1] = f; to[q + 1] = e;
      }
      let reach = to[a];
      for (let p = a + 1; p < b; p++) {
        if (from[p] - reach > best) { best = from[p] - reach; bestDeg = (th * 180) / Math.PI; }
        if (to[p] > reach) reach = to[p];
      }
    }
  }
  return { len: best, deg: bestDeg };
}

const sqX = new Float64Array(4), sqY = new Float64Array(4), sqV = new Float64Array(4);
function clipSquare(x: number, y: number, nx: number, ny: number, dx: number, dy: number, lo: number, hi: number, out: Float64Array): boolean {
  sqX[0] = x; sqX[1] = x + 1; sqX[2] = x + 1; sqX[3] = x;
  sqY[0] = y; sqY[1] = y; sqY[2] = y + 1; sqY[3] = y + 1;
  let vmin = Infinity, vmax = -Infinity;
  for (let c = 0; c < 4; c++) { const v = nx * sqX[c] + ny * sqY[c]; sqV[c] = v; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
  if (!(vmin < hi && vmax > lo)) return false;
  let mn = Infinity, mx = -Infinity;
  for (let c = 0; c < 4; c++) {
    if (sqV[c] >= lo && sqV[c] <= hi) { const u = dx * sqX[c] + dy * sqY[c]; if (u < mn) mn = u; if (u > mx) mx = u; }
    const d = (c + 1) & 3;
    for (let side = 0; side < 2; side++) {
      const bound = side === 0 ? lo : hi;
      const fa = sqV[c] - bound, fb = sqV[d] - bound;
      if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
        const t = fa / (fa - fb);
        const u = dx * (sqX[c] + t * (sqX[d] - sqX[c])) + dy * (sqY[c] + t * (sqY[d] - sqY[c]));
        if (u < mn) mn = u;
        if (u > mx) mx = u;
      }
    }
  }
  out[0] = mn; out[1] = mx;
  return mn <= mx;
}

/** The off-lattice angles of the exact strip check: midpoints between neighbouring directions of the 32- and 48-direction lattices. */
export function offLatticeAngles(): number[] {
  const lattices = [32, 48];
  const onLattice = (th: number): boolean => lattices.some((n) => Math.abs((th * n) / Math.PI - Math.round((th * n) / Math.PI)) < 1e-9);
  return lattices.flatMap((n) => Array.from({ length: n }, (_, k) => ((k + 0.5) * Math.PI) / n)).filter((th) => !onLattice(th));
}

/** Earliest t >= 0 at which a disc of radius r centred at (px, py) + t*(dx, dy) overlaps the tile square (qx, qy); Infinity if never. */
function discHitsTile(px: number, py: number, dx: number, dy: number, qx: number, qy: number, r: number): number {
  let best = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const x0 = pass === 0 ? qx - r : qx, x1 = pass === 0 ? qx + 1 + r : qx + 1;
    const y0 = pass === 0 ? qy : qy - r, y1 = pass === 0 ? qy + 1 : qy + 1 + r;
    let lo = -Infinity, hi = Infinity, miss = false;
    if (dx === 0) { if (px <= x0 || px >= x1) miss = true; }
    else { const p = (x0 - px) / dx, q = (x1 - px) / dx; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
    if (!miss) {
      if (dy === 0) { if (py <= y0 || py >= y1) miss = true; }
      else { const p = (y0 - py) / dy, q = (y1 - py) / dy; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
    }
    if (!miss && lo < hi && hi > 0) best = Math.min(best, Math.max(lo, 0));
  }
  for (let c = 0; c < 4; c++) {
    const fx = px - (qx + (c & 1)), fy = py - (qy + (c >> 1));
    const b = fx * dx + fy * dy, disc = b * b - (fx * fx + fy * fy - r * r);
    if (disc > 0) { const sq = Math.sqrt(disc); if (-b + sq > 0) best = Math.min(best, Math.max(-b - sq, 0)); }
  }
  return best;
}

function discReach(open: Uint8Array, near: Uint8Array, w: number, h: number, cx: number, cy: number, dx: number, dy: number, r: number): number {
  const px = cx + 0.5, py = cy + 0.5;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : 1 / Math.abs(dx), tdy = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let tMaxX = 0.5 * tdx, tMaxY = 0.5 * tdy;
  let t = 0, tBlock = Infinity;
  for (;;) {
    if (t >= tBlock) return tBlock;
    const tn = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (near[cy * w + cx]) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const x = cx + i, y = cy + j;
          if (x < 0 || y < 0 || x >= w || y >= h || !open[y * w + x]) tBlock = Math.min(tBlock, discHitsTile(px, py, dx, dy, x, y, r));
        }
      }
    }
    if (tn - t >= LANE_EPS && !open[cy * w + cx]) return Math.min(tBlock, t);
    if (tMaxX < tMaxY) { cx += sx; tMaxX += tdx; } else { cy += sy; tMaxY += tdy; }
    t = tn;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return Math.min(tBlock, t);
  }
}

/** The longest straight segment through any open tile centre, in `dirs` directions, along which a disc of radius r stays on open tiles (tiles). */
export function denseDisc(open: Uint8Array, w: number, h: number, r: number, dirs = 64): number {
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let j = -1; j <= 1 && !near[y * w + x]; j++) {
        for (let i = -1; i <= 1; i++) {
          const nx = x + i, ny = y + j;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open[ny * w + nx]) { near[y * w + x] = 1; break; }
        }
      }
    }
  }
  let best = 0;
  for (let k = 0; k < dirs; k++) {
    const a = (k * Math.PI) / dirs;
    const dx = snapZero(Math.cos(a)), dy = snapZero(Math.sin(a));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!open[y * w + x]) continue;
        const len = discReach(open, near, w, h, x, y, dx, dy, r) + discReach(open, near, w, h, x, y, -dx, -dy, r);
        if (len > best) best = len;
      }
    }
  }
  return best;
}

/**
 * Sampled check with the sim's own wall test: FAN_RAYS aims across the cone from `a` that can hit a target at `b`
 * (centre within `reach` of the ray), each cast with `raycast` up to MAX_SIGHT_CORRIDOR. Returns the first aim that
 * hits (degrees off the centre line), or null.
 */
export function hittableAim(m: GameMap, a: Vec2, b: Vec2, reach: number): number | null {
  const L = dist(a, b), ang0 = Math.atan2(b.y - a.y, b.x - a.x), maxOff = Math.asin(Math.min(1, reach / L)), half = (FAN_RAYS - 1) / 2;
  for (let k = 0; k < FAN_RAYS; k++) {
    const off = ((k - half) / half) * maxOff;
    const dx = Math.cos(ang0 + off), dy = Math.sin(ang0 + off);
    const s = (b.x - a.x) * dx + (b.y - a.y) * dy, perp = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx);
    if (s < 0 || perp > reach + 1e-9) continue;
    const wall = raycast(m, a.x, a.y, a.x + dx * MAX_SIGHT_CORRIDOR, a.y + dy * MAX_SIGHT_CORRIDOR);
    if (s <= (wall.hit ? wall.dist : MAX_SIGHT_CORRIDOR)) return (off * 180) / Math.PI;
  }
  return null;
}

/**
 * Exact check: the aims that hit are the slopes |cross/dot| <= reach / sqrt(L^2 - reach^2) about the centre line, and
 * each passes the target at s >= sqrt(L^2 - reach^2). A wall tile in front whose far corner is nearer than that stops
 * every aim between its extreme corners' slopes; the cone is shut when such tiles cover the whole interval. Returns the
 * first open slope (degrees) or null. It can only over-report.
 */
export function firstOpenSlope(m: GameMap, a: Vec2, b: Vec2, reach: number): number | null {
  const L = dist(a, b), sMin = Math.sqrt(L * L - reach * reach), edge = reach / sMin;
  const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
  const tx0 = worldToTile(Math.min(a.x, b.x)) - 1, tx1 = worldToTile(Math.max(a.x, b.x)) + 1;
  const ty0 = worldToTile(Math.min(a.y, b.y)) - 1, ty1 = worldToTile(Math.max(a.y, b.y)) + 1;
  const spans: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isWallTile(m, tx, ty)) continue;
      let lo = Infinity, hi = -Infinity, far = 0, front = true;
      for (let c = 0; c < 4; c++) {
        const rx = (tx + (c & 1)) * TILE - a.x, ry = (ty + (c >> 1)) * TILE - a.y, along = rx * dx + ry * dy;
        if (along <= 0) { front = false; break; }
        const slope = (dx * ry - dy * rx) / along;
        lo = Math.min(lo, slope); hi = Math.max(hi, slope); far = Math.max(far, Math.hypot(rx, ry));
      }
      if (front && far < sMin && hi >= -edge && lo <= edge) spans.push([lo, hi]);
    }
  }
  spans.sort((p, q) => p[0] - q[0]);
  let covered = -edge;
  for (const [lo, hi] of spans) { if (lo > covered + 1e-9) break; if (hi > covered) covered = hi; }
  return covered >= edge - 1e-9 ? null : (Math.atan(covered) * 180) / Math.PI;
}

/** Walking distance (5 straight, 7 diagonal, no corner cutting) over walkable tiles, by a bucketed Dijkstra. */
export function walk57(m: GameMap, from: number): Int32Array {
  const w = m.w, N = w * m.h, d = new Int32Array(N).fill(1 << 30), done = new Uint8Array(N);
  d[from] = 0;
  const buckets: number[][] = [[from]];
  for (let c = 0; c < buckets.length; c++) {
    const b = buckets[c];
    if (!b) continue;
    for (const i of b) {
      if (done[i] || d[i] !== c) continue;
      done[i] = 1;
      const x = i % w, y = (i - x) / w;
      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddx = -1; ddx <= 1; ddx++) {
          if (!ddx && !ddy) continue;
          const nx = x + ddx, ny = y + ddy, j = ny * w + nx;
          if (m.tiles[j] !== TILE_FLOOR) continue;
          if (ddx && ddy && (m.tiles[y * w + nx] !== TILE_FLOOR || m.tiles[ny * w + x] !== TILE_FLOOR)) continue;
          const nd = c + (ddx && ddy ? 7 : 5);
          if (nd < d[j]) { d[j] = nd; (buckets[nd] ??= []).push(j); }
        }
      }
    }
  }
  return d;
}

/** Length in world units of the findPath route (0 when there is none). */
export function walkLength(m: GameMap, a: Vec2, b: Vec2): number {
  let len = 0, px = a.x, py = a.y;
  for (const q of findPath(m, a, b)) { len += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; }
  return len;
}

/** Floor runs along each side of a ruin's wall ring: side 0 top, 1 right, 2 bottom, 3 left. */
function doorRuns(m: GameMap, b: TileRect): { side: number; start: number; len: number }[] {
  const runs: { side: number; start: number; len: number }[] = [];
  for (let side = 0; side < 4; side++) {
    const len = side % 2 === 0 ? b.w : b.h;
    let runStart = -1;
    for (let i = 0; i <= len; i++) {
      let floor = false;
      if (i < len) {
        const tx = side === 0 || side === 2 ? b.x + i : side === 1 ? b.x + b.w - 1 : b.x;
        const ty = side === 1 || side === 3 ? b.y + i : side === 0 ? b.y : b.y + b.h - 1;
        floor = m.tiles[ty * m.w + tx] === TILE_FLOOR;
      }
      if (floor && runStart < 0) runStart = i;
      if (!floor && runStart >= 0) { runs.push({ side, start: runStart, len: i - runStart }); runStart = -1; }
    }
  }
  return runs;
}

/**
 * The longest straight run of outdoor wall tiles (in a zone, outside ruins) that belongs to a wall blob not touching
 * the border: rocks and chunks only chain by touching, so a long run would be a barrier, not cover.
 */
function longestOutdoorWallRun(m: GameMap): number {
  const W = m.w;
  const outdoor = (x: number, y: number): boolean => x > 0 && y > 0 && x < W - 1 && y < m.h - 1 && m.tiles[y * W + x] === TILE_WALL &&
    m.regionGrid[y * W + x] >= 1 && m.regionGrid[y * W + x] <= ZONE_COUNT && !m.buildings.some((b) => inRect(b, x, y));
  const seen = new Uint8Array(W * m.h), wall = new Uint8Array(W * m.h);
  for (let y = 1; y < m.h - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!outdoor(x, y) || seen[y * W + x]) continue;
      const tiles: TilePt[] = [];
      let border = false;
      const stack = [[x, y]];
      seen[y * W + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        tiles.push({ x: cx, y: cy });
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (m.regionGrid[ny * W + nx] === REGION_NONE) border = true;
            if (outdoor(nx, ny) && !seen[ny * W + nx]) { seen[ny * W + nx] = 1; stack.push([nx, ny]); }
          }
        }
      }
      if (!border) for (const t of tiles) wall[t.y * W + t.x] = 1;
    }
  }
  let longest = 0;
  for (let y = 1; y < m.h - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!wall[y * W + x]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (wall[(y - dy) * W + x - dx]) continue;
        let run = 0;
        while (wall[(y + dy * run) * W + x + dx * run]) run++;
        longest = Math.max(longest, run);
      }
    }
  }
  return longest;
}

// ---- A demo zone style hook: low ground, floor hazards and styler walls for tests and sweeps ----------------------------

/**
 * One pass over every zone, each kind in its home zone: fire gets a meandering lava river 2 wide and up to 24 long with
 * ember on its free banks, sentenced three fences of 5-9 tiles with a gap (kept: no rock may stand on them), frost a
 * 6-tile crevasse with a gap and a 4x4 ice patch, plague a 5x5 bog, holy a 3x3 patch of light; every zone two 2x2 walls.
 */
export const demoStyleHook: ZoneStyleHook = ({ w, h, seed, attempt, zone, zoneFaction, protect, tiles, terrain, keepLow }) => {
  const N = w * h;
  for (let z = 1; z <= zoneFaction.length; z++) {
    const faction = zoneFaction[z - 1];
    const rng = styleRng(seed, attempt, REGION_FACTIONS.indexOf(faction) + 1);
    const cells: number[] = [];
    for (let i = 0; i < N; i++) if (zone[i] === z && !protect[i] && tiles[i] === TILE_FLOOR) cells.push(i);
    if (cells.length === 0) continue;
    const free = (i: number): boolean => i >= 0 && i < N && zone[i] === z && protect[i] === 0 && tiles[i] === TILE_FLOOR && terrain[i] === TERRAIN_NONE;
    const low = (i: number, kind: number): void => { tiles[i] = TILE_LOW; terrain[i] = kind; };
    const patch = (side: number, kind: number): void => {
      const at = cells[randInt(rng, 0, cells.length)];
      for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) if (free(at + dy * w + dx) && (at % w) + dx < w - 1) terrain[at + dy * w + dx] = kind;
    };
    if (faction === "fire") {
      let at = cells[randInt(rng, 0, cells.length)];
      let dx = rng() < 0.5 ? 1 : 0, dy = 1 - dx;
      const river: number[] = [];
      for (let step = 0; step < 24; step++) {
        const x = at % w, side = dx !== 0 ? w : 1;
        if (!free(at) || !free(at + side) || x <= 1 || x >= w - 2) break;
        low(at, TERRAIN_LAVA);
        low(at + side, TERRAIN_LAVA);
        river.push(at, at + side);
        if (rng() < 0.25) { const t = dx; dx = dy; dy = t; }
        at += dy * w + dx;
      }
      for (const r of river) for (const d of [1, -1, w, -w]) if (free(r + d)) terrain[r + d] = TERRAIN_EMBER;
    } else if (faction === "sentenced") {
      for (let f = 0; f < 3; f++) {
        const at = cells[randInt(rng, 0, cells.length)];
        const horiz = rng() < 0.5, len = randInt(rng, 5, 10), gap = randInt(rng, 1, len - 1);
        for (let k = 0; k < len; k++) {
          const t = at + (horiz ? k : k * w);
          if (k === gap || !free(t)) continue;
          low(t, TERRAIN_FENCE);
          keepLow[t] = 1;
        }
      }
    } else if (faction === "frost") {
      const at = cells[randInt(rng, 0, cells.length)];
      const horiz = rng() < 0.5;
      for (let k = 0; k < 6; k++) { const t = at + (horiz ? k : k * w); if (k !== 3 && free(t)) low(t, TERRAIN_CREVASSE); }
      patch(4, TERRAIN_ICE);
    } else if (faction === "plague") patch(5, TERRAIN_BOG);
    else if (faction === "holy") patch(3, TERRAIN_LIGHT);
    for (let b = 0; b < 2; b++) {
      const at = cells[randInt(rng, 0, cells.length)];
      for (const o of [0, 1, w, w + 1]) if (free(at + o)) tiles[at + o] = TILE_WALL;
    }
  }
};
