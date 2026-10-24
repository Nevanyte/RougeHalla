// Headless game world: the synced schema state plus server-only runtime data.
// Nothing in sim/ may import @colyseus/core or know about sockets.
import { randomUUID } from "node:crypto";
import {
  generateMap, mulberry32, withGates, type DamageShares, type FactionId, type FxEvent, type GameMap, type GvReason,
  type ProjectileKind, type RunResult, type Sample, type SignatureKind, type Vec2, type WeaponId,
} from "@raid/shared";
import { RaidState, type PlayerState, type ProjectileState } from "@raid/shared/schema";
import type { Combatant } from "./combatant";
import type { FactionsRuntime } from "./factions";
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
  /** Training: place dummies and a rack of every weapon next to each player's spawn when the run starts (sim/mobs.ts). */
  dummies?: boolean;
  /** Regional mobs: place a mob at every camp spot when the run starts (sim/mobLife.ts). Off unless set; the server turns it on. */
  mobs?: boolean;
}

/** A melee swing or wand cast waiting to land, or a bow being drawn. Times are server ms. */
export type PendingAction =
  | { kind: "swing"; weapon: WeaponId; startedAt: number; landsAt: number; a: number; packet: DamagePacket }
  /** `origin`: where the caster's client drew it when the cast began; the ball leaves from there, along `a`. */
  | { kind: "cast"; weapon: WeaponId; startedAt: number; landsAt: number; a: number; packet: DamagePacket; origin: Vec2 }
  | { kind: "draw"; weapon: WeaponId; startedAt: number };

/**
 * A fighter's weapon state machine (sim/weapons.ts). The slots, the one in hand, the cooldown end (`readyAt`) and the
 * draw start are synced on the fighter's state; this is the rest. Times are server ms.
 */
export interface WeaponRuntime {
  action: PendingAction | null;
  rootUntil: number;
  castSlowUntil: number;
  /** Ranged recovery: RANGED_RECOVERY_MOVE of full speed until the cooldown that started with the shot ends. */
  recoverUntil: number;
  staggerImmuneUntil: number;
  /** The trigger: held since `pressedAt`; a press is also remembered until `bufferedUntil` (quick clicks). */
  held: boolean;
  pressedAt: number;
  bufferedUntil: number;
  /** A release arrived for a draw that hasn't reached its minimum yet (or hasn't started): loose it as soon as it can. */
  releasePending: boolean;
  /** Latest aim angle and when it arrived (0 = never aimed: walking turns the fighter). */
  aim: number;
  aimAt: number;
  /** How far behind the server the fighter's client renders (server now - its `t`), clamped; melee rewinds by it. */
  lagMs: number;
}

/** Server-only combat data every fighter has, player or mob. */
export interface CombatRuntime {
  id: string;
  inputs: InputQueue;
  /** Remaining waypoints in world units; the fighter walks toward path[0]. */
  path: Vec2[];
  /** Recent authoritative positions (oldest first) for lag-compensated hit tests and present-time projectile sweeps. */
  history: Sample[];
  weapon: WeaponRuntime;
}

export interface PlayerRuntime extends CombatRuntime {
  profile: string;
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
  /** Timers of the kill combos (sim/buffs.ts). Created on first use, so a hand-built runtime needs nothing. */
  boost?: BoostRuntime;
  /** Rampage announcement throttle (sim/feed.ts). Created on first use. */
  announce?: AnnounceRuntime;
}

/** Server-only timers behind a player's buffs. Times are server ms. */
export interface BoostRuntime {
  /** Speed bursts from kills (the dash and the rush): the strongest one still running applies. */
  bursts: Array<{ mult: number; until: number }>;
  /** When the kill barrier (PlayerState.barrier) ends. */
  shieldUntil: number;
}

/** When the player's bounty was last announced, and what it was (a rise since then is still waiting for the window to end). */
export interface AnnounceRuntime {
  lastAt: number;
  sent: number;
}

export interface MobRuntime extends CombatRuntime {
  /** Server ms of the last damage taken (a dummy heals back to full DUMMY_RESET_SECONDS after it). */
  lastHitAt: number;
  /** A regional mob's mind and camp (sim/mobLife.ts, sim/mobAI.ts). Absent on a training dummy. */
  brain?: MobBrain;
}

