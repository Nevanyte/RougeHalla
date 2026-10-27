// PULL_WINDOW recheck (zone-shapes contract 7.1): how much longer than the unbounded string pull is the shipped findPath, and what does it cost?
//   npx tsx packages/server/bench/pullWindow.ts [--maps 40] [--seed0 0] [--pairs 2000]
//   npx tsx packages/server/bench/pullWindow.ts --lib /path/to/pathfindW.ts --windows 32,48,64,96   the whole table, from a copy of pathfind.ts
//                                                                   that exports `findPath` and `setWindow(n)` (WP0a's is in the zone-shapes phase A scratchpad, pw/pathfindW.ts)
// Per map: `--pairs` path pairs (default 2000): 1000 random floor pairs, every pool member to the coliseum centre, every camp pair of a zone that
// is an edge of the zone's Gabriel graph, 500 lock chases (random floor pairs within 640 u), topped up with random pairs. For each window it prints the
// share of paths more than 1% longer than the unbounded pull, the longest ratio, and the cost per path (us, p50 / p99 / mean).
// Without --lib the two rows are the shipped findPath (PULL_WINDOW, shared/pathfind.ts) and the unbounded reference (shared/test/findPathReference.ts).
// The rule (contract 7.1): keep the smallest window with at most 0.5% of paths more than 1% longer and a p99 cost within 1.3x of the 32 window's. Changing
// PULL_WINDOW re-pins every map (the generator certifies the spawn walks with findPath), so a change goes to the orchestrator before phase C pins.
import { FACTION_IDS, findPath as shippedFindPath, generateMap, mulberry32, PULL_WINDOW, randInt, TILE_FLOOR, tileToWorldCenter, type GameMap, type Vec2 } from "@raid/shared";
import { findPathReference } from "../../shared/test/findPathReference";

type FindPath = (map: GameMap, from: Vec2, to: Vec2) => Vec2[];
interface Row { label: string; find: FindPath; before?: () => void }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const len = (a: Vec2, ps: readonly Vec2[]): number => {
  let total = 0, x = a.x, y = a.y;
  for (const p of ps) { total += Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2); x = p.x; y = p.y; }
  return total;
};
const quantile = (xs: number[], q: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

/** The pairs of one map (see the header), deterministic in (map, index). */
export function pullPairs(map: GameMap, index: number, total = 2000): Array<{ a: Vec2; b: Vec2 }> {
  const rng = mulberry32(1000 + index);
  const floor: number[] = [];
  for (let i = 0; i < map.w * map.h; i++) if (map.tiles[i] === TILE_FLOOR) floor.push(i);
  const pt = (i: number): Vec2 => ({ x: tileToWorldCenter(i % map.w) + (rng() - 0.5) * 20, y: tileToWorldCenter(Math.floor(i / map.w)) + (rng() - 0.5) * 20 });
  const any = (): Vec2 => pt(floor[randInt(rng, 0, floor.length)]!);
  const pairs: Array<{ a: Vec2; b: Vec2 }> = [];
  for (let k = 0; k < Math.min(1000, total); k++) pairs.push({ a: any(), b: any() });
  for (const p of map.spawnPool) pairs.push({ a: p, b: map.coliseum.centre });
  for (const zone of FACTION_IDS) {
    const cs = map.camps.filter((c) => c.zone === zone);
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const mx = (cs[i]!.x + cs[j]!.x) / 2, my = (cs[i]!.y + cs[j]!.y) / 2;
        const r2 = ((cs[i]!.x - cs[j]!.x) ** 2 + (cs[i]!.y - cs[j]!.y) ** 2) / 4;
        // Gabriel edge: no other camp of the zone inside the circle on the segment.
        if (cs.every((k, q) => q === i || q === j || (k.x - mx) ** 2 + (k.y - my) ** 2 >= r2)) pairs.push({ a: cs[i]!, b: cs[j]! });
      }
    }
  }
  let chases = 0;
  while (chases < 500 && pairs.length < total) {
    const a = any(), b = any();
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= 640 * 640) { pairs.push({ a, b }); chases++; }
  }
  while (pairs.length < total) pairs.push({ a: any(), b: any() });
  return pairs;
}

async function main(): Promise<void> {
  const maps = Number(arg("--maps") ?? 40);
  const seed0 = Number(arg("--seed0") ?? 0);
  const pairsPerMap = Number(arg("--pairs") ?? 2000);
  const rows: Row[] = [];
  const lib = arg("--lib");
  if (lib) {
    const mod = (await import(lib)) as { findPath: FindPath; setWindow: (n: number) => void };
    for (const w of (arg("--windows") ?? "32,48,64,96").split(",").map(Number)) rows.push({ label: String(w), find: mod.findPath, before: () => mod.setWindow(w) });
    rows.push({ label: "unbounded", find: mod.findPath, before: () => mod.setWindow(1e9) });
  } else {
    rows.push({ label: `shipped ${PULL_WINDOW}`, find: (m, a, b) => shippedFindPath(m, a, b) });
    rows.push({ label: "unbounded", find: (m, a, b) => findPathReference(m, a, b) });
  }
  const res = rows.map(() => ({ over: 0, max: 1, n: 0, times: [] as number[] }));
  for (let s = 0; s < maps; s++) {
    const map = generateMap(seed0 + s);
    const pairs = pullPairs(map, seed0 + s, pairsPerMap);
    // The yardstick is the unbounded pull: the last row.
    const last = rows[rows.length - 1]!;
    last.before?.();
    const base = pairs.map((p) => len(p.a, last.find(map, p.a, p.b)));
    rows.forEach((row, k) => {
      row.before?.();
      for (let q = 0; q < pairs.length; q++) {
        const p = pairs[q]!;
        const t0 = performance.now();
        const path = row.find(map, p.a, p.b);
        res[k]!.times.push((performance.now() - t0) * 1000);
        if (base[q]! <= 0) continue;
        const r = len(p.a, path) / base[q]!;
        res[k]!.n++;
        if (r > 1.01) res[k]!.over++;
        if (r > res[k]!.max) res[k]!.max = r;
      }
    });
  }
  console.log(`PULL_WINDOW recheck: ${maps} maps (seeds ${seed0}..${seed0 + maps - 1}), ${pairsPerMap} pairs each`);
  console.log("window       | paths   | >1% longer | max ratio | us p50 | us p99 | us mean");
  rows.forEach((row, k) => {
    const r = res[k]!;
    const mean = r.times.reduce((a, b) => a + b, 0) / Math.max(1, r.times.length);
    console.log(`${row.label.padEnd(12)} | ${String(r.n).padEnd(7)} | ${(100 * r.over / Math.max(1, r.n)).toFixed(2).padStart(9)}% | ${r.max.toFixed(4).padStart(9)} | ${quantile(r.times, 0.5).toFixed(1).padStart(6)} | ${quantile(r.times, 0.99).toFixed(1).padStart(6)} | ${mean.toFixed(1)}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
