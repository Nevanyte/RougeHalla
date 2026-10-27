// sim/mods.ts (roguelike R0, R4a): the stat mirrors on PlayerState, the one seam the sim reads its attack- and move-speed
// multipliers through. Pinned here: the wire is whole thousandths (D22: the sim simulates with exactly what a client decodes),
// the identity defaults never patch, a card grant moves the mirror in the same call, the sim's interval, damage and walk come
// from the decoded mirror, the mod-source registry (multipliers multiply, flats add, expiry caught by the per-tick pass, mobs
// kept server-side), the private reward stream, and the ledger's hitLanded hook (once per landed entry, after the damage,
// never changing an outcome). The per-card rows themselves are in cardRows.test.ts.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  ALL_WEAPON_IDS, AS_MULT_CAP, attackInterval, BOW_WINDUP, damagePerHit, damageShares, decodeFlat, decodeMirrors,
  decodeMult, encodeFlat, encodeMult, IDENTITY_MIRRORS, mapFromTiles, MIRROR_FIELDS, mulberry32, pacedFaction, FACTIONS,
  PLAYER_SPEED, SIG_CHILLED, slotReadyAt, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WEAPONS, weaponTimings, WIRE_IDENTITY_MIRRORS, WISH_COOLDOWN_SECONDS,
  type Effect, type FactionId, type GameMap, type WeaponId,
} from "@raid/shared";
import { PlayerState, RaidState } from "@raid/shared/schema";
import { handleCast } from "../src/sim/abilities";
import { dropWeapon, handlePickup } from "../src/sim/loot";
import { attackSpeedMult, moveSpeedMult, syncMaxHp } from "../src/sim/buffs";
import { grantCard } from "../src/sim/chests";
import { combatant, factionOf, timingsOf, type Combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import {
  adOf, apOf, bonusMaxHpOf, critChanceOf, dotMultOf, hasFlag, healTakenMultOf, hitMultOf, hpRaceCapOf, lifestealDotOf, lifestealMultOf,
  lingerMultOf, modsOf, multOf, outgoingMult, recomputeMods, returnedMultOf, scalingStatsOf, setExtraRows, slowResistOf, statSumsOf,
  updateMods, wishCooldownMultOf,
} from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import { addStatus } from "../src/sim/status";
import { vsExtras } from "../src/sim/vsProbe";
import { handleSwap, packetFor } from "../src/sim/weapons";
import { chainHook, createWorld, type LedgerEntry, type ModSource, type SimEvent, type World } from "../src/sim/world";
import { quoted } from "./support/quoted";
import { hit as rigHit, inStep, P as RigP, pvpArena, RT as RigRT } from "./support/pvpRig";

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
/** p`i` takes `n` copies of a card through the chest's own grant. */
const grant = (w: World, i: number, id: string, n = 1): void => {
  for (let k = 0; k < n; k++) expect(grantCard(w, C(w, i) as Extract<Combatant, { kind: "player" }>, id)).not.toBeNull();
};
/** The wire value the mirror holds for a folded double (D22: whole thousandths). */
const wire = (x: number): number => encodeMult(x);
// The numbers of the cards these tests grant (read from the catalog: a retune is a data edit).
const HASTE1 = quoted("haste1"); // attack speed
const HASTE2 = quoted("haste2");
const FLEET2 = quoted("fleet2"); // move speed, off while shooting
const VIT1 = quoted("vitality1"); // max hp
const MR1 = quoted("mr1"); // magic resist, in points
const ARMOR1 = quoted("armor1"); // armor, in points

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
    p.asMult = encodeMult(1 + HASTE1 * 1.0371);
    p.speedMult = encodeMult((1 + FLEET2 * 0.7312) * 0.8);
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
    p.asMult = encodeMult(1 + HASTE2 * 1.0937);
    decoder.decode(encoder.encode());
    expect(Object.is(mine.asMult, p.asMult)).toBe(true);
  });

  it("a player nothing modifies never patches a mirror, and a grant patches only the mirrors it moves", () => {
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
    // Vitality (max hp only) moves no mirror; Haste (attack speed) moves asMult alone.
    grant(w, 0, "vitality1");
    expect(patchedPlayerFields(encoder, decoder).filter((f) => (MIRROR_FIELDS as readonly string[]).includes(f))).toEqual([]);
    grant(w, 0, "haste1");
    expect(patchedPlayerFields(encoder, decoder).filter((f) => (MIRROR_FIELDS as readonly string[]).includes(f))).toEqual(["asMult"]);
    expect(Object.is(decoder.state.players.get("p0")!.asMult, P(w, 0).asMult)).toBe(true);
  });
});

