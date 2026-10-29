// Elite death augments (mob progression, ROGUELIKE_PLAN 3.3, D1-D3, D12, D16, D17).
//
//   - The drop: a credited elite death creates a reward chest on the camp's chest tile (CampDef.chest; centre if blocked).
//     The options are interactive augments rolled from world.rewardRandom; eligible pickers' builds determine which are available.
//     (public by design, D17). It expires CHEST_SECONDS after the drop (`expiresAt`), never extended.
//   - `choose` (an action, so within a tick picks resolve in the shuffled actionOrder; step.ts runs actions only for alive
//     players in an active run). Checked in this order, each refusal a private toast that uses up nothing:
//       the picker is a standing player (not down, no result out) .......................... silent
//       the picker is not stunned or casting (status.ts actionBlocked, as for a pickup) ...... "Can't do that now"
//       the chest exists, is a reward, is not younger than one tick (a chest born in a tick's ledger pass is first pickable
//       two ticks on: holdBirth), and now < expiresAt ....................................... "Chest gone"
//       the picker's SERVER position is within CHEST_RANGE of the chest's centre ............ "Too far away"
//       with line of sight on collisionMap(world) ......................................... "Can't reach that"
//       the picker has not picked here yet (an option or a skip) ........................... "You already picked"
//       a skip, or an option index the chest has (else ignored) ........................... silent
//       the option is free ................................................................ "Already taken"
//       a conditional needs a card of its base in the picker's build ....................... "Needs <Base title>"
//       a unique card (a conditional or an augment) is not already held ..................... "Already yours"
//     Then the option is theirs (`takenBy`), they join `pickers`, the card is added to PlayerState.build (a base card stacks),
//     the mods are folded again at once (sim/mods.ts; max hp follows), and a `chestTaken` fx goes out. A skip (`pick` -1) joins
//     `pickers` and pays D12: heal SKIP_HEAL_SHARE of max hp through heal() (the 3 s lockout applies); if that heals nothing
//     (in combat, or at full hp), GV_SKIP GV under GV_MOB_CAP (arena.ts awardSkipGv); `chestTaken` with option -1.
//   - Removal: the `expireChests` system removes a chest in the tick serverTime reaches `expiresAt` (after that tick's
//     inputs, which already refuse it); the coliseum teleport and the end of the run remove every chest.
// Reward containers are never weapon containers: `pickup` refuses them (loot.ts), and they hold no items.
import {
  CHEST_RANGE, CHEST_REFUSAL, CHEST_SECONDS, cardBlock, cardDef, cardLive, countIn, hasLineOfSight, isEliteCamp, isInteractiveAugment, isSolidAt, rollChestOptions,
  SKIP_HEAL_SHARE, type FactionId, type Vec2,
} from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { awardSkipGv } from "./arena";
import { syncMaxHp } from "./buffs";
import { campContribOf, eligibleContributors } from "./campHeal";
import { standing, type Combatant } from "./combatant";
import { heal } from "./factions";
import { addContainer, bornThisTick, forgetBirth, holdBirth } from "./loot";
import { recomputeMods } from "./mods";
import { actionBlocked } from "./status";
import { chainHook, collisionMap, emit, type ActionHandler, type World } from "./world";

export const REWARD_LABEL = "Augment Chest";

const elitePickers = new WeakMap<World, Map<number, ReadonlySet<string>>>();

/** Preserve contributor IDs before a clear forgets them. Eligibility is checked after the full damage pass. */
export function snapshotElitePickers(world: World, camp: number): void {
  if (camp < 0) return;
  let byCamp = elitePickers.get(world);
  if (!byCamp) elitePickers.set(world, byCamp = new Map());
  byCamp.set(camp, campContribOf(world, camp));
}

function toast(world: World, to: string, text: string): void {
  emit(world, { type: "toast", to, text });
}

/**
 * A reward container at `at` with these options (card ids, in card order), expiring CHEST_SECONDS from now. `camp` is the
 * camp's index in map.camps (stored + 1), or omitted for a chest that belongs to no camp (the training console's).
 */
export function dropRewardChest(world: World, at: Vec2, options: readonly string[], camp?: number): ContainerState {
  const box = addContainer(world, "reward", at, REWARD_LABEL, []);
  holdBirth(world, box.id); // a chest born in a ledger pass is first pickable two ticks on (an id guessed blind wins nothing)
  box.camp = camp !== undefined && camp >= 0 ? camp + 1 : 0;
  box.expiresAt = world.state.serverTime + CHEST_SECONDS * 1000;
  for (const id of options) {
    box.options.push(id);
    box.takenBy.push("");
  }
  return box;
}

/** Where camp `camp`'s chest stands: its chest tile, or its centre when nobody can stand on that tile (a wall or LOW ground). */
export function chestSpot(world: World, camp: number): Vec2 | null {
  const def = world.map.camps[camp];
  if (!def) return null;
  return isSolidAt(world.map, def.chest.x, def.chest.y) ? { x: def.x, y: def.y } : { x: def.chest.x, y: def.chest.y };
}

/**
 * Rolls camp `camp`'s chest (world.rewardRandom only) and drops it. An elite camp rolls the elite tier odds; the conditional card
 * and the augment read the builds of the camp's eligible contributors (none: no conditional). Null for a camp the map does not have.
 */
export function rollChest(world: World, camp: number, elite = false, zone?: FactionId): ContainerState | null {
  const def = world.map.camps[camp];
  const at = chestSpot(world, camp);
  if (!def || !at) return null;
  const contributors = elite ? elitePickers.get(world)?.get(camp) : undefined;
  const pickers = eligibleContributors(world, camp, contributors).map((c) => c.s.build);
  elitePickers.get(world)?.delete(camp);
  return dropRewardChest(world, at, rollChestOptions(world.rewardRandom, { elite: elite || isEliteCamp(def), pickers, ...(zone ? { zone } : {}) }), camp);
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
  if (!cardDef(id) || !cardLive(id) || !isInteractiveAugment(id)) return; // only live interactive augments are pickable
  const block = cardBlock(id, p.build);
  if (block) { toast(world, c.id, block.text); return; } // "Needs <Base>" or CHEST_REFUSAL.owned
  box.takenBy[i] = c.id;
  box.pickers.push(c.id);
  grantCard(world, c, id);
  emit(world, { type: "fx", fx: { kind: "chestTaken", chest: box.id, by: c.id, option: i } });
};

/**
 * One copy of card `id` for a player: the build's count goes up by one (a base card stacks; a unique card is held once). The mods are
 * folded again at once (the card acts from this tick on) and max hp follows. Returns the new count, or null (an unknown id, a unique
 * card already held, or a conditional without a card of its base). The chest's pick goes through here, and so do a quest's card and
 * the training console's.
 */
export function grantCard(world: World, c: Extract<Combatant, { kind: "player" }>, id: string): number | null {
  if (!cardDef(id) || cardBlock(id, c.s.build)) return null;
  const count = Math.min(255, countIn(c.s.build, id) + 1);
  c.s.build.set(id, count);
  recomputeMods(world, c);
  syncMaxHp(c.s);
  return count;
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
  chainHook(world, "mobKilled", (w, _killer, mob) => {
    if (!mob.elite) return;
    if (mob.camp >= 0) rollChest(w, mob.camp, true, mob.zone);
    else dropRewardChest(w, mob.at, rollChestOptions(w.rewardRandom, { elite: true, zone: mob.zone }));
  });
  chainHook(world, "teleported", clearChests);
  chainHook(world, "runEnded", clearChests);
}
