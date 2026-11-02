// The join-time check that a page was built against the contract this server speaks (JoinOptions.build). It only ever lets a join
// through or refuses it: the value is compared and dropped, and nothing in the game reads it.

/**
 * Whether a join may go on. True when the server requires no build, or the join names none (a bot, the harness, a dev build, a
 * page older than this field: they cannot be told apart, and only an id that is there and wrong is evidence of a stale decoder).
 * A join that names something else, of any type, is refused.
 */
export function clientBuildAllowed(required: string | undefined, given: unknown): boolean {
  if (required === undefined || given === undefined || given === null) return true;
  return given === required;
}

const LOG_EVERY_MS = 10_000;
let loggedAt = -Infinity;

/** One line to the log per LOG_EVERY_MS for refused joins (a deploy can send a whole lobby of them), the ids cut short. */
export function noteStaleClient(required: string, given: unknown, now = Date.now()): void {
  if (now - loggedAt < LOG_EVERY_MS) return;
  loggedAt = now;
  const shown = typeof given === "string" ? given.slice(0, 12) : typeof given;
  console.warn(`[join] refused a stale page: build ${shown} (this server speaks ${required.slice(0, 12)})`);
}
