// Measures state-update cost with the production headless room, FxChannel, and Colyseus SchemaSerializer.
// Run from the repo root with `node --import tsx packages/server/bench/stateUpdate.ts [--ticks 1200] [--warmup 400]`.
// Each scenario seats 6 or 8 deterministic bots on the same certified Cloudflare warm-up map, then measures full bot
// frames, fx batch construction, roster updates, production schema encoding, and one or eight mocked socket sends.
import { setImmediate } from "node:timers/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ClientState, getMessageBytes, Protocol, SchemaSerializer } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { WebSocketClient } from "@colyseus/ws-transport";
import { certifiedMap, TICK_MS } from "@raid/shared";
import { BOT_FILL_DEFAULTS, type TierId } from "../src/bots/brain/types";
import { createHeadlessRoom } from "../src/bots/tournament/headlessRoom";
import { aggro } from "../src/sim/mobAI";
import { combatant } from "../src/sim/combatant";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const TICKS = Math.max(1, Math.floor(arg("--ticks", 1200)));
const WARMUP = Math.max(0, Math.floor(arg("--warmup", 400)));
const SEED = Math.max(1, Math.floor(arg("--seed", 1)));
const wsHeader = (n: number): number => n < 126 ? 2 : n < 65_536 ? 4 : 10;
const stat = (xs: readonly number[]) => {
  if (xs.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    avg: xs.reduce((a, b) => a + b, 0) / xs.length,
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!,
    max: sorted[sorted.length - 1]!,
  };
};
const cpuMs = (delta: NodeJS.CpuUsage): number => (delta.user + delta.system) / 1000;

