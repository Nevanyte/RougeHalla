import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadConfig } from "../../packages/server/src/config";
import { InputQueue } from "../../packages/server/src/sim/inputs";
import { CAPTURE_FREE_MESSAGE_TYPES, createIntake } from "./intake";

const roomSource = readFileSync(new URL("../../packages/server/src/rooms/RaidRoom.ts", import.meta.url), "utf8");

test("capture free-message classification is the actual RaidRoom admission policy", () => {
  // Source-backed intentionally: a policy refactor must update this guard rather than silently copying an old policy.
  const declaration = roomSource.match(/const FREE_MESSAGE_TYPES:\s*ReadonlySet<string>\s*=\s*new Set\((\[[^\]]*\])\);/);
  assert.ok(declaration, "RaidRoom free-message declaration changed: verify its admission policy");
  const actual = JSON.parse(declaration[1]) as string[];
  assert.deepEqual([...CAPTURE_FREE_MESSAGE_TYPES].sort(), actual.sort());
  assert.match(roomSource, /if \(!FREE_MESSAGE_TYPES\.has\(type\) && !this\.orderAllowed\(client\.sessionId\)\) return;/);
});

test("production zero burst or refill disables the order limiter", () => {
  for (const env of [{ ORDER_BURST: "0" }, { ORDER_PER_SECOND: "0" }]) {
    const intake = createIntake(true, loadConfig(env)), queue = new InputQueue();
    for (let i = 0; i < 100; i++) assert.equal(intake("p0", queue, "move", { x: 1, y: 1 }, 0), true);
  }
});

test("frozen acceptance fixture uses production defaults and a burst increase changes its transcript", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/order_budget.json", import.meta.url), "utf8"));
  const replay = (intake: ReturnType<typeof createIntake>) => {
    const queues = new Map<string, InputQueue>();
    return fixture.ticks.flatMap((tick: { tick: number; serverTime: number }) => {
      const outcomes = fixture.inputs.filter((input: { tick: number }) => input.tick === tick.tick).map((input: any) => {
        let queue = queues.get(input.player);
        if (!queue) queues.set(input.player, queue = new InputQueue());
        return intake(input.player, queue, input.type, input.msg, tick.serverTime - fixture.legacyConfig.tickMs);
      });
      for (const queue of queues.values()) queue.drain();
      return outcomes;
    });
  };
  const expected = fixture.inputs.map((input: { accepted?: boolean }) => input.accepted ?? true);
  assert.deepEqual(replay(createIntake(true)), expected, "capture must follow production defaults rather than its own constants");
  const defaults = loadConfig({});
  const mutated = replay(createIntake(true, loadConfig({ ORDER_BURST: String(defaults.orderBurst + 1) })));
  assert.notDeepEqual(mutated, expected, "negative control: changing production burst must change capture acceptance");
  const firstRefusal = expected.indexOf(false);
  assert.equal(mutated[firstRefusal], true, "the extra production token must admit the formerly refused order");
});
