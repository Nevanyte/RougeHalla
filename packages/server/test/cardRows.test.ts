// The cards in the sim (shared/cards.ts rows, folded by sim/mods.ts): one rig per live card, each proving the card does what its text
// says, read where the sim reads it (the mirrors, the readers of sim/mods.ts, a ledger hit); then what is not live stays inert, the
// machinery around a grant (the mirrors patch only when their quantized value changes, heal({ ignoreLockout }), lifesteal), Second
// Wind's heal over time, Pestilence in the signature, and the ledger staying order-free with the `vs` rows.
// Cards whose consumer sits in a combat file that the card pass wires later (healTaken in heal(), the Boom's dot and returned mults,
// lifestealMult and Siphon in the lifesteal pass, slow resistance, Race to 0 in the ledger, the new `vs` probes in the ledger's own
// probe) are pinned at the reader: the number the sim will read, not yet the end effect.
import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import {
  attackInterval, AUGMENT_IDS, BASE_STAT_IDS, baseCardId, CARD_TIERS, cardDef, cardLive, cardPower, CARDS, damagePerHit, damageShares,
  decodeFlat, decodeMult, diseaseDps, encodeFlat, encodeMult, EXECUTE_BAND, FACTIONS, HEAL_LOCKOUT_SECONDS, HEAL_OVER_TIME_STEP_MS,
  healOverTimeSpanMs, healOverTimeSteps, lifestealFraction, LIFESTEAL_MAX, lifestealShare, LS_CAP, mapFromTiles, MIRROR_FIELDS, mitigateShares,
  mulberry32, pacedFaction, scalingDamage, SIG_EXECUTE, SIGNATURE_WEAPONS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, WIRE_IDENTITY_MIRRORS,
  cardText, type CardId, type FactionId, type GameMap,
} from "@raid/shared";
import type { PlayerState, RaidState } from "@raid/shared/schema";
import { teleportToColiseum } from "../src/sim/arena";
import { grantCard } from "../src/sim/chests";
import { combatant, defenseOf, timingsOf, type Combatant } from "../src/sim/combatant";
import { heal, noteContact } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { placeMob } from "../src/sim/mobLife";
import {
  adOf, apOf, critChanceOf, dotMultOf, executeBandOf, hasFlag, healTakenMultOf, hitMultOf, hpRaceCapOf, lifestealDotOf, lifestealMultOf,
  lifestealRowsOf, lingerMultOf, markRateOf, modRowsOf, outgoingMult, returnedMultOf, slowResistOf, statSumsOf, updateMods,
  wishCooldownMultOf,
} from "../src/sim/mods";
import { addPlayer, step } from "../src/sim/step";
import { vsExtras } from "../src/sim/vsProbe";
import { packetFor } from "../src/sim/weapons";
import type { LedgerEntry, World } from "../src/sim/world";
import { quoted } from "./support/quoted";

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

