// One owned combatant per Plague. Its entries keep the zombie id (no borrowed on-hits or disease); reward and PvP readers
// resolve ownership explicitly. It has no regional mob brain, reward path, corpse, regeneration or automatic resurrection.
import {
  circleClear, decodeMult, hasLineOfSight, MASK_MOVE, PLAGUE_ZOMBIE_ASSIST_MS, PLAGUE_ZOMBIE_ASSIST_RANGE, plagueZombieStats,
  PLAYER_RADIUS, type Vec2,
} from "@raid/shared";
import { MobState } from "@raid/shared/schema";
import { combatant, hostile, isEvading, standing, type Combatant } from "./combatant";
import { displace } from "./displace";
import { InputQueue } from "./inputs";
import { isStunned, isUntargetable } from "./status";
import { canPlayerSeeActor } from "./vision";
import { cancelAction } from "./weapons";
import { chainHook, collisionMap, emit, newWeaponRuntime, type World } from "./world";

type Zombie = Extract<Combatant, { kind: "mob" }>;
type Owner = Extract<Combatant, { kind: "player" }>;
const FOLLOW_DISTANCE = 48;
const REPATH_MS = 250;

/** Prefer a body-clear spot behind the owner. No random draw and no teleport through a wall. */
function besideOwner(world: World, p: Vec2 & { facing: number }): Vec2 {
  const map = collisionMap(world);
  for (const distance of [32, 24, 16]) for (const turn of [Math.PI, Math.PI / 2, -Math.PI / 2, 0]) {
    const a = p.facing + turn;
    const at = { x: p.x + Math.cos(a) * distance, y: p.y + Math.sin(a) * distance };
    if (circleClear(map, at, PLAYER_RADIUS) && hasLineOfSight(map, p, at, MASK_MOVE)) return at;
  }
  return { x: p.x, y: p.y }; // the owner's own standing position is always a valid final fallback
}

function resetCombat(world: World, z: Zombie): void {
  z.rt.inputs.drain(); z.rt.path = []; z.rt.slip = null;
  cancelAction(world, z);
  z.rt.weapon.held = false; z.rt.weapon.bufferedUntil = 0; z.rt.weapon.rootUntil = 0;
  if (z.rt.zombie) { z.rt.zombie.target = null; z.rt.zombie.assistUntil = 0; z.rt.zombie.lastMoveAt = 0; }
}

function syncStats(owner: Owner, z: Zombie, revive = false): void {
  const stats = plagueZombieStats(owner.s.maxHp, owner.s.corpseStacks);
  const gained = stats.maxHp - z.s.maxHp;
  z.s.maxHp = stats.maxHp;
  z.s.hp = revive ? stats.maxHp : Math.min(stats.maxHp, z.s.hp + Math.max(0, gained));
}

/** Called only after an authorized corpse has been removed and its owner's max-health growth has been folded. */
export function raiseOrGrowZombie(world: World, owner: Owner): void {
  const p = owner.s;
  const id = p.plagueZombieId || `pz:${owner.id}`;
  let z = combatant(world, id);
  const revive = !z || !standing(z);
  if (!z) {
    const m = new MobState();
    m.kind = "zombie"; m.faction = "plague"; m.ownerId = owner.id; m.name = `${p.name}'s Zombie`;
    m.hp = m.maxHp = 0;
    world.state.mobs.set(id, m);
    world.mobs.set(id, {
      id, inputs: new InputQueue(), path: [], history: [], weapon: newWeaponRuntime(), lastHitAt: 0,
      zombie: { get damage() { return plagueZombieStats(p.maxHp, p.corpseStacks).damage; }, target: null, assistUntil: 0,
        lastMoveAt: 0, ownerDisplaceSeq: p.displaceSeq },
    });
    z = combatant(world, id);
  }
  if (!z || z.kind !== "mob" || z.s.kind !== "zombie" || z.s.ownerId !== owner.id) return;
  p.plagueZombieId = id;
  syncStats(owner, z, revive);
  if (revive) {
    resetCombat(world, z);
    z.rt.statuses = [];
    z.s.status = "alive"; z.s.sig = 0; z.s.brand = 0; z.s.effects = 0; z.s.readyAt = world.state.serverTime;
    displace(world, z, besideOwner(world, p));
    z.rt.zombie!.ownerDisplaceSeq = p.displaceSeq;
  }
}

/** A killable companion's sole way down. It pays nothing and stays dead until its owner consumes another body. */
export function hurtZombie(world: World, z: Zombie, amounts: readonly number[]): number {
  if (z.s.kind !== "zombie" || z.s.status !== "alive") return 0;
  if ((world.state.players.get(z.s.ownerId)?.immuneUntil ?? 0) > world.state.serverTime) return 0;
  const total = amounts.reduce((n, a) => n + Math.max(0, a), 0);
  const before = z.s.hp;
  z.s.hp = Math.max(0, before - total); z.rt.lastHitAt = world.state.serverTime;
  if (z.s.hp <= 0) {
    z.s.status = "dead"; resetCombat(world, z);
    emit(world, { type: "fx", fx: { kind: "death", id: z.id, x: z.s.x, y: z.s.y, by: null } });
    world.hooks.fighterOut?.(world, z.id, "down");
  }
  return before - z.s.hp;
}

