// How fast does ONE regional mob kill a player who does not fight back? A motionless, weaponless player at 25% hp (the
// default; `--hp 0.5` for another fraction, `--mobs 4` for a whole camp, `--elite` for an elite) stands in front of a mob of
// each zone and the fight is played through step(): the weapon state machines, the ledger, the signature systems and
// mobAI.thinkMobs. The cell is the seconds until the player is dead. No weapon is held and nothing is ever ordered, so the
// number is the mob's own damage output on a full-scale player's hp pool, not a duel (the mobs have 1e9 hp, so a signature
// of the player's that works without a swing cannot end the fight by killing them).
//
// Why it exists (balance contract 6.1, acceptance A13): a Plague mob's `execute` reads the PLAYER's hp fraction, whose pool is
// full-scale, so scaling it by MOB_K alone (as every damage number is) left it 4-5x too strong below half hp. mobFaction
// scales it by k once more (k^2); this bench is the measure. A13: the Plague zone must take at least 0.5x the other zones'
// median to kill.
//
//   npx tsx bench/mobExecute.ts                       the 25% hp table (zone x player faction) and the A13 verdict
//   npx tsx bench/mobExecute.ts --all                 also: full hp, 50% hp, a 4-mob camp at 40% hp, an elite at full hp
//   options: --hp 0.25  --mobs 1  --elite  --cap 120 (seconds)  --json FILE
//
// A13 reads two ratios, both Plague-zone time over the median of the other four zones' times: per player faction (each
// column of the table) and pooled (the Plague row's median over the median of all twenty cells of the other rows). A cell
// that outlived the cap counts as the cap.
import { writeFileSync } from "node:fs";
import { FACTION_IDS, mulberry32, TICK_MS, TILE, type FactionId, type Vec2 } from "@raid/shared";
import { buildArena } from "../src/harness/duel";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { aggro } from "../src/sim/mobAI";
import { placeMob } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";

const CENTER = 20 * TILE;
const NEVER = 1_000_000;
const PID = "p";
/** A13: the Plague zone takes at least this share of the other zones' median to kill. */
export const A13_MIN_RATIO = 0.5;

export interface ExecuteSpec {
  zone: FactionId;
  player: FactionId;
  /** The player's hp as a fraction of its max when the fight starts. */
  hpFrac: number;
  /** How many mobs attack (the first is the elite when `elite`). */
  mobs: number;
  elite: boolean;
  /** Give up after this many seconds. */
  capS: number;
}

export interface ExecuteResult {
  /** Seconds until the player is dead, or null when it outlived the cap. */
  ttk: number | null;
  /** Average dps the player took over the first 5 s (or until it died). */
  dps5: number;
  maxHp: number;
}

