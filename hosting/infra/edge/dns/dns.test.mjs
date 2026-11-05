import test from "node:test";
import { Resolver } from "node:dns/promises";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CloudflareDns, MARKER, assertPracticeZone, ipType, apexOf, resolveAuthoritative } from "./cloudflare.mjs";
import { gameHostname, isGameHostname, regionOk, token } from "./hostname.mjs";

const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../../placement/vectors/hostnames.json", import.meta.url)), "utf8"));
const ZONE = "g.rougehalla.com";

// A tiny in-memory Cloudflare.
function fakeCf(initial = []) {
  const records = [...initial];
  let seq = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const method = init.method;
    calls.push({ method, path: u.pathname + u.search, auth: init.headers.authorization });
    if (u.pathname === "/client/v4/zones/zone1") return { ok: true, status: 200, json: async () => ({ success: true, result: { id: "zone1", name: "rougehalla.com" } }) };
    if (/^\/client\/v4\/zones\/[^/]+$/.test(u.pathname)) return { ok: true, status: 200, json: async () => ({ success: true, result: { id: "other", name: "other.example" } }) };
    const body = init.body ? JSON.parse(init.body) : null;
    const ok = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });
    if (method === "GET") {
      const name = u.searchParams.get("name");
      if (name) return ok(records.filter((r) => r.name === name));
      return ok(records.filter((r) => (r.comment ?? "").startsWith(u.searchParams.get("comment.startswith") ?? "")));
    }
    if (method === "POST") { const r = { id: `id${++seq}`, created_on: new Date(0).toISOString(), ...body }; records.push(r); return ok(r); }
    const id = u.pathname.split("/").pop();
    const i = records.findIndex((r) => r.id === id);
    if (method === "PUT") { records[i] = { ...records[i], ...body }; return ok(records[i]); }
    if (method === "DELETE") { records.splice(i, 1); return ok({ id }); }
    throw new Error("unexpected " + method);
  };
  return { records, calls, fetchImpl };
}
const mk = (cf, extra = {}) => new CloudflareDns({ zone: ZONE, zoneId: "zone1", token: "SECRET", apply: true, fetchImpl: cf.fetchImpl, ...extra });

test("hostnames match the shared vectors (Rust computes the same)", () => {
  for (const c of vectors.cases) assert.equal(gameHostname(c.region, c.placementId, vectors.zone), c.hostname);
  assert.equal(token("x").length, 12);
});

test("hostname shape guard", () => {
  const h = gameHostname("us-west-2", "rh-req00001-1", ZONE);
  assert.ok(isGameHostname(h, ZONE));
  for (const bad of ["www.rougehalla.com", `api.${ZONE}`, `a.b.${ZONE}`, `us-west-2-short.${ZONE}`, `${h}.evil.com`]) assert.ok(!isGameHostname(bad, ZONE), bad);
  assert.throws(() => gameHostname("US", "p", ZONE));
  assert.throws(() => gameHostname("us-west-2", "p", "*.g.rougehalla.com"));
});

test("dry run sends nothing and never contains the token", async () => {
  let fetched = 0;
  const dns = new CloudflareDns({ zone: ZONE, apply: false, fetchImpl: async () => { fetched++; } });
  const name = gameHostname("us-west-2", "rh-req00001-1", ZONE);
  assert.deepEqual(await dns.upsert(name, "203.0.113.9", 60, "rh-req00001-1"), { action: "created" });
  assert.equal(fetched, 0);
  assert.ok(dns.requests.some((r) => r.method === "POST" && !r.executed));
  assert.ok(!JSON.stringify(dns.requests).includes("Bearer"));
});

test("only the practice domain is allowed; the production domain is refused", () => {
  assert.doesNotThrow(() => assertPracticeZone("g.rougehalla.com"));
  assert.doesNotThrow(() => assertPracticeZone("rougehalla.com"));
  for (const z of ["play.roguehalla.com", "roguehalla.com", "g.roguehalla.com", "example.com", "rougehalla.com.evil.net", "xrougehalla.com"]) {
    assert.throws(() => assertPracticeZone(z), undefined, z);
    assert.throws(() => new CloudflareDns({ zone: z }), undefined, z);
  }
});

test("apply requires credentials", () => {
  assert.throws(() => new CloudflareDns({ zone: ZONE, apply: true }));
});

