#!/usr/bin/env python3
"""Verify and summarize an existing sealed source case; never run or mutate a sim."""

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = "parity/card-runtime/source.json"
SOURCE_SHA256 = "f67417ff219039296852886e61aa9661ac535d2f5ce0126fa3f76f6a3a740337"
CASE_INDEX = 30
CASE_NAME = "while-hp-and-fight-cache-transition"
UNDEFINED = {"$undefined": True}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def extract():
    raw = (ROOT / SOURCE).read_bytes()
    require(sha(raw) == SOURCE_SHA256, "sealed source corpus SHA256 changed")
    corpus = json.loads(raw)
    verified = {}
    for group in ("sourceInputs", "harnessInputs"):
        entries = corpus["provenance"][group]
        for entry in entries:
            require(
                sha((ROOT / entry["path"]).read_bytes()) == entry["sha256"],
                f"sealed {group} mismatch: {entry['path']}",
            )
        verified[group] = len(entries)

    case = corpus["cases"][CASE_INDEX]
    require(case["name"] == CASE_NAME, "case index/name changed")
    records = corpus["privateOracleRecords"]

    def resolve(value):
        if isinstance(value, dict):
            if set(value) == {"$oracle"}:
                return resolve(records[value["$oracle"]])
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        return value

    frames = [case["initial"]]
    for action in case["timeline"]:
        frames.extend(action["frames"] if "frames" in action else [action])
    frames.append(case["final"])

    def fact(frame):
        mods = resolve(frame["private"]["privateOracle"]["mods"])
        build = next(a for a in mods["actors"] if a["id"] == "p0")["cache"]["build"]
        clocks = mods["fightClocks"]
        clock = None if clocks == UNDEFINED else dict(clocks).get("p0")
        return {
            "label": frame["label"],
            "time": frame["time"],
            "tick": frame["tick"],
            "phase": frame["phase"],
            "watch": mods["fightWatch"],
            "clock": clock,
            "holds": build["holds"],
            "damageSum": build["sums"]["damage"],
            "landed": frame["private"]["landed"],
            "rng": frame["rng"],
        }

    facts = [fact(frame) for frame in frames]
    # Prefer an ordinary step at a duplicated timestamp over a later diagnostic placement.
    at = {}
    for item in facts:
        at.setdefault(item["time"], item)
    checks = {
        50: (None, 0, -0.3),
        100: ({"start": 100, "last": 100}, 0, -0.3),
        3050: ({"start": 100, "last": 3050}, 0, -0.3),
        3100: ({"start": 100, "last": 3050}, 1, 0.35000000000000003),
        3550: ({"start": 100, "last": 3550}, 1, 0.35000000000000003),
        4050: ({"start": 100, "last": 4050}, 1, 0.35000000000000003),
        7050: ({"start": 100, "last": 4050}, 0, -0.3),
    }
    for time, expected in checks.items():
        item = at[time]
        require(
            (item["clock"], item["holds"], item["damageSum"]) == expected,
            f"sealed clock/cache witness changed at {time}ms",
        )
        require(item["watch"] == ["p0"], f"watch changed at {time}ms")
        require(item["rng"]["total"] == 49, f"RNG offset changed at {time}ms")
    require(at[100]["landed"][0]["amount"] == 25.29657695322707, "first real hit changed")
    require(at[3550]["landed"][0]["amount"] == 48.786255552652214, "mature real hit changed")
    require(case["ordinarySteps"] == 195, "ordinary step count changed")
    require(case["final"]["rng"]["total"] == 137, "final RNG offset changed")

    # Retain every clock/hold/phase transition and genuine landed frame, plus final RNG.
    selected = []
    previous = None
    for item in facts:
        state = (item["phase"], item["clock"], item["holds"], item["damageSum"])
        if state != previous or item["landed"] or item["label"] == "final":
            selected.append(item)
        previous = state
    return {
        "format": "rh-slow-starter-sealed-assessment/1",
        "scope": "Read-only extraction of retained source evidence; no new source execution or native parity claim.",
        "baseRevision": "db5ed80b2b89a156eae09cd0bd3f4c9e77e9e6de",
        "source": {"path": SOURCE, "bytes": len(raw), "sha256": sha(raw)},
        "verifiedInputs": verified,
        "caseIndex": CASE_INDEX,
        "caseName": CASE_NAME,
        "input": case["input"],
        "ordinarySteps": case["ordinarySteps"],
        "canonicalHashAlgorithm": "Python json.dumps(sort_keys=True,separators=(',',':')), UTF-8, SHA256",
        "caseCanonicalSha256": canonical_sha(case),
        "randomTapeCanonicalSha256": canonical_sha(case["randomTape"]),
        "randomTapeDraws": len(case["randomTape"]),
        "selectedFrames": selected,
        "unwitnessed": [
            "A real hit at gap <3000, =3000 and >3000ms after prior last hit",
            "Watched victim-side touches and unwatched pre-acquisition hits",
            "Legal card removal/reacquisition/clear and clock ownership",
            "Lethal-hit/death/revive, real teleport, and same-world run-start lifecycle",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", type=Path, help="Compare with an existing extraction; write nothing")
    args = parser.parse_args()
    rendered = json.dumps(extract(), indent=2, ensure_ascii=False) + "\n"
    if args.check:
        require(args.check.read_text() == rendered, "assessment extraction differs")
        print(f"PASS sealed source +143 input hashes + clock/cache/RNG witnesses: {args.check}")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
