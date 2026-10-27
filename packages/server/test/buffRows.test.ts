// The roguelike buffs in the sim (R4a): one rig per BuffDef row, each proving the row does what its text says at the
// quoted 3 stacks and scales by S(n) / S(3); then the machinery around them: grants (fx, max hp, the mirrors patched only
// when their quantized value changes), the bounty's transfer per buff, lifesteal for any faction and its caps, Blood
// Saint's once-per-run heal, heal({ ignoreLockout }) and the mob kill's grant of its type's buff.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  attackInterval, BOUNTY_STACK_SHARE, BUFFS, buffScale, damageShares, decodeFlat, decodeMult, encodeFlat, encodeMult,
  FACTIONS, HEAL_LOCKOUT_SECONDS, lifestealFraction, lifestealShare, mapFromTiles, MIRROR_FIELDS, mitigateShares,
  MOB_BUFF_STACKS, mulberry32, pacedFaction, packFx, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, unpackFx, WIRE_IDENTITY_MIRRORS,
  type BuffId, type FactionId, type FxEvent, type GameMap, type WeaponId,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { applyDamage, type Attacker } from "../src/sim/arena";
import { buffsOf, grantBuff, moveSpeedMult } from "../src/sim/buffs";
import { combatant, defenseOf, timingsOf, type Combatant } from "../src/sim/combatant";
import { heal, noteContact, signatureState } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { killMob, mobTypeOf, placeMob } from "../src/sim/mobLife";
import { markRateOf, modRowsOf, outgoingMult, updateMods } from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import type { SimEvent, World } from "../src/sim/world";
import { quoted } from "./support/quoted";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

// ---------------------------------------------------------------------------------------------------------------- rig

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

