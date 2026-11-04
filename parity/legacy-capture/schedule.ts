// Records the legacy tick schedule as data: the fixed phase order of `updateActive` (packages/server/src/sim/step.ts) and
// the RESOLVED order of every runtime-registered hook list (afterWeapons, beforeDamage, systems, moveModifiers, modSources),
// each entry attributed to the module that registered it. In the legacy game that order is emergent: it follows the
// MODULES install list in gameplay.ts and each module's push/unshift calls (fireRoam unshifts). The Rust core declares its
// schedule statically (crates/rh-sim/src/schedule.rs) and a test checks it against this file, so a port can neither
// reorder a system nor silently skip one.
//
//   npx tsx parity/legacy-capture/schedule.ts [--out parity/schedule]
//
// Two worlds are recorded: "production" (createGameWorld defaults, what RaidRoom runs) and "capture" (the module set
// capture.ts uses for the parity fixtures: signatures and walk hints off). Each is rebuilt module by module to attribute
// entries, then cross-checked against the real createGameWorld: a mismatch (e.g. gameplay.ts changed its skip rules) throws.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mulberry32, mapFromTiles, TILE_FLOOR } from "@raid/shared";
import { createGameWorld } from "../../packages/server/src/sim/gameplay";
import { createWorld, type World } from "../../packages/server/src/sim/world";
import { loadConfig } from "../../packages/server/src/config";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const simDir = join(repo, "packages/server/src/sim");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(repo, outArg > 0 ? process.argv[outArg + 1]! : "parity/schedule");

const LISTS = ["afterWeapons", "beforeDamage", "systems", "moveModifiers", "modSources"] as const;
type ListName = (typeof LISTS)[number];

function revision(): string {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: repo }).toString().trim();
    const dirty = execSync("git status --porcelain -- packages", { cwd: repo }).toString().trim() !== "";
    return dirty ? `${sha}+dirty-packages` : sha;
  } catch { return "unknown"; }
}

/** MODULES from gameplay.ts, in install order, as [installName, moduleFile]. */
function modules(): Array<[string, string]> {
  const src = readFileSync(join(simDir, "gameplay.ts"), "utf8");
  const imports = new Map<string, string>();
  for (const m of src.matchAll(/import \{ install as (install\w+) \} from "\.\/(\w+)";/g)) imports.set(m[1]!, m[2]!);
  const body = /const MODULES.*= \[\n([\s\S]*?)\n\];/.exec(src);
  if (!body) throw new Error("gameplay.ts: MODULES not found");
  const names = body[1]!.replace(/\/\/.*$/gm, "").split(",").map((s) => s.trim()).filter(Boolean);
  return names.map((n) => {
    const file = imports.get(n);
    if (!file) throw new Error(`gameplay.ts: no import for ${n}`);
    return [n, file];
  });
}

/** The modules createGameWorld leaves out for these options (mirrors gameplay.ts; the cross-check below proves it). */
function skipped(install: string, opts: { signatures?: boolean; walkHints?: boolean }): boolean {
  if (install === "installWalkHint" && opts.walkHints === false) return true;
  const sig = ["installFactions", "installFireRoam", "installBruiserPassives", "installPlagueCorpses",
    "installPlagueZombies", "installSentencedHunt"];
  return sig.includes(install) && opts.signatures === false;
}

type WorldKind = "production" | "capture";

/** production: the live server's sim config with every env default (loadConfig({}), what RaidRoom passes);
 *  capture: the config capture.ts builds its parity fixtures with. */
function worldOpts(kind: WorldKind) {
  const w = 12, h = 8;
  const map = mapFromTiles(w, h, new Uint8Array(w * h).fill(TILE_FLOOR), 11);
  const config = kind === "production" ? loadConfig({}) : {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 3600,
  };
  return {
    seed: 11, map, config,
    random: mulberry32(1), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8],
  } as Parameters<typeof createWorld>[0];
}

type Entry = { module: string; fn: string };

async function resolveSchedule(kind: WorldKind, opts: { signatures?: boolean; walkHints?: boolean }) {
  const world = createWorld(worldOpts(kind)) as World & Record<ListName, unknown[]>;
  const owner = new Map<unknown, string>();
  const actions: Record<string, string> = {};
  // A hook chain in execution order: chainHook runs the earlier link first (world.ts), so the modules that set it, in
  // install order. (A module that replaced a hook without chaining it would look the same here.)
  const hooks: Record<string, string[]> = {};
  const installed: string[] = [];
  for (const [install, file] of modules()) {
    if (skipped(install, opts)) continue;
    const mod = await import(pathToFileURL(join(simDir, `${file}.ts`)).href);
    const beforeActions = { ...world.actions };
    const beforeHooks = { ...world.hooks };
    mod.install(world);
    installed.push(file);
    for (const l of LISTS) for (const f of world[l]) if (!owner.has(f)) owner.set(f, file);
    for (const [k, v] of Object.entries(world.actions)) if ((beforeActions as Record<string, unknown>)[k] !== v) actions[k] = file;
    for (const [k, v] of Object.entries(world.hooks)) if ((beforeHooks as Record<string, unknown>)[k] !== v) (hooks[k] ??= []).push(file);
  }
  const lists = Object.fromEntries(LISTS.map((l) => [l, world[l].map((f) => ({
    module: owner.get(f)!, fn: (f as { name?: string }).name || "<anonymous>",
  }) satisfies Entry)])) as Record<ListName, Entry[]>;

  // Cross-check against the real thing.
  const real = createGameWorld(worldOpts(kind), opts) as World & Record<ListName, unknown[]>;
  for (const l of LISTS) {
    const a = real[l].map((f) => (f as { name?: string }).name || "<anonymous>");
    const b = lists[l].map((e) => e.fn);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`${l}: rebuilt order differs from createGameWorld\n real: ${a.join(", ")}\n ours: ${b.join(", ")}`);
    }
  }
  if (JSON.stringify(Object.keys(real.actions).sort()) !== JSON.stringify(Object.keys(actions).sort())) {
    throw new Error("actions differ from createGameWorld");
  }
  return { modules: installed, lists, actions, hooks };
}

