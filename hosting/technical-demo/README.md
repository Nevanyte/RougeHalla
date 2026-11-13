# Ephemeral technical demo host

This new preparation is for one **fresh x86-64 Ubuntu 24.04 instance in
ca-west-1**, practice `play.rougehalla.com`, and an original absolute UTC deadline no
more than twelve hours ahead. The historical guest below used the earlier three-hour
limit. The first two actual guests terminated before application
readiness; the second guest proves the NFT syntax error documented below. The
corrected rules pass an actual Ubuntu NFT parser check. Fixed guest03 now passes
installation/native storage readiness, actual isolation/shaping, valid public TLS
and an ordinary browser profile-load/Training/movement/Leave check. The fixed
shutdown was fixed at 2026-11-10 03:50:21 UTC; it was an ephemeral demo and its
cleanup is recorded separately.

The root URL redirects to `index.html` with the ordinary same-origin Training
endpoint selected, so both Arena and Practice are available without operator setup.
No diagnostic mode or synthetic join is enabled by this URL.

`bootstrap.py` intentionally avoids the older host executor's custom AMI,
retained preformatted volume, backup bucket, age tools and recovery contracts.
That executor at `01fe2cf4` is not a drop-in for this demo: its prerequisite
image/toolchain/owner-marked volume/full contract bundle do not exist here.
This demo offers **no retained-data, backup or recovery promise**. Termination
loses profiles, matches, tokens, logs and spool data on the root disk.

Root's shaper adds an fq_codel child after the8mbit TBF so bulk page downloads use per-flow scheduling alongside game
traffic. The parent's latency setting is not a hard queue-delay bound with that child. Kernel acceptance and actual
concurrent-download/game latency remain unexecuted checks; the rate/absolute-lifetime budget is separate.

## Root review and launch prerequisites

Root owns all cloud/IAM/DNS actions, cost checks and activation approval. Before
launch, independently review these new files, verify the selected AMI is the
intended Ubuntu/x86 image, and bind the two artifacts and exact Web endpoint
configuration. Existing local/browser services are untouched.

Launch must set encrypted 8 GiB gp3 root **DeleteOnTermination=true**,
**InstanceInitiatedShutdownBehavior=terminate**, IMDSv2 required, public IPv4,
and only inbound 80/443 (no SSH, database, 7777 or 7779). No NAT/ALB/RDS,
retained volume or cross-region objects. Root separately selects the minimal
EC2/SSM role and exact private-object permission, SSM availability and outbound
apt/S3/ACME access. The application UIDs are blocked from IPv4/IPv6 IMDS by nft
before the artifact is executed; the root bootstrap uses temporary instance
credentials. No account API or credential lookup is performed offline.

No policy is generated here. For Root's separate policy review the applicable
skill recommends this **unexecuted** source-analysis command:

```
uvx iam-policy-autopilot@latest generate-policies /Users/nevinmckinnon/Documents/Projects/RogueHalla/hosting/technical-demo/bootstrap.py --region ca-west-1 --account 048226733033 --service-hints s3 --pretty
```

Review that separately, without running it during this preparation; do not interpret
this preparation as an IAM permission grant. Instance stop/termination, disk,
IPv4 and data transfer charges still require Root's launch packet; a shutdown
timer is not a billing hard cap. Root supplied live ca-west-1 planning figures
of USD0.09/GB egress and USD0.0232/hour compute. For one 12-hour guest, the
8mbit shaper yields at most 43.2 decimal GB before the per-start 512kb burst:
USD3.888 egress plus USD0.2784 compute and USD1 other allowance. The planning
conversion is 1.50 CAD/USD with a 25% buffer, or CAD9.687. The reserve is CAD10
new plus CAD9 historical = CAD19 within the CAD20 owner limit. These are planning
figures and a reserve, not a billing hard cap, live FX quote, credit/balance
measurement or actual bill. Root must confirm termination
behavior and DNS before release. This source does not validate live account/
AMI/volume/role ownership or refresh prices.

