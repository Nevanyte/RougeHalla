// The zone styler contract: what a styler sees (contexts), what it may write (guarded blockers, surfaces, props) and what the
// generator hands in (StyleState). Size-free: every size comes from the state.
import type { MapProp, RegionFaction, TilePt, TileRect } from "../map";
import type { Rng } from "../rng";

/** `wall` becomes TILE_WALL; the others become TILE_LOW with that terrain kind. */
export type BlockKind = "wall" | "lava" | "fence" | "crevasse";
/** Floor kinds: the tile stays FLOOR, only `terrain` changes. */
export type SurfaceKind = "ember" | "bog" | "ice" | "light";

export interface ZoneInfo {
  /** The generator's zone index 1..5: the stream key (REGION_FACTIONS order on wedge maps). */
  readonly index: number;
  readonly faction: RegionFaction;
  /** Tiles in the zone, and FLOOR among them when the pass starts. */
  readonly painted: number;
  readonly floor: number;
  readonly bbox: TileRect;
  /** Deepest tile (max edge distance; ties: lowest index). */
  readonly pole: TilePt;
  /** Mean of the zone's tile centres, in tile units. */
  readonly centroid: { readonly x: number; readonly y: number };
  /** Unit major axis of the zone (closed-form 2x2 eigenvector, sqrt only). */
  readonly axis: { readonly x: number; readonly y: number };
}

export interface StyleCaps {
  /** Longest straight horizontal or vertical run of WALL a write may make (the cover test's bound is 14). */
  readonly maxWallRun: number;
  /** Zone-local or territory join checks per zone and pass (the fallback when the simple-point test says no). */
  readonly joinChecks: number;
  /** Budget in percent of the zone's painted area on 0.35 x WALL + 1.0 x LOW (the cover pass saves 0.65 rocks per wall tile, LOW saves none). */
  readonly footprintPct: number;
  /** Tiles a blocker keeps from the zone's rim (this also makes zone output independent of processing order). */
  readonly rimTiles: number;
  /** A FENCE tile may not push two floor tiles it stood between more than this many tiles apart by walking (bodies, and melee swings, go round a fence). */
  readonly fenceDetour: number;
  /** The same for a WALL tile: it may not leave two floor tiles it stood between more than this many tiles apart (a street closed for a long walk round). */
  readonly wallDetour: number;
}

export const ZONE_STYLE_CAPS: StyleCaps = { maxWallRun: 14, joinChecks: 64, footprintPct: 8, rimTiles: 3, fenceDetour: 10, wallDetour: 12 };

/** Stateless integer-hash noise, mixed with the pass's stream seed; deterministic on every engine. */
export interface NoiseKit {
  /** [0, 1). */
  hash(x: number, y: number, salt: number): number;
  /** Bilinear value noise on a lattice of `cell` tiles, smoothstep fade; [0, 1). */
  value(x: number, y: number, cell: number, salt: number): number;
  /** Octaves of value noise, each at half the cell and half the weight; [0, 1). */
  fbm(x: number, y: number, cell: number, octaves: number, salt: number): number;
}

export interface CampInfo {
  /** Camp centre, tile units. */
  readonly x: number;
  readonly y: number;
  /** Clearing radius, tiles. */
  readonly r: number;
  readonly territory: number;
}

export interface BaseCtx {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly attempt: number;
  readonly zone: ZoneInfo;
  /** 1 = this zone's painted tile. */
  readonly mask: Uint8Array;
  /** 1 = no pass writes it (the generator's protect). */
  readonly hard: Uint8Array;
  /**
   * Per tile: 0 = free; nonzero = no blocker. 1 (and every `hard` tile) takes no hazard but LIGHT or nothing; 2 is a margin that
   * takes any floor hazard (a ruin's ring, a ridge pass).
   */
  readonly noBlock: Uint8Array;
  readonly tiles: Readonly<Uint8Array>;
  readonly terrain: Readonly<Uint8Array>;
  /** 3-4 chamfer distance (thirds of a tile) from a zone tile to the nearest tile outside the zone. */
  readonly edgeDist: Readonly<Int32Array>;
  readonly territory: Uint8Array | null;
  readonly camps: readonly CampInfo[];
  /** This pass's stream for this zone. */
  readonly rng: Rng;
  readonly noise: NoiseKit;
  /** Tile index of (x, y), or -1 outside the grid. */
  at(x: number, y: number): number;
}

