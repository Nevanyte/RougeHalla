// What a headless bot does about a cleared camp's shared chest (ROGUELIKE_PLAN R5: D1-D3, CHEST_* in shared/constants.ts; the cards
// of the balance pass, BALANCE_CONTRACT 9: `cardScore` is the chooser, the persona's `risk` decides what it will give up for power).
// Pure, like mobHunt.ts: it reads a snapshot (the bot, the reward containers in the state, the clock) and answers "pick now",
// "walk to this chest" or "nothing". BotClient executes the answer: one `choose` message, or a `move`. Nothing here touches a
// socket or a clock of its own.
//
// The rules:
//   1. A chest within pickRange (CHEST_RANGE less CHEST_PANEL_SLACK, as the client's panel does) with a line of sight and some
//      life left gets the bot's one pick at once, whatever else it is doing: a `choose` moves nobody and costs the fight nothing.
//      The pick is the best free option the bot can use (chooseOption), else a skip (-1). Not in the chest's first holdMs: the
//      server refuses a pick on a chest born in a ledger pass until the second tick after it (holdBirth, sim/loot.ts), and the
//      one try must not be spent on that. The age is read off the chest itself (CHEST_SECONDS less its time left), so a chest
//      first seen old (a bot that was busy elsewhere) is picked at once; a young one in reach is simply waited for (a few
//      thinks, nothing else started) and its options are not read yet.
//   2. Otherwise the bot walks to the nearest live chest that it can reach in time (the walk at most pace x speed, plus
//      arriveSlackMs, inside the chest's remaining life). In a fight, or with an awake mob close, only a chest within fightWalk
//      is worth leaving it for; running away at low hp walks to no chest. Like a player, the bot decides the walk from what it
//      sees of a chest from afar (where it is, how long it has left, whether it has picked there): the options and who took
//      them are read only once the chest is within pickRange, where the panel shows them (D17). A trip can end in a skip.
//   3. A chest is tried ONCE: asking for it (or a pick the state shows we already made) puts it in `done`, and a refused pick is
//      never repeated. A walk that stops closing in is given up on, so a chest behind a bad path never holds the bot: the
//      record is kept per chest and counts only the time spent walking to it, so a fight that interrupts the walk (and starts
//      it again a moment later) neither resets the count nor adds to it.
//   4. A chest that has expired, or is gone from the state, is simply not in the input any more.
import {
  CHEST_PANEL_SLACK, CHEST_RANGE, CHEST_SECONDS, cardBlock, cardDef, ownsBase, PLAYER_SPEED, TICK_MS, TILE,
  type CardCounts, type CardDef, type Vec2, type WeaponId,
} from "@raid/shared";

/** The part of a state.containers entry the hunt reads: a kind "reward" container (ContainerState). */
export interface ChestLike {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Server time (ms, the clock of `state.serverTime`) it vanishes. */
  expiresAt: number;
  /** Card ids in card order, and who took each ("" = free), and everyone who has made their pick or skipped. */
  options: Iterable<string>;
  takenBy: Iterable<string>;
  pickers: Iterable<string>;
}

export interface ChestHuntConfig {
  /** A pick is sent from within this distance (u) of the chest: inside the server's CHEST_RANGE, since what the bot sees is a patch old. */
  pickRange: number;
  /** ...with at least this much of the chest's life left (ms): the message takes a trip and is applied on the next tick. */
  pickMarginMs: number;
  /**
   * ...and not before the chest is this old (ms, by its own clock: CHEST_SECONDS less its time left). The server holds a chest
   * born in a ledger pass (every camp's) for two ticks after the one that made it ("Chest gone"); a pick sent before that is
   * refused and the bot's one try is gone. One tick more than the hold, for a message that overtakes its patch.
   */
  holdMs: number;
  /** A walk is started only if it arrives with this much (ms) of the chest's life to spare... */
  arriveSlackMs: number;
  /** ...counting the walk at this share of PLAYER_SPEED (a path is not a straight line). */
  paceShare: number;
  /** In a fight, or with an awake mob close, only a chest this near (walking distance, u) is worth leaving it for. */
  fightWalk: number;
  /** A walk that has not got `stallProgress` (u) closer after this much walking (ms) is given up on. */
  stallMs: number;
  stallProgress: number;
  /** One think counts for at most this long (ms) in the stall record: a long gap between thinks is not walking time. */
  stallStepMaxMs: number;
  /** Walking distances are computed for this many of the nearest chests only, and kept this long (ms). */
  maxCandidates: number;
  walkCacheMs: number;
}

