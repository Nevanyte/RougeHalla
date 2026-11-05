// Per-placement DNS record lifecycle against the Cloudflare DNS API, for the practice zone only.
//
// Safe by construction:
//  * dry-run is the default: nothing is sent, the planned requests are returned (token never included);
//  * a real write needs `apply: true` AND the zone under the practice domain `rougehalla.com`. The production domain
//    `roguehalla.com` (note the spelling) and every other zone are refused in code, not by convention;
//  * records are DNS-only (proxied: false): the game port is not an HTTP(S) port Cloudflare proxies, and an origin-IP-in-DNS
//    record is the point of this design (TLS_DNS.md);
//  * every record this module creates carries the comment marker below, and the sweeper deletes only records that have the
//    marker AND the exact hostname shape of hostname.mjs, so it can never touch the web site or API records.
import { Resolver } from "node:dns/promises";
import { isGameHostname } from "./hostname.mjs";

export const API = "https://api.cloudflare.com/client/v4";
export const MARKER = "rh-placement";
const PRACTICE = /(^|\.)rougehalla\.com$/;
const MIN_TTL_S = 60; // Cloudflare: minimum 60 s on non-Enterprise zones (API docs read 2026-11-05).

export function assertPracticeZone(zone) {
  if (!PRACTICE.test(zone)) throw new Error(`refusing zone ${JSON.stringify(zone)}: only the practice domain rougehalla.com is allowed`);
  if (/roguehalla\.com$/.test(zone)) throw new Error("refusing the production domain");
}

export function ipType(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split(".").every((o) => Number(o) <= 255)) return "A";
  if (/^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":")) return "AAAA";
  throw new Error(`not an IP address: ${JSON.stringify(ip)}`);
}

export class CloudflareDns {
  /** @param {{zone:string, zoneId?:string, token?:string, apply?:boolean, fetchImpl?:typeof fetch, now?:()=>number}} o */
  constructor({ zone, zoneId, token, apply = false, fetchImpl = globalThis.fetch, now = Date.now }) {
    assertPracticeZone(zone);
    if (apply && (!zoneId || !token)) throw new Error("apply needs zoneId and token (CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN)");
    Object.assign(this, { zone, zoneId, token, apply, fetchImpl, now });
    /** Planned or executed requests, token redacted. */
    this.requests = [];
    this.zoneVerified = false;
  }

