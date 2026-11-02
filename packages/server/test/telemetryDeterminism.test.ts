// docs/TELEMETRY.md 2: a world with the recorder installed produces the same events and state, tick for tick, as one without,
// through a teleport and a run end. The same headless bot game also yields a record that validates and is tagged as bots.
import { describe, expect, it } from "vitest";
import { validateRunRecord, type RunRecord } from "@raid/shared";
import { BOT_FILL_DEFAULTS } from "../src/bots/brain/types";
import { createHeadlessRoom, type HeadlessRoom } from "../src/bots/tournament/headlessRoom";
import { TelemetryRuntime } from "../src/telemetry/runtime";
import type { SimEvent } from "../src/sim/world";

function room(seed: number, telemetry?: TelemetryRuntime): HeadlessRoom {
  return createHeadlessRoom({
    seed,
    config: { patienceSeconds: 25, patienceMinSeconds: 25, suddenDeathSeconds: 8 },
    bots: { ...BOT_FILL_DEFAULTS, fillTo: 8 },
    lineup: Array.from({ length: 8 }, (_, i) => ({ tier: (["easy", "normal", "hard"] as const)[i % 3] })),
    ...(telemetry ? { telemetry } : {}),
  });
}

/** A cheap digest of what a tick did and left: every event, every player's and mob's state that a recorder could disturb. */
function digest(r: HeadlessRoom, events: readonly SimEvent[]): string {
  const s = r.world.state;
  const parts: string[] = [String(s.tick), s.phase, String(s.gatesLocked), JSON.stringify(events)];
  for (const [id, p] of s.players) parts.push(`${id}:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.hp.toFixed(3)},${p.status},${p.kills},${p.gv},${p.weapon0},${p.weapon1}`);
  for (const [id, m] of s.mobs) parts.push(`${id}:${m.x.toFixed(2)},${m.y.toFixed(2)},${m.hp.toFixed(2)},${m.status}`);
  parts.push(String(s.containers.size), String(r.world.idCounter));
  return parts.join("|");
}

describe("telemetry determinism", () => {
  it("the recorder changes nothing, tick for tick; the game's record validates", () => {
    const records: RunRecord[] = [];
    const telemetry = new TelemetryRuntime({
      sink: { submit: (rec) => { records.push(rec); }, close: async () => {}, stats: () => ({ sent: 0, dropped: 0, failed: 0, queued: 0 }) },
      source: "test", build: { server: "test-build", commit: null }, salt: null, positions: true, botsFillTo: 0,
    });
    const seed = 4242;
    const plain = room(seed);
    const recorded = room(seed, telemetry);
    let teleported = false;
    let ticks = 0;
    for (; ticks < 6000 && plain.world.state.phase !== "ended"; ticks++) {
      const a = plain.tick();
      const b = recorded.tick();
      if (plain.world.state.gatesLocked) teleported = true;
      const da = digest(plain, a);
      const db = digest(recorded, b);
      if (da !== db) expect.fail(`tick ${plain.world.state.tick} differs`);
    }
    expect(recorded.world.state.phase).toBe(plain.world.state.phase);
    expect(teleported).toBe(true);
    expect(plain.world.state.phase).toBe("ended");
    expect(records).toHaveLength(plain.world.state.phase === "ended" ? 1 : 0);
    if (!records[0]) recorded.telemetry!.finalize("abandoned");
    const record = records[0]!;
    expect(validateRunRecord(record)).toBeNull();
    expect(record.bots).toBe(8);
    expect(record.humans).toBe(0);
    expect(record.players.every((p) => p.bot && p.pid === null && p.tier !== undefined && p.persona !== undefined)).toBe(true);
    // Every death has a known cause (docs/TELEMETRY.md 3.5).
    for (const p of record.players) if (p.death) expect(p.death.kind).not.toBe("unknown");
    const json = JSON.stringify(record);
    console.log(`telemetry determinism: ${ticks} ticks, teleported ${teleported}, end ${record.end}, ${record.duels.length} duels, ` +
      `${record.offers.length} offers, ${record.camps.length} camp clears, ${(json.length / 1024).toFixed(1)} KB of JSON`);
  }, 240_000);
});
