// An independent certifier for generated maps: every guarantee of the map contract (map.ts) and the R2 gates
// (ROGUELIKE_PLAN R2), checked from the GameMap alone with checkers written apart from the generator (ports of the R1
// certifier and of the mapgen tests of the 64x64 generator it replaced). It never reads the generator's bookkeeping: the contract's numbers are
// written out here. Movement and sight go through the masks of map.ts: walkable is `(tile & MASK_MOVE) === 0` (TILE_LOW
// blocks it), see-through is `(tile & MASK_SIGHT) === 0` (TILE_LOW lets sight through).
//
// Zone shapes (contract section 6). Two kinds of result, kept apart:
//  - HARD: `certifyMap(...).failures`. A map with any failure is rejected. The shape gates (every zone WALL/LOW tile owned by a named
//    feature, no zone wall piece under 6 tiles, tile classes and terrain kinds that fit the feature kind, sizes, no feature on a camp
//    clearing/halo or a spawn pad) are the `strict` group: off while the old stylers run, on exactly when the generator's SHAPE_GATES
//    is (phase C flips that one constant), or per zone with `strict: [faction, ...]` (a zone WP's own tests).
//  - REPORT: `stats.zones[z]` (ZoneMeasures: ray profile, engagement pairs, camp graph with stretch and loops, wall pieces, terrain and
//    feature counts) judged against `ZONE_WINDOWS` (contract section 4's per-zone windows) and `SWEEP_THRESHOLDS`; a breach is
//    investigated, never an automatic failure. The measure functions are exported, pure and tested on hand-made grids.
// Only maps, masks, the sim's raycast and findPath are imported: nothing the generator uses to build what is checked here.
import { MAX_PLAYERS, TILE } from "../src/constants";
import { raycast } from "../src/geometry";
import {
  MASK_MOVE, MASK_SIGHT, REGION_COLISEUM, REGION_FACTIONS, REGION_NONE, REGION_WEAPONS, TILE_FLOOR, TILE_LOW, TILE_WALL, isWallTile, tileToWorldCenter,
  withGates, worldToTile,
} from "../src/map";
import type { GameMap, GateSide, RegionFaction, TilePt, TileRect } from "../src/map";
import type { Vec2 } from "../src/messages";
import { SHAPE_GATES, STYLE_STREAM, styleRng } from "../src/mapgen";
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

// ---- The measures' numbers (contract 6.2) ----
/** Ray profile: 24 directions k * 15 degrees, from the centre of every zone FLOOR tile with even x and even y, capped at 40 tiles. */
export const RAY_DIRECTIONS = 24;
export const RAY_CAP_TILES = 40;
/** The bow's range (7.5 tiles) and twice it: the two ray shares. */
export const BOW_TILES = 7.5;
export const FAR_TILES = 15;
/** Engagement pairs: a fixed LCG seeded 12345 + 7 * zoneIndex draws until PAIR_TARGET pairs 3 to 7.5 tiles apart (at most PAIR_DRAWS draws). */
export const PAIR_TARGET = 2500;
export const PAIR_DRAWS = 6000;
export const PAIR_MIN_TILES = 3;
export const PAIR_MAX_TILES = 7.5;
/** A camp-graph edge is traversable when its findPath route is at most ROUTE_MUL x the straight line + ROUTE_ADD_TILES. */
export const ROUTE_MUL = 1.5;
export const ROUTE_ADD_TILES = 4;
/** The ring road's Chebyshev width around the coliseum footprint: the front door lies RING_ROAD + 1 < distance <= RING_ROAD + 4. */
export const RING_ROAD_TILES = 3;
/** Wall pieces: under PIECE_MIN tiles is a defect (the shape gates), at least PIECE_BIG is a "big" piece. */
export const PIECE_MIN = 6;
export const PIECE_BIG = 12;
/** A landmark's interior (its box shrunk by one tile) must be at least this much floor. */
export const LANDMARK_INTERIOR_FLOOR = 0.6;
/** A landmark keeps this many tiles (Chebyshev) from every camp halo (clearing + 1). */
export const LANDMARK_HALO_GAP = 3;
/** The footprint (walls + LOW over painted tiles, percent) the shape pass may use: a report threshold. */
export const FOOTPRINT_MAX_PCT = 13;

// ---- The feature tables (contract 2.5-2.6, section 4), re-declared: map.ts's tables must equal these ----
export const CERT_FEATURE_KINDS = ["landmark", "crater", "lavaRiver", "fenceRow", "gallows", "barrow", "mere", "headland", "spire", "causeway", "hall", "infill"] as const;
export type CertFeatureKind = (typeof CERT_FEATURE_KINDS)[number];
export const CERT_FEATURE_JOBS = ["landmark", "pen", "crossing", "lane", "fork", "lee", "choke", "cover", "rest", "seal"] as const;
/** Landmark designs and the zone each belongs to (contract 5.2). */
export const LANDMARK_ZONE: Readonly<Record<string, RegionFaction>> = {
  forge: "fire", guardHouse: "sentenced", burrow: "plague", watchtower: "frost", shrine: "holy",
};
/** Tile classes a feature kind writes (WALL / LOW); a kind with neither owns floor only (a lake, a causeway). */
const KIND_WRITES: Readonly<Record<CertFeatureKind, { wall: boolean; low: boolean }>> = {
  landmark: { wall: true, low: false }, crater: { wall: true, low: false }, lavaRiver: { wall: false, low: true }, fenceRow: { wall: false, low: true },
  gallows: { wall: true, low: false }, barrow: { wall: true, low: false }, mere: { wall: false, low: false }, headland: { wall: true, low: false },
  spire: { wall: true, low: false }, causeway: { wall: false, low: false }, hall: { wall: true, low: false }, infill: { wall: true, low: false },
};
/** The terrain kind a LOW feature's tiles carry. */
const KIND_TERRAIN: Readonly<Partial<Record<CertFeatureKind, number>>> = { lavaRiver: TERRAIN_LAVA, fenceRow: TERRAIN_FENCE };
/** The jobs each kind may carry (section 4: the sets a styler names); a landmark always names "landmark". */
const KIND_JOBS: Readonly<Record<CertFeatureKind, readonly string[]>> = {
  landmark: ["landmark", "lee", "fork", "rest"], crater: ["pen"], lavaRiver: ["crossing"], fenceRow: ["lane"], gallows: ["landmark"],
  barrow: ["fork", "choke"], mere: ["crossing"], headland: ["lee"], spire: ["landmark"], causeway: ["crossing", "lee"], hall: ["cover", "rest"], infill: ["seal"],
};

/** Ownership of floor hazards (ember, bog, ice, light) is a strict check of its own: the generator's gate speaks of WALL/LOW tiles. */
export const STRICT_HAZARD_OWNERSHIP = true;

