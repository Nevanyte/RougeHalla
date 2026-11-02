// A scripted arena for the telemetry tests: an open hand-built floor, a game world without signatures (so only the script's
// damage lands), the recorder installed, and a `beforeDamage` system that records the script's hits through the real ledger.
import { mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type FactionId, type GameMap } from "@raid/shared";
import { createGameWorld } from "../../src/sim/gameplay";
import { recordHit } from "../../src/sim/ledger";
import { addPlayer, step } from "../../src/sim/step";
import { installTelemetry, telemetryDraft, type RunDraft, type TelemetryRecorder } from "../../src/sim/telemetry";
import type { LedgerEntry, SimConfig, SimEvent, World } from "../../src/sim/world";
import { noteRoomEvent } from "../../src/sim/telemetry";

const W = 60;
const H = 40;

export function openMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return { ...mapFromTiles(W, H, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: (6 + i * 6) * TILE + 16, y: 20 * TILE + 16 })) };
}

export type ScriptHit = Omit<LedgerEntry, "scale" | "by" | "packet" | "weapon" | "stagger"> & {
  by: string;
  amount: number;
  weapon?: LedgerEntry["weapon"];
};

export interface Rig {
  world: World;
  rec: TelemetryRecorder;
  ids: string[];
  /** Hits to record at the next step's beforeDamage (true damage, so the amount lands unmitigated). */
  hit(h: ScriptHit): void;
  /** Steps `n` ticks, feeding the Room-side events to the recorder; returns them. */
  run(n?: number): SimEvent[];
  draft(end?: "void" | "abandoned"): RunDraft;
}

export function makeRig(n: number, opts: { factions?: FactionId[]; hp?: number; config?: Partial<SimConfig>; positions?: boolean } = {}): Rig {
  const config: SimConfig = {
    minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 10_000, patienceMinSeconds: 10_000, suddenDeathSeconds: 10_000,
    pvpRules: false, ...opts.config,
  };
  const world = createGameWorld({ map: openMap(), config, random: mulberry32(11) }, { signatures: false });
  const rec = installTelemetry(world, { positions: opts.positions !== false });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    ids.push(id);
    addPlayer(world, id, `player${i}`, { faction: opts.factions?.[i] ?? "fire" });
  }
  const queue: ScriptHit[] = [];
  world.beforeDamage.push((w) => {
    for (const h of queue.splice(0)) {
      const { by, amount, weapon, ...rest } = h;
      recordHit(w, { ...rest, by: { id: by, name: by }, packet: { raw: amount, phys: 0, magic: 0, true: 1 }, weapon: weapon === undefined ? "sword" : weapon, stagger: false });
    }
  });
  const run = (k = 1): SimEvent[] => {
    const out: SimEvent[] = [];
    for (let i = 0; i < k; i++) {
      const evs = step(world, TICK_MS);
      for (const ev of evs) noteRoomEvent(rec, ev);
      out.push(...evs);
    }
    return out;
  };
  run(1);
  if (world.state.phase !== "active") throw new Error("the rig's run did not start");
  // Same hp for everyone, so the numbers in a test mean what they say; spread out so nothing else touches them.
  const hp = opts.hp ?? 1000;
  ids.forEach((id) => { const p = world.state.players.get(id)!; p.hp = hp; p.maxHp = hp; });
  return {
    world, rec, ids,
    hit: (h) => { queue.push(h); },
    run,
    draft: (end) => telemetryDraft(world, rec, end)!,
  };
}