/** "idle" at its camp and neutral; "fight" chasing and attacking its target; "return" walking home to heal (it ignores everyone). */
export type MobMode = "idle" | "fight" | "return";

export interface MobBrain {
  region: FactionId;
  elite: boolean;
  /** The camp spot it rests on and the way it faces there. */
  home: Vec2;
  homeFacing: number;
  mode: MobMode;
  /** The player it fights, and the damage each player has done to it since it last rested (who it turns on next). */
  target: string | null;
  threat: Map<string, number>;
  /**
   * Server ms it woke, or last dealt damage to a player (stamped by ledger.recordHit). It gives up MOB_GIVE_UP_SECONDS
   * after: damage it takes does not count, so a shooter out of its reach cannot keep it fighting.
   */
  lastCombatAt: number;
  /** Throttle and memory for the inputs it sends: when the last move went out, where to, and whether it is walking or holding the trigger. */
  lastMoveAt: number;
  goal: Vec2 | null;
  moving: boolean;
  holding: boolean;
  /** Offset into MOB_REPATH_MS, so the mobs of a room don't all path on one tick. */
  phase: number;
  /** Server ms it died (status "dead"); it is removed MOB_CORPSE_MS later. */
  diedAt: number;
  /** The aim it last sent (NaN: none yet), so the AI re-aims only past MOB_AIM_DEADBAND. */
  lastAim: number;
}

/** One hit's damage before mitigation: the raw amount and the attacker's damage shares. */
export interface DamagePacket extends DamageShares { raw: number }

/** Who dealt a ledger entry: a combatant id, and the name to credit if they are gone by the time it lands. */
export interface DamageSource { id: string; name: string }

/**
 * One hit landing this tick (sim/ledger.ts). Every damage source writes here and applyLedger() applies them all at
 * once after melee, so the shuffled player order never decides who hit first.
 */
export interface LedgerEntry {
  victim: string;
  by: DamageSource;
  packet: DamagePacket;
  /** The weapon that dealt it (a riposte and a reflected arrow name the shield). */
  weapon: WeaponId;
  /** A projectile hit: a swing landing later in the same tick can still halve or cancel it (see `scale`). */
  projectile?: string;
  /** Applied to the packet at resolution: 1, SWORD_BALL_SCALE after a sword met the ball, 0 after an axe destroyed it. */
  scale: number;
  /** An unblocked sword hit: the victim is staggered if it isn't immune. */
  stagger: boolean;
  /** Signature damage (sim/factions.ts). Damage over time gets no `hit` fx of its own (it is reported in chunks). */
  sig?: SignatureKind;
  /**
   * Dealt without an attack of the dealer's own (a riposte). A reflected arrow (`projectile` set, weapon "shield") is
   * passive too. Passive hits make a target only for a fighter that has none.
   */
  passive?: boolean;
}

/** A ledger entry that took hp off its victim this tick (applyLedger), for systems that react to damage. */
export interface LandedHit {
  victim: string;
  by: string;
  /** After armor and shield: the whole hit, even past the hp a killing tick removes (as testing/realtime.py counts it). */
  amount: number;
  weapon: WeaponId;
  sig?: SignatureKind;
}

/** A swing whose windup ended this tick (resolved in the melee phase). */
export interface MeleeRequest {
  attacker: string;
  weapon: WeaponId;
  /** Direction fixed when the swing started. */
  a: number;
  /** Server time the attacker's client was drawing when the swing landed: attacker and targets are sampled there. */
  rewindT: number;
  packet: DamagePacket;
}

/** A projectile loosed this tick (the bow on release, the wand when its cast ends); spawned after the sweep. */
export interface SpawnRequest {
  owner: string;
  kind: ProjectileKind;
  weapon: WeaponId;
  a: number;
  packet: DamagePacket;
  /**
   * Where it leaves from: the shooter where its client drew it (rewound like a melee origin), since that is where the
   * client measured `a` from. Defaults to the shooter's present position.
   */
  origin?: Vec2;
}

