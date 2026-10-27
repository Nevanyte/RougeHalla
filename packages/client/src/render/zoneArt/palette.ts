// The zone palettes (part D 7.2): placeholder colours for the five themed zones and the terrain kinds, plus the small colour
// helpers the art uses. Pure and free of Phaser. Floors stay dark in every zone (CIE L* 15 to 35) so fighters, projectiles and hp
// bars keep today's contrast; the character comes from walls, hazards and decor. The test pins the contrast ratios of the table.
import type { RegionFaction } from "@raid/shared";

export type ZoneKey = RegionFaction;

export interface ZonePalette {
  /** Plain ground, and the alternate tint a hash-picked share of the tiles takes. */
  floor: number;
  floorAlt: number;
  /** Small marks on the ground (flecks, mortar, grout, scratches). */
  floorMark: number;
  /** A wall's top face and front face. */
  wallTop: number;
  wallFront: number;
  /** A lighter line for a wall's top rim (the lit edge). */
  wallRim: number;
  /** The zone's accent (cracks, trim, banners). */
  accent: number;
  /** Particles of the zone (embers, spores, sparkles, motes). */
  particle: number;
}

export const ZONE_PALETTE: Readonly<Record<ZoneKey, ZonePalette>> = {
  // Scorch: ash and obsidian.
  fire: {
    floor: 0x2d2622, floorAlt: 0x38302b, floorMark: 0x453a33,
    wallTop: 0x5b4a66, wallFront: 0x2a2231, wallRim: 0x8a74a0, accent: 0xff6a1a, particle: 0xffb74d,
  },
  // Gallows: cell stone and iron.
  sentenced: {
    floor: 0x3a3b42, floorAlt: 0x44454d, floorMark: 0x2c2d33,
    wallTop: 0x7b7e8a, wallFront: 0x4b4e58, wallRim: 0xa4a8b6, accent: 0x7e57c2, particle: 0x9aa0ab,
  },
  // Warren: swamp, moss and fungus.
  plague: {
    floor: 0x2a3326, floorAlt: 0x323d2c, floorMark: 0x3d4a35,
    wallTop: 0x6d7f4a, wallFront: 0x34452a, wallRim: 0x9bb066, accent: 0xb5e35a, particle: 0xc5e1a5,
  },
  // Rime: glacier; a blue-slate floor, white on ice and walls.
  frost: {
    floor: 0x34495e, floorAlt: 0x3b546b, floorMark: 0x4c6a85,
    wallTop: 0xd4edf9, wallFront: 0x6f9fbd, wallRim: 0xffffff, accent: 0x4aa3df, particle: 0xffffff,
  },
  // Sanctum: a cathedral hall; cream stone and gold.
  holy: {
    floor: 0x4a4234, floorAlt: 0x544b3b, floorMark: 0x6a5f49,
    wallTop: 0xe9dfc0, wallFront: 0xb3a37a, wallRim: 0xfff6d6, accent: 0xd4af37, particle: 0xfff2b0,
  },
};

/** Colours of the terrain kinds (D 7.2): the values the contrast table is about. */
export const TERRAIN_PALETTE = {
  lava: { body: 0xff5a14, core: 0xffb347, crust: 0x3b1a10 },
  ember: { base: 0x5a2412, glow: 0xff8a2a, cracks: 0xffd27a },
  fence: { iron: 0x1c1d22, highlight: 0x8d93a3, wood: 0x6d4c41 },
  bog: { body: 0x3a5f22, surface: 0x8fc25a, bubbles: 0xc5e1a5, sludge: 0x1f2a1a },
  ice: { body: 0x8cc8e8, highlight: 0xeaf8ff, crack: 0x5a8ca8 },
  crevasse: { body: 0x0a1626, edge: 0x4aa3df, deep: 0x050b14 },
  light: { beam: 0xfff2b0, warm: 0xffe28a },
  gallows: { banner: 0x7e57c2, bannerDark: 0x4527a0, chain: 0x9aa0ab },
  sanctum: { gold: 0xd4af37, blood: 0x8e1b1b },
} as const;

