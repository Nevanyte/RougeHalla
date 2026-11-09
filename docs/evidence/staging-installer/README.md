# Offline staging installer foundation: source candidate only

**SOURCE-READY FOUNDATION / OPERATIONAL HOLD. NOT DEPLOYABLE, NOT HOST-INSTALLED.** Exact base7a13b88aaa104cf2fd18dc2de7eada6c02060485; readonly primary review3c577a97c2f170913a1a6418fa7e7d4efeb1fdec. Executed immutable code **2d68e8b90f1d98e4a1993482a26dc76bcf5bd3ef** adds only9 new files under tools/staging-full-runtime/installer. The clean existing checkpoint worktree was reused on NEW codex/staging-installer-offline; codex/owned-seat-checkpoint remains preserved. This evidence-only commit adds no executed code changes.

No AWS client/API/CLI/login/network, deployment, host installation, DB process, Cargo, package/cache install, main/UI/Editor change or cloud spending occurred. The old preparer, refusing userdata, deployable:false and all existing staging siblings were hash-compared against base and remain unchanged. Its old14-test suite was not rerun. All synthetic inputs below are past2000 fixtures, not current resource/identity/tool/cost/AMI/capacity attestations.

## Implemented slice

- Strict bounded run/account/region/practice-domain/key/version/hash/time/known-volume contract, with duplicate/unknown JSON refusal. No apply/upload/install/activation CLI.
- Concrete unattached EC2 role/profile design with only exact-version artifact GetObjectVersion and exact-key create-only ciphertext PutObject, TLS/resource-account/absolute-expiry conditions. No wildcard data resource, list/delete, secret/admin/KMS/managed policy, SSH/public DB/control or backup read. The newly proposed role supersedes no-role only within this PRIVATE design; old templates stay untouched.
- Persistent fixed expiry material and no-renew record, installed before downloads/DB/services in the foundation contract. Exact known EBS serial/UUID/device/mount/run-owner checks; blank/unknown/root disks refuse, no formatting path.
- Bounded future CLI argv, pinned version/owner/range/endpoint, exact local hash/length/range metadata checks, conditional checksum+metadata ciphertext PUT and response verification. No command is executed. Public tar is inspected without extraction and rejects traversal/links/specials/duplicates/missing/substituted/unmanifested bytes.
- An injected ordering controller always stops at artifact-verified-not-installed with installed:false/deployable:false; no marker/activation operation exists. Simulated operations are explicitly not proof of a timer, mount, writer lock or download on a real host.
- Concrete private PG/SCRAM/non-superuser fresh-role stdin SQL builder and a remaining-host contract preserving shared Source+Training account/lease DB, Source-only genuine spool, no Training banking, exact owners/locks, durable flags and restore continuation. Actual PG/secret provisioning and real service checks remain absent. No client credentials, balances or outcomes are seeded.

See the source README for API scope, exact policy/command shape, private ownership rules and unimplemented host seams. The expiry review shell is rendered for syntax inspection only: **it was not executed**.

## Actual NEW offline checks

| Check | Actual outcome |
|---|---|
| New focused unittest suite |12 PASS, first run; synthetic facts/bytes, not host success |
| Python AST + rendered embedded expiry Python |PASS, parsing only |
| Rendered expiry shell |bash -n PASS, never installed/executed |
| Draft7 plan schema |Synthetic fixture PASS; missing real inputs REFUSED |
| Actual new CLI blank-plan negative |Exit2; no output directory or host action |
| Cached cfn-lint1.46.0, ca-west-1 |PASS exit0, NEW role fragment only |
| Cached cfn-guard3.2.1 |2 NEW rule groups PASS |
| Deliberately wildcard data-resource role |Guard exit19, EXPECTED REFUSAL retained |
| Scope/freeze/whitespace |9 new source files match code Git objects; all old staging siblings unchanged; git diff --check PASS |

