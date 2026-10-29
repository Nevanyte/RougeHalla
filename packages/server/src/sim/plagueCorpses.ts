// Plague automatically harvests public player-death remains by walking over them. Ordinary loot/body containers
// are separate: a weapon pickup can never grant a corpse stack or raise a zombie.
import {
  FACTIONS, hasLineOfSight, MASK_MOVE, PLAGUE_CORPSE_AUTO_RANGE, PLAGUE_CORPSE_HEAL_SHARE,
  PLAGUE_CORPSE_HP_SHARE, PLAGUE_CORPSE_INTERACT_RANGE, PLAGUE_CORPSE_LIFETIME_MS,
} from "@raid/shared";
import { PlagueCorpseState } from "@raid/shared/schema";
import { combatant } from "./combatant";
import type { ActionHandler, World } from "./world";
import { chainHook, collisionMap, emit, tieRank } from "./world";
import { recomputeMods } from "./mods";
import { syncMaxHp } from "./buffs";
import { heal } from "./factions";
import { actionBlocked } from "./status";
import { raiseOrGrowZombie } from "./plagueZombies";

export { PLAGUE_CORPSE_AUTO_RANGE, PLAGUE_CORPSE_HEAL_SHARE, PLAGUE_CORPSE_HP_SHARE,
  PLAGUE_CORPSE_INTERACT_RANGE, PLAGUE_CORPSE_LIFETIME_MS };

function toast(world: World, id: string, text: string): void {
  emit(world, { type: "toast", to: id, text });
}

/** One marker is left for a real death, never a disconnect/MIA or a training revival. */
function leaveCorpse(world: World, id: string, cause: "down" | "removed"): void {
  if (cause !== "down" || world.config.training || world.state.phase !== "active") return;
  const player = world.state.players.get(id);
  if (!player || player.status !== "dead") return;
  const corpse = new PlagueCorpseState();
  // Each real player falls once per raid; corpse IDs must not shift the allocation of ordinary loot.
  corpse.id = `pc:${id}`;
  corpse.playerId = id;
  corpse.playerName = player.name;
  corpse.x = player.x;
  corpse.y = player.y;
  corpse.expiresAt = world.state.serverTime + PLAGUE_CORPSE_LIFETIME_MS;
  world.state.plagueCorpses.set(corpse.id, corpse);
}

export const handleConsumeCorpse: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "consumeCorpse" || c.kind !== "player") return;
  const p = c.s;
  if (p.status !== "alive") { toast(world, c.id, "Only the living can consume a corpse"); return; }
  if (p.faction !== "plague") { toast(world, c.id, "Only Plague can consume corpses"); return; }
  if (actionBlocked(world, c)) { toast(world, c.id, "Can't do that now"); return; }
  const corpse = world.state.plagueCorpses.get(cmd.corpseId);
  if (!corpse) { toast(world, c.id, "That corpse is gone"); return; }
  if (world.state.serverTime >= corpse.expiresAt) {
    world.state.plagueCorpses.delete(corpse.id);
    toast(world, c.id, "That corpse has decayed");
    return;
  }
  if (Math.hypot(p.x - corpse.x, p.y - corpse.y) > PLAGUE_CORPSE_INTERACT_RANGE) {
    toast(world, c.id, "Too far away");
    return;
  }
  if (!hasLineOfSight(collisionMap(world), p, corpse, MASK_MOVE)) {
    toast(world, c.id, "Can't reach that");
    return;
  }

  // Removing first makes simultaneous attempts a single-winner race in the server's shuffled action order.
  world.state.plagueCorpses.delete(corpse.id);
  p.corpseStacks = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(p.corpseStacks)) + 1);
  const hpBefore = p.hp;
  recomputeMods(world, c);
  syncMaxHp(p);
  // syncMaxHp normally carries a max-health increase onto the current bar. For corpses the reward specifies a heal
  // that goes through the ordinary heal rules, so undo that implicit carry and apply the single explicit heal instead.
  p.hp = Math.min(hpBefore, p.maxHp);
  heal(world, c, FACTIONS.plague.hp * PLAGUE_CORPSE_HEAL_SHARE);
  raiseOrGrowZombie(world, c);
  toast(world, c.id, `Consumed ${corpse.playerName}'s corpse: +3% max health, zombie raised or strengthened`);
};

/** Gameplay assembly may call this after installing mods and faction signatures. */
export function install(world: World): void {
  world.actions.consumeCorpse = handleConsumeCorpse;
  chainHook(world, "fighterOut", leaveCorpse);
  world.systems.push((w) => {
    for (const [id, corpse] of w.state.plagueCorpses) {
      if (w.state.serverTime >= corpse.expiresAt) w.state.plagueCorpses.delete(id);
    }
    if (w.state.phase !== "active" || w.config.training || w.state.plagueCorpses.size === 0) return;
    // Movement and damage have finished. The same shuffled tick order settles overlapping contenders, independently
    // of join order; removing each corpse inside the shared handler makes it available to exactly one player.
    const order = [...w.state.players.keys()].sort((a, b) =>
      (w.combat.rank.get(a) ?? Infinity) - (w.combat.rank.get(b) ?? Infinity) || tieRank(w, a) - tieRank(w, b));
    for (const id of order) {
      const c = combatant(w, id);
      if (!c || c.kind !== "player" || c.s.status !== "alive" || c.rt.down || c.rt.resolved
        || c.s.faction !== "plague" || actionBlocked(w, c)) continue;
      for (const corpse of w.state.plagueCorpses.values()) {
        if (Math.hypot(c.s.x - corpse.x, c.s.y - corpse.y) > PLAGUE_CORPSE_AUTO_RANGE
          || !hasLineOfSight(collisionMap(w), c.s, corpse, MASK_MOVE)) continue;
        handleConsumeCorpse(w, c, { kind: "consumeCorpse", corpseId: corpse.id });
      }
    }
  });
  chainHook(world, "runEnded", (w) => { w.state.plagueCorpses.clear(); });
}
