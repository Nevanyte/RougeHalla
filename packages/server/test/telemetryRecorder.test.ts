// The telemetry recorder (docs/TELEMETRY.md 3): source classification, death causes, healing, offers and picks, the 1 Hz
// sampler, power snapshots, the caps and `truncated`, on scripted worlds.
import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, SUDDEN_DEATH_KILLER, TELEMETRY_MAX_OFFERS, TELEMETRY_MAX_SAMPLES, TICK_MS, TILE, TILE_ABSENT, TILE_FLOOR,
  TILE_WALL, unpackTiles, validateRunRecord, type CampDef, type GameMap,
} from "@raid/shared";
import { dropStatChest } from "../src/sim/chests";
import { heal } from "../src/sim/factions";
import { enqueueClientMessage } from "../src/sim/inputs";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import type { MobCombatant } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import { installTelemetry, restartWholeCamps } from "../src/sim/telemetry";
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

describe("telemetry recorder: camp cycles", () => {
  const at = (t: number): number => t * TILE + TILE / 2;
  function campWorld() {
    const W = 40, H = 20;
    const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
    for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
    for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
    const camp: CampDef = {
      id: "fire-1", zone: "fire", x: at(10), y: at(5), r: 96,
      spots: [{ x: at(9), y: at(4) }, { x: at(11), y: at(4) }, { x: at(10), y: at(7) }],
      eliteSpot: -1, chest: { x: at(10), y: at(5) }, area: 0, radius: 288,
    };
    const map: GameMap = { ...mapFromTiles(W, H, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: at(3 + 4 * i), y: at(15) })), camps: [camp] };
    const w = createGameWorld({
      config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: true },
      random: mulberry32(12), rewardSalt: 99, map,
    }, { signatures: false });
    const rec = installTelemetry(w);
    for (let i = 0; i < 2; i++) addPlayer(w, `p${i}`, `name${i}`, { faction: "frost" });
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    const mobs = [...w.state.mobs].filter(([, m]) => m.camp === 1).map(([id]) => combatant(w, id) as MobCombatant);
    const hit = (by: string, mob: MobCombatant, raw: number): void => {
      recordHit(w, { victim: mob.id, by: { id: by, name: by }, packet: { raw, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
      applyLedger(w);
      w.events.length = 0;
    };
    return { w, rec, mobs, hit };
  }

  it("a camp that went whole again starts its clear's clock and contributors over", () => {
    const { w, rec, mobs, hit } = campWorld();
    hit("p1", mobs[0]!, 5);
    const poked = rec.campEngaged[0]!;
    expect(poked).toBeGreaterThanOrEqual(0);
    restartWholeCamps(rec);
    expect(rec.campEngaged[0]).toBe(poked); // still wounded and fighting
    // It walks home: whole, idle, at full hp (mobAI's arrival).
    w.state.serverTime += 30_000;
    for (const m of mobs) { m.s.hp = m.s.maxHp; m.rt.brain!.mode = "idle"; }
    restartWholeCamps(rec);
    expect(rec.campEngaged[0]).toBe(-1);
    expect(rec.campContrib[0]).toBe(0);
    const engagedAgain = w.state.serverTime;
    for (const m of mobs) hit("p0", m, 1e6);
    expect(rec.camps).toHaveLength(1);
    expect(rec.camps[0]!.contributors).toEqual([0]);
    expect(rec.camps[0]!.engagedAt).toBe(Math.round(engagedAgain - rec.startAt));
  });

  it("a camp with a member down is only paused, not whole", () => {
    const { rec, mobs, hit } = campWorld();
    hit("p1", mobs[0]!, 1e6);
    const poked = rec.campEngaged[0]!;
    for (const m of mobs.slice(1)) { m.s.hp = m.s.maxHp; m.rt.brain!.mode = "idle"; }
    restartWholeCamps(rec);
    expect(rec.campEngaged[0]).toBe(poked);
    for (const m of mobs.slice(1)) hit("p0", m, 1e6);
    expect(rec.camps[0]!.contributors).toEqual([0, 1]);
  });
});
