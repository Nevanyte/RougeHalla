// What a tournament runs a batch of games with, in this thread or in a worker_threads worker (runTournament.ts starts them).
// `planGame` turns (plan, game index) into the options of one game, `runBatch` plays a list of indices, and the bottom of the
// file is the worker's entry: it runs only inside a worker that runTournament.ts started (workerData.tournamentWorker), never
// when a test or the CLI imports this file.
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { FACTION_IDS, mulberry32, shuffle, type FactionId } from "@raid/shared";
import { createBotStatsStore } from "../learning/BotStatsStore";
import { PERSONA_IDS, type PersonaId, type TierId } from "../brain/types";
import { MAX_GAME_MS, runGame, type GameSummary, type RunGameOptions, type SeatSpec } from "./game";
import type { SimConfig } from "../../sim/world";

/** Everything a tournament is, as plain data (it crosses to the workers). */
export interface TournamentPlan {
  readonly games: number;
  readonly seed: number;
  /** One tier per seat, in seating order (the sim shuffles who spawns where). */
  readonly tiers: readonly TierId[];
  /** "mix" rotates the four personas evenly over the seats and games. */
  readonly persona: PersonaId | "mix";
  /** "mix" (or absent) deals the five factions evenly; a faction id puts every bot on it, so skill is not confounded with the matchup. */
  readonly faction?: FactionId | "mix";
  /** Each batch keeps one in-memory learning store across its games; off, a game is a pure function of its seed. */
  readonly learn: boolean;
  readonly maxSimMs: number;
  readonly config?: Partial<SimConfig>;
  readonly latencyMs?: number;
  readonly jitterMs?: number;
}

/** A 32-bit mix of a seed and a tag (a murmur finaliser), so the streams of one tournament do not march together. */
export function mix(seed: number, tag: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tag + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * An even draw of `kinds` over the seats. Per block of `kinds.length` games the seats are dealt a random slot each (a shuffle
 * of the seat numbers, mod the number of kinds) and a random order of the kinds; game g of the block then gives a seat the kind
 * at (its slot + g), so over a block every seat, and so every tier, sees every kind exactly once. Seats beyond the number of
 * kinds share a slot (and a kind) for that block, which keeps the lobby rule of at most two to a faction at 8 seats.
 */
export function dealEvenly<K>(kinds: readonly K[], seats: number, seed: number, tag: number, index: number): K[] {
  const k = kinds.length;
  const block = Math.floor(index / k);
  const rng = mulberry32(mix(seed, tag * 100_003 + block));
  const order = shuffle(rng, [...kinds]);
  const slots = shuffle(rng, Array.from({ length: seats }, (_, i) => i % k));
  return slots.map((slot) => order[(slot + (index % k)) % k]!);
}

/** The options of game `index`: its seed, and a lineup that is fully fixed (tier, persona, faction) before the game starts. */
export function planGame(plan: TournamentPlan, index: number): Pick<RunGameOptions, "seed" | "lineup" | "botSeed"> {
  const seats = plan.tiers.length;
  const factions = plan.faction && plan.faction !== "mix"
    ? plan.tiers.map(() => plan.faction as FactionId)
    : dealEvenly(FACTION_IDS, seats, plan.seed, 1, index);
  const personas = plan.persona === "mix" ? dealEvenly(PERSONA_IDS, seats, plan.seed, 2, index) : null;
  const lineup: SeatSpec[] = plan.tiers.map((tier, i) => ({
    tier, persona: personas ? personas[i]! : (plan.persona as PersonaId), faction: factions[i]!,
  }));
  return {
    // The Room's own range for a map seed.
    seed: mix(plan.seed, 1_000_000 + index) % 2 ** 31,
    lineup,
    botSeed: mix(plan.seed, 2_000_000 + index),
  };
}

export interface GameResult {
  readonly index: number;
  readonly summary: GameSummary;
  /** Wall time this game took, ms. Not part of the summary, which must replay byte for byte. */
  readonly wallMs: number;
}

/** Plays `indices` in order. With learning on, the bots of one batch share one in-memory store, so a batch is deterministic but a game is not alone. */
export function runBatch(plan: TournamentPlan, indices: readonly number[], onGame?: (r: GameResult) => void): GameResult[] {
  const store = plan.learn ? createBotStatsStore(null) : null;
  const out: GameResult[] = [];
  for (const index of indices) {
    const t0 = performance.now();
    const summary = runGame({
      ...planGame(plan, index),
      ...(plan.config ? { config: plan.config } : {}),
      ...(plan.latencyMs !== undefined ? { latencyMs: plan.latencyMs } : {}),
      ...(plan.jitterMs !== undefined ? { jitterMs: plan.jitterMs } : {}),
      maxSimMs: plan.maxSimMs > 0 ? plan.maxSimMs : MAX_GAME_MS,
      store,
    });
    const result: GameResult = { index, summary, wallMs: performance.now() - t0 };
    out.push(result);
    onGame?.(result);
  }
  return out;
}

/** The message a worker posts: one per game, then `done`. */
export type WorkerMessage = ({ readonly type: "game" } & GameResult) | { readonly type: "done" };

// ================================================================================================================ worker entry

if (!isMainThread && parentPort && (workerData as { tournamentWorker?: boolean } | null)?.tournamentWorker === true) {
  const port = parentPort;
  const { plan, indices } = workerData as { plan: TournamentPlan; indices: number[] };
  runBatch(plan, indices, (r) => port.postMessage({ type: "game", ...r } satisfies WorkerMessage));
  port.postMessage({ type: "done" } satisfies WorkerMessage);
}
