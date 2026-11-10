# Ephemeral technical demo preparation — NOT DEPLOYED

This new preparation is for one **fresh x86-64 Ubuntu 24.04 instance in
ca-west-1**, practice `rougehalla.com`, and an original absolute UTC deadline no
more than three hours ahead. No installer, package manager, AWS SDK, host probe,
service, or cloud operation has been executed by preparing these files. Ten stdlib bootstrap controls and seven PyYAML stack controls pass; this is not
a tested Ubuntu installation.

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
of USD0.09/GB egress and USD0.0232/hour compute. The conservative phase reserve
is USD2 / CAD4, plus CAD5 historical reserve = CAD9 reserved / CAD11 unallocated
within the CAD20 owner limit. These are planning reserves, not a live FX quote,
credit/balance measurement or actual bill. Root must confirm termination
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

Maximum download 160 MiB, total expanded 400 MiB, 10,000 members. The full bundle
SHA is supplied separately in nonsecret config, not trusted from S3 metadata.
All member names/types/inventory are checked before creating the destination;
file hashes are checked while writing exclusive fresh files. Any mismatch
powers off through the setup failure unit; no partial installation is served.
No tar extraction API is used. This bundle preparation is separate from the
existing 17MB native component tar; do not feed that component tar directly.

Replace **all** placeholders in `config.example.json`. Keep the original expiry
unchanged on reboot, and use a fresh run ID. Locally render (does not call AWS):

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
no bots, Source 2 players/30s lobby, Training solo/immediate, and durable Source
result spool on the ephemeral root. No gameplay edits. Source starts first (its
normal migrations), then Training. Caddy is started only after both actual
`/readyz` objects report ok/ready/storage-ok and both `/info` objects report
protocol14/content `7c6a633f68c2cc72`. Caddy's restart/boot precondition repeats
these checks and every app/PG start checks the unchanged absolute expiry.

Caddy exposes HTTPS static/WS/Source API only, routes `/training/ws` separately,
refuses control/probe and Training API routes, replaces XFF with the actual peer,
and enables normal compression. Explicit gzip/Brotli Unity suffix headers are
included; actual loader/MIME/CORS/TLS/browser behavior remains unrun. No Caddy
access log is enabled and application/PG stdout/stderr are suppressed, so
private tokens/SQL are not copied into a proof receipt. Operational diagnostics
are intentionally sparse; use SSM metadata and Root-approved safe probes.
The setup receipt means services were started and loopback identity checked,
not that ACME completed, the public site loaded or a genuine match succeeded.

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

At 8mbit for a fixed three-hour lifetime, nominal sustained egress is about
10.8 decimal GB plus the 512kb burst allowance per shaper initialization. This
is a rate-duration planning bound, not a measured transfer or durable byte
ceiling; reboot does not renew TTL. Actual kernel/ENI shaping remains unrun.

## Offline checks

```
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s hosting/technical-demo -p test_offline.py -v
```

Ten bootstrap tests cover expiry boundaries, config refusal, real tar good/exclusive write,
traversal/link/FIFO/unknown/duplicate refusal, wrong hash, the exact TBF argv and route/ordering refusals, and critical rendered
ordering/route/unit properties. They do not emulate a host or claim cloud-ready
activation. Root should independently review first, then own the single bounded
actual launch/readiness/browser attempt and its cleanup evidence.

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

`test_offline.py` now has10 controls (the previous7 plus three diagnostics
controls), and unchanged `test_stack.py` has7: **17 offline PASS**. These include
mocked real helper call order, NFT failure preventing later work, parent/route
refusals, numeric missing-executable/timeout status, stderr/control-byte bounds,
no stdout/error-argument leaks, and rejection of unsupported diagnostic commands.
They do not execute nft/ip/tc, package installation, Linux services or cloud APIs.
