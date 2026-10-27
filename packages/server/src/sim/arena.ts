// Arena lifecycle: how players go down, who wins, the patience timer, the coliseum teleport and sudden death.
//
// step.ts runs an active tick as: tick-start snapshot → inputs (shuffled) → abilities (status expiry, casts landing,
// zones) → target locks → weapon state machines → afterWeapons → movement → history → projectile sweep → spawns → melee →
// beforeDamage (signature damage, then status damage, then sudden death's burn) → the damage ledger, all at once (status
// changes made inside it wait for its end) → systems → settle.
// Everything that takes a player out of the fight goes through downPlayer(), and settle() is the only place where
// results are emitted during a step and where the run ends, so the shuffled order players were processed in never
// decides who won:
//   - Any death (a leave counts) restarts the patience timer, unlocks the gates and cancels sudden death, even in
//     the tick the timer expires: that tick has no teleport. The timer's length scales with the players standing
//     (patienceSecondsFor), counted after the deaths that restarted it.
//   - A player in their reconnect grace is still "alive": they count toward the survivors and can still be hit.
//   - The run ends when nobody is alive, or, in a contested run (2+ starters), when one player is. A lone
//     survivor wins. With nobody left, the players who went down in this last tick are compared by hp fraction at
//     the start of the tick: a single highest wins, an exact tie is a draw for those tied. Solo runs have no winner.
//   - GV earned during the run (kills, mobs, bounties) is kept whatever the outcome. The winner also gets GV_WIN, but
//     only when the run went active with WIN_BONUS_MIN_PLAYERS and they damaged WIN_BONUS_MIN_OPPONENTS different
//     players (so a second callsign can't feed someone wins). All of it banks when the player's result is emitted (the
//     Room persists `resolved` events).
//   - Bounty: a player's bounty follows their player kills (bountyFor; mob kills feed the buffs and the mob reward curve, never the bounty) and is announced (throttled) whenever it rises;
//     whoever kills them is paid it on top of the kill GV. Leaving within KILL_CREDIT_SECONDS of a hit from another
//     player is that player's kill, so leaving can't dodge a bounty.
// This module never touches the store, sockets or the Room.
import {
  bountyFor, COLISEUM_RING_RADIUS, circleClear, findPath, GV_ELITE, GV_KILL, GV_MOB, GV_MOB_CAP, GV_SKIP, GV_WIN,
  KILL_CREDIT_SECONDS, patienceSecondsFor, WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, PLAYER_RADIUS, SUDDEN_DEATH_KILLER, suddenDeathShare, TELEPORT_IMMUNITY_MS, TILE,
  tileToWorldCenter, worldToTile, type GameMap, type GvBreakdown, type GvReason, type RunOutcome, type RunResult,
  type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { absorbShield } from "./buffs";
import { announceBounty, mobRewardFor } from "./feed";
import { recordHit } from "./ledger";
import { floorHp } from "./status";
import { dropLock, releaseTrigger } from "./weapons";
import { emit, payLater, type PlayerRuntime, type World } from "./world";

/** The player dealing damage, when it comes from a player (for kill credit and the death fx). */
export interface Attacker { id: string; p: PlayerState; rt: PlayerRuntime }

type Entry = { p: PlayerState; rt: PlayerRuntime };

/** Alive and not yet down this tick. */
const standing = (p: PlayerState, rt: PlayerRuntime | undefined): rt is PlayerRuntime =>
  p.status === "alive" && !!rt && !rt.down && !rt.resolved;

function alivePlayers(world: World): Entry[] {
  const out: Entry[] = [];
  for (const [id, p] of world.state.players) {
    const rt = world.players.get(id);
    if (standing(p, rt)) out.push({ p, rt });
  }
  return out;
}

/** Patience timer length in ms with `alive` players standing. */
export function patienceMs(world: World, alive: number): number {
  return patienceSecondsFor(alive, world.config.patienceSeconds, world.config.patienceMinSeconds) * 1000;
}

/** Called by startRaid once players are placed. */
export function beginRun(world: World): void {
  const s = world.state;
  // Whoever left during planning still started: they went MIA (missInPlanning), as a leave in the run does, and the gate on
  // the win bonus and the "lone survivor wins" rule see the same count they would have seen a moment later.
  const starters = Math.max(s.players.size, world.planning?.starters ?? 0);
  world.arena.startedWith = starters;
  s.startedWith = starters;
  world.arena.downedThisTick = [];
  world.arena.downsBetweenTicks = 0;
  world.arena.voided = false;
  // Decision 10: the first timer can be flat (firstPatienceSeconds); every timer after a death scales (settle).
  const first = world.config.firstPatienceSeconds;
  s.patienceEndsAt = s.serverTime + (first !== undefined && first > 0 ? first * 1000 : patienceMs(world, s.players.size));
  s.inColiseum = false;
  s.gatesLocked = false;
  s.suddenDeathAt = 0;
  s.winner = "";
}

/**
 * First thing in every active tick: the (barrier included) hp fractions that break a tie between simultaneous last
 * deaths, and the bounties this tick's kills pay (world.arena.bountyAtTickStart).
 */
export function markTickStart(world: World): void {
  world.arena.bountyAtTickStart.clear();
  for (const [id, p] of world.state.players) {
    const rt = world.players.get(id);
    // A barrier is hp for every hit, so it counts here too: effective hp over max hp.
    if (rt) rt.hpFracAtTickStart = p.maxHp > 0 ? (p.hp + p.barrier) / p.maxHp : 0;
    world.arena.bountyAtTickStart.set(id, p.bounty);
  }
}

/**
 * The one way to hurt a player. Ignored for anyone not standing and during teleport immunity. `source` is the
 * attacker, or the name of what killed them for the result (SUDDEN_DEATH_KILLER, or a mob or a departed shooter).
 * Returns the hp actually removed, or the damage that reached the pool when a death floor (Last Stand) held the hp; 0 when nothing got through.
 */
export function applyDamage(
  world: World, victim: PlayerState, rtv: PlayerRuntime, amount: number, source: Attacker | string,
): number {
  return applyHits(world, victim, rtv, [{ amount, source }]);
}

export interface Hit { amount: number; source: Attacker | string }

/**
 * Several hits landing on one player at the same moment (the per-tick ledger, sim/ledger.ts): their sum comes off at
 * once, so no hit is "first". Every player among the sources counts as having damaged the victim. If the sum kills, the
 * kill (and the bounty) goes to the largest hit by a rival player, else to the largest hit; ties go to the earlier one
 * (the ledger hands them over in the tick's secret order).
 */
export function applyHits(world: World, victim: PlayerState, rtv: PlayerRuntime, hits: readonly Hit[]): number {
  // hp 0 while still standing: the killing blow is being processed (a hook hitting the victim again must not re-kill).
  if (!standing(victim, rtv) || victim.hp <= 0) return 0;
  if (world.state.serverTime < victim.immuneUntil) return 0;
  let total = 0;
  let top: Hit | null = null;
  let topRival: (Hit & { source: Attacker }) | null = null;
  for (const h of hits) {
    if (!(h.amount > 0)) continue;
    total += h.amount;
    if (!top || h.amount > top.amount) top = h;
    // Hurting yourself is never your own kill or leave credit.
    if (typeof h.source !== "string" && h.source.rt !== rtv) {
      h.source.rt.damaged.add(rtv.id);
      if (!topRival || h.amount > topRival.amount) topRival = h as Hit & { source: Attacker };
    }
  }
  if (!top) return 0;
  if (topRival) rtv.lastHit = { by: topRival.source.rt.id, at: world.state.serverTime };
  // A barrier (none since the kill combos went; R6's skills) takes its share first; a hit it swallows whole neither hurts nor kills.
  total = absorbShield(victim, total);
  if (!(total > 0)) return 0;
  const before = victim.hp;
  const unheld = Math.max(0, before - total);
  victim.hp = floorHp(world, rtv.id, before, total);
  // What is returned is what reached the pool: a death floor that held the hp (Last Stand) did not stop the damage, it counts toward
  // what the floor pays back, so the hit still lands (a stagger, a number, a record), even when hp was already at the floor.
  if (victim.hp > 0) return victim.hp > unheld ? total : before - victim.hp;

  const killer = topRival ?? top;
  const by = typeof killer.source === "string" ? null : killer.source;
  rtv.killedBy = by ? by.p.name : (killer.source as string);
  emit(world, { type: "fx", fx: { kind: "death", id: rtv.id, x: victim.x, y: victim.y, by: by?.id ?? null } });
  // A rival's hit in the killing pass takes the kill. Failing that, a mob (or a departed shooter's arrow) that finishes
  // someone a player has been hunting gives the kill to that player if they hit within KILL_CREDIT_SECONDS: the same
  // rule as leaving, so running into a camp can't dodge a bounty. Sudden death is the arena's own and credits nobody.
  const credited = topRival
    ? topRival.source
    : typeof top.source === "string" && top.source !== SUDDEN_DEATH_KILLER ? recentRival(world, rtv, world.state.serverTime) : null;
  if (credited) {
    // The bounty is read now, with every other death of the pass still pending, and paid once the pass is over
    // (payLater): a shield or max hp won by a kill never saves a killer who dies in the same pass.
    const bounty = owedBounty(world, victim, rtv);
    payLater(world, () => creditKill(world, credited, victim, rtv, bounty));
  }
  downPlayer(world, victim, rtv, "died");
  return before;
}

/** Kills in one tick are simultaneous: a bounty the victim earned with a kill this same tick isn't paid yet. */
function owedBounty(world: World, victim: PlayerState, rtv: PlayerRuntime): number {
  return world.stepping ? (world.arena.bountyAtTickStart.get(rtv.id) ?? victim.bounty) : victim.bounty;
}

/**
 * Kill GV, the victim's bounty and the killer's new bounty. Skipped for a killer whose result is already out (a
 * projectile outliving its shooter, from Phase 9): nothing could bank it, and their final kills are already reported.
 */
function creditKill(world: World, by: Attacker, victim: PlayerState, rtv: PlayerRuntime, bounty = owedBounty(world, victim, rtv)): void {
  if (by.rt.resolved) return;
  by.p.kills += 1;
  awardGv(world, by.p, by.rt, "kill");
  if (bounty > 0) {
    credit(world, by.p, by.rt, "bounty", bounty);
    world.hooks.bountyClaimed?.(world, by.rt, rtv, bounty);
  }
  // After the bounty hook (half the victim's buffs already moved).
  world.hooks.playerKilled?.(world, by.rt);
  updateBounty(world, by.p, by.rt);
}

/**
 * The last player to hit `rt`, if they are still in the run and the hit came at most KILL_CREDIT_SECONDS before `at`.
 */
function recentRival(world: World, rt: PlayerRuntime, at: number): Attacker | null {
  const hit = rt.lastHit;
  if (!hit || at - hit.at > KILL_CREDIT_SECONDS * 1000) return null;
  const p = world.state.players.get(hit.by);
  const att = world.players.get(hit.by);
  return p && att && !att.resolved ? { id: hit.by, p, rt: att } : null;
}

/**
 * Who gets the kill when `rt` leaves now: the last player to hit them within KILL_CREDIT_SECONDS of the moment they
 * left. A dropped connection left when it dropped, not when its reconnect grace ran out (any hit during the grace is
 * later still, so it counts too).
 */
function leaveCredit(world: World, rt: PlayerRuntime): Attacker | null {
  return recentRival(world, rt, rt.droppedAt ?? world.state.serverTime);
}

/**
 * Credits the fixed GV for a kill or a mob (feedback goes out as a `gv` event; the amount banks with the player's
 * result). A mob pays its GV times `mult` (the reward curve, see mobRewardFor), rounded to whole GV, and mob GV stops at
 * GV_MOB_CAP. GV earned by someone whose result is already out is dropped: nothing can bank it any more.
 */
export function awardGv(world: World, p: PlayerState, rt: PlayerRuntime, reason: "kill" | "mob" | "elite", mult = 1): number {
  const amount = reason === "kill"
    ? GV_KILL
    : Math.min(Math.round((reason === "elite" ? GV_ELITE : GV_MOB) * mult), Math.max(0, GV_MOB_CAP - rt.gv.mobs));
  return credit(world, p, rt, reason, amount);
}

/**
 * A chest skip that healed nothing (roguelike R5, D12): GV_SKIP GV, counted with the mob GV and so stopped by GV_MOB_CAP
 * like it. Returns the GV paid (0 once the cap is reached, for a player whose result is out, or in a training room).
 */
export function awardSkipGv(world: World, p: PlayerState, rt: PlayerRuntime): number {
  // The training room records nothing (practice kills pay none either): no GV, so no "+3 GV" toast.
  if (world.config.training) return 0;
  return credit(world, p, rt, "skip", Math.min(GV_SKIP, Math.max(0, GV_MOB_CAP - rt.gv.mobs)));
}

function credit(world: World, p: PlayerState, rt: PlayerRuntime, reason: Exclude<GvReason, "win">, amount: number): number {
  if (rt.resolved || amount <= 0) return 0;
  if (reason === "kill") rt.gv.kills += amount;
  else if (reason === "bounty") rt.gv.bounty += amount;
  else rt.gv.mobs += amount; // mob, elite and a chest skip: one pot under GV_MOB_CAP
  p.gv = rt.gv.kills + rt.gv.mobs + rt.gv.bounty;
  emit(world, { type: "gv", id: rt.id, amount, reason });
  return amount;
}

/**
 * A mob kill: pays mob GV at `mult`, the reward the player's feed earns (read before this kill is counted; the caller
 * passes it so the GV and the buff drop of one kill use the same number), and then counts toward the feed score.
 * Returns the GV paid.
 */
export function creditMobKill(
  world: World, p: PlayerState, rt: PlayerRuntime, elite: boolean, mult = mobRewardFor(world, p, rt),
): number {
  if (rt.resolved) return 0;
  rt.mobKills += 1;
  p.mobKills = rt.mobKills;
  return awardGv(world, p, rt, elite ? "elite" : "mob", mult);
}

/**
 * Recomputes the bounty from the player kills; a rise is announced to everyone, at most once per BOUNTY_ANNOUNCE_MS per
 * player (feed.ts). A killer who went down in the same pass is no longer on a rampage: they get neither.
 */
function updateBounty(world: World, p: PlayerState, rt: PlayerRuntime): void {
  if (!standing(p, rt)) return;
  const bounty = bountyFor(p.kills);
  if (bounty <= p.bounty) return;
  p.bounty = bounty;
  announceBounty(world, p, rt);
}

/** The Room lost this player's connection and holds the seat for a reconnect (they stay in the fight meanwhile). */
export function markDropped(world: World, id: string): void {
  const rt = world.players.get(id);
  // During planning too: a dropped player does not hold up the early start (sim/planning.ts everyoneReady).
  const held = world.state.phase === "active" || world.state.phase === "planning";
  if (rt && rt.droppedAt === null && held) rt.droppedAt = world.state.serverTime;
  // A press that arrived just before the socket closed would hold the trigger for the whole grace.
  rt?.inputs.drain();
  releaseHeld(world, id);
}

/** They are back within the grace. A button they still hold is pressed again by their client. */
export function markReconnected(world: World, id: string): void {
  const rt = world.players.get(id);
  if (rt) rt.droppedAt = null;
  releaseHeld(world, id);
}

/** A release sent while the connection was down never arrives, so the server lets go of the trigger itself. */
function releaseHeld(world: World, id: string): void {
  const p = world.state.players.get(id);
  const rt = world.players.get(id);
  if (p && rt) releaseTrigger(world, { kind: "player", id, s: p, rt });
}

/** GV earned so far and not yet banked: what a run voided by a server shutdown still pays. */
export function unbankedGv(rt: PlayerRuntime): number {
  return rt.resolved ? 0 : rt.gv.kills + rt.gv.mobs + rt.gv.bounty;
}

/**
 * Takes a standing player out of the fight: they stop acting and leave a body. During a step the result waits for
 * settle() at the end of the tick; between steps (a leave) there is no tick to wait for, so it goes out now, and
 * the death still restarts the timer in the next tick.
 */
export function downPlayer(world: World, p: PlayerState, rt: PlayerRuntime, outcome: "died" | "mia"): void {
  if (!standing(p, rt)) return;
  const credited = outcome === "mia" ? leaveCredit(world, rt) : null;
  rt.down = { outcome };
  rt.path = [];
  releaseTrigger(world, { kind: "player", id: rt.id, s: p, rt });
  p.status = outcome === "died" ? "dead" : "mia";
  world.hooks.fighterOut?.(world, rt.id, "down");
  if (credited) creditKill(world, credited, p, rt);
  world.hooks.dropBody(world, p);
  if (world.stepping) {
    world.arena.downedThisTick.push({ p, rt });
    return;
  }
  world.arena.downsBetweenTicks++;
  resolve(world, p, rt, outcome, alivePlayers(world).length + 1, 0);
}

/**
 * A player leaves during the planning phase: MIA, as a leave in the run is, so it costs them what that costs (a run and a
 * death in their stats) and nothing can be got for free by leaving to see the deal and queueing again. Their result goes out
 * at once. Nothing else follows from the run: no body (nothing was brought in), no kill credit (nobody can have hit them), no
 * GV, and no settle (it does not run in planning). Called by removePlayer before it deletes them, so `place` counts the
 * players still in the room: the first of eight to leave is 8th, as the first to go MIA in a run of eight is.
 */
export function missInPlanning(world: World, p: PlayerState, rt: PlayerRuntime): void {
  if (rt.resolved) return;
  rt.down = { outcome: "mia" };
  rt.path = [];
  resolve(world, p, rt, "mia", world.state.players.size, 0);
}

function resolve(
  world: World, p: PlayerState, rt: PlayerRuntime, outcome: RunOutcome, place: number, win: number, winBonusWithheld = false,
): void {
  if (rt.resolved) return;
  rt.resolved = true;
  rt.path = [];
  const s = world.state;
  const gv: GvBreakdown = {
    kills: rt.gv.kills, mobs: rt.gv.mobs, bounty: rt.gv.bounty, win, total: rt.gv.kills + rt.gv.mobs + rt.gv.bounty + win,
  };
  const result: RunResult = {
    outcome,
    profile: rt.profile,
    durationSec: s.raidStartedAt > 0 ? Math.round((s.serverTime - s.raidStartedAt) / 1000) : 0,
    kills: p.kills,
    killedBy: outcome === "died" ? rt.killedBy : null,
    place,
    players: world.arena.startedWith,
    gv,
    winBonusWithheld,
  };
  emit(world, { type: "resolved", id: rt.id, result });
}

/**
 * Sudden death, in the beforeDamage stage. Once the gates have been locked for suddenDeathSeconds with no death, every
 * standing player loses a share of max hp per second that grows by SUDDEN_DEATH_RAMP_FRACTION each whole second.
 * Only whole ticks after `suddenDeathAt` burn (it is set on the tick grid), so the ramp is the same at any tick rate.
 * The burn is a ledger entry (all true damage, from SUDDEN_DEATH_KILLER, credited to nobody), so it lands in the same
 * pass as the tick's hits and no spoils won by a kill in that pass (bounty buffs, the max hp they bring) can save anyone from it.
 */
export function suddenDeath(world: World, dtMs: number): void {
  const s = world.state;
  if (!s.gatesLocked || s.suddenDeathAt <= 0) return;
  const tickStart = s.serverTime - dtMs;
  if (tickStart < s.suddenDeathAt) return;
  const share = suddenDeathShare(tickStart - s.suddenDeathAt) * (dtMs / 1000);
  for (const { p, rt } of alivePlayers(world)) {
    recordHit(world, {
      victim: rt.id, by: { id: SUDDEN_DEATH_KILLER, name: SUDDEN_DEATH_KILLER },
      packet: { raw: share * p.maxHp, phys: 0, magic: 0, true: 1 }, weapon: "sword", stagger: false, arena: true,
    });
  }
}

export { suddenDeathShare };

/** Last thing in every active tick: results for this tick's downs, the end of the run, the timer and the teleport. */
export function settle(world: World): void {
  const s = world.state;
  const a = world.arena;
  const downed = a.downedThisTick;
  a.downedThisTick = [];
  const deaths = downed.length + a.downsBetweenTicks;
  a.downsBetweenTicks = 0;
  const alive = alivePlayers(world);
  const contested = a.startedWith >= 2;

  if (alive.length === 0 || (contested && alive.length === 1)) {
    endRun(world, alive, downed, contested);
    return;
  }
  for (const d of downed) resolve(world, d.p, d.rt, d.rt.down!.outcome, alive.length + 1, 0);
  if (deaths > 0) {
    s.patienceEndsAt = s.serverTime + patienceMs(world, alive.length);
    s.gatesLocked = false;
    s.suddenDeathAt = 0;
    return;
  }
  if (!s.gatesLocked && s.serverTime >= s.patienceEndsAt) teleportToColiseum(world);
}

function endRun(world: World, alive: Entry[], downed: Entry[], contested: boolean): void {
  const s = world.state;
  let winners: Entry[] = [];
  if (alive.length === 1) {
    winners = alive;
  } else if (contested && downed.length > 0) {
    let best = -Infinity;
    for (const d of downed) best = Math.max(best, d.rt.hpFracAtTickStart);
    winners = downed.filter((d) => d.rt.hpFracAtTickStart === best);
  }
  const draw = winners.length > 1;
  const won = new Set(winners.map((w) => w.rt));
  for (const d of downed) {
    if (!won.has(d.rt)) resolve(world, d.p, d.rt, d.rt.down!.outcome, winners.length + 1, 0);
  }
  for (const w of winners) {
    if (draw) { resolve(world, w.p, w.rt, "draw", 1, 0); continue; }
    const earned = contested && earnedWinBonus(world, w.rt);
    resolve(world, w.p, w.rt, "won", 1, earned ? GV_WIN : 0, !earned);
  }

  const winner = !draw && winners.length === 1 ? winners[0]! : null;
  s.winner = winner?.p.name ?? "";
  s.phase = "ended";
  // Nothing is fought after the end: a lock the winner still held would stay synced through the linger.
  for (const [id, rt] of world.players) {
    const p = s.players.get(id);
    if (p) dropLock({ kind: "player", id, s: p, rt });
  }
  world.hooks.runEnded?.(world);
  s.patienceEndsAt = 0;
  s.gatesLocked = false;
  s.suddenDeathAt = 0;
  emit(world, { type: "fx", fx: { kind: "victory", id: winner?.rt.id ?? null, name: winner?.p.name ?? null, draw } });
  emit(world, { type: "raidEnded" });
}

function earnedWinBonus(world: World, rt: PlayerRuntime): boolean {
  return world.arena.startedWith >= WIN_BONUS_MIN_PLAYERS && rt.damaged.size >= WIN_BONUS_MIN_OPPONENTS;
}

/**
 * Everyone standing goes to a distinct coliseum spot (assigned by the server-private RNG), with their path, queued
 * inputs and rewind history cleared, and TELEPORT_IMMUNITY_MS of immunity. The gates lock and the sudden-death
 * clock starts. Only settle() calls this, in a tick with no death.
 */
export function teleportToColiseum(world: World): void {
  const s = world.state;
  const now = s.serverTime;
  const alive = alivePlayers(world);
  const spots = coliseumSpots(world.map, alive.length);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(world.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j]!, spots[i]!];
  }
  alive.forEach(({ p, rt }, i) => {
    const spot = spots[i]!;
    p.x = spot.x;
    p.y = spot.y;
    p.immuneUntil = now + TELEPORT_IMMUNITY_MS;
    rt.path = [];
    rt.inputs.drain();
    rt.history = [{ t: now, x: p.x, y: p.y }];
  });
  s.gatesLocked = true;
  s.inColiseum = true;
  s.patienceEndsAt = 0;
  s.suddenDeathAt = now + world.config.suddenDeathSeconds * 1000;
  world.hooks.teleported?.(world);
  emit(world, { type: "fx", fx: { kind: "teleport" } });
}

