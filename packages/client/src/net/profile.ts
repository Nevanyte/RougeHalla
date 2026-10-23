// Profile REST client: GET /api/profile/:name claims a callsign (first time) or proves ownership of it (token header).
// The token is the only proof, so it lives in localStorage per callsign and never leaves this device otherwise.
import { PROFILE_TOKEN_HEADER, type LeaderboardEntry, type LeaderboardResponse, type ProfileDTO, type ProfileResponse } from "@raid/shared";
import { apiBase } from "./connection";

const TOKEN_KEY_PREFIX = "raid.token.";
const REQUEST_TIMEOUT_MS = 8000;
/** The leaderboard is a garnish on the hub: give up on it sooner than on the profile. */
const LEADERBOARD_TIMEOUT_MS = 4000;
const UNREACHABLE = "Can't reach the server";

export type ProfileErrorKind = "taken" | "invalid" | "unavailable";

/** A failure the menu can show verbatim (`message` is player-facing). */
export class ProfileError extends Error {
  constructor(readonly kind: ProfileErrorKind, message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

// Storage can be missing or throw (private mode, blocked cookies); the profile then just can't be re-proved next visit.
function readToken(name: string): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY_PREFIX + name);
  } catch {
    return null;
  }
}

function writeToken(name: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY_PREFIX + name, token);
  } catch {
    // Ignored: see readToken.
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The v2 shape (GV, stats, cosmetics): an older server's reply fails the check and reads as unreadable instead of rendering half a hub. */
function isProfileResponse(v: unknown): v is ProfileResponse {
  const r = v as Partial<ProfileResponse> | null;
  const p: Partial<ProfileDTO> | undefined = r?.profile;
  return typeof r?.token === "string" && !!p && typeof p.name === "string"
    && isNum(p.gv) && isNum(p.gvLifetime) && isObject(p.gvByMonth) && isObject(p.stats)
    && isObject(p.cosmetics) && Array.isArray(p.cosmetics.owned);
}

function isLeaderboardResponse(v: unknown): v is LeaderboardResponse {
  const r = v as Partial<LeaderboardResponse> | null;
  return !!r && typeof r.month === "string" && Array.isArray(r.entries)
    && r.entries.every((e: Partial<LeaderboardEntry> | null) => !!e && typeof e.name === "string" && isNum(e.gv));
}

const inFlight = new Map<string, Promise<ProfileResponse>>();

/**
 * One request per callsign at a time. A not-yet-claimed name sends no token, so a second concurrent GET would lose
 * the claim race to the first and be refused as "taken" even though the name is the player's own.
 */
export function fetchProfile(name: string): Promise<ProfileResponse> {
  const pending = inFlight.get(name);
  if (pending) return pending;
  const request: Promise<ProfileResponse> = requestProfile(name).finally(() => {
    if (inFlight.get(name) === request) inFlight.delete(name);
  });
  inFlight.set(name, request);
  return request;
}

async function requestProfile(name: string): Promise<ProfileResponse> {
  const headers: Record<string, string> = {};
  const token = readToken(name);
  if (token) headers[PROFILE_TOKEN_HEADER] = token;

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/profile/${encodeURIComponent(name)}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ProfileError("unavailable", timedOut ? "The server took too long to answer" : UNREACHABLE);
  }

  if (res.status === 403) throw new ProfileError("taken", "That callsign is taken (its token isn't on this device)");
  if (res.status === 400) throw new ProfileError("invalid", "Invalid callsign");
  // Vite's dev proxy (or any gateway) answers these when the game server behind it is down.
  if (res.status >= 502 && res.status <= 504) throw new ProfileError("unavailable", UNREACHABLE);
  if (!res.ok) throw new ProfileError("unavailable", `Server error (HTTP ${res.status})`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ProfileError("unavailable", "The server sent an unreadable profile");
  }
  if (!isProfileResponse(body)) throw new ProfileError("unavailable", "The server sent an unreadable profile");
  writeToken(name, body.token);
  return body;
}

/**
 * The top of a month's leaderboard, or null for any failure (unreachable, 404 from a server without the route, a bad
 * body): the hub shows the board only when there is one and never waits on it.
 */
export async function fetchLeaderboard(month: string, limit: number): Promise<LeaderboardResponse | null> {
  try {
    const query = `month=${encodeURIComponent(month)}&limit=${limit}`;
    const res = await fetch(`${apiBase()}/api/leaderboard?${query}`, { signal: AbortSignal.timeout(LEADERBOARD_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isLeaderboardResponse(body) ? body : null;
  } catch {
    return null;
  }
}

export function formatNumber(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}