export function runMobExecute(spec: ExecuteSpec): ExecuteResult {
  const home: Vec2 = { x: CENTER, y: CENTER };
  const start: Vec2 = { x: CENTER + 90, y: CENTER };
  const world = createGameWorld({
    random: mulberry32(7),
    config: { minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: NEVER, patienceMinSeconds: NEVER, suddenDeathSeconds: NEVER, mobs: false },
    map: { ...buildArena("open", [home, start], 1), spawns: [start] },
  }, { signatures: true });
  const p = addPlayer(world, PID, PID, { faction: spec.player });
  p.weapon0 = "";
  p.weapon1 = "";
  step(world, TICK_MS);
  p.x = start.x;
  p.y = start.y;
  world.players.get(PID)!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
  p.hp = p.maxHp * spec.hpFrac;
  const hp0 = p.hp;
  const ids: string[] = [];
  for (let i = 0; i < spec.mobs; i++) {
    const a = Math.PI + (i / Math.max(1, spec.mobs)) * Math.PI * 2 * 0.75 - 0.4;
    const at = { x: start.x + Math.cos(a) * 70, y: start.y + Math.sin(a) * 70 };
    ids.push(placeMob(world, { region: spec.zone, elite: spec.elite && i === 0, at, facing: Math.atan2(start.y - at.y, start.x - at.x) }));
  }
  for (const id of ids) {
    const m = combatant(world, id)!;
    if (m.kind !== "mob") continue;
    // The player does not fight back, but its signature may (an armed hand engages a burn, a mark or a disease on whoever
    // hits it): an unkillable mob keeps the number the mob's own output, not who wins.
    m.s.hp = m.s.maxHp = 1e9;
    aggro(world, m, PID, 1);
  }
  const maxTicks = Math.round((spec.capS * 1000) / TICK_MS);
  const fiveS = Math.round(5000 / TICK_MS);
  let hp5 = hp0;
  for (let t = 0; t < maxTicks; t++) {
    step(world, TICK_MS);
    if (t === fiveS) hp5 = Math.max(0, p.hp);
    if (p.status !== "alive") {
      const ttk = ((t + 1) * TICK_MS) / 1000;
      if (t < fiveS) hp5 = 0;
      return { ttk, dps5: (hp0 - hp5) / Math.min(5, ttk), maxHp: p.maxHp };
    }
  }
  return { ttk: null, dps5: (hp0 - hp5) / 5, maxHp: p.maxHp };
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface ExecuteTable {
  /** seconds to death by zone (rows) and player faction (columns); the cap where it outlived it. */
  secs: Record<FactionId, Record<FactionId, number>>;
  capped: Record<FactionId, Record<FactionId, boolean>>;
  /** Plague zone over the median of the other zones, per player faction. */
  byPlayer: Record<FactionId, number>;
  /** The Plague row's median over the median of the other rows' cells. */
  pooled: number;
}

export function executeTable(base: Omit<ExecuteSpec, "zone" | "player">): ExecuteTable {
  const secs = {} as ExecuteTable["secs"];
  const capped = {} as ExecuteTable["capped"];
  for (const zone of FACTION_IDS) {
    secs[zone] = {} as Record<FactionId, number>;
    capped[zone] = {} as Record<FactionId, boolean>;
    for (const player of FACTION_IDS) {
      const r = runMobExecute({ ...base, zone, player });
      secs[zone][player] = r.ttk ?? base.capS;
      capped[zone][player] = r.ttk === null;
    }
  }
  const others = FACTION_IDS.filter((z) => z !== "plague");
  const byPlayer = {} as Record<FactionId, number>;
  for (const player of FACTION_IDS) byPlayer[player] = secs.plague[player] / median(others.map((z) => secs[z][player]));
  const pooled = median(FACTION_IDS.map((pf) => secs.plague[pf])) / median(others.flatMap((z) => FACTION_IDS.map((pf) => secs[z][pf])));
  return { secs, capped, byPlayer, pooled };
}

const cell = (t: ExecuteTable, zone: FactionId, player: FactionId): string => `${t.capped[zone][player] ? ">" : ""}${t.secs[zone][player].toFixed(1)}s`;

export function printTable(title: string, t: ExecuteTable): void {
  console.log(`\n### ${title}\n`);
  console.log(`| mob zone \\ player faction | ${FACTION_IDS.join(" | ")} |`);
  console.log(`|---|${FACTION_IDS.map(() => "---").join("|")}|`);
  for (const zone of FACTION_IDS) console.log(`| ${zone} | ${FACTION_IDS.map((pf) => cell(t, zone, pf)).join(" | ")} |`);
  const ratios = FACTION_IDS.map((pf) => t.byPlayer[pf]);
  console.log(`\nPlague zone / median of the other zones, per player faction: ${FACTION_IDS.map((pf) => `${pf} ${t.byPlayer[pf].toFixed(2)}x`).join("  ")}`);
  console.log(`  range ${Math.min(...ratios).toFixed(2)}x - ${Math.max(...ratios).toFixed(2)}x; pooled ${t.pooled.toFixed(2)}x`);
}

function main(): void {
  const args = process.argv.slice(2);
  const flag = (name: string): boolean => args.includes(`--${name}`);
  const value = (name: string, fallback: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
  };
  const capS = value("cap", 120);
  console.log("cell = seconds until a motionless, weaponless player is dead (> = still alive at the cap)");
  const out: Record<string, ExecuteTable> = {};
  const sets: Array<[string, Omit<ExecuteSpec, "zone" | "player">]> = flag("all")
    ? [
      ["one NORMAL mob vs a player at 25% hp (A13)", { hpFrac: 0.25, mobs: 1, elite: false, capS }],
      ["one NORMAL mob vs a player at 50% hp", { hpFrac: 0.5, mobs: 1, elite: false, capS }],
      ["one NORMAL mob vs a full-hp player", { hpFrac: 1, mobs: 1, elite: false, capS }],
      ["4 NORMAL mobs (a camp) vs a player at 40% hp", { hpFrac: 0.4, mobs: 4, elite: false, capS }],
      ["one ELITE mob vs a full-hp player", { hpFrac: 1, mobs: 1, elite: true, capS }],
    ]
    : [[
      `${value("mobs", 1)} ${flag("elite") ? "ELITE" : "NORMAL"} mob${value("mobs", 1) === 1 ? "" : "s"} vs a player at ${Math.round(value("hp", 0.25) * 100)}% hp${value("hp", 0.25) === 0.25 && value("mobs", 1) === 1 && !flag("elite") ? " (A13)" : ""}`,
      { hpFrac: value("hp", 0.25), mobs: value("mobs", 1), elite: flag("elite"), capS },
    ]];
  for (const [title, spec] of sets) {
    const t = executeTable(spec);
    out[title] = t;
    printTable(title, t);
  }
  const a13 = Object.entries(out).find(([title]) => title.includes("(A13)"));
  if (a13) {
    const [, t] = a13;
    const worst = Math.min(...FACTION_IDS.map((pf) => t.byPlayer[pf]));
    console.log(`\nA13 (Plague zone >= ${A13_MIN_RATIO}x the other zones' median): ${t.pooled >= A13_MIN_RATIO ? "PASS" : "FAIL"} pooled (${t.pooled.toFixed(2)}x); worst single player column ${worst.toFixed(2)}x (informational: one cell of five)`);
  }
  const json = args.indexOf("--json");
  if (json >= 0 && args[json + 1]) writeFileSync(args[json + 1]!, JSON.stringify(out, null, 1));
}

// Run only as a script (the tests import runMobExecute / executeTable).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/mobExecute.ts")) main();
