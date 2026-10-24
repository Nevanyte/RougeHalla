import { describe, expect, it } from "vitest";
import { FACTION_IDS, SIGNATURE_WEAPONS, packLook, unpackLook, type ProfileDTO } from "@raid/shared";
import { hubAvatarState } from "../src/hub/hubAvatar";

function profile(equipped: Record<string, string>, owned: string[]): ProfileDTO {
  return {
    name: "op-test", gv: 120, gvLifetime: 400, gvByMonth: {},
    stats: { runs: 3, wins: 1, draws: 0, deaths: 2, kills: 4 },
    cosmetics: { owned, equipped },
    achievements: {},
    progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} },
  };
}

// Every PlayerState field PlayerView, FighterArt, SignatureArt and TrailView read.
const READ_BY_THE_VIEW = [
  "name", "look", "facing", "hp", "maxHp", "status", "faction", "weapon0", "weapon1", "slot", "drawStartedAt",
  "bounty", "immuneUntil", "sig", "brand",
] as const;

describe("hubAvatarState", () => {
  it("has every field the player view reads", () => {
    const state = hubAvatarState(null, null, 1000);
    for (const field of READ_BY_THE_VIEW) expect(state, field).toHaveProperty(field);
    for (const field of ["name", "faction", "weapon0", "weapon1", "status"] as const) expect(typeof state[field]).toBe("string");
    for (const field of ["look", "facing", "hp", "maxHp", "slot", "drawStartedAt", "bounty", "immuneUntil", "sig", "brand"] as const) {
      expect(Number.isFinite(state[field]), field).toBe(true);
    }
  });

  it("is a neutral, empty-handed, full-health fighter without a profile or a pick", () => {
    const state = hubAvatarState(null, null, 1000);
    expect(state).toMatchObject({
      name: "", look: 0, faction: "", weapon0: "", weapon1: "", slot: 0, status: "alive", hp: 1, maxHp: 1,
      bounty: 0, immuneUntil: 0, drawStartedAt: 0, sig: 0, brand: 0,
    });
  });

  it("carries the callsign and the equipped cosmetics as the packed look word", () => {
    const owned = ["skin-crimson", "outline-white", "trail-ember", "title-rookie", "gilded-fire", "skin-azure"];
    const equipped = { skin: "skin-crimson", outline: "outline-white", trail: "trail-ember", title: "title-rookie", "gold-fire": "gilded-fire" };
    const state = hubAvatarState(profile(equipped, owned), null, 1000);
    expect(state.name).toBe("op-test");
    expect(state.look).toBe(packLook(equipped, owned));
    const look = unpackLook(state.look);
    expect(look.skin?.id).toBe("skin-crimson");
    expect(look.outline?.id).toBe("outline-white");
    expect(look.trail?.id).toBe("trail-ember");
    expect(look.title?.id).toBe("title-rookie");
    expect(look.gold.map((g) => g.id)).toEqual(["gilded-fire"]);
  });

  it("leaves out anything equipped but not owned", () => {
    const state = hubAvatarState(profile({ skin: "skin-crimson", title: "title-rookie" }, ["title-rookie"]), null, 1000);
    const look = unpackLook(state.look);
    expect(look.skin).toBeUndefined();
    expect(look.title?.id).toBe("title-rookie");
  });

  it("takes the faction pick and holds its signature weapon", () => {
    for (const faction of FACTION_IDS) {
      const state = hubAvatarState(null, faction, 1000);
      expect(state.faction).toBe(faction);
      expect(state.weapon0).toBe(SIGNATURE_WEAPONS[faction]);
      expect(state.weapon1).toBe("");
      expect(state.slot).toBe(0);
    }
  });

  it("faces where it is told, and returns a fresh object each time", () => {
    const a = hubAvatarState(null, "fire", 1000, 1.25);
    const b = hubAvatarState(null, "fire", 1000);
    expect(a.facing).toBe(1.25);
    expect(b.facing).toBe(0);
    a.facing = 3;
    expect(b.facing).toBe(0);
  });
});