export interface ShapeCtx extends BaseCtx {
  readonly caps: StyleCaps;
  /** Would `block(i, kind)` succeed right now? Burns a join check when the simple-point test alone cannot say. */
  canBlock(i: number, kind: BlockKind): boolean;
  /** Writes the blocker; false = refused and nothing changed. A wall on a LOW tile keeps its LOW kind (a pillar in the river). */
  block(i: number, kind: BlockKind): boolean;
  /** Could a blocker land on tile i as far as the static rules go (a FLOOR tile of the zone, not protected, past the rim, not reserved)? Cheap and side-effect free; `canBlock` also runs the connectivity and shape checks. */
  open(i: number): boolean;
  /** Gives a LOW tile this pass wrote back to floor (never a tile it did not write); false if tile i is not one. */
  release(i: number): boolean;
  /** Do the floor tiles up to 3 steps either side of tile i, along its row and column, still walk to each other within the fence detour cap? For a fence tile that stands. */
  fenceDetourOk(i: number): boolean;
  /** No later blocker of this pass may take tile i (a door, a ford, a corridor mouth). */
  reserve(i: number): void;
  isReserved(i: number): boolean;
}

export interface SurfaceCtx extends BaseCtx {
  canSurface(i: number, kind: SurfaceKind): boolean;
  surface(i: number, kind: SurfaceKind): boolean;
}

export interface PropCtx extends BaseCtx {
  /** A prop of PROP_KINDS id `kind` on tile (x, y), art variant `v`; false (nothing added) off the zone, on a protected site, on the wrong tile class or past the 8% cap. */
  prop(kind: number, x: number, y: number, v: number): boolean;
}

export interface ZoneStyler<P = unknown> {
  readonly id: "scorch" | "gallows" | "warren" | "rime" | "sanctum";
  readonly faction: RegionFaction;
  /** Bump on any output change; the pinned-hash tests name it. */
  readonly version: number;
  /** Walls and LOW features. Returns a plan (what was built where) handed to `surface` and `props`. */
  shape(ctx: ShapeCtx): P;
  surface?(ctx: SurfaceCtx, plan: P): void;
  props?(ctx: PropCtx, plan: P): void;
}

export interface StyleState {
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  readonly attempt: number;
  /** Writeable: the stylers turn FLOOR into WALL or LOW (and a LOW tile into a WALL). */
  tiles: Uint8Array;
  /** New (zeros) on entry; filled with LOW and floor kinds. */
  terrain: Uint8Array;
  /** New (empty) on entry; the prop pass appends. */
  props: MapProp[];
  /** Per tile: 0 = unpainted, else the zone index (1-based into zoneFaction). */
  readonly zone: Uint8Array;
  readonly zoneFaction: readonly RegionFaction[];
  /** 1 = no styler writes it. */
  readonly protect: Uint8Array;
  /**
   * Tiles that take no blocker without being protected outright: 1 = the band past the ring road (LIGHT may stand there, other
   * hazards may not), 2 = a margin that takes any floor hazard (a ruin's ring, a ridge pass). Defaults to nothing.
   */
  readonly noBlock?: Uint8Array;
  /** Tiles that take no prop (spawn 3x3, chests, camp spots, gate lanes, ground spots). Defaults to `protect`. */
  readonly noProp?: Uint8Array;
  readonly territory: Uint8Array | null;
  /** The camps: `site` the tile index of the centre, `r` the clearing radius in TILES, `territory` its territory id. */
  readonly camps: readonly { readonly site: number; readonly r: number; readonly territory: number }[];
  /** Out. Stays empty in v1: every LOW tile may take a cover rock. */
  keepLow: Uint8Array;
}

export interface StyleOptions {
  /** false = no props (the server and the bots): tiles and terrain are byte-equal either way. */
  decor?: boolean;
  /** Test hook: replaces the styler of a faction (a no-op for the zone isolation test). */
  stylers?: Partial<Record<RegionFaction, ZoneStyler<unknown>>>;
  caps?: Partial<StyleCaps>;
}

export interface StyleResult {
  readonly index: number;
  readonly faction: RegionFaction;
  /**
   * Tiles this pass holds as WALL or LOW: `walls + low`. A LOW tile this pass wrote that was later walled MOVES from `low` to
   * `walls` (counted once); a LOW tile the generator laid that was walled counts as a wall only, and never lowers `low`.
   */
  readonly blocked: number;
  readonly walls: number;
  readonly low: number;
  readonly kept: number;
  readonly refused: number;
  readonly joinChecks: number;
  readonly surfaced: number;
  readonly props: number;
  /** Tiles the connectivity safety net gave back (always 0 when every write went through the guard). */
  readonly repaired: number;
  /** Telemetry only; never feeds output. */
  readonly ms: number;
  /** What the styler built (tests and printZone read it; the generator does not). */
  readonly plan: unknown;
}
