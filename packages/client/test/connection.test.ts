// Where the client connects, and what it carries to the server for a public link: the page's own origin in a production
// build (served by the game server itself), the dev port in a dev build, VITE_SERVER_URL over both; the playtest passcode
// from the page's address, remembered, and sent with a join and with a profile request.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSCODE_HEADER, PROFILE_TOKEN_HEADER, ROOM_NAME, SERVER_PORT, TRAINING_ROOM_NAME } from "@raid/shared";

const created: Array<{ endpoint: string; calls: Array<{ method: string; room: string; options: Record<string, unknown> }> }> = [];

vi.mock("@colyseus/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@colyseus/sdk")>();
  class FakeClient {
    readonly calls: Array<{ method: string; room: string; options: Record<string, unknown> }> = [];
    constructor(readonly endpoint: string) { created.push(this); }
    private async join(method: string, room: string, options: Record<string, unknown>) {
      this.calls.push({ method, room, options });
      return { reconnection: {}, sessionId: "s" };
    }
    joinOrCreate(room: string, options: Record<string, unknown>) { return this.join("joinOrCreate", room, options); }
    create(room: string, options: Record<string, unknown>) { return this.join("create", room, options); }
  }
  return { ...actual, Client: FakeClient };
});

let storage: Map<string, string>;
let storageBroken = false;

function stubPage(page: { href?: string } = {}): void {
  const url = new URL(page.href ?? "https://abc-def.trycloudflare.com/");
  vi.stubGlobal("location", { href: url.href, origin: url.origin, protocol: url.protocol, hostname: url.hostname, search: url.search });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => { if (storageBroken) throw new Error("denied"); return storage.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (storageBroken) throw new Error("denied"); storage.set(k, v); },
  });
}

