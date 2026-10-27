// The bot brain's contract (docs/BOTS.md). Everything a layer needs to be written against, and nothing that runs: types,
// plus the tier, persona, view and learning tables, which are design numbers every layer must share.
//
// Data flow, one frame (a server tick in-process, a patch over the network):
//   driver state + fx  --perception.ts-->  Frame  --frames.ts (delay ring)-->  Percept
//   Percept  --memory.ts-->  MemoryView + Stimulus[]  --strategy.ts-->  Goal  --tactics.ts (+ modules)-->  Intent[]
//   Intent[]  --humanizer.ts-->  TimedCommand[]  --driver-->  enqueueClientMessage (in-process) | room.send (network)
//
// Import rules (test/bots/boundary.test.ts):
//   - files under bots/brain/ import @raid/shared (never @raid/shared/schema), each other, and ../mobHunt; nothing from sim/,
//     rooms/, persistence/, @colyseus/*, node:*. The one exception is perception.ts, the only reader of the synced state: it
//     may `import type` from @raid/shared/schema.
//   - no Math.random, Date.now, performance.now, timers or `process` under bots/brain/: time is the percept's server time and
//     randomness comes from the seeded streams in BrainRngs, so a headless tournament replays exactly.
import {
  INTERP_DELAY_MS, Y_SCALE,
  type BuffStat, type ClientMessages, type ComboId, type FactionId, type GameMap, type ProjectileEnd, type ProjectileKind,
  type Rng, type RunOutcome, type RunResult, type SignatureKind, type Vec2, type WeaponId,
} from "@raid/shared";

/** Server time (state.serverTime), ms. The brain has no other clock. */
export type ServerMs = number;
/** A player's or a mob's key in the synced maps (a session id, `BOT_ID_PREFIX`n, or a mob id). */
export type FighterId = string;
export type AbilitySlotId = "wish" | "q" | "e";

// =================================================================================================================== tiers

export type TierId = "easy" | "normal" | "hard";
export const TIER_IDS: readonly TierId[] = ["easy", "normal", "hard"];

/** An ex-Gaussian delay (ms): N(mu, sigma) + Exp(tau), mean mu + tau. Resampled below `floor`, clamped at `cap`. */
export interface ExGaussian {
  readonly mu: number;
  readonly sigma: number;
  readonly tau: number;
  readonly floor: number;
  readonly cap: number;
}

export interface TierParams {
  readonly id: TierId;
  /** Unexpected stimulus first in the percept -> the click: notice, decide, move the hand. */
  readonly reaction: ExGaussian;
  /** The next step of a plan already made (walk off after a shot, press F on arrival): anticipated, so shorter. */
  readonly step: ExGaussian;
  /** After the coliseum teleport: finding yourself on a new screen. */
  readonly daze: ExGaussian;
  /** Two independent decisions are at least this far apart (psychological refractory period, ms). */
  readonly refractoryMs: number;
  /** Tactics re-think without any stimulus every mean +- jitter ms (uniform); strategy likewise. */
  readonly thinkMs: { readonly mean: number; readonly jitter: number };
  readonly strategyMs: { readonly mean: number; readonly jitter: number };
  /** Sustained actions per minute (token bucket), its size, and the shortest gap between two commands (ms). */
  readonly apm: number;
  readonly burst: number;
  readonly minGapMs: number;
  /** Right-click on the ground: 2D Gaussian sigma (u) = base + perUnit x distance from the bot (the cursor travels from it). */
  readonly moveScatter: { readonly base: number; readonly perUnit: number };
  /**
   * Left-click on a fighter: the cursor lands at its drawn position minus its velocity x lagS (the hand trails a mover), plus
   * Gaussian sigma (u); with probability slipP the sigma is x slipMult. The point then goes through the client's picker.
   */
  readonly targetScatter: { readonly sigma: number; readonly lagS: number; readonly slipP: number; readonly slipMult: number };
  /** A right-click on the minimap (a destination off screen): sigma in world units. */
  readonly minimapSigma: number;
  /** For an off-screen destination: chance to click the screen edge toward it (and click again as it walks) over the minimap. */
  readonly edgeClickP: number;
  /** Error (sigma, ms) on a timed step: the orb-walk re-lock at the cooldown, a juke at a draw's end. */
  readonly timingSigmaMs: number;
  /** Chance per decision to pause first, and how long (uniform ms). Never more than one pause per decision. */
  readonly hesitation: { readonly p: number; readonly minMs: number; readonly maxMs: number };
  /** Softmax temperature over option utilities (utility units ~0..1), and the chance to take any of the top three instead. */
  readonly softmaxT: number;
  readonly lapseP: number;
  /** Chance to sidestep a visible incoming ball (or wand windup) when it is still dodgeable after the reaction. */
  readonly dodgeP: number;
  /** Chance to time a direction change to a visible bow draw's end (the only way to beat an arrow). */
  readonly jukeP: number;
  /** Orb-walk with a ranged weapon against a chaser: chance per engagement, step length (u), heading noise (rad). */
  readonly orbwalk: { readonly p: number; readonly stepU: number; readonly angleJitter: number };
  /** Chance this bot knows each edge of the faction and weapon wheels (fixed per bot at creation). Unknown edges read 0. */
  readonly knowledge: number;
  /** Fixed per-bot error on the mob matchup share (uniform +-). */
  readonly mobShareNoise: number;
  /** Route planning: nearest camps considered, walk (true) or straight-line x 1.3 distances, and MobHunter `reach` (u). */
  readonly route: { readonly horizon: number; readonly walkPaths: boolean; readonly reach: number };
  /**
   * Attention: a stimulus inside `central` x the view's half extents is seen at the plain reaction; outside it x peripheryMult;
   * while the bot is fighting, a NEW threat x engagedMult as well (tunnel vision), and the fight is only reconsidered every
   * reconsiderMs.
   */
  readonly attention: {
    readonly central: number;
    readonly peripheryMult: number;
    readonly engagedMult: number;
    readonly reconsiderMs: number;
  };
  /** How long an opponent's last position and hp are remembered at all. */
  readonly memorySpanMs: number;
  /** Chance to ignore a windup from a fighter that cancelled one at us within the last 3 s (reading a feint). */
  readonly feintRead: number;
  /**
   * How it sizes up a fight it could open (strategy.ts, `appraise`): the logit of its chance to win is `bias + lead x (own hp share -
   * theirs) + busy x (they are trading hits with a third fighter) + hue x (the matchup score the hue and the wheels give) + noise x N(0, 1)`,
   * the last a misjudgement kept per foe for a few seconds. The weights of the best player are what the tournaments' fights show
   * (docs/BOTS_TUNING.md 2): the hp lead decides fights, the hue hardly does. A newcomer weighs the hue and not the bars.
   */
  readonly appraisal: {
    readonly bias: number; readonly lead: number; readonly busy: number; readonly hue: number; readonly noise: number;
  };
  /**
   * Wariness (u): a player it does not want to fight that is walking at it, or is this close, is kept away from (a short flight
   * that drops no fight in progress). 0 = it does not notice, or does not mind.
   */
  readonly wary: number;
  /**
   * Mob farming is paid for in hp (a starter loses about 20% of it on each of its first two kills and gets no hp back): the matchup
   * share a normal mob and an elite need (mobHunt's `mobMinShare` / `eliteMinShare`; an elite is also taken with three stacks at
   * 0.4), and the hp share below which no new mob fight is opened.
   */
  readonly caution: { readonly mobShare: number; readonly eliteShare: number; readonly startHp: number };
}

