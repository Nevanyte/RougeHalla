// What makes each of the ten ELITE mob types unmistakable in the world: a simple, bold emblem baked once per type and attached to the
// elite's figure, beyond the gold rings, the gold-rimmed body, the star and the gold name every elite already has (MobView). Two
// layers per type, both baked textures (render/bake.ts), so the y-sorted world stays in one draw batch:
//
//   back    under the body disc: wings, a tail, shoulder boulders, rat ears, a sunburst, a bloat;
//   front   over the disc: a hood, a helm, horns, a crown, a halo, tusks, boils.
//
// Everything is drawn in the figure's own frame, the body disc's centre at the origin, and stands upright (a billboard: it does not
// turn with the facing, which the held weapon and the nose already say), so it scales and squashes with the figure (FigureJuice). It
// reaches out to the sides and below rather than up: the hp bar sits 8 px over the disc's top and the name 18, so a headpiece rises no
// more than about 12 px over the rim (the hp bar is drawn over it). Each emblem echoes its map glyph (ui/eliteGlyphs.ts) and shares no
// silhouette with the other nine or with a normal mob (a disc with a role mark). A hit flashes the emblem white with the body: the
// flash variant is the same drawing with every fill in one colour (the Pen's `mono`), kept apart from the normal one as a bake of its own.
import type Phaser from "phaser";
import { PLAYER_RADIUS, type MobTypeId } from "@raid/shared";
import type { Region } from "./bake";

type G = Phaser.GameObjects.Graphics;
type Pt = readonly [number, number];

/** The body disc's radius in the figure (MobView.FIGURE_RADIUS). */
const R = PLAYER_RADIUS * 1.1;
/** The dark edge on every part, so a silhouette holds on any floor. */
const EDGE = 0x1b1f24;
const TAU = Math.PI * 2;

/** The texture region an emblem layer is baked in: the disc's centre is the origin; room for the widest wings, the tail and the sunburst. */
export const ELITE_ART_REGION: Region = { x0: -38, y0: -30, x1: 38, y1: 28 };

export type EliteLayer = "back" | "front";
export const ELITE_LAYERS: readonly EliteLayer[] = ["back", "front"];

/** One layer's drawing, made with a Pen on a Graphics whose origin is the body disc's centre. */
type Draw = (pen: Pen) => void;

export interface EliteArt {
  readonly id: MobTypeId;
  /** Under the body disc, or null when the type has nothing there. */
  readonly back: Draw | null;
  /** Over the body disc, or null. */
  readonly front: Draw | null;
}

// ------------------------------------------------------------------------------------------------------------------ the pen

/** Draws shapes with a dark edge onto a Graphics; in the flash variant (`mono`) every fill is that one colour. */
class Pen {
  constructor(readonly g: G, private readonly mono?: number) {}

  private c(color: number): number {
    return this.mono ?? color;
  }

  /** A filled ellipse with no edge (a shade). */
  blot(x: number, y: number, w: number, h: number, fill: number, alpha = 1): this {
    this.g.fillStyle(this.c(fill), alpha).fillEllipse(x, y, w, h);
    return this;
  }

  /** A plain rectangle (a shade, a cage's back). */
  rect(x: number, y: number, w: number, h: number, fill: number, alpha = 1): this {
    this.g.fillStyle(this.c(fill), alpha).fillRect(x, y, w, h);
    return this;
  }

  /** The outline of a circle, no edge of its own. */
  circle(x: number, y: number, r: number, w: number, color: number, alpha = 1): this {
    this.g.lineStyle(w, this.c(color), alpha).strokeCircle(x, y, r);
    return this;
  }

  /** The outline of an ellipse `rx` and `ry` out from its centre, no edge of its own. */
  oval(x: number, y: number, rx: number, ry: number, w: number, color: number, alpha = 1): this {
    this.g.lineStyle(w, this.c(color), alpha).strokeEllipse(x, y, rx * 2, ry * 2);
    return this;
  }

