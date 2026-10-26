// Stat mods: folds a fighter's active effects into the stat mirrors (PlayerState asMult, windupMult, speedMult,
// armorBonus, shieldBonus; ROGUELIKE_PLAN 3.8), and is the one place the sim reads them back. The sim never uses a
// stat's unencoded double: it reads the decoded mirror (shared/mods.ts), which is what every client decodes too.
//
// How effects fold (shared/mods.ts foldStatRows): `stat` rows add within a stat key, and each key becomes one multiplier,
// 1 + its sum; different keys multiply where the sim combines them, never add. `flat` rows add points. `while` rows fold
// only while their condition holds. Rows whose `requires` are not all owned are off. Per-hit (`vs`, `scale`) and event
// rows (`onHit`, `trigger`) are not stats and do not fold here. Then every registered mod source (world.modSources, e.g.
// Wishes' attack slow, `attackSlowFactor`) is asked: its multipliers multiply into the folded ones, its flat bonuses add.
//
// When the mirrors are folded:
//   - synchronously, whenever a source changes: recomputeMods(world, c). grantStacks (and so transferStacks) calls it,
//     so a stack grant changes the attack interval and the walk in the same tick, as it always has. A registered source
//     whose answer changes (a status applied or cleansed) must call it too (Wishes' statusApplied hook will);
//   - once per tick as a world.systems entry (after damage), which re-asks every registered source, so an expiry shows
//     by the end of the tick it happens in. A source must therefore answer from the present (until > now), not from a
//     list another system prunes. With no source registered it only checks the stacks below;
//   - R0 only: on read, when the stacks they were folded from have changed behind recomputeMods's back (tests write the
//     stacks fields directly). It reuses the sources' last answers (a read has no world). Production writes the stacks
//     in grantStacks alone, so there this check always passes. R4a removes the stacks fields and this check with them.
//
// R0's own rows are the attack- and move-speed stacks (their S-curve bonuses as `stat` rows), so asMult and speedMult are
// exactly buffMultiplier(stacks) as before. The hp stacks stay with syncMaxHp (sim/buffs.ts). windupMult, armorBonus and
// shieldBonus have no source yet and stay at the identity; nothing reads them yet (R4a wires the windup into timingsOf
// and the client's draw and root, and the flat bonuses into defenseOf). R4a replaces modRowsOf with the fighter's buff,
// build and status rows; the callers (recomputeMods, the readers, the system) do not change.
//
// Mobs have no synced mirrors. What the sources give a mob is kept here (server only), so a slowed mob attacks slower,
// but a client still draws its bow's pull at the unslowed pace until MobState gets mirrors.
//
// A leaf module: it must not import weapons.ts, arena.ts, ledger.ts, combatant.ts, a status runtime or anything else that
// imports buffs.ts (they import it). Type-only imports are fine.
import {
  buffBonus, decodeFlat, decodeMult, encodeMirrors, foldStatRows, mirrorsFromSums, zeroSums, type Effect, type StatMirrors,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import type { ModContribution, World } from "./world";

/** The registry's answers, combined: multipliers multiplied, flat bonuses added. */
type Contribution = Required<ModContribution>;
const NONE: Readonly<Contribution> = { asMult: 1, speedMult: 1, windupMult: 1, armor: 0, shield: 0 };

interface ModCache {
  /** The stacks the mirrors were last folded from (R0's read-time check). */
  as: number;
  ms: number;
  /** The registered sources' last combined answer. */
  src: Readonly<Contribution>;
  /** A mob's folded mirrors (wire form), which have no synced field. */
  mob: StatMirrors | null;
}
const caches = new WeakMap<FighterState, ModCache>();
/** Per world, the fighters whose mirrors hold a source's answer: the per-tick pass folds them again when one is unregistered. */
const withSources = new WeakMap<World, Set<FighterState>>();

/** The rows a player's mirrors fold from. R0: the S-curve bonuses of the attack- and move-speed stacks. */
export function modRowsOf(p: PlayerState): Effect[] {
  return [
    { k: "stat", stat: "attackSpeed", v: buffBonus("attackSpeed", p.stacksAs) },
    { k: "stat", stat: "moveSpeed", v: buffBonus("moveSpeed", p.stacksMs) },
  ];
}

function isPlayerState(s: FighterState): s is PlayerState {
  return "asMult" in s;
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

/** The mirrors (wire form) a fighter's own rows and the sources' combined answer `src` give. */
function foldWith(s: FighterState, src: Readonly<Contribution>): StatMirrors {
  const m = mirrorsFromSums(isPlayerState(s) ? foldStatRows(modRowsOf(s)) : zeroSums());
  if (src !== NONE) {
    m.asMult *= src.asMult;
    m.speedMult *= src.speedMult;
    m.windupMult *= src.windupMult;
    m.armorBonus += src.armor;
    m.shieldBonus += src.shield;
  }
  return encodeMirrors(m);
}

/** Stores the fold. A mirror that did not change is not written, so it does not patch. */
function store(s: FighterState, src: Readonly<Contribution>): void {
  const m = foldWith(s, src);
  const cache = caches.get(s);
  if (isPlayerState(s)) {
    // The schema setter skips an equal value too; the checks keep plain objects in tests honest as well.
    if (s.asMult !== m.asMult) s.asMult = m.asMult;
    if (s.windupMult !== m.windupMult) s.windupMult = m.windupMult;
    if (s.speedMult !== m.speedMult) s.speedMult = m.speedMult;
    if (s.armorBonus !== m.armorBonus) s.armorBonus = m.armorBonus;
    if (s.shieldBonus !== m.shieldBonus) s.shieldBonus = m.shieldBonus;
    if (cache) {
      cache.as = s.stacksAs;
      cache.ms = s.stacksMs;
      cache.src = src;
    } else {
      caches.set(s, { as: s.stacksAs, ms: s.stacksMs, src, mob: null });
    }
    return;
  }
  if (src === NONE) {
    caches.delete(s);
    return;
  }
  if (cache) {
    cache.src = src;
    cache.mob = m;
  } else {
    caches.set(s, { as: 0, ms: 0, src, mob: m });
  }
}

/**
 * Re-folds a fighter's mirrors from its own rows and every registered source, and stores them. Call it whenever one of
 * its sources changes (a stack grant; later a buff, a passive, a status applied or removed).
 */
export function recomputeMods(world: World, c: Combatant): void {
  const src = askSources(world, c);
  store(c.s, src);
  const held = withSources.get(world);
  if (src !== NONE) {
    if (held) held.add(c.s);
    else withSources.set(world, new Set([c.s]));
  } else {
    held?.delete(c.s);
  }
}

/** R0's read-time check: re-folds (with the sources' last answers) if the stacks changed since the last fold. */
function refresh(p: PlayerState): void {
  const cache = caches.get(p);
  if (cache === undefined) store(p, NONE);
  else if (cache.as !== p.stacksAs || cache.ms !== p.stacksMs) store(p, cache.src);
}

/** The attack-speed multiplier the sim uses: the decoded `asMult` mirror (for a mob, what the sources give it, else 1). */
export function asMultOf(s: FighterState): number {
  if (isPlayerState(s)) {
    refresh(s);
    return decodeMult(s.asMult);
  }
  const mob = caches.get(s)?.mob;
  return mob ? decodeMult(mob.asMult) : 1;
}

/** The walking-speed multiplier of the fighter's own stats: the decoded `speedMult` mirror. Kill bursts are not in it. */
export function speedMultOf(s: FighterState): number {
  if (isPlayerState(s)) {
    refresh(s);
    return decodeMult(s.speedMult);
  }
  const mob = caches.get(s)?.mob;
  return mob ? decodeMult(mob.speedMult) : 1;
}

/** Every mirror of a fighter, decoded (the identity for a mob nothing modifies). */
export function modsOf(s: FighterState): StatMirrors {
  let m: StatMirrors | null;
  if (isPlayerState(s)) {
    refresh(s);
    m = s;
  } else {
    m = caches.get(s)?.mob ?? null;
  }
  if (!m) return { asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0 };
  return {
    asMult: decodeMult(m.asMult), windupMult: decodeMult(m.windupMult), speedMult: decodeMult(m.speedMult),
    armorBonus: decodeFlat(m.armorBonus), shieldBonus: decodeFlat(m.shieldBonus),
  };
}

/**
 * System: re-asks every registered source for every fighter (catching expiries). With none registered it only checks the
 * stacks, after dropping what a source that has since been unregistered left on anyone.
 */
export function updateMods(world: World): void {
  const held = withSources.get(world);
  if (world.modSources.length === 0) {
    if (held && held.size > 0) {
      for (const s of held) store(s, NONE);
      held.clear();
    }
    for (const p of world.state.players.values()) refresh(p);
    return;
  }
  // Rebuilt by the recomputes below, so a fighter that has left the world is not held on to.
  held?.clear();
  for (const [id, s] of world.state.players) {
    const rt = world.players.get(id);
    if (rt) recomputeMods(world, { kind: "player", id, s, rt });
  }
  for (const [id, s] of world.state.mobs) {
    const rt = world.mobs.get(id);
    if (rt) recomputeMods(world, { kind: "mob", id, s, rt });
  }
}

export function install(world: World): void {
  world.systems.push(updateMods);
}
