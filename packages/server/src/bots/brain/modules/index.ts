// The feature-module registry (docs/BOTS.md 8). A module (Wishes, planning, chests, skills, relics, hazards) registers itself
// here when its file is imported; the driver hands `enabledModules(features)` to each brain as `BrainConfig.modules`, and the
// brain calls only those. This file names no module: a module that needs a symbol the branch may lack reads it off Features,
// PerceptExtras and `ext` events, and takes its policy through `registerCastPolicy` (the Wishes adapter, once that branch lands).
import type { CastPolicy, FeatureModule, Features } from "../types";

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

/** `decideCast` of the Wishes branch, behind an opaque definition. The last one registered is the one used. */
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
