// Headless game world: the synced schema state plus server-only runtime data.
// Nothing in sim/ may import @colyseus/core or know about sockets.
import { randomUUID } from "node:crypto";
import {
  generateMap, mapHashU32, mulberry32, withGates, type AbilityId, type AbilitySlot, type DamageShares, type FactionId,
  type FieldKind, type FxEvent, type GameMap, type GvReason, type MobTypeId, type PlanMessage, type ProjectileKind, type ProjectileLaunch,
  type RunResult, type Sample, type SignatureKind, type SlipState, type StatusKind, type Vec2, type WeaponId,
} from "@raid/shared";
import { RaidState, type PlayerState } from "@raid/shared/schema";
import type { Combatant } from "./combatant";
import type { FactionsRuntime } from "./factions";
import type { ActionCommand, InputQueue } from "./inputs";
import type { PlanningRuntime } from "./planning";
import type { QuestsRuntime } from "./quests";
import type { TerrainRuntime } from "./terrainEffects";

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
  /** NPC quests, rolled at planning start (or raid start without planning). Always off in training. */
  quests?: boolean;
  /**
   * A training world (sim/training.ts): the run never ends and nothing is recorded: no patience timer, teleport, sudden
   * death, results or GV, and a fighter who goes down is revived. Implies the training setup (`dummies`).
   */
  training?: boolean;
  /**
   * Planning (roguelike R3, sim/planning.ts): when the lobby closes, this long a "planning" phase with the spawn deal comes
   * first, ending sooner once every connected player is ready. Unset or 0: no planning, the run starts at once (every sim
   * test's flow). A training world never plans.
   */
  planSeconds?: number;
  /**
   * The first patience timer of a run, flat (decision 10), armed when the run starts (after planning). Unset: the first timer
   * scales with the players like every later one (patienceMs). Timers after a death always scale.
   */
  firstPatienceSeconds?: number;
  /**
   * Terrain hazards (sim/terrainEffects.ts: ember burn, bog slow, the ice slide, light heal): true (the default) applies the
   * effects of whatever terrain the map holds, with each faction's home rule; false switches every effect off and leaves the
   * map as it is; "all" applies them to everyone, the home exemption (and the light boost) off. Measurement uses the last two.
   */
  hazards?: boolean | "all";
  /** Seconds after the run starts that every Wish stays locked (sim/abilities.ts armWishes); WISH_LOCK_SECONDS when absent. */
  wishLockSeconds?: number;
}

/**
 * An attack winding up: a melee swing, a wand cast or a bow draw. The fighter is rooted from `startedAt` until `landsAt`
 * (the swing lands, the ball or arrow leaves). Times are server ms. `target`: the fighter the target lock started it on; it
 * is aimed again at that fighter, if still standing, when it lands or leaves (sim/weapons.ts).
 */
export type PendingAction =
  | { kind: "swing"; weapon: WeaponId; startedAt: number; landsAt: number; a: number; packet: DamagePacket; target?: string }
  /** `origin`: where the caster's client drew it when the cast began; the ball leaves from there, along `a`. */
  | { kind: "cast"; weapon: WeaponId; startedAt: number; landsAt: number; a: number; packet: DamagePacket; origin: Vec2; target?: string }
  /** The bow's fixed draw: the same as a cast, except that a stagger does not interrupt it (9.1) and `drawStartedAt` is synced. */
  | { kind: "draw"; weapon: WeaponId; startedAt: number; landsAt: number; a: number; packet: DamagePacket; origin: Vec2; target?: string };

/**
 * A fighter's weapon state machine (sim/weapons.ts). The slots, the one in hand, the cooldown end (`readyAt`) and the
 * draw start are synced on the fighter's state; this is the rest. Times are server ms.
 */