export const CHEST_HUNT: Readonly<ChestHuntConfig> = {
  pickRange: CHEST_RANGE - CHEST_PANEL_SLACK,
  pickMarginMs: 350,
  holdMs: 3 * TICK_MS,
  arriveSlackMs: 1000,
  paceShare: 0.85,
  fightWalk: 12 * TILE,
  stallMs: 3000,
  stallProgress: 24,
  stallStepMaxMs: 500,
  maxCandidates: 3,
  walkCacheMs: 250,
};

/** What the chest step reads about the bot itself. */
export interface ChestSelf {
  /** The bot's id in the room (what `pickers` and `takenBy` name). */
  id: string;
  x: number;
  y: number;
  /** The bot's faction, or "" when unknown. */
  faction: string;
  /** The carried weapons (both slots; null = empty). */
  weapons: readonly (WeaponId | null)[];
  /** The slot in hand (0 or 1; default 0): an empty hand fights with fists. */
  slot?: 0 | 1;
  /** The persona's risk (0..1, PersonaParams.risk; default 0.5): how much it will give up for power. See cardScore. */
  risk?: number;
  /** The cards it holds (PlayerState.build, id -> count): a conditional without its base, or a unique card already held, cannot be picked. */
  build: CardCounts | null;
}

export interface ChestInput {
  /** Any steadily rising clock in ms (the walk cache and the stall watch). */
  now: number;
  /** `state.serverTime`: the clock the chests' `expiresAt` is on. */
  serverTime: number;
  self: ChestSelf;
  /** The reward containers in the state (other kinds are ignored). */
  chests: Iterable<ChestLike>;
  /** Walking distance from the bot to a point, or null when there is no path. */
  walk: (to: Vec2) => number | null;
  /** The bot can see the point (a straight line clear of walls). */
  sight: (to: Vec2) => boolean;
  /** In a fight, or an awake mob is close: walk only for a near chest. */
  fighting: boolean;
  /** Running away at low hp: walk to no chest (a pick in range is still free). */
  retreating: boolean;
  /** After the teleport the gates are locked and every chest is gone. */
  inColiseum: boolean;
}

export type ChestDecision =
  /** Send `choose { chest, pick: option }` now (option -1 = skip). The chest counts as tried. */
  | { kind: "pick"; chest: string; option: number; why: string }
  /** Walk to the chest. */
  | { kind: "walk"; chest: string; to: Vec2; why: string }
  | { kind: "none" };

const NONE: ChestDecision = { kind: "none" };
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Weapons whose hits scale with attack damage (AD) and those that scale with ability power (AP): shared WeaponSpec.scaling. */
const AD_WEAPONS: readonly WeaponId[] = ["sword", "axe", "bow"];
const MELEE_WEAPONS: readonly WeaponId[] = ["sword", "axe", "shield", "fists"];
/** The factions whose signature is a damage over time: AP feeds it whatever the weapon (AP_DOT_RATIO). */
const DOT_FACTIONS: readonly string[] = ["fire", "sentenced", "plague"];

/** The two augments that can end their owner (a x2.5 damage taken at low health; a quarter of the health gone): only a bold persona takes them. */
const DANGEROUS: readonly string[] = ["raceToZero", "glassCannon"];
/** A persona takes a card that gives something up from this risk, and a dangerous one only above DANGER_RISK. */
export const TRADEOFF_RISK = 0.5;
export const DANGER_RISK = 0.7;

