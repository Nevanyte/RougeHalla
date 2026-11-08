# Latency-duel staging plan (rendered, not deployed)

Prepared 2026-11-08 against source commit `23b2e4cfe9eb7530d350b176fd08d108eb739dda`. This is a local, reviewable plan for one bounded two-human latency run. **No AWS resource, DNS record, upload, or cloud change set was created.** The saved AWS Core identity remains account `961470857356`; the Calgary helper is pinned to `048226733033`. The account mismatch is unresolved, so no AWS validation or deployment is appropriate yet.

## Selected profile

The default `first-playable` profile remains byte-for-byte unchanged. An explicit `--latency-duel` selector is available only with `render` or `prepare`. It exact-matches one expected game-service block and fails closed if that block changes. The selected server arguments are:

```text
/opt/rougehalla/bin/rh-server --bind 127.0.0.1:7777 --map /opt/rougehalla/maps/latency-duel.map.json --min-players 2 --fill-bots 0 --max-rooms 2 --lobby-seconds 3 --fill-seconds 0
```

The bundle must contain exactly one regular-file `maps/latency-duel.map.json`, with the pinned SHA-256 of `parity/maps/duel.map.json`; wrong contents, directories and duplicate entries are rejected. Since this profile omits `--first-playable`, which supplies the Rust process lifetime watchdog, the service adds `RuntimeMaxSec=4h` and keeps `TimeoutStopSec=180`, `Restart=no`, and the independent absolute host timer. The OS poweroff deadline remains fixed at 4h30 after preparation. No room-count, security group, egress, DNS, or stack lifetime setting is broadened.

The first-playable local profile fails this latency harness because its players spawn outside each other's visibility; it observes zero remote humans and produces no trials (`local-staging-profile.json`). The controlled duel profile has since passed with the exact Linux ARM64 server and two real Unity Web clients: visibility, settled baselines and all 12 trials in `linux-rtt-sweep-final.json`. A packaged Caddy HTTPS/WSS loopback fixture also exercises the bundled Web payload. These checks establish the local data path; the rendered AWS bootstrap, host timer, DNS and trusted public certificate still require the approved cloud run. Bot fill stays zero.

## Render and local validation

Focused Python renderer tests: **5 passed** (`python3 hosting/staging-mvp/test_latency_render.py`). `py_compile` and `bash -n hosting/staging-mvp/bootstrap.sh.in` passed. Tests cover default byte preservation, exact selected args and runtime cap, fail-closed replacement, required map content/type/uniqueness, unchanged ingress/deadline/timer, and no changed bootstrap content outside the single service block.

Dry-render output is kept separately from the earlier first-playable review:

