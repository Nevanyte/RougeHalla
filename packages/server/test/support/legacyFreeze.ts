// Frost's Wish is Frost Wall since 2026-11-04. Freeze (a unit-target stun) stays in the catalog, and the cast pipeline's unit-target
// tests are written with it: a file that calls this makes the Frost slot hold Freeze again for its own tests (vitest isolates each
// file's modules, and afterAll puts Frost Wall back).
import { afterAll, beforeAll } from "vitest";
import { WISHES, type AbilityId } from "@raid/shared";

export function useLegacyFreeze(): void {
  const wishes = WISHES as Record<string, AbilityId>;
  let was: AbilityId = "frostWall";
  beforeAll(() => { was = wishes.frost!; wishes.frost = "freeze"; });
  afterAll(() => { wishes.frost = was; });
}