/** Players p0, p1, ... of these factions in a run that started on the first step. */
function startRun(factions: FactionId[], opts: { signatures?: boolean } = {}): World {
  const world = createGameWorld({
    config: { minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(6),
    map: openMap(),
  }, { signatures: opts.signatures ?? false });
  factions.forEach((faction, i) => addPlayer(world, `p${i}`, `name${i}`, { faction }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const RT = (w: World, i: number) => w.players.get(`p${i}`)!;
const C = (w: World, i: number): Combatant => combatant(w, `p${i}`)!;
const paced = (id: FactionId) => pacedFaction(FACTIONS[id]);
const grant = (w: World, i: number, id: BuffId, n: number): void => grantBuff(w, P(w, i), RT(w, i), id, n);

function fxOf<K extends FxEvent["kind"]>(events: SimEvent[], kind: K): Array<Fx<K>> {
  return events.filter((e): e is Extract<SimEvent, { type: "fx" }> => e.type === "fx").map((e) => e.fx)
    .filter((fx): fx is Fx<K> => fx.kind === kind);
}

/** Sets a player's hp to `frac` of a large max hp, so a test hit never kills. */
function setHpFrac(w: World, i: number, frac: number, max = 10_000): void {
  P(w, i).maxHp = max;
  P(w, i).hp = max * frac;
}

/** What one ledger hit of `raw` from p`a` (its faction's shares) takes off p`v` (outside a step). */
function hitFor(w: World, a: number, v: number, raw: number, extra: { sig?: "burn" | "mark"; arena?: boolean } = {}): number {
  const spec = paced(P(w, a).faction as FactionId);
  const before = P(w, v).hp;
  recordHit(w, {
    victim: `p${v}`, by: { id: `p${a}`, name: P(w, a).name }, packet: { raw, ...damageShares(spec) }, weapon: "sword",
    stagger: false, ...extra,
  });
  applyLedger(w);
  return before - P(w, v).hp;
}

/** The same hit with no buff: raw x `mult` through the victim's defense. */
function expectedHit(w: World, a: number, v: number, raw: number, mult: number): number {
  const spec = paced(P(w, a).faction as FactionId);
  return mitigateShares(raw * mult, damageShares(spec), defenseOf(P(w, v)));
}

const STACKS = [3, 1.7, 6.2];

// ---------------------------------------------------------------------------------------------------- one rig per row

/** Each rig grants `n` stacks of its buff and checks the row against its quoted number x k = buffScale(n). */
const RIGS: Record<BuffId, (n: number, k: number) => void> = {
  emberImp: (n, k) => {
    const w = startRun(["fire", "frost"]);
    setHpFrac(w, 1, 0.9);
    grant(w, 0, "emberImp", n);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1 + quoted("emberImp") * k), 9);
  },
  cinderHound: (n, k) => {
    const w = startRun(["frost", "fire"]);
    grant(w, 0, "cinderHound", n);
    expect(P(w, 0).speedMult).toBe(1000);
    RT(w, 0).weapon.lock = "p1";
    updateMods(w);
    expect(P(w, 0).speedMult).toBe(encodeMult(1 + quoted("cinderHound") * k));
    expect(moveSpeedMult(w, C(w, 0))).toBe(decodeMult(encodeMult(1 + quoted("cinderHound") * k)));
    RT(w, 0).weapon.lock = null;
    updateMods(w);
    expect(P(w, 0).speedMult).toBe(1000);
  },
  magmaBrute: (n, k) => {
    const w = startRun(["frost", "fire"]);
    const hp0 = P(w, 0).hp;
    grant(w, 0, "magmaBrute", n);
    const hp = quoted("magmaBrute", 0);
    const resist = quoted("magmaBrute", 1);
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.frost.hp * (1 + hp * k), 9);
    expect(P(w, 0).hp - hp0).toBeCloseTo(FACTIONS.frost.hp * hp * k, 9);
    expect(P(w, 0).shieldBonus).toBe(encodeFlat(resist * k));
    expect(defenseOf(P(w, 0)).shield).toBe(paced("frost").shield + decodeFlat(encodeFlat(resist * k)));
    // Fire's damage is all magic: the shield takes it down.
    setHpFrac(w, 0, 0.9);
    expect(hitFor(w, 1, 0, 100)).toBeCloseTo(100 / (1 + (paced("frost").shield + decodeFlat(encodeFlat(resist * k))) / 100), 9);
  },
  wyrmling: (n, k) => {
    const w = startRun(["fire", "frost"]);
    grant(w, 0, "wyrmling", n);
    setHpFrac(w, 1, 0.8);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1 + quoted("wyrmling") * k), 9);
    setHpFrac(w, 1, 0.7);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1), 9);
  },
  bailiff: (n, k) => {
    const rate = quoted("bailiff");
    expect(markRateOf(P(markRig(n), 0))).toBeCloseTo(1 + rate * k, 12);
    // The mark's engaged time grows (1 + rate x k) x as fast as without the buff.
    const ticks = 12;
    const plain = markRig(0);
    const buffed = markRig(n);
    for (let i = 0; i < ticks; i++) { step(plain, TICK_MS); step(buffed, TICK_MS); }
    const e0 = signatureState(plain, "p0")!.markElapsed;
    const e1 = signatureState(buffed, "p0")!.markElapsed;
    expect(e0).toBeGreaterThan(0);
    expect(e1 / e0).toBeCloseTo(1 + rate * k, 9);
  },
  chainWarden: (n) => expectInert("chainWarden", n),
  inquisitor: (n) => expectInert("inquisitor", n),
  executioner: (n, k) => {
    const w = startRun(["fire", "frost"]);
    grant(w, 0, "executioner", n);
    setHpFrac(w, 1, 0.2);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1 + quoted("executioner") * k), 9);
    setHpFrac(w, 1, 0.3);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1), 9);
  },
  plagueRat: (n, k) => {
    const w = startRun(["plague", "fire"]);
    grant(w, 0, "plagueRat", n);
    expect(P(w, 0).asMult).toBe(encodeMult(1 + quoted("plagueRat") * k));
    const as = decodeMult(P(w, 0).asMult);
    for (const weapon of ["bow", "sword", "axe"] as WeaponId[]) {
      expect(timingsOf(P(w, 0), weapon)!.interval).toBe(attackInterval(paced("plague"), weapon, as));
    }
  },
  bloatfly: (n) => expectInert("bloatfly", n),
  rotMonk: (n) => expectInert("rotMonk", n),
  ratOgre: (n, k) => {
    const w = startRun(["fire", "frost"]);
    grant(w, 0, "ratOgre", n);
    setHpFrac(w, 1, 0.49);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1 + quoted("ratOgre") * k), 9);
    setHpFrac(w, 1, 0.5);
    expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1), 9);
  },
  frostWisp: (n) => expectInert("frostWisp", n),
  iceGolem: (n, k) => {
    const w = startRun(["holy", "fire"]);
    const hp0 = P(w, 0).hp;
    grant(w, 0, "iceGolem", n);
    const hp = quoted("iceGolem");
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.holy.hp * (1 + hp * k), 9);
    expect(P(w, 0).hp - hp0).toBeCloseTo(FACTIONS.holy.hp * hp * k, 9);
  },
  rimeStalker: (n, k) => {
    const w = startRun(["fire", "holy"]);
    grant(w, 0, "rimeStalker", n);
    const armor = quoted("rimeStalker");
    expect(P(w, 0).armorBonus).toBe(encodeFlat(armor * k));
    expect(defenseOf(P(w, 0)).armor).toBe(paced("fire").armor + decodeFlat(encodeFlat(armor * k)));
    // Holy's damage is all physical: the armor takes it down.
    setHpFrac(w, 0, 0.9);
    expect(hitFor(w, 1, 0, 100)).toBeCloseTo(100 / (1 + decodeFlat(encodeFlat(armor * k)) / 100), 9);
  },
  glacialWarden: (n) => expectInert("glacialWarden", n),
  acolyte: (n, k) => {
    // A Fire player (no lifesteal of its own) heals the quoted share x k of what it lands, inside the lockout.
    const w = startRun(["fire", "frost"], { signatures: true });
    grant(w, 0, "acolyte", n);
    P(w, 0).hp = 200;
    setHpFrac(w, 1, 0.9);
    const landed = landOneHit(w, 0, 1, 300);
    expect(landed).toBeGreaterThan(0);
    expect(P(w, 0).hp - 200).toBeCloseTo(landed * quoted("acolyte") * k, 9);
  },
  seraphShard: (n, k) => {
    const w = startRun(["frost", "sentenced"]);
    grant(w, 0, "seraphShard", n);
    const resist = quoted("seraphShard");
    expect(P(w, 0).shieldBonus).toBe(encodeFlat(resist * k));
    expect(defenseOf(P(w, 0)).shield).toBe(paced("frost").shield + decodeFlat(encodeFlat(resist * k)));
  },
  penitent: (n, k) => {
    const w = startRun(["fire", "frost"]);
    grant(w, 0, "penitent", n);
    setHpFrac(w, 1, 0.9);
    const full = P(w, 0).maxHp;
    for (const [frac, steps] of [[1, 0], [0.75, 2], [0.69, 3], [0.8, 2], [0.05, 9]] as const) {
      P(w, 0).hp = full * frac;
      expect(hitFor(w, 0, 1, 100), `${frac}`).toBeCloseTo(expectedHit(w, 0, 1, 100, 1 + quoted("penitent") * k * steps), 9);
    }
  },
  bloodSaint: (n, k) => {
    const w = startRun(["frost", "fire"], { signatures: true });
    grant(w, 0, "bloodSaint", n);
    const max = P(w, 0).maxHp;
    // In combat (the lockout running) a hit leaves it at 25%: it heals the quoted share x k of max hp after the pass anyway.
    const share = quoted("bloodSaint");
    const events = landOneHitEvents(w, 1, 0, rawToLeave(w, 1, 0, 0.25 * max));
    const healed = fxOf(events, "heal").filter((h) => h.id === "p0");
    expect(healed).toHaveLength(1);
    expect(healed[0]!.amount).toBeCloseTo(share * k * max, 6);
    expect(P(w, 0).hp).toBeCloseTo(0.25 * max + share * k * max, 6);
  },
};

