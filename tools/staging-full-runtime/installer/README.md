# Offline installer foundation candidate

**NOT DEPLOYABLE / NO HOST RUN / ROOT REVIEW REQUIRED.** Exact source base7a13b88aaa104cf2fd18dc2de7eada6c02060485; readonly primary review3c577a97c2f170913a1a6418fa7e7d4efeb1fdec. Only this NEW directory and NEW docs/evidence/staging-installer are leased. The existing preparer, its deployable:false output and its refusing/poweroff userdata remain byte-identical. No CLI here can deploy, upload, download, install or activate a host. No AWS SDK/client or network executor is included.

This is the largest coherent reviewed slice: strict nonsecret run plan; concrete exact-object role/profile fragment; expiry-first host material; known-volume/ownership checks and stopped-writer ordering; future CLI argv with local byte/metadata verification; nonextracting public-bundle validation. The dependency-injected controller stops at artifact-verified-not-installed, always installed:false/deployable:false. Simulated operations and receipt hashes are not real host/cloud attestation. No installation-verified marker can be produced here.

## Private role and transfer design

The NEW fragment deliberately supersedes the prior no-role constraint only as an unattached private DESIGN. It contains exactly an auto-named EC2 role and instance profile, no Host, ingress, key, bucket, DNS, credentials or userdata. Permissions:

- s3:GetObjectVersion on ONE exact public artifact object ARN, restricted to its exact VersionId.
- s3:PutObject on ONE exact run ciphertext object ARN, with AES256 and create-only If-None-Match condition.
- Both require TLS, resource account048226733033 and server-side CurrentTime before the same absolute host expiry. No data ARN wildcard, list/delete, Secrets Manager, KMS, logs, admin, STS delegation, managed policy, SSM/SSH or backup GET.

Keys are runs/<run_id>/public-bundle.tar and runs/<run_id>/cold-backup.age. A pinned version is mandatory: no latest/null fallback. The GET argv includes a byte range bounded by the expected exact object length, expected bucket owner and a fixed regional HTTPS endpoint. Local verification requires exact length/SHA and complete ContentRange/VersionId. Upload accepts a bounded single-PUT .age envelope only; header inspection is NOT evidence of real encryption. Only the existing real backup producer's completion plus actual private ownership/quiescence can authorize a future upload. Put argv uses a checksum and run/hash metadata; response must return matching checksum and a nonempty version. ETag alone is never accepted as SHA.

Backup HeadObject would require object-read authority, not a standalone metadata-only permission. None is granted: metadata travels in the PUT and response. Independent offhost HEAD/read/checksum and clean-target restore are Root-owned, not implied by this host receipt. A successful PUT response still says offhost_restore_proved:false. No decrypting age identity is sent to the serving host.

The EC2 trust principal is only ec2.amazonaws.com. Current service context-key support, S3 conditional-key semantics, pinned CLI flags, exact version/owner and any required endpoint/bucket policy must be verified against official AWS documentation and the actual account before release. Offline schema/unit checks are not IAM semantic/API acceptance. Do not invent unsupported EC2 SourceArn conditions; actual exact instance-profile attachment and deployer PassRole scoping remain Root review. The assuming host must not acquire other policies. Runtime app/PG/Caddy users must be denied access to role/IMDS credentials by a real reviewed host egress/identity guard; that executor is absent.

This is an Allow-only fragment, not a deny boundary against other identity/resource grants. Root's independent offline review checked official public AWS semantics; effective account permissions and exact attachment remain unproved here. Conditional create-only means absent current key: a current delete marker can permit recreation in a versioned bucket. The role cannot delete, but external lifecycle/admin actions still require review; absolute policy time is neither cancellation of in-flight operations nor a host/storage-cost stop.

## Expiry, volume and private state

Plan identity is048226733033 /ca-west-1 /rougehalla.com only. Prepared/expiry times are canonical UTC; expiry is absolute, <=4.5h from preparation, with explicit backup+180s drain fitting remaining time. Every foundation phase rechecks that SAME deadline; restarts cannot change it. Rendered expiry-first.review.sh is review material, never called here: it installs create-new root-owned fsynced persistent systemd timer/record, refuses a differing existing deadline, arms/verifies it before any download/DB/public service. No relative timer or runtime restart renews the deadline. Its systemd/OS clock behavior and terminate-on-poweroff host configuration still require actual host proof. Do not run this script in the workspace.

