import { afterEach, describe, expect, it, vi } from "vitest";
import type { LobbySnapshot } from "@raid/shared";
import { asEl, installPlanningDom } from "./planningDom";

const net = vi.hoisted(() => ({
  fetchLobbySnapshot: vi.fn(),
  heartbeatLobbyPresence: vi.fn(),
  releaseLobbyPresence: vi.fn(),
}));
vi.mock("../src/net/lobby", () => net);
import { LobbyActivity } from "../src/ui/lobbyActivity";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function snapshot(over: Partial<LobbySnapshot> = {}): LobbySnapshot {
  const serverNow = Date.now();
  return {
    serverNow,
    activeGame: { phase: "active", startedAt: serverNow - 100_000, players: [
      { name: "Runner", kind: "human", alive: true }, { name: "PracticeBot", kind: "bot", alive: true },
    ] },
    waiting: [{ name: "WaitingOne" }], onlineCount: 2, arenaLimit: 1, arenaRoomCount: 1, arenaAvailable: false,
    ...over,
  };
}

function visibility(dom: ReturnType<typeof installPlanningDom>, state: "visible" | "hidden"): void {
  dom.doc.visibilityState = state;
  dom.doc.fire({
    type: "visibilitychange", target: null, defaultPrevented: false, propagationStopped: false,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
  });
}

const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe("LobbyActivity", () => {
  it("uses public snapshot before login, switches to 15-second authenticated refresh, and releases each lease once", async () => {
    vi.useFakeTimers();
    const dom = installPlanningDom();
    const current = snapshot();
    net.fetchLobbySnapshot.mockResolvedValue(current);
    net.heartbeatLobbyPresence.mockResolvedValue(current);
    net.releaseLobbyPresence.mockResolvedValue(undefined);
    const panel = new LobbyActivity();
    panel.show();
    await settle();
    expect(net.fetchLobbySnapshot).toHaveBeenCalledTimes(1);
    expect(net.heartbeatLobbyPresence).not.toHaveBeenCalled();

    panel.setIdentity({ name: "Runner", token: "secret" });
    await settle();
    expect(net.heartbeatLobbyPresence).toHaveBeenCalledTimes(1);
    expect(net.heartbeatLobbyPresence).toHaveBeenCalledWith("Runner", "secret", expect.any(AbortSignal));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(net.fetchLobbySnapshot).toHaveBeenCalledTimes(1);
    expect(net.heartbeatLobbyPresence).toHaveBeenCalledTimes(2);

    const callsBeforePause = net.heartbeatLobbyPresence.mock.calls.length;
    visibility(dom, "hidden");
    await settle();
    expect(net.releaseLobbyPresence).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.heartbeatLobbyPresence).toHaveBeenCalledTimes(callsBeforePause);
    visibility(dom, "visible");
    await settle();
    expect(net.heartbeatLobbyPresence).toHaveBeenCalledTimes(callsBeforePause + 1);
    panel.hide();
    expect(net.releaseLobbyPresence).toHaveBeenCalledTimes(2);
    panel.setIdentity(null);
    expect(net.releaseLobbyPresence).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.heartbeatLobbyPresence).toHaveBeenCalledTimes(callsBeforePause + 1);
  });

  it("shows current players and server-anchored elapsed time without rebuilding lists on clock ticks; stale data recovers", async () => {
    vi.useFakeTimers();
    installPlanningDom();
    const current = snapshot({ activeGame: { phase: "lobby", startedAt: null, players: [{ name: "EarlyJoin", kind: "human", alive: false }] }, waiting: [], onlineCount: 1 });
    const localNow = Date.now();
    const active = snapshot({
      serverNow: localNow - 5000,
      activeGame: { phase: "active", startedAt: localNow - 105_000, players: [
        { name: "Runner", kind: "human", alive: true }, { name: "PracticeBot", kind: "bot", alive: true },
      ] },
      arenaAvailable: true,
    });
    net.fetchLobbySnapshot.mockResolvedValueOnce(current).mockResolvedValueOnce(active).mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(active);
    net.heartbeatLobbyPresence.mockResolvedValue(active);
    net.releaseLobbyPresence.mockResolvedValue(undefined);
    const panel = new LobbyActivity();
    panel.show();
    await settle();
    const root = asEl(panel.root);
    expect(root.textContent).toContain("Gathering players");
    expect(root.textContent).toContain("No players waiting in the hub.");
    expect(root.textContent).not.toContain("Out");

    await vi.advanceTimersByTimeAsync(15_000);
    const gameList = root.byClass("lobby-people")[0]!;
    const duration = root.byClass("lobby-duration")[0]!;
    const originalText = duration.textContent;
    expect(originalText).toBe("1m 40s playing");
    await vi.advanceTimersByTimeAsync(3000);
    expect(duration.textContent).not.toBe(originalText);
    expect(root.byClass("lobby-people")[0]).toBe(gameList);

    await vi.advanceTimersByTimeAsync(31_000);
    expect(root.textContent).toContain("Lobby activity is out of date");
    expect(root.textContent).toContain("Current players unavailable.");
    expect(root.textContent).not.toContain("PracticeBot");

    await vi.advanceTimersByTimeAsync(11_000);
    expect(root.textContent).toContain("PracticeBot");
    expect(root.textContent).toContain("Current lobby is accepting players.");
    panel.hide();
  });
});
