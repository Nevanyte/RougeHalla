// The heartbeat's contract: `beat` is appended to the client message wire list (the list is wire format: grow at the end), and the
// timings keep their order (a beat is well inside the server's timeout; the client's own stall limit is inside it too).
import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGE_TYPES, CLIENT_STALL_MS, HEARTBEAT_MS, LIVENESS_SWEEP_MS, LIVENESS_TIMEOUT_MS, RECONNECT_SECONDS } from "../src/index";

describe("the heartbeat message", () => {
  it("is appended after every earlier client message, in the order the wire has them", () => {
    expect(CLIENT_MESSAGE_TYPES.slice(0, 18)).toEqual([
      "move", "stop", "target", "aim", "attack", "release", "swap", "pickup", "plan", "cast", "choose", "train", "questAccept", "attackMove",
      "consumeCorpse", "huntTarget", "useConsumable", "trade",
    ]);
    expect(CLIENT_MESSAGE_TYPES[18]).toBe("beat");
  });

  it("has no duplicates", () => {
    expect(new Set(CLIENT_MESSAGE_TYPES).size).toBe(CLIENT_MESSAGE_TYPES.length);
  });
});

describe("the liveness timings", () => {
  it("leave room for several lost beats before a drop, and the client notices a dead link before the server does", () => {
    expect(LIVENESS_TIMEOUT_MS).toBeGreaterThanOrEqual(3 * HEARTBEAT_MS);
    expect(CLIENT_STALL_MS).toBeLessThan(LIVENESS_TIMEOUT_MS);
    expect(LIVENESS_SWEEP_MS).toBeLessThanOrEqual(HEARTBEAT_MS);
    expect(RECONNECT_SECONDS * 1000).toBeGreaterThan(LIVENESS_TIMEOUT_MS);
  });
});
