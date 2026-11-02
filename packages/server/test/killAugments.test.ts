// Kill augments (sim/killAugments.ts, shared/killAugments.ts): a credited player kill drops a private Trophy container of the
// victim's top three stats; the owner's pick adds half of that bonus; a mob kill drops nothing.
import { describe, expect, it } from "vitest";
import {
  CHEST_REFUSAL, KILL_AUG_SECONDS, KILL_AUG_SHARE, encodeKillAugment, mapFromTiles, mulberry32, parseKillAugment, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type GameMap,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { recomputeMods } from "../src/sim/mods";
import { placeMob } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import { rewardChests } from "../src/sim/chests";
import type { SimEvent, World } from "../src/sim/world";

const W = 40;
const H = 20;
const at = (t: number): number => t * TILE + TILE / 2;

function arenaMap(): GameMap {
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let tx = 0; tx < W; tx++) { tiles[tx] = TILE_WALL; tiles[(H - 1) * W + tx] = TILE_WALL; }
  for (let ty = 0; ty < H; ty++) { tiles[ty * W] = TILE_WALL; tiles[ty * W + W - 1] = TILE_WALL; }
  return { ...mapFromTiles(W, H, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: at(3 + 4 * i), y: at(15) })), camps: [] };
}

function run(n = 3): World {
  const w = createGameWorld({
    config: { minPlayers: n, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600, mobs: false, pvpRules: false },
    random: mulberry32(5), rewardSalt: 7, map: arenaMap(),
  }, { signatures: false });
  for (let i = 0; i < n; i++) addPlayer(w, `p${i}`, `name${i}`, { faction: "frost" });
  step(w, TICK_MS);
  expect(w.state.phase).toBe("active");
  return w;
}

const P = (w: World, i: number): PlayerState => w.state.players.get(`p${i}`)!;
const choose = (w: World, i: number, chest: string, pick: number): boolean =>
  enqueueClientMessage(w.players.get(`p${i}`)!.inputs, "choose", { chest, pick });
const toasts = (events: readonly SimEvent[], to: string): string[] => events.flatMap((e) => (e.type === "toast" && e.to === to ? [e.text] : []));

/** Gives p`i` invested stats: Offense +12 (pardoner x12), attack speed +9% (plagueRat x9), damage +4% (emberImp x4). */
function invest(w: World, i: number): void {
  P(w, i).mobStats.set("pardoner", 12);
  P(w, i).mobStats.set("plagueRat", 9);
  P(w, i).mobStats.set("emberImp", 4);
  recomputeMods(w, w.players.get(`p${i}`) ? combatant(w, `p${i}`)! : (null as never));
}

function kill(w: World, victim: number, by: string): void {
  recordHit(w, { victim: `p${victim}`, by: { id: by, name: by }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
  applyLedger(w);
}

describe("kill augments", () => {
  it("drops an owner-only trophy of the victim's top stats after a player kill", () => {
    const w = run();
    invest(w, 1);
    kill(w, 1, "p0");
    const boxes = rewardChests(w);
    expect(boxes).toHaveLength(1);
    const box = boxes[0]!;
    expect(box.owner).toBe("p0");
    expect(box.label).toBe("Trophy");
    expect(box.expiresAt - w.state.serverTime).toBe(KILL_AUG_SECONDS * 1000);
    const parsed = [...box.options].map((o) => parseKillAugment(o));
    expect(parsed.every((x) => x !== null)).toBe(true);
    expect(parsed.map((x) => x!.key).sort()).toEqual(["ad", "attackSpeed", "damage"]);
    expect(parsed.find((x) => x!.key === "ad")!.gain).toBeCloseTo(12 * KILL_AUG_SHARE, 5);
  });

  it("grants half the stat to the killer on a pick and refuses everyone else", () => {
    const w = run();
    invest(w, 1);
    kill(w, 1, "p0");
    step(w, TICK_MS); step(w, TICK_MS); step(w, TICK_MS);
    const box = rewardChests(w)[0]!;
    P(w, 0).x = box.x; P(w, 0).y = box.y; P(w, 2).x = box.x + 10; P(w, 2).y = box.y;
    const ad = [...box.options].findIndex((o) => parseKillAugment(o)?.key === "ad");
    const before = P(w, 0).adBonus;
    choose(w, 2, box.id, ad);
    const ev = step(w, TICK_MS);
    expect(toasts(ev, "p2")).toContain(CHEST_REFUSAL.notYours);
    expect(box.takenBy[ad]).toBe("");
    choose(w, 0, box.id, ad);
    step(w, TICK_MS);
    expect(box.takenBy[ad]).toBe("p0");
    expect(P(w, 0).extra.killStats.get("ad")).toBeCloseTo(6, 5);
    expect(P(w, 0).adBonus).toBeCloseTo(before + 60, 0); // the mirror is in tenths
    expect([...P(w, 0).build.keys()]).toEqual([]); // no card, so no card power
    choose(w, 0, box.id, 0);
    expect(toasts(step(w, TICK_MS), "p0")).toContain(CHEST_REFUSAL.picked);
  });

  it("drops nothing for a mob kill, a victim with nothing invested, or a victim's own death", () => {
    const w = run();
    kill(w, 1, "p0");
    expect(rewardChests(w)).toHaveLength(0);
    const w2 = run();
    const mob = placeMob(w2, { region: "fire", elite: false, at: { x: at(10), y: at(10) } });
    recordHit(w2, { victim: mob, by: { id: "p0", name: "p0" }, packet: { raw: 1e6, phys: 1, magic: 0, true: 0 }, weapon: "sword", stagger: false });
    applyLedger(w2);
    expect(rewardChests(w2)).toHaveLength(0);
  });

  it("round-trips the option encoding", () => {
    expect(parseKillAugment(encodeKillAugment("ad", 6))).toEqual({ key: "ad", gain: 6 });
    expect(parseKillAugment("kill:nope:3")).toBeNull();
    expect(parseKillAugment("sharpened")).toBeNull();
  });
});