## Exact bundle and rendering

Build a **plain, uncompressed tar** with only regular files, no directory
members, no symlinks/hardlinks/devices, and these paths:

- `rh-server`: reviewed Linux x86-64 postgres-feature binary (ELF checked).
- `source-map.json`: the reviewed complete Source map.
- `web/index.html` and the complete reviewed Web tree below `web/`.
- `bundle-manifest.json`: JSON object mapping **every other member's exact
  relative path to its lowercase SHA256**. No metadata wrapper or extra paths.

Use the local-only `hosting/technical-demo/bundle.py` packager with explicit
reviewed inputs; it never executes the server binary or contacts a service:

```
PYTHONDONTWRITEBYTECODE=1 python3 -B hosting/technical-demo/bundle.py \
  --server /absolute/reviewed/rh-server \
  --map /absolute/reviewed/source-map.json \
  --web /absolute/reviewed/Web \
  --output /absolute/new/technical-demo.tar \
  --receipt /absolute/new/technical-demo-bundle.json
```

The output tar and receipt must not already exist; the Web directory is walked
completely and any symlink, special file, unsafe member, or missing index
refuses the package. The packager writes sorted USTAR regular files with fixed
metadata and a separate local receipt containing archive/member hashes and
sizes. The receipt marks itself `deployable: false` and records no protocol or
content identity. Root obtains those two values separately from the exact
reviewed binary's `/info`; the tar digest and final rendered config must bind
that same binary, map and Web tree. The producer does not attest build
provenance or authorize upload/launch.

Maximum download 160 MiB, total expanded 400 MiB, 10,000 members. The full bundle
SHA is supplied separately in nonsecret config, not trusted from S3 metadata.
All member names/types/inventory are checked before creating the destination;
file hashes are checked while writing exclusive fresh files. Any mismatch
powers off through the setup failure unit; no partial installation is served.
No tar extraction API is used. This bundle preparation is separate from the
existing 17MB native component tar; do not feed that component tar directly.

Replace **all** placeholders in `config.example.json`; `protocol: 0` is an
intentionally invalid sentinel. Set protocol and content hash from the exact
reviewed binary's `/info`, then keep those identities immutable alongside the
bundle digest. Keep the original expiry unchanged on reboot, and use a fresh run
ID. Locally render (does not call AWS):

```
PYTHONDONTWRITEBYTECODE=1 python3 hosting/technical-demo/render.py /private/nonsecret-demo-config.json > /private/demo-user-data.sh
```

The renderer embeds exact reviewed bootstrap bytes plus nonsecret config. Root
must retain their SHA256s in the launch packet. Base64 embedding can exceed EC2's
raw user-data limit: Root must measure rendered bytes and use EC2-supported
**gzip user data** if needed, verifying decompression back to the exact script.
Do not launch an oversized raw payload or fetch an unpinned bootstrap online.
No access keys, tokens, password, account claim or populated database is seeded.

## Ordering and bounded failure

User data refuses existing config, creates root-only fixed config, validates
expiry, then enables a persistent absolute `OnCalendar=... UTC` shutdown timer.
Only afterwards does it start a systemd bootstrap unit with 600s total setup
timeout, control-group kill, no retry, and failure→poweroff. A shell failure
before handing off also requests poweroff. Cloud-init/EC2 launch behavior itself
is an external activation dependency, not proved by offline tests.

The bootstrap inhibits package service autostart, installs Ubuntu apt
`python3-boto3`, PostgreSQL16, Caddy, nftables and iproute2; disables stock services and
masks the stock PG cluster. It creates a no-login app user, installs IMDS
isolation and the egress shaper, downloads/verifies the single exact bundle, creates a distinct private
PG data directory, and uses a Unix socket with peer authentication. PG TCP is
disabled; fsync/synchronous_commit/full_page_writes are explicitly on. The app
role is non-superuser/non-role-creator/non-db-creator and owns only its fresh
application database. No password is passed or printed. Package availability,
actual loaded PG settings/permissions, nft kernel behavior, systemd semantics
and Caddy validation remain host execution gates.

