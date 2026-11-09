// Static consumer for the declared-helper corpus: checks families/outcomes, not a copied formula.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "/out";
const c = JSON.parse(readFileSync(join(out, "source.json"), "utf8"));
const fail = (m) => { throw new Error(m); };
if (c.format !== "rh-walk-hint-helpers/1") fail("wrong format");
if (!Array.isArray(c.cases) || c.cases.length < 40) fail("too few helper cases");
const by = Object.fromEntries(c.cases.map((x) => [x.id, x]));
const get = (id) => { const x = by[id]; if (!x) fail("missing " + id); if (x.error) fail(id + " errored: " + x.error); return x; };
const hint = (id) => { const o = get(id).observed; if (!o || !o.hint) fail("no hint " + id); return o.hint; };
const zero = (id) => { if (hint(id).ticks !== 0) fail(id + " not zero"); };
const pos = (id) => { if (!(hint(id).ticks > 0 && hint(id).ticks <= 3)) fail(id + " not positive"); };
for (const id of ["gate-phase-lobby","gate-phase-ended","gate-standing-dead","gate-hidden","gate-stun","gate-root","gate-slip-center","gate-path-empty","gate-tiny-segment"]) zero(id);
pos("positive-baseline"); zero("factor-zero"); pos("factor-floor");
if (JSON.stringify(get("factor-hazard-noninterference").input.beforeHazards) !== JSON.stringify(get("factor-hazard-noninterference").observed.afterHazards)) fail("hazard changed");
zero("weapon-root-active"); pos("weapon-root-expired"); zero("weapon-action-swing"); if (hint("weapon-held-ready").ticks !== 2) fail("held-ready not 2"); pos("weapon-buffered-not-ready");
if (get("weaponHoldsAt-root-before").observed.observed !== true || get("weaponHoldsAt-root-at").observed.observed !== false) fail("weaponHoldsAt boundary");
pos("lock-free"); zero("lock-stop"); zero("lock-missing"); zero("lock-replan"); zero("lock-future-hidden");
pos("amove-no-target"); zero("amove-acquire");
zero("ice-center"); zero("ice-thin-strip"); pos("ice-clear"); pos("ice-home-frost"); zero("ice-all-hazards");
const d2 = get("hysteresis-delta2"), d3 = get("hysteresis-delta3"), w255 = get("hysteresis-wrap-255"), w253 = get("hysteresis-wrap-253");
if (d2.observed.observed.dir !== d2.input.oldDir) fail("delta2 changed");
if (d3.observed.observed.dir === d3.input.oldDir) fail("delta3 unchanged");
if (w255.observed.observed.dir !== 255) fail("wrap255 changed");
if (w253.observed.observed.dir === 253) fail("wrap253 unchanged");
if (hint("waypoint-cap3").ticks !== 3 || hint("waypoint-cap2").ticks !== 2) fail("waypoint boundaries");
for (const id of ["hook-teleported","hook-runEnded"]) {
  const x = get(id);
  if (x.input.before.ticks <= 0) fail(id + " before zero");
  if (x.observed.players.some((p) => p.ticks !== 0)) fail(id + " after nonzero");
  if (!x.observed.players.some((p) => p.dir !== 0)) fail(id + " dir lost");
}
const mirror = c.cases.filter((x) => x.family === "mirrorTimings");
if (mirror.length !== 18) fail("mirrorTimings rows " + mirror.length);
for (const weapon of ["sword","bow","wand","shield","axe","fists"]) {
  const getM = (pair) => mirror.find((x) => x.input.weapon === weapon && x.input.pair === pair)?.observed;
  const b = getM("baseline"), f = getM("fast-as-reduced-windup"), s = getM("slow-as-increased-windup");
  if (!b || !f || !s) fail("mirror pair missing " + weapon);
  if (!(f.interval < b.interval)) fail("fast AS interval " + weapon);
  if (f.ranged && f.windup !== b.windup) fail("NPC ranged floor " + weapon);
  if (!f.ranged && !(f.windup <= b.windup)) fail("melee fast windup " + weapon);
  if (!(s.windup >= b.windup)) fail("slow windup " + weapon);
}
console.log(JSON.stringify({ mode: "verify", cases: c.cases.length, errors: c.cases.filter((x) => x.error).length, families: [...new Set(c.cases.map((x) => x.family))] }));