export const TIERS: Readonly<Record<TierId, TierParams>> = {
  easy: {
    id: "easy",
    reaction: { mu: 330, sigma: 60, tau: 120, floor: 230, cap: 1400 },
    step: { mu: 150, sigma: 40, tau: 50, floor: 90, cap: 700 },
    daze: { mu: 700, sigma: 150, tau: 300, floor: 400, cap: 2500 },
    refractoryMs: 180,
    thinkMs: { mean: 300, jitter: 100 },
    strategyMs: { mean: 2000, jitter: 600 },
    apm: 60, burst: 3, minGapMs: 160,
    moveScatter: { base: 14, perUnit: 0.04 },
    targetScatter: { sigma: 26, lagS: 0.09, slipP: 0.04, slipMult: 3 },
    minimapSigma: 40,
    edgeClickP: 0.7,
    timingSigmaMs: 160,
    hesitation: { p: 0.12, minMs: 400, maxMs: 1200 },
    softmaxT: 0.25, lapseP: 0.08,
    dodgeP: 0.15, jukeP: 0,
    orbwalk: { p: 0, stepU: 120, angleJitter: 0.6 },
    knowledge: 0.4, mobShareNoise: 0.15,
    route: { horizon: 3, walkPaths: false, reach: 500 },
    attention: { central: 0.6, peripheryMult: 1.4, engagedMult: 1.6, reconsiderMs: 2500 },
    memorySpanMs: 25_000,
    feintRead: 0,
    appraisal: { bias: 0.9, lead: 2, busy: 0.3, hue: 1.1, noise: 0.9 },
    wary: 0,
    caution: { mobShare: 0.3, eliteShare: 0.3, startHp: 0.3 },
  },
  normal: {
    id: "normal",
    reaction: { mu: 210, sigma: 40, tau: 70, floor: 170, cap: 900 },
    step: { mu: 100, sigma: 25, tau: 30, floor: 70, cap: 500 },
    daze: { mu: 500, sigma: 100, tau: 200, floor: 300, cap: 1800 },
    refractoryMs: 140,
    thinkMs: { mean: 200, jitter: 60 },
    strategyMs: { mean: 1500, jitter: 400 },
    apm: 110, burst: 4, minGapMs: 110,
    moveScatter: { base: 9, perUnit: 0.025 },
    targetScatter: { sigma: 18, lagS: 0.06, slipP: 0.02, slipMult: 3 },
    minimapSigma: 28,
    edgeClickP: 0.5,
    timingSigmaMs: 100,
    hesitation: { p: 0.07, minMs: 250, maxMs: 800 },
    softmaxT: 0.12, lapseP: 0.04,
    dodgeP: 0.4, jukeP: 0.2,
    orbwalk: { p: 0.5, stepU: 140, angleJitter: 0.4 },
    knowledge: 0.7, mobShareNoise: 0.08,
    route: { horizon: 6, walkPaths: true, reach: 700 },
    attention: { central: 0.65, peripheryMult: 1.3, engagedMult: 1.4, reconsiderMs: 2000 },
    memorySpanMs: 35_000,
    feintRead: 0.1,
    appraisal: { bias: 0.3, lead: 3.4, busy: 0.5, hue: 0.6, noise: 0.45 },
    wary: 300,
    caution: { mobShare: 0.6, eliteShare: 0.8, startHp: 0.6 },
  },
  hard: {
    id: "hard",
    reaction: { mu: 160, sigma: 25, tau: 40, floor: 140, cap: 700 },
    step: { mu: 70, sigma: 15, tau: 20, floor: 55, cap: 400 },
    daze: { mu: 350, sigma: 80, tau: 150, floor: 220, cap: 1400 },
    refractoryMs: 120,
    thinkMs: { mean: 150, jitter: 40 },
    strategyMs: { mean: 1200, jitter: 300 },
    apm: 170, burst: 5, minGapMs: 80,
    moveScatter: { base: 6, perUnit: 0.015 },
    targetScatter: { sigma: 12, lagS: 0.035, slipP: 0.01, slipMult: 3 },
    minimapSigma: 20,
    edgeClickP: 0.3,
    timingSigmaMs: 60,
    hesitation: { p: 0.04, minMs: 150, maxMs: 500 },
    softmaxT: 0.06, lapseP: 0.02,
    dodgeP: 0.65, jukeP: 0.45,
    orbwalk: { p: 0.85, stepU: 160, angleJitter: 0.26 },
    knowledge: 0.95, mobShareNoise: 0.03,
    route: { horizon: 10, walkPaths: true, reach: 900 },
    attention: { central: 0.7, peripheryMult: 1.25, engagedMult: 1.3, reconsiderMs: 1500 },
    memorySpanMs: 45_000,
    feintRead: 0.2,
    appraisal: { bias: -0.3, lead: 4.5, busy: 0.7, hue: 0.25, noise: 0.15 },
    wary: 450,
    caution: { mobShare: 0.7, eliteShare: 1.1, startHp: 0.7 },
  },
};

// ================================================================================================================ personas

export type PersonaId = "farmer" | "hunter" | "opportunist" | "cautious";
export const PERSONA_IDS: readonly PersonaId[] = ["farmer", "hunter", "opportunist", "cautious"];

/** What a bot wants. Tiers say how well it plays; personas say what it plays for. The two never multiply (docs/BOTS.md 5). */
export interface PersonaParams {
  readonly id: PersonaId;
  /** Utility weights (0..1) on the strategy's goal families. */
  readonly pve: number;
  readonly pvp: number;
  readonly loot: number;
  readonly bounty: number;
  readonly thirdParty: number;
  /**
   * The logit of its chance to win (TierParams.appraisal) needed to open a fight with a player: 0.7 is 2 in 3, 1.1 3 in 4, 1.6 5 in 6, 1.9
   * 6 in 7. `bountyCaution` is added while it carries a bounty itself.
   */
  readonly engageEdge: number;
  readonly bountyCaution: number;
  /** Leave a fight below this hp share (also MobHunter.retreatHp); start none below `reengageHp` unless cornered. */
  readonly fleeHp: number;
  readonly reengageHp: number;
  /** Multiplies the tier's orb-walk chance when the matchup favours kiting. */
  readonly kite: number;
  /** A chase that has not closed ORBIT_PROGRESS for this long is dropped and its target avoided (the pursuit-ring breaker). */
  readonly chaseGiveUpMs: number;
  /** MobHunter overrides: kill goal, and the distance at which a standing player beats any mob. */
  readonly mobKillGoal: number;
  readonly playerThreat: number;
  readonly eliteAppetite: number;
  /** Inside the coliseum before sudden death: 0 holds the ring's edge and waits, 1 opens fights. */
  readonly coliseum: number;
}

