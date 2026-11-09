// Actual-source reflex geometry capture. Runs the unchanged TypeScript angleGap and private course
// through a temporary in-memory export appended to the actual source text; imports/constants remain the
// original ones. Never writes to the source tree. Pinned Node image; output is canonical JSON + newline.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const REPO = "/repo";
const SOURCE = REPO + "/packages/server/src/bots/brain/tactics/kite.ts";
const OUTPUT = process.env.RH_REFLEX_GEOMETRY_OUTPUT || "/out";
const MODE = process.env.RH_REFLEX_GEOMETRY_MODE || "capture";
const MUTATION = process.env.RH_REFLEX_GEOMETRY_MUTATION || "";
const BASE = process.env.RH_REFLEX_GEOMETRY_BASE || "";
const IMAGE = process.env.RH_REFLEX_GEOMETRY_IMAGE || "";
const SOURCE_PATH = "packages/server/src/bots/brain/tactics/kite.ts";
const APPEND = "\n// capture-only temporary export; no source body/import/constant is changed\nexport { course as __course };\n";
const OWN_ORIGIN = 20;
const PLAYER_RADIUS = 12;
const RANGED_HIT_REACH = 14;
const SIDESTEP_U = PLAYER_RADIUS + RANGED_HIT_REACH;

function sha(s) {
  return createHash("sha256").update(s).digest("hex");
}
function read(path) {
  return readFileSync(path, "utf8");
}
function span(source, marker) {
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error("missing source marker " + marker);
  const start = source.lastIndexOf("\n", idx) + 1;
  let braces = 0;
  let seen = false;
  let end = source.length;
  for (let i = idx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") { braces++; seen = true; }
    else if (ch === "}") {
      braces--;
      if (seen && braces === 0) { end = i + 1; break; }
    }
  }
  const lineOf = (at) => source.slice(0, at).split("\n").length;
  const text = source.slice(start, end);
  return { startLine: lineOf(start), endLine: lineOf(end), bytes: Buffer.byteLength(text), sha256: sha(text) };
}

const MUTATIONS = [
  { id: "own-id-equality", find: "pr.from === self.id || ", replace: "" },
  { id: "origin-boundary", find: "pr.x0 - self.x, pr.y0 - self.y) < OWN_ORIGIN", replace: "pr.x0 - self.x, pr.y0 - self.y) <= OWN_ORIGIN" },
  { id: "speed-one-boundary", find: "if (speed < 1) return null;", replace: "if (speed <= 1) return null;" },
  { id: "lateral-boundary", find: "Math.abs(offset) > SIDESTEP_U", replace: "Math.abs(offset) >= SIDESTEP_U" },
  { id: "behind-zero-boundary", find: "along < 0", replace: "along <= 0" },
  { id: "range-hit-reach-boundary", find: "along > left + RANGED_HIT_REACH", replace: "along >= left + RANGED_HIT_REACH" },
  { id: "impact-zero-boundary", find: "return ttiMs > 0 ?", replace: "return ttiMs >= 0 ?" },
  { id: "angle-wrap", find: "return d > Math.PI ? 2 * Math.PI - d : d;", replace: "return d;" },
  { id: "provenance-only-comment", find: "const OWN_ORIGIN = 20;", replace: "const OWN_ORIGIN = 20; // provenance-only control" },
];
function applyMutation(source, mutation) {
  if (!mutation) return source;
  const entry = MUTATIONS.find((m) => m.id === mutation);
  if (!entry) throw new Error("unknown mutation " + mutation);
  const first = source.indexOf(entry.find);
  if (first < 0) throw new Error("mutation target missing: " + mutation);
  if (source.indexOf(entry.find, first + 1) >= 0) throw new Error("mutation target not unique: " + mutation);
  return source.slice(0, first) + entry.replace + source.slice(first + entry.find.length);
}