An already-expired FIRST invocation only refuses; it does not install a timer or independently shut down the host. No budget-safe expired-boot behavior is claimed. A real bootstrap must independently terminate/shut down that expired host before any download/install/service path and prove terminate-on-poweroff; this remains an activation gate, not implemented here.

The volume must already have an exact known EBS ID, ext4 UUID, mountpoint, non-root canonical device/serial and run owner. Blank/unrecognized disks refuse; there is no formatting code. Trusted future collection must bind actual NVMe serial, UUID and mounted-device identity, plus independently reviewed encryption/AZ/account receipts. This candidate does not turn supplied facts into attestation or initialize a new EBS filesystem. Initial formatting/host collector and safe actual mount remain explicit seams.

In particular, inequality of supplied device strings is not proof that a device is physically unrelated to the root disk. Partition ancestry, aliases, actual mount ownership and the canonical physical device graph must be established by the future trusted collector; no actual physical-root proof was synthesized by these tests.

The future installer must hold the existing exact writers.lock inode exclusively after both owned writers stop; live launchers retain shared locks. Ownership contract is root:rougehalla0640 lock/config secret, postgres0700 PG data, rougehalla0700 Source spool. One REAL shared PostgreSQL account/lease database serves Source and Training; splitting/copying it would break cross-runtime ownership. Training has no banking/result spool; its existing empty-tree guard must reject unexpected files/links/specials, not discard them. Generated remaining-host-contract.json specifies this separation.

pg_role_input generates only fresh non-superuser application-role/database SQL for private stdin to peer-admin psql, with SCRAM and restricted flags. It accepts only a runtime-generated64-hex DB password; no secret is supplied/read/logged/executed here. Actual provisioning must use existing durable loopback configs with fsync/synchronous_commit/full_page_writes on, private sockets, app owner, logging/redaction verified before password use. No client credential/profile/currency/outcome row is seeded. For restore, use an empty clean target and existing restore.sh, preserve account rows and genuine pending Source bytes, never rerun fresh initialization over restored data.

## Operational HOLD and cost inputs

No actual host executor, installer bootstrap delivery/privilege binding, pinned AMI/PG/age/AWS CLI/tool dependencies, private secret provisioning execution, egress byte/rate limiter, marker release, Caddy/TLS/native/accounts probes, offhost verifier or independent restore is released. No serving operation is implemented. Egress enforcement MUST precede Caddy; original service prerequisites are not bypassed. Exact verified Source/Training profiles/loopback endpoints, public Caddy/TLS/accounts and no Training banking remain unchanged. Existing old writers must be stopped/fenced BEFORE an older DB is restored; a local lock cannot fence an old remote writer. No automatic service start follows restoration.

Root must supply nonsecret plan facts plus actual identity/inventory, object/bucket/version/encryption, exact volume/UUID/AZ/owner, trusted clean OS/tool pins, fixed deadline, gross prior costs/current verified prices/conservative CAD conversion and funded transfer+retention+cleanup reserve. CAD20TOTAL gross is unchanged; credits do not enlarge it. This module does not price or approve any amount. Software byte ceilings of1GiB are refusal bounds, not sizing/transfer-cost/capacity claims. Cost review must cover ranged artifact GET+egress, single ciphertext PUT/checksum/verification, current/noncurrent versions+lag, EC2/root/data/publicIPv4, egress guard and retained cleanup. No current price/AMI/FX/capacity was looked up or invented. Existing preparer/cost gates still apply in full; validation here never upgrades them.

## Offline commands only

Set PYTHONDONTWRITEBYTECODE=1. No old14-test suite repetition is needed.

    python3 -m unittest discover -s tools/staging-full-runtime/installer -p 'test_installer.py' -v
    python3 tools/staging-full-runtime/installer/contract.py validate --plan tools/staging-full-runtime/installer/plan.unverified.json
    # Expected exit2, no render/host action: required real inputs are intentionally absent.

With Root-supplied nonsecret facts, render-review --plan /absolute/plan.json --out /absolute/NEW/review only writes inert review material. It never applies it. Existing cached cfn-lint/cfn-guard may check the NEW role fragment; schema/security passes do not authorize account calls or replace official semantic/current-account review. No source-derived boto3/SDK IAM analysis is being substituted: this is an explicit-operations/CLI/IaC design. Autopilot/package/service-reference downloads remain unexecuted under the no-network/no-new-cache instruction.
