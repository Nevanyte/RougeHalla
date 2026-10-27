// Wrong passcodes are counted per client address and over the whole server, on BOTH doors (the profile route and
// matchmaking), and the address is the socket's: Cloudflare's header only from a loopback peer, never X-Forwarded-For. The
// gate's maths on a made-up clock first, then the real server over real sockets.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { PASSCODE_HEADER, ROOM_NAME } from "@raid/shared";
import { loadConfig } from "../src/config";
import { CLIENT_ADDRESS_HEADER, addressOfContext, clientAddress, isLoopback } from "../src/guards/clientIp";
import { PASSCODE_THROTTLED, PasscodeGate } from "../src/guards/passcode";
import { startServer, type RaidServer } from "../src/index";

const PASSCODE = "open-sesame";

describe("PasscodeGate", () => {
  it("counts wrong guesses per address and refuses the address past its limit BEFORE comparing, even for the right passcode", () => {
    const gate = new PasscodeGate(PASSCODE, 3, 100);
    for (let i = 0; i < 3; i++) expect(gate.check(`guess${i}`, "1.1.1.1", 1000 + i)).toEqual({ ok: false, blocked: false, retryAfterMs: 0 });
    const blocked = gate.check(PASSCODE, "1.1.1.1", 2000);
    expect(blocked).toMatchObject({ ok: false, blocked: true });
    expect((blocked as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    expect(gate.check("guess", "1.1.1.1", 2001)).toMatchObject({ blocked: true });
    // Another address is untouched.
    expect(gate.check(PASSCODE, "2.2.2.2", 2002)).toEqual({ ok: true });
  });

  it("lets an address back in when its oldest guess leaves the minute", () => {
    const gate = new PasscodeGate(PASSCODE, 2, 100, 60_000);
    gate.check("a", "1.1.1.1", 0);
    gate.check("b", "1.1.1.1", 10_000);
    expect(gate.check(PASSCODE, "1.1.1.1", 59_999)).toMatchObject({ blocked: true });
    expect(gate.check(PASSCODE, "1.1.1.1", 60_001)).toEqual({ ok: true });
  });

  it("a right passcode costs nothing, and neither does a request that carries no passcode", () => {
    const gate = new PasscodeGate(PASSCODE, 2, 100);
    for (let i = 0; i < 20; i++) expect(gate.check(PASSCODE, "1.1.1.1", i)).toEqual({ ok: true });
    for (let i = 0; i < 20; i++) expect(gate.check(undefined, "1.1.1.1", 100 + i)).toMatchObject({ ok: false, blocked: false });
    expect(gate.check("wrong", "1.1.1.1", 200)).toMatchObject({ ok: false, blocked: false });
  });

  it("a cap over all addresses stops a guesser who keeps changing address", () => {
    const gate = new PasscodeGate(PASSCODE, 5, 8);
    for (let i = 0; i < 8; i++) gate.check("guess", `10.0.0.${i}`, i);
    expect(gate.check("guess", "10.0.0.99", 100)).toMatchObject({ blocked: true });
    expect(gate.check(PASSCODE, "10.0.0.100", 101)).toMatchObject({ blocked: true });
  });

  it("with no passcode set, or a limit of 0, nothing is ever counted or refused", () => {
    const none = new PasscodeGate(undefined, 1, 1);
    for (let i = 0; i < 10; i++) expect(none.check("x", "1.1.1.1", i)).toEqual({ ok: true });
    const off = new PasscodeGate(PASSCODE, 0, 0);
    for (let i = 0; i < 50; i++) expect(off.check("x", "1.1.1.1", i)).toMatchObject({ blocked: false });
    expect(off.check(PASSCODE, "1.1.1.1", 99)).toEqual({ ok: true });
  });
});

describe("clientAddress", () => {
  it("honours CF-Connecting-IP only from a loopback peer", () => {
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopback(peer), peer).toBe(true);
      expect(clientAddress(peer, "203.0.113.7"), peer).toBe("203.0.113.7");
    }
    for (const peer of ["192.168.1.20", "::ffff:192.168.1.20", "203.0.113.50", "2001:db8::1", "10.0.0.1"]) {
      expect(isLoopback(peer), peer).toBe(false);
      expect(clientAddress(peer, "203.0.113.7"), peer).toBe(peer);
    }
  });

  it("falls back to the socket for a header that is not one address, and for no peer at all", () => {
    for (const bad of ["", "not-an-ip", "1.2.3.4, 5.6.7.8", "x".repeat(200)]) expect(clientAddress("127.0.0.1", bad), bad).toBe("127.0.0.1");
    expect(clientAddress("127.0.0.1", ["1.1.1.1", "2.2.2.2"])).toBe("127.0.0.1");
    expect(clientAddress("127.0.0.1", undefined)).toBe("127.0.0.1");
    expect(clientAddress(undefined, "1.1.1.1")).toBe("unknown");
    expect(clientAddress("127.0.0.1", " 2001:DB8::1 ")).toBe("2001:db8::1");
  });

  it("reads a matchmaking context's stamped address, and 'unknown' for a call with none", () => {
    expect(addressOfContext({ headers: new Headers({ [CLIENT_ADDRESS_HEADER]: "9.9.9.9" }) })).toBe("9.9.9.9");
    expect(addressOfContext({ headers: new Headers() })).toBe("unknown");
    expect(addressOfContext(undefined)).toBe("unknown");
  });
});