/** Players p0, p1, ... of these factions in a run that started on the first step (the PvP rules off: a damage number is the card's alone). */
function startRun(factions: FactionId[], opts: { signatures?: boolean } = {}): World {
  const world = createGameWorld({
    config: { minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, pvpRules: false },
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
const C = (w: World, i: number) => combatant(w, `p${i}`)! as Extract<Combatant, { kind: "player" }>;
const paced = (id: FactionId) => pacedFaction(FACTIONS[id]);

/** p`i` takes card `id` through the chest's own grant, a conditional's base (Tier I) first. */
function hold(w: World, i: number, id: string, copies = 1): void {
  const def = cardDef(id)!;
  if (def.kind === "conditional" && def.requires) {
    const have = [1, 2, 3].some((t) => P(w, i).build.get(`${def.requires}${t}`));
    if (!have) expect(grantCard(w, C(w, i), `${def.requires}1`)).toBe(1);
  }
  for (let k = 1; k <= copies; k++) expect(grantCard(w, C(w, i), id)).toBe(k);
}

function setHpFrac(w: World, i: number, frac: number, max = 10_000): void {
  P(w, i).maxHp = max;
  P(w, i).hp = max * frac;
}

/** What one ledger hit of `raw` from p`a` takes off victim `victim` (outside a step). */
function hitFor(w: World, a: number, victim: string, raw: number): number {
  const spec = paced(P(w, a).faction as FactionId);
  const s = w.state.players.get(victim) ?? w.state.mobs.get(victim)!;
  const before = s.hp;
  recordHit(w, { victim, by: { id: `p${a}`, name: P(w, a).name }, packet: { raw, ...damageShares(spec) }, weapon: "sword", stagger: false });
  applyLedger(w);
  return before - s.hp;
}

/** The same hit through the victim's defense at multiplier `mult`. */
function expectedHit(w: World, a: number, victim: string, raw: number, mult: number): number {
  const s = w.state.players.get(victim) ?? w.state.mobs.get(victim)!;
  return mitigateShares(raw * mult, damageShares(paced(P(w, a).faction as FactionId)), defenseOf(s));
}

/** Records one hit from p`a` on p`v` in the next step's beforeDamage phase; returns what it took off p`v`. */
function landOneHit(w: World, a: number, v: number, raw: number): number {
  const before = P(w, v).hp;
  let once = false;
  w.beforeDamage.push((world) => {
    if (once) return;
    once = true;
    const spec = paced(P(world, a).faction as FactionId);
    recordHit(world, { victim: `p${v}`, by: { id: `p${a}`, name: P(world, a).name }, packet: { raw, ...damageShares(spec) }, weapon: "sword", stagger: false });
  });
  step(w, TICK_MS);
  return before - P(w, v).hp;
}

const wire = (v: number): number => decodeFlat(encodeFlat(v));
const sim = (x: number): number => decodeMult(encodeMult(x));

// ------------------------------------------------------------------------------------------------- the base cards

/** One rig per base card: its stat arrives where the sim reads it. */
function baseRig(base: (typeof BASE_STAT_IDS)[number], tier: 1 | 2 | 3): () => void {
  const id = baseCardId(base, tier);
  const v = (): number => quoted(id);
  switch (base) {
    case "ad": return () => {
      const w = startRun(["fire", "frost"]);
      const before = packetFor(C(w, 0), "sword").raw;
      hold(w, 0, id);
      expect(P(w, 0).adBonus).toBe(encodeFlat(v()));
      expect(adOf(P(w, 0))).toBe(wire(v()));
      const t = timingsOf(P(w, 0), "sword")!;
      const add = scalingDamage("sword", { ad: wire(v()), ap: 0, bonusMaxHp: 0, bonusDefense: 0 }, 1, t.interval).phys;
      expect(add).toBeGreaterThan(0);
      expect(packetFor(C(w, 0), "sword").raw).toBeCloseTo(before + add, 9);
    };
    case "ap": return () => {
      const w = startRun(["fire", "frost"]);
      const before = packetFor(C(w, 0), "wand").raw;
      hold(w, 0, id);
      expect(P(w, 0).apBonus).toBe(encodeFlat(v()));
      expect(apOf(P(w, 0))).toBe(wire(v()));
      const t = timingsOf(P(w, 0), "wand")!;
      const add = scalingDamage("wand", { ad: 0, ap: wire(v()), bonusMaxHp: 0, bonusDefense: 0 }, 1, t.interval).magic;
      expect(add).toBeGreaterThan(0);
      expect(packetFor(C(w, 0), "wand").raw).toBeCloseTo(before + add, 9);
    };
    case "haste": return () => {
      const w = startRun(["frost", "fire"]);
      hold(w, 0, id);
      expect(P(w, 0).asMult).toBe(encodeMult(1 + v()));
      expect(timingsOf(P(w, 0), "axe")!.interval).toBeCloseTo(attackInterval(paced("frost"), "axe", sim(1 + v())), 9);
    };
    case "vitality": return () => {
      const w = startRun(["holy", "fire"]);
      const hp0 = P(w, 0).hp;
      hold(w, 0, id);
      expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.holy.hp * (1 + v()), 9);
      expect(P(w, 0).hp - hp0).toBeCloseTo(FACTIONS.holy.hp * v(), 9);
    };
    case "armor": return () => {
      const w = startRun(["fire", "holy"]);
      hold(w, 0, id);
      expect(P(w, 0).armorBonus).toBe(encodeFlat(v()));
      expect(defenseOf(P(w, 0)).armor).toBe(paced("fire").armor + wire(v()));
      // Holy's damage is all physical: the armor takes it down.
      setHpFrac(w, 0, 0.9);
      expect(hitFor(w, 1, "p0", 100)).toBeCloseTo(100 / (1 + wire(v()) / 100), 9);
    };
    case "mr": return () => {
      const w = startRun(["frost", "fire"]);
      hold(w, 0, id);
      expect(P(w, 0).shieldBonus).toBe(encodeFlat(v()));
      expect(defenseOf(P(w, 0)).shield).toBe(paced("frost").shield + wire(v()));
      // Fire's damage is all magic: the magic resist takes it down.
      setHpFrac(w, 0, 0.9);
      expect(hitFor(w, 1, "p0", 100)).toBeCloseTo(100 / (1 + (paced("frost").shield + wire(v())) / 100), 9);
    };
    case "leech": return () => {
      // A Fire player (no lifesteal of its own) heals the card's share of what it lands, inside the lockout.
      const w = startRun(["fire", "frost"], { signatures: true });
      hold(w, 0, id);
      expect(lifestealRowsOf(P(w, 0))).toBeCloseTo(v(), 12);
      P(w, 0).hp = 200;
      setHpFrac(w, 1, 0.9);
      const landed = landOneHit(w, 0, 1, 300);
      expect(landed).toBeGreaterThan(0);
      expect(P(w, 0).hp - 200).toBeCloseTo(landed * Math.min(LS_CAP, v()), 9);
    };
    case "fleet": return () => {
      const w = startRun(["fire", "frost"]);
      hold(w, 0, id);
      expect(P(w, 0).speedMult).toBe(encodeMult(1 + v()));
      // Off from a shot's start (the Swift Boots rule); fleet.test.ts pins the window to the tick.
      RT(w, 0).weapon.lastShotAt = w.state.serverTime;
      updateMods(w);
      expect(P(w, 0).speedMult).toBe(1000);
    };
  }
}

// ------------------------------------------------------------------------------------------- conditionals and augments

type Rig = () => void;

/** The `vs` probes the ledger's own probe will hand outgoingMult: the sim's vsExtras, with the answer of the test where the world has none. */
const probeOf = (w: World, by: string, victim: string) => vsExtras(w, by, victim);

const RIGS: Record<string, Rig> = {
  // ---- conditionals
  bloodthirst: () => {
    const w = startRun(["frost", "fire"]);
    hold(w, 0, "bloodthirst");
    setHpFrac(w, 0, 0.6);
    updateMods(w);
    expect(lifestealMultOf(P(w, 0))).toBe(1);
    setHpFrac(w, 0, 0.49);
    updateMods(w);
    expect(lifestealMultOf(P(w, 0))).toBe(2);
    setHpFrac(w, 0, 0.8);
    updateMods(w);
    expect(lifestealMultOf(P(w, 0))).toBe(1);
  },
  secondSkin: () => {
    const w = startRun(["frost", "fire"]);
    hold(w, 0, "secondSkin");
    expect(statSumsOf(P(w, 0)).healBarrier).toBeCloseTo(quoted("secondSkin"), 12);
    expect(statSumsOf(P(w, 1)).healBarrier).toBe(0);
  },
  juggernaut: () => {
    const w = startRun(["frost", "fire"]);
    hold(w, 0, "juggernaut"); // ad1 first: 12 AD
    expect(P(w, 0).armorBonus).toBe(encodeFlat(12 * quoted("juggernaut", 0)));
    expect(P(w, 0).shieldBonus).toBe(encodeFlat(12 * quoted("juggernaut", 1)));
    hold(w, 0, "ad3");
    expect(P(w, 0).armorBonus).toBe(encodeFlat((12 + 33) * 0.25));
  },
  spellsword: () => {
    const w = startRun(["frost", "fire"]);
    hold(w, 0, "spellsword");
    expect(apOf(P(w, 0))).toBe(wire(12 * 0.5));
    hold(w, 0, "ap1");
    expect(apOf(P(w, 0))).toBe(wire(12 * 0.5 + 12));
  },
  bigBrain: () => {
    const w = startRun(["holy", "fire"]);
    hold(w, 0, "bigBrain"); // vitality1: +9% of 1400
    expect(apOf(P(w, 0))).toBe(wire(0.02 * FACTIONS.holy.hp * 1.09));
  },
  arcaneTempo: () => {
    const w = startRun(["frost", "fire"]);
    hold(w, 0, "arcaneTempo"); // haste1: +9% attack speed = 9 AP
    expect(apOf(P(w, 0))).toBeCloseTo(9, 1);
    hold(w, 0, "haste2");
    expect(apOf(P(w, 0))).toBeCloseTo(25, 1);
  },
  momentum: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "momentum"); // fleet1: +6% move speed -> +6% damage
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(1.06, 12);
    hold(w, 0, "fleet3", 3); // the conversion stops at +30%
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(1.3, 12);
  },
  stoneSkin: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "stoneSkin"); // armor1: +15 armor, and 2 of each per 100 max hp
    expect(P(w, 0).armorBonus).toBe(encodeFlat(15 + 0.02 * FACTIONS.fire.hp));
    expect(P(w, 0).shieldBonus).toBe(encodeFlat(0.02 * FACTIONS.fire.hp));
  },
  hearty: () => {
    const w = startRun(["holy", "fire"]);
    hold(w, 0, "hearty");
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.holy.hp * (1 + 0.09 + quoted("hearty")), 9);
  },
  // ---- augments
  hereComesTheBoom: () => {
    const w = startRun(["fire", "frost"]);
    const before = packetFor(C(w, 0), "axe").raw;
    hold(w, 0, "hereComesTheBoom");
    expect(P(w, 0).asMult).toBe(500);
    expect(hitMultOf(P(w, 0))).toBe(2.5);
    expect(dotMultOf(P(w, 0))).toBe(1.25);
    expect(returnedMultOf(P(w, 0))).toBe(1.25);
    // Half the speed, per hit unchanged, then x2.5: a hit of 2.5x, a quarter more damage a second.
    expect(packetFor(C(w, 0), "axe").raw).toBeCloseTo(damagePerHit(paced("fire"), "axe", 0.5) * 2.5, 9);
    expect(packetFor(C(w, 0), "axe").raw).toBeCloseTo(before * 2.5, 9);
  },
  machineGun: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "machineGun");
    expect(P(w, 0).asMult).toBe(2000);
    expect(hitMultOf(P(w, 0))).toBe(quoted("machineGun", 1));
    expect(quoted("machineGun", 1)).toBe(0.5);
    expect(packetFor(C(w, 0), "axe").raw).toBeCloseTo(damagePerHit(paced("fire"), "axe", 2) * 0.5, 9);
  },
  glassCannon: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "glassCannon");
    setHpFrac(w, 1, 0.9);
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.fire.hp * 0.75, 9);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1.35), 9);
  },
  thickSkull: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "thickSkull");
    expect(P(w, 0).maxHp).toBeCloseTo(FACTIONS.fire.hp * 1.3, 9);
    expect(hasFlag(P(w, 0), "noCrit")).toBe(true);
    expect(critChanceOf(P(w, 0))).toBe(0);
  },
  vampiricPact: () => {
    const w = startRun(["holy", "frost"], { signatures: true });
    hold(w, 0, "vampiricPact");
    expect(lifestealRowsOf(P(w, 0))).toBeCloseTo(0.15, 12);
    expect(healTakenMultOf(P(w, 0))).toBe(0);
    expect(healTakenMultOf(P(w, 1))).toBe(1);
  },
  arcaneOverload: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "arcaneOverload");
    hold(w, 0, "ap1");
    expect(apOf(P(w, 0))).toBe(wire(12 * 1.5));
    expect(wishCooldownMultOf(P(w, 0))).toBe(2);
    expect(wishCooldownMultOf(P(w, 1))).toBe(1);
  },
  committed: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "committed");
    expect(hasFlag(P(w, 0), "lockSecondSlot")).toBe(true);
    expect(P(w, 0).asMult).toBe(encodeMult(1.15));
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(1.2, 12);
  },
  slowBurn: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "slowBurn");
    expect(lingerMultOf(P(w, 0))).toBe(2);
    expect(dotMultOf(P(w, 0))).toBe(0.7);
  },
  fistsOfFury: () => {
    const w = startRun(["fire", "frost"]);
    expect(P(w, 0).weapon0).toBe("");
    hold(w, 0, "fistsOfFury");
    expect(P(w, 0).asMult).toBe(encodeMult(1.4));
    P(w, 0).weapon0 = "sword";
    updateMods(w);
    expect(P(w, 0).asMult).toBe(1000);
    P(w, 0).weapon0 = "";
    updateMods(w);
    expect(P(w, 0).asMult).toBe(encodeMult(1.4));
  },
  slowStarter: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "slowStarter");
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(0.7, 12);
    // A fight is a landed or taken hit within FIGHT_GAP_SECONDS of the last: three seconds of it turn the -30% into +35%.
    const t0 = w.state.serverTime;
    const touch = (): void => {
      w.combat.landed = [{ victim: "p1", by: "p0", amount: 1, weapon: "sword", sig: undefined } as never];
      updateMods(w);
      w.combat.landed = [];
    };
    touch();
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(0.7, 12);
    for (let ms = 500; ms <= 3200; ms += 500) {
      w.state.serverTime = t0 + ms;
      touch();
    }
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(1.35, 12);
  },
  coupDeGrace: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "coupDeGrace");
    expect(outgoingMult(P(w, 0), 0.29)).toBeCloseTo(1.3, 12);
    expect(outgoingMult(P(w, 0), 0.3)).toBe(1);
    setHpFrac(w, 1, 0.29);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1.3), 9);
  },
  bigGameHunter: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "bigGameHunter");
    const elite = placeMob(w, { region: "fire", elite: true, at: { x: tileCentre(20), y: tileCentre(5) } });
    const normal = placeMob(w, { region: "fire", elite: false, at: { x: tileCentre(22), y: tileCentre(5) } });
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", elite))).toBeCloseTo(1.25, 12); // an elite mob at full hp: "elite", not "a player above 70%"
    expect(outgoingMult(P(w, 0), 0.5, probeOf(w, "p0", elite))).toBeCloseTo(1.25, 12);
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", normal))).toBe(1); // a mob at full hp is not "big game"
    expect(outgoingMult(P(w, 0), 0.71, probeOf(w, "p0", "p1"))).toBeCloseTo(1.25, 12); // a player above 70%
    expect(outgoingMult(P(w, 0), 0.7, probeOf(w, "p0", "p1"))).toBe(1);
  },
  packLeader: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "packLeader");
    expect(outgoingMult(P(w, 0), 1)).toBe(1);
    RT(w, 0).campsCleared = 3;
    updateMods(w);
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(1.09, 12);
    RT(w, 0).campsCleared = 20;
    updateMods(w);
    expect(outgoingMult(P(w, 0), 1)).toBeCloseTo(1.24, 12);
  },
  raceToZero: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "raceToZero");
    expect(hpRaceCapOf(P(w, 0))).toBe(2.5);
    expect(hpRaceCapOf(P(w, 1))).toBe(0);
  },
  sittingDucks: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "sittingDucks");
    expect(outgoingMult(P(w, 0), 1, { slowed: () => true })).toBeCloseTo(1.12, 12);
    expect(outgoingMult(P(w, 0), 1, { slowed: () => false })).toBe(1);
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", "p1"))).toBe(1); // nobody is slowed yet
  },
  ironWill: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "ironWill");
    expect(slowResistOf(P(w, 0))).toBe(0.4);
    expect(slowResistOf(P(w, 1))).toBe(0);
  },
  gatheringStorm: () => {
    const w = startRun(["sentenced", "frost"]);
    hold(w, 0, "gatheringStorm");
    expect(markRateOf(P(w, 0))).toBe(1.5);
  },
  wellspring: () => {
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "wellspring");
    expect(healTakenMultOf(P(w, 0))).toBe(1.25);
  },
  siphon: () => {
    const w = startRun(["plague", "frost"]);
    hold(w, 0, "siphon");
    expect(lifestealDotOf(P(w, 0))).toBe(0.2);
  },
  quickdraw: () => {
    const w = startRun(["fire", "frost"]);
    const axe = timingsOf(P(w, 0), "axe")!;
    const bow = timingsOf(P(w, 0), "bow")!;
    hold(w, 0, "quickdraw");
    expect(P(w, 0).windupMult).toBe(500);
    expect(timingsOf(P(w, 0), "axe")!.windup).toBeCloseTo(axe.windup * 0.5, 9);
    expect(timingsOf(P(w, 0), "sword")!.windup).toBeCloseTo(0.05, 9);
    expect(timingsOf(P(w, 0), "bow")).toEqual(bow); // melee windups only
  },
  bountyHunter: () => {
    const w = startRun(["fire", "frost", "holy"]);
    hold(w, 0, "bountyHunter");
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", "p1"))).toBe(1); // equal power
    hold(w, 1, "ad2");
    expect(cardPower(P(w, 1).build)).toBeGreaterThan(cardPower(P(w, 0).build));
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", "p1"))).toBeCloseTo(1.1, 12);
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", "p2"))).toBe(1);
    const dummy = placeMob(w, { region: "fire", elite: false, at: { x: tileCentre(20), y: tileCentre(5) } });
    expect(outgoingMult(P(w, 0), 1, probeOf(w, "p0", dummy))).toBe(1); // a mob holds no cards
  },
  secondWind: () => {
    const w = startRun(["frost", "fire"], { signatures: true });
    hold(w, 0, "secondWind");
    const share = 0.2;
    setHpFrac(w, 0, 0.3);
    const max = P(w, 0).maxHp;
    // The hit takes p0 to 20%: the first quarter of the heal comes with the pass, despite the lockout.
    const dmg = expectedHit(w, 1, "p0", 2000, 1);
    hitFor(w, 1, "p0", 2000);
    const after = 0.3 * max - dmg;
    expect(after / max).toBeLessThan(0.25);
    expect(P(w, 0).hp).toBeCloseTo(after + (share * max) / 4, 6);
    // Then a quarter every HEAL_OVER_TIME_STEP_MS: all of it within 2 s.
    const t0 = w.state.serverTime;
    while (w.state.serverTime < t0 + 3 * HEAL_OVER_TIME_STEP_MS) step(w, TICK_MS);
    expect(P(w, 0).hp).toBeCloseTo(after + share * max, 6);
    for (let i = 0; i < 20; i++) step(w, TICK_MS);
    expect(P(w, 0).hp).toBeCloseTo(after + share * max, 6);
    // Once: under 25% again, nothing.
    setHpFrac(w, 0, 0.2);
    hitFor(w, 1, "p0", 10);
    for (let i = 0; i < 40; i++) step(w, TICK_MS);
    expect(P(w, 0).hp / P(w, 0).maxHp).toBeLessThan(0.2);
    // And the teleport does not re-arm it (it is a single copy, once a run).
    teleportToColiseum(w);
    P(w, 0).immuneUntil = 0;
    setHpFrac(w, 0, 0.2);
    const hp = P(w, 0).hp - expectedHit(w, 1, "p0", 10, 1);
    hitFor(w, 1, "p0", 10);
    for (let i = 0; i < 40; i++) step(w, TICK_MS);
    expect(P(w, 0).hp).toBe(hp);
  },
  witness: () => {
    const w = startRun(["sentenced", "frost", "fire"], { signatures: true });
    hold(w, 0, "witness");
    setHpFrac(w, 1, 0.9);
    const bonus = 1 + quoted("witness");
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    // p1's lock is on p2: a third party.
    RT(w, 1).weapon.lock = "p2";
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, bonus), 9);
    // p1's lock is on p0 itself: not a third party.
    RT(w, 1).weapon.lock = "p0";
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    // No lock, but p1's last hit (its signature target) is on p2.
    RT(w, 1).weapon.lock = null;
    noteContact(w, "p1", "p2");
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, bonus), 9);
    // A mob fighting someone else is a third party too.
    const mob = placeMob(w, { region: "frost", elite: false, at: { x: tileCentre(20), y: tileCentre(5) } });
    w.mobs.get(mob)!.brain!.mode = "fight";
    w.mobs.get(mob)!.brain!.target = "p2";
    w.state.mobs.get(mob)!.hp = 1e6;
    w.state.mobs.get(mob)!.maxHp = 1e6;
    expect(hitFor(w, 0, mob, 100)).toBeCloseTo(expectedHit(w, 0, mob, 100, bonus), 9);
  },
  pestilence: () => {
    // Anyone but Plague: +damage to targets below 60%.
    const w = startRun(["fire", "frost"]);
    hold(w, 0, "pestilence");
    setHpFrac(w, 1, 0.59);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1.08), 9);
    setHpFrac(w, 1, 0.6);
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1), 9);
    expect(executeBandOf(P(w, 0))).toBe(EXECUTE_BAND);
    // Plague: no damage row, a wider execute instead.
    const pw = plagueRig(true);
    expect(executeBandOf(P(pw, 0))).toBeCloseTo(EXECUTE_BAND + 0.1, 12);
    setHpFrac(pw, 1, 0.55);
    expect(hitFor(pw, 0, "p1", 100)).toBeCloseTo(expectedHit(pw, 0, "p1", 100, 1), 9);
  },
  lastRites: () => {
    const w = startRun(["holy", "fire"]);
    hold(w, 0, "lastRites");
    const on = encodeMult(1 + quoted("lastRites"));
    setHpFrac(w, 0, 0.31);
    updateMods(w);
    expect(P(w, 0).asMult).toBe(1000);
    setHpFrac(w, 0, 0.29);
    updateMods(w);
    expect(P(w, 0).asMult).toBe(on);
    expect(timingsOf(P(w, 0), "wand")!.interval).toBeLessThan(timingsOf(P(startRun(["holy"]), 0), "wand")!.interval);
    setHpFrac(w, 0, 0.35);
    updateMods(w);
    expect(P(w, 0).asMult).toBe(1000);
  },
};

