// The zone styler contract: what a styler sees (contexts), what it may write (guarded blockers, features, surfaces, props) and
// what the generator hands in (ZoneStyleState). Size-free: every size comes from the state. Frozen by the zone-shapes
// contract (section 3.1): phase B work packages code against these types and never change them.
import type { FeatureJob, FeatureKind, MapFeature, MapProp, RegionFaction, TilePt, TileRect } from "../map";
import type { Rng } from "../rng";

/** `wall` becomes TILE_WALL; the others become TILE_LOW with that terrain kind. */
export type BlockKind = "wall" | "lava" | "fence" | "crevasse";
/** Floor kinds: the tile stays FLOOR, only `terrain` changes. */
export type SurfaceKind = "ember" | "bog" | "ice" | "light";

export interface ZoneInfo {
  /** The generator's zone index 1..5: the stream key (this attempt's zone order: the generator shuffles the factions). */
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
  /** Zone-local or territory join checks per zone and pass (the fallback when the simple-point test says no). */
  readonly joinChecks: number;
  /** Footprint budget in percent of the zone's painted area: WALL and LOW both cost 1.0 per tile. */
  readonly footprintPct: number;
  /** Tiles a blocker keeps from the zone's rim (this also makes zone output independent of processing order). */
  readonly rimTiles: number;
  /** A FENCE tile may not push two floor tiles it stood between more than this many tiles apart by walking (bodies, and melee swings, go round a fence). */
  readonly fenceDetour: number;
}

/** The shape pass's caps (contract 0.1.8): walls count 1.0 in the footprint, 13% of the zone. */
export const ZONE_STYLE_CAPS: StyleCaps = { joinChecks: 512, footprintPct: 13, rimTiles: 3, fenceDetour: 10 };
/** The landmark pass's caps: landmarks have a budget of their own, 4% of the zone. */
export const LANDMARK_CAPS: StyleCaps = { joinChecks: 128, footprintPct: 4, rimTiles: 3, fenceDetour: 10 };
/** The smallest 8-connected WALL (or LOW) piece a "trim" feature may leave (and, with SHAPE_GATES, any zone wall piece). */
export const FEATURE_MIN_PIECE = 6;

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
  /** One of the zone's two elite camps. */
  readonly elite: boolean;
  /** The generator's camp index (feature params name it; `records()` maps it to the contract index). */
  readonly index: number;
}

/**
 * A feature a styler asks the guard to place (contract 3.1). Its blocks go through `canBlock` one by one, in write order; the
 * floor tiles it lists are owned without being written. First owner wins: a later feature never takes an owned tile.
 */
export interface FeatureSpec {
  readonly kind: FeatureKind;
  /** Landmark design key, else omitted (""). */
  readonly variant?: string;
  readonly jobs: readonly FeatureJob[];
  /** Anchor tile (integers): a crater's camp centre, a landmark's template origin, a row's first tile, a lake's seed. */
  readonly anchor: readonly [number, number];
  /** Kind-specific integers (contract 2.6). */
  readonly params?: readonly number[];
  /** Blockers in write order (tile index, kind). */
  readonly blocks: ReadonlyArray<readonly [number, BlockKind]>;
  /** Group id per block (same length), for mode "groups": each group stands whole or not at all. */
  readonly groups?: readonly number[];
  /** Floor tiles the feature owns without writing them. Must be FLOOR in this zone, not owned yet; others are skipped. */
  readonly floor?: readonly number[];
  /**
   * "whole": every block is written or nothing is (and the feature is not recorded).
   * "trim": the guard may refuse blocks; afterwards every 8-connected WALL (resp. LOW) piece that contains a tile written here and has
   *   fewer than `minPiece` tiles in all (counting walls already on the map) gives those written tiles back; the feature is kept only
   *   if at least `minSharePermille` of `blocks` stand, else everything is given back.
   * "groups": each group is "whole"; the feature is kept if at least `minGroups` groups stand.
   */
  readonly mode: "whole" | "trim" | "groups";
  /** Default FEATURE_MIN_PIECE. */
  readonly minPiece?: number;
  /** "trim": default 600. */
  readonly minSharePermille?: number;
  /** "groups": default 1. */
  readonly minGroups?: number;
}