test("upsert creates, is idempotent, updates a changed ip, and sends a DNS-only marked record", async () => {
  const cf = fakeCf();
  const dns = mk(cf);
  const name = gameHostname("ca-central-1", "rh-req00002-1", ZONE);
  assert.deepEqual(await dns.upsert(name, "198.51.100.7", 60, "rh-req00002-1"), { action: "created" });
  assert.equal(cf.records.length, 1);
  assert.equal(cf.records[0].proxied, false);
  assert.equal(cf.records[0].type, "A");
  assert.ok(cf.records[0].comment.startsWith(MARKER));
  assert.deepEqual(await dns.upsert(name, "198.51.100.7", 60, "rh-req00002-1"), { action: "unchanged" });
  assert.deepEqual(await dns.upsert(name, "198.51.100.8", 60, "rh-req00002-1"), { action: "updated" });
  assert.equal(cf.records.length, 1);
  assert.equal(cf.records[0].content, "198.51.100.8");
  assert.ok(cf.calls.every((c) => c.auth === "Bearer SECRET"));
  assert.ok(!JSON.stringify(dns.requests).includes("SECRET"));
});

test("AAAA for IPv6 and bad input is rejected before any call", async () => {
  assert.equal(ipType("2001:db8::1"), "AAAA");
  assert.equal(ipType("203.0.113.9"), "A");
  assert.throws(() => ipType("999.1.1.1"));
  const cf = fakeCf();
  const dns = mk(cf);
  const name = gameHostname("us-west-2", "rh-req00003-1", ZONE);
  await assert.rejects(dns.upsert(name, "not-an-ip"));
  await assert.rejects(dns.upsert(name, "203.0.113.9", 10), /below the provider minimum/);
  await assert.rejects(dns.upsert("www.g.rougehalla.com", "203.0.113.9"));
  assert.equal(cf.calls.length, 0);
});

test("never overwrites or deletes a record it did not create", async () => {
  const name = gameHostname("us-west-2", "rh-req00004-1", ZONE);
  const cf = fakeCf([{ id: "x1", type: "A", name, content: "192.0.2.1", ttl: 60, comment: "hand made" }]);
  const dns = mk(cf);
  await assert.rejects(dns.upsert(name, "203.0.113.9"), /without the rh-placement marker/);
  await assert.rejects(dns.delete(name), /without the rh-placement marker/);
  assert.equal(cf.records.length, 1);
});

test("delete is idempotent", async () => {
  const cf = fakeCf();
  const dns = mk(cf);
  const name = gameHostname("us-west-2", "rh-req00005-1", ZONE);
  await dns.upsert(name, "203.0.113.9", 60, "rh-req00005-1");
  assert.deepEqual(await dns.delete(name), { deleted: 1 });
  assert.deepEqual(await dns.delete(name), { deleted: 0 });
});

test("sweep deletes only old, unmarked-as-active game records and skips everything else", async () => {
  const old = gameHostname("us-west-2", "rh-old000001-1", ZONE);
  const live = gameHostname("us-west-2", "rh-live00001-1", ZONE);
  const fresh = gameHostname("us-west-2", "rh-fresh0001-1", ZONE);
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const cf = fakeCf([
    { id: "1", type: "A", name: old, content: "1.1.1.1", comment: `${MARKER} x`, created_on: day },
    { id: "2", type: "A", name: live, content: "1.1.1.2", comment: `${MARKER} y`, created_on: day },
    { id: "3", type: "A", name: fresh, content: "1.1.1.3", comment: `${MARKER} z`, created_on: new Date().toISOString() },
    { id: "4", type: "A", name: "www.rougehalla.com", content: "1.1.1.4", comment: `${MARKER} sneaky`, created_on: day },
    { id: "5", type: "A", name: "api.g.rougehalla.com", content: "1.1.1.5", comment: `${MARKER} sneaky`, created_on: day },
  ]);
  const r = await mk(cf).sweep(new Set([live]), 15 * 60_000);
  assert.deepEqual(r.deleted, [old]);
  assert.deepEqual(r.kept.sort(), [live, fresh].sort());
  assert.deepEqual(r.skipped.sort(), ["api.g.rougehalla.com", "www.rougehalla.com"]);
  assert.deepEqual(cf.records.map((x) => x.id).sort(), ["2", "3", "4", "5"]);
});

test("a Cloudflare error surfaces without leaking the token", async () => {
  const dns = new CloudflareDns({ zone: ZONE, zoneId: "z", token: "SECRET", apply: true, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ code: 9109 }] }) }) });
  const name = gameHostname("us-west-2", "rh-req00006-1", ZONE);
  await assert.rejects(dns.upsert(name, "203.0.113.9"), (e) => /403/.test(e.message) && !/SECRET/.test(e.message));
});