// ---------------------------------------------------------------- the real server
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

let server: RaidServer;
let port = 0;
let dir = "";
const url = (p: string) => `http://127.0.0.1:${port}${p}`;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-throttle-"));
  port = await freePort();
  server = await startServer({
    ...loadConfig({ PLAYTEST_PASSCODE: PASSCODE, PASSCODE_FAILS_PER_MINUTE: "3", PASSCODE_FAILS_PER_MINUTE_ALL: "1000" }),
    port, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"), lobbySeconds: 120, minPlayers: 99,
  });
});

afterAll(async () => {
  try {
    await server?.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A claim from `ip`, which a loopback peer may name with Cloudflare's header (what the tunnel does). */
const claim = (name: string, ip: string, passcode?: string, extra: Record<string, string> = {}) =>
  fetch(url(`/api/profile/${name}`), { headers: { "cf-connecting-ip": ip, ...(passcode === undefined ? {} : { [PASSCODE_HEADER]: passcode }), ...extra } });

/** A matchmaking POST, as the SDK sends it, from `ip`. */
const matchmake = (ip: string, passcode: string | undefined, extra: Record<string, string> = {}) =>
  fetch(url(`/matchmake/joinOrCreate/${ROOM_NAME}`), {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...extra },
    body: JSON.stringify({ profile: "nobody", token: "x", ...(passcode === undefined ? {} : { passcode }) }),
  });

describe("on the real server", () => {
  it("refuses an address with 429, a Retry-After and a plain code after 3 wrong passcodes on the profile route, and creates nothing", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await claim(`guess${i}`, "203.0.113.1", `wrong${i}`);
      expect(res.status, `guess ${i}`).toBe(401);
    }
    const blocked = await claim("guess9", "203.0.113.1", "wrong9");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({ error: PASSCODE_THROTTLED, code: "passcode_throttled" });
    // The right passcode gets no answer while the address is blocked: a guess past the limit learns nothing.
    expect((await claim("friend1", "203.0.113.1", PASSCODE)).status).toBe(429);
    expect(server.store.get("friend1")).toBeUndefined();
    // Another address, right passcode: in.
    expect((await claim("friend1", "203.0.113.2", PASSCODE)).status).toBe(200);
  });

  it("counts matchmaking guesses on the same gate: the same address is refused there too, with 429 and the plain text", async () => {
    // 203.0.113.1 is already blocked by the profile route above.
    const res = await matchmake("203.0.113.1", "anything");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: PASSCODE_THROTTLED });
    // A fresh address spends its own three on matchmaking, and then is blocked on the profile route as well.
    for (let i = 0; i < 3; i++) {
      const wrong = await matchmake("203.0.113.3", `wrong${i}`);
      expect(wrong.status, `matchmake guess ${i}`).not.toBe(429);
      expect(JSON.stringify(await wrong.json())).toMatch(/passcode/i);
    }
    expect((await matchmake("203.0.113.3", "wrong9")).status).toBe(429);
    expect((await claim("guess10", "203.0.113.3", PASSCODE)).status).toBe(429);
  });

  it("cannot be dodged by naming another address in X-Forwarded-For, X-Real-IP, X-Client-IP or the stamp header", async () => {
    const forged = (n: number) => ({
      "x-forwarded-for": `198.51.100.${n}`, "x-real-ip": `198.51.100.${n}`, "x-client-ip": `198.51.100.${n}`, [CLIENT_ADDRESS_HEADER]: `198.51.100.${n}`,
    });
    // Same real (header-named, loopback-peer) address 203.0.113.4: a new forged name each time changes nothing.
    for (let i = 0; i < 3; i++) expect((await matchmake("203.0.113.4", `w${i}`, forged(i))).status).not.toBe(429);
    expect((await matchmake("203.0.113.4", "w9", forged(50))).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await claim(`forged${i}`, "203.0.113.5", `w${i}`, forged(i))).status).toBe(401);
    expect((await claim("forged9", "203.0.113.5", "w9", forged(60))).status).toBe(429);
  });

  const lan = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;

  it.skipIf(!lan)("ignores CF-Connecting-IP from a peer that is not this machine: a direct caller on the LAN cannot rename itself", async () => {
    const direct = (name: string, claimed: string, passcode: string) =>
      fetch(`http://${lan}:${port}/api/profile/${name}`, { headers: { "cf-connecting-ip": claimed, [PASSCODE_HEADER]: passcode } });
    for (let i = 0; i < 3; i++) expect((await direct(`lan${i}`, `192.0.2.${i}`, "wrong")).status).toBe(401);
    // A fourth guess under a fourth made-up address is the same caller to the server: blocked. The header does not even help to look innocent.
    expect((await direct("lan9", "192.0.2.99", "wrong")).status).toBe(429);
    // The address it tried to borrow is not blocked by what it did: nobody can aim the cap at someone else.
    expect((await claim("victim1", "192.0.2.1", PASSCODE)).status).toBe(200);
  });

  it("stops a guesser who changes address once the whole server has seen 7 wrong guesses in the minute", async () => {
    // RaidRoom.ctx is one per process: the first server is stopped before the second is made.
    await server.stop();
    port = await freePort();
    server = await startServer({
      ...loadConfig({ PLAYTEST_PASSCODE: PASSCODE, PASSCODE_FAILS_PER_MINUTE: "5", PASSCODE_FAILS_PER_MINUTE_ALL: "7" }),
      port, latencyMs: 0, stashFile: path.join(dir, "data", "stash2.json"), lobbySeconds: 120, minPlayers: 99,
    });
    for (let i = 0; i < 4; i++) expect((await claim(`spread${i}`, `203.0.113.${100 + i}`, "wrong")).status).toBe(401);
    for (let i = 0; i < 3; i++) expect((await matchmake(`203.0.113.${110 + i}`, "wrong")).status).not.toBe(429);
    // Seven wrong guesses, no address with more than 4: everyone waits now, a fresh address and the right passcode included.
    expect((await claim("late1", "203.0.113.200", PASSCODE)).status).toBe(429);
    expect((await matchmake("203.0.113.201", PASSCODE)).status).toBe(429);
    expect(server.store.get("late1")).toBeUndefined();
  });
});
