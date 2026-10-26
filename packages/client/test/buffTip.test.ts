// The build strip's wording that is not the shared catalog's: the matchup tags, the tooltip and the toast for several buffs.
import { describe, expect, it } from "vitest";
import { BUFFS, FACTIONS, buffToast, buffView, type BuffTag } from "@raid/shared";
import { COMING_NOTE, NEWS_LISTED, buffNewsText, tagLabel, tagList, tipText, zoneLabel } from "../src/ui/buffTip";

describe("tagLabel", () => {
  it("names a faction as the player knows it (Holy is Demon Blood), a weapon as its users, a word in plain English", () => {
    expect(tagLabel("holy")).toBe("Demon Blood");
    expect(tagLabel("fire")).toBe("Fire");
    expect(tagLabel("bow")).toBe("bow users");
    expect(tagLabel("highHp")).toBe("high-HP fighters");
    expect(tagLabel("any")).toBe("anyone");
  });

  it("leaves no tag of the catalog as a raw camelCase id", () => {
    const tags = new Set<BuffTag>(BUFFS.flatMap((b) => [...b.worksWith, ...b.counters]));
    expect(tags.size).toBeGreaterThan(10);
    for (const tag of tags) {
      const label = tagLabel(tag);
      expect(label, tag).not.toBe("");
      expect(label, tag).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it("passes an unknown tag (newer server content) through as given", () => {
    expect(tagLabel("fromTheFuture")).toBe("fromTheFuture");
  });

  it("joins a list", () => {
    expect(tagList(["kiters", "bow", "wand"])).toBe("kiters, bow users, wand users");
    expect(tagList([])).toBe("");
  });

  it("says a zone by its player-facing name", () => {
    expect(zoneLabel("holy")).toBe("Demon Blood zone");
    expect(zoneLabel("sentenced")).toBe(`${FACTIONS.sentenced.displayName} zone`);
  });
});

describe("tipText", () => {
  it("is one line per fact, in a fixed order", () => {
    const lines = tipText(buffView("rimeStalker", 2.5, 1)!, true).split("\n");
    expect(lines[0]).toBe("Rime Stalker (Frost zone)");
    expect(lines[1]).toMatch(/^2\.5 stacks: \+\d+(\.\d)? armor$/);
    expect(lines[2]).toBe("At 3 stacks: +20 armor");
    expect(lines[3]).toMatch(/^Next kill: \+1\.1 stacks \(\+\d+(\.\d)? armor\)$/);
    expect(lines[4]).toBe("Works with: anyone");
    expect(lines[5]).toBe("Strong against: Plague, Frost, Demon Blood, physical damage");
    expect(lines).toHaveLength(6);
  });

  it("leaves the next-kill line out when asked (no mob to kill) or when the reward is nothing", () => {
    expect(tipText(buffView("rimeStalker", 2.5, 1)!, false)).not.toContain("Next kill");
    expect(tipText(buffView("rimeStalker", 2.5, 0)!, true)).not.toContain("Next kill");
  });

  it("adds the coming note for a row the server does not apply yet, and only then", () => {
    expect(tipText(buffView("frostWisp", 2, 1)!, true)).toContain(COMING_NOTE);
    expect(tipText(buffView("iceGolem", 2, 1)!, true)).not.toContain(COMING_NOTE);
  });

  it("marks an elite's", () => {
    expect(tipText(buffView("glacialWarden", 1, 1)!, true).split("\n")[0]).toBe("Glacial Warden (elite, Frost zone)");
  });
});

describe("buffNewsText", () => {
  it("is empty for no news, and a single buff keeps the shared toast wording", () => {
    expect(buffNewsText([])).toBe("");
    expect(buffNewsText([{ buff: "emberImp", gained: 1.1, total: 3.2 }])).toBe(buffToast("emberImp", 1.1, 3.2));
  });

  it("sums a buff gained twice into one entry, with the latest total", () => {
    expect(buffNewsText([{ buff: "emberImp", gained: 1.1, total: 1.1 }, { buff: "emberImp", gained: 1.1, total: 2.2 }])).toBe(
      buffToast("emberImp", 2.2, 2.2),
    );
  });

  it(`lists up to ${NEWS_LISTED} buffs by name and counts the rest`, () => {
    const news = ["emberImp", "bailiff", "acolyte", "plagueRat", "iceGolem"].map((buff, i) => ({ buff, gained: 1 + i, total: 5 }));
    expect(buffNewsText(news.slice(0, 2))).toBe("Ember Imp +1.0, Bailiff +2.0");
    expect(buffNewsText(news.slice(0, 3))).toBe("Ember Imp +1.0, Bailiff +2.0, Acolyte +3.0");
    expect(buffNewsText(news)).toBe("Ember Imp +1.0, Bailiff +2.0, Acolyte +3.0 and 2 more");
  });

  it("names a buff it does not know by its id", () => {
    expect(buffNewsText([{ buff: "x1", gained: 1, total: 1 }, { buff: "emberImp", gained: 1, total: 1 }])).toBe("x1 +1.0, Ember Imp +1.0");
  });
});
