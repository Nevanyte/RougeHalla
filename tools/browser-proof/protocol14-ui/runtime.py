#!/usr/bin/env python3
"""Private local Postgres + rh-server + static artifact supervisor for Web proof."""

from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request


PINNED_SERVER_SHA256 = "0b08727ba9cc7a5850e10f09e0737042937b865ee47dd29f1afc67abbbc242eb"
PG_BIN = Path("/opt/homebrew/opt/postgresql@16/bin")
READY_TIMEOUT_SECONDS = 30.0


def private_dir(path: Path) -> None:
    if path.is_symlink():
        raise RuntimeError("private state path must not be a symlink")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path, 0o700)
    if path.stat().st_mode & 0o077:
        raise RuntimeError("private state permissions could not be restricted")


def write_private(path: Path, value: object) -> None:
    encoded = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(fd)
    os.chmod(path, 0o600)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def free_port_excluding(excluded: set[int]) -> int:
    for _ in range(32):
        port = free_port()
        if port not in excluded:
            return port
    raise RuntimeError("could not reserve distinct loopback ports")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_quiet(argv: list[str], *, env: dict[str, str] | None = None, timeout: float = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, env=env, timeout=timeout, check=False)


def require_ok(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed (exit {result.returncode})")


def verify_postgres(pg_port: int) -> None:
    psql = PG_BIN / "psql"
    query = "SELECT current_setting('fsync'), current_setting('synchronous_commit'), current_setting('full_page_writes')"
    result = run_quiet([str(psql), "-X", "-A", "-t", "-h", "127.0.0.1", "-p", str(pg_port),
                        "-U", "postgres", "-d", "postgres", "-c", query], timeout=10)
    require_ok(result, "PostgreSQL durability verification")
    if result.stdout.strip().lower() != "on|on|on":
        raise RuntimeError("PostgreSQL durability settings are not all on")


def wait_ready(server: subprocess.Popen[bytes], port: int) -> None:
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    url = f"http://127.0.0.1:{port}/readyz"
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError("rh-server exited before readiness")
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.15)
    raise RuntimeError("rh-server readiness timed out")


def wait_port_closed(port: int, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.15):
                pass
        except OSError:
            return True
        time.sleep(0.05)
    return False


def stop_child(proc: subprocess.Popen[bytes] | None, timeout: float = 3.0) -> tuple[bool, bool]:
    if proc is None:
        return False, False
    if proc.poll() is not None:
        return True, False
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
        return True, False
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=2.0)
            return True, True
        except subprocess.TimeoutExpired:
            return False, True


class FrozenArtifactHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".data": "application/octet-stream",
        ".symbols.json": "application/json",
    }

    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def list_directory(self, path):
        self.send_error(403, "Directory listing disabled")
        return None

    def log_message(self, fmt: str, *args) -> None:
        # Static access logs can contain URLs. Keep them out of console/evidence output.
        return


def serve_artifact(root: Path) -> http.server.ThreadingHTTPServer:
    handler = lambda *args, **kwargs: FrozenArtifactHandler(*args, directory=str(root), **kwargs)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    server.allow_reuse_address = False
    return server


def prepare(args: argparse.Namespace) -> tuple[Path, Path, Path, Path]:
    private_arg = Path(args.private_state).expanduser()
    if private_arg.is_symlink():
        raise RuntimeError("private state path must not be a symlink")
    private = private_arg.resolve()
    private_dir(private)
    for name in ("runtime.json", "cleanup.json"):
        if (private / name).exists():
            raise RuntimeError(f"private state already contains {name}; use a fresh directory")
    repo = Path(args.repo).expanduser().resolve(strict=True)
    artifact = Path(args.artifact).expanduser().resolve(strict=True)
    if not repo.is_dir() or not artifact.is_dir() or not (artifact / "index.html").is_file():
        raise RuntimeError("repo and WebGL artifact directories are required; artifact needs index.html")
    binary = Path(args.server_bin).expanduser().resolve(strict=True)
    if not binary.is_file() or sha256(binary) != PINNED_SERVER_SHA256:
        raise RuntimeError("rh-server binary does not match the pinned proof executable")
    for tool in ("initdb", "pg_ctl", "psql"):
        if not (PG_BIN / tool).is_file():
            raise RuntimeError(f"PostgreSQL 16 tool missing: {tool}")
    pg_data = private / "postgres-data"
    spool = private / "result-spool"
    logs = private / "logs"
    pg_data.mkdir(mode=0o700)
    spool.mkdir(mode=0o700)
    logs.mkdir(mode=0o700)
    return private, binary, artifact, pg_data


