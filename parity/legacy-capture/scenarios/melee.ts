import { DEFAULT_MODULES } from "../world";
import type { Scenario, Ctx, PlayerDef } from "./types";

const rows = Array.from({ length: 24 }, (_, y) => y === 0 || y === 23 ? "#".repeat(40) : `#${".".repeat(38)}#`);
const at = (x: number) => ({ x, y: 320 });
const player = (id: string, x: number, weapon0?: string, weapon1?: string): PlayerDef =>
  ({ id, at: at(x), faction: id === "p0" ? "frost" : "holy", weapon0, weapon1 });
const fight = ({ send }: Ctx) => {
  send("p0", "attack", { a: 0 });
  send("p1", "attack", { a: Math.PI });
};
const melee = (name: string, description: string, players: PlayerDef[], requires: string[], drive: Scenario["drive"]): Scenario =>
  ({ name, packet: "P-COMBAT-1", description, parity: "slice", rows, randomSeed: 12, players, maxTicks: 1200,
     // P-CONS-1 owns timed emblems. Keep a separate full-module fixture below.
     modules: DEFAULT_MODULES.filter(m => m !== "consumables"),
     record: ["combat", "containers", "statuses"], requires: ["hit", "death", ...requires], drive });

export const meleeScenarios: Scenario[] = [
  melee("sword_vs_fists", "An armed sword trades instant swings with an empty hand until settlement.",
    [player("p0", 400, "sword"), player("p1", 450)], ["swing"],
    ctx => { if (ctx.tick === 3) fight(ctx); }),
  melee("shield_block_riposte", "A frontal shield returns the stopped part of a sword hit; turning away lets the next sword land whole.",
    [player("p0", 400, "sword"), player("p1", 456, "shield")], ["block"],
    ctx => {
      if (ctx.tick === 3) fight(ctx);
      if (ctx.tick === 70) ctx.send("p1", "aim", { a: 0 });
      if (ctx.tick === 102) ctx.send("p1", "aim", { a: Math.PI });
    }),
  melee("axe_shred_stack", "Axe hits stack twice, lapse during a pause, then reapply to the shield holder.",
    [player("p0", 400, "axe"), player("p1", 456, "shield")], ["state:shred"],
    ctx => {
      if (ctx.tick === 3) { ctx.send("p1", "aim", {a:Math.PI}); ctx.send("p0","attack",{a:0}); }
      if (ctx.tick === 50) ctx.send("p0","release",{a:0});
      if (ctx.tick === 126) fight(ctx);
    }),
  melee("sword_stagger_cancel", "An unblocked sword cancels an active wand cast. The defender changes to fists and finishes the fight.",
    [player("p0", 400, "sword"), player("p1", 456, "wand")], ["stagger","input:swap"],
    ctx => {
      if (ctx.tick === 3) fight(ctx);
      if (ctx.tick === 4) ctx.send("p1","swap",{slot:1});
    }),
  {
    ...melee("swap_cooldown", "Swaps to an empty hand, back to axe and across an attack cooldown accumulate their full time; specials off leaves the axe's damage alone.",
      [player("p0", 400, "axe"), player("p1", 456, "shield")], ["input:swap"],
      ctx => {
        if (ctx.tick === 3) fight(ctx);
        if (ctx.tick === 4 || ctx.tick === 6 || ctx.tick === 7 || ctx.tick === 9) ctx.send("p0", "swap", {});
      }), config: { weaponSpecials: false },
  },
  {
    ...melee("pickup_replace_drop", "A full rack pickup replaces the hand weapon. Its new ground drop is guessed too soon, then recovered; the winner settles with a body still on the floor.",
      [player("p0", 400, "sword", "shield"), player("p1", 456)], ["toast","input:pickup","input:swap"],
      ctx => {
        if (ctx.tick === 3) { ctx.send("p0","pickup",{containerId:"c1"}); ctx.send("p0","pickup",{containerId:"c2"}); }
        if (ctx.tick === 4) ctx.send("p0","pickup",{containerId:"c2"});
        if (ctx.tick === 5) ctx.send("p0","swap",{slot:1});
        if (ctx.tick === 6) fight(ctx);
      }), containers: [{ weapon: "axe", at: at(400) }],
  },
];

meleeScenarios.push({
  ...meleeScenarios[0]!, name: "emblem_during_melee", packet: "P-CONS-1", parity: "capture-only",
  description: "Production module installation adds a wind emblem at tick 238 while the sword duel is in progress.",
  modules: undefined, requires: ["state:consumable", "hit", "death"],
});