Source and Training use the existing public runtimes/flags, loopback 7777/7779,
and durable Source result spool on the ephemeral root. Source uses
`--min-players 1 --fill-bots 8 --max-rooms 1 --lobby-seconds 10 --fill-seconds 3`:
the fill target is eight total players, normally one human plus seven bots.
The first seat sets the 10-second lobby deadline; reaching the one-human minimum
shortens it to at most three remaining seconds, with missing bots filled before
lobby close. Training remains solo/immediate with no bots and one room. Source
runs `--bot-learning single-writer` (owner approval 2026-11-11; the host's
Postgres holds the single-writer lease); Training keeps `--bot-learning off`,
because rh-server refuses learning in training. These launch scripts do not pass a `--hitboxes`
override. The current integration runtime is still protocol 14; it does not gain
that parser option until the reviewed union is integrated. The incoming primary
protocol-16 runtime implements `--hitboxes` overrides and defaults live Source
and Training to Archetypes, while bare-core `SimConfig` remains LegacyCircle.
After union, verify the parser, live default, exported map and flags against the
exact combined binary and reviewed artifact; this preparation is not that proof.
Source starts first (its
normal migrations), then Training. Caddy is started only after both actual
`/readyz` objects report ok/ready/storage-ok and both `/info` objects match the
immutable `protocol` and `content_hash` identities in strict config. Protocol is
a positive u16; content hash is 16 lowercase hex digits. Caddy's restart/boot
precondition repeats these checks and every app/PG start checks the unchanged
absolute expiry.

Caddy exposes HTTPS static/WS/Source API only, routes `/training/ws` separately,
refuses control/probe and Training API routes, replaces XFF with the actual peer,
and enables normal compression. Explicit gzip/Brotli Unity suffix headers are
included; actual loader/MIME/CORS/TLS/browser behavior remains unrun. No Caddy
access log is enabled and application/PG stdout/stderr are suppressed, so
private tokens/SQL are not copied into a proof receipt. Operational diagnostics
are intentionally sparse; use SSM metadata and Root-approved safe probes.
The setup receipt means services were started and loopback identity checked,
not that ACME completed, the public site loaded or a genuine match succeeded.

## Source launch settings (P-HOST-FLAGS-1)

The nonsecret config takes three optional keys for the **Source** room; Training never receives them (rh-server refuses
`--map-pool` and `--lobby-timing` there). Absent keys mean the defaults, and with all defaults the rendered units are
byte-identical to the earlier ones. The owner chooses the values at deploy time.

- `map_pool` (`true`/`false`, default `false`): adds `--map-pool`; each room takes its own certified generated map and
  `--map source-map.json` stays as the last resort. Maps are generated off the tick and a room never waits for one: until the
  pool has a certified map ready, early rooms are given the `--map` file (counted as a fallback).
- `signature_landmarks` (`true`/`false`, default `false`): adds `--signature-landmarks`; refused by config validation
  unless `map_pool` is `true`. Keep it off on a real host until the landmark and art packets land.
- `lobby_timing` (`"legacy"`/`"matchmaking"`, default `"legacy"`): `"matchmaking"` adds `--lobby-timing matchmaking`, a
  15 second lobby with bots added at second 13, and drops `--lobby-seconds 10 --fill-seconds 3`. Per
  `crates/rh-server/src/bot_fill.rs` (`apply_lobby_timing`), matchmaking overwrites the sim's lobby seconds, minimum
  players and fill seconds anyway, so it wins whenever both are present; the pair is dropped to avoid a misleading unit.

