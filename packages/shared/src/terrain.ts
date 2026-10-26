// The surface layer of a map: `GameMap.terrain` holds one TERRAINS index per tile. Collision is NEVER read from here
// (that is `tiles`, map.ts): a kind only says which tile class it may sit on, and `validateTerrain` checks that the two
// layers agree. Kind ids are append-only (generator output, tests and the client's art index them). The numbers below
// are first picks for the hazards; their effects are applied by the sim (burn, bog, ice, light), not here.
import { PLAYER_SPEED, TILE } from "./constants";
import { FACTION_IDS } from "./factions";
import {
  MASK_MOVE,
  REGION_COLISEUM,
  REGION_FACTIONS,
  REGION_IDS,
  TILE_FLOOR,
  TILE_LOW,
  TILE_WALL,
  moveComponentsOf,
  tileToWorldCenter,
  worldToTile,
} from "./map";
import type { GameMap, RegionFaction } from "./map";
import { SNAP_RADIUS } from "./pathfind";

export const TERRAIN_NONE = 0;
export const TERRAIN_LAVA = 1;
export const TERRAIN_FENCE = 2;
export const TERRAIN_CREVASSE = 3;
export const TERRAIN_EMBER = 4;
export const TERRAIN_BOG = 5;
export const TERRAIN_ICE = 6;
export const TERRAIN_LIGHT = 7;

export type TerrainKey = "none" | "lava" | "fence" | "crevasse" | "ember" | "bog" | "ice" | "light";

export interface TerrainSpec {
  readonly key: TerrainKey;
  /** Help card and HUD name. */
  readonly name: string;
  /** The tile class it sits on (LOW kinds, or FLOOR kinds); null for NONE. A LOW kind may also mark a wall standing in that feature. */
  readonly tile: number | null;
  /** The zone it belongs to: placed only there (T6), and that faction meets `homeRule`. */
  readonly home: RegionFaction | null;
  /** Walking speed multiplier while a fighter's centre is on it (1 = none). */
  readonly speedMult: number;
  /** Ice: milliseconds from rest to PLAYER_SPEED (0 = no slide). */
  readonly slipMs: number;
  /** Share of max hp lost per second as true damage through the ledger (0 = none). */
  readonly burnShare: number;
  /** Share of max hp healed per second through heal(), lockout applies (0 = none). */
  readonly healShare: number;
  /** How the home faction meets the effect: "exempt" none of it, "boost" times `homeMult`, "none" like everyone. */
  readonly homeRule: "exempt" | "boost" | "none";
  /** 1 unless homeRule is "boost". */
  readonly homeMult: number;
  /** Placeholder base colour (the client art replaces it). */
  readonly color: number;
}

const NEUTRAL = { speedMult: 1, slipMs: 0, burnShare: 0, healShare: 0, homeRule: "none", homeMult: 1 } as const;

/** Indexed by the kind id; append only. All effect numbers are FIRST PICKS. */
export const TERRAINS: readonly TerrainSpec[] = [
  { key: "none", name: "Plain ground", tile: null, home: null, ...NEUTRAL, color: 0x000000 },
  { key: "lava", name: "Lava", tile: TILE_LOW, home: "fire", ...NEUTRAL, color: 0xd2451e },
  { key: "fence", name: "Fence", tile: TILE_LOW, home: "sentenced", ...NEUTRAL, color: 0x8a7f6a },
  { key: "crevasse", name: "Crevasse", tile: TILE_LOW, home: "frost", ...NEUTRAL, color: 0x1b2a3a },
  { key: "ember", name: "Embers", tile: TILE_FLOOR, home: "fire", ...NEUTRAL, burnShare: 0.02, homeRule: "exempt", color: 0xff7a2a },
  { key: "bog", name: "Bog", tile: TILE_FLOOR, home: "plague", ...NEUTRAL, speedMult: 0.7, homeRule: "exempt", color: 0x4f6b2f },
  { key: "ice", name: "Ice", tile: TILE_FLOOR, home: "frost", ...NEUTRAL, slipMs: 400, homeRule: "exempt", color: 0xa9d6f0 },
  { key: "light", name: "Light", tile: TILE_FLOOR, home: "holy", ...NEUTRAL, healShare: 0.006, homeRule: "boost", homeMult: 2, color: 0xfff1b0 },
];

/** The kind on a tile; out of bounds is NONE. */
export function terrainAtTile(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return TERRAIN_NONE;
  return map.terrain[ty * map.w + tx];
}

/** The kind under a world point: effects read the tile under a fighter's CENTRE, on both sides of the wire. */
export function terrainAt(map: GameMap, x: number, y: number): number {
  return terrainAtTile(map, worldToTile(x), worldToTile(y));
}

