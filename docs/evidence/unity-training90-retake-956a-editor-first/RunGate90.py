#!/usr/bin/env python3
"""One-shot schema-2 Test Framework orchestration. UNEXECUTED helper; never retries or resumes."""
from pathlib import Path
import datetime, json, subprocess, hashlib, re

ROOT = Path(__file__).resolve().parent
PROJECT = Path("/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject")
CONTRACT = ROOT / "EXPECTED_SELECTORS.json"
BINDING = ROOT / "evidence/discovery-binding-verification.json"
LEDGER = ROOT / "evidence/test-execution-ledger.json"
EVIDENCE = ROOT / "evidence"


def require(ok, message):
    if not ok: raise ValueError(message)


def write_new(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="") as f: f.write(text)


def sha(text): return hashlib.sha256(text.encode("utf-8")).hexdigest()


def validate_result(text, expected_names):
    data = json.loads(text)
    require(data.get("success") is True, "CLI result success is not true")
    results = data.get("Results")
    require(isinstance(results, list), "CLI result has no Results list")
    names = [x.get("FullName") for x in results]
    require(all(isinstance(x, str) and x for x in names), "CLI returned an empty FullName")
    require(len(names) == len(set(names)), "CLI returned duplicate test FullNames")
    require(set(names) == expected_names, f"result FullNames differ: missing={sorted(expected_names-set(names))}, extra={sorted(set(names)-expected_names)}")
    require(all(x.get("Status") == "Passed" and x.get("Message") is None and x.get("StackTrace") is None for x in results),
            "one or more cases failed, skipped, or returned diagnostics")
    expected_summary = {"Total": len(expected_names), "Passed": len(expected_names), "Failed": 0, "Skipped": 0, "Inconclusive": 0}
    require(data.get("Summary") == expected_summary, f"summary mismatch: {data.get('Summary')!r} != {expected_summary!r}")
    return data["Summary"], names


