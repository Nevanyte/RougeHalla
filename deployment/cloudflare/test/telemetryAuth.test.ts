import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DASHBOARD_CSP, SESSION_COOKIE, SESSION_SECONDS, sessionValue, verifySession } from "../src/telemetry/auth";
import { telemetryContainerEnv, telemetryOn } from "../src/telemetry/containerEnv";
import type { TelemetryStoreRpc } from "../src/telemetry/ingest";
import { handleStats, type StatsEnv } from "../src/telemetry/routes";
import { toRows } from "../src/telemetry/rows";
import { ingestRows, migrate, runKey, runQuery } from "../src/telemetry/store";
import { DAY1, miniSet, nodeSql } from "./telemetryHelpers";

const DASH = "dashboard-token-0123456789abcdef0123456789";
const ORIGIN = "https://play.example";
const NOW = DAY1 + 3_600_000;

function env(over: Partial<StatsEnv> = {}, limiterOk = true): StatsEnv & { limited: string[] } {
  const sql = nodeSql();
  migrate(sql);
  for (const r of miniSet()) ingestRows(sql, toRows(r));
  const rpc: TelemetryStoreRpc = {
    ingest: async (rows) => rows.map((r) => ingestRows(sql, r)),
    query: async (name, q, opts, now) => runQuery(sql, name, q, opts, now),
    runKey: async (id) => runKey(sql, id),
  };
  const limited: string[] = [];
  return {
    DASHBOARD_TOKEN: DASH,
    MATCHMAKE_LIMITER: { limit: async ({ key }: { key: string }) => { limited.push(key); return { success: limiterOk }; } },
    TELEMETRY: { idFromName: () => ({}) as DurableObjectId, get: () => rpc },
    PROFILES: { get: async () => null, list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }) } as unknown as StatsEnv["PROFILES"],
    limited,
    ...over,
  };
}

const req = (p: string, init: RequestInit = {}) => new Request(`${ORIGIN}${p}`, init);
const bearer = { Authorization: `Bearer ${DASH}` };

function login(body: string, headers: Record<string, string> = { Origin: ORIGIN }) {
  return req("/stats/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.9", ...headers }, body });
}