/** A placed feature: its index in the attempt's feature log, the blocks that stand (tile indices, write order), the blocks refused. */
export interface PlacedFeature { readonly id: number; readonly written: readonly number[]; readonly refused: number }

/**
 * A zone's route guard (contract 3.9; built by the feature kit, features.ts): it keeps the pool members' walks to the coliseum
 * from stretching. Declared here because ShapeCtx hands it out; the kit implements it.
 */
export interface RouteGuard {
  /** Pool members in this zone (tile indices). */
  readonly members: readonly number[];
  /** Their pick-time walks (centreWalk) — the baseline. */
  readonly base: Int32Array;
  /** 1 on tiles within Chebyshev 1 of any member's baseline descent path (the 3-wide corridors); fixed at creation. */
  readonly corridor: Uint8Array;
  /** Corridor tiles per member (for ford, gate and breach placement). */
  corridorOf(k: number): readonly number[];
  /** Recomputes the zone field on the current tiles and returns the worst member stretch in permille (1000 = none; a member cut off
   *  returns 1_000_000). With a list of tile indices it asks the same as if those tiles were walls too (a feature not written yet):
   *  the live tiles are not touched. */
  worstStretch(extraWallTiles?: ArrayLike<number>): number;
  /** The member index with the worst stretch at the last worstStretch() call. */
  worstMember(): number;
  /** Does any of these tiles lie on a corridor? (cheap filter: only features that touch a corridor need worstStretch). */
  touches(tiles: ArrayLike<number>): boolean;
}

/** Builds a zone's route guard from its context (the feature kit's job; the runtime calls it on the first `routeGuard()`). */
export type RouteGuardBuilder = (c: BaseCtx) => RouteGuard;

/**
 * A feature in the attempt's log while the map is built (`StyleState.features`): the same fields as the finished MapFeature, but a
 * crater's `p[0]` is still the generator's camp index and a mere's `p[1]` is still 0; `records()` renumbers both, recounts `tiles`
 * and `bbox` from the final ownership and orders the features (contract 2.5).
 */
export type FeatureDraft = MapFeature;

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
   * takes any floor hazard (a landmark's ring, a ridge pass).
   */
  readonly noBlock: Uint8Array;
  readonly tiles: Readonly<Uint8Array>;
  readonly terrain: Readonly<Uint8Array>;
  /** 3-4 chamfer distance (thirds of a tile) from a zone tile to the nearest tile outside the zone. */
  readonly edgeDist: Readonly<Int32Array>;
  readonly territory: Uint8Array | null;
  /** The camps whose centre lies in this zone (their `index` is the generator's camp index), so `campNodes(c)` is this zone's graph. */
  readonly camps: readonly CampInfo[];
  /** This pass's stream for this zone. */
  readonly rng: Rng;
  readonly noise: NoiseKit;
  /** Tile index of (x, y), or -1 outside the grid. */
  at(x: number, y: number): number;
  /** Pool members standing in this zone (tile indices, pick order); empty in the landmark stage. */
  readonly spawns: readonly number[];
  /** walkField16 to the coliseum centre at pool-pick time (fifths of a tile, -1 unreachable); null in the landmark stage and on fixtures. */
  readonly centreWalk: Int32Array | null;
  /** This zone's features so far (landmarks first), read-only views. */
  zoneFeatures(): readonly MapFeature[];
  /** Is tile i owned by any feature. */
  isOwned(i: number): boolean;
}