export const PERSONAS: Readonly<Record<PersonaId, PersonaParams>> = {
  farmer: {
    id: "farmer", pve: 1, pvp: 0.3, loot: 0.7, bounty: 0.2, thirdParty: 0.2, engageEdge: 1.3, bountyCaution: 0.5,
    fleeHp: 0.4, reengageHp: 0.75, kite: 0.4, chaseGiveUpMs: 4000, mobKillGoal: 9, playerThreat: 250, eliteAppetite: 0.8,
    coliseum: 0.3,
  },
  hunter: {
    id: "hunter", pve: 0.35, pvp: 1, loot: 0.3, bounty: 1, thirdParty: 0.5, engageEdge: 0.3, bountyCaution: 0,
    fleeHp: 0.2, reengageHp: 0.5, kite: 0.2, chaseGiveUpMs: 9000, mobKillGoal: 3, playerThreat: 400, eliteAppetite: 0.3,
    coliseum: 1,
  },
  opportunist: {
    id: "opportunist", pve: 0.6, pvp: 0.7, loot: 1, bounty: 0.6, thirdParty: 1, engageEdge: 0.8, bountyCaution: 0.3,
    fleeHp: 0.35, reengageHp: 0.7, kite: 0.5, chaseGiveUpMs: 5000, mobKillGoal: 6, playerThreat: 300, eliteAppetite: 0.5,
    coliseum: 0.5,
  },
  cautious: {
    id: "cautious", pve: 0.7, pvp: 0.4, loot: 0.5, bounty: 0.2, thirdParty: 0.4, engageEdge: 1.6, bountyCaution: 0.6,
    fleeHp: 0.55, reengageHp: 0.9, kite: 1, chaseGiveUpMs: 3000, mobKillGoal: 7, playerThreat: 320, eliteAppetite: 0.4,
    coliseum: 0.2,
  },
};

// ============================================================================================================ the screen

/** Projected pixels every human sees top to bottom (client view/viewport.ts REF_VIEW_H; test/bots pins the two together). */
export const BOT_VIEW_REF_H = 900;
/** The window a bot is assumed to have: 16:9 (a 21:9 human sees 2100 u across, a 4:3 one 1200 u). */
export const BOT_VIEW_ASPECT = 16 / 9;
/** Half the visible world around the bot: 800 u across each way, 562.5 u up and down (the ground is squashed by Y_SCALE). */
export const BOT_VIEW = {
  halfW: (BOT_VIEW_REF_H * BOT_VIEW_ASPECT) / 2,
  halfH: BOT_VIEW_REF_H / Y_SCALE / 2,
} as const;
/** Perception keeps this much (u) beyond the window in a Frame; composing the Percept applies the exact window. */
export const FRAME_MARGIN = 64;
/** Other fighters' hp and barrier as read off a bar: steps of this share. */
export const HP_QUANT = 0.05;
/** Minimap dots: positions rounded to this (u), refreshed this often (the minimap repaints at 10 Hz, ui/minimap.ts). */
export const MINIMAP_QUANT = 16;
export const MINIMAP_REFRESH_MS = 100;
/** A projectile is credited to the visible fighter drawn nearest its origin within this (client render/FxView.ts LAUNCH_NEAR). */
export const LAUNCH_NEAR = 56;
/** Delays the network adapter does not need to add (they are real there); the in-process driver adds its own latency too. */
export const WORLD_RENDER_DELAY_MS = INTERP_DELAY_MS;

// ================================================================================================================ features

/** What this server and branch can do, detected at runtime (perception.ts detectFeatures), never imported by name. */
export interface Features {
  /** CLIENT_MESSAGE_TYPES as the server knows it. A command whose type is missing is never sent. */
  readonly messageTypes: readonly string[];
  /** "cast" accepted, PlayerState.wishReadyAt present, shared ABILITIES exported (Wishes branch). */
  readonly wishes: boolean;
  /** PlayerState.effects (EFFECT_* bits: hidden, untargetable, stunned...). */
  readonly statusEffects: boolean;
  /** RaidState.fields (zones, clouds, trails). */
  readonly fields: boolean;
  /** "plan" accepted and a planning phase exists (roguelike R3). */
  readonly planning: boolean;
  /** "choose" accepted: contested reward chests (R5). */
  readonly chests: boolean;
  /** Q/E slots on PlayerState (R6). */
  readonly skills: boolean;
  /** PlayerState.build (relics, curses, boons; R7). */
  readonly relics: boolean;
  /** RaidState.camps (CampState; R5). */
  readonly camps: boolean;
  /** The map carries terrain hazards (zone-terrain branch). */
  readonly hazards: boolean;
}

// ================================================================================================================= percept

/** The bot itself, as its HUD and its own drawn fighter show it (exact numbers: a human reads its own bars and buff rows). */
export interface SelfView {
  readonly id: FighterId;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  /** PlayerStatus: "lobby" | "alive" | "dead" | "mia". */
  readonly status: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly barrier: number;
  readonly faction: FactionId | null;
  readonly weapons: readonly [WeaponId | null, WeaponId | null];
  readonly slot: 0 | 1;
  /** The fighter its lock is on (the lock ring), or null. */
  readonly attackTarget: FighterId | null;
  readonly drawStartedAt: ServerMs;
  readonly readyAt: ServerMs;
  readonly immuneUntil: ServerMs;
  readonly sig: number;
  readonly brand: number;
  readonly stacks: Readonly<Record<BuffStat, number>>;
  /** Decoded stat mirrors (shared mods.ts decodeMult): the HUD's attack and move speed. */
  readonly asMult: number;
  readonly speedMult: number;
  readonly kills: number;
  readonly mobKills: number;
  readonly gv: number;
  readonly bounty: number;
  readonly moveSeq: number;
}

/** The run line and the arena timers (ui/hud.ts). */
export interface HudView {
  /** RaidPhase, or a newer one ("planning") this brain may not know. */
  readonly phase: string;
  readonly training: boolean;
  readonly lobbyEndsAt: ServerMs;
  readonly raidStartedAt: ServerMs;
  readonly patienceEndsAt: ServerMs;
  readonly suddenDeathAt: ServerMs;
  readonly inColiseum: boolean;
  readonly gatesLocked: boolean;
  readonly startedWith: number;
  /** Players standing (the HUD's "Alive n/N", counted over the whole room). */
  readonly alive: number;
  readonly playerCount: number;
  readonly minPlayers: number;
  readonly winner: string;
}

/** Another player on screen, as drawn. Built by perception (FighterSeen) and finished by compose (the rest). */
export interface FighterSeen {
  readonly id: FighterId;
  readonly name: string;
  /** The [BOT] tag. The brain must not decide anything on it (test: flipping it changes no command). */
  readonly bot: boolean;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly status: string;
  /** hp / maxHp and barrier / maxHp, read off the bar: quantized to HP_QUANT. Max hp itself is not shown. */
  readonly hpFrac: number;
  readonly barrierFrac: number;
  readonly faction: FactionId | null;
  /** The weapon in hand only: the other slot is never drawn (memory may remember it from a swap). */
  readonly inHand: WeaponId | null;
  /** The bow pull is drawn from it. */
  readonly drawStartedAt: ServerMs;
  /** The crown (0 = none). */
  readonly bounty: number;
  /** Teleport immunity is drawn. */
  readonly immune: boolean;
  readonly sig: number;
  readonly brand: number;
  /** False while untargetable (the client's `targetable(effects)`); hidden fighters are never in the percept at all. */
  readonly targetable: boolean;
}

