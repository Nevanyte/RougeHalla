// Sanctum (holy): cathedral ruins. Symmetric colonnades, broken arches and cloister courtyards with a light shaft each.
// Symmetry is per structure (each colonnade and cloister mirrors about its own axis): four camp clearings, spawns and ruins
// make a zone-wide mirror impossible. Colonnade rows are the most efficient lane cutters (0.9 rock tile per pillar tile).
// Holy heals double in light: an economy advantage (a rest chain), not a duel one. Part D 4.5's recipe, scaled to the zone.
// A structure is a list of pillar sites computed from its centre, size and axis alone; where it goes is chosen by sampling
// centres and keeping the one whose sites fall on the most open ground (a finished map leaves little clean ground, so a free
// rectangle is rare), and a cloister needs a clean 3x3 of floor for its shaft.
import { TILE_FLOOR, TILE_WALL } from "../map";
import { TERRAIN_LIGHT } from "../terrain";
import { randInt } from "../rng";
import { chance, roomOf, wall } from "./kit";
import type { Rect } from "./kit";
import { PROP } from "./propKinds";
import { sizeScale } from "./scale";
import type { PropCtx, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";

export type StructureKind = "nave" | "cloister" | "avenue";

export interface StructurePlan {
  kind: StructureKind;
  rect: Rect;
  /** The structure's long axis is horizontal; its mirror line runs along it. */
  horizontal: boolean;
  cx: number;
  cy: number;
  /** Pillar positions before any break coin: mirror-symmetric by construction (tile indices). */
  planned: number[];
  /** The pillars (and walls) the styler actually wrote. */
  placed: number[];
  /** Centre tile of the 3x3 light shaft, or -1 when no clean 3x3 fitted. */
  shaft: number;
  /** Altar wall tiles (the nave). */
  altar: number[];
}

export interface SanctumPlan {
  structures: StructurePlan[];
}

/** One pillar site: its offset from the structure's centre along (v) and across (u) the long axis, and the chance it is broken. */
interface Site { u: number; v: number; broken: number }

interface Layout {
  kind: StructureKind;
  /** Half extent along and across the long axis. */
  halfLong: number;
  halfShort: number;
  sites: Site[];
  /** Sites mirrored about the axis: (u, v) and (-u, v) both exist. */
  altar: Array<[number, number]>;
  /** The shaft's centre offset (u, v). */
  shaft: [number, number];
}

/** A cloister: a ring of pillars at pitch 2 with four 2-tile gaps and a light shaft in the middle. */
function cloister(hs: number): Layout {
  const sites: Site[] = [];
  for (let a = -hs; a <= hs; a++) {
    for (let b = -hs; b <= hs; b++) {
      const edge = Math.abs(a) === hs || Math.abs(b) === hs;
      if (!edge || (Math.abs(a) <= 1 && Math.abs(b) === hs) || (Math.abs(b) <= 1 && Math.abs(a) === hs)) continue;
      if ((Math.abs(a) === hs && ((b + hs) & 1) !== 0) || (Math.abs(b) === hs && ((a + hs) & 1) !== 0)) continue;
      sites.push({ u: a, v: b, broken: 0.12 });
    }
  }
  return { kind: "cloister", halfLong: hs, halfShort: hs, sites, altar: [], shaft: [0, 0] };
}

/** An avenue (two pillar rows) or a nave (two colonnades, arches near the ends, an altar). */
function colonnade(kind: "nave" | "avenue", half: number, U: number): Layout {
  const sites: Site[] = [];
  for (let v = -half + 1; v <= half - 1; v += 2) { sites.push({ u: U, v, broken: 0.15 }); sites.push({ u: -U, v, broken: 0.15 }); }
  const altar: Array<[number, number]> = [];
  if (kind === "nave") {
    for (const v of [-half + 2, half - 2]) { sites.push({ u: 2, v, broken: 0.35 }); sites.push({ u: -2, v, broken: 0.35 }); }
    for (const du of [-1, 0, 1]) altar.push([du, half - 1]);
  }
  return { kind, halfLong: half, halfShort: U + 1, sites, altar, shaft: kind === "nave" ? [0, -3] : [0, 0] };
}

interface Step { kind: StructureKind; layouts: Layout[] }

function plan(sc: number): Step[] {
  const big = sc >= 0.85;
  const clo: Layout[] = big ? [cloister(4), cloister(3)] : [cloister(3)];
  const nave: Layout[] = big ? [colonnade("nave", 12, 4), colonnade("nave", 9, 4)] : [colonnade("nave", 8, 4), colonnade("nave", 6, 3)];
  const avenue: Layout[] = [colonnade("avenue", big ? 8 : 6, 3), colonnade("avenue", big ? 6 : 5, 2)];
  return [
    { kind: "nave", layouts: nave },
    { kind: "cloister", layouts: clo },
    { kind: "cloister", layouts: clo },
    { kind: "avenue", layouts: avenue },
    { kind: "cloister", layouts: clo },
    { kind: "avenue", layouts: avenue },
  ];
}

function shape(c: ShapeCtx): SanctumPlan {
  const r = c.rng;
  const w = c.w;
  const sc = sizeScale(c.zone.painted);
  const out: SanctumPlan = { structures: [] };
  // on open ground a structure must stand wholly on ground it can take; a finished map leaves strips, so a third of it will do
  const minOpen = roomOf(c) > 0.4 ? 0.9 : 0.3;
  const taken: Rect[] = [];
  const bb = c.zone.bbox;
  const apart = (a: Rect, b: Rect): boolean => a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y;
  /** A clean 3x3 of floor (LIGHT stands on any unprotected floor, the ring band included) around (sx, sy) or one tile off it; the centre index or -1. */
  const shaftAt = (sx: number, sy: number): number => {
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let clean = true;
      for (let b = -1; b <= 1 && clean; b++) {
        for (let a = -1; a <= 1; a++) {
          const i = c.at(sx + ox + a, sy + oy + b);
          if (i < 0 || c.tiles[i] !== TILE_FLOOR || c.hard[i] || !c.mask[i] || c.isReserved(i)) { clean = false; break; }
        }
      }
      if (clean) return c.at(sx + ox, sy + oy);
    }
    return -1;
  };
  // centres of the clean 3x3 patches of floor: where a shaft can stand (a cloister is built around one)
  const patches: number[] = [];
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      const i = c.at(x, y);
      if (c.tiles[i] === TILE_FLOOR && c.mask[i] && !c.hard[i] && shaftAt(x, y) === i) patches.push(i);
    }
  }
  for (const step of plan(sc)) {
    let best: { layout: Layout; cx: number; cy: number; horizontal: boolean; score: number; rect: Rect; shaft: number } | null = null;
    for (let t = 0; t < 160; t++) {
      const layout = step.layouts[randInt(r, 0, step.layouts.length)];
      const horizontal = chance(r, 0.5);
      let cx = bb.x + randInt(r, 0, bb.w), cy = bb.y + randInt(r, 0, bb.h);
      if (layout.kind !== "avenue" && patches.length > 0 && chance(r, 0.75)) {
        const p = patches[randInt(r, 0, patches.length)];
        const px = p % w, py = (p - px) / w;
        cx = layout.kind === "cloister" || !horizontal ? px : px + 3;
        cy = layout.kind === "cloister" || horizontal ? py : py + 3;
      }
      const at = (u: number, v: number): number => (horizontal ? c.at(cx + v, cy + u) : c.at(cx + u, cy + v));
      const hl = layout.halfLong, hsh = layout.halfShort;
      const rect: Rect = horizontal ? { x: cx - hl, y: cy - hsh, w: 2 * hl + 1, h: 2 * hsh + 1 } : { x: cx - hsh, y: cy - hl, w: 2 * hsh + 1, h: 2 * hl + 1 };
      if (taken.some((o) => !apart(o, rect))) continue;
      let open = 0, inZone = 0;
      for (const s of layout.sites) {
        const i = at(s.u, s.v);
        if (i >= 0 && c.mask[i]) inZone++;
        if (i >= 0 && c.open(i)) open++;
      }
      if (inZone < Math.ceil(layout.sites.length * 0.8) || open < Math.ceil(layout.sites.length * minOpen)) continue;
      // a cloister or nave wants a light shaft: a clean 3x3 of floor is worth six pillars, but a structure without one stands
      let shaft = -1;
      if (layout.kind !== "avenue") {
        const si = at(layout.shaft[0], layout.shaft[1]);
        if (si >= 0) shaft = shaftAt(si % w, (si - (si % w)) / w);
      }
      const score = open + (shaft >= 0 ? 6 : 0);
      if (!best || score > best.score) best = { layout, cx, cy, horizontal, score, rect, shaft };
    }
    if (!best) continue;
    const { layout, cx, cy, horizontal } = best;
    const at = (u: number, v: number): number => (horizontal ? c.at(cx + v, cy + u) : c.at(cx + u, cy + v));
    const st: StructurePlan = { kind: layout.kind, rect: best.rect, horizontal, cx, cy, planned: [], placed: [], shaft: best.shaft, altar: [] };
    if (best.shaft >= 0) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) c.reserve(c.at((best.shaft % w) + a, Math.floor(best.shaft / w) + b));
    for (const s of layout.sites) {
      const i = at(s.u, s.v);
      if (i < 0) continue;
      st.planned.push(i);
      if (chance(r, s.broken)) continue;
      if (wall(c, i % w, (i - (i % w)) / w)) st.placed.push(i);
    }
    for (const [u, v] of layout.altar) {
      const i = at(u, v);
      if (i >= 0 && wall(c, i % w, (i - (i % w)) / w)) { st.placed.push(i); st.altar.push(i); }
    }
    out.structures.push(st);
    taken.push(best.rect);
  }
  return out;
}

