#!/usr/bin/env python3
"""UNRUN, exactly-once off-screen 4-case layout controller proposal."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shlex
import struct
import subprocess
import sys
from types import SimpleNamespace

PROJECT = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/repo/client-unity/UnityProject")
REPO = PROJECT.parent.parent
ROOT_RECEIPT = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/ROOT_NATIVE98_ADMISSION.json")
ROOT_RECEIPT_SHA256 = "96cb7f9591cf326df3cc0d8200bf7e414ae38ef14a9db2e557dac0021dda8d14"
LEDGER = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/evidence/test-execution-ledger.json")
LEDGER_SHA256 = "c9fa74f0d2cb6d94d7fc9b86bf0686597eb93d4bc5f069b5f2210f7ba884c6d2"
SCOPED_UNITY = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/run-02/ScopedUnity.py")
SCOPED_UNITY_SHA256 = "ffc9223970a801247020c8c1e43d9f3862713bea584263195f47780fe78f3a3a"
PREFS_GENERATOR = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/resume98-native-preparation-2026-11-09/generate_resume98_prefs_lease.py")
PREFS_GENERATOR_SHA256 = "ee35d12ff1abfadf8d742f94b9a328a42047d8c30e86d7252f16d20a76b46b25"
PREFS_TEMPLATE = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/resume98-native-preparation-2026-11-09/Resume98PrefsLeaseTemplate.cs")
PREFS_TEMPLATE_SHA256 = "a66aa04a2c99f2cfefe021d46f5d062aceabc8a90687679c61e011a91cd80be1"
PREFS_CONTROLLER = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-unity-art/resume98-native-preparation-2026-11-09/RunResume98WithPrefsLease.py")
PREFS_CONTROLLER_SHA256 = "6b495dbf0ff76b0c10de718272206f221b511cce06cfdc77904c48afbc26bace"
FREEZE = Path("/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-resume98-isolated/SOURCE_FREEZE.json")
FREEZE_SHA256 = "2845414b71e5afe0c5ad6597e38c50187e0975680a8712823b9e039f1068a343"
SOURCE = "6d5d9340a6b9f425a17d7ea4488b49291fff3dc1"
UNITY_VERSION = "6000.0.85f2"
EDITOR_PID = 46583
FORBIDDEN_PID = 9075
OVERLAY_PATH = REPO / "client-unity/UnityProject/ProjectSettings/PackageManagerSettings.asset"
OVERLAY_SHA256 = "a2cb53758656a32e072c1e33d985a3f73b8374b2acb3365750d31070d60a67b5"
OVERLAY_BYTES = 1044
R = SCOPED_UNITY.parent
COMBINED_PATH = R / "TrainingLayoutNativeFinal.cs"
EVIDENCE = R / "evidence"
PRIVATE = R / "private"
SNAPSHOT = PRIVATE / "resume98-playerprefs.snapshot.bin"
ASSEMBLY_TYPE = "LayoutProofHost6d"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def write_receipt(path, value):
    write_new(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def verify_admission(args):
    require(args.execute_layout_after_review is True, "explicit one-time layout execution flag is required")
    require(args.project == PROJECT and args.project.is_absolute() and args.project.resolve() == PROJECT,
            "project path differs from the isolated 6d project")
    require(args.editor_pid == EDITOR_PID and args.editor_pid != FORBIDDEN_PID,
            "new Editor PID differs from exact approved 46583")
    require(args.source == SOURCE and re.fullmatch(r"[0-9a-f]{40}", args.source),
            "source SHA differs from frozen 6d commit")
    require(args.root_receipt == ROOT_RECEIPT and sha(args.root_receipt) == ROOT_RECEIPT_SHA256,
            "Root Native98 receipt hash differs")
    root = json.loads(args.root_receipt.read_text())
    require(root.get("status") == "ROOT_ADMITTED_ONE_EXACT_NATIVE98_RUN"
            and root.get("source") == SOURCE and root.get("project") == str(PROJECT)
            and root.get("pid") == EDITOR_PID and root.get("cases") == 98
            and root.get("source_pins_independently_rechecked") == 1284
            and root.get("contract_sha256") == args.contract_sha256,
            "Root Native98 receipt context differs")
    require(args.ledger == LEDGER and sha(args.ledger) == LEDGER_SHA256,
            "Native98 PASS ledger hash differs")
    ledger = json.loads(args.ledger.read_text())
    names = ledger.get("executedFullNames")
    require(ledger.get("status") == "PASS" and ledger.get("expectedCaseCount") == 98
            and isinstance(names, list) and len(names) == len(set(names)) == 98
            and ledger.get("skippedFullNames") == [] and ledger.get("unrunFullNames") == []
            and len(ledger.get("passedFixtureTypes", [])) == 9
            and len(ledger.get("completedFixtureTypes", [])) == 9,
            "Native98 ledger is not exactly 98 unique passed cases")
    require(args.combined_source.is_file() and args.combined_source.is_absolute()
            and args.combined_source == COMBINED_PATH
            and re.fullmatch(r"[0-9a-f]{64}", args.combined_sha256)
            and sha(args.combined_source) == args.combined_sha256,
            "explicit combined Stage/Host source path or byte hash differs")
    for path, digest in ((SCOPED_UNITY, SCOPED_UNITY_SHA256), (PREFS_CONTROLLER, PREFS_CONTROLLER_SHA256),
                         (PREFS_GENERATOR, PREFS_GENERATOR_SHA256), (PREFS_TEMPLATE, PREFS_TEMPLATE_SHA256)):
        require(path.is_file() and sha(path) == digest, "frozen controller dependency hash differs: " + path.name)
    require(args.private_dir == PRIVATE and args.private_dir.is_dir() and not args.private_dir.is_symlink()
            and args.private_dir.stat().st_uid == os.getuid()
            and (args.private_dir.stat().st_mode & 0o777) == 0o700,
            "existing private directory is not exact owner/mode")
    require(args.evidence.is_absolute() and not args.evidence.resolve().is_relative_to(PROJECT),
            "layout evidence must be external to the Unity project")
    require(args.source_freeze == FREEZE and args.source_freeze_sha256 == FREEZE_SHA256
            and args.startup_overlay == OVERLAY_PATH and args.startup_overlay_sha256 == OVERLAY_SHA256,
            "frozen source or startup overlay pins differ")
    require(not SNAPSHOT.exists() and not SNAPSHOT.is_symlink(), "private preference snapshot already exists")
    require(not (args.evidence / "layout6d-final.json").exists(), "layout output is not create-new")

    # Run the already reviewed 1,284-pin source verifier as definitions only; do not run its Main.
    guard = runpy.run_path(str(PREFS_CONTROLLER), run_name="layout_source_guard_only")
    guard_args = SimpleNamespace(project=PROJECT, source=SOURCE, source_freeze=FREEZE,
        source_freeze_sha256=FREEZE_SHA256, startup_overlay=OVERLAY_PATH,
        startup_overlay_sha256=OVERLAY_SHA256, editor_pid=EDITOR_PID)
    source_summary = guard["verify_frozen_source"](guard_args)
    return root, ledger, source_summary


def scoped(args, name, parts):
    require(name.startswith("layout6d-") and re.fullmatch(r"[A-Za-z0-9_.-]+", name),
            "scoped evidence stem must be layout6d-prefixed")
    raw_path = EVIDENCE / name
    require(not raw_path.exists() and not raw_path.with_name(name + ".invocation.json").exists(),
            "ScopedUnity create-only evidence collision: " + name)
    command = [sys.executable, str(SCOPED_UNITY), name] + list(parts)
    proc = subprocess.run(command, cwd=R, capture_output=True)
    require(proc.returncode == 0, "ScopedUnity stopped: " + name)
    require(raw_path.is_file(), "ScopedUnity raw stdout missing: " + name)
    return json.loads(raw_path.read_bytes())


def extract_cli_result(payload):
    require(isinstance(payload, dict) and payload.get("success") is True,
            "Unity script command did not return success")
    if "hostAssemblyName" in payload or "backendApplied" in payload or "stageReady" in payload:
        return payload
    result = payload.get("result")
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return {"result": result}
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("result"), dict):
        return data["result"]
    raise ValueError("Unity command result shape is not one of the reviewed object forms")


def make_pref_wrapper(args, operation, name):
    command = [sys.executable, str(PREFS_GENERATOR), "--operation", operation,
        "--project-root", str(PROJECT), "--expected-pid", str(EDITOR_PID),
        "--excluded-pid", str(FORBIDDEN_PID), "--unity-version", UNITY_VERSION,
        "--editor-app", "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app",
        "--editor-executable", "/Applications/Unity/Hub/Editor/6000.0.85f2/Unity.app/Contents/MacOS/Unity",
        "--private-dir", str(PRIVATE), "--wrapper-name", name]
    proc = subprocess.run(command, cwd=R, capture_output=True)
    require(proc.returncode == 0, "preference wrapper generation failed: " + operation)
    receipt = json.loads(proc.stdout)
    require(receipt.get("status") == "GENERATED_UNRUN" and receipt.get("operation") == operation,
            "preference generator response differs")
    wrapper = Path(receipt.get("wrapper", ""))
    require(wrapper.parent == PRIVATE and wrapper.name == name and wrapper.is_file(),
            "generated preference wrapper path differs")
    return wrapper


def eval_pref_wrapper(args, operation, wrapper):
    payload = scoped(args, "layout6d-prefs-" + operation,
        ["script", "eval", "--", "--file", str(wrapper)])
    result = extract_cli_result(payload)
    expected = "CAPTURE_OK;keys=3" if operation == "capture" else "RESTORE_OK;keys=3;verified=3;snapshotDeleted=true"
    require(result.get("result") == expected, "preference helper did not return its exact success token")
    return result


def make_host_wrapper(args, method, assembly_name, tag, invocation_args=(), cleanup_fallback=False):
    type_args = {"Start": "", "RequestCase": "typeof(int),typeof(int),typeof(float),typeof(bool)",
                 "BeginCaptureObservation": "", "EndCaptureObservation": "", "Describe": "", "Close": ""}[method]
    literal_args = ",".join(invocation_args)
    assembly_literal = json.dumps(assembly_name or "")
    fallback = "true" if cleanup_fallback else "false"
    code = f'''using System;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
public static class Layout6dHostInvoker {{
 public static async Task<JObject> Invoke() {{
  const string expectedAssembly={assembly_literal};
  const bool allowUniqueTypeFallback={fallback};
  var exact=AppDomain.CurrentDomain.GetAssemblies().Where(a=>string.Equals(a.GetName().Name,expectedAssembly,StringComparison.Ordinal)).ToArray();
  Assembly assembly=null;
  if(expectedAssembly.Length>0) {{ if(exact.Length!=1) throw new InvalidOperationException("Compiled host assembly identity is missing or ambiguous."); assembly=exact[0]; }}
  else if(allowUniqueTypeFallback) {{
   var candidates=AppDomain.CurrentDomain.GetAssemblies().Select(a=>new {{Assembly=a,Type=a.GetType("{ASSEMBLY_TYPE}",false,false)}}).Where(x=>x.Type!=null).ToArray();
   if(candidates.Length!=1) throw new InvalidOperationException("Could not identify exactly one partially started layout host."); assembly=candidates[0].Assembly;
  }} else throw new InvalidOperationException("Exact compiled host assembly name is required.");
  var host=assembly.GetType("{ASSEMBLY_TYPE}",true,false);
  var method=host.GetMethod("{method}",BindingFlags.Public|BindingFlags.Static,null,new Type[]{{{type_args}}},null);
  if(method==null) throw new MissingMethodException(host.FullName,"{method}");
  object value=method.Invoke(null,new object[]{{{literal_args}}});
  if(value is Task<JObject> task) return await task;
  if(value is JObject json) return json;
  throw new InvalidOperationException("Public host method returned an unexpected type.");
 }}
}}'''
    wrapper = PRIVATE / ("layout6d-host-" + tag + ("-cleanup" if cleanup_fallback else "") + ".cs")
    write_new(wrapper, code)
    return wrapper


def host_call(args, method, assembly_name, tag, invocation_args=(), cleanup_fallback=False):
    wrapper = make_host_wrapper(args, method, assembly_name, tag, invocation_args, cleanup_fallback)
    stem = "layout6d-host-" + tag + ("-cleanup" if cleanup_fallback else "")
    payload = scoped(args, stem, ["script", "run", "--", "--file", str(wrapper), "--entry", "Layout6dHostInvoker.Invoke"])
    result = extract_cli_result(payload)
    return result


def extract_assembly_name(payload, result):
    candidates = [result.get("hostAssemblyName"), payload.get("hostAssemblyName") if isinstance(payload, dict) else None]
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, dict): candidates.append(data.get("hostAssemblyName"))
    names = [x for x in candidates if isinstance(x, str) and x]
    require(len(set(names)) == 1, "Start output did not expose one exact hostAssemblyName")
    return names[0]


def png_size(path):
    with path.open("rb") as stream:
        header = stream.read(24)
    require(len(header) == 24 and header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR",
            "capture output is not a valid PNG IHDR")
    return struct.unpack(">II", header[16:24])


def check_case_result(result, width, height, scale):
    require(result.get("backendApplied") is False and result.get("pointerClaims", "").startswith("open;"),
            "stage output overclaims backend or pointer acceptance")
    camera = result.get("camera")
    canvas = result.get("canvas")
    require(isinstance(camera, dict) and camera.get("targetTexturePresent") is True
            and camera.get("targetWidth") == width and camera.get("targetHeight") == height
            and camera.get("pixelWidth") == width and camera.get("pixelHeight") == height,
            "host camera/RT dimensions differ")
    require(isinstance(canvas, dict) and canvas.get("renderMode") == "ScreenSpaceCamera"
            and canvas.get("pixelWidth") == width and canvas.get("pixelHeight") == height,
            "host Canvas dimensions differ")
    case = result.get("configuredCase")
    require(isinstance(case, dict) and case.get("width") == width and case.get("height") == height
            and abs(float(case.get("scale")) - scale) < 0.0001,
            "host configured case or text scale differs")
    require(isinstance(result.get("consoleRootProjectedBounds"), dict)
            and isinstance(result.get("panelProjectedBounds"), dict),
            "host projected Canvas bounds are missing")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--execute-layout-after-review", action="store_true")
    p.add_argument("--project", type=Path, required=True)
    p.add_argument("--editor-pid", type=int, required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--combined-source", type=Path, required=True)
    p.add_argument("--combined-sha256", required=True)
    p.add_argument("--root-receipt", type=Path, required=True)
    p.add_argument("--ledger", type=Path, required=True)
    p.add_argument("--contract-sha256", required=True)
    p.add_argument("--source-freeze", type=Path, required=True)
    p.add_argument("--source-freeze-sha256", required=True)
    p.add_argument("--startup-overlay", type=Path, required=True)
    p.add_argument("--startup-overlay-sha256", required=True)
    p.add_argument("--private-dir", type=Path, required=True)
    p.add_argument("--evidence", type=Path, required=True)
    return p.parse_args()


def run(args):
    root, ledger, preflight = verify_admission(args)
    args.evidence.mkdir(parents=True, exist_ok=True)
    summary = {"status": "PREPARED", "source": SOURCE, "project": str(PROJECT),
        "editorPid": EDITOR_PID, "native98RootReceiptSha256": ROOT_RECEIPT_SHA256,
        "native98LedgerSha256": LEDGER_SHA256, "combinedSourceSha256": args.combined_sha256,
        "casesExpected": [[1280,720,1.0,False],[1280,720,1.5,True],[2560,1440,1.0,False],[2560,1440,1.5,True]],
        "caseResults": [], "pointerAcceptance": "OPEN_OFFSCREEN_CAPTURE_ONLY", "backendApplied": False}
    summary["sourcePreflightBeforeCapture"] = preflight
    captured = False
    host_started = False
    assembly_name = None
    capture_wrapper = None
    restore_wrapper = None
    try:
        capture_wrapper = make_pref_wrapper(args, "capture", "capture-layout6d-prefs.cs")
        eval_pref_wrapper(args, "capture", capture_wrapper)
        captured = True
        snapshot_stat = SNAPSHOT.lstat()
        require(SNAPSHOT.is_file() and not SNAPSHOT.is_symlink()
                and snapshot_stat.st_uid == os.getuid() and (snapshot_stat.st_mode & 0o777) == 0o600,
                "private three-key snapshot metadata differs")

        summary["sourcePreflightBeforeHost"] = runpy.run_path(str(PREFS_CONTROLLER), run_name="layout_guard")["verify_frozen_source"](
            SimpleNamespace(project=PROJECT, source=SOURCE, source_freeze=FREEZE,
                source_freeze_sha256=FREEZE_SHA256, startup_overlay=OVERLAY_PATH,
                startup_overlay_sha256=OVERLAY_SHA256, editor_pid=EDITOR_PID))
        host_started = True
        start_payload = scoped(args, "layout6d-host-start", ["script", "run", "--", "--file", str(args.combined_source), "--entry", "LayoutProofHost6d.Start"])
        start_result = extract_cli_result(start_payload)
        assembly_name = extract_assembly_name(start_payload, start_result)
        require(start_result.get("stageReady") is True and start_result.get("backendApplied") is False,
                "LayoutProofHost6d.Start did not report ready/offline state")
        # Game View/Screen facts are useful context, but this task captures the
        # owned off-screen RT. They are observational and never gate a case.
        summary["gameViewObservationAtStart"] = {
            "baseline": start_result.get("gameViewBaseline"),
            "current": start_result.get("gameViewCurrent"),
        }

        for index, (width, height, scale, bottom) in enumerate(summary["casesExpected"], 1):
            summary["sourcePreflightBeforeCase" + str(index)] = runpy.run_path(str(PREFS_CONTROLLER), run_name="layout_guard")["verify_frozen_source"](
                SimpleNamespace(project=PROJECT, source=SOURCE, source_freeze=FREEZE,
                    source_freeze_sha256=FREEZE_SHA256, startup_overlay=OVERLAY_PATH,
                    startup_overlay_sha256=OVERLAY_SHA256, editor_pid=EDITOR_PID))
            request = host_call(args, "RequestCase", assembly_name, "request-%02d" % index,
                (str(width), str(height), scale.__repr__() + "f", str(bottom).lower()))
            check_case_result(request, width, height, scale)
            summary["sourcePreflightImmediatelyBeforeCapture" + str(index)] = runpy.run_path(str(PREFS_CONTROLLER), run_name="layout_guard")["verify_frozen_source"](
                SimpleNamespace(project=PROJECT, source=SOURCE, source_freeze=FREEZE,
                    source_freeze_sha256=FREEZE_SHA256, startup_overlay=OVERLAY_PATH,
                    startup_overlay_sha256=OVERLAY_SHA256, editor_pid=EDITOR_PID))
            output = args.evidence / ("layout6d-case-%02d-%dx%d-scale%s-bottom%s.png" %
                (index, width, height, str(scale).replace(".", ""), "1" if bottom else "0"))
            capture_error = None
            begin = None
            end = None
            capture_payload = None
            try:
                begin = host_call(args, "BeginCaptureObservation", assembly_name, "begin-%02d" % index)
                require(begin.get("success") is True and begin.get("cameraName"),
                        "camera capture observation did not begin")
                require(not output.exists(), "capture PNG path already exists")
                capture_payload = scoped(args, "layout6d-capture-%02d" % index,
                    ["capture", "game_view", "--", "--source", "camera", "--camera", begin["cameraName"],
                     "--overlay", "false", "--width", str(width), "--height", str(height),
                     "--output-path", str(output)])
            except Exception as error:
                capture_error = type(error).__name__
            finally:
                try:
                    end = host_call(args, "EndCaptureObservation", assembly_name, "end-%02d" % index)
                except Exception as error:
                    if capture_error is None:
                        capture_error = type(error).__name__
            require(capture_error is None, "capture or camera observation failed: " + str(capture_error))
            require(isinstance(end, dict) and end.get("success") is True
                    and end.get("firstFailure") in (None, ""), "camera render observation failed")
            require(output.is_file() and png_size(output) == (width, height), "captured PNG IHDR dimensions differ")
            rows = end.get("captureTargetRows")
            require(isinstance(rows, list) and len(rows) > 0, "camera render observation list is empty")
            for row in rows:
                require(row.get("cameraName") == begin["cameraName"]
                        and row.get("targetTexturePresent") is True
                        and row.get("targetWidth") == width and row.get("targetHeight") == height
                        and row.get("cameraPixelWidth") == width and row.get("cameraPixelHeight") == height,
                        "one observed camera render differs from the configured exact-size RT")
            describe = host_call(args, "Describe", assembly_name, "describe-%02d" % index)
            check_case_result(describe, width, height, scale)
            summary["caseResults"].append({"case": index, "width": width, "height": height,
                "scale": scale, "bottom": bottom, "png": str(output), "pngDimensions": [width,height],
                "layoutStateBeforeCapture": request,
                "layoutStateAfterCapture": describe,
                "cameraRenderObservation": rows, "backendApplied": False,
                "pointerAcceptance": "OPEN_OFFSCREEN_CAPTURE_ONLY"})
        summary["status"] = "FOUR_OFFSCREEN_CASES_CAPTURED_PENDING_CLEANUP"
    except Exception as error:
        summary["status"] = "STOP_FIRST_LAYOUT_ERROR"
        summary["errorType"] = type(error).__name__
    finally:
        # Cleanup order is fixed and independent: close host if its exact assembly is known,
        # else uniquely identify its public host type for Close; restore prefs; then recheck sources.
        try:
            if host_started:
                if assembly_name:
                    summary["hostClose"] = host_call(args, "Close", assembly_name, "close")
                else:
                    summary["hostClose"] = host_call(args, "Close", "", "close", cleanup_fallback=True)
            else:
                summary["hostClose"] = {"success": True, "attempted": False, "reason": "host start was not attempted"}
        except Exception as error:
            summary["hostClose"] = {"success": False, "errorType": type(error).__name__}
        try:
            if SNAPSHOT.exists():
                restore_wrapper = make_pref_wrapper(args, "restore", "restore-layout6d-prefs.cs")
                summary["prefsRestore"] = eval_pref_wrapper(args, "restore", restore_wrapper)
            else:
                summary["prefsRestore"] = {"success": not captured, "attempted": False,
                    "snapshotPresent": False}
        except Exception as error:
            summary["prefsRestore"] = {"success": False, "errorType": type(error).__name__,
                "snapshotPresent": SNAPSHOT.exists()}
        summary["snapshotPresentAfter"] = SNAPSHOT.exists()
        try:
            summary["sourcePreflightFinal"] = runpy.run_path(str(PREFS_CONTROLLER), run_name="layout_guard")["verify_frozen_source"](
                SimpleNamespace(project=PROJECT, source=SOURCE, source_freeze=FREEZE,
                    source_freeze_sha256=FREEZE_SHA256, startup_overlay=OVERLAY_PATH,
                    startup_overlay_sha256=OVERLAY_SHA256, editor_pid=EDITOR_PID))
        except Exception as error:
            summary["sourcePreflightFinal"] = {"status": "STOP", "errorType": type(error).__name__}
        host_ok = isinstance(summary.get("hostClose"), dict) and summary["hostClose"].get("success") is True
        prefs_ok = isinstance(summary.get("prefsRestore"), dict) and summary["prefsRestore"].get("result") == "RESTORE_OK;keys=3;verified=3;snapshotDeleted=true"
        source_ok = summary.get("sourcePreflightFinal", {}).get("status") == "PASS"
        if summary.get("status") == "FOUR_OFFSCREEN_CASES_CAPTURED_PENDING_CLEANUP" and host_ok and prefs_ok and not summary["snapshotPresentAfter"] and source_ok:
            summary["status"] = "PASS_FOUR_OFFSCREEN_CASES_CLEANUP_AND_SOURCE"
        elif summary.get("status") == "FOUR_OFFSCREEN_CASES_CAPTURED_PENDING_CLEANUP":
            summary["status"] = "STOP_CLEANUP_OR_FINAL_SOURCE_CHECK"
        try:
            final_root, final_ledger, _ = verify_admission(args)
            summary["native98RecheckFinal"] = {"rootReceiptSha256": ROOT_RECEIPT_SHA256,
                "ledgerSha256": LEDGER_SHA256, "status": "PASS"}
        except Exception as error:
            summary["native98RecheckFinal"] = {"status": "STOP", "errorType": type(error).__name__}
        summary["native98TestsReusedNotRerun"] = True
        summary["liveGameViewPointerAcceptance"] = False
        summary["gameplayBackendAcceptance"] = False
        write_receipt(args.evidence / "layout6d-final.json", summary)
    return summary


def main():
    args = parse_args()
    result = run(args)
    print(json.dumps({"status": result.get("status"), "cases": len(result.get("caseResults", [])),
        "snapshotPresentAfter": result.get("snapshotPresentAfter"), "preferenceValuesIncluded": False}, indent=2))
    return 0 if result.get("status") == "PASS_FOUR_OFFSCREEN_CASES_CLEANUP_AND_SOURCE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
