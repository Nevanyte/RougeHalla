// The zone stylers' entry: `styleZones(state)` is the entry the zone generator calls once per attempt, after the zones, territories,
// camps and ruins are placed and before obstacles, spawns, crates and cover. Each zone runs shape (walls, LOW features), then
// surface (hazards), then props, on three streams of its own: mulberry32(hashSeed(seed, attempt, zoneIndex, stream)),
// stream 0 shape, 1 decor, 2 surface. The generator's main stream is never drawn. Zones run in index order and never read
// each other's writes beyond a 3-tile rim, so a zone's output does not depend on the others.
import { TILE } from "../constants";
import type { PropKindSpec } from "../terrain";
import type { RegionFaction } from "../map";
import { chamfer, floorComponents, repairConnectivity } from "./kit";
import { makeScratch, propCtx, shapeCtx, surfaceCtx, ZoneRuntime, zoneInfoOf } from "./context";
import { gallows } from "./gallows";
import { rime } from "./rime";
import { sanctum } from "./sanctum";
import { scorch } from "./scorch";
import { warren } from "./warren";
import { ZONE_PROP_KINDS } from "./propKinds";
import { ZONE_STYLE_CAPS } from "./types";
import type { CampInfo, StyleResult, StyleOptions, ZoneStyleState, ZoneStyler } from "./types";

/** One styler per faction; the registry the zone generator reads. */
export const ZONE_STYLERS: Readonly<Record<RegionFaction, ZoneStyler<any>>> = {
  fire: scorch,
  sentenced: gallows,
  plague: warren,
  frost: rime,
  holy: sanctum,
};

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : 0);

/**
 * Styles every zone of the state in place (`tiles`, `terrain`, `props`) and returns one result per zone. Only FLOOR becomes
 * WALL or LOW (and a LOW tile may become a wall); nothing is ever opened, and nothing protected, outside a zone or within
 * 3 tiles of a zone's rim is touched. Every write is guarded: the zone's floor (and each territory's) stays 4-connected.
 */
export function styleZones(st: ZoneStyleState, opts: StyleOptions = {}): StyleResult[] {
  const { w, h } = st;
  const n = w * h;
  for (const [name, arr] of [["tiles", st.tiles], ["terrain", st.terrain], ["zone", st.zone], ["protect", st.protect], ["keepLow", st.keepLow]] as const) {
    if (arr.length !== n) throw new RangeError(`styleZones: ${name} has ${arr.length} entries for ${w}x${h}`);
  }
  const caps = { ...ZONE_STYLE_CAPS, ...opts.caps };
  const scratch = makeScratch(n);
  const wrote = new Uint8Array(n);
  const noBlock = new Uint8Array(n);
  for (let i = 0; i < n; i++) noBlock[i] = st.protect[i] ? 1 : st.noBlock ? st.noBlock[i] : 0;
  const noProp = st.noProp ?? st.protect;
  const camps: CampInfo[] = st.camps.map((c) => ({ x: c.site % w, y: (c.site - (c.site % w)) / w, r: c.r, territory: c.territory }));
  const results: StyleResult[] = [];
  let components = -1; // the floor components of the tiles as the last zone left them (computed on first use)
  for (let z = 1; z <= st.zoneFaction.length; z++) {
    const faction = st.zoneFaction[z - 1];
    const styler = opts.stylers?.[faction] ?? ZONE_STYLERS[faction];
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = st.zone[i] === z ? 1 : 0;
    const edgeDist = chamfer(mask, w, h);
    const info = zoneInfoOf(z, faction, mask, st.tiles, edgeDist, w, h);
    if (info.painted === 0 || !styler) {
      results.push({ index: z, faction, blocked: 0, walls: 0, low: 0, kept: 0, refused: 0, joinChecks: 0, surfaced: 0, props: 0, repaired: 0, ms: 0, plan: null });
      continue;
    }
    const t0 = nowMs();
    const rt = new ZoneRuntime({
      w, h, seed: st.seed, attempt: st.attempt, info, mask, hard: st.protect, noBlock, noProp, tiles: st.tiles, terrain: st.terrain,
      props: st.props, edgeDist, territory: st.territory, camps, caps, scratch, wrote, propKinds: ZONE_PROP_KINDS,
    });
    const before = components < 0 ? floorComponents(st.tiles, w, h).sizes.length : components;
    const plan = styler.shape(shapeCtx(rt));
    // The guard keeps the floor connected; this is the net under it, and it stays at zero.
    let repaired = 0;
    components = before;
    if (rt.walls + rt.lows > 0) {
      components = floorComponents(st.tiles, w, h).sizes.length;
      if (components > before) {
        repaired = repairConnectivity(st.tiles, st.terrain, wrote, w, h);
        components = floorComponents(st.tiles, w, h).sizes.length;
      }
    }
    styler.surface?.(surfaceCtx(rt), plan);
    if (opts.decor !== false) styler.props?.(propCtx(rt), plan);
    results.push({
      index: z, faction, blocked: rt.walls + rt.lows, walls: rt.walls, low: rt.lows, kept: 0, refused: rt.refused, joinChecks: rt.joinUsed,
      surfaced: rt.surfaced, props: rt.propsAdded, repaired, ms: nowMs() - t0, plan,
    });
  }
  return results;
}

/**
 * Drops the props whose tile no longer matches their kind (a cover rock fell on a floor prop, a floor kind was cleared). No
 * random draw; run it last, on the final tiles. Returns how many were dropped.
 */
export function filterProps(props: ZoneStyleState["props"], tiles: Uint8Array, w: number, propKinds: readonly PropKindSpec[] = ZONE_PROP_KINDS): number {
  let out = 0;
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const spec = propKinds[p.kind];
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (spec && tiles[ty * w + tx] === spec.on) props[out++] = p;
  }
  const dropped = props.length - out;
  props.length = out;
  return dropped;
}
