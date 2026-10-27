// The chest panel's rules (ui/chestMath.ts), pure: the range of the panel, the grey-out time, which chest it shows, what each card
// is and may be, and what the status line says.
import { describe, expect, it } from "vitest";
import {
  CHEST_GREY_MS, CHEST_PANEL_HYSTERESIS, CHEST_PANEL_SLACK, CHEST_RANGE, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, mapFromTiles, skipText,
} from "@raid/shared";
import {
  ChestMemory, DEFAULT_RTT_MS, chestPickLine, PANEL_CLOSE_RANGE, PANEL_RANGE, campLabel, rttFromOrderDelay, usableRtt, formatCountdown, greyAtMs, hasPicked, inPanelRange, isGreyed, myPick, optionCards, pickReward, poolName, rankBadge,
  pickLine, readReward, stateText, statusText, takenIndex, timeShare, trueServerNow, type Reward, type RewardSource,
} from "../src/ui/chestMath";

const source = (over: Partial<RewardSource> = {}): RewardSource => ({
  kind: "reward", x: 500, y: 500, camp: 2, expiresAt: 20_000, options: ["pestilence", "whetstone", "swiftBoots"],
  takenBy: ["", "", ""], pickers: [], ...over,
});
const reward = (over: Partial<Reward> = {}): Reward => ({ ...readReward(source(), "c1")!, ...over });

describe("readReward", () => {
  it("copies a reward container out of the state, and refuses every other kind", () => {
    const r = readReward(source({ options: { length: 2, 0: "whetstone", 1: "swiftBoots", [Symbol.iterator]: Array.prototype[Symbol.iterator] } as never }), "c1");
    expect(r).toMatchObject({ id: "c1", x: 500, y: 500, camp: 2, expiresAt: 20_000, options: ["whetstone", "swiftBoots"] });
    for (const kind of ["chest", "ground", "body"]) expect(readReward(source({ kind }), "x")).toBeNull();
  });

  it("pads a takenBy that is short of the options with free slots (a patch half applied)", () => {
    expect(readReward(source({ takenBy: [] }), "c1")!.takenBy).toEqual(["", "", ""]);
    expect(readReward(source({ takenBy: ["bob"] }), "c1")!.takenBy).toEqual(["bob", "", ""]);
  });
});

