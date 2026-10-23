// Profile REST client: GET /api/profile/:name claims a callsign (first time) or proves ownership of it (token header).
// The token is the only proof, so it lives in localStorage per callsign and never leaves this device otherwise.
import { PROFILE_TOKEN_HEADER, itemDef, type ItemDTO, type ProfileResponse } from "@raid/shared";
import { apiBase } from "./connection";

const TOKEN_KEY_PREFIX = "raid.token.";
const REQUEST_TIMEOUT_MS = 8000;
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

function isProfileResponse(v: unknown): v is ProfileResponse {
  const r = v as Partial<ProfileResponse> | null;
  return !!r && typeof r.token === "string" && !!r.profile && typeof r.profile.name === "string"
    && Array.isArray(r.profile.stash) && !!r.profile.stats;
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

/** Catalog value of one item; ids the catalog doesn't know (newer server content) count as 0. */
export function itemValue(defId: string): number {
  return itemDef(defId)?.value ?? 0;
}

export function totalValue(items: readonly ItemDTO[]): number {
  let sum = 0;
  for (const it of items) sum += itemValue(it.def);
  return sum;
}

export function formatValue(n: number): string {
  return n.toLocaleString("en-US");
}
