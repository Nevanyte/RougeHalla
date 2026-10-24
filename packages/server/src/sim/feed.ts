// Feed and the bounty's voice (GAME_DESIGN 12.1, 12.3, 12.4): a player's feed, the lobby median it is compared with,
// the multiplier mobs pay them, and the rampage announcement with its per-player throttle. Pure reads of the sim state
// plus one system; arena.ts calls in (it must not be imported here).
import {
  BOUNTY_ANNOUNCE_MS, feedScore, median, mobRewardMultiplier,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { emit, type AnnounceRuntime, type PlayerRuntime, type World } from "./world";

/** Feed score: player kills plus a quarter per mob kill. */
export function feedOfPlayer(p: PlayerState, rt: PlayerRuntime): number {
  return feedScore(p.kills, rt.mobKills);
}

const standing = (p: PlayerState, rt: PlayerRuntime | undefined): rt is PlayerRuntime =>
  p.status === "alive" && !!rt && !rt.down && !rt.resolved;

/** Median feed of the players still standing: the "lobby" the catch-up bonus is measured against. */
export function lobbyMedianFeed(world: World): number {
  const feeds: number[] = [];
  for (const [id, p] of world.state.players) {
    const rt = world.players.get(id);
    if (standing(p, rt)) feeds.push(feedOfPlayer(p, rt));
  }
  return median(feeds);
}

/** What a mob kill by this player pays now (GV and buff stacks both): the reward curve at their feed, times the catch-up. */
export function mobRewardFor(world: World, p: PlayerState, rt: PlayerRuntime): number {
  return mobRewardMultiplier(feedOfPlayer(p, rt), lobbyMedianFeed(world));
}

function announceOf(rt: PlayerRuntime): AnnounceRuntime {
  return (rt.announce ??= { lastAt: -Infinity, sent: 0 });
}

/**
 * Announces a risen bounty ("<name> is on a rampage"), at most once per BOUNTY_ANNOUNCE_MS per player. A rise held back
 * is announced by flushAnnouncements when the window ends, with the value then.
 */
export function announceBounty(world: World, p: PlayerState, rt: PlayerRuntime): void {
  const a = announceOf(rt);
  const now = world.state.serverTime;
  if (p.bounty <= a.sent || now - a.lastAt < BOUNTY_ANNOUNCE_MS) return;
  a.lastAt = now;
  a.sent = p.bounty;
  emit(world, { type: "fx", fx: { kind: "bounty", id: rt.id, name: p.name, bounty: p.bounty } });
}

/** System: a bounty rise the throttle held back goes out once the window is over. */
export function flushAnnouncements(world: World): void {
  for (const [id, p] of world.state.players) {
    const rt = world.players.get(id);
    if (rt && rt.announce && standing(p, rt) && p.bounty > rt.announce.sent) announceBounty(world, p, rt);
  }
}

export function install(world: World): void {
  world.systems.push(flushAnnouncements);
}