export interface FighterView extends FighterSeen {
  /** Estimated from two frames 100 ms apart (a human sees motion); 0 when it was not on screen in both. */
  readonly vx: number;
  readonly vy: number;
  readonly dist: number;
  /** Clear line from the bot on the collision map (gates included). */
  readonly los: boolean;
  /** The matchup hue the UI shows (shared matchupTint: in sight within MATCHUP_RANGE), -1..+1, else 0. */
  readonly tint: number;
  /** Inside the attention centre (TierParams.attention.central). */
  readonly central: boolean;
}

export interface MobSeen {
  readonly id: FighterId;
  /** MobKind: "mob" | "elite" | "dummy". */
  readonly kind: string;
  readonly name: string;
  readonly faction: FactionId | null;
  readonly x: number;
  readonly y: number;
  readonly facing: number;
  readonly status: string;
  readonly hpFrac: number;
  readonly inHand: WeaponId | null;
  readonly drawStartedAt: ServerMs;
  readonly sig: number;
  readonly brand: number;
}

export interface MobView extends MobSeen {
  readonly vx: number;
  readonly vy: number;
  readonly dist: number;
  readonly los: boolean;
  readonly central: boolean;
}

/** A living regional mob's minimap dot (ui/minimap.ts setMobs): no hp, no weapon, no dummies, nothing dead. */
export interface MinimapMob {
  /** Dots are told apart by continuity on a real minimap; the id stands for that (docs/BOTS.md 3.2). */
  readonly id: FighterId;
  readonly x: number;
  readonly y: number;
  readonly faction: FactionId | null;
  readonly elite: boolean;
}

export interface MinimapView {
  /** When the dots were last refreshed (every MINIMAP_REFRESH_MS). */
  readonly t: ServerMs;
  readonly mobs: readonly MinimapMob[];
  readonly gatesLocked: boolean;
}

export interface ContainerSeen {
  readonly id: string;
  /** ContainerKind ("chest" | "ground" | "body"), or a newer kind ("reward"). */
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  /** A body's label (who it was); empty otherwise. */
  readonly label: string;
  /** A chest still shut (it holds its weapon); false once opened. Ground weapons and bodies: true while they hold one. */
  readonly closed: boolean;
  /**
   * What a pickup would take. A ground weapon's icon is always drawn; a chest's or a body's weapon is known only while it is
   * the interaction target (in INTERACT_RANGE with line of sight). undefined = cannot tell from here; null = nothing in it.
   */
  readonly weapon: WeaponId | null | undefined;
  /** Within INTERACT_RANGE with line of sight from the bot's latest position (what F would take). */
  readonly interactable: boolean;
}

export interface ContainerView extends ContainerSeen {
  readonly dist: number;
}

/** A projectile in flight on screen, flown from its launch tuple like the client flies it. */
export interface ProjectileView {
  readonly id: string;
  readonly kind: ProjectileKind;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly x0: number;
  readonly y0: number;
  readonly t0: ServerMs;
  readonly range: number;
  /** The visible fighter drawn nearest its origin within LAUNCH_NEAR, as the client attributes it; null when none was. */
  readonly from: FighterId | null;
}

interface EventBase {
  /** Server time of the step that produced it. */
  readonly t: ServerMs;
  /** Where it shows (the subject's drawn position, or the fx's own point); null for the HUD, an announcement, a private message. */
  readonly at: Vec2 | null;
}

/**
 * One thing the bot saw happen. Fx kinds keep their FxEvent names; a field naming a fighter the bot cannot see is null, and
 * an fx whose subject is off screen (or hidden) is not here at all, except the map-wide announcements (deaths by name,
 * bounties, the teleport, the victory) and what happens to the bot itself.
 */
export type ObservedEvent = EventBase & (
  | { readonly kind: "windup"; readonly by: FighterId; readonly weapon: WeaponId; readonly a: number; readonly ms: number }
  | { readonly kind: "swing"; readonly by: FighterId; readonly weapon: WeaponId; readonly a: number }
  | {
    readonly kind: "hit"; readonly id: FighterId; readonly by: FighterId | null; readonly amount: number;
    readonly weapon: WeaponId | null; readonly sig: SignatureKind | null;
  }
  | { readonly kind: "block"; readonly id: FighterId; readonly by: FighterId | null; readonly weapon: WeaponId }
  | { readonly kind: "stagger"; readonly id: FighterId }
  | { readonly kind: "cancel"; readonly id: FighterId }
  | { readonly kind: "projEnd"; readonly id: string; readonly proj: ProjectileKind; readonly reason: ProjectileEnd }
  /** A player's death is announced by name everywhere ("X was killed"); `at` and `by` only when it happened on screen. */
  | { readonly kind: "death"; readonly id: FighterId; readonly name: string; readonly by: FighterId | null; readonly mob: boolean }
  | { readonly kind: "heal"; readonly id: FighterId; readonly amount: number }
  | { readonly kind: "buff"; readonly id: FighterId; readonly stat: BuffStat; readonly stacks: number; readonly total: number }
  | { readonly kind: "combo"; readonly id: FighterId; readonly combo: ComboId; readonly proc: boolean }
  | { readonly kind: "teleport" }
  | { readonly kind: "bounty"; readonly id: FighterId; readonly name: string; readonly bounty: number }
  | { readonly kind: "victory"; readonly id: FighterId | null; readonly name: string | null; readonly draw: boolean }
  /** A toast addressed to this bot ("Too far away", "Nothing there"...). Not render-delayed. */
  | { readonly kind: "toast"; readonly text: string }
  | { readonly kind: "result"; readonly result: RunResult }
  /** A private server message to this bot (R3 `plan`, R7 `reveal`): never anyone else's. */
  | { readonly kind: "private"; readonly type: string; readonly msg: Readonly<Record<string, unknown>> }
  /** An fx kind this brain does not name (Wishes' cast, castLand, castEnd, status): its fields, copied, same visibility rule. */
  | { readonly kind: "ext"; readonly fx: string; readonly data: Readonly<Record<string, unknown>> }
);
export type ObservedKind = ObservedEvent["kind"];

/** The Wish slot as the weapon bar's cooldown widget shows it (Wishes branch). `def` is shared ABILITIES[ability], opaque here. */
export interface WishView {
  readonly ability: string;
  readonly def: unknown;
  readonly rank: number;
  readonly readyAt: ServerMs;
  readonly casting: boolean;
}

/** Q/E (R6), the same shape. */
export type SkillSlotView = WishView;

/** RaidState.camps[i] as the map and minimap mark it (R5): never more than the UI draws ("?" stays "?"). */
export interface CampView {
  readonly index: number;
  readonly id: string;
  readonly type: string;
  readonly reward: string;
  readonly alive: number;
  /** 0 idle, 1 engaged, 2 cleared. */
  readonly state: number;
}