/** Server-only flight data of one synced ProjectileState (sim/projectiles.ts). */
export interface ProjectileRuntime {
  id: string;
  state: ProjectileState;
  kind: ProjectileKind;
  /** What its hits count as: the bow or wand that loosed it, or the shield that reflected it. */
  weapon: WeaponId;
  owner: string;
  /** Credited if the owner is gone when it lands. */
  ownerName: string;
  /** Where it was at `simT` (server ms) and how far it has come. */
  x: number;
  y: number;
  simT: number;
  traveled: number;
  /** Where it was when this tick's sweep began: a swing landing this tick meets the ball anywhere on that stretch. */
  tickX: number;
  tickY: number;
  packet: DamagePacket;
  /** A sword already halved this ball (it is halved once at most). */
  halved: boolean;
  /** How many shields reflected this arrow's chain so far (0 for a fresh shot); see MAX_ARROW_REFLECTIONS. */
  reflections: number;
  /** Set when it stops; it is then removed from the state. */
  ended: boolean;
}

/** Per-tick combat scratch: filled and drained within one step (step.ts). */
export interface CombatScratch {
  ledger: LedgerEntry[];
  melee: MeleeRequest[];
  spawns: SpawnRequest[];
  /**
   * Every projectile that flew or was loosed this tick, including those that stopped (their path this tick is
   * tickX/tickY -> x/y). Melee uses it to meet balls, even one whose hit is already in the ledger.
   */
  swept: ProjectileRuntime[];
  /** Every ledger entry that landed this tick, in the order applied. */
  landed: LandedHit[];
  /**
   * This tick's secret rank of each player (their place in actionOrder). Exact ties between hits (who gets a kill, which
   * of two bodies an arrow meets) go to the lower rank, so neither join order nor ledger order decides them.
   */
  rank: Map<string, number>;
  /**
   * True while applyLedger applies damage. Rewards for kills (GV, a bounty, stacks, shields) are queued in `payouts` and
   * paid once every victim has taken their damage (payLater), so who is left standing never depends on the order victims
   * happen to be processed in.
   */
  collecting: boolean;
  payouts: Array<() => void>;
  /** The lobby's median feed as it stood before the pass (null outside one): every mob reward in the pass reads this one. */
  medianFeed: number | null;
}