/** The rule switches that are a price (the other flags only turn a hook on): Committed locks the second slot, Thick Skull forbids crits, Gambler gambles. */
const COST_FLAGS: ReadonlySet<string> = new Set(["lockSecondSlot", "noCrit", "gambler"]);
/** The stats for which a smaller number is the better one (a shorter windup, less damage taken, a shorter cooldown). */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(["windup", "damageTaken", "cooldown"]);

/**
 * Does the card give up something for its power (a stat row that hurts, a multiplier under 1, a rule that costs, or a multiplier that
 * hurts: a doubled Wish cooldown, the damage a Race to 0 takes)? Such a card needs a persona with risk to take it.
 */
export function costsSomething(def: CardDef): boolean {
  return def.effects.some((e) => {
    switch (e.k) {
      case "stat": return LOWER_IS_BETTER.has(e.stat) ? e.v > 0 : e.v < 0;
      case "mult": return e.v < 1 || e.key === "wishCooldown" || e.key === "hpRace";
      case "flag": return COST_FLAGS.has(e.flag);
      default: return false;
    }
  });
}

/** The weapon the bot fights with now: the slot in hand, fists for an empty one. */
export function activeWeapon(self: Pick<ChestSelf, "weapons" | "slot">): WeaponId {
  return self.weapons[self.slot ?? 0] ?? "fists";
}

/**
 * How well a base stat suits the weapon in hand (BALANCE_CONTRACT 9): AD on a weapon that scales with it, AP on a wand, armor and magic
 * resist on a shield, the fists a hybrid (half of both); AP is also worth something to a faction whose signature is a damage over time.
 */
function baseFit(base: string, weapon: WeaponId, faction: string): number {
  switch (base) {
    case "ad": return AD_WEAPONS.includes(weapon) ? 1 : weapon === "fists" ? 0.5 : weapon === "wand" ? -0.5 : -1;
    case "ap": return weapon === "wand" ? 1 : weapon === "fists" ? 0.5 : DOT_FACTIONS.includes(faction) ? 0 : -1;
    case "armor":
    case "mr": return weapon === "shield" ? 1 : 0;
    // Fleet is off while shooting: the ranged weapons get little from it.
    case "fleet": return weapon === "bow" || weapon === "wand" ? -0.5 : 0;
    default: return 0;
  }
}

/** How well an augment or conditional suits the weapon in hand and the faction, from what the card is about (its tags and a few rules). */
function ruleFit(def: CardDef, weapon: WeaponId, faction: string, carried: number): number {
  let fit = 0;
  for (const tag of def.tags) {
    if (tag === "physical") fit += AD_WEAPONS.includes(weapon) ? 0.5 : weapon === "wand" ? -0.5 : 0;
    else if (tag === "magic") fit += weapon === "wand" ? 0.5 : weapon === "fists" ? 0.25 : -0.25;
    else if (tag === "block") fit += weapon === "shield" ? 1 : -1;
    else if (tag === "ramping") fit += faction === "sentenced" ? 1 : -2; // only the mark ramps
    else if (tag === "slow") fit += faction === "frost" ? 1 : 0;
  }
  if (def.id === "fistsOfFury") fit += weapon === "fists" ? 2 : -3; // it does nothing once the bot is armed
  if (def.id === "quickdraw") fit += MELEE_WEAPONS.includes(weapon) ? 1 : -1; // melee windups only
  if (def.id === "committed" && carried > 1) fit -= 2; // it locks the second slot the bot is using
  return fit;
}

