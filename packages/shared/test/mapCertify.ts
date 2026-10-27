// An independent certifier for generated maps: every guarantee of the map contract (map.ts) and the R2 gates
// (ROGUELIKE_PLAN R2), checked from the GameMap alone with checkers written apart from the generator (ports of the R1
// certifier and of the mapgen tests of the 64x64 generator it replaced). It never reads the generator's bookkeeping: the contract's numbers are
// written out here. Movement and sight go through the masks of map.ts: walkable is `(tile & MASK_MOVE) === 0` (TILE_LOW
// blocks it), see-through is `(tile & MASK_SIGHT) === 0` (TILE_LOW lets sight through).
import { MAX_PLAYERS, TILE } from "../src/constants";
import { raycast } from "../src/geometry";
import {
  MASK_MOVE, MASK_SIGHT, REGION_COLISEUM, REGION_FACTIONS, REGION_NONE, REGION_WEAPONS, TILE_FLOOR, TILE_LOW, TILE_WALL, isWallTile, tileToWorldCenter,
  withGates, worldToTile,
} from "../src/map";
import type { GameMap, GateSide, TilePt, TileRect } from "../src/map";
import type { Vec2 } from "../src/messages";
import { STYLE_STREAM, styleRng } from "../src/mapgen";
import type { ZoneStyleHook } from "../src/mapgen";
import { findPath } from "../src/pathfind";
import { randInt } from "../src/rng";
import {
  TERRAINS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TERRAIN_NONE, validateTerrain,
} from "../src/terrain";

// ---- The contract's numbers (not read from the generator; zone-shapes contract 6.1-6.3) ----
export const MAP_SIZE = 136;
export const ZONE_COUNT = 5;
export const AREA_SPREAD_MAX = 8;
export const FLOOR_SHARE_MAX = 1.15;
export const RING_CONTACT_MIN = 24;
export const SLIVER_MAX = 100;
export const CAMPS_PER_ZONE = 8;
export const ELITES_PER_ZONE = 2;
export const ELITE_MIN_SEP_TILES = 16;
export const CAMP_GAP_TILES = 9;
export const TERRITORY_RADIUS_TILES = 30;
/** Pool members closer than SPAWN_SAFE_TILES need a wall on the straight line between them; none closer than SPAWN_SEP_TILES. */
export const SPAWN_SAFE_TILES = 10;
export const SPAWN_SEP_TILES = 5;
export const SPAWN_CAMP_TILES = 5;
export const POOL_MIN = 24;
export const POOL_MAX = 32;
export const POOL_ZONES = 4;
/** The members' findPath walks to the coliseum centre: max/min (a certificate). */
export const WALK_RATIO_MAX = 1.2;
/** Floor-hazard tiles (ember, bog, ice) under a member's findPath walk, at most. */
export const HAZARD_WALK_MAX = 8;
export const CRATES_MIN = 4;
export const CRATES_MAX = 6;
export const GROUND_MIN = 30;
export const GROUND_MAX = 45;
export const FEATURES_MAX = 250;

export interface MapStats {
  painted: number[];
  floor: number[];
  contact: number[];
  slivers: number[];
  radius: number[];
  leashShare: number[];
  pool: number;
  poolZones: number;
  /** The BFS 5/7 walk ratio over the pool (report only since the findPath gate). */
  walkRatio57: number;
  /** The findPath walk ratio over the pool (certified <= WALK_RATIO_MAX). */
  walkRatioPath: number;
  /** Floor-hazard tiles under each member's findPath walk. */
  hazardsOnWalks: number[];
  rocks: number;
  features: number;
  /** Per zone (REGION_FACTIONS order): tiles of each terrain kind (index = kind id), walls included for the LOW kinds' pillars. */
  kinds: number[][];
  /** Per zone: the walkable floor's 4-connected pieces (zone mode only; 0 otherwise). */
  zonePieces: number[];
  /** Per pool member (zone mode only): distinct terrain tiles its findPath route to the centre crosses. Report only (contract 0.8). */
  hazardExposure: number[];
}

export interface CertifyOptions {
  /** The zone stylers ran: validateTerrain checks LOW kinds (T10). */
  styled?: boolean;
  /** `styler=zone`: the generator's own zone stylers ran. Implies `styled`, and adds the zone-floor connectivity check and the spawn-to-centre hazard exposure. */
  zone?: boolean;
}

