import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: { Scene: class {} } }));
import { packFx, Y_SCALE, type FxBatch, type ProjectileLaunch } from "@raid/shared";
import { LocalAutos, type AutoVisual } from "../src/net/localAutos";
import { FxView, type FxHost } from "../src/render/FxView";
import { FigurePose } from "../src/render/figurePose";
import { ProjectileView } from "../src/render/ProjectileView";
import { resetReducedMotionCache } from "../src/render/juice";
import { RaidScene } from "../src/scenes/RaidScene";
import { fakeScene, type FakeObject } from "./fakes";

afterEach(() => resetReducedMotionCache());

function wiredScene() {
  const { scene: phaserScene, ofKind } = fakeScene();
  const pose = new FigurePose();
  const positions: Record<string, { x: number; y: number }> = { me: { x: 30, y: 40 }, foe: { x: 120, y: 40 } };
  const landed: number[] = [];
  const hurt: number[] = [];
  const fx = new FxView(phaserScene, {
    localId: "me", view: () => ({ flash: () => {}, cues: pose }), position: (id) => positions[id], name: () => undefined,
    projectileEnded: () => {}, localLanded: (event) => landed.push(event.amount), localHurt: (event) => hurt.push(event.amount),
  } satisfies FxHost);
  const projectiles = new ProjectileView(phaserScene);
  const localAutos = new LocalAutos();
  const groundNotes: unknown[] = [];
  const predictNotes: unknown[] = [];
  const raid = new RaidScene() as unknown as {
    fx: FxView;
    projectiles: ProjectileView;
    localAutos: LocalAutos;
    room: { sessionId: string; state: { roster: string[]; players: Map<string, unknown> } };
    ground: { combat: { note: (event: unknown) => void } };
    predict: { noteFx: (...args: unknown[]) => void; confirmPredictedRangedPause: (...args: unknown[]) => void };
    visiblePosition: (id: string) => { x: number; y: number } | undefined;
    localClock: (now: number) => number;
    warnDropped: () => void;
    showLocalAuto: (visual: AutoVisual, now: number) => void;
    onFxBatch: (batch: FxBatch) => void;
  };
  raid.fx = fx;
  raid.projectiles = projectiles;
  raid.localAutos = localAutos;
  raid.room = { sessionId: "me", state: { roster: ["me", "foe"], players: new Map([["me", {}]]) } };
  raid.ground = { combat: { note: (event) => groundNotes.push(event) } };
  raid.predict = { noteFx: (...args) => predictNotes.push(args), confirmPredictedRangedPause: vi.fn() };
  raid.visiblePosition = (id) => positions[id];
  raid.localClock = (now) => now;
  raid.warnDropped = () => {};
  return { fx, pose, positions, landed, hurt, projectiles, localAutos, groundNotes, predictNotes, raid, ofKind };
}

