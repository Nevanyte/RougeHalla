// Regional mobs fight with their region's Phase 10 signature, at mob strength, and the Phase 11 seams into the signature
// layer hold: the evade rule (a returning mob has no target and takes/deals no signature damage), the teleport reset,
// regeneration through heal(), lifesteal on a mob that dies to a big hit, and the move-speed buff next to Frost's slow.
// Everything runs through the real step() loop and the real mob AI on a small open map; the only stand-ins are `aggro`
// (to wake a mob without a hit) and a few fixtures noted where they are used.
import { describe, expect, it } from "vitest";
import {
  backlashPerSwing, bonusMultiplier, buffRowsOf, burnDps, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, chillMultiplier, damagePerHit,
  damageShares, decodeMult, diseaseDps, DOT_FX_MS, encodeMult, FACTIONS, HEAL_LOCKOUT_SECONDS, lifestealFraction, mapFromTiles, markDps,
  ELITE_K, MOB_K, MOB_LEASH_RADIUS, MOB_REGEN_SECONDS, mitigateShares, mobFaction, mulberry32, pacedFaction, PLAYER_SPEED, SIG_BURNING,
  SIG_CHILLED, SIG_DISEASED, SIG_EXECUTE, TARGET_FORGET_SECONDS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type FactionId, type FactionSpec, type FxEvent, type GameMap, type SignatureKind, type WeaponId,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { grantBuff } from "../src/sim/buffs";
import { combatant } from "../src/sim/combatant";
import { signatureState, targetOf } from "../src/sim/factions";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { recordHit } from "../src/sim/ledger";
import { aggro } from "../src/sim/mobAI";
import { placeMob, type MobCombatant } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import { addPlayer, step } from "../src/sim/step";
import type { LandedHit, PlayerRuntime, SimConfig, SimEvent, World } from "../src/sim/world";

type Fx<K extends FxEvent["kind"]> = Extract<FxEvent, { kind: K }>;

const DT = TICK_MS / 1000;
const SIDE = 32;
const tile = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
/** The mob's camp spot, in the middle of an open 32 x 32 tile arena (leash 224 u, so it never meets a wall). */
const HOME = tile(16, 16);
/** A place beyond the leash from HOME, where a mob that is dragged there gives up. */
const FAR = { x: HOME.x + MOB_LEASH_RADIUS + 16, y: HOME.y };
/** Hp that no scenario can exhaust. */
const BIG_HP = 1e6;
const CONFIG: SimConfig = {
  minPlayers: 1, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9, suddenDeathSeconds: 1e9,
};

function openMap(): GameMap {
  const tiles = new Uint8Array(SIDE * SIDE).fill(TILE_FLOOR);
  for (let i = 0; i < SIDE; i++) {
    tiles[i] = tiles[(SIDE - 1) * SIDE + i] = TILE_WALL;
    tiles[i * SIDE] = tiles[i * SIDE + SIDE - 1] = TILE_WALL;
  }
  const map = mapFromTiles(SIDE, SIDE, tiles);
  map.spawns = [tile(3, 3), tile(5, 3), tile(7, 3), tile(9, 3)];
  return map;
}

/** The factions as the sim fights them: players paced, regional mobs scaled by MOB_K and then paced. */
const PLAYER_SPEC = Object.fromEntries(
  Object.keys(FACTIONS).map((id) => [id, pacedFaction(FACTIONS[id as FactionId])]),
) as Record<FactionId, FactionSpec>;
const MOB_SPEC = Object.fromEntries(
  Object.keys(FACTIONS).map((id) => [id, pacedFaction(mobFaction(id as FactionId, false))]),
) as Record<FactionId, FactionSpec>;
const ELITE_SPEC = Object.fromEntries(
  Object.keys(FACTIONS).map((id) => [id, pacedFaction(mobFaction(id as FactionId, true))]),
) as Record<FactionId, FactionSpec>;

/** What `raw` of a mob of `region`'s signature does to a player of faction `victim`: the mob's shares against its defense. */
const onPlayer = (region: FactionId, victim: FactionId, raw: number): number =>
  mitigateShares(raw, damageShares(MOB_SPEC[region]), PLAYER_SPEC[victim]);
/** ...and what `raw` of a player's signature does to a mob of `region`. */
const onMob = (owner: FactionId, region: FactionId, raw: number): number =>
  mitigateShares(raw, damageShares(PLAYER_SPEC[owner]), MOB_SPEC[region]);

interface Rig {
  world: World;
  p: PlayerState;
  prt: PlayerRuntime;
  faction: FactionId;
  mob: MobCombatant;
  /** Every event and every landed hit since the rig was made. */
  events: SimEvent[];
  landed: LandedHit[];
}

interface RigOptions {
  player: FactionId;
  /** In hand (slot 0): omitted keeps the faction's own weapon, null is an empty hand. */
  weapon?: WeaponId | null;
  weapon1?: WeaponId;
  /** Share of the player's hp; the player has BIG_HP unless `naturalHp` is set. */
  hpFrac?: number;
  naturalHp?: boolean;
  mob: FactionId;
  /** A mob's own hp is its natural one unless set: BIG_HP by default, so a fight never ends in a kill by accident. */
  mobHp?: number;
  mobMaxHp?: number;
  mobAt?: { x: number; y: number };
  playerAt?: { x: number; y: number };
  /** Face the player (a shield mob blocks only from the front). */
  mobFacing?: number;
  elite?: boolean;
}

function place(world: World, id: string, x: number, y: number): void {
  const s = world.state.players.get(id) ?? world.state.mobs.get(id)!;
  const rt = world.players.get(id) ?? world.mobs.get(id)!;
  s.x = x;
  s.y = y;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

function makeRig(o: RigOptions): Rig {
  const world = createGameWorld({ config: CONFIG, random: mulberry32(1), map: openMap() });
  addPlayer(world, "p", "P", { faction: o.player });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  const p = world.state.players.get("p")!;
  if (o.weapon !== undefined) p.weapon0 = o.weapon ?? "";
  p.weapon1 = o.weapon1 ?? "";
  if (!o.naturalHp) p.maxHp = BIG_HP;
  p.hp = p.maxHp * (o.hpFrac ?? 1);
  const at = o.playerAt ?? { x: HOME.x - 40, y: HOME.y };
  place(world, "p", at.x, at.y);
  const mobAt = o.mobAt ?? HOME;
  const id = placeMob(world, { region: o.mob, elite: o.elite ?? false, at: mobAt, facing: o.mobFacing ?? Math.atan2(at.y - mobAt.y, at.x - mobAt.x) });
  const mob = combatant(world, id) as MobCombatant;
  mob.s.maxHp = o.mobMaxHp ?? (o.mobHp === undefined ? BIG_HP : Math.max(o.mobHp, mob.s.maxHp));
  mob.s.hp = o.mobHp ?? mob.s.maxHp;
  return { world, p, prt: world.players.get("p")!, faction: o.player, mob, events: [], landed: [] };
}

/** A fighter's signature state after a tick (see sim/factions.ts SigFighter). */
interface SigSnap {
  target: string | null;
  engaged: boolean;
  inReach: boolean;
  markElapsed: number;
  combatAt: number;
  contactAt: number;
  chill: number;
}

interface TickLog {
  now: number;
  events: SimEvent[];
  landed: LandedHit[];
  mob: SigSnap;
  /** The player's own. */
  me: SigSnap;
  mode: string;
  mobHp: number;
  playerHp: number;
}

function snap(world: World, id: string): SigSnap {
  const sig = signatureState(world, id);
  return {
    target: sig?.target ?? null, engaged: sig?.engaged ?? false, inReach: sig?.inReach ?? false,
    markElapsed: sig?.markElapsed ?? 0, combatAt: sig?.combatAt ?? -Infinity, contactAt: sig?.contactAt ?? -Infinity,
    chill: sig?.chill ?? 1,
  };
}

function tick(rig: Rig): TickLog {
  const events = step(rig.world, TICK_MS);
  const landed = [...rig.world.combat.landed];
  rig.events.push(...events);
  rig.landed.push(...landed);
  return {
    now: rig.world.state.serverTime, events, landed,
    mob: snap(rig.world, rig.mob.id),
    me: snap(rig.world, "p"),
    mode: rig.mob.rt.brain?.mode ?? "dummy",
    mobHp: rig.mob.s.hp,
    playerHp: rig.p.hp,
  };
}

/** Steps `n` ticks; `before(i)` runs ahead of tick i (inputs, fixtures). */
function run(rig: Rig, n: number, before?: (i: number) => void): TickLog[] {
  const out: TickLog[] = [];
  for (let i = 0; i < n; i++) {
    before?.(i);
    out.push(tick(rig));
  }
  return out;
}

const send = (rig: Rig, type: string, msg: unknown): void => { enqueueClientMessage(rig.prt.inputs, type, msg); };
const angleToMob = (rig: Rig): number => Math.atan2(rig.mob.s.y - rig.p.y, rig.mob.s.x - rig.p.x);
/** The player presses the trigger toward the mob (or toward `a`) and keeps holding it. */
const hold = (rig: Rig, a: number = angleToMob(rig)): void => send(rig, "attack", { a });
/** Wakes the mob onto the player as a hit would (the mob's own AI takes it from there). */
const wake = (rig: Rig): void => aggro(rig.world, rig.mob, "p", 1);

const fxOf = <K extends FxEvent["kind"]>(events: readonly SimEvent[], kind: K): Array<Fx<K>> =>
  events.flatMap((e) => (e.type === "fx" && e.fx.kind === kind ? [e.fx as Fx<K>] : []));
const sigLanded = (landed: readonly LandedHit[], sig: SignatureKind): LandedHit[] => landed.filter((h) => h.sig === sig);
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const mobBurn = (log: TickLog, rig: Rig, sig: SignatureKind): LandedHit[] =>
  sigLanded(log.landed, sig).filter((h) => h.by === rig.mob.id && h.victim === "p");

/** Drags the mob to `at` (as if shoved there) and leaves it standing, its path forgotten. */
function pin(rig: Rig, at: { x: number; y: number }): void {
  place(rig.world, rig.mob.id, at.x, at.y);
}

// ---------------------------------------------------------------------------------------------------------------------

describe("a regional mob fights with its region's signature at mob strength", () => {
  describe("Fire", () => {
    // The player swings an axe (no stagger, so nothing pauses the mob's burn) at a Fire mob that fights back.
    const fight = (): { rig: Rig; logs: TickLog[] } => {
      const rig = makeRig({ player: "plague", weapon: "axe", mob: "fire" });
      hold(rig);
      return { rig, logs: run(rig, 80) };
    };

    it("burns the player it fights, burnDps of the scaled paced faction x the axe's multiplier, every engaged tick", () => {
      const { rig, logs } = fight();
      const expected = onPlayer("fire", "plague", burnDps(MOB_SPEC.fire) * bonusMultiplier("axe") * DT);
      expect(expected).toBeGreaterThan(0);
      let engaged = 0;
      for (const log of logs) {
        const burns = mobBurn(log, rig, "burn");
        if (!log.mob.engaged) {
          expect(burns, `tick ${log.now} not engaged`).toHaveLength(0);
          continue;
        }
        engaged++;
        expect(burns, `tick ${log.now}`).toHaveLength(1);
        expect(burns[0]).toMatchObject({ victim: "p", by: rig.mob.id, weapon: "axe", sig: "burn" });
        expect(burns[0]!.amount).toBeCloseTo(expected, 9);
      }
      expect(engaged).toBeGreaterThan(50);

      // Per second: the scaled paced burn times the weapon's multiplier, which is MOB_K of the full-strength Fire's.
      const perSecond = sum(rig.landed.filter((h) => h.sig === "burn").map((h) => h.amount)) / (engaged * DT);
      expect(perSecond).toBeCloseTo(burnDps(MOB_SPEC.fire) * bonusMultiplier("axe"), 6);
      expect(perSecond / (burnDps(PLAYER_SPEC.fire) * bonusMultiplier("axe"))).toBeCloseTo(MOB_K, 9);
    });

    it("reports the burn as sig \"burn\" hit fx by the mob's id, in DOT_FX_MS chunks, and marks the player burning", () => {
      const { rig, logs } = fight();
      const fx = rig.events.flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.sig === "burn" ? [e.fx] : []));
      expect(fx.length).toBeGreaterThanOrEqual(5);
      const perTick = onPlayer("fire", "plague", burnDps(MOB_SPEC.fire) * bonusMultiplier("axe") * DT);
      const chunkTicks = DOT_FX_MS / TICK_MS;
      // A chunk is a whole number of ticks of burn (the first one starts mid-window and may be short), at most DOT_FX_MS long.
      const ticksIn = fx.map((h) => h.amount / perTick);
      for (const [i, h] of fx.entries()) {
        expect(h).toMatchObject({ id: "p", by: rig.mob.id, weapon: "axe", sig: "burn" });
        expect(ticksIn[i]!).toBeCloseTo(Math.round(ticksIn[i]!), 6);
        expect(Math.round(ticksIn[i]!)).toBeLessThanOrEqual(chunkTicks);
      }
      expect(ticksIn.filter((n) => Math.round(n) === chunkTicks).length).toBeGreaterThanOrEqual(3);
      // What is not in a fx yet is less than one chunk.
      const landedTotal = sum(rig.landed.filter((h) => h.sig === "burn").map((h) => h.amount));
      expect(landedTotal - sum(fx.map((h) => h.amount))).toBeLessThan(chunkTicks * perTick + 1e-9);
      expect(logs.at(-1)!.mob.engaged).toBe(true);
      expect(rig.p.sig & SIG_BURNING).toBeTruthy();
    });

    it("answers each swing of the player with backlash, a sig \"backlash\" hit fx by the mob", () => {
      const { rig, logs } = fight();
      const expected = onPlayer("fire", "plague", backlashPerSwing(MOB_SPEC.fire.params.backlash!, PLAYER_SPEC.plague, "axe") * bonusMultiplier("axe"));
      const swings = logs.filter((l) => fxOf(l.events, "swing").some((s) => s.by === "p"));
      expect(swings.length).toBeGreaterThanOrEqual(3);
      for (const log of logs) {
        const mine = fxOf(log.events, "swing").filter((s) => s.by === "p").length;
        const backlash = fxOf(log.events, "hit").filter((h) => h.sig === "backlash");
        expect(backlash, `tick ${log.now}`).toHaveLength(mine);
        for (const h of backlash) {
          expect(h).toMatchObject({ id: "p", by: rig.mob.id, weapon: "axe" });
          expect(h.amount).toBeCloseTo(expected, 9);
        }
      }
      // Mob strength: the Fire mob's backlash param is MOB_K of the player-strength Fire's.
      expect(MOB_SPEC.fire.params.backlash! / PLAYER_SPEC.fire.params.backlash!).toBeCloseTo(MOB_K, 12);
    });

    it("an elite burns at ELITE_K strength", () => {
      const rig = makeRig({ player: "plague", weapon: "axe", mob: "fire", elite: true });
      hold(rig);
      const logs = run(rig, 60);
      const expected = mitigateShares(burnDps(ELITE_SPEC.fire) * bonusMultiplier("axe") * DT, damageShares(ELITE_SPEC.fire), PLAYER_SPEC.plague);
      const burns = logs.flatMap((l) => mobBurn(l, rig, "burn"));
      expect(burns.length).toBeGreaterThan(40);
      for (const h of burns) expect(h.amount).toBeCloseTo(expected, 9);
      expect(burnDps(ELITE_SPEC.fire) / burnDps(PLAYER_SPEC.fire)).toBeCloseTo(ELITE_K, 12);
      expect(expected / onPlayer("fire", "plague", burnDps(MOB_SPEC.fire) * bonusMultiplier("axe") * DT)).toBeCloseTo(ELITE_K / MOB_K, 9);
    });
  });

  describe("Plague", () => {
    // The mob's weapon is a bow, so the player stands where it likes to shoot from (between its back-off and attack range).
    const fight = (hpFrac: number): { rig: Rig; logs: TickLog[]; fracs: number[] } => {
      const rig = makeRig({ player: "holy", weapon: null, mob: "plague", hpFrac, playerAt: { x: HOME.x - 150, y: HOME.y } });
      wake(rig);
      const fracs: number[] = [];
      const logs = run(rig, 100, () => { fracs.push(rig.p.hp / rig.p.maxHp); });
      return { rig, logs, fracs };
    };
    const diseasePerTick = (hpFrac: number): number =>
      onPlayer("plague", "holy", diseaseDps(MOB_SPEC.plague, hpFrac) * bonusMultiplier("bow") * DT);

    it("diseases the player it fights: diseaseDps of the scaled paced faction at the player's hp share x the bow's multiplier", () => {
      const { rig, logs, fracs } = fight(1);
      let engaged = 0;
      logs.forEach((log, i) => {
        const hits = mobBurn(log, rig, "disease");
        if (!log.mob.engaged) {
          expect(hits, `tick ${log.now} not engaged`).toHaveLength(0);
          return;
        }
        engaged++;
        expect(hits, `tick ${log.now}`).toHaveLength(1);
        expect(hits[0]).toMatchObject({ victim: "p", by: rig.mob.id, weapon: "bow", sig: "disease" });
        expect(hits[0]!.amount).toBeCloseTo(diseasePerTick(fracs[i]!), 9);
      });
      expect(engaged).toBeGreaterThan(50);
      expect(sigLanded(rig.landed, "disease").length).toBe(engaged);
      // At mob strength: the plague param is MOB_K of the player-strength Plague's.
      expect(MOB_SPEC.plague.params.plague! / PLAYER_SPEC.plague.params.plague!).toBeCloseTo(MOB_K, 12);
      const fx = rig.events.flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.sig === "disease" ? [e.fx] : []));
      expect(fx.length).toBeGreaterThanOrEqual(5);
      for (const h of fx) expect(h).toMatchObject({ id: "p", by: rig.mob.id, weapon: "bow", sig: "disease" });
      expect(rig.p.sig & SIG_DISEASED).toBeTruthy();
      expect(rig.p.sig & SIG_EXECUTE).toBeFalsy();
    });

    it("executes below half hp: the disease rises as the player falls under 50%", () => {
      // A mob's execute is scaled by k squared (mobFaction, balance contract 6.1), so the rise is a fraction of a player-sized
      // Plague's: measured at 10% hp, where it is clearest.
      const healthy = fight(1);
      const hurt = fight(0.1);
      const perTick = (f: ReturnType<typeof fight>): number[] =>
        f.logs.flatMap((l, i) => (l.mob.engaged ? [sum(mobBurn(l, f.rig, "disease").map((h) => h.amount)) / diseasePerTick(f.fracs[i]!)] : []));
      // Every engaged tick of the hurt player matches the formula at its hp share (exactly one disease hit per tick).
      for (const ratio of perTick(hurt)) expect(ratio).toBeCloseTo(1, 9);
      const mean = (f: ReturnType<typeof fight>): number => {
        const hits = sigLanded(f.rig.landed, "disease");
        return sum(hits.map((h) => h.amount)) / hits.length;
      };
      const expectedRise = diseaseDps(MOB_SPEC.plague, 0.1) / diseaseDps(MOB_SPEC.plague, 1);
      expect(expectedRise).toBeGreaterThan(1.5);
      expect(mean(hurt) / mean(healthy)).toBeGreaterThan(expectedRise * 0.99);
      expect(mean(hurt) / mean(healthy)).toBeLessThan(expectedRise * 1.01);
      expect(hurt.rig.p.sig & SIG_EXECUTE).toBeTruthy();
      expect(hurt.rig.p.sig & SIG_DISEASED).toBeTruthy();
    });
  });

  describe("Sentenced", () => {
    // A Sentenced mob swings a sword. The player holds two weapons so that it can swap.
    const fight = (): Rig => {
      const rig = makeRig({ player: "plague", weapon: "bow", weapon1: "axe", mob: "sentenced" });
      wake(rig);
      return rig;
    };
    const markPerTick = (elapsed: number): number =>
      onPlayer("sentenced", "plague", markDps(MOB_SPEC.sentenced, elapsed) * bonusMultiplier("sword") * DT);

    it("marks the player it fights: the mark ramps with the time engaged in reach, markDps of the scaled paced faction", () => {
      const rig = fight();
      const elapsed: number[] = [];
      const logs = run(rig, 80, () => { elapsed.push(signatureState(rig.world, rig.mob.id)?.markElapsed ?? 0); });
      const marks = logs.map((l) => mobBurn(l, rig, "mark"));
      let ramped = 0;
      marks.forEach((hits, i) => {
        const want = markPerTick(elapsed[i]!);
        if (want <= 0) {
          expect(hits, `tick ${logs[i]!.now}`).toHaveLength(0);
          return;
        }
        ramped++;
        expect(hits, `tick ${logs[i]!.now}`).toHaveLength(1);
        expect(hits[0]).toMatchObject({ victim: "p", by: rig.mob.id, weapon: "sword", sig: "mark" });
        expect(hits[0]!.amount).toBeCloseTo(want, 9);
      });
      expect(ramped).toBeGreaterThan(50);
      // It does ramp: the last tick's mark is several times the first's, and the brand is on the player.
      const amounts = marks.flat().map((h) => h.amount);
      expect(amounts.at(-1)! / amounts[0]!).toBeGreaterThan(5);
      expect(rig.p.brand).toBeGreaterThan(0);
      // Mob strength: the ramp is MOB_K of the player-strength Sentenced's (both paced alike).
      expect(MOB_SPEC.sentenced.params.mark_ramp! / PLAYER_SPEC.sentenced.params.mark_ramp!).toBeCloseTo(MOB_K, 12);
    });

    it("starts the mark over when the player swaps weapons", () => {
      const rig = fight();
      run(rig, 50);
      const before = signatureState(rig.world, rig.mob.id)!.markElapsed;
      expect(before).toBeGreaterThan(1);
      const loud = markPerTick(before);
      send(rig, "swap", { slot: 1 });
      const [swap, next] = run(rig, 2);
      expect(rig.p.slot).toBe(1);
      // The swap tick marks nothing (the clock is at 0 when the damage is worked out) and the clock restarts from there.
      expect(mobBurn(swap!, rig, "mark")).toHaveLength(0);
      expect(swap!.mob.markElapsed).toBeCloseTo(DT, 9);
      expect(mobBurn(next!, rig, "mark")[0]!.amount).toBeCloseTo(markPerTick(DT), 9);
      expect(markPerTick(DT)).toBeLessThan(loud / 10);
    });
  });

  describe("Frost", () => {
    // The player swings a sword at a Frost mob (its shield blocks and ripostes) and the mob bashes back.
    const fight = (withMob: boolean): { rig: Rig; windups: number[]; logs: TickLog[] } => {
      const rig = makeRig({
        player: "plague", weapon: "sword", mob: "frost", mobAt: withMob ? HOME : tile(28, 28), mobFacing: Math.PI,
      });
      if (withMob) wake(rig);
      hold(rig, 0);
      const logs = run(rig, 140);
      const windups = logs.filter((l) => fxOf(l.events, "windup").some((w) => w.by === "p")).map((l) => l.now);
      return { rig, windups, logs };
    };
    const meanGap = (times: readonly number[]): number => (times.at(-1)! - times[0]!) / (times.length - 1) / 1000;

    it("chills the player it fights: the cooldown runs at chillMultiplier of real time and the chill is synced", () => {
      const chilled = fight(true);
      const free = fight(false);
      // The slow is not a damage number, so a mob's chill is the full-strength one.
      const slow = chillMultiplier(MOB_SPEC.frost);
      expect(slow).toBeCloseTo(0.4, 12);
      expect(slow).toBe(chillMultiplier(PLAYER_SPEC.frost));
      const sig = signatureState(chilled.rig.world, "p")!;
      expect(sig.chill).toBeCloseTo(slow, 12);
      expect(sig.chillers).toEqual([chilled.rig.mob.id]);
      expect(chilled.rig.p.sig & SIG_CHILLED).toBeTruthy();
      expect(signatureState(free.rig.world, "p")?.chill ?? 1).toBe(1);
      // Swings after the chill took hold: one every interval / 0.4 instead of every interval.
      const late = (w: readonly number[]): number[] => w.filter((t) => t >= 1500);
      expect(late(chilled.windups).length).toBeGreaterThanOrEqual(6);
      const gapFree = meanGap(late(free.windups));
      const gapChilled = meanGap(late(chilled.windups));
      expect(gapFree).toBeGreaterThan(0.24);
      expect(gapFree).toBeLessThan(0.27);
      expect(gapChilled / gapFree).toBeGreaterThan(2.3);
      expect(gapChilled / gapFree).toBeLessThan(2.7);
    });
  });

  describe("Holy", () => {
    // A Holy mob casts a wand; the player stands where it likes to cast from.
    const fight = (mobHp: number): { rig: Rig; log: TickLog; before: number } => {
      const rig = makeRig({
        player: "holy", weapon: null, naturalHp: true, mob: "holy", mobMaxHp: 1000, mobHp, playerAt: { x: HOME.x - 140, y: HOME.y },
      });
      wake(rig);
      for (let i = 0; i < 100; i++) {
        const before = rig.mob.s.hp;
        const log = tick(rig);
        if (log.landed.some((h) => h.by === rig.mob.id && h.weapon === "wand")) return { rig, log, before };
      }
      throw new Error("the mob never hit");
    };

    it("lifesteals: its hp rises by what it hurts the player for x lifestealFraction at its hp share, with a heal fx", () => {
      const { rig, log, before } = fight(500);
      const dealt = sum(log.landed.filter((h) => h.by === rig.mob.id).map((h) => h.amount));
      expect(dealt).toBeGreaterThan(0);
      const gain = dealt * lifestealFraction(MOB_SPEC.holy, 0.5);
      expect(gain).toBeGreaterThan(0);
      expect(rig.mob.s.hp - before).toBeCloseTo(gain, 9);
      expect(fxOf(log.events, "heal")).toEqual([{ kind: "heal", id: rig.mob.id, amount: expect.closeTo(gain, 9) }]);
    });

    it("never heals past its max hp", () => {
      const { rig, log } = fight(998);
      expect(rig.mob.s.hp).toBe(1000);
      expect(fxOf(log.events, "heal")).toEqual([{ kind: "heal", id: rig.mob.id, amount: expect.closeTo(2, 9) }]);
    });
  });
});

