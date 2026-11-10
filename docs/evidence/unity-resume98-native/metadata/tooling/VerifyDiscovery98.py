#!/usr/bin/env python3
"""Offline typed-discovery binder candidate for the 98-case resume contract.

This script only reads receipts and writes one create-new binding receipt. It does not
invoke Unity, discover tests, or execute test bodies. Every final-source/context/hash
pin is a required CLI argument; the Candidate04 source snapshot is recorded separately.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import re

CONTRACT_SCHEMA = "roguehalla-owned-seat-resume-typed-fixture-contract/1"
EXPECTED_CASES = 98
EXPECTED_OLD_CASES = 90
EXPECTED_RESUME_CASES = 8
RESUME_FIXTURE = "Roguehalla.Client.Tests.MatchResumeEditModeTests"
EXPECTED_OVERLAY_PATH = "client-unity/UnityProject/ProjectSettings/PackageManagerSettings.asset"
EXPECTED_OVERLAY_BYTES = 1044
EXPECTED_OVERLAY_SHA256 = "a2cb53758656a32e072c1e33d985a3f73b8374b2acb3365750d31070d60a67b5"
EXPECTED_SOURCE_SHA = "6d5d9340a6b9f425a17d7ea4488b49291fff3dc1"
EXPECTED_EDITOR_PID = 46583


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def unwrap(value, label):
    if isinstance(value, dict) and "result" in value:
        require(value.get("success") is True, f"{label}: wrapper success is not true")
        return value["result"]
    return value


def exact_int(value, label):
    require(type(value) is int, f"{label}: expected a JSON integer, got {type(value).__name__}")
    return value


def verify_argument(actual, expected, full_name, index):
    label = f"{full_name} argument {index}"
    typ = expected["declaredType"]
    require(actual.get("typeFullName") == typ,
            f"{label}: runtime type {actual.get('typeFullName')!r} != {typ!r}")
    if "attributeValueType" in expected:
        require(expected["attributeValueType"] == typ,
                f"{label}: contract attribute type differs from declared type")

    value, shown = expected["value"], expected["displayValue"]
    require(actual.get("text") == shown, f"{label}: invariant text differs")
    if typ == "System.Boolean":
        require(type(value) is bool and type(actual.get("boolValue")) is bool
                and actual["boolValue"] is value, f"{label}: Boolean differs or is not Boolean")
    elif typ == "Roguehalla.Net.MatchLaunchMode":
        require(isinstance(value, dict) and actual.get("enumName") == value.get("name"),
                f"{label}: enum name differs")
        got = exact_int(actual.get("numericValue"), label + " enum numericValue")
        want = exact_int(value.get("numericValue"), label + " expected enum numericValue")
        require(got == want, f"{label}: enum numeric value differs")
    elif typ == "System.Int32":
        got = exact_int(actual.get("numericValue"), label + " Int32 numericValue")
        want = exact_int(value, label + " expected Int32")
        require(got == want, f"{label}: Int32 value differs")
    elif typ == "System.Int64":
        require(isinstance(value, str) and re.fullmatch(r"0|-?[1-9][0-9]*", value) is not None,
                f"{label}: Int64 must be a canonical decimal string")
        require(expected.get("attributeValueType") == "System.Int64",
                f"{label}: missing Int64 attribute value type")
        got = exact_int(actual.get("numericValue"), label + " Int64 numericValue")
        require(-(1 << 63) <= got <= (1 << 63) - 1, f"{label}: runtime Int64 is out of range")
        require(str(got) == value and actual["text"] == value and shown == value,
                f"{label}: Int64 decimal differs")
    else:
        raise ValueError(f"{label}: unsupported strict argument type {typ!r}")


def validate_context(native_receipt, args, project_path, bootstrap_overlay):
    native = unwrap(native_receipt, "native identity verification")
    require(native.get("status") == "PASS_IDENTITY_BEFORE_EXECUTION",
            "native/source identity has not passed before execution")
    context = native.get("context")
    require(isinstance(context, dict), "native identity receipt lacks context object")
    expected = {
        "projectPath": str(project_path),
        "editorPid": args.editor_pid,
        "unityVersion": args.unity_version,
    }
    require(args.editor_pid > 0 and args.editor_pid != args.forbidden_editor_pid,
            "Editor PID is invalid or is the forbidden pre-existing Editor")
    for key, value in expected.items():
        require(context.get(key) == value,
                f"native identity context {key} differs: {context.get(key)!r} != {value!r}")
    require(native.get("sourceSha") == args.source_sha,
            "native identity receipt must bind the exact final source SHA")
    require(native.get("bootstrapOverlay") == bootstrap_overlay,
            "native identity receipt must bind the exact approved bootstrap overlay manifest and file")
    require(args.unity_version == "6000.0.85f2", "unexpected Unity Editor version argument")
    return native, context



def validate_bootstrap_overlay(args, project_path):
    overlay_path = Path(args.bootstrap_overlay)
    require(overlay_path.is_file(), "bootstrap overlay manifest is not a file")
    manifest_sha = hashlib.sha256(overlay_path.read_bytes()).hexdigest()
    require(manifest_sha == args.bootstrap_overlay_sha256,
            "exact bootstrap overlay manifest SHA-256 differs")
    overlay = read_json(overlay_path)
    require(overlay.get("format") == "rh-unity-isolated-bootstrap-overlay/1",
            "unexpected bootstrap overlay manifest format")
    require(overlay.get("source") == EXPECTED_SOURCE_SHA == args.source_sha,
            "bootstrap overlay source SHA differs from exact frozen source")
    require(type(overlay.get("editor_pid")) is int
            and overlay["editor_pid"] == EXPECTED_EDITOR_PID == args.editor_pid,
            "bootstrap overlay Editor PID differs from exact approved Editor")
    require(overlay.get("path") == EXPECTED_OVERLAY_PATH,
            "bootstrap overlay path differs from the one approved ProjectSettings file")
    require(type(overlay.get("bytes")) is int
            and overlay["bytes"] == EXPECTED_OVERLAY_BYTES,
            "bootstrap overlay byte count differs")
    require(overlay.get("sha256") == EXPECTED_OVERLAY_SHA256,
            "bootstrap overlay file SHA-256 differs")
    target = (project_path / "ProjectSettings" / "PackageManagerSettings.asset").resolve(strict=True)
    require(target.is_file(), "approved bootstrap overlay target is not a file")
    require(target.stat().st_size == EXPECTED_OVERLAY_BYTES,
            "approved bootstrap overlay target byte count differs")
    require(hashlib.sha256(target.read_bytes()).hexdigest() == EXPECTED_OVERLAY_SHA256,
            "approved bootstrap overlay target file SHA-256 differs")
    return {
        "manifestSha256": manifest_sha,
        "path": EXPECTED_OVERLAY_PATH,
        "bytes": EXPECTED_OVERLAY_BYTES,
        "sha256": EXPECTED_OVERLAY_SHA256,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("contract", "source-pins", "discovery", "loaded-identity", "signatures",
                 "native-identity", "bootstrap-overlay", "bootstrap-overlay-sha256",
                 "output", "contract-sha256", "source-pins-sha256",
                 "source-sha", "project-path", "unity-version"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--editor-pid", required=True, type=int)
    parser.add_argument("--forbidden-editor-pid", required=True, type=int)
    args = parser.parse_args()

    contract_path = Path(args.contract)
    pins_path = Path(args.source_pins)
    output_path = Path(args.output)
    require(not output_path.exists(), f"refusing to overwrite {output_path}")
    require(hashlib.sha256(contract_path.read_bytes()).hexdigest() == args.contract_sha256,
            "exact frozen typed-contract hash differs")
    require(hashlib.sha256(pins_path.read_bytes()).hexdigest() == args.source_pins_sha256,
            "exact fixture source-pin hash differs")
    project_path = Path(args.project_path).resolve(strict=True)
    require(project_path.is_dir(), "canonical project path is not a directory")
    bootstrap_overlay = validate_bootstrap_overlay(args, project_path)

    contract = read_json(contract_path)
    pins = read_json(pins_path)
    require(contract.get("schema") == CONTRACT_SCHEMA, "unexpected typed-contract schema")
    require(contract.get("sourceSha") == pins.get("sourceSha"),
            "Candidate source snapshot differs between typed contract and source pins")
    require(pins.get("schema") == "roguehalla-owned-seat-resume-source-pins/1",
            "unexpected fixture source-pin schema")
    require(contract.get("compiledArtifactsOnly") is True
            and contract.get("testBodiesInvoked") is False
            and contract.get("unityApisInvoked") is False
            and contract.get("old90Preserved") is True,
            "contract candidate provenance is not the reviewed compiled-only Candidate04 form")

    cases = contract.get("cases")
    counts = contract.get("counts")
    require(isinstance(cases, list) and len(cases) == EXPECTED_CASES,
            "typed contract must contain exactly 98 case rows")
    require(counts == {"old90": 90, "newResume": 8, "total": 98},
            "typed contract count declaration differs from 90 + 8 = 98")
    names = [item.get("fullName") for item in cases]
    require(all(isinstance(name, str) and name for name in names)
            and len(set(names)) == EXPECTED_CASES, "contract has empty or duplicate literal fullNames")
    sources = pins.get("fixtureSources")
    require(isinstance(sources, list) and len(sources) == 9,
            "Candidate04 pins must declare exactly nine fixture source identities")
    fixtures = [item.get("fixtureType") for item in sources]
    require(all(isinstance(f, str) and f for f in fixtures) and len(set(fixtures)) == 9,
            "fixture source types are empty or duplicated")
    require(len({f.rsplit(".", 1)[-1] for f in fixtures}) == 9,
            "fixture simple names collide; class-filter mapping would be ambiguous")
    fixture_set = set(fixtures)
    require({item.get("fixtureType") for item in cases} == fixture_set,
            "typed cases and pinned fixture source identities differ")
    groups = {f: [x for x in cases if x["fixtureType"] == f] for f in fixtures}
    require(all(groups.values()), "a pinned fixture source has no typed cases")
    require(len(groups[RESUME_FIXTURE]) == EXPECTED_RESUME_CASES,
            "Candidate04 resume fixture does not contribute exactly eight cases")
    require(sum(len(v) for k, v in groups.items() if k != RESUME_FIXTURE) == EXPECTED_OLD_CASES,
            "the eight new cases plus preserved prior union do not total 98")

    guid_by_type = {}
    source_path_by_type = {}
    for source in sources:
        fixture = source["fixtureType"]
        src, meta = source.get("source"), source.get("meta")
        require(isinstance(src, dict) and isinstance(meta, dict), fixture + ": source/meta pins missing")
        require(isinstance(src.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", src["sha256"]),
                fixture + ": source SHA is not canonical")
        require(isinstance(meta.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", meta["sha256"]),
                fixture + ": meta SHA is not canonical")
        guid = meta.get("guid")
        require(isinstance(guid, str) and re.fullmatch(r"[0-9a-f]{32}", guid),
                fixture + ": meta GUID is not canonical")
        src_path, meta_path = src.get("path"), meta.get("path")
        require(isinstance(src_path, str) and src_path.endswith(".cs"), fixture + ": source path invalid")
        require(isinstance(meta_path, str) and meta_path == src_path + ".meta",
                fixture + ": source/meta path pairing differs")
        guid_by_type[fixture] = guid
        source_path_by_type[fixture] = src_path
    require(len(set(guid_by_type.values())) == 9, "fixture script GUIDs are not unique")

    native_receipt = read_json(args.native_identity)
    native, context = validate_context(native_receipt, args, project_path, bootstrap_overlay)
    discovery = unwrap(read_json(args.discovery), "public discovery")
    loaded = unwrap(read_json(args.loaded_identity), "loaded fixture identity")
    signatures_doc = unwrap(read_json(args.signatures), "loaded method signatures")

    raw_context = loaded.get("context")
    require(isinstance(raw_context, dict), "loaded identity observer lacks shared context")
    context_values = {
        "projectPath": str(project_path), "editorPid": args.editor_pid,
        "unityVersion": args.unity_version, "sourceSha": args.source_sha,
        "contractSourceSnapshot": contract["sourceSha"],
        "contractSha256": args.contract_sha256, "sourcePinsSha256": args.source_pins_sha256,
        "activeBuildTarget": "WebGL", "isCompiling": False, "isUpdating": False, "isPlaying": False,
    }
    for key, value in context_values.items():
        require(raw_context.get(key) == value,
                f"loaded observer context {key} differs: {raw_context.get(key)!r} != {value!r}")
    require(raw_context.get("editorBinaryPath"), "loaded observer context lacks Editor executable path")
    for key in ("projectPath", "editorPid", "unityVersion"):
        require(context.get(key) == raw_context.get(key),
                f"native identity and observers differ in context field {key}")
    require(native.get("sourceSha") in (None, args.source_sha),
            "native identity source SHA differs from final source argument")
    require(discovery.get("sourceSha") == args.source_sha and discovery.get("context") == raw_context,
            "discovery observer source/context differs from loaded identity observer")
    require(loaded.get("sourceSha") == args.source_sha,
            "loaded identity observer source SHA differs from final source argument")
    require(signatures_doc.get("sourceSha") == args.source_sha
            and signatures_doc.get("context") == raw_context,
            "method-signature observer source/context differs from loaded identity observer")

    require(discovery.get("executedTests") is False,
            "public discovery must explicitly state that test bodies were not executed")
    discovered_rows = discovery.get("cases")
    require(isinstance(discovered_rows, list) and len(discovered_rows) == EXPECTED_CASES,
            "public discovery must contain exactly 98 case rows")
    got_names = [row.get("fullName") for row in discovered_rows]
    require(all(isinstance(name, str) and name for name in got_names)
            and len(set(got_names)) == EXPECTED_CASES,
            "public discovery has empty or duplicate literal fullNames")
    actual = {row["fullName"]: row for row in discovered_rows}
    expected_names = set(names)
    require(set(actual) == expected_names,
            f"literal fullName mismatch: missing={sorted(expected_names-set(actual))}, "
            f"extra={sorted(set(actual)-expected_names)}")

    expected_prefixes = [f + "." for f in fixtures]
    require(discovery.get("fixturePrefixes") == expected_prefixes,
            "public discovery fixture prefixes differ from exact pinned fixture types")
    class_matches = discovery.get("classFilterMatches")
    require(isinstance(class_matches, dict)
            and set(class_matches) == {f.rsplit(".", 1)[-1] for f in fixtures},
            "public class-filter match inventory differs from the nine pinned fixtures")
    for fixture in fixtures:
        found = class_matches[fixture.rsplit(".", 1)[-1]]
        require(isinstance(found, list) and len(found) == len(set(found))
                and set(found) == {item["fullName"] for item in groups[fixture]},
                "class-filter matches differ for exact fixture type " + fixture)

    require(loaded.get("compiling") is False and loaded.get("updating") is False,
            "Editor is compiling or updating in loaded identity receipt")
    loaded_rows = loaded.get("results")
    require(isinstance(loaded_rows, list) and len(loaded_rows) == 9,
            "loaded identity must contain exactly nine fixture script results")
    loaded_by_type = {row.get("loadedType"): row for row in loaded_rows}
    require(len(loaded_by_type) == 9 and set(loaded_by_type) == fixture_set,
            "loaded fixture identities differ from exact source fixture types")
    assembly_mvids = set()
    for fixture in fixtures:
        row = loaded_by_type[fixture]
        require(row.get("guid") == guid_by_type[fixture], fixture + ": loaded script GUID mismatch")
        imported = str(row.get("importedPath", row.get("path", ""))).replace("\\", "/")
        source = source_path_by_type[fixture]
        unity_relative = "Assets/" + source.split("/Assets/", 1)[1] if "/Assets/" in source else source
        require(imported.endswith(unity_relative), fixture + ": loaded script path mismatch")
        mvid = row.get("mvid")
        require(isinstance(mvid, str) and mvid, fixture + ": missing loaded test assembly MVID")
        assembly_mvids.add(mvid)
        method_names = {item["method"] for item in groups[fixture]}
        require(set(row.get("methods", [])) == method_names,
                fixture + ": loaded method-name inventory differs")
    require(len(assembly_mvids) == 1, "fixture scripts resolve to multiple test assembly MVIDs")

    signatures = signatures_doc.get("results")
    require(isinstance(signatures, list), "method signature receipt must be an array")
    for item in cases:
        full_name = item["fullName"]
        got = actual[full_name]
        fixture, method = item["fixtureType"], item["method"]
        require(got.get("declaringType") == fixture, full_name + ": declaring type differs")
        require(got.get("methodName") == method, full_name + ": method name differs")
        require(got.get("runState") == "Runnable", full_name + ": discovery case is not Runnable")
        require(got.get("methodModuleMvid") in assembly_mvids,
                full_name + ": discovered method MVID differs from loaded fixture assembly")

        expected_params = item.get("methodParameters", [])
        actual_params = got.get("methodParameters", [])
        require(len(actual_params) == len(expected_params), full_name + ": parameter count differs")
        for index, (want, have) in enumerate(zip(expected_params, actual_params)):
            if "index" in want:
                require(want["index"] == index, full_name + ": expected parameter index is noncanonical")
            if "name" in want:
                require(have.get("name") == want["name"],
                        f"{full_name}: parameter {index} name differs")
            require(have.get("declaredType") == want["declaredType"],
                    f"{full_name}: parameter {index} declared type differs")

        if "methodReturnType" in item:
            declared = [p["declaredType"] for p in expected_params]
            matches = [m for t in signatures
                       if t.get("type") == fixture and t.get("moduleMvid") == got["methodModuleMvid"]
                       for m in t.get("methods", [])
                       if m.get("name") == method
                       and [p.get("declaredType") for p in m.get("parameters", [])] == declared]
            require(len(matches) == 1 and matches[0].get("returnType") == item["methodReturnType"],
                    full_name + ": same-module CLR return signature differs")

        expected_args = item.get("selectedArguments", [])
        actual_args = got.get("arguments", [])
        require(len(actual_args) == len(expected_args), full_name + ": argument count differs")
        for index, (have, want) in enumerate(zip(actual_args, expected_args)):
            verify_argument(have, want, full_name, index)
        if "declaredCaseAttributes" in item:
            require(got.get("nUnitTestCaseAttributes") == item["declaredCaseAttributes"],
                    full_name + ": declared NUnit TestCase metadata differs")

    require(validate_bootstrap_overlay(args, project_path) == bootstrap_overlay,
            "bootstrap overlay changed during the pre-execution binding")

    output = {
        "status": "PASS_BEFORE_EXECUTION",
        "bootstrapOverlay": bootstrap_overlay,
        "contractSchema": contract["schema"],
        "contractSha256": args.contract_sha256,
        "sourcePinsSha256": args.source_pins_sha256,
        "finalRootSourceSha": args.source_sha,
        "source": args.source_sha,
        "project": str(project_path),
        "editorPid": args.editor_pid,
        "fixtureSourcesSha256": args.source_pins_sha256,
        "nativeIdentitySha256": hashlib.sha256(Path(args.native_identity).read_bytes()).hexdigest(),
        "contractSourceSnapshot": contract["sourceSha"],
        "context": {"projectPath": str(project_path), "editorPid": args.editor_pid,
                    "unityVersion": args.unity_version},
        "cases": EXPECTED_CASES,
        "fixtureCounts": {f: len(groups[f]) for f in fixtures},
        "literalFullNamesExact": True,
        "typedMethodSignaturesExact": True,
        "typedArgumentsAndCaseAttributesExact": True,
        "loadedFixtureGuidsAndPathsExact": True,
        "loadedTestAssemblyMvid": next(iter(assembly_mvids)),
        "executedTests": False,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
        f.write("\n")
    print("PASS_BEFORE_EXECUTION: exact 98-case discovery and loaded-source identity bound")


if __name__ == "__main__":
    main()
