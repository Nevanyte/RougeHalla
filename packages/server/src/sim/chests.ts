// A cleared camp's shared chest (roguelike R5, ROGUELIKE_PLAN 3.3, D1-D3, D12, D16, D17).
//
//   - The drop: when a camp is cleared (sim/camps.ts, after the ledger pass), a container of kind "reward" appears on the
//     camp's chest tile (CampDef.chest; the camp's centre if that tile is a wall). Its options are rolled from
//     world.rewardRandom only (shared/rewards.ts rollChestOptions, the camp's zone, no build: each picker's own ranks decide
//     what a pick gives), and it holds them in synced state with `takenBy` and `pickers` (public by design, D17). It
//     expires CHEST_SECONDS after the drop (`expiresAt`), never extended.
//   - `choose` (an action, so within a tick picks resolve in the shuffled actionOrder; step.ts runs actions only for alive
//     players in an active run). Checked in this order, each refusal a private toast that uses up nothing:
//       the picker is a standing player (not down, no result out) .......................... silent
//       the picker is not stunned or casting (status.ts actionBlocked, as for a pickup) ...... "Can't do that now"
//       the chest exists, is a reward, was not created this tick, and now < expiresAt ...... "Chest gone"
//       the picker's SERVER position is within CHEST_RANGE of the chest's centre ............ "Too far away"
//       with line of sight on collisionMap(world) ......................................... "Can't reach that"
//       the picker has not picked here yet (an option or a skip) ........................... "You already picked"
//       a skip, or an option index the chest has (else ignored) ........................... silent
//       the option is free ................................................................ "Already taken"
//       the picker does not hold it at its top rank ........................................ "Already at rank 2"
//     Then the option is theirs (`takenBy`), they join `pickers`, the passive goes to rank 1 or 2 in PlayerState.build, the
//     mods are folded again at once (sim/mods.ts; max hp follows), and a `chestTaken` fx goes out. A skip (`pick` -1) joins
//     `pickers` and pays D12: heal SKIP_HEAL_SHARE of max hp through heal() (the 3 s lockout applies); if that heals nothing
//     (in combat, or at full hp), GV_SKIP GV under GV_MOB_CAP (arena.ts awardSkipGv); `chestTaken` with option -1.
//   - Removal: the `expireChests` system removes a chest in the tick serverTime reaches `expiresAt` (after that tick's
//     inputs, which already refuse it); the coliseum teleport and the end of the run remove every chest.
// Reward containers are never weapon containers: `pickup` refuses them (loot.ts), and they hold no items.
import {
  CHEST_RANGE, CHEST_REFUSAL, CHEST_SECONDS, hasLineOfSight, isWallAt, nextRank, rollChestOptions, skillDef, SKIP_HEAL_SHARE, type Vec2,
} from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { awardSkipGv } from "./arena";
import { syncMaxHp } from "./buffs";
import { standing, type Combatant } from "./combatant";
import { heal } from "./factions";
import { addContainer, bornThisTick, forgetBirth } from "./loot";
import { recomputeMods } from "./mods";
import { actionBlocked } from "./status";
import { chainHook, collisionMap, emit, type ActionHandler, type World } from "./world";

export const REWARD_LABEL = "Skill Chest";

function toast(world: World, to: string, text: string): void {
  emit(world, { type: "toast", to, text });
}

/**
 * A reward container at `at` with these options (SkillIds, in card order), expiring CHEST_SECONDS from now. `camp` is the
 * camp's index in map.camps (stored + 1), or omitted for a chest that belongs to no camp (the training console's).
 */
export function dropRewardChest(world: World, at: Vec2, options: readonly string[], camp?: number): ContainerState {
  const box = addContainer(world, "reward", at, REWARD_LABEL, []);
  box.camp = camp !== undefined && camp >= 0 ? camp + 1 : 0;
  box.expiresAt = world.state.serverTime + CHEST_SECONDS * 1000;
  for (const id of options) {
    box.options.push(id);
    box.takenBy.push("");
  }
  return box;
}

/** Where camp `camp`'s chest stands: its chest tile, or its centre when that tile is a wall. */
export function chestSpot(world: World, camp: number): Vec2 | null {
  const def = world.map.camps[camp];
  if (!def) return null;
  return isWallAt(world.map, def.chest.x, def.chest.y) ? { x: def.x, y: def.y } : { x: def.chest.x, y: def.chest.y };
}

