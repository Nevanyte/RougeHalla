// The wedge generator's output, pinned. ROGUELIKE_PLAN R0 gate: "the hash of the 200 generated maps is unchanged".
// The R0 adapter may only ADD fields to a map. This test hashes every field that existed before R0 and ignores any
// field added since, so it stays green as long as the wedge maps themselves are untouched.
// R2 (the zone generator) replaces the maps on purpose and will replace this test with it.
import { describe, expect, it } from "vitest";
import type { GameMap } from "../src/map";
import { generateMap } from "../src/mapgen";
import type { Vec2 } from "../src/messages";

/** FNV-1a (32 bit) over a stream of bytes. */
class Fnv {
  h = 0x811c9dc5;
  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), 0x01000193) >>> 0;
  }
  bytes(a: Uint8Array): void {
    for (let i = 0; i < a.length; i++) this.byte(a[i]);
  }
  /** Text is ASCII here (ids, weapon names, numbers), plus a separator so "ab","c" differs from "a","bc". */
  str(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
    this.byte(0x1f);
  }
  num(n: number): void { this.str(String(n)); }
  bool(b: boolean): void { this.byte(b ? 1 : 0); }
  vec(p: Vec2): void { this.num(p.x); this.num(p.y); }
  vecs(a: readonly Vec2[]): void { this.num(a.length); for (const p of a) this.vec(p); }
}

/** Every field of a pre-R0 GameMap, in a fixed order. Fields added after R0 are deliberately absent. */
function hashLegacyMap(m: GameMap): number {
  const f = new Fnv();
  f.num(m.seed);
  f.num(m.w);
  f.num(m.h);
  f.bytes(m.tiles);
  f.bytes(m.regionGrid);

  const c = m.coliseum;
  f.num(c.rect.x); f.num(c.rect.y); f.num(c.rect.w); f.num(c.rect.h);
  f.vec(c.centre);
  f.num(c.gates.length);
  for (const g of c.gates) {
    f.str(g.side);
    f.num(g.tiles.length);
    for (const t of g.tiles) { f.num(t.x); f.num(t.y); }
    f.num(g.x); f.num(g.y);
  }
  f.vecs(c.innerSpawns);

  f.num(m.regions.length);
  for (const r of m.regions) {
    f.str(r.id);
    f.vec(r.anchor);
    f.vecs(r.spawns);
    f.vecs(r.chestSpots);
    f.num(r.mobCamps.length);
    for (const mc of r.mobCamps) {
      f.str(mc.id);
      f.str(mc.region);
      f.num(mc.x); f.num(mc.y); f.num(mc.r);
      f.vecs(mc.spots);
      f.bool(mc.elite);
      f.str(mc.weapon);
    }
  }

  f.num(m.buildings.length);
  for (const b of m.buildings) { f.num(b.x); f.num(b.y); f.num(b.w); f.num(b.h); }
  f.vecs(m.spawns);
  f.num(m.extracts.length);
  for (const x of m.extracts) { f.str(x.id); f.str(x.name); f.num(x.x); f.num(x.y); f.num(x.r); }
  f.vecs(m.crateSpots);
  f.vecs(m.groundSpots);
  return f.h;
}

const hex = (n: number) => n.toString(16).padStart(8, "0");

/** Seeds 0..199 in groups of 20, so a failing run says which seeds moved. */
const GROUP = 20;
const SEED_COUNT = 200;

/** Recorded with the generator as it stood before R0 (commit d35f4ba, no adapter fields yet). */
const LEGACY_WEDGE_GROUP_HASHES_PRE_R0: readonly string[] = [
  "1cfd9032", "0c80e60b", "e3ec147e", "8e804aca", "af5d0ed2", "d280d60b", "33d3cfec", "04f9b829", "6ead28cd", "37daa890",
];
/** The 200 seeds hashed together: the one number the R0 gate names. */
const LEGACY_WEDGE_HASH_PRE_R0 = "c214258d";

describe("legacy wedge maps (pre-R0 hash)", () => {
  it("the 200 generated maps hash to the value recorded before R0", () => {
    const all = new Fnv();
    const groups: string[] = [];
    for (let g = 0; g < SEED_COUNT; g += GROUP) {
      const gf = new Fnv();
      for (let s = g; s < g + GROUP; s++) {
        const h = hashLegacyMap(generateMap(s));
        gf.num(h);
        all.num(h);
      }
      groups.push(hex(gf.h));
    }
    expect(groups).toEqual(LEGACY_WEDGE_GROUP_HASHES_PRE_R0);
    expect(hex(all.h)).toBe(LEGACY_WEDGE_HASH_PRE_R0);
  }, 180_000);
});
