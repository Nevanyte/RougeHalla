import { certifiedMap, mapHash } from "../../packages/shared/src/mapgen.ts";
import { PINNED_MAPS, PINNED_PLAIN } from "../../packages/shared/test/mapPins.ts";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

type Sample = { seed: number; attempt: number; hash: string; elapsed_ns: number };
const output = process.argv[2];
if (!output) throw new Error("usage: ts-bench.mts OUTPUT.json");
const samples: Record<"plain" | "styled", Sample[]> = { plain: [], styled: [] };
const pins: Record<"plain" | "styled", readonly string[]> = { plain: PINNED_PLAIN, styled: PINNED_MAPS };
function run(mode: "plain" | "styled", seed: number, measured: boolean): Sample {
  const start = measured ? performance.now() : 0;
  const map = mode === "plain"
    ? certifiedMap(seed, { styleZones: null, decor: false })
    : certifiedMap(seed, { decor: false });
  const elapsed_ns = measured ? Math.round((performance.now() - start) * 1_000_000) : 0;
  if (!map) throw new Error(`${mode} seed ${seed} was not certified`);
  const hash = mapHash(map);
  const pin = pins[mode][seed];
  const expected = `${seed}:${map.attempt}:${hash}`;
  if (expected !== pin) throw new Error(`${mode} seed ${seed} pin mismatch: ${expected} != ${pin}`);
  return { seed, attempt: map.attempt, hash, elapsed_ns };
}
for (const mode of ["plain", "styled"] as const) for (let seed = 0; seed < 5; seed++) run(mode, seed, false);
for (let seed = 0; seed < 40; seed++) {
  const order: ("plain" | "styled")[] = seed % 2 === 0 ? ["plain", "styled"] : ["styled", "plain"];
  for (const mode of order) samples[mode].push(run(mode, seed, true));
}
function summarize(rows: Sample[]) {
  const v = rows.map(row => row.elapsed_ns).sort((a, b) => a - b);
  return { median_ns: Math.floor((v[19] + v[20]) / 2), p95_ns: v[Math.ceil(v.length * .95) - 1], min_ns: v[0], max_ns: v[v.length - 1] };
}
const result = {
  plain: { options: "styleZones:null,decor:false,shapeGates:true,bushes:true", samples: samples.plain, summary: summarize(samples.plain) },
  styled: { options: "default:styled,decor:false,shapeGates:true,bushes:true", samples: samples.styled, summary: summarize(samples.styled) },
};
writeFileSync(output, JSON.stringify(result) + "\n");