export interface RayProfile {
  /** Zone FLOOR tiles with even x and even y. */
  samples: number;
  rays: number;
  /** Mean ray length in tiles. */
  mean: number;
  /** Share of rays at least BOW_TILES / FAR_TILES long (0..1). */
  share75: number;
  share15: number;
  /** Mean of min(r, 7.5) / 7.5. */
  openBow: number;
}

export interface PairProfile {
  /** LCG draws used and pairs kept (3 to 7.5 tiles apart, both ends zone FLOOR). */
  draws: number;
  pairs: number;
  /** Shares of the kept pairs (they sum to 1): a wall between them, else only LOW ground, else clear. */
  wallBlocked: number;
  lowSeparated: number;
  clear: number;
}

export interface GraphNode { x: number; y: number; kind: "camp" | "door"; camp: number }

export interface CampGraph {
  nodes: GraphNode[];
  /** Gabriel edges [a, b], a < b. */
  edges: Array<readonly [number, number]>;
  /** Per edge: findPath length / straight length (0 when there is no route). */
  stretch: number[];
  /** Per edge: the route stays within ROUTE_MUL x straight + ROUTE_ADD_TILES. */
  traversable: boolean[];
  /** Camp-camp edges only: mean and max stretch over those with a route. */
  stretchMean: number;
  stretchMax: number;
  campEdges: number;
  /** E - V + C over the traversable edges. */
  loops: number;
}

export interface PieceStats {
  /** 8-connected pieces of the class inside the zone. */
  count: number;
  tiles: number;
  singles: number;
  /** Pieces under PIECE_MIN tiles (singles included). */
  under6: number;
  /** Share of the class's tiles that lie in pieces of at least PIECE_BIG tiles. */
  bigShare: number;
  largest: number;
  /** Every piece's size, ascending. */
  sizes: number[];
}

export interface ZoneMeasures {
  zone: RegionFaction;
  painted: number;
  floor: number;
  walls: number;
  lows: number;
  /** (walls + lows) / painted, percent. */
  footprint: number;
  rays: RayProfile;
  pairs: PairProfile;
  graph: CampGraph;
  wallPieces: PieceStats;
  lowPieces: PieceStats;
  /** Tiles of each terrain kind in the zone (index = kind id). */
  terrain: number[];
  /** ICE tiles over the zone's FLOOR tiles, percent. */
  iceShare: number;
  /** The zone's features by kind. */
  features: Record<string, number>;
  /** Barrows with a tunnel (p[1] === 1), a hall's piers (p[3]). */
  tunnels: number;
  piers: number;
  /** Tiles owned by the zone's infill features. */
  infillTiles: number;
  /** Tiles between the zone's two elite camps (0 with fewer than two). */
  eliteSep: number;
}

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
  /** Features of the whole map by kind. */
  featureKinds: Record<string, number>;
  /** Per zone (REGION_FACTIONS order): tiles of each terrain kind (index = kind id), walls included for the LOW kinds' pillars. */
  kinds: number[][];
  /** Per zone: the walkable floor's 4-connected pieces (zone mode only; 0 otherwise). */
  zonePieces: number[];
  /** Per pool member (zone mode only): distinct terrain tiles its findPath route to the centre crosses. Report only (contract 0.8). */
  hazardExposure: number[];
  /** The report measures per zone in REGION_FACTIONS order (empty when `measures` is off). */
  zones: ZoneMeasures[];
  /** The zone codes the strict group ran on (empty: it did not run). */
  strictZones: number[];
}

export interface CertifyOptions {
  /** The zone stylers ran: validateTerrain checks LOW kinds (T10). */
  styled?: boolean;
  /** `styler=zone`: the generator's own zone stylers ran. Implies `styled`, and adds the zone-floor connectivity check and the spawn-to-centre hazard exposure. */
  zone?: boolean;
  /**
   * The shape gates' checks (ownership, wall pieces, tile classes, sizes, no overlap): true = every zone, a list = those zones only
   * (a zone WP's own tests: the other zones still run the old stylers), false = none. Default: every zone in `zone` mode exactly when
   * the generator's SHAPE_GATES is on (phase C flips that constant and this follows), none otherwise.
   */
  strict?: boolean | readonly RegionFaction[];
  /** Compute the per-zone report measures (stats.zones). Default: on in `zone` mode. */
  measures?: boolean;
}

/** The zone codes `strict` selects (see CertifyOptions.strict). */
export function strictZoneCodes(zone: boolean, strict: CertifyOptions["strict"]): number[] {
  const all = REGION_FACTIONS.map((_, z) => z + 1);
  if (strict === undefined) return zone && SHAPE_GATES ? all : [];
  if (strict === false) return [];
  if (strict === true) return all;
  return strict.map((f) => REGION_FACTIONS.indexOf(f) + 1);
}

/** Runs every per-map check; returns the failures (empty when the map certifies) and the measured numbers. */
export function certifyMap(m: GameMap, copts: CertifyOptions = {}): { failures: string[]; stats: MapStats } {
  const opts = { styled: !!(copts.styled || copts.zone), zone: !!copts.zone };
  const strictCodes = strictZoneCodes(opts.zone, copts.strict);
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
      // One sample per world unit (1/32 of a tile): a tile the polyline only grazes by less than that is missed, the generator's DDA does not.
      const steps = Math.ceil(Math.sqrt((q.x - ax) * (q.x - ax) + (q.y - ay) * (q.y - ay)));
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
  for (let n = 0; interleaved.length < pool.length && n < pool.length; n++) for (const r of m.regions) if (r.spawns[n]) interleaved.push(r.spawns[n]);
  if (JSON.stringify(m.spawns) !== JSON.stringify(interleaved)) views = "spawns not interleaved by zone";
  if (JSON.stringify(m.crateSpots) !== JSON.stringify(m.regions.flatMap((r) => r.chestSpots))) views = "crateSpots";
  check("views: mobCamps, region spawns, spawns, crateSpots derive from camps and the pool; area is painted; pole is outdoor floor in the zone", views === "", () => views);

  // --- Features and pieces -----------------------------------------------------------------------------------------------
  // The tables, the ownership grid, the landmarks' rules and the order always run; the shape gates (every zone WALL/LOW tile owned, no
  // zone wall piece under 6 tiles, tile classes, sizes, no overlap with a clearing or a spawn pad) run on the strict zones only.
  for (const f of featureProblems(m, strictCodes)) failures.push(f);
  if (strictCodes.length > 0) for (const f of pieceProblems(m, strictCodes)) failures.push(f);

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
  // --- The report measures (contract 6.2): never failures --------------------------------------------------------------------
  const wantMeasures = copts.measures ?? opts.zone;
  const zones = wantMeasures ? REGION_FACTIONS.map((_, z) => zoneMeasures(m, z)) : [];
  const featureKinds: Record<string, number> = {};
  for (const f of m.features) featureKinds[f.kind] = (featureKinds[f.kind] ?? 0) + 1;
  return {
    failures,
    stats: {
      painted, floor, contact, slivers, radius, leashShare, pool: pool.length, poolZones: zonesIn.size, walkRatio57, walkRatioPath, hazardsOnWalks, rocks,
      features: m.features.length, featureKinds, kinds, zonePieces, hazardExposure, zones, strictZones: strictCodes,
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

// ---- The report measures (contract 6.2): pure, exported, tested on hand-made grids ---------------------------------------------

const zoneCodeOf = (f: RegionFaction): number => REGION_FACTIONS.indexOf(f) + 1;
const tileOf = (m: GameMap, p: Vec2): number => worldToTile(p.y) * m.w + worldToTile(p.x);

/** 4- or 8-connected pieces of `ok` tiles: sizes in discovery order and the label of every tile (-1 off). */
export function pieces(w: number, h: number, ok: (i: number) => boolean, eight: boolean): { sizes: number[]; label: Int32Array } {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const sizes: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] >= 0 || !ok(s)) continue;
    const id = sizes.length;
    let top = 0, size = 0;
    stack[top++] = s;
    label[s] = id;
    while (top > 0) {
      const c = stack[--top], x = c % w, y = (c - x) / w;
      size++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (label[j] >= 0 || !ok(j)) continue;
          label[j] = id;
          stack[top++] = j;
        }
      }
    }
    sizes.push(size);
  }
  return { sizes, label };
}