/** Rolls camp `camp`'s chest (world.rewardRandom only) and drops it. Null for a camp the map does not have. */
export function rollChest(world: World, camp: number): ContainerState | null {
  const def = world.map.camps[camp];
  const at = chestSpot(world, camp);
  if (!def || !at) return null;
  return dropRewardChest(world, at, rollChestOptions(world.rewardRandom, { zone: def.zone }), camp);
}

/** Every reward container now in the state. */
export function rewardChests(world: World): ContainerState[] {
  const out: ContainerState[] = [];
  for (const c of world.state.containers.values()) if (c.kind === "reward") out.push(c);
  return out;
}

export const handleChoose: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "choose" || c.kind !== "player" || !standing(c)) return;
  // A pick is an action like a pickup: a stun or a pending cast blocks it (the Wishes' D5), and it uses up nothing.
  if (actionBlocked(world, c)) { toast(world, c.id, CHEST_REFUSAL.busy); return; }
  const p = c.s;
  const now = world.state.serverTime;
  const box = world.state.containers.get(cmd.chest);
  if (!box || box.kind !== "reward" || bornThisTick(world, box.id) || !(now < box.expiresAt)) { toast(world, c.id, CHEST_REFUSAL.gone); return; }
  if (Math.hypot(p.x - box.x, p.y - box.y) > CHEST_RANGE) { toast(world, c.id, CHEST_REFUSAL.far); return; }
  if (!hasLineOfSight(collisionMap(world), p, box)) { toast(world, c.id, CHEST_REFUSAL.blocked); return; }
  if (box.pickers.includes(c.id)) { toast(world, c.id, CHEST_REFUSAL.picked); return; }
  if (cmd.pick === -1) {
    box.pickers.push(c.id);
    paySkip(world, c);
    emit(world, { type: "fx", fx: { kind: "chestTaken", chest: box.id, by: c.id, option: -1 } });
    return;
  }
  const i = cmd.pick;
  if (!(i >= 0 && i < box.options.length)) return;
  if (box.takenBy[i] !== "") { toast(world, c.id, CHEST_REFUSAL.taken); return; }
  const id = box.options[i]!;
  const rank = nextRank(p.build, id);
  if (rank === null) { toast(world, c.id, CHEST_REFUSAL.maxed); return; }
  if (!skillDef(id)) return; // an option this server does not know: never rolled, so a broken container
  box.takenBy[i] = c.id;
  box.pickers.push(c.id);
  grantSkill(world, c, id);
  emit(world, { type: "fx", fx: { kind: "chestTaken", chest: box.id, by: c.id, option: i } });
};

/**
 * One rank of skill `id` for a player: rank 1, or rank 2 when they hold rank 1. The mods are folded again at once (a passive
 * acts from this tick on) and max hp follows. Returns the new rank, or null (an unknown id, or already at the top rank).
 * The chest's pick goes through here; the training console may too.
 */
export function grantSkill(world: World, c: Extract<Combatant, { kind: "player" }>, id: string): number | null {
  const rank = nextRank(c.s.build, id);
  if (rank === null || !skillDef(id)) return null;
  c.s.build.set(id, rank);
  recomputeMods(world, c);
  syncMaxHp(c.s);
  return rank;
}

/** D12: a skip heals SKIP_HEAL_SHARE of max hp when the heal lockout allows; healing nothing (lockout, full hp) pays GV_SKIP. */
function paySkip(world: World, c: Extract<Combatant, { kind: "player" }>): void {
  if (heal(world, c, SKIP_HEAL_SHARE * c.s.maxHp) > 0) return;
  awardSkipGv(world, c.s, c.rt);
}

/** System: a chest goes in the tick serverTime reaches its expiresAt (that tick's picks were already refused). */
export function expireChests(world: World): void {
  const now = world.state.serverTime;
  let gone: string[] | null = null;
  for (const [id, box] of world.state.containers) if (box.kind === "reward" && now >= box.expiresAt) (gone ??= []).push(id);
  if (gone) for (const id of gone) { world.state.containers.delete(id); forgetBirth(world, id); }
}

/** Every chest goes (the coliseum teleport: the gates lock them out of reach; the end of the run). */
export function clearChests(world: World): void {
  for (const box of rewardChests(world)) { world.state.containers.delete(box.id); forgetBirth(world, box.id); }
}

export function install(world: World): void {
  world.actions.choose = handleChoose;
  world.systems.push(expireChests);
  chainHook(world, "campCleared", (w, camp) => { rollChest(w, camp); });
  chainHook(world, "teleported", clearChests);
  chainHook(world, "runEnded", clearChests);
}
