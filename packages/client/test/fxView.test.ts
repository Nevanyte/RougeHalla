import { describe, expect, it } from "vitest";
import { type TimedFx } from "@raid/shared";
import { FxView, type FxHost } from "../src/render/FxView";
import { fakeScene } from "./fakes";

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

// The announcements the view hands its host: a kill, a rampage, a victory. (The retired buff event used to add the local
// player's buff news and a ring and a float for everyone; with the cards it plays nothing.)
describe("FxView announcements", () => {
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
  const death = (id: string, by: string | null): TimedFx => ({ kind: "death", id, x: 50, y: 60, by, t: 0 });

  it("tells a kill as one plain line", () => {
    const { lines, play } = news();
    play([death("foe", "me")]);
    expect(lines).toEqual([["Foe was killed", undefined]]);
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

  it("drops the retired buff and combo events without a trace", () => {
    const { lines, play, made } = news();
    // Codes 10 and 11 never reach the view (unpackFx drops them), but an old queue entry of either kind must be a no-op too.
    play([
      { kind: "buff", id: "me", buff: "emberImp", stacks: 1.1, total: 1.1, t: 0 } as unknown as TimedFx,
      { kind: "combo", id: "me", combo: "dash", proc: false, t: 0 } as unknown as TimedFx,
    ]);
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

  it("treats a zombie death as a quiet fighter burst rather than a player kill announcement", () => {
    const { lines, play, made } = setup({ z: "Morrow's zombie", foe: "Foe" }, { z: "zombie" });
    play(death("z", "foe"));
    expect(lines).toEqual([]);
    expect(made.length).toBe(1);
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
