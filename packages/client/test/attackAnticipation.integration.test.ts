import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("phaser", () => ({ default: { Scene: class {} } }));
import type { TimedFx } from "@raid/shared";
import { AttackAnticipation } from "../src/net/attackAnticipation";
import { FxView, type FxHost } from "../src/render/FxView";
import { FigurePose } from "../src/render/figurePose";
import { resetReducedMotionCache } from "../src/render/juice";
import { RaidScene } from "../src/scenes/RaidScene";
import { fakeScene } from "./fakes";

afterEach(() => resetReducedMotionCache());

function setup() {
  const { scene } = fakeScene();
  const pose = new FigurePose();
  const host: FxHost = {
    localId: "me",
    view: () => ({ flash: () => {}, cues: pose }),
    position: () => ({ x: 100, y: 100 }),
    name: () => undefined,
    projectileEnded: () => {},
  };
  return { pose, fx: new FxView(scene, host) };
}

const windup: TimedFx = { kind: "windup", by: "me", weapon: "sword", a: 0, ms: 300, t: 1000 };

describe("attack anticipation integrated with FigurePose and delayed FxView playback", () => {
  it("poses visibly on the press frame and hands over when the authoritative FX reaches render time", () => {
    const { pose, fx } = setup();
    const scene = new RaidScene() as unknown as {
      views: Map<string, { cues: FigurePose }>;
      room: { sessionId: string };
      predict: { motion: { delay: number } };
      attackAnticipation: AttackAnticipation;
      beginAttackAnticipation(a: number, now: number, weapon: string): void;
    };
    scene.views = new Map([["me", { cues: pose }]]);
    scene.room = { sessionId: "me" };
    scene.predict = { motion: { delay: 280 } };
    scene.beginAttackAnticipation(0, 0, "sword");
    const baseline = new FigurePose().sample(16, 1, -1, 0).ox;
    const pressOffset = pose.sample(16, 1, -1, 0).ox;
    expect(baseline).toBe(0);
    expect(Math.abs(pressOffset - baseline)).toBeGreaterThanOrEqual(0.5); // visible within one frame at the 280ms order-delay fixture

    fx.enqueue(windup); // network has delivered it, but the remote render clock is still before t=1000
    expect(scene.attackAnticipation.confirm(100)).toBe(true);
    expect(scene.attackAnticipation.cancelIfUnconfirmed()).toBe(false); // release keeps the accepted one-shot windup
    fx.update(900, 100, true);
    const beforeTakeover = pose.sample(200, 1, -1, 0).ox;
    expect(beforeTakeover).toBeLessThan(0);

    fx.update(1000, 200, true);
    const afterTakeover = pose.sample(200, 1, -1, 0).ox;
    expect(afterTakeover).toBeLessThan(0);
    expect(afterTakeover).toBeCloseTo(beforeTakeover, 6); // no rest-pose flash at the authority handoff
    fx.update(1299, 499, true);
    expect(pose.sample(499, 1, -1, 0).ox).toBeCloseTo(-3.5, 3); // a completed guess holds, rather than releasing before the server's 300ms landing
  });

  it("drops a confirmed but not yet rendered windup when a move cancels the server action", () => {
    const { pose, fx } = setup();
    const scene = new RaidScene() as unknown as {
      views: Map<string, { cues: FigurePose }>;
      room: { sessionId: string };
      predict: { motion: { delay: number } };
      attackAnticipation: AttackAnticipation;
      beginAttackAnticipation(a: number, now: number, weapon: string): void;
    };
    scene.views = new Map([["me", { cues: pose }]]);
    scene.room = { sessionId: "me" };
    scene.predict = { motion: { delay: 280 } };
    scene.beginAttackAnticipation(0, 0, "sword");
    fx.enqueue(windup);
    scene.attackAnticipation.confirm(100);
    fx.update(900, 100, true);
    expect(pose.sample(200, 1, -1, 0).ox).toBeLessThan(0);

    fx.dropWindups("me", 1000, 250); // same path used by RaidScene's movement/target/cast cancellation
    fx.update(1000, 250, true);
    expect(pose.sample(600, 1, -1, 0).ox).toBeCloseTo(0, 1);
  });

  it("does not create pending state if RaidScene has no local PlayerView cue target", () => {
    const scene = new RaidScene() as unknown as {
      views: Map<string, unknown>;
      room: { sessionId: string };
      predict: { motion: { delay: number } };
      attackAnticipation: AttackAnticipation;
      beginAttackAnticipation(a: number, now: number, weapon: string): void;
    };
    scene.views = new Map();
    scene.room = { sessionId: "me" };
    scene.predict = { motion: { delay: 100 } };
    scene.beginAttackAnticipation(0, 0, "sword");
    expect(scene.attackAnticipation.pending).toBe(false);
  });

  it("uses the melee pose for axe swings and the ranged pose for bow draws", () => {
    const poseFor = (weapon: string) => {
      const pose = new FigurePose();
      const scene = new RaidScene() as unknown as {
        views: Map<string, { cues: FigurePose }>;
        room: { sessionId: string };
        predict: { motion: { delay: number } };
        beginAttackAnticipation(a: number, now: number, weapon: string): void;
      };
      scene.views = new Map([["me", { cues: pose }]]);
      scene.room = { sessionId: "me" };
      scene.predict = { motion: { delay: 300 } };
      scene.beginAttackAnticipation(0, 0, weapon);
      return pose.sample(16, 1, -1, 0).ox;
    };
    const axe = Math.abs(poseFor("axe")), bow = Math.abs(poseFor("bow"));
    expect(axe).toBeGreaterThanOrEqual(0.5);
    expect(bow).toBeGreaterThanOrEqual(0.5);
    expect(axe).toBeGreaterThan(bow);
  });
});
