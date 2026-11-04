// Records the legacy tick schedule as data: the fixed phase order of `updateActive` (packages/server/src/sim/step.ts),
// the RESOLVED order of every runtime-registered hook list (afterWeapons, beforeDamage, systems, moveModifiers, modSources),
// each entry attributed to the module that registered it, and every LINK of every world hook chain (world.hooks), in
// execution order. In the legacy game that order is emergent: it follows the MODULES install list in gameplay.ts and each
// module's push/unshift and chainHook calls (fireRoam unshifts). The Rust core declares its schedule statically
// (crates/rh-sim/src/schedule.rs) and a test checks it against this file, so a port can neither reorder a system nor
// silently skip one.
//
//   npx tsx parity/legacy-capture/schedule.ts [--out parity/schedule]
//
// Three worlds are recorded: "production" (createGameWorld defaults, what RaidRoom runs), "capture" (the module set
// capture.ts uses for the parity fixtures: signatures and walk hints off) and "training" (the practice room: the training
// config, then installTraining). Each is rebuilt module by module to attribute entries, then cross-checked against the real
// createGameWorld: a mismatch (e.g. gameplay.ts changed its skip rules) throws.
//
// Hook links are captured twice and the two must agree, or the script throws:
//   runtime: while each module installs, world.hooks is a Proxy that logs every assignment. An assignment made by
//     chainHook (world.ts; seen in the stack) is an "append" (the new link runs after the existing chain); a direct
//     assignment is a "wrap" when the module read that hook first (a hand-written wrapper over the previous chain,
//     e.g. quests' dropBody) and a "replace" otherwise (the earlier links are dropped, e.g. loot's dropBody).
//   static: the chainHook(world, "key", fn) call sites and the `world.hooks.key = ...` assignments of each module's
//     source, in source order (with the function name where the argument is an identifier, and the condition for an
//     `if (...) chainHook(...)` site).
// Per (module, key) the runtime link count must lie between the static unconditional and all sites, and the modes must
// be the same sequence. A wrapper must call its previous link first (so execution order is install order); any other
// shape throws.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mulberry32, mapFromTiles, TILE_FLOOR } from "@raid/shared";
import { createGameWorld } from "../../packages/server/src/sim/gameplay";
import { installTraining } from "../../packages/server/src/sim/training";
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

type WorldKind = "production" | "capture" | "training";

/** production: the live server's sim config with every env default (loadConfig({}), what RaidRoom passes);
 *  capture: the config capture.ts builds its parity fixtures with;
 *  training: what RaidRoom.buildWorld passes for a training room (then installTraining). */
function worldOpts(kind: WorldKind) {
  const w = 12, h = 8;
  const map = mapFromTiles(w, h, new Uint8Array(w * h).fill(TILE_FLOOR), 11);
  const config = kind === "production" ? loadConfig({})
    : kind === "training" ? { ...loadConfig({}), dummies: true, training: true, planSeconds: 0 }
    : {
      minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600,
    };
  return {
    seed: 11, map, config,
    random: mulberry32(1), rewardSalt: [1, 2, 3, 4], questSalt: [5, 6, 7, 8],
  } as Parameters<typeof createWorld>[0];
}

type Entry = { module: string; fn: string };

// ---------------------------------------------------------------------------------------------------------------------
// Hook links

type LinkMode = "default" | "append" | "wrap" | "replace";
/** One link of a world hook chain. `fn` is the function's name where the source names it ("<arrow>" for an inline
 *  function, with `src` its compacted source), `when` the condition of a conditional site, `dropped` marks a link a later
 *  `replace` discarded (it never runs). */
type Link = { module: string; mode: LinkMode; fn: string; src?: string; when?: string; dropped?: true };
type Site = { key: string; mode: Exclude<LinkMode, "default">; fn: string; src?: string; when?: string; line: number };

/** The end of a balanced expression starting at `i`: the index of the first `stop` char at depth 0. */
function exprEnd(src: string, i: number, stop: string): number {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (depth === 0 && stop.includes(c)) return i;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
  }
  throw new Error("unbalanced expression");
}