export interface WeaponRuntime {
  action: PendingAction | null;
  /** The axe's root, past its windup (an attack winding up roots on its own: `action`). */
  rootUntil: number;
  staggerImmuneUntil: number;
  /** The trigger: held since `pressedAt`; a press is also remembered until `bufferedUntil` (quick clicks). */
  held: boolean;
  pressedAt: number;
  bufferedUntil: number;
  /** Latest aim angle and when it arrived (0 = never aimed: walking turns the fighter). */
  aim: number;
  aimAt: number;
  /** How far behind the server the fighter's client renders (server now - its `t`), clamped; melee rewinds by it. */
  lagMs: number;
  /** The fighter this one has locked (a `target` order, players only) and what the chase needs (sim/targeting.ts). */
  lock: string | null;
  /** The lock's target has been in line of sight at least once since it was locked (only then can losing it end the lock). */
  lockSeen: boolean;
  /** Server ms the lock's target went out of line of sight after being seen (0 = in sight, or not seen yet). */
  lockLosLostAt: number;
  /**
   * When the chase last planned a path (-Infinity: never), and the point it planned to (null: none yet). The time is a
   * throttle that outlives the lock (setting or dropping one leaves it), so changing locks never re-plans sooner.
   */
  lockPlanAt: number;
  lockGoal: Vec2 | null;
  /** When a `target` order last cost a path search (-Infinity: never): at most one per TARGET_REPATH_MS (sim/targeting.ts). */
  lockSearchAt: number;
  /** Server ms the fighter's last bow arrow or wand ball left it (-Infinity: none yet). Swift Boots' `notShooting` pause counts from it (sim/mods.ts). */
  lastShotAt: number;
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
  /**
   * The slide on ice (shared/walk.ts), created the first tick the fighter stands on slippery ground and dropped when it grips
   * again, on going down and on every teleport (sim/movement.ts walkFighter). Absent or null: walking the path exactly.
   */
  slip?: SlipState | null;
  /** Timed statuses on this fighter (sim/status.ts). Created on first use, so a hand-built runtime needs nothing. */
  statuses?: StatusInstance[];
  /** The ability being cast, if any (sim/abilities.ts). It is not a weapon action: it roots, but only its def's `cancelledBy` ends it. */
  cast?: CastRuntime | null;
}

/** One timed status on a fighter (sim/status.ts). Per-kind fields are set only for that kind. */
export interface StatusInstance {
  kind: StatusKind;
  source: DamageSource;
  ability?: AbilityId;
  /** The buff or relic behind it, for sources that are not an ability. */
  tag?: string;
  startedAt: number;
  until: number;
  /** The magnitude: a slow or anti-heal share, a haste bonus, a dot's raw dps. */
  value: number;
  /** hidden: its own attack or cast has revealed it from `revealFrom` (the tick after it began, so no fighter's order decides what another reads in that tick) until `revealUntil`. */
  revealFrom?: number;
  revealUntil?: number;
  /** zoned: the zone's field and the damage factors it applies. */
  fieldId?: string;
  dealtMult?: number;
  takenFromSourceMult?: number;
  /** deathFloor: the hp it holds the fighter at, the hp loss it has held up so far and the share paid back as a heal at its end. */
  floorHp?: number;
  taken?: number;
  healShare?: number;
  /** dot: the damage shares of its raw damage (all true when absent). */
  shares?: DamageShares;
}

/** A pending ability cast (sim/abilities.ts). Times are server ms. */
export interface CastRuntime {
  ability: AbilityId;
  rank: number;
  slot: AbilitySlot;
  startedAt: number;
  landsAt: number;
  target: string | null;
  point: Vec2;
  /** The blink's landing, found when the cast is re-validated just before it lands. */
  landing: Vec2 | null;
  /** The slot's ready time before the cast spent it, restored when the arena cancels the cast. */
  prevReadyAt: number;
  /** From the cast's `t`, clamped like a weapon's lag; unused until skills rewind. */
  lagMs: number;
}

/** An area in the world (sim/fields.ts), mirrored once into `state.fields`. */
export interface FieldRuntime {
  id: string;
  kind: FieldKind;
  ability: AbilityId;
  owner: DamageSource;
  subject: string | null;
  x: number;
  y: number;
  x2: number;
  y2: number;
  r: number;
  vx: number;
  vy: number;
  startedAt: number;
  endsAt: number;
}

