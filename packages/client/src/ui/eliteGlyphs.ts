// The ten elite mobs' map icons: one small, bold, gold glyph per elite type, drawn above an elite camp on every map screen in place of the
// generic crown. Pure geometry, no canvas and no DOM: `paintCamps` (mapPainter.ts) fills the shapes on a 2D context, and the planning
// screen's chips (planning.ts) show the same shapes as an inline SVG, so a camp reads the same on the minimap, the hold-Tab map and
// the planning map. Each glyph echoes the elite's sprite in the world (render/eliteArt.ts), and is told from the other nine by its
// SILHOUETTE alone (at 8 to 14 px a detail under about a pixel is mush): ink details only add to it.
//
// Which elite stands in which camp is no secret and no draw: the k-th elite camp of a zone holds the k-th of that zone's elites
// (shared rosters.ts `rollCampElites`), so a client computes it from the public map. `campEliteTypes` does that for a list of camps.
import { MOB_TYPES, elitesOf, rollCampElites, type CampDef, type MobTypeId } from "@raid/shared";

type Pt = readonly [number, number];
export type GlyphPoly = ReadonlyArray<Pt>;

/** One filled shape of a glyph in a box from (-1, -1) to (1, 1), y down: a polygon or a disc, in the glyph's colour or in ink (the dark of the outline, for holes and details). */
export type GlyphPart =
  | { readonly poly: GlyphPoly; readonly ink?: boolean }
  | { readonly disc: readonly [x: number, y: number, r: number]; readonly ink?: boolean };

export interface EliteGlyph {
  readonly id: MobTypeId;
  readonly parts: readonly GlyphPart[];
}

/** The unit the designs below are drawn in: 8 grid units to the half-width of the glyph's box. */
const G = 8;
const unit = (n: number): number => Math.round((n / G) * 1000) / 1000;
const poly = (...pts: Array<[number, number]>): GlyphPart => ({ poly: pts.map(([x, y]) => [unit(x), unit(y)] as const) });
const ink = (...pts: Array<[number, number]>): GlyphPart => ({ poly: pts.map(([x, y]) => [unit(x), unit(y)] as const), ink: true });
const disc = (x: number, y: number, r: number): GlyphPart => ({ disc: [unit(x), unit(y), unit(r)] });
const dot = (x: number, y: number, r: number): GlyphPart => ({ disc: [unit(x), unit(y), unit(r)], ink: true });
/** The same polygon mirrored about the vertical axis (a left half from a right one). */
const mirror = (...pts: Array<[number, number]>): GlyphPart => poly(...pts.map(([x, y]) => [-x, y] as [number, number]).reverse());

/** A star with `n` points, outer radii `outer(i)`, inner radius `inner`, point 0 straight up. */
function star(n: number, outer: (i: number) => number, inner: number): GlyphPart {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? outer(i / 2) : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return poly(...pts);
}

/** A six-sided ice crystal (pointed at both ends) `hw` wide and `hh` tall to each side of its middle, tilted `tiltDeg` clockwise about it, centred on (cx, cy). */
function crystal(cx: number, cy: number, hw: number, hh: number, tiltDeg: number): GlyphPart {
  const t = (tiltDeg * Math.PI) / 180;
  const pts: Array<[number, number]> = [[0, -hh], [hw, -hh * 0.55], [hw, hh * 0.45], [0, hh], [-hw, hh * 0.45], [-hw, -hh * 0.55]]
    .map(([x, y]) => [cx + x * Math.cos(t) - y * Math.sin(t), cy + x * Math.sin(t) + y * Math.cos(t)] as [number, number]);
  return poly(...pts);
}

/**
 * Fire: wyrmling, a horned head with small wings; ashDrake, bat wings spread wide over a tail.
 * Sentenced: executioner, a double-bit headsman's axe; gaoler, a key.
 * Plague: ratOgre, a round-eared head with two tusks; poxBehemoth, a lumpy bloat with dark boils.
 * Frost: glacialWarden, a cluster of three ice crystals; avalancheTroll, a hulking figure with boulder shoulders.
 * Holy: bloodSaint, a halo over a blood drop; archon, a radiant eight-ray star.
 */