describe("a player's signature works on a mob like on a player", () => {
  it("a Fire player burns a mob in contact: its hp falls by the burn, and the landed entries and fx carry the sig", () => {
    const rig = makeRig({ player: "fire", weapon: "axe", mob: "frost" });
    hold(rig);
    const hpBefore: number[] = [];
    const logs = run(rig, 80, () => { hpBefore.push(rig.mob.s.hp); });
    const burn = onMob("fire", "frost", burnDps(PLAYER_SPEC.fire) * bonusMultiplier("axe") * DT);
    expect(burn).toBeGreaterThan(0);
    let engaged = 0;
    logs.forEach((log, i) => {
      const hits = log.landed.filter((h) => h.victim === rig.mob.id);
      const burns = hits.filter((h) => h.sig === "burn");
      if (!log.me.engaged) {
        expect(burns, `tick ${log.now}`).toHaveLength(0);
        return;
      }
      engaged++;
      expect(burns, `tick ${log.now}`).toHaveLength(1);
      expect(burns[0]).toMatchObject({ by: "p", victim: rig.mob.id, weapon: "axe", sig: "burn" });
      expect(burns[0]!.amount).toBeCloseTo(burn, 9);
      // Whatever landed on the mob this tick (a swing, the burn) is exactly what its hp lost.
      expect(hpBefore[i]! - log.mobHp).toBeCloseTo(sum(hits.map((h) => h.amount)), 6);
      if (hits.length === 1) expect(hpBefore[i]! - log.mobHp).toBeCloseTo(burn, 9);
    });
    expect(engaged).toBeGreaterThan(50);
    const fx = rig.events.flatMap((e) => (e.type === "fx" && e.fx.kind === "hit" && e.fx.sig === "burn" ? [e.fx] : []));
    expect(fx.length).toBeGreaterThanOrEqual(5);
    for (const h of fx) expect(h).toMatchObject({ id: rig.mob.id, by: "p", weapon: "axe", sig: "burn" });
    expect(rig.mob.s.sig & SIG_BURNING).toBeTruthy();
  });

  it("a Plague player diseases a mob and executes it below half hp", () => {
    // The mob is at 40% of a huge max hp; the execute reads the mob's hp share at the start of each tick.
    const rig = makeRig({ player: "plague", weapon: "axe", mob: "fire", mobMaxHp: BIG_HP, mobHp: 0.4 * BIG_HP });
    hold(rig);
    const fracs: number[] = [];
    const logs = run(rig, 80, () => { fracs.push(rig.mob.s.hp / rig.mob.s.maxHp); });
    let engaged = 0;
    logs.forEach((log, i) => {
      const diseases = log.landed.filter((h) => h.victim === rig.mob.id && h.sig === "disease");
      if (!log.me.engaged) {
        expect(diseases, `tick ${log.now}`).toHaveLength(0);
        return;
      }
      engaged++;
      expect(diseases, `tick ${log.now}`).toHaveLength(1);
      expect(diseases[0]).toMatchObject({ by: "p", weapon: "axe", sig: "disease" });
      expect(diseases[0]!.amount).toBeCloseTo(onMob("plague", "fire", diseaseDps(PLAYER_SPEC.plague, fracs[i]!) * bonusMultiplier("axe") * DT), 9);
    });
    expect(engaged).toBeGreaterThan(50);
    // The execute part is in: well above what the plain disease would be at full hp.
    const first = rig.landed.find((h) => h.sig === "disease")!;
    expect(first.amount).toBeGreaterThan(5 * onMob("plague", "fire", diseaseDps(PLAYER_SPEC.plague, 1) * bonusMultiplier("axe") * DT));
    expect(rig.mob.s.sig & SIG_DISEASED).toBeTruthy();
    expect(rig.mob.s.sig & SIG_EXECUTE).toBeTruthy();
  });

  it("a Sentenced player marks a mob: the mark ramps with the time in reach and the brand is on the mob", () => {
    const rig = makeRig({ player: "sentenced", weapon: "sword", mob: "fire" });
    hold(rig);
    const elapsed: number[] = [];
    const logs = run(rig, 80, () => { elapsed.push(signatureState(rig.world, "p")?.markElapsed ?? 0); });
    let marked = 0;
    logs.forEach((log, i) => {
      const marks = log.landed.filter((h) => h.victim === rig.mob.id && h.sig === "mark");
      const want = onMob("sentenced", "fire", markDps(PLAYER_SPEC.sentenced, elapsed[i]!) * bonusMultiplier("sword") * DT);
      if (!(want > 0)) {
        expect(marks, `tick ${log.now}`).toHaveLength(0);
        return;
      }
      marked++;
      expect(marks, `tick ${log.now}`).toHaveLength(1);
      expect(marks[0]).toMatchObject({ by: "p", weapon: "sword", sig: "mark" });
      expect(marks[0]!.amount).toBeCloseTo(want, 9);
    });
    expect(marked).toBeGreaterThan(50);
    expect(rig.mob.s.brand).toBeGreaterThan(0);
    expect(rig.p.brand).toBe(0);
  });
});

