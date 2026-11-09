// Focused consumer of the actual-source walk-hint corpus. It reads only the sealed JSON and
// verifies the reached facts; it does not recompute any source formula or expected hint.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "/out";
const c = JSON.parse(readFileSync(join(out, "source.json"), "utf8"));
const fail = (m) => { throw new Error(m); };
if (c.format !== "rh-walk-hint-source/1") fail("wrong format");
if (!Array.isArray(c.frames) || c.frames.length < 6) fail("too few frames");
const first = c.frames.find((f) => f.label === "move-initial");
const small = c.frames.find((f) => f.label === "move-small-turn");
const large = c.frames.find((f) => f.label === "move-large-turn");
const stop = c.frames.find((f) => f.label === "stop");
if (!first || !small || !large || !stop) fail("missing named frame");
const p0 = (f) => f.snapshot.players[0];
if (!(p0(first).extra.walkTicks > 0 && p0(first).path.length > 0)) fail("initial move did not produce hint/path");
if (!(p0(first).extra.walkDir !== 0)) fail("initial walkDir is zero");
if (!(p0(first).x !== c.setup.snapshot.players[0].x || p0(first).y !== c.setup.snapshot.players[0].y)) fail("no actual movement");
if (!c.summary.capReached) fail("cap3 not reached");
if (!(p0(small).extra.walkTicks > 0 && p0(small).extra.walkDir === p0(first).extra.walkDir)) fail("small-turn hysteresis not observed");
if (!(p0(large).extra.walkTicks > 0 && p0(large).extra.walkDir !== p0(first).extra.walkDir)) fail("large-turn heading transition not observed");
if (p0(stop).extra.walkTicks !== 0 || p0(stop).path.length !== 0) fail("stop did not zero");
const last = c.frames[c.frames.length - 1];
if (p0(last).extra.walkTicks !== 0 || p0(last).path.length !== 0) fail("waypoint end did not zero");
const waypoint0 = c.frames.find((f) => f.label === "waypoint-0");
if (!waypoint0 || !waypoint0.order || waypoint0.order.type !== "move" || waypoint0.order.msg?.seq !== 5 || waypoint0.order.accepted !== true) fail("waypoint-0 missing accepted seq5 Move record");
if (!c.frames.some((f) => p0(f).extra.walkTicks > 0 && f.label.startsWith("waypoint-"))) fail("waypoint approach never hinted");
if (!c.replay.equal) fail("instrumentation-disabled replay changed facts");
for (const f of c.frames) {
  if (p0(f).extra.walkTicks > 3) fail("hint over cap at " + f.label);
  if (!Array.isArray(f.events)) fail("events missing at " + f.label);
  if (!Array.isArray(f.snapshot.players[0].path)) fail("path missing at " + f.label);
}
console.log(JSON.stringify({ mode: "verify", frames: c.frames.length, hintSequence: c.summary.hintSequence, replayEqual: c.replay.equal, sha256: c.profile ? undefined : undefined }));