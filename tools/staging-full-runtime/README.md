# Calgary dual-runtime staging: preparation only

Frozen native base: `a0c4818ce9df8ad0f4124db31e65ba1244bddc3b`. **NOT DEPLOYABLE / NOT A SPENDING AUTHORIZATION.** No AWS client, login, deployment or upload command is implemented here. Do not apply the review template: its Host userdata deliberately powers off/refuses because a secure installer/transfer design has not been released. Root owns cloud authorization, credentials, final artifacts and identity. Existing hosting files are unchanged.

The only account/region/domain allowed are `048226733033` / `ca-west-1` / `rougehalla.com`. Production `roguehalla.com` and `play.roguehalla.com` are excluded. The **CAD20 TOTAL** includes prior gross staging costs; credits do not expand it. No current account session, costs, FX, AMI, prices, storage size, instance sizing or200-match capacity is asserted by these files.

## Reviewable local output

```sh
python3 tools/staging-full-runtime/prepare.py render-review --out /absolute/NEW/review-directory
python3 -m unittest discover -s tools/staging-full-runtime -p 'test_*.py' -v
bash -n tools/staging-full-runtime/backup.sh tools/staging-full-runtime/restore.sh
# Use already installed cfn-lint / cfn-guard; no AWS validation/create/change-set is part of this command set.
cfn-lint --regions ca-west-1 --template /absolute/NEW/review-directory/template.review-only.json
cfn-guard validate --rules tools/staging-full-runtime/security.guard --data /absolute/NEW/review-directory/template.review-only.json
```

`render-review` needs no account credentials and writes only a NEW local directory. Runtime placeholders remain unresolved. `plan.unverified.json` is an intentionally blank checklist, not a working example with invented live values. Its preflight MUST fail:

```sh
python3 tools/staging-full-runtime/prepare.py preflight --plan tools/staging-full-runtime/plan.unverified.json --artifacts-root /absolute/public-artifact-root
```

Later, `preflight` can check Root-supplied nonsecret receipts and immutable public artifacts and optionally render a NEW local directory via `--out`. There is **no apply option**. Even a complete input passes only local integrity checks and returns `deployable:false`. Data in a receipt is not live API attestation; Root must examine its actual raw provenance. The validator does not authenticate a self-written boolean as a successful binary/cloud test.

Required inputs: fresh correct-account/region STS and scoped owned-resource+cleanup receipts (1h); gross costs/verified conservative FX and regional pricing/sizing receipts (24h); all-in USD reserve including tax/lag/other-staging CAD and explicit positive reserve within CAD20; known AMI owner/ARM64/AZ/standard credits; explicit disk quantities; host deadline <=4.5h from preparation and runtime+180s drain fitting remaining time; owned data deletion deadline <=7d; offhost restore/transfer ownership and costed current+noncurrent-version retention. Seven days is a preparation safety ceiling, not an approved paid retention period or an automatic EBS deletion mechanism. Any actual duration still needs a funded finite reserve.

Public artifact descriptors are relative no-symlink SHA256 files: ARM64 ELF server+Caddy; complete `rh-map/2` source map; all Web file hashes and Source/Training/account bindings; actual native validation receipt binding exact binary/map/source, PostgreSQL feature and Training semantics. Hashes and ELF headers alone cannot establish producer behavior. Root must supply actual binary source-map/profile proofs; these local tests use explicitly synthetic headers/receipts. Never place credentials, presigned URLs or private dumps in the plan/artifact root or logs.

## Exact runtime and routing

One parameterized EC2 host + Caddy + two loopback processes + private PostgreSQL. No NAT/ALB/GameLift/RDS/new IAM role or key. Instance size, root/data GiB and AZ are unverified inputs, not defaults. CFN has one host, standard CPU credits, IMDSv2, root encryption/deletion-on-termination,80/443-only public ingress, no SSH/DB/control ingress or instance profile. Stack Rules pin actual account/region. Metadata tags use `RoguehallaRun`, `Purpose=DualRuntimePreparation`, and retained-data `DeleteBy`.

| Public path | Internal destination |
|---|---|
| `/ws` | Source `127.0.0.1:7777/ws` |
| `/training/ws` | Training `127.0.0.1:7779/ws`, explicit rewrite preserving query |
| `/api`, `/api/*`, `/readyz`, `/info`, `/ping`, `/healthz` | Source account/API/health listener |
| `/training/info`, `/training/ping`, `/training/healthz` | Training with `/training` stripped |
| control/probe and Training account paths |404; never proxy |
| remaining paths | exact staged static Web tree |

No origin/token rewriting or account bypass: preserve incoming Origin and `x-profile-token`, replace spoofable XFF with actual remote host, trust only127.0.0.1 in the server. One account API origin and shared actual PG account/lease store; existing cross-runtime concurrent-profile lease refusal stays intact. Accounts/currencies and Training rules are never synthesized by the proxy.

`run-runtime.py` uses exact frozen runtime profiles, never core/first-playable. Source: map required, default min2/fill0/max16/lobby30/fill5. Training: actual practice map, one human/fill0/zero lobby+fill; this bounded endpoint deliberately limits max_rooms to1. Training's existing no-result/no-banking/no-replay behavior remains native; there is no Training result spool. Source uses the normal durable spool. Learning explicitly Off; separate run-scoped instance IDs; same PG store; no dev/static-auth fallback. No200-match capacity claim.