describe("the cards fold into the mirrors", () => {
  it("grantCard moves the mirror in the same call, to the quantized value of the card's row", () => {
    const w = startRun(2);
    const p = P(w, 0);
    expect([p.asMult, p.speedMult]).toEqual([1000, 1000]);
    grant(w, 0, "haste1");
    const as = 1 + HASTE1;
    expect(Math.abs(decodeMult(p.asMult) - as)).toBeLessThan(0.0005 + 1e-12);
    expect(p.asMult).toBe(wire(as));
    expect(p.speedMult).toBe(1000);
    // Fleet's move speed counts while the player is not shooting (sim/mods.ts holdsNow).
    grant(w, 0, "fleet2");
    expect(p.speedMult).toBe(wire(1 + FLEET2));
    expect(p.asMult).toBe(wire(as));
    // No source for the windup, armor and magic resist yet.
    expect([p.windupMult, p.armorBonus, p.shieldBonus]).toEqual([1000, 0, 0]);
    // A card with a flat row moves its own mirror: Magic Resist's magic resist.
    grant(w, 0, "mr1");
    expect(p.shieldBonus).toBe(encodeFlat(MR1));
    expect(p.armorBonus).toBe(0);
  });

  it("a grant re-folds the mirrors and max hp at once", () => {
    const w = startRun(3);
    const p = P(w, 0);
    grant(w, 0, "haste2");
    grant(w, 0, "mr1");
    grant(w, 0, "vitality1");
    expect(p.asMult).toBe(wire(1 + HASTE2));
    expect(p.shieldBonus).toBe(encodeFlat(MR1));
    expect(p.maxHp).toBeCloseTo(FACTIONS.fire.hp * (1 + VIT1), 9);
    expect(p.hp).toBeCloseTo(p.maxHp, 9);
  });

  it("the sim's attack interval, damage per hit and walk are the ones the decoded mirrors give", () => {
    const w = startRun(5);
    const weapons: WeaponId[] = ["sword", "bow", "wand", "shield", "axe"];
    for (let i = 0; i < 5; i++) {
      const p = P(w, i);
      grant(w, i, "haste1", 1 + i);
      grant(w, i, "fleet1", 1 + (i % 2));
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
    grant(w, 0, "haste1");
    w.modSources.push((_w, c) => (c.id === "p0" ? { asMult: 1.0004 } : null)); // a source factor finer than a thousandth
    recomputeMods(w, C(w, 0));
    const raw = (1 + HASTE1) * 1.0004;
    expect(raw).not.toBe(decodeMult(p.asMult)); // the fold is finer than a thousandth
    expect(attackSpeedMult(p)).toBe(decodeMult(p.asMult));
    expect(timingsOf(p, "axe")!.interval).toBe(attackInterval(paced("fire"), "axe", decodeMult(p.asMult)));
  });

  it("the sim reads the mirror, not the cards: a mirror set by hand is what it attacks and walks with", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grant(w, 0, "haste2", 2);
    p.asMult = encodeMult(2);
    p.speedMult = encodeMult(1.5);
    expect(attackSpeedMult(p)).toBe(2);
    expect(timingsOf(p, "axe")!.interval).toBe(attackInterval(paced("fire"), "axe", 2));
    // It walks at 1.5x: one tick along a straight path.
    const x0 = p.x;
    RT(w, 0).path = [{ x: x0 + 400, y: p.y }];
    tick(w);
    expect(p.x - x0).toBeCloseTo(PLAYER_SPEED * (TICK_MS / 1000) * 1.5, 9);
    // The next grant folds the cards again.
    grant(w, 0, "haste1");
    expect(p.asMult).toBe(wire(1 + 2 * HASTE2 + HASTE1));
    expect(p.speedMult).toBe(1000);
  });

  it("cards written straight to the state (as a test might) are folded by recomputeMods, in the same call", () => {
    const w = startRun(2);
    P(w, 0).build.set("haste2", 1);
    P(w, 1).build.set("mr1", 1);
    recomputeMods(w, C(w, 0));
    recomputeMods(w, C(w, 1));
    expect(attackSpeedMult(P(w, 0))).toBe(decodeMult(wire(1 + HASTE2)));
    expect(P(w, 0).asMult).toBe(wire(1 + HASTE2));
    expect(P(w, 1).shieldBonus).toBe(encodeFlat(MR1));
    expect(modsOf(P(w, 1)).shieldBonus).toBe(MR1);
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

  it("sources combine with the cards: multipliers multiply, flat bonuses add", () => {
    const w = startRun(2);
    const p = P(w, 0);
    grant(w, 0, "haste2"); // +16% attack speed
    w.modSources.push(() => ({ asMult: 0.8, armor: 5 }));
    w.modSources.push(() => null);
    w.modSources.push(() => ({ asMult: 0.5, shield: 2.5, speedMult: 1.1, windupMult: 0.9 }));
    recomputeMods(w, C(w, 0));
    const folded = decodeMult(wire((1 + HASTE2) * (0.8 * 0.5)));
    expect(folded).toBeCloseTo((1 + HASTE2) * 0.4, 3);
    expect(decodeMult(p.asMult)).toBe(folded);
    expect(modsOf(p)).toEqual({ asMult: folded, windupMult: 0.9, speedMult: 1.1, armorBonus: 5, shieldBonus: 2.5, adBonus: 0, apBonus: 0 });
    expect(decodeFlat(p.armorBonus)).toBe(5);
    // A further grant re-folds with the sources' answers, and a flat card row adds to the sources' flat bonus.
    grant(w, 0, "haste2");
    expect(attackSpeedMult(p)).toBe(decodeMult(wire((1 + 2 * HASTE2) * 0.4)));
    grant(w, 0, "armor1");
    expect(modsOf(p).armorBonus).toBe(5 + ARMOR1);
  });

  it("caps the attack-speed total at AS_MULT_CAP: stacked sources clamp the mirror the sim and every client read", () => {
    const w = startRun(2, { signatures: false });
    const p = P(w, 0);
    const encoder = new Encoder(w.state);
    const decoder = connect(encoder);
    grant(w, 0, "haste3"); // below the cap on its own
    expect(p.asMult).toBe(wire(1 + quoted("haste3")));
    expect(decodeMult(p.asMult)).toBeLessThan(AS_MULT_CAP);
    w.modSources.push(slowFor("p0", 1.5)); // a burst on top (R6's overheat, say)
    recomputeMods(w, C(w, 0));
    expect(p.asMult).toBe(wire(AS_MULT_CAP));
    expect(attackSpeedMult(p)).toBe(AS_MULT_CAP);
    expect(timingsOf(p, "bow")!.interval).toBe(attackInterval(paced(p.faction as FactionId), "bow", AS_MULT_CAP));
    expect(packetFor(C(w, 0), "bow").raw).toBeCloseTo(damagePerHit(paced(p.faction as FactionId), "bow", AS_MULT_CAP), 9);
    decoder.decode(encoder.encode());
    expect(decoder.state.players.get("p0")!.asMult).toBe(1500);
    expect(decodeMult(decoder.state.players.get("p0")!.asMult)).toBe(AS_MULT_CAP);
    // A slow multiplies the uncapped total first, then the cap applies (here it no longer binds).
    w.modSources.push(slowFor("p0", 0.5));
    recomputeMods(w, C(w, 0));
    expect(p.asMult).toBe(wire((1 + quoted("haste3")) * 1.5 * 0.5));
    // Gone again: the card's own value, and a fighter with nothing stays at the identity.
    w.modSources.length = 0;
    recomputeMods(w, C(w, 0));
    expect(p.asMult).toBe(wire(1 + quoted("haste3")));
    expect(P(w, 1).asMult).toBe(1000);
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

// ---------------------------------------------------------------------------------------------------------------
// The card engine (balance pass, BALANCE_CONTRACT 3.2, 3.3, 4.6). The pure fold is pinned in shared/test/mods.test.ts; here the
// sim's half: the AD and AP mirrors on the wire, packetFor's scaling, the readers, the conditions and the cooldown. Rows that
// are not a build's go in through setExtraRows (the catalog of cards is agent A3b's), the way a card's rows will fold.

const AD = (v: number): Effect => ({ k: "flat", stat: "ad", v });
const AP = (v: number): Effect => ({ k: "flat", stat: "ap", v });
const mult = (key: Extract<Effect, { k: "mult" }>["key"], v: number): Effect => ({ k: "mult", key, v });
const stat = (s: Extract<Effect, { k: "stat" }>["stat"], v: number): Effect => ({ k: "stat", stat: s, v });
const rowsFor = (w: World, i: number, rows: Effect[]): void => setExtraRows(w, C(w, i), rows);
const isMirror = (f: string): boolean => (MIRROR_FIELDS as readonly string[]).includes(f);

describe("AD and AP on the mirrors", () => {
  it("fold in the same call, in whole tenths, and are what adOf and apOf read; a player without them, and a mob, have none", () => {
    const w = startRun(2);
    const p = P(w, 0);
    expect([p.adBonus, p.apBonus]).toEqual([0, 0]);
    rowsFor(w, 0, [AD(12), AD(21), AP(12.34)]);
    expect([p.adBonus, p.apBonus]).toEqual([330, 123]);
    expect([adOf(p), apOf(p)]).toEqual([33, 12.3]);
    expect(modsOf(p)).toMatchObject({ adBonus: 33, apBonus: 12.3 });
    expect(decodeMirrors(p)).toEqual(modsOf(p));
    expect([adOf(P(w, 1)), apOf(P(w, 1))]).toEqual([0, 0]);
    const id = addMob(w, { kind: "mob", name: "m", faction: "plague", at: { x: tileCentre(20), y: tileCentre(5) }, weapon: "sword" });
    expect([adOf(w.state.mobs.get(id)!), apOf(w.state.mobs.get(id)!)]).toEqual([0, 0]);
    rowsFor(w, 0, []);
    expect([p.adBonus, p.apBonus]).toEqual([0, 0]);
  });

  it("patch only the mirror that moved, and a re-fold of the same rows writes nothing; a client decodes them bit for bit", () => {
    const w = startRun(2);
    const encoder = new Encoder(w.state);
    const decoder = connect(encoder);
    encoder.discardChanges();
    rowsFor(w, 0, [AD(12)]);
    expect(patchedPlayerFields(encoder, decoder).filter(isMirror)).toEqual(["adBonus"]);
    recomputeMods(w, C(w, 0));
    updateMods(w);
    expect(encoder.hasChanges).toBe(false);
    rowsFor(w, 0, [AD(12), AP(5.55)]);
    expect(patchedPlayerFields(encoder, decoder).filter(isMirror)).toEqual(["apBonus"]);
    const mine = decoder.state.players.get("p0")!;
    for (const f of MIRROR_FIELDS) expect(Object.is(mine[f], P(w, 0)[f]), f).toBe(true);
    expect([mine.adBonus, mine.apBonus]).toEqual([120, 56]);
    expect(decodeMirrors(mine)).toEqual(decodeMirrors(P(w, 0)));
  });

  it("a conversion from max hp reads the max hp of the same fold: armor and AP are never a step behind syncMaxHp", () => {
    const w = startRun(2);
    const p = P(w, 0);
    const base = FACTIONS[p.faction as FactionId].hp;
    rowsFor(w, 0, [stat("maxHp", 0.2), { k: "convert", from: "maxHp", to: "armor", per: 0.02 }, { k: "convert", from: "maxHp", to: "ap", per: 0.02 }]);
    expect(p.maxHp).toBe(base); // syncMaxHp is the caller's...
    expect(p.armorBonus).toBe(encodeFlat(0.02 * (base * 1.2))); // ...yet the conversions already read the max hp the rows give
    expect(p.apBonus).toBe(encodeFlat(0.02 * (base * 1.2)));
    syncMaxHp(p);
    expect(p.maxHp).toBeCloseTo(base * 1.2, 9);
    expect(bonusMaxHpOf(p)).toBeCloseTo(0.2 * base, 9);
    const before = [p.armorBonus, p.apBonus];
    recomputeMods(w, C(w, 0));
    expect([p.armorBonus, p.apBonus]).toEqual(before);
    // The floor (G8) holds in the fold too: -80% max hp is half the faction's
    rowsFor(w, 0, [stat("maxHp", -0.8), { k: "convert", from: "maxHp", to: "ap", per: 0.1 }]);
    expect(p.apBonus).toBe(encodeFlat(0.1 * (base * 0.5)));
  });
});

describe("packetFor: the weapons' AD and AP scaling", () => {
  // The contract's table (BALANCE_CONTRACT 3.3), typed out here so a change to WEAPONS.scaling has to change it too.
  const TABLE: Record<WeaponId, { ad?: number; ap?: number; hp?: number; def?: number }> = {
    sword: { ad: 1.0 }, axe: { ad: 1.2, hp: 0.02 }, bow: { ad: 0.9 }, wand: { ad: 0.3, ap: 1.2 }, shield: { ap: 0.3, def: 0.4 },
    fists: { ad: 0.6, ap: 0.6 },
  };

  it("matches the table in WEAPONS", () => {
    for (const id of ALL_WEAPON_IDS) expect(WEAPONS[id].scaling, id).toEqual(TABLE[id]);
  });

  it("is exactly the faction's own packet for a fighter with no AD, AP, bonus max hp or defense", () => {
    const w = startRun(5);
    for (let i = 0; i < 5; i++) {
      const f = factionOf(P(w, i))!;
      for (const weapon of ALL_WEAPON_IDS) expect(packetFor(C(w, i), weapon), `p${i} ${weapon}`).toEqual({ raw: damagePerHit(f, weapon, 1), ...damageShares(f) });
    }
  });

  it("adds (ad x AD + ap x AP + hp x bonus max hp + def x bonus defense) x asMult x interval, physical and magic parts blended into one packet", () => {
    const w = startRun(5);
    for (let i = 0; i < 5; i++) {
      rowsFor(w, i, [AD(40), AP(30), { k: "flat", stat: "armor", v: 20 }, { k: "flat", stat: "shield", v: 10 }, stat("maxHp", 0.1)]);
      syncMaxHp(P(w, i));
      const p = P(w, i);
      const f = factionOf(p)!;
      const sh = damageShares(f);
      const bonusHp = 0.1 * FACTIONS[p.faction as FactionId].hp;
      expect(scalingStatsOf(p)).toMatchObject({ ad: 40, ap: 30, bonusDefense: 30 });
      for (const weapon of ALL_WEAPON_IDS) {
        const t = TABLE[weapon];
        const I = attackInterval(f, weapon, 1);
        const phys = ((t.ad ?? 0) * 40 + (t.hp ?? 0) * bonusHp + (t.def ?? 0) * 30) * I;
        const magic = (t.ap ?? 0) * 30 * I;
        const base = damagePerHit(f, weapon, 1);
        const total = base + phys + magic;
        const pk = packetFor(C(w, i), weapon);
        const tag = `p${i} ${p.faction} ${weapon}`;
        expect(pk.raw, tag).toBeCloseTo(total, 9);
        expect(pk.phys, tag).toBeCloseTo((base * sh.phys + phys) / total, 12);
        expect(pk.magic, tag).toBeCloseTo((base * sh.magic + magic) / total, 12);
        expect(pk.true, tag).toBeCloseTo((base * sh.true) / total, 12);
        expect(pk.phys + pk.magic + pk.true, tag).toBeCloseTo(1, 12);
        // the physical raw damage and the magic raw damage it stands for, apart
        expect(pk.raw * pk.magic - base * sh.magic, tag).toBeCloseTo(magic, 9);
      }
    }
  });

  it("attack speed multiplies the scaling: +30% attack speed is +30% of the points of damage per second", () => {
    const w = startRun(5);
    const p = P(w, 4); // Holy: a sword is not at its floor at x1.3
    rowsFor(w, 4, [AD(40), stat("attackSpeed", 0.3)]);
    expect(attackSpeedMult(p)).toBe(1.3);
    const f = factionOf(p)!;
    const I = attackInterval(f, "sword", 1.3);
    expect(I).toBeGreaterThan(WEAPONS.sword.floor);
    const extra = packetFor(C(w, 4), "sword").raw - damagePerHit(f, "sword", 1.3);
    expect(extra / I).toBeCloseTo(40 * 1.3, 9); // dps from AD: 40 points a second times the attack speed
  });

  it("a `hit` mult multiplies the whole hit, AD and AP included, and leaves the shares alone", () => {
    const w = startRun(5);
    const f = factionOf(P(w, 3))!; // Frost: a shield bash
    rowsFor(w, 3, [AP(30), AD(10)]);
    const plain = packetFor(C(w, 3), "shield");
    rowsFor(w, 3, [AP(30), AD(10), mult("hit", 2.5)]);
    const boom = packetFor(C(w, 3), "shield");
    expect(boom.raw).toBeCloseTo(2.5 * plain.raw, 9);
    expect([boom.phys, boom.magic, boom.true]).toEqual([plain.phys, plain.magic, plain.true]);
    rowsFor(w, 3, [mult("hit", 0.4)]);
    expect(packetFor(C(w, 3), "shield")).toEqual({ raw: 0.4 * damagePerHit(f, "shield", 1), ...damageShares(f) });
    expect(hitMultOf(P(w, 3))).toBe(0.4);
  });

  it("Boom and Machine Gun trade attack speed for hit, per the contract's arithmetic: per hit x2.5 and dps x1.25, per hit x0.4 and dps x0.8", () => {
    const w = startRun(5);
    const p = P(w, 0); // Fire with an axe: no floor binds at x0.5 or x2
    const f = factionOf(p)!;
    const I0 = attackInterval(f, "axe", 1);
    const base = packetFor(C(w, 0), "axe").raw;
    rowsFor(w, 0, [mult("asPost", 0.5), mult("hit", 2.5)]);
    expect(p.asMult).toBe(500);
    const boomI = timingsOf(p, "axe")!.interval;
    expect(boomI).toBeCloseTo(2 * I0, 12);
    expect(packetFor(C(w, 0), "axe").raw).toBeCloseTo(2.5 * base, 9);
    expect(packetFor(C(w, 0), "axe").raw / boomI / (base / I0)).toBeCloseTo(1.25, 9);
    rowsFor(w, 0, [mult("asPost", 2), mult("hit", 0.4)]);
    expect(p.asMult).toBe(2000);
    const mgI = timingsOf(p, "axe")!.interval;
    expect(mgI).toBeCloseTo(I0 / 2, 12);
    expect(mgI).toBeGreaterThan(WEAPONS.axe.floor);
    expect(packetFor(C(w, 0), "axe").raw / mgI / (base / I0)).toBeCloseTo(0.8, 9);
  });

  it("a mob has no AD, AP or hit mult: its packet is its faction's", () => {
    const w = startRun(2);
    const id = addMob(w, { kind: "mob", name: "m", faction: "plague", at: { x: tileCentre(20), y: tileCentre(5) }, weapon: "sword" });
    const m = combatant(w, id)!;
    const f = factionOf(m.s)!;
    for (const weapon of ALL_WEAPON_IDS) expect(packetFor(m, weapon)).toEqual({ raw: damagePerHit(f, weapon, 1), ...damageShares(f) });
  });
});

describe("the attack-speed mirror, the caps and the ranged windups in the sim (G7, G9, G10)", () => {
  const slow = (id: string, m: number): ModSource => (_w, c) => (c.id === id ? { asMult: m } : null);

  it("rows are capped at AS_MULT_CAP and asPost multiplies after: x3.0 at most, x0.5 at least", () => {
    const w = startRun(2);
    const p = P(w, 0);
    rowsFor(w, 0, [stat("attackSpeed", 0.8)]);
    expect(p.asMult).toBe(1500);
    rowsFor(w, 0, [stat("attackSpeed", 0.8), mult("asPost", 2)]);
    expect(p.asMult).toBe(3000);
    expect(attackSpeedMult(p)).toBe(3);
    expect(timingsOf(p, "bow")!.interval).toBe(attackInterval(paced("fire"), "bow", 3));
    rowsFor(w, 0, [mult("asPost", 0.5)]);
    expect(p.asMult).toBe(500);
    rowsFor(w, 0, [stat("attackSpeed", 0.8), mult("asPost", 0.5)]);
    expect(p.asMult).toBe(750);
    // a slow below the cap still applies before asPost
    w.modSources.push(slow("p0", 0.5));
    rowsFor(w, 0, [stat("attackSpeed", 0.8), mult("asPost", 2)]);
    expect(p.asMult).toBe(wire(1.8 * 0.5 * 2)); // 1.8 x 0.5 is under the cap
    w.modSources.length = 0;
    rowsFor(w, 0, []);
    expect(p.asMult).toBe(1000);
  });

  it("a ranged windup never shortens below its base-speed value under attack speed, and a longer interval never lengthens it past its cap", () => {
    const w = startRun(5);
    const plague = P(w, 2);
    const f = paced("plague");
    const base = weaponTimings("bow", attackInterval(f, "bow", 1)).windup;
    expect(weaponTimings("bow", attackInterval(f, "bow", 1.5)).windup).toBeLessThan(base); // the old formula cut it
    rowsFor(w, 2, [stat("attackSpeed", 0.5)]);
    expect(plague.asMult).toBe(1500);
    expect(timingsOf(plague, "bow")!.windup).toBe(base);
    expect(timingsOf(plague, "bow")!.interval).toBe(attackInterval(f, "bow", 1.5));
    rowsFor(w, 2, [stat("attackSpeed", 0.8), mult("asPost", 2)]);
    expect(timingsOf(plague, "bow")!.windup).toBe(base);
    for (let i = 0; i < 5; i++) {
      rowsFor(w, i, [mult("asPost", 0.5)]); // Boom: the interval doubles...
      for (const weapon of ["bow", "wand"] as const) {
        const t = timingsOf(P(w, i), weapon)!;
        const unbuffed = weaponTimings(weapon, attackInterval(paced(P(w, i).faction as FactionId), weapon, 1));
        expect(t.windup, `p${i} ${weapon}`).toBeGreaterThanOrEqual(unbuffed.windup); // ...the windup grows with it...
        expect(t.windup, `p${i} ${weapon}`).toBeLessThanOrEqual(weapon === "bow" ? BOW_WINDUP : 0.4); // ...up to its cap, no further
      }
    }
  });

  it("move speed rows stop at +30% (G10) and a source's slow still applies; bonus armor and magic resist stop at +200 (G7)", () => {
    const w = startRun(2);
    const p = P(w, 0);
    rowsFor(w, 0, [stat("moveSpeed", 0.45), { k: "flat", stat: "armor", v: 150 }, { k: "flat", stat: "armor", v: 120 }, { k: "flat", stat: "shield", v: 260 }]);
    expect(p.speedMult).toBe(1300);
    expect(moveSpeedMult(w, C(w, 0))).toBe(1.3);
    expect([p.armorBonus, p.shieldBonus]).toEqual([2000, 2000]);
    expect(defenseBonus(p)).toEqual({ armor: 200, shield: 200 });
    w.modSources.push((_w, c) => (c.id === "p0" ? { speedMult: 0.5, armor: 40 } : null));
    recomputeMods(w, C(w, 0));
    expect(p.speedMult).toBe(wire(1.3 * 0.5));
    expect(p.armorBonus).toBe(2000); // the sources count toward the same +200
    w.modSources.length = 0;
  });
});
const defenseBonus = (p: PlayerState): { armor: number; shield: number } => ({ armor: decodeFlat(p.armorBonus), shield: decodeFlat(p.shieldBonus) });

describe("the readers the other modules wire in (hit, dot, returned, hpRace, linger, wishCooldown, healTaken, slowResist, lifesteal, crit, flags)", () => {
  it("answer the identity for a fighter with no rows, and the folded value for one with", () => {
    const w = startRun(2);
    const p = P(w, 0);
    expect([hitMultOf(p), dotMultOf(p), returnedMultOf(p), lingerMultOf(p), wishCooldownMultOf(p), multOf(p, "ap")]).toEqual([1, 1, 1, 1, 1, 1]);
    expect([hpRaceCapOf(p), slowResistOf(p), lifestealDotOf(p), critChanceOf(p)]).toEqual([0, 0, 0, 0]);
    expect([lifestealMultOf(p), healTakenMultOf(p), hasFlag(p, "noCrit"), hasFlag(p, "lockSecondSlot")]).toEqual([1, 1, false, false]);
    rowsFor(w, 0, [
      mult("dot", 1.25), mult("returned", 1.25), mult("linger", 2), mult("wishCooldown", 2), mult("hpRace", 9),
      stat("healTaken", 0.25), stat("slowResist", 1.4), stat("lifestealDot", 0.2), stat("critChance", 0.8),
      { k: "while", cond: "hpBelow", arg: 1.1, stat: "lifestealMult", v: 1 }, { k: "flag", flag: "lockSecondSlot" },
    ]);
    expect([dotMultOf(p), returnedMultOf(p), lingerMultOf(p), wishCooldownMultOf(p)]).toEqual([1.25, 1.25, 2, 2]);
    expect(hpRaceCapOf(p)).toBe(2.5); // a row asking for more is held to HP_RACE_CAP (G4)
    expect([healTakenMultOf(p), slowResistOf(p), lifestealDotOf(p), lifestealMultOf(p)]).toEqual([1.25, 1, 0.2, 2]);
    expect(critChanceOf(p)).toBe(0.5); // G12
    expect([hasFlag(p, "lockSecondSlot"), hasFlag(p, "noCrit")]).toEqual([true, false]);
    rowsFor(w, 0, [stat("critChance", 0.3), { k: "flag", flag: "noCrit" }, stat("healTaken", -1)]);
    expect(critChanceOf(p)).toBe(0); // Thick Skull
    expect(healTakenMultOf(p)).toBe(0); // Vampiric Pact: nothing but lifesteal heals
    expect(statSumsOf(p).critChance).toBe(0.3);
  });
});

describe("the conditions: unarmed, fightTime, campsCleared, and the vs tests", () => {
  it("`unarmed` holds while the hand is empty, and is re-checked every tick (a swap shows one tick later)", () => {
    const w = pvpArena([{ id: "a", faction: "fire", weapon: "" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = RigP(w, "a");
    setExtraRows(w, combatant(w, "a")!, [{ k: "while", cond: "unarmed", arg: 0, stat: "attackSpeed", v: 0.4 }]);
    expect(a.asMult).toBe(1400);
    a.weapon0 = "sword";
    updateMods(w);
    expect(a.asMult).toBe(1000);
    a.weapon0 = "";
    updateMods(w);
    expect(a.asMult).toBe(1400);
    // the hand is the active slot: slot 1 empty while slot 0 holds a sword is unarmed too, and slot 0 with the sword is not
    a.weapon0 = "sword";
    a.slot = 1;
    updateMods(w);
    expect(a.asMult).toBe(1400);
    a.slot = 0;
    updateMods(w);
    expect(a.asMult).toBe(1000);
  });

  it("`fightTime` holds once a fight has lasted `arg` seconds (hits landed or taken), and ends FIGHT_GAP_SECONDS after the last", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = RigP(w, "a");
    // Slow Starter: -30% damage, then +35% from 3 s in (-0.3 and +0.65)
    setExtraRows(w, combatant(w, "a")!, [stat("damage", -0.3), { k: "while", cond: "fightTime", arg: 3, stat: "damage", v: 0.65 }]);
    const m = (): number => outgoingMult(a, 1);
    expect(m()).toBeCloseTo(0.7, 12);
    const hits = (n: number): void => { for (let i = 0; i < n; i++) inStep(w, () => { rigHit(w, "v", "a", 1); }); };
    hits(1); // the fight begins
    expect(m()).toBeCloseTo(0.7, 12);
    hits(50); // 2.5 s in
    expect(m()).toBeCloseTo(0.7, 12);
    hits(15); // 3.3 s in
    expect(m()).toBeCloseTo(1.35, 12);
    // the fight ends FIGHT_GAP_SECONDS after the last hit
    let quiet = 0;
    while (m() > 1 && quiet < 100) { tickW(w); quiet++; }
    expect(m()).toBeCloseTo(0.7, 12);
    expect(quiet).toBeGreaterThanOrEqual(58);
    expect(quiet).toBeLessThanOrEqual(62);
    // and a new fight starts the clock again
    hits(2);
    expect(m()).toBeCloseTo(0.7, 12);
  });

  it("a hit TAKEN starts the clock too", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const v = RigP(w, "v");
    setExtraRows(w, combatant(w, "v")!, [stat("damage", -0.3), { k: "while", cond: "fightTime", arg: 1, stat: "damage", v: 0.65 }]);
    for (let i = 0; i < 25; i++) inStep(w, () => { rigHit(w, "v", "a", 1); }); // a hits v, v does not hit back
    expect(outgoingMult(v, 1)).toBeCloseTo(1.35, 12);
  });

  it("`campsCleared` grows a scale row by the camps the player helped clear, up to its cap, read once a tick", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = RigP(w, "a");
    setExtraRows(w, combatant(w, "a")!, [{ k: "scale", src: "campsCleared", per: 0.03, step: 1, cap: 0.24 }]);
    expect(outgoingMult(a, 1)).toBe(1);
    RigRT(w, "a").campsCleared = 3;
    tickW(w);
    expect(outgoingMult(a, 1)).toBeCloseTo(1.09, 12);
    RigRT(w, "a").campsCleared = 20;
    tickW(w);
    expect(outgoingMult(a, 1)).toBeCloseTo(1.24, 12);
    // a fresh fold reads the count at once
    RigRT(w, "a").campsCleared = 5;
    recomputeMods(w, combatant(w, "a")!);
    expect(outgoingMult(a, 1)).toBeCloseTo(1.15, 12);
  });

  it("the new `vs` tests (slowed, elite, higherPower) hold when the ledger's probe says so, and are false without an answer", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = RigP(w, "a");
    setExtraRows(w, combatant(w, "a")!, [
      { k: "vs", test: "elite", arg: 0, v: 0.25 }, { k: "vs", test: "slowed", arg: 0, v: 0.12 }, { k: "vs", test: "higherPower", arg: 0, v: 0.1 },
    ]);
    expect(outgoingMult(a, 1)).toBe(1);
    expect(outgoingMult(a, 1, {})).toBe(1);
    expect(outgoingMult(a, 1, { elite: () => true })).toBeCloseTo(1.25, 12);
    expect(outgoingMult(a, 1, { slowed: () => true, higherPower: () => true })).toBeCloseTo(1.22, 12);
    expect(outgoingMult(a, 1, { elite: () => false, slowed: () => false })).toBe(1);
  });
});

describe("vsExtras: the world's answers to the new `vs` tests", () => {
  it("slowed is a chill or a slowMove status, elite an elite mob, higherPower a player with more card power; each reaches outgoingMult through the probe", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad1: 1 } }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = RigP(w, "a");
    const v = RigP(w, "v");
    const probe = vsExtras(w, "a", "v");
    expect([probe.slowed(), probe.elite(), probe.higherPower()]).toEqual([false, false, false]);
    v.sig |= SIG_CHILLED;
    expect(probe.slowed()).toBe(true);
    v.sig &= ~SIG_CHILLED;
    expect(probe.slowed()).toBe(false);
    expect(addStatus(w, combatant(w, "v")!, { kind: "slowMove", source: { id: "a", name: "A" }, ms: 1000, value: 0.2 })).not.toBeNull();
    expect(probe.slowed()).toBe(true);
    v.build.set("ad3", 1); // power 3 against the attacker's 1
    expect(probe.higherPower()).toBe(true);
    a.build.set("ad3", 1); // 4 against 3
    expect(probe.higherPower()).toBe(false);
    const id = addMob(w, { kind: "mob", name: "m", faction: "plague", at: { x: tileCentre(20), y: tileCentre(5) }, weapon: "sword" });
    expect(vsExtras(w, "a", id).elite()).toBe(false);
    (w.mobs.get(id)! as { brain?: unknown }).brain = { elite: true };
    expect(vsExtras(w, "a", id).elite()).toBe(true);
    // And through outgoingMult
    setExtraRows(w, combatant(w, "a")!, [{ k: "vs", test: "slowed", arg: 0, v: 0.12 }, { k: "vs", test: "elite", arg: 0, v: 0.25 }]);
    expect(outgoingMult(a, 1, vsExtras(w, "a", "v"))).toBeCloseTo(1.12, 12);
    expect(outgoingMult(a, 1, vsExtras(w, "a", id))).toBeCloseTo(1.25, 12);
  });
});

describe("the Wish cooldown multiplier (G13), and the locked second slot", () => {
  it("Arcane Overload's `wishCooldown` doubles the cooldown a cast spends, and nothing else's", () => {
    const run = (rows: Effect[]): number => {
      const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
      const a = RigP(w, "a");
      setExtraRows(w, combatant(w, "a")!, rows);
      a.wishReadyAt = 0;
      const now = w.state.serverTime;
      handleCast(w, combatant(w, "a")!, { kind: "cast", slot: "wish", x: a.x + 200, y: a.y });
      return slotReadyAt(a, "wish") - now;
    };
    expect(run([])).toBe(WISH_COOLDOWN_SECONDS * 1000);
    expect(run([mult("wishCooldown", 2)])).toBe(2 * WISH_COOLDOWN_SECONDS * 1000);
    expect(run([mult("wishCooldown", 0.1)])).toBe(0.5 * WISH_COOLDOWN_SECONDS * 1000);
  });

  it("`lockSecondSlot` refuses a swap to slot 1, and a pickup does not go into it", () => {
    const w = pvpArena([{ id: "a", faction: "fire", weapon: "sword" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = RigP(w, "a");
    a.weapon1 = "axe";
    handleSwap(w, combatant(w, "a")!, { kind: "swap" });
    expect(a.slot).toBe(1); // unlocked: it swaps
    handleSwap(w, combatant(w, "a")!, { kind: "swap" });
    expect(a.slot).toBe(0);
    setExtraRows(w, combatant(w, "a")!, [{ k: "flag", flag: "lockSecondSlot" }]);
    handleSwap(w, combatant(w, "a")!, { kind: "swap" });
    handleSwap(w, combatant(w, "a")!, { kind: "swap", slot: 1 });
    expect(a.slot).toBe(0); // locked
    // A pickup with slot 0 full and slot 1 empty (locked) replaces the hand's weapon rather than filling slot 1.
    a.weapon1 = "";
    const box = dropWeapon(w, { x: a.x + 10, y: a.y }, "bow");
    tickW(w);
    tickW(w); // a container is takeable from the second tick after it appears
    handlePickup(w, combatant(w, "a")!, { kind: "pickup", containerId: box.id });
    expect([a.weapon0, a.weapon1]).toEqual(["bow", ""]);
    // Unlocked, the same pickup fills slot 1 and keeps the hand.
    setExtraRows(w, combatant(w, "a")!, []);
    a.weapon0 = "sword";
    const box2 = dropWeapon(w, { x: a.x + 10, y: a.y }, "bow");
    tickW(w);
    tickW(w);
    handlePickup(w, combatant(w, "a")!, { kind: "pickup", containerId: box2.id });
    expect([a.weapon0, a.weapon1]).toEqual(["sword", "bow"]);
  });
});
const tickW = (w: World): SimEvent[] => step(w, TICK_MS);
