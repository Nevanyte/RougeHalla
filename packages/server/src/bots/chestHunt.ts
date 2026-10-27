// What a headless bot does about a cleared camp's shared chest (ROGUELIKE_PLAN R5: D1-D3, CHEST_* in shared/constants.ts).
// Pure, like mobHunt.ts: it reads a snapshot (the bot, the reward containers in the state, the clock) and answers "pick now",
// "walk to this chest" or "nothing". BotClient executes the answer: one `choose` message, or a `move`. Nothing here touches a
// socket or a clock of its own.
//
// The rules:
//   1. A chest within pickRange (CHEST_RANGE less CHEST_PANEL_SLACK, as the client's panel does) with a line of sight and some
//      life left gets the bot's one pick at once, whatever else it is doing: a `choose` moves nobody and costs the fight nothing.
//      The pick is the best free option the bot can use (chooseOption), else a skip (-1).
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
  CHEST_PANEL_SLACK, CHEST_RANGE, nextRank, PLAYER_SPEED, skillDef, skillRows, TILE,
  type BuildRanks, type Effect, type SkillDef, type Vec2, type WeaponId,
} from "@raid/shared";

/** The part of a state.containers entry the hunt reads: a kind "reward" container (ContainerState). */
export interface ChestLike {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Server time (ms, the clock of `state.serverTime`) it vanishes. */
  expiresAt: number;
  /** SkillIds in card order, and who took each ("" = free), and everyone who has made their pick or skipped. */
  options: Iterable<string>;
  takenBy: Iterable<string>;
  pickers: Iterable<string>;
}

export interface ChestHuntConfig {
  /** A pick is sent from within this distance (u) of the chest: inside the server's CHEST_RANGE, since what the bot sees is a patch old. */
  pickRange: number;
  /** ...with at least this much of the chest's life left (ms): the message takes a trip and is applied on the next tick. */
  pickMarginMs: number;
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
  /** The skills it holds (PlayerState.build): a pick of one at the top rank is not possible. */
  build: BuildRanks | null;
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

/** The effect rows' worth to a fighter, in points: damage, attack speed and hp are what a duel is made of. */
function rowScore(e: Effect): number {
  switch (e.k) {
    case "stat":
      return e.stat === "damage" || e.stat === "attackSpeed" || e.stat === "maxHp" || e.stat === "executeBand" ? 3 : 1;
    case "flat": return 1.5;
    case "trigger": return 2;
    default: return 1.5;
  }
}

/** Does a skill suit what the bot carries? A skill that names only weapons (Quickdraw's bow and axe: its wand floor is the wand's whole windup) and none is held does not. */
function fits(def: SkillDef, weapons: readonly (WeaponId | null)[]): boolean {
  const named = def.worksWith as readonly string[];
  const only = named.filter((t) => t === "sword" || t === "bow" || t === "wand" || t === "shield" || t === "axe");
  if (only.length === 0 || only.length < named.length) return true; // it names no weapon, or something broader as well
  return only.some((t) => weapons.includes(t as WeaponId));
}

/**
 * How much a free option is worth to this bot (higher is better): the skill's own zone is its faction's pool (+4), what its
 * rows do for a fight (damage, attack speed and max hp most), a rank 2 upgrade a little, and a skill that needs a weapon the bot
 * does not hold is held back. An id the catalog does not know (newer server content) scores 0: still takeable.
 */
export function optionScore(id: string, self: Pick<ChestSelf, "faction" | "weapons" | "build">): number {
  const def = skillDef(id);
  const next = nextRank(self.build, id);
  if (!def || next === null) return 0;
  let score = def.pool === self.faction ? 4 : 0;
  for (const row of skillRows(id, next, self.faction)) score += rowScore(row);
  if (next === 2) score += 0.5;
  if (!fits(def, self.weapons)) score -= 3;
  return score;
}

/**
 * The index of the option to take: the best-scoring free one the bot can use (not taken by someone, not held at the top rank),
 * the first of equals; -1 when there is none (skip).
 */
export function chooseOption(
  options: Iterable<string>, takenBy: Iterable<string>, self: Pick<ChestSelf, "faction" | "weapons" | "build">,
): number {
  const ids = [...options];
  const taken = [...takenBy];
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    if ((taken[i] ?? "") !== "") continue;
    if (nextRank(self.build, ids[i]!) === null) continue;
    const score = optionScore(ids[i]!, self);
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

    // 1. In range with sight and time: pick now (a skip when nothing is usable).
    for (const u of up) {
      if (u.d > c.pickRange || u.left <= c.pickMarginMs || !inp.sight(u.chest)) continue;
      // The contents are read here and nowhere else: this is the distance at which a player's panel shows them.
      const option = chooseOption(u.chest.options, u.chest.takenBy, self);
      this.markDone(u.chest.id);
      this.walking = null;
      return {
        kind: "pick", chest: u.chest.id, option,
        why: option >= 0 ? `taking option ${option} (${[...u.chest.options][option]})` : "nothing usable: skipping",
      };
    }

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