function fnOf(expr: string): { fn: string; src?: string } {
  const e = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(e)) return { fn: e };
  const named = /^(?:async\s+)?function\s+([\w$]+)/.exec(e);
  if (named) return { fn: named[1]! };
  const flat = e.replace(/\s+/g, " ");
  return { fn: "<arrow>", src: flat.length > 90 ? `${flat.slice(0, 87)}...` : flat };
}

const lineOf = (src: string, i: number) => src.slice(0, i).split("\n").length;

/** The hook sites of one module file, in source order. */
function staticSites(file: string): Site[] {
  const src = readFileSync(join(simDir, `${file}.ts`), "utf8");
  const sites: Array<Site & { at: number }> = [];
  for (const m of src.matchAll(/chainHook\(\s*[\w$]+\s*,\s*"(\w+)"\s*,/g)) {
    const at = m.index!;
    const argStart = at + m[0].length;
    const arg = src.slice(argStart, exprEnd(src, argStart, ")"));
    const lineStart = src.lastIndexOf("\n", at) + 1;
    const prefix = src.slice(lineStart, at).trim();
    const cond = /^if \((.*)\)$/.exec(prefix);
    if (prefix !== "" && !cond) {
      throw new Error(`${file}.ts:${lineOf(src, at)}: chainHook in an unrecognised context "${prefix}"; extend schedule.ts`);
    }
    sites.push({ key: m[1]!, mode: "append", ...fnOf(arg), ...(cond ? { when: cond[1]! } : {}), line: lineOf(src, at), at });
  }
  for (const m of src.matchAll(/[\w$]+\.hooks\.(\w+)\s*=(?!=)/g)) {
    const at = m.index!;
    const key = m[1]!;
    const rhsStart = at + m[0].length;
    const rhs = src.slice(rhsStart, exprEnd(src, rhsStart, ";")).trim();
    const prev = new RegExp(`const ([\\w$]+) = [\\w$]+\\.hooks\\.${key};`).exec(src.slice(0, at));
    const callsPrev = prev && new RegExp(`\\b${prev[1]}\\(`).test(rhs);
    if (callsPrev) {
      // Execution order equals install order only when the wrapper runs the previous chain before its own code.
      const body = /^\([^)]*\)\s*=>\s*\{\s*([\s\S]*)\}$/.exec(rhs);
      if (!body || !body[1]!.startsWith(`${prev[1]}(`)) {
        throw new Error(`${file}.ts:${lineOf(src, at)}: hook wrapper for ${key} does not call ${prev[1]} first; extend schedule.ts`);
      }
    }
    sites.push({ key, mode: callsPrev ? "wrap" : "replace", ...fnOf(rhs), line: lineOf(src, at), at });
  }
  // A module whose install opens with a guard (`if (...) return;`, quests in training) installs every site conditionally.
  const guard = /export function install\w*\([^)]*\): void \{\s*if \((.*)\) return;/.exec(src);
  if (guard) for (const s of sites) s.when = s.when ? `!(${guard[1]}) && ${s.when}` : `!(${guard[1]})`;
  return sites.sort((a, b) => a.at - b.at).map(({ at: _at, ...s }) => s);
}

type RtLink = { key: string; mode: Exclude<LinkMode, "default">; name: string | null };

