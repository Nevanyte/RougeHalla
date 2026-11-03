import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOBBY_PRESENCE_PATH, LOBBY_SNAPSHOT_PATH, PASSCODE_HEADER, PROFILE_TOKEN_HEADER, type LobbySnapshot } from "@raid/shared";

const { apiBase, readPasscode } = vi.hoisted(() => ({ apiBase: vi.fn(() => "https://raid.example/prefix"), readPasscode: vi.fn(() => "playtest-secret") }));
vi.mock("../src/net/connection", () => ({ apiBase }));
vi.mock("../src/net/passcode", () => ({ readPasscode }));
import { fetchLobbySnapshot, heartbeatLobbyPresence, releaseLobbyPresence } from "../src/net/lobby";

const snapshot: LobbySnapshot = {
  serverNow: 1_700_000_000_000,
  activeGame: { phase: "active", startedAt: 1_699_999_900_000, players: [{ name: "PlayerOne", kind: "human", alive: true }] },
  waiting: [{ name: "PlayerTwo" }], onlineCount: 2, arenaLimit: 1, arenaRoomCount: 1, arenaAvailable: false,
};

beforeEach(() => {
  apiBase.mockClear();
  readPasscode.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("lobby network client", () => {
  it("gets a validated public snapshot from apiBase without auth and disables caching", async () => {
    expect(await fetchLobbySnapshot()).toEqual(snapshot);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`https://raid.example/prefix${LOBBY_SNAPSHOT_PATH}`);
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toBeUndefined();
  });

  it("uses a five-second timeout and composes caller cancellation", async () => {
    const timerSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timerSignal);
    const pendingFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", pendingFetch);
    const caller = new AbortController();
    const request = fetchLobbySnapshot(caller.signal);
    const signal = pendingFetch.mock.calls[0]![1]?.signal;
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(signal?.aborted).toBe(false);
    caller.abort();
    expect(signal?.aborted).toBe(true);
    expect(await request).toBeNull();
  });

  it("authenticates heartbeat and release with profile token and playtest passcode", async () => {
    expect(await heartbeatLobbyPresence("PlayerOne", "profile-token")).toEqual(snapshot);
    const [postUrl, postInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(postUrl).toBe(`https://raid.example/prefix${LOBBY_PRESENCE_PATH}`);
    expect(postInit?.method).toBe("POST");
    const headers = postInit?.headers as Record<string, string>;
    expect(headers[PROFILE_TOKEN_HEADER]).toBe("profile-token");
    expect(headers[PASSCODE_HEADER]).toBe("playtest-secret");
    const body = JSON.parse(String(postInit?.body)) as { name: string; tabId: string };
    expect(body.name).toBe("PlayerOne");
    expect(body.tabId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);

    await releaseLobbyPresence("PlayerOne", "profile-token");
    const [deleteUrl, deleteInit] = vi.mocked(fetch).mock.calls[1]!;
    expect(deleteUrl).toBe(postUrl);
    expect(deleteInit?.method).toBe("DELETE");
    expect(JSON.parse(String(deleteInit?.body))).toEqual(body);
  });

  it("rejects malformed snapshots instead of exposing partial roster data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...snapshot, activeGame: { ...snapshot.activeGame, players: [{ name: "Bot", kind: "robot" }] } }), { status: 200 })));
    expect(await fetchLobbySnapshot()).toBeNull();
  });
});
