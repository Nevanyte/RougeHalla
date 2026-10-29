// What the planning screen says of a camp's mobs (ui/campInfo.ts): read defensively from the roster, so a state with no camps yet,
// or a type from newer content, never throws.
import { describe, expect, it } from "vitest";
import { MOB_ROLE_DEFS, MOB_TYPES, WEAPONS } from "@raid/shared";
import { campMobsText, campTypeInfo, readCampElites, readCampStates, readCampTypes } from "../src/ui/campInfo";

describe("campTypeInfo", () => {
  it("names a known type with its role and the weapon it drops", () => {
    expect(campTypeInfo("rotMonk")).toEqual({ id: "rotMonk", name: "Rot Monk", role: "Grunt", blurb: "Plain fighter.", weapon: "Bow" });
    expect(campTypeInfo("flameCaller")).toEqual({ id: "flameCaller", name: "Flame Caller", role: "Caster", blurb: "Shoots from range.", weapon: "Wand" });
  });

  it("names the camp's elite too, when the room says one", () => {
    expect(campTypeInfo("emberImp", "ashDrake")).toEqual({
      id: "emberImp", name: "Ember Imp", role: "Swarm", blurb: "Fast and fragile.", weapon: "Axe",
      elite: { id: "ashDrake", name: "Ash Drake", role: "Caster", blurb: "Shoots from range.", weapon: "Wand" },
    });
    expect(campTypeInfo("emberImp", "")?.elite).toBeUndefined();
    expect(campTypeInfo("emberImp", undefined)?.elite).toBeUndefined();
  });

  it("is null while the room does not say, and shows an unknown id as it is", () => {
    expect(campTypeInfo("")).toBeNull();
    expect(campTypeInfo(undefined)).toBeNull();
    expect(campTypeInfo("", "wyrmling")).toBeNull();
    expect(campTypeInfo("someNewMob")).toEqual({ id: "someNewMob", name: "someNewMob", role: "", blurb: "", weapon: "" });
    expect(campTypeInfo("emberImp", "someNewElite")?.elite).toEqual({ id: "someNewElite", name: "someNewElite", role: "", blurb: "", weapon: "" });
  });

  it("knows every mob type of the roster, with its role label and weapon name", () => {
    for (const t of MOB_TYPES) {
      const info = campTypeInfo(t.id)!;
      expect(info.name).toBe(t.name);
      expect(info.role).toBe(MOB_ROLE_DEFS[t.role].label);
      expect(info.weapon).toBe(WEAPONS[t.weapon].name);
    }
  });
});

describe("campMobsText", () => {
  it("says the type, its role and what it drops, with the right article, and no buff", () => {
    expect(campMobsText(campTypeInfo("emberImp")!)).toContain("Each normal kill grants +1% damage per kill.");
    expect(campMobsText(campTypeInfo("emberImp")!)).toContain("No chest on a normal camp clear.");
    expect(campMobsText(campTypeInfo("pardoner")!)).toContain("Each normal kill grants +1 attack damage per kill.");
    expect(campMobsText(campTypeInfo("gaoler")!)).toContain("Elite death drops an augment chest; it grants no fixed mob stat.");
  });

  it("adds the elite of an elite camp", () => {
    expect(campMobsText(campTypeInfo("bailiff", "gaoler")!)).toContain("Elite death drops an augment chest; it grants no fixed mob stat.");
  });

  it("is just the id for a type this build does not know", () => {
    expect(campMobsText(campTypeInfo("someNewMob")!)).toContain("someNewMob");
    expect(campMobsText(campTypeInfo("emberImp", "someNewElite")!)).toContain("Elite: someNewElite");
  });

  it("explains fixed normal rewards and elite chests for every known camp", () => {
    for (const t of MOB_TYPES) {
      const text = campMobsText(campTypeInfo(t.id, t.elite ? t.id : undefined)!);
      if (t.elite) expect(text, t.id).toContain("augment chest");
      else expect(text, t.id).toMatch(/Each normal kill grants .* per kill\./);
    }
  });
});

describe("readCampTypes", () => {
  it("reads state.camps[i].type with optional access: nothing, a short list, a type that is not a string", () => {
    expect(readCampTypes({}, 3)).toEqual(["", "", ""]);
    expect(readCampTypes(undefined, 2)).toEqual(["", ""]);
    expect(readCampTypes(null, 1)).toEqual([""]);
    expect(readCampTypes({ camps: [{ type: "emberImp" }, { type: 5 }, {}] }, 4)).toEqual(["emberImp", "", "", ""]);
    expect(readCampTypes({ camps: { 0: { type: "bailiff" }, length: 1 } }, 2)).toEqual(["bailiff", ""]);
    expect(readCampTypes({}, 0)).toEqual([]);
  });
});

describe("readCampElites", () => {
  it("reads state.camps[i].elite with optional access: nothing, a short list, a value that is not a string", () => {
    expect(readCampElites({}, 2)).toEqual(["", ""]);
    expect(readCampElites(undefined, 1)).toEqual([""]);
    expect(readCampElites({ camps: [{ elite: "wyrmling" }, { elite: 3 }, {}, { elite: "" }] }, 5)).toEqual(["wyrmling", "", "", "", ""]);
  });
});

describe("readCampStates", () => {
  it("reads state.camps[i].state as 0 idle, 1 engaged, 2 cleared, and 0 for anything else", () => {
    expect(readCampStates({}, 2)).toEqual([0, 0]);
    expect(readCampStates({ camps: [{ state: 1 }, { state: 2 }, { state: 7 }, {}] }, 4)).toEqual([1, 2, 0, 0]);
  });
});