/** Whether the code assigning or reading world.hooks right now is chainHook (the first frame outside this file). */
function viaChainHook(): boolean {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  const caller = frames.find((f) => !f.includes("legacy-capture/schedule.ts"));
  return caller !== undefined && /\bat chainHook \(/.test(caller);
}

/** Runs one module install with world.hooks behind a logging Proxy; returns its hook links in assignment order. */
function captureInstall(world: World, install: (w: World) => void): RtLink[] {
  const real = world.hooks as unknown as Record<string, unknown>;
  const read = new Set<string>();
  const links: RtLink[] = [];
  world.hooks = new Proxy(real, {
    get(t, k, r) {
      if (typeof k === "string" && !viaChainHook()) read.add(k);
      return Reflect.get(t, k, r);
    },
    set(t, k, v) {
      if (typeof k !== "string") return Reflect.set(t, k, v);
      const chained = viaChainHook();
      const hadPrev = t[k] !== undefined;
      links.push({
        key: k,
        mode: chained ? "append" : read.has(k) ? "wrap" : "replace",
        // chainHook stores fn itself only for the first link; later links are a composed closure.
        name: chained && hadPrev ? null : ((v as { name?: string }).name || null),
      });
      t[k] = v;
      return true;
    },
  }) as unknown as World["hooks"];
  try {
    install(world);
  } finally {
    world.hooks = real as unknown as World["hooks"];
  }
  return links;
}

/** Matches one module's runtime links against its static sites; returns the links with their static detail. */
function crossCheck(file: string, rt: RtLink[], sites: Site[]): Array<Link & { key: string }> {
  const out: Array<Link & { key: string }> = [];
  const keys = new Set([...rt.map((l) => l.key), ...sites.map((s) => s.key)]);
  for (const key of keys) {
    const r = rt.filter((l) => l.key === key);
    const all = sites.filter((s) => s.key === key);
    const uncond = all.filter((s) => !s.when);
    const taken = r.length === all.length ? all : r.length === uncond.length ? uncond : null;
    if (!taken) {
      throw new Error(`${file}: hook ${key}: ${r.length} runtime links vs ${uncond.length} unconditional / ${all.length} static sites`);
    }
    taken.forEach((s, i) => {
      const l = r[i]!;
      if (l.mode !== s.mode) throw new Error(`${file}:${s.line}: hook ${key}: runtime ${l.mode} vs static ${s.mode}`);
      if (l.name && s.fn !== "<arrow>" && l.name !== s.fn) {
        throw new Error(`${file}:${s.line}: hook ${key}: runtime function ${l.name} vs static ${s.fn}`);
      }
    });
  }
  // Runtime order is the module's assignment order; attach each link's static site (the n-th site of that key).
  const seen = new Map<string, number>();
  for (const l of rt) {
    const n = seen.get(l.key) ?? 0;
    seen.set(l.key, n + 1);
    const all = sites.filter((s) => s.key === l.key);
    const taken = rt.filter((x) => x.key === l.key).length === all.length ? all : all.filter((s) => !s.when);
    const s = taken[n]!;
    out.push({
      key: l.key, module: file, mode: l.mode, fn: s.fn,
      ...(s.src ? { src: s.src } : {}), ...(s.when ? { when: s.when } : {}),
    });
  }
  return out;
}

type HookTotals = {
  links: number; live: number; default: number; append: number; wrap: number; replace: number; dropped: number;
  staticSites: number; conditionalSitesNotTaken: number;
};

async function resolveSchedule(kind: WorldKind, opts: { signatures?: boolean; walkHints?: boolean }) {
  const world = createWorld(worldOpts(kind)) as World & Record<ListName, unknown[]>;
  const owner = new Map<unknown, string>();
  const actions: Record<string, string> = {};
  // Every link of every hook chain, in install order; chainHook and the wrappers run the earlier link first (world.ts,
  // and the prev-first check above), so this is execution order once `dropped` links are skipped.
  const hooks: Record<string, Link[]> = {};
  for (const [k, v] of Object.entries(world.hooks)) {
    hooks[k] = [{ module: "world", mode: "default", ...fnOf((v as { name?: string }).name || "(anonymous) => {}") }];
  }
  const installed: string[] = [];
  let staticCount = 0, notTaken = 0;
  const steps: Array<[string, (w: World) => void]> = [];
  for (const [install, file] of modules()) {
    if (skipped(install, opts)) continue;
    const mod = await import(pathToFileURL(join(simDir, `${file}.ts`)).href);
    steps.push([file, mod.install]);
  }
  if (kind === "training") steps.push(["training", installTraining]);
  for (const [file, install] of steps) {
    const beforeActions = { ...world.actions };
    const rt = captureInstall(world, install);
    const sites = staticSites(file);
    staticCount += sites.length;
    const links = crossCheck(file, rt, sites);
    notTaken += sites.length - links.length;
    installed.push(file);
    for (const l of LISTS) for (const f of world[l]) if (!owner.has(f)) owner.set(f, file);
    for (const [k, v] of Object.entries(world.actions)) if ((beforeActions as Record<string, unknown>)[k] !== v) actions[k] = file;
    for (const { key, ...link } of links) {
      const chain = (hooks[key] ??= []);
      if (link.mode === "replace") for (const earlier of chain) earlier.dropped = true;
      chain.push(link);
    }
  }
  const lists = Object.fromEntries(LISTS.map((l) => [l, world[l].map((f) => ({
    module: owner.get(f)!, fn: (f as { name?: string }).name || "<anonymous>",
  }) satisfies Entry)])) as Record<ListName, Entry[]>;

  // Cross-check against the real thing.
  const real = createGameWorld(worldOpts(kind), opts) as World & Record<ListName, unknown[]>;
  if (kind === "training") installTraining(real);
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
  if (JSON.stringify(Object.keys(real.hooks).sort()) !== JSON.stringify(Object.keys(hooks).sort())) {
    throw new Error(`hooks differ from createGameWorld\n real: ${Object.keys(real.hooks).sort()}\n ours: ${Object.keys(hooks).sort()}`);
  }
  const all = Object.values(hooks).flat();
  const count = (m: LinkMode) => all.filter((l) => l.mode === m).length;
  const hookTotals: HookTotals = {
    links: all.length, live: all.filter((l) => !l.dropped).length, default: count("default"), append: count("append"),
    wrap: count("wrap"), replace: count("replace"), dropped: all.filter((l) => l.dropped).length,
    staticSites: staticCount, conditionalSitesNotTaken: notTaken,
  };
  // Every static site of an installed module is accounted for: taken, or a conditional site this config skips.
  if (hookTotals.append + hookTotals.wrap + hookTotals.replace + notTaken !== staticCount) {
    throw new Error(`hook totals do not add up: ${JSON.stringify(hookTotals)}`);
  }
  return { modules: installed, lists, actions, hooks, hookTotals };
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

// The cross-check must refuse what it cannot reconcile (a self-test, so a refactor of it cannot quietly accept anything).
for (const [rt, sites] of [
  [[{ key: "k", mode: "append", name: null }], []],
  [[], [{ key: "k", mode: "append", fn: "f", line: 1 }]],
  [[{ key: "k", mode: "replace", name: null }], [{ key: "k", mode: "append", fn: "f", line: 1 }]],
  [[{ key: "k", mode: "append", name: "g" }], [{ key: "k", mode: "append", fn: "f", line: 1 }]],
] as Array<[RtLink[], Site[]]>) {
  let threw = false;
  try { crossCheck("self-test", rt, sites); } catch { threw = true; }
  if (!threw) throw new Error(`crossCheck accepted ${JSON.stringify({ rt, sites })}`);
}

const production = await resolveSchedule("production", {});
const capture = await resolveSchedule("capture", { signatures: false, walkHints: false });
const training = await resolveSchedule("training", {});
const record = {
  format: "rh-legacy-schedule/2",
  legacyRevision: revision(),
  note: "updateActive's fixed phases in order; each hook list in resolved registration order with its module; each world " +
    "hook as its chain of links in install order (mode default | append (chainHook) | wrap (prev-first wrapper) | replace; " +
    "a `dropped` link was discarded by a later replace; the rest run in list order). 'production' is createGameWorld with " +
    "the live server's default config (loadConfig({})); 'capture' is the module set and config of the parity fixtures " +
    "(signatures and walk hints off); 'training' is the practice room (training config, then installTraining). Telemetry " +
    "and the input trace attach after these in RaidRoom (observers, not gameplay).",
  updateActive: fixedPhases(),
  production,
  capture,
  training,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "legacy_schedule.json"), JSON.stringify(record, null, 1) + "\n");
console.log(`legacy_schedule.json: ${record.updateActive.length} fixed phases; production systems ${production.lists.systems.length}, ` +
  `afterWeapons ${production.lists.afterWeapons.length}, beforeDamage ${production.lists.beforeDamage.length}, ` +
  `moveModifiers ${production.lists.moveModifiers.length}, modSources ${production.lists.modSources.length}`);
for (const [name, w] of Object.entries({ production, capture, training })) {
  console.log(`hooks ${name}: ${Object.keys(w.hooks).length} keys, ${JSON.stringify(w.hookTotals)}`);
}
