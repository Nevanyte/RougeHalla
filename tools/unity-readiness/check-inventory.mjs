#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FORMAT = "rh-unity-presentation-inventory/1";
const ENTRY_KEYS = ["id", "category", "cue", "legacySources", "trigger", "timing", "privacy", "nonHueCue", "status", "protocolNeeds", "notes"];
const SOURCE_KEYS = ["path", "symbol"];
const TRIGGER_KEYS = ["kind", "symbol", "consumption", "reason"];
const NEED_KEYS = ["events", "fields", "mechanics"];
const ROOT_KEYS = ["format", "legacyRevision", "protocol", "intentionalExclusions", "protocolUnused", "entries"];
const PROTOCOL_KEYS = ["ref", "revision", "protocolVersion", "observationVersion"];
const UNUSED_KEYS = ["symbol", "reason"];
const EXCLUSION_KEYS = ["path", "reason", "coveredBy"];
const PROTOCOL_FILES = {
  "crates/rh-protocol/src/lib.rs": ["WireSelf", "WireActor", "WireEvent", "WireFx", "WireResult"],
  "crates/rh-protocol/src/map.rs": ["MapBlob"],
  "crates/rh-protocol/src/state.rs": [
    "WireRewardOption", "WireRewardChest", "WireBuild", "WireInventory", "WireProp", "WireFocus", "WireProps",
    "WireField", "StateItem", "WireCamp", "WireProjectile",
  ],
  "crates/rh-sim/src/observe.rs": ["SelfView", "ActorView", "SeenEvent", "Observation"],
};

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, allowed, label, errors) {
  if (!object(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label} has unknown key ${key}`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) errors.push(`${label} is missing key ${key}`);
}

function nonEmpty(value, label, errors) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} must be a nonempty string`);
}

function strings(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return;
  }
  for (const [index, item] of value.entries()) nonEmpty(item, `${label}[${index}]`, errors);
  if (new Set(value).size !== value.length) errors.push(`${label} contains duplicates`);
}

function block(source, type) {
  const match = new RegExp(`\\bpub\\s+(?:struct|enum)\\s+${type}\\b`).exec(source);
  if (!match) return null;
  const start = source.indexOf("{", match.index + match[0].length);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start + 1, i);
  }
  return null;
}

export function protocolSymbols(sources) {
  const symbols = new Set();
  for (const [path, types] of Object.entries(PROTOCOL_FILES)) {
    const source = sources[path];
    if (typeof source !== "string") {
      symbols.add(`${path}:missing-source`);
      continue;
    }
    for (const type of types) {
      const body = block(source, type);
      if (body === null) {
        symbols.add(`${type}:missing-type`);
        continue;
      }
      const fields = [...body.matchAll(/^\s*pub\s+([a-z][a-z0-9_]*)\s*:/gm)].map((match) => match[1]);
      const variants = [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9_]*)(?:\s*[({,]|\s*$)/gm)].map((match) => match[1]);
      for (const member of [...fields, ...variants]) symbols.add(`${type}.${member}`);
      if (fields.length + variants.length === 0) symbols.add(`${type}:no-members`);
    }
  }
  return symbols;
}