/** Runs every per-map check; returns the failures (empty when the map certifies) and the measured numbers. */
export function certifyMap(m: GameMap, copts: CertifyOptions = {}): { failures: string[]; stats: MapStats } {
  const opts = { styled: !!(copts.styled || copts.zone), zone: !!copts.zone };
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
  check("grid: 136x136, tiles 0/1/2, border wall and none, every other tile in a zone or the coliseum", m.w === MAP_SIZE && m.h === MAP_SIZE && gridBad === "", () => gridBad);
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
  check("camps: 8 per zone, exactly two elite camps per zone", perZone.every((cs) => cs.length === CAMPS_PER_ZONE && cs.filter((c) => c.eliteSpot >= 0).length === ELITES_PER_ZONE), () => perZone.map((cs) => `${cs.length}:${cs.filter((c) => c.eliteSpot >= 0).length}`).join("/"));
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
    // The elite camps: the zone's camp farthest from the centre, then the next farthest at least 16 tiles from it (else the second farthest).
    const zc = camps.filter((c) => c.zone === f).map((c, k) => ({ c, k, d: dist(c, m.coliseum.centre) }));
    zc.sort((a, b) => b.d - a.d || a.k - b.k);
    if (zc.length < 2) continue;
    const first = zc[0].c, second = (zc.slice(1).find((e) => dist(e.c, first) >= ELITE_MIN_SEP_TILES * TILE - 1e-9) ?? zc[1]).c;
    const elites = zc.filter((e) => e.c.eliteSpot >= 0).map((e) => e.c);
    check(`camps: ${f} elite camps are its farthest from the centre and the next farthest 16+ tiles from it`, elites.length === 2 && elites.includes(first) && elites.includes(second), () => elites.map((c) => c.id).join(","));
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
    if (m.buildings.some((b) => inRect(b, x, y))) poolTile = `in a landmark at ${x},${y}`;
  }
  check("spawns: tile centres with a clear 3x3 of floor, outside landmarks, tagged with their tile's zone", poolTile === "", () => poolTile);
  let sepMin = Infinity, campMin = Infinity;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) sepMin = Math.min(sepMin, dist(pool[i], pool[j]));
    for (const c of camps) campMin = Math.min(campMin, dist(pool[i], c));
  }
  check("spawns: 5+ tiles apart, pool-wide", sepMin >= SPAWN_SEP_TILES * TILE - 1e-9, () => `${(sepMin / TILE).toFixed(2)}`);
  check("spawns: 5+ tiles from every camp centre", campMin >= SPAWN_CAMP_TILES * TILE - 1e-9, () => `${(campMin / TILE).toFixed(2)}`);
  // Spawn safety (owner ruling): two members closer than 10 tiles have a wall on the straight line between their centres.
  let unsafe = "";
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      if (dist(pool[i], pool[j]) >= SPAWN_SAFE_TILES * TILE - 1e-9) continue;
      if (!raycast(m, pool[i].x, pool[i].y, pool[j].x, pool[j].y, MASK_SIGHT).hit) unsafe = `${pool[i].x},${pool[i].y} and ${pool[j].x},${pool[j].y}`;
    }
  }
  check("spawns: members under 10 tiles apart have a wall on the line between them", unsafe === "", () => unsafe);
  const w57 = walk57(m, centre);
  const walks = pool.map((s) => w57[tIdx(s)]);
  const walkRatio57 = Math.max(...walks) / Math.min(...walks);
  // The findPath walks (the generator's spawn gate, re-measured): max/min <= 1.2, and at most 8 floor-hazard tiles on each.
  const pathWalks: number[] = [], hazardsOnWalks: number[] = [];
  for (const p of pool) {
    let len = 0, ax = p.x, ay = p.y;
    const seen = new Set<number>();
    for (const q of findPath(m, p, m.coliseum.centre)) {
      len += Math.sqrt((q.x - ax) * (q.x - ax) + (q.y - ay) * (q.y - ay));
      const steps = Math.ceil(Math.sqrt((q.x - ax) * (q.x - ax) + (q.y - ay) * (q.y - ay)) / 4);
      for (let k = 0; k <= steps; k++) {
        const t = Math.floor((ay + ((q.y - ay) * k) / Math.max(1, steps)) / TILE) * W + Math.floor((ax + ((q.x - ax) * k) / Math.max(1, steps)) / TILE);
        const kind = m.terrain[t];
        if (kind === TERRAIN_EMBER || kind === TERRAIN_BOG || kind === TERRAIN_ICE) seen.add(t);
      }
      ax = q.x; ay = q.y;
    }
    pathWalks.push(len);
    hazardsOnWalks.push(seen.size);
  }
  const walkRatioPath = Math.max(...pathWalks) / Math.min(...pathWalks);
  check("spawns: every member walks to the centre (findPath), max/min <= 1.2", Math.min(...pathWalks) > 0 && walkRatioPath <= WALK_RATIO_MAX + 1e-9, () => walkRatioPath.toFixed(4));
  check("spawns: at most 8 floor-hazard tiles on every member's walk", Math.max(0, ...hazardsOnWalks) <= HAZARD_WALK_MAX, () => `${Math.max(...hazardsOnWalks)}`);

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

  // --- Features --------------------------------------------------------------------------------------------------------
  let feats = m.featureGrid instanceof Uint8Array && m.featureGrid.length === N && m.features.length <= FEATURES_MAX ? "" : "featureGrid or count";
  const featCount = new Array<number>(m.features.length + 1).fill(0);
  for (let i = 0; i < N && feats === ""; i++) {
    const v = m.featureGrid[i];
    if (v === 0) continue;
    if (v > m.features.length) { feats = `featureGrid ${v} at ${i % W},${Math.floor(i / W)}`; break; }
    featCount[v]++;
    const f = m.features[v - 1];
    if (!inRect(f.bbox, i % W, Math.floor(i / W))) feats = `feature ${v - 1} owns a tile outside its box`;
  }
  m.features.forEach((f, k) => { if (feats === "" && f.tiles !== featCount[k + 1]) feats = `feature ${k} counts ${f.tiles} tiles, owns ${featCount[k + 1]}`; });
  check("features: at most 250, featureGrid names them, each one's tiles and box match its ownership", feats === "", () => feats);

  // --- Crates, ground spots -----------------------------------------------------------------------------------------------
  const allSpots = camps.flatMap((c) => c.spots.map(tIdx));
  const chebT = (a: number, b: number): number => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));
  let crates = "";
  const seenCrates = new Set<number>();
  for (const r of m.regions) {
    if (r.chestSpots.length < CRATES_MIN || r.chestSpots.length > CRATES_MAX) crates = `${r.id}: ${r.chestSpots.length}`;
    r.chestSpots.forEach((p, i) => {
      const t = tIdx(p), x = t % W, y = Math.floor(t / W);
      if (!isTileCentre(p) || !move(m.tiles, t) || REGION_FACTIONS[m.regionGrid[t] - 1] !== r.id || fpd[t] <= 3 || x < 2 || y < 2 || x > W - 3 || y > H - 3) crates = `${r.id} crate ${x},${y} placement`;
      // Against a wall; or (phase A, a zone with too few walls) on open floor with a clear 3x3.
      let clear3 = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!move(m.tiles, (y + dy) * W + x + dx)) clear3 = false;
      if (!(isWallTile(m, x - 1, y) || isWallTile(m, x + 1, y) || isWallTile(m, x, y - 1) || isWallTile(m, x, y + 1)) && !clear3) crates = `${r.id} crate ${x},${y} neither against a wall nor in the open`;
      if (pool.some((s) => chebT(tIdx(s), t) < 3) || allSpots.some((s) => chebT(s, t) < 2) || camps.some((c) => chebT(tIdx(c), t) < 3)) crates = `${r.id} crate ${x},${y} too near a spawn, spot or camp`;
      if (seenCrates.has(t)) crates = "duplicate";
      seenCrates.add(t);
      for (let j = 0; j < i; j++) if (chebT(tIdx(r.chestSpots[j]), t) < 2) crates = `${r.id} crates touch`;
    });
  }
  check("crates: 4-6 per zone, floor against a wall (or in the open), in the zone, off the ring road and the border ring, apart from spawns, spots, camps and each other", crates === "", () => crates);
  const clearingSet = new Set<number>();
  for (const c of camps) { const cx = worldToTile(c.x), cy = worldToTile(c.y); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 6.25) clearingSet.add((cy + dy) * W + cx + dx); }
  let ground = m.groundSpots.length >= GROUND_MIN && m.groundSpots.length <= GROUND_MAX ? "" : `${m.groundSpots.length} spots`;
  if (new Set(m.groundSpots.map(tIdx)).size !== m.groundSpots.length) ground = "duplicates";
  for (const p of m.groundSpots) {
    const t = tIdx(p), x = t % W, y = Math.floor(t / W);
    if (!isTileCentre(p) || !move(m.tiles, t) || m.regionGrid[t] === REGION_COLISEUM || m.buildings.some((b) => inRect(b, x, y)) || clearingSet.has(t)) ground = `${x},${y} placement`;
    if (pool.some((s) => dist(s, p) < 3 * TILE) || m.crateSpots.some((c) => chebT(tIdx(c), t) < 2)) ground = `${x},${y} near a spawn or crate`;
  }
  check("ground: 30-45 distinct floor spots outside landmarks, camp clearings and the coliseum, off spawns and crates", ground === "", () => ground);
  let landmarks = "";
  m.buildings.forEach((b, bi) => {
    const code = m.regionGrid[b.y * W + b.x];
    if (!isZone(code)) landmarks = `landmark ${bi} not in a zone`;
    for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (m.regionGrid[y * W + x] !== code) landmarks = `landmark ${bi} margin`;
  });
  check("landmarks: each box (+1 margin) inside one zone", landmarks === "", () => landmarks);

  // --- Terrain (zone-terrain contract) ----------------------------------------------------------------------------------------
  const terrainErrors = validateTerrain(m, { styled: opts.styled });
  check("terrain: validateTerrain clean (T1-T10)", terrainErrors.length === 0, () => terrainErrors.slice(0, 2).join("; "));
  check("terrain: an unstyled map has no terrain, no low ground and no props", !!opts.styled || (m.terrain.every((v) => v === TERRAIN_NONE) && m.tiles.every((v) => v !== TILE_LOW) && m.props.length === 0));
  let hazard = "";
  const kindAt = (x: number, y: number): number => m.terrain[y * W + x];
  const isHazard = (k: number): boolean => k !== TERRAIN_NONE && TERRAINS[k].tile === TILE_FLOOR;
  // A square of radius r around a tile: `any` kind (low ground included) or only floor hazards (ember, bog, ice, light).
  const plain = (cx: number, cy: number, r: number, what: string, only: "any" | "hazard", halo = false): void => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (halo && Math.abs(dx) === 3 && Math.abs(dy) === 3) continue;
        const k = kindAt(cx + dx, cy + dy);
        if (only === "any" ? k !== TERRAIN_NONE : isHazard(k)) hazard = `${what} at ${cx},${cy}`;
      }
    }
  };
  for (const s of pool) { plain(worldToTile(s.x), worldToTile(s.y), 1, "spawn 3x3", "any"); plain(worldToTile(s.x), worldToTile(s.y), 2, "spawn 5x5", "hazard"); }
  for (const c of m.crateSpots) { plain(worldToTile(c.x), worldToTile(c.y), 1, "crate 3x3", "any"); }
  for (const c of camps) plain(worldToTile(c.x), worldToTile(c.y), 3, "camp clearing and halo", "any", true);
  for (const g of m.groundSpots) { plain(worldToTile(g.x), worldToTile(g.y), 0, "ground spot", "any"); plain(worldToTile(g.x), worldToTile(g.y), 1, "ground spot 3x3", "hazard"); }
  check("terrain: no kind on a spawn 3x3, a crate 3x3, a camp clearing and halo or a ground spot; no floor hazard on a spawn 5x5 or a ground spot 3x3", hazard === "", () => hazard);
  // ICE keeps one tile of clear ground (validateTerrain T11, checked again here without the validator's code).
  let iceBad = "";
  for (let i = 0; i < N; i++) {
    if (m.terrain[i] !== TERRAIN_ICE) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.tiles[i + dy * W + dx] !== TILE_FLOOR) iceBad = `${i % W},${Math.floor(i / W)}`;
  }
  check("terrain: every ICE tile has floor on all eight sides", iceBad === "", () => iceBad);

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
  const kinds = codes.map(() => new Array<number>(TERRAINS.length).fill(0));
  for (let i = 0; i < N; i++) if (isZone(m.regionGrid[i]) && m.terrain[i] !== TERRAIN_NONE) kinds[m.regionGrid[i] - 1][m.terrain[i]]++;

  // --- styler=zone: the zone's own floor and the walk each spawn makes to the centre ------------------------------------------
  const zonePieces = codes.map(() => 0);
  const hazardExposure: number[] = [];
  if (opts.zone) {
    codes.forEach((c, z) => { zonePieces[z] = components(W, H, (i) => m.regionGrid[i] === c && move(m.tiles, i)).count; });
    // Floor kinds only on FLOOR, LOW kinds only on LOW or WALL, each kind in its home zone: validateTerrain T3/T6 again, in the certifier's words.
    let wrongHome = "";
    for (let i = 0; i < N; i++) {
      const k = m.terrain[i];
      if (k === TERRAIN_NONE) continue;
      const home = TERRAINS[k].home;
      if (home === null || !isZone(m.regionGrid[i]) || REGION_FACTIONS[m.regionGrid[i] - 1] !== home) wrongHome = `${TERRAINS[k].key} at ${i % W},${Math.floor(i / W)}`;
    }
    check("styler=zone: every terrain kind lies in its home zone", wrongHome === "", () => wrongHome);
    check("styler=zone: every zone's walkable floor is one 4-connected piece", zonePieces.every((n) => n === 1), () => zonePieces.join("/"));
    for (const p of pool) {
      const seen = new Set<number>();
      let ax = p.x, ay = p.y;
      for (const q of findPath(m, p, m.coliseum.centre)) {
        const steps = Math.ceil(Math.hypot(q.x - ax, q.y - ay) / 8);
        for (let k = 0; k <= steps; k++) {
          const x = ax + ((q.x - ax) * k) / Math.max(1, steps), y = ay + ((q.y - ay) * k) / Math.max(1, steps);
          const t = Math.floor(y / TILE) * W + Math.floor(x / TILE);
          if (m.terrain[t] !== TERRAIN_NONE) seen.add(t);
        }
        ax = q.x; ay = q.y;
      }
      hazardExposure.push(seen.size);
    }
  }
  return {
    failures,
    stats: {
      painted, floor, contact, slivers, radius, leashShare, pool: pool.length, poolZones: zonesIn.size, walkRatio57, walkRatioPath, hazardsOnWalks, rocks,
      features: m.features.length, kinds, zonePieces, hazardExposure,
    },
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

// ---- A demo zone style hook: low ground, floor hazards and styler walls for tests and sweeps ----------------------------

/**
 * One pass over every zone, each kind in its home zone: fire gets a meandering lava river 2 wide and up to 24 long with
 * ember on its free banks, sentenced three fences of 5-9 tiles with a gap, frost a
 * 6-tile crevasse with a gap and a 6x6 sheet of ice (only the tiles with plain floor on all eight sides), plague a 5x5 bog, holy a 3x3 patch of light; every zone two 2x2 walls.
 * With decor on, three props per zone from the decor stream (of an unknown kind while PROP_KINDS is empty, so the
 * generator drops them: the decor stream must change nothing else).
 */
export const demoStyleHook: ZoneStyleHook = ({ w, h, seed, attempt, decor, zone, zoneFaction, protect, tiles, terrain, props }) => {
  const N = w * h;
  for (let z = 1; z <= zoneFaction.length; z++) {
    const faction = zoneFaction[z - 1];
    const rng = styleRng(seed, attempt, REGION_FACTIONS.indexOf(faction) + 1, STYLE_STREAM.shape);
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
        }
      }
    } else if (faction === "frost") {
      const at = cells[randInt(rng, 0, cells.length)];
      const horiz = rng() < 0.5;
      for (let k = 0; k < 6; k++) { const t = at + (horiz ? k : k * w); if (k !== 3 && free(t)) low(t, TERRAIN_CREVASSE); }
      // A sheet of ICE: validateTerrain T11 wants every ICE tile to have plain floor on all eight sides, so only tiles that do take it.
      // The walls below and the generator's rocks may still stand beside it: the generator clears the ICE they touch.
      const iceAt = cells[randInt(rng, 0, cells.length)];
      for (let dy = 0; dy < 6; dy++) {
        for (let dx = 0; dx < 6; dx++) {
          const t = iceAt + dy * w + dx;
          let clear = free(t) && (t % w) + 1 < w;
          for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) clear = clear && tiles[t + d] === TILE_FLOOR;
          if (clear) terrain[t] = TERRAIN_ICE;
        }
      }
    } else if (faction === "plague") patch(5, TERRAIN_BOG);
    else if (faction === "holy") patch(3, TERRAIN_LIGHT);
    for (let b = 0; b < 2; b++) {
      const at = cells[randInt(rng, 0, cells.length)];
      for (const o of [0, 1, w, w + 1]) if (free(at + o)) tiles[at + o] = TILE_WALL;
    }
    if (decor) {
      const drng = styleRng(seed, attempt, REGION_FACTIONS.indexOf(faction) + 1, STYLE_STREAM.decor);
      for (let k = 0; k < 3; k++) {
        const at = cells[randInt(drng, 0, cells.length)];
        props.push({ kind: 0, x: tileToWorldCenter(at % w), y: tileToWorldCenter(Math.floor(at / w)), v: randInt(drng, 0, 256) });
      }
    }
  }
};