/** A Plague p0 (Pestilence, or none) engaged with a Frost p1 at bow range, signatures on. */
function plagueRig(withCard: boolean): World {
  const w = startRun(["plague", "frost"], { signatures: true });
  P(w, 0).weapon0 = SIGNATURE_WEAPONS.plague; // the bow reaches the signature from 100 u; a run's fists (52 u) would not
  if (withCard) hold(w, 0, "pestilence");
  P(w, 1).x = P(w, 0).x + 100;
  P(w, 1).y = P(w, 0).y;
  return w;
}

for (const base of BASE_STAT_IDS) {
  for (const tier of CARD_TIERS) RIGS[baseCardId(base, tier)] = baseRig(base, tier);
}

/**
 * The 17 cards of the balance pass's phase B (crit, streaks, the on-hit pipeline, blocks, returned damage, the DoT extension, stillness,
 * Overkill, Gambler, Adrenaline, Wishful Thinking...): their machinery is in sim/cardHooks.ts, sim/onHit.ts and sim/cardState.ts and their
 * rigs are in cardHooks.test.ts, which runs the real fight each one changes. The 58 cards of phase A keep their rigs here.
 */
const PHASE_B: readonly CardId[] = [
  "festeringArcana", "rhythm", "overkill", "tankEngine", "pocketSand", "gambler", "adrenaline", "cruelWounds", "thirdTimesTheCharm",
  "eyeForAnEye", "bestOffense", "tunnelVision", "firstImpressions", "plantYourFeet", "wishfulThinking", "hemorrhage", "spikedShell",
];
const LIVE: CardId[] = CARDS.filter((c) => cardLive(c) && !PHASE_B.includes(c.id)).map((c) => c.id);

