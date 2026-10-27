import { describe, expect, it } from "vitest";
import {
  CALLSIGN_BUSY_MESSAGE, GENERIC_MESSAGE, SERVER_PROBLEM_MESSAGE, TIMEOUT_MESSAGE, UNREACHABLE_MESSAGE,
  friendlyClose, friendlyError,
} from "../src/net/errors";

/** What the SDK throws: a MatchMakeError (or ServerError) with a numeric code, or a network failure with none. */
function sdkError(message: string, code?: number | string, name = "MatchMakeError"): Error {
  return Object.assign(new Error(message), { name, code });
}

describe("friendlyError: the server's join refusals", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["profile already in a raid", "callsign busy", /still in a run/i],
    ["a room was just opened for this profile; join it or try again in a few seconds", "room just opened", /just opened.*wait a few seconds/i],
    ["raid already started", "run started", /already started/i],
    ["invalid profile name", "invalid callsign", /isn't valid.*2–16/i],
    ["unknown profile or bad token", "bad token", /another device/i],
  ];
  for (const [raw, label, expected] of cases) {
    it(`${label}: "${raw}"`, () => {
      const text = friendlyError(sdkError(raw, 525));
      expect(text).toMatch(expected);
      expect(text).not.toContain(raw);
    });
  }

  it("the busy refusal is the sentence the menu shows for a duplicated tab", () => {
    expect(friendlyError(sdkError("profile already in a raid", 525))).toBe(CALLSIGN_BUSY_MESSAGE);
    expect(friendlyError(sdkError("profile already in a run", 525))).toBe(CALLSIGN_BUSY_MESSAGE);
  });

  it("a missing or wrong playtest passcode reads as a plain instruction, never the raw text", () => {
    const text = friendlyError(sdkError("this playtest needs a passcode", 525));
    expect(text).toMatch(/needs a passcode.*open the link your host sent/i);
    expect(text).not.toContain("this playtest needs");
  });

  it("too many wrong passcodes reads as a wait, not as a missing passcode", () => {
    const text = friendlyError(sdkError("too many wrong passcodes from this connection: wait a minute and try again", 429));
    expect(text).toMatch(/too many wrong passcodes.*wait a minute/i);
    expect(text).not.toContain("this connection");
    expect(text).not.toBe(friendlyError(sdkError("this playtest needs a passcode", 525)));
  });

  it("a creation refused for the room cap reads as a full server", () => {
    const text = friendlyError(sdkError("the server is full: too many rooms are open right now", 523));
    expect(text).toMatch(/server is full.*try again in a few minutes/i);
    expect(text).not.toContain("too many rooms");
  });

  it("an auth failure with no recognised reason still reads plainly", () => {
    expect(friendlyError(sdkError("onAuth failed", 525))).toMatch(/wouldn't let you in/i);
  });
});

describe("friendlyError: Colyseus matchmaking and seat failures", () => {
  it("a run that was disposed, is gone or has no room", () => {
    for (const raw of ['room "abc" not found', 'room "abc" has been disposed.', "no rooms found with provided criteria"]) {
      expect(friendlyError(sdkError(raw, 522))).toMatch(/no longer available/i);
    }
  });

  it("a run that is locked or full", () => {
    expect(friendlyError(sdkError('room "abc" is locked', 522))).toMatch(/full or already underway/i);
    expect(friendlyError(sdkError("roomid123 is already full.", 523))).toMatch(/full or already underway/i);
    expect(friendlyError(sdkError("room abc is no longer available.", 523))).toMatch(/full or already underway/i);
  });

  it("an expired seat reservation or reconnection token", () => {
    expect(friendlyError(sdkError("reconnection token invalid or expired.", 524))).toMatch(/seat.*expired/i);
    expect(friendlyError(sdkError("", 524))).toMatch(/seat.*expired/i);
  });

  it("a server that is shutting down", () => {
    expect(friendlyError(sdkError("room 'raid' not created: shutting down", 523))).toMatch(/restarting/i);
    expect(friendlyError(sdkError("", 4001, "ServerError"))).toMatch(/restarting/i);
  });

  it("a game mode the server does not define", () => {
    expect(friendlyError(sdkError('provided room name "raid" not defined', 520))).toMatch(/game mode/i);
    expect(friendlyError(sdkError("", 520))).toMatch(/game mode/i);
  });

  it("other matchmaking codes", () => {
    expect(friendlyError(sdkError("", 521))).toMatch(/no longer available/i);
    expect(friendlyError(sdkError("remote room timed out", 523))).toBe(TIMEOUT_MESSAGE);
    expect(friendlyError(sdkError("something odd", 523))).toMatch(/couldn't set up a run/i);
  });
});

describe("friendlyError: the server cannot be reached", () => {
  const unreachable: Array<[string, unknown]> = [
    ["Chrome fetch", new TypeError("Failed to fetch")],
    ["Firefox fetch", new TypeError("NetworkError when attempting to fetch resource.")],
    ["Safari fetch", new TypeError("Load failed")],
    ["undici fetch", new TypeError("fetch failed")],
    ["ECONNREFUSED on the cause (Node)", Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })],
    ["ECONNREFUSED as the SDK's code", sdkError("connect ECONNREFUSED 127.0.0.1:2567", "ECONNREFUSED", "ServerError")],
    ["ENOTFOUND", sdkError("getaddrinfo ENOTFOUND host", "ENOTFOUND", "ServerError")],
    ["a failed websocket", new Error("WebSocket connection failed")],
    ["a websocket that failed to open (a bare ServerError)", Object.assign(new Error(""), { name: "ServerError" })],
    ["an abnormal close before the join (1006)", sdkError("", 1006, "ServerError")],
    ["no status received (1005)", sdkError("", 1005, "ServerError")],
    ["a gateway 502", Object.assign(new Error("Bad Gateway"), { name: "ServerError", status: 502, code: 502 })],
    ["a gateway 503", Object.assign(new Error("Service Unavailable"), { name: "ServerError", status: 503 })],
    ["a gateway 504", Object.assign(new Error("Gateway Timeout"), { name: "ServerError", status: 504 })],
  ];
  for (const [label, err] of unreachable) {
    it(label, () => expect(friendlyError(err)).toBe(UNREACHABLE_MESSAGE));
  }
});