/** A Sentenced (bow) player p0 with `n` Bailiff stacks engaged with a Frost p1 a few tiles away. */
function markRig(n: number): World {
  const w = startRun(["sentenced", "frost"], { signatures: true });
  for (const i of [0, 1]) {
    setHpFrac(w, i, 1, 1e7);
    P(w, i).weapon0 = i === 0 ? "bow" : "shield";
    P(w, i).slot = 0;
  }
  P(w, 0).x = 300; P(w, 0).y = 330;
  P(w, 1).x = 420; P(w, 1).y = 330;
  for (const i of [0, 1]) RT(w, i).history = [{ t: w.state.serverTime, x: P(w, i).x, y: P(w, i).y }];
  if (n > 0) grant(w, 0, "bailiff", n);
  noteContact(w, "p0", "p1");
  return w;
}

/** A row that needs the status runtime does nothing before R4b: no rows, no mirror, no damage change. */
function expectInert(id: BuffId, n: number): void {
  const w = startRun(["fire", "frost"]);
  grant(w, 0, id, n);
  expect(buffsOf(P(w, 0)).get(id)).toBe(n);
  expect(modRowsOf(P(w, 0))).toEqual([]);
  for (const f of MIRROR_FIELDS) expect(P(w, 0)[f], f).toBe(WIRE_IDENTITY_MIRRORS[f]);
  for (const frac of [1, 0.5, 0.1]) expect(outgoingMult(P(w, 0), frac)).toBe(1);
  setHpFrac(w, 1, 0.9);
  expect(hitFor(w, 0, 1, 100)).toBeCloseTo(expectedHit(w, 0, 1, 100, 1), 9);
}