/**
 * 8-connected pieces of tile class `cls` (TILE_WALL or TILE_LOW) lying in zone `code`: count, singles, pieces under PIECE_MIN, the share
 * of the class's tiles in pieces of at least PIECE_BIG, the largest.
 */
export function pieceStats(m: GameMap, code: number, cls: number): PieceStats {
  const { sizes } = pieces(m.w, m.h, (i) => m.regionGrid[i] === code && m.tiles[i] === cls, true);
  const tiles = sizes.reduce((a, v) => a + v, 0);
  const big = sizes.filter((v) => v >= PIECE_BIG).reduce((a, v) => a + v, 0);
  return {
    count: sizes.length, tiles, singles: sizes.filter((v) => v === 1).length, under6: sizes.filter((v) => v < PIECE_MIN).length,
    bigShare: tiles === 0 ? 0 : big / tiles, largest: sizes.length === 0 ? 0 : Math.max(...sizes), sizes: [...sizes].sort((a, b) => a - b),
  };
}

// ---- Ray profile ----
const DIR_COS = Array.from({ length: RAY_DIRECTIONS }, (_, k) => Math.cos((k * 2 * Math.PI) / RAY_DIRECTIONS));
const DIR_SIN = Array.from({ length: RAY_DIRECTIONS }, (_, k) => Math.sin((k * 2 * Math.PI) / RAY_DIRECTIONS));

/** The 24 ray lengths (tiles, capped at RAY_CAP_TILES) from the centre of tile (tx, ty) under MASK_SIGHT: walls stop a ray, LOW does not. */
export function rayLengthsAt(m: GameMap, tx: number, ty: number): number[] {
  const x0 = tileToWorldCenter(tx), y0 = tileToWorldCenter(ty), reach = RAY_CAP_TILES * TILE;
  const out: number[] = [];
  for (let k = 0; k < RAY_DIRECTIONS; k++) {
    const r = raycast(m, x0, y0, x0 + DIR_COS[k] * reach, y0 + DIR_SIN[k] * reach, MASK_SIGHT);
    out.push(Math.min(RAY_CAP_TILES, r.dist / TILE));
  }
  return out;
}

/** The ray profile of zone `code`: samples are its FLOOR tiles with even x and even y. */
export function rayProfile(m: GameMap, code: number): RayProfile {
  let samples = 0, rays = 0, sum = 0, n75 = 0, n15 = 0, open = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    const x = i % m.w, y = (i - x) / m.w;
    if ((x & 1) || (y & 1) || m.regionGrid[i] !== code || m.tiles[i] !== TILE_FLOOR) continue;
    samples++;
    for (const r of rayLengthsAt(m, x, y)) {
      rays++;
      sum += r;
      if (r >= BOW_TILES) n75++;
      if (r >= FAR_TILES) n15++;
      open += Math.min(r, BOW_TILES) / BOW_TILES;
    }
  }
  return { samples, rays, mean: rays ? sum / rays : 0, share75: rays ? n75 / rays : 0, share15: rays ? n15 / rays : 0, openBow: rays ? open / rays : 0 };
}

