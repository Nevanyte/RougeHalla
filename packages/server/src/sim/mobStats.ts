import { MOB_STAT_CAP, mobStatCount, mobStatReward, mobStatText, type MobTypeId } from "@raid/shared";
import { syncMaxHp } from "./buffs";
import { recomputeMods } from "./mods";
import type { Combatant } from "./combatant";
import { emit, type World } from "./world";

/** Grants fixed per-kill progression. The multiplier/feed systems never touch this reward. */
export function grantMobStat(world: World, p: Extract<Combatant, { kind: "player" }>, id: MobTypeId | string, amount = 1): number {
  const reward = mobStatReward(id);
  if (!reward || p.s.status !== "alive" || p.rt.resolved || !Number.isFinite(amount) || amount < 0) return 0;
  const gained = Math.min(MOB_STAT_CAP - mobStatCount(p.s.mobStats, id), Math.floor(amount));
  if (gained <= 0) return 0;
  const count = mobStatCount(p.s.mobStats, id) + gained;
  p.s.mobStats.set(reward.id, count);
  recomputeMods(world, p);
  syncMaxHp(p.s);
  emit(world, { type: "toast", to: p.id, text: `${reward.name}: ${mobStatText(id, count)} (${count}/${MOB_STAT_CAP})${count === MOB_STAT_CAP ? " — MAX" : ""}` });
  return gained;
}
