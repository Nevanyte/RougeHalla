// DECLARED method contexts, not earned World history. Outputs come from the actual source APIs.
// The only compiled source adapter appends an export of walkHint.ts's existing SPEED_SLACK.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  mapFromTiles, mulberry32, decide, lockSpacing, PLAYER_SPEED, TICK_MS,
  TARGET_LOS_GRACE_MS, TARGET_REPATH_MS, TARGET_RANGE, encodeWalkDir, hasLineOfSight,
} from "@raid/shared";
import { createGameWorld } from "/repo/packages/server/src/sim/gameplay.ts";
import { addPlayer, step as sourceStep } from "/repo/packages/server/src/sim/step.ts";
import { addStatus, removeStatuses, reveal, isUntargetableAt } from "/repo/packages/server/src/sim/status.ts";
import { allCombatants, combatant, timingsOf } from "/repo/packages/server/src/sim/combatant.ts";
import { walkHintOf, weaponHoldsAt, SPEED_SLACK } from "/repo/packages/server/src/sim/walkHint.ts";
import { GOAL_MOVED, lockable, updateTargets } from "/repo/packages/server/src/sim/targeting.ts";
import { getVisionMemory, canPlayerSeeActor } from "/repo/packages/server/src/sim/vision.ts";
import { collisionMap } from "/repo/packages/server/src/sim/world.ts";
import { TIE_EPS_MS } from "/repo/packages/server/src/sim/weapons.ts";
export { assertBoundaryCorpus as assertBoundaryFacts } from "./boundaries-verify.mjs";

