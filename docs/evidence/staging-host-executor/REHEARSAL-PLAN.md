# Real-host rehearsal plan for the host executor (Root-controlled, NOT RUN)

Nothing below has been executed. Each step names the exact command or observation, the expected result, and the stop rule. On a **STOP**, keep the raw output, do not loosen any check to make it pass, and return to source review. Every step runs at code commit `b06c0e5` (or a reviewed descendant), with the [activation proposal](ACTIVATION-PATCH.md) applied **only on a rehearsal branch or scratch tree** until Root authorizes it.

Scope stays practice account `048226733033` / `ca-west-1` / `rougehalla.com` and CAD20 TOTAL. Each cloud phase needs its own Root cost and authorization receipt first.

## Phase A: local ARM64 Linux VM, no cloud (Root workstation)

The VM runs Ubuntu 24.04 ARM64 with systemd 255 and python3.12. It is disposable and has no AWS credentials.

| # | Action | Expect | Stop if |
|---|---|---|---|
| A1 | `systemctl --version \| head -1`; `ls -l /usr/bin/python3.12 /usr/sbin/nft /usr/sbin/useradd /usr/sbin/runuser` | `systemd 255 …`; regular root-owned files, not symlinks | Major version differs or a pinned path is a symlink |
| A2 | From a checkout at the exact commit: `PYTHONDONTWRITEBYTECODE=1 python3.12 -B -m unittest discover -s tools/staging-full-runtime/installer -p 'test_*.py'` and the same for `-s tools/staging-full-runtime` | 97 OK / 14 OK | Any failure |
| A3 | Install the pinned tool trees under `/opt/rougehalla/{aws,postgres,age}` and compute the receipt with `python3.12 -c "import sys; sys.path.insert(0,'tools/staging-full-runtime/installer'); import host_executor as x; f=x.HostFS(x.SystemIds()); print({n: f.tree_digest(p) for n, p in x.TOOL_TREES.items()})"` plus `sha256sum` of every `TOOL_PATHS` file | Stable digests across two runs; every file root-owned and not group/other writable | `tree_digest` refuses (writable or foreign-owned entry), or digests change between runs |
| A4 | **nft JSON shape (unverified assumption).** As root: render with `x.nft_ruleset({'rougehalla':<uid>,'postgres':<uid>}, boundary)`, `nft -f -`, then `nft --json list table inet rougehalla_guard > listing.json`, then `x.verify_nft(open('listing.json').read(), uids, boundary)` | No exception | `verify_nft` refuses. Record the real JSON. Repair the parser in source review to match the real kernel's form exactly. Never accept an arbitrary shape. |
| A5 | Egress limiter smoke on a VM ruleset with a deliberately tiny quota (1 MiB) and rate: `runuser -u rougehalla -- python3.12 -c "<2 MiB HTTPS GET>"` | Transfer stalls or fails after ~1 MiB; root traffic unaffected; loopback unaffected | Non-root traffic passes the quota, or loopback is counted |
| A6 | Guard unit from the proposal with a synthetic plan whose deadline is in the past | `ShutdownRequested` path: VM powers off; no `/var/lib/rougehalla-installer`; no `/etc/rougehalla/run-deadline.json` | Any installer state is created, or the VM stays up |
| A7 | Guard unit with a valid future plan, but `/opt/rougehalla/postgres/bin/psql` replaced by a different file | Refusal at the toolchain step, then poweroff. `nft` is not loaded. | A download or a later step is attempted |
| A8 | Guard timing: `systemd-analyze` plus `systemctl show -p ExecMainStartTimestampMonotonic,ExecMainExitTimestampMonotonic rougehalla-expiry-bootstrap.service` on a full local run with a local S3 stand-in **only if Root approves one**. Otherwise time each step from the journal. | Total < 110 s (the executor reserves 10 s of the 120 s guard) | Over budget. Root decides between a smaller artifact and a reviewed guard redesign; never raise the timeout silently. |
| A9 | Run the expiry evidence's required host tests (`../staging-expiry-executor/README.md`, "Remaining actual host and AWS gates"): SIGKILL before arming, reboot persistence, real timer firing, clock jump, cancelled poweroff | As specified there | As specified there |

