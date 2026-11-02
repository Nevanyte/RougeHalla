// The local weapon swap, predicted (net/localHand.ts) and wired through RaidScene: the swap keys always send the slot the player
// means, predict the hand only when the server is expected to take the swap, route the clicks that follow it by the new weapon,
// feed the local auto its slot and ready time, and leave the cosmetics a pressed swap already cancelled alone when the patch
// confirms it. The scene is a private-field rig, as in localAutos.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: { Scene: class {} } }));
import { EFFECT_CASTING, EFFECT_STUNNED, packFx, SWAP_SECONDS, TICK_MS } from "@raid/shared";
import { RaidScene } from "../src/scenes/RaidScene";
import { SWAP_SETTLE_SLACK_MS } from "../src/net/localHand";
import { DELAY_INIT_MS, DELAY_MAX_MS } from "../src/net/localMotion";

const NOW = 10_000;
const DELAY = 120;
const APPLY_AT = NOW + DELAY + TICK_MS;

interface Me {
  slot: number; weapon0: string; weapon1: string; status: string; effects: number; build: Map<string, number>; readyAt: number;
  attackTarget: string; faction: string; asMult: number; windupMult: number; facing: number;
}

type Scene = {
  room: { sessionId: string; state: { phase: string; serverTime: number; players: Map<string, Me>; mobs: Map<string, unknown>; training: boolean; gatesLocked: boolean; roster: string[] };
    send: ReturnType<typeof vi.fn>; reconnection?: { isReconnecting: boolean } };
  hand: { predicting: boolean; applyAt: number; counts: { confirmed: number; refused: number; expired: number }; slotOf(s: number): number; observe(...a: number[]): string };
  predict: { motion: { delay: number; delayKnown?: boolean }; castEndsAt: ReturnType<typeof vi.fn>; noteWeaponChange: ReturnType<typeof vi.fn>; setPredictedRangedPause: ReturnType<typeof vi.fn>; noteFx: ReturnType<typeof vi.fn> };
  fx: { dropWindups: ReturnType<typeof vi.fn>; cancelWindups: ReturnType<typeof vi.fn>; enqueue: ReturnType<typeof vi.fn>; localAuto: ReturnType<typeof vi.fn> };
  lockDisplay: { shown(synced: string, now: number): string; note(id: string, now: number): void };
  inHand: Map<string, string>;
  localClock: (now: number) => number;
  cancelLocalAutos: ReturnType<typeof vi.fn> | ((now: number) => void);
  swapHand(explicit?: 0 | 1): void;
  handleKey(e: unknown): void;
  localSlot(me: { slot: number }): number;
  localWeapon(me: Me): string;
  clickAttack(pointer: unknown): void;
  sendTarget(pointer: unknown): void;
  noteWeaponChanges(state: unknown): void;
  localAutoInput(now: number): { key: string; weapon: string; readyInMs: number; enabled: boolean; targetId?: string } | null;
  updateTargets(me: Me, now: number): void;
  onFxBatch(batch: unknown): void;
  lockId: string;
};

function rig(over: Partial<Me> = {}, extra: { phase?: string } = {}) {
  const me: Me = {
    slot: 0, weapon0: "wand", weapon1: "sword", status: "alive", effects: 0, build: new Map(), readyAt: 0, attackTarget: "",
    faction: "fire", asMult: 1000, windupMult: 1000, facing: 0, ...over,
  };
  const foe = { slot: 0, weapon0: "bow", weapon1: "", status: "alive", effects: 0, build: new Map(), readyAt: 0 };
  const state = {
    phase: extra.phase ?? "active", serverTime: NOW - 50, players: new Map<string, Me>([["me", me]]), mobs: new Map<string, unknown>(), training: false, gatesLocked: false,
    roster: ["me"],
  };
  const send = vi.fn();
  const scene = new RaidScene() as unknown as Scene;
  scene.room = { sessionId: "me", state, send };
  scene.localClock = () => NOW;
  scene.predict = {
    motion: { delay: DELAY }, castEndsAt: vi.fn(() => 0), noteWeaponChange: vi.fn(), setPredictedRangedPause: vi.fn(), noteFx: vi.fn(),
  };
  scene.fx = { dropWindups: vi.fn(), cancelWindups: vi.fn(), enqueue: vi.fn(), localAuto: vi.fn() };
  const sentOf = (type: string) => send.mock.calls.filter((c) => c[0] === type).map((c) => c[1] as Record<string, unknown>);
  return { scene, me, foe, state, send, sentOf };
}

