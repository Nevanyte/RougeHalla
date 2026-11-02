// The local cues of the Wish and the potion keys, wired through RaidScene with a fake Phaser: the telegraph drawn at the key press
// is confirmed by the own cast fx and ended by the own castEnd on arrival (neither waits in FxView's render-time queue), and let
// go when a patch acks the cast with no cast fx; the potion key is checked with the server's words before anything is sent.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: { Scene: class {} } }));
import { CONSUMABLES, EFFECT_STUNNED, packFx, POTION_REFUSAL, type FxBatch, type FxEvent } from "@raid/shared";
import { LocalPrediction } from "../src/net/localPrediction";
import { PotionCue } from "../src/net/potionCue";
import { FxView } from "../src/render/FxView";
import { resetReducedMotionCache } from "../src/render/juice";
import { WishFx } from "../src/render/WishFx";
import { RaidScene } from "../src/scenes/RaidScene";
import { argsOf, fakeScene } from "./fakes";

afterEach(() => { vi.restoreAllMocks(); resetReducedMotionCache(); });

interface Wired {
  fx: FxView;
  wishFx: WishFx;
  predict: LocalPrediction;
  potionCue: PotionCue;
  room: {
    sessionId: string;
    send: (type: string, payload: unknown) => void;
    reconnection?: { isReconnecting: boolean };
    state: { phase: string; serverTime: number; roster: string[]; players: Map<string, Record<string, unknown>> };
  };
  ground: { combat: { note: (event: unknown) => void } };
  localAutos: { consume: () => undefined };
  localClock: (now: number) => number;
  warnDropped: () => void;
  announce: ((text: string) => void) | undefined;
  onFxBatch(batch: FxBatch): void;
  observeLocal(state: unknown): void;
  drinkPotion(): void;
}

const ROSTER = new Map([["me", 0], ["foe", 1]]);

function wired() {
  const { scene, made, ofKind } = fakeScene();
  const positions: Record<string, { x: number; y: number }> = { me: { x: 30, y: 40 }, foe: { x: 120, y: 40 } };
  const fx = new FxView(scene, {
    localId: "me", view: () => undefined, position: (id) => positions[id], name: () => undefined, projectileEnded: () => {},
  });
  const wishFx = new WishFx(scene, { localId: "me", position: (id) => positions[id] });
  const sent: Array<[string, unknown]> = [];
  const said: string[] = [];
  const me: Record<string, unknown> = {
    x: 30, y: 40, status: "alive", faction: "frost", slot: 0, weapon0: "sword", weapon1: "", moveSeq: 0, attackTarget: "", displaceSeq: 0,
    effects: 0, hp: 100, maxHp: 1000, potionLarge: 1, potionSmall: 0, potionsHealing: 0, healingUntil: 0,
  };
  const raid = new RaidScene() as unknown as Wired;
  raid.fx = fx;
  raid.wishFx = wishFx;
  raid.predict = new LocalPrediction();
  raid.room = {
    sessionId: "me", send: (type, payload) => sent.push([type, payload]),
    state: { phase: "active", serverTime: 0, roster: ["me", "foe"], players: new Map([["me", me]]) },
  };
  raid.ground = { combat: { note: () => {} } };
  raid.localAutos = { consume: () => undefined };
  raid.localClock = (now) => now;
  raid.warnDropped = () => {};
  raid.announce = (text) => said.push(text);
  const enqueued = vi.spyOn(fx, "enqueue");
  const batch = (events: FxEvent[], t: number) => packFx(events, t, { roster: ROSTER });
  const telegraphs = () => made.filter((g) => g.state.visible !== false && argsOf(g, "lineBetween").length > 0);
  return { raid, fx, wishFx, sent, said, me, enqueued, batch, telegraphs, made, ofKind };
}

const freezeCast: FxEvent = { kind: "cast", by: "me", ability: "freeze", ms: 250, target: "foe", x: 120, y: 40 };
const predicted = { by: "me", ability: "freeze" as const, ms: 250, target: "foe", x: 120, y: 40, seq: 7 };

