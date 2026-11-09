// Data-only verifier, shared by the compiled helper and this optional readonly CLI.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const IDS = ["goal-below", "goal-equal", "goal-above", "repath-before", "repath-equal", "repath-fresh",
  "los-before", "los-equal", "future-hidden-active", "future-hidden-revealed", "future-untargetable-before", "future-untargetable-equal",
  "amove-nearest-ordered", "amove-hidden-nearest", "amove-hide-to-acquire", "waypoint-below", "waypoint-equal", "waypoint-above",
  "direction-below", "direction-equal", "direction-above", "tie-before", "tie-equal", "tie-after"];
const fail = message => { throw new Error(message); };
function requireTrue(value, label) { if (value !== true) fail(label); }
export function assertBoundaryCorpus(c) {
  if (c?.format !== "rh-walk-hint-helper-boundaries/1") fail("wrong corpus format");
  if (!Array.isArray(c.cases) || c.cases.length !== IDS.length || c.cases.length > 24) fail("expected exactly24 finite declared contexts");
  const by = new Map();
  for (const row of c.cases) {
    if (!row || typeof row.id !== "string" || by.has(row.id) || !IDS.includes(row.id)) fail("unknown/duplicate case id");
    if (row.helper !== true || row.error) fail(row.id + ": setup/source ERROR: " + JSON.stringify(row.error));
    if (!row.input || !row.observed || !Number.isInteger(row.draws) || row.draws < 0) fail(row.id + ": incomplete actual observation");
    by.set(row.id, row);
  }
  const get = id => { if (!by.has(id)) fail("missing " + id); return by.get(id); };
  const ticks = id => { const h = get(id).observed.hint; if (!h || !Number.isInteger(h.dir) || h.dir < 0 || h.dir > 255 || !Number.isInteger(h.ticks) || h.ticks < 0 || h.ticks > 3) fail("bad hint " + id); return h.ticks; };
  for (const [id, expected] of [["goal-below", 1], ["goal-equal", 1], ["goal-above", 0], ["repath-before", 1], ["repath-equal", 0], ["repath-fresh", 0], ["los-before", 1], ["los-equal", 0]])
    if (ticks(id) !== expected) fail(id + ": actual source hint did not isolate the declared branch");
  for (const id of ["los-before", "los-equal"]) {
    const r = get(id).input.recipe;
    requireTrue(r.actualVisible && r.actualLockable && !r.actualLOS && r.lostAt > 0, id + ": earlier visibility/clock gate masks grace");
  }
  for (const [id, expected] of [["future-hidden-active", true], ["future-hidden-revealed", false], ["future-untargetable-before", true], ["future-untargetable-equal", false], ["tie-before", false], ["tie-equal", false], ["tie-after", true]])
    if (get(id).observed.observed !== expected) fail(id + ": actual source endpoint differs");
  for (const id of ["amove-nearest-ordered", "amove-hidden-nearest"]) {
    if (ticks(id) !== 0 || get(id).observed.selected !== "p2") fail(id + ": actual chooser did not select declared visible fallback/nearest");
    const order = get(id).input.recipe.orderedCandidates.map(x => x.id);
    if (order.join(",") !== "p0,p1,p2") fail(id + ": actual candidate insertion order changed");
  }
  const transition = get("amove-hide-to-acquire").observed;
  if (transition.before.ticks !== 1 || transition.selectedBefore !== null || transition.removed.length !== 1 || transition.after.ticks !== 0 || transition.selectedAfter !== "p1")
    fail("actual hidden-status-removal/chooser sequence did not reach the declared transition");
  for (const [id, expected] of [["waypoint-below", 2], ["waypoint-equal", 3], ["waypoint-above", 3]]) {
    requireTrue(get(id).input.recipe.isolation, id + ": segment input did not isolate the actual floating predicate");
    if (ticks(id) !== expected) fail(id + ": actual source waypoint result differs");
  }
  const d = ["below", "equal", "above"].map(side => get("direction-" + side));
  const bits = d.map(row => BigInt("0x" + row.input.recipe.angleBits));
  if (bits[0] !== bits[1] + 1n || bits[2] !== bits[1] - 1n) fail("direction angles are not adjacent binary64 inputs");
  for (const row of d) {
    if (!Number.isInteger(row.observed.direct) || row.observed.direct < 0 || row.observed.direct > 255) fail("bad actual encodeWalkDir output");
    ticks(row.id);
    if (row.observed.hint.ticks === 0 || row.observed.hint.dir !== row.observed.pathKernel) fail("actual path/kernel representation differs " + row.id);
  }
  if (d[1].observed.direct !== 0) fail("actual source negative half rounds to the wrong byte");
  // Deliberately do NOT assert a Cartesian hint transition. It is OPEN if placement/atan2
  // collapses adjacent angle inputs. No favourable-input search, forced hint or expected formula.
  return {
    cases: c.cases.length,
    directDirectionTransition: d.some(row => row.observed.direct !== d[1].observed.direct),
    pathDirectionTransition: d.some(row => row.observed.hint.dir !== d[1].observed.hint.dir),
    actualPathAngleCount: new Set(d.map(row => row.input.recipe.actualPathAngleBits)).size,
    directionPathCoverage: "OPEN until independent capture review: direct adjacent-input kernel and Cartesian path observations are separate; no fabricated transition",
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = assertBoundaryCorpus(JSON.parse(readFileSync(join(process.argv[2] || "/out", "source.json"), "utf8")));
  console.log(JSON.stringify({ mode: "verify", ...result }));
}