beforeEach(() => { vi.spyOn(performance, "now").mockReturnValue(NOW); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("swap keys", () => {
  it("Q sends the other slot as an explicit slot and predicts it", () => {
    const { scene, me, sentOf } = rig();
    scene.swapHand();
    expect(sentOf("swap")).toEqual([{ slot: 1 }]);
    expect(scene.hand.predicting).toBe(true);
    expect(scene.localSlot(me)).toBe(1);
    expect(scene.localWeapon(me)).toBe("sword");
    expect(scene.hand.applyAt).toBe(APPLY_AT);
  });

  it("a second Q inside the round trip sends the slot back, and 1 and 2 send their own slot", () => {
    const { scene, me, sentOf } = rig();
    scene.swapHand();
    scene.swapHand();
    expect(sentOf("swap")).toEqual([{ slot: 1 }, { slot: 0 }]);
    expect(scene.localSlot(me)).toBe(0);
    scene.swapHand(1);
    scene.swapHand(0);
    expect(sentOf("swap").slice(2)).toEqual([{ slot: 1 }, { slot: 0 }]);
  });

  it("reads the keys: Q, Digit1/2 and Numpad1/2 (the typing guard sits in front of them)", () => {
    vi.stubGlobal("document", { activeElement: null });
    const { scene, sentOf } = rig();
    const key = (code: string) => scene.handleKey({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: null, preventDefault: () => {} });
    key("KeyQ");
    key("Digit1");
    key("Numpad2");
    key("Digit2");
    expect(sentOf("swap")).toEqual([{ slot: 1 }, { slot: 0 }, { slot: 1 }, { slot: 1 }]);
  });

  it("pressing the slot already in hand sends it (the server ignores it) and predicts nothing", () => {
    const { scene, sentOf } = rig();
    scene.swapHand(0);
    expect(sentOf("swap")).toEqual([{ slot: 0 }]);
    expect(scene.hand.predicting).toBe(false);
  });

  describe("the swap is still sent, with no prediction, when the server is expected to refuse it", () => {
    const cases: Array<[string, Partial<Me>, (s: Scene) => void]> = [
      ["stunned", { effects: EFFECT_STUNNED }, () => {}],
      ["casting", { effects: EFFECT_CASTING }, () => {}],
      ["a cast predicted but not yet in the patch", {}, (s) => { s.predict.castEndsAt.mockReturnValue(NOW + 300); }],
      ["empty to empty hands", { weapon0: "", weapon1: "" }, () => {}],
      ["the locked second slot (Committed)", { build: new Map([["committed", 1]]) }, () => {}],
      ["an unknown weapon id in the other slot", { weapon1: "spear" }, () => {}],
      ["dead", { status: "dead" }, () => {}],
      ["reconnecting", {}, (s) => { s.room.reconnection = { isReconnecting: true }; }],
    ];
    it.each(cases)("%s", (_name, over, prepare) => {
      const { scene, sentOf } = rig(over);
      prepare(scene);
      scene.swapHand();
      expect(sentOf("swap")).toEqual([{ slot: 1 }]);
      expect(scene.hand.predicting).toBe(false);
    });

    it("outside an active run", () => {
      const { scene, sentOf } = rig({}, { phase: "lobby" });
      scene.swapHand();
      expect(sentOf("swap")).toEqual([{ slot: 1 }]);
      expect(scene.hand.predicting).toBe(false);
    });
  });

  it("Committed locks only the second slot: going back to the first is predicted", () => {
    const { scene } = rig({ slot: 1, build: new Map([["committed", 1]]) });
    scene.swapHand();
    expect(scene.hand.predicting).toBe(true);
    expect(scene.hand.slotOf(1)).toBe(0);
  });

  it("an empty slot is fists and a legal place to swap to from a weapon", () => {
    const { scene, me } = rig({ weapon1: "" });
    scene.swapHand();
    expect(scene.hand.predicting).toBe(true);
    expect(scene.localWeapon(me)).toBe("fists");
  });
});

describe("clicks follow the weapon the player sees in hand", () => {
  const pointer = {};
  /** What clickAttack and the local auto it feeds read besides the hand: the cursor's aim and where the local fighter is drawn. */
  const aimed = (scene: Scene) => {
    const s = scene as unknown as { cursorAngle: () => number; visiblePosition: () => undefined; input: { activePointer: object } };
    s.cursorAngle = () => 0.5;
    s.visiblePosition = () => undefined;
    s.input = { activePointer: {} };
    scene.sendTarget = vi.fn();
  };

  it("wand to a non-wand, then a click inside the round trip: an attack, not a lost target", () => {
    const { scene, sentOf } = rig(); // the patch still shows the wand in hand
    aimed(scene);
    scene.swapHand();
    scene.clickAttack(pointer);
    expect(sentOf("attack")).toEqual([expect.objectContaining({ a: 0.5 })]);
    expect(scene.sendTarget).not.toHaveBeenCalled();
  });

  it("a non-wand to the wand, then a click: a target (a homing ball), not a directional attack", () => {
    const { scene, sentOf } = rig({ weapon0: "sword", weapon1: "wand" }); // the patch still shows the sword
    aimed(scene);
    scene.swapHand();
    scene.clickAttack(pointer);
    expect(scene.sendTarget).toHaveBeenCalledTimes(1);
    expect(sentOf("attack")).toEqual([]);
  });

  it("without a swap in flight the click goes by the patch, as before", () => {
    const { scene, sentOf } = rig();
    aimed(scene);
    scene.clickAttack(pointer);
    expect(scene.sendTarget).toHaveBeenCalledTimes(1);
    const sword = rig({ slot: 1 });
    aimed(sword.scene);
    sword.scene.clickAttack(pointer);
    expect(sword.sentOf("attack")).toHaveLength(1);
    expect(sentOf("attack")).toEqual([]);
  });

  it("sendTarget locks only with a wand in hand, judged by the predicted hand too", () => {
    const wandNext = rig({ weapon0: "sword", weapon1: "wand" });
    const s = wandNext.scene as unknown as Scene & { cursorGround: () => { x: number; y: number }; targetCandidates: () => unknown[]; orderTarget: (id: string) => void };
    s.cursorGround = () => ({ x: 100, y: 100 });
    s.targetCandidates = () => [{ id: "foe", x: 100, y: 100 }];
    s.orderTarget = vi.fn();
    s.sendTarget(pointer);
    expect(wandNext.sentOf("target")).toEqual([]); // a sword in hand: the server would refuse it
    s.swapHand();
    s.sendTarget(pointer);
    expect(wandNext.sentOf("target")).toEqual([{ id: "foe" }]);
    expect(s.orderTarget).toHaveBeenCalledWith("foe");
  });

  it("the lock ring follows the predicted hand: none while a non-wand is predicted, the lock again once the wand is", () => {
    const { scene, me } = rig({ attackTarget: "foe" });
    const s = scene as unknown as Scene & { rings: { update: () => void }; liveFighter: (id: string) => string; hoverId: string; aimKnown: boolean; input: { isOver: boolean } };
    s.rings = { update: vi.fn() };
    s.liveFighter = (id) => id;
    s.aimKnown = false;
    s.input = { isOver: false };
    s.updateTargets(me, NOW);
    expect(s.lockId).toBe("foe");
    s.swapHand(); // wand to sword: the server drops the lock
    s.updateTargets(me, NOW);
    expect(s.lockId).toBe("");
  });
});

describe("the local auto-attack", () => {
  const stub = (scene: Scene) => {
    const s = scene as unknown as { visiblePosition: () => undefined; cursorAngle: () => number; input: { activePointer: object } };
    s.visiblePosition = () => undefined;
    s.cursorAngle = () => 0;
    s.input = { activePointer: {} };
  };

  it("keys on the predicted slot and weapon and adds the swap time to the ready time", () => {
    const { scene } = rig({ readyAt: NOW + 100 });
    stub(scene);
    expect(scene.localAutoInput(NOW)).toMatchObject({ key: "0:wand", weapon: "wand", readyInMs: 100 });
    scene.swapHand();
    // The swap is applied at APPLY_AT, after the 100 ms of cooldown left: ready SWAP_SECONDS later.
    expect(scene.localAutoInput(NOW)).toMatchObject({ key: "1:sword", weapon: "sword", readyInMs: APPLY_AT + SWAP_SECONDS * 1000 - NOW });
  });

  it("counts the cooldown still running past the apply time", () => {
    const { scene } = rig({ readyAt: NOW + 900 });
    stub(scene);
    scene.swapHand();
    expect(scene.localAutoInput(NOW)).toMatchObject({ readyInMs: 900 + SWAP_SECONDS * 1000 });
  });

  it("returns to the server's key and ready time once a refused swap is given up", () => {
    const { scene, state, me } = rig({ readyAt: NOW + 100 });
    stub(scene);
    scene.swapHand();
    me.effects = EFFECT_STUNNED; // a stun landed while the swap was in flight
    state.serverTime = APPLY_AT + SWAP_SETTLE_SLACK_MS;
    scene.noteWeaponChanges(state);
    expect(scene.hand.predicting).toBe(false);
    expect(scene.hand.counts.refused).toBe(1);
    expect(scene.localAutoInput(NOW)).toMatchObject({ key: "0:wand", readyInMs: 100 });
  });
});

describe("the patch that follows a swap", () => {
  function pressedAndPatched(pickup = false) {
    const r = rig();
    r.scene.cancelLocalAutos = vi.fn();
    r.scene.noteWeaponChanges(r.state); // the hand the scene has seen so far
    if (!pickup) r.scene.swapHand();
    (r.scene.cancelLocalAutos as ReturnType<typeof vi.fn>).mockClear();
    r.scene.fx.cancelWindups.mockClear();
    r.me.slot = 1;
    r.state.serverTime = APPLY_AT;
    r.scene.noteWeaponChanges(r.state);
    return r;
  }

  it("confirms the prediction without cancelling again what the key press cancelled, and still tells the prediction", () => {
    const { scene, state } = pressedAndPatched();
    expect(scene.hand.counts.confirmed).toBe(1);
    expect(scene.hand.predicting).toBe(false);
    expect(scene.cancelLocalAutos).not.toHaveBeenCalled();
    expect(scene.fx.cancelWindups).not.toHaveBeenCalled();
    expect(scene.predict.noteWeaponChange).toHaveBeenCalledExactlyOnceWith(state.serverTime);
  });

  it("a change nobody predicted (a pickup that replaced the hand, a swap after a long gap) still cancels the local cosmetics", () => {
    const { scene, state } = pressedAndPatched(true);
    expect(scene.cancelLocalAutos).toHaveBeenCalledTimes(1);
    expect(scene.fx.cancelWindups).toHaveBeenCalledExactlyOnceWith("me", state.serverTime);
    expect(scene.predict.noteWeaponChange).toHaveBeenCalledExactlyOnceWith(state.serverTime);
  });

  it("a remote player's swap cancels its telegraphs, whatever the local hand did", () => {
    const { scene, state, foe } = rig();
    state.players.set("foe", foe as unknown as Me);
    scene.cancelLocalAutos = vi.fn();
    scene.noteWeaponChanges(state);
    scene.swapHand();
    scene.fx.cancelWindups.mockClear();
    foe.slot = 1;
    state.serverTime = APPLY_AT;
    scene.noteWeaponChanges(state);
    expect(scene.fx.cancelWindups).toHaveBeenCalledExactlyOnceWith("foe", APPLY_AT);
  });

  it("a late patch with no stun or cast showing keeps the hand, and the patch that shows the swap still cancels nothing", () => {
    const r = rig();
    r.scene.cancelLocalAutos = vi.fn();
    r.scene.noteWeaponChanges(r.state);
    r.scene.swapHand();
    (r.scene.cancelLocalAutos as ReturnType<typeof vi.fn>).mockClear();
    r.state.serverTime = APPLY_AT + SWAP_SETTLE_SLACK_MS + 50;
    r.scene.noteWeaponChanges(r.state);
    expect(r.scene.hand.predicting).toBe(true);
    expect(r.scene.localSlot(r.me)).toBe(1);
    r.me.slot = 1;
    r.state.serverTime += 100;
    r.scene.noteWeaponChanges(r.state);
    expect(r.scene.hand.counts).toEqual({ confirmed: 1, refused: 0, expired: 0 });
    expect(r.scene.cancelLocalAutos).not.toHaveBeenCalled();
    expect(r.scene.fx.cancelWindups).not.toHaveBeenCalled();
  });

  it("before any order has measured the delay, the settle time waits for the longest delay", () => {
    const r = rig();
    r.scene.predict.motion = { delay: DELAY_INIT_MS, delayKnown: false };
    r.scene.noteWeaponChanges(r.state);
    r.scene.swapHand();
    r.me.effects = EFFECT_STUNNED;
    r.state.serverTime = NOW + DELAY_INIT_MS + TICK_MS + SWAP_SETTLE_SLACK_MS;
    r.scene.noteWeaponChanges(r.state);
    expect(r.scene.hand.predicting).toBe(true);
    r.state.serverTime = NOW + DELAY_MAX_MS + TICK_MS + SWAP_SETTLE_SLACK_MS;
    r.scene.noteWeaponChanges(r.state);
    expect(r.scene.hand.counts.refused).toBe(1);
  });

  it("keeps cancelling nothing while a double tap's intermediate patch goes by", () => {
    const r = rig();
    r.scene.cancelLocalAutos = vi.fn();
    r.scene.noteWeaponChanges(r.state);
    r.scene.swapHand();
    r.scene.swapHand(); // Q Q: back to slot 0
    (r.scene.cancelLocalAutos as ReturnType<typeof vi.fn>).mockClear();
    r.me.slot = 1; // the first swap's patch
    r.state.serverTime = APPLY_AT;
    r.scene.noteWeaponChanges(r.state);
    expect(r.scene.hand.predicting).toBe(true);
    expect(r.scene.cancelLocalAutos).not.toHaveBeenCalled();
    expect(r.scene.localSlot(r.me)).toBe(0);
  });
});

describe("an old weapon's windup in flight when the swap is pressed", () => {
  const roster = new Map([["me", 0]]);
  function fxRig() {
    const r = rig(); // a wand in hand, a sword in the other slot
    const s = r.scene as unknown as { ground: { combat: { note: () => void } }; warnDropped: () => void; clockSynced: boolean };
    s.ground = { combat: { note: () => {} } };
    s.warnDropped = () => {};
    s.clockSynced = false;
    r.scene.cancelLocalAutos = vi.fn();
    r.scene.noteWeaponChanges(r.state);
    return r;
  }
  const windup = (weapon: string, t: number) => packFx([{ kind: "windup", by: "me", weapon, a: 0, ms: 300 } as never], t, { roster });

  it("is not drawn: the server's swap cancels it with no fx and the confirming patch cancels nothing", () => {
    const r = fxRig();
    r.scene.swapHand(); // wand to sword
    (r.scene.cancelLocalAutos as ReturnType<typeof vi.fn>).mockClear();
    // The server began a wand windup just before the swap reached it; its fx arrives before the patch that shows the swap.
    r.scene.onFxBatch(windup("wand", NOW - 20));
    expect(r.scene.fx.localAuto).not.toHaveBeenCalled();
    // A windup of the weapon the player sees in hand is drawn as before.
    r.scene.onFxBatch(windup("sword", NOW - 10));
    expect(r.scene.fx.localAuto).toHaveBeenCalledExactlyOnceWith("windup", "sword", 0, 300, NOW);
    r.me.slot = 1;
    r.state.serverTime = APPLY_AT;
    r.scene.noteWeaponChanges(r.state);
    expect(r.scene.hand.counts.confirmed).toBe(1);
    expect(r.scene.cancelLocalAutos).not.toHaveBeenCalled();
    expect(r.scene.fx.cancelWindups).not.toHaveBeenCalled();
  });

  it("with no swap in flight the same windup is drawn", () => {
    const r = fxRig();
    r.scene.onFxBatch(windup("wand", NOW - 20));
    expect(r.scene.fx.localAuto).toHaveBeenCalledExactlyOnceWith("windup", "wand", 0, 300, NOW);
  });
});

describe("the prediction ends with the fighter's run", () => {
  const roster = new Map([["me", 0]]);

  it.each([
    ["the coliseum teleport", { kind: "teleport" as const }],
    ["the local death", { kind: "death" as const, id: "me", x: 0, y: 0, by: null }],
  ])("%s clears it", (_name, event) => {
    const { scene } = rig();
    const s = scene as unknown as {
      ground: { combat: { note: () => void } }; interp: { markCut: () => void }; warnDropped: () => void; hud: { showDeath: () => void };
      clockSynced: boolean; wishFx: { cancelPredicted: () => number };
    };
    s.ground = { combat: { note: () => {} } };
    s.wishFx = { cancelPredicted: () => 0 };
    s.interp = { markCut: () => {} };
    s.warnDropped = () => {};
    s.hud = { showDeath: () => {} };
    s.clockSynced = false;
    scene.cancelLocalAutos = vi.fn();
    scene.swapHand();
    expect(scene.hand.predicting).toBe(true);
    scene.onFxBatch(packFx([event], NOW, { roster }));
    expect(scene.hand.predicting).toBe(false);
  });
});
