// Declarative future controls ONLY: no imports, builds, source writes or execution.
// Anchors are exact/unique in sourceBase bb564d3b. A future separately approved
// variant must bind its executed bytes and reach its intended producer assertion.
// A compile/envelope/provenance refusal is never counted as a semantic kill.
export const P15_CONTROLS = Object.freeze([
  Object.freeze({
    id: "teleport-immunity", kind: "semantic", file: "packages/server/src/sim/arena.ts", expectedMatches: 1,
    find: "p.immuneUntil = now + TELEPORT_IMMUNITY_MS;", replace: "p.immuneUntil = 0;",
    cases: ["P0", "P1"], requiredSemantic: "positive produced owner deadline/protected paid-hit gate disappears",
  }),
  Object.freeze({
    id: "remote-lower-guard", kind: "semantic", file: "packages/server/src/bots/brain/perception.ts", expectedMatches: 1,
    find: "immune: until > 0 && left > 0 && left <= TELEPORT_IMMUNITY_MS,",
    replace: "immune: until > 0 && left >= 0 && left <= TELEPORT_IMMUNITY_MS,",
    cases: ["P0"], requiredSemantic: "remote exact-expiry left0 at U+100 wrongly remains true",
  }),
  Object.freeze({
    id: "remote-upper-guard", kind: "semantic", file: "packages/server/src/bots/brain/perception.ts", expectedMatches: 1,
    find: "immune: until > 0 && left > 0 && left <= TELEPORT_IMMUNITY_MS,",
    replace: "immune: until > 0 && left > 0,",
    cases: ["P0"], requiredSemantic: "immediate T/T+50 remote sample wrongly becomes true before source100ms guard",
  }),
  Object.freeze({
    id: "preserve-ranged-cancel", kind: "semantic", file: "packages/server/src/sim/step.ts", expectedMatches: 1,
    find: "cancelLockedWindup(world, c, true);", replace: "cancelLockedWindup(world, c, false);",
    cases: ["W1", "W2"], requiredSemantic: "queued Stop/Move cancels genuinely pending ranged cast, losing its positive committed launch",
  }),
  Object.freeze({
    id: "different-target-cancel", kind: "semantic", file: "packages/server/src/sim/targeting.ts", expectedMatches: 1,
    find: "if (w.action?.target !== t.id) cancelLockedWindup(world, c);",
    replace: "if (w.action?.target !== t.id) { /* control: cancellation removed */ }",
    cases: ["W0"], requiredSemantic: "retarget cancel/real observer feint disappears; later swap/no-Ball alone cannot count",
  }),
  Object.freeze({
    id: "bow-stagger-exclusion", kind: "semantic", file: "packages/server/src/sim/weapons.ts", expectedMatches: 1,
    find: "if (w.action && w.action.kind !== \"draw\") {", replace: "if (w.action) {",
    cases: ["B2"], requiredSemantic: "positive paid Sword hit cancels real Bow draw, losing its surviving Arrow and changing stagger",
  }),
]);
export const COMMENT_NONKILL = Object.freeze({
  id: "comment-provenance", kind: "comment-nonkill", file: "packages/server/src/sim/arena.ts", expectedMatches: 1,
  find: "export function teleportToColiseum(world: World): void {",
  replace: "export function teleportToColiseum(world: World): void { // control: comment-only nonkill",
  requiredSemantic: "functional observations stay equal while executed original/comment provenance changes; NOT a killed mutant",
});
export function controlPlan() {
  return {
    semantic: P15_CONTROLS.map(c => ({ ...c, status: "DEFINED_NOT_RUN" })),
    commentNonkill: { ...COMMENT_NONKILL, status: "DEFINED_NOT_RUN" },
    compileOrProvenanceRefusalCountsAsKill: false,
    runtimeAndFrozenExecution: "HELD_FOR_SEPARATE_ROOT_APPROVAL",
  };
}
