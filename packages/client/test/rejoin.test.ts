// The rejoin decisions and the seat's storage (net/rejoin.ts), and the liveness watch (net/linkWatch.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_STALL_MS, HEARTBEAT_MS, LIVENESS_SWEEP_MS, LIVENESS_TIMEOUT_MS, RECONNECT_SECONDS } from "@raid/shared";
import { LinkWatch, linkStalled, type LinkRoom } from "../src/net/linkWatch";
import {
  clearSeat, loadSeat, nextRejoinDelay, recoverableClose, REJOIN_RETRY_MS, REJOIN_WINDOW_MS, saveSeat, SEAT_KEY, shouldRejoinOnBusy,
} from "../src/net/rejoin";

function memoryStore() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("the stored seat", () => {
  it("round-trips, and is only handed to the callsign that owns it", () => {
    const store = memoryStore();
    saveSeat({ profile: "alice", token: "room1:tok" }, store);
    expect(loadSeat("alice", store)).toEqual({ profile: "alice", token: "room1:tok" });
    expect(loadSeat(undefined, store)).toEqual({ profile: "alice", token: "room1:tok" });
    expect(loadSeat("bob", store)).toBeNull();
    clearSeat(store);
    expect(loadSeat("alice", store)).toBeNull();
  });

  it("does not store a seat with no token, and ignores a damaged record", () => {
    const store = memoryStore();
    saveSeat({ profile: "alice", token: "" }, store);
    expect(store.m.size).toBe(0);
    for (const bad of ["not json", "null", "{}", JSON.stringify({ profile: "a", token: "no-colon" }), JSON.stringify({ profile: 1, token: "r:t" })]) {
      store.m.set(SEAT_KEY, bad);
      expect(loadSeat("a", store), bad).toBeNull();
    }
  });

  it("survives storage that throws, or none", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(() => saveSeat({ profile: "a", token: "r:t" }, broken)).not.toThrow();
    expect(loadSeat("a", broken)).toBeNull();
    expect(() => clearSeat(broken)).not.toThrow();
    expect(() => saveSeat({ profile: "a", token: "r:t" }, null)).not.toThrow();
    expect(loadSeat("a", null)).toBeNull();
  });
});

describe("when to keep asking for the seat", () => {
  it("covers the server noticing the drop, then its whole grace", () => {
    expect(REJOIN_WINDOW_MS).toBeGreaterThan(LIVENESS_TIMEOUT_MS + LIVENESS_SWEEP_MS + RECONNECT_SECONDS * 1000);
  });

  it("retries on a steady pause until the window is over, then gives up", () => {
    const lostAt = 10_000;
    expect(nextRejoinDelay(lostAt, lostAt, new Error("already consumed"))).toBe(REJOIN_RETRY_MS);
    expect(nextRejoinDelay(lostAt + REJOIN_WINDOW_MS - REJOIN_RETRY_MS, lostAt)).toBe(REJOIN_RETRY_MS);
    expect(nextRejoinDelay(lostAt + REJOIN_WINDOW_MS - REJOIN_RETRY_MS + 1, lostAt)).toBeNull();
    expect(nextRejoinDelay(lostAt + REJOIN_WINDOW_MS + 5000, lostAt)).toBeNull();
  });

  it("gives up at once when the room is gone", () => {
    expect(nextRejoinDelay(0, 0, new Error('room "abc" not found'))).toBeNull();
    expect(nextRejoinDelay(0, 0, "room disposed")).toBeNull();
  });

  it("recovers from the closes that mean a broken connection, and from no others", () => {
    for (const code of [1001, 1005, 1006, 4003, 4010]) expect(recoverableClose(code), String(code)).toBe(true);
    for (const code of [undefined, 1000, 4000, 4001, 4002]) expect(recoverableClose(code), String(code)).toBe(false);
  });

  it("tries the token on a busy refusal only when this tab holds that callsign's seat", () => {
    const seat = { profile: "alice", token: "r:t" };
    expect(shouldRejoinOnBusy(true, seat, "alice")).toBe(true);
    expect(shouldRejoinOnBusy(true, seat, "bob")).toBe(false);
    expect(shouldRejoinOnBusy(true, null, "alice")).toBe(false);
    expect(shouldRejoinOnBusy(false, seat, "alice")).toBe(false);
  });
});

describe("LinkWatch", () => {
  let now = 0;
  let inbound: (() => void) | null = null;
  let link: LinkRoom & { sent: number[]; drops: number; open: boolean; reconnecting: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    inbound = null;
    link = {
      sent: [], drops: 0, open: true, reconnecting: false,
      isOpen() { return this.open; },
      isReconnecting() { return this.reconnecting; },
      send(n) { this.sent.push(n); },
      drop() { this.drops++; },
      onInbound(cb) { inbound = cb; return () => { inbound = null; }; },
    };
  });
  afterEach(() => vi.useRealTimers());

  const advance = (ms: number) => { for (let t = 0; t < ms; t += HEARTBEAT_MS) { now += HEARTBEAT_MS; vi.advanceTimersByTime(HEARTBEAT_MS); } };

  it("knows a stall by the time since the last patch", () => {
    expect(linkStalled(CLIENT_STALL_MS, 0)).toBe(false);
    expect(linkStalled(CLIENT_STALL_MS + 1, 0)).toBe(true);
  });

  it("beats every HEARTBEAT_MS with a rising count, and stops when stopped", () => {
    const w = new LinkWatch(link, () => now);
    w.start();
    advance(3 * HEARTBEAT_MS);
    expect(link.sent).toEqual([0, 1, 2]);
    w.stop();
    advance(3 * HEARTBEAT_MS);
    expect(link.sent).toHaveLength(3);
    expect(inbound).toBeNull();
  });

  it("beats from incoming patches when a hidden tab's timers are throttled, at most once a HEARTBEAT_MS", () => {
    const w = new LinkWatch(link, () => now);
    w.start();
    // 20 patches a second for 3 s and no timer firing at all.
    for (let i = 0; i < 60; i++) { now += 50; inbound!(); }
    expect(link.sent).toEqual([0, 1, 2]);
    w.stop();
  });

  it("drops a socket that is open and carries no patch for CLIENT_STALL_MS, once, and not one that is patching", () => {
    const w = new LinkWatch(link, () => now);
    w.start();
    for (let i = 0; i < 6; i++) { advance(HEARTBEAT_MS); inbound!(); }
    expect(link.drops).toBe(0);
    advance(CLIENT_STALL_MS + HEARTBEAT_MS);
    expect(link.drops).toBe(1);
    w.stop();
  });

  it("leaves the SDK alone while it is already reconnecting or the socket is closed, and does not count that silence", () => {
    const w = new LinkWatch(link, () => now);
    w.start();
    link.reconnecting = true;
    advance(CLIENT_STALL_MS * 3);
    expect(link.sent).toEqual([]);
    link.reconnecting = false;
    advance(HEARTBEAT_MS);
    expect(link.drops).toBe(0);
    link.open = false;
    advance(CLIENT_STALL_MS * 3);
    expect(link.drops).toBe(0);
    w.stop();
  });
});
