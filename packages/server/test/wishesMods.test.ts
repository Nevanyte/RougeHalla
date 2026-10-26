// Where the Wishes' status runtime meets the stat mirrors (sim/mods.ts) and the ledger's hitLanded hook: an attack slow is
// folded into the attack-speed mirror (one source of truth for attack speed), and a damage-over-time entry still reaches
// hitLanded although it has no per-tick hit fx.
import { describe, expect, it } from "vitest";
import { decodeMult, mapFromTiles, mulberry32, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type GameMap } from "@raid/shared";
import { updateAbilities } from "../src/sim/abilities";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { asMultOf } from "../src/sim/mods";
import { addStatus, cleanse, removeStatuses } from "../src/sim/status";
import { addPlayer, step } from "../src/sim/step";
import type { LedgerEntry, World } from "../src/sim/world";

function openMap(): GameMap {
  const w = 30;
  const h = 20;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  const spawns = Array.from({ length: 4 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 }));
  return { ...mapFromTiles(w, h, tiles), spawns };
}

function run(): World {
  const world = createGameWorld({
    seed: 5,
    config: { minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(6),
    map: openMap(),
  }, { signatures: false });
  addPlayer(world, "a", "A");
  addPlayer(world, "b", "B");
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

describe("a slowAttack status and the attack-speed mirror", () => {
  it("lowers asMult while it lasts, and the per-tick pass restores it after it ends", () => {
    const w = run();
    const a = combatant(w, "a")!;
    const source = { id: "b", name: "B" };
    expect(asMultOf(a.s)).toBe(1);
    addStatus(w, a, { kind: "slowAttack", source, ms: 1000, value: 0.3 });
    // The statusApplied hook folds it at once: the synced mirror and the sim's read agree on 1 - 0.3.
    expect(decodeMult((a.s as { asMult: number }).asMult)).toBeCloseTo(0.7, 2);
    expect(asMultOf(a.s)).toBeCloseTo(0.7, 2);
    // It expires inside updateAbilities; mods' own system (end of the same tick) asks the sources again.
    for (let i = 0; i < 25; i++) step(w, TICK_MS);
    expect(asMultOf(a.s)).toBe(1);
  });

  it("a cleanse or any other removal restores the mirror at once, not at the next tick's pass", () => {
    const w = run();
    const a = combatant(w, "a")!;
    addStatus(w, a, { kind: "slowAttack", source: { id: "b", name: "B" }, ms: 5000, value: 0.4 });
    expect(asMultOf(a.s)).toBeLessThan(1);
    removeStatuses(w, a, (st) => st.kind === "slowAttack");
    expect(asMultOf(a.s)).toBe(1);
    expect(decodeMult((a.s as { asMult: number }).asMult)).toBe(1);
    addStatus(w, a, { kind: "slowAttack", source: { id: "b", name: "B" }, ms: 5000, value: 0.4 });
    cleanse(w, a, ["soft"]);
    expect(asMultOf(a.s)).toBe(1);
  });

  it("an expiry inside updateAbilities restores it before the weapons read it, not by the end of the tick", () => {
    const w = run();
    const a = combatant(w, "a")!;
    addStatus(w, a, { kind: "slowAttack", source: { id: "b", name: "B" }, ms: 1000, value: 0.3 });
    expect(asMultOf(a.s)).toBeCloseTo(0.7, 2);
    w.state.serverTime += 1000;
    updateAbilities(w); // the phase that runs right after the inputs, before the weapons: no system has run yet
    expect(asMultOf(a.s)).toBe(1);
    expect(decodeMult((a.s as { asMult: number }).asMult)).toBe(1);
  });

  it("the coliseum teleport's clear restores it in the tick's own patch (the teleport runs after the systems)", () => {
    const w = run();
    const a = combatant(w, "a")!;
    addStatus(w, a, { kind: "slowAttack", source: { id: "b", name: "B" }, ms: 20_000, value: 0.4 });
    expect(asMultOf(a.s)).toBeLessThan(1);
    w.state.patienceEndsAt = w.state.serverTime + TICK_MS;
    step(w, TICK_MS);
    expect(w.state.gatesLocked).toBe(true);
    expect(asMultOf(a.s)).toBe(1);
    expect(decodeMult((a.s as { asMult: number }).asMult)).toBe(1);
  });
});

describe("hitLanded and ability damage over time", () => {
  it("fires for a dot entry (no per-tick hit fx), once, after the damage", () => {
    const w = run();
    const calls: Array<{ entry: LedgerEntry; applied: number }> = [];
    w.hooks.hitLanded = (_world, entry, applied) => { calls.push({ entry, applied }); };
    const hp = w.state.players.get("b")!.hp;
    recordHit(w, {
      victim: "b", by: { id: "a", name: "A" }, packet: { raw: 12, phys: 0, magic: 0, true: 1 }, weapon: null, ability: "blaze", dot: true,
      stagger: false,
    });
    w.state.serverTime += TICK_MS;
    applyLedger(w);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.entry.dot).toBe(true);
    expect(calls[0]!.applied).toBeCloseTo(12, 9);
    expect(w.state.players.get("b")!.hp).toBeCloseTo(hp - 12, 6);
    expect(w.events.some((e) => e.type === "fx" && e.fx.kind === "hit")).toBe(false);
    expect(w.combat.landed.at(-1)).toMatchObject({ victim: "b", by: "a", weapon: null, ability: "blaze", dot: true });
  });
});
