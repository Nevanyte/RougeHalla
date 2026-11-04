// The spell slot (shared/spells.ts, sim/spells.ts): finds placed on the map when the run starts, one spell held at a time (a
// pickup lays the held one down where the find lay), the reload on the slot's stock clock (it belongs to the copy, hand or
// ground), the cast through the ordinary pipeline on slot "spell", the drop where a holder falls, and the training rack. No spell
// exists yet: the first block pins that the empty catalog changes nothing; the rest register test-only spells.
import { describe, expect, it } from "vitest";
import {
  ABILITIES, abilityInSlot, chargesAt, EFFECT_HASTE, chooseSpellFinds, heldSpell, isSpellId, mapFromTiles, mulberry32, pickSpell,
  regionAt, slotFullAt, slotReadyAt, SPELL_FIND_CLEARANCE_TILES, SPELL_FINDS_PER_ZONE, SPELL_REFUSAL, spellIds, spellPool,
  spellTakenText, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type AbilityId, type GameMap, type Vec2,
} from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { downPlayer } from "../src/sim/arena";
import { cancelCast } from "../src/sim/abilities";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { dropSpell } from "../src/sim/spells";
import { addPlayer, startRaid, step } from "../src/sim/step";
import { installTraining } from "../src/sim/training";
import type { SimConfig, SimEvent, World } from "../src/sim/world";
import { BOLT, BOLT_RELOAD_MS, SPARK, TEST_SPELLS, useTestSpells, WARD, WARD_CAST_MS, WARD_RELOAD_MS } from "./support/testSpell";

const BASE: SimConfig = {
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600,
  wishLockSeconds: 0, pvpRules: false, regen: false,
};

const T = (w: World) => w.state.serverTime;
const tc = (t: number) => t * TILE + TILE / 2;
const spellsOn = (w: World) => [...w.state.containers.values()].filter((c) => c.kind === "spell");
const P = (w: World, id: string) => w.state.players.get(id)!;

function toasts(events: SimEvent[], to: string): string[] {
  return events.filter((e): e is Extract<SimEvent, { type: "toast" }> => e.type === "toast" && e.to === to).map((e) => e.text);
}

function roomMap(): GameMap {
  const W = 30, H = 16;
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) { tiles[x] = TILE_WALL; tiles[(H - 1) * W + x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { tiles[y * W] = TILE_WALL; tiles[y * W + W - 1] = TILE_WALL; }
  return { ...mapFromTiles(W, H, tiles), spawns: [{ x: tc(3), y: tc(3) }, { x: tc(25), y: tc(12) }] };
}

/** Two players on a hand-built room, in the run. */
function rig(): World {
  const map = roomMap();
  const world = createGameWorld({ seed: 7, map: { ...map, seed: 7 }, config: BASE, random: mulberry32(8) }, { signatures: false });
  world.map = map;
  addPlayer(world, "a", "alice", { faction: "fire" });
  addPlayer(world, "b", "bob", { faction: "holy" });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

function place(world: World, who: string, at: Vec2): void {
  const c = combatant(world, who)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: T(world), x: at.x, y: at.y }];
}

function pickup(world: World, who: string, box: ContainerState): SimEvent[] {
  expect(enqueueClientMessage(world.players.get(who)!.inputs, "pickup", { containerId: box.id })).toBe(true);
  return step(world, TICK_MS);
}

function castSpell(world: World, who: string): SimEvent[] {
  const p = P(world, who);
  expect(enqueueClientMessage(world.players.get(who)!.inputs, "cast", { slot: "spell", x: p.x, y: p.y, seq: 3 })).toBe(true);
  return step(world, TICK_MS);
}

function runFor(world: World, ms: number): void {
  const end = T(world) + ms;
  while (T(world) < end) step(world, TICK_MS);
}

describe("the spell slot with no spell in the catalog (today)", () => {
  it("the catalog and the pool are empty, the slot holds nothing, and a cast on it changes nothing but the order echo", () => {
    expect(spellIds()).toEqual([]);
    expect(spellPool()).toEqual([]);
    const w = rig();
    const p = P(w, "a");
    expect(abilityInSlot(p, "spell")).toBeNull();
    // A forged spell id in the slot is no spell either (only an ability of kind "spell" is).
    p.extra.spell = "frostWall";
    expect(heldSpell(p)).toBeNull();
    p.extra.spell = "";
    castSpell(w, "a");
    expect(p.moveSeq).toBe(3);
    expect(w.players.get("a")!.cast ?? null).toBeNull();
    expect([p.extra.spellReadyAt, p.extra.spellFullAt]).toEqual([0, 0]);
  });

  it("a generated map's run lays out no spell find, and the game's own containers are what they were", () => {
    const world = createGameWorld({ seed: 1234, config: { ...BASE, minPlayers: 1 }, random: mulberry32(1235) });
    const before = [...world.state.containers.values()].map((c) => `${c.kind}:${c.x},${c.y}`);
    addPlayer(world, "a", "alice");
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    expect(spellsOn(world)).toEqual([]);
    expect([...world.state.containers.values()].map((c) => `${c.kind}:${c.x},${c.y}`).slice(0, before.length)).toEqual(before);
  });
});

