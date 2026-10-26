// Turns whatever a failed join, request or socket threw into one short, plain sentence for a player. The raw text (a
// stack, an SDK message, "[object Object]", a close code) never reaches the screen; callers keep it for console.error.
// An unrecognised failure reads as the generic line instead of echoing what it said.

export const UNREACHABLE_MESSAGE = "Can't reach the game server. Check your connection and try again.";
export const TIMEOUT_MESSAGE = "The game server took too long to answer. Please try again.";
export const SERVER_PROBLEM_MESSAGE = "The game server had a problem. Please try again in a moment.";
export const UNREADABLE_MESSAGE = "The server sent something this version of the game can't read. Reload the page and try again.";
const RATE_LIMIT_MESSAGE = "Too many attempts. Wait a moment and try again.";
const RESTARTING_MESSAGE = "The server is restarting. Try again in a moment.";
const NO_MODE_MESSAGE = "The server doesn't offer this game mode right now. Reload the page and try again.";
const GONE_MESSAGE = "That run is no longer available. Try again.";
const SEAT_EXPIRED_MESSAGE = "Your seat in the run expired before you connected. Try joining again.";
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";
export const CALLSIGN_BUSY_MESSAGE =
  "That callsign is still in a run (another tab, or your last run is still closing). Try again in a few seconds, or use another callsign.";
export const JOIN_CLOSED_MESSAGE = "The connection closed before you could join. Please try again.";
export const JOIN_SLOW_MESSAGE = "Joining is taking too long. Check your connection and try again.";

/** WebSocket close codes (1xxx) and Colyseus's own (4xxx), as the SDK reports them. */
const CLOSE_NORMAL = new Set([1000, 1001, 4000]);
const CLOSE_ABNORMAL = new Set([1005, 1006, 4010]);
const CLOSE_SERVER_SHUTDOWN = 4001;
const CLOSE_WITH_ERROR = 4002;
const CLOSE_FAILED_TO_RECONNECT = 4003;

/** Network failures as the browsers and Node word them: Chrome, Firefox, Safari, undici, sockets, the SDK's websocket. */
const NETWORK_RE = /failed to fetch|networkerror|network request failed|network error|load failed|fetch failed|econnrefused|enotfound|econnreset|eai_again|socket hang up|websocket|err_connection|err_internet|connection (?:refused|reset|closed)|could not connect|offline/i;
const TIMEOUT_RE = /timed? ?out|timeout|etimedout|took too long/i;

/** What a failure says, in the order a refusal is most likely to match: the server's own join refusals first. */
const MESSAGE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/already in a (?:raid|run)/i, CALLSIGN_BUSY_MESSAGE],
  [/room was just opened for this profile/i, "A room for this callsign was just opened. Wait a few seconds and try again."],
  [/(?:raid|run) already started/i, "That run has already started. Try again to join the next one."],
  [/invalid profile name|invalid callsign/i, "That callsign isn't valid. Use 2–16 letters, digits, _ or -."],
  [/unknown profile or bad token|bad token|profile belongs to someone else/i, "This callsign belongs to another device. Pick a different callsign."],
  [/seat reservation|reconnection token invalid or expired|reservation (?:expired|not found)/i, SEAT_EXPIRED_MESSAGE],
  [/room\b.*is locked|already full|room is full|no longer available/i, "That run is full or already underway. Try again to join another."],
  [/room\b.*(?:not found|disposed)|no rooms found/i, GONE_MESSAGE],
  [/shutting down|shutdown|maintenance|restarting|server is not accepting/i, RESTARTING_MESSAGE],
  [/provided room name.*not defined|no handler/i, NO_MODE_MESSAGE],
  [/too many requests|rate limit/i, RATE_LIMIT_MESSAGE],
];