describe("range", () => {
  it("opens within the server's range less the slack, never at the edge of the server's own", () => {
    expect(PANEL_RANGE).toBe(CHEST_RANGE - CHEST_PANEL_SLACK);
    expect(inPanelRange({ x: 0, y: 0 }, { x: PANEL_RANGE, y: 0 })).toBe(true);
    expect(inPanelRange({ x: 0, y: 0 }, { x: PANEL_RANGE + 0.5, y: 0 })).toBe(false);
    // The server would accept this (96 u), the panel does not offer it: the position it holds can be a step behind.
    expect(inPanelRange({ x: 0, y: 0 }, { x: CHEST_RANGE - 1, y: 0 })).toBe(false);
    expect(inPanelRange({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(true);
  });
});

describe("range, with hysteresis", () => {
  it("an open panel stays until the player is PANEL_CLOSE_RANGE away, still inside the server's range", () => {
    expect(PANEL_CLOSE_RANGE).toBe(PANEL_RANGE + CHEST_PANEL_HYSTERESIS);
    expect(PANEL_CLOSE_RANGE).toBe(92);
    expect(PANEL_CLOSE_RANGE).toBeLessThan(CHEST_RANGE);
    const o = { x: 0, y: 0 };
    expect(inPanelRange(o, { x: PANEL_RANGE + 1, y: 0 })).toBe(false); // not open: it does not open here
    expect(inPanelRange(o, { x: PANEL_RANGE + 1, y: 0 }, true)).toBe(true); // open: it stays
    expect(inPanelRange(o, { x: PANEL_CLOSE_RANGE, y: 0 }, true)).toBe(true);
    expect(inPanelRange(o, { x: PANEL_CLOSE_RANGE + 0.5, y: 0 }, true)).toBe(false);
  });

  it("pickReward holds the chest it is told is open out to the close range, and no other", () => {
    const edge = reward({ id: "edge", x: 500 + PANEL_RANGE + 2, y: 500 });
    const other = reward({ id: "other", x: 500, y: 500 + PANEL_RANGE + 2 });
    const from = { x: 500, y: 500 };
    expect(pickReward([edge, other], from, "me", 1000)).toBeNull();
    expect(pickReward([edge, other], from, "me", 1000, null, "edge")?.reward.id).toBe("edge");
    expect(pickReward([edge, other], from, "me", 1000, null, "other")?.reward.id).toBe("other");
    expect(pickReward([edge, other], from, "me", 1000, null, "gone")).toBeNull();
    const far = reward({ id: "edge", x: 500 + PANEL_CLOSE_RANGE + 1, y: 500 });
    expect(pickReward([far], from, "me", 1000, null, "edge")).toBeNull();
  });
});

describe("the round trip the chest's clock uses", () => {
  it("is one clamp for the panel and the ring: never negative, the default when it is not a number", () => {
    expect(usableRtt(80)).toBe(80);
    expect(usableRtt(0)).toBe(0);
    expect(usableRtt(-30)).toBe(0);
    expect(usableRtt(Number.NaN)).toBe(DEFAULT_RTT_MS);
    expect(usableRtt(Infinity)).toBe(DEFAULT_RTT_MS);
  });

  it("is the prediction's order delay plus a tick (the delay runs up to a tick short), and a delay of -1 tick is no round trip", () => {
    expect(rttFromOrderDelay(60)).toBe(60 + TICK_MS);
    expect(rttFromOrderDelay(-TICK_MS)).toBe(0); // the lowest delay the prediction reports
    expect(rttFromOrderDelay(-1000)).toBe(0);
    expect(rttFromOrderDelay(Number.NaN)).toBe(DEFAULT_RTT_MS);
    // A pick sent just before the grey-out is no longer offered where the old (unadjusted) delay still offered it.
    const delay = 60;
    const expiresAt = 15_000;
    const estimate = expiresAt - delay - CHEST_GREY_MS - 20; // 20 ms inside the old margin
    expect(isGreyed(expiresAt, trueServerNow(estimate, delay), delay)).toBe(false);
    expect(isGreyed(expiresAt, trueServerNow(estimate, rttFromOrderDelay(delay)), rttFromOrderDelay(delay))).toBe(true);
  });
});

describe("ChestMemory", () => {
  it("keeps a chest's options for a few seconds after it was last seen, and forgets it then", () => {
    const m = new ChestMemory();
    m.note("c1", ["whetstone", "swiftBoots", "thickHide"], 1000);
    expect(m.option("c1", 1)).toBe("swiftBoots");
    expect(m.option("c1", 3)).toBeUndefined();
    expect(m.option("c2", 0)).toBeUndefined();
    m.forget(1000 + ChestMemory.KEEP_MS);
    expect(m.size).toBe(1);
    m.note("c1", ["whetstone", "swiftBoots", "thickHide"], 4000); // seen again: the clock restarts
    m.forget(4000 + ChestMemory.KEEP_MS);
    expect(m.size).toBe(1);
    m.forget(4000 + ChestMemory.KEEP_MS + 1);
    expect(m.size).toBe(0);
    expect(m.option("c1", 0)).toBeUndefined();
  });

  it("copies the options (a schema array changes under it)", () => {
    const live = ["whetstone", "swiftBoots"];
    const m = new ChestMemory();
    m.note("c1", live, 0);
    live.length = 0;
    expect(m.option("c1", 0)).toBe("whetstone");
  });
});

describe("chestPickLine: the local player's own pick as a line", () => {
  const rank = (held: Record<string, number>) => (skill: string): number => held[skill] ?? 0;
  it("names the skill from the chest in the state, and from memory when the chest left it first", () => {
    const m = new ChestMemory();
    m.note("c1", ["pestilence", "whetstone", "swiftBoots"], 0);
    const live = ["pestilence", "whetstone", "swiftBoots"];
    expect(chestPickLine("c1", 1, live, m, rank({ whetstone: 1 }))).toBe("You took Whetstone");
    expect(chestPickLine("c1", 1, live, m, rank({ whetstone: 2 }))).toBe("You took Whetstone (rank 2)");
    // A pick in the chest's last ~100 ms is played after the chest has gone: the memory still has its cards.
    expect(chestPickLine("c1", 2, undefined, m, rank({ swiftBoots: 1 }))).toBe("You took Swift Boots");
    expect(chestPickLine("c1", 2, undefined, new ChestMemory(), rank({}))).toBeUndefined(); // never seen: no line, no crash
    expect(chestPickLine("c1", 7, undefined, m, rank({}))).toBeUndefined();
  });

  it("a skip needs neither the chest nor the memory", () => {
    expect(chestPickLine("gone", -1, undefined, new ChestMemory(), rank({}))).toBe("You skipped the chest");
  });
});

describe("time", () => {
  it("greys at RTT/2 + CHEST_GREY_MS before expiry, in the server's own time", () => {
    expect(greyAtMs(15_000, 100)).toBe(15_000 - (50 + CHEST_GREY_MS));
    expect(greyAtMs(15_000, 0)).toBe(15_000 - CHEST_GREY_MS);
    // A negative or missing round trip counts as none.
    expect(greyAtMs(15_000, -40)).toBe(15_000 - CHEST_GREY_MS);
    expect(isGreyed(15_000, 14_899, 100)).toBe(false);
    expect(isGreyed(15_000, 14_900, 100)).toBe(true);
    expect(isGreyed(15_000, 16_000, 100)).toBe(true);
  });

  it("reads the server's time as the client's estimate plus half the round trip (the estimate runs a one way trip behind)", () => {
    expect(trueServerNow(1000, 100)).toBe(1050);
    expect(trueServerNow(1000, -5)).toBe(1000);
    // So on the client's own clock the chest greys a full round trip plus the margin before expiry.
    const rtt = 80;
    const greyOnEstimate = 15_000 - rtt - CHEST_GREY_MS;
    expect(isGreyed(15_000, trueServerNow(greyOnEstimate - 1, rtt), rtt)).toBe(false);
    expect(isGreyed(15_000, trueServerNow(greyOnEstimate, rtt), rtt)).toBe(true);
  });

  it("counts down in whole seconds, a part of a second as one, never below zero", () => {
    expect(formatCountdown(15_000)).toBe("0:15");
    expect(formatCountdown(14_001)).toBe("0:15");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-500)).toBe("0:00");
    expect(formatCountdown(Number.NaN)).toBe("0:00");
    expect(formatCountdown(75_000)).toBe("1:15");
  });

  it("is a share of the chest's lifetime left, held in 0..1", () => {
    expect(timeShare(15_000, 0, 15_000)).toBe(1);
    expect(timeShare(15_000, 7_500, 15_000)).toBe(0.5);
    expect(timeShare(15_000, 20_000, 15_000)).toBe(0);
    expect(timeShare(15_000, -5_000, 15_000)).toBe(1);
    expect(timeShare(15_000, 0, 0)).toBe(0);
  });
});

describe("pickReward: which chest the panel shows", () => {
  const me = { x: 500, y: 500 };
  const open = (id: string, x: number, y: number, over: Partial<Reward> = {}): Reward => reward({ id, x, y, ...over });

  it("shows a live chest in range and nothing for one out of range or expired", () => {
    expect(pickReward([open("a", 560, 500)], me, "me", 1000)?.reward.id).toBe("a");
    expect(pickReward([open("a", 500 + PANEL_RANGE + 1, 500)], me, "me", 1000)).toBeNull();
    expect(pickReward([open("a", 560, 500, { expiresAt: 1000 })], me, "me", 1000)).toBeNull();
    expect(pickReward([open("a", 560, 500, { expiresAt: 1001 })], me, "me", 1000)).not.toBeNull();
    expect(pickReward([], me, "me", 1000)).toBeNull();
  });

  it("takes the nearest of several, and one the player has not picked at before one they have", () => {
    const near = open("near", 520, 500);
    const far = open("far", 570, 500);
    expect(pickReward([far, near], me, "me", 1000)?.reward.id).toBe("near");
    const pickedNear = open("near", 520, 500, { pickers: ["me"] });
    const got = pickReward([pickedNear, far], me, "me", 1000);
    expect(got?.reward.id).toBe("far");
    expect(got?.picked).toBe(false);
    // Only picked chests in range: the nearest of them is the summary.
    const only = pickReward([pickedNear, open("other", 560, 500, { pickers: ["me"] })], me, "me", 1000);
    expect(only).toMatchObject({ picked: true });
    expect(only?.reward.id).toBe("near");
  });

  it("needs a clear line to the chest when it is given the walls (the server refuses a pick through one)", () => {
    const tiles = new Uint8Array(20 * 20).fill(TILE_FLOOR);
    for (let y = 0; y < 20; y++) tiles[y * 20 + 8] = TILE_WALL;
    const map = mapFromTiles(20, 20, tiles);
    const from = { x: 7.5 * TILE, y: 5 * TILE };
    const behind = open("w", 9.5 * TILE, 5 * TILE);
    expect(inPanelRange(from, behind)).toBe(true);
    expect(pickReward([behind], from, "me", 1000, map)).toBeNull();
    expect(pickReward([behind], from, "me", 1000)?.reward.id).toBe("w");
    const clear = open("c", 6 * TILE, 5 * TILE);
    expect(pickReward([clear], from, "me", 1000, map)?.reward.id).toBe("c");
  });
});

describe("picks of a chest", () => {
  it("knows who picked and which option they took", () => {
    const r = reward({ pickers: ["bob", "me"], takenBy: ["bob", "", "me"] });
    expect(hasPicked(r, "me")).toBe(true);
    expect(hasPicked(r, "eve")).toBe(false);
    expect(takenIndex(r, "me")).toBe(2);
    expect(takenIndex(r, "eve")).toBe(-1);
  });
});

describe("optionCards", () => {
  const ctx = { myId: "me", build: {} as Record<string, number>, faction: "plague", closed: false };

  it("offers a free card, a rank-2 offer for a skill held at rank 1, and a held-at-2 skill as maxed", () => {
    const cards = optionCards(reward(), { ...ctx, build: { whetstone: 1, swiftBoots: 2 } });
    expect(cards.map((c) => c.state.kind)).toEqual(["free", "free", "maxed"]);
    expect(cards.map((c) => c.pickable)).toEqual([true, true, false]);
    expect(cards[0]!.view).toMatchObject({ name: "Pestilence", rank: 1 });
    expect(cards[1]!.view).toMatchObject({ name: "Whetstone", rank: 2, maxed: false });
    expect(rankBadge(cards[0]!.view)).toBe("");
    expect(rankBadge(cards[1]!.view)).toBe("Rank 2");
  });

  it("words a skill for the picker's faction (Pestilence is a different line for Plague)", () => {
    const plague = optionCards(reward(), { ...ctx, faction: "plague" })[0]!.view!;
    const fire = optionCards(reward(), { ...ctx, faction: "fire" })[0]!.view!;
    expect(plague.text).not.toBe(fire.text);
  });

  it("marks what other players took, with who, and what this player took", () => {
    const r = reward({ takenBy: ["bob", "me", ""], pickers: ["bob", "me"] });
    const cards = optionCards(r, { ...ctx, build: { whetstone: 1 }, closed: true });
    expect(cards.map((c) => c.state)).toEqual([{ kind: "taken", by: "bob" }, { kind: "mine" }, { kind: "free" }]);
    // Their own pick reads at the rank they hold now, not the next one.
    expect(cards[1]!.view).toMatchObject({ rank: 1, maxed: false });
    expect(stateText(cards[0]!.state, (id) => (id === "bob" ? "Bob" : undefined))).toBe("Taken by Bob");
    expect(stateText(cards[0]!.state, () => undefined)).toBe("Taken by another player");
    expect(stateText(cards[1]!.state, () => undefined)).toBe("You took this");
  });

  it("offers nothing once the chest is closed to this player (picked, or about to vanish), whatever is free", () => {
    const cards = optionCards(reward(), { ...ctx, closed: true });
    expect(cards.every((c) => !c.pickable)).toBe(true);
    expect(cards.map((c) => c.state.kind)).toEqual(["free", "free", "free"]);
  });

  it("shows an id this build does not know and never offers it", () => {
    const cards = optionCards(reward({ options: ["fromNewerContent"], takenBy: [""] }), ctx);
    expect(cards[0]).toMatchObject({ view: null, state: { kind: "unknown" }, pickable: false });
    expect(stateText(cards[0]!.state, () => undefined)).toMatch(/not in this version/i);
  });

  it("names a pool: a zone by its faction's name, the neutral pool as Neutral", () => {
    const name = (z: string) => z.toUpperCase();
    expect(poolName("neutral", name)).toBe("Neutral");
    expect(poolName("fire", name)).toBe("FIRE");
  });
});

describe("statusText", () => {
  const base = { picked: null, pending: false, refused: null, greyed: false, anyPickable: true };

  it("says what the pick was, with the rank held", () => {
    expect(statusText({ ...base, picked: "skip" })).toBe("You skipped this chest.");
    expect(statusText({ ...base, picked: { skill: "whetstone", rank: 1 } })).toBe("You took Whetstone.");
    expect(statusText({ ...base, picked: { skill: "whetstone", rank: 2 } })).toBe("You took Whetstone (rank 2).");
  });

  it("puts a result first, then a pick on its way, then a refusal, then the chest about to vanish, then the rest", () => {
    expect(statusText({ ...base, pending: true, refused: "Already taken" })).toBe("Sending your pick...");
    expect(statusText({ ...base, refused: "Already taken", greyed: true })).toBe("Already taken.");
    expect(statusText({ ...base, refused: "Too far away." })).toBe("Too far away.");
    expect(statusText({ ...base, greyed: true })).toBe("This chest is about to vanish.");
    expect(statusText({ ...base, anyPickable: false })).toMatch(/Nothing left to take/);
    expect(statusText(base)).toMatch(/One pick per chest/);
  });

  it("finds the skill a player took, at the rank they hold", () => {
    expect(myPick(reward({ takenBy: ["", "me", ""] }), "me", { whetstone: 2 })).toEqual({ skill: "whetstone", rank: 2 });
    expect(myPick(reward(), "me", {})).toBeNull();
  });

  it("the skip line is the shared one", () => {
    expect(skipText()).toMatch(/^Skip: heal 15%/);
  });
});

describe("the feed lines", () => {
  it("names a cleared camp by its zone, an elite camp as such, and says nothing for a camp the map lacks", () => {
    expect(campLabel({ zone: "plague", eliteSpot: -1 })).toBe("Plague camp");
    expect(campLabel({ zone: "frost", eliteSpot: 0 })).toBe("Frost elite camp");
    expect(campLabel({ zone: "holy", eliteSpot: -1 })).toBe("Demon Blood camp");
    expect(campLabel(undefined)).toBeUndefined();
  });

  it("tells a pick as 'You took ...' with the rank held, a skip as one, and a skill this build lacks as nothing", () => {
    expect(pickLine(1, "whetstone", 1)).toBe("You took Whetstone");
    expect(pickLine(1, "whetstone", 2)).toBe("You took Whetstone (rank 2)");
    expect(pickLine(-1, undefined, 0)).toBe("You skipped the chest");
    expect(pickLine(0, "fromTheFuture", 1)).toBeUndefined();
    expect(pickLine(0, undefined, 0)).toBeUndefined();
  });
});
