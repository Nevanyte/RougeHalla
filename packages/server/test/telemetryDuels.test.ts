// Duel segmentation (docs/TELEMETRY.md section 4) on scripted damage through the real ledger.
import { describe, expect, it } from "vitest";
import { DUEL_GAP_MS, THIRD_ARENA, THIRD_PLAYER, TICK_MS, TELEMETRY_MAX_DUELS, SUDDEN_DEATH_KILLER } from "@raid/shared";
import { removePlayer } from "../src/sim/step";
import { makeRig } from "./support/telemetryRig";

const GAP_TICKS = DUEL_GAP_MS / TICK_MS;

describe("telemetry duel segments", () => {
  it("a scripted duel to a kill: kill, the killer wins, clean, first striker, damage by source", () => {
    const r = makeRig(3, { hp: 300 });
    r.hit({ victim: "p1", by: "p0", amount: 100 });
    r.run(1);
    r.hit({ victim: "p0", by: "p1", amount: 40 });
    r.run(5);
    r.hit({ victim: "p1", by: "p0", amount: 100 });
    r.run(5);
    r.hit({ victim: "p1", by: "p0", amount: 150 });
    r.run(2);
    const d = r.draft();
    expect(d.duels).toHaveLength(1);
    const duel = d.duels[0]!;
    expect(duel.outcome).toBe("kill");
    expect(duel.winner).toBe(0);
    expect(duel.clean).toBe(true);
    expect(duel.third).toBe(0);
    expect(duel.first).toBe(0);
    expect(duel.sides[0].slot).toBe(0);
    expect(duel.sides[1].slot).toBe(1);
    expect(duel.sides[0].dmg.weapon).toBe(350);
    expect(duel.sides[1].dmg.weapon).toBe(40);
    expect(duel.sides[0].weaponsUsed).toEqual(["sword"]);
    expect(duel.sides[1].hpEnd).toBe(0);
    expect(duel.sides[0].hp).toBe(1);
    expect(duel.end - duel.start).toBe(11 * TICK_MS);
    expect(duel.comeback).toBeNull(); // equal power
    const victim = d.players[1]!;
    expect(victim.death).toMatchObject({ kind: "player", bySlot: 0, weapon: "sword" });
    expect(d.firstBlood).toMatchObject({ victim: 1, killer: 0 });
    expect(d.players[0]!.overkill).toBe(50);
  });

  it("a disengage: one contact, then DUEL_GAP_MS of nothing; end is the last contact", () => {
    const r = makeRig(2);
    r.hit({ victim: "p1", by: "p0", amount: 10 });
    r.run(1);
    r.run(GAP_TICKS + 2);
    const d = r.draft();
    expect(d.duels).toHaveLength(1);
    expect(d.duels[0]).toMatchObject({ outcome: "disengage", winner: -1 });
    expect(d.duels[0]!.end).toBe(d.duels[0]!.start);
    // A later contact opens a second segment.
    r.hit({ victim: "p0", by: "p1", amount: 10 });
    r.run(1);
    const d2 = r.draft("void");
    expect(d2.duels.map((x) => x.outcome)).toEqual(["disengage", "runEnd"]);
    expect(d2.duels[1]!.first).toBe(1);
  });

  it("a third-party interrupt: a third player's damage marks the segment; a third player's kill is thirdParty for the survivor", () => {
    const r = makeRig(3, { hp: 200 });
    r.hit({ victim: "p1", by: "p0", amount: 50 });
    r.run(2);
    r.hit({ victim: "p1", by: "p2", amount: 20 });
    r.run(2);
    r.hit({ victim: "p1", by: "p2", amount: 500 });
    r.run(2);
    const d = r.draft("void");
    const pair01 = d.duels.find((x) => x.sides[0].slot === 0 && x.sides[1].slot === 1)!;
    expect(pair01.outcome).toBe("thirdParty");
    expect(pair01.winner).toBe(0);
    expect(pair01.clean).toBe(false);
    expect(pair01.third & THIRD_PLAYER).toBeTruthy();
    const pair12 = d.duels.find((x) => x.sides[0].slot === 1 && x.sides[1].slot === 2)!;
    expect(pair12.outcome).toBe("kill");
    expect(pair12.winner).toBe(1);
    // p0's earlier hit on p1 came before this pair's segment opened: it is clean.
    expect(pair12.clean).toBe(true);
    expect(d.players[1]!.death).toMatchObject({ kind: "player", bySlot: 2 });
  });

  it("both sides down in the same tick is a trade; the same-tick first strike goes to the larger damage", () => {
    const r = makeRig(3, { hp: 100 });
    r.hit({ victim: "p1", by: "p0", amount: 30 });
    r.hit({ victim: "p0", by: "p1", amount: 60 });
    r.run(2);
    r.hit({ victim: "p1", by: "p0", amount: 200 });
    r.hit({ victim: "p0", by: "p1", amount: 200 });
    r.run(1);
    const d = r.draft("void");
    expect(d.duels[0]).toMatchObject({ outcome: "trade", winner: -1, first: 1 });
  });

  it("arena damage sets THIRD_ARENA without breaking clean; a leave is a quit", () => {
    const r = makeRig(3);
    r.hit({ victim: "p1", by: "p0", amount: 10 });
    r.run(1);
    r.hit({ victim: "p1", by: SUDDEN_DEATH_KILLER, amount: 5, arena: true });
    r.run(1);
    removePlayer(r.world, "p1");
    r.run(1); // the leave's result goes out with the next step's events
    const d = r.draft("void");
    expect(d.duels[0]).toMatchObject({ outcome: "quit", clean: true });
    expect(d.duels[0]!.third & THIRD_ARENA).toBeTruthy();
    expect(d.players[1]!.death?.kind).toBe("quit");
    expect(d.players[1]!.quit).toBe(true);
  });

  it("a block counts as contact: it opens a segment with no damage", () => {
    const r = makeRig(2);
    const holder = { kind: "player" as const, id: "p1", s: r.world.state.players.get("p1")!, rt: r.world.players.get("p1")! };
    const attacker = { kind: "player" as const, id: "p0", s: r.world.state.players.get("p0")!, rt: r.world.players.get("p0")! };
    r.world.hooks.blocked?.(r.world, holder, attacker, { raw: 20, phys: 1, magic: 0, true: 0 }, true);
    r.run(GAP_TICKS + 2);
    const d = r.draft();
    expect(d.duels).toHaveLength(1);
    expect(d.duels[0]).toMatchObject({ outcome: "disengage", first: 0 });
    expect(d.duels[0]!.sides[0].dmg).toEqual({});
  });

  it("past the cap, segments are tracked but not written, and truncated.duels counts them", () => {
    const r = makeRig(2);
    r.rec.duelsWritten = TELEMETRY_MAX_DUELS;
    r.hit({ victim: "p1", by: "p0", amount: 10 });
    r.run(GAP_TICKS + 2);
    const d = r.draft();
    expect(d.duels).toHaveLength(0);
    expect(d.truncated?.duels).toBe(1);
  });
});