describe("the own Wish telegraph through RaidScene", () => {
  it("is confirmed by the own cast fx on arrival, which then never enters the render-time queue", () => {
    const { raid, wishFx, enqueued, batch, telegraphs } = wired();
    wishFx.predictCast(predicted, 1000);
    vi.spyOn(performance, "now").mockReturnValue(1100); // the fx arrives 100 ms after the press
    raid.onFxBatch(batch([freezeCast], 1100));
    expect(enqueued.mock.calls.some(([e]) => e.kind === "cast")).toBe(false);
    wishFx.update(1100);
    expect(telegraphs()).toHaveLength(1);
    // Confirmed: it now outlives the unconfirmed life, waiting for the landing.
    wishFx.update(1640);
    expect(telegraphs()).toHaveLength(1);
  });

  it("is ended by the own castEnd on arrival, with the castLand and anyone else's fx still queued for render time", () => {
    const { raid, wishFx, enqueued, batch, telegraphs } = wired();
    wishFx.predictCast(predicted, 1000);
    raid.onFxBatch(batch([freezeCast, { kind: "cast", by: "foe", ability: "trial", ms: 350, target: "me", x: 30, y: 40 }], 1100));
    wishFx.update(1120);
    raid.onFxBatch(batch([{ kind: "castEnd", by: "me", ability: "freeze", reason: "interrupted" }], 1150));
    expect(enqueued.mock.calls.map(([e]) => e.kind)).toEqual(["cast"]); // only the foe's
    expect(enqueued.mock.calls[0]![0]).toMatchObject({ by: "foe" });
    wishFx.update(1160);
    expect(telegraphs()).toHaveLength(0);
    raid.onFxBatch(batch([{ kind: "castLand", by: "me", ability: "freeze", target: "foe", x: 120, y: 40 }], 1350));
    expect(enqueued.mock.calls.map(([e]) => e.kind)).toEqual(["cast", "castLand"]);
  });

  it("with nothing drawn at the press, the own cast and castEnd play at render time as before", () => {
    const { raid, enqueued, batch } = wired();
    raid.onFxBatch(batch([freezeCast], 1100));
    raid.onFxBatch(batch([{ kind: "castEnd", by: "me", ability: "freeze", reason: "fizzle" }], 1150));
    expect(enqueued.mock.calls.map(([e]) => e.kind)).toEqual(["cast", "castEnd"]);
  });

  it("is let go when a patch acks the cast's order number with no cast fx (a refusal)", () => {
    const { raid, wishFx, me, telegraphs } = wired();
    raid.observeLocal(raid.room.state); // the first sample
    raid.predict.noteCast(1000, { castMs: 250, seq: 7 });
    wishFx.predictCast(predicted, 1000);
    wishFx.update(1020);
    expect(telegraphs()).toHaveLength(1);
    me.moveSeq = 7;
    raid.room.state.serverTime = 1050;
    raid.observeLocal(raid.room.state);
    wishFx.update(1060);
    expect(telegraphs()).toHaveLength(0);
    expect(wishFx.confirmPredicted({ kind: "cast", by: "me", ability: "freeze", ms: 250, target: "foe", x: 120, y: 40, t: 1050 }, 1100)).toBe(false);
  });

  it("is kept when the cast fx came before the acking patch (the server took it)", () => {
    const { raid, wishFx, me, batch, telegraphs } = wired();
    raid.observeLocal(raid.room.state);
    raid.predict.noteCast(1000, { castMs: 250, seq: 7 });
    wishFx.predictCast(predicted, 1000);
    raid.onFxBatch(batch([freezeCast], 1100));
    me.moveSeq = 7;
    raid.room.state.serverTime = 1100;
    raid.observeLocal(raid.room.state);
    wishFx.update(1120);
    expect(telegraphs()).toHaveLength(1);
  });
});

describe("the potion key through RaidScene", () => {
  it("a press the server would refuse is not sent, and says the server's own words", () => {
    const { raid, sent, said, me, ofKind } = wired();
    me.hp = 1000;
    raid.drinkPotion();
    expect(sent).toEqual([]);
    expect(said).toEqual([POTION_REFUSAL.full]);
    me.hp = 100;
    me.effects = EFFECT_STUNNED;
    raid.drinkPotion();
    expect(said).toEqual([POTION_REFUSAL.full, POTION_REFUSAL.blocked]);
    expect(sent).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(0);
  });

  it("a press the server will take is sent once, with one ring in the potion's colour, and the next press counts it", () => {
    const { raid, sent, said, ofKind } = wired();
    raid.drinkPotion();
    expect(sent).toEqual([["useConsumable", { kind: "heal" }]]);
    expect(said).toEqual([]);
    const rings = ofKind("graphics");
    expect(rings).toHaveLength(1);
    expect(argsOf(rings[0]!, "lineStyle").some((a) => a[1] === CONSUMABLES.potionLarge.color)).toBe(true);
    raid.drinkPotion(); // the one potion is already on its way
    expect(sent).toHaveLength(1);
    expect(said).toEqual([POTION_REFUSAL.empty]);
  });

  it("a press while casting (the root the cast will still hold when it arrives) is refused locally", () => {
    const { raid, sent, said } = wired();
    const now = performance.now();
    raid.predict.noteCast(now, { castMs: 250, seq: 3 });
    raid.drinkPotion();
    expect(sent).toEqual([]);
    expect(said).toEqual([POTION_REFUSAL.blocked]);
  });

  it("while reconnecting, or outside a running fight, the press is sent as it is, with no cue", () => {
    const { raid, sent, said, me, ofKind } = wired();
    me.hp = 1000;
    raid.room.reconnection = { isReconnecting: true };
    raid.drinkPotion();
    raid.room.reconnection = { isReconnecting: false };
    raid.room.state.phase = "ended";
    raid.drinkPotion();
    expect(sent).toHaveLength(2);
    expect(said).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(0);
  });
});
