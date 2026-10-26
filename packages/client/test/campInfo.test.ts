// What the planning screen says of a camp's mobs and of the buffs that answer the factions present (ui/campInfo.ts): read
// defensively from the roster and the buff catalog, so a state with no camps yet, or a type from newer content, never throws.
import { describe, expect, it } from "vitest";
import { FACTIONS, MOB_TYPES, buffsCountering, buffText, type FactionId } from "@raid/shared";
import { campTypeInfo, counterBuffs, counterHintLines, readCampTypes } from "../src/ui/campInfo";

describe("campTypeInfo", () => {
  it("names a known type and gives its buff line", () => {
    const info = campTypeInfo("rotMonk");
    expect(info?.name).toBe("Rot Monk");
    expect(info?.buff).toBe(buffText("rotMonk"));
    expect(info?.buff.length).toBeGreaterThan(0);
  });

  it("is null while the room does not say, and shows an unknown id as it is", () => {
    expect(campTypeInfo("")).toBeNull();
    expect(campTypeInfo(undefined)).toBeNull();
    expect(campTypeInfo("someNewMob")).toEqual({ name: "someNewMob", buff: "" });
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

describe("counterBuffs", () => {
  it("lists, for each faction present, the buffs whose counters name it, at most three, once per faction", () => {
    const hints = counterBuffs(["holy", "fire", "holy", "plague"]);
    expect(hints.map((h) => h.faction)).toEqual(["holy", "fire", "plague"].filter((f) => buffsCountering(f as FactionId).length > 0));
    for (const h of hints) {
      expect(h.buffs.length).toBeGreaterThan(0);
      expect(h.buffs.length).toBeLessThanOrEqual(3);
      for (const b of h.buffs) expect(buffsCountering(h.faction).map((d) => d.id)).toContain(b.id);
    }
    expect(counterBuffs(["holy"], 1)[0]!.buffs).toHaveLength(1);
  });

  it("ignores factions that are not factions, and says nothing when no buff counters one", () => {
    expect(counterBuffs(["nobody", "", "coliseum"])).toEqual([]);
    expect(counterBuffs([])).toEqual([]);
  });

  it("writes one line per faction with the zone each buff is won in", () => {
    const lines = counterHintLines(counterBuffs(["holy"]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Against Demon Blood: /);
    for (const b of counterBuffs(["holy"])[0]!.buffs) expect(lines[0]).toContain(`${b.name} (${FACTIONS[b.zone].displayName})`);
  });
});