/** The fixed phases of updateActive in source order (each top-level statement that runs something). */
function fixedPhases(): string[] {
  const src = readFileSync(join(simDir, "step.ts"), "utf8");
  const start = src.indexOf("function updateActive(");
  if (start < 0) throw new Error("step.ts: updateActive not found");
  const end = src.indexOf("\n}\n", start);
  const lines = src.slice(start, end).split("\n").slice(1);
  const rules: Array<[RegExp, string]> = [
    [/^ {2}if \(world\.arena\.voided\) return;/, "guard:voided"],
    [/^ {2}markTickStart\(world\);/, "markTickStart"],
    [/^ {2}world\.combat\.ledger = world\.combat\.deferred;/, "ledger:openWithDeferred"],
    [/^ {2}const order = actionOrder\(world\);/, "actionOrder"],
    [/^ {2}for \(const id of order\) applyInputs/, "inputs:players(actionOrder)"],
    [/^ {2}for \(const id of world\.mobs\.keys\(\)\) applyInputs/, "inputs:mobs(insertionOrder)"],
    [/^ {2}updateAbilities\(world\);/, "abilities"],
    [/^ {2}updateTargets\(world\);/, "targets"],
    [/^ {2}updateWeapons\(world\);/, "weapons"],
    [/^ {2}runTimed\(world, world\.afterWeapons/, "hooks:afterWeapons"],
    [/^ {2}const mults = fighters\.map/, "movement:multipliers(moveModifiers)"],
    [/^ {2}fighters\.forEach/, "movement:walk"],
    [/^ {2}for \(const c of fighters\) recordHistory/, "movement:recordHistory"],
    [/^ {2}sweepProjectiles\(world, dtMs\);/, "projectiles:sweep"],
    [/^ {2}spawnProjectiles\(world\);/, "projectiles:spawn"],
    [/^ {2}resolveMelee\(world\);/, "melee"],
    [/^ {2}runTimed\(world, world\.beforeDamage/, "hooks:beforeDamage"],
    [/^ {2}if \(!world\.config\.training\) suddenDeath/, "suddenDeath(notTraining)"],
    [/^ {2}applyLedger\(world\);/, "ledger:apply"],
    [/^ {2}runTimed\(world, world\.systems/, "hooks:systems"],
    [/^ {2}if \(world\.config\.training\) trainingSettle/, "settle:training"],
    [/^ {2}else settle\(world\);/, "settle"],
    [/^ {2}if \(s\.phase === "ended"\) clearProjectiles/, "projectiles:clearIfEnded"],
  ];
  // Statements that only prepare state (no system runs) are recognised and skipped; anything else is an error, so a
  // change to updateActive cannot slip past this record.
  const benign = [/^ {2}const (s|now|dt|fighters) = /, /^ {2}world\.combat\.\w+ = \[\];/, /^ {2}world\.combat\.rank = /,
    /^ {2}lap\(world, /, /^ {2}\/\//, /^ {4}/, /^ {2}\}\);?$/, /^\s*$/];
  const out: string[] = [];
  for (const line of lines) {
    const hit = rules.find(([re]) => re.test(line));
    if (hit) { out.push(hit[1]); continue; }
    if (benign.some((re) => re.test(line))) continue;
    throw new Error(`step.ts updateActive: unrecognised statement, update schedule.ts: ${JSON.stringify(line)}`);
  }
  return out;
}

const production = await resolveSchedule("production", {});
const capture = await resolveSchedule("capture", { signatures: false, walkHints: false });
const record = {
  format: "rh-legacy-schedule/1",
  legacyRevision: revision(),
  note: "updateActive's fixed phases in order; each hook list in resolved registration order with its module. " +
    "'production' is createGameWorld with the live server's default config (loadConfig({})); 'capture' is the module set " +
    "and config of the parity fixtures (signatures and walk hints off). Telemetry and the input trace attach after these " +
    "in RaidRoom (observers, not gameplay).",
  updateActive: fixedPhases(),
  production,
  capture,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "legacy_schedule.json"), JSON.stringify(record, null, 1) + "\n");
console.log(`legacy_schedule.json: ${record.updateActive.length} fixed phases; production systems ${production.lists.systems.length}, ` +
  `afterWeapons ${production.lists.afterWeapons.length}, beforeDamage ${production.lists.beforeDamage.length}, ` +
  `moveModifiers ${production.lists.moveModifiers.length}, modSources ${production.lists.modSources.length}`);
