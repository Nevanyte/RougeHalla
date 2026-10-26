import { describe, expect, it, vi } from "vitest";
import { buffToast, FACTIONS, type BuffId, type TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";
import { Toasts } from "../src/ui/toast";
import { argsOf, fakeScene, FakeEl, installFakeDom } from "./fakes";

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

// The local player's buff news and the remote floats (Phase 11, R4a: one buff per mob type).
describe("FxView buff news", () => {
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
  const buff = (id: string, b: BuffId, stacks: number, total: number): TimedFx => ({ kind: "buff", id, buff: b, stacks, total, t: 0 });
  const death = (id: string, by: string | null): TimedFx => ({ kind: "death", id, x: 50, y: 60, by, t: 0 });

  it("keeps a single event's own wording: the name, the stacks gained and held, and what they give", () => {
    const { lines, play } = news();
    play([buff("me", "emberImp", 1.1, 1.1)]);
    expect(lines).toEqual([[buffToast("emberImp", 1.1, 1.1), "buff"]]);
    expect(lines[0]![0]).toMatch(/^Ember Imp \+1\.1 \(1\.1\): \+\d+(\.\d)?% damage$/);
  });

  it("tells a bounty kill's buffs as one line, in the order gained, the rest counted", () => {
    const { lines, play } = news();
    // transferBuffs grants each buff the victim held in turn; the victim's death line comes with them.
    play([
      death("foe", "me"),
      buff("me", "emberImp", 2, 4), buff("me", "bailiff", 1.5, 3), buff("me", "acolyte", 1, 2), buff("me", "bloodSaint", 0.5, 1),
    ]);
    expect(lines).toEqual([
      ["Foe was killed", undefined],
      ["Ember Imp +2.0, Bailiff +1.5, Acolyte +1.0 and 1 more", "buff"],
    ]);
  });

  it("keeps the toast stack's three slots for all of it: the buff news is not pushed out", () => {
    vi.useFakeTimers();
    const { ui } = installFakeDom();
    const toasts = new Toasts();
    const { play } = news({ announce: (text, tone) => toasts.show(text, tone) });
    play([
      death("foe", "me"), { kind: "bounty", id: "foe", name: "Foe", bounty: 90, t: 0 },
      buff("me", "emberImp", 2, 4), buff("me", "bailiff", 2, 4), buff("me", "acolyte", 2, 4),
    ]);
    const root = (ui.children[0] as FakeEl).children as FakeEl[];
    const shown = root.filter((n) => !n.removed).map((n) => n.textContent);
    expect(shown).toHaveLength(3);
    expect(shown[2]).toBe("Ember Imp +2.0, Bailiff +2.0, Acolyte +2.0");
    expect(root.filter((n) => !n.removed).map((n) => n.className)[2]).toBe("toast buff");
    toasts.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sums a buff gained twice in one frame into one line with the latest total", () => {
    const { lines, play } = news();
    play([buff("me", "plagueRat", 1.1, 1.1), buff("me", "plagueRat", 1.1, 2.2)]);
    expect(lines).toEqual([[buffToast("plagueRat", 2.2, 2.2), "buff"]]);
  });

  it("tells the news of different frames separately, and says nothing for a frame without any", () => {
    const { fx, lines, play } = news();
    play([buff("me", "emberImp", 1.1, 1.1)], 1000);
    fx.update(1050, 0, true);
    play([buff("me", "bailiff", 1.1, 1.1)], 1100);
    expect(lines.map(([text]) => text)).toEqual([buffToast("emberImp", 1.1, 1.1), buffToast("bailiff", 1.1, 1.1)]);
  });

  it("floats other players' gains over them, in the buff's name, instead of toasting them", () => {
    const { lines, play, ofKind } = news();
    play([buff("foe", "plagueRat", 1.1, 1.1)]);
    expect(lines).toEqual([]);
    expect(ofKind("text").map((t) => t.state.text)).toEqual(["+1.1 Plague Rat"]);
  });

  it("rings the fighter in the buff's zone colour, for the local player and for others", () => {
    const { play, ofKind } = news();
    play([buff("foe", "iceGolem", 1.1, 1.1)]);
    play([buff("me", "emberImp", 1.1, 1.1)], 1100);
    const rings = ofKind("graphics");
    expect(rings).toHaveLength(2);
    expect(argsOf(rings[0]!, "lineStyle")[0]![1]).toBe(FACTIONS.frost.color);
    expect(argsOf(rings[1]!, "lineStyle")[0]![1]).toBe(FACTIONS.fire.color);
  });

  it("names a buff this build does not know by its id, and never throws on it", () => {
    const { lines, play, ofKind } = news();
    play([buff("me", "fromANewerServer" as BuffId, 1, 1), buff("foe", "fromANewerServer" as BuffId, 1, 1)]);
    expect(lines).toEqual([["fromANewerServer +1.0 (1.0)", "buff"]]);
    expect(ofKind("text").map((t) => t.state.text)).toEqual(["+1.0 fromANewerServer"]);
  });

  it("ignores a drop of nothing and a fighter it cannot place", () => {
    const { lines, play, made } = news({ position: () => undefined });
    play([buff("me", "emberImp", 0, 0)]);
    play([buff("foe", "emberImp", 1.1, 1.1)], 1100);
    expect(lines).toEqual([]);
    expect(made).toEqual([]);
  });

  it("does not announce into the void when the host has no sink", () => {
    const { play } = news({ announce: undefined });
    expect(() => play([buff("me", "emberImp", 1.1, 1.1)])).not.toThrow();
  });

  it("drops the retired combo event without a trace", () => {
    const { lines, play, made } = news();
    // Code 11 never reaches the view (unpackFx drops it), but an old queue entry of that kind must be a no-op too.
    play([{ kind: "combo", id: "me", combo: "dash", proc: false, t: 0 } as unknown as TimedFx]);
    expect(lines).toEqual([]);
    expect(made).toEqual([]);
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

// Wishes: casts and statuses are handed to WishFx at render time, a stun drops the stunned fighter's windup, and a burning
// ability's tick is a drip like a signature's.
describe("FxView casts and statuses", () => {
  function rig(host: Partial<FxHost> = {}) {
    const delivered: Array<[TimedFx, number]> = [];
    const flashes: string[] = [];
    const { scene, made, ofKind } = fakeScene();
    const full: FxHost = {
      localId: "me", view: (id) => ({ flash: () => flashes.push(id) }), position: () => ({ x: 100, y: 100 }), name: () => undefined,
      projectileEnded: () => {}, wishFx: (fx, now) => delivered.push([fx, now]), ...host,
    };
    const fx = new FxView(scene, full);
    return { fx, delivered, flashes, made, ofKind };
  }
  const cast = (t: number): TimedFx => ({ kind: "cast", by: "foe", ability: "freeze", ms: 250, target: "me", x: 1, y: 2, t });
  const landed = (t: number): TimedFx => ({ kind: "castLand", by: "foe", ability: "freeze", target: "me", x: 1, y: 2, t });
  const ended = (t: number): TimedFx => ({ kind: "castEnd", by: "foe", ability: "trial", reason: "fizzle", t });
  const status = (id: string, kind: "stun" | "root", t: number): TimedFx => ({ kind: "status", id, status: kind, ms: 1250, by: "foe", t });
  const windup = (by: string, t: number): TimedFx => ({ kind: "windup", by, weapon: "sword", a: 0, ms: 300, t });

  it("hands cast, castLand, castEnd and status to the host when render time reaches them, with the clock they run on", () => {
    const { fx, delivered } = rig();
    for (const e of [cast(1000), landed(1250), ended(1300), status("me", "root", 1350)]) fx.enqueue(e);
    fx.update(900, 5, true);
    expect(delivered).toEqual([]);
    fx.update(1260, 77, true);
    expect(delivered.map(([e]) => e.kind)).toEqual(["cast", "castLand"]);
    expect(delivered.every(([, now]) => now === 77)).toBe(true);
    fx.update(1400, 88, true);
    expect(delivered.map(([e]) => e.kind)).toEqual(["cast", "castLand", "castEnd", "status"]);
    expect(delivered[3]![1]).toBe(88);
  });

  it("plays them at once while the clock is unsynced", () => {
    const { fx, delivered } = rig();
    fx.enqueue(cast(90000));
    fx.update(0, 3, false);
    expect(delivered).toHaveLength(1);
  });

  it("does not need a host sink", () => {
    const { fx } = rig({ wishFx: undefined });
    fx.enqueue(cast(1000));
    fx.enqueue(status("me", "stun", 1000));
    expect(() => fx.update(1000, 0, true)).not.toThrow();
  });

  it("drops the stunned fighter's windup telegraph, and only theirs", () => {
    const { fx, ofKind } = rig();
    fx.enqueue(windup("foe", 1000));
    fx.enqueue(windup("ally", 1000));
    fx.update(1000, 0, true);
    const [foe, ally] = ofKind("graphics");
    expect(foe!.state.visible).toBe(true);
    fx.enqueue(status("foe", "stun", 1100));
    fx.update(1100, 50, true);
    expect(foe!.state.visible).toBe(false);
    expect(ally!.state.visible).toBe(true);
  });

  it("leaves a windup alone for a status that is not a stun", () => {
    const { fx, ofKind } = rig();
    fx.enqueue(windup("foe", 1000));
    fx.update(1000, 0, true);
    fx.enqueue(status("foe", "root", 1100));
    fx.update(1100, 50, true);
    expect(ofKind("graphics")[0]!.state.visible).toBe(true);
  });

  it("still tells the host about the stun that dropped the windup", () => {
    const { fx, delivered } = rig();
    fx.enqueue(windup("foe", 1000));
    fx.enqueue(status("foe", "stun", 1000));
    fx.update(1000, 0, true);
    expect(delivered.map(([e]) => e.kind)).toEqual(["status"]);
  });
});

describe("FxView damage over time from an ability", () => {
  const burn = (amount: number, over: Partial<Extract<TimedFx, { kind: "hit" }>> = {}): TimedFx =>
    ({ kind: "hit", id: "foe", by: "me", amount, weapon: null, ability: "blaze", t: 1000, ...over }) as TimedFx;

  function rig() {
    const flashes: string[] = [];
    const localHits: number[] = [];
    const { scene, made, ofKind } = fakeScene();
    const host: FxHost = {
      localId: "me", view: (id) => ({ flash: () => flashes.push(id) }), position: () => ({ x: 100, y: 100 }), name: () => undefined,
      projectileEnded: () => {}, localHit: (fx) => localHits.push(fx.amount),
    };
    const fx = new FxView(scene, host);
    const play = (e: TimedFx) => { fx.enqueue(e); fx.update(1000, 0, true); };
    return { play, flashes, localHits, made, ofKind };
  }

  it("does not flash the body for a burning tick", () => {
    const { play, flashes } = rig();
    play(burn(15));
    expect(flashes).toEqual([]);
  });

  it("flashes for a blow, as before (a weapon hit, an ability that is not over time)", () => {
    const { play, flashes } = rig();
    play({ kind: "hit", id: "foe", by: "me", amount: 40, weapon: "sword", t: 1000 });
    play(burn(40, { ability: "freeze" }));
    expect(flashes).toEqual(["foe", "foe"]);
  });

  it("prints the tick as a small number in the ability's colour, not a blow's size or colour", () => {
    const { play, ofKind } = rig();
    play(burn(15));
    const text = ofKind("text")[0]!;
    expect(text.state.text).toBe("15");
    expect(text.state.color).toBe("#ff7043");
    expect(text.state.fontSize).toBe(11);
  });

  it("prints nothing for a chunk that rounds to nothing", () => {
    const { play, ofKind } = rig();
    play(burn(0.3));
    expect(ofKind("text")).toHaveLength(0);
  });

  it("makes no impact burst for a burning tick", () => {
    const { play, ofKind } = rig();
    play(burn(15));
    expect(ofKind("graphics")).toHaveLength(0);
  });

  it("still reports the hit on the local player to the host (the scene decides about the vignette)", () => {
    const { play, localHits } = rig();
    play(burn(15, { id: "me", by: "foe" }));
    expect(localHits).toEqual([15]);
  });
});
