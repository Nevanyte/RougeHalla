import { describe, expect, it } from "vitest";
import { TRAINING_BANNER, heldWeaponName, statusLine, vitalsHpText, type StatusInput, type VitalsInput } from "../src/ui/hud";

const arena: StatusInput = {
  training: false, phase: "active", playerCount: 5, minPlayers: 2, lobbyEndsAt: 0,
  alive: 3, startedWith: 6, winner: "", gv: 4,
};

describe("status line", () => {
  it("training says nothing is recorded, in every phase, and shows none of the run", () => {
    expect(TRAINING_BANNER).toBe("TRAINING — nothing here is recorded: no GV, no stats");
    for (const phase of ["lobby", "active", "ended"]) {
      const line = statusLine({ ...arena, training: true, phase, winner: "Ada" }, 1000);
      expect(line).toBe(TRAINING_BANNER);
      expect(line).not.toMatch(/Alive|Run GV|Waiting|Run over|victorious/);
    }
  });

  it("the arena run line is unchanged: players standing out of those who started, and the run GV", () => {
    expect(statusLine(arena, 0)).toBe("Alive 3/6 · Run GV 4");
    // Not in the state (no `me`): no GV.
    expect(statusLine({ ...arena, gv: null }, 0)).toBe("Alive 3/6");
    // The count comes from startedWith, not from how many are still in the state.
    expect(statusLine({ ...arena, playerCount: 1, alive: 1 }, 0)).toBe("Alive 1/6 · Run GV 4");
  });

  it("the arena lobby line counts the seconds down to the start, rounded up", () => {
    const lobby = { ...arena, phase: "lobby", playerCount: 1, minPlayers: 2, lobbyEndsAt: 10_000 };
    expect(statusLine(lobby, 0)).toBe("Waiting for players 1/2 — run starts in 0:10");
    expect(statusLine(lobby, 8_001)).toBe("Waiting for players 1/2 — run starts in 0:02");
    expect(statusLine({ ...lobby, lobbyEndsAt: 125_000 }, 0)).toBe("Waiting for players 1/2 — run starts in 2:05");
    expect(statusLine(lobby, 20_000)).toBe("Waiting for players 1/2 — run starts in 0:00");
  });

  it("the planning line counts the seconds to the end of planning, rounded up, and survives a missing end", () => {
    const planning = { ...arena, phase: "planning", planEndsAt: 12_000 };
    expect(statusLine(planning, 0)).toBe("Planning 0:12");
    expect(statusLine(planning, 4_900)).toBe("Planning 0:08");
    expect(statusLine(planning, 11_999)).toBe("Planning 0:01");
    expect(statusLine(planning, 20_000)).toBe("Planning 0:00");
    expect(statusLine({ ...arena, phase: "planning" }, 0)).toBe("Planning");
    expect(statusLine({ ...arena, phase: "planning", planEndsAt: 0 }, 0)).toBe("Planning");
    // Practice shows its banner whatever the phase.
    expect(statusLine({ ...planning, training: true }, 0)).toBe(TRAINING_BANNER);
  });

  it("the arena end lines name the winner when there is one", () => {
    expect(statusLine({ ...arena, phase: "ended", winner: "Ada" }, 0)).toBe("Run over — Ada is victorious");
    expect(statusLine({ ...arena, phase: "ended" }, 0)).toBe("Run over");
  });
});

describe("vitals line", () => {
  const me: VitalsInput = { hp: 412.2, maxHp: 500, status: "alive", weapon0: "sword", weapon1: "bow", slot: 0 };

  it("arena: whole-number hp (a standing player never reads 0) and the status, as before", () => {
    expect(vitalsHpText(me, false)).toBe(" · HP 413/500 · alive");
    expect(vitalsHpText({ ...me, hp: 0.2 }, false)).toBe(" · HP 1/500 · alive");
    expect(vitalsHpText(undefined, false)).toBe("");
  });

  it("training: the weapon in hand instead of the status word", () => {
    expect(vitalsHpText(me, true)).toBe(" · Sword · HP 413/500");
    expect(vitalsHpText({ ...me, slot: 1 }, true)).toBe(" · Bow · HP 413/500");
    expect(vitalsHpText(undefined, true)).toBe("");
  });

  it("an empty slot is fists; an unknown weapon id reads as no weapon", () => {
    expect(heldWeaponName({ weapon0: "", weapon1: "bow", slot: 0 })).toBe("Fists");
    expect(vitalsHpText({ ...me, weapon0: "", weapon1: "" }, true)).toBe(" · Fists · HP 413/500");
    expect(heldWeaponName({ weapon0: "sword", weapon1: "laser", slot: 1 })).toBe("no weapon");
  });
});
