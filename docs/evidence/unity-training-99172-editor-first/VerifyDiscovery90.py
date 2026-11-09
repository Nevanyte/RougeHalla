#!/usr/bin/env python3
"""Offline verifier for the schema-2 Training90 discovery packet. Never runs tests."""
from pathlib import Path
import json, re, hashlib

ROOT = Path(__file__).resolve().parent
CONTRACT = ROOT / "EXPECTED_SELECTORS.json"
DISCOVERY = ROOT / "discovered-cases.json"
IDENTITY = ROOT / "evidence/loaded-identity.json"
OUTPUT = ROOT / "evidence/discovery-binding-verification.json"


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unwrap(path):
    raw = json.loads(path.read_text())
    if isinstance(raw, dict) and "result" in raw:
        require(raw.get("success", True) is True, f"{path.name}: wrapper success is not true")
        return raw["result"]
    return raw


def exact_int(value, label):
    require(type(value) is int, f"{label}: expected a JSON integer, got {type(value).__name__}")
    return value


def verify_argument(actual, expected, full_name, index):
    label = f"{full_name} argument {index}"
    typ = expected["declaredType"]
    require(actual.get("typeFullName") == typ, f"{label}: runtime type {actual.get('typeFullName')!r} != {typ!r}")
    if "attributeValueType" in expected:
        require(expected["attributeValueType"] == typ, f"{label}: contract attribute type differs from declared type")
    val, shown = expected["value"], expected["displayValue"]
    require(actual.get("text") == shown, f"{label}: invariant text differs")
    if typ == "System.Boolean":
        require(type(val) is bool and type(actual.get("boolValue")) is bool and actual["boolValue"] is val,
                f"{label}: Boolean value differs or is not Boolean")
    elif typ == "Roguehalla.Net.MatchLaunchMode":
        require(isinstance(val, dict) and actual.get("enumName") == val.get("name"), f"{label}: enum name differs")
        got = exact_int(actual.get("numericValue"), label + " enum numericValue")
        want = exact_int(val.get("numericValue"), label + " expected enum numericValue")
        require(got == want, f"{label}: enum numeric value differs")
    elif typ == "System.Int32":
        got = exact_int(actual.get("numericValue"), label + " Int32 numericValue")
        want = exact_int(val, label + " expected Int32")
        require(got == want, f"{label}: Int32 value differs")
    elif typ == "System.Int64":
        require(isinstance(val, str) and re.fullmatch(r"0|-?[1-9][0-9]*", val) is not None,
                f"{label}: expected Int64 must be a canonical decimal string")
        require(expected.get("attributeValueType") == "System.Int64", f"{label}: missing Int64 attribute type")
        got = exact_int(actual.get("numericValue"), label + " Int64 numericValue")
        require(-(1 << 63) <= got <= (1 << 63) - 1, f"{label}: runtime Int64 is out of range")
        require(str(got) == val and actual["text"] == val and shown == val, f"{label}: Int64 exact decimal differs")
    else:
        raise ValueError(f"{label}: unsupported strict argument type {typ!r}")