/** What a decor sprite may stand on. Part D fills the table; append only. */
export interface PropKindSpec {
  readonly key: string;
  /** The tile class its anchor must sit on (TILE_FLOOR, TILE_LOW or TILE_WALL). */
  readonly on: number;
  readonly home: RegionFaction | null;
}

export const PROP_KINDS: readonly PropKindSpec[] = [];

/** The faction behind a regionGrid code; undefined for none and the coliseum. */
const FACTION_OF_CODE: readonly (RegionFaction | undefined)[] = REGION_IDS.map((id) => REGION_FACTIONS.find((f) => f === id));

export interface ValidateTerrainOptions {
  /** The zone stylers ran: every LOW tile must then carry a kind (T10). */
  styled?: boolean;
  /** The prop table to check against; PROP_KINDS by default. */
  propKinds?: readonly PropKindSpec[];
}

/**
 * Checks a map's terrain layer against its tile layer and its protected places. Empty means valid; each string starts with
 * the id of the rule it breaks (one string per rule and offending group, naming the first offender). Pure and O(N), no
 * caches (a generator may call it on a map it is still editing).
 *
 *   T1  tiles, terrain and regionGrid are each w*h long (nothing else is checked when one is not)
 *   T2  tile codes are FLOOR, WALL or LOW; terrain kinds are below TERRAINS.length
 *   T3  class agreement: a floor kind only on FLOOR; a LOW kind on LOW, or on WALL (a pillar standing in that feature,
 *       decor only); NONE anywhere
 *   T4  the border ring is WALL (never LOW)
 *   T5  every LOW tile is within manhattan SNAP_RADIUS of a FLOOR tile (a click on a river walks to the bank)
 *   The rest apply to a generated map only (regions present):
 *   T6  LOW and kinded tiles lie in a faction region, and a kind with a home lies in that faction's region
 *   T7  FLOOR is one 4-connected component with the gates open and two with them closed
 *   T8  protected cells are FLOOR with no terrain: gate tiles, spawn 3x3s, inner spawn 3x3s, chests, camp clearings; the
 *       coliseum footprint has no LOW and no terrain
 *   T9  each prop is in bounds, of a known kind, on its kind's tile class
 *   T10 (`styled` only) no LOW tile has kind NONE
 *   T11 (any map, checked with T5) no other tile that blocks movement (wall or LOW) and no cell off the map in the
 *       8-neighbourhood of an ICE tile: the slide (shared/walk.ts) cannot steer in a corridor its own overshoot fills, so
 *       ice keeps one tile of clear floor around it
 */
