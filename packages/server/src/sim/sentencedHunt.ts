import {
  isMovingTowardHuntTarget, SENTENCED_HUNT_MARK_PER_STACK, SENTENCED_HUNT_MOVE_BONUS,
  sentencedHuntMarkMultiplier,
} from "@raid/shared";
import type { Combatant } from "./combatant";
import type { ActionHandler, World } from "./world";
import { chainHook, emit } from "./world";

export { SENTENCED_HUNT_MARK_PER_STACK, SENTENCED_HUNT_MOVE_BONUS, sentencedHuntMarkMultiplier };

function toast(world: World, id: string, text: string): void {
  emit(world, { type: "toast", to: id, text });
}

export const handleHuntTarget: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "huntTarget" || c.kind !== "player") return;
  const hunter = c.s;
  if (world.state.phase !== "active" || world.config.training || hunter.status !== "alive" || hunter.faction !== "sentenced") return;
  const current = world.state.players.get(hunter.huntTarget);
  if (current?.status === "alive") return;
  const target = world.state.players.get(cmd.id);
  if (!target || cmd.id === c.id || target.status !== "alive") return;
  hunter.huntTarget = cmd.id;
  toast(world, c.id, `Hunting ${target.name} · ${target.faction}`);
};

export function huntMoveMultiplier(world: World, c: Combatant): number {
  if (c.kind !== "player" || c.s.faction !== "sentenced" || c.s.status !== "alive" || !c.s.huntTarget) return 1;
  const target = world.state.players.get(c.s.huntTarget);
  if (!target || target.status !== "alive") return 1;
  const next = c.rt.path[0];
  if (!next) return 1;
  const direction = { x: next.x - c.s.x, y: next.y - c.s.y };
  const toTarget = { x: target.x - c.s.x, y: target.y - c.s.y };
  return isMovingTowardHuntTarget(direction, toTarget) ? 1 + SENTENCED_HUNT_MOVE_BONUS : 1;
}

function fighterOut(world: World, id: string, cause: "down" | "removed"): void {
  const player = world.state.players.get(id);
  if (player) player.huntTarget = "";
  const realDeath = cause === "down" && player?.status === "dead" && world.state.phase === "active" && !world.config.training;
  for (const [hunterId, hunter] of world.state.players) {
    if (hunter.huntTarget !== id) continue;
    hunter.huntTarget = "";
    if (!realDeath || hunterId === id || hunter.status !== "alive" || hunter.faction !== "sentenced") continue;
    const stacks = Number.isFinite(hunter.huntStacks) ? Math.max(0, hunter.huntStacks) : 0;
    hunter.huntStacks = stacks + 1;
    toast(world, hunterId, `Hunt complete: +${Math.round(SENTENCED_HUNT_MARK_PER_STACK * 100)}% mark strength`);
  }
}

/** Install after player state and faction actions exist; gameplay.ts owns module registration. */
export function install(world: World): void {
  world.actions.huntTarget = handleHuntTarget;
  world.moveModifiers.push(huntMoveMultiplier);
  chainHook(world, "fighterOut", fighterOut);
  chainHook(world, "runEnded", (w) => {
    for (const p of w.state.players.values()) p.huntTarget = "";
  });
}
