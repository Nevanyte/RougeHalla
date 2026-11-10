#!/usr/bin/env python3
"""Generate a guarded external Unity script-eval wrapper; never invokes Unity."""
import argparse
import json
import os
from pathlib import Path
import shlex
import stat
import sys

EXPECTED_PROJECT = "/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject"
EXPECTED_UNITY = "6000.0.85f2"
EXPECTED_EDITOR_EXE = "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity"
EXPECTED_EDITOR_APP = "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app"
SNAPSHOT_NAME = "resume98-playerprefs.snapshot.bin"

def need_abs_dir(raw, label):
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError(label + " must be an absolute path")
    return path.resolve(strict=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True, choices=("capture", "restore"))
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--expected-pid", required=True, type=int)
    parser.add_argument("--excluded-pid", required=True, type=int)
    parser.add_argument("--unity-version", required=True)
    parser.add_argument("--editor-app", required=True)
    parser.add_argument("--editor-executable", required=True)
    parser.add_argument("--private-dir", required=True)
    parser.add_argument("--wrapper-name", required=True)
    args = parser.parse_args()

    project = need_abs_dir(args.project_root, "project-root")
    if str(project) != EXPECTED_PROJECT:
        raise ValueError("project-root does not match the pinned isolated project")
    if args.expected_pid <= 1 or args.expected_pid == args.excluded_pid:
        raise ValueError("expected-pid must be a positive new PID distinct from excluded-pid")
    if args.unity_version != EXPECTED_UNITY or args.editor_executable != EXPECTED_EDITOR_EXE or args.editor_app != EXPECTED_EDITOR_APP:
        raise ValueError("Unity version/install paths differ from the frozen install")

    private = Path(args.private_dir)
    if not private.is_absolute() or private.is_symlink():
        raise ValueError("private-dir must be an absolute, non-symlink directory")
    private = private.resolve(strict=True)
    st = private.stat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise ValueError("private-dir must be owned by the current user and have mode 0700")

    name = args.wrapper_name
    if Path(name).name != name or not name.endswith(".cs") or not name.startswith(args.operation + "-"):
        raise ValueError("wrapper-name must be a new operation-prefixed .cs basename")
    wrapper = private / name
    snapshot = private / SNAPSHOT_NAME
    if args.operation == "capture" and snapshot.exists():
        raise ValueError("snapshot already exists; refusing to overwrite")
    if args.operation == "restore":
        if snapshot.is_symlink() or not snapshot.is_file():
            raise ValueError("restore snapshot is missing or not a regular private file")
        if stat.S_IMODE(snapshot.stat().st_mode) != 0o600 or snapshot.stat().st_uid != os.getuid():
            raise ValueError("restore snapshot must be owned by the current user with mode 0600")
    if wrapper.exists() or wrapper.is_symlink():
        raise ValueError("wrapper already exists; refusing to overwrite")

    template = Path(__file__).with_name("Resume98PrefsLeaseTemplate.cs").read_text(encoding="utf-8")
    invocation = "\nreturn Resume98PrefsLease.Execute(" + ", ".join([
        json.dumps(args.operation), json.dumps(str(project)), str(args.expected_pid),
        json.dumps(args.unity_version), json.dumps(args.editor_app),
        json.dumps(args.editor_executable), json.dumps(str(snapshot)),
    ]) + ");\n"
    code = (template.rstrip() + invocation).encode("utf-8")

    fd = os.open(str(wrapper), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(code)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        # Preserve the create-new artifact for inspection; do not replace it on retry.
        raise
    os.chmod(wrapper, 0o600)

    command = ["unity", "command", "script", "eval", "--project-path", str(project),
               "--caller", "plugin", "--skill", "unity-cli", "--format", "json",
               "--", "--file", str(wrapper)]
    print(json.dumps({
        "status": "GENERATED_UNRUN",
        "operation": args.operation,
        "wrapper": str(wrapper),
        "planned_command_unrun": shlex.join(command),
        "private_snapshot_path": str(snapshot),
        "snapshot_payload_or_values_in_receipt": False,
    }, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No exception message can contain preference values because this generator never reads them.
        print(json.dumps({"status": "GENERATOR_STOP", "error_type": type(error).__name__}), file=sys.stderr)
        sys.exit(1)
