// P15 compiled-control definitions. CODE-ONLY, NOT EXECUTED. A future Root-approved control build may
// apply exactly one mutation to actual source, compile it, and require the semantic verifier to fail.
export const P15_CONTROLS = Object.freeze([
  {
    id: "remote-lower-guard", kind: "semantic", file: "packages/server/src/bots/brain/perception.ts",
    find: "left > 0 && left <= 1500", replace: "left > 0 && left < 1500",
    requiredSemantic: "P0 lower remote-immunity sample must stop being protected",
  },
  {
    id: "remote-upper-guard", kind: "semantic", file: "packages/server/src/bots/brain/perception.ts",
    find: "left > 0 && left <= 1500", replace: "left >= 0 && left <= 1500",
    requiredSemantic: "P0 before/expired remote sample must stop matching the guard",
  },
  {
    id: "teleport-immunity", kind: "semantic", file: "packages/server/src/sim/arena.ts",
    find: "p.immuneUntil = now + TELEPORT_IMMUNITY_MS;", replace: "p.immuneUntil = 0;",
    requiredSemantic: "P0 positive owner deadline / protection guard is removed",
  },
  {
    id: "preserve-ranged-cancel", kind: "semantic", file: "packages/server/src/sim/step.ts",
    find: "cancelLockedWindup(world, c, true)", replace: "cancelLockedWindup(world, c, false)",
    requiredSemantic: "W1/W2 Stop/Move must cancel the real Wand cast instead of preserving it",
  },
  {
    id: "different-target-cancel", kind: "semantic", file: "packages/server/src/sim/targeting.ts",
    find: "if (w.action?.target !== t.id) cancelLockedWindup(world, c);", replace: "if (w.action?.target !== t.id) {}",
    requiredSemantic: "W0 retarget must not emit the actual cancel/observer feint",
  },
  {
    id: "bow-stagger-exclusion", kind: "semantic", file: "packages/server/src/sim/weapons.ts",
    find: "if (w.action && w.action.kind !== \"draw\") {", replace: "if (w.action) {",
    requiredSemantic: "B2 Bow draw must be canceled by the paid Sword stagger (surviving Arrow lost)",
  },
  {
    id: "comment-provenance", kind: "provenance-only", file: "packages/server/src/sim/arena.ts",
    find: "export function teleportToColiseum(world: World): void {", replace: "export function teleportToColiseum(world: World): void { // provenance-only control",
    requiredSemantic: "NON-KILL: functional outputs unchanged while executed source provenance changes",
  },
]);
export function controlPlan() {
  return P15_CONTROLS.map((c) => ({ id: c.id, kind: c.kind, file: c.file, mutation: { find: c.find, replace: c.replace }, requiredSemantic: c.requiredSemantic, status: "DEFINED_NOT_RUN" }));
}