/**
 * The colours of the zone shapes (contract 7.5): a crater's lip and ash bowl, a barrow's moss, a hall's piers, and the masonry of the
 * five landmark designs. Walls keep the zone's own wall palette for everything else; these are what a named feature adds, so a
 * player reads "this wall is a crater" from the colour and the marks together (colour is never the only cue: featureStyle.ts).
 */
export const SHAPE_PALETTE = {
  crater: { lip: 0xff9a4a, lipDeep: 0xb4501c, ash: 0x100b09, dust: 0x7a685c, crack: 0xff8a2a },
  mound: { moss: 0x9bc05a, mossDark: 0x3f5a28, rock: 0x4c5a3a, earth: 0x5a4a32 },
  pier: { shaft: 0xd9ceaa, cap: 0xfff0c0, base: 0x8c7f5a, gold: 0xd4af37, slab: 0x6a5f49 },
  forge: { top: 0x3b3342, front: 0x1f1a26, rim: 0x7a6590, mortar: 0x120e18, glow: 0xff7a2a, hot: 0xffd27a, floor: 0x1c1513 },
  guardHouse: { top: 0x8e919d, front: 0x535763, rim: 0xc8ccda, mortar: 0x34363f, iron: 0x1b1d24, floor: 0x33343b },
  burrow: { top: 0x7c5c3e, front: 0x47341f, rim: 0xb08a62, mortar: 0x2a1f14, timber: 0x654526, timberHi: 0xa87a4a, root: 0x6f8f3c, floor: 0x33271c },
  watchtower: { top: 0xcfe3f3, front: 0x7f9fba, rim: 0xffffff, mortar: 0x587792, ice: 0xeaf8ff, floor: 0x2f4357 },
  shrine: { top: 0xf2ecd8, front: 0xcdc29f, rim: 0xffffff, mortar: 0xa59a78, gold: 0xd4af37, vein: 0x8f9db0, floor: 0x5d5545 },
  gallows: { top: 0x6e553a, front: 0x3e2d1c, plank: 0x4a3826, rim: 0xa07f58, rope: 0xcbb28a },
  tunnel: { dark: 0x050806, damp: 0x6f8a5a },
  snow: { packed: 0xe3ecf2, shade: 0xb4c7d4 },
  shore: { slush: 0xcfe9f7, rim: 0xeaf8ff },
  ford: { slab: 0x6d6a66, slabHi: 0x9a968f, slabLo: 0x3c3a38 },
} as const;

export const WALL_TINT_NEUTRAL = 0x8a9099;

// ---------------------------------------------------------------------------------------------------------------- colour maths

/** The 0..255 channels of 0xRRGGBB. */
export function channels(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

export function rgb(r: number, g: number, b: number): number {
  const q = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

/** `a` toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Toward white by `t`. */
export function lighten(c: number, t: number): number {
  return mix(c, 0xffffff, t);
}

/** Toward black by `t`. */
export function darken(c: number, t: number): number {
  return mix(c, 0x000000, t);
}

function linear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0..1. */
export function relativeLuminance(c: number): number {
  const [r, g, b] = channels(c);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio of two colours, 1..21, whichever is lighter. */
export function contrastRatio(a: number, b: number): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** CIE L* (0..100), the lightness the floors are bounded by. */
export function lightness(c: number): number {
  const y = relativeLuminance(c);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** Whether a faction id has a zone palette (the five faction regions; not the coliseum or "none"). */
export function isZoneKey(id: string): id is ZoneKey {
  return Object.prototype.hasOwnProperty.call(ZONE_PALETTE, id);
}

/** The unthemed ground: the coliseum and the neutral stone of the ring and ridges (today's look, unchanged by the zone art). */
export const NEUTRAL_PALETTE = {
  floor: 0x2a3038,
  coliseumFloor: mix(0x2a3038, 0xc8b48a, 0.22),
  /** Laid over a landmark building's box (map.buildings), so a building reads as indoors in every zone. */
  indoor: 0x1c1612,
  indoorAlpha: 0.45,
} as const;