  /** A closed polygon, filled and edged. */
  poly(pts: readonly Pt[], fill: number, edge = EDGE, w = 1.5, alpha = 1): this {
    const g = this.g;
    g.fillStyle(this.c(fill), alpha).lineStyle(w, edge, 0.95).beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.closePath().fillPath().strokePath();
    return this;
  }

  /** A filled disc with an edge. */
  disc(x: number, y: number, r: number, fill: number, edge = EDGE, w = 1.5): this {
    this.g.fillStyle(this.c(fill), 1).lineStyle(w, edge, 0.95).fillCircle(x, y, r).strokeCircle(x, y, r);
    return this;
  }

  /** A disc with no edge (a highlight, a hole). */
  dot(x: number, y: number, r: number, fill: number, alpha = 1): this {
    this.g.fillStyle(this.c(fill), alpha).fillCircle(x, y, r);
    return this;
  }

  /** A plain line (a bone, a bar, a whisker). */
  line(x0: number, y0: number, x1: number, y1: number, w: number, color: number, alpha = 1): this {
    this.g.lineStyle(w, this.c(color), alpha).lineBetween(x0, y0, x1, y1);
    return this;
  }

  /** A line along `pts`. */
  path(pts: readonly Pt[], w: number, color: number, alpha = 1): this {
    const g = this.g;
    g.lineStyle(w, this.c(color), alpha).beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.strokePath();
    return this;
  }

  /** A ring (a halo, a key ring): `w` wide, with a dark one 2.4 wider under it. */
  ring(x: number, y: number, rx: number, ry: number, w: number, color: number): this {
    const g = this.g;
    g.lineStyle(w + 2.4, EDGE, 0.95).strokeEllipse(x, y, rx * 2, ry * 2);
    g.lineStyle(w, this.c(color), 1).strokeEllipse(x, y, rx * 2, ry * 2);
    return this;
  }

  /** A tapering rope of discs along `pts`: radius `r0` at the first, `r1` at the last; the dark edge first, so the whole rope has one outline. */
  rope(pts: readonly Pt[], r0: number, r1: number, fill: number): this {
    const g = this.g;
    const n = pts.length - 1;
    const radius = (i: number): number => r0 + ((r1 - r0) * i) / n;
    g.fillStyle(EDGE, 0.95);
    pts.forEach(([x, y], i) => g.fillCircle(x, y, radius(i) + 1.1));
    g.fillStyle(this.c(fill), 1);
    pts.forEach(([x, y], i) => g.fillCircle(x, y, radius(i)));
    return this;
  }
}

// ---------------------------------------------------------------------------------------------------------------- geometry

const mirrorX = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as const);
const shift = (pts: readonly Pt[], dx: number, dy: number, k = 1): Pt[] => pts.map(([x, y]) => [dx + x * k, dy + y * k] as const);
/** `pts` turned `deg` clockwise (on screen) about the origin. */
const turn = (pts: readonly Pt[], deg: number): Pt[] => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c] as const);
};

/** `n + 1` points along the quadratic curve p0 -> p1 -> p2. */
function quad(p0: Pt, p1: Pt, p2: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]] as const);
  }
  return out;
}

/** A lumpy outline round (cx, cy), `rx` by `ry` out, swelled by `lumps` bumps of about `amp` px, turned by `phase`. */
function blob(cx: number, cy: number, rx: number, ry: number, lumps: number, amp: number, phase: number, steps = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const bump = 1 + (amp * Math.sin(a * lumps + phase)) / Math.max(rx, ry);
    out.push([cx + Math.cos(a) * rx * bump, cy + Math.sin(a) * ry * bump] as const);
  }
  return out;
}

/** The points of an arc of the disc's rim, `r` out from the centre, between two clock-style angles (0 = straight up, clockwise). */
function rim(r: number, from: number, to: number, steps = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([Math.sin(a) * r, -Math.cos(a) * r] as const);
  }
  return out;
}

