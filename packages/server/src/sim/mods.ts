// Stat mods: folds a fighter's effect rows into its stats, writes the ones a client needs as the quantized stat mirrors
// (PlayerState asMult, windupMult, speedMult, armorBonus, shieldBonus, adBonus, apBonus; ROGUELIKE_PLAN 3.8), and is the one place the sim
// reads them back. The sim never uses a mirrored stat's unencoded double: it reads the decoded mirror (shared/mods.ts),
// which is what every client decodes too (D22).
//
// A player's rows are its cards' rows (PlayerState.build: each live card's rows, shared/cards.ts cardRows, once per copy held,
// with the faction's own rows where the card has some), kept here per player and rebuilt only when the build changes. Rows of
// several cards fold together: a damage row of any adds to the one damage sum, and so on for every key. (A kill gives no stat:
// the per-kill buffs went with the balance pass, BALANCE_CONTRACT 3.6.)
//   stat, flat   fold into one sum per stat key (shared/mods.ts StatSums): rows add within a key, keys multiply where the
//                sim combines them (1 + sum each). Mirrored keys go to the mirrors; the rest are read here: maxHp
//                (sim/buffs.ts syncMaxHp), damage (outgoingMult), lifesteal (lifestealRowsOf), markRate (markRateOf).
//   while        folds like a stat row while its condition holds. Only players that own such a row are checked, once a
//                tick (updateMods, after damage), and refolded only when a condition flips: the mirror moves one tick
//                after the condition, by design. `notShooting` (Swift Boots) is false from the tick a bow or wand attack
//                starts (`weapon.action`, set in the weapon phase, so the end-of-tick check already sees it) until `ms`
//                after the shot left (`weapon.lastShotAt`), so the speed mirror flips twice per bout of shooting.
//   vs, scale    damage rows: outgoingMult adds them to the damage sum per hit (the ledger calls it before any victim
//                of the pass takes damage, so it reads the state as the pass began). The tests that need more than the
//                victim's hp (higherFeed, thirdParty: R5) are answered by the ledger's probe, from the same moment.
//   executeBand  Plague's execute threshold (Pestilence): 0.5 + the sum (executeBandOf), read by sim/factions.ts.
//   trigger      listed for sim/factions.ts (triggersOf), which runs them.
//   convert, mult, flag   (balance pass, BALANCE_CONTRACT 4.6) the whole fold is shared foldRows: the plain sums, the conversions in
//                one pass from them (max hp is the folded one, so armor from max hp is never a step stale), the caps (G7, G10, G11), and
//                the products of the `mult` rows (asPost after the attack-speed cap, hit, dot, returned, ap, wishCooldown, hpRace,
//                linger). adBonus and apBonus are mirrors like the others; the readers below (adOf, apOf, multOf, hitMultOf,
//                dotMultOf, returnedMultOf, hpRaceCapOf, wishCooldownMultOf, healTakenMultOf, slowResistOf, lifestealMultOf,
//                lifestealDotOf, critChanceOf, hasFlag) are how the rest of the sim reads what is not a mirror.
//   Rows that come from outside the build (a test, the training console, later relics and curses) go in with setExtraRows.
// Every registered mod source (world.modSources, e.g. Wishes' attack slow) is asked too: its multipliers multiply into
// the folded mirrors, its flat bonuses add. The attack-speed product of the rows and the sources is then capped (shared
// capAsMult, AS_MULT_CAP), and the `asPost` mults multiply after that (shared mirrorsFromFold).
//
// When the mirrors are folded (event-driven; nothing folds every fighter every tick):
//   - recomputeMods(world, c): at once, whenever a source changes. grantCard calls it, so a card changes the attack interval
//     and the walk in the same tick. A registered source whose answer changes (a status applied or cleansed) must call it too;
//   - updateMods (a world.systems entry, after damage): players with `while` rows have their conditions checked, and when
//     sources are registered every fighter's answer is asked again (an expiry shows by the end of its tick); a fighter
//     is refolded only when something it folds from changed.
// A mirror is written only when its wire value changes, so it patches only then.
//
// Mobs have no synced mirrors (R4a left them out: nothing modifies a mob before R4b's statuses). What the sources give
// a mob is kept here, server only, so a slowed mob would attack slower while a client still drew its bow at the unslowed
// pace: R4b adds MobState mirrors if mobs can be slowed.
//
// A leaf module: it must not import weapons.ts, arena.ts, ledger.ts, combatant.ts, buffs.ts (the barrier and max hp), a status
// runtime or anything else that imports it. Type-only imports are fine.
import {
  assertNever, capAsMult, CARDS, cardLive, cardRows, countIn, critChanceFrom, decodeFlat, decodeMult, encodeMirrors, EXECUTE_BAND, FACTIONS,
  FIGHT_GAP_SECONDS, FISTS, foldRows, isDot, isFactionId, MAX_HP_FLOOR_SHARE, mirrorsFromFold, OUTGOING_ROW_CAP, ownsBase, requirementsMet,
  type BaseStatId, type Effect, type EffectFlag, type EffectOf, type Folded, type MultKey, type ScalingStats, type StatMirrors,
  type StatSums,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import type { LedgerEntry, ModContribution, World } from "./world";

/** The registry's answers, combined: multipliers multiplied, flat bonuses added. */
type Contribution = Required<ModContribution>;
const NONE: Readonly<Contribution> = { asMult: 1, speedMult: 1, windupMult: 1, armor: 0, shield: 0 };

/** A trigger row and the key it fires under (once-per-run rows are remembered by it). */
export interface OwnedTrigger { key: string; row: EffectOf<"trigger"> }

/** A player's rows, sorted by what reads them. Rebuilt from the cards only when they change. */
interface Build {
  /** Every applied row (the cards' rows, once per copy, and the extra ones), for display, tests and the fold. */
  rows: Effect[];
  /** while rows: folded while their condition holds (bit i of `holds` for whiles[i]; `holding` is the same as a set). */
  whiles: EffectOf<"while">[];
  holds: number;
  holding: ReadonlySet<EffectOf<"while">>;
  vs: EffectOf<"vs">[];
  scales: EffectOf<"scale">[];
  triggers: OwnedTrigger[];
  /** onHit rows (Hemorrhage, later relics): sim/onHit.ts applies them when a hit lands. */
  onHits: EffectOf<"onHit">[];
  /** Some `while` row is a `fightTime` one, so the fight clock is kept for this player. */
  usesFight: boolean;
  /** Some `scale` row grows with the camps cleared; `camps` is the count as of the last tick (PlayerRuntime.campsCleared). */
  usesCamps: boolean;
  camps: number;
  /** The rows folded as they stood at the last fold (sources not included: they only touch the mirrors). */
  folded: Folded;
  /** The same fold's sums (`folded.sums`). */
  sums: StatSums;
}

interface ModCache {
  build: Build | null;
  /** The registered sources' last combined answer. */
  src: Readonly<Contribution>;
  /** A mob's folded mirrors (wire form), which have no synced field. */
  mob: StatMirrors | null;
}
const caches = new WeakMap<FighterState, ModCache>();
/** Per world, the fighters whose mirrors hold a source's answer: the per-tick pass folds them again when one is unregistered. */
const withSources = new WeakMap<World, Set<FighterState>>();
/** Per world, the players that own a `while` row, by id: the only ones whose conditions are checked every tick. */
const conditional = new WeakMap<World, Map<string, PlayerState>>();
/** Per world, the players whose rows grow with the camps they cleared: their count is read once a tick. */
const campUsers = new WeakMap<World, Map<string, PlayerState>>();
/** Per world, the players with a `fightTime` row, and when each one's current fight began and last had a hit (server ms). */
const fightWatch = new WeakMap<World, Set<string>>();
const fightClocks = new WeakMap<World, Map<string, { start: number; last: number }>>();
/** Rows a fighter has besides its build's (setExtraRows). */
const extraRows = new WeakMap<FighterState, readonly Effect[]>();

const EMPTY_FOLDED: Readonly<Folded> = foldRows([]);
const EMPTY_SUMS: Readonly<StatSums> = EMPTY_FOLDED.sums;
const NO_HOLDS: ReadonlySet<EffectOf<"while">> = new Set();

function isPlayerState(s: FighterState): s is PlayerState {
  return "asMult" in s;
}

function addRow(b: Build, e: Effect, key: string): void {
  b.rows.push(e);
  switch (e.k) {
    case "stat":
    case "flat":
    case "convert":
    case "mult":
    case "flag": break; // folded from `rows` by shared foldRows
    case "while":
      b.whiles.push(e);
      if (e.cond === "fightTime") b.usesFight = true;
      break;
    case "vs": b.vs.push(e); break;
    case "scale":
      b.scales.push(e);
      if (e.src === "campsCleared") b.usesCamps = true;
      break;
    case "trigger": b.triggers.push({ key, row: e }); break;
    case "onHit": b.onHits.push(e); break; // applied by sim/onHit.ts, from the hitLanded hook
    default: assertNever(e, "effect kind");
  }
}

/** The hp a player's faction starts with: the base its maxHp rows scale (the player's own maxHp for a fighter without a faction). */
function baseHpOf(p: PlayerState): number {
  return isFactionId(p.faction) ? FACTIONS[p.faction].hp : p.maxHp;
}

/**
 * The player's rows: each live card's rows once per copy held (catalog order, so a sum is the same whatever order the cards were
 * gained in), then the extra rows. A trigger's once-key is `card:<card id>:<row>`, the same for every copy.
 * Rows' `requires` ids are base stats (a card's own `requires` gates the offer, not the rows): a base id counts as owned at any tier.
 */
function buildOf(p: PlayerState): Build {
  const b: Build = {
    rows: [], whiles: [], holds: 0, holding: NO_HOLDS, vs: [], scales: [], triggers: [], onHits: [], usesFight: false, usesCamps: false, camps: 0,
    folded: EMPTY_FOLDED, sums: EMPTY_SUMS,
  };
  const owns = (id: string): boolean => countIn(p.build, id) > 0 || ownsBase(p.build, id as BaseStatId);
  if (p.build && p.build.size > 0) {
    for (const def of CARDS) {
      const n = countIn(p.build, def.id);
      if (!(n > 0) || !cardLive(def)) continue;
      const rows = cardRows(def.id, p.faction);
      for (let copy = 0; copy < n; copy++) {
        rows.forEach((e, i) => {
          if (e.needs === "status" || !requirementsMet(e, owns)) return;
          addRow(b, e, `card:${def.id}:${i}`);
        });
      }
    }
  }
  extraRows.get(p)?.forEach((e, i) => {
    if (e.needs === "status" || !requirementsMet(e, owns)) return;
    addRow(b, e, `extra:${i}`);
  });
  return b;
}

/** The rows a player's stats fold from (its cards' rows, once per copy, then the extra ones). */
export function modRowsOf(p: PlayerState): Effect[] {
  return buildOf(p).rows;
}

/** The hand holds no weapon: fists. */
function handIsEmpty(s: PlayerState): boolean {
  const w = s.slot === 1 ? s.weapon1 : s.weapon0;
  return w === "" || w === FISTS;
}

/** Does a `while` row's condition hold for this fighter now? */
function holdsNow(world: World, c: Combatant, e: EffectOf<"while">): boolean {
  switch (e.cond) {
    // Chasing your lock = holding a target lock (on or off, so the mirror patches only when a lock starts or ends).
    case "chasingLock": return c.rt.weapon.lock !== null;
    case "hpBelow": return c.s.maxHp > 0 && c.s.hp / c.s.maxHp < e.arg;
    case "afterCast": return false; // R6: casts
    case "notShooting": {
      // Off from a bow or wand attack's start (its windup is `weapon.action`) until e.ms after the shot left; a windup that is
      // cancelled never shoots, so it leaves no pause. Event-driven like the others: it flips at the first start of a bout of
      // shooting and e.ms after its last shot, not between shots when they come closer than e.ms.
      const w = c.rt.weapon;
      if (w.action !== null && w.action.kind !== "swing") return false;
      return world.state.serverTime - w.lastShotAt >= (e.ms ?? 0);
    }
    // Fists: the hand's slot is empty. Re-checked every tick, so a swap or an arming shows one tick later, like the others.
    case "unarmed": return isPlayerState(c.s) && handIsEmpty(c.s);
    // In a fight (a hit landed or taken within FIGHT_GAP_SECONDS) that has lasted at least `arg` seconds.
    case "fightTime": {
      const f = fightClocks.get(world)?.get(c.id);
      if (!f) return false;
      const now = world.state.serverTime;
      return now - f.last < FIGHT_GAP_SECONDS * 1000 && now - f.start >= e.arg * 1000;
    }
    default: return assertNever(e.cond, "while condition");
  }
}

function holdsOf(world: World, c: Combatant, b: Build): number {
  let bits = 0;
  for (let i = 0; i < b.whiles.length; i++) if (holdsNow(world, c, b.whiles[i]!)) bits |= 1 << i;
  return bits;
}

/** Records which `while` rows hold (bit i of `bits` for whiles[i]). */
function applyHolds(b: Build, bits: number): void {
  b.holds = bits;
  b.holding = bits === 0 ? NO_HOLDS : new Set(b.whiles.filter((_, i) => (bits & (1 << i)) !== 0));
}

/** Folds the build's rows (shared foldRows: plain sums, conversions, caps, mults, flags) and keeps the result on it. */
function refold(p: PlayerState, b: Build): void {
  // The rows were filtered by `requires` when the build was made, so every row left is on.
  b.folded = foldRows(b.rows, { owns: () => true, holds: (e) => b.holding.has(e), baseMaxHp: baseHpOf(p) });
  b.sums = b.folded.sums;
}

/** Every registered source's answer for `c`, combined. */
function askSources(world: World, c: Combatant): Readonly<Contribution> {
  const sources = world.modSources;
  if (sources.length === 0) return NONE;
  let out: Contribution | null = null;
  for (const source of sources) {
    const a = source(world, c);
    if (!a) continue;
    out ??= { ...NONE };
    if (a.asMult !== undefined) out.asMult *= a.asMult;
    if (a.speedMult !== undefined) out.speedMult *= a.speedMult;
    if (a.windupMult !== undefined) out.windupMult *= a.windupMult;
    if (a.armor !== undefined) out.armor += a.armor;
    if (a.shield !== undefined) out.shield += a.shield;
  }
  return out ?? NONE;
}

function sameContribution(a: Readonly<Contribution>, b: Readonly<Contribution>): boolean {
  return a === b || (a.asMult === b.asMult && a.speedMult === b.speedMult && a.windupMult === b.windupMult
    && a.armor === b.armor && a.shield === b.shield);
}

/** The mirrors (wire form) a fold and the sources' combined answer give: attack speed capped on the rows and the sources, then times asPost. */
function mirrorsOf(folded: Readonly<Folded>, src: Readonly<Contribution>): StatMirrors {
  return encodeMirrors(mirrorsFromFold(folded, src));
}

/** Writes the mirrors a player holds, each only when its wire value changed, so a mirror that did not move does not patch. */
function writeMirrors(s: PlayerState, m: StatMirrors): void {
  if (s.asMult !== m.asMult) s.asMult = m.asMult;
  if (s.windupMult !== m.windupMult) s.windupMult = m.windupMult;
  if (s.speedMult !== m.speedMult) s.speedMult = m.speedMult;
  if (s.armorBonus !== m.armorBonus) s.armorBonus = m.armorBonus;
  if (s.shieldBonus !== m.shieldBonus) s.shieldBonus = m.shieldBonus;
  if (s.adBonus !== m.adBonus) s.adBonus = m.adBonus;
  if (s.apBonus !== m.apBonus) s.apBonus = m.apBonus;
}

function track<T>(map: WeakMap<World, Map<string, T>>, world: World, id: string, value: T | null): void {
  const m = map.get(world);
  if (value !== null) {
    if (m) m.set(id, value);
    else map.set(world, new Map([[id, value]]));
  } else {
    m?.delete(id);
  }
}

/** Writes the fold. A mirror whose wire value did not change is not written, so it does not patch. */
function store(world: World, c: Combatant, cache: ModCache): void {
  const s = c.s;
  if (isPlayerState(s)) {
    writeMirrors(s, mirrorsOf(cache.build ? cache.build.folded : EMPTY_FOLDED, cache.src));
    const b = cache.build;
    track(conditional, world, c.id, b && b.whiles.length > 0 ? s : null);
    track(campUsers, world, c.id, b && b.usesCamps ? s : null);
    const watch = fightWatch.get(world);
    if (b && b.usesFight) {
      if (watch) watch.add(c.id);
      else fightWatch.set(world, new Set([c.id]));
    } else {
      watch?.delete(c.id);
      fightClocks.get(world)?.delete(c.id);
    }
    return;
  }
  cache.mob = cache.src === NONE ? null : mirrorsOf(EMPTY_FOLDED, cache.src);
}

function noteSources(world: World, s: FighterState, src: Readonly<Contribution>): void {
  const held = withSources.get(world);
  if (src !== NONE) {
    if (held) held.add(s);
    else withSources.set(world, new Set([s]));
  } else {
    held?.delete(s);
  }
}

/**
 * Re-folds a fighter's stats from its rows (rebuilt from its cards and extra rows) and every registered source, and
 * stores the mirrors. Call it whenever one of them changes (a card granted, a status applied or removed).
 */
export function recomputeMods(world: World, c: Combatant): void {
  const src = askSources(world, c);
  let cache = caches.get(c.s);
  if (!cache) caches.set(c.s, cache = { build: null, src, mob: null });
  cache.src = src;
  if (isPlayerState(c.s)) {
    const b = buildOf(c.s);
    if (b.usesCamps && c.kind === "player") b.camps = c.rt.campsCleared ?? 0;
    applyHolds(b, holdsOf(world, c, b));
    refold(c.s, b);
    cache.build = b.rows.length > 0 ? b : null;
  }
  store(world, c, cache);
  noteSources(world, c.s, src);
}

/**
 * Gives a player rows that are not its build's (a test's crafted card, the training console, later relics and curses), replacing
 * the last set; an empty list takes them away. The fold is redone at once. Max hp is not synced here (sim/buffs.ts syncMaxHp).
 */
export function setExtraRows(world: World, c: Combatant, rows: readonly Effect[]): void {
  if (rows.length > 0) extraRows.set(c.s, rows);
  else extraRows.delete(c.s);
  recomputeMods(world, c);
}

/** The attack-speed multiplier the sim uses: the decoded `asMult` mirror (for a mob, what the sources give it, else 1). */
export function asMultOf(s: FighterState): number {
  if (isPlayerState(s)) return decodeMult(s.asMult);
  const mob = caches.get(s)?.mob;
  return mob ? decodeMult(mob.asMult) : 1;
}

/** The walking-speed multiplier of the fighter's own stats: the decoded `speedMult` mirror. */
export function speedMultOf(s: FighterState): number {
  if (isPlayerState(s)) return decodeMult(s.speedMult);
  const mob = caches.get(s)?.mob;
  return mob ? decodeMult(mob.speedMult) : 1;
}

/** The windup multiplier: the decoded `windupMult` mirror (shared scaleWindup applies it). */
export function windupMultOf(s: FighterState): number {
  if (isPlayerState(s)) return decodeMult(s.windupMult);
  const mob = caches.get(s)?.mob;
  return mob ? decodeMult(mob.windupMult) : 1;
}

/** Points the fighter's mods add to its faction's armor and shield (the decoded mirrors). */
export function defenseBonusOf(s: FighterState): { armor: number; shield: number } {
  if (isPlayerState(s)) return { armor: decodeFlat(s.armorBonus), shield: decodeFlat(s.shieldBonus) };
  const mob = caches.get(s)?.mob;
  return mob ? { armor: decodeFlat(mob.armorBonus), shield: decodeFlat(mob.shieldBonus) } : { armor: 0, shield: 0 };
}

/** Attack damage (AD): the decoded `adBonus` mirror (0 for a mob, and for a fighter nothing gives any). */
export function adOf(s: FighterState): number {
  if (isPlayerState(s)) return decodeFlat(s.adBonus);
  const mob = caches.get(s)?.mob;
  return mob ? decodeFlat(mob.adBonus) : 0;
}

/** Ability power (AP), after the `ap` mult: the decoded `apBonus` mirror. */
export function apOf(s: FighterState): number {
  if (isPlayerState(s)) return decodeFlat(s.apBonus);
  const mob = caches.get(s)?.mob;
  return mob ? decodeFlat(mob.apBonus) : 0;
}

/** Max hp over the faction's (0 at the faction's own hp, and for a mob): the part of a weapon's `scaling.hp`. */
export function bonusMaxHpOf(s: FighterState): number {
  return isPlayerState(s) ? Math.max(0, s.maxHp - baseHpOf(s)) : 0;
}

/** The stats a weapon hit scales with (shared WeaponScaling), read from the mirrors and the max hp: what packetFor feeds shared scalingDamage. */
export function scalingStatsOf(s: FighterState): ScalingStats {
  const def = defenseBonusOf(s);
  // The armor mirror dips below 0 under the axe's shred; a weapon scales with bonus armor a fighter HAS, never with a debuff.
  return { ad: adOf(s), ap: apOf(s), bonusMaxHp: bonusMaxHpOf(s), bonusDefense: Math.max(0, def.armor) + def.shield };
}

/** Every mirror of a fighter, decoded (the identity for a fighter nothing modifies). */
export function modsOf(s: FighterState): StatMirrors {
  const m = isPlayerState(s) ? s : caches.get(s)?.mob ?? null;
  if (!m) return { asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0, adBonus: 0, apBonus: 0 };
  return {
    asMult: decodeMult(m.asMult), windupMult: decodeMult(m.windupMult), speedMult: decodeMult(m.speedMult),
    armorBonus: decodeFlat(m.armorBonus), shieldBonus: decodeFlat(m.shieldBonus), adBonus: decodeFlat(m.adBonus), apBonus: decodeFlat(m.apBonus),
  };
}

function foldedOf(s: FighterState): Readonly<Folded> {
  return caches.get(s)?.build?.folded ?? EMPTY_FOLDED;
}

/** The fighter's folded stat sums as of its last fold, conversions and caps included (all zero for a fighter with no rows: every mob today). */
export function statSumsOf(s: FighterState): Readonly<StatSums> {
  return caches.get(s)?.build?.sums ?? EMPTY_SUMS;
}

/** Max health a card has earned outright, on top of the rows (Tank Engine: sim/cardHooks.ts), by player. */
const flatMaxHp = new WeakMap<FighterState, number>();

/** Sets the max health `s` has earned outside the rows; the caller syncs max hp (sim/buffs.ts syncMaxHp) after. */
export function setFlatMaxHp(s: FighterState, points: number): void {
  if (points > 0) flatMaxHp.set(s, points);
  else flatMaxHp.delete(s);
}

/** The max health earned outside the rows (0 for none). */
export function flatMaxHpOf(s: FighterState): number {
  return flatMaxHp.get(s) ?? 0;
}

/** Its max hp multiplier from the rows: 1 + the maxHp sum, never below MAX_HP_FLOOR_SHARE (G8: half the faction's). */
export function maxHpMultOf(s: FighterState): number {
  return Math.max(MAX_HP_FLOOR_SHARE, 1 + statSumsOf(s).maxHp);
}

/** The lifesteal its rows add up to (any faction), before the cap: shared lifestealTotal caps it (LS_CAP), multiplies it and adds Holy's own. */
export function lifestealRowsOf(s: FighterState): number {
  return statSumsOf(s).lifesteal;
}

/** The product of the fighter's `lifestealMult` rows (Bloodthirst x2 while it holds; 1 for none): it multiplies the capped rows, not Holy's own. */
export function lifestealMultOf(s: FighterState): number {
  return statSumsOf(s).lifestealMult;
}

/** The share of the damage over time it deals that a fighter heals (Siphon's `lifestealDot`), on top of the rest of its lifesteal (shared lifestealTotal's `onDot`). */
export function lifestealDotOf(s: FighterState): number {
  return Math.max(0, statSumsOf(s).lifestealDot);
}

/** Healing a fighter receives is multiplied by this: 1 + the healTaken sum, never negative (Wellspring 1.25, Vampiric Pact 0: lifesteal is exempt, so wire it in heal()). */
export function healTakenMultOf(s: FighterState): number {
  return Math.max(0, 1 + statSumsOf(s).healTaken);
}

/** The share of every heal a fighter receives that also becomes a barrier (Second Skin 0.3; G6 holds the barrier to 25% of max hp and decays it), 0 for none. */
export function healBarrierOf(s: FighterState): number {
  return Math.max(0, statSumsOf(s).healBarrier);
}

/** The share of a slow's strength a fighter resists (Iron Will 0.4), 0..1. */
export function slowResistOf(s: FighterState): number {
  return Math.min(1, Math.max(0, statSumsOf(s).slowResist));
}

/** Critical strike chance (G12): the `critChance` sum held to CRIT_CHANCE_MAX, 0 under a `noCrit` flag. The accumulator that rolls it is phase B's. */
export function critChanceOf(s: FighterState): number {
  const f = foldedOf(s);
  return critChanceFrom(f.sums.critChance, f.flags.has("noCrit"));
}

/** Is the flag on? (`lockSecondSlot` Committed, `noCrit` Thick Skull.) */
export function hasFlag(s: FighterState, flag: EffectFlag): boolean {
  return foldedOf(s).flags.has(flag);
}

/** The product of the fighter's `mult` rows for `key`, after the guards' clamps (1 for none). */
export function multOf(s: FighterState, key: MultKey): number {
  return foldedOf(s).mults[key];
}

/** Multiplies a weapon hit's whole damage, AD and AP included (Boom 2.5, Machine Gun 0.4); sim/weapons.ts packetFor applies it. */
export function hitMultOf(s: FighterState): number {
  return foldedOf(s).mults.hit;
}

/**
 * Multiplies every damage-over-time tick the fighter deals (Boom 1.25, Slow Burn 0.7): a signature's (sim/factions.ts `bonus`) and a
 * card's (a bleed, Festering Arcana's tail: sim/abilities.ts `statusDamage`); a Wish's burn is flat and never reads it.
 */
export function dotMultOf(s: FighterState): number {
  return foldedOf(s).mults.dot;
}

/**
 * Multiplies the damage the fighter returns to attackers (Boom 1.25): Fire's backlash (sim/factions.ts), Spiked Shell (sim/cardHooks.ts), a
 * riposte (sim/melee.ts) and an arrow its shield reflects (sim/projectiles.ts).
 */
export function returnedMultOf(s: FighterState): number {
  return foldedOf(s).mults.returned;
}

/** Multiplies the fighter's Wish cooldown (Arcane Overload 2); sim/abilities.ts hands it to abilityCooldownMs. */
export function wishCooldownMultOf(s: FighterState): number {
  return foldedOf(s).mults.wishCooldown;
}

/** How many times as long a damage-over-time signature lingers after a fight breaks off (Slow Burn 2). */
export function lingerMultOf(s: FighterState): number {
  return foldedOf(s).mults.linger;
}

/** The ceiling of a Race to 0 the fighter holds (its `hpRace` row, at most HP_RACE_CAP), or 0 for none: sim/ledger.ts reads it as the card's source. */
export function hpRaceCapOf(s: FighterState): number {
  const v = foldedOf(s).mults.hpRace;
  return v > 1 ? v : 0;
}

/** How fast a Sentenced fighter's marks climb their tiers: 1 + the markRate sum (never below 0), the credit each landed hit gives toward the next tier. */
export function markRateOf(s: FighterState): number {
  return Math.max(0, 1 + statSumsOf(s).markRate);
}

/**
 * The attack-speed multiplier the fighter's own rows give, capped like the mirror's (AS_MULT_CAP), before any source (a slow, the
 * mark's tax) and before `asPost`: what the tax reads as the fighter's card haste (1 for a mob and for a fighter with no haste row).
 */
export function cardAsMultOf(s: FighterState): number {
  return capAsMult(1 + statSumsOf(s).attackSpeed);
}

/** The hp share below which a Plague fighter's execute runs: EXECUTE_BAND (0.5) + its executeBand rows, within 0..1. */
export function executeBandOf(s: FighterState): number {
  return Math.min(1, Math.max(0, EXECUTE_BAND + statSumsOf(s).executeBand));
}

/** The trigger rows the fighter owns, with their once-keys. */
export function triggersOf(s: FighterState): readonly OwnedTrigger[] {
  return caches.get(s)?.build?.triggers ?? [];
}

const NO_ON_HITS: readonly EffectOf<"onHit">[] = [];

/** The `onHit` rows the fighter owns (a card's on-hit status: Hemorrhage's bleed). */
export function onHitsOf(s: FighterState): readonly EffectOf<"onHit">[] {
  return caches.get(s)?.build?.onHits ?? NO_ON_HITS;
}

/** True for a fighter with any damage row (stat damage, vs or scale): the ledger skips the rest. */
function hasDamageRows(b: Build | null | undefined): b is Build {
  return !!b && (b.sums.damage !== 0 || b.vs.length > 0 || b.scales.length > 0);
}

/**
 * The answers to the `vs` tests that need more than the victim's hp, asked lazily (only for an attacker with such a row).
 * The ledger builds one per entry from the state as the pass began (sim/ledger.ts vsProbe); a test without an answer is false.
 */
export interface VsProbe {
  /** The victim is a player whose feed is higher than the attacker's (Bounty Hunter). */
  higherFeed?(): boolean;
  /** The victim's lock, its mob target or its last hit (the signature target) is on someone other than the attacker (Witness). */
  thirdParty?(): boolean;
  /** The victim is chilled (Frost's chill) or under a move slow status (Sitting Ducks). */
  slowed?(): boolean;
  /** The victim is an elite mob (Big Game Hunter). */
  elite?(): boolean;
  /** The victim is a player holding more card power than the attacker (Bounty Hunter's successor). */
  higherPower?(): boolean;
  /** The victim is a player, not a mob or a dummy (Big Game Hunter's `playerAbove`). */
  player?(): boolean;
  /** The victim is rooted (a root status). */
  rooted?(): boolean;
  /** The hits the attacker has landed in a row on the victim before this one (Tunnel Vision, First Impressions): 0 for a new target. */
  streak?(): number;
}

/**
 * Does a `vs` row's test hold against a victim at hp fraction `victimFrac`? (A test that needs the world is the probe's.) `streak` is the
 * probe's streak answer for an entry that is a weapon hit, and undefined for any other (the streak cards say "hit": a bleed is none).
 */
function vsHolds(e: EffectOf<"vs">, victimFrac: number, probe: VsProbe | undefined, streak: (() => number) | undefined): boolean {
  switch (e.test) {
    case "hpAbove": return victimFrac > e.arg;
    case "hpBelow": return victimFrac < e.arg;
    case "higherFeed": return probe?.higherFeed?.() ?? false;
    case "thirdParty": return probe?.thirdParty?.() ?? false;
    case "slowed": return probe?.slowed?.() ?? false;
    case "elite": return probe?.elite?.() ?? false;
    case "higherPower": return probe?.higherPower?.() ?? false;
    case "playerAbove": return victimFrac > e.arg && (probe?.player?.() ?? false);
    case "rooted": return probe?.rooted?.() ?? false;
    // Holds while the hits already landed in a row on this target are `arg` or fewer: arg 0 is the first hit on a new target.
    case "streak": return streak !== undefined && streak() <= e.arg;
    default: return assertNever(e.test, "vs test");
  }
}

/**
 * Which damage an entry is, for G1's cap: a weapon hit ("hit": the `hit` mult is already inside its packet), a damage-over-time
 * tick ("dot": the `dot` mult), damage returned to an attacker ("returned") or any other ("other": no mult of its own).
 */
export type OutgoingKind = "hit" | "dot" | "returned" | "other";

/**
 * The kind of a ledger entry, for outgoingMult's G1 cap: a damage-over-time tick (burn, disease, the mark, an ability's or a
 * status's `dot`), damage returned to an attacker (Fire's backlash, a riposte or a reflected arrow: `passive`), a weapon hit
 * (a weapon, no signature), or any other (a Wish's hit: ability power is flat and the ledger skips it anyway).
 */
export function outgoingKindOf(e: Pick<LedgerEntry, "sig" | "dot" | "passive" | "weapon" | "ability">): OutgoingKind {
  if (isDot(e.sig) || e.dot === true) return "dot";
  if (e.sig === "backlash" || e.passive === true) return "returned";
  if (e.sig === undefined && e.ability === undefined && e.weapon !== null) return "hit";
  return "other";
}

/**
 * What a weapon hit or signature damage `attacker` deals to a victim at hp fraction `victimFrac` is multiplied by,
 * before armor and shield: 1 + the damage sum + every `vs` row whose test holds + every `scale` row's stepped bonus (rows
 * within the damage key add), G1-capped: this row multiplier times the entry's own `mult` (hit for a weapon hit, dot, returned:
 * `kind`) never passes OUTGOING_ROW_CAP, so Boom's x2.5 leaves no room for a damage row and Glass Cannon on a plain hit stops at x2.5.
 * The ledger calls it for every entry before any victim of the pass takes damage, so both hp
 * fractions (and what `probe` answers) are as the pass began, and skips ability entries (flat power) and the arena's
 * burn. The `streak` rows (First Impressions, Tunnel Vision) count only for a weapon hit (`kind` "hit"). 1 for a fighter with no
 * build (every mob today), and for one with no damage rows unless its own mult and `baked` already pass the cap (Boom with a crit: the
 * answer is then the ceiling, below 1, so a damage card never LOWERS a hit). `kind` defaults to "other"; the ledger names it per entry.
 * `baked` is the multiplier the entry's packet already carries beyond the fighter's own mult of its kind (a critical strike's 1.5, Plant
 * Your Feet's 1.25): it shares G1's cap with them, so the rows give way to it instead of going past x2.5.
 */
export function outgoingMult(attacker: FighterState, victimFrac: number, probe?: VsProbe, kind: OutgoingKind = "other", baked = 1): number {
  return outgoingMultCore(attacker, victimFrac, probe, kind, baked, false);
}

/**
 * The share (0..1) of an entry's outgoing multiplier that its attacker's execute rows contribute: the `vs hpBelow` rows (Coup de Grace, Pestilence
 * outside Plague), which add damage as the victim falls. A tier-4 mark denies exactly that much of a hit (sim/ledger.ts, docs/SENTENCED_REDESIGN.md R7):
 * `1 - (the multiplier without those rows) / (the multiplier with them)`, so it is 0 for a fighter without them and never more than the rows give.
 */
export function outgoingExecuteShare(attacker: FighterState, victimFrac: number, probe?: VsProbe, kind: OutgoingKind = "other", baked = 1): number {
  const b = caches.get(attacker)?.build;
  if (!b || !b.vs.some((e) => e.test === "hpBelow")) return 0;
  const full = outgoingMultCore(attacker, victimFrac, probe, kind, baked, false);
  if (!(full > 0)) return 0;
  const without = outgoingMultCore(attacker, victimFrac, probe, kind, baked, true);
  return Math.max(0, Math.min(1, 1 - without / full));
}

function outgoingMultCore(
  attacker: FighterState, victimFrac: number, probe: VsProbe | undefined, kind: OutgoingKind, baked: number, skipExecute: boolean,
): number {
  const b = caches.get(attacker)?.build;
  if (!b) return 1;
  const m = b.folded.mults;
  const own = (kind === "hit" ? m.hit : kind === "dot" ? m.dot : kind === "returned" ? m.returned : 1) * (baked > 0 ? baked : 1);
  const ceiling = own > 1 ? OUTGOING_ROW_CAP / own : OUTGOING_ROW_CAP;
  // No damage row: nothing to add, but Boom's x2.5 with a crit's x1.5 (or Plant Your Feet's x1.25) already passes the cap on its own,
  // and a fighter without rows must not hit harder than the same one with a damage card (the cap cuts the packet back to x2.5).
  if (!hasDamageRows(b)) return Math.min(1, ceiling);
  let sum = b.sums.damage;
  const streak = kind === "hit" ? probe?.streak : undefined;
  for (const e of b.vs) if (!(skipExecute && e.test === "hpBelow") && vsHolds(e, victimFrac, probe, streak)) sum += e.v;
  for (const e of b.scales) {
    if (!(e.step > 0)) continue;
    let bonus = 0;
    if (e.src === "campsCleared") {
      bonus = e.per * Math.floor(b.camps / e.step + 1e-9);
    } else if (e.src === "streak") {
      bonus = e.per * Math.floor((streak?.() ?? 0) / e.step + 1e-9);
    } else if (attacker.maxHp > 0) {
      const missing = Math.max(0, 1 - attacker.hp / attacker.maxHp);
      // Stepped: +per for every whole step of missing hp (a hair of float slack so exactly 20% missing is two steps).
      bonus = e.per * Math.floor(missing / e.step + 1e-9);
    }
    sum += e.cap !== undefined && bonus > e.cap ? e.cap : bonus;
  }
  return Math.max(0, Math.min(1 + sum, ceiling));
}

/** The tick's landed hits start and extend the fight clock of every player that has a `fightTime` row (a fight ends FIGHT_GAP_SECONDS after its last hit). */
function noteFights(world: World): void {
  const watch = fightWatch.get(world);
  if (!watch || watch.size === 0) return;
  let clocks = fightClocks.get(world);
  if (!clocks) fightClocks.set(world, clocks = new Map());
  const now = world.state.serverTime;
  const touch = (id: string): void => {
    if (!watch.has(id)) return;
    const f = clocks.get(id);
    if (!f || now - f.last >= FIGHT_GAP_SECONDS * 1000) clocks.set(id, { start: now, last: now });
    else f.last = now;
  };
  for (const h of world.combat.landed) {
    touch(h.by);
    touch(h.victim);
  }
}

/**
 * System: the fight clocks and the camp counts are brought up to date; players with `while` rows have their conditions checked
 * (refolded only on a flip); with sources registered, every fighter's answer is asked again (refolded only when it changed).
 * With none registered, what a source that has since been unregistered left on anyone is dropped.
 */
export function updateMods(world: World): void {
  noteFights(world);
  const camps = campUsers.get(world);
  if (camps && camps.size > 0) {
    for (const [id, s] of camps) {
      const rt = world.players.get(id);
      const b = caches.get(s)?.build;
      if (!rt || !b || !b.usesCamps) {
        camps.delete(id);
        continue;
      }
      b.camps = rt.campsCleared ?? 0;
    }
  }
  const cond = conditional.get(world);
  if (cond && cond.size > 0) {
    for (const [id, s] of cond) {
      const rt = world.players.get(id);
      const cache = caches.get(s);
      const b = cache?.build;
      if (!rt || world.state.players.get(id) !== s || !cache || !b || b.whiles.length === 0) {
        cond.delete(id);
        continue;
      }
      const holds = holdsOf(world, { kind: "player", id, s, rt }, b);
      if (holds === b.holds) continue;
      applyHolds(b, holds);
      refold(s, b);
      store(world, { kind: "player", id, s, rt }, cache);
    }
  }
  const held = withSources.get(world);
  if (world.modSources.length === 0) {
    if (held && held.size > 0) {
      for (const s of held) {
        const cache = caches.get(s);
        if (!cache) continue;
        cache.src = NONE;
        if (isPlayerState(s)) {
          writeMirrors(s, mirrorsOf(cache.build ? cache.build.folded : EMPTY_FOLDED, NONE));
        } else {
          cache.mob = null;
        }
      }
      held.clear();
    }
    return;
  }
  // Rebuilt below, so a fighter that has left the world is not held on to.
  held?.clear();
  const ask = (c: Combatant): void => {
    const src = askSources(world, c);
    let cache = caches.get(c.s);
    if (!cache) {
      if (src === NONE) return;
      caches.set(c.s, cache = { build: null, src, mob: null });
    } else if (sameContribution(cache.src, src)) {
      noteSources(world, c.s, cache.src);
      return;
    }
    cache.src = src;
    store(world, c, cache);
    noteSources(world, c.s, src);
  };
  for (const [id, s] of world.state.players) {
    const rt = world.players.get(id);
    if (rt) ask({ kind: "player", id, s, rt });
  }
  for (const [id, s] of world.state.mobs) {
    const rt = world.mobs.get(id);
    if (rt) ask({ kind: "mob", id, s, rt });
  }
}

export function install(world: World): void {
  world.systems.push(updateMods);
}
