// sim/mods.ts (roguelike R0): the stat mirrors on PlayerState, the one seam the sim reads its attack- and move-speed
// multipliers through. Pinned here: the wire is bit-identical to what the sim used, the identity defaults never patch, a
// stack grant moves the mirror in the same call, the sim's interval, damage and walk come from the mirror, the mod-source
// registry (multipliers multiply, flats add, expiry caught by the per-tick pass, mobs kept server-side), the private
// reward stream, and the ledger's hitLanded hook (once per landed entry, after the damage, never changing an outcome).
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  attackInterval, buffMultiplier, damagePerHit, decodeFlat, decodeMirrors, decodeMult, encodeFlat, encodeMult,
  IDENTITY_MIRRORS, mapFromTiles, MIRROR_FIELDS, mulberry32, pacedFaction, FACTIONS, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, type FactionId, type GameMap, type WeaponId,
} from "@raid/shared";
import { PlayerState, RaidState } from "@raid/shared/schema";
import { attackSpeedMult, grantStacks, moveSpeedMult, transferStacks } from "../src/sim/buffs";
import { combatant, factionOf, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { modsOf, recomputeMods, updateMods } from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import { packetFor } from "../src/sim/weapons";
import { chainHook, createWorld, type LedgerEntry, type ModSource, type SimEvent, type World } from "../src/sim/world";

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const W_TILES = 40;
const H_TILES = 20;
const tileCentre = (t: number): number => t * TILE + TILE / 2;

function openMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let tx = 0; tx < W_TILES; tx++) { tiles[tx] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + tx] = TILE_WALL; }
  for (let ty = 0; ty < H_TILES; ty++) { tiles[ty * W_TILES] = TILE_WALL; tiles[ty * W_TILES + W_TILES - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: tileCentre(3 + 3 * i), y: tileCentre(10) }));
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns };
}

