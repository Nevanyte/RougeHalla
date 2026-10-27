import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOT_TAG, chestNameOf, displayName, playerLabel, winnerLabel } from "../src/render/displayName";

describe("displayName", () => {
  it("tags a bot and leaves a person's name as it is", () => {
    expect(displayName({ name: "Ada", bot: false })).toBe("Ada");
    expect(displayName({ name: "Grimbold", bot: true })).toBe(`${BOT_TAG} Grimbold`);
  });

  it("reads a missing flag as a person: state from a server that predates bots, the hub's avatar", () => {
    expect(displayName({ name: "Ada" })).toBe("Ada");
    expect(displayName({ name: "Ada", bot: undefined })).toBe("Ada");
  });

  it("is the same string everywhere (the tag leads, so a long name cannot push it off the nameplate)", () => {
    expect(BOT_TAG).toBe("[BOT]");
    expect(displayName({ name: "Grimbold", bot: true }).startsWith(BOT_TAG)).toBe(true);
  });
});

describe("winnerLabel", () => {
  const players = [{ name: "Ada", bot: false }, { name: "Grimbold", bot: true }, { name: "Old" }];

  it("tags the winner when the player of that name is a bot", () => {
    expect(winnerLabel("Grimbold", players)).toBe(`${BOT_TAG} Grimbold`);
  });

  it("leaves a person, a name nobody in the room bears and an empty winner alone", () => {
    expect(winnerLabel("Ada", players)).toBe("Ada");
    expect(winnerLabel("Old", players)).toBe("Old");
    expect(winnerLabel("Gone", players)).toBe("Gone");
    expect(winnerLabel("", players)).toBe("");
  });
});

describe("playerLabel", () => {
  const players = new Map([["a", { name: "Ada", bot: false }], ["g", { name: "Grimbold", bot: true }], ["o", { name: "Old" }]]);

  it("looks a player up by id and tags a bot", () => {
    expect(playerLabel(players, "g")).toBe(`${BOT_TAG} Grimbold`);
    expect(playerLabel(players, "a")).toBe("Ada");
    expect(playerLabel(players, "o")).toBe("Old");
  });

  it("is undefined for an id the room does not have", () => {
    expect(playerLabel(players, "ghost")).toBeUndefined();
  });
});

describe("chestNameOf", () => {
  const players = new Map([["a", { name: "Ada", bot: false }], ["g", { name: "Grimbold", bot: true }]]);

  it("tags a bot taker, names a person plainly and has nothing for an id the room lacks", () => {
    const nameOf = chestNameOf(() => players);
    expect(nameOf("g")).toBe(`${BOT_TAG} Grimbold`);
    expect(nameOf("a")).toBe("Ada");
    expect(nameOf("ghost")).toBeUndefined();
  });

  it("has nothing while there is no room, and reads the players when asked, not when built", () => {
    let current: typeof players | undefined;
    const nameOf = chestNameOf(() => current);
    expect(nameOf("g")).toBeUndefined();
    current = players;
    expect(nameOf("g")).toBe(`${BOT_TAG} Grimbold`);
  });

  // RaidScene is a Phaser scene with no harness here, so this pins its wiring by source shape: the chest panel's taker
  // name must come from `chestNameOf` (which tags a bot), not from a bare `players.get(id)?.name`.
  it("RaidScene hands the chest panel chestNameOf, never a bare player name", () => {
    const src = readFileSync(new URL("../src/scenes/RaidScene.ts", import.meta.url), "utf8");
    const start = src.indexOf("private readonly chestFrame");
    expect(start).toBeGreaterThan(-1);
    const frame = src.slice(start, src.indexOf("};", start));
    expect(frame).toMatch(/nameOf:\s*chestNameOf\(/);
    expect(frame).not.toMatch(/players\.get\(id\)\?\.name/);
  });
});