describe("evade: a mob walking home has no signature target and trades no signature damage", () => {
  /**
   * The mob fights the player for 2 s near its camp, then the pair is dragged FAR from the camp (the player the same
   * distance from the mob as before). A mob beyond MOB_LEASH_RADIUS gives up at its next think, lets go of the trigger and
   * walks home ("return"): the real AI. The control moves the camp along instead, so it stays a fight. Either way the mob
   * is pinned where it stands every tick, so the player keeps standing in reach and keeps swinging.
   */
  function dragged(o: RigOptions, giveUp: boolean): { rig: Rig; before: TickLog[]; after: TickLog[] } {
    const rig = makeRig(o);
    hold(rig);
    wake(rig);
    const before = run(rig, 40);
    const offset = { x: rig.p.x - rig.mob.s.x, y: rig.p.y - rig.mob.s.y };
    if (!giveUp) rig.mob.rt.brain!.home = { x: FAR.x, y: FAR.y };
    place(rig.world, "p", FAR.x + offset.x, FAR.y + offset.y);
    const after = run(rig, 40, () => pin(rig, FAR));
    return { rig, before, after };
  }
  const swingsOf = (logs: readonly TickLog[]): number =>
    sum(logs.map((l) => fxOf(l.events, "swing").filter((s) => s.by === "p").length));

  describe("Fire", () => {
    const setup: RigOptions = { player: "plague", weapon: "axe", mob: "fire" };

    it("a Fire mob that gives up drops its target at once and burns nobody, however long the player stands in reach", () => {
      const { rig, before, after } = dragged(setup, true);
      expect(before.filter((l) => mobBurn(l, rig, "burn").length > 0).length).toBeGreaterThan(20);
      expect(after[0]!.mode).toBe("return");
      expect(rig.mob.rt.brain!.holding).toBe(false);
      const rest = after.slice(1);
      for (const log of rest) {
        expect(log.mode, `tick ${log.now}`).toBe("return");
        expect(log.mob.target, `tick ${log.now}`).toBeNull();
        expect(log.mob.engaged, `tick ${log.now}`).toBe(false);
        expect(log.landed.filter((h) => h.by === rig.mob.id && h.sig), `tick ${log.now}`).toHaveLength(0);
        // Nothing lands on it either: not the player's swings, not the player's own signature.
        expect(log.landed.filter((h) => h.victim === rig.mob.id), `tick ${log.now}`).toHaveLength(0);
        expect(log.mobHp, `tick ${log.now}`).toBe(after[0]!.mobHp);
      }
      // The player stood in reach (the mob is 40 u away, the axe reaches 72) and kept swinging at it...
      expect(rest.every((l) => Math.hypot(rig.mob.s.x - rig.p.x, rig.mob.s.y - rig.p.y) <= 72)).toBe(true);
      expect(swingsOf(rest)).toBeGreaterThanOrEqual(3);
      // ...and once the mob's last swing is over, the player's hp stops falling for good.
      const settled = after.slice(10);
      expect(new Set(settled.map((l) => l.playerHp)).size).toBe(1);
      expect(rig.p.sig & SIG_BURNING).toBeFalsy();
      expect(rig.p.sig & SIG_CHILLED).toBeFalsy();
    });

    it("the same pair with the camp moved along keeps burning (so the geometry did reach)", () => {
      const { rig, after } = dragged(setup, false);
      for (const log of after) {
        expect(log.mode, `tick ${log.now}`).toBe("fight");
        expect(log.mob.target).toBe("p");
        expect(log.mob.engaged).toBe(true);
        expect(mobBurn(log, rig, "burn"), `tick ${log.now}`).toHaveLength(1);
      }
      expect(rig.p.sig & SIG_BURNING).toBeTruthy();
      expect(after.at(-1)!.mobHp).toBeLessThan(after[0]!.mobHp);
    });
  });

  describe("Plague", () => {
    // The mob shoots from 150 u; the player answers with wand balls (range 220), so both stay in reach of each other.
    const setup: RigOptions = { player: "holy", weapon: "wand", mob: "plague", playerAt: { x: HOME.x - 150, y: HOME.y } };

    it("a Plague mob that gives up drops its target and diseases nobody while the player keeps hitting it from reach", () => {
      const { rig, before, after } = dragged(setup, true);
      expect(before.filter((l) => mobBurn(l, rig, "disease").length > 0).length).toBeGreaterThan(10);
      expect(after[0]!.mode).toBe("return");
      const rest = after.slice(1);
      for (const log of rest) {
        expect(log.mode, `tick ${log.now}`).toBe("return");
        expect(log.mob.target, `tick ${log.now}`).toBeNull();
        expect(log.mob.engaged, `tick ${log.now}`).toBe(false);
        expect(log.landed.filter((h) => h.by === rig.mob.id && h.sig), `tick ${log.now}`).toHaveLength(0);
        expect(log.landed.filter((h) => h.victim === rig.mob.id), `tick ${log.now}`).toHaveLength(0);
      }
      // The player's balls kept flying at it (each one is a hit the evading mob shrugs off).
      expect(rest.filter((l) => fxOf(l.events, "windup").some((w) => w.by === "p")).length).toBeGreaterThanOrEqual(3);
      expect(rig.mob.s.hp).toBe(after[0]!.mobHp);
      expect(rig.p.sig & SIG_DISEASED).toBeFalsy();
      expect(rig.p.sig & SIG_EXECUTE).toBeFalsy();
    });

    it("the same pair with the camp moved along keeps diseasing", () => {
      const { rig, after } = dragged(setup, false);
      for (const log of after) {
        expect(log.mode, `tick ${log.now}`).toBe("fight");
        expect(log.mob.target).toBe("p");
        expect(mobBurn(log, rig, "disease"), `tick ${log.now}`).toHaveLength(1);
      }
      expect(rig.p.sig & SIG_DISEASED).toBeTruthy();
    });
  });
});

