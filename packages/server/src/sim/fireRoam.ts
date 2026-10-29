import { FIRE_ROAM_CHARGE_MAX, FIRE_ROAM_RAMP_MS, fireRoamBurstDamage, fireRoamCharge, fireRoamSpeedMult } from "@raid/shared";
import { deferHit } from "./ledger";
import { apOf } from "./mods";
import type { Combatant } from "./combatant";
import type { DamagePacket, LedgerEntry, World } from "./world";
import { chainHook } from "./world";

/** Authoritative server timing; clients receive only the quantized charge mirror. */
interface FireRoamRuntime {
  lastCombatAt: Map<string, number>;
  armedPackets: WeakMap<DamagePacket, string>;
}

const runtimes = new WeakMap<World, FireRoamRuntime>();

function runtime(world: World): FireRoamRuntime {
  let rt = runtimes.get(world);
  if (!rt) {
    rt = { lastCombatAt: new Map(), armedPackets: new WeakMap() };
    runtimes.set(world, rt);
  }
  return rt;
}

function resetCharge(world: World, id: string): void {
  const p = world.state.players.get(id);
  if (!p || p.faction !== "fire") return;
  const rt = runtime(world);
  rt.lastCombatAt.set(id, world.state.serverTime);
  p.roamCharge = 0;
}

function eligibleAuto(entry: LedgerEntry): boolean {
  return entry.weapon !== null
    && entry.ability === undefined
    && entry.sig === undefined
    && !entry.dot
    && !entry.passive
    && !entry.derived
    && !entry.arena;
}

function onAttackStarted(world: World, c: Combatant): void {
  if (c.kind !== "player" || c.s.faction !== "fire" || c.s.status !== "alive" || !c.s.roamReady || world.state.phase !== "active") return;
  const rt = runtime(world);
  const action = c.rt.weapon.action;
  if (action) rt.armedPackets.set(action.packet, c.id);
}

function onHitLanded(world: World, entry: LedgerEntry, _applied: number): void {
  const owner = world.state.players.get(entry.by.id);
  if (owner?.faction !== "fire") return;

  resetCharge(world, entry.by.id);
  if (!eligibleAuto(entry)) return;

  const rt = runtime(world);
  const armedOwner = rt.armedPackets.get(entry.packet);
  if (armedOwner !== entry.by.id || !owner.roamReady) return;

  owner.roamReady = false;
  const victimExists = world.state.players.has(entry.victim) || world.state.mobs.has(entry.victim);
  if (!victimExists) return;
  const amount = fireRoamBurstDamage(apOf(owner));
  deferHit(world, {
    victim: entry.victim,
    by: { id: entry.by.id, name: owner.name },
    packet: { phys: 0, magic: 1, true: 0, raw: amount },
    weapon: null,
    derived: true,
    stagger: false,
  });
}

function update(world: World): void {
  const rt = runtime(world);
  const now = world.state.serverTime;
  for (const [id, p] of world.state.players) {
    if (p.faction !== "fire" || p.status !== "alive" || world.state.phase !== "active") {
      p.roamCharge = 0;
      p.roamReady = false;
      rt.lastCombatAt.delete(id);
      continue;
    }
    let lastCombatAt = rt.lastCombatAt.get(id);
    if (lastCombatAt === undefined) {
      lastCombatAt = now;
      rt.lastCombatAt.set(id, now);
    }
    const elapsed = Math.max(0, now - lastCombatAt);
    p.roamCharge = fireRoamCharge(elapsed);
    if (elapsed >= FIRE_ROAM_RAMP_MS) p.roamReady = true;
  }
}

function roamingSpeed(world: World, c: Combatant): { speedMult: number } | null {
  if (c.kind !== "player" || c.s.faction !== "fire" || c.s.status !== "alive" || world.state.phase !== "active") return null;
  const lastCombatAt = runtime(world).lastCombatAt.get(c.id);
  if (lastCombatAt === undefined) return null;
  return { speedMult: fireRoamSpeedMult(fireRoamCharge(world.state.serverTime - lastCombatAt)) };
}

export function install(world: World): void {
  const rt = runtime(world);
  chainHook(world, "raidStarted", (w) => {
    rt.lastCombatAt.clear();
    rt.armedPackets = new WeakMap();
    for (const [id, p] of w.state.players) {
      rt.lastCombatAt.set(id, w.state.serverTime);
      p.roamCharge = 0;
      p.roamReady = false;
    }
  });
  chainHook(world, "attackStarted", onAttackStarted);
  chainHook(world, "hitLanded", onHitLanded);
  chainHook(world, "hurt", (w, c, applied) => { if (applied > 0) resetCharge(w, c.id); });
  chainHook(world, "fighterOut", (w, id) => {
    rt.lastCombatAt.delete(id);
    const p = w.state.players.get(id);
    if (p) {
      p.roamCharge = 0;
      p.roamReady = false;
    }
  });
  chainHook(world, "runEnded", (w) => {
    for (const p of w.state.players.values()) {
      p.roamCharge = 0;
      p.roamReady = false;
    }
    rt.lastCombatAt.clear();
  });
  world.modSources.push(roamingSpeed);
  // Runs before sim/mods.ts so the movement mirror folds the current charge in this tick.
  world.systems.unshift(update);
}