/** A bat's wing, the right one: shoulder at the origin, the wrist out and up, three fingers hanging from it; scale 1 is about 19 px out and 18 px tall. */
const WING: readonly Pt[] = [[0, -3], [7, -9.5], [17, -10.5], [19.5, -2], [14.6, -4], [15.4, 4.6], [10, 0.6], [9.2, 8.2], [5, 3.4], [0, 5.4]];
/** The wing's finger bones: from the wrist (WING[2]) to each hanging tip. */
const WING_BONES: readonly Pt[] = [WING[3]!, WING[5]!, WING[7]!];

/** A pair of bat wings at scale `k`, their shoulders `shoulderX` out either side of the centre and `shoulderY` down it, in a membrane colour with bones. */
function wings(pen: Pen, shoulderX: number, shoulderY: number, k: number, membrane: number, bone: number): void {
  for (const side of [-1, 1]) {
    const at = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [shoulderX * side + x * k * side, shoulderY + y * k] as const);
    pen.poly(at(WING), membrane, EDGE, 1.6);
    const wrist = at([WING[2]!])[0]!;
    for (const tip of at(WING_BONES)) pen.line(wrist[0], wrist[1], tip[0], tip[1], 1.3, bone, 0.9);
    const arm = at([WING[0]!, WING[1]!, WING[2]!]);
    pen.path(arm, 2, bone, 0.95);
  }
}

// ------------------------------------------------------------------------------------------------------------------ the ten

// Fire. The disc is orange.
const BONE = 0xf2e3c6;

const wyrmling: EliteArt = {
  id: "wyrmling",
  // Small wings of scorched red, folded out behind the shoulders.
  back: (pen) => wings(pen, 8, -3, 0.92, 0xc2410c, 0xffab91),
  // A pair of swept horns of bone.
  front: (pen) => {
    const horn: readonly Pt[] = [[2.4, -12.9], [5.4, -17], [11.2, -21.5], [9.6, -15.6], [9, -10.4]];
    for (const pts of [horn, mirrorX(horn)]) pen.poly(pts, BONE, EDGE, 1.5);
  },
};

const ashDrake: EliteArt = {
  id: "ashDrake",
  // Great wings of ash with ember bones, and a long tail curling off to the lower right, ending in a spade.
  back: (pen) => {
    const tail = quad([5, 10], [20, 24], [31, 9], 16);
    pen.rope(tail, 5.6, 1.6, 0x7a6e75);
    const [tx, ty] = tail[tail.length - 1]!;
    pen.poly([[tx - 3, ty + 1.6], [tx + 0.4, ty - 7.4], [tx + 4.4, ty + 0.4], [tx + 0.8, ty + 2.2]], 0xff7043, EDGE, 1.3);
    wings(pen, 7, -4, 1.36, 0x5b5058, 0xff7043);
  },
  // A crest of three ember spines.
  front: (pen) => {
    pen.poly([[-2.6, -12.7], [0, -20.4], [2.6, -12.7]], 0xff7043, EDGE, 1.4);
    pen.poly([[-6.8, -11.2], [-6.4, -18], [-2.8, -12.2]], 0xffa270, EDGE, 1.3);
    pen.poly([[6.8, -11.2], [6.4, -18], [2.8, -12.2]], 0xffa270, EDGE, 1.3);
  },
};

