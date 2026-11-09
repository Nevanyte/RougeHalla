// Declared actual-source helper contexts for the seven OPEN boundary decisions. Inputs are explicit
// helper state; observed values come from actual imported walkHintOf / isUntargetableAt / shared decide.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  mapFromTiles, mulberry32, decide, lockSpacing, PLAYER_SPEED, TICK_MS, TARGET_LOS_GRACE_MS,
  TARGET_REPATH_MS, TERRAIN_ICE,
} from "@raid/shared";
import { createGameWorld } from "/repo/packages/server/src/sim/gameplay.ts";
import { addPlayer, step } from "/repo/packages/server/src/sim/step.ts";
import { addStatus, isUntargetableAt } from "/repo/packages/server/src/sim/status.ts";
import { combatant, timingsOf } from "/repo/packages/server/src/sim/combatant.ts";
import { walkHintOf } from "/repo/packages/server/src/sim/walkHint.ts";
import { GOAL_MOVED } from "/repo/packages/server/src/sim/targeting.ts";

const W = 64, H = 40, SEED = 7;
const BASE = {
  minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 1e6, patienceMinSeconds: 1e6,
  suddenDeathSeconds: 1e6, planSeconds: 0, firstPatienceSeconds: 0, pvpRules: false, wishLockSeconds: 0,
};
const SOURCE_FILES = [
  "packages/server/src/sim/walkHint.ts",
  "packages/server/src/sim/gameplay.ts",
  "packages/server/src/sim/step.ts",
  "packages/server/src/sim/status.ts",
  "packages/server/src/sim/targeting.ts",
  "packages/server/src/sim/combatant.ts",
  "packages/server/src/sim/movement.ts",
  "packages/server/src/sim/world.ts",
  "packages/shared/src/constants.ts",
  "packages/shared/src/mods.ts",
  "packages/shared/src/weapons.ts",
  "packages/shared/src/policies.ts",
  "packages/shared/src/terrain.ts",
];
function sha(s) { return createHash("sha256").update(s).digest("hex"); }
const at = (tx, ty) => ({ x: tx * 32 + 16, y: ty * 32 + 16 });
function makeWorld(opts = {}) {
  const tiles = new Uint8Array(W * H).fill(0);
  const terrain = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) tiles[y * W + x] = 1;
  for (const [x, y] of opts.wall ?? []) tiles[y * W + x] = 1;
  for (const [x, y] of opts.ice ?? []) terrain[y * W + x] = TERRAIN_ICE;
  const map = mapFromTiles(W, H, tiles, 0, terrain); map.spawns = [at(5, 5), at(10, 5), at(5, 8)];
  let draws = 0; const rnd = mulberry32(SEED);
  const world = createGameWorld({ map, seed: 0, random: () => { draws++; return rnd(); }, config: { ...BASE, minPlayers: opts.players ?? 1 }, newItemUid: (() => { let n = 0; return () => "u" + (n++); })() }, { walkHints: true });
  for (let i = 0; i < (opts.players ?? 1); i++) addPlayer(world, "p" + i, "boundary-p" + i, { faction: i === 0 ? "holy" : "frost" });
  step(world, TICK_MS); world.events = [];
  return { world, draws: () => draws };
}
function put(world, id, x, y) {
  const p = world.state.players.get(id), rt = world.players.get(id);
  p.x = x; p.y = y; p.status = "alive"; rt.path = []; rt.slip = null;
  rt.history = [{ t: world.state.serverTime, x, y }]; p.extra.walkTicks = 0; p.extra.walkDir = 0;
}
function equip(world, id, weapon) {
  const p = world.state.players.get(id); p.weapon0 = weapon; p.weapon1 = ""; p.slot = 0;
  const rt = world.players.get(id); rt.weapon.action = null; rt.weapon.rootUntil = 0; rt.weapon.held = false; rt.weapon.bufferedUntil = 0;
  rt.weapon.lock = null; rt.weapon.lockSeen = false; rt.weapon.lockLosLostAt = 0; rt.weapon.lockPlanAt = -Infinity;
  rt.weapon.lockGoal = null; rt.weapon.attackMoveGoal = null;
}
const C = (world, id) => combatant(world, id);
function run(id, decision, setup, observe) {
  try { const ctx = setup(); ctx.world.events = []; const d = ctx.draws(); const observed = observe(ctx); return { id, decision, helper: true, input: ctx.facts, observed, events: ctx.world.events.slice(), draws: ctx.draws() - d }; }
  catch (error) { return { id, decision, helper: true, error: String(error) }; }
}
function hintObserve(ctx) { const h = walkHintOf(ctx.world, C(ctx.world, "p0")); return { method: "walkHintOf", hint: { dir: h.dir, ticks: h.ticks } }; }
function lockBase(ctx, opts = {}) {
  const w = ctx.world; put(w, "p0", 200, 200); put(w, "p1", 400, 200); equip(w, "p0", "wand");
  w.players.get("p0").path = [{ x: 250, y: 200 }]; w.state.players.get("p0").readyAt = 0;
  const p = w.state.players.get("p0"), t = w.state.players.get("p1");
  t.history = [{ t: w.state.serverTime, x: 400, y: 200 }];
  const tm = timingsOf(p, "wand");
  const out = decide({ self: { x: p.x, y: p.y }, target: { x: t.x, y: t.y }, targetVel: { x: 0, y: 0 }, los: true, weapon: "wand", ready: true, windup: tm.windup, spacing: lockSpacing("wand") });
  if (!out.move) throw new Error("declared lock target did not produce a policy move goal");
  const rt = w.players.get("p0"); rt.weapon.lock = "p1"; rt.weapon.lockSeen = true; rt.weapon.lockLosLostAt = 0;
  rt.weapon.lockPlanAt = opts.planAt ?? w.state.serverTime - 200;
  rt.weapon.lockGoal = opts.lockGoal ?? { x: out.move.x, y: out.move.y };
  return { ...ctx, facts: { ...(opts.facts ?? {}), policyGoal: out.move, lockGoal: rt.weapon.lockGoal, planAt: rt.weapon.lockPlanAt === -Infinity ? "-Infinity" : rt.weapon.lockPlanAt } };
}
export function runBoundaries() {
  const cases = [];
  // 1. goal movement threshold 8: adjacent below/equal/above around the policy goal, plan boundary fixed at 250.
  const deltas = [
    { id: "goal-below8", delta: 8 - Math.pow(2, -50) },
    { id: "goal-equal8", delta: 8 },
    { id: "goal-above8", delta: 8 + Math.pow(2, -49) },
  ];
  for (const d of deltas) cases.push(run(d.id, "goal8", () => {
    const ctx = makeWorld({ players: 2 }); const base = lockBase(ctx);
    const g = base.facts.policyGoal; base.world.players.get("p0").weapon.lockGoal = { x: g.x + d.delta, y: g.y };
    return { ...base, facts: { ...base.facts, goalDelta: d.delta, lockGoal: { x: g.x + d.delta, y: g.y } } };
  }, hintObserve));
  // 2. repath 250 equality plus fresh -Infinity.
  const plans = [
    { id: "repath-just-before", value: 250 - 1e-9 },
    { id: "repath-equal", value: 250 },
    { id: "repath-just-after", value: 250 + 1e-9 },
  ];
  for (const p of plans) cases.push(run(p.id, "repath250", () => {
    const ctx = makeWorld({ players: 2 }); const base = lockBase(ctx);
    const atNow = ctx.world.state.serverTime + TICK_MS; // lock_next's at
    const now = ctx.world.state.serverTime;
    ctx.world.players.get("p0").weapon.lockPlanAt = atNow - p.value;
    return { ...base, facts: { ...base.facts, at: "now+50", planAt: "at-" + p.value, planDistance: p.value } };
  }, hintObserve));
  cases.push(run("repath-fresh-infinity", "repath250", () => {
    const ctx = makeWorld({ players: 2 }); const base = lockBase(ctx);
    ctx.world.players.get("p0").weapon.lockPlanAt = -Infinity;
    return { ...base, facts: { ...base.facts, planAtNonfinite: "-Infinity", planAt: null } };
  }, hintObserve));
  // 3. LOS grace expiry: wall blocks sight; last-visible bookkeeping fixed; at boundary ±.
  for (const d of [
    { id: "los-just-before", offset: -1e-9 },
    { id: "los-equal", offset: 0 },
    { id: "los-just-after", offset: 1e-9 },
  ]) cases.push(run(d.id, "losGrace", () => {
    const ctx = makeWorld({ players: 2, wall: [[9, 4], [9, 5], [9, 6], [9, 7], [9, 8], [9, 9]] }); const base = lockBase(ctx);
    const atNow = ctx.world.state.serverTime + TICK_MS;
    const lostAt = atNow - TARGET_LOS_GRACE_MS - d.offset;
    ctx.world.players.get("p0").weapon.lockLosLostAt = lostAt;
    return { ...base, facts: { ...base.facts, wallBetween: true, lockSeen: true, lostAt: "at-" + TARGET_LOS_GRACE_MS + (d.offset >= 0 ? "+" : "") + d.offset } };
  }, hintObserve));
  // 4. future visibility direct actual status endpoints.
  function futureAt(id, statusKind, setupStatus, offset) {
    cases.push(run(id, "futureVisibility", () => {
      const ctx = makeWorld({ players: 2 }); put(ctx.world, "p0", 200, 200); put(ctx.world, "p1", 400, 200);
      const now = ctx.world.state.serverTime; const c = C(ctx.world, "p1");
      const inst = addStatus(ctx.world, c, setupStatus);
      const extra = statusKind === "hidden" && id.includes("revealed") ? { revealFrom: now + 20, revealUntil: now + 100 } : null;
      if (extra) { inst.revealFrom = extra.revealFrom; inst.revealUntil = extra.revealUntil; }
      return { ...ctx, facts: { status: statusKind, at: "now+" + offset, revealFrom: extra ? "now+20" : null, revealUntil: extra ? "now+100" : null }, c, atNow: now + offset };
    }, (ctx) => ({ method: "isUntargetableAt", at: ctx.facts.at, observed: isUntargetableAt(ctx.c, ctx.atNow) })));
  }
  futureAt("future-hidden-active", "hidden", { kind: "hidden", source: { id: "h", name: "h" }, ms: 5000 }, 50);
  futureAt("future-hidden-revealed", "hidden", { kind: "hidden", source: { id: "h", name: "h" }, ms: 5000 }, 50);
  futureAt("future-untargetable-before", "untargetable", { kind: "untargetable", source: { id: "h", name: "h" }, ms: 50 }, 49);
  futureAt("future-untargetable-equal", "untargetable", { kind: "untargetable", source: { id: "h", name: "h" }, ms: 50 }, 50);
  // 5. attack-move ordering: actual player roster order p1 then p2, fixed states.
  function amoveCase(id, p1Status, p1At, p2At) {
    cases.push(run(id, "amoveOrder", () => {
      const ctx = makeWorld({ players: 3 }); put(ctx.world, "p0", 200, 200); put(ctx.world, "p1", p1At, 200); put(ctx.world, "p2", p2At, 200); equip(ctx.world, "p0", "wand");
      ctx.world.players.get("p0").path = [{ x: 250, y: 200 }]; ctx.world.players.get("p0").weapon.attackMoveGoal = { x: 250, y: 200 };
      if (p1Status === "hidden") addStatus(ctx.world, C(ctx.world, "p1"), { kind: "hidden", source: { id: "h", name: "h" }, ms: 5000 });
      if (p2Status === "hidden") addStatus(ctx.world, C(ctx.world, "p2"), { kind: "hidden", source: { id: "h", name: "h" }, ms: 5000 });
      return { ...ctx, facts: { candidateOrder: ["p1", "p2"], p1: { x: p1At, status: p1Status }, p2: { x: p2At, status: p2Status }, chosenTargetExposed: false } };
    }, hintObserve));
  }
  amoveCase("amove-hidden-first", "hidden", 400, 300);
  amoveCase("amove-visible-first-hidden-second", undefined, 400, 300);
  amoveCase("amove-first-out-of-range-second-near", undefined, 900, 300);
  amoveCase("amove-both-visible", undefined, 300, 400);
  // 6. waypoint 1e-6 slack around the actual source step with mUpper=1.01 (declared input construction).
  const step = (PLAYER_SPEED * 1.01 * TICK_MS) / 1000;
  const L = 3 * step;
  for (const d of [
    { id: "waypoint-below-1e-6", len: L - 1e-6 },
    { id: "waypoint-equal", len: L },
    { id: "waypoint-above-1e-6", len: L + 1e-6 },
  ]) cases.push(run(d.id, "waypoint1e-6", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); ctx.world.players.get("p0").path = [{ x: 200 + d.len, y: 200 }];
    return { ...ctx, facts: { segmentLength: d.len, boundary: "3*PLAYER_SPEED*1.01*TICK_MS/1000", plusMinus: 1e-6 } };
  }, hintObserve));
  // 7. adjacent representable directions at the existing negative half-byte case.
  const theta = -Math.PI / 256;
  for (const d of [
    { id: "direction-below-half-byte", a: theta - 1e-16 },
    { id: "direction-at-half-byte", a: theta },
    { id: "direction-above-half-byte", a: theta + 1e-16 },
  ]) cases.push(run(d.id, "directionRounding", () => {
    const ctx = makeWorld(); put(ctx.world, "p0", 200, 200); ctx.world.players.get("p0").path = [{ x: 200 + Math.cos(d.a) * 100, y: 200 + Math.sin(d.a) * 100 }];
    return { ...ctx, facts: { angle: d.a, halfByteCase: "negative -PI/256" } };
  }, hintObserve));
  return cases;
}
export function assertBoundaryFacts(corpus) {
  const fail = (m) => { throw new Error(m); };
  if (!corpus || corpus.format !== "rh-walk-hint-helper-boundaries/1") fail("wrong boundary format");
  const by = Object.fromEntries(corpus.cases.map((c) => [c.id, c]));
  const get = (id) => { const c = by[id]; if (!c) fail("missing " + id); if (c.error) fail(id + " errored: " + c.error); return c; };
  const h = (id) => { const o = get(id).observed; if (!o.hint) fail("no hint " + id); return o.hint; };
  // actual source output relations: the three adjacent goal deltas straddle the replan branch.
  const gb = h("goal-below8"), ge = h("goal-equal8"), ga = h("goal-above8");
  if (!(gb.ticks === 1 && ge.ticks === 1 && ga.ticks === 0)) fail("goal8 boundary not observed: " + [gb.ticks, ge.ticks, ga.ticks]);
  const rb = h("repath-just-before"), re = h("repath-equal"), ra = h("repath-just-after"), rf = h("repath-fresh-infinity");
  if (!(rb.ticks === 1 && re.ticks === 0 && ra.ticks === 0 && rf.ticks === 1)) fail("repath250 boundary not observed: " + [rb.ticks, re.ticks, ra.ticks, rf.ticks]);
  const lb = h("los-just-before"), le = h("los-equal"), la = h("los-just-after");
  if (!(lb.ticks === 1 && le.ticks === 0 && la.ticks === 0)) fail("LOS grace boundary not observed: " + [lb.ticks, le.ticks, la.ticks]);
  const fh = get("future-hidden-active").observed.observed;
  const fr = get("future-hidden-revealed").observed.observed;
  if (!(fh === true && fr === false)) fail("future hidden endpoint not observed: " + [fh, fr]);
  const ub = get("future-untargetable-before").observed.observed, ue = get("future-untargetable-equal").observed.observed;
  if (!(ub === true && ue === false)) fail("future untargetable endpoint not observed: " + [ub, ue]);
  if (h("amove-hidden-first").ticks !== 0 || h("amove-first-out-of-range-second-near").ticks !== 0) fail("amove ordering fallback not observed");
  const wb = h("waypoint-below-1e-6"), we = h("waypoint-equal"), wa = h("waypoint-above-1e-6");
  if (!(wb.ticks === 2 && we.ticks === 3 && wa.ticks === 3)) fail("waypoint 1e-6 boundary not observed: " + [wb.ticks, we.ticks, wa.ticks]);
  const db = h("direction-below-half-byte").dir, de = h("direction-at-half-byte").dir, da = h("direction-above-half-byte").dir;
  if (!(db !== de || de !== da)) fail("direction adjacent rounding did not produce any observed transition");
}
export function sourceInfo() {
  const files = {};
  for (const rel of SOURCE_FILES) { const s = readFileSync(join("/repo", rel), "utf8"); files[rel] = { bytes: Buffer.byteLength(s), sha256: sha(s) }; }
  return files;
}