def main():
    require(not OUTPUT.exists(), f"refusing to overwrite {OUTPUT}")
    require(hashlib.sha256(CONTRACT.read_bytes()).hexdigest() == "cf38da76450bbcc01bb2f6c15d73c44d119152959733ef3037dcc04960f1cc7e", "frozen contract hash differs")
    native=unwrap(ROOT / "evidence/native-identity-verification.json")
    require(native.get("status") == "PASS_IDENTITY_BEFORE_EXECUTION", "native/source identity has not passed")
    signatures=unwrap(ROOT / "evidence/loaded-method-signatures.json")
    contract = json.loads(CONTRACT.read_text())
    require(contract.get("schema") == "roguehalla-unity-editmode-typed-fixture-contract/2", "unexpected contract schema")
    expected_cases = contract["cases"]
    fixtures = [x["fixtureType"] for x in contract["fixtureSources"]]
    require(len(fixtures) == 8 and len(set(fixtures)) == 8, "contract must declare eight unique canonical fixture types")
    require(len(expected_cases) == 90 and len({x["fullName"] for x in expected_cases}) == 90, "contract must contain 90 unique cases")
    groups = {name: [x for x in expected_cases if x["fixtureType"] == name] for name in fixtures}
    require(all(groups.values()) and set(x["fixtureType"] for x in expected_cases) == set(fixtures), "fixture source/case type mismatch")
    counts = contract["counts"]
    require(counts["old64"] + sum(counts["newByFixture"].values()) == 90, "declared Training90 arithmetic differs")

    discovered = unwrap(DISCOVERY)
    require(discovered.get("executedTests") is False, "discovery receipt does not explicitly say tests were not executed")
    rows = discovered.get("cases")
    require(isinstance(rows, list) and len(rows) == 90, "public discovery must contain exactly 90 rows")
    names = [x.get("fullName") for x in rows]
    require(all(isinstance(x, str) and x for x in names) and len(set(names)) == 90, "discovery has empty or duplicate full names")
    actual = {x["fullName"]: x for x in rows}
    want_names = {x["fullName"] for x in expected_cases}
    require(set(actual) == want_names, f"full-name mismatch: missing={sorted(want_names-set(actual))}, extra={sorted(set(actual)-want_names)}")

    require(discovered.get("fixturePrefixes") == [f+"." for f in fixtures], "public discovery fixture prefixes differ")
    class_matches=discovered.get("classFilterMatches",{})
    require(set(class_matches)=={f.split(".")[-1] for f in fixtures}, "class match inventory differs")
    for fixture in fixtures:
        found=class_matches[fixture.split(".")[-1]]
        require(len(found)==len(set(found)) and set(found)=={x["fullName"] for x in groups[fixture]}, "filter matches differ: "+fixture)

    identity = unwrap(IDENTITY)
    require(identity.get("compiling") is False and identity.get("updating") is False, "Editor identity receipt is not idle")
    loaded_rows = identity.get("results")
    require(isinstance(loaded_rows, list) and len(loaded_rows) == 8, "loaded identity must contain eight fixture types")
    loaded = {x.get("loadedType"): x for x in loaded_rows}
    require(len(loaded) == 8 and set(loaded) == set(fixtures), "loaded identity fixture types differ from the contract")
    guid_by_type = {x["fixtureType"]: x["meta"]["guid"] for x in contract["fixtureSources"]}
    mvids = set()
    for fixture in fixtures:
        row = loaded[fixture]
        require(row.get("guid") == guid_by_type[fixture], f"{fixture}: loaded script GUID mismatch")
        require(row.get("importedPath", row.get("path", "")).endswith(fixture.split(".")[-1] + ".cs"),
                f"{fixture}: loaded script path mismatch")
        require(isinstance(row.get("mvid"), str) and row["mvid"], f"{fixture}: missing loaded test assembly MVID")
        mvids.add(row["mvid"])
        methods = {x["method"] for x in groups[fixture]}
        require(set(row.get("methods", [])) == methods, f"{fixture}: loaded method names differ from expected cases")
    require(len(mvids) == 1, "fixture types resolve to multiple loaded test assemblies")

    for item in expected_cases:
        got = actual[item["fullName"]]
        label = item["fullName"]
        require(got.get("declaringType") == item["fixtureType"], f"{label}: declaring type differs")
        require(got.get("methodName") == item["method"], f"{label}: method differs")
        if "methodReturnType" in item:
            matching=[m for t in signatures if t["type"] == item["fixtureType"] and t["moduleMvid"] == got["methodModuleMvid"] for m in t["methods"] if m["name"] == item["method"] and [p["declaredType"] for p in m["parameters"]] == [p["declaredType"] for p in item.get("methodParameters",[])]]
            require(len(matching)==1 and matching[0]["returnType"] == item["methodReturnType"], f"{label}: same-module CLR return type differs")
        require(got.get("runState") == "Runnable", f"{label}: case is not Runnable")
        require(got.get("methodModuleMvid") in mvids, f"{label}: method MVID differs from loaded identity")
        exp_params, got_params = item.get("methodParameters", []), got.get("methodParameters", [])
        require(len(got_params) == len(exp_params), f"{label}: parameter count differs")
        for i, (want, have) in enumerate(zip(exp_params, got_params)):
            if "index" in want: require(want["index"] == i, f"{label}: noncanonical expected parameter index")
            if "name" in want: require(have.get("name") == want["name"], f"{label}: parameter {i} name differs")
            require(have.get("declaredType") == want["declaredType"], f"{label}: parameter {i} declared type differs")
        exp_args, got_args = item.get("selectedArguments", []), got.get("arguments", [])
        require(len(got_args) == len(exp_args), f"{label}: argument count differs")
        for i, (have, want) in enumerate(zip(got_args, exp_args)):
            verify_argument(have, want, label, i)
        if "declaredCaseAttributes" in item:
            require(got.get("nUnitTestCaseAttributes") == item["declaredCaseAttributes"], f"{label}: NUnit TestCase metadata differs")

    result = {
        "status": "PASS_BEFORE_EXECUTION", "contractSchema": contract["schema"],
        "source": "99172b65a317fc489b2290caa43c1735f26f2e26", "proposedSourceSnapshot": contract["sourceSnapshot"], "cases": 90,
        "fullNamesExact": True, "typedArgumentsExact": True, "loadedIdentityExact": True,
        "executedTests": False, "fixtureCounts": {k: len(v) for k, v in groups.items()},
        "loadedTestAssemblyMvid": next(iter(mvids)),
        "identityReceipt": str(IDENTITY), "discoveryReceipt": str(DISCOVERY)
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("x") as f:
        json.dump(result, f, indent=2); f.write("\n")
    print("PASS_BEFORE_EXECUTION: exact 90-case discovery and typed identity binding")


if __name__ == "__main__":
    main()