/**
 * How much a free option is worth to this bot (higher is better; BALANCE_CONTRACT 9):
 *   base         a stat it already owns +3 (deepen), a new one +1.5, plus its tier and how well the stat suits the weapon in hand
 *   conditional  its base is owned (or the pick is refused): +4 and its tier, plus the fit of its tags
 *   augment      its tier plus 1 to 3 by the persona's risk (1 + 2 x risk) and the fit of its tags; a card that gives something up
 *                is refused below risk 0.5, and A Race to 0 and Glass Cannon at or below 0.7
 * A card it cannot take (a conditional without its base, a unique card it holds) scores -Infinity, and an id the catalog does not
 * know (newer server content) scores 0: still takeable.
 */
export function cardScore(id: string, self: Pick<ChestSelf, "faction" | "weapons" | "build" | "slot" | "risk">): number {
  const def = cardDef(id);
  if (!def) return 0;
  if (cardBlock(id, self.build)) return -Infinity;
  const weapon = activeWeapon(self);
  const risk = self.risk ?? 0.5;
  const carried = self.weapons.filter((w) => w !== null).length;
  switch (def.kind) {
    case "base": return (ownsBase(self.build, def.base!) ? 3 : 1.5) + def.tier + baseFit(def.base!, weapon, self.faction);
    case "conditional": return 4 + def.tier + ruleFit(def, weapon, self.faction, carried);
    case "augment": {
      if (DANGEROUS.includes(def.id) && !(risk > DANGER_RISK)) return -Infinity;
      if (costsSomething(def) && risk < TRADEOFF_RISK) return -Infinity;
      return def.tier + 1 + 2 * Math.min(1, Math.max(0, risk)) + ruleFit(def, weapon, self.faction, carried);
    }
  }
}

/** The name the first version gave it. */
export const optionScore = cardScore;

/**
 * The index of the option to take: the best-scoring free one the bot can use (not taken by someone, not refused to it by its build),
 * the first of equals; -1 when there is none (skip).
 */