/** The raw hit from p`a` that brings p`v` to `hp` (its defense in). */
function rawToLeave(w: World, a: number, v: number, hp: number): number {
  return (P(w, v).hp - hp) / expectedHit(w, a, v, 1, 1);
}

/** Records one hit from p`a` on p`v` in the next step's beforeDamage phase; returns that step's events. */
function landOneHitEvents(w: World, a: number, v: number, raw: number): SimEvent[] {
  let once = false;
  w.beforeDamage.push((world) => {
    if (once) return;
    once = true;
    const spec = paced(P(world, a).faction as FactionId);
    recordHit(world, { victim: `p${v}`, by: { id: `p${a}`, name: P(world, a).name }, packet: { raw, ...damageShares(spec) }, weapon: "sword", stagger: false });
  });
  return step(w, TICK_MS);
}

/** The same, returning what the hit took off p`v`. */
function landOneHit(w: World, a: number, v: number, raw: number): number {
  const before = P(w, v).hp;
  landOneHitEvents(w, a, v, raw);
  return before - P(w, v).hp;
}

describe("one rig per buff: the quoted number at 3 stacks, scaled by S(n) / S(3)", () => {
  it("covers every buff in the catalog", () => {
    expect(Object.keys(RIGS).sort()).toEqual(BUFFS.map((b) => b.id).sort());
  });
  for (const b of BUFFS) {
    for (const n of STACKS) {
      it(`${b.id} at ${n} stacks: ${b.text}`, () => RIGS[b.id](n, buffScale(n)));
    }
  }
});

// -------------------------------------------------------------------------------------------------------- machinery

