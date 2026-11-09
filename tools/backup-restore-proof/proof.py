#!/usr/bin/env python3
"""Disposable, loopback-only PostgreSQL dump/cold restore proof. No third-party Python dependencies."""

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
IDENTITY_SQL = """SELECT jsonb_build_object('system_identifier',system_identifier::text,
 'data_directory',current_setting('data_directory'),'port',inet_server_port(),
 'address',host(inet_server_addr()),'database',current_database(),
 'fsync',current_setting('fsync'),'synchronous_commit',current_setting('synchronous_commit'),
 'full_page_writes',current_setting('full_page_writes')) FROM pg_control_system()"""
SETTINGS = ("fsync", "synchronous_commit", "full_page_writes")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args, log, *, env=None, check=True, timeout=90):
    with log.open("ab") as stream:
        result = subprocess.run(
            args,
            cwd=REPO,
            env=env,
            stdout=stream,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            check=False,
        )
    if check:
        require(
            result.returncode == 0,
            f"command failed (exit {result.returncode}); private log: {log}",
        )
    return result.returncode


def sql(pg, url, statement):
    # SQL here contains no account credential. psql never inherits user startup files or ambient connection settings.
    result = subprocess.run(
        [str(pg / "psql"), "-XAt", "-v", "ON_ERROR_STOP=1", url, "-c", statement],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    require(result.returncode == 0, "psql failed; response withheld (private database)")
    return result.stdout.strip()


class Cluster:
    def __init__(self, pg, state, label, excluded_port=None):
        self.pg = pg
        self.label = label
        self.dir = state / label
        self.dir.mkdir(mode=0o700)
        self.data = self.dir / "data"
        self.running = False
        while True:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                self.port = sock.getsockname()[1]
            if self.port != excluded_port:
                break
        self.url = f"postgres://postgres@127.0.0.1:{self.port}/rh_backup?connect_timeout=3"

    def init(self):
        command(
            [
                str(self.pg / "initdb"),
                "-D",
                str(self.data),
                "-U",
                "postgres",
                "--auth=trust",
                "--encoding=UTF8",
                "--no-locale",
            ],
            self.dir / "initdb.log",
        )
        self.start()
        sql(
            self.pg,
            self.url.replace("/rh_backup?", "/postgres?"),
            "CREATE DATABASE rh_backup",
        )
        identity = json.loads(sql(self.pg, self.url, IDENTITY_SQL))
        require(identity["data_directory"] == str(self.data), "wrong data directory")
        require(
            identity["port"] == self.port and identity["address"] == "127.0.0.1",
            "wrong listener",
        )
        show = {key: sql(self.pg, self.url, f"SHOW {key}") for key in SETTINGS}
        require(
            all(value == "on" for value in show.values()),
            "durable settings must all be ON",
        )
        require(
            all(identity[key] == "on" for key in SETTINGS),
            "identity durability mismatch",
        )
        write_json(self.dir.parent / f"{self.label}-identity.json", identity)
        write_json(self.dir / "show-settings.json", show)
        return identity

    def start(self):
        command(
            [
                str(self.pg / "pg_ctl"),
                "-D",
                str(self.data),
                "-l",
                str(self.dir / "postgres.log"),
                "-w",
                "-o",
                f"-p {self.port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' "
                "-c fsync=on -c synchronous_commit=on -c full_page_writes=on",
                "start",
            ],
            self.dir / "control.log",
        )
        self.running = True

    def stop(self):
        if self.running:
            command(
                [
                    str(self.pg / "pg_ctl"),
                    "-D",
                    str(self.data),
                    "-m",
                    "fast",
                    "-w",
                    "stop",
                ],
                self.dir / "control.log",
            )
            self.running = False

    def unavailable(self):
        result = subprocess.run(
            [str(self.pg / "pg_ctl"), "-D", str(self.data), "status"],
            capture_output=True,
            check=False,
        )
        require(result.returncode == 3, "original cluster is still running")
        with socket.socket() as sock:
            require(
                sock.connect_ex(("127.0.0.1", self.port)) != 0,
                "original database port is reachable",
            )


def phase_env(state, cluster, phase, expected):
    env = os.environ.copy()
    env.update(
        RH_REQUIRE_LIVE_PENDING_LEASES="0" if (state / "saved-bundle-mode").exists() else "1",
        DATABASE_URL=cluster.url,
        RH_BACKUP_STATE=str(state),
        RH_BACKUP_PHASE=phase,
        RH_EXPECTED_IDENTITY=f"{expected}-identity.json",
    )
    return env


def phase_args(executable):
    return [
        str(executable),
        "--ignored",
        "--exact",
        "cold_backup_restore_phase",
        "--nocapture",
    ]


def phase(executable, state, cluster, name, expected=None, check=True):
    return command(
        phase_args(executable),
        state / f"{name}.log",
        env=phase_env(state, cluster, name, expected or cluster.label),
        check=check,
        timeout=45,
    )


def wait_file(path, child, seconds=25):
    end = time.monotonic() + seconds
    while not path.exists():
        require(
            child.poll() is None,
            f"source application exited early; see {path.parent / 'source.log'}",
        )
        require(time.monotonic() < end, f"timed out awaiting {path.name}")
        time.sleep(0.02)


def sync_bundle(backup):
    # pg_dump and the copied spool/credential receipts are a single recovery unit; persist every file and directory.
    for path in backup.rglob("*"):
        if path.is_file():
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
    for path in sorted([backup] + [p for p in backup.rglob("*") if p.is_dir()], reverse=True):
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def validate_bundle(backup):
    require((backup / "manifest.json").is_file(), "REQUIRED_ARTIFACT_MISSING: manifest.json")
    manifest = json.loads((backup / "manifest.json").read_text())
    entries = manifest["sha256"]
    mandatory = {
        "database.dump",
        "private-state.json",
        "boundary.json",
        "source-identity.json",
        "quiescent.json",
        "producer.json",
    }
    require(mandatory <= set(entries), "REQUIRED_ARTIFACT_MISSING: incomplete manifest")
    spool = {name for name in entries if name.startswith("spool/") and name.endswith(".rec")}
    require(
        len(spool) == 2,
        "REQUIRED_ARTIFACT_MISSING: two genuine pending records required",
    )
    require(
        manifest["pending_results"] == 2 and manifest["committed_results"] == 2,
        "invalid backup boundary",
    )
    actual = {
        str(path.relative_to(backup)) for path in backup.rglob("*") if path.is_file() and path.name != "manifest.json"
    }
    require(
        actual == set(entries),
        "REQUIRED_ARTIFACT_MISSING: bundle file inventory differs",
    )
    for name, expected in entries.items():
        path = backup / name
        require(
            not Path(name).is_absolute() and ".." not in Path(name).parts and not path.is_symlink(),
            "unsafe artifact path",
        )
        require(path.is_file(), f"REQUIRED_ARTIFACT_MISSING: {name}")
        require(digest(path) == expected, f"ARTIFACT_CHECKSUM_MISMATCH: {name}")
    return manifest


def expect_bundle_failure(backup, reason):
    try:
        validate_bundle(backup)
    except RuntimeError as error:
        require(reason in str(error), "negative control failed for an unintended reason")
        return str(error)
    raise RuntimeError("negative control falsely passed")


def build(state):
    require(
        os.environ.get("CARGO_TARGET_DIR"),
        "source pinned environment, then assign your own CARGO_TARGET_DIR",
    )
    target = Path(os.environ["CARGO_TARGET_DIR"]).resolve()
    require(
        not target.is_relative_to(REPO),
        "CARGO_TARGET_DIR must be task-owned outside Git",
    )
    # cargo emits machine-readable executable identity. Its stderr stays in a bounded private build receipt.
    with (
        (state / "build.jsonl").open("w") as out,
        (state / "build.log").open("w") as err,
    ):
        result = subprocess.run(
            [
                "cargo",
                "test",
                "-p",
                "rh-server",
                "--features",
                "postgres",
                "--test",
                "account_backup_restore_flow",
                "--locked",
                "--no-run",
                "--message-format=json",
            ],
            cwd=REPO,
            stdout=out,
            stderr=err,
            check=False,
        )
    require(result.returncode == 0, f"build failed; see {state / 'build.log'}")
    executables = [
        row["executable"]
        for line in (state / "build.jsonl").read_text().splitlines()
        if (row := json.loads(line)).get("executable")
        and row.get("target", {}).get("name") == "account_backup_restore_flow"
    ]
    require(
        len(executables) == 1,
        "expected exactly one focused integration test executable",
    )
    return Path(executables[0])


def run(state):
    pg = Path(os.environ.get("PGBIN", ""))
    require((pg / "initdb").is_file(), "PGBIN must select pinned PostgreSQL binaries")
    require(os.geteuid() != 0, "run as a non-root local user; no OS account creation")
    executable = build(state)
    source = Cluster(pg, state, "source")
    target = Cluster(pg, state, "target", source.port)
    child = None
    locker = None
    recovery_start = None
    try:
        source_id = source.init()
        target_init_start = time.monotonic()
        target_id = target.init()
        target_init_seconds = time.monotonic() - target_init_start
        require(
            source_id["system_identifier"] != target_id["system_identifier"],
            "clusters must be independently initialized",
        )
        print(
            "Two independent loopback clusters: durable settings ON; identity checks recorded.",
            flush=True,
        )
        # Negative URL test while source IS reachable: a connection refusal is not accepted as an identity proof.
        require(
            phase(executable, state, source, "guard", expected="target", check=False) != 0,
            "wrong-cluster guard falsely passed",
        )
        require(
            "CLUSTER_IDENTITY_MISMATCH" in (state / "guard.log").read_text(),
            "wrong-cluster failure was not identity rejection",
        )
        negatives = {"reachable_original_cluster": "CLUSTER_IDENTITY_MISMATCH"}
        target.stop()  # Recovery must cold-start the independent target too.
        with (state / "source.log").open("wb") as source_log:
            child = subprocess.Popen(
                phase_args(executable),
                cwd=REPO,
                env=phase_env(state, source, "source", "source"),
                stdout=source_log,
                stderr=subprocess.STDOUT,
            )
        wait_file(state / "ready-to-lock", child)
        lock_log = (state / "lease-lock.log").open("w")
        locker = subprocess.Popen(
            [str(pg / "psql"), "-XAt", "-v", "ON_ERROR_STOP=1", source.url],
            stdin=subprocess.PIPE,
            stdout=lock_log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        locker.stdin.write(
            "SET application_name='rh-backup-locker';\nBEGIN;\n"
            "SELECT profile_id FROM session_leases WHERE profile_id IN "
            "(SELECT profile_id FROM profiles WHERE callsign IN ('carol','dave')) "
            "ORDER BY profile_id FOR UPDATE;\n\\echo LEASE_LOCKS_HELD\n"
        )
        locker.stdin.flush()
        end = time.monotonic() + 10
        while "LEASE_LOCKS_HELD" not in (state / "lease-lock.log").read_text():
            require(
                locker.poll() is None and time.monotonic() < end,
                "external lease lock failed",
            )
            time.sleep(0.02)
        require(
            sql(
                pg,
                source.url,
                "SELECT count(*) FROM session_leases WHERE released_at IS NULL",
            )
            == "2",
            "two genuine admitted leases required",
        )
        (state / "locked").write_text("external locks confirmed\n")
        wait_file(state / "source-ready", child)
        require(
            len(list((state / "source-spool").glob("*.rec"))) == 2,
            "two pending records required before kill",
        )
        child.kill()
        require(
            child.wait(timeout=10) == -signal.SIGKILL,
            "source application was not killed as intended",
        )
        child = None
        # A backend blocked on a row lock may not observe its dead client's TCP FIN until the lock is granted.
        # Fence those old database writers explicitly BEFORE releasing the external locks, or they could commit late.
        require(
            json.loads(sql(pg, source.url, IDENTITY_SQL)) == source_id,
            "source identity changed before writer fencing",
        )
        terminated = sql(
            pg,
            source.url,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='rh_backup' "
            "AND pid<>pg_backend_pid() AND application_name<>'rh-backup-locker'",
        ).splitlines()
        require(all(value == "t" for value in terminated), "old writer termination failed")
        write_json(
            state / "writer-fence.json",
            {
                "application_sigkill": True,
                "old_backends_terminated": len(terminated),
                "order": [
                    "external lease locks",
                    "genuine spool fsync",
                    "application SIGKILL",
                    "terminate old database backends",
                    "only locker remains",
                    "ROLLBACK external locks",
                    "zero sessions",
                    "boundary comparison",
                    "pg_dump",
                ],
            },
        )
        # Wait for app connections to vanish while the independent lock holder remains alive.
        end = time.monotonic() + 10
        while (
            sql(
                pg,
                source.url,
                "SELECT count(*) FROM pg_stat_activity WHERE datname='rh_backup' AND pid<>pg_backend_pid()",
            )
            != "1"
        ):
            require(time.monotonic() < end, "source application connections did not close")
            time.sleep(0.02)
        locker.stdin.write("ROLLBACK;\n\\q\n")
        locker.stdin.flush()
        require(locker.wait(timeout=10) == 0, "external locker failed")
        locker = None
        lock_log.close()
        phase(executable, state, source, "boundary")
        require(
            sql(
                pg,
                source.url,
                "SELECT count(*) FROM pg_stat_activity WHERE datname='rh_backup' AND pid<>pg_backend_pid()",
            )
            == "0",
            "backup boundary is not quiescent",
        )
        boundary_at = time.time()
        backup = state / "backup"
        backup.mkdir(mode=0o700)
        shutil.copytree(state / "source-spool", backup / "spool")
        for name in (
            "private-state.json",
            "boundary.json",
            "source-identity.json",
            "quiescent.json",
            "producer.json",
        ):
            shutil.copy2(state / name, backup / name)
        command(
            [
                str(pg / "pg_dump"),
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                "--file",
                str(backup / "database.dump"),
                source.url,
            ],
            state / "pg-dump.log",
        )
        write_json(
            backup / "manifest.json",
            {
                "format": 1,
                "boundary_unix_seconds": boundary_at,
                "committed_results": 2,
                "pending_results": 2,
                "sha256": {
                    str(path.relative_to(backup)): digest(path) for path in sorted(backup.rglob("*")) if path.is_file()
                },
            },
        )
        sync_bundle(backup)
        manifest = validate_bundle(backup)
        command(
            [str(pg / "pg_restore"), "--list", str(backup / "database.dump")],
            state / "archive-toc.log",
        )
        # No source application or database is available during any positive restore/application verification.
        source.stop()
        source.unavailable()
        print(
            "Quiescent boundary: 2 committed results + 2 genuine pending spool records; source stopped.",
            flush=True,
        )
        recovery_start = time.monotonic()
        target.start()
        require(
            json.loads(sql(pg, target.url, IDENTITY_SQL)) == target_id,
            "cold target identity changed",
        )
        truncated = state / "truncated.dump"
        truncated.write_bytes((backup / "database.dump").read_bytes()[:64])
        sql(
            pg,
            target.url.replace("/rh_backup?", "/postgres?"),
            "CREATE DATABASE rejected_restore",
        )
        require(
            command(
                [
                    str(pg / "pg_restore"),
                    "--exit-on-error",
                    "--single-transaction",
                    "--no-owner",
                    "--no-privileges",
                    "--dbname",
                    target.url.replace("/rh_backup?", "/rejected_restore?"),
                    str(truncated),
                ],
                state / "truncated-restore.log",
                check=False,
            )
            != 0,
            "truncated archive falsely restored",
        )
        truncated_reason = (state / "truncated-restore.log").read_text()
        require(
            "end of file" in truncated_reason.lower() or "too short" in truncated_reason.lower(),
            "truncated archive failed for an unintended reason",
        )
        negatives["truncated_archive_pg_restore"] = truncated_reason.strip()
        # Independently test the same required-artifact validator used immediately before the real restore.
        damaged = state / "negative-bundle"
        shutil.copytree(backup, damaged)
        first = next((damaged / "spool").glob("*.rec"))
        first.unlink()
        negatives["missing_pending_spool"] = expect_bundle_failure(damaged, "REQUIRED_ARTIFACT_MISSING")
        shutil.rmtree(damaged)
        shutil.copytree(backup, damaged)
        (damaged / "private-state.json").unlink()
        negatives["missing_authentication_receipt"] = expect_bundle_failure(damaged, "REQUIRED_ARTIFACT_MISSING")
        shutil.rmtree(damaged)
        shutil.copytree(backup, damaged)
        with (damaged / "database.dump").open("ab") as stream:
            stream.write(b"corrupt")
        negatives["corrupt_archive_checksum"] = expect_bundle_failure(damaged, "ARTIFACT_CHECKSUM_MISMATCH")
        validate_bundle(backup)
        source.unavailable()
        command(
            [
                str(pg / "pg_restore"),
                "--exit-on-error",
                "--single-transaction",
                "--no-owner",
                "--no-privileges",
                "--dbname",
                target.url,
                str(backup / "database.dump"),
            ],
            state / "pg-restore.log",
        )
        shutil.copytree(backup / "spool", state / "recovered-spool")
        # The verifier receives only target URL and identity. Its private receipts came from the validated bundle.
        for name in ("private-state.json", "boundary.json"):
            shutil.copy2(backup / name, state / name)
        phase(executable, state, target, "verify")
        source.unavailable()
        require(
            json.loads(sql(pg, target.url, IDENTITY_SQL)) == target_id,
            "target identity changed",
        )
        elapsed = time.monotonic() - recovery_start
        receipt = {
            "status": "PASS",
            "base_sha": "86f03cbdda15eca64585093d5c88fda2c42e4810",
            "tested_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
            "source": source_id,
            "target": target_id,
            "show_settings": {
                label: json.loads((state / label / "show-settings.json").read_text()) for label in ("source", "target")
            },
            "backup_manifest_sha256": digest(backup / "manifest.json"),
            "archive_sha256": manifest["sha256"]["database.dump"],
            "archive_bytes": (backup / "database.dump").stat().st_size,
            "recovery_seconds_including_target_start_and_negative_controls": round(elapsed, 3),
            "target_initialization_seconds_separate": round(target_init_seconds, 3),
            "negative_controls": negatives,
            "verification": json.loads((state / "verified.json").read_text()),
            "producer": json.loads((state / "producer.json").read_text()),
            "writer_fence": json.loads((state / "writer-fence.json").read_text()),
            "test_executable_sha256": digest(executable),
            "source_test_sha256": digest(REPO / "crates/rh-server/tests/account_backup_restore_flow.rs"),
            "orchestrator_sha256": digest(Path(__file__)),
        }
        write_json(state / "receipt.json", receipt)
        print(
            "PASS: cold restore + original HTTP credentials + pending recovery "
            f"+ duplicate/fence protection ({elapsed:.3f}s).",
            flush=True,
        )
        print(f"Private receipts/artifacts: {state}", flush=True)
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=10)
        if locker is not None and locker.poll() is None:
            locker.kill()
            locker.wait(timeout=10)
        # Stop only the two data directories this invocation created. Keep all artifacts for review, including failures.
        failures = []
        for cluster in (source, target):
            try:
                cluster.stop()
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                failures.append(str(error))
        require(not failures, "task-owned cluster cleanup failed: " + "; ".join(failures))


def recover_saved(state, bundle):
    """Rehearse recovery/rollback using ONLY a saved local proof bundle, never the old database."""
    manifest = validate_bundle(bundle)
    (state / "saved-bundle-mode").write_text("recover before new admissions, including after lease expiry\n")
    original = json.loads((bundle / "source-identity.json").read_text())
    require(
        original["address"] == "127.0.0.1",
        "only local synthetic proof bundles are supported",
    )
    with socket.socket() as sock:
        require(
            sock.connect_ex(("127.0.0.1", original["port"])) != 0,
            "OLD_WRITER_NOT_FENCED: original database port is still reachable",
        )
    require(
        not (Path(original["data_directory"]) / "postmaster.pid").exists(),
        "OLD_WRITER_NOT_FENCED: original PostgreSQL has a postmaster PID",
    )
    pg = Path(os.environ.get("PGBIN", ""))
    require(
        (pg / "initdb").is_file() and os.geteuid() != 0,
        "pinned PostgreSQL and non-root user required",
    )
    executable = build(state)
    cluster = Cluster(pg, state, "target", original["port"])
    try:
        started = time.monotonic()
        identity = cluster.init()
        require(
            identity["system_identifier"] != original["system_identifier"],
            "independent target required",
        )
        shutil.copytree(bundle, state / "backup")
        validate_bundle(state / "backup")
        command(
            [
                str(pg / "pg_restore"),
                "--exit-on-error",
                "--single-transaction",
                "--no-owner",
                "--no-privileges",
                "--dbname",
                cluster.url,
                str(state / "backup/database.dump"),
            ],
            state / "pg-restore.log",
        )
        shutil.copytree(state / "backup/spool", state / "recovered-spool")
        for name in ("private-state.json", "boundary.json"):
            shutil.copy2(state / "backup" / name, state / name)
        phase(executable, state, cluster, "verify")
        elapsed = time.monotonic() - started
        write_json(
            state / "receipt.json",
            {
                "status": "PASS",
                "operation": "saved-bundle-recovery",
                "source": original,
                "target": identity,
                "archive_sha256": manifest["sha256"]["database.dump"],
                "recovery_seconds_including_initdb": round(elapsed, 3),
                "verification": json.loads((state / "verified.json").read_text()),
                "test_executable_sha256": digest(executable),
            },
        )
        print(
            f"PASS: saved bundle -> fresh initdb -> authenticated recovery ({elapsed:.3f}s).",
            flush=True,
        )
        print(f"Private receipts/artifacts: {state}", flush=True)
    finally:
        cluster.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--state",
        type=Path,
        help="new private absolute directory outside the repository; preserved on failure/success",
    )
    parser.add_argument(
        "--restore-bundle",
        type=Path,
        help="recover a saved synthetic proof bundle into a fresh local cluster; old database must be stopped",
    )
    args = parser.parse_args()
    os.umask(0o077)
    if args.state:
        state = args.state.expanduser().absolute()
        require(
            not state.resolve().is_relative_to(REPO),
            "private database artifacts must be outside Git",
        )
        state.mkdir(mode=0o700, parents=True, exist_ok=False)
    else:
        state = Path(tempfile.mkdtemp(prefix="rh-cold-restore-"))
    # Deliberately assign task-owned state AFTER the caller sources final-env.sh. Never run the nondurable launcher.
    os.environ["RH_PGTEST_STATE"] = str(state / "unused-pgtest-state")
    print(f"Private proof state: {state}", flush=True)
    if args.restore_bundle:
        recover_saved(state, args.restore_bundle.expanduser().resolve())
    else:
        run(state)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