/** A contested reward chest on screen (R5). Its options only within CHEST_RANGE - 8 u with line of sight, as the panel opens. */
export interface RewardChestView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly expiresAt: ServerMs;
  readonly options: readonly string[] | null;
  readonly takenBy: readonly string[];
  /** This bot already took (or skipped) its pick. */
  readonly picked: boolean;
}

/** A zone, cloud or trail on screen (Wishes FieldState). */
export interface FieldView {
  readonly id: string;
  readonly kind: string;
  readonly ability: string;
  readonly x: number;
  readonly y: number;
  readonly x2: number;
  readonly y2: number;
  readonly r: number;
  readonly owner: FighterId | null;
  readonly endsAt: ServerMs;
}

/** The private planning deal (R3 `plan` message). */
export interface PlanOffer {
  readonly endsAt: ServerMs;
  readonly spawns: readonly [number, number];
  readonly taken: readonly [boolean, boolean];
  readonly boons: readonly [string, string];
}

/** Feature-only fields: each is absent unless its feature is on (and filled only by perception.ts). */
export interface PerceptExtras {
  readonly wish?: WishView;
  readonly skills?: { readonly q: SkillSlotView | null; readonly e: SkillSlotView | null };
  /** EFFECT_* bits of the bot and of every fighter in `fighters`/`mobs`. */
  readonly effects?: Readonly<Record<FighterId, number>>;
  readonly fields?: readonly FieldView[];
  readonly camps?: readonly CampView[];
  readonly chests?: readonly RewardChestView[];
  readonly plan?: PlanOffer;
  /** Camp index -> reward kind, only from a private `reveal` to this bot (Scout, Insight). */
  readonly reveals?: Readonly<Record<number, string>>;
}

/**
 * One frame of perception (perception.ts), plain data copied out of the state: no schema object, no reference into the
 * world. It holds a little more than the window (FRAME_MARGIN) so that compose can centre the window on the newest self.
 */
export interface Frame {
  readonly t: ServerMs;
  readonly self: SelfView;
  readonly hud: HudView;
  readonly fighters: readonly FighterSeen[];
  readonly mobs: readonly MobSeen[];
  readonly containers: readonly ContainerSeen[];
  readonly projectiles: readonly ProjectileView[];
  readonly minimap: MinimapView;
  /** Fx of the steps this frame covers: played in render time, so composed with the world's delay. */
  readonly events: readonly ObservedEvent[];
  /** Toasts, results and private messages: shown at once, so composed with the self delay. */
  readonly immediate: readonly ObservedEvent[];
  readonly extras: PerceptExtras;
}

/** Everything the brain may know about the present. The only input of Brain.tick. */
export interface Percept {
  /** The bot's clock: the newest frame's server time. Clicks are stamped against it. */
  readonly now: ServerMs;
  /** The time the world part shows: now - worldDelayMs (positions interpolated between the two frames around it). */
  readonly viewT: ServerMs;
  /** From the frame at now - selfDelayMs. */
  readonly self: SelfView;
  readonly hud: HudView;
  /** Inside the window around `self` (BOT_VIEW), sampled at viewT. */
  readonly fighters: readonly FighterView[];
  readonly mobs: readonly MobView[];
  readonly containers: readonly ContainerView[];
  readonly projectiles: readonly ProjectileView[];
  readonly minimap: MinimapView;
  /** Since the previous percept: world events up to viewT (window-filtered against `self`) and immediate ones up to now. */
  readonly events: readonly ObservedEvent[];
  readonly extras: PerceptExtras;
  readonly features: Features;
}

/** What perception needs besides the driver's state (the state type itself lives in perception.ts). */
export interface PerceiveContext {
  readonly selfId: FighterId;
  /** generateMap(state.seed): open gates; perception applies withGates itself when the HUD says they are locked. */
  readonly map: GameMap;
  readonly features: Features;
  /** The previous frame's minimap, reused until MINIMAP_REFRESH_MS has passed. */
  readonly lastMinimap: MinimapView | null;
}
export type Perceive<I> = (input: I, ctx: PerceiveContext) => Frame;

export interface ComposeConfig {
  readonly selfDelayMs: number;
  readonly worldDelayMs: number;
  readonly map: GameMap;
  readonly features: Features;
  readonly attentionCentral: number;
}

/** frames.ts: the delay ring. */
export interface FrameRingApi {
  push(frame: Frame): void;
  /** The percept for the newest frame, or null until the ring covers worldDelayMs. Each event is delivered exactly once. */
  compose(cfg: ComposeConfig): Percept | null;
}

// ================================================================================================================== memory

/** Something new in this percept that a human would have to react to. memory.ts finds them; the humanizer times the answer. */
export type StimulusKind =
  | "newThreat" | "foeSwapped" | "incoming" | "windupAtMe" | "drawAtMe" | "hpLoss" | "lowHp" | "lockLost" | "targetDown"
  | "orderFailed" | "clickMissed" | "arrived" | "teleport" | "announcement" | "castSeen" | "chestUp" | "planOffer";

export interface Stimulus {
  readonly kind: StimulusKind;
  /** percept.now of the percept it first appeared in. Reaction time counts from here. */
  readonly at: ServerMs;
  readonly subject: string | null;
  /** Inside the attention centre (an off-screen or HUD stimulus counts as central). */
  readonly central: boolean;
  /** Kind-specific: hp lost, time to impact (ms), bounty... */
  readonly value?: number;
}

export interface FighterMemory {
  readonly id: FighterId;
  name: string;
  bot: boolean;
  faction: FactionId | null;
  /** Every weapon seen in its hand this run; `otherSlot` is the last one seen before a swap (a belief, not a fact). */
  weaponsSeen: WeaponId[];
  inHand: WeaponId | null;
  otherSlot: WeaponId | null;
  seenAt: ServerMs;
  pos: Vec2;
  vel: Vec2;
  hpFrac: number;
  bounty: number;
  alive: boolean;
  diedAt: ServerMs | null;
  hitMeAt: ServerMs | null;
  hitByMeAt: ServerMs | null;
  damageToMe: number;
  damageByMe: number;
  /** Seen trading hits with another fighter (the third-party cue). */
  engagedWith: FighterId | null;
  engagedAt: ServerMs | null;
  chasingMe: boolean;
  /** A Wish cast seen (Wishes fx), and when it is guessed ready again: seen + the cooldown, as a human counts it. */
  wishSeenAt: ServerMs | null;
  wishReadyGuess: ServerMs | null;
  /** Windups it cancelled while facing the bot (feints). */
  feints: number;
  lastFeintAt: ServerMs | null;
}

export interface MobMemory {
  readonly id: FighterId;
  kind: string;
  faction: FactionId | null;
  /** Where its dot first stood (its camp spot), and the map camp that spot belongs to. */
  home: Vec2 | null;
  campId: string | null;
  pos: Vec2;
  /** Last minimap sighting, and last on-screen sighting (the only source of hp). */
  dotAt: ServerMs;
  seenAt: ServerMs | null;
  hpFrac: number;
  inHand: WeaponId | null;
  awake: boolean;
  /** Its hp rose while it was off its spot: walking home, untouchable (mobHunt's MobTracker rule). */
  returning: boolean;
  alive: boolean;
}