Service files are **host-only inputs**, not enabled here. Runtime/PG startup requires the retained mount and an installation verification marker; that marker is an operator-installed completion check, not cryptographic attestation. Caddy also requires a reviewed `rougehalla-egress-limit.service`, deliberately absent until the installer is released. Native defaults refuse `--runtime` plus `--first-playable`; the independent absolute host-expiry mechanism must therefore be installed before downloads/DB/public serving, with service lifetimes and drain inside that unchanged absolute deadline. No hidden restart renews it.

## Runtime secrets and required installer boundary

No secret is a CFN parameter/output, receipt, command example or source literal. `init-runtime-secrets.py` is **host-only, NOT executed by preparation**: root creates a new root-owned0640 `runtime-secrets.json`, group rougehalla, with fresh DB password and playtest passcode, no value output/overwrite. The private parent directory must already be correctly provisioned. The launcher reads it only at runtime and emits a generic refusal on local preflight error. Native's existing DB-URL argv API remains unchanged; OS root/the same service user can inspect its own process, so protect those identities and do not collect raw process environments/argv or private logs into evidence. Validate native error redaction during installation before public activation.

PG initialization/role provisioning is intentionally **not implemented**: it must consume that runtime file without echo/logging secrets, use SCRAM loopback auth and a non-superuser application role/database owner, preserve restored account credential rows, and never seed/rotate client tokens to fake restoration. No Secrets Manager value retrieval is done; if Root later selects Secrets Manager, use approved runtime dynamic resolution and an explicitly reviewed narrow access design, not get-secret-value through an agent. No IAM policy is generated or attached in this packet.

The unimplemented installer must also bind the exact EBS volume ID/UUID to `/srv/rougehalla-data` (never format an unknown disk), set PG/spool/Caddy/config ownership, create the root:rougehalla0640 `writers.lock`, bind the verified installation marker to the exact run_id, provide pinned PostgreSQL/age binaries and tool paths, and install absolute expiry+egress controls before serving. Root must choose private artifact delivery/offhost capability without putting secrets in template/userdata/logs or adding broad IAM. With no role/SSH/approved runtime transfer channel, this is a **real unresolved activation seam**, not an implicit permission to add one. The review-only bootstrap refuses rather than silently delivering credentials.

## Durability, backup and finite cleanup

PG data and Source spool share a separate encrypted gp3 volume with **DeletionPolicy and UpdateReplacePolicy Retain**, independent of host/root-disk destruction. The backup bucket is private, encrypted, ownership enforced, versioned and retained. Current-version lifecycle is parameterized; noncurrent versions expire1day after becoming noncurrent; incomplete uploads abort1day later. S3 lifecycle timing is asynchronous and leaves delete markers/empty buckets; EBS `DeleteBy` is only metadata. Neither is a hard cost stop. Root must fund/check all versions, cleanup lag and explicit volume+bucket deletion, not just terminate the host.

Host-only `backup.sh`: stop/drain both owned runtimes; hold the exclusive writers lock (launcher retains shared lock through exec); require zero application DB sessions and all3 durability flags on; real custom pg_dump plus exact pending Source spool bytes; refuse unexpected Training files/symlinks/special files; manifest hashes; encrypt only to a public age recipient; create-new publication of completed ciphertext. It restarts nothing and never claims offhost upload. Use a separately reviewed bounded maintenance timeout inside the fixed host deadline. Its private plaintext workspace is removed on normal/error exit; abrupt kill/host loss can leave private bytes on the encrypted root disk. This is not a power-loss erasure claim.

Root must transfer **only ciphertext** through an approved exact-object bounded HTTPS capability/runtime channel, verify offhost SHA/metadata/expiry, and restore on an independent clean target before data deletion. No transfer capability, AWS upload helper, key retrieval or backup HTTP endpoint exists here. Private age decrypting identity stays off the serving host and out of model/log/template context.

Host-only `restore.sh`: existing empty target DB+application role, stopped runtimes, durability flags on; private runtime age identity; reject archive traversal/links/devices/duplicate/unmanifested/missing pending bytes before DB mutation; restore atomically via pg_restore into application-owned tables, preserve pending spool and start no server. Restore must then prove original client tokens/profile balances, expired-lease fencing, real pending replay and idempotence through the real router/Director/Store. These scripts were syntax/unit reviewed only, **not run against PG or production**. Existing local cold proof is reusable evidence, not a cloud deployment or proof of these new scripts.

Cleanup order is reviewed, not automated here: close public admission; drain+settle/fence writers; retain exact PG+pending state; verified encrypted offhost copy and independent restore; remove only marked practice DNS and wait TTL; delete owned host/network/artifact resources; verify all remaining retained volume/bucket/object-version IDs and delete them by the funded deadline after explicit data disposition. Never invoke the old disposable cleanup expecting it to delete or safely retain this data schema. No data is deleted by preparation.

## Remaining Root gates

Fresh correct account+permissions/inventory/practice DNS; gross actual cost+verified CAD conversion and finite all-in reserve; exact candidate artifacts and complete map validation; local combined memory/disk/CPU sizing including PG and backup workspace; reviewed pinned host installer/secret-role provisioning/expiry/egress/transfer; actual Source/Training WS upgrade and single-account/router/durable result behavior; current ordinary Unity public TLS/Web flow; actual offhost backup+independent restore+retention cleanup. No provisioning may precede Root's separate concrete authorization. Local checks below are preparation release only.
