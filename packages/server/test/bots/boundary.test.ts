// The brain's boundary, statically (docs/BOTS.md 3.7, types.ts "Import rules"): every file under bots/brain/ and
// bots/mobHunt.ts imports only @raid/shared, its siblings and ../mobHunt (perception.ts alone may `import type` the
// schema; modules/wishes.ts alone may also import ../../abilityPolicy and modules/chests.ts ../../chestHunt), and reads no clock, no Math.random, no timers and no `process`. bots/learning/ (the stats file) may use the
// disk, but never the profile store, the sim or the rooms, and the profile store never reaches into bots/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const BOTS = path.join(SRC, "bots");
const BRAIN = path.join(BOTS, "brain");
const MOBHUNT = path.join(BOTS, "mobHunt.ts");
const LEARNING = path.join(BOTS, "learning");
const PERSISTENCE = path.join(SRC, "persistence");
const PERCEPTION = path.join(BRAIN, "perception.ts");
// The Wishes module calls the shared cast policy, which is pure and imports nothing but @raid/shared: the one file outside
// bots/brain/ that a brain file may import, and only the Wishes module may.
const WISHES = path.join(BRAIN, "modules", "wishes.ts");
const ABILITY_POLICY = path.join(BOTS, "abilityPolicy.ts");
// The chests module reuses the pure chest hunt (which card, when to walk, when to give up), shared-only like the cast policy.
const CHESTS = path.join(BRAIN, "modules", "chests.ts");
const CHEST_HUNT = path.join(BOTS, "chestHunt.ts");

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Import { spec: string; typeOnly: boolean }

/**
 * The source without comments (`code`, strings kept) and with string and template text blanked too (`bare`, for the token
 * scan), so neither a comment that says "no Math.random" nor a log text trips it. Regex literals are not special-cased.
 */
function strip(src: string): { code: string; bare: string } {
  let code = "", bare = "";
  let i = 0;
  const templates: number[] = [];
  let depth = 0;
  const put = (c: string, blank = false) => {
    code += c;
    bare += blank && c !== "\n" ? " " : c;
  };
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { code += " "; bare += " "; i++; }
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) { const ch = src[i] === "\n" ? "\n" : " "; code += ch; bare += ch; }
      continue;
    }
    if (c === "'" || c === "\"" || c === "`") {
      put(c);
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") { put(src[i]!, true); i++; if (i < src.length) put(src[i]!, true); i++; continue; }
        if (c === "`" && src[i] === "$" && src[i + 1] === "{") {
          templates.push(depth);
          put("$");
          put("{");
          i += 2;
          break;
        }
        put(src[i]!, true);
        i++;
      }
      if (i < src.length && src[i] === c) { put(c); i++; }
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        // The end of a `${...}`: back inside the template text.
        templates.pop();
        put("}");
        i++;
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\\") { put(src[i]!, true); i++; if (i < src.length) put(src[i]!, true); i++; continue; }
          if (src[i] === "$" && src[i + 1] === "{") { templates.push(depth); put("$"); put("{"); i += 2; break; }
          put(src[i]!, true);
          i++;
        }
        if (i < src.length && src[i] === "`") { put("`"); i++; }
        continue;
      }
      depth--;
    }
    put(c);
    i++;
  }
  return { code, bare };
}

function importsOf(code: string): Import[] {
  const out: Import[] = [];
  const add = (spec: string, typeOnly: boolean) => out.push({ spec, typeOnly });
  for (const m of code.matchAll(/\b(?:import|export)\s+(type\s+)?[^;'"`]*?\bfrom\s*(['"])([^'"]+)\2/g)) add(m[3]!, m[1] !== undefined);
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) add(m[2]!, false);
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) add(m[2]!, false);
  return out;
}

/** What a brain file must never say, in code (comments and strings excluded). */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["Math.random", /\bMath\s*\.\s*random\b/],
  ["Date.now", /\bDate\s*\.\s*now\b/],
  ["performance.now", /\bperformance\s*\.\s*now\b/],
  ["setTimeout", /\bsetTimeout\b/],
  ["setInterval", /\bsetInterval\b/],
  ["process.", /\bprocess\s*\./],
];

