#!/usr/bin/env python3
"""ONE unchanged --write under an explicitly historical DOC metadata context; no auto-retry."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time
import uuid

HERE = Path(__file__).absolute().parent
ENV = {"PATH": "/usr/bin:/bin:/usr/local/bin", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}
MODULES = ["node_modules", *[f"packages/{p}/node_modules" for p in ("client", "server", "shared")]]

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def plain(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "literal absolute path required")
    for p in [*reversed(path.parents), path]:
        require(not p.is_symlink(), f"symlink path refused: {p}")
    require(path.is_dir() if directory else path.is_file(), f"missing/wrong kind: {path}")
    return path

def sha(data):
    return hashlib.sha256(data).hexdigest()

def check_pin(root, row):
    p = plain(root / row["path"])
    data = p.read_bytes()
    require(len(data) == row["bytes"] and sha(data) == row["sha256"], f"pin drift: {row['path']}")
    return data

def exact_bytes(actual, expected):
    require(actual == expected, "WHOLE-BYTE mismatch; fresh actual retained; no normalization/retry")

def inventories(repo, witness):
    source = {str(p.relative_to(repo)) for d in ("packages/shared/src", "packages/client/src", "packages/server/src/sim", "packages/server/src/bots") for p in (repo / d).rglob("*.ts")}
    source.add("packages/server/src/rooms/FxChannel.ts")
    require(source == {p for p in witness["pins"] if p.endswith(".ts")}, "source inventory changed")
    own = {str(p.relative_to(repo)) for p in (repo / witness["toolDirectory"]).rglob("*") if p.is_file() and p.suffix in (".mts", ".mjs", ".sh", ".md", ".json")}
    require(own == {p for p in witness["pins"] if p.startswith(witness["toolDirectory"] + "/")}, "original tool inventory changed")
    if witness["toolDirectory"].endswith("runner-callsite-fixtures"):
        support = {str(p.relative_to(repo)) for p in (repo / "tools/npc-continuity-fixtures").rglob("*") if p.is_file()}
        require(support == {p for p in witness["pins"] if p.startswith("tools/npc-continuity-fixtures/")}, "nested support inventory changed")

def capture_script(script):
    require(script in ("tools/npc-continuity-fixtures/capture.mts", "tools/npc-runner-callsite-fixtures/capture.mts"), "unknown producer")
    return (": >/tmp/empty-user-npmrc\n: >/tmp/empty-global-npmrc\n"
            "npm ci --ignore-scripts --no-audit --no-fund >/out/npm.log 2>&1 || exit 71\n"
            "test \"$(node -p 'process.version+\"/\"+process.platform+\"/\"+process.arch')\" = v22.23.4/linux/x64\n"
            f"/usr/bin/prlimit --fsize=134217728:134217728 -- /bin/sh -eu -c 'printf source-started > /out/source-started; exec node --import tsx {script} --write /out/actual.json'\n")

def docker_args(repo, out, snapshot, image, name, script):
    args = ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--name", name, "--label", f"rh.npc-context.owner={name}", "--cidfile", str(out / "container.cid"), "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit=256", "--memory=2g", "--cpus=2"]  # File ceiling applies only to Source below; npm remains under the other bounds.
    for src, dst, readonly in [(repo, "/repo", True), (snapshot, "/repo/docs/CONTRACTS.md", True), (out, "/out", False)]:
        require("," not in str(src), "mount path contains comma")
        args += ["--mount", f"type=bind,src={src},dst={dst}" + (",readonly" if readonly else "")]
    args += ["--tmpfs", "/tmp:rw,exec,size=1500m", "--tmpfs", "/repo/node_modules:rw,exec,size=1500m"]
    for p in MODULES[1:]:
        args += ["--tmpfs", f"/repo/{p}:rw,exec,size=256m"]
    for value in ["npm_config_cache=/tmp/npm-cache", "NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc", "NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc"]:
        args += ["--env", value]
    return args + ["--workdir", "/repo", image, "sh", "-eu", "-c", capture_script(script)]

def owned_cleanup(docker, name):
    listing = ["container", "ls", "--all", "--filter", f"name=^/{name}$", "--format", "{{.Names}}"]
    result = subprocess.run(docker + listing, env=ENV, capture_output=True, text=True, timeout=10)
    require(result.returncode == 0, "cleanup cannot verify daemon/container state")
    if not result.stdout.strip():
        return "verified-not-present"
    require(result.stdout.strip() == name, "cleanup refused: container name mismatch")
    result = subprocess.run(docker + ["inspect", "--format", '{{ index .Config.Labels "rh.npc-context.owner" }}', name], env=ENV, capture_output=True, text=True, timeout=10)
    require(result.returncode == 0 and result.stdout.strip() == name, "cleanup refused: container ownership mismatch")
    for operation in (["stop", "--time", "5", name], ["rm", "--force", name]):
        subprocess.run(docker + operation, env=ENV, capture_output=True, timeout=15)
    result = subprocess.run(docker + listing, env=ENV, capture_output=True, text=True, timeout=10)
    require(result.returncode == 0 and not result.stdout.strip(), "owned container cleanup not verified")
    return "owned-container-removed"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("witness", choices=("continuity", "runner"))
    for name in ("repo", "output", "expected-code-sha", "docker", "docker-socket"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--timeout", type=int, default=180)
    a = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", a.expected_code_sha) and 30 <= a.timeout <= 600, "expected code/timeout invalid")
    repo = plain(Path(a.repo), True)
    require(HERE == repo / "tools/npc-witness-context", "run the reviewed in-repo wrapper")
    git = lambda *args: subprocess.check_output(["git", "--no-replace-objects", "-C", str(repo), *args], env=ENV)
    require(git("rev-parse", "HEAD").decode().strip() == a.expected_code_sha, "unexpected driver HEAD")
    for p in HERE.iterdir():
        require(p.is_file(), "unexpected wrapper directory")
        require(git("show", f"HEAD:{p.relative_to(repo)}") == plain(p).read_bytes(), "unsealed wrapper bytes")
    m = json.loads((HERE / "context.json").read_text())
    require(m["format"] == "npc-witness-historical-doc-context/1", "context format")
    snapshot = plain(repo / m["historicalDoc"]["path"])
    check_pin(repo, m["historicalDoc"])
    check_pin(repo, m["currentDoc"])
    w = m["witnesses"][a.witness]
    inventories(repo, w)
    for p, pin in w["pins"].items():
        check_pin(repo, dict(path=p, **pin))
    expected = check_pin(repo, w["oracle"])
    for p in MODULES:
        plain(repo / p, True)  # Caller prepares missing EMPTY ignored mountpoints; never alter existing caches.
    for p in [repo / ".npmrc", *[repo / "packages" / n / ".npmrc" for n in ("client", "server", "shared")]]:
        require(not p.exists() and not p.is_symlink(), "project npm configuration refused (not read)")
    out = Path(a.output)
    plain(out.parent, True)
    require(not out.exists() and not out.is_symlink() and out.is_absolute() and ".." not in out.parts, "fresh literal output required")
    require(not out.is_relative_to(repo) and not repo.is_relative_to(out), "output must be outside repo")
    executable = plain(Path(a.docker))
    socket = Path(a.docker_socket)
    plain(socket.parent, True)
    require(not socket.is_symlink() and stat.S_ISSOCK(socket.stat().st_mode), "literal local Docker socket required")
    out.mkdir(mode=0o700)
    os.umask(0o077)
    (out / "empty-docker-config").mkdir(mode=0o700)
    docker = [str(executable), "--config", str(out / "empty-docker-config"), "--host", f"unix://{socket}"]
    name = "rh-npc-context-" + uuid.uuid4().hex
    argv = docker + docker_args(repo, out, snapshot, m["image"], name, w["script"])
    receipt = dict(format="npc-historical-context-run/1", status="ERROR", witness=a.witness, code=a.expected_code_sha, contextSha256=sha((HERE / "context.json").read_bytes()), historicalDoc=m["historicalDoc"], currentNormativeDoc=m["currentDoc"], argv=argv, timeoutSeconds=a.timeout, network="default Docker network for locked npm only; no host credentials/config/cache", started=time.time())
    child = None
    try:
        image = subprocess.check_output(docker + ["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", m["image"]], env=ENV, timeout=15).decode().strip()
        require(image == "linux/amd64", "existing pinned image must be linux/amd64; never pull")
        with (out / "stdout.log").open("xb") as stdout, (out / "stderr.log").open("xb") as stderr:
            child = subprocess.Popen(argv, env=ENV, stdout=stdout, stderr=stderr, start_new_session=True)
            receipt["exit"] = child.wait(timeout=a.timeout)
        require(receipt["exit"] == 0, "producer failed; inspect retained logs/raw")
        raw = plain(out / "actual.json").read_bytes()
        receipt["actual"] = dict(bytes=len(raw), sha256=sha(raw))
        exact_bytes(raw, expected)
        receipt["status"] = "EXACT_HISTORICAL_CONTEXT_BYTES"
    except Exception as error:
        receipt["error"] = str(error)
    finally:
        try:
            receipt["containerCleanup"] = owned_cleanup(docker, name)
        except Exception as error:
            receipt["cleanupError"] = str(error)
            receipt["status"] = "ERROR"
        try:
            if child is not None and child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)  # Only this wrapper's new client process group.
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
        except Exception as error:
            receipt["clientCleanupError"] = str(error)
            receipt["status"] = "ERROR"
        receipt["sourceStarted"] = (out / "source-started").is_file()
        receipt["finished"] = time.time()
        with (out / "receipt.json").open("x") as stream:
            json.dump(receipt, stream, indent=2)
            stream.write("\n")
    require(receipt["status"] == "EXACT_HISTORICAL_CONTEXT_BYTES", "context check failed; retained output, no retry")

if __name__ == "__main__":
    main()
