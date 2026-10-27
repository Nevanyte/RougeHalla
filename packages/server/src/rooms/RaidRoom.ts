// Thin Colyseus adapter around the headless sim: validates/enqueues inputs, ticks the
// world at a fixed rate, and turns sim events into messages and profile changes.
//
// Run gear is minted by the sim and never leaves the run; only GV and stats persist (all synchronous, all
// through ctx.store):
//   "resolved"        recordRun(outcome, kills, gv.total)   once per player and run, whatever the outcome
//   server shutdown   bankGv(unbanked run GV)               the run is void: no run is recorded
//   leave in lobby    nothing
//   leave in planning recordRun(mia, 0 kills, 0 GV), as a leave in the run: planning is part of the run (a dropped client's
//                     seat is held, as in the run, and goes MIA when the grace runs out). A shutdown voids it instead.
//   a bot             nothing, ever (sim bots have no client, profile or seat; settle() drops their results, and only the
//                     bot manager's learning store hears of them)
import { randomBytes, randomInt } from "node:crypto";
import { ErrorCode, Room, ServerError, type Client } from "@colyseus/core";
import {
  CLIENT_MESSAGE_TYPES, ENDED_LINGER_SECONDS, isFactionId, MAX_PLAYERS, PROFILE_RE, RECONNECT_SECONDS, spawnWalks, TICK_MS, packLook,
  type FactionId, type FxBatch, type FxEvent, type GvReason, type JoinOptions, type RunResult, type ServerMessages,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { BotManager } from "../bots/BotManager";
import type { BotStatsStoreApi } from "../bots/brain/types";
import type { ServerConfig } from "../config";
import type { MapSource } from "../mapPool";
import type { ProfileStore } from "../persistence/ProfileStore";
import { markDropped, markReconnected } from "../sim/arena";
import { createGameWorld } from "../sim/gameplay";
import { enqueueClientMessage } from "../sim/inputs";
import { planFor } from "../sim/planning";
import { abandonPlayer, addPlayer, removePlayer, startRaid, step } from "../sim/step";
import { installTraining } from "../sim/training";
import type { SimEvent, World } from "../sim/world";
import { FxChannel } from "./FxChannel";

/** Fixed steps run per simulation callback at most; older backlog is dropped. */
const MAX_CATCHUP_STEPS = 3;

/** An acquired-but-never-confirmed profile (onAuth passed, onJoin never ran) frees itself after this. */
const PENDING_ACQUIRE_MAX_MS = 30_000;

/** A profile that opened a room nobody has joined yet cannot open another for this long (see RaidRoom.onAuth). */
const UNJOINED_ROOM_COOLDOWN_MS = 5_000;

/**
 * Which profiles are currently committed to a raid. Process-wide: one profile can be in at most one
 * raid at a time, whichever room it is. The value is the owner, `${roomId}:${sessionId}`; releasing
 * is owner-checked so a stale holder (a player still looking at old results) can never free the
 * entry that a newer raid now owns.
 */
export class ActiveProfiles {
  private readonly owners = new Map<string, { owner: string; at: number; confirmed: boolean }>();
  /**
   * The room most recently opened on a profile's request, until someone joins it or it is disposed. One entry per profile
   * and each is dropped within a seat reservation of the room's life, so it cannot grow.
   */
  private readonly unjoined = new Map<string, { roomId: string; at: number }>();

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

  /** True while `profile` has a room it opened a few seconds ago that nobody has joined. */
  hasUnjoinedRoom(profile: string, now = Date.now()): boolean {
    const e = this.unjoined.get(profile);
    return !!e && now - e.at < UNJOINED_ROOM_COOLDOWN_MS;
  }

  roomOpened(profile: string, roomId: string, now = Date.now()): void {
    this.unjoined.set(profile, { roomId, at: now });
  }

  /** A player joined the room, or it is gone. A newer room of the same profile keeps its own entry. */
  forgetRoom(profile: string, roomId: string): void {
    if (this.unjoined.get(profile)?.roomId === roomId) this.unjoined.delete(profile);
  }

  get size(): number {
    return this.owners.size;
  }
}

export interface RoomContext {
  config: ServerConfig;
  store: ProfileStore;
  profiles: ActiveProfiles;
  /** Certified maps, taken synchronously at a room's first join (mapPool.ts). */
  maps: MapSource;
  /** What the fill bots learn across runs (docs/BOTS.md 6.2): process-wide, its own file, never the profile store. Null = learning off. */
  botStats: BotStatsStoreApi | null;
}

/** What onAuth hands to onJoin via `client.auth`. */
interface RoomAuth {
  profile: string;
  faction: FactionId | null;
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

const GV_TOAST: Record<GvReason, string> = { kill: "kill", mob: "mob", elite: "elite", bounty: "bounty", skip: "chest skip" };

export class RaidRoom extends Room<{ state: RaidState }> {
  /** Set once by createServer(); rooms are constructed by the matchmaker. */
  static ctx: RoomContext;

  /**
   * Matchmake-time gate: anonymous HTTP callers can't create rooms or reserve seats, and neither can a profile that
   * could not take the seat: one already in a raid, or one that opened a room a moment ago and has not joined it. A valid
   * profile is one HTTP request away from a room, so without the second check it could open them as fast as it can post.
   * Returning `true` (not an auth object) makes core still run the instance onAuth at connect time, which does the
   * phase check and the profile registry claim. (Core logs at startup that the instance onAuth "will be ignored"; with a
   * `true` result it is not.)
   */
  static async onAuth(_token: string, options: Partial<JoinOptions> | undefined): Promise<boolean> {
    const { store, profiles } = RaidRoom.ctx;
    const profile = checkCredentials(options, store);
    if (profiles.isActive(profile)) throw refuse("profile already in a raid");
    if (profiles.hasUnjoinedRoom(profile)) throw refuse("a room was just opened for this profile; join it or try again in a few seconds");
    return true;
  }

  maxClients = MAX_PLAYERS;
  /**
   * Spam guard; exceeding it disconnects. Legit clients send about 35/s at most (20 Hz aim, 10 Hz move repeat, clicks),
   * with headroom for a network stall that delivers a couple of seconds of input at once.
   */
  maxMessagesPerSecond = 100;

  /** Built on the first join (buildWorld), with a map from the pool: a room nobody joins never takes one. */
  private built: World | undefined;
  /** The profile that asked for this room, until a player joins it (or the room is disposed). */
  private opener: string | null = null;
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
  private readonly fxChannel = new FxChannel();
  /**
   * Factions players picked in the hub, by session, until their run is recorded. A round-robin default (no pick) is
   * not recorded: faction titles and golden variants must not come from luck of the join order.
   */
  private readonly picked = new Map<string, FactionId>();

  /** A training room (mode "training"): private, one player, nothing recorded (sim/training.ts). Fixed at creation. */
  private training = false;
  /** When the last input arrived (training's idle limit). */
  private lastInputAt = Date.now();

  /** The fill bots (docs/BOTS.md 7.2): an arena room with `bots.fillTo` above 0. Never in training. */
  private bots: BotManager | undefined;
  /** The `fxs` batches broadcast since the bots' last frame: they see what the clients got. Only filled when there are bots. */
  private readonly botBatches: FxBatch[] = [];

  private get world(): World {
    if (!this.built) throw new Error("the world is built when the first player joins");
    return this.built;
  }

  onCreate(options?: Partial<JoinOptions>) {
    const { config, profiles } = RaidRoom.ctx;
    this.training = options?.mode === "training";
    // A room nobody joins gets nothing more: the world, and its map from the pool, come with the first join (buildWorld).
    const opener = options?.profile;
    if (typeof opener === "string" && PROFILE_RE.test(opener)) {
      this.opener = opener;
      profiles.roomOpened(opener, this.roomId);
    }
    if (this.training) {
      // Out of every matchmaking search and open to its creator only (the "training" handler also forces the mode).
      this.maxClients = 1;
      void this.setPrivate(true);
      // A training run has no end of its own, so a player who walks away from an open tab is let go after a while.
      const idleMs = Math.max(1, config.trainingIdleSeconds) * 1000;
      this.clock.setInterval(() => {
        if (Date.now() - this.lastInputAt > idleMs) void this.disconnect();
      }, Math.min(5000, idleMs));
    }
    for (const type of CLIENT_MESSAGE_TYPES) {
      this.onMessage(type, (client: Client, msg: unknown) => {
        const rt = this.built?.players.get(client.sessionId);
        // Only an input that was accepted counts as presence: junk would otherwise keep an abandoned training room open for good.
        if (rt && enqueueClientMessage(rt.inputs, type, msg, { training: this.training })) this.lastInputAt = Date.now();
      });
    }
    this.setTimestep((elapsed) => this.tick(elapsed), TICK_MS);
    // Patches are sent from tick() right after each simulated step, so every patch carries
    // exactly the latest tick. Must come after setTimestep (otherwise core installs its own
    // clock-tick interval, which skews `elapsed`).
    this.patchRate = 0;
  }

  private buildWorld(): World {
    const { config, maps } = RaidRoom.ctx;
    // Synchronous: a certified map made ahead on the pool's worker (an empty pool certifies one here, logged). A training
    // room needs no seed of its own: it gets a copy of a recent map, so a burst of practice rooms does not drain the pool.
    const map = this.training ? maps.takeForTraining() : maps.take();
    // The planning deal reads the spawn walks (a pooled map arrives with them; a map certified here does not). Worked out now,
    // as the room is built, so no later tick pays for them: the planning start is a tick with every player in it.
    if (!this.training) spawnWalks(map);
    const world = createGameWorld({
      // The seed is the map's own (createWorld): what is published always rebuilds this map.
      map,
      // Training never plans: its one player is in the run the moment they join.
      config: this.training ? { ...config, dummies: true, training: true, planSeconds: 0 } : config,
      random: Math.random,
      // The reward stream's own secret: never the public seed, and not orderSalt, which tie outcomes can leak (world.ts).
      rewardSalt: Array.from(new Uint32Array(randomBytes(16).buffer, 0, 4)),
    });
    if (this.training) installTraining(world);
    else if (config.bots.fillTo > 0) {
      const { store, botStats } = RaidRoom.ctx;
      this.bots = new BotManager(world, config.bots, {
        store: botStats,
        // A read of the profile registry and nothing else: a bot's callsign must not be a real player's.
        isNameTaken: (name) => store.get(name) !== undefined,
        seed: config.bots.seed ?? randomInt(0, 2 ** 32),
      });
    }
    this.built = world;
    // Core describes the state to the client after onJoin returns, so this is early enough.
    this.state = world.state;
    return world;
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
    if (this.built && this.built.state.phase !== "lobby") throw refuse("raid already started");
    const { store, profiles } = RaidRoom.ctx;
    const profile = checkCredentials(options, store);
    // Last, so a rejected join never holds the profile.
    if (!profiles.tryAcquire(profile, this.ownerKey(client.sessionId))) throw refuse("profile already in a raid");
    return { profile, faction: isFactionId(options?.faction) ? options.faction : null };
  }

  onJoin(client: Client) {
    const { profiles, store } = RaidRoom.ctx;
    const { profile, faction } = client.auth as RoomAuth;
    const ownerKey = this.ownerKey(client.sessionId);
    try {
      // The first player to get this far, with the profile already claimed in onAuth, is who the room is built for.
      const world = this.built ?? this.buildWorld();
      // The lobby is full of humans and bots: the newest bot gives its seat up (maxClients counts humans only).
      if (this.bots && world.state.players.size >= MAX_PLAYERS) this.bots.yieldSeat();
      // Equipped at the moment of joining; changing the wardrobe mid-run takes effect next run.
      const owned = store.get(profile)?.cosmetics;
      addPlayer(world, client.sessionId, profile, { faction, look: owned ? packLook(owned.equipped, owned.owned) : 0 });
      this.seats.set(client.sessionId, { profile, ownerKey });
      if (faction && !this.training) this.picked.set(client.sessionId, faction);
      profiles.confirm(profile, ownerKey);
      if (this.opener) profiles.forgetRoom(this.opener, this.roomId);
      // Training has no lobby to wait out: the run is on as soon as its one player is in.
      if (this.training) startRaid(world);
    } catch (err) {
      if (this.built) removePlayer(this.built, client.sessionId);
      this.seats.delete(client.sessionId);
      profiles.release(profile, ownerKey);
      throw err;
    }
    this.sendInFlight(client);
  }

  onDrop(client: Client) {
    // Nothing to hold in the lobby: a ghost would count toward minPlayers and could be spawned into
    // the raid unable to act. Not allowing reconnection makes core call onLeave right away. Once the run
    // is on, the seat is held (and the player stays alive, and hittable) so a blip doesn't cost them.
    // Planning holds it too: the room is locked by then, so a blip would otherwise cost the whole run (a dropped
    // player keeps their pick, or is given the default at the end, and does not hold up the early start). If the grace
    // runs out before the run starts, onLeave counts it as any leave in planning: MIA.
    // A training room has nothing to hold either: the shipped client leaves with a non-consented close, which lands here, and a
    // hold would keep the profile locked for the whole grace period after the player has gone back to the hub.
    if (!this.built || this.built.state.phase === "lobby" || this.training) return;
    // For kill credit, a player who never comes back left now, not when the grace runs out.
    markDropped(this.world, client.sessionId);
    // Rejects when the client never finished joining or the room is disposing; onLeave still runs.
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client: Client) {
    markReconnected(this.world, client.sessionId);
    const result = this.pendingResults.get(client.sessionId);
    if (result) client.send("result", result);
    this.sendPlan(client);
    this.sendInFlight(client);
  }

  /**
   * The player's private planning deal, for a client that reconnects during planning: it is in no synced state, so the
   * full state cannot tell it. Held back by core until that state is out, like sendInFlight's batch.
   */
  private sendPlan(client: Client) {
    const plan = planFor(this.world, client.sessionId);
    if (plan) client.send("plan", plan satisfies ServerMessages["plan"]);
  }

  /**
   * The arrows and balls flying right now, for a client that joins or reconnects: the synced state has none, so the full
   * state it is about to get cannot tell it. The client is still joining here, so core holds this back until the full
   * state is out and sends it ahead of every batch from the steps in between (the same path as the `result` above).
   */
  private sendInFlight(client: Client) {
    if (this.world.projectiles.size === 0) return;
    client.send("fxs", this.fxChannel.inFlight(this.world.projectiles, this.world.state.serverTime) satisfies ServerMessages["fxs"]);
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
    // Core also calls this for a join that failed before the room had a world to put the player in: nothing was taken.
    if (!this.built) return;
    const { profiles } = RaidRoom.ctx;
    const sessionId = client.sessionId;
    const seat = this.seats.get(sessionId);
    // Deleting the seat first is what keeps a second onLeave/onDispose from paying out again.
    this.seats.delete(sessionId);
    if (this.training) {
      // Walking out of a practice room is not leaving a run: no MIA, no result, nothing banked.
      abandonPlayer(this.world, sessionId);
    } else if (seat && this.shuttingDown && (this.world.state.players.get(sessionId)?.status === "alive" || this.world.state.phase === "planning")) {
      // A void run leaves no trace (no MIA result, no body, no recorded run), but what was earned is paid. A run still
      // in planning is one too: a restart must not cost every player a loss.
      this.bankVoided(seat.profile, abandonPlayer(this.world, sessionId));
    } else {
      removePlayer(this.world, sessionId);
    }
    // A leave can resolve a player outside of a tick (MIA); flush those events now, and only then
    // forget the result: settle() stores it for a reconnect that can no longer happen.
    this.handleEvents(this.world.events.splice(0));
    this.pendingResults.delete(sessionId);
    this.picked.delete(sessionId); // settle() takes it when a run is recorded; a lobby leave or a void run never reaches that
    if (seat) profiles.release(seat.profile, seat.ownerKey);
  }

  /** Safety net: onLeave normally empties `seats`; this keeps a leak from locking a profile out for good. */
  onDispose() {
    const { profiles } = RaidRoom.ctx;
    this.bots?.dispose();
    if (this.opener) profiles.forgetRoom(this.opener, this.roomId);
    for (const [sessionId, seat] of this.seats) {
      if (this.world.state.players.get(sessionId)?.status === "alive") {
        this.bankVoided(seat.profile, abandonPlayer(this.world, sessionId));
      }
      profiles.release(seat.profile, seat.ownerKey);
    }
    this.seats.clear();
    this.picked.clear();
  }

  private bankVoided(profile: string, gv: number) {
    if (gv <= 0 || this.training) return;
    try {
      RaidRoom.ctx.store.bankGv(profile, gv);
    } catch (err) {
      console.error(`[raid ${this.roomId}] failed to bank the GV of ${profile}:`, err);
    }
  }

  private tick(elapsedMs: number) {
    if (!this.built) return;
    const { bots } = this;
    this.accumulator += elapsedMs;
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < MAX_CATCHUP_STEPS) {
      if (bots) {
        // Arrivals happen between steps, and a command that has reached the server by this step's time is applied by it, as a
        // socket message that came in since the last step would be.
        if (this.world.state.phase === "lobby") bots.lobbyTick();
        bots.beforeStep(this.world.state.serverTime + TICK_MS);
      }
      this.handleEvents(step(this.world, TICK_MS));
      this.accumulator -= TICK_MS;
      steps++;
    }
    if (this.accumulator >= TICK_MS) this.accumulator = 0;
    if (steps > 0) {
      this.fxChannel.extendRoster(this.world.state);
      this.broadcastPatch();
      this.fxChannel.rosterSent();
      // One frame per patch, like a client: the bots see this state and these batches, never anything a client did not get.
      bots?.afterPatch(this.botBatches.splice(0));
    }
  }

  private sendTo<K extends keyof ServerMessages>(sessionId: string, type: K, msg: ServerMessages[K]) {
    this.clients.getById(sessionId)?.send(type, msg);
  }

  /** A toast to a client, or, for a fill bot (no client), into its next frame. */
  private toastTo(id: string, text: string) {
    if (this.bots?.isBot(id)) this.bots.onToast(id, text);
    else this.sendTo(id, "toast", { text });
  }

  private handleEvents(events: SimEvent[]) {
    const fxs: FxEvent[] = [];
    for (const ev of events) {
      switch (ev.type) {
        case "fx":
          fxs.push(ev.fx);
          break;
        case "toast":
          this.toastTo(ev.to, ev.text);
          break;
        case "resolved":
          this.settle(ev.id, ev.result, ev.bot === true);
          break;
        case "gv":
          this.toastTo(ev.id, `+${ev.amount} GV (${GV_TOAST[ev.reason]})`);
          break;
        case "planningStarted":
        case "raidStarted":
          void this.lock();
          break;
        case "plan":
          // A bot has no client: its deal goes into its next frame (the planning module reads it).
          if (this.bots?.isBot(ev.to)) this.bots.onPrivate(ev.to, "plan", ev.plan);
          else this.sendTo(ev.to, "plan", ev.plan);
          break;
        case "raidEnded":
          this.clock.setTimeout(() => void this.disconnect(), ENDED_LINGER_SECONDS * 1000);
          break;
      }
    }
    // One message for the whole step, stamped with the step's time and sent before this tick's patch: a `teleport` has to
    // reach the client ahead of the patch that moves everyone (it marks the cut). A step with no fx and no new projectile
    // sends nothing.
    const batch = this.fxChannel.batch(fxs, this.world.state.serverTime, this.world.projectiles);
    if (batch) {
      this.broadcast("fxs", batch satisfies ServerMessages["fxs"]);
      if (this.bots) this.botBatches.push(batch);
    }
  }

  /**
   * A player's run is over: bank its GV and stats, free the profile, tell them. `bot` is the sim's own flag on the event, which
   * survives a bot that was removed before the event was handled; the world lookup is the second check.
   */
  private settle(sessionId: string, result: RunResult, bot = false) {
    // bots never touch persistence: a bot has no profile, and its display name could match a real one. recordRun, bankGv, the
    // profile registry and pendingResults are all out of reach from here on. The bot's brain learns from it, and that is all.
    if (bot || this.world.players.get(sessionId)?.bot) {
      this.bots?.onResult(sessionId, result);
      return;
    }
    // The sim never resolves a training run; this is the second lock on "no GV, no stats, no achievements".
    if (this.training) return;
    const { store, profiles } = RaidRoom.ctx;
    let unlocked: string[] = [];
    // The weapon in hand when the run ended (the winner is still in the state), and the faction if it was picked.
    const p = this.world.state.players.get(sessionId);
    const held = p ? (p.slot === 1 ? p.weapon1 : p.weapon0) : "";
    const faction = this.picked.get(sessionId);
    this.picked.delete(sessionId);
    try {
      ({ unlocked } = store.recordRun(result.profile, {
        outcome: result.outcome, kills: result.kills, gv: result.gv.total, bounty: result.gv.bounty,
        weapon: held || undefined,
        ...(faction ? { faction } : {}),
        // The win bonus gate doubles as the achievements' anti-farming gate (see RunRecord.winQualified).
        winQualified: result.outcome === "won" && !result.winBonusWithheld,
      }));
    } catch (err) {
      // Never let a store problem stop the result from reaching the player or the profile from freeing up.
      console.error(`[raid ${this.roomId}] failed to persist the result of ${result.profile}:`, err);
    }
    // Released now rather than at onLeave so the player can queue again while still on the results screen.
    profiles.release(result.profile, this.ownerKey(sessionId));
    const sent: RunResult = unlocked.length > 0 ? { ...result, achievements: unlocked } : result;
    this.pendingResults.set(sessionId, sent);
    this.sendTo(sessionId, "result", sent);
  }
}