async function bundleSource(sourceText, tag) {
  const built = await build({
    stdin: { contents: sourceText + APPEND, resolveDir: dirname(SOURCE), loader: "ts", sourcefile: SOURCE },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  if (built.outputFiles.length !== 1) throw new Error("expected one bundle output");
  const bundlePath = join("/tmp", "reflex-geometry-" + process.pid + "-" + tag + ".mjs");
  writeFileSync(bundlePath, built.outputFiles[0].text);
  const mod = await import(pathToFileURL(bundlePath).href);
  if (typeof mod.angleGap !== "function") throw new Error("angleGap export missing");
  if (typeof mod.__course !== "function") throw new Error("course temporary export missing");
  return { angleGap: mod.angleGap, course: mod.__course, bundleBytes: Buffer.byteLength(built.outputFiles[0].text), bundleSha256: sha(built.outputFiles[0].text) };
}

const angleCases = [
  { id: "zero", a: 0, b: 0 },
  { id: "simple-positive", a: 0.25, b: -0.25 },
  { id: "pi-exact", a: 0, b: Math.PI },
  { id: "just-below-pi", a: 0, b: Math.PI - 1e-9 },
  { id: "just-above-pi", a: 0, b: Math.PI + 1e-9 },
  { id: "wrap-positive", a: 2 * Math.PI + 0.3, b: 0.3 },
  { id: "wrap-negative", a: -2 * Math.PI - 0.3, b: -0.3 },
  { id: "negative-sign", a: -Math.PI / 2, b: Math.PI / 2 },
  { id: "large-finite", a: 1e6, b: -1e6 },
  { id: "same-large", a: 123456.789, b: 123456.789 },
];

const courseCases = [
  { id: "own-id", branch: "from_self", from_self: true, origin: [0, 0], at: [10, 0], velocity: [1, 0], range: 100, self_at: [20, 0], lag_ms: 0 },
  { id: "origin-below", branch: "origin", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [19.999, 0], lag_ms: 0 },
  { id: "origin-equal", branch: "origin", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20, 0], lag_ms: 0 },
  { id: "origin-above", branch: "origin", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20.001, 0], lag_ms: 0 },
  { id: "speed-below", branch: "speed", from_self: false, origin: [0, 0], at: [0, 0], velocity: [0.999, 0], range: 100, self_at: [20, 0], lag_ms: 0 },
  { id: "speed-equal", branch: "speed", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20, 0], lag_ms: 0 },
  { id: "speed-above", branch: "speed", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1.001, 0], range: 100, self_at: [20, 0], lag_ms: 0 },
  { id: "lateral-pos-equal", branch: "lateral", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20, 26], lag_ms: 0 },
  { id: "lateral-pos-above", branch: "lateral", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20, 26.0001], lag_ms: 0 },
  { id: "lateral-neg-equal", branch: "lateral", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20, -26], lag_ms: 0 },
  { id: "lateral-neg-above", branch: "lateral", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [20, -26.0001], lag_ms: 0 },
  { id: "behind-below", branch: "behind", from_self: false, origin: [-1, 0], at: [20, 0], velocity: [1, 0], range: 100, self_at: [19.999, 0], lag_ms: -2 },
  { id: "behind-equal", branch: "behind", from_self: false, origin: [0, 0], at: [20, 0], velocity: [1, 0], range: 100, self_at: [20, 0], lag_ms: -1 },
  { id: "ahead-positive", branch: "behind", from_self: false, origin: [-1, 0], at: [20, 0], velocity: [1, 0], range: 100, self_at: [20.001, 0], lag_ms: -1 },
  { id: "range-equal", branch: "range", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [114, 0], lag_ms: 0 },
  { id: "range-above", branch: "range", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [114.0001, 0], lag_ms: 0 },
  { id: "range-below", branch: "range", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 100, self_at: [113.999, 0], lag_ms: 0 },
  { id: "impact-zero", branch: "impact", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 1000, self_at: [20, 0], lag_ms: 20000 },
  { id: "impact-small-positive", branch: "impact", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 1000, self_at: [20, 0], lag_ms: 19999.999 },
  { id: "impact-negative", branch: "impact", from_self: false, origin: [0, 0], at: [0, 0], velocity: [1, 0], range: 1000, self_at: [20, 0], lag_ms: 20000.001 },
  { id: "diagonal-positive-offset", branch: "diagonal", from_self: false, origin: [0, 0], at: [0, 0], velocity: [3, 4], range: 200, self_at: [20, 40], lag_ms: 0 },
  { id: "diagonal-negative-offset", branch: "diagonal", from_self: false, origin: [0, 0], at: [0, 0], velocity: [3, 4], range: 200, self_at: [40, 20], lag_ms: 0 },
  { id: "axis-negative-velocity", branch: "axis", from_self: false, origin: [140, 0], at: [120, 0], velocity: [-1, 0], range: 100, self_at: [100, 0], lag_ms: 0 },
  { id: "general-origin", branch: "general", from_self: false, origin: [80, 20], at: [60, 20], velocity: [1, 0], range: 100, self_at: [40, 30], lag_ms: 0 },
  { id: "general-lateral-refusal", branch: "general", from_self: false, origin: [80, 20], at: [60, 20], velocity: [1, 0], range: 100, self_at: [40, 60], lag_ms: 0 },
];

