// The generator's cost gate (ROGUELIKE_PLAN R2: median batches <= 45 ms for the plain generator; ZT-6: <= 60 ms with the zone
// stylers on, which cost about one more attempt in four and 5-6 ms of styler per attempt), in a file of its own.
//
// The full suite runs its files in parallel processes; on a big.LITTLE machine with more workers than fast cores a file
// can land on a slow core and share memory bandwidth with eight certification shards, which made raw timings 2-5x the
// quiet ones. So every batch is timed next to a fixed yardstick workload of the generator's kind (flood fills, 5/7
// distance passes and a strided scan of a 32 MB array) and scaled by it: the gate reads the batch's cost on the quiet
// reference machine. YARDSTICK_QUIET_MS is the yardstick measured on an Apple M5 Pro (Node 25.8), quiet.
// scripts/mapBench.ts gives the unscaled numbers.
import { describe, expect, it } from "vitest";
import { certifiedMap, warmMapgen } from "../src/mapgen";

/** The yardstick's cost on the reference machine, quiet (ms). */
const YARDSTICK_QUIET_MS = 5;
const big = new Uint16Array(16 << 20);
for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 20;

function yardstick(): number {
  const W = 96, N = W * W, wall = new Uint8Array(N), dist = new Int32Array(N), queue = new Int32Array(N);
  let acc = 0;
  for (let rep = 0; rep < 10; rep++) {
    for (let i = 0; i < N; i++) wall[i] = ((i * 7919 + rep * 104729) % 23) < 4 || i < W || i >= N - W || i % W === 0 || i % W === W - 1 ? 1 : 0;
    dist.fill(-1);
    let head = 0, tail = 0;
    const s = 48 * W + 48;
    wall[s] = 0;
    dist[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        if (!wall[j] && dist[j] < 0) { dist[j] = dist[i] + 5; queue[tail++] = j; }
      }
    }
    for (let i = W + 1; i < N - W - 1; i++) if (dist[i] > 0) acc += Math.min(dist[i], dist[i - 1] + 5, dist[i - W - 1] + 7);
    for (let i = rep; i < big.length; i += 61) acc += big[i];
  }
  return acc;
}

const median = (v: readonly number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];

describe("performance", () => {
  it("certifies a map per raw seed well under the budget: median of 7 batches of 8 seeds <= 60 ms with the zone stylers, <= 45 ms without (scaled to the quiet reference machine)", () => {
    warmMapgen();
    for (let i = 0; i < 16; i++) { certifiedMap(80_000 + i); certifiedMap(80_100 + i, { styleZones: null }); }
    for (let i = 0; i < 4; i++) yardstick();
    // Load comes in bursts, so every map is timed between two short yardsticks and the batch is scaled by their sum.
    const raw: number[] = [], scaled: number[] = [], plainScaled: number[] = [];
    for (let b = 0; b < 7; b++) {
      let gen = 0, plain = 0, yard = 0;
      for (let i = 0; i < 8; i++) {
        let t = performance.now();
        yardstick();
        yard += (performance.now() - t) / 4;
        t = performance.now();
        certifiedMap(10_000 + b * 8 + i);
        gen += performance.now() - t;
        t = performance.now();
        yardstick();
        yard += (performance.now() - t) / 4;
        t = performance.now();
        certifiedMap(10_000 + b * 8 + i, { styleZones: null });
        plain += performance.now() - t;
        t = performance.now();
        yardstick();
        yard += (performance.now() - t) / 4;
        t = performance.now();
        yardstick();
        yard += (performance.now() - t) / 4;
      }
      raw.push(gen / 8);
      scaled.push((gen * YARDSTICK_QUIET_MS) / yard);
      plainScaled.push((plain * YARDSTICK_QUIET_MS) / yard);
    }
    const med = median(scaled), medPlain = median(plainScaled);
    console.info(
      `[perf] certifiedMap median of 7 batches: ${med.toFixed(1)} ms scaled to the quiet machine (raw ${raw.map((v) => v.toFixed(1)).join(", ")} ms); ` +
      `without the zone stylers ${medPlain.toFixed(1)} ms`,
    );
    expect(med).toBeLessThanOrEqual(60);
    expect(medPlain).toBeLessThanOrEqual(45);
  }, 120_000);
});