Any other key or value is refused. Offline check of the rendered flags: `test_offline.py` (`LaunchFlags`). Local proof
that the "all three on" command starts a real server: build `rh-server`, then run it on loopback with the Source options
(`--runtime source-arena --bind 127.0.0.1:<port> --map maps/... --min-players 1 --fill-bots 8 --max-rooms 1 --map-pool
--signature-landmarks --lobby-timing matchmaking` plus a database URL) until it prints its ready line. Done once on 2026-11-12 against `crates/rh-sim/src/mapdata/fixtures/seed1.map.json`
(runtime `rh-map/2`, seed 1) with a throwaway Postgres: `[server] map pool on: each room takes its own certified map
(target 8)`, then `[server] ws/http (dev only) on 127.0.0.1:17777 | protocol 17 content 4674a176a28e3c7a`, and
`/readyz` returned `{"ok":true,"state":"ready","storage":"ok"}`.

## Boot-persistent interface egress shaping

The enabled isolation oneshot runs `bootstrap.py isolate`: nft first, then the
same internal shape sequence, before
app/Caddy startup. That command checks the original expiry, reads IPv4 and IPv6
default routes with fixed `ip -json` argv, refuses malformed/absent IPv4 defaults
or multiple/unsafe NICs, then applies one root TBF on the unique default ENI:

```
/usr/sbin/tc qdisc replace dev <validated-default-NIC> root handle 1: tbf rate 8mbit burst 512kb latency 500ms
```

This shapes the entire interface's outgoing IPv4/IPv6 traffic, including public
Web, SSM and SDK/admin traffic. Any ip/tc failure fails isolation and requests
poweroff; app/Caddy cannot start through the declared unit dependencies. The
unit reapplies on boot, while the original absolute deadline remains unchanged.
A per-flow fq_codel child follows the TBF; the parent latency is not a hard
queue-delay bound with that child. There is no hard50ms claim or byte quota/counter store,
and **no 2GiB promise**. The earlier 2GiB quota request was superseded by Root's
8mbit instruction before any quota implementation.

At 8mbit for the new maximum 12-hour lifetime, nominal sustained egress is about
43.2 decimal GB plus the 512kb burst allowance per shaper initialization. This
is a rate-duration planning bound, not a measured transfer or durable byte
ceiling; reboot does not renew TTL. Actual kernel/ENI shaping remains unrun.

## Offline checks

```
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hosting/technical-demo -p test_offline.py -v
```

Twelve bootstrap tests cover exact 12-hour/expired/over-limit expiry cases, strict
config refusal, positive and stale protocol/content readiness on both service
ports, real tar good/exclusive write, traversal/link/FIFO/unknown/duplicate
refusal, wrong hash, exact TBF argv and route/ordering refusals, and rendered
ordering/route/unit properties. Seven stack tests cover offline structural,
resource-scope, and absolute-schedule controls. These tests do not emulate a host
or claim cloud-ready activation. See the source preparation receipt for exact
commands/results; host execution remains pending.

## First isolation failure and diagnostic-only continuation

First actual instance `i-0b2f4485d0491740e` terminated through the intended
failure→poweroff path. Its original rendered user data, gzip and private console
remain unchanged in the coordinator's `calgary-demo-launch-01` receipt. Console
proves `rh-demo-isolation.service` failed, but not whether NFT or the later
route/TBF/fq_codel command failed. SSM process startup was not Online readiness.
This diagnostic patch does not claim that underlying fault is repaired.

The isolation unit now runs one Python wrapper preserving the exact order:
NFT load, expiry guard, IPv4/IPv6 default-route reads, route/domain guard, TBF,
then fq_codel. Existing rejection, timeout, fixed expiry and OnFailure poweroff
remain. Only this unit sends diagnostics to journal+console. Each step emits
fixed `RH_DEMO_ISOLATION` stage/event/numeric-status JSON and flushes it before
propagating failure. Allowed identifiers are `nft-load`, `guard`, `route-v4`,
`route-v6`, `tbf`, `fq_codel`; `guard` covers both expiry and route selection.
Known NFT/IP/TC failures alone may include at most2048 stderr bytes, converted
to a single printable ASCII field. No argv, environment, config, route stdout,
SDK credentials, application or SQL logs are emitted. Known-command stderr is
captured transiently by subprocess and only its bounded prefix is retained;
this is not a general untrusted-program output-capture service.