/** How far (in tiles) coliseumSpots looks around each ring point for a free floor tile. */
const SPOT_SEARCH_TILES = 12;

/**
 * `n` distinct floor points spread around a ring of COLISEUM_RING_RADIUS about the coliseum: for each even step around
 * the ring, the nearest unused one of mapgen's coliseum spots. Deterministic for a map. A map with too few coliseum
 * spots (a hand-built one) takes the free tile centre nearest each ring point about the map centre instead, reachable
 * from the first spawn, and a player whose ring point finds nothing falls back to a spawn.
 */
export function coliseumSpots(map: GameMap, n: number): Vec2[] {
  const inner = map.coliseum.innerSpawns;
  if (inner.length >= n) return spreadOver(inner, map.coliseum.centre, n);
  const cx = (map.w * TILE) / 2;
  const cy = (map.h * TILE) / 2;
  const origin = map.spawns[0];
  const used = new Set<number>();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / Math.max(1, n);
    const want = { x: cx + Math.cos(angle) * COLISEUM_RING_RADIUS, y: cy + Math.sin(angle) * COLISEUM_RING_RADIUS };
    const spot = nearestFreeTile(map, want, used, origin);
    out.push(spot ?? map.spawns[i % map.spawns.length]!);
  }
  return out;
}