describe("an idle mob", () => {
  it("stops burning a bystander once the trade window is over, and forgets its target after TARGET_FORGET_SECONDS", () => {
    // A Holy player has no damage over time of its own, which would keep waking the mob (a DoT tick hurts it like a hit).
    const rig = makeRig({ player: "holy", weapon: "axe", mob: "fire" });
    hold(rig);
    run(rig, 40);
    expect(signatureState(rig.world, rig.mob.id)!.engaged).toBe(true);
    // The player lets go and its last swing lands; then the fight is over for the mob too: idle, hands empty.
    send(rig, "release", { a: 0 });
    for (let i = 0; i < 30 && rig.prt.weapon.action !== null; i++) tick(rig);
    expect(rig.prt.weapon.action).toBeNull();
    const brain = rig.mob.rt.brain!;
    brain.mode = "idle";
    brain.target = null;
    brain.threat.clear();
    brain.holding = false;
    rig.mob.rt.inputs.drain();
    rig.mob.rt.weapon.held = false;
    rig.mob.rt.weapon.bufferedUntil = 0;

    const logs = run(rig, 260);
    expect(logs.every((l) => l.mode === "idle")).toBe(true);
    // The last contact between the pair is the last tick a hit landed between them (the mob may still finish a swing).
    const lastContact = Math.max(...logs.map((l) => l.mob.contactAt));
    expect(lastContact).toBeGreaterThan(0);
    const burnTicks = logs.filter((l) => mobBurn(l, rig, "burn").length > 0).map((l) => l.now);
    // It does burn on the strength of that last contact for a while...
    expect(burnTicks.some((t) => t > lastContact)).toBe(true);
    // ...but not past the 3 s trade window (the pair's cadences are all shorter), though the player never left its reach.
    expect(Math.max(...burnTicks)).toBeLessThanOrEqual(lastContact + 3000);
    for (const log of logs.filter((l) => l.now > lastContact + 3000)) {
      expect(log.mob.engaged, `tick ${log.now}`).toBe(false);
      expect(log.mob.inReach || log.now >= lastContact + TARGET_FORGET_SECONDS * 1000, `tick ${log.now}`).toBe(true);
    }
    // The target is held until TARGET_FORGET_SECONDS after that contact, and gone from that very tick.
    const forgetAt = lastContact + TARGET_FORGET_SECONDS * 1000;
    expect(logs.find((l) => l.now === forgetAt - TICK_MS)!.mob.target).toBe("p");
    expect(logs.find((l) => l.now === forgetAt)!.mob.target).toBeNull();
    expect(logs.at(-1)!.now).toBeGreaterThan(forgetAt + 1000);
    // From then on the bystander is left alone.
    const after = logs.filter((l) => l.now >= forgetAt);
    expect(after.every((l) => l.mob.target === null && l.landed.length === 0 && l.playerHp === after[0]!.playerHp)).toBe(true);
    expect(rig.p.sig & SIG_BURNING).toBeFalsy();
  });
});