/** Server-only ability data, created on first use (sim/fields.ts `abilitiesRt`); `World.abilities` is null until then. */
export interface AbilitiesRuntime {
  fields: Map<string, FieldRuntime>;
  /** Ability damage over time waiting to be reported as one `hit` fx per DOT_FX_MS, by victim and source (the signature dot's twin). */
  dot: Map<string, { victim: string; by: string; ability: AbilityId; amount: number }>;
  dotSince: number;
  /** Server ms of the coliseum teleport, once there was one: a cast arriving within CAST_TELEPORT_GRACE_MS of it is refused. */
  teleportedAt?: number;
}

export interface PlayerRuntime extends CombatRuntime {
  profile: string;
  killedBy: string | null;
  /** GV earned this run, by source. A win bonus is decided when the run resolves and is never kept here. */
  gv: { kills: number; mobs: number; bounty: number; quest: number };
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
  /** The barrier's timer (sim/buffs.ts). Created on first use, so a hand-built runtime needs nothing. */
  boost?: BoostRuntime;
  /** Keys of the once-per-run trigger rows that have fired (sim/factions.ts, e.g. Blood Saint's heal). Created on first use. */
  fired?: Set<string>;
  /** Rampage announcement throttle (sim/feed.ts). Created on first use. */
  announce?: AnnounceRuntime;
  /** Heals spread over time still to come (Second Wind; sim/factions.ts healOverTime). Created on first use. */
  hots?: HealOverTime[];
}

/** The rest of a heal spread over time: `left` more steps of `amount`, the next at server ms `next`. */
export interface HealOverTime {
  next: number;
  left: number;
  amount: number;
  ignoreLockout: boolean;
}

/** Server-only timers behind a player's buffs. Times are server ms. */
export interface BoostRuntime {
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
  /** The weapon that dealt it (a riposte and a reflected arrow name the shield); null for an ability's or another named source's damage. */
  weapon: WeaponId | null;
  /** The ability that dealt it (weapon null). `by` is the caster, so kill credit and the bounty work as for a weapon. */
  ability?: AbilityId;
  /** Damage over time, from a status or an area: no `hit` fx of its own (it is reported in chunks). */
  dot?: boolean;
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
  /**
   * The world's own damage (sudden death, terrain hazards): it lands in the pass like any hit, but shows no `hit` fx and is
   * not counted as combat, so `weapon` is never read.
   */
  arena?: boolean;
}

/** A ledger entry that took hp off its victim this tick (applyLedger), for systems that react to damage. */
export interface LandedHit {
  victim: string;
  by: string;
  /** After armor and shield: the whole hit, even past the hp a killing tick removes (as testing/realtime.py counts it). */
  amount: number;
  weapon: WeaponId | null;
  sig?: SignatureKind;
  ability?: AbilityId;
  dot?: boolean;
}

/** A swing whose windup ended this tick (resolved in the melee phase). */
export interface MeleeRequest {
  attacker: string;
  weapon: WeaponId;
  /** Direction fixed when the swing started; a swing on a locked target is aimed straight at it as it lands. */
  a: number;
  /** Server time the attacker's client was drawing when the swing landed: attacker and targets are sampled there. */
  rewindT: number;
  packet: DamagePacket;
}

/** A projectile loosed this tick (the bow when its draw ends, the wand when its cast ends); spawned after the sweep. */
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

/**
 * A projectile in flight (sim/projectiles.ts). Not in the synced state: clients are told of it by an `fxs` batch, from
 * `launch`, which is fixed when it leaves and is exactly what they fly it from.
 */
