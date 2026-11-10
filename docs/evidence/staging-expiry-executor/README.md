# Guarded absolute expiry executor

Exact branch base: `5e19ef1b801ef363a83217ddecd768c5aba71cac`, the canonical branch at initial check. Code commit: `31bd70d078c5d6465315e77a76c9574cd492bdcd`. Branch: `codex/staging-expiry-executor`, reusing the owned-seat-checkpoint worktree. Later coordinator commits do not change this recorded base.

The new `expiry_executor.py` is an executable Linux/root-only implementation, with a real restricted OS runner and create-only/fsynced file storage. It replaces neither the existing refusing userdata nor the old review script. All eleven earlier installer files, including the device collector, remain unchanged; no shared status/schema/dependency files were edited. Integration remains Root-owned. No host/systemd action was run on this Mac.

## Mandatory independent bootstrap boundary

Root explicitly selected an independently supervised bootstrap unit rather than assuming a standalone process can protect itself from SIGKILL before timer arming. Before deadline state creation, the executor checks Linux/effective UID0, systemd PID1, the same mount namespace, exact v2 cgroup `/system.slice/rougehalla-expiry-bootstrap.service`, and the actual manager's loaded unit properties. It must be that unit's main PID, currently starting as root/oneshot, with no drop-ins or pending reload, `FailureAction=poweroff`, finite positive startup timeout <=120s, kill-on-timeout, control-group kill, no restart, no special success exit status and no manual stop. Only reviewed systemd major **255** is supported; other versions refuse for separate semantic review. A missing/incompatible guard refuses before creating state.

[bootstrap-required.service.txt](bootstrap-required.service.txt) specifies the required integration contract. It is not installed, enabled or executed. Root must install the pinned trusted Python/module bundle, use the original exact reviewed run/timestamps, and invoke it directly as the guard's main process. A shell wrapper with a different main PID fails. Root must gate all future download/DB/public-service steps on this execution's successful current expiry gate and recheck the unchanged deadline before each step. A printed receipt from an earlier invocation is not continuing authorization. No other installer work is performed here.

The guard must exist independently before this executor starts: a killed or timed-out setup process cannot run cleanup. The fake tests model PID1's failure action separately; that model is not proof of real host shutdown. Root must separately verify the installed guard, including SIGKILL and startup-timeout cases, on the actual trusted host.

## Concrete lifecycle

The strict request contains only `run_id`, `prepared_at`, `expires_at`: canonical UTC seconds and a valid run marker, with the original window >181s and <=4.5h. It never computes a new relative deadline. After the guard check:

1. An already-expired initial/restarted boot queues `poweroff.target` with `--job-mode=replace-irreversibly --no-block`. It verifies PID1 reports the correct loaded target with a pending job or active/activating state, then raises a terminal `ShutdownRequested`; it creates no deadline state and returns no downstream gate. Loss of the bus/failed command/cancelled job cannot produce a PASS.
2. A future deadline requires the kernel's synchronized-clock property and consistent observed realtime/boottime progression. Pending shutdown also refuses. A fixed root-owned lock serializes setup. Held nofollow directory descriptors anchor `/etc/rougehalla` and `/etc/systemd/system` through root-owned, non-writable ancestors.
3. The module creates `run-deadline.json`, the shutdown service and absolute timer with `O_EXCL|O_NOFOLLOW`, root ownership, mode0600 and one link. It fsyncs each file and containing directory. Existing bytes/mode/owner/type/link count must match exactly; no overwrite, truncation, deadline renewal or cleanup occurs. Partial same-state creation can resume; corrupt state or units without an original deadline refuse. Exact existing state is re-fsynced without inode replacement.
4. It actually calls `daemon-reload`, then `enable --now` for the fixed timer. It verifies and fsyncs the expected root-owned enablement symlink/directory. It queries loaded service/timer state, canonical fragment paths/no drop-ins/no pending reload, root shutdown argv/failure action, enabled/active/waiting persistent timer, zero random delay, no monotonic timers, 1us accuracy and the actual next realtime elapse equal to the original absolute deadline. The timer also powers off on clock jumps, preventing a wall-clock rollback from silently extending it.
5. It rechecks bytes, independent guard, absence of pending shutdown and the synchronized clock. Only then does it return `expiry_gate:true` with the original deadline and material hashes. `installed:false` and `deployable:false` always remain. Any post-guard exception or handled cancellation requests independently verified PID1 shutdown and yields no gate. A SIGKILL is the independent guard's responsibility; it is not caught by Python.

Only fixed absolute `systemctl`/`timedatectl` command tuples are allowed. Executables/ancestors must be root-owned, non-writable and symlink-free. Subprocesses have no shell, null stdin, bounded captured output, five-second timeouts, fixed locale/TZ/minimal environment and no inherited credential environment. There are no cloud calls, downloads, package installs, database/secret operations, application services, timer-stop/disable commands or deployment activation.

## Primary semantics reviewed