// The fights below use a Holy player: it has no damage over time, so (unlike a Plague's execute) nothing kills a hurt mob.
describe("the coliseum teleport", () => {
  it("puts living mobs back on their camp spot at full hp, idle, with no signature target", () => {
    const rig = makeRig({ player: "holy", weapon: "axe", mob: "fire", mobMaxHp: 1000, mobHp: 600 });
    const { world } = rig;
    // A second mob, far away and hurt, that nobody fights.
    const holyAt = tile(6, 26);
    const holy = combatant(world, placeMob(world, { region: "holy", elite: false, at: holyAt })) as MobCombatant;
    holy.s.maxHp = 450;
    holy.s.hp = 120;
    holy.rt.lastHitAt = world.state.serverTime;
    hold(rig);
    wake(rig);
    run(rig, 20);
    // Drag the fight 100 u from the camp (inside the leash), so the mob is hurt, engaged and away from home.
    const offset = { x: rig.p.x - rig.mob.s.x, y: rig.p.y - rig.mob.s.y };
    pin(rig, { x: HOME.x + 100, y: HOME.y });
    place(world, "p", HOME.x + 100 + offset.x, HOME.y + offset.y);
    run(rig, 20);
    expect(rig.mob.s.hp).toBeLessThan(600);
    expect(rig.mob.s.hp).toBeGreaterThan(0);
    expect(rig.mob.rt.brain!.mode).toBe("fight");
    expect(signatureState(world, rig.mob.id)!.target).toBe("p");
    expect(signatureState(world, rig.mob.id)!.engaged).toBe(true);
    expect(targetOf(world, "p")).toBe(rig.mob.id);

    // The patience runs out: the real teleport at the end of the next tick.
    world.state.patienceEndsAt = world.state.serverTime + TICK_MS;
    const log = tick(rig);
    expect(world.state.inColiseum).toBe(true);
    expect(fxOf(log.events, "teleport")).toHaveLength(1);

    for (const mob of [rig.mob, holy]) {
      const brain = mob.rt.brain!;
      expect(mob.s.status, mob.id).toBe("alive");
      expect({ x: mob.s.x, y: mob.s.y }, mob.id).toEqual(brain.home);
      expect(mob.s.hp, mob.id).toBe(mob.s.maxHp);
      expect(brain.mode, mob.id).toBe("idle");
      expect(brain.target, mob.id).toBeNull();
      expect(brain.threat.size, mob.id).toBe(0);
      expect(mob.rt.path, mob.id).toEqual([]);
      expect(mob.rt.weapon.held, mob.id).toBe(false);
      expect(mob.rt.weapon.action, mob.id).toBeNull();
      expect(targetOf(world, mob.id), mob.id).toBeNull();
    }
    expect({ x: rig.mob.s.x, y: rig.mob.s.y }).toEqual(HOME);
    expect(targetOf(world, "p")).toBeNull();

    // Nothing carries over into the coliseum: no target, no sig bits, no burn, however long the player swings.
    for (const next of run(rig, 30)) {
      expect(next.mode).toBe("idle");
      expect(next.mob.target).toBeNull();
      expect(next.me.target).toBeNull();
      expect(next.landed.filter((h) => h.by === rig.mob.id || h.victim === rig.mob.id)).toHaveLength(0);
    }
    expect(rig.p.sig).toBe(0);
    expect(rig.p.brand).toBe(0);
    expect(rig.mob.s.sig).toBe(0);
    expect(rig.mob.s.hp).toBe(rig.mob.s.maxHp);
  });
});