export interface ProjectileRuntime {
  id: string;
  launch: ProjectileLaunch;
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
  /** Set when it stops; it is then removed from `world.projectiles`. */
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
   * True while applyLedger applies damage. Rewards for kills (GV, a bounty, buffs, a trigger's heal) are queued in `payouts` and
   * paid once every victim has taken their damage (payLater), so who is left standing never depends on the order victims
   * happen to be processed in.
   */
  collecting: boolean;
  payouts: Array<() => void>;
  /**
   * Camp-wide wake requests made during the pass (sim/mobAI.ts): a camp, and the player its hit member hands on. Resolved once
   * after the pass, so the order victims were processed in (join order) never decides whom a camp chases.
   */
  campWakes: Array<{ camp: number; target: string }>;
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
  /** Set when a player is abandoned mid-run or in planning (a server shutdown): the run is void and the sim stops advancing it (planning never starts one). */
  voided: boolean;
  /**
   * Every player's bounty when the tick being simulated began. A kill in a tick pays the victim's bounty from here,
   * so a bounty raised by another kill in the same tick (whose victim the ledger happened to apply first) isn't paid.
   */
  bountyAtTickStart: Map<string, number>;
}

/**
 * Counters the terrain hazards keep for measurement (sim/terrainEffects.ts): nothing in the game reads them. `damage` is the
 * hp each victim actually lost to each hazard kind ("ember"): what the ledger took off after armor, teleport immunity, a kill
 * barrier, Last Stand's floor and overkill (WorldHooks.arenaHurt), not the burn asked for. `seconds` the fighter-seconds each
 * kind acted on (a fighter its home rule exempts adds none), and `heal` the hp light restored per player.
 */
export interface HazardStats {
  damage: Map<string, Record<string, number>>;
  seconds: { ember: number; bog: number; ice: number; light: number };
  heal: Map<string, number>;
}

export interface HazardRuntime { stats: HazardStats }

export function newHazardStats(): HazardStats {
  return { damage: new Map(), seconds: { ember: 0, bog: 0, ice: 0, light: 0 }, heal: new Map() };
}

export type SimEvent =
  | { type: "fx"; fx: FxEvent }
  | { type: "toast"; to: string | null; text: string }
  | { type: "raidStarted" }
  /** The lobby closed into the planning phase (sim/planning.ts): the Room locks itself, as it does at raidStarted. */
  | { type: "planningStarted" }
  /** A player's private planning deal changed (or was just dealt): the Room sends `plan` to that player only. */
  | { type: "plan"; to: string; plan: PlanMessage }
  /** A hidden offer's private head-start reveal; public sync follows four seconds later. */
  | { type: "questReveal"; to: string; quest: import("@raid/shared").QuestRevealMessage }
  | { type: "raidEnded" }
  /** Feedback only: GV a player just earned. It is banked through their `resolved` result, never from this. */
  | { type: "gv"; id: string; amount: number; reason: GvReason }
  /** A player's run is over; the Room banks `result` (GV and stats) and sends it to them. */
  | { type: "resolved"; id: string; result: RunResult };

/** Handles one queued action for a standing fighter (players today; Phase 11 mobs go through the same handlers). */
export type ActionHandler = (world: World, c: Combatant, cmd: ActionCommand) => void;
export type SimSystem = (world: World, dtMs: number) => void;
/**
 * A factor on a fighter's move speed this tick (Frost's chill; Phase 11 buffs). All of them multiply. `dtMs` is the step being
 * simulated (step.ts passes it; a caller outside the tick may not).
 */
export type MoveModifier = (world: World, c: Combatant, dtMs?: number) => number;

/** What one mod source adds to a fighter's stat mirrors (sim/mods.ts): multipliers multiply in, flat bonuses add points. */
export interface ModContribution {
  asMult?: number;
  speedMult?: number;
  windupMult?: number;
  armor?: number;
  shield?: number;
}
/**
 * A source the stat mirrors fold in besides the fighter's own rows (sim/mods.ts), e.g. a status runtime's attack slow. It answers
 * from the present state (null = nothing). One whose answer changes must call recomputeMods(world, c) when it does; the
 * per-tick pass re-asks every source, which catches an expiry by the end of that tick.
 */
export type ModSource = (world: World, c: Combatant) => ModContribution | null;

export interface WorldHooks {
  /** A player went down (died/mia) with their run gear still on them. Default: discard it. */
  dropBody(world: World, p: PlayerState): void;
  /** The lobby just turned into planning: private deals and public planning offers are ready. */
  planningStarted?(world: World): void;
  /** The lobby just turned into an active raid: players are placed and `raidStartedAt` is set. */
  raidStarted?(world: World): void;
  /**
   * Everyone alive was just moved into the coliseum (paths and input queues are already cleared). Modules chain onto
   * it: weapons cancel every action, projectiles clear every flight.
   */
  teleported?(world: World): void;
  /** `killer` just claimed `victim`'s bounty (already paid). sim/buffs.ts moves half of each of the victim's buffs here. */
  bountyClaimed?(world: World, killer: PlayerRuntime, victim: PlayerRuntime, bounty: number): void;
  /** A player just killed another player (kill GV and bounty paid); quest objectives chain here. */
  playerKilled?(world: World, killer: PlayerRuntime, victim: PlayerRuntime, outcome: "died" | "mia"): void;
  /** A regional mob's spoils were just paid; quest objectives chain here. `camp` is its map index, or -1 when camp-less. */
  mobKilled?(world: World, killer: PlayerRuntime, mob: { type: MobTypeId; zone: FactionId; camp: number; elite: boolean }): void;
  /** A fighter changed the weapon in hand (a swap, or a pickup that replaced it). Phase 10 resets a Sentenced mark. */
  weaponSwapped?(world: World, c: Combatant): void;
  /** A fighter left the fight for good: a player went down (`down`) or left (`removed`), or a mob died (`down`). Modules clear their state for it. */
  fighterOut?(world: World, id: string, cause: "down" | "removed"): void;
  /**
   * The run just ended (arena.ts endRun: a winner, a draw, a void): results are out and the phase is "ended". The Wishes
   * clear their casts, statuses and fields here; sim/chests.ts removes every chest.
   */
  runEnded?(world: World): void;
  /** `c` just started an attack (a swing, a cast or a draw): its `action` is set. */
  attackStarted?(world: World, c: Combatant): void;
  /** A status was applied to `c` (after its effect bits were refreshed); `fresh` is false for a refresh of an instance it already had. */
  statusApplied?(world: World, c: Combatant, st: StatusInstance, fresh: boolean): void;
  /** A stagger took on `c` (its immunity has started). */
  staggered?(world: World, c: Combatant): void;
  /**
   * A ledger entry just took effect on its victim (applyLedger, after the victim's damage, once per entry that lands
   * a `landed` record: mitigated damage above 0, not the arena's burn). `applied` is that damage after armor and shield
   * (what its hit fx shows). Unset by default, so it costs nothing. On-hit effects (R4b) hang here; they must decide
   * from the state as it stood when the tick began (or defer what they write until the pass ends, as Wishes' statuses
   * do with payLater), never from what earlier victims of the same pass changed, or the ledger's order would matter.
   */
  hitLanded?(world: World, entry: LedgerEntry, applied: number): void;
  /**
   * The arena's own damage (an `arena` entry: sudden death, terrain) just took `hp` off `victim` (applyLedger, after the victim's
   * damage): the hp it actually removed, not what it asked for. Armor, teleport immunity, a kill barrier, Last Stand's floor and
   * overkill all come off first. When the victim also took other hits in the pass the removed hp is shared between the entries in
   * proportion to their (mitigated) amounts. Unset by default; a measurement tap, it must not change the state.
   */
  arenaHurt?(world: World, victim: string, by: DamageSource, hp: number): void;
  /**
   * A standing fighter just took `applied` damage in the ledger pass (applyLedger, once per victim per pass, after all of
   * its hits landed together, the arena's burn included; before the hit fx and hitLanded). It is still standing: a victim
   * the pass killed is not reported. Reactions to the fighter's own hp (Blood Saint's trigger, sim/factions.ts) hang here;
   * they decide from the victim's own state only and defer what they pay with payLater. `applied` is what reached the pool
   * (a death floor that held the hp counts the whole hit), so `hpBefore`, the hp as the pass began, is what a "crossed the
   * threshold" test must read, never hp + applied.
   */
  hurt?(world: World, c: Combatant, applied: number, hpBefore: number): void;
  /**
   * Camp `camp` (its index in map.camps) just lost its last mob (sim/camps.ts). Called after the ledger pass that killed it
   * (payLater), right after the `campCleared` fx; sim/chests.ts drops the camp's shared chest here.
   */
  campCleared?(world: World, camp: number): void;
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
  /** The arrows and balls in flight, by id. Plain objects: nothing here is synced (rooms/FxChannel.ts announces them). */
  projectiles: Map<string, ProjectileRuntime>;
  combat: CombatScratch;
  /** Server-only randomness (loot rolls, spawn assignment). Never derived from the public seed. */
  random: () => number;
  /** Secret salt for the per-tick player processing order (see actionOrder in step.ts). */
  orderSalt: number;
  /**
   * A private stream for reward and roster rolls (camp rosters at world build, chest options when a camp is cleared). Separate from
   * `random`, so drawing from it never shifts the loot rolls. The Room seeds it with a fresh crypto salt (createWorld's
   * `rewardSalt`); without one it is derived from orderSalt, which is fine for tests but not for a live room: orderSalt
   * also keys tieRank, whose outcomes a client can observe (see CLAUDE.md), so it is not secret enough to roll rewards from.
   */
  rewardRandom: () => number;
  /**
   * The quests' own 128-bit stream (rosters and every giver, token and parcel position): quest code draws only from it,
   * never from `rewardRandom` or `random`, so switching quests on or off moves neither. The Room seeds it from its own
   * crypto words (`questSalt`), so it is independent of the reward stream whose early outputs (rosters, chest options)
   * players see; without one it is a mixed derivation of the reward salt (tests).
   */
  questRandom: () => number;
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
  /** Sources the stat mirrors fold in besides the fighter's own rows (sim/mods.ts); empty unless a module registers one. */
  modSources: ModSource[];
  hooks: WorldHooks;
  arena: ArenaRuntime;
  /** Faction signatures (sim/factions.ts); null until that module is installed. */
  factions: FactionsRuntime | null;
  /** The planning phase's private deal (sim/planning.ts): null until planning starts, kept (read-only) after it. */
  planning: PlanningRuntime | null;
  /** Terrain hazards (sim/terrainEffects.ts); null until that module is installed. */
  terrain: TerrainRuntime | null;
  /** What the hazards did, for measurement. */
  hazards: HazardRuntime;
  /** Areas and ability damage over time (sim/fields.ts); null until something uses them. */
  abilities: AbilitiesRuntime | null;
  /** Quest offers and their server-only hidden state (sim/quests.ts); null when disabled or training. */
  quests: QuestsRuntime | null;
}

export function createWorld(opts: {
  /**
   * The public seed. Required without a `map` (the map is generated from it). With a map, the map's own seed is what is
   * published (with its attempt and hash, so a client rebuilds exactly this map), and a `seed` given as well must equal it:
   * a mismatch throws, since a client would then regenerate a different map than the one played on.
   */
  seed?: number;
  config: SimConfig;
  random: () => number;
  newItemUid?: () => string;
  /**
   * A ready map instead of generateMap(seed): the live server's comes from its map pool (server/src/mapPool.ts, with
   * `seed` = its seed), and hand-built test arenas and the harness skip the generator.
   */
  map?: GameMap;
  /**
   * The secret behind `rewardRandom`: four crypto-random 32-bit words (the Room's), or a single number (tests), which is
   * expanded. Derived from orderSalt when absent (tests only).
   */
  rewardSalt?: number | readonly number[];
  /**
   * The secret behind `questRandom`, in the same forms. The Room passes four more crypto-random words, so the hidden
   * quests do not share a state with the reward stream; without it (tests) the stream is mixed from the reward salt.
   */
  questSalt?: number | readonly number[];
}): World {
  const state = new RaidState();
  const given = opts.seed === undefined ? undefined : opts.seed >>> 0;
  if (opts.map && given !== undefined && given !== opts.map.seed >>> 0) {
    throw new Error(`createWorld: seed ${given} does not match the map's seed ${opts.map.seed >>> 0}`);
  }
  if (!opts.map && given === undefined) throw new Error("createWorld: needs a seed or a map");
  state.seed = opts.map ? opts.map.seed >>> 0 : given!;
  state.minPlayers = opts.config.minPlayers;
  // The only draw from opts.random here: tests script that stream, so the reward stream must not take from it.
  const orderSalt = Math.floor(opts.random() * 2 ** 32) >>> 0;
  const rewardSalt = opts.rewardSalt ?? rewardSaltFrom(orderSalt);
  const map = opts.map ?? generateMap(state.seed);
  // What a client needs to build the same map with one attempt, and to know it did.
  state.attempt = map.attempt;
  state.mapHash = mapHashU32(map);
  return {
    state,
    config: opts.config,
    map,
    idCounter: 0,
    joined: 0,
    newItemUid: opts.newItemUid ?? (() => randomUUID()),
    players: new Map(),
    mobs: new Map(),
    projectiles: new Map(),
    combat: { ledger: [], melee: [], spawns: [], swept: [], rank: new Map(), landed: [], collecting: false, payouts: [], campWakes: [], medianFeed: null },
    random: opts.random,
    orderSalt,
    rewardRandom: rewardStream(rewardSalt),
    questRandom: rewardStream(opts.questSalt ?? questSaltFrom(rewardSalt)),
    events: [],
    stepping: false,
    actions: {},
    afterWeapons: [],
    beforeDamage: [],
    systems: [],
    moveModifiers: [],
    modSources: [],
    hooks: { dropBody: (_w, p) => { p.weapon0 = ""; p.weapon1 = ""; } },
    arena: { startedWith: 0, downedThisTick: [], downsBetweenTicks: 0, voided: false, bountyAtTickStart: new Map() },
    factions: null,
    planning: null,
    terrain: null,
    hazards: { stats: newHazardStats() },
    abilities: null,
    quests: null,
  };
}

/**
 * A test-only reward salt from orderSalt (murmur3's finalizer over a distinct tag), so that stream never lines up with
 * actionOrder's or tieRank's (which hash orderSalt with the tick). A live room passes its own crypto salt instead.
 */
function rewardSaltFrom(orderSalt: number): number {
  let h = (orderSalt ^ 0x52455744) >>> 0; // "REWD"
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function saltWords(seed: number | readonly number[]): Uint32Array {
  const words = new Uint32Array(4);
  if (typeof seed !== "number") {
    for (let i = 0; i < 4; i++) words[i] = (seed[i] ?? 0) >>> 0;
    return words;
  }
  let x = seed >>> 0;
  for (let i = 0; i < 4; i++) {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    words[i] = (z ^ (z >>> 16)) >>> 0;
  }
  return words;
}

/**
 * A quest salt from the reward salt, for a world whose Room gave none (tests): four lanes under a tag, mixed so that each
 * output word depends on all four input words (a leaked reward word says nothing of one quest word) while the whole map
 * stays 128 bits in, 128 bits out (every step is a bijection of its own lane given the others).
 */
function questSaltFrom(seed: number | readonly number[]): number[] {
  const fmix = (x: number): number => {
    let h = x >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
  const words = saltWords(seed);
  const lane = Array.from(words, (w, i) => (w ^ 0x51554553 ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0); // "QUES"
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 4; i++) {
      lane[i] = fmix((lane[i]! + (lane[(i + 1) & 3]! ^ rotl(lane[(i + 2) & 3]!, 7 + 5 * i))) >>> 0);
    }
  }
  return lane;
}

/**
 * A private 128-bit stream: sfc32 over four salt words, so seeing rolls does not let a client brute-force a 32-bit seed.
 * A single number is expanded into four words; the Room passes four crypto-random ones.
 */
export function rewardStream(seed: number | readonly number[]): () => number {
  const words = saltWords(seed);
  let a = words[0]!, b = words[1]!, c = words[2]!, d = words[3]!;
  const next = (): number => {
    const t0 = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const t = (t0 + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  return next;
}

export function emit(world: World, ev: SimEvent): void {
  world.events.push(ev);
}

type ChainableHook =
  | "teleported" | "planningStarted" | "raidStarted" | "weaponSwapped" | "bountyClaimed" | "hitLanded" | "hurt" | "arenaHurt"
  | "fighterOut" | "runEnded" | "attackStarted" | "statusApplied" | "staggered" | "campCleared" | "mobKilled" | "playerKilled";

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
 * salt down (see CLAUDE.md). A player's kill credit uses combat.rank instead; a mob's (sim/mobLife.ts killMob) uses this
 * for an exact tie in what two players did to it over the whole fight, where one of them may not be in the pass at all.
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
    action: null, rootUntil: 0, staggerImmuneUntil: 0, held: false, pressedAt: 0, bufferedUntil: 0, aim: 0, aimAt: 0, lagMs: 0,
    lock: null, lockSeen: false, lockLosLostAt: 0, lockPlanAt: -Infinity, lockGoal: null, lockSearchAt: -Infinity, lastShotAt: -Infinity,
  };
}