function surface(c: SurfaceCtx, plan: SanctumPlan): void {
  for (const st of plan.structures) {
    if (st.shaft < 0) continue;
    const sx = st.shaft % c.w, sy = (st.shaft - sx) / c.w;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) c.surface(c.at(sx + a, sy + b), "light");
  }
}

function props(c: PropCtx, plan: SanctumPlan): void {
  const n = c.w * c.h;
  const pillar = new Uint8Array(n);
  for (const st of plan.structures) for (const i of st.placed) pillar[i] = 1;
  const nearAltar = new Uint8Array(n);
  for (const st of plan.structures) {
    for (const i of st.altar) {
      const x = i % c.w, y = (i - x) / c.w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = c.at(x + dx, y + dy); if (j >= 0) nearAltar[j] = 1; }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!c.mask[i]) continue;
    const x = i % c.w, y = (i - x) / c.w;
    const v = Math.floor(c.noise.hash(x, y, 90) * 3);
    const t = c.tiles[i];
    if (t === TILE_WALL) {
      if (pillar[i] && c.noise.hash(x, y, 1) < 0.35) c.prop(PROP.column_cap, x, y, v);
      else if (c.noise.hash(x, y, 2) < 0.04) c.prop(PROP.banner_red, x, y, v);
    } else if (t === TILE_FLOOR) {
      if (nearAltar[i] && c.noise.hash(x, y, 3) < 0.4) c.prop(PROP.candelabra, x, y, v);
      else if (c.terrain[i] === 0 && c.noise.hash(x, y, 4) < 0.01) c.prop(PROP.rubble, x, y, v);
      else if (c.terrain[i] === 0) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = c.at(x + dx, y + dy);
          if (j >= 0 && c.terrain[j] === TERRAIN_LIGHT) { if (c.noise.hash(x, y, 5) < 0.3) c.prop(PROP.stained_glass, x, y, v); break; }
        }
      }
    }
  }
}

export const sanctum: ZoneStyler<SanctumPlan> = { id: "sanctum", faction: "holy", version: 1, shape, surface, props };