// ---- Engagement pairs ----
/** The LCG of the pair sampling: s -> (s * 1103515245 + 12345) mod 2^31, exact (Math.imul wraps mod 2^32; the mask keeps 31 bits). */
export const lcgNext = (s: number): number => (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;

/**
 * Calls visit(tile index) for every tile the segment between the centres of tiles (ax, ay) and (bx, by) passes through, both ends
 * included. A segment through a tile corner visits both tiles it squeezes between and the one beyond (the rule of the sim's raycast).
 * Exact integer arithmetic. `visit` returning true stops the walk and the function returns true.
 */
export function walkSegment(w: number, ax: number, ay: number, bx: number, by: number, visit: (i: number) => boolean | void): boolean {
  const sx = Math.sign(bx - ax), sy = Math.sign(by - ay), nx = Math.abs(bx - ax), ny = Math.abs(by - ay);
  let x = ax, y = ay, ix = 0, iy = 0;
  if (visit(y * w + x)) return true;
  while (ix < nx || iy < ny) {
    // The next vertical grid line is crossed at (ix + 1/2) / nx of the segment, the next horizontal one at (iy + 1/2) / ny.
    const lhs = (1 + 2 * ix) * ny, rhs = (1 + 2 * iy) * nx;
    if (ix < nx && iy < ny && lhs === rhs) {
      if (visit(y * w + x + sx) || visit((y + sy) * w + x)) return true;
      x += sx; y += sy; ix++; iy++;
    } else if (iy >= ny || (ix < nx && lhs < rhs)) {
      x += sx; ix++;
    } else {
      y += sy; iy++;
    }
    if (visit(y * w + x)) return true;
  }
  return false;
}

/**
 * The engagement pairs of zone `code` (the zone's index in REGION_FACTIONS is `zoneIndex`): a fixed LCG seeded 12345 + 7 * zoneIndex
 * draws a zone FLOOR tile A, then an offset (dx, dy) in [-7, 7]^2; the pair (A, B = A + offset) counts when B is a zone FLOOR tile and
 * 3 <= distance <= 7.5 tiles between centres. It stops at PAIR_TARGET pairs or PAIR_DRAWS draws. Each pair is wall-blocked (the sim's
 * raycast under MASK_SIGHT hits), else LOW-separated (the segment crosses a LOW tile), else clear.
 */
export function engagementPairs(m: GameMap, code: number, zoneIndex: number): PairProfile {
  const W = m.w, cells: number[] = [];
  for (let i = 0; i < W * m.h; i++) if (m.regionGrid[i] === code && m.tiles[i] === TILE_FLOOR) cells.push(i);
  let s = 12345 + 7 * zoneIndex, draws = 0, pairs = 0, wall = 0, low = 0;
  if (cells.length === 0) return { draws, pairs, wallBlocked: 0, lowSeparated: 0, clear: 0 };
  // The low bits of a power-of-two LCG are weak: every draw uses bits 8 and up.
  const draw = (n: number): number => { s = lcgNext(s); return (s >>> 8) % n; };
  const lowAt = (i: number): boolean => (m.tiles[i] & TILE_LOW) !== 0;
  while (draws < PAIR_DRAWS && pairs < PAIR_TARGET) {
    draws++;
    const a = cells[draw(cells.length)], dx = draw(15) - 7, dy = draw(15) - 7;
    const d2 = dx * dx + dy * dy;
    if (d2 < PAIR_MIN_TILES * PAIR_MIN_TILES || d2 > PAIR_MAX_TILES * PAIR_MAX_TILES) continue;
    const ax = a % W, ay = (a - ax) / W, bx = ax + dx, by = ay + dy;
    if (bx < 0 || by < 0 || bx >= W || by >= m.h) continue;
    const b = by * W + bx;
    if (m.regionGrid[b] !== code || m.tiles[b] !== TILE_FLOOR) continue;
    pairs++;
    if (raycast(m, tileToWorldCenter(ax), tileToWorldCenter(ay), tileToWorldCenter(bx), tileToWorldCenter(by), MASK_SIGHT).hit) wall++;
    else if (walkSegment(W, ax, ay, bx, by, lowAt)) low++;
  }
  return { draws, pairs, wallBlocked: pairs ? wall / pairs : 0, lowSeparated: pairs ? low / pairs : 0, clear: pairs ? (pairs - wall - low) / pairs : 0 };
}

// ---- Camp graph ----

/** Chebyshev distance (tiles, capped at `cap`) from the coliseum region, 255 beyond. */
function coliseumDistance(m: GameMap, cap: number): Uint8Array {
  const W = m.w, N = W * m.h, d = new Uint8Array(N).fill(255), queue = new Int32Array(N);
  let head = 0, tail = 0;
  for (let i = 0; i < N; i++) if (m.regionGrid[i] === REGION_COLISEUM) { d[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    if (d[i] >= cap) continue;
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= m.h || d[ny * W + nx] !== 255) continue;
        d[ny * W + nx] = d[i] + 1;
        queue[tail++] = ny * W + nx;
      }
    }
  }
  return d;
}

/**
 * The nodes of a zone's camp graph: its camps in `m.camps` order, then its front door: the zone FLOOR tile at ring distance RING_ROAD + 1
 * < d <= RING_ROAD + 4 from the coliseum footprint nearest the centroid of the zone's painted tiles (ties lowest index). No door when no
 * tile qualifies (a map without a coliseum).
 */
export function campGraphNodes(m: GameMap, faction: RegionFaction): GraphNode[] {
  const W = m.w, code = zoneCodeOf(faction), out: GraphNode[] = [];
  m.camps.forEach((c, k) => { if (c.zone === faction) out.push({ x: worldToTile(c.x), y: worldToTile(c.y), kind: "camp", camp: k }); });
  let n = 0, cx = 0, cy = 0;
  for (let i = 0; i < W * m.h; i++) if (m.regionGrid[i] === code) { n++; cx += (i % W) + 0.5; cy += Math.floor(i / W) + 0.5; }
  if (n === 0) return out;
  cx /= n; cy /= n;
  const d = coliseumDistance(m, RING_ROAD_TILES + 4);
  let best = -1, bd = Infinity;
  for (let i = 0; i < W * m.h; i++) {
    if (m.regionGrid[i] !== code || m.tiles[i] !== TILE_FLOOR || d[i] <= RING_ROAD_TILES + 1 || d[i] > RING_ROAD_TILES + 4) continue;
    const ex = (i % W) + 0.5 - cx, ey = Math.floor(i / W) + 0.5 - cy, e = ex * ex + ey * ey;
    if (e < bd) { bd = e; best = i; }
  }
  if (best >= 0) out.push({ x: best % W, y: Math.floor(best / W), kind: "door", camp: -1 });
  return out;
}

/** The Gabriel graph: (a, b) is an edge when no third node k has (2xk - xa - xb)^2 + (2yk - ya - yb)^2 < (xa - xb)^2 + (ya - yb)^2. */
export function gabriel(nodes: readonly { x: number; y: number }[]): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y, d2 = dx * dx + dy * dy;
      let ok = true;
      for (let k = 0; k < nodes.length && ok; k++) {
        if (k === a || k === b) continue;
        const ex = 2 * nodes[k].x - nodes[a].x - nodes[b].x, ey = 2 * nodes[k].y - nodes[a].y - nodes[b].y;
        if (ex * ex + ey * ey < d2) ok = false;
      }
      if (ok) out.push([a, b]);
    }
  }
  return out;
}

/** E - V + C of a graph given by its edges over `n` nodes. */
export function cyclomaticNumber(n: number, edges: ReadonlyArray<readonly [number, number]>): number {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  let comps = n;
  for (const [a, b] of edges) { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = rb; comps--; } }
  return edges.length - n + comps;
}

/** A findPath route's length in world units from `a` through its waypoints, or 0 when there is none. */
export function routeLength(m: GameMap, a: Vec2, b: Vec2): number {
  const path = findPath(m, a, b);
  let len = 0, px = a.x, py = a.y;
  for (const q of path) { len += Math.sqrt((q.x - px) * (q.x - px) + (q.y - py) * (q.y - py)); px = q.x; py = q.y; }
  return path.length === 0 ? 0 : len;
}

/**
 * The zone's camp graph: nodes (camps + front door), Gabriel edges, and for each edge the stretch (findPath route over the straight line
 * between the node centres) and whether it is traversable (route <= ROUTE_MUL x straight + ROUTE_ADD_TILES). `loops` is E - V + C over
 * the traversable edges; the stretch mean and max cover the camp-camp edges that have a route.
 */
