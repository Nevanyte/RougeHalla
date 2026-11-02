// The local cues of the Wish and the potion keys, wired through RaidScene with a fake Phaser: the telegraph `castSlot` draws at the
// key press is confirmed by the own cast fx and ended by the own castEnd on arrival (neither waits in FxView's render-time queue),
// and let go when a patch acks the cast with no cast fx, at the local death or teleport, or while reconnecting; the potion key is
// checked with the server's words, and kept off the wire only when the refusal is sure.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: { Scene: class {} } }));
import { CONSUMABLES, EFFECT_STUNNED, packFx, POTION_REFUSAL, Y_SCALE, type FxBatch, type FxEvent } from "@raid/shared";
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
    state: {
      phase: string; serverTime: number; roster: string[]; players: Map<string, Record<string, unknown>>;
      mobs?: Map<string, unknown>; gatesLocked?: boolean; training?: boolean;
    };
  };
  ground: { combat: { note: (event: unknown) => void } };
  localAutos: { consume: () => undefined };
  localClock: (now: number) => number;
  warnDropped: () => void;
  announce: ((text: string) => void) | undefined;
  rendered: Map<string, { x: number; y: number }>;
  wishSlot: { deny: (text: string, now: number) => void; update: () => void };
  aimKnown: boolean;
  input: unknown;
  cameras: unknown;
  cursorGround: () => { x: number; y: number };
  cancelLocalAutos: () => void;
  noteDeath: () => void;
  noteTeleport: () => void;
  onFxBatch(batch: FxBatch): void;
  observeLocal(state: unknown): void;
  stepLocal(now: number, state: unknown): void;
  onToast(t: { text: string }): void;
  drinkPotion(): void;
  castSlot(slot: "wish"): void;
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
  raid.cancelLocalAutos = () => {};
  raid.noteDeath = () => {};
  raid.noteTeleport = () => {};
  const enqueued = vi.spyOn(fx, "enqueue");
  const batch = (events: FxEvent[], t: number) => packFx(events, t, { roster: ROSTER });
  const telegraphs = () => made.filter((g) => g.state.visible !== false && argsOf(g, "lineBetween").length > 0);
  return { raid, fx, wishFx, sent, said, me, enqueued, batch, telegraphs, made, ofKind };
}

/** `wired()` with what `castSlot` reads: a foe drawn under the cursor in reach, a Wish ready, the press at wall time 1000. */
function castable(faction: string) {
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const w = wired();
  const { raid, me } = w;
  Object.assign(me, { faction, wishReadyAt: 0, qReadyAt: 0, eReadyAt: 0 });
  raid.room.state.players.set("foe", { x: 120, y: 40, status: "alive", effects: 0, immuneUntil: 0 });
  Object.assign(raid.room.state, { mobs: new Map(), gatesLocked: false, training: false });
  raid.rendered.set("me", { x: 30, y: 40 });
  raid.rendered.set("foe", { x: 120, y: 40 });
  const deny = vi.fn();
  raid.wishSlot = { deny, update: () => {} };
  raid.aimKnown = true;
  raid.input = { isOver: true, activePointer: { updateWorldPoint: () => {}, worldX: 120, worldY: 40 * Y_SCALE } };
  raid.cameras = { main: {} };
  raid.cursorGround = () => ({ x: 120, y: 40 });
  const predictCast = vi.spyOn(w.wishFx, "predictCast");
  const castSent = () => w.sent.filter(([type]) => type === "cast").map(([, p]) => p as { slot: string; id?: string; seq: number });
  return { ...w, deny, predictCast, castSent };
}

const freezeCast: FxEvent = { kind: "cast", by: "me", ability: "freeze", ms: 250, target: "foe", x: 120, y: 40 };
const predicted = { by: "me", ability: "freeze" as const, ms: 250, target: "foe", x: 120, y: 40, seq: 7 };