export function validateTerrain(map: GameMap, opts: ValidateTerrainOptions = {}): string[] {
  const { w, h, tiles, terrain, regionGrid } = map;
  const n = w * h;
  const out: string[] = [];

  // T1: every later rule indexes these arrays by tile, so a wrong length ends the check.
  if (tiles.length !== n) out.push(`T1 tiles has ${tiles.length} entries, expected ${n} (${w}x${h})`);
  if (terrain.length !== n) out.push(`T1 terrain has ${terrain.length} entries, expected ${n} (${w}x${h})`);
  if (regionGrid.length !== n) out.push(`T1 regionGrid has ${regionGrid.length} entries, expected ${n} (${w}x${h})`);
  if (out.length > 0) return out;

  const at = (i: number): string => `(${i % w}, ${(i - (i % w)) / w})`;
  const kinds = TERRAINS.length;

  // T2, T3
  let badCode = -1, badKind = -1, badClass = -1, countCode = 0, countKind = 0, countClass = 0;
  for (let i = 0; i < n; i++) {
    const t = tiles[i];
    const k = terrain[i];
    const codeOk = t === TILE_FLOOR || t === TILE_WALL || t === TILE_LOW;
    const kindOk = k < kinds;
    if (!codeOk) { if (countCode++ === 0) badCode = i; }
    if (!kindOk) { if (countKind++ === 0) badKind = i; }
    if (!codeOk || !kindOk || k === TERRAIN_NONE) continue;
    const spec = TERRAINS[k];
    const agrees = spec.tile === t || (spec.tile === TILE_LOW && t === TILE_WALL);
    if (!agrees) { if (countClass++ === 0) badClass = i; }
  }
  if (countCode > 0) out.push(`T2 ${countCode} tile(s) with a code outside {floor, wall, low}, first ${at(badCode)} = ${tiles[badCode]}`);
  if (countKind > 0) out.push(`T2 ${countKind} tile(s) with a terrain kind >= ${kinds}, first ${at(badKind)} = ${terrain[badKind]}`);
  if (countClass > 0) {
    out.push(`T3 ${countClass} tile(s) whose terrain disagrees with the tile class, first ${at(badClass)}: ${TERRAINS[terrain[badClass]].key} on tile code ${tiles[badClass]}`);
  }

  // T4
  let badBorder = -1;
  for (let x = 0; x < w && badBorder < 0; x++) {
    if (tiles[x] !== TILE_WALL) badBorder = x;
    else if (tiles[(h - 1) * w + x] !== TILE_WALL) badBorder = (h - 1) * w + x;
  }
  for (let y = 0; y < h && badBorder < 0; y++) {
    if (tiles[y * w] !== TILE_WALL) badBorder = y * w;
    else if (tiles[y * w + w - 1] !== TILE_WALL) badBorder = y * w + w - 1;
  }
  if (badBorder >= 0) out.push(`T4 border tile ${at(badBorder)} is not a wall`);

  // T5: multi-source 4-neighbour BFS from every FLOOR tile, SNAP_RADIUS deep, through every tile: the manhattan distance
  // findPath's snap searches (its rings ignore what lies between the click and the floor).
  const dist = new Int8Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (tiles[i] === TILE_FLOOR) { dist[i] = 0; frontier.push(i); }
  for (let d = 1; d <= SNAP_RADIUS && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      if (x > 0 && dist[i - 1] < 0) { dist[i - 1] = d; next.push(i - 1); }
      if (x < w - 1 && dist[i + 1] < 0) { dist[i + 1] = d; next.push(i + 1); }
      if (i >= w && dist[i - w] < 0) { dist[i - w] = d; next.push(i - w); }
      if (i < n - w && dist[i + w] < 0) { dist[i + w] = d; next.push(i + w); }
    }
    frontier = next;
  }
  let farLow = -1, countFar = 0;
  for (let i = 0; i < n; i++) if (tiles[i] === TILE_LOW && dist[i] < 0) { if (countFar++ === 0) farLow = i; }
  if (countFar > 0) out.push(`T5 ${countFar} LOW tile(s) more than ${SNAP_RADIUS} tiles from any floor, first ${at(farLow)}`);

  // T11: a map invariant (it holds with or without regions), checked wherever the terrain holds ICE.
  let nearSolid = -1, countNear = 0;
  for (let i = 0; i < n; i++) {
    if (terrain[i] !== TERRAIN_ICE) continue;
    const x = i % w, y = (i - x) / w;
    let bad = false;
    for (let dy = -1; dy <= 1 && !bad; dy++) {
      for (let dx = -1; dx <= 1 && !bad; dx++) {
        const nx = x + dx, ny = y + dy;
        // The tile itself is T3's business (ice on a wall or LOW).
        if (dx === 0 && dy === 0) continue;
        bad = nx < 0 || ny < 0 || nx >= w || ny >= h || (tiles[ny * w + nx] & MASK_MOVE) !== 0;
      }
    }
    if (bad && countNear++ === 0) nearSolid = i;
  }
  if (countNear > 0) out.push(`T11 ${countNear} ICE tile(s) with a wall, LOW tile or the map edge in their 8-neighbourhood, first ${at(nearSolid)}`);

  if (map.regions.length === 0) return out;

  // T6
  let badRegion = -1, countRegion = 0, badHome = -1, countHome = 0;
  for (let i = 0; i < n; i++) {
    const k = terrain[i];
    const low = tiles[i] === TILE_LOW;
    if (!low && k === TERRAIN_NONE) continue;
    const faction = FACTION_OF_CODE[regionGrid[i]];
    if (!faction) { if (countRegion++ === 0) badRegion = i; continue; }
    if (k !== TERRAIN_NONE && k < kinds) {
      const home = TERRAINS[k].home;
      if (home !== null && home !== faction) { if (countHome++ === 0) badHome = i; }
    }
  }
  if (countRegion > 0) out.push(`T6 ${countRegion} LOW or kinded tile(s) outside every faction region, first ${at(badRegion)} in ${REGION_IDS[regionGrid[badRegion]] ?? "?"}`);
  if (countHome > 0) out.push(`T6 ${countHome} kinded tile(s) outside their home zone, first ${at(badHome)}: ${TERRAINS[terrain[badHome]].key} in ${REGION_IDS[regionGrid[badHome]]}`);

  // T7: counted without the caches, on the gates-closed copy built here.
  const open = countComponents(moveComponentsOf(tiles, w, h));
  if (open !== 1) out.push(`T7 floor has ${open} components with the gates open, expected 1`);
  const closedTiles = tiles.slice();
  for (const g of map.coliseum.gates) for (const t of g.tiles) if (t.x >= 0 && t.y >= 0 && t.x < w && t.y < h) closedTiles[t.y * w + t.x] = TILE_WALL;
  const closed = countComponents(moveComponentsOf(closedTiles, w, h));
  if (closed !== 2) out.push(`T7 floor has ${closed} components with the gates closed, expected 2`);

  // T8: a protected cell is plain floor (out of bounds is a violation too).
  const bad = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
    const i = ty * w + tx;
    return tiles[i] !== TILE_FLOOR || terrain[i] !== TERRAIN_NONE;
  };
  const protect = (what: string, cells: Iterable<{ x: number; y: number }>): void => {
    for (const c of cells) if (bad(c.x, c.y)) { out.push(`T8 ${what} tile (${c.x}, ${c.y}) is not plain floor`); return; }
  };
  const around = (what: string, centres: Iterable<{ x: number; y: number }>): void => {
    for (const p of centres) {
      const cx = worldToTile(p.x), cy = worldToTile(p.y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (bad(cx + dx, cy + dy)) { out.push(`T8 ${what} 3x3 at (${cx}, ${cy}) is not plain floor`); return; }
        }
      }
    }
  };
  protect("gate", map.coliseum.gates.flatMap((g) => g.tiles));
  for (let i = 0; i < n; i++) {
    if (regionGrid[i] === REGION_COLISEUM && (tiles[i] === TILE_LOW || terrain[i] !== TERRAIN_NONE)) {
      out.push(`T8 coliseum tile ${at(i)} has LOW or terrain`);
      break;
    }
  }
  around("spawn", [...map.spawns, ...map.spawnPool, ...map.regions.flatMap((r) => r.spawns)]);
  around("inner spawn", map.coliseum.innerSpawns);
  const toTile = (p: { x: number; y: number }) => ({ x: worldToTile(p.x), y: worldToTile(p.y) });
  protect("chest", [...map.crateSpots, ...map.regions.flatMap((r) => r.chestSpots), ...map.camps.map((c) => c.chest)].map(toTile));
  const clearing: { x: number; y: number }[] = [];
  for (const c of [...map.camps, ...map.regions.flatMap((r) => r.mobCamps)]) {
    const ctx = worldToTile(c.x), cty = worldToTile(c.y);
    const span = Math.ceil(c.r / TILE);
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        // A tile belongs to the clearing when its centre lies within r of the camp centre (mapgen's definition).
        const px = tileToWorldCenter(ctx + dx) - c.x, py = tileToWorldCenter(cty + dy) - c.y;
        if (px * px + py * py <= c.r * c.r) clearing.push({ x: ctx + dx, y: cty + dy });
      }
    }
  }
  protect("camp clearing", clearing);

  // T9
  const propKinds = opts.propKinds ?? PROP_KINDS;
  let badProp = "";
  for (let p = 0; p < map.props.length && badProp === ""; p++) {
    const pr = map.props[p];
    const tx = worldToTile(pr.x), ty = worldToTile(pr.y);
    const spec = propKinds[pr.kind];
    if (!Number.isFinite(pr.x + pr.y) || tx < 0 || ty < 0 || tx >= w || ty >= h) badProp = `prop ${p} at (${pr.x}, ${pr.y}) is out of bounds`;
    else if (!spec) badProp = `prop ${p} has unknown kind ${pr.kind}`;
    else if (tiles[ty * w + tx] !== spec.on) badProp = `prop ${p} (${spec.key}) stands on tile code ${tiles[ty * w + tx]}, needs ${spec.on}`;
  }
  if (badProp !== "") out.push(`T9 ${badProp}`);

  // T10
  if (opts.styled) {
    let first = -1, count = 0;
    for (let i = 0; i < n; i++) if (tiles[i] === TILE_LOW && terrain[i] === TERRAIN_NONE) { if (count++ === 0) first = i; }
    if (count > 0) out.push(`T10 ${count} LOW tile(s) with no terrain kind, first ${at(first)}`);
  }
  return out;
}