- `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/latency-duel-template.json`
- SHA-256: `b9c03cf20463c38b27b549ad084976c361f23491817b06500ec75d478a68aa0e`
- Renderer state directory: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep-latency-duel`
- `cfn-lint 1.46.0 --regions ca-west-1`: PASS, no findings.
- `cfn-guard 3.2.1` using `hosting/staging-mvp/security.guard`: PASS (`capability_not_echoed`, `one_small_disposable_host`, `web_and_acme_ingress_only`).
- Rendered service assertions: PASS. No AWS `validate-template` call was made.

## Candidate build inputs

Local preparation artifacts exist under `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/bundle`. The release tar and source manifest are prepared locally; neither has been uploaded or deployed.

| Input | Evidence |
|---|---|
| Rust server | Linux ARM64 release built from source commit `23b2e4cfe9eb7530d350b176fd08d108eb739dda`, protocol 11, content hash `801a76cde4cfd305`; SHA-256 `5f12724513b9ab50478f2fbf2bb266a84fd9167e7baea57102602e68b9c4cb4c`. Loopback `/info` returned ready. See [`linux-arm64.md`](linux-arm64.md). |
| Unity Web player | Unity `6000.0.85f2`; source payload hashes preserved, only wrapper index changed to same-origin `/ws`; packaged index SHA-256 `0421890df6936af7ec64656c6eaa1a040014f01dfa5c5ffddcf96de3f7e9f8a9`; 22 files, about 57 MB. Report: `/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/input-latency-staging-prep/web-packaging.json`. |
| Map | `maps/latency-duel.map.json`, copied from `parity/maps/duel.map.json`; SHA-256 `f824d887443832f13208d7eb5ef7eb3317e44924f7972a63236b0c41ff344511`. |
| Caddy | Linux ARM64 v2.11.9 binary; SHA-256 `762d7763ed8e303d50bf11fb0274627266907ea8c170720d7d9a6fd0b9bf5c65`, license included. The current rendered Caddyfile (SHA-256 `6508797a01c32715ff3a44accf0a9e368d932887026404c1f73ed2d9134796a0`) validates with this exact binary in an isolated Linux ARM64 container. See [validation evidence](caddy-validation.md). |

The prepared `release.tar.gz` is 37,172,179 bytes, SHA-256 `8c77189316c797d66cb6c5a492ac585fed38c7ee7bd20cc3a7b59e4bff8136eb`. It contains the required root-level binaries, Web payload, controlled map and licenses; the stricter `validate_bundle(..., latency_duel=True)` passes this exact tar. The local `release-source-manifest.json` binds 27 payload files to the tested native/client source. Before execution, refresh its harness/template provenance against the final integrated commits and verify the tar hash again. Capabilities and test credentials are outside the bundle.

## Cloud boundary, budget, and cleanup

The target remains the historical Calgary MVP account `048226733033`, region `ca-west-1`, one `t4g.small` (standard CPU credits), one auto-assigned public IPv4, encrypted 8 GiB gp3 root disk, a dedicated disposable VPC, and practice-only `rougehalla.com` DNS. Public ingress stays TCP 80/443 only. Production hostnames, GameLift, NAT, load balancers, database, SSH, instance role, and paid-plan upgrade are excluded. The current connected account is `961470857356`, not the helper's pinned account. Wait for the owner to reconnect the correct account and verify STS, regional inventory, and posted costs before preparing anything.

The owner-authorized **CAD 20 total cap** is unchanged. Remaining allowance is unknown: the earlier account's posted billing was not verified, and the latest Cost Explorer result was only USD 0.00 MTD in account `961470857356`, which cannot be applied to Calgary. A prior reservation for this design held CAD 10 including margin. Its historical direct compute/disk/IPv4 estimate was USD `0.110014` for 4.5 hours at rates then recorded as t4g.small USD `0.0184`/hour, public IPv4 USD `0.005`/hour, and gp3 USD `0.088`/GiB-month. These are old inputs, not a present upper bound: egress (up to 16.2 decimal GB at the 8 Mbps/4.5h cap), tax, conversion, artifact storage/requests, and current rates require fresh calculation. Confirm posted actuals and hold a reviewed total reserve within the remaining CAD 20 before cloud preparation; do not infer room to spend from that historical estimate.

The helper fixes an absolute UTC deadline 4h30 after `prepare`; the persisted systemd expiry timer is installed before downloads and powers off the host, with EC2 configured to terminate on guest poweroff and root volume deletion. The game process independently stops at 4h, and `TimeoutStopSec=180` bounds drain. Cleanup still must delete the exact owned stack and artifact bucket, remove only the marked TTL-60 practice DNS record, and verify instance, root volume, network interfaces, and public address are gone. Preserve the existing cleanup runbook and next-day posted-billing review. Timer/poweroff is not a substitute for cleanup if the guest or host fails.

## Gates before requesting cloud execution review

1. Correct-account STS and read-only scoped inventory/billing checks succeed for `048226733033` / `ca-west-1`; reconcile historical actual spend and calculate a fresh worst case within the remaining CAD 20.
2. Local latency-duel run with two human Unity clients passes opponent visibility, stationary baseline, all planned latency trials, and harness integrity; save immutable evidence.
3. Validate current rendered Caddy configuration/binary, bundle map placement, tar paths/modes, source manifest, exact template hash, current price inputs, DNS ownership, and cleanup operator/deadline.
4. Review a concrete preparation proposal and only then use the existing explicit `--apply` gate. This plan did not invoke `prepare`, AWS CLI, CloudFormation APIs, or DNS tools.