describe("castSlot draws the own telegraph at the press", () => {
  it("a unit cast (Freeze): at the target as drawn, carrying the order number sent, and the acking patch lets a refusal go", () => {
    const { raid, me, wishFx, predictCast, castSent, telegraphs, deny } = castable("frost");
    raid.castSlot("wish");
    expect(deny).not.toHaveBeenCalled();
    const [cast] = castSent();
    expect(cast).toMatchObject({ slot: "wish", id: "foe" });
    expect(predictCast).toHaveBeenCalledTimes(1);
    expect(predictCast.mock.calls[0]).toEqual([{ by: "me", ability: "freeze", ms: 250, target: "foe", x: 120, y: 40, seq: cast!.seq }, 1000]);
    wishFx.update(1010);
    expect(telegraphs()).toHaveLength(1);
    raid.observeLocal(raid.room.state);
    me.moveSeq = cast!.seq; // echoed with no cast fx before it: refused
    raid.observeLocal(raid.room.state);
    wishFx.update(1020);
    expect(telegraphs()).toHaveLength(0);
  });

  it("a self cast (Swarm): at the caster as drawn", () => {
    const { raid, predictCast, castSent } = castable("plague");
    raid.castSlot("wish");
    const [cast] = castSent();
    expect(predictCast.mock.calls[0]?.[0]).toEqual({ by: "me", ability: "swarm", ms: 250, target: null, x: 30, y: 40, seq: cast!.seq });
  });

  it("none for a Wish with no cast time (Last Stand), and none while reconnecting", () => {
    const holy = castable("holy");
    holy.raid.castSlot("wish");
    expect(holy.castSent()).toHaveLength(1);
    expect(holy.predictCast).not.toHaveBeenCalled();
    const frost = castable("frost");
    frost.raid.room.reconnection = { isReconnecting: true };
    frost.raid.castSlot("wish");
    expect(frost.predictCast).not.toHaveBeenCalled();
  });

  it.each([
    ["the teleport", { kind: "teleport" } as FxEvent],
    ["the local death", { kind: "death", id: "me", x: 30, y: 40, by: null } as FxEvent],
  ])("an unconfirmed one goes at %s (its cast is refused there), with no echo needed; a confirmed one stays", (_name, ended) => {
    const { raid, wishFx, batch, telegraphs } = castable("frost");
    raid.castSlot("wish");
    wishFx.update(1010);
    expect(telegraphs()).toHaveLength(1);
    raid.onFxBatch(batch([ended], 1040));
    wishFx.update(1050);
    expect(telegraphs()).toHaveLength(0);
    const again = castable("frost");
    again.raid.castSlot("wish");
    again.raid.onFxBatch(again.batch([freezeCast, ended], 1040));
    again.wishFx.update(1050);
    expect(again.telegraphs()).toHaveLength(1); // the server's castEnd ends it
  });

  it("every unconfirmed one goes while the connection is down (stepLocal)", () => {
    const { raid, wishFx, telegraphs } = castable("frost");
    raid.castSlot("wish");
    raid.room.reconnection = { isReconnecting: true };
    raid.stepLocal(1016, raid.room.state);
    wishFx.update(1020);
    expect(telegraphs()).toHaveLength(0);
  });
});