interface Facts {
  message: string;
  name: string;
  code: number | string | undefined;
  status: number | undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const asCode = (v: unknown): number | string | undefined => (typeof v === "number" || typeof v === "string" ? v : undefined);

const NONE: Facts = { message: "", name: "", code: undefined, status: undefined };

/** The parts of a thrown value worth classifying; never throws, whatever it is handed. */
function factsOf(err: unknown): Facts {
  try {
    if (typeof err === "string") return { ...NONE, message: err };
    if (typeof err === "number") return { ...NONE, code: err };
    if (!isObject(err)) return NONE;
    const cause = isObject(err.cause) ? err.cause : undefined;
    return {
      message: typeof err.message === "string" ? err.message : "",
      name: typeof err.name === "string" ? err.name : "",
      // The SDK puts a Node network code (ECONNREFUSED) on the cause when fetch itself failed.
      code: asCode(err.code) ?? asCode(cause?.code),
      status: typeof err.status === "number" ? err.status : undefined,
    };
  } catch {
    // A getter that throws (a hostile or half-built object) is just an unknown failure.
    return NONE;
  }
}

/** Short, plain, never a stack or a raw code. */
export function friendlyError(err: unknown): string {
  const { message, name, code, status } = factsOf(err);

  // Failures the client raised itself already carry a player-facing sentence.
  if ((name === "ProfileError" || name === "ShopRequestError") && message) return message;

  for (const [re, text] of MESSAGE_RULES) if (re.test(message)) return text;

  if (typeof code === "string") {
    if (/^ETIMEDOUT$/i.test(code)) return TIMEOUT_MESSAGE;
    if (/^(?:ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)$/i.test(code)) return UNREACHABLE_MESSAGE;
  }
  // A gateway answering for a game server that is down ("Gateway Timeout" is not a slow answer).
  if (status === 502 || status === 503 || status === 504) return UNREACHABLE_MESSAGE;
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (name === "TimeoutError" || name === "AbortError" || TIMEOUT_RE.test(message)) return TIMEOUT_MESSAGE;
  if (NETWORK_RE.test(message)) return UNREACHABLE_MESSAGE;

  // The SDK's ServerError for a websocket that failed to open carries neither a code nor a reason.
  if (name === "ServerError" && !message && code === undefined && status === undefined) return UNREACHABLE_MESSAGE;

  if (typeof code === "number") {
    // A socket that closed or failed before the join finished (1005/1006) is a server we could not talk to.
    if (CLOSE_ABNORMAL.has(code)) return UNREACHABLE_MESSAGE;
    if (code === CLOSE_SERVER_SHUTDOWN) return RESTARTING_MESSAGE;
    if (CLOSE_NORMAL.has(code)) return JOIN_CLOSED_MESSAGE;
    if (code === 520) return NO_MODE_MESSAGE;
    if (code === 521 || code === 522) return GONE_MESSAGE;
    if (code === 523) return "The game server couldn't set up a run. Please try again in a moment.";
    if (code === 524) return SEAT_EXPIRED_MESSAGE;
    if (code === 525) return "The server wouldn't let you in. Reload the page and try again.";
    if (code === 4217) return "The server couldn't read that request. Reload the page and try again.";
  }

  const http = status ?? (typeof code === "number" && code >= 400 && code < 600 ? code : undefined);
  if (http === 429) return RATE_LIMIT_MESSAGE;
  if (http !== undefined && http >= 500) return SERVER_PROBLEM_MESSAGE;
  return GENERIC_MESSAGE;
}

/**
 * What a player reads after the connection to a room ended for good. `training` words it for the practice room.
 * The code stays out of the sentence (callers log it).
 */
export function friendlyClose(code: number | undefined, training = false): string {
  const where = training ? "training" : "the run";
  if (code === undefined || CLOSE_NORMAL.has(code)) return `Disconnected from ${where}.`;
  if (CLOSE_ABNORMAL.has(code)) return `Lost connection to ${where}. Check your connection and try again.`;
  if (code === CLOSE_SERVER_SHUTDOWN) return `The server is restarting, so ${where} ended.`;
  if (code === CLOSE_FAILED_TO_RECONNECT) return `Couldn't reconnect to ${where}. Check your connection and try again.`;
  if (code === CLOSE_WITH_ERROR) return `${training ? "Training" : "The run"} ended because of a server error.`;
  return `Disconnected from ${where}.`;
}