/** `n` players (default factions: Fire, Sentenced, Plague, Frost, Holy...) in a run that started on the first step. */
function startRun(n: number, opts: { signatures?: boolean; seed?: number } = {}): World {
  const seed = opts.seed ?? 77;
  const world = createGameWorld({
    seed,
    config: { minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(seed + 1),
    map: openMap(),
  }, { signatures: opts.signatures ?? false });
  for (let i = 0; i < n; i++) addPlayer(world, `p${i}`, `name${i}`);
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const C = (w: World, i: number): Combatant => combatant(w, `p${i}`)!;
const tick = (w: World): SimEvent[] => step(w, TICK_MS);
const paced = (id: FactionId) => pacedFaction(FACTIONS[id]);

/** A client the way the SDK builds one: the handshake's reflection, then the full state. */
function connect(encoder: Encoder<RaidState>): Decoder<RaidState> {
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  decoder.decode(encoder.encodeAll());
  return decoder;
}

/** The PlayerState fields the next patch carries, as the client decodes it (then the server forgets them, as a Room does). */
function patchedPlayerFields(encoder: Encoder<RaidState>, decoder: Decoder<RaidState>): string[] {
  decoder.triggerChanges ??= () => {}; // the decoder lists the changes only for a listener
  const changes = decoder.decode(encoder.encode());
  encoder.discardChanges();
  return changes.filter((c) => c.ref instanceof Object && "asMult" in (c.ref as object)).map((c) => String(c.field));
}

// ---------------------------------------------------------------------------------------------------------------

describe("the mirrors on the wire", () => {
  it("a new PlayerState holds the identity mirrors, and decodes to them", () => {
    const p = new PlayerState();
    for (const f of MIRROR_FIELDS) expect(p[f], f).toBe(IDENTITY_MIRRORS[f]);
    expect(decodeMirrors(p)).toEqual(IDENTITY_MIRRORS);
  });

  it("a client decodes every mirror bit for bit as the server stored it", () => {
    const state = new RaidState();
    const p = new PlayerState();
    state.players.set("a", p);
    p.asMult = encodeMult(buffMultiplier("attackSpeed", 1.1));
    p.speedMult = encodeMult(buffMultiplier("moveSpeed", 0.7) * 0.8);
    p.windupMult = encodeMult(0.92 * 1.0003);
    p.armorBonus = encodeFlat(12.34);
    p.shieldBonus = encodeFlat(-7.86);
    const encoder = new Encoder(state);
    const decoder = connect(encoder);
    const mine = decoder.state.players.get("a")!;
    for (const f of MIRROR_FIELDS) expect(Object.is(mine[f], p[f]), f).toBe(true);
    expect(decodeMirrors(mine)).toEqual(decodeMirrors(p));
    expect(decodeMirrors(mine).armorBonus).toBe(12.3);
    expect(decodeMirrors(mine).shieldBonus).toBe(-7.9);
    // A later change arrives the same way.
    p.asMult = encodeMult(buffMultiplier("attackSpeed", 4.37));
    decoder.decode(encoder.encode());
    expect(Object.is(mine.asMult, p.asMult)).toBe(true);
  });

  it("a player nothing buffs never patches a mirror, and a grant patches only the mirrors it moves", () => {
    const w = startRun(2);
    const encoder = new Encoder(w.state);
    const decoder = connect(encoder);
    encoder.discardChanges();
    for (let i = 0; i < 20; i++) {
      tick(w);
      const fields = patchedPlayerFields(encoder, decoder);
      for (const f of MIRROR_FIELDS) expect(fields, `tick ${i}`).not.toContain(f);
    }
    // Re-folding with nothing changed writes nothing at all.
    recomputeMods(w, C(w, 0));
    updateMods(w);
    expect(encoder.hasChanges).toBe(false);
    // Hp stacks move no mirror; attack-speed stacks move asMult alone.
    grantStacks(w, P(w, 0), RT(w, 0), "hp", 1.5);
    expect(patchedPlayerFields(encoder, decoder).filter((f) => (MIRROR_FIELDS as readonly string[]).includes(f))).toEqual([]);
    grantStacks(w, P(w, 0), RT(w, 0), "attackSpeed", 1.1);
    expect(patchedPlayerFields(encoder, decoder).filter((f) => (MIRROR_FIELDS as readonly string[]).includes(f))).toEqual(["asMult"]);
    expect(Object.is(decoder.state.players.get("p0")!.asMult, P(w, 0).asMult)).toBe(true);
  });
});

describe("the stacks fold into the mirrors", () => {
  it("grantStacks moves the mirror in the same call, to buffMultiplier of the stacks (within 0.0005; exactly, in fact)", () => {
    const w = startRun(2);
    const p = P(w, 0);
    expect([p.asMult, p.speedMult]).toEqual([1, 1]);
    grantStacks(w, p, RT(w, 0), "attackSpeed", 1.1);
    expect(Math.abs(decodeMult(p.asMult) - buffMultiplier("attackSpeed", 1.1))).toBeLessThan(0.0005);
    expect(decodeMult(p.asMult)).toBe(buffMultiplier("attackSpeed", 1.1));
    expect(p.speedMult).toBe(1);
    grantStacks(w, p, RT(w, 0), "moveSpeed", 0.7);
    grantStacks(w, p, RT(w, 0), "moveSpeed", 2.3);
    expect(decodeMult(p.speedMult)).toBe(buffMultiplier("moveSpeed", p.stacksMs));
    expect(decodeMult(p.asMult)).toBe(buffMultiplier("attackSpeed", 1.1));
    // No source yet for these three.
    expect([p.windupMult, p.armorBonus, p.shieldBonus]).toEqual([1, 0, 0]);
  });

  it("a bounty transfer re-folds the killer's mirrors at once", () => {
    const w = startRun(3);
    const victim = P(w, 1);
    grantStacks(w, victim, RT(w, 1), "attackSpeed", 4);
    grantStacks(w, victim, RT(w, 1), "moveSpeed", 2);
    transferStacks(w, RT(w, 0), RT(w, 1));
    const killer = P(w, 0);
    expect(killer.stacksAs).toBeGreaterThan(0);
    expect(decodeMult(killer.asMult)).toBe(buffMultiplier("attackSpeed", killer.stacksAs));
    expect(decodeMult(killer.speedMult)).toBe(buffMultiplier("moveSpeed", killer.stacksMs));
  });

  it("the sim's attack interval, damage per hit and walk are the ones the mirrors give", () => {
    const w = startRun(5);
    const weapons: WeaponId[] = ["sword", "bow", "wand", "shield", "axe"];
    for (let i = 0; i < 5; i++) {
      const p = P(w, i);
      grantStacks(w, p, RT(w, i), "attackSpeed", 0.9 + i);
      grantStacks(w, p, RT(w, i), "moveSpeed", 0.4 + 0.7 * i);
      const f = factionOf(p)!;
      const as = decodeMult(p.asMult);
      for (const weapon of weapons) {
        expect(timingsOf(p, weapon)!.interval, `p${i} ${weapon}`).toBe(attackInterval(f, weapon, as));
        expect(packetFor(C(w, i), weapon).raw, `p${i} ${weapon}`).toBe(damagePerHit(f, weapon, as));
      }
      expect(moveSpeedMult(w, C(w, i))).toBe(decodeMult(p.speedMult));
    }
  });

  it("the sim reads the mirror, not the stacks: a mirror set by hand is what it attacks and walks with", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grantStacks(w, p, RT(w, 0), "attackSpeed", 2);
    p.asMult = encodeMult(2);
    p.speedMult = encodeMult(1.5);
    expect(attackSpeedMult(p)).toBe(2);
    expect(timingsOf(p, "axe")!.interval).toBe(attackInterval(paced("fire"), "axe", 2));
    // It walks at 1.5x: one tick along a straight path.
    const x0 = p.x;
    RT(w, 0).path = [{ x: x0 + 400, y: p.y }];
    tick(w);
    expect(p.x - x0).toBeCloseTo(PLAYER_SPEED * (TICK_MS / 1000) * 1.5, 9);
    // The next grant folds the stacks again.
    grantStacks(w, p, RT(w, 0), "attackSpeed", 1);
    expect(decodeMult(p.asMult)).toBe(buffMultiplier("attackSpeed", 3));
    expect(decodeMult(p.speedMult)).toBe(1);
  });

  it("stacks written straight to the state (as tests do) are folded on the next read, and by the end of the tick", () => {
    const w = startRun(2);
    P(w, 0).stacksAs = 3;
    expect(attackSpeedMult(P(w, 0))).toBe(buffMultiplier("attackSpeed", 3));
    expect(P(w, 0).asMult).toBe(buffMultiplier("attackSpeed", 3));
    P(w, 1).stacksMs = 2;
    tick(w);
    expect(P(w, 1).speedMult).toBe(buffMultiplier("moveSpeed", 2));
  });

  it("a mob's multipliers are 1, with no mirror to read", () => {
    const w = startRun(2);
    const id = addMob(w, { kind: "mob", name: "m", faction: "plague", at: { x: tileCentre(20), y: tileCentre(5) }, weapon: "sword" });
    const m = w.state.mobs.get(id)!;
    expect(attackSpeedMult(m)).toBe(1);
    expect(moveSpeedMult(w, combatant(w, id)!)).toBe(1);
    expect(modsOf(m)).toEqual(IDENTITY_MIRRORS);
  });
});

describe("mod sources (world.modSources)", () => {
  const slowFor = (id: string, mult: number): ModSource => (_w, c) => (c.id === id ? { asMult: mult } : null);

  it("a 0.8 attack-speed source changes asMult and the attack interval, and removing it restores both", () => {
    const w = startRun(2);
    const p = P(w, 0);
    const before = timingsOf(p, "axe")!;
    w.modSources.push(slowFor("p0", 0.8));
    recomputeMods(w, C(w, 0));
    expect(decodeMult(p.asMult)).toBe(0.8);
    expect(attackSpeedMult(p)).toBe(0.8);
    expect(timingsOf(p, "axe")!.interval).toBe(attackInterval(paced("fire"), "axe", 0.8));
    expect(timingsOf(p, "axe")!.interval).toBeGreaterThan(before.interval);
    expect(P(w, 1).asMult).toBe(1);
    w.modSources.pop();
    recomputeMods(w, C(w, 0));
    expect(p.asMult).toBe(1);
    expect(timingsOf(p, "axe")).toEqual(before);
  });

  it("the per-tick pass re-asks the sources: a new one shows, and an expired one goes, by the end of the tick", () => {
    const w = startRun(2);
    const until = w.state.serverTime + 5 * TICK_MS;
    w.modSources.push((world, c) => (c.id === "p0" && world.state.serverTime < until ? { asMult: 0.8 } : null));
    tick(w);
    expect(P(w, 0).asMult).toBe(0.8);
    while (w.state.serverTime < until) tick(w);
    expect(P(w, 0).asMult).toBe(1);
  });

  it("sources combine with the stacks: multipliers multiply, flat bonuses add", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grantStacks(w, p, RT(w, 0), "attackSpeed", 3);
    w.modSources.push(() => ({ asMult: 0.8, armor: 5 }));
    w.modSources.push(() => null);
    w.modSources.push(() => ({ asMult: 0.5, shield: 2.5, speedMult: 1.1, windupMult: 0.9 }));
    recomputeMods(w, C(w, 0));
    expect(decodeMult(p.asMult)).toBe(buffMultiplier("attackSpeed", 3) * (0.8 * 0.5));
    expect(modsOf(p)).toEqual({ asMult: buffMultiplier("attackSpeed", 3) * 0.4, windupMult: 0.9, speedMult: 1.1, armorBonus: 5, shieldBonus: 2.5 });
    expect(decodeFlat(p.armorBonus)).toBe(5);
    // A stack written behind the fold's back re-folds with the sources' last answers.
    p.stacksAs = 5;
    expect(attackSpeedMult(p)).toBe(buffMultiplier("attackSpeed", 5) * 0.4);
  });

  it("a mob keeps what the sources give it server-side: a slowed mob attacks slower, and recovers", () => {
    const w = startRun(2);
    const id = addMob(w, { kind: "mob", name: "m", faction: "frost", at: { x: tileCentre(20), y: tileCentre(5) }, weapon: "axe" });
    const m = w.state.mobs.get(id)!;
    const before = timingsOf(m, "axe")!;
    w.modSources.push(slowFor(id, 0.5));
    recomputeMods(w, combatant(w, id)!);
    expect(attackSpeedMult(m)).toBe(0.5);
    expect(timingsOf(m, "axe")!.interval).toBe(attackInterval(factionOf(m)!, "axe", 0.5));
    w.modSources.pop();
    tick(w);
    expect(attackSpeedMult(m)).toBe(1);
    expect(timingsOf(m, "axe")).toEqual(before);
  });
});