Tests exercise refusal before side effects, fixed deadline/renewal, expiry during download, wrong/blank/root/foreign volume, expiry→volume→writers→download ordering, no installed marker, exact action/resource/version/time scope, actual local substitution/truncation/foreign metadata, hostile tar members without extraction, encrypted-envelope/checksum bounds, no fake offhost restore claim, fresh private role material and restore hold. They do not claim actual binary/map/producer, Caddy/TLS, application account, cloud permission or cold restore behavior. No first validation red occurred; the intended policy negative is preserved, not swallowed.

Applied local CloudFormation authoring/IAM skills and their authoring/role/policy references. The skill's source-SDK autopilot path is not applicable to this explicit CLI/IaC operation design (no boto3/SDK source); no package/latest/service-reference fetch was attempted. Account identity, official IAM action/condition/service-context semantics and pre-deployment AWS API validation were deliberately NOT performed under the no-network/no-account-action constraint. Cached schema/security passes do not fill that gap.

## Concrete Root review inputs / blockers

1. Exact current identity/inventory/cost/FX/gross spent/retention reserve within CAD20TOTAL,048226733033/ca-west-1/rougehalla.com. No prices, spent amount, AMI, sizing or200-match capacity is invented.
2. Actual private bucket/version/owner/SSE-S3 and artifact pins; verify S3 conditional-write key/CLI support and EC2 trust context-key behavior against official docs, exact instance-profile attachment and deployer PassRole. The role currently has no backup GET/HEAD: PUT metadata/response are not an independent offhost read/restore.
3. Reviewed first-boot delivery plus trusted privileged executor for immutable expiry, EBS ID/UUID/encryption/AZ/mount and lock ownership. Initial formatting is not implemented or authorized. No self-written receipt hash proves this state.
4. Pinned OS/PG/age/AWS CLI tools; actual private runtime secrets/role provisioning with no logs/argv leakage; real loopback durable PostgreSQL and non-superuser verification.
5. Real egress-byte/rate/IMDS-credential isolation before Caddy; fixed-deadline guards for every service, actual native Source/Training/account/lease/redaction/TLS probes before a genuine installation marker. No such marker is produced here.
6. Real quiescent encrypted backup completion, bounded offhost upload/independent checksum and clean-target restore with original account proof, pending replay and duplicate/fence behavior. **Old writers must be stopped/fenced before restoring an older DB.** Local locks cannot fence a remote old writer. No service starts automatically after restore.
7. Fund and explicitly clean current/noncurrent object versions, delete markers, retained bucket/EBS, cleanup lag and all gross transfer/compute/storage/IP costs by the reviewed deadline. Lifecycle/DeleteBy are not hard cost stops. Software1GiB bounds are not cost/sizing authorization.

## Reproduction and evidence seal

    export PYTHONDONTWRITEBYTECODE=1
    python3 -m unittest discover -s tools/staging-full-runtime/installer -p test_installer.py -v
    python3 tools/staging-full-runtime/installer/contract.py validate --plan tools/staging-full-runtime/installer/plan.unverified.json
    # Expected exit2; missing real facts, no deployment.
    /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/aws-mvp/cfn-lint-venv/bin/cfn-lint --regions ca-west-1 --template docs/evidence/staging-installer/synthetic-review/role.review-only.json
    /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/aws-mvp/cfn-guard-3.2.1/cfn-guard validate --rules tools/staging-full-runtime/installer/security.guard --data docs/evidence/staging-installer/synthetic-review/role.review-only.json --output-format json
    shasum -a 256 -c docs/evidence/staging-installer/SHA256SUMS

frozen-source.json binds source/base/primary. receipt.json and raw first-run logs bind outcomes and limitations. synthetic-review is explicitly labelled expired, non-live review material; negative-guard.log retains the expected refusal. SHA256SUMS binds source/evidence except itself; final evidence head is reported separately. No further operation is underway; stop for Root review.