export function loadProtocolSources(root, revision) {
  const sources = {};
  for (const path of Object.keys(PROTOCOL_FILES)) {
    sources[path] = execFileSync("git", ["show", `${revision}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  }
  return sources;
}

function sourceVersions(sources) {
  const protocol = /pub const PROTOCOL_VERSION:\s*u16\s*=\s*(\d+)\s*;/.exec(sources["crates/rh-protocol/src/lib.rs"]);
  const observation = /pub const OBSERVATION_VERSION:\s*u16\s*=\s*(\d+)\s*;/.exec(sources["crates/rh-sim/src/observe.rs"]);
  return { protocol: protocol ? Number(protocol[1]) : null, observation: observation ? Number(observation[1]) : null };
}

function walkModules(root, directory, out = []) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walkModules(root, path, out);
    else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".css"))) out.push(path);
  }
  return out;
}

export function presentationModules(root) {
  const modules = [
    ...walkModules(root, "packages/client/src/render"),
    ...walkModules(root, "packages/client/src/ui"),
  ];
  const net = resolve(root, "packages/client/src/net");
  if (existsSync(net)) {
    for (const entry of readdirSync(net, { withFileTypes: true })) {
      if (entry.isFile() && /Fx[^/]*\.ts$/.test(entry.name)) modules.push(`packages/client/src/net/${entry.name}`);
    }
  }
  return modules.sort();
}

function validateLegacySource(root, source, label, errors) {
  exactKeys(source, SOURCE_KEYS, label, errors);
  if (!object(source)) return;
  nonEmpty(source.path, `${label}.path`, errors);
  nonEmpty(source.symbol, `${label}.symbol`, errors);
  if (typeof source.path !== "string" || !source.path.startsWith("packages/client/src/") || source.path.includes("..")) {
    errors.push(`${label}.path must stay under packages/client/src`);
    return;
  }
  const absolute = resolve(root, source.path);
  if (!existsSync(absolute)) {
    errors.push(`${label}.path does not exist: ${source.path}`);
    return;
  }
  if (typeof source.symbol === "string") {
    const terminal = source.symbol.split(".").at(-1);
    if (!new RegExp(`\\b${terminal}\\b`).test(readFileSync(absolute, "utf8"))) errors.push(`${label} symbol is absent: ${source.symbol}`);
  }
}

export function generateGaps(inventory) {
  const lines = [
    "# Unity presentation protocol gaps",
    "",
    "<!-- GENERATED by tools/unity-readiness/check-inventory.mjs; do not edit. -->",
    "",
    `Inspected protocol source: \`${inventory.protocol.ref}\` at \`${inventory.protocol.revision}\`; protocol ${inventory.protocol.protocolVersion}, observation ${inventory.protocol.observationVersion}.`,
    "",
    "Each section is one inventory mechanic. Names under Events and Fields are requested public presentation additions or existing observation facts that still need wire support; Mechanics records missing authoritative producers or external flows. An empty list is intentional.",
    "",
  ];
  const missing = inventory.entries.filter((entry) => entry.status !== "available");
  lines.push(`Status: ${missing.length} entries need work; ${inventory.entries.length - missing.length} entries are available.`, "");
  for (const entry of missing) {
    lines.push(`## ${entry.id}: ${entry.cue}`, "", `Status: **${entry.status}**. ${entry.trigger.reason || entry.notes}`, "");
    for (const [label, key] of [["Events", "events"], ["Fields", "fields"], ["Mechanics", "mechanics"]]) {
      lines.push(`### ${label}`, "");
      if (entry.protocolNeeds[key].length === 0) lines.push("- None.");
      else for (const need of entry.protocolNeeds[key]) lines.push(`- \`${need}\``);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function checkInventory({ root = ROOT, inventory, protocolSources }) {
  const errors = [];
  exactKeys(inventory, ROOT_KEYS, "inventory", errors);
  if (!object(inventory)) return { errors, report: "", symbols: new Set(), modules: [] };
  if (inventory.format !== FORMAT) errors.push(`format must be ${FORMAT}`);
  nonEmpty(inventory.legacyRevision, "legacyRevision", errors);
  exactKeys(inventory.protocol, PROTOCOL_KEYS, "protocol", errors);
  for (const key of ["ref", "revision"]) nonEmpty(inventory.protocol?.[key], `protocol.${key}`, errors);
  for (const key of ["protocolVersion", "observationVersion"]) {
    if (!Number.isInteger(inventory.protocol?.[key])) errors.push(`protocol.${key} must be an integer`);
  }
  const symbols = protocolSymbols(protocolSources);
  for (const marker of symbols) if (marker.endsWith(":missing-source") || marker.endsWith(":missing-type") || marker.endsWith(":no-members")) errors.push(`protocol extraction failed: ${marker}`);
  const versions = sourceVersions(protocolSources);
  if (versions.protocol !== inventory.protocol.protocolVersion) errors.push(`protocolVersion ${inventory.protocol.protocolVersion} != inspected ${versions.protocol}`);
  if (versions.observation !== inventory.protocol.observationVersion) errors.push(`observationVersion ${inventory.protocol.observationVersion} != inspected ${versions.observation}`);

  if (!Array.isArray(inventory.entries) || inventory.entries.length === 0) errors.push("entries must be a nonempty array");
  const entries = Array.isArray(inventory.entries) ? inventory.entries : [];
  const ids = new Set();
  const addressed = new Map();
  const coveredModules = new Set();
  for (const [index, entry] of entries.entries()) {
    const label = `entries[${index}]`;
    exactKeys(entry, ENTRY_KEYS, label, errors);
    if (!object(entry)) continue;
    nonEmpty(entry.id, `${label}.id`, errors);
    if (ids.has(entry.id)) errors.push(`${label} duplicates id ${entry.id}`);
    ids.add(entry.id);
    for (const key of ["category", "cue", "timing", "privacy", "nonHueCue", "notes"]) nonEmpty(entry[key], `${label}.${key}`, errors);
    if (!["available", "missing-in-protocol", "missing-mechanic"].includes(entry.status)) errors.push(`${label}.status is invalid`);
    if (!Array.isArray(entry.legacySources) || entry.legacySources.length === 0) errors.push(`${label}.legacySources must be nonempty`);
    for (const [sourceIndex, source] of (entry.legacySources ?? []).entries()) {
      validateLegacySource(root, source, `${label}.legacySources[${sourceIndex}]`, errors);
      if (object(source) && typeof source.path === "string") coveredModules.add(source.path);
    }
    exactKeys(entry.trigger, TRIGGER_KEYS, `${label}.trigger`, errors);
    if (object(entry.trigger)) {
      nonEmpty(entry.trigger.symbol, `${label}.trigger.symbol`, errors);
      if (!["protocol", "client", "legacy", "external"].includes(entry.trigger.kind)) errors.push(`${label}.trigger.kind is invalid`);
      if (!["consume", "blocked", "unused", "not-applicable"].includes(entry.trigger.consumption)) errors.push(`${label}.trigger.consumption is invalid`);
      if (entry.trigger.kind === "protocol") {
        if (!symbols.has(entry.trigger.symbol)) errors.push(`${label}.trigger.symbol is absent from inspected protocol: ${entry.trigger.symbol}`);
        if (entry.trigger.consumption === "not-applicable") errors.push(`${label} protocol trigger cannot be not-applicable`);
        addressed.set(entry.trigger.symbol, entry.trigger.consumption);
        if (entry.status === "available" && entry.trigger.consumption !== "consume") errors.push(`${label} available protocol cue must consume its trigger`);
      } else if (entry.trigger.consumption !== "not-applicable") errors.push(`${label} nonprotocol trigger must be not-applicable`);
      if (["blocked", "unused"].includes(entry.trigger.consumption)) nonEmpty(entry.trigger.reason, `${label}.trigger.reason`, errors);
    }
    exactKeys(entry.protocolNeeds, NEED_KEYS, `${label}.protocolNeeds`, errors);
    for (const key of NEED_KEYS) strings(entry.protocolNeeds?.[key], `${label}.protocolNeeds.${key}`, errors);
    const needs = object(entry.protocolNeeds) ? NEED_KEYS.flatMap((key) => entry.protocolNeeds[key] ?? []) : [];
    if (entry.status === "available" && needs.length) errors.push(`${label} available cue cannot request protocol/mechanic work`);
    if (entry.status === "missing-in-protocol" && !object(entry.protocolNeeds)) continue;
    if (entry.status === "missing-in-protocol" && entry.protocolNeeds.events.length + entry.protocolNeeds.fields.length === 0) errors.push(`${label} missing-in-protocol needs an event or field`);
    if (entry.status === "missing-mechanic" && entry.protocolNeeds.mechanics.length === 0) errors.push(`${label} missing-mechanic needs a mechanic`);
  }

  if (!Array.isArray(inventory.protocolUnused)) errors.push("protocolUnused must be an array");
  for (const [index, unused] of (inventory.protocolUnused ?? []).entries()) {
    exactKeys(unused, UNUSED_KEYS, `protocolUnused[${index}]`, errors);
    if (!object(unused)) continue;
    nonEmpty(unused.symbol, `protocolUnused[${index}].symbol`, errors);
    nonEmpty(unused.reason, `protocolUnused[${index}].reason`, errors);
    if (!symbols.has(unused.symbol)) errors.push(`protocolUnused[${index}] is absent from inspected protocol: ${unused.symbol}`);
    if (addressed.has(unused.symbol)) errors.push(`protocol symbol is both entry-triggered and unused: ${unused.symbol}`);
    addressed.set(unused.symbol, "unused");
  }
  for (const symbol of symbols) if (!addressed.has(symbol)) errors.push(`protocol symbol has no consumption or unused status: ${symbol}`);

  if (!Array.isArray(inventory.intentionalExclusions)) errors.push("intentionalExclusions must be an array");
  const exclusions = new Set();
  for (const [index, exclusion] of (inventory.intentionalExclusions ?? []).entries()) {
    exactKeys(exclusion, EXCLUSION_KEYS, `intentionalExclusions[${index}]`, errors);
    if (!object(exclusion)) continue;
    nonEmpty(exclusion.path, `intentionalExclusions[${index}].path`, errors);
    nonEmpty(exclusion.reason, `intentionalExclusions[${index}].reason`, errors);
    if (!ids.has(exclusion.coveredBy)) errors.push(`intentionalExclusions[${index}].coveredBy is not an entry`);
    if (coveredModules.has(exclusion.path)) errors.push(`module is both referenced and excluded: ${exclusion.path}`);
    exclusions.add(exclusion.path);
  }
  const modules = presentationModules(root);
  for (const path of modules) if (!coveredModules.has(path) && !exclusions.has(path)) errors.push(`presentation module has no cue source or intentional exclusion: ${path}`);
  for (const path of exclusions) if (!modules.includes(path)) errors.push(`intentional exclusion is not a covered presentation module: ${path}`);
  const report = errors.length ? "" : generateGaps(inventory);
  return { errors, report, symbols, modules };
}

export function verifySourcePins(root, inventory) {
  const actualProtocol = execFileSync("git", ["rev-parse", inventory.protocol.ref], { cwd: root, encoding: "utf8" }).trim();
  if (actualProtocol !== inventory.protocol.revision) {
    throw new Error(`protocol ref ${inventory.protocol.ref} is ${actualProtocol}, not reviewed revision ${inventory.protocol.revision}`);
  }
  try {
    execFileSync("git", ["diff", "--quiet", inventory.legacyRevision, "--", "packages/client"], { cwd: root, stdio: "pipe" });
  } catch {
    throw new Error(`legacy packages/client differs from reviewed revision ${inventory.legacyRevision}`);
  }
}

function parseArgs(argv) {
  const options = { check: false, inventory: "docs/unity/presentation-inventory.json", output: "docs/unity/PROTOCOL_GAPS.md" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--inventory" || arg === "--output") {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a path`);
      options[arg.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const inventoryPath = resolve(ROOT, options.inventory);
  const outputPath = resolve(ROOT, options.output);
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  verifySourcePins(ROOT, inventory);
  const result = checkInventory({ root: ROOT, inventory, protocolSources: loadProtocolSources(ROOT, inventory.protocol?.revision) });
  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR ${error}`);
    console.error(`Inventory drift: ${result.errors.length} error(s); generated output was not written.`);
    return 1;
  }
  if (options.check) {
    const actual = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (actual !== result.report) {
      console.error(`ERROR generated report is stale or missing: ${relative(ROOT, outputPath)}`);
      return 1;
    }
  } else writeFileSync(outputPath, result.report);
  console.log(`PASS ${inventory.entries.length} cues; ${result.modules.length} modules; ${result.symbols.size} protocol symbols; ${inventory.entries.filter((entry) => entry.status !== "available").length} gap entries${options.check ? "; generated report current" : ""}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
