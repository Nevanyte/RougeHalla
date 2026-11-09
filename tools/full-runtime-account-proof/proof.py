#!/usr/bin/env python3
"""Run exactly one full Source account bridge in a new durable, loopback-only PostgreSQL cluster."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]
TEST = "http_owned_source_match_spool_profile_and_leaderboard_agree"


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def run(args, log, env=None, timeout=120):
    with log.open("ab") as out:
        code = subprocess.run(args, cwd=REPO, env=env, stdout=out,
                              stderr=subprocess.STDOUT, timeout=timeout, check=False).returncode
    require(code == 0, f"command exit {code}; inspect private log {log}")


def private_state_path(candidate):
    """Reject Git membership after resolving symlinks, before creating any private state."""
    state = candidate.resolve()
    require(not state.exists(), "state must be new; failed setups are preserved, never reused")
    require(all(p.name != ".git" for p in (state, *state.parents)), "private state cannot enter Git metadata")
    parent = state.parent
    while not parent.exists():
        parent = parent.parent
    require(parent.is_dir(), "nearest existing state parent must be a directory")
    require(not any((p / ".git").exists() for p in (parent, *parent.parents)),
            "private state must be outside every Git worktree")
    # Do not let caller Git routing/ceiling variables disguise actual worktree or bare-repository membership.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(LC_ALL="C", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
    probe = subprocess.run(["git", "-C", str(parent), "rev-parse", "--absolute-git-dir"],
                           env=env, text=True, capture_output=True, timeout=5, check=False)
    require(probe.returncode != 0, "private state must be outside Git worktrees, metadata and bare repositories")
    require(probe.returncode == 128 and probe.stderr.startswith("fatal: not a git repository"),
            "cannot establish that private state is outside Git")
    return state


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--pg-bin", type=Path, default=os.environ.get("PGBIN"))
    args = parser.parse_args()
    state = private_state_path(args.state)
    require(args.pg_bin is not None and (args.pg_bin / "initdb").is_file(), "set --pg-bin or PGBIN")
    require(os.environ.get("CARGO_TARGET_DIR"), "set task-owned CARGO_TARGET_DIR after sourcing pinned environment")
    state.mkdir(mode=0o700, parents=True)
    write(state / "ownership.json", {"task": "full-runtime-account-proof", "state": str(state)})
    data = state / "data"
    pg = args.pg_bin.resolve()
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
    url = f"postgres://postgres@127.0.0.1:{port}/postgres?connect_timeout=3"
    running = False
    started = time.monotonic()
    failure = None
    try:
        run([str(pg / "initdb"), "-D", str(data), "-U", "postgres", "--auth=trust",
             "--encoding=UTF8", "--no-locale"], state / "initdb.log")
        run([str(pg / "pg_ctl"), "-D", str(data), "-l", str(state / "postgres.log"), "-w", "-o",
             f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' "
             "-c fsync=on -c synchronous_commit=on -c full_page_writes=on", "start"], state / "control.log")
        running = True
        query = """SELECT jsonb_build_object('system_identifier',system_identifier::text,
        'data_directory',current_setting('data_directory'),'port',inet_server_port(),
        'address',host(inet_server_addr()),'fsync',current_setting('fsync'),
        'synchronous_commit',current_setting('synchronous_commit'),
        'full_page_writes',current_setting('full_page_writes')) FROM pg_control_system()"""
        identity = json.loads(subprocess.check_output(
            [str(pg / "psql"), "-XAt", "-v", "ON_ERROR_STOP=1", url, "-c", query], text=True))
        require(identity["data_directory"] == str(data) and identity["port"] == port
                and identity["address"] == "127.0.0.1", "cluster ownership mismatch")
        require(all(identity[k] == "on" for k in ["fsync", "synchronous_commit", "full_page_writes"]),
                "durability must be ON")
        write(state / "cluster-identity.json", identity)
        env = os.environ.copy()
        env.update(DATABASE_URL=url, RH_FULL_RUNTIME_STATE=str(state), RH_PGTEST_STATE=str(state / "unused-pgtest-state"))
        command = ["cargo", "test", "--locked", "-p", "rh-server", "--features", "postgres",
                   "--test", "full_runtime_account_flow", "--", "--ignored", "--exact", TEST, "--nocapture"]
        write(state / "command.json", {"command": command, "git_head": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(), "RH_BUILD": env.get("RH_BUILD"),
            "RH_BUILD_REV": env.get("RH_BUILD_REV")})
        run(command, state / "test.log", env=env)
        require((state / "receipt.json").is_file(), "missing receipt: test may have been skipped")
        require("1 passed; 0 failed; 0 ignored" in (state / "test.log").read_text(), "test did not actually pass")
        require((state / "private-replay.json").is_file(), "missing genuine full replay")
    except BaseException as error:
        failure = error
        write(state / "FAILED.json", {"error": str(error), "elapsed_seconds": time.monotonic() - started,
                                     "setup_retained": True})
    finally:
        if running:
            run([str(pg / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"], state / "control.log")
        status = subprocess.run([str(pg / "pg_ctl"), "-D", str(data), "status"],
                                capture_output=True, check=False).returncode
        with socket.socket() as probe:
            closed = probe.connect_ex(("127.0.0.1", port)) != 0
        require(status == 3 and closed and not (data / "postmaster.pid").exists(), "owned cluster did not stop")
        write(state / "cleanup.json", {"pg_ctl_status": status, "port_closed": closed,
                                      "postmaster_pid_absent": True, "elapsed_seconds": time.monotonic() - started})
    if failure:
        raise failure
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in state.iterdir() if p.is_file()}
    write(state / "checksums.json", hashes)
    print(f"PASS: full Source account bridge; private receipt {state / 'receipt.json'}")


if __name__ == "__main__":
    main()
