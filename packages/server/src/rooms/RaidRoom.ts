// Thin Colyseus adapter around the headless sim: validates/enqueues inputs, ticks the
// world at a fixed rate, and turns sim events into messages and profile changes.
//
// Run gear is minted by the sim and never leaves the run; only GV and stats persist (all synchronous, all
// through ctx.store):
//   "resolved"        recordRun(outcome, kills, gv.total)   once per player and run, whatever the outcome
//   server shutdown   bankGv(unbanked run GV)               the run is void: no run is recorded
//   leave in lobby    nothing
import { randomInt } from "node:crypto";
import { ErrorCode, Room, ServerError, type Client } from "@colyseus/core";
import {
  CLIENT_MESSAGE_TYPES, ENDED_LINGER_SECONDS, MAX_PLAYERS, PROFILE_RE, RECONNECT_SECONDS, TICK_MS,
  type GvReason, type JoinOptions, type RunResult, type ServerMessages,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import type { ServerConfig } from "../config";
import type { ProfileStore } from "../persistence/ProfileStore";
import { markDropped, markReconnected } from "../sim/arena";
import { createGameWorld } from "../sim/gameplay";
import { enqueueClientMessage } from "../sim/inputs";
import { abandonPlayer, addPlayer, removePlayer, step } from "../sim/step";
import type { SimEvent, World } from "../sim/world";

/** Fixed steps run per simulation callback at most; older backlog is dropped. */
const MAX_CATCHUP_STEPS = 3;

/** An acquired-but-never-confirmed profile (onAuth passed, onJoin never ran) frees itself after this. */
const PENDING_ACQUIRE_MAX_MS = 30_000;

/**
 * Which profiles are currently committed to a raid. Process-wide: one profile can be in at most one
 * raid at a time, whichever room it is. The value is the owner, `${roomId}:${sessionId}`; releasing
 * is owner-checked so a stale holder (a player still looking at old results) can never free the
 * entry that a newer raid now owns.
 */
export class ActiveProfiles {
  private readonly owners = new Map<string, { owner: string; at: number; confirmed: boolean }>();

  isActive(profile: string, now = Date.now()): boolean {
    const e = this.owners.get(profile);
    return !!e && (e.confirmed || now - e.at <= PENDING_ACQUIRE_MAX_MS);
  }

  /** Claims the profile for `owner`; false when someone else holds it. */
  tryAcquire(profile: string, owner: string, now = Date.now()): boolean {
    if (this.isActive(profile, now)) return false;
    this.owners.set(profile, { owner, at: now, confirmed: false });
    return true;
  }

  /** Marks the hold as real (the player is in the room); it no longer expires. */
  confirm(profile: string, owner: string): void {
    const e = this.owners.get(profile);
    if (e?.owner === owner) e.confirmed = true;
  }

  /** Frees the profile only if `owner` still holds it. Returns whether it did. */
  release(profile: string, owner: string): boolean {
    if (this.owners.get(profile)?.owner !== owner) return false;
    this.owners.delete(profile);
    return true;
  }

  ownerOf(profile: string): string | undefined {
    return this.owners.get(profile)?.owner;
  }

  get size(): number {
    return this.owners.size;
  }
}

export interface RoomContext {
  config: ServerConfig;
  store: ProfileStore;
  profiles: ActiveProfiles;
}

/** What onAuth hands to onJoin via `client.auth`. */
interface RoomAuth {
  profile: string;
}

/** One joined player's claim on the profile registry. */
interface Seat {
  profile: string;
  ownerKey: string;
}

/** A refused join. A ServerError is an expected outcome: core doesn't print its stack to the log. */
const refuse = (message: string) => new ServerError(ErrorCode.AUTH_FAILED, message);

/** Credentials, checked before any room is created or seat reserved. */
function checkCredentials(options: Partial<JoinOptions> | undefined, store: ProfileStore): string {
  const profile = options?.profile;
  if (typeof profile !== "string" || !PROFILE_RE.test(profile)) throw refuse("invalid profile name");
  const token = options?.token;
  if (typeof token !== "string" || !store.verifyToken(profile, token)) throw refuse("unknown profile or bad token");
  return profile;
}

const GV_TOAST: Record<GvReason, string> = { kill: "kill", mob: "mob", elite: "elite", bounty: "bounty" };

export class RaidRoom extends Room<{ state: RaidState }> {
  /** Set once by createServer(); rooms are constructed by the matchmaker. */
  static ctx: RoomContext;

  /**
   * Matchmake-time gate: anonymous HTTP callers can't create rooms or reserve seats. Returning
   * `true` (not an auth object) makes core still run the instance onAuth at connect time, which
   * does the phase check and the profile registry claim. (Core logs at startup that the instance
   * onAuth "will be ignored"; with a `true` result it is not.)
   */
  static async onAuth(_token: string, options: Partial<JoinOptions> | undefined): Promise<boolean> {
    checkCredentials(options, RaidRoom.ctx.store);
    return true;
  }

  maxClients = MAX_PLAYERS;
  /**
   * Spam guard; exceeding it disconnects. Legit clients send about 35/s at most (20 Hz aim, 10 Hz move repeat, clicks),
   * with headroom for a network stall that delivers a couple of seconds of input at once.
   */
  maxMessagesPerSecond = 100;

  private world!: World;
  private accumulator = 0;
  /**
   * Set when the process is shutting down (a deploy, or a tsx-watch restart in `npm run dev`). The run
   * dies with the process, so players still in it are not MIA: the run is void, but the GV they earned is paid.
   * (Colyseus skips this override under `devMode`, which this server doesn't enable.)
   */
  private shuttingDown = false;
  /** Results survive a dropped connection so a reconnecting client still gets theirs. */
  private readonly pendingResults = new Map<string, RunResult>();
  /** sessionId -> seat, from onJoin until onLeave. */
  private readonly seats = new Map<string, Seat>();

  onCreate() {
    const { config } = RaidRoom.ctx;
    this.world = createGameWorld({ seed: randomInt(0, 2 ** 31), config, random: Math.random });
    this.state = this.world.state;
    for (const type of CLIENT_MESSAGE_TYPES) {
      this.onMessage(type, (client: Client, msg: unknown) => {
        const rt = this.world.players.get(client.sessionId);
        if (rt) enqueueClientMessage(rt.inputs, type, msg);
      });
    }
    this.setTimestep((elapsed) => this.tick(elapsed), TICK_MS);
    // Patches are sent from tick() right after each simulated step, so every patch carries
    // exactly the latest tick. Must come after setTimestep (otherwise core installs its own
    // clock-tick interval, which skews `elapsed`).
    this.patchRate = 0;
  }

  private ownerKey(sessionId: string): string {
    return `${this.roomId}:${sessionId}`;
  }

  /**
   * Synchronous on purpose: nothing can interleave between the checks, the registry claim and
   * onJoin's withdraw. Joining never creates a profile; the client claims one over HTTP first.
   */
  onAuth(client: Client, options: Partial<JoinOptions> | undefined): RoomAuth {
    // Seats can be reserved just before the raid starts; refuse them so nobody lands in an
    // active raid stuck in "lobby". Reconnections bypass onAuth.
    if (this.world.state.phase !== "lobby") throw refuse("raid already started");
    const { store, profiles } = RaidRoom.ctx;
    const profile = checkCredentials(options, store);
    // Last, so a rejected join never holds the profile.
    if (!profiles.tryAcquire(profile, this.ownerKey(client.sessionId))) throw refuse("profile already in a raid");
    return { profile };
  }

  onJoin(client: Client) {
    const { profiles } = RaidRoom.ctx;
    const { profile } = client.auth as RoomAuth;
    const ownerKey = this.ownerKey(client.sessionId);
    try {
      addPlayer(this.world, client.sessionId, profile);
      this.seats.set(client.sessionId, { profile, ownerKey });
      profiles.confirm(profile, ownerKey);
    } catch (err) {
      removePlayer(this.world, client.sessionId);
      this.seats.delete(client.sessionId);
      profiles.release(profile, ownerKey);
      throw err;
    }
  }

  onDrop(client: Client) {
    // Nothing to hold in the lobby: a ghost would count toward minPlayers and could be spawned into
    // the raid unable to act. Not allowing reconnection makes core call onLeave right away. Once the run
    // is on, the seat is held (and the player stays alive, and hittable) so a blip doesn't cost them.
    if (this.world.state.phase === "lobby") return;
    // For kill credit, a player who never comes back left now, not when the grace runs out.
    markDropped(this.world, client.sessionId);
    // Rejects when the client never finished joining or the room is disposing; onLeave still runs.
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client: Client) {
    markReconnected(this.world, client.sessionId);
    const result = this.pendingResults.get(client.sessionId);
    if (result) client.send("result", result);
  }

  /**
   * Core calls this on every room when the process shuts down (SIGTERM from a deploy or a tsx-watch
   * restart, SIGINT, or a crash). The base implementation disconnects every client, which is what
   * leads to onLeave, so it must still run. The flag goes up first so those onLeave calls know why.
   */
  onBeforeShutdown() {
    this.shuttingDown = true;
    super.onBeforeShutdown();
  }

  onLeave(client: Client) {
    const { profiles } = RaidRoom.ctx;
    const sessionId = client.sessionId;
    const seat = this.seats.get(sessionId);
    // Deleting the seat first is what keeps a second onLeave/onDispose from paying out again.
    this.seats.delete(sessionId);
    if (seat && this.shuttingDown && this.world.state.players.get(sessionId)?.status === "alive") {
      // A void run leaves no trace (no MIA result, no body, no recorded run), but what was earned is paid.
      this.bankVoided(seat.profile, abandonPlayer(this.world, sessionId));
    } else {
      removePlayer(this.world, sessionId);
    }
    // A leave can resolve a player outside of a tick (MIA); flush those events now, and only then
    // forget the result: settle() stores it for a reconnect that can no longer happen.
    this.handleEvents(this.world.events.splice(0));
    this.pendingResults.delete(sessionId);
    if (seat) profiles.release(seat.profile, seat.ownerKey);
  }

  /** Safety net: onLeave normally empties `seats`; this keeps a leak from locking a profile out for good. */
  onDispose() {
    const { profiles } = RaidRoom.ctx;
    for (const [sessionId, seat] of this.seats) {
      if (this.world.state.players.get(sessionId)?.status === "alive") {
        this.bankVoided(seat.profile, abandonPlayer(this.world, sessionId));
      }
      profiles.release(seat.profile, seat.ownerKey);
    }
    this.seats.clear();
  }

  private bankVoided(profile: string, gv: number) {
    if (gv <= 0) return;
    try {
      RaidRoom.ctx.store.bankGv(profile, gv);
    } catch (err) {
      console.error(`[raid ${this.roomId}] failed to bank the GV of ${profile}:`, err);
    }
  }

  private tick(elapsedMs: number) {
    this.accumulator += elapsedMs;
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < MAX_CATCHUP_STEPS) {
      this.handleEvents(step(this.world, TICK_MS));
      this.accumulator -= TICK_MS;
      steps++;
    }
    if (this.accumulator >= TICK_MS) this.accumulator = 0;
    if (steps > 0) this.broadcastPatch();
  }

  private sendTo<K extends keyof ServerMessages>(sessionId: string, type: K, msg: ServerMessages[K]) {
    this.clients.getById(sessionId)?.send(type, msg);
  }

  private handleEvents(events: SimEvent[]) {
    for (const ev of events) {
      switch (ev.type) {
        case "fx":
          this.broadcast("fx", { ...ev.fx, t: this.world.state.serverTime });
          break;
        case "toast":
          this.sendTo(ev.to, "toast", { text: ev.text });
          break;
        case "resolved":
          this.settle(ev.id, ev.result);
          break;
        case "gv":
          this.sendTo(ev.id, "toast", { text: `+${ev.amount} GV (${GV_TOAST[ev.reason]})` });
          break;
        case "raidStarted":
          void this.lock();
          break;
        case "raidEnded":
          this.clock.setTimeout(() => void this.disconnect(), ENDED_LINGER_SECONDS * 1000);
          break;
      }
    }
  }

  /** A player's run is over: bank its GV and stats, free the profile, tell them. */
  private settle(sessionId: string, result: RunResult) {
    const { store, profiles } = RaidRoom.ctx;
    try {
      store.recordRun(result.profile, { outcome: result.outcome, kills: result.kills, gv: result.gv.total });
    } catch (err) {
      // Never let a store problem stop the result from reaching the player or the profile from freeing up.
      console.error(`[raid ${this.roomId}] failed to persist the result of ${result.profile}:`, err);
    }
    // Released now rather than at onLeave so the player can queue again while still on the results screen.
    profiles.release(result.profile, this.ownerKey(sessionId));
    this.pendingResults.set(sessionId, result);
    this.sendTo(sessionId, "result", result);
  }
}