// Sentenced. The disc is purple.
const executioner: EliteArt = {
  id: "executioner",
  // A headsman's axe slung across the back, its broad head up over the right shoulder.
  back: (pen) => {
    const shaft: readonly Pt[] = [[-1.7, 15], [1.7, 15], [1.7, -19], [-1.7, -19]];
    const head: readonly Pt[] = [[1.5, -22], [9.5, -24], [15, -19.5], [12, -14.8], [15, -10.5], [9.5, -6], [1.5, -8.5]];
    const at = (pts: readonly Pt[]): Pt[] => shift(turn(pts, 24), 3, 3);
    pen.poly(at(shaft), 0x6d4c41, EDGE, 1.4);
    pen.poly(at(head), 0xb0bec5, EDGE, 1.5);
    pen.path(at([[9.5, -23], [14, -19.2], [11.2, -14.8], [14, -10.8], [9.4, -7.2]]), 1.2, 0xeceff1, 0.9);
  },
  // A black pointed cowl with two glowing eye slits.
  front: (pen) => {
    const cowl: Pt[] = [...rim(R + 0.8, -96, -50, 5), [-6.6, -15.6], [1.2, -22], [8, -15], ...rim(R + 0.8, 50, 96, 5), [9.4, 6], [0, 8.6], [-9.4, 6]];
    pen.poly(cowl, 0x2a2233, 0x0e0b12, 1.6);
    pen.blot(0, -1.4, 15, 11.5, 0x07050a);
    for (const x of [-3.6, 3.6]) pen.poly([[x - 2.2, -2.6], [x + 2.2, -2.6], [x + 1.6, -0.2], [x - 1.6, -0.2]], 0xff5252, 0x07050a, 0.8);
  },
};

const gaoler: EliteArt = {
  id: "gaoler",
  back: null,
  // A great helm of iron whose face is a cage of bars, and a ring of big keys hanging off the left hip.
  front: (pen) => {
    pen.poly([...rim(R + 0.8, -94, 94, 18), [R - 1, 0.6], [-(R - 1), 0.6]], 0x78909c, EDGE, 1.6);
    pen.rect(-R + 3, 0.6, (R - 3) * 2, 9.4, 0x0b0e11, 0.72);
    for (const x of [-8, -4, 0, 4, 8]) pen.line(x, 0.6, x, 10, 2.2, 0xb0bec5);
    pen.line(-R + 3, 10, R - 3, 10, 2.2, 0xb0bec5);
    pen.line(-R + 2, 0.6, R - 2, 0.6, 2.4, 0xcfd8dc);
    pen.ring(-16, 4, 4.6, 4.6, 2, 0xcfd8dc);
    for (const [x, color] of [[-19.4, 0xd4a017], [-12.6, 0xcfd8dc]] as const) {
      // A key hanging off the ring: a shaft with two teeth, and a bow with a hole.
      pen.line(x, 9, x, 19, 2.6, EDGE);
      pen.line(x, 9, x, 19, 1.3, color);
      pen.line(x, 17, x + 3, 17, 3, EDGE);
      pen.line(x, 17, x + 3, 17, 1.6, color);
      pen.disc(x, 8.6, 2.7, color, EDGE, 1.3);
      pen.dot(x, 8.6, 0.9, EDGE);
    }
  },
};

// Plague. The disc is green.
const ratOgre: EliteArt = {
  id: "ratOgre",
  // Big round ears and a long pink tail.
  back: (pen) => {
    pen.rope(quad([6, 11], [20, 22], [30, 9], 12), 2.4, 1.1, 0xf8bbd0);
    for (const side of [-1, 1]) {
      pen.disc(10.8 * side, -11.6, 6.8, 0xa1887f, EDGE, 1.6);
      pen.dot(10.8 * side, -11, 4, 0xf8bbd0);
    }
  },
  // Beady eyes, a pink snout, whiskers and a pair of ivory tusks.
  front: (pen) => {
    for (const side of [-1, 1]) {
      for (const dy of [-1.6, 1.4, 4.4]) pen.line(5 * side, 5.4 + dy * 0.2, 17 * side, 3 + dy * 2, 1.1, 0xeceff1, 0.95);
    }
    for (const side of [-1, 1]) {
      pen.disc(4.4 * side, -3, 2.3, 0x14110f, EDGE, 0.8);
      pen.dot(4.9 * side, -3.7, 0.8, 0xffffff);
      pen.poly([[5.4 * side, 6.6], [2.8 * side, 8.4], [8.6 * side, -0.6]], 0xfff8e1, EDGE, 1.3);
    }
    pen.disc(0, 4.2, 2.7, 0xf48fb1, EDGE, 1.2);
  },
};

