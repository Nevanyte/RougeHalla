// Training: the practice room (RoomMode "training", SimConfig.training). One player, Phase 9's setup next to their spawn (dummies
// that never die and a rack of every weapon: sim/mobs.ts spawnTraining, switched on by SimConfig.dummies), and none of the
// run's consequences: there is no patience timer, teleport or sudden death, no result, no GV and nothing recorded on the
// profile. Whoever goes down is put back on their feet. Everything here sits behind the flag: an arena world never reaches it.
import { chainHook, type World } from "./world";
import { resetWeapons } from "./weapons";

/**
 * Switches a freshly created world to training. The room calls this right after createGameWorld, and passes
 * `{ dummies: true, training: true }` in the config so the training setup is placed when the run starts.
 */
export function installTraining(world: World): void {
  world.state.training = true;
  // A fighter keeps their weapons when they go down: they are revived at once, not looted.
  world.hooks.dropBody = () => {};
  // beginRun arms the patience timer; nothing here ever teleports, so show none.
  chainHook(world, "raidStarted", (w) => {
    w.state.patienceEndsAt = 0;
  });
}

/**
 * Replaces the end of an active tick (sudden death and settle) in a training world. Nobody's run is settled here, so no
 * result is sent and nothing is banked (the Room refuses a `resolved` event in training in any case: a down between ticks
 * still emits one). Whoever is down, whether it happened this tick (a shield dummy's reflected arrow can hurt its shooter)
 * or between ticks, is revived at full health where they fell. A player removed from the world (MIA) is simply gone.
 */
export function trainingSettle(world: World): void {
  const a = world.arena;
  a.downedThisTick = [];
  a.downsBetweenTicks = 0;
  for (const [id, p] of world.state.players) {
    if (p.status !== "dead") continue;
    const rt = world.players.get(id);
    if (!rt) continue;
    rt.down = null;
    rt.resolved = false;
    rt.killedBy = null;
    rt.lastHit = null;
    rt.path = [];
    // Revived where it fell, at rest: the samples from before the fall would otherwise give a slide on ice the speed it died at.
    rt.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
    rt.slip = null;
    p.status = "alive";
    p.hp = p.maxHp;
    resetWeapons({ kind: "player", id: rt.id, s: p, rt });
  }
}