describe("every live card does what its text says", () => {
  it("has a rig for every phase-A card (the phase-B cards' rigs are cardHooks.test.ts's), and every card is live", () => {
    expect(Object.keys(RIGS).sort()).toEqual([...LIVE].sort());
    expect(LIVE).toHaveLength(58);
    expect(CARDS.filter((c) => cardLive(c))).toHaveLength(75);
    for (const id of PHASE_B) expect(cardLive(id), id).toBe(true);
  });
  for (const id of LIVE) it(`${id}: ${cardText(id)}`, () => RIGS[id]!());
});

describe("no card waits for a hook any more", () => {
  it("every card in the catalog is live, so a chest may roll any of them and the sim folds their rows", () => {
    expect(CARDS.filter((c) => !cardLive(c))).toEqual([]);
    for (const id of PHASE_B) {
      const w = startRun(["frost", "fire"]);
      hold(w, 0, id);
      expect(P(w, 0).build.get(id), id).toBe(1);
      expect(modRowsOf(P(w, 0)).length, id).toBeGreaterThan(0);
    }
  });

  it("but it counts toward card power: a card is a card", () => {
    const w = startRun(["frost", "fire"]);
    hold(w, 0, "overkill");
    expect(cardPower(P(w, 0).build)).toBe(2);
  });
});