export interface CampMemory {
  readonly id: string;
  readonly zone: FactionId;
  readonly elite: boolean;
  /** Living dots last counted on its spots, and when they reached 0. */
  aliveSeen: number;
  clearedAt: ServerMs | null;
  /** Another player seen within its radius. */
  contestedAt: ServerMs | null;
  visitedAt: ServerMs | null;
}

export interface ContainerMemory {
  readonly id: string;
  kind: string;
  pos: Vec2;
  closed: boolean;
  weapon: WeaponId | null | undefined;
  seenAt: ServerMs;
  /** Given up on (a refused or failed pickup). */
  skipped: boolean;
}

export interface SelfMemory {
  lastHitAt: ServerMs | null;
  lastHitByPlayerAt: ServerMs | null;
  lastDealtAt: ServerMs | null;
  /** Damage taken in the last 3 s, and by whom (null: the arena or unseen). */
  recentDamage: number;
  recentHits: ReadonlyArray<{ readonly t: ServerMs; readonly by: FighterId | null; readonly amount: number }>;
  teleportedAt: ServerMs | null;
  /** The last order the driver sent, from Brain's own record (orderFailed / arrived detection). */
  lastOrder: TimedCommand | null;
  /** The last `cast` the driver sent (its click time is `at`): a module that must know when a Wish went out reads it. */
  lastCast?: TimedCommand | null;
  stillSince: ServerMs;
}

export interface MemoryView {
  readonly fighters: ReadonlyMap<FighterId, Readonly<FighterMemory>>;
  readonly mobs: ReadonlyMap<FighterId, Readonly<MobMemory>>;
  readonly camps: ReadonlyMap<string, Readonly<CampMemory>>;
  readonly containers: ReadonlyMap<string, Readonly<ContainerMemory>>;
  readonly self: Readonly<SelfMemory>;
  /** This frame's stimuli. */
  readonly stimuli: readonly Stimulus[];
  /** Bounties announced so far, by fighter. */
  readonly bounties: ReadonlyMap<FighterId, number>;
  readonly choices: readonly ChoiceKey[];
  /**
   * Where a fighter not on screen probably is: its last position, and a radius that grows at 0.6 x PLAYER_SPEED with age;
   * null once memorySpanMs has passed (or it died).
   */
  whereabouts(id: FighterId, now: ServerMs): { readonly at: Vec2; readonly radius: number } | null;
}

export interface MemoryApi {
  /** Folds one percept in and returns what is new in it. */
  observe(p: Percept): readonly Stimulus[];
  noteSent(cmd: TimedCommand): void;
  recordChoice(key: ChoiceKey): void;
  readonly view: MemoryView;
}

// ======================================================================================================= knowledge & odds

/** The counter wheels as this bot knows them (TierParams.knowledge): an edge it does not know reads 0. */
export interface Knowledge {
  factionEdge(a: FactionId, b: FactionId): -1 | 0 | 1;
  weaponEdge(a: WeaponId, b: WeaponId): -1 | 0 | 1;
  /** mobHunt's matchupShare plus this bot's fixed error. */
  mobShare(me: FactionId, region: FactionId, elite: boolean): number;
  /** Who would win a fight with `them` from here, on what the bot knows (strategy and tactics share it). */
  odds(me: SelfView, them: OpponentSnapshot): FightOdds;
}

/** An opponent as seen now (FighterView) or remembered (FighterMemory). */
export interface OpponentSnapshot {
  readonly id: FighterId;
  readonly faction: FactionId | null;
  readonly inHand: WeaponId | null;
  readonly otherSlot: WeaponId | null;
  readonly hpFrac: number;
  readonly bounty: number;
  readonly dist: number;
  /** The UI tint when on screen, else 0. */
  readonly tint: number;
}

export interface FightOdds {
  /** -2..+2: the known matchup score (or the tint's sign) plus 2 x the hp-share lead, clamped. */
  readonly edge: number;
  /** -2..+2: the matchup score alone (what the wheels the bot knows, or the hue it reads, say), without the hp lead. */
  readonly score: number;
  /** Both wheels' edges were known (not just the tint). */
  readonly known: boolean;
  readonly why: string;
}

// ================================================================================================================ services

/** Shared pathfinding behind a per-tick budget (BOT_PATH_BUDGET_PER_TICK across every bot of a room) and a short cache. */
export interface PathService {
  /** The walking distance, or null when there is no path. Over budget: straight line x 1.3, `exact` false. */
  walk(from: Vec2, to: Vec2): { readonly dist: number; readonly exact: boolean } | null;
  path(from: Vec2, to: Vec2): readonly Vec2[] | null;
  /** hasLineOfSight / segmentClear(PLAYER_RADIUS) on the collision map (gates locked per the HUD). */
  los(a: Vec2, b: Vec2): boolean;
  clear(a: Vec2, b: Vec2): boolean;
  collisionMap(): GameMap;
}

export interface BrainServices {
  readonly paths: PathService;
  readonly log: (msg: string) => void;
}

/** Separate seeded streams, so that tuning the hand's noise never reshuffles the choices (variance reduction in tournaments). */
export interface BrainRngs {
  /** Strategy and tactics choices (softmax draws). */
  readonly decide: Rng;
  /** The humanizer's delays and scatter. */
  readonly motor: Rng;
  /** Hesitations and lapses. */
  readonly lapse: Rng;
}

/** What every layer reads in one think. */
export interface BrainContext {
  readonly cfg: BrainConfig;
  readonly p: Percept;
  readonly mem: MemoryView;
  readonly know: Knowledge;
  readonly svc: BrainServices;
  readonly rng: BrainRngs;
  /** The bot is fighting: locked and in reach, or traded a hit within ENGAGE_TRADE_SECONDS. */
  readonly engaged: boolean;
}

// ================================================================================================================ strategy

export type RoamWhy = "explore" | "camp" | "lastSeen" | "coliseum" | "centre";

export type Goal =
  | { readonly kind: "idle" }
  | { readonly kind: "farm"; readonly mob: FighterId; readonly camp: string | null }
  | { readonly kind: "hunt"; readonly target: FighterId }
  /** A fight in progress, whoever opened it. */
  | { readonly kind: "fight"; readonly target: FighterId }
  | { readonly kind: "loot"; readonly container: string }
  | { readonly kind: "flee"; readonly from: readonly Vec2[]; readonly until: ServerMs }
  | { readonly kind: "roam"; readonly to: Vec2; readonly why: RoamWhy }
  | { readonly kind: "hold"; readonly at: Vec2; readonly why: "coliseum" | "ambush" | "wait" }
  /** A feature module's own goal (walk to a reward chest, answer the plan); only that module's act() runs it. */
  | { readonly kind: "module"; readonly module: string; readonly data: Readonly<Record<string, unknown>> };
export type GoalKind = Goal["kind"];

export interface GoalDecision {
  readonly goal: Goal;
  readonly utility: number;
  readonly why: string;
  /** The learning key this decision instantiates, if any (recorded once the goal is taken). */
  readonly choice?: ChoiceKey;
}

export interface GoalStatus {
  readonly state: "running" | "done" | "failed" | "blocked";
  readonly why: string;
}