function removeOwned(world: World, ownerId: string): void {
  const p = world.state.players.get(ownerId);
  const id = p?.plagueZombieId || `pz:${ownerId}`;
  const z = combatant(world, id);
  if (z?.kind === "mob" && z.s.kind === "zombie") {
    resetCombat(world, z); world.state.mobs.delete(id); world.mobs.delete(id);
  }
  if (p) p.plagueZombieId = "";
}

function eligibleTarget(world: World, owner: Owner, z: Zombie, id: string | null): Combatant | null {
  const t = id ? combatant(world, id) : null;
  if (!t || !standing(t) || !hostile(z, t) || isEvading(t) || isUntargetable(world, t)
    || Math.hypot(t.s.x - owner.s.x, t.s.y - owner.s.y) > PLAGUE_ZOMBIE_ASSIST_RANGE
    || !canPlayerSeeActor(world, owner.id, t.id, t.s)) return null;
  return t;
}

/** Zombies follow paths through the same input queue, movement, windups and collision code as every other combatant. */
export function updateZombies(world: World): void {
  const now = world.state.serverTime;
  for (const [id, rt] of world.mobs) {
    if (!rt.zombie) continue;
    const z = combatant(world, id), owner = combatant(world, world.state.mobs.get(id)?.ownerId ?? "");
    if (!z || z.kind !== "mob") continue;
    if (!owner || owner.kind !== "player" || !standing(owner) || owner.s.faction !== "plague") { removeOwned(world, z.s.ownerId); continue; }
    if (!standing(z)) continue;
    syncStats(owner, z);
    if (rt.zombie.ownerDisplaceSeq !== owner.s.displaceSeq) {
      resetCombat(world, z); displace(world, z, besideOwner(world, owner.s));
      rt.zombie.ownerDisplaceSeq = owner.s.displaceSeq;
    }
    if (isStunned(world, z)) continue;
    const t = eligibleTarget(world, owner, z, owner.s.attackTarget)
      ?? (now < rt.zombie.assistUntil ? eligibleTarget(world, owner, z, rt.zombie.target) : null);
    const follow = Math.hypot(z.s.x - owner.s.x, z.s.y - owner.s.y) > PLAGUE_ZOMBIE_ASSIST_RANGE;
    const target = follow ? null : t;
    const goal = target?.s ?? owner.s;
    const a = Math.atan2(goal.y - z.s.y, goal.x - z.s.x);
    const distance = Math.hypot(goal.x - z.s.x, goal.y - z.s.y);
    const canHit = target && distance <= 66 && hasLineOfSight(collisionMap(world), z.s, target.s, MASK_MOVE);
    if (canHit) {
      if (rt.path.length > 0) rt.inputs.pushMove({ kind: "stop" });
      rt.inputs.pushAim(a);
      if (!rt.weapon.held) rt.inputs.pushAction({ kind: "attack", a });
    } else {
      if (rt.weapon.held) rt.inputs.pushAction({ kind: "release", a });
      const wantsMove = target || distance > FOLLOW_DISTANCE;
      if (wantsMove && (now - rt.zombie.lastMoveAt >= REPATH_MS || rt.path.length === 0)) {
        rt.inputs.pushMove({ kind: "move", x: goal.x, y: goal.y }); rt.zombie.lastMoveAt = now;
      } else if (!wantsMove && rt.path.length > 0) rt.inputs.pushMove({ kind: "stop" });
    }
  }
}

export function install(world: World): void {
  world.moveModifiers.push((w, c) => {
    if (c.kind !== "mob" || c.s.kind !== "zombie") return 1;
    const owner = w.state.players.get(c.s.ownerId);
    if (!owner) return 1;
    const catchup = Math.hypot(owner.x - c.s.x, owner.y - c.s.y) > FOLLOW_DISTANCE * 2 ? 1.25 : 1;
    return Math.max(1, decodeMult(owner.speedMult)) * catchup;
  });
  // Owner max-health changes in an input apply before this tick's damage; mirror folds later in the tick update them again.
  world.afterWeapons.push(w => {
    for (const [id, rt] of w.mobs) if (rt.zombie) {
      const z = combatant(w, id), owner = combatant(w, w.state.mobs.get(id)?.ownerId ?? "");
      if (z?.kind === "mob" && standing(z) && owner?.kind === "player" && standing(owner)) syncStats(owner, z);
    }
  });
  world.systems.push(updateZombies);
  chainHook(world, "hitLanded", (w, e, applied) => {
    if (!(applied > 0) || e.weapon === null || e.sig || e.dot || e.passive || e.derived || e.ability) return;
    const p = w.state.players.get(e.by.id);
    const rt = p?.plagueZombieId ? w.mobs.get(p.plagueZombieId)?.zombie : undefined;
    if (p?.faction === "plague" && rt) { rt.target = e.victim; rt.assistUntil = w.state.serverTime + PLAGUE_ZOMBIE_ASSIST_MS; }
  });
  chainHook(world, "fighterOut", (w, id) => { if (w.state.players.has(id)) removeOwned(w, id); });
  chainHook(world, "teleported", (w) => {
    for (const p of w.state.players.values()) {
      const z = p.plagueZombieId ? combatant(w, p.plagueZombieId) : null;
      if (z?.kind === "mob" && standing(z)) {
        resetCombat(w, z); displace(w, z, besideOwner(w, p)); z.rt.zombie!.ownerDisplaceSeq = p.displaceSeq;
      }
    }
  });
  chainHook(world, "runEnded", w => { for (const id of w.players.keys()) removeOwned(w, id); });
}
