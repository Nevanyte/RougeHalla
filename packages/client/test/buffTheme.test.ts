// The zone colours of the 20 buffs (ui/buffTheme.ts).
import { describe, expect, it } from "vitest";
import { BUFFS, FACTIONS, FACTION_IDS } from "@raid/shared";
import { BARRIER_COLOR, BUFF_COLOR, ELITE_COLOR, UNKNOWN_BUFF_COLOR, buffColor, buffZone, zoneColorOf } from "../src/ui/buffTheme";

describe("buff colours", () => {
  it("every buff has its zone's colour, and the five zones have five colours", () => {
    expect(Object.keys(BUFF_COLOR)).toHaveLength(20);
    for (const def of BUFFS) {
      expect(buffColor(def.id), def.id).toBe(FACTIONS[def.zone].color);
      expect(buffZone(def.id), def.id).toBe(def.zone);
    }
    expect(new Set(FACTION_IDS.map((z) => zoneColorOf(z))).size).toBe(5);
  });

  it("is grey for an id or a zone this build does not know", () => {
    expect(buffColor("fromANewerServer")).toBe(UNKNOWN_BUFF_COLOR);
    expect(zoneColorOf("nowhere")).toBe(UNKNOWN_BUFF_COLOR);
    expect(buffZone("fromANewerServer")).toBeUndefined();
  });

  it("keeps the barrier and the elite apart from the zone colours", () => {
    const zones = new Set(Object.values(BUFF_COLOR));
    expect(zones.has(BARRIER_COLOR)).toBe(false);
    expect(zones.has(ELITE_COLOR)).toBe(false);
  });
});