def main():
    require(not LEDGER.exists(), f"refusing rerun/resume: {LEDGER} already exists")
    contract = json.loads(CONTRACT.read_text())
    require(contract.get("schema") == "roguehalla-unity-editmode-typed-fixture-contract/2", "unexpected contract schema")
    require(hashlib.sha256(CONTRACT.read_bytes()).hexdigest() == "2a6290fd1ded1c4b97eae92d87f5e55f63a8b3f7f9a0b453a8bef6088ab5e2b8", "frozen contract hash differs")
    native=json.loads((ROOT / "evidence/native-identity-verification.json").read_text())
    require(native.get("status")=="PASS_IDENTITY_BEFORE_EXECUTION", "native/source identity missing")
    cases = contract["cases"]
    fixture_types = [x["fixtureType"] for x in contract["fixtureSources"]]
    require(len(cases) == 90 and len(fixture_types) == 8 and len(set(fixture_types)) == 8, "unexpected 90-case/eight-fixture contract")
    by_type = {name: [x for x in cases if x["fixtureType"] == name] for name in fixture_types}
    require(all(by_type.values()), "a canonical fixture type has no expected cases")
    all_names = [x["fullName"] for x in cases]
    require(len(set(all_names)) == 90, "expected contract contains duplicate full names")
    binding = json.loads(BINDING.read_text())
    require(binding.get("status") == "PASS_BEFORE_EXECUTION" and binding.get("executedTests") is False,
            "public discovery/identity binding has not passed before execution")
    require(binding.get("source") == "956a80dcfe89dd290816f2ea6051b210b7a4834f" and binding.get("cases") == 90,
            "discovery binding is for a different source/case set")

    slug = lambda s: re.sub(r"[^A-Za-z0-9_-]+", "_", s)
    paths = []
    for i, fixture in enumerate(fixture_types, 1):
        prefix = EVIDENCE / f"run-{i:02d}-{slug(fixture)}"
        paths.extend([Path(str(prefix) + ".stdout.txt"), Path(str(prefix) + ".stderr.txt"), Path(str(prefix) + ".invocation.json")])
    for path in [LEDGER, *paths]: require(not path.exists(), f"refusing to overwrite existing execution evidence: {path}")

    ledger = {
        "policy": "exactly once per canonical fixtureType; stop at first error; no retry or resume",
        "source": "956a80dcfe89dd290816f2ea6051b210b7a4834f", "proposedSourceSnapshot": contract["sourceSnapshot"], "schema": contract["schema"],
        "status": "NOT_STARTED", "expectedCaseCount": 90, "completedFixtureTypes": [],
        "groups": [], "unrunFullNames": list(all_names), "unresolvedCurrentFixtureFullNames": []
    }
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    write_new(LEDGER, json.dumps(ledger, indent=2) + "\n")

    for index, fixture in enumerate(fixture_types):
        expected = {x["fullName"] for x in by_type[fixture]}
        prefix = EVIDENCE / f"run-{index+1:02d}-{slug(fixture)}"
        stdout_path, stderr_path, invocation_path = (Path(str(prefix) + suffix) for suffix in (".stdout.txt", ".stderr.txt", ".invocation.json"))
        argv = ["unity", "command", "test", "run", "--project-path", str(PROJECT), "--caller", "plugin", "--skill", "unity-cli", "--format", "json", "--timeout", "60", "--", "--mode", "editor", "--filter", fixture, "--timeout", "60"]
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        group = {"fixtureType": fixture, "filter": fixture, "expectedFullNames": sorted(expected), "state": "IN_FLIGHT", "argv": argv, "startedUtc": started}
        ledger["status"] = "RUNNING"; ledger["groups"].append(group); ledger["unresolvedCurrentFixtureFullNames"] = sorted(expected)
        with LEDGER.open("w", encoding="utf-8") as f: json.dump(ledger, f, indent=2); f.write("\n")

        launch_error = None; exit_code = None; out = err = ""
        try:
            process = subprocess.run(argv, capture_output=True, text=True)
            out, err, exit_code = process.stdout, process.stderr, process.returncode
        except Exception as error:
            launch_error = repr(error); err = launch_error

        # Persist exact process outputs and invocation receipt before parsing or validating them.
        write_new(stdout_path, out)
        write_new(stderr_path, err)
        invocation = {"argv": argv, "startedUtc": started, "finishedUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "exitCode": exit_code, "launchError": launch_error, "stdoutSha256": sha(out), "stdoutBytes": len(out.encode("utf-8")),
                      "stderrSha256": sha(err), "stderrBytes": len(err.encode("utf-8"))}
        write_new(invocation_path, json.dumps(invocation, indent=2) + "\n")
        group.update({"state": "RETURNED", "exitCode": exit_code, "launchError": launch_error,
                      "stdoutPath": str(stdout_path), "stderrPath": str(stderr_path), "invocationPath": str(invocation_path)})
        with LEDGER.open("w", encoding="utf-8") as f: json.dump(ledger, f, indent=2); f.write("\n")

        try:
            require(launch_error is None and exit_code == 0, f"CLI launch/exit failure: {launch_error or exit_code}")
            summary, actual_names = validate_result(out, expected)
            group.update({"state": "PASS", "summary": summary, "actualFullNames": actual_names, "exactFullNames": True})
            ledger["completedFixtureTypes"].append(fixture)
            ledger["unresolvedCurrentFixtureFullNames"] = []
            remaining_types = fixture_types[index+1:]
            ledger["unrunFullNames"] = [x["fullName"] for x in cases if x["fixtureType"] in remaining_types]
            ledger["status"] = "PASS" if not remaining_types else "RUNNING"
            with LEDGER.open("w", encoding="utf-8") as f: json.dump(ledger, f, indent=2); f.write("\n")
            print(f"{fixture}: PASS {len(expected)}/{len(expected)}", flush=True)
        except Exception as error:
            group.update({"state": "FAIL", "validationError": str(error)})
            ledger["status"] = "STOPPED_ON_FIRST_ERROR"
            ledger["unrunFullNames"] = [x["fullName"] for x in cases if x["fixtureType"] in fixture_types[index+1:]]
            with LEDGER.open("w", encoding="utf-8") as f: json.dump(ledger, f, indent=2); f.write("\n")
            print(f"{fixture}: STOPPED: {error}; unrun={len(ledger['unrunFullNames'])}", flush=True)
            return 1

    print("PASS: all 90 exact cases passed once; no retries", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