  /**
   * Before the first real request: the zone id must belong to the validated zone name (a wrong CLOUDFLARE_ZONE_ID would send
   * the writes to another zone). Read-only lookup; the Cloudflare zone is the registered domain, so `g.rougehalla.com` lives
   * in zone `rougehalla.com`. Fails closed on any mismatch or error.
   */
  async #verifyZone() {
    if (this.zoneVerified) return;
    const url = `${API}/zones/${this.zoneId}`;
    this.requests.push({ method: "GET", url, body: null, executed: true });
    const res = await this.fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(`cloudflare GET zone: HTTP ${res.status} ${JSON.stringify(json.errors ?? [])}`);
    const name = json.result?.name;
    if (typeof name !== "string" || !(this.zone === name || this.zone.endsWith(`.${name}`))) {
      throw new Error(`refusing: CLOUDFLARE_ZONE_ID belongs to zone ${JSON.stringify(name)}, not to ${JSON.stringify(this.zone)}`);
    }
    assertPracticeZone(name);
    this.zoneVerified = true;
  }

  async #call(method, path, body) {
    const url = `${API}/zones/${this.zoneId ?? "<ZONE_ID>"}${path}`;
    this.requests.push({ method, url, body: body ?? null, executed: this.apply });
    if (!this.apply) return { success: true, result: method === "GET" ? [] : {}, dryRun: true };
    await this.#verifyZone();
    const res = await this.fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(`cloudflare ${method} ${path}: HTTP ${res.status} ${JSON.stringify(json.errors ?? [])}`);
    return json;
  }

  #checkName(name) {
    if (!isGameHostname(name, this.zone)) throw new Error(`refusing ${JSON.stringify(name)}: not a game hostname under ${this.zone}`);
  }

  async find(name) {
    const r = await this.#call("GET", `/dns_records?name=${encodeURIComponent(name)}&per_page=100`);
    return r.result;
  }

  /** Create or replace the record. Idempotent: the same name+ip is a no-op, a different ip updates in place. */
  async upsert(name, ip, ttl = 60, placementId = "") {
    this.#checkName(name);
    if (!Number.isInteger(ttl) || ttl < MIN_TTL_S) throw new Error(`ttl ${ttl} below the provider minimum ${MIN_TTL_S}`);
    const type = ipType(ip);
    const body = { type, name, content: ip, ttl, proxied: false, comment: `${MARKER} ${placementId}`.trim() };
    const existing = (await this.find(name)).filter((r) => r.type === type || r.type === "A" || r.type === "AAAA");
    for (const r of existing) {
      if (!(r.comment ?? "").startsWith(MARKER)) throw new Error(`refusing to overwrite ${name}: a record without the ${MARKER} marker exists`);
    }
    const same = existing.find((r) => r.type === type);
    if (same && same.content === ip && same.ttl === ttl) return { action: "unchanged" };
    if (same) {
      await this.#call("PUT", `/dns_records/${same.id}`, body);
      return { action: "updated" };
    }
    await this.#call("POST", "/dns_records", body);
    return { action: "created" };
  }

  /** Delete the record if it is ours. A missing record is success (the janitor and the session-end hook may both run). */
  async delete(name) {
    this.#checkName(name);
    const existing = await this.find(name);
    let n = 0;
    for (const r of existing) {
      if (!(r.comment ?? "").startsWith(MARKER)) throw new Error(`refusing to delete ${name}: record without the ${MARKER} marker`);
      await this.#call("DELETE", `/dns_records/${r.id}`);
      n++;
    }
    return { deleted: n };
  }

  /** Delete marked game records not in `active` (hostnames) that are older than `minAgeMs`. */
  async sweep(active, minAgeMs = 15 * 60_000) {
    if (!Number.isFinite(minAgeMs) || minAgeMs < 0) throw new Error(`min age ${minAgeMs} is not a non-negative number`);
    const r = await this.#call("GET", `/dns_records?comment.startswith=${MARKER}&per_page=5000`);
    const out = { kept: [], deleted: [], skipped: [] };
    for (const rec of r.result) {
      if (!isGameHostname(rec.name, this.zone) || !(rec.comment ?? "").startsWith(MARKER)) {
        out.skipped.push(rec.name);
      } else if (active.has(rec.name) || !Number.isFinite(Date.parse(rec.created_on)) || this.now() - Date.parse(rec.created_on) < minAgeMs) {
        // An unparsable or missing created_on is "keep": a record of unknown age is never deleted.
        out.kept.push(rec.name);
      } else {
        await this.#call("DELETE", `/dns_records/${rec.id}`);
        out.deleted.push(rec.name);
      }
    }
    return out;
  }
}

/** The registered domain of a zone (`g.rougehalla.com` -> `rougehalla.com`). Two-label public suffixes are not supported (not needed). */
export function apexOf(zone) {
  return zone.split(".").slice(-2).join(".");
}

/**
 * What the zone's AUTHORITATIVE name servers answer for `name` right now (all of them must agree on the address before a client
 * is given the name: a recursive resolver caches a miss for the negative TTL). Read-only.
 * @param {{ns?: (apex:string)=>Promise<string[]>, address?: (host:string)=>Promise<string[]>, query?: (server:string, name:string)=>Promise<string[]>}} io injectable for tests
 * @returns {Promise<{servers:string[], answers:Record<string,string[]>, agree:boolean, addresses:string[]}>}
 */
export async function resolveAuthoritative(name, zone, io = {}) {
  assertPracticeZone(zone);
  const ns = io.ns ?? ((apex) => new Resolver().resolveNs(apex));
  const address = io.address ?? (async (h) => (await new Resolver().resolve4(h)));
  const query = io.query ?? (async (server, n) => {
    const r = new Resolver();
    r.setServers([server]);
    try { return [...(await r.resolve4(n)), ...(await r.resolve6(n).catch(() => []))]; } catch (e) { if (e.code === "ENODATA" || e.code === "ENOTFOUND") return []; throw e; }
  });
  const hosts = await ns(apexOf(zone));
  const servers = (await Promise.all(hosts.map(address))).flat();
  const answers = {};
  for (const s of servers) answers[s] = (await query(s, name)).sort();
  const lists = Object.values(answers).map((a) => a.join(","));
  const agree = lists.length > 0 && lists.every((l) => l === lists[0]);
  return { servers, answers, agree, addresses: agree ? Object.values(answers)[0] : [] };
}