describe("grantBuff", () => {
  it("adds to the buff's stacks, re-folds at once and sends a buff fx naming the buff, which round-trips the wire", () => {
    const w = startRun(["plague", "fire"]);
    grant(w, 0, "plagueRat", 1.1);
    grant(w, 0, "plagueRat", 2.25);
    expect(P(w, 0).buffs.get("plagueRat")).toBeCloseTo(3.35, 12);
    expect(P(w, 0).asMult).toBe(encodeMult(1 + quoted("plagueRat") * buffScale(3.35)));
    const fx = fxOf(w.events, "buff");
    expect(fx).toEqual([
      { kind: "buff", id: "p0", buff: "plagueRat", stacks: 1.1, total: 1.1 },
      { kind: "buff", id: "p0", buff: "plagueRat", stacks: 2.25, total: 1.1 + 2.25 },
    ]);
    const back = unpackFx(packFx(fx, 1000), []);
    expect(back.map((f) => (f.kind === "buff" ? [f.buff, f.stacks, f.total] : null))).toEqual([["plagueRat", 1.1, 1.1], ["plagueRat", 2.25, 3.35]]);
  });

  it("ignores nothing, a negative amount, an unknown id, a dead or resolved player", () => {
    const w = startRun(["plague", "fire"]);
    grant(w, 0, "plagueRat", 0);
    grant(w, 0, "plagueRat", -1);
    grantBuff(w, P(w, 0), RT(w, 0), "nope" as BuffId, 2);
    P(w, 1).status = "dead";
    grant(w, 1, "emberImp", 2);
    expect(P(w, 0).buffs.size + P(w, 1).buffs.size).toBe(0);
    expect(fxOf(w.events, "buff")).toEqual([]);
  });

  it("patches a mirror only when its quantized value changes, and a player nothing buffs never patches one", () => {
    const w = startRun(["plague", "fire"]);
    const encoder = new Encoder(w.state);
    const decoder = connect(encoder);
    encoder.discardChanges();
    for (let i = 0; i < 10; i++) {
      step(w, TICK_MS);
      for (const f of MIRROR_FIELDS) expect(patched(encoder, decoder)).not.toContain(f);
    }
    grant(w, 0, "plagueRat", 3);
    expect(patched(encoder, decoder)).toEqual(expect.arrayContaining(["asMult"]));
    // A sliver more moves the folded double by far less than a thousandth: the buffs map patches, the mirror does not.
    const before = P(w, 0).asMult;
    grant(w, 0, "plagueRat", 0.001);
    expect(P(w, 0).asMult).toBe(before);
    expect(patched(encoder, decoder)).not.toContain("asMult");
    expect(decoder.state.players.get("p0")!.buffs.get("plagueRat")).toBeCloseTo(3.001, 5);
    expect(decoder.state.players.get("p0")!.asMult).toBe(P(w, 0).asMult);
    // Cinder Hound's mirror moves when a lock starts or ends, not every tick it holds.
    grant(w, 0, "cinderHound", 3);
    encoder.discardChanges();
    RT(w, 0).weapon.lock = "p1";
    updateMods(w);
    expect(patched(encoder, decoder)).toContain("speedMult");
    updateMods(w);
    updateMods(w);
    expect(patched(encoder, decoder)).not.toContain("speedMult");
  });
});

function connect(encoder: Encoder<RaidState>): Decoder<RaidState> {
  const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
  decoder.decode(encoder.encodeAll());
  return decoder;
}

function patched(encoder: Encoder<RaidState>, decoder: Decoder<RaidState>): string[] {
  decoder.triggerChanges ??= () => {};
  const changes = decoder.decode(encoder.encode());
  encoder.discardChanges();
  return changes.filter((c) => c.ref instanceof Object && "asMult" in (c.ref as object)).map((c) => String(c.field));
}

describe("the bounty moves half of each buff", () => {
  it("a bounty kill grants the killer half of every buff the victim held, one fx per buff", () => {
    const w = startRun(["fire", "frost"]);
    grant(w, 1, "iceGolem", 4);
    grant(w, 1, "emberImp", 2.2);
    grant(w, 0, "emberImp", 1);
    P(w, 1).bounty = 20;
    w.events.length = 0;
    const by: Attacker = { id: "p0", p: P(w, 0), rt: RT(w, 0) };
    applyDamage(w, P(w, 1), RT(w, 1), 1e9, by);
    expect(P(w, 1).status).not.toBe("alive");
    expect(buffsOf(P(w, 0))).toEqual(new Map([["emberImp", 1 + 2.2 * BOUNTY_STACK_SHARE], ["iceGolem", 4 * BOUNTY_STACK_SHARE]]));
    expect(fxOf(w.events, "buff").map((f) => [f.buff, f.stacks])).toEqual([["emberImp", 1.1], ["iceGolem", 2]]);
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.fire.hp * (1 + quoted("iceGolem") * buffScale(2)), 9);
  });
});

describe("lifesteal", () => {
  it("adds to Holy's own, which alone is unchanged, and the total stops at 100%", () => {
    for (const [frac, acolyte] of [[0.5, 0], [0.5, 3], [0.5, 6], [0.1, 6]] as const) {
      const w = startRun(["holy", "frost"], { signatures: true });
      if (acolyte > 0) grant(w, 0, "acolyte", acolyte);
      setHpFrac(w, 0, frac, 10_000);
      setHpFrac(w, 1, 0.9);
      const before = P(w, 0).hp;
      const landed = landOneHit(w, 0, 1, 400);
      const own = lifestealFraction(paced("holy"), frac);
      const share = lifestealShare(own, quoted("acolyte") * buffScale(acolyte));
      expect(P(w, 0).hp - before, `${frac} ${acolyte}`).toBeCloseTo(landed * share, 9);
      if (frac === 0.1) expect(share).toBe(1);
    }
  });
});