The unchanged renderer embeds the exact new bootstrap bytes; regenerate and
independently pin new script/gzip inputs before any separately approved launch.
Old launch receipts are never overwritten or relabeled. Root reviews/commits
this patch and owns all host/cloud actions; no replacement launch occurred in
these offline checks.

`test_offline.py` now has11 controls (the previous7 plus three diagnostics
controls and one NFT render control), and unchanged `test_stack.py` has7:
**18 offline PASS**. These include
mocked real helper call order, NFT failure preventing later work, parent/route
refusals, numeric missing-executable/timeout status, stderr/control-byte bounds,
no stdout/error-argument leaks, and rejection of unsupported diagnostic commands.
They do not execute nft/ip/tc, package installation, Linux services or cloud APIs.

## Confirmed NFT grammar repair and corrected demo origin

Replacement `i-026f8ad9c4923a16c` produced `nft-load` exit1 with actual NFT
`unexpected '}', expecting newline or semicolon`: the old one-line producer
closed its chain and table as `} }` without a separator. Pure
`isolation_rules((app_uid, postgres_uid, caddy_uid))` now renders real newlines
between both closing blocks. Both exact service-UID sets, output hook/policy,
and IPv4/IPv6 IMDS reject rules remain unchanged. The diagnostic stage/failure
poweroff, original absolute expiry and TBF/fq_codel argv are unchanged. The
focused test binds the full actual render and preserves both rejection terms;
no NFT/kernel invocation or successful replacement host is claimed offline.
The two failed-instance receipts, user data, gzip and console remain immutable.

The only demo hostname/origin is now **https://play.rougehalla.com**. Config
rejects the old apex `rougehalla.com` and official production
`play.roguehalla.com` (also `roguehalla.com`). Caddy's site and both native CORS
origins match the corrected test subdomain. No production DNS/TLS/service,
account data or cloud resource was changed by this source edit. Root must
regenerate/pin new nonsecret config/userdata and bind the exact Web endpoint
before a separately authorized guest; earlier origin receipts stay historical.

## Hosted Unity response encoding correction

Root's actual GET response headers with `Accept-Encoding: gzip` showed the
58,599,146-byte Web.wasm and47,874,287-byte Web.data responses had no
Content-Encoding. The preparation now explicitly includes response MIME types
`text/*`, `application/javascript*`, `application/json*`, `application/wasm*`,
`application/octet-stream*` and `image/svg+xml*` in the existing zstd/gzip encode
matcher. This removes reliance on the installed Caddy version's default MIME
list; it changes neither Unity build/artifact nor native identity.

Host, routes/blocked paths, Training redirect, static MIME headers and existing
precompressed suffix handling remain unchanged. The old exact Caddyfile and
bootstrap are retained in the coordinator's content-encoding-fix receipt for
Root's rollback. This source preparation does not reload a server or prove
compressed byte counts, cold-load duration, CPU cost or public game performance.
Root has now validated the exact new Caddyfile with the installed binary and
completed one graceful reload. Actual normal-TLS GET headers confirm gzip on
both WASM/data responses. Full compressed transfer size and load-time improvement
remain unmeasured. No restart, timer, NFT, gameplay or cloud-resource change was
needed for this correction; previous bootstrap/userdata receipts stay unchanged.

Caddy syntax references: [encode response matcher](https://caddyserver.com/docs/caddyfile/directives/encode)
and [response-header matching](https://caddyserver.com/docs/caddyfile/response-matchers).
