import { describe, expect, it } from "vitest";
import { LOBBY_SNAPSHOT_PATH, type LobbySnapshot } from "@raid/shared";
import { coldLobbySnapshotOrContinue, coldLobbySnapshotResponse, confirmsEmptyLobbySnapshotAtGeneration, isLobbySnapshotRequest, lobbyRateLimitKey } from "../src/lobbySnapshot";

describe("cold lobby snapshots", () => {
  it("identifies only the lobby snapshot GET and HEAD requests", () => {
    expect(isLobbySnapshotRequest(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`))).toBe(true);
    expect(isLobbySnapshotRequest(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`, { method: "HEAD" }))).toBe(true);
    expect(isLobbySnapshotRequest(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`, { method: "POST" }))).toBe(false);
    expect(isLobbySnapshotRequest(new Request("https://game.test/api/lobby/presence"))).toBe(false);
  });

  it("returns a no-store empty snapshot without a body for HEAD", async () => {
    const get = coldLobbySnapshotResponse(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`), 1, 1234);
    expect(get.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(get.headers.get("content-type")).toContain("application/json");
    expect(await get.json() as LobbySnapshot).toEqual({
      serverNow: 1234, activeGame: null, waiting: [], onlineCount: 0,
      arenaLimit: 1, arenaRoomCount: 0, arenaAvailable: true,
    });

    const head = coldLobbySnapshotResponse(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`, { method: "HEAD" }), 0, 1234);
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(head.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(head.headers.get("content-type")).toContain("application/json");
    expect(head.headers.get("content-length")).toBeNull();
  });

  it("answers stopped GETs without invoking readiness and sends running/starting requests through readiness", async () => {
    let readinessCalls = 0;
    const continueThroughReadiness = async (): Promise<Response> => {
      readinessCalls++;
      return new Response("release verified");
    };
    const request = new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`);
    const cold = await coldLobbySnapshotOrContinue(request, false, false, 1, continueThroughReadiness);
    expect(readinessCalls).toBe(0);
    expect((await cold.json() as LobbySnapshot).arenaAvailable).toBe(true);

    const running = await coldLobbySnapshotOrContinue(request, true, false, 1, continueThroughReadiness);
    expect(readinessCalls).toBe(1);
    expect(await running.text()).toBe("release verified");

    const starting = await coldLobbySnapshotOrContinue(request, false, true, 1, continueThroughReadiness);
    expect(readinessCalls).toBe(2);
    expect(await starting.text()).toBe("release verified");
  });

  it("does not memoize an empty read that finishes after a presence or matchmaking request", async () => {
    const response = coldLobbySnapshotResponse(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`), 1, 1234);
    let generation = 4;
    const pending = confirmsEmptyLobbySnapshotAtGeneration(response, 4, () => generation);
    generation++; // A non-snapshot request invalidates the memo while the snapshot body is being read.
    expect(await pending).toBe(false);
    expect(await confirmsEmptyLobbySnapshotAtGeneration(response, 5, () => generation)).toBe(true);
  });

  it("separates public lobby reads from matchmaking rate-limit keys", () => {
    const request = new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`, { headers: { "CF-Connecting-IP": "203.0.113.4" } });
    expect(lobbyRateLimitKey(request)).toBe("lobby:203.0.113.4");
    expect(lobbyRateLimitKey(new Request(`https://game.test${LOBBY_SNAPSHOT_PATH}`))).toBe("lobby:unknown");
  });
});
