// Raid lifecycle + the fixed-step update. `step()` is the only entry point the Room ticks.
import {
  MAX_PLAYERS, mulberry32, PLAYER_MAX_HP, type ItemDTO, type RaidOutcome, type RaidResult, type Vec2,
} from "@raid/shared";
import { ItemState, PlayerState } from "@raid/shared/schema";
import { InputQueue } from "./inputs";
import { advanceAlongPath, planPath, recordHistory } from "./movement";
import { emit, type PlayerRuntime, type SimEvent, type World } from "./world";

export function addPlayer(world: World, id: string, profile: string, items: ItemDTO[]): PlayerState {
  const s = world.state;
  const p = new PlayerState();
  p.name = profile;
  p.hp = PLAYER_MAX_HP;
  p.maxHp = PLAYER_MAX_HP;
  p.status = "lobby";
  for (const it of items) {
    const item = new ItemState();
    item.uid = it.uid;
    item.def = it.def;
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
    extracting: null,
    broughtIn: items.map((i) => ({ ...i })),
    killedBy: null,
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
 * Removes a player whose client is gone for good. An alive player in an active raid
 * is resolved as MIA first (they lose what they carried).
 */
export function removePlayer(world: World, id: string): void {
  const p = world.state.players.get(id);
  const rt = world.players.get(id);
  if (p && rt && p.status === "alive") resolvePlayer(world, p, rt, "mia");
  world.state.players.delete(id);
  world.players.delete(id);
}

export function resolvePlayer(
  world: World, p: PlayerState, rt: PlayerRuntime, outcome: RaidOutcome,
): void {
  if (rt.resolved) return;
  rt.resolved = true;
  rt.path = [];
  rt.extracting = null;
  p.extractProgress = 0;
  p.status = outcome === "died" ? "dead" : outcome;

  const carried: ItemDTO[] = p.inventory.map((i) => ({ uid: i.uid, def: i.def }));
  const carriedUids = new Set(carried.map((i) => i.uid));
  const s = world.state;
  const result: RaidResult = {
    outcome,
    profile: rt.profile,
    durationSec: s.raidStartedAt > 0 ? Math.round((s.serverTime - s.raidStartedAt) / 1000) : 0,
    kills: p.kills,
    killedBy: rt.killedBy,
    broughtIn: rt.broughtIn,
    extracted: outcome === "extracted" ? carried : [],
    lost: outcome === "extracted" ? rt.broughtIn.filter((i) => !carriedUids.has(i.uid)) : carried,
  };
  if (outcome === "extracted") p.inventory.clear();
  else world.hooks.dropBody(world, p);
  emit(world, { type: "resolved", id: rt.id, result });
}

export function startRaid(world: World): void {
  const s = world.state;
  s.phase = "active";
  s.raidStartedAt = s.serverTime;
  s.raidEndsAt = s.serverTime + world.config.raidSeconds * 1000;
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
  emit(world, { type: "raidStarted" });
}

function endRaid(world: World): void {
  const s = world.state;
  for (const [id, p] of s.players) {
    if (p.status === "alive") resolvePlayer(world, p, world.players.get(id)!, "mia");
  }
  s.phase = "ended";
  emit(world, { type: "raidEnded" });
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

function updateActive(world: World, dtMs: number): void {
  const s = world.state;
  const dt = dtMs / 1000;
  for (const id of actionOrder(world)) {
    const p = s.players.get(id)!;
    const rt = world.players.get(id)!;
    const { move, actions } = rt.inputs.drain();
    if (p.status !== "alive") continue;
    if (move) {
      // An unreachable click is ignored rather than treated as "stop".
      const path = move.kind === "move" ? planPath(world, p, move) : [];
      if (move.kind === "stop" || path.length > 0) {
        rt.path = path;
        if (rt.extracting) { rt.extracting = null; p.extractProgress = 0; }
      }
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

  if (s.serverTime >= s.raidEndsAt) { endRaid(world); return; }
  let alive = 0;
  for (const p of s.players.values()) if (p.status === "alive") alive++;
  if (alive === 0) endRaid(world);
}

/** Advances the world by one fixed step and returns the events it produced. */
export function step(world: World, dtMs: number): SimEvent[] {
  const s = world.state;
  s.serverTime += dtMs;
  s.tick++;
  if (s.phase === "lobby") updateLobby(world);
  else if (s.phase === "active") updateActive(world, dtMs);
  const out = world.events;
  world.events = [];
  return out;
}
