import { DEFAULT_MODULES, MODULES } from "../world";
import type { Scenario, Ctx } from "./types";

// Real exported installers, in createGameWorld order. Consumable ID allocation and
// the other faction installers are deliberately absent from this partial foundation.
export const HOLY_MODULES = Object.keys(MODULES).filter(
  (m) => (DEFAULT_MODULES.includes(m) || m === "factions") && m !== "consumables",
);
const rows = Array.from({ length: 24 }, (_, y) => (y === 0 || y === 23 ? "#".repeat(40) : `#${".".repeat(38)}#`));
const base = (name: string, description: string): Scenario => ({
  name,
  description,
  packet: "P-FACTION-1",
  parity: "slice",
  rows,
  randomSeed: 12,
  modules: HOLY_MODULES,
  record: ["signatures", "landed", "combat", "statuses", "containers"],
  players: [
    { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 400 },
    { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 600 },
  ],
  maxTicks: 160,
  requires: ["hit", "heal"],
  drive: () => {},
});
const duel = ({ tick, send, pos, world }: Ctx) => {
  if (tick !== 3) return;
  for (const [id, target] of [
    ["p0", "p1"],
    ["p1", "p0"],
  ]) {
    const a = pos(id!),
      b = pos(target!);
    send(id!, "attack", { a: Math.atan2(b.y - a.y, b.x - a.x), t: world.state.serverTime - 50 });
  }
};
export const holyScenarios: Scenario[] = [
  {
    ...base(
      "holy_reach_low",
      "A real bow trade across LOW, then sword/bow swaps: signature reach uses the current weapon's physical collision mask.",
    ),
    maxTicks: 100,
    rows: rows.map((row, y) => (y === 10 ? row.slice(0, 13) + "~" + row.slice(14) : row)),
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 336 }, hp: 500, weapon0: "bow", weapon1: "sword" },
      { id: "p1", faction: "holy", at: { x: 456, y: 336 }, hp: 700 },
    ],
    drive: ({ tick, send }) => {
      if (tick === 3) send("p0", "attack", { a: 0 });
      if (tick === 18) send("p0", "stop", {});
      if (tick === 20 || tick === 55) send("p0", "swap", {});
    },
    requires: ["hit", "heal", "input:swap"],
  },
  {
    ...base(
      "holy_passive_then_active_retarget",
      "A real shield hit sets a target; reflected arrows preserve it, then an active bow hit retargets.",
    ),
    maxTicks: 120,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon0: "bow" },
      { id: "p1", faction: "holy", at: { x: 620, y: 320 }, hp: 700, weapon0: "shield", weapon1: "bow" },
      { id: "p2", faction: "holy", at: { x: 650, y: 380 }, hp: 700 },
    ],
    drive: ({ tick, send }) => {
      if (tick === 3) {
        send("p0", "attack", { a: 0 });
        send("p1", "attack", { a: Math.atan2(60, 30) });
      }
      if (tick === 4) send("p1", "aim", { a: Math.PI });
      if (tick === 35) send("p1", "swap", {});
    },
    requires: ["block", "hit", "heal", "input:swap"],
  },

  {
    ...base(
      "holy_block_without_damage",
      "A real arrow meets a shield with a trusted initial barrier: block contact engages before any HP damage or heal lockout.",
    ),
    maxTicks: 60,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon0: "bow" },
      { id: "p1", faction: "holy", at: { x: 620, y: 320 }, hp: 700, barrier: 500, weapon0: "shield" },
    ],
    drive: ({ tick, send }) => {
      if (tick === 2) send("p1", "aim", { a: Math.PI });
      if (tick === 3) send("p0", "attack", { a: 0 });
    },
    requires: ["block", "hit", "heal", "launch"],
  },

  ...[20, 400].map(
    (barrier): Scenario => ({
      ...base(
        `holy_barrier_${barrier}`,
        "Trusted initial barrier setup on a real Holy victim: no fake card producer; actual ledger absorption and pre-ledger HP fraction.",
      ),
      maxTicks: 85,
      players: [
        { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 400, barrier: 50 },
        { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 600, barrier },
      ],
      drive: duel,
    }),
  ),

  {
    ...base(
      "holy_lifesteal_low_hp",
      "Holy fists sustain reads HP before damage; genuine factions module, no cards or auxiliary faction installers.",
    ),
    drive: duel,
  },
  {
    ...base(
      "holy_sword_shield",
      "Holy sword versus shield: actual blocked damage, riposte contacts and post-barrier sustain.",
    ),
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon0: "sword" },
      { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 700, weapon0: "shield" },
    ],
    drive: duel,
    requires: ["block", "hit", "heal"],
  },
  {
    ...base(
      "holy_arrow_reflection",
      "A Holy arrow meets a real shield, returns passively and heals its surviving owner on impact.",
    ),
    maxTicks: 150,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon0: "bow" },
      { id: "p1", faction: "holy", at: { x: 620, y: 320 }, hp: 700, weapon0: "shield" },
    ],
    drive: ({ tick, send }) => {
      if (tick === 2) send("p1", "aim", { a: Math.PI });
      if (tick === 3) send("p0", "attack", { a: 0 });
    },
    requires: ["block", "hit", "heal", "launch"],
  },
  {
    ...base("holy_wand_splash", "Holy wand splash feeds multiple victims' landed amounts in original victim order."),
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon0: "wand" },
      { id: "p1", faction: "holy", at: { x: 570, y: 320 } },
      { id: "p2", faction: "holy", at: { x: 580, y: 340 } },
    ],
    drive: ({ tick, send }) => {
      if (tick === 3) send("p0", "attack", { a: 0 });
    },
    requires: ["hit", "heal", "launch"],
  },
  {
    ...base(
      "holy_contact_forget",
      "Initial trade then moving separation: exact reach linger, trade expiry, weapon swaps and ten-second target forgetting.",
    ),
    maxTicks: 240,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon1: "bow" },
      { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 600 },
    ],
    drive: (ctx) => {
      duel(ctx);
      if (ctx.tick === 10) {
        ctx.send("p0", "stop", {});
        ctx.send("p1", "move", { x: 1000, y: 320 });
      }
      if (ctx.tick === 20) ctx.send("p0", "swap", {});
      if (ctx.tick === 35) ctx.send("p0", "swap", {});
    },
  },
  ...[12, 91].map(
    (randomSeed): Scenario => ({
      ...base(
        `holy_contact_tie_${randomSeed}`,
        "Equal real melee contacts choose the salted independent per-tick tie rank in the canonical pN actor namespace.",
      ),
      randomSeed,
      maxTicks: 65,
      players: [
        { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 500, weapon0: "sword" },
        { id: "p1", faction: "holy", at: { x: 456, y: 310 } },
        { id: "p2", faction: "holy", at: { x: 456, y: 330 } },
      ],
      drive: ({ tick, send }) => {
        if (tick === 3) send("p0", "attack", { a: 0 });
      },
    }),
  ),
  {
    ...base(
      "holy_lethal_no_revive",
      "Simultaneous lethal Holy fists keep both fighters dead; player overkill is credited without reviving an attacker.",
    ),
    maxTicks: 45,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 5 },
      { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 5 },
    ],
    drive: duel,
    requires: ["hit", "death", "victory"],
  },
  {
    ...base(
      "holy_overkill_clamp",
      "Surviving Holy attacker gains from player overkill and clamps actual healing at max HP.",
    ),
    maxTicks: 45,
    players: [
      { id: "p0", faction: "holy", at: { x: 400, y: 320 }, hp: 1144 },
      { id: "p1", faction: "holy", at: { x: 456, y: 320 }, hp: 1 },
    ],
    drive: ({ tick, send }) => {
      if (tick === 3) send("p0", "attack", { a: 0 });
    },
    requires: ["hit", "heal", "death"],
  },
];