/** The file a relative specifier names (with or without its .ts, or a folder's index.ts). */
function resolve(from: string, spec: string): string {
  const p = path.resolve(path.dirname(from), spec);
  return p.endsWith(".ts") ? p : existsSync(`${p}.ts`) ? `${p}.ts` : existsSync(path.join(p, "index.ts")) ? path.join(p, "index.ts") : `${p}.ts`;
}

const inside = (dir: string, file: string): boolean => file.startsWith(dir + path.sep);
const rel = (file: string): string => path.relative(SRC, file);

/** Everything wrong with one brain file (empty when it keeps the rules). */
function brainViolations(file: string, src: string): string[] {
  const { code, bare } = strip(src);
  const bad: string[] = [];
  for (const imp of importsOf(code)) {
    if (imp.spec === "@raid/shared") continue;
    if (imp.spec === "@raid/shared/schema") {
      if (file !== PERCEPTION) bad.push(`imports the schema (${imp.spec})`);
      else if (!imp.typeOnly) bad.push("perception.ts imports the schema at runtime (only `import type` is allowed)");
      continue;
    }
    if (imp.spec.startsWith(".")) {
      const target = resolve(file, imp.spec);
      if (file === WISHES && target === ABILITY_POLICY) continue;
      if (file === CHESTS && target === CHEST_HUNT) continue;
      if (!inside(BRAIN, target) && target !== MOBHUNT) bad.push(`imports ${imp.spec} (${rel(target)}): outside bots/brain/ and ../mobHunt`);
      continue;
    }
    bad.push(`imports ${imp.spec}`);
  }
  for (const [name, re] of FORBIDDEN) if (re.test(bare)) bad.push(`uses ${name}`);
  return bad;
}

describe("the brain boundary", () => {
  const brain = [...tsFiles(BRAIN), MOBHUNT];

  it("covers the brain's files", () => {
    const names = brain.map(rel);
    for (const f of ["bots/brain/types.ts", "bots/brain/perception.ts", "bots/brain/frames.ts", "bots/mobHunt.ts"]) expect(names).toContain(f);
  });

  it("every file under bots/brain/ and bots/mobHunt.ts imports only @raid/shared, its siblings and ../mobHunt, and reads no clock or randomness", () => {
    const report = brain.flatMap((file) => brainViolations(file, readFileSync(file, "utf8")).map((v) => `${rel(file)}: ${v}`));
    expect(report).toEqual([]);
  });

  it("bots/learning/ (when present) never reaches the profile store, the sim, the rooms or Colyseus, and the store never reaches bots/", () => {
    const report: string[] = [];
    for (const file of tsFiles(LEARNING)) {
      for (const imp of importsOf(strip(readFileSync(file, "utf8")).code)) {
        const target = imp.spec.startsWith(".") ? resolve(file, imp.spec) : "";
        const banned = imp.spec.startsWith("@colyseus/") || imp.spec.includes("ProfileStore")
          || [PERSISTENCE, path.join(SRC, "sim"), path.join(SRC, "rooms")].some((dir) => target !== "" && inside(dir, target));
        if (banned) report.push(`${rel(file)}: imports ${imp.spec}`);
      }
    }
    for (const file of tsFiles(PERSISTENCE)) {
      for (const imp of importsOf(strip(readFileSync(file, "utf8")).code)) {
        if (imp.spec.startsWith(".") && inside(BOTS, resolve(file, imp.spec))) report.push(`${rel(file)}: imports ${imp.spec}`);
      }
    }
    expect(report).toEqual([]);
  });
});