function selfView(at) {
  return { id: "self", x: at[0], y: at[1] };
}
function projectileView(c) {
  return {
    from: c.from_self ? "self" : "other",
    x0: c.origin[0], y0: c.origin[1],
    x: c.at[0], y: c.at[1],
    vx: c.velocity[0], vy: c.velocity[1],
    range: c.range,
  };
}
async function generate(sourceText, mutation) {
  const original = read(SOURCE);
  const sourceWithMutation = applyMutation(original, mutation);
  const sourceSha256 = sha(sourceWithMutation);
  const extracted = {
    angleGap: span(original, "export function angleGap"),
    course: span(original, "function course("),
    append: APPEND,
    appendSha256: sha(APPEND),
  };
  const { angleGap, course, bundleBytes, bundleSha256 } = await bundleSource(sourceWithMutation, mutation || "canonical");
  const angle = angleCases.map((c) => ({ input: { a: c.a, b: c.b }, result: angleGap(c.a, c.b) }));
  const courseRows = [];
  for (const c of courseCases) {
    const pr = projectileView(c);
    const result = course(pr, selfView(c.self_at), c.lag_ms);
    courseRows.push({
      id: c.id, branch: c.branch,
      input: {
        from_self: c.from_self,
        origin: c.origin, at: c.at, velocity: c.velocity,
        range: c.range, self_at: c.self_at, lag_ms: c.lag_ms,
      },
      result: result === null ? null : { tti_ms: result.ttiMs, offset: result.offset, nx: result.nx, ny: result.ny },
    });
  }
  const corpus = {
    format: "rh-reflex-geometry-source/1",
    profile: {
      base: BASE,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      image: IMAGE,
      source: { path: SOURCE_PATH, bytes: Buffer.byteLength(original), sha256: sha(original) },
      extraction: {
        method: "actual unchanged source text + appended temporary export; esbuild bundle; original imports/constants",
        angleGap: extracted.angleGap,
        course: extracted.course,
        append: APPEND,
        appendSha256: sha(APPEND),
      },
      constants: { PLAYER_RADIUS, RANGED_HIT_REACH, SIDESTEP_U, OWN_ORIGIN },
      mutation: mutation || null,
      bundle: { bytes: bundleBytes, sha256: bundleSha256 },
    },
    angle: { cases: angle },
    course: { cases: courseRows },
    controlsExpected: {
      angleWrapRow: "just-above-pi",
      courseRefusalRows: {
        own_id: "own-id", origin: "origin-equal", speed: "speed-equal", lateral: "lateral-pos-equal",
        behind: "behind-equal", range: "range-equal", impact: "impact-zero",
      },
    },
  };
  return { corpus, sourceSha256, sourceWithMutation };
}
function diff(a, b, path) {
  if (a === b) return null;
  if (typeof a !== typeof b) return path + " type";
  if (a === null || b === null) return path + " value";
  if (typeof a !== "object") return path;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return path + " length";
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], path + "/" + i);
      if (d) return d;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (!(k in a) || !(k in b)) return path + "/" + k + " key";
    const d = diff(a[k], b[k], path + "/" + k);
    if (d) return d;
  }
  return null;
}
function semantic(corpus) {
  const clone = JSON.parse(JSON.stringify(corpus));
  delete clone.profile;
  return clone;
}

const original = read(SOURCE);
const canonical = await generate(original, "");
if (MODE === "capture") {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(join(OUTPUT, "source.json"), JSON.stringify(canonical.corpus, null, 2) + "\n");
  console.log(JSON.stringify({ mode: "capture", cases: canonical.corpus.course.cases.length, angleCases: canonical.corpus.angle.cases.length, bytes: Buffer.byteLength(JSON.stringify(canonical.corpus, null, 2) + "\n"), sha256: sha(JSON.stringify(canonical.corpus, null, 2) + "\n") }));
} else if (MODE === "--check") {
  const expected = read(join(OUTPUT, "source.json"));
  const actual = JSON.stringify(canonical.corpus, null, 2) + "\n";
  if (expected !== actual) {
    const d = diff(JSON.parse(expected), canonical.corpus, "");
    throw new Error("canonical bytes differ" + (d ? ": " + d : ""));
  }
  console.log(JSON.stringify({ mode: "check", bytes: Buffer.byteLength(actual), sha256: sha(actual), cases: canonical.corpus.course.cases.length, angleCases: canonical.corpus.angle.cases.length }));
} else if (MODE === "controls") {
  mkdirSync(OUTPUT, { recursive: true });
  const controlRows = [];
  let kills = 0;
  for (const mutation of MUTATIONS) {
    const record = { id: mutation.id, status: "run" };
    try {
      const result = await generate(original, mutation.id);
      const d = diff(semantic(canonical.corpus), semantic(result.corpus), "");
      record.firstDiff = d;
      record.changed = d !== null;
      if (mutation.id === "provenance-only-comment") {
        record.status = d === null ? "NON-KILL" : "UNEXPECTED-KILL";
      } else if (d !== null) {
        record.status = "KILL"; kills++;
      } else {
        record.status = "SURVIVOR";
      }
      record.sourceSha256 = result.sourceSha256;
    } catch (error) {
      record.status = "ERROR";
      record.error = String(error);
    }
    controlRows.push(record);
    console.log("CONTROL " + mutation.id + ": " + record.status + (record.firstDiff ? " " + record.firstDiff : ""));
  }
  const restored = await generate(original, "");
  const restoredEqual = JSON.stringify(restored.corpus) === JSON.stringify(canonical.corpus);
  const required = MUTATIONS.filter((m) => m.id !== "provenance-only-comment").length;
  const good = kills === required && restoredEqual && controlRows.every((r) => r.status !== "ERROR" && r.status !== "UNEXPECTED-KILL");
  writeFileSync(join(OUTPUT, "controls.json"), JSON.stringify({ format: "rh-reflex-geometry-controls/1", required, kills, restoredEqual, rows: controlRows }, null, 2) + "\n");
  console.log(JSON.stringify({ mode: "controls", required, kills, restoredEqual, ok: good }));
  if (!good) throw new Error("controls failed");
} else {
  throw new Error("unknown mode " + MODE);
}
