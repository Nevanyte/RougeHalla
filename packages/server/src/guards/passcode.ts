import { createHash, timingSafeEqual } from "node:crypto";
import { AddressWindowLimiter } from "./windowLimiter";

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

/** What a throttled attempt says. The client matches "wrong passcodes" in it (net/errors.ts); REST answers it with 429. */
export const PASSCODE_THROTTLED = "too many wrong passcodes from this connection: wait a minute and try again";

/** The window the failure counts below are taken over. */
export const PASSCODE_FAIL_WINDOW_MS = 60_000;

export type PasscodeVerdict = { ok: true } | { ok: false; blocked: boolean; retryAfterMs: number };

/**
 * The passcode check with a limit on wrong guesses, one gate for both doors (the profile route and matchmaking). Wrong
 * guesses are counted per client address and over the whole server; an address that has used up its guesses is refused
 * BEFORE the comparison, so a right guess past the limit tells it nothing. A right passcode costs nothing, and neither
 * does a request with no passcode in it. With no passcode set, or a limit of 0, nothing is counted.
 */
export class PasscodeGate {
  private readonly fails: AddressWindowLimiter;

  constructor(private readonly expected: string | undefined, perAddress: number, all: number, windowMs = PASSCODE_FAIL_WINDOW_MS) {
    this.fails = new AddressWindowLimiter(all, perAddress, windowMs);
  }

  check(given: unknown, address: string, now: number): PasscodeVerdict {
    if (this.expected === undefined) return { ok: true };
    const wait = this.fails.retryAfterMs(address, now);
    if (wait > 0) return { ok: false, blocked: true, retryAfterMs: wait };
    if (passcodeOk(given, this.expected)) return { ok: true };
    // Only a guess counts. A request that carries no passcode at all (a link without ?code=) guesses nothing.
    if (typeof given === "string") this.fails.record(address, now);
    return { ok: false, blocked: false, retryAfterMs: 0 };
  }
}