def run(args: argparse.Namespace) -> int:
    private, binary, artifact, pg_data = prepare(args)
    previous_term_handler = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, lambda _signum, _frame: (_ for _ in ()).throw(KeyboardInterrupt()))
    spool = private / "result-spool"
    logs = private / "logs"
    static = serve_artifact(artifact)
    static_port = int(static.server_address[1])
    pg_port = free_port_excluding({static_port})
    server_port = free_port_excluding({static_port, pg_port})
    claim_passcode = secrets.token_urlsafe(32)
    database_url = f"postgres://postgres@127.0.0.1:{pg_port}/postgres"
    page_origin = f"http://127.0.0.1:{static_port}"
    server_origin = f"http://127.0.0.1:{server_port}"
    websocket_url = f"ws://127.0.0.1:{server_port}/ws"
    account_api = f"{server_origin}/api"

    pg_proc_pid = None
    server_proc = None
    static_thread = threading.Thread(target=static.serve_forever, name="proof-static", daemon=True)
    static_thread.start()
    cleanup = {"server_stopped": False, "server_forced_kill": False, "static_stopped": False,
               "postgres_stopped": False, "server_port_closed": False, "static_port_closed": False,
               "postgres_port_closed": False}
    exit_code = 0
    try:
        init = run_quiet([str(PG_BIN / "initdb"), "-D", str(pg_data), "-U", "postgres",
                          "--auth-local=trust", "--auth-host=trust", "-E", "UTF8"], timeout=60)
        require_ok(init, "PostgreSQL initialization")
        pg_log_path = logs / "postgres.log"
        pg_log_fd = os.open(pg_log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.close(pg_log_fd)
        pg_start = run_quiet([str(PG_BIN / "pg_ctl"), "-D", str(pg_data), "-l", str(logs / "postgres.log"),
                              "-w", "-t", "15", "-o",
                              f"-h 127.0.0.1 -p {pg_port} -c fsync=on -c synchronous_commit=on -c full_page_writes=on",
                              "start"], timeout=25)
        require_ok(pg_start, "PostgreSQL startup")
        # Track by PID metadata from the owned postmaster.pid file, not a process-list scan.
        pg_proc_pid = int((pg_data / "postmaster.pid").read_text(encoding="ascii").splitlines()[0])
        verify_postgres(pg_port)

        server_log = (logs / "rh-server.log").open("ab", buffering=0)
        os.chmod(logs / "rh-server.log", 0o600)
        env = os.environ.copy()
        env["PLAYTEST_PASSCODE"] = claim_passcode
        server_args = [str(binary), "--bind", f"127.0.0.1:{server_port}", "--database-url", database_url,
                       "--result-spool", str(spool), "--first-playable", "--min-players", "2",
                       "--fill-bots", "2", "--lobby-seconds", "8", "--fill-seconds", "1",
                       "--api-cors-origins", page_origin]
        server_proc = subprocess.Popen(server_args, stdin=subprocess.DEVNULL, stdout=server_log,
                                       stderr=server_log, env=env, close_fds=True)
        server_log.close()
        wait_ready(server_proc, server_port)
        runtime = {
            "claimPasscode": claim_passcode,
            "databaseUrl": database_url,
            "pageOrigin": page_origin,
            "serverOrigin": server_origin,
            "websocketUrl": websocket_url,
            "accountApi": account_api,
            "supervisorPid": os.getpid(),
            "serverPid": server_proc.pid,
            "postgresPid": pg_proc_pid,
            "postgresPort": pg_port,
            "serverPort": server_port,
            "staticPort": static_port,
            "artifact": str(artifact),
            "repo": str(Path(args.repo).expanduser().resolve()),
            "serverSha256": PINNED_SERVER_SHA256,
        }
        write_private(private / "runtime.json", runtime)
        print(json.dumps({"event": "ready", "supervisorPid": os.getpid(), "serverPid": server_proc.pid,
                          "postgresPid": pg_proc_pid, "postgresPort": pg_port, "serverPort": server_port,
                          "staticPort": static_port, "serverSha256": PINNED_SERVER_SHA256,
                          "postgresDurability": {"fsync": "on", "synchronous_commit": "on", "full_page_writes": "on"}},
                         sort_keys=True), flush=True)
        while server_proc.poll() is None:
            time.sleep(0.2)
        exit_code = 1
    except KeyboardInterrupt:
        exit_code = 0
    except Exception as exc:
        # Detailed traces stay private and must never contain private runtime values on stdout.
        try:
            write_private(private / "failure.json", {"errorType": type(exc).__name__, "message": str(exc)[:300]})
        except Exception:
            pass
        print(json.dumps({"event": "failed", "errorType": type(exc).__name__}), flush=True)
        exit_code = 1
    finally:
        try:
            cleanup["server_stopped"], cleanup["server_forced_kill"] = stop_child(server_proc, 3.0)
        except Exception:
            cleanup["server_stopped"] = False
        try:
            static.shutdown()
            static.server_close()
            static_thread.join(timeout=2.0)
            cleanup["static_stopped"] = not static_thread.is_alive()
        except Exception:
            cleanup["static_stopped"] = False
        try:
            pg_stop = run_quiet([str(PG_BIN / "pg_ctl"), "-D", str(pg_data), "-m", "fast", "-w", "-t", "8", "stop"], timeout=12)
            cleanup["postgres_stopped"] = pg_stop.returncode == 0
        except Exception:
            cleanup["postgres_stopped"] = False
        cleanup["server_port_closed"] = wait_port_closed(server_port)
        cleanup["static_port_closed"] = wait_port_closed(static_port)
        cleanup["postgres_port_closed"] = wait_port_closed(pg_port)
        cleanup.update({"supervisorPid": os.getpid(), "serverPid": server_proc.pid if server_proc else None,
                        "postgresPid": pg_proc_pid,
                        "serverPort": server_port, "staticPort": static_port, "postgresPort": pg_port})
        try:
            write_private(private / "cleanup.json", cleanup)
        except Exception:
            cleanup["cleanup_record_written"] = False
        print(json.dumps({"event": "cleanup", **cleanup}, sort_keys=True), flush=True)
        signal.signal(signal.SIGTERM, previous_term_handler)
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("run", help="start owned private local services until SIGTERM")
    command.add_argument("--private-state", required=True)
    command.add_argument("--repo", required=True)
    command.add_argument("--server-bin", required=True)
    command.add_argument("--artifact", required=True)
    args = parser.parse_args()
    if args.command == "run":
        return run(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
