// Stat mods: folds a fighter's effect rows into its stats, writes the ones a client needs as the quantized stat mirrors
// (PlayerState asMult, windupMult, speedMult, armorBonus, shieldBonus; ROGUELIKE_PLAN 3.8), and is the one place the sim
// reads them back. The sim never uses a mirrored stat's unencoded double: it reads the decoded mirror (shared/mods.ts),
// which is what every client decodes too (D22).
//
// A player's rows are its buffs' rows (shared/buffs.ts: each buff's rows scaled to its stacks; rows that need the status
// runtime are left out until R4b) and, from roguelike R5, its passives' rows (PlayerState.build: each live skill's rows at
// its rank, shared/skills.ts skillRows, with the faction's own rows where the rank has some), kept here per player and
// rebuilt only when the buffs or the build change. Buff and passive rows fold together: a damage row of either adds to the
// one damage sum, and so on for every key.
//   stat, flat   fold into one sum per stat key (shared/mods.ts StatSums): rows add within a key, keys multiply where the
//                sim combines them (1 + sum each). Mirrored keys go to the mirrors; the rest are read here: maxHp
//                (sim/buffs.ts syncMaxHp), damage (outgoingMult), lifesteal (lifestealOf), markRate (markRateOf).
//   while        folds like a stat row while its condition holds. Only players that own such a row are checked, once a
//                tick (updateMods, after damage), and refolded only when a condition flips: the mirror moves one tick
//                after the condition, by design.
//   vs, scale    damage rows: outgoingMult adds them to the damage sum per hit (the ledger calls it before any victim
//                of the pass takes damage, so it reads the state as the pass began). The tests that need more than the
//                victim's hp (higherFeed, thirdParty: R5) are answered by the ledger's probe, from the same moment.
//   executeBand  Plague's execute threshold (Pestilence): 0.5 + the sum (executeBandOf), read by sim/factions.ts.
//   trigger      listed for sim/factions.ts (triggersOf), which runs them.
// Every registered mod source (world.modSources, e.g. Wishes' attack slow) is asked too: its multipliers multiply into
// the folded mirrors, its flat bonuses add. The attack-speed product is then capped (shared capAsMult, AS_MULT_CAP).
//
// When the mirrors are folded (event-driven; nothing folds every fighter every tick):
//   - recomputeMods(world, c): at once, whenever a source changes. grantBuff (and so transferBuffs) calls it, so a grant
//     changes the attack interval and the walk in the same tick. A registered source whose answer changes (a status
//     applied or cleansed) must call it too;
//   - updateMods (a world.systems entry, after damage): players with `while` rows have their conditions checked, and when
//     sources are registered every fighter's answer is asked again (an expiry shows by the end of its tick); a fighter
//     is refolded only when something it folds from changed.
// A mirror is written only when its wire value changes, so it patches only then.
//
// Mobs have no synced mirrors (R4a left them out: nothing modifies a mob before R4b's statuses). What the sources give
// a mob is kept here, server only, so a slowed mob would attack slower while a client still drew its bow at the unslowed
// pace: R4b adds MobState mirrors if mobs can be slowed.
//
// A leaf module: it must not import weapons.ts, arena.ts, ledger.ts, combatant.ts, buffs.ts, a status runtime or anything
// else that imports it. Type-only imports are fine.
import {
  BUFFS, buffScale, capAsMult, decodeFlat, decodeMult, encodeMirrors, EXECUTE_BAND, mirrorsFromSums, rankIn, requirementsMet,
  scaleEffect, SKILLS, skillLive, skillRows, stacksIn, zeroSums, type Effect, type EffectOf, type StatMirrors, type StatSums,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import type { ModContribution, World } from "./world";

/** The registry's answers, combined: multipliers multiplied, flat bonuses added. */
type Contribution = Required<ModContribution>;
const NONE: Readonly<Contribution> = { asMult: 1, speedMult: 1, windupMult: 1, armor: 0, shield: 0 };

/** A trigger row and the key it fires under (once-per-run rows are remembered by it). */
export interface OwnedTrigger { key: string; row: EffectOf<"trigger"> }

/** A player's rows, sorted by what reads them. Rebuilt from the buffs only when they change. */
interface Build {
  /** Every applied row (the buffs' rows at their stacks), for display and tests. */
  rows: Effect[];
  /** stat and flat rows: always folded. */
  fixed: Array<EffectOf<"stat"> | EffectOf<"flat">>;
  /** while rows: folded while their condition holds (bit i of `holds` for whiles[i]). */
  whiles: EffectOf<"while">[];
  holds: number;
  vs: EffectOf<"vs">[];
  scales: EffectOf<"scale">[];
  triggers: OwnedTrigger[];
  /** The rows folded as they stood at the last fold (sources not included: they only touch the mirrors). */
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

const EMPTY_SUMS: Readonly<StatSums> = zeroSums();

function isPlayerState(s: FighterState): s is PlayerState {
  return "asMult" in s;
}

function addRow(b: Build, e: Effect, key: string): void {
  b.rows.push(e);
  switch (e.k) {
    case "stat":
    case "flat": b.fixed.push(e); break;
    case "while": b.whiles.push(e); break;
    case "vs": b.vs.push(e); break;
    case "scale": b.scales.push(e); break;
    case "trigger": b.triggers.push({ key, row: e }); break;
    case "onHit": break; // R4b: statuses on hit (they need the status runtime, so none reaches here yet)
  }
}

/**
 * The player's rows: each owned buff's rows scaled to its stacks, then each live passive's rows at its rank (catalog order
 * both, so a sum is the same whatever order they were gained in). A trigger's once-key is `<buff id>:<row>` for a buff and
 * `skill:<skill id>:<row>` for a passive, the same for both ranks (an upgrade does not re-arm a trigger that has fired).
 */
function buildOf(p: PlayerState): Build {
  const b: Build = { rows: [], fixed: [], whiles: [], holds: 0, vs: [], scales: [], triggers: [], sums: EMPTY_SUMS };
  const owns = (id: string): boolean => stacksIn(p.buffs, id) > 0 || rankIn(p.build, id) > 0;
  for (const def of BUFFS) {
    const n = stacksIn(p.buffs, def.id);
    if (!(n > 0)) continue;
    const k = buffScale(n);
    def.effects.forEach((raw, i) => {
      if (raw.needs === "status" || !requirementsMet(raw, owns)) return;
      addRow(b, scaleEffect(raw, k), `${def.id}:${i}`);
    });
  }
  if (p.build && p.build.size > 0) {
    for (const def of SKILLS) {
      const r = rankIn(p.build, def.id);
      if (!(r > 0) || !skillLive(def)) continue;
      skillRows(def.id, r, p.faction).forEach((e, i) => {
        if (e.needs === "status" || !requirementsMet(e, owns)) return;
        addRow(b, e, `skill:${def.id}:${i}`);
      });
    }
  }
  return b;
}

/** The rows a player's stats fold from (its buffs' rows at their stacks, then its passives' rows at their ranks). */
export function modRowsOf(p: PlayerState): Effect[] {
  return buildOf(p).rows;
}

/** Does a `while` row's condition hold for this fighter now? */
function holdsNow(c: Combatant, e: EffectOf<"while">): boolean {
  switch (e.cond) {
    // Chasing your lock = holding a target lock (on or off, so the mirror patches only when a lock starts or ends).
    case "chasingLock": return c.rt.weapon.lock !== null;
    case "hpBelow": return c.s.maxHp > 0 && c.s.hp / c.s.maxHp < e.arg;
    case "afterCast": return false; // R6: casts
  }
}

function holdsOf(c: Combatant, b: Build): number {
  let bits = 0;
  for (let i = 0; i < b.whiles.length; i++) if (holdsNow(c, b.whiles[i]!)) bits |= 1 << i;
  return bits;
}

function fold(b: Build): StatSums {
  const sums = zeroSums();
  for (const e of b.fixed) sums[e.stat] += e.v;
  for (let i = 0; i < b.whiles.length; i++) if (b.holds & (1 << i)) sums[b.whiles[i]!.stat] += b.whiles[i]!.v;
  return sums;
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

/** The mirrors (wire form) the folded sums and the sources' combined answer give, attack speed capped on the total. */
function mirrorsOf(sums: Readonly<StatSums>, src: Readonly<Contribution>): StatMirrors {
  const m = mirrorsFromSums(sums);
  if (src !== NONE) {
    m.asMult *= src.asMult;
    m.speedMult *= src.speedMult;
    m.windupMult *= src.windupMult;
    m.armorBonus += src.armor;
    m.shieldBonus += src.shield;
  }
  m.asMult = capAsMult(m.asMult);
  return encodeMirrors(m);
}

/** Writes the fold. A mirror whose wire value did not change is not written, so it does not patch. */
function store(world: World, c: Combatant, cache: ModCache): void {
  const s = c.s;
  if (isPlayerState(s)) {
    const sums = cache.build ? cache.build.sums : EMPTY_SUMS;
    const m = mirrorsOf(sums, cache.src);
    if (s.asMult !== m.asMult) s.asMult = m.asMult;
    if (s.windupMult !== m.windupMult) s.windupMult = m.windupMult;
    if (s.speedMult !== m.speedMult) s.speedMult = m.speedMult;
    if (s.armorBonus !== m.armorBonus) s.armorBonus = m.armorBonus;
    if (s.shieldBonus !== m.shieldBonus) s.shieldBonus = m.shieldBonus;
    const cond = conditional.get(world);
    if (cache.build && cache.build.whiles.length > 0) {
      if (cond) cond.set(c.id, s);
      else conditional.set(world, new Map([[c.id, s]]));
    } else {
      cond?.delete(c.id);
    }
    return;
  }
  cache.mob = cache.src === NONE ? null : mirrorsOf(EMPTY_SUMS, cache.src);
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
 * Re-folds a fighter's stats from its rows (rebuilt from its buffs) and every registered source, and stores the mirrors.
 * Call it whenever one of them changes (a buff grant; later a passive, a status applied or removed).
 */
export function recomputeMods(world: World, c: Combatant): void {
  const src = askSources(world, c);
  let cache = caches.get(c.s);
  if (!cache) caches.set(c.s, cache = { build: null, src, mob: null });
  cache.src = src;
  if (isPlayerState(c.s)) {
    const b = buildOf(c.s);
    b.holds = holdsOf(c, b);
    b.sums = fold(b);
    cache.build = b.rows.length > 0 ? b : null;
  }
  store(world, c, cache);
  noteSources(world, c.s, src);
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

/** Every mirror of a fighter, decoded (the identity for a fighter nothing modifies). */
export function modsOf(s: FighterState): StatMirrors {
  const m = isPlayerState(s) ? s : caches.get(s)?.mob ?? null;
  if (!m) return { asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0 };
  return {
    asMult: decodeMult(m.asMult), windupMult: decodeMult(m.windupMult), speedMult: decodeMult(m.speedMult),
    armorBonus: decodeFlat(m.armorBonus), shieldBonus: decodeFlat(m.shieldBonus),
  };
}

/** The fighter's folded stat sums as of its last fold (all zero for a fighter with no rows: every mob today). */
export function statSumsOf(s: FighterState): Readonly<StatSums> {
  return caches.get(s)?.build?.sums ?? EMPTY_SUMS;
}

/** Its max hp multiplier from the rows: 1 + the maxHp sum (never below 0.05). */
export function maxHpMultOf(s: FighterState): number {
  return Math.max(0.05, 1 + statSumsOf(s).maxHp);
}

/** The lifesteal its rows add up to (any faction), before the cap: shared lifestealShare caps it and adds Holy's own. */
export function lifestealRowsOf(s: FighterState): number {
  return statSumsOf(s).lifesteal;
}

/** How much faster a Sentenced fighter's mark ramps: 1 + the markRate sum (never below 0). */
export function markRateOf(s: FighterState): number {
  return Math.max(0, 1 + statSumsOf(s).markRate);
}

/** The hp share below which a Plague fighter's execute runs: EXECUTE_BAND (0.5) + its executeBand rows, within 0..1. */
export function executeBandOf(s: FighterState): number {
  return Math.min(1, Math.max(0, EXECUTE_BAND + statSumsOf(s).executeBand));
}

/** The trigger rows the fighter owns, with their once-keys. */
export function triggersOf(s: FighterState): readonly OwnedTrigger[] {
  return caches.get(s)?.build?.triggers ?? [];
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
}

/** Does a `vs` row's test hold against a victim at hp fraction `victimFrac`? (slowed, rooted, streak need R4b.) */
function vsHolds(e: EffectOf<"vs">, victimFrac: number, probe: VsProbe | undefined): boolean {
  switch (e.test) {
    case "hpAbove": return victimFrac > e.arg;
    case "hpBelow": return victimFrac < e.arg;
    case "higherFeed": return probe?.higherFeed?.() ?? false;
    case "thirdParty": return probe?.thirdParty?.() ?? false;
    case "slowed":
    case "rooted":
    case "streak":
      return false;
  }
}

/**
 * What every hit `attacker` deals to a victim at hp fraction `victimFrac` is multiplied by, before armor and shield:
 * 1 + the damage sum + every `vs` row whose test holds + every `scale` row's stepped bonus (rows within the damage key
 * add). The ledger calls it for every entry before any victim of the pass takes damage, so both hp fractions (and what
 * `probe` answers) are as the pass began. 1 for a fighter with no damage rows (every mob today).
 */
export function outgoingMult(attacker: FighterState, victimFrac: number, probe?: VsProbe): number {
  const b = caches.get(attacker)?.build;
  if (!hasDamageRows(b)) return 1;
  let sum = b.sums.damage;
  for (const e of b.vs) if (vsHolds(e, victimFrac, probe)) sum += e.v;
  if (b.scales.length > 0 && attacker.maxHp > 0) {
    const missing = Math.max(0, 1 - attacker.hp / attacker.maxHp);
    for (const e of b.scales) {
      // Stepped: +per for every whole step of missing hp (a hair of float slack so exactly 20% missing is two steps).
      if (e.step > 0) sum += e.per * Math.floor(missing / e.step + 1e-9);
    }
  }
  return Math.max(0, 1 + sum);
}

/**
 * System: players with `while` rows have their conditions checked (refolded only on a flip); with sources registered,
 * every fighter's answer is asked again (refolded only when it changed). With none registered, what a source that has
 * since been unregistered left on anyone is dropped.
 */
export function updateMods(world: World): void {
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
      const holds = holdsOf({ kind: "player", id, s, rt }, b);
      if (holds === b.holds) continue;
      b.holds = holds;
      b.sums = fold(b);
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
          const m = mirrorsOf(cache.build ? cache.build.sums : EMPTY_SUMS, NONE);
          if (s.asMult !== m.asMult) s.asMult = m.asMult;
          if (s.windupMult !== m.windupMult) s.windupMult = m.windupMult;
          if (s.speedMult !== m.speedMult) s.speedMult = m.speedMult;
          if (s.armorBonus !== m.armorBonus) s.armorBonus = m.armorBonus;
          if (s.shieldBonus !== m.shieldBonus) s.shieldBonus = m.shieldBonus;
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
