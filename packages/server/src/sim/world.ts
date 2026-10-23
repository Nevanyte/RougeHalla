// Headless game world: the synced schema state plus server-only runtime data.
// Nothing in sim/ may import @colyseus/core or know about sockets.
import { randomUUID } from "node:crypto";
import {
  generateMap, type FxEvent, type GameMap, type GvReason, type RunResult, type Sample, type Vec2,
} from "@raid/shared";
import { RaidState, type PlayerState } from "@raid/shared/schema";
import type { ActionCommand, InputQueue } from "./inputs";

export interface SimConfig {
  minPlayers: number;
  lobbySeconds: number;
  /** Max wait for more players once minPlayers have joined. */
  fillSeconds: number;
  /** No death for this long teleports everyone alive into the coliseum: this long with PATIENCE_FULL_ALIVE standing... */
  patienceSeconds: number;
  /** ...shrinking linearly to this at PATIENCE_MIN_ALIVE or fewer (patienceSecondsFor). Equal to patienceSeconds = flat. */
  patienceMinSeconds: number;
  /** Locked in the coliseum this long with no death, sudden death starts. */
  suddenDeathSeconds: number;
}

export interface PlayerRuntime {
  id: string;
  profile: string;
  inputs: InputQueue;
  /** Remaining waypoints in world units; the player walks toward path[0]. */
  path: Vec2[];
  /** Recent authoritative positions (oldest first) for lag-compensated hit tests. */
  history: Sample[];
  nextAttackAt: number;
  /** While serverTime < this, walking doesn't overwrite `facing` (the player keeps aiming). */
  aimFacingUntil?: number;
  killedBy: string | null;
  /** GV earned this run, by source. A win bonus is decided when the run resolves and is never kept here. */
  gv: { kills: number; mobs: number; bounty: number };
  /** Mobs killed this run (feeds the feed score with FEED_MOB_KILL_WEIGHT; player kills are PlayerState.kills). */
  mobKills: number;
  /** hp / maxHp when the tick being simulated began: the tie-break between simultaneous last deaths. */
  hpFracAtTickStart: number;
  /** The last player to damage them and when (server ms): a leave soon after counts as that player's kill. */
  lastHit: { by: string; at: number } | null;
  /** Different players this one damaged during the run (not themselves, not sudden death): see WIN_BONUS_MIN_OPPONENTS. */
  damaged: Set<string>;
  /** When their connection dropped (server ms), while the Room holds the seat for a reconnect; null when connected. */
  droppedAt: number | null;
  /** Set when the player goes down (died, or left the run). Their result follows at the end of that tick. */
  down: { outcome: "died" | "mia" } | null;
  /** Set once their result has been emitted. */
  resolved: boolean;
}

/** Arena bookkeeping that is not synced (see arena.ts). */
export interface ArenaRuntime {
  /** Players in the run when it started. With fewer than 2 the run is solo: nobody wins and no win bonus is paid. */
  startedWith: number;
  /** Players who went down in the step being simulated, in order. arena.settle() resolves them. */
  downedThisTick: Array<{ p: PlayerState; rt: PlayerRuntime }>;
  /** Players who went down between steps (a leave). Resolved at once, they still count as the next tick's deaths. */
  downsBetweenTicks: number;
  /** Set when a player is abandoned mid-run (a server shutdown): the run is void and the sim stops advancing it. */
  voided: boolean;
}

export type SimEvent =
  | { type: "fx"; fx: FxEvent }
  | { type: "toast"; to: string; text: string }
  | { type: "raidStarted" }
  | { type: "raidEnded" }
  /** Feedback only: GV a player just earned. It is banked through their `resolved` result, never from this. */
  | { type: "gv"; id: string; amount: number; reason: GvReason }
  /** A player's run is over; the Room banks `result` (GV and stats) and sends it to them. */
  | { type: "resolved"; id: string; result: RunResult };

export type ActionHandler = (world: World, p: PlayerState, rt: PlayerRuntime, cmd: ActionCommand) => void;
export type SimSystem = (world: World, dtMs: number) => void;

export interface WorldHooks {
  /** A player went down (died/mia) with their run gear still on them. Default: discard it. */
  dropBody(world: World, p: PlayerState): void;
  /** The lobby just turned into an active raid: players are placed and `raidStartedAt` is set. */
  raidStarted?(world: World): void;
  /** Everyone alive was just moved into the coliseum (paths and input queues are already cleared). Phase 9 clears in-flight projectiles here. */
  teleported?(world: World): void;
  /** `killer` just claimed `victim`'s bounty (already paid). Phase 11 moves half the victim's buff stacks here. */
  bountyClaimed?(world: World, killer: PlayerRuntime, victim: PlayerRuntime, bounty: number): void;
}

export interface World {
  state: RaidState;
  config: SimConfig;
  /** Generated from state.seed; identical to what clients generate. */
  map: GameMap;
  /** Monotonic counter behind nextId(). */
  idCounter: number;
  /** Item uids. Run gear never leaves the run, but globally unique ids keep that safe to change. */
  newItemUid: () => string;
  players: Map<string, PlayerRuntime>;
  /** Server-only randomness (loot rolls, spawn assignment). Never derived from the public seed. */
  random: () => number;
  /** Secret salt for the per-tick player processing order (see actionOrder in step.ts). */
  orderSalt: number;
  /** Events produced during the current step; drained by step(). */
  events: SimEvent[];
  /** True while step() runs. Things created outside it (e.g. a body from a leave) belong to the next tick. */
  stepping: boolean;
  /** Gameplay modules install themselves here (see sim/gameplay.ts). Unknown actions are ignored. */
  actions: Partial<Record<ActionCommand["kind"], ActionHandler>>;
  /** Run every active step after inputs and movement, in registration order. */
  systems: SimSystem[];
  hooks: WorldHooks;
  arena: ArenaRuntime;
}

export function createWorld(opts: {
  seed: number;
  config: SimConfig;
  random: () => number;
  newItemUid?: () => string;
}): World {
  const state = new RaidState();
  state.seed = opts.seed >>> 0;
  state.minPlayers = opts.config.minPlayers;
  return {
    state,
    config: opts.config,
    map: generateMap(state.seed),
    idCounter: 0,
    newItemUid: opts.newItemUid ?? (() => randomUUID()),
    players: new Map(),
    random: opts.random,
    orderSalt: Math.floor(opts.random() * 2 ** 32) >>> 0,
    events: [],
    stepping: false,
    actions: {},
    systems: [],
    hooks: { dropBody: (_w, p) => { p.inventory.clear(); } },
    arena: { startedWith: 0, downedThisTick: [], downsBetweenTicks: 0, voided: false },
  };
}

export function emit(world: World, ev: SimEvent): void {
  world.events.push(ev);
}

/**
 * The map that blocks movement, line of fire and line of sight. Phase 8b: `withGates(world.map)` while
 * `state.gatesLocked`, so locked gates seal the coliseum on the server too.
 */
export function collisionMap(world: World): GameMap {
  return world.map;
}

/** Room-unique id for containers and other raid-scoped entities (not items: see newItemUid). */
export function nextId(world: World, prefix: string): string {
  world.idCounter++;
  return `${prefix}${world.idCounter.toString(36)}`;
}
