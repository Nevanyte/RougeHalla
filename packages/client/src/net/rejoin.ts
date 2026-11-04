// Getting back into a run the connection lost (pure decisions and the seat's storage; main.ts drives them). The server keeps a dropped
// seat for RECONNECT_SECONDS, but only once it has noticed the drop, which for a silent client takes LIVENESS_TIMEOUT_MS plus a sweep.
// The SDK's own retries end at once when the server refuses the token ("not a seat in reconnection yet": close 4003), so the client
// keeps asking with the stored token until the grace is surely over.
import { LIVENESS_SWEEP_MS, LIVENESS_TIMEOUT_MS, RECONNECT_SECONDS } from "@raid/shared";

export const SEAT_KEY = "raidbr.seat.v1";

/** What a rejoin needs: whose seat it is and the room's reconnection token ("roomId:token", as `room.reconnectionToken` has it). */
export interface SeatRecord {
  profile: string;
  token: string;
}

/** From the moment the connection was lost: the server's noticing, its grace, and a margin for connecting through the proxy. */
export const REJOIN_WINDOW_MS = LIVENESS_TIMEOUT_MS + LIVENESS_SWEEP_MS + RECONNECT_SECONDS * 1000 + 3000;
/** The pause between two asks. */
export const REJOIN_RETRY_MS = 700;

type SeatStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** sessionStorage can throw (blocked site data) or be missing (tests): a seat that cannot be kept is simply not rejoined. */
function defaultStore(): SeatStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveSeat(seat: SeatRecord, store: SeatStore | null = defaultStore()): void {
  if (!store || !seat.token) return;
  try { store.setItem(SEAT_KEY, JSON.stringify(seat)); } catch { /* not remembered */ }
}

/** The stored seat, if there is one and (when `profile` is given) it is that callsign's. */
export function loadSeat(profile?: string, store: SeatStore | null = defaultStore()): SeatRecord | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SEAT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SeatRecord> | null;
    if (!v || typeof v.profile !== "string" || typeof v.token !== "string" || !v.token.includes(":")) return null;
    if (profile !== undefined && v.profile !== profile) return null;
    return { profile: v.profile, token: v.token };
  } catch {
    return null;
  }
}

export function clearSeat(store: SeatStore | null = defaultStore()): void {
  if (!store) return;
  try { store.removeItem(SEAT_KEY); } catch { /* nothing to forget */ }
}

/**
 * Closes that mean the connection broke, as opposed to a leave (4000) or a restart (4001): a seat may be waiting. 4002 is the server
 * closing a client for a burst of messages (or one it could not read); it holds the seat as for any drop (RaidRoom.onDrop: every code
 * but a consented leave is a drop), and an honest client's backlog after a stall of the link or of the server is exactly such a
 * burst (docs/NETWORK_INVESTIGATION_2026-11-04.md), so it is worth a short try (rejoinWindowFor).
 */
export function recoverableClose(code: number | undefined): boolean {
  return code === 1001 || code === 1005 || code === 1006 || code === 4002 || code === 4003 || code === 4010;
}

/** The server closed the socket itself (4002): it has seen the drop, so its seat is held now or never and a few tries settle it. */
export const SERVER_CLOSED_REJOIN_WINDOW_MS = 5000;

/** How long after the loss to keep asking: a close the server made settles quickly; the others wait out its noticing and its grace. */
export function rejoinWindowFor(code: number | undefined): number {
  return code === 4002 ? SERVER_CLOSED_REJOIN_WINDOW_MS : REJOIN_WINDOW_MS;
}

/** The room is gone for good (a token for it can never work again), so asking more is pointless. */
const GONE_RE = /room\b.*(?:not found|disposed)|no rooms found|invalid room/i;

/** How long to wait before the next ask, or null to give up: the window since `lostAt` is over, or the last failure was final. */
export function nextRejoinDelay(now: number, lostAt: number, lastError?: unknown, windowMs = REJOIN_WINDOW_MS): number | null {
  const text = lastError instanceof Error ? lastError.message : typeof lastError === "string" ? lastError : "";
  if (GONE_RE.test(text)) return null;
  return now + REJOIN_RETRY_MS > lostAt + windowMs ? null : REJOIN_RETRY_MS;
}

/** A refused join is "your profile still holds a seat" and this tab has that profile's seat: the token may now work. */
export function shouldRejoinOnBusy(busyRefusal: boolean, seat: SeatRecord | null, profile: string): boolean {
  return busyRefusal && seat !== null && seat.profile === profile;
}
