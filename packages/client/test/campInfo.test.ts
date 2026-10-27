// What the planning screen says of a camp's mobs (ui/campInfo.ts): read defensively from the roster, so a state with no camps yet,
// or a type from newer content, never throws.
import { describe, expect, it } from "vitest";
import { MOB_TYPES } from "@raid/shared";
import { campTypeInfo, readCampStates, readCampTypes } from "../src/ui/campInfo";

describe("campTypeInfo", () => {
  it("names a known type", () => {
    expect(campTypeInfo("rotMonk")).toEqual({ name: "Rot Monk" });
  });

  it("is null while the room does not say, and shows an unknown id as it is", () => {
    expect(campTypeInfo("")).toBeNull();
    expect(campTypeInfo(undefined)).toBeNull();
    expect(campTypeInfo("someNewMob")).toEqual({ name: "someNewMob" });
  });

  it("knows every mob type of the roster", () => {
    for (const t of MOB_TYPES) expect(campTypeInfo(t.id)?.name).toBe(t.name);
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

describe("readCampStates", () => {
  it("reads state.camps[i].state as 0 idle, 1 engaged, 2 cleared, and 0 for anything else", () => {
    expect(readCampStates({}, 2)).toEqual([0, 0]);
    expect(readCampStates({ camps: [{ state: 1 }, { state: 2 }, { state: 7 }, {}] }, 4)).toEqual([1, 2, 0, 0]);
  });
});
