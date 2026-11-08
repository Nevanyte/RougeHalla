import { HOLY_MODULES } from "./holy";
import type { Scenario, Ctx } from "./types";

// The production module order, restricted to the Holy/Sentenced foundation plus the hunt
// installer. No consume/corpse/roam/passive producers, cards or walk hints.
export const SENTENCED_HUNT_MODULES = (() => {
  const mods = [...HOLY_MODULES];
  const at = mods.indexOf("mods");
  if (at < 0) throw new Error("HOLY_MODULES lost its mods terminator");
  mods.splice(at, 0, "sentencedHunt");
  return mods;
})();

const rows = Array.from({ length: 30 }, (_, y) =>
  y === 0 || y === 29 ? "#".repeat(80) : `#${".".repeat(78)}#`,
);
const base: Scenario = {
  name: "",
  description: "",
  packet: "P-FACTION-4",
  parity: "slice",
  factionSlice: "player-engagement-holy-plague-fire-frost-sentenced-hunt/1",
  modules: SENTENCED_HUNT_MODULES,
  rows,
  randomSeed: 12,
  maxTicks: 180,
  record: ["hunt"],
  players: [],
  drive: () => {},
  requires: ["input:huntTarget"],
};
const attack = (c: Ctx, id: string, target: string) => {
  const a = c.pos(id), b = c.pos(target);
  c.send(id, "attack", { a: Math.atan2(b.y - a.y, b.x - a.x) });
};
const hunt = (c: Ctx, id: string, target: string) => c.send(id, "huntTarget", { id: target });

export const huntScenarios: Scenario[] = [
  {
    ...base,
    name: "sentenced_hunt_select_and_death",
    description:
      "Ordinary selection with a living target refusal, a real bow death that pays one completed-hunt stack, and replacement after death.",
    maxTicks: 170,
    players: [
      { id: "p0", faction: "sentenced", at: { x: 400, y: 320 }, hp: 5000, weapon0: "bow" },
      { id: "p1", faction: "fire", at: { x: 460, y: 320 }, hp: 160 },
      { id: "p2", faction: "holy", at: { x: 620, y: 320 }, hp: 5000 },
      { id: "p3", faction: "holy", at: { x: 1450, y: 800 }, hp: 5000 },
    ],
    drive: c => {
      if (c.tick === 2) hunt(c, "p0", "p1");
      if (c.tick === 3) attack(c, "p0", "p1");
      if (c.tick === 10) hunt(c, "p0", "p2");
      if (c.tick === 25) attack(c, "p0", "p1");
      if (c.tick === 60) hunt(c, "p0", "p2");
      if (c.tick === 62) attack(c, "p0", "p2");
    },
    requires: ["hit", "death", "input:huntTarget"],
  },
  {
    ...base,
    name: "sentenced_hunt_mia_clears",
    description:
      "An ordinary selected rival leaves (MIA): the selection clears without a completed-hunt stack, then a new living rival is accepted.",
    maxTicks: 70,
    players: [
      { id: "p0", faction: "sentenced", at: { x: 400, y: 320 }, hp: 5000, weapon0: "bow" },
      { id: "p1", faction: "fire", at: { x: 460, y: 320 }, hp: 5000 },
      { id: "p2", faction: "holy", at: { x: 620, y: 320 }, hp: 5000 },
      { id: "p3", faction: "holy", at: { x: 1450, y: 800 }, hp: 5000 },
    ],
    drive: c => {
      if (c.tick === 2) hunt(c, "p0", "p1");
      if (c.tick === 30) hunt(c, "p0", "p2");
    },
    actions: [{ tick: 20, player: "p1", kind: "remove" }],
    requires: ["input:huntTarget"],
  },
  {
    ...base,
    name: "sentenced_hunt_hunter_death_clears",
    description:
      "A low-HP Sentenced hunter selects a rival and is then killed by that rival: the hunter's own selection clears and pays no stack.",
    maxTicks: 90,
    players: [
      { id: "p0", faction: "sentenced", at: { x: 420, y: 320 }, hp: 60, weapon0: "bow" },
      { id: "p1", faction: "fire", at: { x: 480, y: 320 }, hp: 5000, weapon0: "bow" },
      { id: "p2", faction: "holy", at: { x: 620, y: 320 }, hp: 5000 },
      { id: "p3", faction: "holy", at: { x: 1450, y: 800 }, hp: 5000 },
    ],
    drive: c => {
      if (c.tick === 2) hunt(c, "p0", "p1");
      if (c.tick === 3) attack(c, "p1", "p0");
    },
    requires: ["hit", "death", "input:huntTarget"],
  },
  {
    ...base,
    name: "sentenced_hunt_toward_move",
    description:
      "Ordinary walks toward, then away from, the selected rival: the +5% leg bonus changes the actual positions without any injected velocity.",
    maxTicks: 150,
    players: [
      { id: "p0", faction: "sentenced", at: { x: 300, y: 400 }, hp: 5000 },
      { id: "p1", faction: "fire", at: { x: 600, y: 400 }, hp: 5000 },
      { id: "p2", faction: "holy", at: { x: 1450, y: 800 }, hp: 5000 },
    ],
    drive: c => {
      if (c.tick === 2) hunt(c, "p0", "p1");
      if (c.tick === 3) c.send("p0", "move", { x: 700, y: 400 });
      if (c.tick === 55) c.send("p0", "move", { x: 300, y: 700 });
      if (c.tick === 105) c.send("p0", "stop", {});
    },
    requires: ["input:huntTarget", "input:move"],
  },
  {
    ...base,
    name: "sentenced_hunt_vision_exception",
    description:
      "At equal fog distance only the selected rival is revealed; the unselected player at the same position remains unseen.",
    maxTicks: 8,
    vision: { viewers: ["p0"], points: [{ x: 2300, y: 400 }, { x: 2300, y: 1400 }] },
    players: [
      { id: "p0", faction: "sentenced", at: { x: 300, y: 400 }, hp: 5000 },
      { id: "p1", faction: "fire", at: { x: 2300, y: 400 }, hp: 5000 },
      { id: "p2", faction: "holy", at: { x: 2300, y: 1400 }, hp: 5000 },
    ],
    drive: c => {
      if (c.tick === 2) hunt(c, "p0", "p1");
    },
    requires: ["input:huntTarget"],
  },
  {
    ...base,
    name: "sentenced_hunt_run_end_clears",
    description:
      "Two ordinary bow kills with a genuine hunt replacement end the run; the winner's selection is cleared by runEnded.",
    maxTicks: 220,
    players: [
      { id: "p0", faction: "sentenced", at: { x: 400, y: 320 }, hp: 5000, weapon0: "bow" },
      { id: "p1", faction: "fire", at: { x: 460, y: 320 }, hp: 80 },
      { id: "p2", faction: "holy", at: { x: 620, y: 320 }, hp: 80 },
    ],
    drive: c => {
      if (c.tick === 2) hunt(c, "p0", "p1");
      if (c.tick === 3) attack(c, "p0", "p1");
      if (c.tick === 55) hunt(c, "p0", "p2");
      if (c.tick === 57) attack(c, "p0", "p2");
    },
    requires: ["hit", "death", "victory", "input:huntTarget"],
  },
];