describe("spells (test-only spells registered)", () => {
  useTestSpells();

  it("the catalog lists every spell, the pool those with a spawn weight, and a weighted pick follows the weights", () => {
    expect(spellIds()).toEqual([BOLT, WARD, SPARK]);
    expect(spellPool()).toEqual([BOLT, SPARK]);
    expect(isSpellId(BOLT)).toBe(true);
    expect(isSpellId("blaze")).toBe(false);
    const pool = spellPool();
    const counts = new Map<AbilityId, number>();
    for (let i = 0; i < 400; i++) {
      const id = pickSpell(pool, (i + 0.5) / 400)!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // BOLT weighs 1, SPARK 3.
    expect(counts.get(BOLT)).toBe(100);
    expect(counts.get(SPARK)).toBe(300);
    expect(pickSpell([], 0.5)).toBeNull();
  });

  it("finds go in every zone, on its ground spots, clear of the other containers and of each other", () => {
    const world = createGameWorld({ seed: 1234, config: { ...BASE, minPlayers: 1 }, random: mulberry32(1235), rewardSalt: [1, 2, 3, 4] });
    addPlayer(world, "a", "alice");
    step(world, TICK_MS);
    const finds = spellsOn(world);
    const zones = new Map<string, number>();
    for (const f of finds) {
      const zone = regionAt(world.map, f.x, f.y);
      zones.set(zone, (zones.get(zone) ?? 0) + 1);
      expect(world.map.groundSpots.some((s) => s.x === f.x && s.y === f.y)).toBe(true);
      expect(f.items).toHaveLength(1);
      expect(spellPool()).toContain(f.items[0]!.def);
      expect(f.readyAt).toBe(0);
      expect(f.label).toBe(ABILITIES[f.items[0]!.def as AbilityId].name);
      for (const o of world.state.containers.values()) {
        if (o === f) continue;
        expect(Math.hypot(o.x - f.x, o.y - f.y)).toBeGreaterThanOrEqual(SPELL_FIND_CLEARANCE_TILES * TILE);
      }
    }
    expect([...zones.keys()].sort()).toEqual(["fire", "frost", "holy", "plague", "sentenced"]);
    for (const n of zones.values()) expect(n).toBeLessThanOrEqual(SPELL_FINDS_PER_ZONE);
    expect(finds.length).toBeGreaterThanOrEqual(5);
  });

  it("where they go depends on the secret salt (not on the public seed or world.random), and the loot rolls do not move", () => {
    const layout = (salt: number[]) => {
      const world = createGameWorld({ seed: 1234, config: { ...BASE, minPlayers: 1 }, random: mulberry32(1235), rewardSalt: salt });
      addPlayer(world, "a", "alice");
      step(world, TICK_MS);
      return {
        finds: spellsOn(world).map((f) => `${f.x},${f.y}:${f.items[0]!.def}`).sort(),
        loot: [...world.state.containers.values()].filter((c) => c.kind !== "spell").map((c) => `${c.kind}:${c.x},${c.y}:${c.items.map((i) => i.def)}`),
        next: world.random(),
      };
    };
    const a = layout([1, 2, 3, 4]);
    const again = layout([1, 2, 3, 4]);
    const b = layout([9, 8, 7, 6]);
    expect(again).toEqual(a);
    expect(b.finds).not.toEqual(a.finds);
    expect(b.loot).toEqual(a.loot);
    expect(b.next).toBe(a.next);
  });

  it("chooseSpellFinds places nothing for an empty pool or a zero count, without asking for a single hash", () => {
    let asked = 0;
    const unit = () => { asked++; return 0.5; };
    const world = createGameWorld({ seed: 1234, config: { ...BASE, minPlayers: 1 }, random: mulberry32(1235) });
    expect(chooseSpellFinds(world.map, [], 2, [], 2, unit)).toEqual([]);
    expect(chooseSpellFinds(world.map, [BOLT], 0, [], 2, unit)).toEqual([]);
    expect(asked).toBe(0);
  });

  it("a pickup puts the find's spell in the slot, takes the find away and says so", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const find = dropSpell(w, { x: tc(6), y: tc(5) }, BOLT);
    step(w, TICK_MS);
    const ev = pickup(w, "a", find);
    const p = P(w, "a");
    expect(p.extra.spell).toBe(BOLT);
    expect(abilityInSlot(p, "spell")?.def.id).toBe(BOLT);
    expect(w.state.containers.has(find.id)).toBe(false);
    expect(spellsOn(w)).toHaveLength(0);
    expect(toasts(ev, "a")).toEqual([spellTakenText(ABILITIES[BOLT])]);
    // Weapons never change.
    expect([p.weapon0, p.weapon1]).toEqual(["", ""]);
  });

  it("one spell at a time: taking another lays the held one down where the find lay, with its own reload clock", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const first = dropSpell(w, { x: tc(6), y: tc(5) }, BOLT);
    const second = dropSpell(w, { x: tc(5), y: tc(6) }, SPARK);
    step(w, TICK_MS);
    pickup(w, "a", first);
    castSpell(w, "a"); // one of BOLT's two charges spent: its clock runs
    const p = P(w, "a");
    const boltClock = p.extra.spellFullAt;
    expect(boltClock).toBeGreaterThan(T(w));
    pickup(w, "a", second);
    expect(p.extra.spell).toBe(SPARK);
    expect([p.extra.spellReadyAt, p.extra.spellFullAt]).toEqual([0, 0]); // a fresh find is loaded
    const ground = spellsOn(w);
    expect(ground).toHaveLength(1);
    expect(ground[0]!.items[0]!.def).toBe(BOLT);
    expect([ground[0]!.x, ground[0]!.y]).toEqual([second.x, second.y]);
    expect(ground[0]!.readyAt).toBe(boltClock);
    // The dropped copy is not takeable in the tick it was laid down, so a swap cannot be undone in the same tick.
    // Taking BOLT back restores its clock: still one charge out, so it is ready (a charge in hand) and not full.
    pickup(w, "a", ground[0]!);
    expect(p.extra.spell).toBe(BOLT);
    expect(p.extra.spellFullAt).toBe(boltClock);
    expect(chargesAt(p.extra.spellFullAt, T(w), 2, BOLT_RELOAD_MS)).toBe(1);
    expect(slotReadyAt(p, "spell")).toBeLessThanOrEqual(T(w));
  });

  it("the cast spends the spell's charges and the slot waits only with every charge out; they reload one per reload time", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const find = dropSpell(w, { x: tc(6), y: tc(5) }, BOLT);
    step(w, TICK_MS);
    pickup(w, "a", find);
    const p = P(w, "a");
    const t0 = T(w);
    castSpell(w, "a");
    expect(slotReadyAt(p, "spell")).toBeLessThanOrEqual(T(w)); // one charge left
    castSpell(w, "a");
    const readyAt = slotReadyAt(p, "spell");
    expect(readyAt).toBeGreaterThan(T(w)); // both out
    expect(chargesAt(slotFullAt(p, "spell"), T(w), 2, BOLT_RELOAD_MS)).toBe(0);
    // A third press while empty is refused for free.
    const full = p.extra.spellFullAt;
    castSpell(w, "a");
    expect(p.extra.spellFullAt).toBe(full);
    // The first charge is back one reload after the first cast.
    expect(readyAt - t0).toBeGreaterThanOrEqual(BOLT_RELOAD_MS);
    expect(readyAt - t0).toBeLessThanOrEqual(BOLT_RELOAD_MS + 2 * TICK_MS);
    // The spell landed: its effect (a haste) is on the caster.
    expect(p.effects & EFFECT_HASTE).not.toBe(0);
    runFor(w, readyAt - T(w) + TICK_MS);
    expect(chargesAt(slotFullAt(p, "spell"), T(w), 2, BOLT_RELOAD_MS)).toBe(1);
  });

  it("the spell's clock is separate from the Wish's: casting one never spends the other", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const find = dropSpell(w, { x: tc(6), y: tc(5) }, SPARK);
    step(w, TICK_MS);
    pickup(w, "a", find);
    const p = P(w, "a");
    const wishBefore = [p.wishReadyAt, p.extra.wishFullAt];
    castSpell(w, "a");
    expect([p.wishReadyAt, p.extra.wishFullAt]).toEqual(wishBefore);
    expect(p.extra.spellReadyAt).toBeGreaterThan(T(w));
  });

  it("refuses to swap spells while the spell slot's own cast is under way, and a refunded cast restores the spell's clock", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const ward = dropSpell(w, { x: tc(6), y: tc(5) }, WARD);
    const other = dropSpell(w, { x: tc(5), y: tc(6) }, SPARK);
    step(w, TICK_MS);
    pickup(w, "a", ward);
    castSpell(w, "a");
    const c = combatant(w, "a")!;
    expect(c.rt.cast?.slot).toBe("spell");
    const p = P(w, "a");
    expect(p.extra.spellReadyAt - T(w)).toBeGreaterThan(WARD_RELOAD_MS - WARD_CAST_MS);
    // A cast with a cast time blocks every pickup (actionBlocked).
    expect(toasts(pickup(w, "a", other), "a")).toEqual(["Can't do that now"]);
    expect(p.extra.spell).toBe(WARD);
    expect(w.state.containers.has(other.id)).toBe(true);
    // The arena's cancel refunds the spell slot, as the teleport does a Wish.
    cancelCast(w, c, "cancelled", true);
    expect([p.extra.spellReadyAt, p.extra.spellFullAt]).toEqual([0, 0]);
  });

  it("a spell with no cast time cast in the same tick as a pickup keeps the slot: the spell's own refusal", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const bolt = dropSpell(w, { x: tc(6), y: tc(5) }, BOLT);
    const other = dropSpell(w, { x: tc(5), y: tc(6) }, SPARK);
    step(w, TICK_MS);
    pickup(w, "a", bolt);
    const q = w.players.get("a")!.inputs;
    const p = P(w, "a");
    expect(enqueueClientMessage(q, "cast", { slot: "spell", x: p.x, y: p.y, seq: 4 })).toBe(true);
    expect(enqueueClientMessage(q, "pickup", { containerId: other.id })).toBe(true);
    const ev = step(w, TICK_MS);
    expect(toasts(ev, "a")).toEqual([SPELL_REFUSAL.casting]);
    expect(p.extra.spell).toBe(BOLT);
    expect(w.state.containers.has(other.id)).toBe(true);
  });

  it("a player who goes down leaves the held spell where they fell, with its clock, and the slot empty", () => {
    const w = rig();
    place(w, "a", { x: tc(5), y: tc(5) });
    const find = dropSpell(w, { x: tc(6), y: tc(5) }, BOLT);
    step(w, TICK_MS);
    pickup(w, "a", find);
    castSpell(w, "a");
    const p = P(w, "a");
    const clock = p.extra.spellFullAt;
    downPlayer(w, p, w.players.get("a")!, "died");
    expect(p.extra.spell).toBe("");
    expect([p.extra.spellReadyAt, p.extra.spellFullAt]).toEqual([0, 0]);
    const dropped = spellsOn(w);
    expect(dropped).toHaveLength(1);
    expect([dropped[0]!.x, dropped[0]!.y]).toEqual([p.x, p.y]);
    expect(dropped[0]!.items[0]!.def).toBe(BOLT);
    expect(dropped[0]!.readyAt).toBe(clock);
  });

  it("a training room racks one find of every spell beside the weapons, and a fighter who goes down there keeps the spell", () => {
    const world = createGameWorld({ seed: 1234, config: { ...BASE, minPlayers: 1, dummies: true, training: true }, random: mulberry32(1235) });
    installTraining(world);
    addPlayer(world, "a", "alice");
    startRaid(world);
    const rack = spellsOn(world).map((f) => f.items[0]!.def).sort();
    expect(rack).toEqual(TEST_SPELLS.map((d) => d.id).sort());
    const p = P(world, "a");
    p.extra.spell = BOLT;
    downPlayer(world, p, world.players.get("a")!, "died");
    expect(p.extra.spell).toBe(BOLT);
  });

  it("every slot starts empty when the run starts", () => {
    const map = roomMap();
    const world = createGameWorld({ seed: 7, map: { ...map, seed: 7 }, config: BASE, random: mulberry32(8) }, { signatures: false });
    world.map = map;
    addPlayer(world, "a", "alice", { faction: "fire" });
    addPlayer(world, "b", "bob", { faction: "holy" });
    P(world, "a").extra.spell = BOLT;
    P(world, "a").extra.spellFullAt = 99_999;
    step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    expect([P(world, "a").extra.spell, P(world, "a").extra.spellFullAt]).toEqual(["", 0]);
  });
});
