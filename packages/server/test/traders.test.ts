import { describe, expect, it } from "vitest";
import { TILE_FLOOR, TILE_LOW, mapFromTiles, mulberry32, TRADER_RANGE, WEAPONS } from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { grantCard } from "../src/sim/chests";
import { grantMobStat } from "../src/sim/mobStats";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import { handleTrade, rollStatTrades, updateTraders } from "../src/sim/traders";
import { adOf, apOf, recomputeMods } from "../src/sim/mods";
import type { World } from "../src/sim/world";

function run(training = false): World {
  const world = createGameWorld({ random: mulberry32(8), rewardSalt: 52,
    map: mapFromTiles(28, 28, new Uint8Array(28 * 28).fill(TILE_FLOOR)),
    config: { minPlayers: 2, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 600, patienceMinSeconds: 600, suddenDeathSeconds: 60, training },
  });
  addPlayer(world, "a", "Alice", { faction: "fire" }); addPlayer(world, "b", "Bob", { faction: "holy" });
  step(world, 50);
  return world;
}

function visit(w: World, kind: string) {
  const trader = [...w.state.traders.values()].find(t => t.kind === kind)!;
  const c = combatant(w, "a")!;
  if (c.kind !== "player") throw new Error("expected a player");
  c.s.x = trader.x; c.s.y = trader.y;
  return { trader, c, p: w.state.players.get("a")! };
}

describe("wandering traders", () => {
  it("spawns exactly two immune noncombatants in a raid, but none in training", () => {
    const w = run();
    expect(w.state.traders.size).toBe(2);
    for (const npc of w.state.traders.values()) expect(combatant(w, npc.id)).toBeNull();
    expect(run(true).state.traders.size).toBe(0);
  });

  it("wanders over reachable floor and stops for visitors", () => {
    const w = run(), { trader, p } = visit(w, "barter");
    const at = { x: trader.x, y: trader.y };
    w.state.serverTime = 20_000; updateTraders(w, 1000);
    expect({ x: trader.x, y: trader.y }).toEqual(at);
    p.x = -1000; p.y = -1000;
    w.state.players.get("b")!.x = -1000; w.state.players.get("b")!.y = -1000;
    w.state.serverTime = 40_000; updateTraders(w, 1000);
    expect(Math.hypot(trader.x - at.x, trader.y - at.y)).toBeGreaterThan(0);
    expect(Math.hypot(trader.x - at.x, trader.y - at.y)).toBeLessThanOrEqual(42.001);
  });

  it("rolls three persistent choices from current stats, once per approach", () => {
    const w = run(), { p } = visit(w, "stats");
    updateTraders(w, 50);
    expect(p.tradeOffers.length).toBe(3);
    const first = [...p.tradeOffers];
    updateTraders(w, 50);
    expect([...p.tradeOffers]).toEqual(first);
    expect(first.map(raw => JSON.parse(raw).cost)).toHaveLength(new Set(first.map(raw => JSON.parse(raw).cost)).size);
    const offers = rollStatTrades(w, p);
    for (const offer of offers) {
      expect(offer.cost).not.toBe(offer.gain);
      expect(offer.costValue).toBeGreaterThan(0);
      expect(offer.gainValue).toBeGreaterThan(0);
    }
  });

  it("neither freezes a trader nor accepts an exchange through a see-through fence", () => {
    const w = run(), { p, c, trader } = visit(w, "stats");
    trader.x = 272; trader.y = 176; p.x = 208; p.y = 176;
    w.map.tiles[5 * w.map.w + 7] = TILE_LOW;
    const walker = w.traders!.walkers.get(trader.id)!;
    walker.nextWalkAt = 10_000;
    updateTraders(w, 50);
    expect(p.tradeOffers.length).toBe(0);
    expect(walker.nextWalkAt).toBe(10_000);
    p.tradeOffers.push(JSON.stringify({ cost: "maxHp", costValue: .12, gain: "ad", gainValue: 18, label: "test trade" }));
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(p.tradeUsed).toBe(false);
    expect(p.tradeStats.size).toBe(0);
  });

  it("pays an actual stat cost and gain once, with range and replay protection", () => {
    const w = run(), { p, c, trader } = visit(w, "stats");
    p.tradeOffers.push(JSON.stringify({ cost: "maxHp", costValue: .12, gain: "ad", gainValue: 18, label: "test trade" }));
    const hp = p.maxHp;
    p.x += TRADER_RANGE + 1;
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(p.tradeUsed).toBe(false);
    p.x = trader.x;
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(p.tradeUsed).toBe(true);
    expect(p.maxHp).toBeCloseTo(hp * .88);
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
    expect(adOf(p)).toBeCloseTo(18);
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(p.maxHp).toBeCloseTo(hp * .88);
    recomputeMods(w, c);
    expect(adOf(p)).toBeCloseTo(18);
  });

  it("barters the active weapon for a different weapon or a potion, consuming the cost", () => {
    const w = run(), { p, c, trader } = visit(w, "barter");
    p.weapon0 = "sword"; p.weapon1 = ""; p.slot = 0;
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(p.weapon0).toBe("bow");
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 1 });
    expect(p.potionSmall).toBe(0);
    w.state.serverTime += 5000;
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 1 });
    expect(p.weapon0).toBe(""); expect(p.potionSmall).toBe(1);
    w.state.serverTime += 5000;
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 2 });
    expect(p.potionSmall).toBe(0); expect(WEAPONS[p.weapon0 as keyof typeof WEAPONS]).toBeDefined();
  });

  it("increasing max HP through a stat trade never grants free healing", () => {
    const w = run(), { p, c, trader } = visit(w, "stats");
    p.hp = p.maxHp * .4;
    const hp = p.hp, max = p.maxHp;
    p.tradeOffers.push(JSON.stringify({ cost: "armor", costValue: 12, gain: "maxHp", gainValue: .18, label: "test trade" }));
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(p.maxHp).toBeCloseTo(max * 1.18);
    expect(p.hp).toBe(hp);
  });

  it("preserves current cards, uncapped mob growth and champion progression through the trade", () => {
    const w = run(), { p, c, trader } = visit(w, "stats");
    grantCard(w, c, "ap1"); grantMobStat(w, c, "miasmaWitch", 50);
    p.campClears = 7; p.roamCharge = 650; p.roamReady = true; p.huntStacks = 2;
    const before = apOf(p), cards = [...p.build], farm = [...p.mobStats];
    p.tradeOffers.push(JSON.stringify({ cost: "armor", costValue: 12, gain: "ap", gainValue: 18, label: "test trade" }));
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 0 });
    expect(apOf(p)).toBeCloseTo(before + 18);
    expect([...p.build]).toEqual(cards); expect([...p.mobStats]).toEqual(farm);
    expect([p.campClears, p.roamCharge, p.roamReady, p.huntStacks]).toEqual([7, 650, true, 2]);
    grantMobStat(w, c, "miasmaWitch", 1);
    expect(apOf(p)).toBeCloseTo(before + 19);
  });

  it("never turns an empty fist into a free item or fills a locked second slot", () => {
    const w = run(), { p, c, trader } = visit(w, "barter");
    p.weapon0 = ""; p.weapon1 = "";
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 1 });
    expect(p.potionSmall).toBe(0);
    p.weapon0 = "sword"; p.potionSmall = 1; grantCard(w, c, "committed");
    handleTrade(w, c, { kind: "trade", trader: trader.id, pick: 2 });
    expect(p.potionSmall).toBe(1); expect(p.weapon1).toBe("");
  });
});