describe("every augment and conditional is held once", () => {
  it("a second copy is refused and changes nothing", () => {
    for (const id of [...AUGMENT_IDS, "bloodthirst", "hearty"] as const) {
      if (!cardLive(id)) continue;
      const w = startRun(["frost", "fire"]);
      hold(w, 0, id);
      const before = JSON.stringify([...P(w, 0).build.entries()]);
      expect(grantCard(w, C(w, 0), id), id).toBeNull();
      expect(JSON.stringify([...P(w, 0).build.entries()]), id).toBe(before);
    }
  });
});

// -------------------------------------------------------------------------------------------------------- machinery

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

describe("granting a card", () => {
  it("patches a mirror only when its quantized value changes, and a player nothing modifies never patches one", () => {
    const w = startRun(["plague", "fire"]);
    const encoder = new Encoder(w.state);
    const decoder = connect(encoder);
    encoder.discardChanges();
    for (let i = 0; i < 10; i++) {
      step(w, TICK_MS);
      for (const f of MIRROR_FIELDS) expect(patched(encoder, decoder)).not.toContain(f);
    }
    hold(w, 0, "haste3");
    expect(patched(encoder, decoder)).toEqual(expect.arrayContaining(["asMult"]));
    // A card whose rows are read by the server alone (Iron Will's slow resistance) moves no mirror: the build map patches, the mirrors do not.
    hold(w, 0, "ironWill");
    const changed = patched(encoder, decoder);
    for (const f of MIRROR_FIELDS) expect(changed).not.toContain(f);
    expect(decoder.state.players.get("p0")!.build.get("ironWill")).toBe(1);
    expect(decoder.state.players.get("p0")!.build.get("haste3")).toBe(1);
    expect(decoder.state.players.get("p0")!.asMult).toBe(P(w, 0).asMult);
    // A base card held twice is a count of 2 on the wire.
    expect(grantCard(w, C(w, 0), "haste3")).toBe(2);
    expect(P(w, 0).build.get("haste3")).toBe(2);
    patched(encoder, decoder);
    expect(decoder.state.players.get("p0")!.build.get("haste3")).toBe(2);
    // Fleet's mirror moves when the shot window opens or closes, not every tick it holds.
    hold(w, 0, "fleet2");
    patched(encoder, decoder); // the decoder now holds the bonus
    RT(w, 0).weapon.lastShotAt = w.state.serverTime;
    updateMods(w);
    expect(patched(encoder, decoder)).toContain("speedMult");
    updateMods(w);
    updateMods(w);
    expect(patched(encoder, decoder)).not.toContain("speedMult");
  });

  it("leaves every mirror at the identity for a fighter with no cards", () => {
    const w = startRun(["plague", "fire"]);
    for (const f of MIRROR_FIELDS) expect(P(w, 1)[f], f).toBe(WIRE_IDENTITY_MIRRORS[f]);
  });
});