export const ELITE_GLYPHS = {
  wyrmling: {
    id: "wyrmling",
    parts: [
      poly([-2, -0.4], [-5.4, -2.4], [-8.4, -8.8], [-6.2, -4.4], [-3.2, -3.2]),
      mirror([-2, -0.4], [-5.4, -2.4], [-8.4, -8.8], [-6.2, -4.4], [-3.2, -3.2]),
      poly([-4.2, -2.2], [4.2, -2.2], [5, 2], [2.4, 6], [0, 8.6], [-2.4, 6], [-5, 2]),
      dot(-2.2, 0.4, 1.15), dot(2.2, 0.4, 1.15),
    ],
  },
  ashDrake: {
    id: "ashDrake",
    parts: [
      poly([1, -1.5], [3.4, -5], [8.2, -7.6], [7.8, -2], [5.9, -3.4], [6.4, 1.6], [4.2, -0.4], [3.9, 4.2], [2.2, 1.4], [1, 2.6]),
      mirror([1, -1.5], [3.4, -5], [8.2, -7.6], [7.8, -2], [5.9, -3.4], [6.4, 1.6], [4.2, -0.4], [3.9, 4.2], [2.2, 1.4], [1, 2.6]),
      poly([0, -5.2], [1.6, -1.4], [1.2, 3.2], [0, 8.2], [-1.2, 3.2], [-1.6, -1.4]),
    ],
  },
  executioner: {
    id: "executioner",
    parts: [
      poly([-1.2, -6], [1.2, -6], [1.2, 8.2], [-1.2, 8.2]),
      poly([-1.2, -6], [0, -8.4], [1.2, -6]),
      poly([1, -5.6], [5, -8], [8.4, -8.4], [7.2, -4.2], [8.4, -0.2], [5, -0.6], [1, -2.2]),
      mirror([1, -5.6], [5, -8], [8.4, -8.4], [7.2, -4.2], [8.4, -0.2], [5, -0.6], [1, -2.2]),
    ],
  },
  gaoler: {
    id: "gaoler",
    parts: [
      disc(0, -4.3, 3.9), dot(0, -4.3, 1.5),
      poly([-1.35, -1], [1.35, -1], [1.35, 8.2], [-1.35, 8.2]),
      poly([1, 2.8], [4.4, 2.8], [4.4, 5], [1, 5]),
      poly([1, 6], [3.4, 6], [3.4, 8.2], [1, 8.2]),
    ],
  },
  ratOgre: {
    id: "ratOgre",
    parts: [
      disc(-5.2, -4.8, 3.2), disc(5.2, -4.8, 3.2), dot(-5.2, -4.8, 1.3), dot(5.2, -4.8, 1.3),
      disc(0, 0.6, 5.8),
      poly([-4.4, 4], [-1.4, 5.4], [-4.8, 8.8]),
      poly([4.4, 4], [1.4, 5.4], [4.8, 8.8]),
      dot(-2.2, -0.4, 1), dot(2.2, -0.4, 1), dot(0, 2.6, 0.9),
    ],
  },
  poxBehemoth: {
    id: "poxBehemoth",
    parts: [
      disc(0, 0.6, 6.7),
      disc(-6.3, -3.2, 1.9), disc(5.2, -5.2, 2.2), disc(6.9, 3.6, 1.8), disc(-4.2, 6.2, 2),
      dot(-2.6, -2.2, 1.6), dot(2.7, 0.4, 1.9), dot(-1.2, 3.6, 1.4),
    ],
  },
  glacialWarden: {
    id: "glacialWarden",
    parts: [
      crystal(0, -0.4, 2.9, 8.4, 0),
      crystal(-5.9, 3.8, 1.9, 4.4, -24),
      crystal(5.9, 3.8, 1.9, 4.4, 24),
    ],
  },
  avalancheTroll: {
    id: "avalancheTroll",
    parts: [
      poly([-4.2, -0.6], [-2.4, -6], [1.6, -7.2], [4.6, -3.6], [5, 1.6], [4.2, 4.4], [-3.6, 4.6]),
      poly([-8.4, 2.8], [-7.2, -0.8], [-3.2, 0.2], [-2.6, 7.8], [-8, 7.8]),
      poly([8.4, 2.6], [7.8, 7.8], [2.8, 7.8], [2.6, 2.2], [4.2, -0.6], [7.4, -1]),
      ink([-0.4, -6.4], [1.2, -3.4], [-0.2, -1.8], [1.6, 1.8], [0.6, 2.2], [-1.4, -1.6], [0, -3.4]),
    ],
  },
  bloodSaint: {
    id: "bloodSaint",
    parts: [
      disc(0, -5.3, 2.8), dot(0, -5.3, 1.35),
      poly([0, -1.4], [1.7, 1], [3.3, 3.2], [3.9, 5.2], [3.1, 7.2], [1.6, 8.2], [0, 8.4], [-1.6, 8.2], [-3.1, 7.2], [-3.9, 5.2], [-3.3, 3.2], [-1.7, 1]),
    ],
  },
  archon: {
    id: "archon",
    parts: [star(8, (i) => (i % 2 === 0 ? 8.6 : 6.2), 3.6), dot(0, 0, 1.5)],
  },
} as const satisfies Readonly<Record<string, EliteGlyph>>;

/** The ten elite types, in catalog order (zone order, then the zone's two). */
export const ELITE_TYPE_IDS: readonly MobTypeId[] = MOB_TYPES.filter((t) => t.elite).map((t) => t.id);