describe("world.rewardRandom", () => {
  const make = (rewardSalt?: number | readonly number[]): World =>
    createWorld({ seed: 5, config: { minPlayers: 2, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 10 },
      random: mulberry32(1234), map: openMap(), rewardSalt });
  const draws = (rng: () => number, n: number): number[] => Array.from({ length: n }, rng);

  it("never touches world.random: the loot stream is the same with or without a reward salt, and for any salt", () => {
    const reference = mulberry32(1234);
    const orderSalt = Math.floor(reference() * 2 ** 32) >>> 0; // createWorld's one draw
    const expected = draws(reference, 32);
    for (const salt of [undefined, 0, 1, 0xdeadbeef]) {
      const w = make(salt);
      expect(w.orderSalt, String(salt)).toBe(orderSalt);
      draws(w.rewardRandom, 50); // drawing rewards first changes nothing
      expect(draws(w.random, 32), String(salt)).toEqual(expected);
    }
  });

  it("is its own stream: different salts differ, one salt repeats, and without one it is neither the loot nor actionOrder's stream", () => {
    expect(draws(make(1).rewardRandom, 8)).not.toEqual(draws(make(2).rewardRandom, 8));
    expect(draws(make(7).rewardRandom, 8)).toEqual(draws(make(7).rewardRandom, 8));
    const w = make();
    const own = draws(w.rewardRandom, 8);
    expect(own).toEqual(draws(make().rewardRandom, 8));
    expect(own).not.toEqual(draws(mulberry32(1234), 8));
    expect(own).not.toEqual(draws(mulberry32(w.orderSalt), 8));
    for (const v of own) expect(v >= 0 && v < 1).toBe(true);
  });

  it("is a 128-bit stream: four salt words each matter, and the draws are spread evenly over [0, 1)", () => {
    const base = [0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210];
    const ref = draws(make(base).rewardRandom, 8);
    expect(draws(make(base).rewardRandom, 8)).toEqual(ref);
    for (let i = 0; i < 4; i++) {
      const w = base.slice();
      w[i] = (w[i]! ^ 1) >>> 0; // one flipped bit in one word changes the whole stream
      expect(draws(make(w).rewardRandom, 8), `word ${i}`).not.toEqual(ref);
    }
    const n = 20000;
    const rng = make(base).rewardRandom;
    let sum = 0;
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < n; i++) { const v = rng(); sum += v; bins[Math.floor(v * 10)]!++; }
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
    for (const b of bins) expect(b).toBeGreaterThan(n / 10 * 0.9);
  });

  it("createGameWorld passes the salt through", () => {
    const opts = { seed: 5, config: { minPlayers: 2, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 10 }, map: openMap() };
    const a = createGameWorld({ ...opts, random: mulberry32(1), rewardSalt: 99 });
    const b = createWorld({ ...opts, random: mulberry32(1), rewardSalt: 99 });
    expect(draws(a.rewardRandom, 4)).toEqual(draws(b.rewardRandom, 4));
  });
});