describe("Blood Saint", () => {
  it("fires once per run, only below 30%, only for a survivor", () => {
    const w = startRun(["frost", "fire"], { signatures: true });
    grant(w, 0, "bloodSaint", 3);
    const max = P(w, 0).maxHp;
    // To 40%: nothing.
    expect(fxOf(landOneHitEvents(w, 1, 0, rawToLeave(w, 1, 0, 0.4 * max)), "heal").filter((h) => h.id === "p0")).toEqual([]);
    // To 20%: the quoted share of max hp back (at 3 stacks, k = 1).
    landOneHitEvents(w, 1, 0, rawToLeave(w, 1, 0, 0.2 * max));
    expect(P(w, 0).hp).toBeCloseTo((0.2 + quoted("bloodSaint")) * max, 6);
    // To 10% again: once per run, so nothing.
    expect(fxOf(landOneHitEvents(w, 1, 0, rawToLeave(w, 1, 0, 0.1 * max)), "heal").filter((h) => h.id === "p0")).toEqual([]);
    expect(RT(w, 0).fired).toEqual(new Set(["bloodSaint:0"]));
  });

  it("a killing pass does not fire it", () => {
    const w = startRun(["frost", "fire"], { signatures: true });
    grant(w, 0, "bloodSaint", 3);
    landOneHitEvents(w, 1, 0, rawToLeave(w, 1, 0, -100));
    expect(P(w, 0).status).not.toBe("alive");
    expect(RT(w, 0).fired).toBeUndefined();
  });
});

describe("heal({ ignoreLockout })", () => {
  it("skips the 3 s lockout and nothing else (never past max hp, never on a fighter who is down)", () => {
    const w = startRun(["frost", "fire"], { signatures: true });
    landOneHit(w, 1, 0, 50); // p0 is in combat now
    expect(w.state.serverTime).toBeLessThan(HEAL_LOCKOUT_SECONDS * 1000);
    P(w, 0).hp = 100;
    expect(heal(w, C(w, 0), 50)).toBe(0);
    expect(heal(w, C(w, 0), 50, { ignoreLockout: true })).toBe(50);
    expect(heal(w, C(w, 0), 1e9, { ignoreLockout: true })).toBe(P(w, 0).maxHp - 150);
    P(w, 0).status = "dead";
    expect(heal(w, C(w, 0), 50, { ignoreLockout: true })).toBe(0);
  });
});

describe("a mob kill grants its type's buff", () => {
  it("MobState.type when set; else the zone's first normal type, or its elite type for an elite", () => {
    expect(mobTypeOf("rotMonk", "plague", false)).toBe("rotMonk");
    expect(mobTypeOf("", "plague", false)).toBe("plagueRat");
    expect(mobTypeOf("", "plague", true)).toBe("ratOgre");
    expect(mobTypeOf("junk", "holy", true)).toBe("bloodSaint");
    const w = startRun(["fire", "frost"]);
    const id = placeMob(w, { region: "frost", elite: false, at: { x: 200, y: 330 } });
    w.state.mobs.get(id)!.type = "rimeStalker";
    const mob = combatant(w, id) as Extract<Combatant, { kind: "mob" }>;
    const entry = recordHit(w, { victim: id, by: { id: "p0", name: "name0" }, packet: { raw: 1, phys: 0, magic: 1, true: 0 }, weapon: "sword", stagger: false });
    w.combat.ledger = [];
    killMob(w, mob, [entry], [mob.s.hp]);
    const got = buffsOf(P(w, 0)).get("rimeStalker")!;
    expect(got).toBeGreaterThan(0.3 * MOB_BUFF_STACKS);
    expect(got).toBeLessThanOrEqual(1.25 * MOB_BUFF_STACKS);
    expect(fxOf(w.events, "combo" as FxEvent["kind"])).toEqual([]);
  });
});