describe("the own Wish telegraph through RaidScene", () => {
  it("is confirmed by the own cast fx on arrival, which then never enters the render-time queue", () => {
    const { raid, wishFx, enqueued, batch, telegraphs } = wired();
    wishFx.predictCast(predicted, 1000);
    vi.spyOn(performance, "now").mockReturnValue(1100); // the fx arrives 100 ms after the press
    raid.onFxBatch(batch([freezeCast], 1100));
    expect(enqueued.mock.calls.some(([e]) => e.kind === "cast")).toBe(false);
    wishFx.update(1100);
    expect(telegraphs()).toHaveLength(1);
    // Confirmed: it waits for the landing past its cast time.
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

  it("is let go at a late echo too, with no cast root left in the prediction (given up at ORDER_EXPIRE_MS)", () => {
    const { raid, wishFx, me, telegraphs } = wired();
    raid.observeLocal(raid.room.state);
    wishFx.predictCast(predicted, 1000);
    wishFx.update(1700);
    expect(telegraphs()).toHaveLength(1);
    me.moveSeq = 7;
    raid.observeLocal(raid.room.state);
    wishFx.update(1710);
    expect(telegraphs()).toHaveLength(0);
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
  it("a stun the server's fx told of, still running when the press lands, keeps it unsent with the server's words", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { raid, sent, said, ofKind, batch } = wired();
    raid.onFxBatch(batch([{ kind: "status", id: "me", status: "stun", ms: 1000, by: null }], 1000));
    raid.drinkPotion();
    expect(sent).toEqual([]);
    expect(said).toEqual([POTION_REFUSAL.blocked]);
    expect(ofKind("graphics")).toHaveLength(0);
  });

  it("a press landing after that stun ends is sent and cued, whatever the lagging bit says", () => {
    vi.spyOn(performance, "now").mockReturnValue(1960); // lands at 2010: the stun [1000, 2000) is over
    const { raid, sent, said, me, batch, ofKind } = wired();
    raid.onFxBatch(batch([{ kind: "status", id: "me", status: "stun", ms: 1000, by: null }], 1000));
    me.effects = EFFECT_STUNNED;
    raid.drinkPotion();
    expect(sent).toEqual([["useConsumable", { kind: "heal" }]]);
    expect(said).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(1);
  });

  it("a refusal read from state that can change in flight is sent with no cue, and the server's toast answers it", () => {
    const { raid, sent, said, me, ofKind } = wired();
    me.hp = 1000; // a hit may land first
    raid.drinkPotion();
    me.hp = 100;
    me.effects = EFFECT_STUNNED; // the bit alone: it lags a stun's end
    raid.drinkPotion();
    me.effects = 0;
    raid.predict.noteCast(performance.now(), { castMs: 250, seq: 3 }); // a cast the server may still refuse
    raid.drinkPotion();
    expect(sent).toEqual([["useConsumable", { kind: "heal" }], ["useConsumable", { kind: "heal" }], ["useConsumable", { kind: "heal" }]]);
    expect(said).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(0);
    expect(raid.potionCue.waiting).toBe(0);
  });

  it("a cast the own cast fx confirmed, still running when the press lands, keeps it unsent", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { raid, sent, said, batch } = wired();
    raid.onFxBatch(batch([freezeCast], 1000)); // its root [1000, 1250)
    raid.drinkPotion();
    expect(sent).toEqual([]);
    expect(said).toEqual([POTION_REFUSAL.blocked]);
  });

  it("a press the server will take is sent with one ring in the potion's colour; the next is sent too, uncued", () => {
    const { raid, sent, said, ofKind } = wired();
    raid.drinkPotion();
    expect(sent).toEqual([["useConsumable", { kind: "heal" }]]);
    expect(said).toEqual([]);
    const rings = ofKind("graphics");
    expect(rings).toHaveLength(1);
    expect(argsOf(rings[0]!, "lineStyle").some((a) => a[1] === CONSUMABLES.potionLarge.color)).toBe(true);
    raid.drinkPotion(); // the one potion is on its way, but a camp's potion may land first: the server answers
    expect(sent).toHaveLength(2);
    expect(said).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(1);
    expect(raid.potionCue.waiting).toBe(1);
  });

  it("the press in flight is answered by a server toast of a potion refusal, or by a patch whose stock fell", () => {
    const { raid, me } = wired();
    me.potionLarge = 2;
    raid.observeLocal(raid.room.state); // the stock the patches showed: 2
    raid.drinkPotion();
    expect(raid.potionCue.waiting).toBe(1);
    raid.onToast({ text: "Too far away" });
    expect(raid.potionCue.waiting).toBe(1);
    raid.onToast({ text: POTION_REFUSAL.full });
    expect(raid.potionCue.waiting).toBe(0);
    raid.drinkPotion();
    me.potionLarge = 1;
    raid.observeLocal(raid.room.state);
    expect(raid.potionCue.waiting).toBe(0);
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
