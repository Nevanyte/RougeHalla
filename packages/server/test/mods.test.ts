// sim/mods.ts (roguelike R0, R4a): the stat mirrors on PlayerState, the one seam the sim reads its attack- and move-speed
// multipliers through. Pinned here: the wire is whole thousandths (D22: the sim simulates with exactly what a client decodes),
// the identity defaults never patch, a buff grant moves the mirror in the same call, the sim's interval, damage and walk come
// from the decoded mirror, the mod-source registry (multipliers multiply, flats add, expiry caught by the per-tick pass, mobs
// kept server-side), the private reward stream, and the ledger's hitLanded hook (once per landed entry, after the damage,
// never changing an outcome). The per-buff rows themselves are in buffRows.test.ts.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  attackInterval, buffScale, damagePerHit, decodeFlat, decodeMirrors, decodeMult, encodeFlat, encodeMult,
  IDENTITY_MIRRORS, mapFromTiles, MIRROR_FIELDS, mulberry32, pacedFaction, FACTIONS, PLAYER_SPEED, TICK_MS, TILE, TILE_FLOOR,
  TILE_WALL, WIRE_IDENTITY_MIRRORS, type BuffId, type FactionId, type GameMap, type WeaponId,
} from "@raid/shared";
import { PlayerState, RaidState } from "@raid/shared/schema";
import { attackSpeedMult, grantBuff, moveSpeedMult, transferBuffs } from "../src/sim/buffs";
import { combatant, factionOf, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { modsOf, recomputeMods, updateMods } from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import { packetFor } from "../src/sim/weapons";
import { chainHook, createWorld, type LedgerEntry, type ModSource, type SimEvent, type World } from "../src/sim/world";
import { quoted } from "./support/quoted";

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
const grant = (w: World, i: number, id: BuffId, n: number): void => grantBuff(w, P(w, i), RT(w, i), id, n);
/** The wire value the mirror holds for a folded double (D22: whole thousandths). */
const wire = (x: number): number => encodeMult(x);
// The quoted numbers of the rows these tests grant (read from the catalog: a retune is a data edit).
const AS_Q = quoted("plagueRat"); // attack speed
const MS_Q = quoted("cinderHound"); // move speed, while chasing a lock
const ICE_Q = quoted("iceGolem"); // max hp
const BRUTE_MR_Q = quoted("magmaBrute", 1); // magic resist, in points
const SHARD_Q = quoted("seraphShard"); // magic resist, in points
const RIME_Q = quoted("rimeStalker"); // armor, in points

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
    for (const f of MIRROR_FIELDS) expect(p[f], f).toBe(WIRE_IDENTITY_MIRRORS[f]);
    expect([p.asMult, p.windupMult, p.speedMult, p.armorBonus, p.shieldBonus]).toEqual([1000, 1000, 1000, 0, 0]);
    expect(decodeMirrors(p)).toEqual(IDENTITY_MIRRORS);
  });

  it("a multiplier travels as whole thousandths, rounded half up, and decodes to exactly wire / 1000", () => {
    expect(encodeMult(1)).toBe(1000);
    expect(encodeMult(0.8)).toBe(800);
    expect(encodeMult(1.0404)).toBe(1040);
    expect(encodeMult(1.0405)).toBe(1041);
    expect(decodeMult(1040)).toBe(1.04);
    expect(decodeMult(800)).toBe(0.8);
    for (const x of [0.37, 0.8, 1, 1.0004, 1.23456, 2.0996]) {
      expect(Math.abs(decodeMult(encodeMult(x)) - x), String(x)).toBeLessThanOrEqual(0.0005 + 1e-12);
      expect(Number.isInteger(encodeMult(x)), String(x)).toBe(true);
    }
  });

  it("a client decodes every mirror bit for bit as the server stored it", () => {
    const state = new RaidState();
    const p = new PlayerState();
    state.players.set("a", p);
    p.asMult = encodeMult(1 + AS_Q * buffScale(1.1));
    p.speedMult = encodeMult((1 + MS_Q * buffScale(0.7)) * 0.8);
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
    p.asMult = encodeMult(1 + AS_Q * buffScale(4.37));
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
    // Ice Golem (max hp only) moves no mirror; Plague Rat (attack speed) moves asMult alone.
    grant(w, 0, "iceGolem", 1.5);
    expect(patchedPlayerFields(encoder, decoder).filter((f) => (MIRROR_FIELDS as readonly string[]).includes(f))).toEqual([]);
    grant(w, 0, "plagueRat", 1.1);
    expect(patchedPlayerFields(encoder, decoder).filter((f) => (MIRROR_FIELDS as readonly string[]).includes(f))).toEqual(["asMult"]);
    expect(Object.is(decoder.state.players.get("p0")!.asMult, P(w, 0).asMult)).toBe(true);
  });
});

