// Fill bots in the planning phase (roguelike R3 meets docs/BOTS.md 8). The brain has no planning module yet, so BotManager presses
// Ready for each bot, 1 to 3 s into the phase, through the delay line a click takes (TODO(planning module)); these tests pin that
// stand-in, so the room never waits out the planning timer for bots, and the humans-only win-bonus gate across planning leavers.
import { describe, expect, it } from "vitest";
import { mulberry32, TICK_MS } from "@raid/shared";
import { BOT_FILL_DEFAULTS } from "../src/bots/brain/types";
import { createHeadlessRoom } from "../src/bots/tournament/headlessRoom";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import type { SimConfig } from "../src/sim/world";

const PLAN_SECONDS = 12;

function planningRoom(fillTo: number, lineup: number, seed = 5) {
  return createHeadlessRoom({
    seed,
    config: { planSeconds: PLAN_SECONDS, firstPatienceSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    bots: { ...BOT_FILL_DEFAULTS, fillTo },
    lineup: Array.from({ length: lineup }, () => ({})),
    startAtOnce: lineup > 0,
  });
}

/** Ticks until the run starts, noting for each bot the planning-relative time (ms) at which its `planReady` first showed. */
function readyTimes(room: ReturnType<typeof planningRoom>): { times: Map<string, number>; planMs: number; sentAtStart: number } {
  const s = room.world.state;
  while (s.phase === "lobby") room.tick();
  expect(s.phase).toBe("planning");
  const t0 = s.serverTime;
  const times = new Map<string, number>();
  let sentAtStart = -1;
  for (let i = 0; i < PLAN_SECONDS * 20 + 40 && s.phase === "planning"; i++) {
    room.tick();
    for (const [id, p] of s.players) if (p.bot && p.planReady && !times.has(id)) times.set(id, s.serverTime - t0);
  }
  sentAtStart = room.manager.stats.sent;
  return { times, planMs: s.serverTime - t0, sentAtStart };
}

describe("fill bots in planning", () => {
  it("each presses ready once, 1 to 3 s in (plus the uplink), so the phase ends long before its timer", () => {
    const room = planningRoom(6, 6);
    const { times, planMs, sentAtStart } = readyTimes(room);
    expect(room.world.state.phase).toBe("active");
    expect([...times.keys()].sort()).toEqual(room.seats.map((s) => s.id).sort());
    const latency = BOT_FILL_DEFAULTS.latencyMs + BOT_FILL_DEFAULTS.jitterMs;
    for (const [id, ms] of times) {
      expect(ms, `${id} pressed ready too early`).toBeGreaterThanOrEqual(1000 - TICK_MS);
      expect(ms, `${id} pressed ready too late`).toBeLessThanOrEqual(3000 + latency + 3 * TICK_MS);
    }
    // They do not all press it in the same tick: each draws its own time.
    expect(new Set(times.values()).size).toBeGreaterThan(1);
    // The last one to be ready ended the phase, and it sent exactly one message each, none refused.
    expect(planMs).toBeLessThanOrEqual(Math.max(...times.values()) + TICK_MS);
    expect(planMs).toBeLessThan(PLAN_SECONDS * 1000 - 5000);
    expect(sentAtStart).toBe(6);
    expect(room.manager.stats.refused).toBe(0);
    expect(room.manager.stats.errors).toBe(0);
  });

  it("replays exactly: the same seed presses ready at the same times", () => {
    const a = readyTimes(planningRoom(4, 4, 9));
    const b = readyTimes(planningRoom(4, 4, 9));
    expect([...b.times]).toEqual([...a.times]);
    expect(b.planMs).toBe(a.planMs);
  });

  it("with a human who never presses it, the bots are ready and the phase waits out the timer for the human alone", () => {
    const room = planningRoom(4, 3);
    const { world } = room;
    addPlayer(world, "h0", "Hannah");
    world.state.lobbyEndsAt = world.state.serverTime;
    const { times, planMs } = readyTimes(room);
    expect(times.size).toBe(3);
    expect(world.state.players.get("h0")!.planReady).toBe(false);
    // The human had until planEndsAt; nothing short of it ended the phase.
    expect(planMs).toBeGreaterThanOrEqual(PLAN_SECONDS * 1000 - TICK_MS);
    expect(world.state.phase).toBe("active");
    expect(world.arena.startedHumans).toBe(1);
    expect(world.arena.startedWith).toBe(4);
  });

  it("a human who leaves in planning is still a starter for the win bonus gate, a bot never is", () => {
    const cfg: SimConfig = {
      minPlayers: 9, lobbySeconds: 1, fillSeconds: 1, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
      planSeconds: 3, firstPatienceSeconds: 0,
    };
    const w = createGameWorld({ seed: 31, config: cfg, random: mulberry32(32), rewardSalt: 7 });
    for (let i = 0; i < 3; i++) addPlayer(w, `h${i}`, `human${i}`);
    for (let i = 0; i < 2; i++) addPlayer(w, `bot~${i}`, `Bot${i}`, { bot: true });
    while (w.state.phase === "lobby") step(w, TICK_MS);
    expect(w.state.phase).toBe("planning");
    removePlayer(w, "h2"); // out in planning: MIA, but it started
    while (w.state.phase === "planning") step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(w.state.players.size).toBe(4);
    expect(w.arena.startedWith).toBe(5);
    expect(w.arena.startedHumans).toBe(3);
  });
});
