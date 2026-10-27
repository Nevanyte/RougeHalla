// The "Ground" section of the help card (H): what each terrain kind is and what it does, read from the terrain catalog so the
// numbers cannot go stale, one row each with a swatch drawn in the kind's pattern (zigzag, circles, diagonals, rays, bars, waves, a
// jagged slit), because colour is never the only cue. `groundLegend()` is the data (pure, tested); `renderGround()` makes the DOM.
import {
  FACTIONS, TERRAINS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE_LOW,
  isFactionId, type TerrainSpec,
} from "@raid/shared";
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
  return node;
}