async function measure(botCount: 6 | 8, clientCount: 1 | 8, tier: TierId) {
  const map = certifiedMap(SEED, { decor: false });
  if (!map) throw new Error(`certified map ${SEED} did not build`);
  const room = createHeadlessRoom({
    seed: map.seed,
    map,
    bots: { ...BOT_FILL_DEFAULTS, fillTo: botCount, latencyMs: 0, jitterMs: 0 },
    lineup: Array.from({ length: botCount }, () => ({ tier })),
    config: { planSeconds: 0, patienceSeconds: 3600, firstPatienceSeconds: 3600 },
    statsStore: null,
  });
  // Start the run before the full-state snapshot, then stage one bot at each occupied camp like the loaded bandwidth
  // scenario. This keeps real BotManager decisions active on a stable fight while measuring the production state path.
  room.tick();
  const botIds = room.seats.map((seat) => seat.id);
  const campOf = new Map<string, number>();
  botIds.forEach((id, i) => {
    const ci = Math.floor(i * room.world.map.camps.length / botIds.length);
    const camp = room.world.map.camps[ci]!;
    const p = room.world.state.players.get(id)!;
    p.x = camp.x - 70;
    p.y = camp.y;
    room.world.players.get(id)!.history = [{ t: room.world.state.serverTime, x: p.x, y: p.y }];
    campOf.set(id, ci);
  });
  Encoder.BUFFER_SIZE = Math.max(Encoder.BUFFER_SIZE, 64 * 1024);
  const sentBytes: number[] = [];
  const clients = Array.from({ length: clientCount }, (_, i) => {
    const ref = { send(data: Uint8Array) { sentBytes.push(data.byteLength + wsHeader(data.byteLength)); } };
    const client = new WebSocketClient(`bench-${i}`, ref as unknown as ConstructorParameters<typeof WebSocketClient>[1]);
    client.state = ClientState.JOINED;
    return client;
  });
  const serializer = new SchemaSerializer<typeof room.world.state>();
  serializer.reset(room.world.state);
  serializer.handshake();
  const initial = serializer.getFullState(clients[0]!);
  const fullSyncBytesPerClient = initial.byteLength + wsHeader(initial.byteLength);
  // Simulate the full-state handoff and clear its initial tracked additions before the first incremental tick.
  serializer.applyPatches([], room.world.state);

  const roomCpu: number[] = [];
  const roomWall: number[] = [];
  const roomAndStateCpu: number[] = [];
  const roomAndStateWall: number[] = [];
  const fxBatchCpu: number[] = [];
  const fxEncodeCpu: number[] = [];
  const fxFanoutCpu: number[] = [];
  const rosterCpu: number[] = [];
  const serializeCpu: number[] = [];
  const fights: number[] = [];
  let patchBytes = 0;
  let fxBytes = 0;
  let patchFrames = 0;
  let fxFrames = 0;
  let rosterAdds = 0;
  let measuring = false;

  const originalBatch = room.channel.batch.bind(room.channel);
  room.channel.batch = ((...args: Parameters<typeof room.channel.batch>) => {
    const c0 = process.threadCpuUsage();
    const result = originalBatch(...args);
    if (measuring) fxBatchCpu.push(cpuMs(process.threadCpuUsage(c0)));
    return result;
  }) as typeof room.channel.batch;
  const originalExtend = room.channel.extendRoster.bind(room.channel);
  room.channel.extendRoster = ((...args: Parameters<typeof room.channel.extendRoster>) => {
    const c0 = process.threadCpuUsage();
    const result = originalExtend(...args);
    if (measuring) rosterCpu.push(cpuMs(process.threadCpuUsage(c0)));
    return result;
  }) as typeof room.channel.extendRoster;
  const originalRosterSent = room.channel.rosterSent.bind(room.channel);
  room.channel.rosterSent = (() => {
    const c0 = process.threadCpuUsage();
    const result = originalRosterSent();
    if (measuring) rosterCpu.push(cpuMs(process.threadCpuUsage(c0)));
    return result;
  }) as typeof room.channel.rosterSent;

  try {
    for (let n = 0; n < WARMUP + TICKS; n++) {
      measuring = n >= WARMUP;
      const oldRoster = room.world.state.roster.length;
      // Sustain a measured combat load on the fixed warm-up map. This mirrors the existing bandwidth bench's camp wakeups
      // and under-half-health refill: every camp stays engaged and the bots keep making normal combat decisions.
      if (n > 0) {
        for (const id of botIds) {
          const p = room.world.state.players.get(id);
          if (p?.status === "alive" && p.hp < p.maxHp * 0.5) p.hp = p.maxHp;
        }
        if (n % 10 === 1) {
          for (const [id, ci] of campOf) {
            for (const [mid, m] of room.world.state.mobs) {
              if ((m.kind !== "mob" && m.kind !== "elite") || m.status !== "alive" || m.camp !== ci + 1) continue;
              const mc = combatant(room.world, mid);
              if (mc?.kind === "mob") aggro(room.world, mc, id, 1);
            }
          }
        }
      }
      const frameCpuStart = process.threadCpuUsage();
      const frameWallStart = performance.now();
      let c0 = process.threadCpuUsage();
      const wallStart = performance.now();
      room.tick();
      const wallElapsed = performance.now() - wallStart;
      let elapsed = process.threadCpuUsage(c0);
      if (n >= WARMUP) {
        roomCpu.push(cpuMs(elapsed));
        roomWall.push(wallElapsed);
      }
      if (n >= WARMUP) rosterAdds += room.world.state.roster.length - oldRoster;

      const batch = room.lastBatch;
      if (n >= WARMUP && batch) {
        c0 = process.threadCpuUsage();
        const frame = getMessageBytes.raw(Protocol.ROOM_DATA, "fxs", batch);
        elapsed = process.threadCpuUsage(c0);
        fxEncodeCpu.push(cpuMs(elapsed));
        fxBytes += frame.byteLength + wsHeader(frame.byteLength);
        fxFrames++;
        c0 = process.threadCpuUsage();
        for (const client of clients) client.raw(frame);
        elapsed = process.threadCpuUsage(c0);
        fxFanoutCpu.push(cpuMs(elapsed));
      }
      const beforePatchSends = sentBytes.length;
      c0 = process.threadCpuUsage();
      serializer.applyPatches(clients, room.world.state);
      elapsed = process.threadCpuUsage(c0);
      const fullFrameCpuMs = cpuMs(process.threadCpuUsage(frameCpuStart));
      const fullFrameWallMs = performance.now() - frameWallStart;
      if (n >= WARMUP) {
        roomAndStateCpu.push(fullFrameCpuMs);
        roomAndStateWall.push(fullFrameWallMs);
        serializeCpu.push(cpuMs(elapsed));
        const sendDeltas = sentBytes.slice(beforePatchSends);
        if (sendDeltas.length > 0) {
          patchFrames += sendDeltas.length;
          patchBytes += sendDeltas.reduce((a, b) => a + b, 0);
        }
        sentBytes.length = 0;
        fights.push([...room.world.mobs.values()].filter((m) => m.brain?.mode === "fight").length);
      } else {
        sentBytes.length = 0;
      }
      if (n % 4 === 0) await setImmediate();
    }
    const seconds = TICKS * TICK_MS / 1000;
    const stateUpdateAvg = stat(fxBatchCpu).avg + stat(fxEncodeCpu).avg + stat(fxFanoutCpu).avg
      + stat(rosterCpu).avg + stat(serializeCpu).avg;
    const measuredRoomAndStateAvg = stat(roomCpu).avg + stat(fxEncodeCpu).avg + stat(fxFanoutCpu).avg + stat(serializeCpu).avg;
    const finalResult = {
      seed: map.seed,
      botCount,
      botTier: tier,
      clientCount,
      warmupTicks: WARMUP,
      measuredTicks: TICKS,
      phase: room.world.state.phase,
      mobs: room.world.state.mobs.size,
      avgFightingMobs: fights.reduce((a, b) => a + b, 0) / fights.length,
      rosterEntries: room.world.state.roster.length,
      rosterAddsMeasured: rosterAdds,
      fullSyncBytesPerClient,
      roomTickWallMs: stat(roomWall),
      roomTickCpuMs: stat(roomCpu),
      roomAndStateWallMs: stat(roomAndStateWall),
      roomAndStateCpuMs: stat(roomAndStateCpu),
      fxBatchCpuMs: stat(fxBatchCpu),
      fxEncodeCpuMs: stat(fxEncodeCpu),
      fxFanoutCpuMs: stat(fxFanoutCpu),
      rosterCpuMs: stat(rosterCpu),
      schemaApplyPatchesCpuMs: stat(serializeCpu),
      stateUpdateAvgCpuMsPerTick: stateUpdateAvg,
      stateUpdateShareOfMeasuredRoomAndStateCpuPercent: stateUpdateAvg / measuredRoomAndStateAvg * 100,
      patchWsBytesPerSecondPerClient: patchBytes / seconds / clientCount,
      patchFramesPerSecondPerClient: patchFrames / seconds / clientCount,
      fxFramesPerSecondPerRoom: fxFrames / seconds,
      fxWsBytesPerSecondPerClient: fxBytes / seconds,
      finalGameplayStateSha256: createHash("sha256").update(JSON.stringify(room.world.state)).digest("hex"),
      botErrors: room.manager.stats.errors,
      botRefusals: room.manager.stats.refused,
      manager: { ...room.manager.stats },
    };
    return finalResult;
  } finally {
    room.manager.dispose();
  }
}

for (const bots of [6, 8] as const) {
  for (const clients of [1, 8] as const) {
    console.log(JSON.stringify(await measure(bots, clients, "hard")));
  }
}
