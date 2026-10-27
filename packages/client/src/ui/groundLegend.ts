// The "Ground" section of the help card (H): what each terrain kind is and what it does, read from the terrain catalog so the
// numbers cannot go stale, one row each with a swatch drawn in the kind's pattern (zigzag, circles, diagonals, rays, bars, waves, a
// jagged slit), because colour is never the only cue. `groundLegend()` is the data (pure, tested); `renderGround()` makes the DOM.
import {
  FACTIONS, TERRAINS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE_LOW,
  isFactionId, type TerrainSpec,
} from "@raid/shared";
import { COLOR_FEATURE_WALL } from "./mapPainter";
import { el } from "./dom";
import "./groundLegend.css";

export interface GroundEntry {
  /** The terrain kind id (terrain.ts). */
  kind: number;
  /** The catalog key: also the swatch's CSS class suffix. */
  key: string;
  name: string;
  /** What it does, in a sentence. */
  effect: string;
}

/** The order the legend lists them: the surfaces that act on you first, the barriers after. */
const ORDER: readonly number[] = [TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT, TERRAIN_LAVA, TERRAIN_FENCE, TERRAIN_CREVASSE];

const pct = (share: number): string => `${Math.round(share * 1000) / 10}%`;

function homeName(spec: TerrainSpec): string {
  return spec.home !== null && isFactionId(spec.home) ? FACTIONS[spec.home].displayName : "the home faction";
}

function effectOf(spec: TerrainSpec): string {
  if (spec.tile === TILE_LOW) return "Blocks walking and melee swings; shots, sight and spells pass over";
  if (spec.burnShare > 0) return `Burns ${pct(spec.burnShare)} of max hp per second; ${homeName(spec)} is immune`;
  if (spec.speedMult < 1) return `Slows you to ${Math.round(spec.speedMult * 100)}%; ${homeName(spec)} is immune`;
  if (spec.slipMs > 0) return `Slippery: you slide when you start, turn or stop; ${homeName(spec)} keeps full grip`;
  if (spec.healShare > 0) {
    return `Heals ${pct(spec.healShare)} of max hp per second out of combat; ${homeName(spec)} heals ${spec.homeMult === 2 ? "double" : `x${spec.homeMult}`}`;
  }
  return spec.name;
}

/** One entry per terrain kind but plain ground, in display order. */
export function groundLegend(): GroundEntry[] {
  return ORDER.map((kind) => {
    const spec = TERRAINS[kind]!;
    return { kind, key: spec.key, name: spec.name, effect: effectOf(spec) };
  });
}

export interface ShapeEntry {
  /** The feature kind it is about (map.features[].kind), and the colour the map screens paint its walls in (the swatch). */
  key: string;
  name: string;
  effect: string;
  color: string;
}

/**
 * The shapes of the land (zone-shapes contract 4): what the named features on the map are and what they ask of you. Walls are walls
 * (they stop walking, shots and sight); the words say how to get past or through each, and the swatch is the colour the minimap and
 * the map screens paint that feature's walls in, so the legend and the maps agree.
 */
export function shapeLegend(): ShapeEntry[] {
  const wall = (kind: keyof typeof COLOR_FEATURE_WALL): string => COLOR_FEATURE_WALL[kind] ?? "#9aa3ad";
  return [
    { key: "crater", name: "Crater", effect: "A ring of rock round a camp. It stops walking, shots and sight: go in by the gaps in the ring", color: wall("crater") },
    { key: "barrow", name: "Barrow", effect: "A mound of rock between camps: go round it (the bog on one side is slow) or through the tunnel some have", color: wall("barrow") },
    { key: "hall", name: "Pillared hall", effect: "Square piers in a grid: they stop shots and sight, the aisles between them are open, and the light at its heart heals", color: wall("hall") },
    { key: "headland", name: "Ice headland", effect: "Shards of ice on a frozen lake's shore: cover from shots, and the shore itself is plain ground beside the slippery ice", color: wall("headland") },
    { key: "landmark", name: "Ruined building", effect: "A walled room with doorways (a forge, a guard house, a burrow, a watchtower or a shrine): shelter, and weapon crates inside", color: wall("landmark") },
  ];
}

/** The help card's Ground section. */
export function renderGround(): HTMLElement {
  const node = el("section", "help-section help-ground");
  node.append(el("h3", "help-section-title", "Ground"));
  const list = el("dl", "help-list help-ground-list");
  for (const entry of groundLegend()) {
    const term = el("dt", "help-ground-term");
    const swatch = el("span", `ground-swatch ground-swatch-${entry.key}`);
    swatch.setAttribute?.("aria-hidden", "true");
    term.append(swatch, el("span", "help-ground-name", entry.name));
    list.append(term, el("dd", "help-action", entry.effect));
  }
  node.append(list);
  node.append(el("h4", "help-ground-sub", "Shapes of the land"));
  const shapes = el("dl", "help-list help-ground-list help-shape-list");
  for (const entry of shapeLegend()) {
    const term = el("dt", "help-ground-term help-shape-term");
    const swatch = el("span", `ground-swatch ground-swatch-shape-${entry.key}`);
    swatch.setAttribute?.("aria-hidden", "true");
    swatch.style?.setProperty?.("background", entry.color);
    term.append(swatch, el("span", "help-ground-name", entry.name));
    shapes.append(term, el("dd", "help-action", entry.effect));
  }
  node.append(shapes);
  return node;
}
