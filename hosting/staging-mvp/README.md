# Disposable first playable in Calgary

This is the temporary single-host exception in [ADR0020](../../docs/adr/0020-temporary-single-host-staging.md), **not a
GameLift deployment or scale test**. It serves the selected Rust-authoritative match and Unity player at the practice
domain **https://rougehalla.com**. Production `roguehalla.com` / `play.roguehalla.com` are never targets. The owner’s
**CAD20 total** limit remains; credits do not expand it. All cloud creation remains explicit and separate from preparation.

One `t4g.small`, `ca-west-1`, Ubuntu24.04 arm64; one auto-assigned public IPv4, encrypted8GiB gp3 root disk deleted on
termination. A small dedicated VPC/subnet/route/security group keeps cleanup independent of existing networks. Only
TCP80/443 are public; no SSH, EC2 IAM role, NAT gateway, load balancer, RDS, paid support or autoscaling. Rust listens on
loopback; Caddy handles public ACME HTTP-01, HTTPS, static files, dynamic gzip and `/ws` upgrades. Control APIs are not
proxied. This run uses in-memory profiles/results, so progression is disposable and resets with the server.

## Boundaries and expiry

- The manifest fixes an **absolute4.5h** deadline when `prepare` begins. The first bootstrap action installs/enables a
  persistent systemd timer, before any downloads. The timer survives reboot and powers off immediately when overdue.
  EC2 is configured to **terminate** on OS poweroff; root EBS is deleted. Any bootstrap failure also requests poweroff.
- The Rust process independently drains at4h and exits by4h180s; `Restart=no` prevents a new four-hour process. This
  simulation lifetime alone is not an infrastructure cost control.
- Caddy requires an8Mbit/s egress limiter before starting, including on reboot. Failure to install the limiter prevents
  the public web service from starting. This temporary transfer limit is unrelated to the client performance target.
- Standard T-class CPU credits prevent unlimited CPU-credit charges. A single host has no automatic relaunch path.
- Local cleanup still deletes the CloudFormation stack and artifact bucket, and the coordinator removes only its
  temporary marked practice DNS record. Verify termination/volume deletion; the OS timer is not a guarantee against
  guest/kernel failure. Keep an independent operator or cloud-side teardown deadline.

The new account API reported an active Free plan and USD100 credit balance on2026-11-06. No Paid-plan upgrade is
performed here. Calgary API checks confirmed `t4g.small` offered/free-tier eligible,2vCPU/2GiB within a5vCPU standard
quota. Official Price List rates retrieved the same day: host USD0.0184/h and gp3 USD0.088/GB-month; public IPv4 is
USD0.005/h. The private preflight has raw results and computed estimates. Include data/tax/conversion and cleanup
reserve in the CAD20 total; Cost Explorer was not enabled, so no zero-bill assertion is made.

## Release bundle

Prepare an exact `.tar.gz` with these paths at its root; no enclosing directory, links, credentials or game secrets:

```
bin/rh-server       # actual verified Linux arm64 release executable
bin/caddy           # official Linux arm64 Caddy v2.11.9 executable
web/index.html      # copied Unity Web output, configured below
web/Build/...
web/TemplateData/...
licenses/...        # retain project, Caddy, TMP/Unity and font/sprite notices
```

Make a copy of the measured canonical Unity output; do not mutate the benchmark artifact or rebuild Wasm just to set
the endpoint. The helper changes the copied HTML wrapper before the loader and adds lossless `.data.gz` sidecars while retaining
every original Build payload. It supplies a same-origin `/ws`
backend only when `server` is absent, preserves all other query parameters, and leaves normal visits at the menu:

```bash
python3 hosting/staging-mvp/package-web.py \
  --source client-unity/UnityProject/Build/Web \
  --dest /absolute/private/bundle/web \
  --report /absolute/private/web-packaging.json
```

The destination must not exist. The report records the original and packaged index hashes and verifies every other
payload hash stayed unchanged. Its `gzip_sidecars` entries separately identify each added file and decoded source hash.
Caddy's `file_server precompressed gzip` negotiates these sidecars; the explicit `.data` MIME remains
`application/octet-stream`. Identity clients receive the original bytes, and `Vary: Accept-Encoding` separates cached
representations. Wasm/JS retain dynamic gzip and their original MIME types. The actual health proxy is `/healthz`.

The currently live playtest predates these packaging changes: its `.data` remains uncompressed. Local real-Caddy and
Chromium checks verify negotiated MIME/decompression/hash, identity fallback and identity byte ranges. A future reviewed
deployment still needs the complete actual Unity proof; these local asset checks do not replace that playthrough.
See [compression evidence](../../docs/evidence/first-playable-web-compression/README.md). The final public smoke must
verify trusted TLS, asset headers and the ordinary menu-to-match path on the real hostname.

## Render and review without provisioning

Python3.9+ and AWS CLI2.39.5 were used. State and parameters belong outside the repository, in a private directory.