export function campGraph(m: GameMap, faction: RegionFaction): CampGraph {
  const nodes = campGraphNodes(m, faction), edges = gabriel(nodes);
  const stretch: number[] = [], traversable: boolean[] = [];
  const camp: number[] = [];
  edges.forEach(([a, b]) => {
    const pa = { x: tileToWorldCenter(nodes[a].x), y: tileToWorldCenter(nodes[a].y) }, pb = { x: tileToWorldCenter(nodes[b].x), y: tileToWorldCenter(nodes[b].y) };
    const straight = Math.sqrt((pa.x - pb.x) * (pa.x - pb.x) + (pa.y - pb.y) * (pa.y - pb.y)), route = routeLength(m, pa, pb);
    stretch.push(route > 0 && straight > 0 ? route / straight : 0);
    traversable.push(route > 0 && route <= ROUTE_MUL * straight + ROUTE_ADD_TILES * TILE);
    if (nodes[a].kind === "camp" && nodes[b].kind === "camp" && route > 0) camp.push(stretch[stretch.length - 1]);
  });
  const kept = edges.filter((_, k) => traversable[k]);
  return {
    nodes, edges, stretch, traversable, campEdges: edges.filter(([a, b]) => nodes[a].kind === "camp" && nodes[b].kind === "camp").length,
    stretchMean: camp.length ? camp.reduce((a, v) => a + v, 0) / camp.length : 0, stretchMax: camp.length ? Math.max(...camp) : 0,
    loops: cyclomaticNumber(nodes.length, kept),
  };
}

/** Every report measure of zone `zi` (its index in REGION_FACTIONS). */
export function zoneMeasures(m: GameMap, zi: number): ZoneMeasures {
  const code = zi + 1, faction = REGION_FACTIONS[zi], N = m.w * m.h;
  let painted = 0, floor = 0, walls = 0, lows = 0;
  const terrain = new Array<number>(TERRAINS.length).fill(0);
  for (let i = 0; i < N; i++) {
    if (m.regionGrid[i] !== code) continue;
    painted++;
    if (m.tiles[i] === TILE_FLOOR) floor++;
    else if (m.tiles[i] === TILE_WALL) walls++;
    else if (m.tiles[i] === TILE_LOW) lows++;
    if (m.terrain[i] !== TERRAIN_NONE) terrain[m.terrain[i]]++;
  }
  const features: Record<string, number> = {};
  let tunnels = 0, piers = 0, infillTiles = 0;
  for (const f of m.features) {
    if (f.zone !== faction) continue;
    features[f.kind] = (features[f.kind] ?? 0) + 1;
    if (f.kind === "barrow" && f.p[1] === 1) tunnels++;
    if (f.kind === "hall") piers += f.p[3] ?? 0;
    if (f.kind === "infill") infillTiles += f.tiles;
  }
  const elites = m.camps.filter((c) => c.zone === faction && c.eliteSpot >= 0);
  const eliteSep = elites.length >= 2 ? Math.sqrt((elites[0].x - elites[1].x) * (elites[0].x - elites[1].x) + (elites[0].y - elites[1].y) * (elites[0].y - elites[1].y)) / TILE : 0;
  return {
    zone: faction, painted, floor, walls, lows, footprint: painted ? (100 * (walls + lows)) / painted : 0,
    rays: rayProfile(m, code), pairs: engagementPairs(m, code, zi), graph: campGraph(m, faction),
    wallPieces: pieceStats(m, code, TILE_WALL), lowPieces: pieceStats(m, code, TILE_LOW), terrain,
    iceShare: floor ? (100 * terrain[TERRAIN_ICE]) / floor : 0, features, tunnels, piers, infillTiles, eliteSep,
  };
}

// ---- Features, ownership and pieces (contract 6.1 gates, 6.2 ownership) ----------------------------------------------------------

/** First line of every failure of featureProblems, so a test (or a reader) can tell the checks apart. */
export const FEATURE_CHECKS = {
  grid: "features: featureGrid is a w*h Uint8Array naming at most 250 features",
  table: "features: kind, variant, jobs, zone, params, anchor and box are in the tables and well formed",
  tiles: "features: each feature's tiles equals its count in featureGrid, and its box contains them",
  zone: "features: a feature owns tiles of its own zone only",
  order: "features: in order: zones in REGION_FACTIONS order; a zone's landmarks first, its one infill last",
  landmark: "features: a landmark names its zone's design, keeps its box + 1 inside the zone and 3 tiles from every camp halo, has doors 2+ wide and an interior at least 60% floor",
  buildings: "features: map.buildings holds the landmarks' boxes, one each",
  unowned: "features: every zone WALL or LOW tile belongs to a feature (strict)",
  hazards: "features: every zone tile with a floor hazard belongs to a feature (strict)",
  kindTiles: "features: a feature's WALL and LOW tiles fit its kind, and its LOW tiles carry the kind's terrain (strict)",
  size: "features: a wall or LOW feature owns at least 6 such tiles (strict)",
  overlap: "features: no feature puts a wall or LOW tile on a camp clearing, halo or spawn pad (owned floor may: a crater bowl, a hall aisle) (strict)",
  jobs: "features: a feature's jobs are the ones its kind may carry (strict)",
  pieces: "pieces: no zone WALL 8-piece has fewer than 6 tiles, so no single tile (strict)",
} as const;

/** The camps' halos (clearing of radius 2.5 tiles grown by one tile) and the spawn pool's 3x3 pads, as masks. */
function protectedMasks(m: GameMap): { halo: Uint8Array; pad: Uint8Array } {
  const W = m.w, N = W * m.h, halo = new Uint8Array(N), pad = new Uint8Array(N);
  for (const c of m.camps) {
    const cx = worldToTile(c.x), cy = worldToTile(c.y);
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        // A tile is in the halo when it touches (8-neighbourhood) a clearing tile: centre distance at most 2.5 tiles.
        let near = false;
        for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if ((dx + ox) * (dx + ox) + (dy + oy) * (dy + oy) <= 6.25) { near = true; break; }
        const x = cx + dx, y = cy + dy;
        if (near && x >= 0 && y >= 0 && x < W && y < m.h) halo[y * W + x] = 1;
      }
    }
  }
  for (const s of m.spawnPool) {
    const sx = worldToTile(s.x), sy = worldToTile(s.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = sx + dx, y = sy + dy; if (x >= 0 && y >= 0 && x < W && y < m.h) pad[y * W + x] = 1; }
  }
  return { halo, pad };
}

/**
 * The feature checks. Always: the grid, the tables, the counts and boxes, the zone of every owned tile, the order, the landmarks'
 * rules, the buildings. For `strict` zone codes: every WALL or LOW tile (and floor hazard) of those zones is owned, the owner's kind
 * fits the tile, sizes, overlaps and jobs. Each string is `FEATURE_CHECKS.<name>: why`.
 */
