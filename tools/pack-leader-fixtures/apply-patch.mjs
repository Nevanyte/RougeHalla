// Minimal exact unified-diff applier for the mutant patches (the pinned slim image has no GNU patch). It verifies every
// context line before writing, so a stale patch fails instead of corrupting the copy.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, patchPath] = process.argv.slice(2);
if (!root || !patchPath) { console.error("usage: apply-patch.mjs <repo-root> <patch>"); process.exit(2); }
const input = readFileSync(patchPath, "utf8").split("\n");
let i = 0;
while (i < input.length && !input[i].startsWith("--- ")) i++;
if (i >= input.length) { console.error("no --- header"); process.exit(2); }
const oldHeader = input[i++].slice(4).trim();
if (!input[i] || !input[i].startsWith("+++ ")) { console.error("no +++ header"); process.exit(2); }
const newHeader = input[i++].slice(4).trim();
const strip = (p) => p.replace(/^[ab]\//, "");
if (strip(oldHeader) !== strip(newHeader)) { console.error("different old/new paths are not supported"); process.exit(2); }
const rel = strip(newHeader);
const file = join(root, rel);
const original = readFileSync(file, "utf8").split("\n");
const out = [];
let cursor = 0;
let hunks = 0;
while (i < input.length) {
  const line = input[i];
  if (!line.startsWith("@")) { i++; continue; }
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!m) { console.error("bad hunk header: " + line); process.exit(2); }
  const oldStart = Number(m[1]);
  i++;
  const ops = [];
  while (i < input.length) {
    const l = input[i];
    if (l.startsWith("@@") || l === "" || l === "\\ No newline at end of file") break;
    const op = l[0];
    if (op !== " " && op !== "-" && op !== "+") break;
    ops.push({ op, content: l.slice(1) });
    i++;
  }
  const at = oldStart - 1;
  if (at < cursor) { console.error("overlapping hunk at " + rel + ":" + oldStart); process.exit(2); }
  out.push(...original.slice(cursor, at));
  let c = at;
  for (const o of ops) {
    if (o.op === " " || o.op === "-") {
      if (original[c] !== o.content) {
        console.error("context mismatch at " + rel + ":" + (c + 1) + "\n  file:     " + JSON.stringify(original[c]) + "\n  expected: " + JSON.stringify(o.content));
        process.exit(2);
      }
      if (o.op === " ") out.push(original[c]);
      c++;
    } else {
      out.push(o.content);
    }
  }
  cursor = c;
  hunks++;
}
if (hunks === 0) { console.error("no hunks applied"); process.exit(2); }
out.push(...original.slice(cursor));
writeFileSync(file, out.join("\n"));
console.log("applied " + hunks + " hunk(s) to " + rel);