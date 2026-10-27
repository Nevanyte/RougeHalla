// The feature-module registry (docs/BOTS.md 8). A module (Wishes, planning, chests, skills, relics, hazards) is registered here;
// the driver hands `enabledModules(features)` to each brain as `BrainConfig.modules`, and the brain calls only those. A module
// that needs a symbol the branch may lack reads it off Features, PerceptExtras and `ext` events. The modules that are built are
// registered at the bottom of this file, so every caller of `enabledModules` gets them without naming them.
import type { CastPolicy, FeatureModule, Features } from "../types";
import { chestsModule } from "./chests";
import { planningModule } from "./planning";
import { wishesModule } from "./wishes";

const modules = new Map<string, FeatureModule>();
let castPolicy: CastPolicy | null = null;

/** Adds a module; registering an id again replaces the module and keeps its place in the order. */
export function registerModule(m: FeatureModule): void {
  modules.set(m.id, m);
}

/** The registered modules whose `enabled(features)` holds, in registration order. */
export function enabledModules(features: Features): readonly FeatureModule[] {
  const out: FeatureModule[] = [];
  for (const m of modules.values()) if (m.enabled(features)) out.push(m);
  return out;
}

/**
 * A cast policy behind an opaque definition, for a module that takes its policy from outside. The Wishes module calls the shared
 * `decideCast` itself (the one import outside the brain's folder, allowed by test/bots/boundary.test.ts) and does not read this.
 */
export function registerCastPolicy(p: CastPolicy): void {
  castPolicy = p;
}

export function getCastPolicy(): CastPolicy | null {
  return castPolicy;
}

/** Tests: forget every module and the cast policy. */
export function resetModules(): void {
  modules.clear();
  castPolicy = null;
}

registerModule(wishesModule);
registerModule(planningModule);
registerModule(chestsModule);