export function featureProblems(m: GameMap, strict: readonly number[] = []): string[] {
  const out: string[] = [], W = m.w, H = m.h, N = W * H, F = m.features;
  const once = new Set<string>();
  const add = (check: keyof typeof FEATURE_CHECKS, key: string, why: string): void => {
    if (once.has(`${check}|${key}`)) return;
    once.add(`${check}|${key}`);
    out.push(`${FEATURE_CHECKS[check]}: ${why}`);
  };
  if (!(m.featureGrid instanceof Uint8Array) || m.featureGrid.length !== N) { add("grid", "g", "featureGrid is not a w*h Uint8Array"); return out; }
  if (F.length > FEATURES_MAX) add("grid", "count", `${F.length} features`);
  const where = (i: number): string => `${i % W},${Math.floor(i / W)}`;
  const strictSet = new Set(strict);
  const kindSet = new Set<string>(CERT_FEATURE_KINDS), jobSet = new Set<string>(CERT_FEATURE_JOBS);
  const owned = new Array<number>(F.length + 1).fill(0), walls = new Array<number>(F.length + 1).fill(0);
  const zoneIdx = (f: { zone: string }): number => REGION_FACTIONS.indexOf(f.zone as RegionFaction);

  F.forEach((f, k) => {
    const id = `feature ${k} (${f.kind})`;
    if (!kindSet.has(f.kind)) add("table", `kind${k}`, `${id} has a kind outside the table`);
    if (zoneIdx(f) < 0) add("table", `zone${k}`, `${id} names no zone`);
    if (!Array.isArray(f.jobs) || f.jobs.length < 1 || f.jobs.length > 2 || new Set(f.jobs).size !== f.jobs.length || f.jobs.some((j) => !jobSet.has(j))) add("table", `jobs${k}`, `${id} needs one or two distinct jobs from the table`);
    const variantOk = f.kind === "landmark" ? f.variant in LANDMARK_ZONE : f.variant === "";
    if (!variantOk) add("table", `variant${k}`, `${id} has variant "${f.variant}"`);
    if (!Array.isArray(f.p) || f.p.some((v) => !Number.isInteger(v))) add("table", `p${k}`, `${id} has params that are not integers`);
    if (!Number.isInteger(f.ax) || !Number.isInteger(f.ay) || f.ax < 0 || f.ay < 0 || f.ax >= W || f.ay >= H) add("table", `anchor${k}`, `${id} has an anchor off the map`);
    const b = f.bbox;
    if (!b || ![b.x, b.y, b.w, b.h].every(Number.isInteger) || b.w < 1 || b.h < 1 || b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) add("table", `box${k}`, `${id} has a box off the map`);
  });
  for (let i = 0; i < N; i++) {
    const v = m.featureGrid[i];
    if (v === 0) continue;
    if (v > F.length) { add("grid", `v${v}`, `featureGrid names feature ${v - 1} at ${where(i)} of ${F.length}`); continue; }
    owned[v]++;
    if (m.tiles[i] !== TILE_FLOOR) walls[v]++;
    const f = F[v - 1], code = zoneCodeOf(f.zone as RegionFaction);
    if (f.bbox && !inRect(f.bbox, i % W, Math.floor(i / W))) add("tiles", `box${v}`, `feature ${v - 1} owns ${where(i)} outside its box`);
    if (m.regionGrid[i] !== code) add("zone", `z${v}`, `feature ${v - 1} (${f.kind}, ${f.zone}) owns ${where(i)} of region ${m.regionGrid[i]}`);
  }
  F.forEach((f, k) => { if (f.tiles !== owned[k + 1] || owned[k + 1] === 0) add("tiles", `n${k}`, `feature ${k} (${f.kind}) counts ${f.tiles} tiles, owns ${owned[k + 1]}`); });

  // Order: zones in REGION_FACTIONS order; in a zone landmarks first, at most one infill and it last.
  let lastZone = -1, stage = 0, infills = 0;
  F.forEach((f, k) => {
    const z = zoneIdx(f);
    if (z < lastZone) add("order", `z${k}`, `feature ${k} (${f.zone}) comes after a later zone`);
    if (z !== lastZone) { lastZone = z; stage = 0; infills = 0; }
    const rank = f.kind === "landmark" ? 0 : f.kind === "infill" ? 2 : 1;
    if (rank < stage) add("order", `r${k}`, `feature ${k} (${f.kind}) breaks the landmarks, shapes, infill order of its zone`);
    stage = Math.max(stage, rank);
    if (f.kind === "infill" && ++infills > 1) add("order", `i${k}`, `zone ${f.zone} has more than one infill`);
  });

  // Landmarks.
  const { halo, pad } = protectedMasks(m);
  const landmarks = F.map((f, k) => ({ f, k })).filter((e) => e.f.kind === "landmark");
  const near = new Uint8Array(N); // tiles within LANDMARK_HALO_GAP - 1 (Chebyshev) of a halo tile
  if (landmarks.length > 0) {
    const r = LANDMARK_HALO_GAP - 1;
    for (let i = 0; i < N; i++) {
      if (!halo[i]) continue;
      const x = i % W, y = (i - x) / W;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) near[ny * W + nx] = 1; }
    }
  }
  for (const { f, k } of landmarks) {
    const id = `landmark ${k} (${f.variant})`, code = zoneCodeOf(f.zone as RegionFaction), b = f.bbox;
    if (LANDMARK_ZONE[f.variant] !== undefined && LANDMARK_ZONE[f.variant] !== f.zone) add("landmark", `d${k}`, `${id} is a ${LANDMARK_ZONE[f.variant]} design in the ${f.zone} zone`);
    if (!b || b.x < 1 || b.y < 1 || b.x + b.w > W - 1 || b.y + b.h > H - 1) { add("landmark", `m${k}`, `${id} has no room for its margin`); continue; }
    let margin = true;
    for (let y = b.y - 1; y <= b.y + b.h && margin; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (m.regionGrid[y * W + x] !== code) { margin = false; break; }
    if (!margin) add("landmark", `m${k}`, `${id}: its box + 1 leaves the zone`);
    const tiles: number[] = [];
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (m.featureGrid[y * W + x] === k + 1) tiles.push(y * W + x);
    if (tiles.some((i) => near[i])) add("landmark", `h${k}`, `${id} is closer than ${LANDMARK_HALO_GAP} tiles to a camp halo`);
    // Doors: the template's door tiles are p[2..]; each 4-connected run of them is at least 2 wide, and a door tile is walkable.
    const doors = f.p.slice(2);
    const doorSet = new Set(doors);
    if (doors.length === 0) add("landmark", `o${k}`, `${id} has no door`);
    if (doors.some((i) => i < 0 || i >= N || m.tiles[i] !== TILE_FLOOR || m.featureGrid[i] !== k + 1)) add("landmark", `o${k}`, `${id} has a door that is not an owned floor tile`);
    for (const d of doors) {
      let run = 1;
      const stack = [d], seen = new Set([d]);
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of [c + 1, c - 1, c + W, c - W]) if (doorSet.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); run++; }
      }
      if (run < 2) { add("landmark", `o${k}`, `${id} has a door ${where(d)} one tile wide`); break; }
    }
    // Interior: the box shrunk by one tile is at least LANDMARK_INTERIOR_FLOOR walkable floor.
    let cells = 0, fl = 0;
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) { cells++; if (m.tiles[y * W + x] === TILE_FLOOR) fl++; }
    if (cells > 0 && fl < LANDMARK_INTERIOR_FLOOR * cells) add("landmark", `f${k}`, `${id}: only ${fl} of ${cells} interior tiles are floor`);
  }
  // buildings: one box per landmark, each landmark's box inside a building box.
  if (m.buildings.length !== landmarks.length) add("buildings", "n", `${m.buildings.length} buildings for ${landmarks.length} landmarks`);
  else for (const { f, k } of landmarks) {
    const b = f.bbox;
    if (!m.buildings.some((q) => b.x >= q.x && b.y >= q.y && b.x + b.w <= q.x + q.w && b.y + b.h <= q.y + q.h)) add("buildings", `b${k}`, `landmark ${k} has no building box around it`);
  }

  if (strictSet.size === 0) return out;

  // ---- Strict: the shape gates ----
  let unowned = 0, firstUnowned = -1, unownedHazard = 0, firstHazard = -1;
  for (let i = 0; i < N; i++) {
    const code = m.regionGrid[i];
    if (!strictSet.has(code)) continue;
    const v = m.featureGrid[i], t = m.tiles[i];
    if (v === 0 && (t === TILE_WALL || t === TILE_LOW)) { unowned++; if (firstUnowned < 0) firstUnowned = i; }
    if (STRICT_HAZARD_OWNERSHIP && v === 0 && t === TILE_FLOOR && m.terrain[i] !== TERRAIN_NONE) { unownedHazard++; if (firstHazard < 0) firstHazard = i; }
    if (v === 0 || v > F.length) continue;
    const f = F[v - 1], kind = f.kind as CertFeatureKind;
    if (!kindSet.has(kind)) continue;
    const writes = KIND_WRITES[kind];
    if ((t === TILE_WALL && !writes.wall) || (t === TILE_LOW && !writes.low)) add("kindTiles", `c${v}`, `feature ${v - 1} (${kind}) owns a ${t === TILE_WALL ? "WALL" : "LOW"} tile at ${where(i)}`);
    const want = KIND_TERRAIN[kind];
    if (t === TILE_LOW && want !== undefined && m.terrain[i] !== want) add("kindTiles", `t${v}`, `feature ${v - 1} (${kind}) has a LOW tile of terrain ${m.terrain[i]} at ${where(i)}`);
    if ((t === TILE_WALL || t === TILE_LOW) && (halo[i] || pad[i])) add("overlap", `w${v}`, `feature ${v - 1} (${kind}) puts a ${t === TILE_WALL ? "wall" : "LOW tile"} on a camp halo or spawn pad at ${where(i)}`);
  }
  if (unowned > 0) add("unowned", "n", `${unowned} tiles, first at ${where(firstUnowned)}`);
  if (unownedHazard > 0) add("hazards", "n", `${unownedHazard} tiles, first at ${where(firstHazard)}`);
  F.forEach((f, k) => {
    if (!strictSet.has(zoneCodeOf(f.zone as RegionFaction)) || !kindSet.has(f.kind)) return;
    const kind = f.kind as CertFeatureKind, writes = KIND_WRITES[kind];
    if ((writes.wall || writes.low) && kind !== "infill" && walls[k + 1] < PIECE_MIN) add("size", `s${k}`, `feature ${k} (${kind}) owns ${walls[k + 1]} wall or LOW tiles`);
    if (kind === "landmark" && !f.jobs.includes("landmark")) add("jobs", `l${k}`, `landmark ${k} does not name the job "landmark"`);
    if (f.jobs.some((j) => !KIND_JOBS[kind].includes(j))) add("jobs", `j${k}`, `feature ${k} (${kind}) carries jobs ${f.jobs.join("+")}`);
  });
  return out;
}

