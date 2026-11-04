import { MOB_STAT_COUNT_MAX, mobStatCount, mobStatReward, mobStatText, type MobTypeId } from "@raid/shared";
import { syncMaxHp } from "./buffs";
import { recomputeMods } from "./mods";
import type { Combatant } from "./combatant";
import { emit, type World } from "./world";

/**
 * Grants fixed per-kill progression. The multiplier/feed systems never touch this reward. `source` names the mob killed in the toast
 * when it is not `id`'s type (a camp whose buff another zone's type pays): "Ember Imp: +3 kill stacks of Pardoner · ...".
 */
export function grantMobStat(world: World, p: Extract<Combatant, { kind: "player" }>, id: MobTypeId | string, amount = 1, source?: string): number {
  const reward = mobStatReward(id);
  if (!reward || p.s.status !== "alive" || p.rt.resolved || !Number.isFinite(amount) || amount < 0) return 0;
  const gained = Math.floor(amount);
  if (!Number.isSafeInteger(gained) || gained > MOB_STAT_COUNT_MAX - mobStatCount(p.s.mobStats, id)) return 0;
  if (gained <= 0) return 0;
  const count = mobStatCount(p.s.mobStats, id) + gained;
  p.s.mobStats.set(reward.id, count);
  recomputeMods(world, p);
  syncMaxHp(p.s);
  const stacks = `+${gained} kill ${gained === 1 ? "stack" : "stacks"}`;
  const head = source && source !== reward.name ? `${source}: ${stacks} of ${reward.name}` : `${reward.name}: ${stacks}`;
  emit(world, { type: "toast", to: p.id, text: `${head} · ${mobStatText(id, count)} total` });
  return gained;
}