beforeEach(() => {
  storage = new Map();
  storageBroken = false;
  created.length = 0;
  vi.resetModules();
  vi.stubEnv("VITE_SERVER_URL", "");
  vi.stubEnv("DEV", false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const load = () => import("../src/net/connection");

describe("serverEndpoint and apiBase", () => {
  it("a production build talks to the page's own origin, so an https page gets wss", async () => {
    stubPage({ href: "https://abc-def.trycloudflare.com/?profile=amy" });
    const { serverEndpoint, apiBase } = await load();
    expect(serverEndpoint()).toBe("https://abc-def.trycloudflare.com");
    expect(apiBase()).toBe(""); // /api on the same origin
    // The SDK derives the websocket from an https origin: wss on 443 (checked against the real client).
    const actual = await vi.importActual<typeof import("@colyseus/sdk")>("@colyseus/sdk");
    const real = new actual.Client(serverEndpoint()) as unknown as { settings: { hostname: string; port: number; secure: boolean } };
    expect(real.settings).toMatchObject({ hostname: "abc-def.trycloudflare.com", port: 443, secure: true });
  });

  it("a production build on a plain http origin keeps its port and gets ws", async () => {
    stubPage({ href: "http://192.168.1.20:2600/" });
    const { serverEndpoint } = await load();
    expect(serverEndpoint()).toBe("http://192.168.1.20:2600");
    const actual = await vi.importActual<typeof import("@colyseus/sdk")>("@colyseus/sdk");
    const real = new actual.Client(serverEndpoint()) as unknown as { settings: { hostname: string; port: number; secure: boolean } };
    expect(real.settings).toMatchObject({ hostname: "192.168.1.20", port: 2600, secure: false });
  });

  it("a dev build keeps today's hostname:SERVER_PORT, since Vite proxies only /api", async () => {
    vi.stubEnv("DEV", true);
    stubPage({ href: "http://localhost:5173/" });
    const { serverEndpoint, apiBase } = await load();
    expect(serverEndpoint()).toBe(`http://localhost:${SERVER_PORT}`);
    expect(apiBase()).toBe("");
  });

  it("VITE_SERVER_URL overrides both, for the socket and for the REST base", async () => {
    stubPage();
    vi.stubEnv("VITE_SERVER_URL", "wss://game.example.test:8443");
    const prod = await load();
    expect(prod.serverEndpoint()).toBe("wss://game.example.test:8443");
    expect(prod.apiBase()).toBe("https://game.example.test:8443");
    vi.stubEnv("DEV", true);
    expect(prod.serverEndpoint()).toBe("wss://game.example.test:8443");
  });
});

describe("the passcode", () => {
  it("is read from ?code= in the address, remembered, and found again on a link without it", async () => {
    stubPage({ href: "https://x.trycloudflare.com/?profile=amy&code=open-sesame" });
    const { readPasscode } = await import("../src/net/passcode");
    expect(readPasscode()).toBe("open-sesame");
    expect(storage.get("raid.passcode")).toBe("open-sesame");
    stubPage({ href: "https://x.trycloudflare.com/" });
    expect(readPasscode()).toBe("open-sesame");
  });

  it("a newer ?code= replaces the remembered one", async () => {
    storage.set("raid.passcode", "old");
    stubPage({ href: "https://x.trycloudflare.com/?code=new" });
    const { readPasscode } = await import("../src/net/passcode");
    expect(readPasscode()).toBe("new");
    expect(storage.get("raid.passcode")).toBe("new");
  });

  it("is undefined when there is none, and still works from the address when storage is blocked", async () => {
    stubPage();
    const { readPasscode } = await import("../src/net/passcode");
    expect(readPasscode()).toBeUndefined();
    storageBroken = true;
    expect(readPasscode()).toBeUndefined();
    stubPage({ href: "https://x.trycloudflare.com/?code=abc" });
    expect(readPasscode()).toBe("abc");
  });

  it("rides in the options of a run join and of a training join, and only when there is one", async () => {
    stubPage({ href: "https://x.trycloudflare.com/?code=open-sesame" });
    const { joinRaid, joinTraining } = await load();
    await joinRaid({ profile: "amy", token: "t", faction: "fire" });
    await joinTraining({ profile: "amy", token: "t" });
    const [client] = created as unknown as Array<{ calls: Array<{ method: string; room: string; options: Record<string, unknown> }> }>;
    expect(client!.calls).toEqual([
      { method: "joinOrCreate", room: ROOM_NAME, options: { profile: "amy", token: "t", faction: "fire", passcode: "open-sesame" } },
      { method: "create", room: TRAINING_ROOM_NAME, options: { profile: "amy", token: "t", passcode: "open-sesame" } },
    ]);

    created.length = 0;
    storage.clear();
    stubPage({ href: "https://x.trycloudflare.com/" });
    vi.resetModules();
    const bare = await load();
    await bare.joinRaid({ profile: "amy", token: "t" });
    const [second] = created as unknown as Array<{ calls: Array<{ options: Record<string, unknown> }> }>;
    expect(second!.calls[0]!.options).toEqual({ profile: "amy", token: "t" }); // no passcode key at all
  });
});

describe("the profile requests", () => {
  const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("send the passcode and the token as headers", async () => {
    stubPage({ href: "https://x.trycloudflare.com/?code=open-sesame" });
    storage.set("raid.token.amy", "tok");
    const fetchSpy = vi.fn(async () => reply(403));
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchProfile } = await import("../src/net/profile");
    await expect(fetchProfile("amy")).rejects.toMatchObject({ kind: "taken" });
    const [calledUrl, init] = fetchSpy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(calledUrl).toBe("/api/profile/amy");
    expect(init.headers).toEqual({ [PROFILE_TOKEN_HEADER]: "tok", [PASSCODE_HEADER]: "open-sesame" });
  });

  it("a 401 reads as a plain passcode message, and a 429 as too many new callsigns", async () => {
    stubPage();
    const { fetchProfile } = await import("../src/net/profile");
    const { friendlyError, PASSCODE_MESSAGE, NEW_CALLSIGNS_MESSAGE, PASSCODE_THROTTLED_MESSAGE } = await import("../src/net/errors");
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { error: "this playtest needs a passcode", code: "passcode_required" })));
    const refused = await fetchProfile("amy").catch((e: unknown) => e);
    expect(friendlyError(refused)).toBe(PASSCODE_MESSAGE);
    expect(PASSCODE_MESSAGE).toMatch(/passcode.*link your host sent/i);
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, { error: "too many new callsigns lately, try again later" })));
    const capped = await fetchProfile("bob").catch((e: unknown) => e);
    expect(friendlyError(capped)).toBe(NEW_CALLSIGNS_MESSAGE);
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, { error: "too many wrong passcodes from this connection: wait a minute and try again", code: "passcode_throttled" })));
    const guessed = await fetchProfile("cat").catch((e: unknown) => e);
    expect(friendlyError(guessed)).toBe(PASSCODE_THROTTLED_MESSAGE);
  });

  it("a shop request refused with 429 reads as a plain rate-limit message", async () => {
    stubPage();
    storage.set("raid.token.amy", "tok");
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, { error: "too many requests, slow down" })));
    const { purchaseCosmetic } = await import("../src/net/profile");
    const { RATE_LIMIT_MESSAGE } = await import("../src/net/errors");
    await expect(purchaseCosmetic("amy", "skin-x")).rejects.toMatchObject({ code: "unavailable", message: RATE_LIMIT_MESSAGE });
  });
});