describe("a mob's regeneration goes through heal()", () => {
  /** Ticks of the hp gaining and its size, from the first tick whose hp is above the one before it. */
  const regen = (logs: readonly TickLog[], from: number): { at: number; gain: number } | null => {
    for (let i = 1; i < logs.length; i++) {
      if (logs[i]!.now >= from && logs[i]!.mobHp > logs[i - 1]!.mobHp) return { at: logs[i]!.now, gain: logs[i]!.mobHp - logs[i - 1]!.mobHp };
    }
    return null;
  };

  it("a returning mob heals only HEAL_LOCKOUT_SECONDS after it last dealt or took damage, without heal fx, and is whole at home", () => {
    const rig = makeRig({ player: "holy", weapon: "axe", mob: "fire", mobMaxHp: 1000, mobHp: 600 });
    hold(rig);
    wake(rig);
    const fight = run(rig, 40);
    const offset = { x: rig.p.x - rig.mob.s.x, y: rig.p.y - rig.mob.s.y };
    place(rig.world, "p", FAR.x + offset.x, FAR.y + offset.y);
    // Pinned beyond the leash, the mob gives up and stays "return" for a long while; the player keeps swinging at it.
    const away = run(rig, 140, () => pin(rig, FAR));
    expect(away[0]!.mode).toBe("return");
    expect(away.every((l) => l.mode === "return")).toBe(true);
    const all = [...fight, ...away];

    // The clock starts at the last tick the mob dealt or took damage (it may finish a swing after giving up).
    const lastCombat = Math.max(...all.filter((l) => l.landed.some((h) => h.by === rig.mob.id || h.victim === rig.mob.id)).map((l) => l.now));
    // It dealt its last burn in the very tick it gave up.
    expect(lastCombat).toBeGreaterThanOrEqual(away[0]!.now);
    expect(away.at(-1)!.now).toBeGreaterThan(lastCombat + HEAL_LOCKOUT_SECONDS * 1000 + 1000);
    const hurt = away[0]!.mobHp;
    expect(hurt).toBeLessThan(1000);
    expect(hurt).toBeGreaterThan(0);

    // Not a point of hp until the lockout is over, though it is untouchable and walking home, then exactly maxHp / MOB_REGEN_SECONDS a second.
    const healsAt = lastCombat + HEAL_LOCKOUT_SECONDS * 1000;
    for (const log of away.filter((l) => l.now < healsAt && l.now >= away[0]!.now)) expect(log.mobHp, `tick ${log.now}`).toBe(hurt);
    const first = regen(away, 0)!;
    expect(first.at).toBe(healsAt);
    expect(first.gain).toBeCloseTo((1000 * DT) / MOB_REGEN_SECONDS, 9);
    const healing = away.filter((l) => l.now >= healsAt && l.mobHp < 1000);
    expect(healing.length).toBeGreaterThan(10);
    // The player's swings at the returning mob (which land nothing) did not restart the lockout.
    expect(away.filter((l) => l.now > healsAt).every((l) => l.landed.every((h) => h.victim !== rig.mob.id))).toBe(true);
    // It heals quietly: not one heal fx for it, the whole way.
    expect(fxOf(rig.events, "heal").filter((h) => h.id === rig.mob.id)).toHaveLength(0);
    expect(away.at(-1)!.mobHp).toBe(1000);

    // Let go of it: it walks the camp and arrives whole.
    const walk = run(rig, 80);
    expect(rig.mob.rt.brain!.mode).toBe("idle");
    expect({ x: rig.mob.s.x, y: rig.mob.s.y }).toEqual(HOME);
    expect(rig.mob.s.hp).toBe(1000);
    expect(walk.at(-1)!.mobHp).toBe(1000);
  });

  it("a returning mob that reaches its camp inside the lockout is whole on arrival all the same", () => {
    const rig = makeRig({ player: "holy", weapon: "axe", mob: "fire", mobMaxHp: 1000, mobHp: 600 });
    hold(rig);
    wake(rig);
    const fight = run(rig, 40);
    const offset = { x: rig.p.x - rig.mob.s.x, y: rig.p.y - rig.mob.s.y };
    // Just past the leash, once: a walk home of a second and a half, with the player letting go.
    const edge = { x: HOME.x + MOB_LEASH_RADIUS + 10, y: HOME.y };
    pin(rig, edge);
    place(rig.world, "p", edge.x + offset.x, edge.y + offset.y);
    send(rig, "release", { a: 0 });
    const walk = run(rig, 100);
    const home = walk.findIndex((l) => l.mode === "idle");
    expect(home).toBeGreaterThan(20);
    const lastCombat = Math.max(...[...fight, ...walk].filter((l) => l.landed.some((h) => h.by === rig.mob.id || h.victim === rig.mob.id)).map((l) => l.now));
    // It arrived before the lockout was over, so it did not heal on the way: hurt all the way, then whole at the camp.
    expect(walk[home]!.now - lastCombat).toBeLessThan(HEAL_LOCKOUT_SECONDS * 1000);
    const hurt = walk[0]!.mobHp;
    expect(hurt).toBeLessThan(1000);
    for (const log of walk.slice(0, home)) expect(log.mobHp, `tick ${log.now}`).toBe(hurt);
    expect(walk[home]!.mobHp).toBe(1000);
    expect({ x: rig.mob.s.x, y: rig.mob.s.y }).toEqual(HOME);
  });

  it("an idle mob left hurt (nobody to wake it) heals only 3 s after it was last hurt, without heal fx", () => {
    const rig = makeRig({ player: "plague", weapon: null, mob: "sentenced", mobMaxHp: 1000, mobHp: 1000, playerAt: tile(4, 4) });
    // One hit from someone who is not in the room (so it wakes nobody), dealt inside a tick like any other.
    let fired = false;
    rig.world.afterWeapons.unshift(() => {
      if (fired) return;
      fired = true;
      recordHit(rig.world, {
        victim: rig.mob.id, by: { id: "ghost", name: "Ghost" }, packet: { raw: 500, phys: 0, magic: 0, true: 1 }, weapon: "bow", stagger: false,
      });
    });
    const logs = run(rig, 120);
    const hitAt = logs.find((l) => l.mobHp < 1000)!.now;
    expect(logs.find((l) => l.now === hitAt)!.mobHp).toBe(500);
    expect(logs.every((l) => l.mode === "idle")).toBe(true);
    for (const log of logs.filter((l) => l.now < hitAt + HEAL_LOCKOUT_SECONDS * 1000)) expect(log.mobHp).toBeLessThanOrEqual(500);
    const first = regen(logs, hitAt + 1)!;
    expect(first.at).toBe(hitAt + HEAL_LOCKOUT_SECONDS * 1000);
    expect(first.gain).toBeCloseTo((1000 * DT) / MOB_REGEN_SECONDS, 9);
    // Half the hp back takes half of MOB_REGEN_SECONDS, then it is whole and stays so.
    const full = logs.find((l) => l.mobHp === 1000 && l.now > hitAt)!;
    expect(Math.abs(full.now - first.at - ((MOB_REGEN_SECONDS * 1000) / 2 - TICK_MS))).toBeLessThanOrEqual(TICK_MS);
    expect(logs.at(-1)!.mobHp).toBe(1000);
    expect(fxOf(rig.events, "heal").filter((h) => h.id === rig.mob.id)).toHaveLength(0);
  });
});

