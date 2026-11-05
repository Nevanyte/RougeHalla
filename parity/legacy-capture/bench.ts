// Times the legacy step() on a captured scenario's exact inputs (the same workload crates/rh-parity's parity-bench replays
// through the Rust core), so before/after numbers compare like with like.
//   npx tsx parity/legacy-capture/bench.ts [--scenario crowded_8] [--runs 20]
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapFromTiles, mulberry32, TICK_MS, TILE_FLOOR, TILE_LOW, TILE_WALL, type FactionId } from "@raid/shared";
import { createScenarioWorld } from "./world";
import { markDropped, markReconnected } from "../../packages/server/src/sim/arena";
import { dropWeapon } from "../../packages/server/src/sim/loot";
import { createIntake } from "./intake";
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
  if (fx.legacyConfig.mapSeed !== undefined) throw new Error("benchmark requires the captured hand-built map; generated-map workloads are not comparable yet");
  const world = createScenarioWorld({
    name, randomSeed: fx.legacyConfig.randomSeed, players: fx.players,
    modules: fx.legacyConfig.modules,
    config: fx.legacyConfig.options,
    secrets: fx.legacyConfig.secrets,
  } as any, mapFromTiles(w, h, tiles, 11));
  for (const c of fx.legacyConfig.setup?.containers ?? []) dropWeapon(world, c.at, c.weapon);
  for (const p of fx.players) {
    const s = addPlayer(world, p.id, p.id.toUpperCase(), { faction: p.faction as FactionId });
    s.weapon0 = p.weapon0 ?? "";
    s.weapon1 = p.weapon1 ?? "";
  }
  step(world, TICK_MS);
  for (const p of fx.players) {
    const s = world.state.players.get(p.id)!;
    s.x = p.x; s.y = p.y; s.facing = 0; s.hp = p.hp;
    world.players.get(p.id)!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
  }
  const out: number[] = [];
  const intake = createIntake(fx.budgeted ?? false);
  let k = 0;
  for (const t of fx.ticks) {
    while (k < fx.inputs.length && fx.inputs[k].tick <= t.tick) {
      const i = fx.inputs[k++];
      const rt = world.players.get(i.player);
      if (!rt) throw new Error(`input for missing player ${i.player}`);
      const accepted = intake(i.player, rt.inputs, i.type, i.msg, world.state.serverTime, world.config.training);
      if (accepted !== (i.accepted ?? true)) throw new Error(`tick ${i.tick}: input acceptance differs from fixture`);
    }
    const t0 = process.hrtime.bigint();
    step(world, TICK_MS);
    out.push(Number(process.hrtime.bigint() - t0) / 1000);
    for (const action of fx.actions ?? []) {
      if (action.tick !== t.tick) continue;
      const kind = action.type ?? action.kind;
      if (kind === "remove" || kind === "leave") removePlayer(world, action.player);
      else if (kind === "drop") markDropped(world, action.player);
      else if (kind === "reconnect" || kind === "join") markReconnected(world, action.player);
      else throw new Error(`unmapped action ${kind}`);
    }
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