describe("friendlyError: timeouts", () => {
  it("a request that timed out", () => {
    const err = new DOMException("The operation timed out.", "TimeoutError");
    expect(friendlyError(err)).toBe(TIMEOUT_MESSAGE);
    expect(friendlyError(new Error("Request timeout"))).toBe(TIMEOUT_MESSAGE);
    expect(friendlyError(sdkError("connect ETIMEDOUT", "ETIMEDOUT", "ServerError"))).toBe(TIMEOUT_MESSAGE);
    expect(friendlyError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(TIMEOUT_MESSAGE);
  });
});

describe("friendlyError: HTTP statuses", () => {
  it("rate limits and server errors", () => {
    expect(friendlyError(Object.assign(new Error("Too Many Requests"), { status: 429 }))).toMatch(/too many attempts/i);
    expect(friendlyError(Object.assign(new Error("boom"), { status: 500 }))).toBe(SERVER_PROBLEM_MESSAGE);
    expect(friendlyError(Object.assign(new Error("x"), { code: 500 }))).toBe(SERVER_PROBLEM_MESSAGE);
  });
});

describe("friendlyError: the client's own failures keep their sentence", () => {
  it("ProfileError and ShopRequestError carry a player-facing message", () => {
    expect(friendlyError(Object.assign(new Error("That callsign is taken (its token isn't on this device)"), { name: "ProfileError" })))
      .toBe("That callsign is taken (its token isn't on this device)");
    expect(friendlyError(Object.assign(new Error("Need 40 more GV"), { name: "ShopRequestError" }))).toBe("Need 40 more GV");
  });
});

describe("friendlyError: unknown input never leaks", () => {
  const stack = new Error("Cannot read properties of undefined (reading 'players')");
  const odd: Array<[string, unknown]> = [
    ["a bug with a stack", stack],
    ["an empty error", new Error("")],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { foo: "bar" }],
    ["an object with a toString", { toString: () => "[object Object]" }],
    ["a number that means nothing", 42],
    ["an unknown string", "kaboom"],
    ["a symbol", Symbol("x")],
    ["a ReferenceError from a bug", new ReferenceError("foo is not defined")],
    ["an array", [1, 2, 3]],
  ];
  for (const [label, err] of odd) {
    it(label, () => {
      const text = friendlyError(err);
      expect(text).toBe(GENERIC_MESSAGE);
      expect(text).not.toMatch(/\[object|at .*\(|stack|undefined|reading/i);
    });
  }

  it("never throws on a hostile object", () => {
    const hostile = new Proxy({}, { get() { throw new Error("no"); } });
    expect(() => friendlyError(hostile)).not.toThrow();
  });
});

describe("friendlyClose: a room that ended", () => {
  it("a normal close", () => {
    for (const code of [1000, 1001, 4000]) {
      expect(friendlyClose(code)).toBe("Disconnected from the run.");
      expect(friendlyClose(code, true)).toBe("Disconnected from training.");
    }
  });

  it("an abnormal close points at the connection", () => {
    for (const code of [1005, 1006, 4010]) {
      expect(friendlyClose(code)).toMatch(/^Lost connection to the run\. Check your connection/);
      expect(friendlyClose(code, true)).toMatch(/^Lost connection to training\./);
    }
  });

  it("a server shutdown, a failed reconnect and a server error", () => {
    expect(friendlyClose(4001)).toMatch(/restarting/i);
    expect(friendlyClose(4003)).toMatch(/Couldn't reconnect to the run/);
    expect(friendlyClose(4003, true)).toMatch(/Couldn't reconnect to training/);
    expect(friendlyClose(4002)).toMatch(/server error/i);
    expect(friendlyClose(4002, true)).toMatch(/^Training ended/);
  });

  it("an unknown or missing code is still a plain sentence", () => {
    expect(friendlyClose(4999)).toBe("Disconnected from the run.");
    expect(friendlyClose(undefined)).toBe("Disconnected from the run.");
  });

  it("never prints the code", () => {
    for (const code of [1000, 1006, 4000, 4001, 4002, 4003, 4010, 4999]) {
      expect(friendlyClose(code)).not.toMatch(/\d/);
      expect(friendlyClose(code, true)).not.toMatch(/\d/);
    }
  });
});