describe("lifesteal on mobs", () => {
  // A Holy player at half hp swings a sword once at something with 5 hp left: the swing is many times that.
  const SWING = damagePerHit(PLAYER_SPEC.holy, "sword");
  const strike = (target: "mob" | "dummy"): { rig: Rig; log: TickLog; id: string } => {
    const rig = makeRig({
      player: "holy", weapon: "sword", naturalHp: true, hpFrac: 0.5, mob: "fire", mobMaxHp: 100, mobHp: 5,
      mobAt: target === "dummy" ? tile(28, 28) : HOME,
    });
    const id = target === "mob"
      ? rig.mob.id
      : addMob(rig.world, { kind: "dummy", name: "Dummy", at: HOME, facing: Math.PI, hp: 5 });
    hold(rig, 0);
    for (let i = 0; i < 20; i++) {
      const log = tick(rig);
      if (log.landed.some((h) => h.victim === id && h.weapon === "sword")) {
        send(rig, "release", { a: 0 });
        return { rig, log, id };
      }
    }
    throw new Error("the swing never landed");
  };
  const healed = (log: TickLog, id: string): number => sum(fxOf(log.events, "heal").filter((h) => h.id === id).map((h) => h.amount));

  it("a Holy player killing a mob gains lifesteal from the hp the hit removed, not from the overkill", () => {
    const { rig, log, id } = strike("mob");
    expect(SWING).toBeGreaterThan(5 * 5);
    // The hit was big, but the entry that reaches systems is capped at the hp the mob had...
    const landed = log.landed.filter((h) => h.victim === id);
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ by: "p", weapon: "sword" });
    expect(landed[0]!.amount).toBeCloseTo(5, 9);
    expect(rig.mob.s.status).toBe("dead");
    expect(fxOf(log.events, "death").map((d) => [d.id, d.by])).toEqual([[id, "p"]]);
    // ...so the heal is that, at half hp (lifestealFraction 0.875), and a small part of what the whole swing would feed.
    const fraction = lifestealFraction(PLAYER_SPEC.holy, 0.5);
    expect(fraction).toBeCloseTo(0.875, 12);
    expect(healed(log, "p")).toBeCloseTo(5 * fraction, 9);
    expect(healed(log, "p")).toBeLessThan(0.2 * SWING * fraction);
  });

  it("hitting a dummy is not capped: the whole hit feeds the lifesteal", () => {
    const { log, id } = strike("dummy");
    const landed = log.landed.filter((h) => h.victim === id);
    expect(landed).toHaveLength(1);
    expect(landed[0]!.amount).toBeCloseTo(SWING, 9);
    expect(healed(log, "p")).toBeCloseTo(SWING * lifestealFraction(PLAYER_SPEC.holy, 0.5), 9);
  });

  it("a hit that does not kill is whole either way", () => {
    const rig = makeRig({
      player: "holy", weapon: "sword", naturalHp: true, hpFrac: 0.5, mob: "fire", mobMaxHp: 1000, mobHp: 1000,
    });
    hold(rig, 0);
    let swing: TickLog | undefined;
    for (let i = 0; i < 20 && !swing; i++) {
      const log = tick(rig);
      if (log.landed.some((h) => h.victim === rig.mob.id && h.weapon === "sword")) swing = log;
    }
    expect(swing).toBeDefined();
    expect(rig.mob.s.status).toBe("alive");
    expect(swing!.landed.find((h) => h.victim === rig.mob.id)!.amount).toBeCloseTo(SWING, 9);
    expect(healed(swing!, "p")).toBeCloseTo(SWING * lifestealFraction(PLAYER_SPEC.holy, 0.5), 9);
  });
});

describe("a move-speed buff meets Frost's chill", () => {
  // The only move-speed buff is Cinder Hound's, and it holds only while its owner chases a locked target. So the walk
  // away from the Frost mob is a chase: the player locks a decoy mob (an idle Fire mob, far down the walk) and the lock
  // walks it there. The buff's mirror follows the lock one tick late (sim/mods.ts updateMods), so each run spends one
  // tick before it measures.
  const DECOY_AT = { x: HOME.x - 400, y: HOME.y };
  /** How far (u) the player walks in each of the first ticks of a chase of the decoy, away from a Frost mob it is engaged with. */
  const strides = (o: { stacks: number; frost: boolean }): { steps: number[]; worstGap: number; rig: Rig } => {
    const rig = makeRig({ player: "plague", weapon: "sword", mob: "frost", mobAt: o.frost ? HOME : tile(28, 28), mobFacing: Math.PI });
    if (o.stacks > 0) grantBuff(rig.world, rig.p, rig.prt, "cinderHound", o.stacks);
    const decoy = combatant(rig.world, placeMob(rig.world, { region: "fire", elite: false, at: DECOY_AT, facing: 0 })) as MobCombatant;
    if (o.frost) {
      wake(rig);
      // Until the mob's bash has landed and the pair is engaged (the chill is on from the tick after).
      for (let i = 0; i < 40 && !((signatureState(rig.world, "p")?.chill ?? 1) < 1); i++) tick(rig);
      expect(signatureState(rig.world, "p")!.chill).toBeLessThan(1);
    }
    send(rig, "target", { id: decoy.id });
    tick(rig); // the lock starts, and the buff's condition holds from the end of this tick
    expect(rig.p.attackTarget).toBe(decoy.id);
    const steps: number[] = [];
    let worstGap = 0;
    // 8 ticks: the player starts about 37 u from the mob and walks away at the buff x the chill (about 7 u a tick at 6
    // stacks), so it is about 87 u off by the last tick, inside CHILL_MOVE_RADIUS (100). Ten ticks would walk it out.
    for (let i = 0; i < 8; i++) {
      const from = { x: rig.p.x, y: rig.p.y };
      worstGap = Math.max(worstGap, Math.hypot(rig.mob.s.x - rig.p.x, rig.mob.s.y - rig.p.y));
      tick(rig);
      steps.push(Math.hypot(rig.p.x - from.x, rig.p.y - from.y));
    }
    expect(rig.p.attackTarget).toBe(decoy.id); // still chasing, never in reach of the decoy: no swing rooted it
    return { steps, worstGap, rig };
  };
  const BASE = PLAYER_SPEED * DT;

  it("walks at the buff's multiplier x CHILL_MOVE_MULT of the base speed inside the chill radius (both are move modifiers)", () => {
    const stacks = 6;
    // What the wire carries: the row at these stacks, rounded to thousandths (the sim walks with exactly this).
    const row = buffRowsOf("cinderHound", stacks)[0]!;
    if (row.k !== "while") throw new Error("Cinder Hound's row is a while row");
    const buff = decodeMult(encodeMult(1 + row.v));
    expect(buff).toBeGreaterThan(1.05);
    const plain = strides({ stacks: 0, frost: false });
    const buffed = strides({ stacks, frost: false });
    const chilled = strides({ stacks: 0, frost: true });
    const both = strides({ stacks, frost: true });
    // Each effect on its own...
    for (const d of plain.steps) expect(d).toBeCloseTo(BASE, 9);
    for (const d of buffed.steps) expect(d).toBeCloseTo(BASE * buff, 9);
    for (const d of chilled.steps) expect(d).toBeCloseTo(BASE * CHILL_MOVE_MULT, 9);
    // ...and together they multiply, while the mob is within CHILL_MOVE_RADIUS the whole time.
    expect(both.worstGap).toBeLessThan(CHILL_MOVE_RADIUS);
    for (const d of both.steps) expect(d).toBeCloseTo(BASE * buff * CHILL_MOVE_MULT, 9);
    expect(both.rig.world.moveModifiers.length).toBeGreaterThanOrEqual(2);
  });

  it("the buff does nothing while its owner is not chasing a lock: a plain walk is at the base speed, chilled or not", () => {
    const rig = makeRig({ player: "plague", weapon: "sword", mob: "frost", mobAt: tile(28, 28), mobFacing: Math.PI });
    grantBuff(rig.world, rig.p, rig.prt, "cinderHound", 6);
    send(rig, "move", { x: HOME.x - 400, y: HOME.y });
    tick(rig);
    for (let i = 0; i < 6; i++) {
      const from = { x: rig.p.x, y: rig.p.y };
      tick(rig);
      expect(Math.hypot(rig.p.x - from.x, rig.p.y - from.y)).toBeCloseTo(BASE, 9);
    }
  });
});

