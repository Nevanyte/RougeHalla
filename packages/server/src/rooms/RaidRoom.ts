// Thin Colyseus adapter around the headless sim: validates/enqueues inputs, ticks the
// world at a fixed rate, and turns sim events into messages and stash changes.
//
// Where items cross the stash boundary (all synchronous, all through ctx.store):
//   onJoin            stash -> inventory   withdraw(loadout)
//   leave in lobby    inventory -> stash   deposit(brought-in items)       once per seat
//   "resolved"        extracted -> stash   deposit(result.extracted); died/mia lose everything
//   server shutdown   inventory -> stash   deposit(brought-in items still carried); no raid is recorded
import { randomInt } from "node:crypto";
import { ErrorCode, Room, ServerError, type Client } from "@colyseus/core";
import {
  CLIENT_MESSAGE_TYPES, ENDED_LINGER_SECONDS, INVENTORY_SLOTS, MAX_PLAYERS, PROFILE_RE, RECONNECT_SECONDS, TICK_MS,
  type ItemDTO, type JoinOptions, type RaidResult, type ServerMessages,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import type { ServerConfig } from "../config";
import type { StashStore } from "../persistence/StashStore";
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
  store: StashStore;
  profiles: ActiveProfiles;
}

/** What onAuth hands to onJoin via `client.auth`. */
interface RoomAuth {
  profile: string;
  loadout: string[];
}

/** One joined player's claim on the stash and the profile registry. */
interface Seat {
  profile: string;
  ownerKey: string;
  /** What onJoin took out of the stash. Refunded if the player leaves before the raid starts. */
  brought: ItemDTO[];
}

/** A refused join. A ServerError is an expected outcome: core doesn't print its stack to the log. */
const refuse = (message: string) => new ServerError(ErrorCode.AUTH_FAILED, message);

function parseLoadout(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > INVENTORY_SLOTS) throw refuse("invalid loadout");
  for (const uid of raw) {
    if (typeof uid !== "string" || uid.length === 0 || uid.length > 64) throw refuse("invalid loadout");
  }
  if (new Set(raw).size !== raw.length) throw refuse("duplicate item in loadout");
  return raw as string[];
}

export class RaidRoom extends Room<{ state: RaidState }> {
  /** Set once by createServer(); rooms are constructed by the matchmaker. */
  static ctx: RoomContext;

  maxClients = MAX_PLAYERS;
  /** Spam guard; legit clients send ≤ ~20/s (move repeat + clicks). Exceeding it disconnects. */
  maxMessagesPerSecond = 60;

  private world!: World;
  private accumulator = 0;
  /**
   * Set when the process is shutting down (a deploy, or a tsx-watch restart in `npm run dev`). The raid
   * dies with the process, so players still in it are not MIA: they get their own items back.
   * (Colyseus skips this override under `devMode`, which this server doesn't enable.)
   */
  private shuttingDown = false;
  /** Results survive a dropped connection so a reconnecting client still gets theirs. */
  private readonly pendingResults = new Map<string, RaidResult>();
  /** sessionId -> seat, from onJoin until onLeave. Presence here means the Room owns that player's items. */
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
    const profile = options?.profile;
    if (typeof profile !== "string" || !PROFILE_RE.test(profile)) {
      throw refuse("invalid profile name");
    }
    const token = options?.token;
    if (typeof token !== "string" || !store.verifyToken(profile, token)) {
      throw refuse("unknown profile or bad token");
    }
    if (profiles.isActive(profile)) throw refuse("profile already in a raid");
    const loadout = parseLoadout(options?.loadout);
    const stashed = new Set(store.get(profile)?.stash.map((i) => i.uid));
    if (!loadout.every((uid) => stashed.has(uid))) throw refuse("loadout has items that are not in the stash");

    // Last, so a rejected join never holds the profile.
    if (!profiles.tryAcquire(profile, this.ownerKey(client.sessionId))) throw refuse("profile already in a raid");
    return { profile, loadout: [...loadout] };
  }

  onJoin(client: Client) {
    const { store, profiles } = RaidRoom.ctx;
    const { profile, loadout } = client.auth as RoomAuth;
    const ownerKey = this.ownerKey(client.sessionId);
    let withdrawn: ItemDTO[] | null = null;
    try {
      withdrawn = store.withdraw(profile, loadout);
      addPlayer(this.world, client.sessionId, profile, withdrawn);
      this.seats.set(client.sessionId, { profile, ownerKey, brought: withdrawn });
      profiles.confirm(profile, ownerKey);
    } catch (err) {
      removePlayer(this.world, client.sessionId);
      if (withdrawn) store.deposit(profile, withdrawn);
      profiles.release(profile, ownerKey);
      throw err;
    }
  }

  onDrop(client: Client) {
    // Nothing to hold in the lobby: a ghost would count toward minPlayers and could be spawned into
    // the raid unable to act. Not allowing reconnection makes core call onLeave right away, which
    // refunds the loadout. Once the raid runs, the seat is held so a blip doesn't cost the player.
    if (this.world.state.phase === "lobby") return;
    // Rejects when the client never finished joining or the room is disposing; onLeave still runs.
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client: Client) {
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
    // Deleting the seat first is what keeps a second onLeave/onDispose from refunding again.
    this.seats.delete(sessionId);
    const voidRaid = !!seat && this.refundSeat(sessionId, seat);
    // A void raid leaves no trace: no MIA result, no body, no recorded raid.
    if (voidRaid) abandonPlayer(this.world, sessionId);
    else removePlayer(this.world, sessionId);
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
      this.refundSeat(sessionId, seat);
      profiles.release(seat.profile, seat.ownerKey);
    }
    this.seats.clear();
  }

  /**
   * Hands items back when the player's raid never really happened for them:
   *   - still in the lobby: everything they brought;
   *   - alive when the server shuts down: what they brought and still carry. Looted items stay behind,
   *     and since every uid deposited here is in the inventory right now, none can be in the stash twice.
   * Returns true for the shutdown case: the caller must then drop the player without resolving them
   * as MIA. Dead, extracted and MIA players were settled already, through "resolved".
   */
  private refundSeat(sessionId: string, seat: Seat): boolean {
    const { store } = RaidRoom.ctx;
    const player = this.world.state.players.get(sessionId);
    if (player?.status === "lobby") {
      store.deposit(seat.profile, seat.brought);
      return false;
    }
    if (this.shuttingDown && player?.status === "alive") {
      const carried = new Set(Array.from(player.inventory, (i) => i.uid));
      store.deposit(seat.profile, seat.brought.filter((i) => carried.has(i.uid)));
      return true;
    }
    return false;
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
        case "raidStarted":
          void this.lock();
          break;
        case "raidEnded":
          this.clock.setTimeout(() => void this.disconnect(), ENDED_LINGER_SECONDS * 1000);
          break;
      }
    }
  }

  /** A player left the raid for good: bank what they got out, count the raid, free the profile, tell them. */
  private settle(sessionId: string, result: RaidResult) {
    const { store, profiles } = RaidRoom.ctx;
    try {
      if (result.outcome === "extracted") store.deposit(result.profile, result.extracted);
      store.recordRaid(result.profile, result.outcome, result.kills);
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
