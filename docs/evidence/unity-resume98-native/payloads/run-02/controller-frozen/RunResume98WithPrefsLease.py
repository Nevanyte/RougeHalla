#!/usr/bin/env python3
"""UNRUN controller proposal. Requires a one-use Root admission JSON; never run during preparation."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

UNITY_VERSION = "6000.0.85f2"
OLD_EDITOR_PID = 9075
APPROVED_NEW_EDITOR_PID = 46583
ADMISSION_SCHEMA = "resume98-root-admission/1"
ADMISSION_STATUS = "ROOT_ADMITTED_ONCE"
SNAPSHOT_NAME = "resume98-playerprefs.snapshot.bin"
FROZEN_SOURCE_FREEZE_SHA256 = "2845414b71e5afe0c5ad6597e38c50187e0975680a8712823b9e039f1068a343"
APPROVED_STARTUP_OVERLAY_RELATIVE = "client-unity/UnityProject/ProjectSettings/PackageManagerSettings.asset"
APPROVED_STARTUP_OVERLAY_BYTES = 1044
APPROVED_STARTUP_OVERLAY_SHA256 = "a2cb53758656a32e072c1e33d985a3f73b8374b2acb3365750d31070d60a67b5"
APPROVED_GIT_STATUS = "?? client-unity/UnityProject/ProjectSettings/PackageManagerSettings.asset"
KEYS = ("rh.ui.profile", "roguehalla.showcase.textScale", "rh.ui.minimapScale")


def need(condition, message):
    if not condition:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run_preserved(args, stem, command):
    """Write invocation before running, then raw streams before callers parse them."""
    invocation = args.evidence / (stem + ".invocation.json")
    stdout_path = args.evidence / (stem + ".stdout.txt")
    stderr_path = args.evidence / (stem + ".stderr.txt")
    completion = args.evidence / (stem + ".completion.json")
    for path in (invocation, stdout_path, stderr_path, completion):
        need(not path.exists(), "create-only command evidence already exists: " + path.name)
    write_new(invocation, json.dumps({"argv": command, "startedUtc": utc_now()}, indent=2) + "\n")
    stdout = stderr = b""
    exit_code = None
    launch_error = None
    try:
        proc = subprocess.run(command, capture_output=True)
        stdout, stderr, exit_code = proc.stdout, proc.stderr, proc.returncode
    except Exception as error:
        launch_error = type(error).__name__
        stderr = ("launch-error-type=" + launch_error).encode("utf-8")
    write_new(stdout_path, stdout)
    write_new(stderr_path, stderr)
    write_new(completion, json.dumps({"exitCode": exit_code, "launchErrorType": launch_error,
        "finishedUtc": utc_now(), "stdoutSha256": hashlib.sha256(stdout).hexdigest(),
        "stdoutBytes": len(stdout), "stderrSha256": hashlib.sha256(stderr).hexdigest(),
        "stderrBytes": len(stderr)}, indent=2) + "\n")
    return {"stdout": stdout, "stderr": stderr, "exitCode": exit_code,
            "launchErrorType": launch_error}


def digest_arg(value, label):
    need(re.fullmatch(r"[0-9a-f]{64}", value) is not None, label + " must be a full SHA-256")
    return value


def verify_frozen_source(args):
    """Recheck the exact frozen Git/disk pins; return a small non-secret summary."""
    freeze_raw = args.source_freeze.read_bytes()
    need(hashlib.sha256(freeze_raw).hexdigest() == args.source_freeze_sha256
         == FROZEN_SOURCE_FREEZE_SHA256, "source-freeze hash differs")
    freeze = json.loads(freeze_raw)
    need(freeze.get("commit") == args.source and freeze.get("source_pin_count") == 1284
         and len(freeze.get("source_pins", [])) == 1284
         and freeze.get("serialization_exceptions") == []
         and Path(freeze.get("project", "")).resolve() == args.project,
         "frozen source identity/count/project differs")
    repo = args.project.parent.parent
    top = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=repo, text=True).strip()
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=repo, text=True).strip()
    need(Path(top).resolve() == repo.resolve() and head == args.source and tree == freeze.get("tree"),
         "frozen Git identity/path differs")

    rows = subprocess.check_output(["git", "ls-tree", "-r", "-z", args.source, "--", "client-unity", "protocol"], cwd=repo)
    entries = {}
    for record in rows.split(b"\0"):
        if not record:
            continue
        metadata, path_bytes = record.split(b"\t", 1)
        fields = metadata.decode("ascii").split()
        need(len(fields) == 3 and fields[1] == "blob", "unexpected tree entry")
        entries[path_bytes.decode("utf-8")] = fields[2]
    pins = freeze["source_pins"]
    pin_paths = [row["path"] for row in pins]
    need(len(set(pin_paths)) == 1284 and set(pin_paths) == set(entries), "frozen 1284 pathset differs")
    guid_paths = {}
    for row in pins:
        path = row["path"]
        data = (repo / path).read_bytes()
        need(len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"],
             "source pin bytes/hash differ: " + path)
        blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        need(blob == entries[path], "source Git blob differs: " + path)
        if path.endswith(".meta"):
            found = re.findall(rb"(?mi)^guid:\s*([0-9a-f]{32})\s*$", data)
            need(len(found) == 1, "metadata GUID cardinality differs: " + path)
            guid = found[0].decode("ascii").lower()
            need(guid not in guid_paths, "metadata GUID duplicate")
            guid_paths[guid] = path
    need(len(guid_paths) == freeze.get("asset_meta_guids") == 626,
         "frozen metadata GUID count differs")

    project_settings = args.project / "ProjectSettings/ProjectVersion.txt"
    version_match = re.search(r"(?m)^m_EditorVersion:\s*(\S+)\s*$", project_settings.read_text())
    need(version_match and version_match.group(1) == UNITY_VERSION, "ProjectVersion differs")
    manifest = json.loads((args.project / "Packages/manifest.json").read_bytes())
    lock = json.loads((args.project / "Packages/packages-lock.json").read_bytes())
    expected_packages = freeze.get("package_set", {})
    locked = lock.get("dependencies", {})
    need(len(expected_packages) == len(locked) == 39
         and set(expected_packages) == set(locked)
         and sum(1 for row in expected_packages.values() if row.get("source") == "registry") == 9
         and sum(1 for row in expected_packages.values() if row.get("source") == "builtin") == 30,
         "frozen package set differs")
    for name, expected in expected_packages.items():
        actual = locked[name]
        for field in ("version", "depth", "source", "dependencies", "url"):
            if field in expected:
                need(actual.get(field) == expected[field], "frozen lock entry differs: " + name)
    expected_direct = {name: row["version"] for name, row in expected_packages.items()
                       if row.get("depth") == 0}
    need(manifest.get("dependencies") == expected_direct, "frozen manifest direct dependencies differ")
    need(expected_packages.get("com.unity.test-framework", {}).get("version") == "1.6.0"
         and expected_packages["com.unity.test-framework"].get("source") == "builtin",
         "test framework pin differs")
    overlay = args.startup_overlay
    expected_overlay = args.project.parent.parent / APPROVED_STARTUP_OVERLAY_RELATIVE
    need(args.editor_pid == APPROVED_NEW_EDITOR_PID
         and overlay == expected_overlay and overlay.is_absolute() and not overlay.is_symlink()
         and overlay == overlay.resolve() and overlay.is_file()
         and overlay.stat().st_size == APPROVED_STARTUP_OVERLAY_BYTES
         and args.startup_overlay_sha256 == APPROVED_STARTUP_OVERLAY_SHA256
         and sha(overlay) == APPROVED_STARTUP_OVERLAY_SHA256,
         "approved startup overlay pin differs")
    status = subprocess.check_output(["git", "status", "--porcelain=v1", "--untracked-files=all"],
                                     cwd=repo, text=True).splitlines()
    need(status == [APPROVED_GIT_STATUS], "Git status differs from sole approved startup overlay")
    return {"status": "PASS", "commit": head, "tree": tree,
            "sourcePins": 1284, "uniqueMetaGuids": len(guid_paths),
            "startupOverlay": {"path": APPROVED_STARTUP_OVERLAY_RELATIVE,
                "bytes": APPROVED_STARTUP_OVERLAY_BYTES,
                "sha256": APPROVED_STARTUP_OVERLAY_SHA256,
                "gitStatus": status[0]}}


def require_admission(args):
    admission = load_json(args.admission)
    need(admission.get("schema") == ADMISSION_SCHEMA and admission.get("status") == ADMISSION_STATUS,
         "missing explicit Root admission")
    need(admission.get("singleUse") is True, "Root admission must be marked single-use")
    expected = {
        "project": str(args.project), "editorPid": args.editor_pid,
        "unityVersion": args.unity_version, "editorApp": args.editor_app,
        "editorExecutable": args.editor_executable, "source": args.source,
        "contractSha256": args.contract_sha256, "fixtureSourcesSha256": args.fixture_sources_sha256,
        "bindingSha256": args.binding_sha256, "nativeIdentitySha256": args.native_identity_sha256,
        "consoleBaselineSha256": args.console_baseline_sha256,
        "sourceFreezeSha256": args.source_freeze_sha256,
        "startupOverlayPath": str(args.startup_overlay),
        "startupOverlaySha256": args.startup_overlay_sha256,
        "evidence": str(args.evidence), "privateDir": str(args.private_dir),
        "runGateSha256": args.run_gate_sha256, "prefsGeneratorSha256": args.prefs_generator_sha256,
        "prefsTemplateSha256": args.prefs_template_sha256,
    }
    for key, value in expected.items():
        need(admission.get(key) == value, "Root admission pin differs: " + key)
    return admission


def validate_files(args):
    need(args.editor_pid == APPROVED_NEW_EDITOR_PID and args.editor_pid != OLD_EDITOR_PID,
         "exact approved new Editor PID required")
    need(args.unity_version == UNITY_VERSION, "Unity version differs from frozen 6000.0.85f2")
    need(re.fullmatch(r"[0-9a-f]{40}", args.source) is not None, "full final source SHA required")
    project = args.project
    need(project.is_absolute() and project.exists() and project == project.resolve(),
         "project must be an existing canonical absolute path")
    need(args.evidence.is_absolute() and not args.evidence.is_relative_to(project),
         "evidence must be absolute and outside the Unity project")
    need(args.private_dir.is_absolute() and args.private_dir.exists() and not args.private_dir.is_symlink(),
         "private directory must already exist")
    mode = args.private_dir.stat()
    need(mode.st_uid == os.getuid() and (mode.st_mode & 0o777) == 0o700,
         "private directory must be user-owned mode 0700")

    pins = {
        args.source_freeze: args.source_freeze_sha256,
        args.startup_overlay: args.startup_overlay_sha256,
        args.contract: args.contract_sha256,
        args.fixture_sources: args.fixture_sources_sha256,
        args.binding: args.binding_sha256,
        args.native_identity: args.native_identity_sha256,
        args.console_baseline: args.console_baseline_sha256,
        args.run_gate: args.run_gate_sha256,
        args.prefs_generator: args.prefs_generator_sha256,
        args.prefs_template: args.prefs_template_sha256,
    }
    for path, expected in pins.items():
        need(path.is_absolute() and path.is_file() and sha(path) == expected,
             "file missing or pinned hash differs: " + path.name)

    # The runner currently embeds its approved project path. Refuse before preference capture
    # if this project's path is not the one the pinned runner accepts.
    runner_text = args.run_gate.read_text(encoding="utf-8")
    project_match = re.search(r"^APPROVED_PROJECT\s*=\s*Path\(['\"]([^'\"]+)['\"]\)", runner_text, re.M)
    version_match = re.search(r"^UNITY_VERSION\s*=\s*['\"]([^'\"]+)['\"]", runner_text, re.M)
    need(project_match and Path(project_match.group(1)).resolve() == project,
         "pinned RunGate98 project constant does not match; do not capture prefs")
    need(version_match and version_match.group(1) == UNITY_VERSION,
         "pinned RunGate98 version constant differs")
    repo = project.parent.parent
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    need(head == args.source, "project Git HEAD differs from pinned final source")

    contract = load_json(args.contract)
    need(contract.get("schema") == "roguehalla-owned-seat-resume-typed-fixture-contract/1",
         "unexpected contract schema")
    need(contract.get("counts") == {"old90": 90, "newResume": 8, "total": 98}
         and len(contract.get("cases", [])) == 98
         and len({row.get("fullName") for row in contract["cases"]}) == 98,
         "exact 98-case contract is not pinned")
    binding = load_json(args.binding)
    native = load_json(args.native_identity)
    baseline = load_json(args.console_baseline)
    for receipt in (binding, native):
        context = receipt.get("context")
        need(receipt.get("source") == args.source and receipt.get("project") == str(project)
             and type(receipt.get("editorPid")) is int and receipt["editorPid"] == args.editor_pid
             and receipt.get("contractSha256") == args.contract_sha256
             and receipt.get("fixtureSourcesSha256") == args.fixture_sources_sha256
             and isinstance(context, dict) and context.get("projectPath") == str(project)
             and context.get("editorPid") == args.editor_pid and context.get("unityVersion") == UNITY_VERSION,
             "pre-execution identity context differs")
        need(receipt.get("executedTests") is False, "pre-execution receipt says tests were executed")
    need(binding.get("status") == "PASS_BEFORE_EXECUTION" and binding.get("cases") == 98,
         "fresh 98-case binding not admitted")
    need(native.get("status") == "PASS_IDENTITY_BEFORE_EXECUTION",
         "fresh native identity not admitted")
    need(binding.get("loadedTestAssemblyMvid") == native.get("testMvid")
         and binding.get("nativeIdentitySha256") == args.native_identity_sha256,
         "binding/native identity pins disagree")
    need(baseline.get("entries") == [] and isinstance(baseline.get("session"), str)
         and type(baseline.get("cursor")) is int
         and baseline.get("groundTruth", {}).get("compilationFailed") is False,
         "new Editor console baseline is not clean")


def exact_eval_result(payload, expected_token):
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return False
    diagnostics = payload.get("diagnostics", [])
    if diagnostics not in (None, []):
        return False
    if payload.get("output") not in (None, ""):
        return False
    result = payload.get("result")
    if isinstance(result, str):
        return result == expected_token
    # Pipeline may preserve EvalResponse as a nested result object. Accept only the
    # documented two-level shape; never recursively search arbitrary diagnostic data.
    if isinstance(result, dict):
        return (result.get("success") is True and result.get("result") == expected_token
                and result.get("diagnostics", []) in (None, [])
                and result.get("output") in (None, ""))
    return False


def target_status(args, stem):
    command = ["unity", "status", "--project-path", str(args.project), "--format", "json"]
    raw = run_preserved(args, stem, command)
    need(raw["launchErrorType"] is None and raw["exitCode"] == 0, "scoped status command failed")
    payload = json.loads(raw["stdout"])
    rows = payload.get("data", {}).get("instances") if isinstance(payload, dict) else None
    need(payload.get("success") is True and isinstance(rows, list) and len(rows) == 1,
         "scoped status did not identify exactly one Editor")
    row = rows[0]
    actual_project = row.get("projectPath", row.get("project"))
    version = row.get("version", row.get("editorVersion"))
    need(isinstance(actual_project, str) and Path(actual_project).resolve() == args.project
         and type(row.get("pid")) is int and row["pid"] == args.editor_pid
         and version == UNITY_VERSION and row.get("state") == "ready",
         "scoped Editor status project/PID/version/readiness differs")


def invoke_script(args, wrapper, phase):
    target_status(args, phase + "-target-status")
    command = ["unity", "command", "script", "eval", "--project-path", str(args.project),
               "--caller", "plugin", "--skill", "unity-cli", "--format", "json",
               "--", "--file", str(wrapper)]
    raw = run_preserved(args, phase + "-script-eval", command)
    if raw["launchErrorType"] is not None or raw["exitCode"] != 0:
        return False
    try:
        payload = json.loads(raw["stdout"])
    except Exception:
        return False
    token = "CAPTURE_OK;keys=3" if wrapper.name.startswith("capture-") else "RESTORE_OK;keys=3;verified=3;snapshotDeleted=true"
    return exact_eval_result(payload, token)


def make_wrapper(args, operation):
    wrapper_name = operation + "-resume98-prefs.cs"
    command = [sys.executable, str(args.prefs_generator), "--operation", operation,
               "--project-root", str(args.project), "--expected-pid", str(args.editor_pid),
               "--excluded-pid", str(OLD_EDITOR_PID), "--unity-version", args.unity_version,
               "--editor-app", args.editor_app, "--editor-executable", args.editor_executable,
               "--private-dir", str(args.private_dir), "--wrapper-name", wrapper_name]
    raw = run_preserved(args, operation + "-wrapper-generator", command)
    if raw["exitCode"] != 0 or raw["launchErrorType"] is not None:
        raise RuntimeError("prefs-wrapper-generation-failed")
    data = json.loads(raw["stdout"])
    need(data.get("status") == "GENERATED_UNRUN" and data.get("operation") == operation,
         "prefs wrapper generator did not return expected status")
    wrapper = Path(data["wrapper"])
    need(wrapper.parent == args.private_dir and wrapper.name == wrapper_name,
         "generated wrapper path differs")
    return wrapper


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--admission", type=Path, required=True)
    p.add_argument("--admission-sha256", required=True)
    p.add_argument("--project", type=Path, required=True)
    p.add_argument("--editor-pid", type=int, required=True)
    p.add_argument("--unity-version", required=True)
    p.add_argument("--editor-app", required=True)
    p.add_argument("--editor-executable", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--source-freeze", type=Path, required=True)
    p.add_argument("--source-freeze-sha256", required=True)
    p.add_argument("--startup-overlay", type=Path, required=True)
    p.add_argument("--startup-overlay-sha256", required=True)
    p.add_argument("--evidence", type=Path, required=True)
    p.add_argument("--private-dir", type=Path, required=True)
    for arg in ("contract", "fixture-sources", "binding", "native-identity", "console-baseline",
                "run-gate", "prefs-generator", "prefs-template"):
        p.add_argument("--" + arg, type=Path, required=True)
        p.add_argument("--" + arg + "-sha256", required=True)
    return p.parse_args()


def main():
    args = arguments()
    summary = {"status": "CONTROLLER_STOP", "source": args.source, "editorPid": args.editor_pid,
               "captureConfirmed": False, "gateInvoked": False, "gateExitCode": None,
               "restoreConfirmed": False, "preferenceValuesIncluded": False}
    snapshot = None
    try:
        args.admission_sha256 = digest_arg(args.admission_sha256, "admission-sha256")
        need(args.admission.is_absolute() and args.admission.is_file()
             and not args.admission.is_symlink() and sha(args.admission) == args.admission_sha256,
             "Root admission file/hash missing or differs")
        need(not args.private_dir.is_symlink(), "private directory must not be a symlink")
        args.project = args.project.resolve(strict=True)
        args.evidence = args.evidence.resolve(strict=False)
        args.private_dir = args.private_dir.resolve(strict=True)
        need(args.evidence.is_absolute() and not args.evidence.is_relative_to(args.project),
             "evidence must be absolute and outside the Unity project")
        args.evidence.mkdir(parents=True, exist_ok=True)
        final_path = args.evidence / "resume98-controller-final.json"
        need(not final_path.exists(), "final controller receipt already exists")

        # All source/identity/Root pins are checked before any wrapper or preference read.
        validate_files(args)
        require_admission(args)
        source_before = verify_frozen_source(args)
        summary["sourcePreflightBeforeCapture"] = source_before
        snapshot = args.private_dir / SNAPSHOT_NAME
        need(not snapshot.exists() and not snapshot.is_symlink(), "private snapshot already exists")

        marker = args.evidence / "resume98-admission-consumed.json"
        fd = os.open(str(marker), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"status": "ADMISSION_CONSUMED", "source": args.source,
                       "editorPid": args.editor_pid, "preferenceValuesIncluded": False}, stream)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())

        # Capture first, and require a private durable snapshot before the pre-test check.
        capture_wrapper = make_wrapper(args, "capture")
        captured = invoke_script(args, capture_wrapper, "capture")
        summary["captureConfirmed"] = captured
        need(captured, "prefs-capture-not-confirmed")
        snapshot_stat = snapshot.lstat()
        need(snapshot.is_file() and not snapshot.is_symlink() and snapshot_stat.st_uid == os.getuid()
             and (snapshot_stat.st_mode & 0o777) == 0o600, "private preference snapshot metadata differs")

        # Recheck all 1284 source pins and the independently approved startup overlay immediately before tests.
        summary["sourcePreflightBeforeTests"] = verify_frozen_source(args)
        gate_command = [sys.executable, str(args.run_gate), "--project", str(args.project),
            "--evidence", str(args.evidence), "--contract", str(args.contract),
            "--fixture-sources", str(args.fixture_sources), "--binding", str(args.binding),
            "--native-identity", str(args.native_identity), "--console-baseline", str(args.console_baseline),
            "--source", args.source, "--contract-sha256", args.contract_sha256,
            "--fixture-sources-sha256", args.fixture_sources_sha256,
            "--editor-pid", str(args.editor_pid), "--execute-native98"]
        summary["gateInvoked"] = True
        gate = run_preserved(args, "run-gate98", gate_command)
        summary["gateExitCode"] = gate["exitCode"]
        need(gate["launchErrorType"] is None and gate["exitCode"] == 0, "native98 gate did not pass")
        summary["status"] = "GATE_PASS_PENDING_RESTORE_AND_FINAL_PREFLIGHT"
    except Exception as error:
        summary["status"] = "CONTROLLER_STOP"
        summary["errorType"] = type(error).__name__
    finally:
        # Independently attempt restoration after every post-snapshot outcome.
        if snapshot is not None and snapshot.exists():
            try:
                restore_wrapper = make_wrapper(args, "restore")
                summary["restoreConfirmed"] = invoke_script(args, restore_wrapper, "restore")
            except Exception as error:
                summary["restoreConfirmed"] = False
                summary["restoreErrorType"] = type(error).__name__
        try:
            if snapshot is not None:
                summary["snapshotPresentAfter"] = snapshot.exists()
            summary["sourcePreflightFinal"] = verify_frozen_source(args)
        except Exception as error:
            summary["sourcePreflightFinal"] = {"status": "STOP", "errorType": type(error).__name__}
        if (summary.get("status") == "GATE_PASS_PENDING_RESTORE_AND_FINAL_PREFLIGHT"
                and summary.get("restoreConfirmed") is True
                and summary.get("snapshotPresentAfter") is False
                and summary.get("sourcePreflightFinal", {}).get("status") == "PASS"):
            summary["status"] = "PASS_GATE_RESTORED_AND_SOURCE_PREFLIGHT"
        elif summary.get("status") == "GATE_PASS_PENDING_RESTORE_AND_FINAL_PREFLIGHT":
            summary["status"] = "STOP_RESTORE_OR_FINAL_PREFLIGHT"
        if summary.get("sourcePreflightFinal", {}).get("status") != "PASS":
            summary["status"] = "STOP_FINAL_SOURCE_PREFLIGHT"
        try:
            final_path = args.evidence / "resume98-controller-final.json"
            write_new(final_path, json.dumps(summary, indent=2, sort_keys=True) + "\n")
        except Exception as error:
            summary["finalReceiptWriteErrorType"] = type(error).__name__
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary.get("status") == "PASS_GATE_RESTORED_AND_SOURCE_PREFLIGHT" else 1


if __name__ == "__main__":
    raise SystemExit(main())
