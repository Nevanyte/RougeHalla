// Thin Colyseus adapter around the headless sim: validates/enqueues inputs, ticks the
// world at a fixed rate, and turns sim events into messages (and later, persistence).
import { randomInt } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import {
  CLIENT_MESSAGE_TYPES, ENDED_LINGER_SECONDS, MAX_PLAYERS, PROFILE_RE, RECONNECT_SECONDS, TICK_MS,
  type JoinOptions, type RaidResult, type ServerMessages,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import type { ServerConfig } from "../config";
import { createGameWorld } from "../sim/gameplay";
import { enqueueClientMessage } from "../sim/inputs";
import { addPlayer, removePlayer, step } from "../sim/step";
import type { SimEvent, World } from "../sim/world";

/** Fixed steps run per simulation callback at most; older backlog is dropped. */
const MAX_CATCHUP_STEPS = 3;

export interface RoomContext {
  config: ServerConfig;
}

export class RaidRoom extends Room<{ state: RaidState }> {
  /** Set once by createServer(); rooms are constructed by the matchmaker. */
  static ctx: RoomContext;

  maxClients = MAX_PLAYERS;
  /** Spam guard; legit clients send ≤ ~20/s (move repeat + clicks). Exceeding it disconnects. */
  maxMessagesPerSecond = 60;

  private world!: World;
  private accumulator = 0;
  /** Results survive a dropped connection so a reconnecting client still gets theirs. */
  private readonly pendingResults = new Map<string, RaidResult>();

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

  onAuth(_client: Client, options: Partial<JoinOptions> | undefined) {
    // Seats can be reserved just before the raid starts; refuse them so nobody lands in an
    // active raid stuck in "lobby". Reconnections bypass onAuth.
    if (this.world.state.phase !== "lobby") throw new Error("raid already started");
    const profile = options?.profile;
    if (typeof profile !== "string" || !PROFILE_RE.test(profile)) {
      throw new Error("invalid profile name");
    }
    return { profile };
  }

  onJoin(client: Client) {
    const profile = (client.auth as { profile: string }).profile;
    addPlayer(this.world, client.sessionId, profile, []);
  }

  onDrop(client: Client) {
    // Rejects when the client never finished joining or the room is disposing; onLeave still runs.
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => {});
  }

  onReconnect(client: Client) {
    const result = this.pendingResults.get(client.sessionId);
    if (result) client.send("result", result);
  }

  onLeave(client: Client) {
    removePlayer(this.world, client.sessionId);
    this.pendingResults.delete(client.sessionId);
    // A leave can resolve a player outside of a tick (MIA); flush those events now.
    this.handleEvents(this.world.events.splice(0));
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
          this.pendingResults.set(ev.id, ev.result);
          this.sendTo(ev.id, "result", ev.result);
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
}
