// Run lifecycle + the fixed-step update. `step()` is the only entry point the Room ticks; arena.ts decides
// how a run ends.
import { MAX_PLAYERS, mulberry32, PLAYER_MAX_HP, RUN_START_KIT, type Vec2 } from "@raid/shared";
import { ItemState, PlayerState } from "@raid/shared/schema";
import { beginRun, downPlayer, markTickStart, settle, suddenDeath, unbankedGv } from "./arena";
import { InputQueue } from "./inputs";
import { advanceAlongPath, planPath, recordHistory } from "./movement";
import { emit, type SimEvent, type World } from "./world";

/**
 * Joins the lobby with a freshly minted RUN_START_KIT. Nothing is brought in from outside the run except `look`, the
 * packed cosmetics word (cosmetics.ts) the Room worked out from the profile: it is shown to everyone and changes nothing else.
 */
export function addPlayer(world: World, id: string, profile: string, look = 0): PlayerState {
  const s = world.state;
  const p = new PlayerState();
  p.name = profile;
  p.look = look >>> 0;
  p.hp = PLAYER_MAX_HP;
  p.maxHp = PLAYER_MAX_HP;
  p.status = "lobby";
  for (const def of RUN_START_KIT) {
    const item = new ItemState();
    item.uid = world.newItemUid();
    item.def = def;
    p.inventory.push(item);
  }
  const spot = lobbySpot(world, s.players.size);
  p.x = spot.x;
  p.y = spot.y;
  if (s.players.size === 0 && s.phase === "lobby") {
    s.lobbyEndsAt = s.serverTime + world.config.lobbySeconds * 1000;
  }
  s.players.set(id, p);
  world.players.set(id, {
    id,
    profile,
    inputs: new InputQueue(),
    path: [],
    history: [],
    nextAttackAt: 0,
    killedBy: null,
    gv: { kills: 0, mobs: 0, bounty: 0 },
    mobKills: 0,
    lastHit: null,
    damaged: new Set(),
    droppedAt: null,
    hpFracAtTickStart: 1,
    down: null,
    resolved: false,
  });
  return p;
}

/** Lobby placement only; real spawns are assigned (shuffled, distinct) when the raid starts. */
function lobbySpot(world: World, index: number): Vec2 {
  const spawns = world.map.spawns;
  return spawns[index % spawns.length]!;
}

function shuffledSpawns(world: World): Vec2[] {
  const out = world.map.spawns.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(world.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Removes a player whose client is gone for good. Leaving an active run counts as a death (MIA): their result
 * goes out at once and the next tick treats it like any other death.
 */
export function removePlayer(world: World, id: string): void {
  const p = world.state.players.get(id);
  const rt = world.players.get(id);
  if (p && rt && world.state.phase === "active") downPlayer(world, p, rt, "mia");
  world.state.players.delete(id);
  world.players.delete(id);
}

/**
 * Removes a player without resolving them: no result, no MIA, no body, no death. For a server shutdown, where the
 * run is void: from then on the run is frozen, so a tick between two abandons can't hand the rest a win (or a
 * death) in a run that no longer counts. Returns the GV they had earned and not yet banked, which the Room still pays.
 */
export function abandonPlayer(world: World, id: string): number {
  const rt = world.players.get(id);
  const gv = rt ? unbankedGv(rt) : 0;
  if (rt) rt.resolved = true;
  if (world.state.phase === "active") world.arena.voided = true;
  world.state.players.delete(id);
  world.players.delete(id);
  return gv;
}

export function startRaid(world: World): void {
  const s = world.state;
  s.phase = "active";
  s.raidStartedAt = s.serverTime;
  const spawns = shuffledSpawns(world);
  let i = 0;
  for (const [id, p] of s.players) {
    const spot = spawns[i++ % spawns.length]!;
    p.x = spot.x;
    p.y = spot.y;
    p.status = "alive";
    const rt = world.players.get(id)!;
    rt.inputs.drain();
    rt.history = [{ t: s.serverTime, x: p.x, y: p.y }];
  }
  beginRun(world);
  world.hooks.raidStarted?.(world);
  emit(world, { type: "raidStarted" });
}

function updateLobby(world: World): void {
  const s = world.state;
  for (const rt of world.players.values()) rt.inputs.drain();
  const n = s.players.size;
  if (n === 0) return;
  if (n >= world.config.minPlayers) {
    s.lobbyEndsAt = Math.min(s.lobbyEndsAt, s.serverTime + world.config.fillSeconds * 1000);
  }
  if (n >= MAX_PLAYERS || s.serverTime >= s.lobbyEndsAt) startRaid(world);
}

/**
 * Order in which players' inputs are applied on `tick`: a shuffle keyed by a server-secret salt
 * and the tick. With a fixed (or merely rotated) order, earlier joiners would win most same-tick
 * races for an item; this is fair for any subset of contenders and unpredictable to clients.
 */
export function actionOrder(world: World, tick = world.state.tick): string[] {
  const ids = [...world.state.players.keys()];
  const rng = mulberry32((world.orderSalt ^ Math.imul(tick, 0x9e3779b1)) >>> 0);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/** Actions → combat/DoT → arena (see arena.ts for why the order matters). */
function updateActive(world: World, dtMs: number): void {
  if (world.arena.voided) return;
  const s = world.state;
  const dt = dtMs / 1000;
  markTickStart(world);
  for (const id of actionOrder(world)) {
    const p = s.players.get(id)!;
    const rt = world.players.get(id)!;
    const { move, actions } = rt.inputs.drain();
    if (p.status !== "alive") continue;
    if (move) {
      // An unreachable click is ignored rather than treated as "stop".
      const path = move.kind === "move" ? planPath(world, p, move) : [];
      if (move.kind === "stop" || path.length > 0) rt.path = path;
    }
    for (const cmd of actions) {
      world.actions[cmd.kind]?.(world, p, rt, cmd);
      if (p.status !== "alive") break;
    }
    if (p.status === "alive") advanceAlongPath(p, rt, dt, (rt.aimFacingUntil ?? 0) > s.serverTime);
  }
  // Record after everyone has moved so hit tests see one consistent tick.
  for (const [id, p] of s.players) {
    if (p.status === "alive") recordHistory(world.players.get(id)!, p, s.serverTime);
  }
  for (const sys of world.systems) sys(world, dtMs);
  suddenDeath(world, dtMs);
  settle(world);
}

/** Advances the world by one fixed step and returns the events it produced. */
export function step(world: World, dtMs: number): SimEvent[] {
  const s = world.state;
  s.serverTime += dtMs;
  s.tick++;
  world.stepping = true;
  try {
    if (s.phase === "lobby") updateLobby(world);
    else if (s.phase === "active") updateActive(world, dtMs);
  } finally {
    world.stepping = false;
  }
  const out = world.events;
  world.events = [];
  return out;
}
