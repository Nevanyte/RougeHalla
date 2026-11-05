# Browser WSS: TLS and DNS for per-placement hosts (P-HOST-2)

Status: **designed and prepared as files; the local WSS/TLS path is proven; no certificate was issued, no DNS record written, nothing deployed.**
Written 2026-11-05. Practice domain **rougehalla.com**; production **play.roguehalla.com** (note the spelling) is never touched, and the tooling refuses it in code.

## 1. The problem

A browser page on `https://...` may only open `wss://` sockets, and the TLS certificate must be valid for the *exact hostname* it dials. GameLift
returns an IP and a port for a container fleet; it has no certificate for us (section 2). So every placement needs a **hostname we control** and a
**certificate valid for it**, on a non-443 port (the connection range is chosen by GameLift).

## 2. Verified facts (read 2026-11-05)

| Fact | Source |
|---|---|
| Container fleets: "game clients connect directly to your cloud-hosted game servers"; GameLift "provides connection information (IP and port)"; the instance's external ports are the fleet's `InstanceConnectionPortRange` mapped to container ports. | developerguide `containers-howitworks.html` |
| `CreateContainerFleet` request syntax has **no certificate/TLS field**. | apireference `API_CreateContainerFleet.html` |
| Placement `DnsName`: TLS-enabled fleets `<id>.<region>.amazongamelift.com` ("you must use the DNS name, not the IP"); non-TLS fleets `ec2-<id>.compute.amazonaws.com`. A container fleet cannot request TLS, so it gets the second form, a name under a domain we cannot certify. | apireference `API_GameSessionPlacement.html` |
| Default inbound permission is **UDP**; for TCP/WSS both `InstanceConnectionPortRange` and `InstanceInboundPermissions` must be set by hand (`Protocol: TCP`, `IpRange` the open range); the container port is picked at random from the range. Reserved: `4092-4191`. | `containers-design-fleet.html`, `API_CreateContainerFleet.html` |
| Fleet-role credentials are **injected into every container**; `GetFleetRoleCredentials()` returns the same; "only accessible inside containers". `EnvironmentOverride` is plain environment (max 20 variables), there is no secrets mechanism in the container definition. VPC peering is not supported for container fleets. | `gamelift-sdk-server-resources.html`, `API_GameServerContainerDefinitionInput.html` |
| **ACM "exportable public certificates"** exist now: export certificate, key and chain for use "anywhere, including containers"; 198-day validity; ACM renews 45 days before expiry and you must redeploy; price **USD 7 per FQDN and USD 79 per wildcard name, charged at issuance and again at each renewal**; DNS validation only. | `docs.aws.amazon.com/acm/latest/userguide/acm-exportable-certificates.html`, `aws.amazon.com/certificate-manager/pricing/` |
| Let's Encrypt limits: 50 new certificates per registered domain per 7 days, **5 per exact identifier set per 7 days** (no override), 5 authorization failures per identifier per hour. Renewals (same identifier set) are exempt from the first. Lifetimes: 90 days now; **64 days from 2027-02-10** (authorization reuse 10 days); 45 days from 2028-02-16; an opt-in 45-day profile since 2026-05-13. | `letsencrypt.org/docs/rate-limits/`, `letsencrypt.org/2025/12/02/from-90-to-45` |
| Cloudflare DNS API: `POST /zones/{zone_id}/dns_records`; TTL minimum **60 s** (30 on Enterprise); token permission named "DNS Write". Delete/list endpoints, per-zone token scoping and API rate limits: UNVERIFIED (not read). | `developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/` |
| `lego` flags used by the issuer script were checked against `goacme/lego:v4.25.2 --help`. | local |
| **Where the zone is hosted** (read-only `dig NS rougehalla.com +short`, 2026-11-05): `cruz.ns.cloudflare.com.`, `leif.ns.cloudflare.com.` -> **Cloudflare**, not Route 53. `roguehalla.com` (production) is also on Cloudflare. | `dig` |

UNVERIFIED: whether `GetComputeCertificate` works on a container fleet (re:Post reports no; the staging step tests it); whether port 443 is allowed in
`InstanceConnectionPortRange` (a 443 range would remove corporate-firewall risk but allows one process per instance); whether two containers of a group can
share an instance path via `MountPoints`.

## 3. Options and decision

