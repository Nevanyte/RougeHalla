import { setImmediate } from "node:timers/promises";
import { Encoder } from "@colyseus/schema";
import { ClientState, SchemaSerializer } from "@colyseus/core";
import { WebSocketClient } from "@colyseus/ws-transport";
import { certifiedMap } from "@raid/shared";
import { BOT_FILL_DEFAULTS } from "./bots/brain/types";
import { createHeadlessRoom } from "./bots/tournament/headlessRoom";

/** Compile the real simulation, bot brains and schema encoder before admitting the first cloud player. */
export async function warmCloudSimulation(ticks = 400, budgetMs = 40_000) {
  const start = performance.now();
  // Use the same workload on every release; random layouts can exhaust the warm-up budget.
  const map = certifiedMap(1, { decor: false });
  if (!map) throw new Error("Cloud warm-up map did not certify");
  // This world has no sockets, human profiles or learning store. Its results are discarded.
  const room = createHeadlessRoom({
    seed: map.seed,
    map,
    bots: { ...BOT_FILL_DEFAULTS, fillTo: 0, latencyMs: 0, jitterMs: 0 },
    lineup: Array.from({ length: 6 }, () => ({})),
    config: { planSeconds: 0, patienceSeconds: 3600, firstPatienceSeconds: 3600 },
    statsStore: null,
  });
  Encoder.BUFFER_SIZE = Math.max(Encoder.BUFFER_SIZE, 64 * 1024);
  // Warm the same serializer and transport wrapper as a live room, including its initial state.
  const client = new WebSocketClient("bootstrap", { send() {} } as unknown as ConstructorParameters<typeof WebSocketClient>[1]);
  client.state = ClientState.JOINED;
  const serializer = new SchemaSerializer<typeof room.world.state>();
  serializer.reset(room.world.state);
  serializer.handshake();
  serializer.getFullState(client);
  try {
    while (room.ticks < ticks && performance.now() - start < budgetMs) {
      room.tick();
      serializer.applyPatches([client], room.world.state);
      // Readiness and shutdown handling stay responsive while no live rooms are admitted.
      if (room.ticks % 4 === 0) await setImmediate();
    }
    return {
      ticks: room.ticks,
      complete: room.ticks >= ticks,
      elapsedMs: Math.round(performance.now() - start),
      phase: room.world.state.phase,
      players: room.world.state.players.size,
    };
  } finally { room.manager.dispose(); }
}