export interface ShapeCtx extends BaseCtx {
  readonly caps: StyleCaps;
  /**
   * Places a feature through the guard (contract 3.1): its blocks in order, its floor owned; rolled back whole when its mode says
   * so. Null when nothing of it stands (nothing changed then, but join checks spent inside it stay spent).
   */
  placeFeature(spec: FeatureSpec): PlacedFeature | null;
  /** The zone's route guard (contract 3.9), built on first call. */
  routeGuard(): RouteGuard;
  /** Would `block(i, kind)` succeed right now? Burns a join check when the simple-point test alone cannot say. */
  canBlock(i: number, kind: BlockKind): boolean;
  /** Writes the blocker; false = refused and nothing changed. A wall on a LOW tile keeps its LOW kind (a pillar in the river). */
  block(i: number, kind: BlockKind): boolean;
  /** Could a blocker land on tile i as far as the static rules go (a FLOOR tile of the zone, not protected, past the rim, not reserved, not owned)? Cheap and side-effect free; `canBlock` also runs the connectivity and shape checks. */
  open(i: number): boolean;
  /** Gives a LOW tile this pass wrote back to floor (never a tile it did not write); false if tile i is not one. */
  release(i: number): boolean;
  /** Do the floor tiles up to 3 steps either side of tile i, along its row and column, still walk to each other within the fence detour cap? For a fence tile that stands. */
  fenceDetourOk(i: number): boolean;
  /** No later blocker of this pass may take tile i (a door, a ford, a corridor mouth). */
  reserve(i: number): void;
  isReserved(i: number): boolean;
}

/** The landmark stage's context (stage 4, before the pool): no route guard (there are no members yet). */
export type LandmarkCtx = Omit<ShapeCtx, "routeGuard">;

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
  /** The landmark stage (before the pool): places 0..LANDMARKS_PER_ZONE landmarks with placeFeature (kind "landmark"). */
  landmark?(ctx: LandmarkCtx): void;
  /** Walls and LOW features. Returns a plan (what was built where) handed to `surface` and `props`. */
  shape(ctx: ShapeCtx): P;
  surface?(ctx: SurfaceCtx, plan: P): void;
  props?(ctx: PropCtx, plan: P): void;
}

export interface ZoneStyleState {
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
   * hazards may not), 2 = a margin that takes any floor hazard (a landmark's ring, a ridge pass). Defaults to nothing.
   */
  readonly noBlock?: Uint8Array;
  /** Tiles that take no prop (spawn 3x3, chests, camp spots, gate lanes, ground spots). Defaults to `protect`. */
  readonly noProp?: Uint8Array;
  readonly territory: Uint8Array | null;
  /**
   * The camps: `site` the tile index of the centre, `r` the clearing radius in TILES, `territory` its territory id, `elite` one of
   * its zone's two elite camps (default false). Their index in this list is CampInfo.index.
   */
  readonly camps: readonly { readonly site: number; readonly r: number; readonly territory: number; readonly elite?: boolean }[];
  /** Unused since the cover is gone (old fixtures still pass one); nothing reads it. */
  keepLow?: Uint8Array;
  /** Pool members (tile indices, pick order). Default: none. */
  readonly spawns?: readonly number[];
  /** walkField16 to the coliseum centre at pool-pick time. Default: null (fixtures). */
  readonly centreWalk?: Int32Array | null;
  /** The attempt's feature log (landmarks already in it); appended to. Default: a fresh log. */
  readonly features?: FeatureDraft[];
  /** 1 + feature-log index per tile, 0 = unowned. Default: a fresh grid. */
  readonly featureOwner?: Uint16Array;
}

export interface StyleOptions {
  /** false = no props (the server and the bots): tiles and terrain are byte-equal either way. */
  decor?: boolean;
  /** Test hook: replaces the styler of a faction (a no-op for the zone isolation test). */
  stylers?: Partial<Record<RegionFaction, ZoneStyler<unknown>>>;
  caps?: Partial<StyleCaps>;
  /** The route guard's builder (default: the feature kit's). Tests only. */
  routeGuard?: RouteGuardBuilder;
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
  /** Features this pass recorded. */
  readonly features: number;
  /** Telemetry only; never feeds output. */
  readonly ms: number;
  /** What the styler built (tests and printZone read it; the generator does not). */
  readonly plan: unknown;
}
