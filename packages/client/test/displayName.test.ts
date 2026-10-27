import { describe, expect, it } from "vitest";
import { BOT_TAG, displayName, playerLabel, winnerLabel } from "../src/render/displayName";

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