function expectDashboardHeaders(r: Response) {
  expect(r.headers.get("Content-Security-Policy")).toBe(DASHBOARD_CSP);
  expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(r.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(r.headers.get("X-Frame-Options")).toBe("DENY");
  expect(r.headers.get("Cache-Control")).toBe("no-store");
}

describe("dashboard routes and auth", () => {
  it("is 404 everywhere without a (long enough) DASHBOARD_TOKEN, and ignores other paths", async () => {
    for (const token of [undefined, "short"]) {
      const e = env({ DASHBOARD_TOKEN: token });
      for (const p of ["/stats", "/stats/app.js", "/stats/login", "/api/stats/meta", "/api/stats/factions"]) {
        expect((await handleStats(req(p, { headers: bearer }), e, NOW))?.status, p).toBe(404);
      }
    }
    for (const p of ["/", "/statsfoo", "/api/statsx", "/matchmake", "/_internal/telemetry"]) {
      expect(await handleStats(req(p), env(), NOW)).toBeNull();
    }
  });

  it("serves the page shell, script and styles with the security headers", async () => {
    const e = env();
    for (const [p, type] of [["/stats", "text/html"], ["/stats/", "text/html"], ["/stats/app.js", "text/javascript"], ["/stats/app.css", "text/css"]]) {
      const r = (await handleStats(req(p), e, NOW))!;
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Type")).toMatch(new RegExp(`^${type}`));
      expectDashboardHeaders(r);
    }
    const html = await (await handleStats(req("/stats"), e, NOW))!.text();
    expect(html).not.toMatch(/<script[^>]*>[^<]|<style|\son\w+=/i);
    expect((await handleStats(req("/stats", { method: "POST" }), e, NOW))!.status).toBe(405);
    expect((await handleStats(req("/stats/nope"), e, NOW))!.status).toBe(404);
  });

  it("answers 401 JSON without credentials and accepts the bearer token", async () => {
    const e = env();
    const denied = (await handleStats(req("/api/stats/factions"), e, NOW))!;
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthorized" });
    expectDashboardHeaders(denied);
    expect((await handleStats(req("/api/stats/factions", { headers: { Authorization: `Bearer ${DASH}x` } }), e, NOW))!.status).toBe(401);
    const ok = (await handleStats(req("/api/stats/factions", { headers: bearer }), e, NOW))!;
    expect(ok.status).toBe(200);
    expectDashboardHeaders(ok);
    expect(((await ok.json()) as { rows: unknown[] }).rows.length).toBe(2);
  });

  it("logs in with the Origin check and the rate limit, and sets a strict session cookie", async () => {
    const e = env();
    const ok = (await handleStats(login(`token=${DASH}`), e, NOW))!;
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe("/stats");
    const cookie = ok.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=\\d+\\.[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}$`));
    expect(e.limited).toEqual(["dashlogin:203.0.113.9"]);
    const value = cookie.split(";")[0];
    const api = (await handleStats(req("/api/stats/overview", { headers: { Cookie: `other=1; ${value}` } }), e, NOW))!;
    expect(api.status).toBe(200);

    const wrong = (await handleStats(login("token=nope"), e, NOW))!;
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get("Location")).toBe("/stats?login=failed");
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
    expect((await handleStats(login(`token=${DASH}`, { Origin: "https://evil.example" }), e, NOW))!.status).toBe(403);
    expect((await handleStats(login(`token=${DASH}`, {}), e, NOW))!.status).toBe(403);
    expect((await handleStats(req("/stats/login"), e, NOW))!.status).toBe(405);
    expect((await handleStats(login(`token=${DASH}`), env({}, false), NOW))!.status).toBe(429);
  });

  it("carries the page's filters back through the sign-in, and nothing but a plain query", async () => {
    const e = env();
    const next = encodeURIComponent("source=tournament&pool=bots&login=failed");
    const ok = (await handleStats(login(`token=${DASH}&next=${next}`), e, NOW))!;
    expect(ok.headers.get("Location")).toBe("/stats?source=tournament&pool=bots");
    const wrong = (await handleStats(login(`token=nope&next=${encodeURIComponent("pool=bots")}`), e, NOW))!;
    expect(wrong.headers.get("Location")).toBe("/stats?login=failed&pool=bots");
    for (const bad of ["//evil.example", "https://evil.example/", "a=<b>", "x".repeat(600)]) {
      const r = (await handleStats(login(`token=${DASH}&next=${encodeURIComponent(bad)}`), e, NOW))!;
      expect(r.headers.get("Location")).toBe("/stats");
    }
  });

  it("refuses an expired, forged or far-future cookie, and the old token's cookie after rotation", async () => {
    const value = await sessionValue(DASH, NOW);
    expect(await verifySession(DASH, value, NOW)).toBe(true);
    expect(await verifySession(DASH, value, NOW + (SESSION_SECONDS + 1) * 1000)).toBe(false);
    const [exp, mac] = value.split(".");
    expect(await verifySession(DASH, `${Number(exp) + 1}.${mac}`, NOW)).toBe(false);
    expect(await verifySession(DASH, `${exp}.${"A".repeat(43)}`, NOW)).toBe(false);
    expect(await verifySession(`${DASH}-rotated`, value, NOW)).toBe(false);
    const far = await sessionValue(DASH, NOW + 365 * 86_400_000);
    expect(await verifySession(DASH, far, NOW)).toBe(false);
    for (const bad of ["", "x", `${exp}`, `${exp}.${mac}.x`, `-1.${mac}`]) expect(await verifySession(DASH, bad, NOW)).toBe(false);
    const e = env();
    const forged = (await handleStats(req("/api/stats/overview", { headers: { Cookie: `${SESSION_COOKIE}=${exp}.${"B".repeat(43)}` } }), e, NOW))!;
    expect(forged.status).toBe(401);
  });

  it("logs out with a cleared cookie", async () => {
    const r = (await handleStats(req("/stats/logout", { method: "POST", headers: { Origin: ORIGIN } }), env(), NOW))!;
    expect(r.status).toBe(303);
    expect(r.headers.get("Location")).toBe("/stats");
    expect(r.headers.get("Set-Cookie")).toBe(`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    expect((await handleStats(req("/stats/logout"), env(), NOW))!.status).toBe(405);
  });

  it("names a bad parameter in a 400 and checks run ids and methods", async () => {
    const e = env();
    const bad = (await handleStats(req("/api/stats/factions?faction=orc", { headers: bearer }), e, NOW))!;
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad parameter", param: "faction" });
    expect(await (await handleStats(req("/api/stats/offers?kind=x", { headers: bearer }), e, NOW))!.json()).toEqual({ error: "bad parameter", param: "kind" });
    expect((await handleStats(req("/api/stats/run/not-a-uuid", { headers: bearer }), e, NOW))!.status).toBe(400);
    expect((await handleStats(req("/api/stats/run/00000000-0000-4000-8000-000000000001", { headers: bearer }), e, NOW))!.status).toBe(404);
    expect((await handleStats(req("/api/stats/nope", { headers: bearer }), e, NOW))!.status).toBe(404);
    expect((await handleStats(req("/api/stats/factions", { method: "POST", headers: bearer }), e, NOW))!.status).toBe(405);
    expect((await handleStats(req("/api/stats/admin/reindex?confirm=1", { headers: bearer }), e, NOW))!.status).toBe(405);
    const cookie = `${SESSION_COOKIE}=${await sessionValue(DASH, NOW)}`;
    expect((await handleStats(req("/api/stats/admin/reindex?confirm=1", { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example" } }), e, NOW))!.status).toBe(403);
  });

  it("answers 503 when the store fails", async () => {
    const e = env();
    const broken = { ...e, TELEMETRY: { idFromName: () => ({}) as DurableObjectId, get: () => ({ query: async () => { throw new Error("down"); } }) as unknown as TelemetryStoreRpc } };
    expect((await handleStats(req("/api/stats/factions", { headers: bearer }), broken, NOW))!.status).toBe(503);
  });

  it("matches the dashboard fixture's response shapes when part C's fixture exists", async () => {
    const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/dashboard/fixture.ts");
    if (!fs.existsSync(fixturePath)) return;
    const { DASHBOARD_FIXTURE } = (await import(/* @vite-ignore */ fixturePath)) as { DASHBOARD_FIXTURE: Record<string, unknown> };
    const e = env();
    const keysOf = (x: unknown): string[] => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort() : []);
    for (const [p, expected] of Object.entries(DASHBOARD_FIXTURE)) {
      if (!p.startsWith("/api/stats/") || p.includes(":") || p.includes("export") || p.includes("admin")) continue;
      const r = (await handleStats(req(`${p}${p.includes("?") ? "&" : "?"}pool=all&source=any&build=any&from=2026-10-01&to=2026-11-30`, { headers: bearer }), e, NOW))!;
      expect(r.status, p).toBe(200);
      const got = await r.json();
      const want = expected as { rows?: unknown[] };
      const gotRows = (got as { rows?: unknown[] }).rows;
      if (Array.isArray(want.rows) && want.rows.length > 0 && Array.isArray(gotRows) && gotRows.length > 0) {
        for (const k of keysOf(want.rows[0])) expect(keysOf(gotRows[0]), `${p} row key ${k}`).toContain(k);
      } else {
        for (const k of keysOf(expected)) if (k !== "notes") expect(keysOf(got), `${p} key ${k}`).toContain(k);
      }
    }
  });
});

describe("container telemetry env", () => {
  const T = "t".repeat(64);
  const S = "s".repeat(64);
  it("is empty without a valid token and never throws", () => {
    expect(telemetryContainerEnv({}, "https://play.example/x", "abc")).toEqual({});
    expect(telemetryContainerEnv({ TELEMETRY_TOKEN: "short", TELEMETRY_SALT: S }, "https://play.example/x", "abc")).toEqual({});
    expect(telemetryOn({ TELEMETRY_TOKEN: "short" })).toBe(false);
  });
  it("passes the ingest URL, token, salt, source and commit", () => {
    expect(telemetryContainerEnv({ TELEMETRY_TOKEN: T, TELEMETRY_SALT: S }, "https://play.example/matchmake/x?y=1", "abc")).toEqual({
      TELEMETRY_URL: "https://play.example/_internal/telemetry", TELEMETRY_TOKEN: T, TELEMETRY_SOURCE: "live", TELEMETRY_SALT: S, GAME_SOURCE_COMMIT: "abc",
    });
    expect(telemetryContainerEnv({ TELEMETRY_TOKEN: T, TELEMETRY_SALT: "weak" }, "https://play.example/", null)).toEqual({
      TELEMETRY_URL: "https://play.example/_internal/telemetry", TELEMETRY_TOKEN: T, TELEMETRY_SOURCE: "live",
    });
  });
});