## Phase B: disposable EC2 instance (practice account, Root credentials, separate cost receipt)

The instance uses the pinned image, a **disposable** pre-initialized data volume with an owner record, and the exact-object role from `contract.role_template`. The artifact for B1–B3 is a deliberately wrong version.

| # | Action | Expect | Stop if |
|---|---|---|---|
| B1 | Launch with an artifact `version_id` that does not exist | Console output shows the executor refused. The instance goes to `shutting-down` and then `terminated` (`InstanceInitiatedShutdownBehavior=terminate`). Root checks `describe-instances` and billing. | Instance stays `running` or `stopped` |
| B2 | Before B1 terminates, the rehearsal image's own boot-time self-test (Root-built, rehearsal image only) runs `runuser -u rougehalla -- python3.12 -c "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://169.254.169.254/latest/api/token', method='PUT', headers={'X-aws-ec2-metadata-token-ttl-seconds':'60'}), timeout=3)"` | Timeout or connection failure for `rougehalla` and `postgres`; root obtains a token | Any non-root identity reaches IMDS |
| B3 | Attach a volume whose UUID or serial differs, then one with an extra unknown file at its root | Refusal before download; afterwards Root reattaches the volume to an admin host and confirms the bytes are unchanged | Any write to that volume |
| B4 | Kill the guard during download: Root sends `aws ec2 reboot-instances` mid-boot | After reboot the guard re-runs and refuses (the run-directory partial is this run's own). Either it completes from a clean state or it powers off. It never extends the deadline: `run-deadline.json` bytes are unchanged (check via admin-host reattach of the root volume snapshot). | Deadline bytes differ, or two timers exist |

## Phase C: full practice rehearsal (only after A and B pass and Root authorizes)

1. Root pre-initializes the data volume: ext4 with the planned UUID, owner record `root:root 0600`, mount root `root 0755`. Root points practice DNS at the planned Elastic or public IP **before** boot, and has the funded reserve and cleanup owner recorded.
2. Launch from the patched template with the three nonsecret inputs. Expect, within the guard window, the executor's JSON receipt in console output if Root adds `StandardOutput=journal+console` to the guard unit (an optional review change: the receipt holds only hashes, steps and health). Without it, the only observation channel is the public endpoints.
3. External checks from Root's machine: `https://rougehalla.com/healthz` → `ok`; `/training/healthz` → `ok`; `/control` and `/training/api` → 404; `/info` shows protocol 14 and the content hash from `runtime-identity.json`. Then a browser Training flow and a two-player Arena with results bank (owner).
4. Let the backup timer fire at `deadline − backup_seconds − 180 s`. Root independently runs `HeadObject` and `GetObject` on the exact key and version with admin credentials and compares SHA-256 to the receipt (the receipt is only visible if console output is enabled). Root then restores on a **clean independent target** with `restore.sh` and the off-host age identity, and proves original client tokens and profiles, expired-lease fencing, pending Source replay and idempotence. The host's upload receipt says `offhost_restore_proved:false` and must not be used as that proof.
5. At the deadline, observe poweroff, then `terminated` state. Record gross costs.
6. Cleanup in the reviewed order (foundation README): retain the ciphertext and volume until step 4 is independently verified, then delete owned resources by the funded deadline.

## Known open items this plan must close or escalate

- The real nft JSON form (A4), real ACME latency inside the guard window (A8 and C2), and the AWS CLI v2 layout: `/opt/rougehalla/aws/bin/aws` must be a regular file, not the installer's default symlink. The `aws` tree digest records symlinks without following them.
- `initdb --no-instructions` needs PostgreSQL ≥ 14. Confirm the pinned major.
- `run-runtime.py` units still exec `/usr/bin/python3` (a symlink on Ubuntu). The executor checks unit text against the existing template, so the runtime interpreter is not hash-pinned. Root decides whether to pin it in the units.
- The host has no interactive operator channel by design. Every on-host observation in Phase C comes from console output or public endpoints.
