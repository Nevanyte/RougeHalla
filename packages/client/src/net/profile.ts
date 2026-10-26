// Profile REST client: GET /api/profile/:name claims a callsign (first time) or proves ownership of it (token header).
// The token is the only proof, so it lives in localStorage per callsign and never leaves this device otherwise.
import {
  PASSCODE_HEADER, PROFILE_TOKEN_HEADER, SHOP_EQUIP_PATH, SHOP_PURCHASE_PATH,
  type EquipRequest, type LeaderboardEntry, type LeaderboardResponse, type ProfileDTO, type ProfileResponse,
  type PurchaseRequest, type ShopErrorCode,
} from "@raid/shared";
import { apiBase } from "./connection";
import {
  NEW_CALLSIGNS_MESSAGE, PASSCODE_MESSAGE, RATE_LIMIT_MESSAGE, SERVER_PROBLEM_MESSAGE, TIMEOUT_MESSAGE, UNREACHABLE_MESSAGE,
  UNREADABLE_MESSAGE,
} from "./errors";
import { readPasscode } from "./passcode";

const TOKEN_KEY_PREFIX = "raid.token.";
const REQUEST_TIMEOUT_MS = 8000;
/** The leaderboard is a garnish on the hub: give up on it sooner than on the profile. */
const LEADERBOARD_TIMEOUT_MS = 4000;

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

/**
 * A whole profile as the hub reads it (GV, stats, cosmetics, achievements and progress): a reply from an older server
 * fails the check and reads as unreadable instead of rendering half a hub or crashing a panel.
 */
function isProfileDTO(v: unknown): v is ProfileDTO {
  if (!isObject(v)) return false;
  const p = v as Partial<Record<keyof ProfileDTO, unknown>>;
  const { cosmetics, progress } = p;
  return typeof p.name === "string" && isNum(p.gv) && isNum(p.gvLifetime) && isObject(p.gvByMonth) && isObject(p.stats)
    && isObject(cosmetics) && Array.isArray(cosmetics.owned) && cosmetics.owned.every((id) => typeof id === "string")
    && isObject(cosmetics.equipped)
    && isObject(p.achievements)
    && isObject(progress) && isObject(progress.winsByFaction) && isObject(progress.winsByWeapon);
}

function isProfileResponse(v: unknown): v is ProfileResponse {
  const r = v as Partial<ProfileResponse> | null;
  return typeof r?.token === "string" && isProfileDTO(r.profile);
}

function isLeaderboardResponse(v: unknown): v is LeaderboardResponse {
  const r = v as Partial<LeaderboardResponse> | null;
  return !!r && typeof r.month === "string" && Array.isArray(r.entries)
    && r.entries.every((e: Partial<LeaderboardEntry> | null) =>
      !!e && typeof e.name === "string" && isNum(e.gv) && (e.title === undefined || typeof e.title === "string"))
    && Array.isArray(r.months) && r.months.every((m) => typeof m === "string")
    && (r.you === undefined || (isObject(r.you) && isNum(r.you.rank) && isNum(r.you.gv)));
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
  // Only a brand-new callsign needs it (the server asks for it then), but a known one can carry it as well.
  const passcode = readPasscode();
  if (passcode) headers[PASSCODE_HEADER] = passcode;

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/profile/${encodeURIComponent(name)}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ProfileError("unavailable", timedOut ? TIMEOUT_MESSAGE : UNREACHABLE_MESSAGE);
  }

  if (res.status === 403) throw new ProfileError("taken", "That callsign is taken (its token isn't on this device)");
  if (res.status === 400) throw new ProfileError("invalid", "Invalid callsign");
  if (res.status === 401) throw new ProfileError("unavailable", PASSCODE_MESSAGE);
  if (res.status === 429) throw new ProfileError("unavailable", NEW_CALLSIGNS_MESSAGE);
  // Vite's dev proxy (or any gateway) answers these when the game server behind it is down.
  if (res.status >= 502 && res.status <= 504) throw new ProfileError("unavailable", UNREACHABLE_MESSAGE);
  if (!res.ok) throw new ProfileError("unavailable", SERVER_PROBLEM_MESSAGE);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ProfileError("unavailable", UNREADABLE_MESSAGE);
  }
  if (!isProfileResponse(body)) throw new ProfileError("unavailable", UNREADABLE_MESSAGE);
  writeToken(name, body.token);
  return body;
}

/**
 * The top of a month's leaderboard, or null for any failure (unreachable, 404 from a server without the route, a bad
 * body): the hub shows the board only when there is one and never waits on it. `name` asks for that callsign's own
 * rank (`you`) as well; the server answers with it only when the request proves ownership, so the stored token goes in
 * the header (never the URL). Without a stored token the board still loads, just with no `you`.
 */
