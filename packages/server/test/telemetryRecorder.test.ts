// The telemetry recorder (docs/TELEMETRY.md 3): source classification, death causes, healing, offers and picks, the 1 Hz
// sampler, power snapshots, the caps and `truncated`, on scripted worlds.
import { describe, expect, it } from "vitest";
import {
  SUDDEN_DEATH_KILLER, TELEMETRY_MAX_OFFERS, TELEMETRY_MAX_SAMPLES, TICK_MS, TILE_ABSENT, unpackTiles, validateRunRecord,
} from "@raid/shared";
import { dropStatChest } from "../src/sim/chests";
import { heal } from "../src/sim/factions";
import { enqueueClientMessage } from "../src/sim/inputs";
import { makeRig } from "./support/telemetryRig";

const PER_SECOND = 1000 / TICK_MS;

describe("telemetry recorder: damage", () => {
  it("classifies each ledger entry by source, dealt and taken alike", () => {
    const r = makeRig(2);
    r.hit({ victim: "p1", by: "p0", amount: 10 });
    r.hit({ victim: "p1", by: "p0", amount: 20, sig: "burn", dot: true });
    r.hit({ victim: "p1", by: "p0", amount: 30, ability: "freeze", weapon: null });
    r.hit({ victim: "p1", by: "p0", amount: 40, derived: true });
    r.hit({ victim: "p1", by: "p0", amount: 50, passive: true });
    r.hit({ victim: "p1", by: "p0", amount: 60, dot: true, weapon: null });
    r.run(1);
    const d = r.draft("void");
    expect(d.players[0]!.dealt.players).toEqual({ weapon: 10, signature: 20, wish: 30, splash: 40, returned: 50, card: 60 });
    expect(d.players[1]!.taken).toEqual({ weapon: 10, signature: 20, wish: 30, splash: 40, returned: 50, card: 60 });
    expect(d.players[0]!.wish).toMatchObject({ damage: 30, hits: 1 });
    expect(d.players[1]!.dealt.players).toEqual({});
  });

  it("arena damage is taken only, and a sudden-death kill is its own cause", () => {
    const r = makeRig(3, { hp: 100 });
    r.hit({ victim: "p2", by: "terrain:ember", amount: 10, arena: true });
    r.run(1);
    r.hit({ victim: "p2", by: SUDDEN_DEATH_KILLER, amount: 500, arena: true });
    r.run(1);
    const d = r.draft("void");
    expect(d.players[2]!.taken.terrain).toBe(10);
    expect(d.players[2]!.taken.suddenDeath).toBe(90);
    expect(d.players[2]!.death).toMatchObject({ kind: "suddenDeath" });
    expect(d.players[2]!.outcome).toBe("died");
    expect(d.firstBlood).toMatchObject({ victim: 2, killer: -1 });
  });

  it("a kill by terrain within KILL_CREDIT_SECONDS of a rival's hit is that rival's kill", () => {
    const r = makeRig(3, { hp: 100 });
    r.hit({ victim: "p1", by: "p2", amount: 50 });
    r.run(10);
    r.hit({ victim: "p1", by: "terrain:ember", amount: 500, arena: true });
    r.run(1);
    const d = r.draft("void");
    expect(d.players[1]!.death).toMatchObject({ kind: "player", bySlot: 2 });
    expect(d.players[1]!.death?.weapon).toBeUndefined();
  });

  it("heals are counted by source", () => {
    const r = makeRig(2);
    r.hit({ victim: "p0", by: "p1", amount: 300 });
    r.run(1);
    const c = { kind: "player" as const, id: "p0", s: r.world.state.players.get("p0")!, rt: r.world.players.get("p0")! };
    heal(r.world, c, 25, { ignoreLockout: true, source: "potion" });
    heal(r.world, c, 5, { lifesteal: true });
    const d = r.draft("void");
    expect(d.players[0]!.healed).toEqual({ potion: 25, lifesteal: 5 });
  });
});