```bash
python3 hosting/staging-mvp/staging.py render --state-dir /absolute/private/template-review
cfn-lint --format json --regions ca-west-1 --template /absolute/private/template-review/template.json
cfn-guard validate --rules hosting/staging-mvp/security.guard \
  --data /absolute/private/template-review/template.json --output-format json
aws cloudformation validate-template --region ca-west-1 --profile rougehalla-staging \
  --template-body file:///absolute/private/template-review/template.json
bash -n hosting/staging-mvp/bootstrap.sh.in
```

`stack.base.json` is source for the renderer; deploy only its rendered `template.json`, which embeds the reviewed
bootstrap. No AWS mutation occurs in `render` or `validate-template`. The template requires no IAM capabilities.
The focused Guard rules check the host size, standard credits, termination/encryption/IMDS requirements, absence of
host credentials/SSH keys, exact public ingress and NoEcho capability parameter; they are not a general production audit.
Before cloud preparation, verify the source/binary/bundle manifest, budget, DNS access and the exact current template.

## Cloud preparation, execution and inspection

These commands are prepared for the coordinator; they were not run merely by authoring these files. Every mutating
phase needs `--apply`. `--aws /absolute/path/to/aws` can select the project-local CLI. The script verifies the dedicated
new staging account and uses Calgary only. `prepare` refuses an existing state directory; preserve each manifest even
after a partial failure so its resources can be cleaned up.

```bash
python3 hosting/staging-mvp/staging.py prepare --state-dir /absolute/private/run \
  --bundle /absolute/private/release.tar.gz --source-manifest /absolute/private/source-manifest.json --apply
```

`prepare` verifies the tar paths/executables, records exact bundle and source-manifest SHA256, resolves an official
Canonical non-Marketplace arm64 AMI through public SSM, and writes the ownership manifest **before** its first mutation.
It creates a private encrypted artifact bucket with all public access blocked and a one-day object expiry, uploads
one artifact, and creates an **unexecuted CREATE change set**. Versioning/Retain are intentionally omitted for this
disposable release object, so cleanup has one known object and no retained storage. The bucket is not game storage.

A scoped presigned GET expires after one hour. Its URL lives only in a mode0600 parameter file, a `NoEcho` CloudFormation
parameter and root-readable instance userdata; it is never echoed. `NoEcho` does not hide EC2 userdata from an operator
who can read that attribute. No permanent access key reaches the host. Delete the object after successful bootstrap
or during cleanup. The script refuses execution more than30min after preparation to leave download headroom.

Wait until the change set is `CREATE_COMPLETE`; review `describe-change-set` and `cloudformation describe-events
--change-set-name <ARN>` (the latter contains validation findings). Then:

```bash
python3 hosting/staging-mvp/staging.py execute --state-dir /absolute/private/run --apply
python3 hosting/staging-mvp/staging.py status --state-dir /absolute/private/run
```

Execution requires the owned `REVIEW_IN_PROGRESS` stack, a matching available change set containing only Add actions,
and no failed/error validation events. Creation completing does not prove bootstrap success or usable TLS. Once the
public IP is known, create the coordinator-owned DNS-only A record for the **practice apex** `rougehalla.com`, then
verify valid public HTTPS, `/healthz`, `/info`, `/ping`, a real Unity match/results/reconnect, gzip headers and the UTC deadline.
Leave existing unrelated DNS records untouched. If bootstrap fails, obtain non-secret console output and clean up;
there is intentionally no SSH/instance role for ad hoc changes.

## Cleanup

```bash
python3 hosting/staging-mvp/staging.py cleanup --state-dir /absolute/private/run --apply
```

Cleanup verifies the stack ownership tag, deletes/waits for that disposable stack, checks bucket ownership/expected
account and refuses unexpected object keys, deletes its one artifact and bucket, and removes the local URL parameter
file. It is safe to repeat after missing resources. A bucket created successfully before tagging failed is recognized
through the recorded creation success plus expected owner; an unrelated tagged bucket is refused. Remove the exact
marked practice DNS record separately and verify no EC2 volume/public-IP charge remains. Preserve the non-secret local
hashes/results for the release record. No broad region sweeps or production resource deletion are part of this helper.

CloudFormation leaves a new unexecuted CREATE stack untagged while `REVIEW_IN_PROGRESS`. Only in that state, ownership
is proven by its exact derived account/region/name ARN plus a change set with the same StackId/name and both run/purpose
tags. This permits safe execution or cleanup of the pending stack. Created/failed stacks still require their own run tag;
the pending-stack exception never accepts a different change set’s StackId or tags. Status reads exclude parameters.

Official references: [EC2 instance schema](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html),
[OS shutdown behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_ChangingInstanceInitiatedShutdownBehavior.html),
[Canonical AMI ownership](https://documentation.ubuntu.com/aws/aws-how-to/instances/launch-ubuntu-ec2-instance/),
[AWS plan choices](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html),
[public IPv4 pricing](https://aws.amazon.com/vpc/pricing/).