test("authoritative verification needs every name server to agree", async () => {
  const name = gameHostname("us-west-2", "rh-req00007-1", ZONE);
  const io = (answers) => ({ ns: async (apex) => { assert.equal(apex, "rougehalla.com"); return ["a.ns", "b.ns"]; }, address: async (h) => [h === "a.ns" ? "10.0.0.1" : "10.0.0.2"], query: async (srv) => answers[srv] });
  const ok = await resolveAuthoritative(name, ZONE, io({ "10.0.0.1": ["203.0.113.9"], "10.0.0.2": ["203.0.113.9"] }));
  assert.deepEqual([ok.agree, ok.addresses], [true, ["203.0.113.9"]]);
  const split = await resolveAuthoritative(name, ZONE, io({ "10.0.0.1": ["203.0.113.9"], "10.0.0.2": [] }));
  assert.deepEqual([split.agree, split.addresses], [false, []]);
  await assert.rejects(resolveAuthoritative("x.play.roguehalla.com", "play.roguehalla.com", io({})));
  assert.equal(apexOf("g.rougehalla.com"), "rougehalla.com");
});

test("a zone id that belongs to another zone is refused before any record request", async () => {
  const cf = fakeCf();
  const dns = new CloudflareDns({ zone: ZONE, zoneId: "zoneX", token: "SECRET", apply: true, fetchImpl: cf.fetchImpl });
  const name = gameHostname("us-west-2", "rh-req00020-1", ZONE);
  await assert.rejects(dns.upsert(name, "203.0.113.9"), /belongs to zone "other.example"/);
  await assert.rejects(dns.delete(name), /belongs to zone/);
  await assert.rejects(dns.sweep(new Set()), /belongs to zone/);
  assert.ok(cf.calls.every((c) => c.path.endsWith("/zones/zoneX")), "only the read-only zone lookup was sent");
  // A matching zone id is verified once, then used.
  const ok = mk(fakeCf());
  await ok.upsert(gameHostname("us-west-2", "rh-req00021-1", ZONE), "203.0.113.9");
  assert.equal(ok.requests.filter((r) => r.url.endsWith("/zones/zone1")).length, 1);
});

test("sweep keeps records whose created_on is missing or unparsable (NaN), and rejects a NaN min age", async () => {
  const a = gameHostname("us-west-2", "rh-nan000001-1", ZONE);
  const b = gameHostname("us-west-2", "rh-nan000002-1", ZONE);
  const cf = fakeCf([
    { id: "1", type: "A", name: a, content: "1.1.1.1", comment: `${MARKER} x`, created_on: "not a date" },
    { id: "2", type: "A", name: b, content: "1.1.1.2", comment: `${MARKER} y` },
  ]);
  const r = await mk(cf).sweep(new Set(), 15 * 60_000);
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(r.kept.sort(), [a, b].sort());
  assert.equal(cf.records.length, 2);
  await assert.rejects(mk(fakeCf()).sweep(new Set(), Number("abc")), /min age/);
});

test("regionOk and gameHostname refuse undefined: no undefined-<token> names", () => {
  assert.equal(regionOk(undefined), false);
  assert.equal(regionOk(null), false);
  assert.equal(regionOk(42), false);
  assert.throws(() => gameHostname(undefined, "rh-req00001-1", ZONE), /not usable/);
  assert.throws(() => gameHostname("us-west-2", undefined, ZONE), /placement id/);
});

test("ttl must be a finite integer of at least 60", async () => {
  const cf = fakeCf();
  const dns = mk(cf);
  const name = gameHostname("us-west-2", "rh-req00022-1", ZONE);
  for (const bad of [NaN, Infinity, 60.5, "60", -1, 59]) await assert.rejects(dns.upsert(name, "203.0.113.9", bad), /ttl/, String(bad));
  assert.equal(cf.calls.length, 0);
  await assert.doesNotReject(dns.upsert(name, "203.0.113.9", 60));
});


test("default authoritative resolver sees AAAA-only hosts and rejects resolver failure", async (t) => {
  const name = gameHostname("us-west-2", "rh-ipv6-1", ZONE);
  t.mock.method(Resolver.prototype, "resolve4", async () => { throw Object.assign(new Error("no A"), { code: "ENODATA" }); });
  t.mock.method(Resolver.prototype, "resolve6", async () => ["2001:db8::1"]);
  const io = { ns: async () => ["ns.example"], address: async () => ["192.0.2.1"] };
  assert.deepEqual((await resolveAuthoritative(name, ZONE, io)).addresses, ["2001:db8::1"]);
  t.mock.method(Resolver.prototype, "resolve6", async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); });
  await assert.rejects(resolveAuthoritative(name, ZONE, io), /timeout/);
});
