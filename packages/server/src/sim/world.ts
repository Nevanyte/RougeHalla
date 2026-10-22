// Headless game world: the synced schema state plus server-only runtime data.
// Nothing in sim/ may import @colyseus/core or know about sockets.
import { randomUUID } from "node:crypto";
import {
  generateMap, type FxEvent, type GameMap, type ItemDTO, type RaidResult, type Sample, type Vec2,
} from "@raid/shared";
import { RaidState, type PlayerState } from "@raid/shared/schema";
import type { ActionCommand, InputQueue } from "./inputs";

export interface SimConfig {
  minPlayers: number;
  lobbySeconds: number;
  /** Max wait for more players once minPlayers have joined. */
  fillSeconds: number;
  raidSeconds: number;
  extractSeconds: number;
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
  extracting: { zoneId: string; startedAt: number } | null;
  /** Items this player entered the raid with (for the results screen). */
  broughtIn: ItemDTO[];
  killedBy: string | null;
  /** Set once the player has left the active raid (dead/extracted/mia) and their result was emitted. */
  resolved: boolean;
}

export type SimEvent =
  | { type: "fx"; fx: FxEvent }
  | { type: "toast"; to: string; text: string }
  | { type: "raidStarted" }
  | { type: "raidEnded" }
  /** A player left the raid for good; the Room persists `result` and sends it to them. */
  | { type: "resolved"; id: string; result: RaidResult };

export type ActionHandler = (world: World, p: PlayerState, rt: PlayerRuntime, cmd: ActionCommand) => void;
export type SimSystem = (world: World, dtMs: number) => void;

export interface WorldHooks {
  /** A player went down (died/mia) with their inventory still on them. Default: discard it. */
  dropBody(world: World, p: PlayerState): void;
}

export interface World {
  state: RaidState;
  config: SimConfig;
  /** Generated from state.seed; identical to what clients generate. */
  map: GameMap;
  /** Monotonic counter behind nextId(). */
  idCounter: number;
  /** Globally unique item uids: looted items can end up in a persistent stash. */
  newItemUid: () => string;
  players: Map<string, PlayerRuntime>;
  /** Server-only randomness (loot rolls, spawn assignment). Never derived from the public seed. */
  random: () => number;
  /** Secret salt for the per-tick player processing order (see actionOrder in step.ts). */
  orderSalt: number;
  /** Events produced during the current step; drained by step(). */
  events: SimEvent[];
  /** Gameplay modules install themselves here (see sim/gameplay.ts). Unknown actions are ignored. */
  actions: Partial<Record<ActionCommand["kind"], ActionHandler>>;
  /** Run every active step after inputs and movement, in registration order. */
  systems: SimSystem[];
  hooks: WorldHooks;
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
    actions: {},
    systems: [],
    hooks: { dropBody: (_w, p) => { p.inventory.clear(); } },
  };
}

export function emit(world: World, ev: SimEvent): void {
  world.events.push(ev);
}

/** Room-unique id for containers and other raid-scoped entities (not items: see newItemUid). */
export function nextId(world: World, prefix: string): string {
  world.idCounter++;
  return `${prefix}${world.idCounter.toString(36)}`;
}
