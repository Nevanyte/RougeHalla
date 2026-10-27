// Fists in the sim (shared/weapons.ts, sim/combatant.ts, sim/weapons.ts): an empty slot fights with fists, so a player is never
// weaponless, a run starts on fists, and fists lock, swing, pierce a shield and never stagger. How a weapon is taken up (a pickup
// into the empty hand, a mob's drop arming a killer) is in loot.test.ts and mobLife.test.ts; the bots' side in bots/tactics.test.ts.
import { describe, expect, it } from "vitest";
import {
  attackInterval, damagePerHit, FACTIONS, FISTS, lockSpacing, mapFromTiles, mulberry32, pacedFaction, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  weaponTimings, type FactionId, type FxEvent, type GameMap, type Vec2, type WeaponId,
} from "@raid/shared";
import { activeWeapon, handIsEmpty, setSlot, slotItem, slotWeapon, timingsOf } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import type { World } from "../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;
const ME: Vec2 = { x: 300, y: 320 };

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let x = 0; x < W_TILES; x++) { tiles[x] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + x] = TILE_WALL; }
  for (let y = 0; y < H_TILES; y++) { tiles[y * W_TILES] = TILE_WALL; tiles[y * W_TILES + W_TILES - 1] = TILE_WALL; }
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 })) };
}

interface Spec { faction: FactionId; at: Vec2; weapons?: [WeaponId | "", (WeaponId | "")?]; facing?: number }