describe("the buffs fold into the mirrors", () => {
  it("grantBuff moves the mirror in the same call, to the quantized value of the buff's row at those stacks", () => {
    const w = startRun(2);
    const p = P(w, 0);
    expect([p.asMult, p.speedMult]).toEqual([1000, 1000]);
    grant(w, 0, "plagueRat", 1.1);
    const as = 1 + AS_Q * buffScale(1.1);
    expect(Math.abs(decodeMult(p.asMult) - as)).toBeLessThan(0.0005 + 1e-12);
    expect(p.asMult).toBe(wire(as));
    expect(p.speedMult).toBe(1000);
    // Cinder Hound's move speed counts only while the player holds a target lock (sim/mods.ts holdsNow).
    RT(w, 0).weapon.lock = "p1";
    grant(w, 0, "cinderHound", 0.7);
    grant(w, 0, "cinderHound", 2.3);
    expect(p.speedMult).toBe(wire(1 + MS_Q * buffScale(p.buffs.get("cinderHound")!)));
    expect(p.asMult).toBe(wire(as));
    // No source for these three yet.
    expect([p.windupMult, p.armorBonus, p.shieldBonus]).toEqual([1000, 0, 0]);
    // A buff with a flat row moves its own mirror: Magma Brute's magic resist.
    grant(w, 0, "magmaBrute", 3);
    expect(p.shieldBonus).toBe(encodeFlat(BRUTE_MR_Q));
    expect(p.armorBonus).toBe(0);
  });

  it("a bounty transfer re-folds the killer's mirrors at once", () => {
    const w = startRun(3);
    const victim = P(w, 1);
    grantBuff(w, victim, RT(w, 1), "plagueRat", 4);
    grantBuff(w, victim, RT(w, 1), "iceGolem", 2);
    grantBuff(w, victim, RT(w, 1), "seraphShard", 6);
    transferBuffs(w, RT(w, 0), RT(w, 1));
    const killer = P(w, 0);
    expect(killer.buffs.get("plagueRat")).toBe(2);
    expect(killer.asMult).toBe(wire(1 + AS_Q * buffScale(2)));
    expect(killer.shieldBonus).toBe(encodeFlat(SHARD_Q * buffScale(3)));
    expect(killer.maxHp).toBeCloseTo(FACTIONS.fire.hp * (1 + ICE_Q * buffScale(1)), 9);
  });

  it("the sim's attack interval, damage per hit and walk are the ones the decoded mirrors give", () => {
    const w = startRun(5);
    const weapons: WeaponId[] = ["sword", "bow", "wand", "shield", "axe"];
    for (let i = 0; i < 5; i++) {
      const p = P(w, i);
      RT(w, i).weapon.lock = `p${(i + 1) % 5}`; // so Cinder Hound's row holds
      grant(w, i, "plagueRat", 0.9 + i);
      grant(w, i, "cinderHound", 0.4 + 0.7 * i);
      const f = factionOf(p)!;
      const as = decodeMult(p.asMult);
      expect(as, `p${i}`).toBeGreaterThan(1);
      expect(decodeMult(p.speedMult), `p${i}`).toBeGreaterThan(1);
      for (const weapon of weapons) {
        expect(timingsOf(p, weapon)!.interval, `p${i} ${weapon}`).toBe(attackInterval(f, weapon, as));
        expect(packetFor(C(w, i), weapon).raw, `p${i} ${weapon}`).toBe(damagePerHit(f, weapon, as));
      }
      expect(moveSpeedMult(w, C(w, i))).toBe(decodeMult(p.speedMult));
    }
  });

  it("the sim reads the quantized mirror, not the folded double a client never sees", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grant(w, 0, "plagueRat", 1.1);
    const raw = 1 + AS_Q * buffScale(1.1);
    expect(raw).not.toBe(decodeMult(p.asMult)); // the fold is finer than a thousandth
    expect(attackSpeedMult(p)).toBe(decodeMult(p.asMult));
    expect(timingsOf(p, "axe")!.interval).toBe(attackInterval(paced("fire"), "axe", decodeMult(p.asMult)));
  });

  it("the sim reads the mirror, not the buffs: a mirror set by hand is what it attacks and walks with", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grant(w, 0, "plagueRat", 2);
    p.asMult = encodeMult(2);
    p.speedMult = encodeMult(1.5);
    expect(attackSpeedMult(p)).toBe(2);
    expect(timingsOf(p, "axe")!.interval).toBe(attackInterval(paced("fire"), "axe", 2));
    // It walks at 1.5x: one tick along a straight path.
    const x0 = p.x;
    RT(w, 0).path = [{ x: x0 + 400, y: p.y }];
    tick(w);
    expect(p.x - x0).toBeCloseTo(PLAYER_SPEED * (TICK_MS / 1000) * 1.5, 9);
    // The next grant folds the buffs again.
    grant(w, 0, "plagueRat", 1);
    expect(p.asMult).toBe(wire(1 + AS_Q * buffScale(3)));
    expect(p.asMult).toBe(wire(1 + AS_Q)); // 3 stacks are the quoted value
    expect(p.speedMult).toBe(1000);
  });

  it("buffs written straight to the state (as a test might) are folded by recomputeMods, in the same call", () => {
    const w = startRun(2);
    P(w, 0).buffs.set("plagueRat", 3);
    P(w, 1).buffs.set("magmaBrute", 3);
    recomputeMods(w, C(w, 0));
    recomputeMods(w, C(w, 1));
    expect(attackSpeedMult(P(w, 0))).toBe(decodeMult(wire(1 + AS_Q)));
    expect(P(w, 0).asMult).toBe(wire(1 + AS_Q));
    expect(P(w, 1).shieldBonus).toBe(encodeFlat(BRUTE_MR_Q));
    expect(modsOf(P(w, 1)).shieldBonus).toBe(BRUTE_MR_Q);
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
    expect(P(w, 1).asMult).toBe(1000);
    w.modSources.pop();
    recomputeMods(w, C(w, 0));
    expect(p.asMult).toBe(1000);
    expect(timingsOf(p, "axe")).toEqual(before);
  });

  it("the per-tick pass re-asks the sources: a new one shows, and an expired one goes, by the end of the tick", () => {
    const w = startRun(2);
    const until = w.state.serverTime + 5 * TICK_MS;
    w.modSources.push((world, c) => (c.id === "p0" && world.state.serverTime < until ? { asMult: 0.8 } : null));
    tick(w);
    expect(P(w, 0).asMult).toBe(800);
    while (w.state.serverTime < until) tick(w);
    expect(P(w, 0).asMult).toBe(1000);
  });

  it("sources combine with the stacks: multipliers multiply, flat bonuses add", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grant(w, 0, "plagueRat", 3); // its quoted attack speed at 3 stacks
    w.modSources.push(() => ({ asMult: 0.8, armor: 5 }));
    w.modSources.push(() => null);
    w.modSources.push(() => ({ asMult: 0.5, shield: 2.5, speedMult: 1.1, windupMult: 0.9 }));
    recomputeMods(w, C(w, 0));
    const folded = decodeMult(wire((1 + AS_Q) * (0.8 * 0.5)));
    expect(folded).toBeCloseTo((1 + AS_Q) * 0.4, 3);
    expect(decodeMult(p.asMult)).toBe(folded);
    expect(modsOf(p)).toEqual({ asMult: folded, windupMult: 0.9, speedMult: 1.1, armorBonus: 5, shieldBonus: 2.5 });
    expect(decodeFlat(p.armorBonus)).toBe(5);
    // A further grant re-folds with the sources' answers, and a flat buff row adds to the sources' flat bonus.
    grant(w, 0, "plagueRat", 2);
    expect(attackSpeedMult(p)).toBe(decodeMult(wire((1 + AS_Q * buffScale(5)) * 0.4)));
    grant(w, 0, "rimeStalker", 3);
    expect(modsOf(p).armorBonus).toBe(5 + RIME_Q);
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
    createWorld({ config: { minPlayers: 2, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 10 },
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
    const opts = { config: { minPlayers: 2, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 60, patienceMinSeconds: 60, suddenDeathSeconds: 10 }, map: openMap() };
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