/** The glyph of an elite type, or null for any other id (a normal type, a type from newer content, ""). */
export function eliteGlyphOf(type: string | undefined): EliteGlyph | null {
  return type !== undefined && Object.prototype.hasOwnProperty.call(ELITE_GLYPHS, type) ? (ELITE_GLYPHS as Readonly<Record<string, EliteGlyph>>)[type]! : null;
}

// ------------------------------------------------------------------------------------------------ which camp holds which elite

/** What the elite lookup reads of a camp; `elite` says the type outright (a camp that already knows it), `spots` identifies a camp across copies. */
export type EliteCampLike = Pick<CampDef, "zone" | "eliteSpot"> & { readonly spots?: CampDef["spots"]; readonly elite?: string };

/**
 * The elite type of camps found in a full camp list, by the camp's `spots` array. A camp that is moved onto a layout slot is a copy
 * (`{ ...camp, x, y }`, as the minimap does), and a copy keeps `spots` by reference, so it still finds its elite although it is
 * painted alone, where its place among its zone's elite camps is no longer known.
 */
const KNOWN = new WeakMap<object, string>();

/** rollCampElites, with an elite camp of a zone that has no elites to hold (a hand-built map's odd zone) counted as a camp without one, not thrown at. */
function rollElites<T extends EliteCampLike>(camps: readonly T[]): Array<MobTypeId | ""> {
  return rollCampElites(camps.map((c) => (c.eliteSpot >= 0 && elitesOf(c.zone).length === 0 ? { zone: c.zone, eliteSpot: -1 } : c)));
}

/** Remembers the elite of every camp of a full camp list (the map's own); `paintMapBase` calls it for the map it paints. */
export function noteEliteCamps<T extends EliteCampLike>(camps: readonly T[]): void {
  const types = rollElites(camps);
  camps.forEach((camp, i) => {
    if (camp.spots !== undefined && typeof camp.spots === "object") KNOWN.set(camp.spots, types[i]!);
  });
}

/**
 * The elite type of each camp ("" for a camp without an elite): the type the camp says (`elite`), else the one remembered for its
 * `spots`, else the k-th elite of its zone by this list (the k-th elite camp of the zone in this list's order). A list that is a
 * subset of the map, or one hand-built camp, is therefore right when its camps carry `elite` or are the map's own, and otherwise
 * counts its own elite camps from the first.
 */
export function campEliteTypes<T extends EliteCampLike>(camps: readonly T[]): string[] {
  // The count of the list is only made when some camp has nothing better to go by (the minimap paints its camps one at a time, every frame).
  let counted: Array<MobTypeId | ""> | null = null;
  return camps.map((camp, i) => {
    if (!(camp.eliteSpot >= 0)) return "";
    if (camp.elite !== undefined && camp.elite !== "") return camp.elite;
    const known = camp.spots !== undefined && typeof camp.spots === "object" ? KNOWN.get(camp.spots) : undefined;
    if (known !== undefined) return known;
    return (counted ??= rollElites(camps))[i]!;
  });
}

// ------------------------------------------------------------------------------------------------------------------- as SVG

/** The glyph's gold and the dark of its outline and its ink: the map painter's COLOR_CROWN and COLOR_OUTLINE. */
export const GLYPH_FILL = "#ffd54f";
export const GLYPH_INK = "#0b0e11";
/** The outline's width in glyph units (the box is 2 wide): about a pixel at the planning chip's size. */
const SVG_OUTLINE = 0.3;

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

function svgShape(part: GlyphPart, paint: string): string {
  if ("disc" in part) return `<circle cx="${num(part.disc[0])}" cy="${num(part.disc[1])}" r="${num(part.disc[2])}" ${paint}/>`;
  return `<polygon points="${part.poly.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}" ${paint}/>`;
}

const svgCache = new Map<string, string>();

/**
 * The glyph as an SVG document string (gold with a dark outline round the whole silhouette, ink details dark), for a data URL on a
 * chip. Painted like the canvas does: the outlines of all the gold parts first, then the gold over them, then the ink.
 */
export function eliteGlyphSvg(glyph: EliteGlyph): string {
  let svg = svgCache.get(glyph.id);
  if (svg) return svg;
  const gold = glyph.parts.filter((p) => p.ink !== true);
  const dark = glyph.parts.filter((p) => p.ink === true);
  const edge = `fill="${GLYPH_INK}" stroke="${GLYPH_INK}" stroke-width="${SVG_OUTLINE}" stroke-linejoin="round"`;
  svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.16 -1.16 2.32 2.32">`
    + `<g>${gold.map((p) => svgShape(p, edge)).join("")}</g>`
    + `<g>${gold.map((p) => svgShape(p, `fill="${GLYPH_FILL}"`)).join("")}</g>`
    + `<g>${dark.map((p) => svgShape(p, `fill="${GLYPH_INK}"`)).join("")}</g></svg>`;
  svgCache.set(glyph.id, svg);
  return svg;
}
