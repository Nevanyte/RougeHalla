import assert from "node:assert/strict";
import test from "node:test";
import { canonicalEvent, canonicalJson, r6 } from "./canon";
import { createScenarioWorld, DEFAULT_MODULES } from "./world";
import { mapFromTiles, TICK_MS } from "@raid/shared";
import { addPlayer, step } from "../../packages/server/src/sim/step";
import type { Scenario } from "./scenarios/types";

test("all event payloads survive, including future fx and private streams", () => {
  const event = { type: "fx", fx: { kind: "future", z: [1.23456789, { t: -0.0000005 }], detail: { b: 2, a: 1 }, omitted: undefined } };
  assert.equal(JSON.stringify(canonicalEvent(event as any)), '{"detail":{"a":1,"b":2},"kind":"future","z":[1.234568,{"t":0}]}');
  assert.deepEqual(canonicalEvent({ type: "toast", to: "p1", text: "private" }), { kind: "toast", text: "private", to: "p1" });
  assert.deepEqual(canonicalEvent({ type: "plan", to: "p1", plan: { secret: 2 } } as any), { kind: "plan", plan: { secret: 2 }, to: "p1" });
  assert.equal(canonicalEvent({ type: "gv" } as any), null);
  assert.equal(canonicalEvent({ type: "resolved" } as any), null);
  assert.throws(() => canonicalJson({ n: Infinity }), /non-finite/);
  assert.equal(r6(1.23456789), 1.234568);
});

test("explicit default installers reproduce real createGameWorld without changing order or hidden draws", () => {
  const sc: Scenario = { name: "module_equivalence", description: "test", parity: "slice", rows: [], randomSeed: 12, players: [], maxTicks: 2, drive: () => {} };
  const map = mapFromTiles(30, 30, new Uint8Array(900), 11);
  const a = createScenarioWorld(sc, map);
  const b = createScenarioWorld({ ...sc, modules: DEFAULT_MODULES }, map);
  for (const w of [a, b]) {
    addPlayer(w, "p0", "P0", { faction: "fire" });
    addPlayer(w, "p1", "P1", { faction: "holy" });
  }
  assert.equal(a.orderSalt, b.orderSalt);
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(step(a, TICK_MS).map(canonicalEvent), step(b, TICK_MS).map(canonicalEvent));
    assert.deepEqual(a.state.toJSON(), b.state.toJSON());
  }
  assert.throws(() => createScenarioWorld({ ...sc, modules: ["typo"] }, map), /unknown module typo/);
});

test("faction catalogue exercises each signature rather than only ordinary weapon damage", async () => {
  const { catalogue } = await import("./scenarios/catalogue");
  const { enqueueClientMessage } = await import("../../packages/server/src/sim/inputs");
  const simulate = (sc: Scenario, neutral = false) => {
    const map = mapFromTiles(40, 24, new Uint8Array(40 * 24), 11);
    const w = createScenarioWorld({ ...sc, modules: neutral ? DEFAULT_MODULES : sc.modules }, map);
    for (const p of sc.players) addPlayer(w, p.id, p.id.toUpperCase(), { faction: p.faction });
    step(w, TICK_MS);
    for (const p of sc.players) {
      const s = w.state.players.get(p.id)!;
      s.x = p.at.x; s.y = p.at.y; s.facing = 0;
      w.players.get(p.id)!.history = [{ t: w.state.serverTime, ...p.at }];
    }
    const fx: any[] = [];
    for (let i = 0; i < sc.maxTicks; i++) {
      sc.drive({ world: w, tick: w.state.tick + 1, pos: id => w.state.players.get(id)!, send: (id, type, msg) => {
        assert.ok(enqueueClientMessage(w.players.get(id)!.inputs, type, msg));
      } });
      for (const e of step(w, TICK_MS)) if (e.type === "fx") fx.push(e.fx);
    }
    return fx;
  };
  for (const [faction, signature] of [["fire", "burn"], ["plague", "disease"], ["sentenced", "mark"]]) {
    const sc = catalogue.find(s => s.name === `signature_${faction}`)!;
    assert.ok(simulate(sc).some(e => e.kind === "hit" && e.sig === signature), `${faction} signature never fired`);
    assert.ok(!simulate(sc, true).some(e => e.kind === "hit" && e.sig === signature));
  }
  const holy = catalogue.find(s => s.name === "signature_holy")!;
  assert.ok(simulate(holy).some(e => e.kind === "heal" && e.id === "p0"));
  assert.ok(!simulate(holy, true).some(e => e.kind === "heal" && e.id === "p0"));
  const frost = catalogue.find(s => s.name === "signature_frost")!;
  const swings = (events: any[]) => events.filter(e => e.kind === "swing" && e.by === "p1").length;
  assert.ok(swings(simulate(frost)) < swings(simulate(frost, true)), "Frost must chill the enemy's actual attack timing");
});

test("budgeted capture uses the real edge bucket and records queue-full refusal", async () => {
  const { createIntake } = await import("./intake");
  const { InputQueue } = await import("../../packages/server/src/sim/inputs");
  const intake = createIntake(true), queue = new InputQueue();
  for (let i = 0; i < 30; i++) assert.equal(intake("p0", queue, "move", { x: 1, y: 1 }, 50), true);
  assert.equal(intake("p0", queue, "move", { x: 1, y: 1 }, 50), false);
  assert.equal(intake("p0", queue, "aim", { a: 0 }, 50), true);
  assert.equal(intake("p0", queue, "move", { x: 1, y: 1 }, 100), false);
  assert.equal(intake("p0", queue, "move", { x: 1, y: 1 }, 150), true);
  const unbudgeted = createIntake(false), full = new InputQueue();
  for (let i = 0; i < 6; i++) assert.equal(unbudgeted("p1", full, "attack", { a: 0 }, 0), true);
  assert.equal(unbudgeted("p1", full, "attack", { a: 0 }, 0), false);
});