- [Upstream v255 systemctl manual](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemctl.xml): poweroff is asynchronous acceptance, not a physical-off acknowledgement. Irreversible jobs resist conflicting transactions but an administrator can still explicitly cancel them. The code therefore verifies the observed job and returns no work gate on shutdown paths; external host-off confirmation remains required.
- [v255 unit manual](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.unit.xml): `FailureAction=poweroff` is a system-manager action for unit failure. This is the independent guard precondition, not an executor `finally` claim.
- [v255 timer manual](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.timer.xml): calendar scheduling, persistence, timing accuracy and clock-change activation inform the exact material. Persistence catches missed activations after downtime; timer slack/OS load mean this is not a hard microsecond hardware cutoff.
- [v255 timedate interface](https://raw.githubusercontent.com/systemd/systemd/v255/man/org.freedesktop.timedate1.xml): synchronized status reflects the kernel. It does not prove correct external time or an uncompromised OS; trusted host/time-source review is still required.
- [v255 systemctl property printer](https://raw.githubusercontent.com/systemd/systemd/v255/src/systemctl/systemctl-show.c), [shared scalar printer](https://raw.githubusercontent.com/systemd/systemd/v255/src/shared/bus-print-properties.c), and [manager interface](https://raw.githubusercontent.com/systemd/systemd/v255/man/org.freedesktop.systemd1.xml): the parser deliberately matches the reviewed property representations. In particular, no job is `Job=` rather than `Job=0`; an empty `TimersMonotonic` array is omitted even with `--all`. Realtime elapse is formatted as an absolute timestamp, and durations use explicit units (or zero).

## Offline verification and preserved first result

Only this new module's tests ran. Fake manager state derives from the actual private temporary unit files written by the executor; reload and arm operations alter that synthetic manager and its real private enablement symlink. Observed manager properties are then independently corrupted in negative controls, with assertions that each case reached the intended command. These tests do not echo an expected plan as OS success.

The first run was **17 tests / 1 failure**, preserved in [first-offline.txt](first-offline.txt): the cancellation test reused a previous case's queued shutdown, so the next case stopped before the intended arm/cancel point. The fixture now isolates shutdown state between simulated boots and asserts each intended stage was reached. The corrected17 passed in [after-isolation.txt](after-isolation.txt). Upstream property-printer review then corrected the two display representations above and added a focused test. Final **18/18 PASS**, [final-offline.txt](final-offline.txt). Both new files passed AST parsing, evidence `verify.sh` passed `bash -n`, and staged whitespace checks passed. There were no existing-suite reruns or native builds.

Coverage includes future/expired first boot; missing/misconfigured/successful independent guard and ordering; actual file and directory fsync calls; crash after state creation with separate emulated guard action; exact restart without inode replacement; deadline mismatch/expiry during setup; cancellation before/after arming without disarming; corrupt/orphaned/symlink/hardlink/bad-mode state; competing locks; fsync/reload/arm failures; observed timer/service/argv/time corruption; pending/cancelled/failed shutdown; wrong OS/UID/PID1/cgroup/namespace/version; fixed runner commands/environment; and Mac CLI refusal with no runner I/O or success output.

Reproduction from the worktree root:

```sh
source /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-env.sh
export CARGO_TARGET_DIR=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-expiry-state/cargo-target-not-created
export RH_PGTEST_STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/staging-expiry-state/pg-not-created
export PYTHONDONTWRITEBYTECODE=1
bash -n docs/evidence/staging-expiry-executor/verify.sh
bash docs/evidence/staging-expiry-executor/verify.sh
test ! -e "$CARGO_TARGET_DIR"
test ! -e "$RH_PGTEST_STATE"
shasum -a 256 -c docs/evidence/staging-expiry-executor/SHA256SUMS
```

The script records already-run test/AST commands; packaging does not rerun the suite. No new worktree/cache or task Cargo/PG state was created. `source-audit.json` pins all eleven unchanged earlier installer files and preserved branches. `SHA256SUMS` covers both new source files and all evidence payloads except itself. The handoff supplies the evidence commit ID to avoid self-reference.

## Remaining actual host and AWS gates

Root must review/install the bootstrap integration before any serving/downloading/DB work, pin the real Python/module/tool/OS bytes, and verify this on a trusted Linux/systemd255 host with correct external time and the actual service/cgroup/namespace. Required real tests include first boot already expired, SIGKILL/timeout before arming, fsync/power-loss/reboot persistence, real timer firing and absolute/clock-jump behavior, failed/cancelled shutdown, and no unauthorized downstream action. No such host test occurred here.

Local accepted shutdown is not proof the hardware went off, nor that EC2 terminates instead of stopping. External observation must verify actual host shutdown, configured instance-initiated shutdown behavior, final AWS instance state and bounded costs. No AWS resource/configuration was inspected or changed. Timer slack, orderly shutdown latency and the startup guard's <=120s failure boundary must be funded; this code is not a hard billing cutoff.

The deadline is immutable within this create-only executor, not tamper-proof against a privileged administrator or older disk snapshot. Root must retain trusted original plan/ownership and remote-writer fencing across restores. Root can cancel PID1 jobs; this module neither overrides that administrative authority nor converts cancellation into a PASS. Device/volume identity, PG/secret provisioning, egress/TLS, actual account/result behavior, offhost independent restore and cleanup remain separate gates. Existing installer deployment authorization stays false. This worker made no merge or push.
