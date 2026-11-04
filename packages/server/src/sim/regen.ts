// Passive player health regeneration: slow, and out of combat only. With no hit dealt or taken for PLAYER_REGEN_QUIET_MS a
// standing player regains PLAYER_REGEN_SHARE_OUT of max hp a second; in a fight PLAYER_REGEN_SHARE_IN (0: none). It runs as a system
// after the damage pass (this tick's hits have stamped the clock), keeps its own combat clock from `combat.landed` (so it
// works without the faction layer, as terrain's light does), goes through heal() so anti-heal and the healTaken cards
// apply, and is quiet (no fx) and feeds no Second Skin barrier. Off unless `SimConfig.regen`.
import { PLAYER_REGEN_QUIET_MS, PLAYER_REGEN_SHARE_IN, PLAYER_REGEN_SHARE_OUT } from "@raid/shared";
import { standingCombatants } from "./combatant";
import { heal } from "./factions";
import { chainHook, type World } from "./world";

const lastCombat = new WeakMap<World, Map<string, number>>();

function clockOf(world: World): Map<string, number> {
  let m = lastCombat.get(world);
  if (!m) { m = new Map(); lastCombat.set(world, m); }
  return m;
}

function regenPass(world: World, dtMs: number): void {
  if (!world.config.regen) return;
  const clock = clockOf(world);
  const now = world.state.serverTime;
  for (const h of world.combat.landed) {
    clock.set(h.victim, now);
    clock.set(h.by, now);
  }
  // The locked coliseum is sudden death's ground: no regeneration against its burn.
  if (world.state.gatesLocked) return;
  for (const c of standingCombatants(world)) {
    if (c.kind !== "player" || c.s.hp >= c.s.maxHp) continue;
    const last = clock.get(c.id);
    const quiet = last === undefined || now - last >= PLAYER_REGEN_QUIET_MS;
    const share = quiet ? PLAYER_REGEN_SHARE_OUT : PLAYER_REGEN_SHARE_IN;
    if (share <= 0) continue;
    heal(world, c, c.s.maxHp * share * (dtMs / 1000), { quiet: true, ignoreLockout: true, noBarrier: true, source: "regen" });
  }
}

export function install(world: World): void {
  world.systems.push(regenPass);
  chainHook(world, "raidStarted", (w) => clockOf(w).clear());
}