describe("a player's Frost chill and damage over time on a mob", () => {
  it("a Frost player chills a mob it fights: the mob's cooldown runs at chillMultiplier of real time", () => {
    // The mob's axe takes 1.2 s a swing; chilled it should take 2.5 times that.
    const rig = makeRig({ player: "frost", weapon: "shield", mob: "fire" });
    hold(rig);
    const logs: TickLog[] = [];
    const left: number[] = [];
    for (let i = 0; i < 120; i++) {
      logs.push(tick(rig));
      left.push(rig.mob.s.readyAt - rig.world.state.serverTime);
    }
    const slow = chillMultiplier(PLAYER_SPEC.frost);
    expect(slow).toBeCloseTo(0.4, 12);
    const started = logs.findIndex((l) => fxOf(l.events, "windup").some((w) => w.by === rig.mob.id));
    expect(started).toBeGreaterThanOrEqual(0);
    // A few ticks after the swing began (past the correction for a swing started this tick), over a stretch of 8 ticks.
    const from = started + 3;
    expect(logs.slice(from, from + 9).every((l) => l.mob.chill === slow)).toBe(true);
    const progressed = (left[from]! - left[from + 8]!) / (8 * TICK_MS);
    expect(progressed).toBeCloseTo(slow, 6);
    expect(rig.mob.s.sig & SIG_CHILLED).toBeTruthy();
    expect(signatureState(rig.world, rig.mob.id)!.chillers).toEqual(["p"]);
  });

  it("a mob that dies to the damage over time of a player is that player's kill", () => {
    const rig = makeRig({ player: "fire", weapon: "axe", mob: "frost" });
    hold(rig);
    let swung: TickLog | undefined;
    for (let i = 0; i < 40 && !swung; i++) {
      const log = tick(rig);
      if (log.landed.some((h) => h.victim === rig.mob.id && h.weapon === "axe" && !h.sig)) swung = log;
    }
    expect(swung).toBeDefined();
    expect(rig.mob.s.status).toBe("alive");
    // Less hp than one tick of burn (about 0.39 after the mob's shield); the axe has no swing due for another second.
    rig.mob.s.hp = 0.2;
    const log = tick(rig);
    expect(rig.mob.s.status).toBe("dead");
    const hits = log.landed.filter((h) => h.victim === rig.mob.id);
    expect(hits.map((h) => h.sig)).toEqual(["burn"]);
    // What the death is credited with is the hp the burn removed.
    expect(hits[0]!.amount).toBeCloseTo(0.2, 9);
    expect(fxOf(log.events, "death")).toEqual([{ kind: "death", id: rig.mob.id, x: rig.mob.s.x, y: rig.mob.s.y, by: "p" }]);
    expect(rig.prt.mobKills).toBe(1);
    expect(rig.p.mobKills).toBe(1);
  });
});

describe("Frost's move slow on a pinned mob", () => {
  it("reaches only CHILL_MOVE_RADIUS: a player that is still chilled beyond it walks at full speed", () => {
    const rig = makeRig({ player: "plague", weapon: null, mob: "frost", mobFacing: Math.PI });
    wake(rig);
    for (let i = 0; i < 40 && !((signatureState(rig.world, "p")?.chill ?? 1) < 1); i++) tick(rig);
    send(rig, "move", { x: HOME.x - 400, y: HOME.y });
    const seen: Array<{ gap: number; chilled: boolean; step: number }> = [];
    for (let i = 0; i < 30; i++) {
      pin(rig, HOME);
      const from = { x: rig.p.x, y: rig.p.y };
      const gap = Math.hypot(HOME.x - from.x, HOME.y - from.y);
      const chilled = (signatureState(rig.world, "p")?.chill ?? 1) < 1;
      tick(rig);
      seen.push({ gap, chilled, step: Math.hypot(rig.p.x - from.x, rig.p.y - from.y) });
    }
    const inside = seen.filter((t) => t.chilled && t.gap <= CHILL_MOVE_RADIUS);
    const beyond = seen.filter((t) => t.chilled && t.gap > CHILL_MOVE_RADIUS);
    expect(inside.length).toBeGreaterThanOrEqual(5);
    expect(beyond.length).toBeGreaterThanOrEqual(5);
    for (const t of inside) expect(t.step).toBeCloseTo(PLAYER_SPEED * DT * CHILL_MOVE_MULT, 9);
    for (const t of beyond) expect(t.step).toBeCloseTo(PLAYER_SPEED * DT, 9);
  });
});

describe("fixed gaps in the seams (regressions: each of these failed before src was fixed)", () => {
  // The comments below describe what was wrong, in the present tense of the day they were written.
  // FIXED BUG 1. sim/factions.ts evading() promises that a returning mob "cannot keep burning, diseasing or chilling a
  // player who follows it (or stands by its camp)". The mob's own target is dropped, so burn and disease do stop (tested
  // above). The chill does not: updateChill() reads the PLAYER's target (the returning mob, still `engaged` for the trade
  // window of up to 3 s while the player is in reach) and chills the player on behalf of the Frost mob that is walking
  // home. The player keeps the 0.4 attack slow and the 0.7 move slow (inside CHILL_MOVE_RADIUS), and SIG_CHILLED, until the
  // window lapses. A fix: skip an evading target in updateChill / chillMoveMultiplier (or clear the target of anyone who
  // targets an evading mob).
  it("a Frost mob that gave up stops chilling the player who stands in reach of it", () => {
    const rig = makeRig({ player: "plague", weapon: "axe", mob: "frost" });
    hold(rig);
    wake(rig);
    run(rig, 40);
    expect(signatureState(rig.world, "p")!.chill).toBeLessThan(1);
    const offset = { x: rig.p.x - rig.mob.s.x, y: rig.p.y - rig.mob.s.y };
    place(rig.world, "p", FAR.x + offset.x, FAR.y + offset.y);
    const away = run(rig, 40, () => pin(rig, FAR));
    expect(away[0]!.mode).toBe("return");
    // From the first tick the mob is evading, its own target is gone (as for Fire and Plague)...
    expect(away.slice(1).every((l) => l.mob.target === null)).toBe(true);
    // ...and so should the chill on the player standing right beside it.
    for (const log of away.slice(1)) expect(log.me.chill, `tick ${log.now}`).toBe(1);
    expect(rig.p.sig & SIG_CHILLED).toBeFalsy();
  });

  // FIXED BUG 1b, same cause. The player's own target stays the returning mob and stays engaged (in reach, trade window of
  // 3 s from the last contact), so a Sentenced mark, a Plague disease or a Fire burn keeps being worked out for it. While
  // the mob walks home that damage is shrugged off (hurtMob), but the tick it arrives and rests (idle, full hp), the next
  // tick of the player's damage over time lands on it and wakes it again (`aggro`): the mob that gave up is on the player
  // again at once, and a long-reach weapon (a wand's 244 u here) keeps the window open for the whole walk home. The same
  // fix applies: a fighter whose target is evading drops that target.
  it("a mob that has just walked home is not woken again by the lingering damage over time of the player who chased it off", () => {
    const rig = makeRig({ player: "sentenced", weapon: "wand", mob: "fire" });
    hold(rig);
    run(rig, 60);
    expect(signatureState(rig.world, "p")!.markElapsed).toBeGreaterThan(1);
    const offset = { x: rig.p.x - rig.mob.s.x, y: rig.p.y - rig.mob.s.y };
    // Dragged beyond the leash once; the player lets go of the trigger and the mob walks home by itself.
    send(rig, "release", { a: 0 });
    place(rig.world, "p", FAR.x + offset.x, FAR.y + offset.y);
    pin(rig, FAR);
    const walk = run(rig, 100);
    const arrived = walk.findIndex((l) => l.mode === "idle");
    expect(arrived).toBeGreaterThan(10);
    expect(walk[arrived]!.mobHp).toBe(rig.mob.s.maxHp);
    for (const log of walk.slice(arrived)) {
      // Nothing lands on it (and so it is not woken)...
      expect(log.landed.filter((h) => h.victim === rig.mob.id).map((h) => h.sig ?? h.weapon), `tick ${log.now}`).toEqual([]);
      expect(log.mode, `tick ${log.now}`).toBe("idle");
    }
  });

  // FIXED BUG 2. Mobs never hurt each other (a hit is recorded with scale 0), but a swing of one mob that meets a Frost
  // camp-mate's raised shield still emits a `block` fx, and sim/factions.ts counts a block as contact: the two become each
  // other's targets and chill each other (SIG_CHILLED, attack cadence x0.4) for as long as the bashes keep being blocked.
  // A mob that is fighting a player is thereby slowed by its own neighbour. A fix: contactsOf() ignores pairs of mobs.
  it("a Frost mob's bash that its camp-mate's shield blocks starts no contact between the two", () => {
    const rig = makeRig({ player: "plague", weapon: null, mob: "frost", playerAt: { x: HOME.x - 40, y: HOME.y } });
    // The camp-mate stands beside the player, in front of the bash and facing it.
    const mate = combatant(rig.world, placeMob(rig.world, { region: "frost", elite: false, at: { x: HOME.x - 25, y: HOME.y + 28 }, facing: 0 })) as MobCombatant;
    mate.s.maxHp = mate.s.hp = BIG_HP;
    wake(rig);
    run(rig, 100);
    // The bash did meet the camp-mate's shield (so this is the scenario)...
    expect(fxOf(rig.events, "block").some((b) => b.by === rig.mob.id && b.id === mate.id)).toBe(true);
    // ...and still nothing about the pair is signature business.
    expect(targetOf(rig.world, mate.id)).toBeNull();
    expect(targetOf(rig.world, rig.mob.id)).toBe("p");
    expect(rig.mob.s.sig & SIG_CHILLED).toBeFalsy();
    expect(mate.s.sig & SIG_CHILLED).toBeFalsy();
    expect(signatureState(rig.world, rig.mob.id)!.chill).toBe(1);
  });
});
