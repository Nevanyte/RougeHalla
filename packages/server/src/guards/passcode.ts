import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether `given` is the playtest passcode. Both sides are hashed first so the comparison takes the same time whatever
 * the two lengths are and wherever they differ. Nothing set (`expected` undefined) means no passcode: everyone passes.
 */
export function passcodeOk(given: unknown, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** What a refusal says. The client matches "passcode" in it and shows its own plain sentence (net/errors.ts). */
export const PASSCODE_REQUIRED = "this playtest needs a passcode";
