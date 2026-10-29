import { engageRange, FROST_ELITE_GUARD_BONUS, FROST_ELITE_GUARD_LINGER_MS, hasLineOfSight, reachMask } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { activeWeapon, combatant, hostile, isEvading, standing, type Combatant } from "./combatant";
import { recomputeMods } from "./mods";
import { chainHook, collisionMap, type LedgerEntry, type World } from "./world";

interface BruiserPassivesRuntime {
  frostEliteUntil: Map<string, number>;
}

const runtimes = new WeakMap<World, BruiserPassivesRuntime>();

function runtime(world: World): BruiserPassivesRuntime {
  let state = runtimes.get(world);
  if (!state) {
    state = { frostEliteUntil: new Map() };
    runtimes.set(world, state);
  }
  return state;
}

/** A direct Frost/elite contact starts or refreshes Frozen Justice's short defense window. */
function noteEliteContact(world: World, playerId: string, otherId: string): void {
  const player = world.state.players.get(playerId);
  const other = world.state.mobs.get(otherId);
  if (player?.faction !== "frost" || player.status !== "alive" || other?.kind !== "elite") return;
  runtime(world).frostEliteUntil.set(playerId, world.state.serverTime + FROST_ELITE_GUARD_LINGER_MS);
}

function noteLedgerContact(world: World, entry: LedgerEntry): void {
  noteEliteContact(world, entry.by.id, entry.victim);
  noteEliteContact(world, entry.victim, entry.by.id);
}

function noteBlockedContact(world: World, holder: Combatant, attacker: Combatant): void {
  noteEliteContact(world, holder.id, attacker.id);
  noteEliteContact(world, attacker.id, holder.id);
}

function lockedElite(world: World, player: Combatant): boolean {
  if (player.kind !== "player" || player.s.faction !== "frost") return false;
  const targetId = player.rt.weapon.lock;
  if (!targetId) return false;
  const target = combatant(world, targetId);
  const weapon = activeWeapon(player.s);
  if (target?.kind !== "mob" || target.s.kind !== "elite" || !standing(target) || isEvading(target) || !hostile(player, target) || !weapon) return false;
  const inReach = Math.hypot(target.s.x - player.s.x, target.s.y - player.s.y) <= engageRange(weapon);
  return inReach && hasLineOfSight(collisionMap(world), player.s, target.s, reachMask(weapon));
}

function setFrostGuard(world: World, id: string, player: PlayerState, guarded: boolean): void {
  if (player.frostEliteGuard === guarded) return;
  player.frostEliteGuard = guarded;
  const c = combatant(world, id);
  if (c?.kind === "player") recomputeMods(world, c);
}

/** Sync the camp count mirror and current Frost defense state before the stat mirrors are folded. */
function update(world: World): void {
  const state = runtime(world);
  const now = world.state.serverTime;

  if (world.state.phase === "active") {
    for (const [id, player] of world.state.players) {
      const rt = world.players.get(id);
      if (rt) {
        const campClears = rt.campsCleared ?? 0;
        if (player.campClears !== campClears) player.campClears = campClears;
      }
    }
  }

  for (const [id, player] of world.state.players) {
    const rt = world.players.get(id);
    if (!rt || player.faction !== "frost" || player.status !== "alive" || world.state.phase !== "active") {
      state.frostEliteUntil.delete(id);
      setFrostGuard(world, id, player, false);
      continue;
    }
    const fighter: Combatant = { kind: "player", id, s: player, rt };
    if (lockedElite(world, fighter)) {
      state.frostEliteUntil.set(id, now + FROST_ELITE_GUARD_LINGER_MS);
    }
    const guarded = (state.frostEliteUntil.get(id) ?? 0) > now;
    setFrostGuard(world, id, player, guarded);
  }
}

function frozenJustice(world: World, c: Combatant): { armor: number; shield: number } | null {
  if (c.kind !== "player" || c.s.faction !== "frost" || c.s.status !== "alive" || !c.s.frostEliteGuard) return null;
  return { armor: FROST_ELITE_GUARD_BONUS, shield: FROST_ELITE_GUARD_BONUS };
}

function clearPlayer(world: World, id: string): void {
  runtime(world).frostEliteUntil.delete(id);
  const player = world.state.players.get(id);
  if (!player) return;
  setFrostGuard(world, id, player, false);
}

function resetRun(world: World): void {
  runtime(world).frostEliteUntil.clear();
  for (const [id, player] of world.state.players) {
    if (player.frostEliteGuard) player.frostEliteGuard = false;
    const rt = world.players.get(id);
    if (rt) {
      const campClears = rt.campsCleared ?? 0;
      if (player.campClears !== campClears) player.campClears = campClears;
    }
    const c = combatant(world, id);
    if (c?.kind === "player") recomputeMods(world, c);
  }
}

export function install(world: World): void {
  world.modSources.push(frozenJustice);
  // Locks are current after targeting and before movement/damage. Hits and blocks extend the timer via hooks below.
  world.afterWeapons.push(update);
  // Run again after the ledger so contacts from this tick reach the mirror before sim/mods folds it.
  world.systems.push(update);
  chainHook(world, "hitLanded", noteLedgerContact);
  chainHook(world, "blocked", noteBlockedContact);
  chainHook(world, "fighterOut", (w, id) => clearPlayer(w, id));
  chainHook(world, "campCleared", (w) => update(w));
  chainHook(world, "raidStarted", resetRun);
  chainHook(world, "runEnded", resetRun);
}