export async function fetchLeaderboard(month: string, limit: number, name?: string): Promise<LeaderboardResponse | null> {
  try {
    let query = `month=${encodeURIComponent(month)}&limit=${limit}`;
    const headers: Record<string, string> = {};
    if (name) {
      query += `&name=${encodeURIComponent(name)}`;
      const token = readToken(name);
      if (token) headers[PROFILE_TOKEN_HEADER] = token;
    }
    const res = await fetch(`${apiBase()}/api/leaderboard?${query}`, { headers, signal: AbortSignal.timeout(LEADERBOARD_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isLeaderboardResponse(body) ? body : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- shop and wardrobe

export type ShopRequestErrorCode = ShopErrorCode | "unavailable";

/** A shop or equip request that did not go through. `message` is player-facing; `need`/`have` come with insufficient_gv. */
export class ShopRequestError extends Error {
  constructor(readonly code: ShopRequestErrorCode, message: string, readonly need?: number, readonly have?: number) {
    super(message);
    this.name = "ShopRequestError";
  }
}

const SHOP_MESSAGES: Record<ShopErrorCode, string> = {
  forbidden: "This callsign's token isn't on this device",
  bad_request: "The server could not read that request",
  unknown_cosmetic: "That item doesn't exist",
  unknown_slot: "That slot doesn't exist",
  not_for_sale: "That item isn't for sale",
  already_owned: "You already own that",
  insufficient_gv: "Not enough GV",
  not_owned: "You don't own that yet",
  slot_mismatch: "That item doesn't go in that slot",
};

function isShopErrorCode(v: unknown): v is ShopErrorCode {
  return typeof v === "string" && Object.hasOwn(SHOP_MESSAGES, v);
}

/** `need` is the price and `have` the balance (see ShopError), so the shortfall is their difference. */
function shopMessage(code: ShopErrorCode, need?: number, have?: number): string {
  if (code === "insufficient_gv" && need !== undefined) {
    const missing = have === undefined ? need : need - have;
    if (missing > 0) return `Need ${formatNumber(missing)} more GV`;
  }
  return SHOP_MESSAGES[code];
}

async function shopFailure(res: Response): Promise<ShopRequestError> {
  if (res.status >= 502 && res.status <= 504) return new ShopRequestError("unavailable", UNREACHABLE_MESSAGE);
  if (res.status === 429) return new ShopRequestError("unavailable", RATE_LIMIT_MESSAGE);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (a gateway page, an empty body): the status alone decides below.
  }
  if (isObject(body) && isShopErrorCode(body.code)) {
    const need = isNum(body.need) ? body.need : undefined;
    const have = isNum(body.have) ? body.have : undefined;
    return new ShopRequestError(body.code, shopMessage(body.code, need, have), need, have);
  }
  if (res.status === 403) return new ShopRequestError("forbidden", SHOP_MESSAGES.forbidden);
  if (res.status === 400 || res.status === 413 || res.status === 415) return new ShopRequestError("bad_request", SHOP_MESSAGES.bad_request);
  return new ShopRequestError("unavailable", SERVER_PROBLEM_MESSAGE);
}

/** POSTs a JSON body with the callsign's token. Only the profile the server answers with is ever believed. */
async function postShop(name: string, path: string, body: PurchaseRequest | EquipRequest): Promise<ProfileDTO> {
  const token = readToken(name);
  if (!token) throw new ShopRequestError("forbidden", SHOP_MESSAGES.forbidden);

  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [PROFILE_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ShopRequestError("unavailable", timedOut ? TIMEOUT_MESSAGE : UNREACHABLE_MESSAGE);
  }
  if (!res.ok) throw await shopFailure(res);

  let reply: unknown;
  try {
    reply = await res.json();
  } catch {
    throw new ShopRequestError("unavailable", UNREADABLE_MESSAGE);
  }
  const profile = isObject(reply) ? reply.profile : undefined;
  if (!isProfileDTO(profile)) throw new ShopRequestError("unavailable", UNREADABLE_MESSAGE);
  return profile;
}

/** Spends the cosmetic's price. Resolves with the server's updated profile; rejects with a ShopRequestError. */
export function purchaseCosmetic(name: string, id: string): Promise<ProfileDTO> {
  return postShop(name, SHOP_PURCHASE_PATH(name), { id });
}

/** Puts the owned cosmetic `id` on in `slot`, or takes the slot off with `null`. Resolves like purchaseCosmetic. */
export function equipCosmetic(name: string, slot: string, id: string | null): Promise<ProfileDTO> {
  return postShop(name, SHOP_EQUIP_PATH(name), { slot, id });
}

export function formatNumber(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US");
}