/** A run in progress with players p0, p1, ... where each is put: no signatures, quiet timers. A player holds nothing unless `weapons` says. */
function arena(specs: Spec[]): Rig {
  const world = createGameWorld({
    seed: 7,
    config: { minPlayers: specs.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(8),
  }, { signatures: false });
  world.map = openMap();
  specs.forEach((s, i) => addPlayer(world, `p${i}`, `player${i}`, { faction: s.faction }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  specs.forEach((s, i) => {
    const p = world.state.players.get(`p${i}`)!;
    p.hp = p.maxHp = 1e6;
    p.weapon0 = s.weapons?.[0] ?? "";
    p.weapon1 = s.weapons?.[1] ?? "";
    p.slot = 0;
    p.x = s.at.x;
    p.y = s.at.y;
    p.facing = s.facing ?? 0;
    world.players.get(`p${i}`)!.history = [{ t: world.state.serverTime, x: s.at.x, y: s.at.y }];
  });
  return { world, log: [] };
}

/** Every fx of the steps run so far, stamped with the server time of the step. */
type Logged = FxEvent & { at: number };
interface Rig { world: World; log: Logged[] }

const P = (world: World, i: number) => world.state.players.get(`p${i}`)!;
const send = (world: World, id: string, type: string, msg: unknown = {}) =>
  expect(enqueueClientMessage(world.players.get(id)!.inputs, type, msg)).toBe(true);

function run(rig: Rig, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const events = step(rig.world, TICK_MS);
    for (const e of events) if (e.type === "fx") rig.log.push({ ...e.fx, at: rig.world.state.serverTime });
  }
}
const fxOf = <K extends FxEvent["kind"]>(log: Logged[], kind: K): Array<Extract<FxEvent, { kind: K }> & { at: number }> =>
  log.filter((f): f is Extract<FxEvent, { kind: K }> & { at: number } => f.kind === kind);

describe("an empty slot is fists", () => {
  it("slotWeapon and activeWeapon give fists for an empty slot and the item for a full one; a bad slot gives nothing", () => {
    const { world } = arena([{ faction: "fire", at: ME }]);
    const p = P(world, 0);
    expect([slotWeapon(p, 0), slotWeapon(p, 1), activeWeapon(p)]).toEqual(["fists", "fists", "fists"]);
    p.weapon0 = "bow";
    expect([slotWeapon(p, 0), slotWeapon(p, 1), activeWeapon(p)]).toEqual(["bow", "fists", "bow"]);
    p.slot = 1;
    expect(activeWeapon(p)).toBe("fists");
    expect(slotWeapon(p, 2)).toBeNull();
    expect(slotWeapon(p, -1)).toBeNull();
  });

  it("slotItem is what is physically carried: null for an empty slot, and for a literal fists (never an item)", () => {
    const { world } = arena([{ faction: "fire", at: ME }]);
    const p = P(world, 0);
    expect([slotItem(p, 0), slotItem(p, 1)]).toEqual([null, null]);
    p.weapon0 = "axe";
    expect([slotItem(p, 0), slotItem(p, 1)]).toEqual(["axe", null]);
    p.weapon1 = FISTS;
    expect(slotItem(p, 1)).toBeNull();
    expect(slotWeapon(p, 1)).toBe("fists");
  });

  it("handIsEmpty follows the slot in hand", () => {
    const { world } = arena([{ faction: "fire", at: ME }]);
    const p = P(world, 0);
    p.weapon0 = "sword";
    expect(handIsEmpty(p)).toBe(false);
    p.slot = 1;
    expect(handIsEmpty(p)).toBe(true);
  });

  it("setSlot stores an item, and an empty slot for null or fists (fists are never stored as an item)", () => {
    const { world } = arena([{ faction: "fire", at: ME }]);
    const p = P(world, 0);
    setSlot(p, 0, "wand");
    setSlot(p, 1, "sword");
    expect([p.weapon0, p.weapon1]).toEqual(["wand", "sword"]);
    setSlot(p, 0, FISTS);
    setSlot(p, 1, null);
    expect([p.weapon0, p.weapon1]).toEqual(["", ""]);
  });

  it("every player starts a run with both slots empty and slot 0 in hand", () => {
    const { world } = arena([{ faction: "fire", at: ME }, { faction: "frost", at: { x: 500, y: 320 } }]);
    const fresh = createGameWorld({
      seed: 7,
      config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
      random: mulberry32(8),
    });
    for (const faction of ["fire", "sentenced", "plague", "frost", "holy"] as const) {
      const p = addPlayer(fresh, `x-${faction}`, faction, { faction });
      expect([p.weapon0, p.weapon1, p.slot], faction).toEqual(["", "", 0]);
      expect(activeWeapon(p), faction).toBe("fists");
      expect(timingsOf(p, "fists")).toEqual(weaponTimings("fists", attackInterval(pacedFaction(FACTIONS[faction]), "fists")));
    }
    expect(world.state.players.size).toBe(2);
  });
});

describe("fighting with fists", () => {
  it("an empty-handed player locks a dummy, walks into fists' reach and punches: a 0.1 s windup, fists' damage, fists' cadence", () => {
    const rig = arena([{ faction: "holy", at: ME }]);
    const { world, log } = rig;
    const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: { x: ME.x + 220, y: ME.y }, hp: 1e9 });
    send(world, "p0", "target", { id: dummy });
    run(rig, 80);
    const windups = fxOf(log, "windup");
    const hits = fxOf(log, "hit");
    expect(windups.length).toBeGreaterThanOrEqual(3);
    expect(windups.every((w) => w.weapon === "fists" && w.by === "p0")).toBe(true);
    expect(fxOf(log, "swing").every((s) => s.weapon === "fists")).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    // The hit is fists' damage on a target without armor: rate x hit x 0.60 x interval, at duel pace.
    const spec = pacedFaction(FACTIONS.holy);
    expect(hits[0]!.amount).toBeCloseTo(damagePerHit(spec, "fists"), 3);
    expect(hits[0]!.weapon).toBe("fists");
    // It stood where fists reach, not where a sword or an axe would: within the lock's attack range of the dummy.
    expect(Math.hypot(P(world, 0).x - world.state.mobs.get(dummy)!.x, P(world, 0).y - world.state.mobs.get(dummy)!.y))
      .toBeLessThanOrEqual(lockSpacing("fists").attackRange + 1);
    // And it kept the fists' cadence: one windup per interval, give or take a tick.
    const gap = windups[2]!.at - windups[1]!.at;
    expect(Math.abs(gap - attackInterval(spec, "fists") * 1000)).toBeLessThanOrEqual(TICK_MS);
  });

  it("a fists hit does not stagger a player and never grants the target stagger immunity", () => {
    const rig = arena([
      { faction: "frost", at: ME },
      { faction: "holy", at: { x: ME.x + 30, y: ME.y }, weapons: ["sword"], facing: Math.PI },
    ]);
    const { world, log } = rig;
    send(world, "p0", "target", { id: "p1" });
    run(rig, 40);
    expect(fxOf(log, "hit").filter((h) => h.id === "p1" && h.weapon === "fists").length).toBeGreaterThanOrEqual(2);
    expect(fxOf(log, "stagger")).toEqual([]);
    expect(world.players.get("p1")!.weapon.staggerImmuneUntil).toBe(0);
  });

  it("fists pierce a raised shield: no block, no riposte, the damage goes through", () => {
    const rig = arena([
      { faction: "frost", at: ME },
      { faction: "holy", at: { x: ME.x + 30, y: ME.y }, weapons: ["shield"], facing: Math.PI },
    ]);
    const { world, log } = rig;
    const before = P(world, 1).hp;
    send(world, "p0", "target", { id: "p1" });
    run(rig, 40);
    const hits = fxOf(log, "hit").filter((h) => h.id === "p1" && h.weapon === "fists");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(fxOf(log, "block").filter((b) => b.by === "p0")).toEqual([]);
    expect(P(world, 1).hp).toBeLessThan(before);
    // The shield was facing the puncher the whole time (it would have stopped a sword's or a bash's hit).
    expect(Math.abs(Math.abs(P(world, 1).facing) - Math.PI)).toBeLessThan(0.2);
  });

  it("a player who loses the weapon in hand keeps its lock and fights on, with fists' spacing", () => {
    const rig = arena([{ faction: "holy", at: ME, weapons: ["bow"] }]);
    const { world, log } = rig;
    const dummy = addMob(world, { kind: "dummy", name: "Dummy", at: { x: ME.x + 200, y: ME.y }, hp: 1e9 });
    send(world, "p0", "target", { id: dummy });
    run(rig, 3);
    expect(world.players.get("p0")!.weapon.lock).toBe(dummy);
    P(world, 0).weapon0 = ""; // dropped, or gone with the body: the lock does not care
    run(rig, 80);
    expect(world.players.get("p0")!.weapon.lock).toBe(dummy);
    expect(fxOf(log, "swing").some((s) => s.weapon === "fists")).toBe(true);
  });
});
