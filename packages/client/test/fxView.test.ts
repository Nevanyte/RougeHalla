import { describe, expect, it, vi } from "vitest";
import { buffToast, COMBOS, comboToast, type BuffStat, type ComboId, type TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";
import { Toasts } from "../src/ui/toast";
import { fakeScene, FakeEl, installFakeDom } from "./fakes";

function setup() {
  const localHits: number[] = [];
  const host: FxHost = {
    localId: "me",
    view: () => undefined,
    position: () => undefined,
    name: () => undefined,
    projectileEnded: () => {},
    localHit: (fx) => localHits.push(fx.amount),
  };
  // Nothing here draws: a hit with no known position ends before it makes any Graphics or Text.
  const fx = new FxView({} as never, host);
  return { fx, localHits };
}

const hit = (id: string, amount: number, t: number): TimedFx => ({ kind: "hit", id, by: "foe", amount, weapon: "sword", t });

describe("FxView local hits", () => {
  it("reports a hit on the local player when render time reaches it, not when it arrives", () => {
    const { fx, localHits } = setup();
    fx.enqueue(hit("me", 80, 1000));
    fx.update(900, 0, true);
    expect(localHits).toEqual([]);
    fx.update(1000, 16, true);
    expect(localHits).toEqual([80]);
    fx.update(1100, 32, true);
    expect(localHits).toEqual([80]);
  });

  it("ignores hits on anyone else", () => {
    const { fx, localHits } = setup();
    fx.enqueue(hit("foe", 80, 1000));
    fx.update(1100, 0, true);
    expect(localHits).toEqual([]);
  });

  it("plays at once while the clock is unsynced", () => {
    const { fx, localHits } = setup();
    fx.enqueue(hit("me", 30, 5000));
    fx.update(0, 0, false);
    expect(localHits).toEqual([30]);
  });
});

// The local player's buff and combo news, a mob's death line and the remote floats (Phase 11).
describe("FxView buff and combo news", () => {
  const NAMES: Record<string, string> = { me: "Me", foe: "Foe", elite1: "Warden", mob1: "Grunt" };
  const KINDS: Record<string, string> = { elite1: "elite", mob1: "mob" };

  function news(host: Partial<FxHost> = {}) {
    const lines: Array<[string, string | undefined]> = [];
    const { scene, made, ofKind } = fakeScene();
    const full: FxHost = {
      localId: "me", view: () => undefined, position: () => ({ x: 100, y: 100 }), name: (id) => NAMES[id], mobKind: (id) => KINDS[id],
      projectileEnded: () => {}, announce: (text, tone) => lines.push([text, tone]), ...host,
    };
    const fx = new FxView(scene, full);
    /** Enqueues `events` (all stamped t) and plays them in one frame. */
    const play = (events: TimedFx[], t = 1000) => {
      for (const e of events) fx.enqueue({ ...e, t } as TimedFx);
      fx.update(t, 0, true);
    };
    return { fx, lines, made, ofKind, play };
  }
  const buff = (id: string, stat: BuffStat, stacks: number, total: number): TimedFx => ({ kind: "buff", id, stat, stacks, total, t: 0 });
  const combo = (id: string, name: ComboId, proc = false): TimedFx => ({ kind: "combo", id, combo: name, proc, t: 0 });
  const death = (id: string, by: string | null): TimedFx => ({ kind: "death", id, x: 50, y: 60, by, t: 0 });

  it("tells a bounty kill's six news lines as one buff line and one combo line, the combo last", () => {
    const { lines, play } = news();
    // transferStacks grants each stat in turn: buff, combo, buff, combo, buff, combo; the victim's death line comes with them.
    play([
      death("foe", "me"),
      buff("me", "hp", 2, 4), combo("me", "shield"),
      buff("me", "attackSpeed", 2, 4), combo("me", "dash"),
      buff("me", "moveSpeed", 2, 4), combo("me", "bloodrush"),
    ]);
    expect(lines).toEqual([
      ["Foe was killed", undefined],
      ["+2.0 Max HP, +2.0 Attack speed, +2.0 Move speed", "buff"],
      ["Combos unlocked: Shield on kill, Dash on kill, Bloodrush", "combo"],
    ]);
  });

  it("names a bot with the host's tagged name in the bounty and victory lines, and falls back to the event's own name", () => {
    const { lines, play } = news({ name: (id) => (id === "foe" ? "[BOT] Foe" : undefined) });
    play([
      { kind: "bounty", id: "foe", name: "Foe", bounty: 90, t: 0 },
      { kind: "victory", id: "foe", name: "Foe", draw: false, t: 0 },
      { kind: "bounty", id: "gone", name: "Gone", bounty: 40, t: 0 },
      { kind: "victory", id: "gone", name: "Gone", draw: false, t: 0 },
    ]);
    expect(lines.map(([text]) => text)).toEqual([
      "[BOT] Foe is on a rampage — bounty 90 GV", "[BOT] Foe is victorious", "Gone is on a rampage — bounty 40 GV", "Gone is victorious",
    ]);
  });

  it("keeps the toast stack's three slots for all of it: the combo unlock is not pushed out", () => {
    vi.useFakeTimers();
    const { ui } = installFakeDom();
    const toasts = new Toasts();
    const { play } = news({ announce: (text, tone) => toasts.show(text, tone) });
    play([
      death("foe", "me"), { kind: "bounty", id: "foe", name: "Foe", bounty: 90, t: 0 },
      buff("me", "hp", 2, 4), combo("me", "shield"), buff("me", "attackSpeed", 2, 4), combo("me", "dash"),
    ]);
    const root = (ui.children[0] as FakeEl).children as FakeEl[];
    const shown = root.filter((n) => !n.removed).map((n) => n.textContent);
    expect(shown).toHaveLength(3);
    expect(shown[2]).toBe("Combos unlocked: Shield on kill, Dash on kill");
    expect(shown[1]).toBe("+2.0 Max HP, +2.0 Attack speed");
    toasts.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a single event's own wording", () => {
    const { lines, play } = news();
    play([buff("me", "attackSpeed", 1.1, 1.1)]);
    play([combo("me", "dash")], 1100);
    expect(lines).toEqual([
      [buffToast("attackSpeed", 1.1, 1.1), "buff"],
      [comboToast(COMBOS.find((c) => c.id === "dash")!), "combo"],
    ]);
    expect(lines[0]![0]).toBe("+1.1 Attack speed (1.1)");
    expect(lines[1]![0]).toBe("Combo unlocked: Dash on kill");
  });

  it("sums a stat gained twice in one frame into one line with the latest total", () => {
    const { lines, play } = news();
    play([buff("me", "attackSpeed", 1.1, 1.1), buff("me", "attackSpeed", 1.1, 2.2)]);
    expect(lines).toEqual([["+2.2 Attack speed (2.2)", "buff"]]);
  });

  it("tells the news of different frames separately, and says nothing for a frame without any", () => {
    const { fx, lines, play } = news();
    play([buff("me", "hp", 1.1, 1.1)], 1000);
    fx.update(1050, 0, true);
    play([combo("me", "shield")], 1100);
    expect(lines.map(([text]) => text)).toEqual(["+1.1 Max HP (1.1)", "Combo unlocked: Shield on kill"]);
  });

  it("floats other players' news over them instead of toasting it", () => {
    const { lines, play, ofKind } = news();
    play([buff("foe", "attackSpeed", 1.1, 1.1), combo("foe", "dash")]);
    expect(lines).toEqual([]);
    const texts = ofKind("text").map((t) => t.state.text);
    expect(texts).toEqual(["+1.1 Attack speed", "Dash on kill!"]);
    expect(ofKind("graphics")).toHaveLength(1); // the ring around the fighter that unlocked a combo
  });

  it("answers a combo that fires on a kill with a ring and no toast", () => {
    const { lines, play, ofKind } = news();
    play([combo("me", "shield", true)]);
    expect(lines).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(1);
  });

  it("ignores a combo id it does not know, a drop of nothing and a fighter it cannot place", () => {
    const { lines, play, made } = news({ position: () => undefined });
    play([combo("me", "from-a-newer-server" as ComboId), combo("foe", "from-a-newer-server" as ComboId), buff("me", "hp", 0, 0)]);
    play([combo("foe", "dash"), buff("foe", "hp", 1.1, 1.1)], 1100);
    expect(lines).toEqual([]);
    expect(made).toEqual([]);
  });

  it("does not announce into the void when the host has no sink", () => {
    const { play } = news({ announce: undefined });
    expect(() => play([buff("me", "hp", 1.1, 1.1), combo("me", "shield")])).not.toThrow();
  });
});

describe("FxView regional mob deaths", () => {
  const death = (id: string, by: string | null): TimedFx => ({ kind: "death", id, x: 50, y: 60, by, t: 1000 });
  function setup(names: Record<string, string | undefined>, kinds: Record<string, string>) {
    const lines: string[] = [];
    const { scene, made } = fakeScene();
    const host: FxHost = {
      localId: "me", view: () => undefined, position: () => undefined, name: (id) => names[id], mobKind: (id) => kinds[id],
      projectileEnded: () => {}, announce: (text) => lines.push(text),
    };
    const fx = new FxView(scene, host);
    const play = (e: TimedFx) => { fx.enqueue(e); fx.update(1000, 0, true); };
    return { lines, made, play };
  }

  it("gives an elite one line naming its killer, and a normal mob none", () => {
    const { lines, play, made } = setup({ elite1: "Warden", mob1: "Grunt", foe: "Foe" }, { elite1: "elite", mob1: "mob" });
    play(death("mob1", "foe"));
    expect(lines).toEqual([]);
    play(death("elite1", "foe"));
    expect(lines).toEqual(["Warden was slain by Foe"]);
    expect(made.length).toBe(2); // a burst each, and no red X on the ground (a player's death draws one)
  });

  it("names the elite alone when nobody is credited or the killer is unknown", () => {
    const { lines, play } = setup({ elite1: "Warden" }, { elite1: "elite" });
    play(death("elite1", null));
    play(death("elite1", "gone"));
    expect(lines).toEqual(["Warden was slain", "Warden was slain"]);
  });

  it("says nothing for an elite whose name is unknown, and still calls a player's death a kill", () => {
    const { lines, play } = setup({ foe: "Foe" }, { elite1: "elite" });
    play(death("elite1", "foe"));
    expect(lines).toEqual([]);
    play(death("foe", "me"));
    expect(lines).toEqual(["Foe was killed"]);
  });
});