describe("telemetry recorder: offers, sampler, snapshots, caps", () => {
  it("records a stat chest's offer to the players in range and their pick", () => {
    const r = makeRig(2);
    const p0 = r.world.state.players.get("p0")!;
    const box = dropStatChest(r.world, { x: p0.x + 20, y: p0.y });
    r.run(3);
    enqueueClientMessage(r.world.players.get("p0")!.inputs, "choose", { chest: box.id, pick: 1 });
    r.run(1);
    const d = r.draft("void");
    expect(d.offers).toHaveLength(1);
    const o = d.offers[0]!;
    expect(o.kind).toBe("stat");
    expect(o.camp).toBe(-1);
    expect(o.options).toHaveLength(3);
    expect(o.options.every((x) => x.startsWith("boost:"))).toBe(true);
    expect(o.eligible).toEqual([0]);
    expect(o.picks).toMatchObject([{ slot: 0, option: 1 }]);
    expect(d.players[0]!.final.boostsTotal).toBe(1);
  });

  it("offers past the cap are counted, not kept", () => {
    const r = makeRig(2);
    const p0 = r.world.state.players.get("p0")!;
    for (let i = 0; i < TELEMETRY_MAX_OFFERS + 2; i++) dropStatChest(r.world, { x: p0.x, y: p0.y });
    const d = r.draft("void");
    expect(d.offers).toHaveLength(TELEMETRY_MAX_OFFERS);
    expect(d.truncated?.offers).toBe(2);
  });

  it("samples weapon, zone and tile seconds at 1 Hz, and TILE_ABSENT once a player is down", () => {
    const r = makeRig(3, { hp: 100 });
    r.run(3 * PER_SECOND);
    r.hit({ victim: "p1", by: "p0", amount: 500 });
    r.run(2 * PER_SECOND);
    const d = r.draft("void");
    expect(d.players[0]!.weaponMs).toEqual({ fists: 5000 });
    expect(d.players[0]!.mainWeapon).toBe("fists");
    expect(Object.values(d.players[0]!.zoneMs).reduce((a, b) => a + b!, 0)).toBe(5000);
    expect(d.players[1]!.weaponMs.fists).toBe(3000);
    const tiles = unpackTiles(d.players[1]!.tiles!)!;
    expect(tiles.length).toBe(10);
    expect(tiles[0]).toBe(d.players[1]!.spawn.tx);
    expect(tiles[8]).toBe(TILE_ABSENT);
    expect(d.players[1]!.aliveMs).toBeGreaterThan(3000);
    expect(d.players[1]!.aliveMs).toBeLessThan(3200);
  });

  it("takes the minute-1 power snapshot for standing players only", () => {
    const r = makeRig(3, { hp: 100 });
    r.hit({ victim: "p2", by: "p0", amount: 500 });
    r.run(61 * PER_SECOND);
    const d = r.draft("void");
    expect(d.players[0]!.snapshots).toHaveLength(1);
    expect(d.players[0]!.snapshots[0]).toMatchObject({ minute: 1, cardPower: 0 });
    expect(d.players[2]!.snapshots).toHaveLength(0);
  });

  it("stops keeping tiles past TELEMETRY_MAX_SAMPLES and counts the seconds dropped", () => {
    const r = makeRig(2);
    r.rec.sampleCount = TELEMETRY_MAX_SAMPLES - 1;
    r.run(3 * PER_SECOND);
    const d = r.draft("void");
    expect(d.truncated?.samples).toBe(2);
    expect(unpackTiles(d.players[0]!.tiles!)!.length).toBe(2 * TELEMETRY_MAX_SAMPLES);
  });

  it("positions off: no tiles", () => {
    const r = makeRig(2, { positions: false });
    r.run(2 * PER_SECOND);
    expect(r.draft("void").players[0]!.tiles).toBeUndefined();
  });

  it("a finished run's draft, filled like the Room fills it, validates", () => {
    const r = makeRig(2, { hp: 100 });
    r.hit({ victim: "p1", by: "p0", amount: 500 });
    r.run(2);
    const d = r.draft();
    expect(d.end).toBe("winner");
    expect(d.winnerSlot).toBe(0);
    const record = {
      ...d, runId: "3f2b8c1e-5d4a-4b6f-9c2e-1a7d0e9b4c55", source: "test", build: { server: "abc", commit: null },
      startedAtEpoch: 1, endedAtEpoch: 2, config: { ...d.config, botsFillTo: 0 },
      players: d.players.map(({ id: _i, profile: _p, ...p }) => ({ ...p, pid: null, net: { drops: 0, reconnects: 0 }, afkMs: 0, afk: false })),
    };
    expect(validateRunRecord(record)).toBeNull();
    expect(JSON.stringify(record)).not.toContain("player0");
  });
});