/** The wall-piece gate for the strict zones: no 8-connected zone WALL piece under PIECE_MIN tiles (a single tile is one). */
export function pieceProblems(m: GameMap, strict: readonly number[]): string[] {
  const out: string[] = [];
  for (const code of strict) {
    const s = pieceStats(m, code, TILE_WALL);
    if (s.under6 > 0) out.push(`${FEATURE_CHECKS.pieces}: ${REGION_FACTIONS[code - 1]} has ${s.under6} (${s.singles} single tiles; sizes ${s.sizes.filter((v) => v < PIECE_MIN).join(",")})`);
  }
  return out;
}

/** What decor on/off must leave equal (contract 0.1.6: features and every hashed layer come from streams the decor never touches): problems, empty when equal. */
export function decorProblems(on: GameMap, off: GameMap): string[] {
  const out: string[] = [];
  const same = (name: string, a: ArrayLike<number>, b: ArrayLike<number>): void => {
    if (a.length !== b.length) { out.push(`${name} length`); return; }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { out.push(`${name} differs at ${i}`); return; }
  };
  same("tiles", on.tiles, off.tiles);
  same("terrain", on.terrain, off.terrain);
  same("regionGrid", on.regionGrid, off.regionGrid);
  same("territoryGrid", on.territoryGrid, off.territoryGrid);
  same("featureGrid", on.featureGrid, off.featureGrid);
  const json = (name: string, a: unknown, b: unknown): void => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${name} differs`); };
  json("features", on.features, off.features);
  json("camps", on.camps, off.camps);
  json("spawnPool", on.spawnPool, off.spawnPool);
  json("buildings", on.buildings, off.buildings);
  json("crateSpots", on.crateSpots, off.crateSpots);
  json("groundSpots", on.groundSpots, off.groundSpots);
  json("regions", on.regions, off.regions);
  if (on.attempt !== off.attempt) out.push("attempt differs");
  return out;
}

// ---- Report thresholds: contract section 4's per-zone windows and 6.2's sweep thresholds ---------------------------------------------

/** One report measure of a zone, read off its ZoneMeasures. */
export const ZONE_MEASURE_VALUES: Readonly<Record<string, (z: ZoneMeasures) => number>> = {
  "rays>=7.5t %": (z) => 100 * z.rays.share75,
  "rays>=15t %": (z) => 100 * z.rays.share15,
  "ray mean t": (z) => z.rays.mean,
  "open-bow %": (z) => 100 * z.rays.openBow,
  "pairs wall %": (z) => 100 * z.pairs.wallBlocked,
  "pairs LOW %": (z) => 100 * z.pairs.lowSeparated,
  "stretch mean": (z) => z.graph.stretchMean,
  "stretch max": (z) => z.graph.stretchMax,
  "loops": (z) => z.graph.loops,
  "walls": (z) => z.walls,
  "LOW tiles": (z) => z.lows,
  "footprint %": (z) => z.footprint,
  "wall pieces": (z) => z.wallPieces.count,
  "singles": (z) => z.wallPieces.singles,
  "pieces<6": (z) => z.wallPieces.under6,
  "big-piece %": (z) => 100 * z.wallPieces.bigShare,
  "largest piece": (z) => z.wallPieces.largest,
  "LOW pieces<6": (z) => z.lowPieces.under6,
  "lava": (z) => z.terrain[TERRAIN_LAVA],
  "ember": (z) => z.terrain[TERRAIN_EMBER],
  "fence": (z) => z.terrain[TERRAIN_FENCE],
  "crevasse": (z) => z.terrain[TERRAIN_CREVASSE],
  "bog": (z) => z.terrain[TERRAIN_BOG],
  "ice": (z) => z.terrain[TERRAIN_ICE],
  "light": (z) => z.terrain[TERRAIN_LIGHT],
  "ice % floor": (z) => z.iceShare,
  "landmarks": (z) => z.features.landmark ?? 0,
  "craters": (z) => z.features.crater ?? 0,
  "fence rows": (z) => z.features.fenceRow ?? 0,
  "barrows": (z) => z.features.barrow ?? 0,
  "tunnels": (z) => z.tunnels,
  "meres": (z) => z.features.mere ?? 0,
  "headlands": (z) => z.features.headland ?? 0,
  "spires": (z) => z.features.spire ?? 0,
  "piers": (z) => z.piers,
  "elite sep t": (z) => z.eliteSep,
};

export interface MeasureWindow {
  lo: number;
  hi: number;
  /** When set the window is judged per seed: at least this share of the seeds must lie inside; else the mean must. */
  share?: number;
}
const inf = Infinity;
/** Contract section 4's per-zone acceptance windows at 136x136 (report-only: a breach is investigated). Keys are ZONE_MEASURE_VALUES names. */
export const ZONE_WINDOWS: Readonly<Record<RegionFaction, Readonly<Record<string, MeasureWindow>>>> = {
  fire: {
    "craters": { lo: 7, hi: 8, share: 0.95 }, "walls": { lo: 150, hi: 300 }, "lava": { lo: 70, hi: 160 }, "ember": { lo: 80, hi: 200 },
    "pieces<6": { lo: 0, hi: 0 }, "rays>=7.5t %": { lo: 48, hi: 64 }, "pairs wall %": { lo: 18, hi: inf }, "stretch mean": { lo: 0, hi: 1.12 },
    "stretch max": { lo: 0, hi: 1.35 }, "loops": { lo: 1, hi: inf }, "footprint %": { lo: 0, hi: FOOTPRINT_MAX_PCT },
  },
  sentenced: {
    "fence rows": { lo: 6, hi: inf, share: 0.95 }, "fence": { lo: 150, hi: 320 }, "walls": { lo: 50, hi: 90 }, "rays>=7.5t %": { lo: 72, hi: 88 },
    "pairs LOW %": { lo: 18, hi: inf }, "pairs wall %": { lo: 0, hi: 8 }, "LOW pieces<6": { lo: 0, hi: 0 }, "pieces<6": { lo: 0, hi: 0 },
    "stretch mean": { lo: 0, hi: 1.15 }, "footprint %": { lo: 0, hi: FOOTPRINT_MAX_PCT },
  },
  plague: {
    "barrows": { lo: 8, hi: 12 }, "tunnels": { lo: 3, hi: 4 }, "walls": { lo: 250, hi: 420 }, "bog": { lo: 150, hi: 300 }, "loops": { lo: 6, hi: inf },
    "rays>=7.5t %": { lo: 60, hi: 74 }, "pairs wall %": { lo: 8, hi: inf }, "stretch mean": { lo: 0, hi: 1.1 }, "stretch max": { lo: 0, hi: 1.3 },
    "pieces<6": { lo: 0, hi: 0 }, "footprint %": { lo: 0, hi: FOOTPRINT_MAX_PCT },
  },
  frost: {
    "meres": { lo: 2, hi: 2, share: 0.6 }, "ice": { lo: 450, hi: 800 }, "ice % floor": { lo: 12, hi: inf, share: 0.95 }, "headlands": { lo: 4, hi: 6 },
    "spires": { lo: 1, hi: inf, share: 0.8 }, "walls": { lo: 90, hi: 220 }, "rays>=7.5t %": { lo: 62, hi: 78 }, "pieces<6": { lo: 0, hi: 0 },
    "footprint %": { lo: 0, hi: FOOTPRINT_MAX_PCT },
  },
  holy: {
    "piers": { lo: 18, hi: 30 }, "walls": { lo: 200, hi: 330 }, "light": { lo: 60, hi: 100 }, "rays>=7.5t %": { lo: 60, hi: 74 }, "pairs wall %": { lo: 10, hi: inf },
    "stretch mean": { lo: 0, hi: 1.1 }, "pieces<6": { lo: 0, hi: 0 }, "footprint %": { lo: 0, hi: FOOTPRINT_MAX_PCT },
  },
};

/** Across a sweep (contract 6.2, report-only): attempts per seed, discards, findPath ratio p90 (max is hard at 1.2), hazards on walks p90. */
export const SWEEP_THRESHOLDS = { attemptsPerSeed: 1.1, discards: 0, walkRatioP90: 1.17, hazardsP90: 6 } as const;

/** Judges `values` (one per seed) against a window: the share inside and whether the window holds. */
export function judgeWindow(values: readonly number[], w: MeasureWindow): { inside: number; mean: number; ok: boolean } {
  const inside = values.length ? values.filter((v) => v >= w.lo - 1e-9 && v <= w.hi + 1e-9).length / values.length : 0;
  const mean = values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0;
  const ok = values.length === 0 ? true : w.share !== undefined ? inside >= w.share : mean >= w.lo - 1e-9 && mean <= w.hi + 1e-9;
  return { inside, mean, ok };
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