const poxBehemoth: EliteArt = {
  id: "poxBehemoth",
  // A bloated, sickly body swelling out all round the disc, with boils on it.
  back: (pen) => {
    pen.poly(blob(0, 3, 20.4, 18.4, 5, 2.6, 0.7), 0xc5e17a, 0x45531c, 1.8);
    pen.blot(0, 15, 24, 8, 0x93a851, 0.55);
    for (const [x, y, r] of [[-16.4, -3, 3.6], [15.6, -5, 4.2], [11.6, 11.4, 3.4], [-10.4, 12.6, 3.2], [-1, -17, 2.8]] as const) boil(pen, x, y, r);
  },
  // Boils on the body itself.
  front: (pen) => {
    for (const [x, y, r] of [[-5.4, -6, 3.2], [6.4, -1.4, 3.6], [-2, 7, 3], [-8.4, 2.4, 1.8], [2.4, -9.6, 1.7]] as const) boil(pen, x, y, r);
  },
};

/** A boil: pale pus in a dark-green rim, with a gleam. */
function boil(pen: Pen, x: number, y: number, r: number): void {
  pen.disc(x, y, r, 0xfff59d, 0x4f6a16, 1.4);
  pen.dot(x - r * 0.3, y - r * 0.35, Math.max(0.7, r * 0.28), 0xffffff, 0.9);
}

// Frost. The disc is blue.
const glacialWarden: EliteArt = {
  id: "glacialWarden",
  back: null,
  // A crown of five long ice spikes fanned over the head.
  front: (pen) => {
    const spike = (angle: number, len: number, half: number): void => {
      const a = (angle * Math.PI) / 180;
      const dir: Pt = [Math.sin(a), -Math.cos(a)];
      const side: Pt = [Math.cos(a), Math.sin(a)];
      const base = (r: number, s: number): Pt => [dir[0] * r + side[0] * s, dir[1] * r + side[1] * s] as const;
      pen.poly([base(R - 1.5, -half), base(R + len, 0), base(R - 1.5, half)], 0xe1f5fe, 0x0d3b66, 1.4);
      pen.poly([base(R - 1.5, 0), base(R + len, 0), base(R - 1.5, half)], 0x81d4fa, 0x0d3b66, 1.1);
    };
    spike(-66, 7.4, 3.2);
    spike(66, 7.4, 3.2);
    spike(-34, 10, 3.4);
    spike(34, 10, 3.4);
    spike(0, 12, 3.6);
  },
};

const avalancheTroll: EliteArt = {
  id: "avalancheTroll",
  // Two huge boulders for shoulders, a cap of snow on each.
  back: (pen) => {
    for (const side of [-1, 1]) {
      const [cx, cy, rx, ry] = [19 * side, -1.2, 10.6, 10.4];
      const at = (fx: number, fy: number): Pt => [cx + fx * rx * side, cy + fy * ry] as const;
      pen.poly(blob(cx, cy, rx, ry, 6, 1.8, side * 1.3, 18), 0x78909c, 0x263238, 1.8);
      // The lit face to the upper inside, the shaded one low and out, a crack, and a cap of snow.
      pen.poly([at(-0.8, -0.1), at(-0.35, -0.8), at(0.35, -0.55), at(0, 0.1)].map(([x, y]) => [x, y] as const), 0xb0bec5, 0x78909c, 0.6, 0.85);
      pen.poly([at(0.15, 0), at(0.95, 0.25), at(0.55, 0.9), at(-0.25, 0.8)], 0x37474f, 0x37474f, 0.6, 0.4);
      pen.path([at(0.1, 0.05), at(0.3, 0.4), at(0.05, 0.62), at(0.28, 0.9)], 1.3, 0x263238, 0.85);
      pen.poly([at(-0.8, -0.35), at(-0.5, -0.88), at(0.12, -1.04), at(0.68, -0.72), at(0.88, -0.2), at(0.46, -0.46), at(0.16, -0.14), at(-0.2, -0.5), at(-0.46, -0.1)], 0xf5fbff, 0x607d8b, 1.2);
    }
  },
  // A snowcap on the head and a crack across the brow.
  front: (pen) => {
    pen.poly([...rim(R + 0.6, -70, 70, 12), ...rim(R - 3.2, 70, -70, 12)], 0xf5fbff, 0x607d8b, 1.3);
    pen.path([[-3, -3], [-0.6, -0.2], [-2, 2.6], [1.4, 5.4]], 1.4, 0x263238, 0.8);
  },
};

