import { LOBBY_SNAPSHOT_PATH, type LobbySnapshot } from "@raid/shared";

/** The public snapshot can be answered without the game process only for its read methods. */
export function isLobbySnapshotRequest(request: Request): boolean {
  return new URL(request.url).pathname === LOBBY_SNAPSHOT_PATH && (request.method === "GET" || request.method === "HEAD");
}

/** Only stopped snapshots take the fast path; running and starting processes must pass readiness. */
export async function coldLobbySnapshotOrContinue(
  request: Request,
  containerRunning: boolean,
  startupInProgress: boolean,
  arenaLimit: number,
  continueThroughReadiness: () => Promise<Response>,
  onColdSnapshot: () => void = () => {},
): Promise<Response> {
  if (isLobbySnapshotRequest(request) && !containerRunning && !startupInProgress) {
    onColdSnapshot();
    return coldLobbySnapshotResponse(request, arenaLimit);
  }
  return continueThroughReadiness();
}

/** The memo is safe only after the server confirms every public lobby list and count is empty. */
export async function confirmsEmptyLobbySnapshot(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const value: unknown = await response.clone().json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const snapshot = value as Record<string, unknown>;
    return snapshot.activeGame === null && Array.isArray(snapshot.waiting) && snapshot.waiting.length === 0
      && snapshot.onlineCount === 0 && snapshot.arenaRoomCount === 0;
  } catch {
    return false;
  }
}

/** A later room or lease request invalidates an in-flight empty response before it can populate the memo. */
export async function confirmsEmptyLobbySnapshotAtGeneration(
  response: Response,
  requestGeneration: number,
  currentGeneration: () => number,
): Promise<boolean> {
  if (requestGeneration !== currentGeneration()) return false;
  const empty = await confirmsEmptyLobbySnapshot(response);
  return empty && requestGeneration === currentGeneration();
}

/** A stopped game has no rooms or live leases; advertise an empty, available lobby without starting it. */
export function coldLobbySnapshotResponse(request: Request, arenaLimit: number, now = Date.now()): Response {
  const snapshot: LobbySnapshot = {
    serverNow: now,
    activeGame: null,
    waiting: [],
    onlineCount: 0,
    arenaLimit: arenaLimit > 0 ? arenaLimit : null,
    arenaRoomCount: 0,
    arenaAvailable: true,
  };
  return new Response(request.method === "HEAD" ? null : JSON.stringify(snapshot), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-transform" },
  });
}

/** Keep public lobby reads in a limiter bucket separate from matchmaking traffic. */
export function lobbyRateLimitKey(request: Request): string {
  return `lobby:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`;
}