export const SOURCE_FILES = [
  "packages/server/src/sim/walkHint.ts", "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/step.ts", "packages/server/src/sim/status.ts",
  "packages/server/src/sim/targeting.ts", "packages/server/src/sim/combatant.ts",
  "packages/server/src/sim/movement.ts", "packages/server/src/sim/world.ts",
  "packages/server/src/sim/vision.ts", "packages/server/src/sim/weapons.ts",
  "packages/shared/src/constants.ts", "packages/shared/src/mods.ts",
  "packages/shared/src/weapons.ts", "packages/shared/src/policies.ts",
  "packages/shared/src/terrain.ts", "packages/shared/src/interp.ts",
];
const W = 64, H = 40, SEED = 7, SETUP_STEPS = 40;
const BASE = {
  minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6,
  patienceMinSeconds: 1e6, suddenDeathSeconds: 1e6, planSeconds: 0,
  firstPatienceSeconds: 0, pvpRules: false, wishLockSeconds: 0,
};
const numberBytes = new DataView(new ArrayBuffer(8));
export function floatBits(x) { numberBytes.setFloat64(0, x, false); return numberBytes.getBigUint64(0, false).toString(16).padStart(16, "0"); }
export function nextUp(x) {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  numberBytes.setFloat64(0, x, false);
  numberBytes.setBigUint64(0, numberBytes.getBigUint64(0, false) + (x > 0 ? 1n : -1n), false);
  return numberBytes.getFloat64(0, false);
}
export function nextDown(x) { return -nextUp(-x); }
function facts(value) {
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
    return { float: Number.isNaN(value) ? "NaN" : Object.is(value, -0) ? "-0" : value < 0 ? "-Infinity" : "+Infinity", bits: floatBits(value) };
  if (Array.isArray(value)) return value.map(facts);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, facts(v)]));
  return value;
}
function need(ok, message, detail = null) {
  if (ok) return;
  const error = new Error(message); error.detail = facts(detail); throw error;
}
function makeWorld({ players = 1, walls = [], borderWalls = true } = {}) {
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (borderWalls && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) tiles[y * W + x] = 1;
  for (const [x, y] of walls) tiles[y * W + x] = 1;
  const terrain = new Uint8Array(W * H);
  const map = mapFromTiles(W, H, tiles, 0, terrain);
  map.spawns = [{ x: 176, y: 176 }, { x: 336, y: 176 }, { x: 176, y: 272 }];
  let draws = 0; const random = mulberry32(SEED);
  const world = createGameWorld({ map, seed: 0, random: () => { draws++; return random(); },
    config: { ...BASE, minPlayers: players }, newItemUid: (() => { let n = 0; return () => "u" + n++; })() }, { walkHints: true });
  for (let i = 0; i < players; i++) addPlayer(world, "p" + i, "boundary-p" + i, { faction: i === 0 ? "holy" : "frost" });
  // The clock is produced by ordinary source steps, not assigned to a desired answer.
  for (let i = 0; i < SETUP_STEPS; i++) sourceStep(world, TICK_MS);
  need(world.state.phase === "active", "source setup did not reach active");
  return { world, draws: () => draws, setup: { map: { width: W, height: H, borderWalls, walls, terrain: "zero", spawns: map.spawns },
    mainSeed: SEED, drawCounterScope: "supplied world.random only; derived reward/quest counters are not observed", sourceSteps: SETUP_STEPS, configuration: { ...BASE, minPlayers: players }, players,
    contextPolicy: "declared positions/path/weapon/status/history; ordinary steps produce only the setup clock, not earned combat" }, recipe: {} };
}
const C = (world, id) => combatant(world, id);
function put(world, id, x, y) {
  const p = world.state.players.get(id), rt = world.players.get(id);
  p.x = x; p.y = y; p.status = "alive"; rt.path = []; rt.slip = null;
  rt.history = [{ t: world.state.serverTime, x, y }]; p.extra.walkTicks = 0; p.extra.walkDir = 0;
}
function equip(world, id, weapon = "wand") {
  const p = world.state.players.get(id), rt = world.players.get(id);
  p.weapon0 = weapon; p.weapon1 = ""; p.slot = 0; p.readyAt = world.state.serverTime + 10000;
  Object.assign(rt.weapon, { action: null, rootUntil: 0, held: false, bufferedUntil: 0,
    lock: null, lockSeen: false, lockLosLostAt: 0, lockPlanAt: -Infinity, lockGoal: null, attackMoveGoal: null });
}
function describe(ctx) {
  return facts({ setup: ctx.setup, recipe: ctx.recipe, now: ctx.world.state.serverTime, tick: ctx.world.state.tick,
    fighters: allCombatants(ctx.world).map(c => ({ id: c.id, kind: c.kind, faction: c.s.faction,
      x: c.s.x, y: c.s.y, status: c.s.status, readyAt: c.s.readyAt, speedMult: c.s.speedMult,
      weapon0: c.s.weapon0, weapon1: c.s.weapon1, slot: c.s.slot, path: c.rt.path,
      history: c.rt.history, slip: c.rt.slip,
      weapon: { action: c.rt.weapon.action, rootUntil: c.rt.weapon.rootUntil, held: c.rt.weapon.held,
        bufferedUntil: c.rt.weapon.bufferedUntil, lock: c.rt.weapon.lock, lockSeen: c.rt.weapon.lockSeen,
        lockLosLostAt: c.rt.weapon.lockLosLostAt, lockPlanAt: c.rt.weapon.lockPlanAt,
        lockGoal: c.rt.weapon.lockGoal, attackMoveGoal: c.rt.weapon.attackMoveGoal }, statuses: c.rt.statuses ?? [] })) });
}
function run(id, decision, setup, observe) {
  let ctx, input;
  try {
    ctx = setup(); input = describe(ctx); ctx.world.events = []; const before = ctx.draws();
    const observed = observe(ctx);
    return { id, decision, helper: true, input, observed: facts(observed), events: facts(ctx.world.events.slice()), draws: ctx.draws() - before };
  } catch (error) {
    return { id, decision, helper: true, input: input ?? (ctx ? describe(ctx) : null),
      error: { name: error.name, message: String(error.message), detail: error.detail ?? null } };
  }
}
function hint(ctx) { return walkHintOf(ctx.world, C(ctx.world, "p0")); }
function hintObserve(ctx) { return { method: "walkHintOf", hint: hint(ctx) }; }
function lockBase(ctx) {
  const w = ctx.world, spacing = lockSpacing("wand");
  // Outside the source attack/far distance, but inside TARGET_RANGE, so no stop/hold can mask replanning.
  const distance = (spacing.attackRange + TARGET_RANGE) / 2;
  need(distance > spacing.far && distance > spacing.attackRange && distance < TARGET_RANGE, "no declared lock interval", spacing);
  put(w, "p0", 200, 200); put(w, "p1", 200 + distance, 200); equip(w, "p0");
  w.players.get("p0").path = [{ x: 250, y: 200 }];
  const p = w.state.players.get("p0"), t = w.state.players.get("p1");
  const out = decide({ self: { x: p.x, y: p.y }, target: { x: t.x, y: t.y }, targetVel: { x: 0, y: 0 },
    los: true, weapon: "wand", ready: false, windup: timingsOf(p, "wand").windup, spacing });
  need(out.move && typeof out.move === "object" && Number.isFinite(out.move.x) && Number.isFinite(out.move.y), "actual decide did not return a finite Vec goal", out);
  const rt = w.players.get("p0");
  Object.assign(rt.weapon, { lock: "p1", lockSeen: true, lockGoal: { ...out.move }, lockPlanAt: w.state.serverTime });
  ctx.recipe = { actualPolicy: out, spacing, targetRange: TARGET_RANGE, distance, sourceGoalThreshold: GOAL_MOVED, at: w.state.serverTime + TICK_MS };
  return ctx;
}
function candidateFacts(w) {
  const self = C(w, "p0"), at = w.state.serverTime + TICK_MS, map = collisionMap(w);
  return allCombatants(w).map(c => ({ id: c.id, x: c.s.x, y: c.s.y,
    distance: Math.hypot(c.s.x - self.s.x, c.s.y - self.s.y), lockable: lockable(w, self, c),
    untargetableAt: isUntargetableAt(c, at), los: hasLineOfSight(map, self.s, c.s) }));
}
export function runBoundaries() {
  const cases = [];
  for (const side of ["below", "equal", "above"]) cases.push(run("goal-" + side, "goal8", () => {
    const ctx = lockBase(makeWorld({ players: 2 })), g = ctx.recipe.actualPolicy.move;
    const equalX = g.x + GOAL_MOVED;
    const x = side === "below" ? nextDown(equalX) : side === "above" ? nextUp(equalX) : equalX;
    const distance = Math.hypot(x - g.x, 0);
    need(side === "below" ? distance < GOAL_MOVED : side === "above" ? distance > GOAL_MOVED : distance === GOAL_MOVED,
      "stored goal coordinates did not straddle the source threshold", { side, x, goal: g, distance });
    const rt = ctx.world.players.get("p0"); rt.weapon.lockGoal = { x, y: g.y };
    rt.weapon.lockPlanAt = ctx.recipe.at - TARGET_REPATH_MS;
    ctx.recipe = { ...ctx.recipe, side, storedGoal: rt.weapon.lockGoal, storedXBits: floatBits(x), actualDistance: distance,
      distanceBits: floatBits(distance), elapsed: ctx.recipe.at - rt.weapon.lockPlanAt };
    return ctx;
  }, hintObserve));
  for (const side of ["before", "equal", "fresh"]) cases.push(run("repath-" + side, "repath250", () => {
    const ctx = lockBase(makeWorld({ players: 2 })), rt = ctx.world.players.get("p0"), g = ctx.recipe.actualPolicy.move;
    rt.weapon.lockGoal = { x: g.x + GOAL_MOVED * 2, y: g.y };
    const equalPlan = ctx.recipe.at - TARGET_REPATH_MS;
    rt.weapon.lockPlanAt = side === "fresh" ? -Infinity : side === "before" ? nextUp(equalPlan) : equalPlan;
    const elapsed = ctx.recipe.at - rt.weapon.lockPlanAt;
    need(side === "before" ? elapsed < TARGET_REPATH_MS : side === "equal" ? elapsed === TARGET_REPATH_MS : elapsed === Infinity,
      "stored plan times did not isolate source elapsed", { side, elapsed, plan: rt.weapon.lockPlanAt });
    ctx.recipe = { ...ctx.recipe, side, actualMoved: Math.hypot(g.x - rt.weapon.lockGoal.x, g.y - rt.weapon.lockGoal.y),
      planAt: rt.weapon.lockPlanAt, planAtBits: floatBits(rt.weapon.lockPlanAt), elapsed };
    return ctx;
  }, hintObserve));
  for (const side of ["before", "equal"]) cases.push(run("los-" + side, "losGrace", () => {
    const walls = [[9, 4], [9, 5], [9, 6], [9, 7], [9, 8], [9, 9]];
    const ctx = lockBase(makeWorld({ players: 2, walls })), w = ctx.world;
    const targetX = w.state.players.get("p1").x;
    // Actual private VisionMemory is primed through its source API and ordinary clock steps.
    // No visibility answer, trail tile, ward owner, Mark or expected lock is installed.
    put(w, "p0", targetX - 24, 200);
    for (let i = 0; i < 2; i++) sourceStep(w, TICK_MS);
    const memory = getVisionMemory(w, "p0");
    need(memory !== null, "actual VisionMemory unavailable");
    const primedAt = w.state.serverTime;
    put(w, "p0", 200, 200); put(w, "p1", targetX, 200); equip(w, "p0");
    const rt = w.players.get("p0"); rt.path = [{ x: 250, y: 200 }];
    Object.assign(rt.weapon, { lock: "p1", lockSeen: true, lockGoal: { x: targetX, y: 200 }, lockPlanAt: w.state.serverTime + TICK_MS });
    const at = w.state.serverTime + TICK_MS;
    const targetElapsed = side === "before" ? nextDown(TARGET_LOS_GRACE_MS) : TARGET_LOS_GRACE_MS;
    rt.weapon.lockLosLostAt = at - targetElapsed;
    const self = C(w, "p0"), target = C(w, "p1");
    const visible = canPlayerSeeActor(w, "p0", "p1", target.s), eligible = lockable(w, self, target);
    const los = hasLineOfSight(collisionMap(w), self.s, target.s), elapsed = at - rt.weapon.lockLosLostAt;
    need(visible && eligible && !los && rt.weapon.lockLosLostAt > 0, "LOS grace preconditions not reached; coverage remains OPEN",
      { visible, eligible, los, lostAt: rt.weapon.lockLosLostAt, elapsed });
    need(elapsed === targetElapsed, "LOS elapsed round-trip did not isolate the declared boundary",
      { side, at, targetElapsed, lostAt: rt.weapon.lockLosLostAt, elapsed });
    need(side === "before" ? elapsed < TARGET_LOS_GRACE_MS : elapsed === TARGET_LOS_GRACE_MS, "LOS clocks do not straddle expiry", elapsed);
    ctx.recipe = { ...ctx.recipe, side, at, primedAt, extraOrdinarySourceSteps: 2, actualVisible: visible,
      actualLockable: eligible, actualLOS: los, lostAt: rt.weapon.lockLosLostAt, lostAtBits: floatBits(rt.weapon.lockLosLostAt),
      targetElapsed, targetElapsedBits: floatBits(targetElapsed), elapsed };
    return ctx;
  }, hintObserve));
  for (const variant of ["hidden-active", "hidden-revealed", "untargetable-before", "untargetable-equal"]) cases.push(run("future-" + variant, "futureVisibility", () => {
    const ctx = makeWorld({ players: 2 }), w = ctx.world; put(w, "p0", 200, 200); put(w, "p1", 400, 200);
    const c = C(w, "p1"), hidden = variant.startsWith("hidden");
    const inst = addStatus(w, c, { kind: hidden ? "hidden" : "untargetable", source: { id: "h", name: "h" }, ms: hidden ? 5000 : TICK_MS });
    need(inst !== null, "actual addStatus refused declared status");
    if (variant === "hidden-revealed") reveal(w, c, w.state.serverTime + 100);
    ctx.at = hidden ? w.state.serverTime + TICK_MS : variant.endsWith("before") ? nextDown(inst.until) : inst.until;
    ctx.recipe = { variant, actualInstance: { ...inst }, at: ctx.at, atBits: floatBits(ctx.at) }; return ctx;
  }, ctx => ({ method: "isUntargetableAt", at: ctx.at, observed: isUntargetableAt(C(ctx.world, "p1"), ctx.at) })));
  for (const variant of ["nearest-ordered", "hidden-nearest", "hide-to-acquire"]) cases.push(run("amove-" + variant, "amoveOrder", () => {
    const ctx = makeWorld({ players: 3 }), w = ctx.world;
    put(w, "p0", 200, 200); put(w, "p1", variant === "nearest-ordered" ? 400 : 300, 200);
    put(w, "p2", variant === "nearest-ordered" ? 300 : variant === "hide-to-acquire" ? 1100 : 400, 200); equip(w, "p0");
    const rt = w.players.get("p0"); rt.path = [{ x: 250, y: 200 }]; rt.weapon.attackMoveGoal = { x: 250, y: 200 };
    if (variant !== "nearest-ordered") need(addStatus(w, C(w, "p1"), { kind: "hidden", source: { id: "h", name: "h" }, ms: 5000 }) !== null, "hidden setup refused");
    ctx.recipe = { variant, orderedCandidates: candidateFacts(w), attackMoveGoal: rt.weapon.attackMoveGoal }; return ctx;
  }, ctx => {
    const w = ctx.world, rt = w.players.get("p0"), before = hint(ctx);
    updateTargets(w); const selectedBefore = rt.weapon.lock;
    if (ctx.recipe.variant !== "hide-to-acquire") return { method: "walkHintOf+updateTargets", hint: before, selected: selectedBefore, orderedCandidates: candidateFacts(w) };
    const removed = removeStatuses(w, C(w, "p1"), st => st.kind === "hidden");
    const after = hint(ctx); updateTargets(w);
    return { method: "walkHintOf+updateTargets+removeStatuses+walkHintOf+updateTargets", before, selectedBefore,
      removed: removed.map(st => ({ ...st })), after, selectedAfter: rt.weapon.lock, orderedCandidates: candidateFacts(w) };
  }));
  for (const side of ["below", "equal", "above"]) cases.push(run("waypoint-" + side, "waypoint1e-6", () => {
    const ctx = makeWorld({ borderWalls: false }), w = ctx.world;
    // Input geometry only, not an output oracle. The source baseline has speed1/no hunt/haste.
    // Fixed endpoint48 and origin48-length keep the subtraction at the segment's binade;
    // this avoids rounding tiny endpoint differences away at a world coordinate near200.
    const step = (PLAYER_SPEED * SPEED_SLACK * TICK_MS) / 1000, threshold = 3 * step - 1e-6;
    const requested = side === "below" ? nextDown(threshold) : side === "above" ? nextUp(threshold) : threshold;
    const qx = 48, px = qx - requested;
    put(w, "p0", px, 200); equip(w, "p0", "fists");
    const length = Math.hypot(qx - px, 0), comparison = length + 1e-6, edge = 3 * step;
    const isolation = side === "below" ? comparison < edge : side === "above" ? comparison > edge : comparison === edge;
    need(isolation, "actual segment arithmetic did not isolate the waypoint slack boundary", { side, px, qx, requested, length, comparison, edge });
    w.players.get("p0").path = [{ x: qx, y: 200 }];
    ctx.recipe = { side, sourceSpeed: PLAYER_SPEED, exportedSourceSlack: SPEED_SLACK, declaredStep: step, threshold,
      origin: px, endpoint: qx, requestedLength: requested, requestedBits: floatBits(requested), actualLength: length,
      comparison, edge, isolation, coverage: "adjacent declared segment inputs; actual walkHintOf supplies the answer" };
    return ctx;
  }, hintObserve));
  const theta = -Math.PI / 256;
  for (const [side, angle] of [["below", nextDown(theta)], ["equal", theta], ["above", nextUp(theta)]]) cases.push(run("direction-" + side, "directionRounding", () => {
    const ctx = makeWorld(), w = ctx.world; put(w, "p0", 200, 200); equip(w, "p0", "fists");
    const q = { x: 200 + Math.cos(angle) * 100, y: 200 + Math.sin(angle) * 100 };
    w.players.get("p0").path = [q]; ctx.recipe = { side, angle, angleBits: floatBits(angle), endpoint: q,
      actualPathAngle: Math.atan2(q.y - 200, q.x - 200), actualPathAngleBits: floatBits(Math.atan2(q.y - 200, q.x - 200)), directKernel: "actual shared encodeWalkDir, not a copied formula",
      coverage: "OPEN until captured: adjacent input angles may collapse in Cartesian placement; no forced transition" };
    return ctx;
  }, ctx => ({ method: "encodeWalkDir+walkHintOf", direct: encodeWalkDir(ctx.recipe.angle), pathKernel: encodeWalkDir(ctx.recipe.actualPathAngle), hint: hint(ctx) })));
  for (const side of ["before", "equal", "after"]) cases.push(run("tie-" + side, "weaponTie", () => {
    const ctx = makeWorld(), w = ctx.world; put(w, "p0", 200, 200); equip(w, "p0", "sword");
    const at = w.state.serverTime + TICK_MS, edge = at + TIE_EPS_MS;
    const landsAt = side === "before" ? nextDown(edge) : side === "after" ? nextUp(edge) : edge;
    w.players.get("p0").weapon.action = { kind: "swing", weapon: "sword", startedAt: w.state.serverTime, landsAt, a: 0, packet: {} };
    ctx.recipe = { side, at, sourceTieEpsilon: TIE_EPS_MS, edge, landsAt, landsAtBits: floatBits(landsAt), rootUntil: 0 }; return ctx;
  }, ctx => ({ method: "weaponHoldsAt", observed: weaponHoldsAt(C(ctx.world, "p0"), ctx.recipe.at) })));
  return cases;
}
export function sourceInfo() {
  return Object.fromEntries(SOURCE_FILES.map(rel => {
    const b = readFileSync(join("/repo", rel)); return [rel, { bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") }];
  }));
}