// Holy. The disc is yellow.
const bloodSaint: EliteArt = {
  id: "bloodSaint",
  back: null,
  // A halo hovering over the head, and a blood drop on the breast with two more falling.
  front: (pen) => {
    pen.ring(0, -17.6, 9.6, 3.2, 2.4, 0xffd54f);
    pen.oval(0, -17.6, 9.6, 3.2, 0.9, 0xfffde7, 0.9);
    // A drop of scale k centred on (cx, cy): its tip straight up, its bulb a circle of 5.8 k round (0, 2.6 k) (the tangents leave at 56.8 degrees).
    const drop = (cx: number, cy: number, k: number): void => {
      const pts: Pt[] = [[0, -8 * k]];
      const bulb = 5.8 * k;
      for (let i = 0; i <= 16; i++) {
        const a = ((56.8 + (246.4 * i) / 16) * Math.PI) / 180;
        pts.push([Math.sin(a) * bulb, 2.6 * k - Math.cos(a) * bulb] as const);
      }
      pen.poly(shift(pts, cx, cy), 0xc62828, 0x4a0d0d, 1.4);
      pen.dot(cx - 2 * k, cy + 2.4 * k, 1.4 * k, 0xffffff, 0.75);
    };
    drop(0, 1, 1);
    drop(-9, 17, 0.42);
    drop(8, 19, 0.34);
  },
};

const archon: EliteArt = {
  id: "archon",
  // A radiant sunburst round the whole figure: long gold rays and short pale ones, the ones over the head cut short.
  back: (pen) => {
    pen.circle(0, 0, R + 2, 3.2, 0xfff9c4, 0.9);
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU - Math.PI / 2;
      const long = i % 2 === 0;
      const up = Math.max(0, -Math.sin(a));
      const len = (long ? 25 : 20) - up * (long ? 6 : 3.5);
      const half = long ? 0.13 : 0.15;
      const at = (r: number, da: number): Pt => [Math.cos(a + da) * r, Math.sin(a + da) * r] as const;
      pen.poly([at(R + 0.4, -half), at(len, 0), at(R + 0.4, half)], long ? 0xffd54f : 0xfff8e1, 0x7a5a00, 1.3);
    }
  },
  front: null,
};

// ------------------------------------------------------------------------------------------------------------------ lookup

/** The ten elites' emblems, by type id. */
export const ELITE_ART = {
  wyrmling, ashDrake, executioner, gaoler, ratOgre, poxBehemoth, glacialWarden, avalancheTroll, bloodSaint, archon,
} as const satisfies Readonly<Record<string, EliteArt>>;

/** The emblem of an elite type, or null for any other id (a normal type, a type from newer content, ""). */
export function eliteArtOf(type: string | undefined): EliteArt | null {
  return type !== undefined && Object.prototype.hasOwnProperty.call(ELITE_ART, type) ? (ELITE_ART as Readonly<Record<string, EliteArt>>)[type]! : null;
}

/** The bake key of one layer of a type's emblem; the flash variant is the same drawing in white. */
export const eliteArtKey = (type: string, layer: EliteLayer, flash = false): string => `elite:${type}:${layer}${flash ? ":flash" : ""}`;

/** The flash colour of the white variant. */
export const ELITE_FLASH = 0xffffff;

/** Draws one layer of an emblem into a Graphics (the bake's draw). `flash` repaints it white. */
export function drawEliteLayer(g: G, art: EliteArt, layer: EliteLayer, flash = false): void {
  const draw = art[layer];
  if (draw) draw(new Pen(g, flash ? ELITE_FLASH : undefined));
}
