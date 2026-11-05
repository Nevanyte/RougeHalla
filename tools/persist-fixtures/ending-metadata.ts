// Actual RaidRoom admission/settle/bankVoided + JsonProfileStore, using synthetic profiles and a deterministic world.
// Transport methods alone are stubbed; no adapter/persistence rule is reimplemented here.
// Run from the repository root: node --import tsx tools/persist-fixtures/ending-metadata.ts [--check]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActiveProfiles, RaidRoom } from "../../packages/server/src/rooms/RaidRoom.ts";
import { JsonProfileStore, type RunRecord } from "../../packages/server/src/persistence/ProfileStore.ts";
import { createWorld } from "../../packages/server/src/sim/world.ts";
import { abandonPlayer, removePlayer, startRaid } from "../../packages/server/src/sim/step.ts";
import { downPlayer, markTickStart, settle } from "../../packages/server/src/sim/arena.ts";
import { dropBody } from "../../packages/server/src/sim/loot.ts";
import { handleSwap } from "../../packages/server/src/sim/weapons.ts";
import { mulberry32, type FactionId, type WeaponId } from "@raid/shared";

type Plan = {
  name: string; faction: FactionId | null; weapon0: WeaponId | null; weapon1: WeaponId | null;
  slot: 0 | 1; swap: boolean; finish: "won" | "died" | "mia" | "posthumous" | "draw" | "void";
  qualified: boolean; bot: boolean; training: boolean; earned: number;
};
const plan = (name: string, overrides: Partial<Plan> = {}): Plan => ({
  name, faction: "frost", weapon0: "wand", weapon1: null, slot: 0, swap: false,
  finish: "won", qualified: true, bot: false, training: false, earned: 0, ...overrides,
});
const plans = [
  plan("explicit-faction-wand"), plan("default-faction", { faction: null }),
  plan("selected-empty-other-armed", { weapon0: null, weapon1: "axe" }),
  plan("both-empty-fists", { weapon0: null }),
  plan("second-slot-held", { weapon1: "shield", slot: 1 }),
  plan("swapped-from-wand", { weapon1: "sword", swap: true }),
  plan("last-held-before-death", { finish: "died" }),
  plan("active-mia", { finish: "mia" }),
  plan("posthumous-qualified-winner", { finish: "posthumous" }),
  plan("draw-after-body-drops", { finish: "draw" }),
  plan("withheld-held-wand", { qualified: false }),
  plan("void-earned", { finish: "void", earned: 7 }),
  plan("void-zero", { finish: "void" }),
  plan("bot-suppressed", { bot: true }),
  plan("training-second-guard", { training: true }),
];
const dir = mkdtempSync(join(tmpdir(), "rh-ending-capture-"));
const observations = [];
try {
  for (const input of plans) {
    const store = new JsonProfileStore(join(dir, `${input.name}.json`), { clock: () => 1_700_000_000_000 });
    try {
      for (const name of ["Subject", "OtherB", "OtherC"]) store.claim(name);
      const records: RunRecord[] = [];
      const banks: number[] = [];
      const recordRun = store.recordRun.bind(store);
      store.recordRun = (name, r) => { if (name === "Subject") records.push(JSON.parse(JSON.stringify(r))); return recordRun(name, r); };
      const bankGv = store.bankGv.bind(store);
      store.bankGv = (name, gv) => { if (name === "Subject") banks.push(gv); bankGv(name, gv); };
      const world = createWorld({ seed: 1, random: mulberry32(2), config: {
        minPlayers: 3, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 100, suddenDeathSeconds: 100, pvpRules: false,
      }});
      world.hooks.dropBody = dropBody;
      // The real prototype methods run on a room shell: no sockets, timers, bot manager, or live server needed.
      const room = Object.assign(Object.create(RaidRoom.prototype), {
        built: world, seats: new Map(), picked: new Map(), pendingResults: new Map(),
        training: false, liveness: { touch() {} }, sendInFlight() {}, sendTo() {},
      });
      Object.defineProperty(room, "roomId", { value: "capture" });
      RaidRoom.ctx = { store, profiles: new ActiveProfiles() } as typeof RaidRoom.ctx;
      for (const [sessionId, faction] of [["Subject", input.faction], ["OtherB", null], ["OtherC", null]] as const) {
        room.onJoin({ sessionId, auth: { profile: sessionId, faction } });
      }
      world.state.serverTime = 50;
      startRaid(world);
      world.events.length = 0;
      const p = world.state.players.get("Subject")!;
      const rt = world.players.get("Subject")!;
      p.weapon0 = input.weapon0 ?? ""; p.weapon1 = input.weapon1 ?? ""; p.slot = input.slot;
      if (input.swap) handleSwap(world, { kind: "player", id: rt.id, s: p, rt }, { kind: "swap", slot: 1 });
      if (input.qualified) rt.damagedHumans = new Set(["OtherB", "OtherC"]);
      rt.gv.quest = input.earned;
      if (input.bot) rt.bot = true;
      room.training = input.training;
      if (input.finish === "void") {
        room.bankVoided("Subject", abandonPlayer(world, "Subject"));
      } else if (input.finish === "mia") {
        removePlayer(world, "Subject");
      } else {
        if (input.finish === "posthumous" || input.finish === "draw") {
          for (const [id, s] of world.state.players) s.hp = s.maxHp * (id === "Subject" || input.finish === "draw" ? 1 : 0.5);
        }
        markTickStart(world);
        world.stepping = true;
        const downs = input.finish === "died" ? ["Subject"]
          : input.finish === "won" ? ["OtherB", "OtherC"] : ["Subject", "OtherB", "OtherC"];
        for (const id of downs) downPlayer(world, world.state.players.get(id)!, world.players.get(id)!, "died");
        world.stepping = false;
        settle(world);
      }
      let result = null;
      for (const e of world.events) if (e.type === "resolved") {
        if (e.id === "Subject") result = e.result;
        room.settle(e.id, e.result, e.bot === true);
      }
      if (records.length > 1) throw new Error("duplicate subject record");
      const after = store.get("Subject")!;
      observations.push({ input, result, record: records[0] ?? null, banks, stats: after.stats, progress: after.progress, gv: after.gv });
    } finally { await store.close(); }
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
const text = JSON.stringify({ format: "rh-ending-metadata/1", source: "RaidRoom.onJoin/settle/bankVoided -> JsonProfileStore", cases: observations }, null, 2) + "\n";
const path = new URL("../../parity/persistence/ending-metadata.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== text) throw new Error("Legacy ending metadata changed; reconcile before regeneration");
} else writeFileSync(path, text);
console.log(`${observations.length} actual legacy adapter/store cases ${process.argv.includes("--check") ? "unchanged" : "captured"}`);
