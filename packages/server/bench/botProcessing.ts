// Repeatable in-process bot-frame microbenchmark. Seats a full arena, warms the real runners, then
// measures only BotManager.afterPatch across fixed-size frames. Set BOT_BENCH_MOVE=1 to move the
// players smoothly during the run, forcing VisionMemory to refresh rays at its normal cadence. Run with:
//   node --import tsx packages/server/bench/botProcessing.ts
import { performance } from "node:perf_hooks";
import { MAX_PLAYERS, mulberry32, TICK_MS, type FxBatch } from "@raid/shared";
import { BOT_FILL_DEFAULTS } from "../src/bots/brain/types";
import { BotManager } from "../src/bots/BotManager";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import { createGameWorld } from "../src/sim/gameplay";

const seed = 0x5eed;
const world = createGameWorld({ seed, config: {
  minPlayers: 2, lobbySeconds: 30, fillSeconds: 5, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 600,
}, random: mulberry32(seed + 1) });
addPlayer(world, "human", "Benchmark Human");
const manager = new BotManager(world, { ...BOT_FILL_DEFAULTS, fillTo: MAX_PLAYERS }, {
  store: null, isNameTaken: () => false, seed,
});
manager.lobbyClosing();
world.state.lobbyEndsAt = world.state.serverTime;
step(world, TICK_MS);
if (world.state.phase !== "active" || manager.specs().length !== MAX_PLAYERS - 1)
  throw new Error(`benchmark setup failed: phase=${world.state.phase}, bots=${manager.specs().length}`);
// The map's camps are quiet in this reduced setup, so add a fixed 12 visible mobs around each seat to
// keep the perception loop representative of a busy arena without simulating combat between samples.
for (const { id } of manager.specs()) {
  const self = world.state.players.get(id)!;
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    addMob(world, { kind: "mob", name: `Bench Mob ${id} ${i}`, at: { x: self.x + Math.cos(angle) * 240, y: self.y + Math.sin(angle) * 240 } });
  }
}

const batches: FxBatch[] = [];
const movingOrigins = process.env.BOT_BENCH_MOVE === "1";
const starts = manager.specs().map(({ id }, index) => {
  const p = world.state.players.get(id)!;
  return { id, index, x: p.x, y: p.y };
});
const moveOrigins = (tick: number): void => {
  if (!movingOrigins) return;
  for (const start of starts) {
    const p = world.state.players.get(start.id)!;
    p.x = start.x + Math.sin(tick * 0.012 + start.index) * 48;
    p.y = start.y + Math.cos(tick * 0.009 + start.index) * 36;
  }
};
const warmup = 1000;
const samples = 10000;
for (let i = 0; i < warmup; i++) {
  world.state.serverTime += TICK_MS;
  moveOrigins(i);
  manager.afterPatch(batches);
}
const durations = new Array<number>(samples);
for (let i = 0; i < samples; i++) {
  world.state.serverTime += TICK_MS;
  moveOrigins(warmup + i);
  const start = performance.now();
  manager.afterPatch(batches);
  durations[i] = performance.now() - start;
}
durations.sort((a, b) => a - b);
const mean = durations.reduce((sum, x) => sum + x, 0) / samples;
console.log(JSON.stringify({
  seed, players: world.state.players.size, bots: manager.specs().length, mobs: world.state.mobs.size, movingOrigins, warmupFrames: warmup,
  measuredFrames: samples, totalBotFrames: manager.stats.frames, meanMs: mean,
  p50Ms: durations[Math.floor(samples * 0.5)], p95Ms: durations[Math.floor(samples * 0.95)],
  commandsSent: manager.stats.sent, errors: manager.stats.errors,
}, null, 2));
manager.dispose();