describe("the boundary scanner itself", () => {
  const fake = path.join(BRAIN, "fake.ts");

  it("flags clocks, randomness, timers and process in code, not in comments or strings", () => {
    const clean = [
      "// no Math.random, Date.now or setTimeout here",
      "/* performance.now() and process.env are off limits */",
      "const s = \"Math.random() in a string\"; const t = `Date.now ${1 + 1} setInterval`;",
      "const r = rng.random(); const n = percept.now;",
    ].join("\n");
    expect(brainViolations(fake, clean)).toEqual([]);
    for (const [name] of FORBIDDEN) {
      const call = name.endsWith(".") ? `${name}env.X` : `${name}()`;
      expect(brainViolations(fake, `const a = 1;\nconst b = ${call};\n`)).toEqual([`uses ${name}`]);
    }
    expect(brainViolations(fake, "const t = `${Date.now()}`;")).toEqual(["uses Date.now"]);
  });

  it("flags every import outside the allowed set, and a runtime schema import anywhere", () => {
    const src = [
      "import fs from \"node:fs\";",
      "import { Room } from \"@colyseus/core\";",
      "import type { RaidState } from \"@raid/shared/schema\";",
      "import { step } from \"../../sim/step\";",
      "import { x } from \"./types\";",
      "import { bestEdge } from \"../mobHunt\";",
      "import {\n  a,\n  b,\n} from \"@raid/shared\";",
      "export { y } from \"../BotClient\";",
      "const m = await import(\"../../rooms/RaidRoom\");",
    ].join("\n");
    expect(brainViolations(fake, src)).toEqual([
      "imports node:fs",
      "imports @colyseus/core",
      "imports the schema (@raid/shared/schema)",
      "imports ../../sim/step (sim/step.ts): outside bots/brain/ and ../mobHunt",
      "imports ../BotClient (bots/BotClient.ts): outside bots/brain/ and ../mobHunt",
      "imports ../../rooms/RaidRoom (rooms/RaidRoom.ts): outside bots/brain/ and ../mobHunt",
    ]);
    expect(brainViolations(PERCEPTION, "import type { RaidState } from \"@raid/shared/schema\";")).toEqual([]);
    expect(brainViolations(PERCEPTION, "import { RaidState } from \"@raid/shared/schema\";")).toEqual([
      "perception.ts imports the schema at runtime (only `import type` is allowed)",
    ]);
    expect(brainViolations(path.join(BRAIN, "tactics", "x.ts"), "import { y } from \"../../mobHunt\";")).toEqual([]);
  });

  it("lets modules/wishes.ts import the pure cast policy, and nothing else outside the brain, and nobody else the policy", () => {
    const policy = "import { decideCast } from \"../../abilityPolicy\";";
    expect(brainViolations(WISHES, policy)).toEqual([]);
    expect(brainViolations(WISHES, "import { BotClient } from \"../../BotClient\";")).toEqual([
      "imports ../../BotClient (bots/BotClient.ts): outside bots/brain/ and ../mobHunt",
    ]);
    expect(brainViolations(path.join(BRAIN, "modules", "other.ts"), policy)).toEqual([
      "imports ../../abilityPolicy (bots/abilityPolicy.ts): outside bots/brain/ and ../mobHunt",
    ]);
    expect(brainViolations(path.join(BRAIN, "tactics.ts"), "import { decideCast } from \"../abilityPolicy\";")).toEqual([
      "imports ../abilityPolicy (bots/abilityPolicy.ts): outside bots/brain/ and ../mobHunt",
    ]);
  });

  it("lets modules/chests.ts import the pure chest hunt, and nobody else", () => {
    const hunt = "import { ChestHunter } from \"../../chestHunt\";";
    expect(brainViolations(CHESTS, hunt)).toEqual([]);
    expect(brainViolations(WISHES, hunt)).toEqual(["imports ../../chestHunt (bots/chestHunt.ts): outside bots/brain/ and ../mobHunt"]);
    expect(brainViolations(path.join(BRAIN, "modules", "planning.ts"), hunt)).toEqual(["imports ../../chestHunt (bots/chestHunt.ts): outside bots/brain/ and ../mobHunt"]);
  });

  it("the cast policy and the chest hunt import only @raid/shared, so the exceptions cannot reach the sim, the rooms or Colyseus", () => {
    for (const file of [ABILITY_POLICY, CHEST_HUNT]) {
      const bad = importsOf(strip(readFileSync(file, "utf8")).code).filter((imp) => imp.spec !== "@raid/shared");
      expect(bad, rel(file)).toEqual([]);
    }
  });
});