/** Components in a moveComponentsOf result: ids run 0..n-1. */
function countComponents(comp: Int32Array): number {
  let max = -1;
  for (let i = 0; i < comp.length; i++) if (comp[i] > max) max = comp[i];
  return max + 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// What a surface does to one fighter (part B). The sim (server/src/sim/terrainEffects.ts) and the client's prediction ask
// the same table, so both sides agree on the tile under a fighter's centre by construction.
// ---------------------------------------------------------------------------------------------------------------------

/** The product of all of a fighter's move modifiers (chill, buffs, bog, later statuses) never drops below this while it is above 0 (a root's 0 stays 0). */
export const MOVE_MULT_FLOOR = 0.35;

/** What a surface does to one fighter, its faction's home rule applied. Precomputed per (kind, faction): the lookup allocates nothing. */
export interface SurfaceEffect {
  readonly kind: number;
  /** Walk speed multiplier (1 = none). */
  readonly speedMult: number;
  /** Slide traction in u/s^2 (see slipAccel); 0 = full grip (off ice, or exempt). */
  readonly accel: number;
  /** Share of max hp per second lost as true damage. */
  readonly burnShare: number;
  /** Share of max hp per second healed through heal(). */
  readonly healShare: number;
}

/** Traction of a surface with `slipMs` milliseconds from rest to PLAYER_SPEED (0 = no slide). */
export function slipAccel(slipMs: number): number {
  return slipMs > 0 ? (PLAYER_SPEED * 1000) / slipMs : 0;
}

/**
 * Column 0 is "no home rule" (an empty or unknown faction: a training dummy, a test); column 1 + i is FACTION_IDS[i].
 * `exempt` gives the neutral effect on the kind's home faction; `boost` multiplies the kind's own magnitude (burn, heal, and
 * the distance of speedMult from 1) by `homeMult`. A slide's traction is never boosted.
 */
const SURFACE: readonly (readonly SurfaceEffect[])[] = TERRAINS.map((spec, kind) => {
  const base: SurfaceEffect = {
    kind, speedMult: spec.speedMult, accel: slipAccel(spec.slipMs), burnShare: spec.burnShare, healShare: spec.healShare,
  };
  const neutral: SurfaceEffect = { kind, speedMult: 1, accel: 0, burnShare: 0, healShare: 0 };
  const boosted: SurfaceEffect = {
    kind,
    speedMult: 1 + (spec.speedMult - 1) * spec.homeMult,
    accel: base.accel,
    burnShare: spec.burnShare * spec.homeMult,
    healShare: spec.healShare * spec.homeMult,
  };
  const row: SurfaceEffect[] = [base];
  for (const f of FACTION_IDS) {
    const home = spec.home !== null && f === spec.home;
    row.push(home && spec.homeRule === "exempt" ? neutral : home && spec.homeRule === "boost" ? boosted : base);
  }
  return row;
});

const FACTION_COLUMN: ReadonlyMap<string, number> = new Map(FACTION_IDS.map((f, i) => [f, i + 1]));

/** `faction` is a fighter's `faction` string (player or regional mob); "" or an unknown one gets no home rule. A kind the table lacks is plain ground. */
export function surfaceEffect(kind: number, faction: string): SurfaceEffect {
  const row = SURFACE[kind] ?? SURFACE[TERRAIN_NONE];
  return row[FACTION_COLUMN.get(faction) ?? 0];
}

/** The effect under a world point (a fighter's centre, the tile `terrainAt` reads). */
export function surfaceAt(map: GameMap, x: number, y: number, faction: string): SurfaceEffect {
  return surfaceEffect(terrainAt(map, x, y), faction);
}

/** Which effects a map holds at all: a system with nothing to do returns at once. */
export interface MapHazards {
  readonly burn: boolean;
  readonly slow: boolean;
  readonly slip: boolean;
  readonly heal: boolean;
}

const hazardCache = new WeakMap<Uint8Array, MapHazards>();

/**
 * The kinds of effect the map's terrain holds (the base effect of every kind present, before any home rule), cached per
 * `terrain` array, which `withGates` copies share. All false for a zeroed layer. A test that edits terrain after a query
 * calls `forgetHazards`.
 */
export function hazardsOf(map: GameMap): MapHazards {
  let h = hazardCache.get(map.terrain);
  if (h) return h;
  const present = new Uint8Array(256);
  const t = map.terrain;
  for (let i = 0; i < t.length; i++) present[t[i]] = 1;
  let burn = false, slow = false, slip = false, heal = false;
  for (let k = 1; k < TERRAINS.length; k++) {
    if (!present[k]) continue;
    const spec = TERRAINS[k];
    if (spec.burnShare > 0) burn = true;
    if (spec.speedMult !== 1) slow = true;
    if (spec.slipMs > 0) slip = true;
    if (spec.healShare > 0) heal = true;
  }
  h = { burn, slow, slip, heal };
  hazardCache.set(map.terrain, h);
  return h;
}

/** For a test that changes terrain after `hazardsOf` read it. */
export function forgetHazards(map: GameMap): void {
  hazardCache.delete(map.terrain);
}