describe("the hitLanded hook", () => {
  interface Call { entry: LedgerEntry; applied: number; hp: number }
  const listen = (w: World): Call[] => {
    const calls: Call[] = [];
    w.hooks.hitLanded = (world, entry, applied) => {
      const victim = combatant(world, entry.victim);
      calls.push({ entry, applied, hp: victim ? victim.s.hp : NaN });
    };
    return calls;
  };

  it("is called once per entry that lands, after its victim took the damage, with the hit's mitigated amount", () => {
    const w = startRun(3);
    const calls = listen(w);
    const by = (i: number) => ({ id: `p${i}`, name: `name${i}` });
    const packet = { raw: 40, phys: 0.5, magic: 0.5, true: 0 };
    const hpBefore = P(w, 1).hp;
    recordHit(w, { victim: "p1", by: by(0), packet, weapon: "sword", stagger: false });
    recordHit(w, { victim: "p1", by: by(2), packet, weapon: "bow", stagger: false });
    recordHit(w, { victim: "p2", by: by(0), packet, weapon: "sword", stagger: false, scale: 0 }); // nothing lands
    recordHit(w, { victim: "p0", by: { id: "arena", name: "arena" }, packet, weapon: "sword", stagger: false, arena: true });
    w.state.serverTime += TICK_MS;
    applyLedger(w);
    expect(calls.map((c) => [c.entry.victim, c.entry.by.id])).toEqual([["p1", "p0"], ["p1", "p2"]]);
    expect(w.combat.landed).toHaveLength(2);
    const total = calls.reduce((s, c) => s + c.applied, 0);
    for (const c of calls) {
      expect(c.hp).toBeCloseTo(hpBefore - total, 9); // both hits had landed before either call
      expect(c.applied).toBeGreaterThan(0);
    }
    expect(calls.map((c) => c.applied)).toEqual(w.combat.landed.map((l) => l.amount));
  });

  it("costs nothing when unset, and never changes an outcome when set", () => {
    const fight = (hook: boolean): { events: string; state: unknown; calls: number; landed: number } => {
      const w = startRun(3, { signatures: true, seed: 31 });
      const at = [{ x: tileCentre(18), y: tileCentre(9) }, { x: tileCentre(20), y: tileCentre(9) }, { x: tileCentre(19), y: tileCentre(11) }];
      at.forEach((pos, i) => {
        const p = P(w, i);
        p.x = pos.x;
        p.y = pos.y;
        RT(w, i).history = [{ t: w.state.serverTime, x: pos.x, y: pos.y }];
      });
      let calls = 0;
      let landed = 0;
      if (hook) w.hooks.hitLanded = () => { calls++; };
      w.systems.push((world) => { landed += world.combat.landed.length; });
      for (let i = 0; i < 3; i++) expect(enqueueClientMessage(RT(w, i).inputs, "target", { id: `p${(i + 1) % 3}` })).toBe(true);
      const events: SimEvent[] = [];
      for (let t = 0; t < 600 && w.state.phase === "active"; t++) events.push(...tick(w));
      const state = [...w.state.players].map(([id, p]) => ({ id, hp: p.hp, status: p.status, kills: p.kills, asMult: p.asMult }));
      return { events: JSON.stringify(events), state, calls, landed };
    };
    const plain = fight(false);
    const hooked = fight(true);
    expect(plain.landed).toBeGreaterThan(10);
    expect(hooked.events).toBe(plain.events);
    expect(hooked.state).toEqual(plain.state);
    expect(hooked.calls).toBe(hooked.landed);
  });

  it("chains like the other hooks", () => {
    const w = startRun(2);
    const order: string[] = [];
    chainHook(w, "hitLanded", () => order.push("a"));
    chainHook(w, "hitLanded", () => order.push("b"));
    recordHit(w, { victim: "p1", by: { id: "p0", name: "name0" }, packet: { raw: 10, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w);
    expect(order).toEqual(["a", "b"]);
  });
});
