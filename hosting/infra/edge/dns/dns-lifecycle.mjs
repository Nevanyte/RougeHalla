#!/usr/bin/env node
// Per-placement DNS record lifecycle (practice zone only). DRY-RUN BY DEFAULT: prints the Cloudflare requests it would make.
//
//   node dns-lifecycle.mjs upsert --region us-west-2 --placement-id rh-req00001-1 --ip 203.0.113.9 [--zone g.rougehalla.com] [--ttl 60]
//   node dns-lifecycle.mjs delete --region us-west-2 --placement-id rh-req00001-1
//   node dns-lifecycle.mjs sweep  --active active-hostnames.json [--min-age-min 15]
//   node dns-lifecycle.mjs verify --region us-west-2 --placement-id rh-req00001-1   # READ-ONLY: asks the zone's authoritative servers
//
// A real write needs `--apply`, RH_EDGE_ALLOW_DNS_WRITES=yes, CLOUDFLARE_API_TOKEN (Zone DNS Edit on rougehalla.com only) and
// CLOUDFLARE_ZONE_ID. Nothing in this repository sets any of them. Never run with the production domain: it is refused.
import { readFileSync } from "node:fs";
import { CloudflareDns, resolveAuthoritative } from "./cloudflare.mjs";
import { gameHostname } from "./hostname.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);
const zone = flag("zone", "g.rougehalla.com");
const ttl = Number(flag("ttl", "60"));
if (cmd === "upsert" && (!Number.isInteger(ttl) || ttl < 60)) {
  console.error(`--ttl must be an integer of at least 60 (Cloudflare's minimum), got ${JSON.stringify(flag("ttl"))}`);
  process.exit(2);
}
const apply = has("apply");
if (apply && process.env.RH_EDGE_ALLOW_DNS_WRITES !== "yes") {
  console.error("refusing --apply: set RH_EDGE_ALLOW_DNS_WRITES=yes after the change was reviewed (docs/hosting/TLS_DNS.md)");
  process.exit(2);
}
try {
  const dns = new CloudflareDns({ zone, apply, zoneId: process.env.CLOUDFLARE_ZONE_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  let result;
  if (cmd === "upsert") {
    const name = gameHostname(flag("region"), flag("placement-id"), zone);
    result = await dns.upsert(name, flag("ip"), ttl, flag("placement-id"));
    result.name = name;
  } else if (cmd === "delete") {
    const name = gameHostname(flag("region"), flag("placement-id"), zone);
    result = await dns.delete(name);
    result.name = name;
  } else if (cmd === "sweep") {
    const active = new Set(JSON.parse(readFileSync(flag("active"), "utf8")));
    result = await dns.sweep(active, Number(flag("min-age-min", "15")) * 60_000);
  } else if (cmd === "verify") {
    const name = gameHostname(flag("region"), flag("placement-id"), zone);
    result = { name, ...(await resolveAuthoritative(name, zone)) };
  } else {
    console.error("usage: dns-lifecycle.mjs upsert|delete|sweep|verify ... [--apply]");
    process.exit(2);
  }
  console.log(JSON.stringify({ mode: apply ? "APPLIED" : "DRY-RUN (nothing sent)", zone, result, requests: dns.requests }, null, 2));
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