| Option | Verdict |
|---|---|
| **A. Our wildcard certificate (`*.g.rougehalla.com`, Let's Encrypt DNS-01) served by `rh-server` (`--tls-cert/--tls-key`) + one DNS-only A record per placement** | **Chosen.** Free, no new always-on service, keeps the browser's connection direct to the game process (no extra hop, so the probe and the game see the same path), and the Rust server already serves PEM files (proved locally, section 7). |
| B. A TLS-terminating proxy layer per Region (NLB/ALB/own proxy) in front of the fleet | Fallback. Needs a proxy path to GameLift-managed instances whose VPC we do not own (VPC peering is unsupported for container fleets; public-IP targets for AWS load balancers: UNVERIFIED), an always-on tier per Region (spend, ops), and adds a hop to every game packet. Switch to it only if A fails a trigger in section 9. Its advantage: no private key on game hosts. |
| C. GameLift-provided TLS | Not available for container fleets (no request field; `DnsName` is the EC2 name). `GetComputeCertificate` on containers: UNVERIFIED, tested in staging, expected to fail. |
| D. ACM exportable public wildcard | Rejected for staging: USD 79 per issuance and again per renewal exceeds the whole CAD 20 staging cap at any plausible exchange rate; it also needs AWS access from the issuer. Revisit for production (198-day validity is attractive; the 45-day redeploy and renewal fee are not). |
| E. One certificate per host | Rejected: 50/week and 5-per-name limits, and every name is published in Certificate Transparency logs. A wildcard publishes one name. |
| F. Per-IP names via a wildcard DNS service (`1-2-3-4.example`) | Rejected: depends on a third party's availability and trust for our game traffic. |

DNS provider for the per-placement records: **Cloudflare** (the zone is already there, no new billable resource, no cross-provider delegation). Its cost is
blast radius: a Cloudflare token is scoped by zone, not by record name (UNVERIFIED), so the placement service's token could edit every `rougehalla.com` record.
Mitigations in the tool (section 5) and a hardening option for the owner: delegate only `g.rougehalla.com` to a Route 53 hosted zone (one NS record added in
Cloudflare once; Route 53 hosted zone price UNVERIFIED), after which IAM can restrict the placement service to that subtree. Decision pending; the code is written
against a narrow interface (`DnsBackend`), so either works.

## 4. Certificate: issuance, distribution, renewal

- Name: `*.g.rougehalla.com` (single label wildcard: placement hostnames are `<region>-<12 base32 chars>.g.rougehalla.com`, one label, from
  `crates/rh-placement/src/hostname.rs`; a two-label name does not match, asserted in the local proof). Key type EC P-256. Separate zone label `g.` so the key never
  covers the web site or API hostnames.
- Issuance: `hosting/infra/edge/cert/issue-wildcard.sh` (dry-run by default: prints the pinned `lego` commands; `--run` needs `RH_EDGE_ALLOW_CERT_ISSUE=yes`, a
  DNS-edit token **separate from the placement service's**, and the practice zone). Staging CA first: it proves DNS-01 without spending the 5-per-name budget.
- Storage: an empty Secrets Manager secret shell `rh/edge/wildcard-cert` (template `queue.cfn.yaml`); the issuer writes the PEM bundle, nothing else has write access.
- **Distribution to game hosts** (the weak point of option A): the private key must reach each `rh-server`. The game process must hold no AWS credential and the
  bridge only uses the GameLift Server SDK, so the proposal is a small **certificate-sync support container** in the game server container group (non-essential,
  `GetSecretValue` on the one secret through the fleet role, writes `fullchain.pem` and `key.pem` where the bridge's `GLBRIDGE_TLS_CERT/KEY` point, then sleeps and
  refreshes). Whether containers of a group can share a path (`MountPoints` to an instance path) is UNVERIFIED; the fallback is a tiny pre-start step in the image
  entrypoint that fetches the bundle with the injected credentials before `glbridge` starts (the credentials are present in the container either way). The key never
  appears in the image, the container definition, an environment variable or a log. This belongs to the fleet package (`hosting/infra/fleet/**`), which is told in the report.
- **Exposure, stated plainly:** anyone who reads the key from a compromised game host can impersonate any `*.g.rougehalla.com` name to a client whose DNS they can
  also spoof. Limits: the `g.` subtree only, short lifetime, revocation, one process per session, hosts replaced every 30 days (AWS recommendation). Option B removes it.
- **Renewal and process age.** `rh-server` reads the PEM files once at start (`RustlsConfig::from_pem_file`; no reload in the code today). A process therefore
  presents the certificate that existed when it started. Rule: *renew when at most one third of the lifetime remains, and never let a process live longer than
  (lifetime - renewal lead - margin)*. With 90-day certificates renewed at 30 days, 30-day fleet replacement and one-session processes this holds; at the 64-day
  lifetime (2027-02-10) renew at ~21 days left; at 45 days (2028) renew at 15 days and replace idle processes within 14 days (fleet package: scheduled replacement). A
  reload-on-change in `rh-server` would remove the rule but touches `crates/rh-server`; not done here (proposal: `RustlsConfig::reload_from_pem_file` on a timer, optional).
- **Trade-off in the fleet role, and its minimisation.** Fleet-role credentials are injected into *every* container of the group (AWS docs, section 1), so the
  internet-facing match container can read the wildcard-cert secret, not only the sync container. This design accepts that for staging. It is minimised, not
  removed: `CertReaderPolicy` allows `secretsmanager:GetSecretValue` on exactly one secret ARN (no wildcard, no `Describe`/`List`), only over TLS
  (`aws:SecureTransport`; a `secretsmanager:VersionStage` condition was left out because its effect on a request without a stage is UNVERIFIED); the key is EC P-256 on a `g.` wildcard with a short life; and nothing else in the account is reachable
  from the match container (the placement service's policy is a different principal). A secret **resource policy** naming the fleet role would not help (the
  role is the problem, not the secret), and a second role for the sync container is not possible on container fleets (one role per fleet, UNVERIFIED beyond the docs
  quoted in section 1).
- **Alternative: no wildcard key on game hosts** (clearly a different architecture; not implemented, listed so the owner can choose it knowingly):
  1. *Proxy layer* (option B): TLS terminates on a small always-on tier per Region (NLB with TLS listeners or an own proxy) that forwards plain `ws` to the game
     process. The key lives only on that tier; the fleet role then needs no secret permission at all (delete `CertReaderPolicy`). Costs: the tier's spend and
     ops, an extra hop, and a network path to GameLift-managed instances (VPC peering is unsupported for container fleets; public-IP targets: UNVERIFIED).
  2. *Per-host short-lived certificate*: each host obtains its own certificate for its own `<region>-<token>.g.rougehalla.com` name (ACME DNS-01 through a **signing
     service we run**, not from the host; the host only sends a CSR for the one name it was placed under, authenticated by its GameLift player-session/compute
     identity). A stolen key then impersonates one name for hours, not the whole `g.` subtree. Costs: Let's Encrypt limits (50 certificates per registered
     domain per week, 5 per exact name) make this unusable at match rate on Let's Encrypt; it needs a CA/ACME provider with high issuance limits or a private CA
     trusted by the client (not possible for browsers). Treat it as viable only with such a provider.
- Let's Encrypt's 5-per-exact-name limit means a failed pipeline cannot be re-run more than five times a week: use staging for every experiment.

## 5. Per-placement DNS lifecycle (`hosting/infra/edge/dns/`)

1. Placement `FULFILLED` -> service computes the name from the placement id (`hostname.mjs` / `hostname.rs`, shared test vectors).
2. Upsert an **A record** (AAAA for IPv6), `proxied: false`, TTL 60 (the provider minimum), `comment: "rh-placement <placementId>"`.
3. **Verify at the authoritative servers** (`dns-lifecycle.mjs verify`, or the `DnsBackend::resolve_authoritative` trait method) until all of the zone's name servers
   agree on the address (<= 10 s budget), and only then hand the name to the client. Reason: a recursive resolver caches a *miss* for the zone's negative TTL; a client
   that resolves before the record exists could stall for minutes.
4. At session end the backend calls `release_host`; a **janitor** (`sweep`) deletes marked records older than 15 minutes that are not in the active-session list.
5. Only records carrying the marker **and** the exact hostname shape are ever updated or deleted; a record without the marker is refused, so the tool cannot touch
   `www`, `api` or anything hand-made. The tool is idempotent (same name+IP is a no-op; a changed IP updates in place; deleting a missing record succeeds).
6. Safety: dry-run by default (prints the requests, token never included); `--apply` needs `RH_EDGE_ALLOW_DNS_WRITES=yes`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`;
   the zone must end in `rougehalla.com` (`roguehalla.com` and everything else is refused, tested). Two separate tokens: placement service (records) and issuer (the ACME TXT).
- Cost of the design: one DNS write per match, about 60 s of TTL, one verification read. The API rate limit is UNVERIFIED; at 200 concurrent matches the write rate is low
  but must be checked before a load test.
- Failure modes covered by the orchestration tests: provider outage (retry x3, then release the host and tell the player), slow propagation (waits, then releases),
  duplicate request (same record), crash between placement and DNS (sweep removes the record; an unclaimed session ends by the server's own timeout).

## 6. Probe origins

`GET /ping` on a game process answers `pong`, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`. Per Region one stable name `probe-<region>.g.rougehalla.com`
(DNS-only A record, same wildcard certificate, 443 or a fixed port) points at an always-on host running the same `rh-server` binary in that Region, so the probe terminates
TLS at an origin's own certificate; a CDN or any cache in between would need a different certificate and could not serve this name. Cost of the always-on host: UNVERIFIED
(not estimated; not created). Idle game processes also answer `/ping`, but their ports are random per process, so they are not a stable probe target. No server change was needed.

## 7. Local proof (2026-11-05, this machine: Apple M5 Pro, macOS arm64, native; rh-server debug build of this branch)

`hosting/placement/probe/local-proof.mjs` (raw output kept at `target/local-proof.json` by the report; verdict **PASS**, Chromium 156 from Playwright 1.64.0):

- `rh-server --tls-cert chain.pem --tls-key leaf.key` with a local CA and a leaf for `*.g.rougehalla.test, localhost, 127.0.0.1` (EC P-256).
- Node verifies chain **and** hostname against the CA: `us-west-2-me6lguklsmky.g.rougehalla.test:<random port>` -> 200 `pong`, `no-store`, CORS `*`; `www.rougehalla.test` and
  `x.us-west-2-....g.rougehalla.test` -> `ERR_TLS_CERT_ALTNAME_INVALID`; no CA -> `SELF_SIGNED_CERT_IN_CHAIN`.
- WSS upgrade over that verified connection: `101`.
- Probe module over verified TLS: 5 samples; and over the built-in `--self-signed` listener only with `NODE_TLS_REJECT_UNAUTHORIZED=0` in the probe child; without it the probe reports the region unreachable.
- Chromium: page at `https://us-west-2-....g.rougehalla.test:<port>/probe` completes the WSS Hello/Welcome and ping-pong; the probe times a **cross-origin** `/ping` on a second server (CORS);
  probe median 1.1 ms vs WSS median 0.4 ms (loopback: mechanism only, tolerance floor 5 ms).
- `node tools/browser-proof/proof.mjs` (existing proof, `--self-signed`): **PASS** (all checks), needs the npm package `playwright` (not in `package.json`; used Playwright 1.64.0 from a scratch install via `NODE_PATH`, matching the cached Chromium revision 1248).

**Browser trust caveat.** `--self-signed` produces a certificate no browser trusts. Chromium here ran with certificate errors ignored; macOS gives no per-process trust store without changing
system settings (not done). A Unity WebGL or normal user session cannot click through a certificate error on a `wss://` socket. So the real-certificate browser test is **NOT RUN** (section 8).

## 8. NOT RUN (cloud / owner decisions) and exact prerequisites

| Item | Command | Needs |
|---|---|---|
| Issue the wildcard on the staging CA | `RH_EDGE_ALLOW_CERT_ISSUE=yes CLOUDFLARE_DNS_API_TOKEN=... LEGO_EMAIL=... hosting/infra/edge/cert/issue-wildcard.sh --run` | owner-approved DNS token on rougehalla.com (creates/removes `_acme-challenge.g` TXT), Docker |
| Issue on the production CA | same with `--production` | staging success first (5/week per exact name) |
| Store in Secrets Manager | `aws secretsmanager put-secret-value --secret-id rh/edge/wildcard-cert --secret-string file://bundle.json` | AWS credential, stack `queue.cfn.yaml` |
| One real record | `RH_EDGE_ALLOW_DNS_WRITES=yes CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... node hosting/infra/edge/dns/dns-lifecycle.mjs upsert --region us-west-2 --placement-id rh-req00001-1 --ip <IpAddress> --apply` then `... verify ...` and `delete ... --apply` | owner approval for a practice-domain write |
| Chrome, Firefox, Safari to a real host | open `https://<an app page on rougehalla.com>` and `new WebSocket("wss://<host>:<port>/ws")` | the above and a placed host; Safari is stricter on chains; record time from `FULFILLED` to first handshake (target < 10 s) |
| Non-443 reachability on restrictive networks | same, from a corporate/school network | a placed host |
| `GetComputeCertificate` on a container fleet | log its result from the bridge | staging fleet |
| Regional probes and calibration | PLACEMENT.md sections 7 and 8 | probe hosts |

## 9. When to switch to option B (a proxy layer)

Any one of: `GetComputeCertificate`/DNS flow cannot hold the "< 10 s from `FULFILLED` to handshake" target; Safari or a target network refuses the non-443 range
and port 443 is not allowed in `InstanceConnectionPortRange`; the owner will not accept the wildcard key on game hosts; Cloudflare API limits cannot carry the match rate.

## 10. Files

`hosting/infra/edge/{queue.cfn.yaml, cert/issue-wildcard.sh, dns/{hostname.mjs,cloudflare.mjs,dns-lifecycle.mjs,dns.test.mjs}}`, `hosting/placement/vectors/hostnames.json`,
`crates/rh-placement/src/hostname.rs`. Template check: `cfn-lint 1.59.0` in `python:3.13-slim`, no findings. `TerminateGameSession`, `StopGameSessionPlacement` and `DescribeGameSessionPlacement` have **no** resource-level
permissions (VERIFIED 2026-11-05 against AWS's service reference for the `gamelift` prefix, `https://servicereference.us-east-1.amazonaws.com/v1/gamelift/gamelift.json` v1.5: empty
resource list for all three; only `StartGameSessionPlacement` names a resource, the queue), so the placement policy keeps `Resource: "*"` for them.