function spreadOver(spots: readonly Vec2[], centre: Vec2, n: number): Vec2[] {
  const used = new Set<number>();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / Math.max(1, n);
    const wx = centre.x + Math.cos(angle) * COLISEUM_RING_RADIUS;
    const wy = centre.y + Math.sin(angle) * COLISEUM_RING_RADIUS;
    let best = -1;
    let bestD = Infinity;
    spots.forEach((s, j) => {
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (!used.has(j) && d < bestD) { best = j; bestD = d; }
    });
    used.add(best);
    out.push(spots[best]!);
  }
  return out;
}

function nearestFreeTile(map: GameMap, want: Vec2, used: Set<number>, origin: Vec2 | undefined): Vec2 | null {
  const tx0 = worldToTile(want.x);
  const ty0 = worldToTile(want.y);
  for (let r = 0; r <= SPOT_SEARCH_TILES; r++) {
    let best: { key: number; at: Vec2; d: number } | null = null;
    for (let ty = ty0 - r; ty <= ty0 + r; ty++) {
      for (let tx = tx0 - r; tx <= tx0 + r; tx++) {
        if (Math.max(Math.abs(tx - tx0), Math.abs(ty - ty0)) !== r) continue;
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        const key = ty * map.w + tx;
        if (used.has(key)) continue;
        const at = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
        if (!circleClear(map, at, PLAYER_RADIUS)) continue;
        const d = Math.hypot(at.x - want.x, at.y - want.y);
        if (best && d >= best.d) continue;
        if (origin && (origin.x !== at.x || origin.y !== at.y) && findPath(map, origin, at, PLAYER_RADIUS).length === 0) continue;
        best = { key, at, d };
      }
    }
    if (best) {
      used.add(best.key);
      return best.at;
    }
  }
  return null;
}
