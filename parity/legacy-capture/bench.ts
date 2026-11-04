// Times the legacy step() on a captured scenario's exact inputs (the same workload crates/rh-parity's parity-bench replays
// through the Rust core), so before/after numbers compare like with like.
//   npx tsx parity/legacy-capture/bench.ts [--scenario crowded_8] [--runs 20]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapFromTiles, mulberry32, TICK_MS, TILE_FLOOR, TILE_LOW, TILE_WALL, type FactionId } from "@raid/shared";
import { createGameWorld } from "../../packages/server/src/sim/gameplay";
import { enqueueClientMessage } from "../../packages/server/src/sim/inputs";
import { addPlayer, removePlayer, step } from "../../packages/server/src/sim/step";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d: string): string => (process.argv.indexOf(k) > 0 ? process.argv[process.argv.indexOf(k) + 1]! : d);
const name = arg("--scenario", "crowded_8");
const runs = Number(arg("--runs", "20"));
const fx = JSON.parse(readFileSync(resolve(here, `../fixtures/${name}.json`), "utf8"));

function once(): number[] {
  const rows: string[] = fx.map.rows;
  const w = rows[0]!.length, h = rows.length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((r, y) => { for (let x = 0; x < w; x++) tiles[y * w + x] = r[x] === "#" ? TILE_WALL : r[x] === "~" ? TILE_LOW : TILE_FLOOR; });
  const world = createGameWorld({
    seed: 11, map: mapFromTiles(w, h, tiles, 11),
    config: { minPlayers: fx.players.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(fx.legacyConfig.randomSeed), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8],
  }, { signatures: false, walkHints: false });
  for (const p of fx.players) addPlayer(world, p.id, p.id.toUpperCase(), { faction: p.faction as FactionId });
  step(world, TICK_MS);
  for (const p of fx.players) {
    const s = world.state.players.get(p.id)!;
    s.x = p.x; s.y = p.y; s.facing = 0; s.hp = p.hp;
    world.players.get(p.id)!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
  }
  const out: number[] = [];
  let k = 0;
  for (const t of fx.ticks) {
    while (k < fx.inputs.length && fx.inputs[k].tick <= t.tick) {
      const i = fx.inputs[k++];
      const rt = world.players.get(i.player);
      if (rt) enqueueClientMessage(rt.inputs, i.type, i.msg);
    }
    const t0 = process.hrtime.bigint();
    step(world, TICK_MS);
    out.push(Number(process.hrtime.bigint() - t0) / 1000);
    if (name === "leave_mia" && t.tick === 40) removePlayer(world, "p2");
  }
  return out;
}

for (let i = 0; i < 3; i++) once(); // JIT warm-up
const all: number[] = [];
for (let r = 0; r < runs; r++) all.push(...once());
all.sort((a, b) => a - b);
const q = (p: number): number => all[Math.min(all.length - 1, Math.floor(p * all.length))]!;
const mean = all.reduce((a, b) => a + b, 0) / all.length;
console.log(JSON.stringify({ impl: "legacy-ts", node: process.version, scenario: name, runs, ticks: all.length, stepUs: { mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p99: +q(0.99).toFixed(2), max: +all[all.length - 1]!.toFixed(2) } }));