/** Runs `pay` now, or, while the ledger is being applied, after all of its damage has landed. */
export function payLater(world: World, pay: () => void): void {
  if (world.combat.collecting) world.combat.payouts.push(pay);
  else pay();
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
  /**
   * Every player's bounty when the tick being simulated began. A kill in a tick pays the victim's bounty from here,
   * so a bounty raised by another kill in the same tick (whose victim the ledger happened to apply first) isn't paid.
   */
  bountyAtTickStart: Map<string, number>;
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

/** Handles one queued action for a standing fighter (players today; Phase 11 mobs go through the same handlers). */
export type ActionHandler = (world: World, c: Combatant, cmd: ActionCommand) => void;
export type SimSystem = (world: World, dtMs: number) => void;
/** A factor on a fighter's move speed this tick (Frost's chill; Phase 11 buffs). All of them multiply. */
export type MoveModifier = (world: World, c: Combatant) => number;

export interface WorldHooks {
  /** A player went down (died/mia) with their run gear still on them. Default: discard it. */
  dropBody(world: World, p: PlayerState): void;
  /** The lobby just turned into an active raid: players are placed and `raidStartedAt` is set. */
  raidStarted?(world: World): void;
  /**
   * Everyone alive was just moved into the coliseum (paths and input queues are already cleared). Modules chain onto
   * it: weapons cancel every action, projectiles clear every flight.
   */
  teleported?(world: World): void;
  /** `killer` just claimed `victim`'s bounty (already paid). Phase 11 moves half the victim's buff stacks here. */
  bountyClaimed?(world: World, killer: PlayerRuntime, victim: PlayerRuntime, bounty: number): void;
  /** A player just killed another player (kill GV paid, bounty claimed): the kill combos fire here. Mob kills call them directly. */
  playerKilled?(world: World, killer: PlayerRuntime): void;
  /** A fighter changed the weapon in hand (a swap, or a pickup that replaced it). Phase 10 resets a Sentenced mark. */
  weaponSwapped?(world: World, c: Combatant): void;
}

export interface World {
  state: RaidState;
  config: SimConfig;
  /** Generated from state.seed; identical to what clients generate. */
  map: GameMap;
  /** Monotonic counter behind nextId(). */
  idCounter: number;
  /** Players who have joined this room so far, in order (the default faction is picked from it). */
  joined: number;
  /** Item uids. Run gear never leaves the run, but globally unique ids keep that safe to change. */
  newItemUid: () => string;
  players: Map<string, PlayerRuntime>;
  /** Server-only data of state.mobs, by the same ids. */
  mobs: Map<string, MobRuntime>;
  /** Server-only data of state.projectiles, by the same ids. */
  projectiles: Map<string, ProjectileRuntime>;
  combat: CombatScratch;
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
  /**
   * Run every active step right after the weapon state machines, before movement: this tick's swings are in
   * combat.melee and its arrows and balls in combat.spawns (Fire's backlash reads them).
   */
  afterWeapons: SimSystem[];
  /** Run every active step after melee, before the ledger is applied: they may still add entries to it. */
  beforeDamage: SimSystem[];
  /** Run every active step after damage is applied, in registration order. */
  systems: SimSystem[];
  moveModifiers: MoveModifier[];
  hooks: WorldHooks;
  arena: ArenaRuntime;
  /** Faction signatures (sim/factions.ts); null until that module is installed. */
  factions: FactionsRuntime | null;
}

export function createWorld(opts: {
  seed: number;
  config: SimConfig;
  random: () => number;
  newItemUid?: () => string;
  /** A ready map instead of generateMap(seed): hand-built test arenas and the harness skip the generator. */
  map?: GameMap;
}): World {
  const state = new RaidState();
  state.seed = opts.seed >>> 0;
  state.minPlayers = opts.config.minPlayers;
  return {
    state,
    config: opts.config,
    map: opts.map ?? generateMap(state.seed),
    idCounter: 0,
    joined: 0,
    newItemUid: opts.newItemUid ?? (() => randomUUID()),
    players: new Map(),
    mobs: new Map(),
    projectiles: new Map(),
    combat: { ledger: [], melee: [], spawns: [], swept: [], rank: new Map(), landed: [], collecting: false, payouts: [], medianFeed: null },
    random: opts.random,
    orderSalt: Math.floor(opts.random() * 2 ** 32) >>> 0,
    events: [],
    stepping: false,
    actions: {},
    afterWeapons: [],
    beforeDamage: [],
    systems: [],
    moveModifiers: [],
    hooks: { dropBody: (_w, p) => { p.weapon0 = ""; p.weapon1 = ""; } },
    arena: { startedWith: 0, downedThisTick: [], downsBetweenTicks: 0, voided: false, bountyAtTickStart: new Map() },
    factions: null,
  };
}

export function emit(world: World, ev: SimEvent): void {
  world.events.push(ev);
}

type ChainableHook = "teleported" | "raidStarted" | "weaponSwapped" | "bountyClaimed";

/** Adds a hook that runs after whatever was already installed for it. */
export function chainHook<K extends ChainableHook>(world: World, key: K, fn: NonNullable<WorldHooks[K]>): void {
  const prev = world.hooks[key] as ((...args: unknown[]) => void) | undefined;
  const next = fn as (...args: unknown[]) => void;
  world.hooks[key] = (prev ? (...args: unknown[]) => { prev(...args); next(...args); } : fn) as WorldHooks[K];
}

/**
 * The map that blocks movement, line of fire and line of sight: while the gates are locked, the locked copy
 * (cached per map, so this is free every tick), which seals the coliseum.
 */
export function collisionMap(world: World): GameMap {
  return world.state.gatesLocked ? withGates(world.map) : world.map;
}

/**
 * Order-free tie-break between equal hits for a fighter's target (sim/factions.ts), players and mobs alike: a hash of
 * the server-secret salt, the tick and the id. It shares orderSalt, so ties a client can stage and observe narrow that
 * salt down (see CLAUDE.md). Kill credit uses combat.rank instead.
 */
export function tieRank(world: World, id: string): number {
  let h = (world.orderSalt ^ Math.imul(world.state.tick, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return mulberry32(h)();
}

/** Room-unique id for containers and other raid-scoped entities (not items: see newItemUid). */
export function nextId(world: World, prefix: string): string {
  world.idCounter++;
  return `${prefix}${world.idCounter.toString(36)}`;
}

/** A fresh weapon state machine: idle, nothing held, never aimed. */
export function newWeaponRuntime(): WeaponRuntime {
  return {
    action: null, rootUntil: 0, castSlowUntil: 0, recoverUntil: 0, staggerImmuneUntil: 0,
    held: false, pressedAt: 0, bufferedUntil: 0, releasePending: false, aim: 0, aimAt: 0, lagMs: 0,
  };
}