export function chooseOption(
  options: Iterable<string>, takenBy: Iterable<string>, self: Pick<ChestSelf, "faction" | "weapons" | "build" | "slot" | "risk">,
): number {
  const ids = [...options];
  const taken = [...takenBy];
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    if ((taken[i] ?? "") !== "") continue;
    const score = cardScore(ids[i]!, self);
    if (score === -Infinity) continue;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

export interface ChestHuntStats {
  /** Walks begun on a chest (one per chest, however long it is). */
  walks: number;
  /** Chests given up on: a walk that stopped closing in. */
  gaveUp: number;
}

export class ChestHunter {
  readonly stats: ChestHuntStats = { walks: 0, gaveUp: 0 };
  /** Chests a pick was asked for, or that we have already picked at, or gave up on: never looked at again. */
  private readonly done = new Set<string>();
  /** The chest the last think walked to, and when: the next think adds the time between to that chest's stall record. */
  private walking: { id: string; at: number } | null = null;
  /** Per chest, not per walk: how close the bot has got and how long it has walked to it since it last got closer. */
  private readonly stalls = new Map<string, { best: number; walkedMs: number }>();
  private readonly walks = new Map<string, { at: number; len: number | null }>();

  /** `log` hears each pick and each give-up (BotClient prints them with --verbose). */
  constructor(readonly cfg: Readonly<ChestHuntConfig> = CHEST_HUNT, private readonly log: (msg: string) => void = () => {}) {}

  /** Has a pick been asked for (or the chest given up on)? */
  tried(id: string): boolean {
    return this.done.has(id);
  }

  /** The chest the bot is walking to, if any. */
  get target(): string | null {
    return this.walking?.id ?? null;
  }

  /** The pick for a chest is final: asked once, and never again whether the server took it or not. */
  markDone(id: string): void {
    this.done.add(id);
    this.walks.delete(id);
    this.stalls.delete(id);
    if (this.walking?.id === id) this.walking = null;
  }

  decide(inp: ChestInput): ChestDecision {
    const c = this.cfg;
    const { now, serverTime, self } = inp;
    if (inp.inColiseum) { this.walking = null; return NONE; }

    // The chests that are up, that we have not picked at, and their distance.
    const up: { chest: ChestLike; d: number; left: number }[] = [];
    for (const chest of inp.chests) {
      if (chest.kind !== "reward" || this.done.has(chest.id)) continue;
      if ([...chest.pickers].includes(self.id)) { this.markDone(chest.id); continue; } // we made our pick already
      const left = chest.expiresAt - serverTime;
      if (left <= 0) continue;
      up.push({ chest, d: dist(self, chest), left });
    }
    up.sort((a, b) => a.d - b.d || (a.chest.id < b.chest.id ? -1 : 1));
    // A record for a chest that is no longer up (expired, gone) is not needed any more.
    for (const id of this.stalls.keys()) if (!up.some((u) => u.chest.id === id)) this.stalls.delete(id);

    // 1. In range with sight and time: pick now (a skip when nothing is usable), once the chest is out of its birth hold.
    let held = false;
    for (const u of up) {
      if (u.d > c.pickRange || u.left <= c.pickMarginMs || !inp.sight(u.chest)) continue;
      if (CHEST_SECONDS * 1000 - u.left < c.holdMs) { held = true; continue; } // too young: not read, not tried, not walked to
      // The contents are read here and nowhere else: this is the distance at which a player's panel shows them.
      const option = chooseOption(u.chest.options, u.chest.takenBy, self);
      this.markDone(u.chest.id);
      this.walking = null;
      return {
        kind: "pick", chest: u.chest.id, option,
        why: option >= 0 ? `taking option ${option} (${[...u.chest.options][option]})` : "nothing usable: skipping",
      };
    }

    // A chest in reach that is still in its birth hold is waited for (a few ticks): walking off to another would only come back.
    if (held) { this.walking = null; return NONE; }

    // 2. Walk to the nearest chest worth the trip.
    if (inp.retreating) { this.walking = null; return NONE; }
    let best: { chest: ChestLike; len: number } | null = null;
    for (const u of up.slice(0, c.maxCandidates)) {
      const len = this.walkLength(u.chest, inp);
      if (len === null) continue;
      if (inp.fighting && len > c.fightWalk) continue;
      const etaMs = (Math.max(0, len - c.pickRange) / (PLAYER_SPEED * c.paceShare)) * 1000;
      if (etaMs + c.arriveSlackMs > u.left) continue; // it would be gone before we got there
      if (!best || len < best.len) best = { chest: u.chest, len };
    }
    if (!best) { this.walking = null; return NONE; }

    // 3. The walk must keep closing in. The record belongs to the chest: stopping the walk for a fight and taking it up again
    // keeps what it had (only the time spent walking to this chest counts, never the time away from it).
    const id = best.chest.id;
    const d = dist(self, best.chest);
    const last = this.walking;
    let st = this.stalls.get(id);
    if (!st) {
      st = { best: d, walkedMs: 0 };
      this.stalls.set(id, st);
      this.stats.walks++;
      this.log(`going for chest ${id} (${Math.round(best.len)} u of walking)`);
    } else {
      if (last?.id === id) st.walkedMs += Math.min(Math.max(0, now - last.at), c.stallStepMaxMs);
      if (d < st.best - c.stallProgress) {
        st.best = d;
        st.walkedMs = 0;
      } else if (st.walkedMs >= c.stallMs) {
        this.log(`giving up on chest ${id}: not getting any closer`);
        this.stats.gaveUp++;
        this.markDone(id);
        return NONE;
      }
    }
    this.walking = { id, at: now };
    return { kind: "walk", chest: id, to: { x: best.chest.x, y: best.chest.y }, why: `chest ${id}` };
  }

  /** The walking distance to a chest, recomputed no more often than walkCacheMs: a path search is the dear part of a think. */
  private walkLength(chest: ChestLike, inp: ChestInput): number | null {
    const hit = this.walks.get(chest.id);
    if (hit && inp.now - hit.at < this.cfg.walkCacheMs) return hit.len;
    const len = inp.walk(chest);
    this.walks.set(chest.id, { at: inp.now, len });
    return len;
  }
}