/**
 * strategy.ts. Called every strategyMs, on a salient stimulus (newThreat, lowHp, teleport, targetDown, announcement,
 * chestUp, planOffer) and whenever the last status is not "running". Keeps `current` unless a candidate beats it by a
 * hysteresis margin; scores with persona weights + learned bias, picks with softmax (TierParams.softmaxT, lapseP).
 */
export interface StrategyLayer {
  decide(ctx: BrainContext, current: Goal, status: GoalStatus): GoalDecision;
}

// ================================================================================================================= tactics

export const PRIORITY = { reflex: 0, combat: 1, goal: 2, chore: 3 } as const;
export type IntentPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

/** How the humanizer times an intent. */
export type IntentTiming =
  /** An answer to a stimulus: reaction (with attention multipliers) from `stimulus.at`. */
  | { readonly kind: "react"; readonly stimulus: Stimulus }
  /** The next step of something already decided: TierParams.step from now. */
  | { readonly kind: "step" }
  /** A rhythm: at `due` +- timingSigmaMs (the re-lock at the cooldown, a juke at a draw's end). */
  | { readonly kind: "timed"; readonly due: ServerMs };

export type IntentBody =
  /** Left-click the fighter drawn at `at` (the humanizer scatters the cursor and resolves it with the client's picker). */
  | { readonly kind: "lock"; readonly target: FighterId; readonly at: Vec2 }
  | { readonly kind: "move"; readonly to: Vec2 }
  | { readonly kind: "stop" }
  | { readonly kind: "swap"; readonly slot: 0 | 1 }
  | { readonly kind: "pickup"; readonly container: string }
  | {
    readonly kind: "cast"; readonly slot: AbilitySlotId; readonly x: number; readonly y: number;
    /** A unit cast: the fighter meant and where it is drawn (resolved like a lock, with the ability's snap radius). */
    readonly target?: FighterId; readonly at?: Vec2; readonly snapRadius?: number;
  }
  | { readonly kind: "plan"; readonly msg: PlanMsg }
  | { readonly kind: "choose"; readonly msg: ChooseMsg };
export type IntentKind = IntentBody["kind"];

export type Intent = IntentBody & {
  readonly priority: IntentPriority;
  readonly timing: IntentTiming;
  readonly why: string;
};

/**
 * The humanizer's channels: one pending intent each, a newer one on the same channel replaces it. lock/move/stop share
 * "order" because the server replaces them with each other too (ClientMessages).
 */
export type IntentChannel = "order" | "swap" | "pickup" | "cast" | "menu";

export interface TacticsOutput {
  /** At most one per channel; the humanizer dedupes an intent equal to one already pending or just sent. */
  readonly intents: readonly Intent[];
  readonly status: GoalStatus;
  /** Locked on its target, in reach and in sight: the server is attacking for it (the stall watch's "busy"). */
  readonly attacking: boolean;
}

/** tactics.ts: executes one goal. Stateless across goals except its own kite, dodge and orbit timers. */
export interface TacticsLayer {
  act(ctx: BrainContext, goal: Goal): TacticsOutput;
}

// ================================================================================================================ commands

export type CoreCommandType = "move" | "stop" | "target" | "swap" | "pickup";
/** Exactly the game client's messages. Never aim, attack or release: the game client sends none of those for a fight either. */
export type CoreCommand = { [K in CoreCommandType]: { readonly type: K; readonly msg: ClientMessages[K] } }[CoreCommandType];

/** Messages that exist on other branches (Wishes `cast`, R3 `plan`, R5 `choose`), mirrored from their contracts. */
export interface CastMsg { readonly slot: AbilitySlotId; readonly x: number; readonly y: number; readonly id?: string; readonly seq?: number }
export interface PlanMsg { readonly spawn?: 0 | 1; readonly boon?: 0 | 1; readonly ready?: boolean }
export interface ChooseMsg { readonly chest: string; readonly pick: number; readonly replace?: 0 | 1 }
export type ExtCommand =
  | { readonly type: "cast"; readonly msg: CastMsg }
  | { readonly type: "plan"; readonly msg: PlanMsg }
  | { readonly type: "choose"; readonly msg: ChooseMsg };

export type Command = CoreCommand | ExtCommand;
export type CommandType = Command["type"];

export interface TimedCommand {
  /** When the bot clicked (server ms, at or before the percept that released it). The in-process driver adds the uplink. */
  readonly at: ServerMs;
  readonly cmd: Command;
  readonly intent: IntentKind;
  readonly priority: IntentPriority;
  /** The stimulus it answers (stats: reaction samples), or null for a step or a timed intent. */
  readonly stimulus: Stimulus | null;
}

export interface HumanizerStats {
  readonly commands: Readonly<Record<CommandType, number>>;
  /** Stimulus -> click delays (ms), the last 256 per kind. */
  readonly reactions: Readonly<Partial<Record<StimulusKind, readonly number[]>>>;
  readonly targetClicks: number;
  /** Lock clicks that picked nobody (nothing sent) or the wrong fighter. */
  readonly clickMissed: number;
  readonly clickWrong: number;
  readonly hesitations: number;
  readonly lapses: number;
  /** Intents dropped for want of a token or overtaken on their channel. */
  readonly throttled: number;
  readonly superseded: number;
  /** Most commands in any 60 s window. */
  readonly apmPeak: number;
}

/** humanizer.ts: intents in, timed and noisy commands out. The only layer that draws from `rng.motor`. */
export interface Humanizer {
  submit(intents: readonly Intent[], ctx: BrainContext): void;
  /** Commands whose click time has come by ctx.p.now, in click order. */
  release(ctx: BrainContext): readonly TimedCommand[];
  /**
   * Lock clicks that picked nobody since the last call (a miss sends nothing, so no command carries it). The brain turns each
   * into a `clickMissed` stimulus so tactics clicks again after a reaction.
   */
  drainMisses(): readonly { readonly target: FighterId; readonly at: ServerMs }[];
  readonly stats: HumanizerStats;
}

// ======================================================================================================== feature modules

/**
 * A capability the game may or may not have yet (Wishes, planning, chests, skills, relics, hazards). Disabled modules are
 * never called. A module never imports a symbol that may not exist on this branch: it reads runtime values off Features,
 * PerceptExtras and `ext` events, and its policy is injected (registerCastPolicy).
 */
export interface FeatureModule {
  readonly id: string;
  enabled(features: Features): boolean;
  observe?(ctx: BrainContext): void;
  /** Extra goal candidates for the strategy, scored with the rest. */
  goals?(ctx: BrainContext): readonly GoalDecision[];
  /** Extra intents merged into tactics' output (a cast on the goal's target, a skip of a chest). */
  intents?(ctx: BrainContext, goal: Goal): readonly Intent[];
  /** Executes its own `module` goals. */
  act?(ctx: BrainContext, goal: Extract<Goal, { kind: "module" }>): TacticsOutput;
}

