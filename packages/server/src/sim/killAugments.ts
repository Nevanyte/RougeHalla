// Kill augments (shared/killAugments.ts): a credited player (or bot) kill, never a mob, drops a private "Trophy" reward container at
// the killer's feet. Its options are the victim's top three stat investments; the owner's pick adds KILL_AUG_SHARE of that
// bonus to PlayerState.killStats (farm rows, outside card power). It rides the chest's `choose` action (sim/chests.ts delegates
// the owner check and the grant here), so the client's chest panel and the bots' chest module work unchanged.
import {
  CHEST_REFUSAL, KILL_AUG_LABEL, KILL_AUG_SECONDS, killAugmentGrant, parseKillAugment, rollKillAugments, type KillAugment,
} from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { syncMaxHp } from "./buffs";
import { standing, type Combatant } from "./combatant";
import { addContainer, holdBirth } from "./loot";
import { recomputeMods } from "./mods";
import { chainHook, emit, type World } from "./world";

type PlayerCombatant = Extract<Combatant, { kind: "player" }>;

/** The playerKilled hook: a trophy for a credited kill (never a mob: this hook only fires for players and bots). */
function onPlayerKilled(world: World, killer: { id: string }, victim: { id: string }, outcome: "died" | "mia"): void {
  if (outcome !== "died" || world.config.training || world.state.phase !== "active" || killer.id === victim.id) return;
  const k = world.state.players.get(killer.id);
  const v = world.state.players.get(victim.id);
  if (!k || !v || k.status !== "alive") return;
  const options = rollKillAugments(v);
  if (options.length === 0) return;
  const box = addContainer(world, "reward", { x: k.x, y: k.y }, KILL_AUG_LABEL, []);
  holdBirth(world, box.id);
  box.owner = killer.id;
  box.expiresAt = world.state.serverTime + KILL_AUG_SECONDS * 1000;
  for (const id of options) { box.options.push(id); box.takenBy.push(""); }
}

/** The owner check for `choose`: false (with the refusal toast) for anyone but the trophy's owner. */
export function trophyOwnerOk(world: World, c: PlayerCombatant, box: ContainerState): boolean {
  if (box.owner === "" || box.owner === c.id) return true;
  emit(world, { type: "toast", to: c.id, text: CHEST_REFUSAL.notYours });
  return false;
}

/** Adds a parsed pick to the player's killStats and folds the mods again. */
export function grantKillAugment(world: World, c: PlayerCombatant, a: KillAugment): void {
  const { stat, v } = killAugmentGrant(a);
  c.s.killStats.set(stat, (c.s.killStats.get(stat) ?? 0) + v);
  recomputeMods(world, c);
  syncMaxHp(c.s);
}

/** A pick on a trophy option; false when the id is not a kill augment. */
export function pickKillAugment(world: World, c: PlayerCombatant, id: string): boolean {
  const a = parseKillAugment(id);
  if (!a) return false;
  grantKillAugment(world, c, a);
  return true;
}

export function install(world: World): void {
  chainHook(world, "playerKilled", onPlayerKilled);
}
