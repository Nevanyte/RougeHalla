// The two fx the camp chests add (FxView): a camp cleared is told to everyone ("Plague camp cleared"), a pick at a chest is told
// to the player who made it ("You took Haste II"). Both play at render time like every fx, and only through the host's own
// words: a host that cannot say which camp or which card says nothing.
import { describe, expect, it } from "vitest";
import type { TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";

function setup(over: Partial<FxHost> = {}) {
  const lines: Array<[string, string | undefined]> = [];
  const host: FxHost = {
    localId: "me",
    view: () => undefined,
    position: () => undefined,
    name: () => undefined,
    projectileEnded: () => {},
    announce: (text, tone) => lines.push([text, tone]),
    ...over,
  };
  const fx = new FxView({} as never, host);
  return { fx, lines };
}

const cleared = (camp: number, t: number): TimedFx => ({ kind: "campCleared", camp, t });
const taken = (by: string, option: number, t: number, chest = "c1"): TimedFx => ({ kind: "chestTaken", chest, by, option, t });

describe("campCleared", () => {
  it("announces the camp by the host's label, when render time reaches it", () => {
    const asked: number[] = [];
    const { fx, lines } = setup({ campLabel: (camp) => { asked.push(camp); return camp === 2 ? "Plague camp" : undefined; } });
    fx.enqueue(cleared(2, 1000));
    fx.update(900, 0, true);
    expect(lines).toEqual([]);
    fx.update(1000, 16, true);
    expect(lines).toEqual([["Plague camp cleared", undefined]]);
    expect(asked).toEqual([2]);
  });

  it("says nothing for a camp the host does not know, and nothing without a host that can say", () => {
    const { fx, lines } = setup({ campLabel: () => undefined });
    fx.enqueue(cleared(9, 1000));
    fx.update(1100, 0, true);
    expect(lines).toEqual([]);
    const bare = setup();
    bare.fx.enqueue(cleared(0, 1000));
    bare.fx.update(1100, 0, true);
    expect(bare.lines).toEqual([]);
  });

  it("does not announce into the void when the host has no sink", () => {
    const { fx } = setup({ announce: undefined, campLabel: () => "Fire camp" });
    fx.enqueue(cleared(0, 1000));
    expect(() => fx.update(1100, 0, true)).not.toThrow();
  });
});

describe("chestTaken", () => {
  it("tells the local player's own pick, as good news", () => {
    const asked: Array<[string, number]> = [];
    const { fx, lines } = setup({ chestPick: (chest, option) => { asked.push([chest, option]); return "You took Haste II"; } });
    fx.enqueue(taken("me", 1, 1000));
    fx.update(1100, 0, true);
    expect(lines).toEqual([["You took Haste II", "ok"]]);
    expect(asked).toEqual([["c1", 1]]);
  });

  it("tells a skip as the host words it (option -1)", () => {
    const { fx, lines } = setup({ chestPick: (_c, option) => (option < 0 ? "You skipped the chest" : "You took it") });
    fx.enqueue(taken("me", -1, 1000));
    fx.update(1100, 0, true);
    expect(lines).toEqual([["You skipped the chest", "ok"]]);
  });

  it("is silent for another player's pick (their card shows it in the panel), and does not even ask the host", () => {
    let asked = 0;
    const { fx, lines } = setup({ chestPick: () => { asked++; return "x"; } });
    fx.enqueue(taken("bob", 0, 1000));
    fx.update(1100, 0, true);
    expect(lines).toEqual([]);
    expect(asked).toBe(0);
  });

  it("says nothing when the chest is no longer known to the host", () => {
    const { fx, lines } = setup({ chestPick: () => undefined });
    fx.enqueue(taken("me", 0, 1000));
    fx.update(1100, 0, true);
    expect(lines).toEqual([]);
  });
});