/** Mirror of the Wishes contract section 6 `CastSituation` (bots/abilityPolicy.ts there). */
export interface CastSituation {
  readonly me: { readonly x: number; readonly y: number; readonly hpFrac: number; readonly effects: number; readonly recentlyHit: boolean };
  readonly foe: {
    readonly id: string; readonly x: number; readonly y: number; readonly d: number; readonly los: boolean; readonly targetable: boolean;
  } | null;
  readonly threat: { readonly x: number; readonly y: number; readonly d: number; readonly chasing: boolean } | null;
  readonly map: GameMap;
  readonly gatesLocked: boolean;
}
export type CastTarget = { readonly x: number; readonly y: number; readonly id?: string } | null;
/**
 * `decideCast(def, rank, situation)` of the Wishes branch, behind an opaque def: modules/wishesAdapter.ts registers it with
 * `(def, rank, s) => decideCast(def as AbilityDef, rank, s)` once that branch is merged.
 */
export type CastPolicy = (def: unknown, rank: number, s: CastSituation) => CastTarget;

// ================================================================================================================ learning

export type ChoiceDomain = "faction" | "opener" | "second" | "spawn" | "boon" | "skill" | "relic" | "camp";
/** `domain|context|option`, e.g. "faction|hunter|fire", "second|frost|bow", "opener|plague|holy". */
export type ChoiceKey = `${ChoiceDomain}|${string}|${string}`;

/** A read-only snapshot of the stats file, taken when the bot joins. */
export interface LearnedBias {
  readonly enabled: boolean;
  /** -LEARN.cap..+LEARN.cap; 0 for an unknown key. Strategy adds LEARN.weight x this to the option's utility. */
  bias(key: ChoiceKey): number;
}

export interface RunSummary {
  readonly tier: TierId;
  readonly persona: PersonaId;
  readonly faction: FactionId | null;
  /** "void": the run never resolved for it (the room closed): recorded nowhere. */
  readonly outcome: RunOutcome | "void";
  readonly place: number;
  readonly players: number;
  readonly choices: readonly ChoiceKey[];
}

/** bots/learning/BotStatsStore.ts. Not ProfileStore, not its file, not its module. */
export interface BotStatsStoreApi {
  snapshot(): LearnedBias;
  record(summary: RunSummary): void;
  flush(): void;
  close(): void;
}

/** Smoothing (docs/BOTS.md 6.2): prior mean, its weight in pseudo-runs, decay per update, bias cap and weight, file bounds. */
export const LEARN = {
  version: 1,
  prior: 0.5,
  strength: 8,
  decay: 0.99,
  cap: 0.25,
  weight: 0.3,
  explore: 0.05,
  maxEntries: 2000,
  writeEveryMs: 10_000,
} as const;

// =================================================================================================================== brain

export interface BrainConfig {
  readonly id: FighterId;
  readonly name: string;
  readonly tier: TierParams;
  readonly persona: PersonaParams;
  readonly seed: number;
  /** generateMap(state.seed), open gates. */
  readonly map: GameMap;
  readonly features: Features;
  readonly learned: LearnedBias;
  readonly services: BrainServices;
  readonly modules: readonly FeatureModule[];
}

export interface BrainStats extends HumanizerStats {
  // BotClient.stats as the e2e reads it today.
  readonly mobTargets: number;
  readonly mobDrops: number;
  readonly retreats: number;
  readonly mobFocusMs: number;
  readonly grabs: number;
  /** Longest stretch alive in a running raid standing still, not attacking, drawing or fetching (the e2e bounds it). */
  readonly maxStallMs: number;
  readonly dodges: number;
  readonly jukes: number;
  readonly kiteCycles: number;
  readonly goals: Readonly<Partial<Record<GoalKind, number>>>;
}

/** brain.ts: memory -> strategy -> tactics (+ modules) -> humanizer, once per percept. */
export interface Brain {
  readonly id: FighterId;
  /** One percept per frame; returns the commands clicked by p.now. */
  tick(p: Percept): readonly TimedCommand[];
  /** The run is over (result null: voided). What the learning store records. */
  end(result: RunResult | null): RunSummary;
  readonly goal: Goal;
  readonly stats: BrainStats;
}
export type BrainFactory = (cfg: BrainConfig) => Brain;

// ================================================================================================================= drivers

/** How a BotRunner reaches the room: BotManager (in-process) or BotClient (network). */
export interface BotAdapter {
  readonly selfId: FighterId;
  /** Features.messageTypes includes it. */
  supports(type: CommandType): boolean;
  /**
   * Issues `cmd`, clicked at `at`. In-process: queued to arrive at max(previous arrival, at + latency + jitter) and handed to
   * enqueueClientMessage before the first step at or after that. Network: room.send now. False when refused locally (an
   * unsupported type, the 100 msg/s guard).
   */
  send(cmd: Command, at: ServerMs): boolean;
}

export interface RunnerConfig {
  /** In-process: the simulated downlink (BotFillConfig.latencyMs); network: 0 (the socket is the delay). */
  readonly selfDelayMs: number;
  /** INTERP_DELAY_MS + selfDelayMs. */
  readonly worldDelayMs: number;
}

/** brain/runner.ts: the driver-agnostic glue. A driver builds its own input `I` (perception.ts PerceptionInput) per frame. */
export interface BotRunnerApi<I> {
  /** perceive -> ring -> compose -> brain.tick -> adapter.send. Returns what was sent (tests). */
  frame(input: I): readonly TimedCommand[];
  end(result: RunResult | null): RunSummary;
  readonly brain: Brain;
}

// ============================================================================================================ lobby fill

/** Ids of server-filled bots: "~" never appears in a Colyseus session id, so the two can never collide. */
export const BOT_ID_PREFIX = "bot~";
/** findPath calls all the bots of one room may make per tick (about 0.1 ms each on a 64x64 map, docs/BOTS.md 1). */
export const BOT_PATH_BUDGET_PER_TICK = 8;

/** config.ts `bots` (env names in docs/BOTS.md 7.3). */
export interface BotFillConfig {
  /** Top an arena lobby up to this many players at the countdown's end; 0 = no fill bots. */
  readonly fillTo: number;
  /** Bots start arriving this long before the countdown ends. */
  readonly arrivalSeconds: number;
  readonly tierMix: Readonly<Record<TierId, number>>;
  readonly personaMix: Readonly<Record<PersonaId, number>>;
  /** Simulated one-way latency and its jitter (ms), each way. */
  readonly latencyMs: number;
  readonly jitterMs: number;
  /** The learning file; null = next to the profile file as bot-stats.json; "" = learning off. */
  readonly statsFile: string | null;
  /** Fixed seed for the bots' streams (tests, tournaments); null = crypto random per room. */
  readonly seed: number | null;
}

export const BOT_FILL_DEFAULTS: BotFillConfig = {
  fillTo: 6,
  arrivalSeconds: 12,
  tierMix: { easy: 0.3, normal: 0.45, hard: 0.25 },
  personaMix: { farmer: 1, hunter: 1, opportunist: 1, cautious: 1 },
  latencyMs: 30,
  jitterMs: 8,
  statsFile: null,
  seed: null,
};

/** One fill bot as BotManager creates it. */
export interface BotSeatSpec {
  readonly id: FighterId;
  readonly name: string;
  readonly tier: TierId;
  readonly persona: PersonaId;
  readonly faction: FactionId;
  readonly seed: number;
}
