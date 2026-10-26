// Map generator bench: `npx tsx packages/shared/scripts/mapBench.ts [seeds=1000] [from=0] [yard=<mapgen.ts of another generator>]`
// Per raw seed: certifiedMap(seed), every attempt until one certifies (failed attempts included), lane tables warm.
// Prints mean/p50/p90/p99/max ms, the certified-at-attempt histogram, the discard rate (no certified attempt in
// MAX_ATTEMPTS), failures by reason and the time per attempt by stage. `yard` names a module exporting
// generateMap(seed) (for example the 64x64 wedge generator checked out elsewhere), run interleaved in the same windows
// as a load yardstick, so numbers from a busy machine can be scaled to a quiet one.
import { MAPGEN_FAILS, MAPGEN_PROFILE, MAX_ATTEMPTS, certifiedMap, tryAttempt, warmMapgen } from "../src/mapgen";

const args = process.argv.slice(2);
const n = Number(args.find((a) => !a.includes("=")) ?? 1000);
const opt = (k: string): string | undefined => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const from = Number(opt("from") ?? 0);
const yardPath = opt("yard");

const t0 = performance.now();
warmMapgen();
const warmMs = performance.now() - t0;
tryAttempt(987_654_321, 0); // JIT warm-up of the generator itself
for (const k of Object.keys(MAPGEN_FAILS)) delete MAPGEN_FAILS[k];
MAPGEN_PROFILE.on = true;

const yard = yardPath ? ((await import(yardPath)) as { generateMap: (s: number) => unknown }) : null;
if (yard) for (let i = 0; i < 5; i++) yard.generateMap(500_000 + i);
const yardTimes: number[] = [];

const times: number[] = [];
const hist = new Array<number>(MAX_ATTEMPTS + 1).fill(0);
let discarded = 0;
for (let s = from; s < from + n; s++) {
  const t = performance.now();
  const m = certifiedMap(s);
  times.push(performance.now() - t);
  if (!m) { discarded++; hist[MAX_ATTEMPTS]++; } else hist[m.attempt]++;
  if (yard && (s - from) % 10 === 9) {
    for (let i = 0; i < 3; i++) {
      const ty = performance.now();
      yard.generateMap(600_000 + s * 3 + i);
      yardTimes.push(performance.now() - ty);
    }
  }
}
const sorted = times.slice().sort((a, b) => a - b);
const pct = (v: number[], q: number): number => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const attempts = MAPGEN_PROFILE.attempts;
console.log(`seeds ${from}..${from + n - 1}; warm (fixed layout + 4 lane tables) ${warmMs.toFixed(1)} ms`);
console.log(`per certified seed: mean ${mean(times).toFixed(1)} ms, p50 ${pct(sorted, 0.5).toFixed(1)}, p90 ${pct(sorted, 0.9).toFixed(1)}, p99 ${pct(sorted, 0.99).toFixed(1)}, max ${sorted[sorted.length - 1].toFixed(1)}`);
console.log(`attempts ${attempts} (${(attempts / n).toFixed(3)} per seed); certified at attempt ${JSON.stringify(hist.slice(0, MAX_ATTEMPTS))}; first-attempt share ${((100 * hist[0]) / n).toFixed(1)}%; discarded ${discarded} (${((100 * discarded) / n).toFixed(2)}%)`);
console.log(`failures (A: = whole attempt): ${JSON.stringify(MAPGEN_FAILS)}`);
console.log(`ms per attempt by stage: ${Object.entries(MAPGEN_PROFILE.ms).map(([k, v]) => `${k} ${(v / attempts).toFixed(2)}`).join(", ")}`);
if (yard) {
  const ys = yardTimes.slice().sort((a, b) => a - b);
  console.log(`yardstick: mean ${mean(yardTimes).toFixed(1)} ms, p99 ${pct(ys, 0.99).toFixed(1)} over ${yardTimes.length} maps`);
}