describe("lifesteal", () => {
  it("adds to Holy's own, which alone is unchanged, and the total stops at LIFESTEAL_MAX (0.85, G5 of the balance pass; was 100%)", () => {
    for (const [frac, copies] of [[0.5, 0], [0.5, 1], [0.5, 3], [0.1, 3]] as const) {
      const w = startRun(["holy", "frost"], { signatures: true });
      if (copies > 0) hold(w, 0, "leech3", copies);
      setHpFrac(w, 0, frac, 10_000);
      setHpFrac(w, 1, 0.9);
      const before = P(w, 0).hp;
      const landed = landOneHit(w, 0, 1, 400);
      const own = lifestealFraction(paced("holy"), frac);
      const share = lifestealShare(own, copies * quoted("leech3"));
      expect(P(w, 0).hp - before, `${frac} ${copies}`).toBeCloseTo(landed * share, 9);
      expect(share).toBeLessThanOrEqual(LIFESTEAL_MAX);
    }
    // Holy's own 0.75 at low hp plus the Leech cards' rows (held to LS_CAP) stay at the cap; the cap itself is the share's ceiling.
    expect(lifestealShare(0.75, 0.25)).toBe(LIFESTEAL_MAX);
    expect(lifestealShare(1, 0.25)).toBe(LIFESTEAL_MAX);
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

describe("Second Wind's heal over time", () => {
  it("spans 1.5 s (four steps 500 ms apart, the first at once), which is what its text says", () => {
    expect(healOverTimeSteps(2000)).toBe(4);
    expect(healOverTimeSpanMs(2000)).toBe(3 * HEAL_OVER_TIME_STEP_MS);
    expect(cardText("secondWind")).toContain("over 1.5 s");
    const w = startRun(["frost", "fire"], { signatures: true });
    hold(w, 0, "secondWind");
    setHpFrac(w, 0, 0.3);
    const max = P(w, 0).maxHp;
    hitFor(w, 1, "p0", 2000);
    const first = P(w, 0).hp;
    const t0 = w.state.serverTime;
    const seen: Array<[number, number]> = [];
    while (w.state.serverTime < t0 + 2000) {
      step(w, TICK_MS);
      seen.push([w.state.serverTime - t0, P(w, 0).hp]);
    }
    const at = (ms: number): number => seen.find(([t]) => t >= ms)![1];
    expect(at(450)).toBeCloseTo(first, 6);
    expect(at(500)).toBeCloseTo(first + 0.05 * max, 6);
    expect(at(1450)).toBeCloseTo(first + 0.10 * max, 6);
    expect(at(1500)).toBeCloseTo(first + 0.15 * max, 6);
    expect(at(2000)).toBeCloseTo(first + 0.15 * max, 6); // nothing after the last step: 1.5 s, not 2 s
  });

  it("a teleport drops the steps still to come", () => {
    const w = startRun(["frost", "fire"], { signatures: true });
    hold(w, 0, "secondWind");
    setHpFrac(w, 0, 0.3);
    hitFor(w, 1, "p0", 2000); // fires: a quarter at once, three steps to come
    step(w, TICK_MS);
    expect(RT(w, 0).hots?.length ?? 0).toBe(1);
    teleportToColiseum(w);
    expect(RT(w, 0).hots?.length ?? 0).toBe(0);
  });
});

describe("Pestilence widens a Plague owner's execute in the signature itself", () => {
  it("diseases harder between 50% and 60% and shows the execute there", () => {
    const run = (withCard: boolean): { lost: number; sig: number } => {
      const w = plagueRig(withCard);
      setHpFrac(w, 1, 0.55, 1e5);
      noteContact(w, "p0", "p1");
      const before = P(w, 1).hp;
      for (let i = 0; i < 10; i++) step(w, TICK_MS);
      return { lost: before - P(w, 1).hp, sig: P(w, 1).sig };
    };
    const plain = run(false);
    const pest = run(true);
    expect(plain.lost).toBeGreaterThan(0);
    expect(pest.lost).toBeGreaterThan(plain.lost);
    expect(plain.sig & SIG_EXECUTE).toBe(0);
    expect(pest.sig & SIG_EXECUTE).toBe(SIG_EXECUTE);
    // The shared formula: the same slope, from the wider band.
    const spec = paced("plague");
    expect(diseaseDps(spec, 0.55, 0.6) - diseaseDps(spec, 0.55)).toBeCloseTo(spec.params.execute! * 0.05, 9);
    expect(diseaseDps(spec, 0.3, 0.6) - diseaseDps(spec, 0.3)).toBeCloseTo(spec.params.execute! * 0.1, 9);
  });
});

describe("cards fold together", () => {
  it("a damage augment and a conditional's conversion add in the one damage sum", () => {
    const w = startRun(["fire", "frost"]);
    setHpFrac(w, 1, 0.9);
    hold(w, 0, "glassCannon");
    hold(w, 0, "momentum"); // fleet1: +6% move speed -> +6% damage
    expect(hitFor(w, 0, "p1", 100)).toBeCloseTo(expectedHit(w, 0, "p1", 100, 1 + 0.35 + 0.06), 9);
  });
});

describe("a Wish's damage stays flat with the damage cards held", () => {
  const TRUE = { phys: 0, magic: 0, true: 1 } as const;
  const DAMAGE_CARDS = ["glassCannon", "coupDeGrace", "witness", "pestilence"] as const;

  for (const faction of ["fire", "sentenced", "holy", "plague", "frost"] as const) {
    it(`${faction}: an ability dot entry is untouched while the weapon entry beside it gets the cards' damage and vs rows`, () => {
      const w = startRun([faction, "frost", "frost"], { signatures: true });
      for (const id of DAMAGE_CARDS) hold(w, 0, id);
      // Every vs row holds against both victims: below 30% hp (Coup de Grace, Pestilence), a lock on a third party (Witness).
      for (const i of [1, 2]) setHpFrac(w, i, 0.25);
      RT(w, 1).weapon.lock = "p2";
      RT(w, 2).weapon.lock = "p1";
      let rows = 1;
      for (const id of DAMAGE_CARDS) {
        for (const e of cardDef(id)!.byFaction?.[faction] ?? cardDef(id)!.effects) {
          if ((e.k === "stat" && e.stat === "damage") || e.k === "vs") rows += e.v;
        }
      }
      expect(rows, "the rig holds the damage and vs rows").toBeGreaterThan(1.5);
      const by = { id: "p0", name: P(w, 0).name };
      const before = { p1: P(w, 1).hp, p2: P(w, 2).hp };
      recordHit(w, { victim: "p1", by, packet: { raw: 100, ...TRUE }, weapon: null, ability: "blaze", dot: true, stagger: false });
      recordHit(w, { victim: "p2", by, packet: { raw: 100, ...TRUE }, weapon: "sword", stagger: false });
      applyLedger(w);
      expect(before.p1 - P(w, 1).hp).toBeCloseTo(100, 9);
      expect(before.p2 - P(w, 2).hp).toBeCloseTo(100 * rows, 9);
      // What the landed hit reports (kill credit, lifesteal) is flat too.
      expect(w.combat.landed.find((h) => h.victim === "p1")!.amount).toBeCloseTo(100, 9);
    });
  }
});

// ------------------------------------------------------------------------------------------------- the order-free pass

describe("the vs rows keep the ledger order-free", () => {
  type Hit = { by: string; victim: string; raw: number };

  function buildPass(): World {
    const w = startRun(["fire", "holy", "plague", "frost", "sentenced"], { signatures: true });
    hold(w, 0, "witness");
    hold(w, 0, "coupDeGrace");
    hold(w, 1, "pestilence");
    hold(w, 2, "pestilence"); // Plague: the execute band, no damage row
    hold(w, 3, "witness");
    hold(w, 4, "glassCannon");
    hold(w, 4, "coupDeGrace");
    const hp: Record<string, number> = { p0: 0.95, p1: 0.62, p2: 0.07, p3: 0.58, p4: 0.04 };
    for (const [id, frac] of Object.entries(hp)) {
      P(w, Number(id[1])).maxHp = 1e4;
      P(w, Number(id[1])).hp = 1e4 * frac;
    }
    P(w, 2).kills = 2;
    P(w, 4).kills = 1;
    RT(w, 3).mobKills = 2;
    // Fights: p1 locks p2, p3 locks p4, p2's last hit was on p0.
    RT(w, 1).weapon.lock = "p2";
    RT(w, 3).weapon.lock = "p4";
    noteContact(w, "p2", "p0");
    return w;
  }

  const HITS: Hit[] = [
    { by: "p0", victim: "p1", raw: 300 },
    { by: "p0", victim: "p2", raw: 900 },
    { by: "p1", victim: "p2", raw: 200 },
    { by: "p3", victim: "p1", raw: 150 },
    { by: "p4", victim: "p3", raw: 120 },
    { by: "p3", victim: "p4", raw: 700 },
    { by: "p4", victim: "p2", raw: 90 },
    { by: "p1", victim: "p3", raw: 40 },
    { by: "p2", victim: "p0", raw: 77 },
    { by: "p0", victim: "p4", raw: 400 },
  ];

  function record(w: World, h: Hit): LedgerEntry {
    const p = w.state.players.get(h.by)!;
    return recordHit(w, {
      victim: h.victim, by: { id: h.by, name: p.name }, packet: { raw: h.raw, ...damageShares(paced(p.faction as FactionId)) },
      weapon: "sword", stagger: false,
    });
  }

  const outcome = (w: World) => [...w.state.players].map(([id, p]) => [id, p.hp, p.status, p.kills] as const);

  it("any order the hits are recorded in gives the same result to the bit", () => {
    const base = buildPass();
    for (const h of HITS) record(base, h);
    base.stepping = true;
    applyLedger(base);
    base.stepping = false;
    const want = outcome(base);
    expect(want.some(([, , status]) => status === "dead")).toBe(true);
    const r = mulberry32(77);
    for (let trial = 0; trial < 25; trial++) {
      const w = buildPass();
      const list = [...HITS];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [list[i], list[j]] = [list[j]!, list[i]!];
      }
      for (const h of list) record(w, h);
      w.stepping = true;
      applyLedger(w);
      w.stepping = false;
      expect(outcome(w), `trial ${trial}`).toEqual(want);
    }
  });
});