describe("local autos wired through RaidScene and FxView", () => {
  it.each([150, 280])("maps a local ranged pause onto the movement model clock with %i ms order delay", delay => {
    const raid = new RaidScene() as unknown as {
      localAutos: LocalAutos;
      predict: { motion: { delay: number }; setPredictedRangedPause: ReturnType<typeof vi.fn> };
      localClock: (now: number) => number;
      syncLocalRangedPause: (now: number) => void;
    };
    const setPause = vi.fn();
    raid.predict = { motion: { delay }, setPredictedRangedPause: setPause };
    raid.localClock = now => 1_000_000 + now - 500;
    const bow = { key: "0:bow", weapon: "bow" as const, a: 0, held: true, enabled: true,
      intervalMs: 900, windupMs: 500, readyInMs: 0 };
    raid.localAutos.press(bow, 500, () => {});
    raid.syncLocalRangedPause(500);
    expect(setPause).toHaveBeenLastCalledWith({ id: "local-auto-1", weapon: "bow",
      from: 1_000_300 + delay, until: 1_000_500 + delay });
    // Clock mapping remains anchored to the same visual release across later frames.
    raid.syncLocalRangedPause(700);
    expect(setPause).toHaveBeenLastCalledWith({ id: "local-auto-1", weapon: "bow",
      from: 1_000_300 + delay, until: 1_000_500 + delay });
    raid.localAutos.frame({ ...bow, held: false }, 1000, () => {});
    raid.syncLocalRangedPause(1000);
    expect(setPause).toHaveBeenLastCalledWith(null);
  });

  it("shows a melee cue immediately, predicts a bow launch at the current local origin, and never reports damage", () => {
    const { scene: phaserScene, ofKind } = fakeScene();
    const pose = new FigurePose();
    let position = { x: 30, y: 40 };
    const landed: number[] = [];
    const hurt: number[] = [];
    const host: FxHost = {
      localId: "me",
      view: (id) => id === "me" ? { flash: () => {}, cues: pose } : undefined,
      position: (id) => id === "me" ? position : undefined,
      name: () => undefined,
      projectileEnded: () => {},
      localLanded: (fx) => landed.push(fx.amount),
      localHurt: (fx) => hurt.push(fx.amount),
    };
    const fx = new FxView(phaserScene, host);
    const predictions: unknown[] = [];
    const raid = new RaidScene() as unknown as {
      fx: FxView;
      room: { sessionId: string };
      visiblePosition: (id: string) => { x: number; y: number } | undefined;
      localClock: (now: number) => number;
      projectiles: { predictLocal: (launch: unknown) => void };
      showLocalAuto: (visual: AutoVisual, now: number) => void;
    };
    raid.fx = fx;
    raid.room = { sessionId: "me" };
    raid.visiblePosition = (id) => id === "me" ? position : undefined;
    raid.localClock = (now) => now;
    raid.projectiles = { predictLocal: (launch) => predictions.push(launch) };

    const autos = new LocalAutos();
    const axe = { key: "0:axe", weapon: "axe" as const, a: 0.4, held: true, enabled: true, intervalMs: 700, windupMs: 0, readyInMs: 0 };
    autos.press(axe, 5_000, (visual) => raid.showLocalAuto(visual, 5_000));
    const swing: FakeObject = ofKind("graphics")[0]!;
    expect(swing.state.position).toEqual([30, 40 * Y_SCALE]);
    expect(pose.sample(5_016, 1, -1, 0).ox).toBeGreaterThan(0);

    // A draw continues after release; its release aim and origin are sampled at launch time.
    position = { x: 70, y: 90 };
    const bow = { key: "0:bow", weapon: "bow" as const, a: 0.1, held: true, enabled: true, intervalMs: 800, windupMs: 300, readyInMs: 0 };
    autos.press(bow, 5_100, (visual) => raid.showLocalAuto(visual, 5_100));
    expect(pose.sample(5_200, 1, -1, 0).ox).toBeLessThan(0);
    autos.frame({ ...bow, held: false, a: 1.2 }, 5_400, (visual) => raid.showLocalAuto(visual, 5_400));
    expect(predictions).toHaveLength(1);
    expect(predictions[0]).toMatchObject({
      id: "local-auto-2", ownerId: "me", kind: "arrow", x: 70, y: 90,
      vx: expect.closeTo(Math.cos(1.2) * 900), vy: expect.closeTo(Math.sin(1.2) * 900),
    });
    expect(landed).toEqual([]);
    expect(hurt).toEqual([]);
    fx.destroy();
  });

  it("suppresses the echoed local melee sweep while still playing the server hit", () => {
    vi.spyOn(performance, "now").mockReturnValue(5_100);
    const { fx, pose, landed, hurt, localAutos, raid, groundNotes, predictNotes, ofKind } = wiredScene();
    const localAutoCue = vi.spyOn(fx, "localAuto");
    const localSwing = vi.spyOn(pose, "swing");
    const input = { key: "0:axe", weapon: "axe" as const, a: 0.3, held: true, enabled: true, intervalMs: 700, windupMs: 0, readyInMs: 0 };
    localAutos.press(input, 5_000, (visual) => raid.showLocalAuto(visual, 5_000));
    const batch = packFx([
      { kind: "swing", by: "me", weapon: "axe", x: -200, y: -300, a: 0.3 },
      { kind: "hit", id: "foe", by: "me", amount: 25, weapon: "axe" },
    ], 5_100, { roster: new Map([["me", 0], ["foe", 1]]) });
    raid.onFxBatch(batch);
    expect(localAutoCue).toHaveBeenCalledTimes(1); // press only; the server swing is a confirmation
    expect(localSwing).toHaveBeenCalledTimes(1);
    expect(groundNotes).toHaveLength(2);
    expect(predictNotes).toHaveLength(2);

    fx.update(5_100, 5_100, true);
    expect(landed).toEqual([25]);
    expect(hurt).toEqual([]);
    expect(ofKind("graphics")).toHaveLength(2); // one sweep and the authoritative hit impact
    fx.destroy();
  });

  it("reconciles an owned same-tick launch and projEnd to one released preview and one recoil", () => {
    vi.spyOn(performance, "now").mockReturnValue(6_000);
    const { fx, pose, localAutos, raid, projectiles } = wiredScene();
    const launchCue = vi.spyOn(pose, "launch");
    const bow = { key: "0:bow", weapon: "bow" as const, a: 0.1, held: true, enabled: true, intervalMs: 900, windupMs: 200, readyInMs: 0 };
    localAutos.press(bow, 5_700, (visual) => raid.showLocalAuto(visual, 5_700));
    localAutos.frame({ ...bow, held: false, a: 0.8 }, 5_900, (visual) => raid.showLocalAuto(visual, 5_900));
    expect(launchCue).toHaveBeenCalledTimes(1); // local release edge
    expect(projectiles.has("local-auto-1")).toBe(true);

    const launch: ProjectileLaunch = { id: "server-arrow", ownerId: "me", kind: "arrow", x: 30, y: 40, vx: 900 * Math.cos(0.8), vy: 900 * Math.sin(0.8), t: 5_900, range: 520 };
    const batch = packFx([{
      kind: "projEnd", id: "server-arrow", ownerId: "me", proj: "arrow", x0: 30, y0: 40, t0: 5_900,
      x: 80, y: 40, reason: "range",
    }], 5_900, { launches: [launch], announced: new Set(["server-arrow"]) });
    raid.onFxBatch(batch);
    expect(raid.predict.confirmPredictedRangedPause).toHaveBeenCalledExactlyOnceWith("local-auto-1", 5_900);
    expect(launchCue).toHaveBeenCalledTimes(1); // owned launch echo adds no recoil
    expect(localAutos.consume("launch", "bow", 6_000)).toBeUndefined();
    expect(projectiles.has("server-arrow")).toBe(true);
    expect(projectiles.has("local-auto-1")).toBe(false); // preview was claimed by the server id
    fx.destroy();
  });

  it("correlates a wand windup before applying its authoritative movement root", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_100);
    const { raid, localAutos, fx } = wiredScene();
    const note = vi.spyOn(raid.predict, "noteFx");
    const confirm = vi.mocked(raid.predict.confirmPredictedRangedPause);
    localAutos.press({ key: "0:wand", weapon: "wand", a: 0, held: true, enabled: true,
      intervalMs: 1000, windupMs: 450, readyInMs: 0, targetId: "foe" }, 1000, visual => raid.showLocalAuto(visual, 1000));
    raid.onFxBatch(packFx([{ kind: "windup", by: "me", weapon: "wand", a: 0, ms: 450 }], 1100));
    expect(confirm).toHaveBeenCalledExactlyOnceWith("local-auto-1", 1550);
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(note.mock.invocationCallOrder[0]!);
    fx.destroy();
  });

  it("lets an early authoritative launch finish an unreleased local draw exactly once", () => {
    vi.spyOn(performance, "now").mockReturnValue(7_000);
    const { fx, pose, localAutos, raid } = wiredScene();
    const launchCue = vi.spyOn(pose, "launch");
    const bow = { key: "0:bow", weapon: "bow" as const, a: 0.2, held: true, enabled: true, intervalMs: 900, windupMs: 500, readyInMs: 0 };
    localAutos.press(bow, 6_500, (visual) => raid.showLocalAuto(visual, 6_500));
    const launch: ProjectileLaunch = { id: "early-arrow", ownerId: "me", kind: "arrow", x: 30, y: 40, vx: 900, vy: 0, t: 6_800, range: 520 };
    raid.onFxBatch(packFx([], 6_800, { launches: [launch] }));
    expect(launchCue).toHaveBeenCalledTimes(1); // authority arrived before the scheduler's 7,000 release
    expect(localAutos.wasReleased("local-auto-1")).toBe(false);
    localAutos.frame({ ...bow, held: false }, 7_000, (visual) => raid.showLocalAuto(visual, 7_000));
    expect(launchCue).toHaveBeenCalledTimes(1); // the consumed preview cannot release again
    expect(localAutos.wasReleased("local-auto-1")).toBe(false);
    fx.destroy();
  });

  it("drops stale own attack and recoil cosmetics without consuming a newer preview or skipping server hits", () => {
    vi.spyOn(performance, "now").mockReturnValue(5_100);
    const { fx, pose, localAutos, raid, projectiles } = wiredScene();
    const localAutoCue = vi.spyOn(fx, "localAuto");
    const launchCue = vi.spyOn(pose, "launch");
    const enqueue = vi.spyOn(fx, "enqueue");
    const bow = { key: "0:bow", weapon: "bow" as const, a: 0.2, held: true, enabled: true, intervalMs: 900, windupMs: 300, readyInMs: 0 };
    localAutos.press(bow, 5_000, (visual) => raid.showLocalAuto(visual, 5_000));
    expect(localAutoCue).toHaveBeenCalledTimes(1); // the fresh predicted windup

    const oldLaunch: ProjectileLaunch = { id: "old-arrow", ownerId: "me", kind: "arrow", x: 5, y: 6, vx: 900, vy: 0, t: 1_000, range: 520 };
    raid.onFxBatch(packFx([
      { kind: "windup", by: "me", weapon: "sword", a: 0.5, ms: 250 },
      { kind: "swing", by: "me", weapon: "axe", x: -50, y: -60, a: 0.7 },
      { kind: "hit", id: "foe", by: "me", amount: 15, weapon: "axe" },
      { kind: "projEnd", id: "old-stop", ownerId: "me", proj: "arrow", x0: 0, y0: 0, t0: 900, x: 20, y: 0, reason: "range" },
    ], 1_000, { launches: [oldLaunch], roster: new Map([["me", 0], ["foe", 1]]) }));
    expect(localAutoCue).toHaveBeenCalledTimes(1);
    expect(launchCue).not.toHaveBeenCalled();
    expect(localAutos.wasReleased("local-auto-1")).toBe(false);
    expect(projectiles.has("old-arrow")).toBe(true); // stale FX still update the authoritative projectile view
    expect(projectiles.has("old-stop")).toBe(true);
    expect(enqueue.mock.calls.some(([event]) => event.kind === "hit")).toBe(true);

    localAutos.frame({ ...bow, held: false, a: 1.1 }, 5_300, (visual) => raid.showLocalAuto(visual, 5_300));
    expect(localAutoCue).toHaveBeenCalledTimes(2); // the still-pending current draw gets its one release
    expect(launchCue).toHaveBeenCalledTimes(1);
    expect(localAutos.wasReleased("local-auto-1")).toBe(true);
    expect(projectiles.has("local-auto-1")).toBe(true);
    fx.destroy();
  });
});
