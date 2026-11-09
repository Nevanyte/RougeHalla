#!/usr/bin/env python3
"""Check retained source observations. This is not an implementation or native parity test."""
import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNDEFINED = {"$undefined": True}
HIGH = 48.786255552652214
LOW = 25.29657695322707


def need(ok, reason):
    if not ok:
        raise ValueError(reason)


def frame(case, time=None, label=None):
    return next(f for f in case["frames"] if
                (time is None or f["time"] == time) and (label is None or f["label"] == label))


def clocks(f):
    return {} if f["fightClocks"] == UNDEFINED else dict(f["fightClocks"])


def cache(f, actor="p0"):
    return next(c for c in f["cache"] if c["id"] == actor)


def verify(j):
    need(j["format"] == "rh-slow-starter-source-assessment/1", "format")
    need(j["runtime"] == {"node": "v22.23.4", "platform": "linux", "arch": "x64", "fixedStepMs": 50}, "runtime")
    need(j["controls"] == {"inspectionNoninterference": 7, "deterministicRepeats": 7}, "execution controls")
    for group in ("sourceInputs", "harnessInputs", "captureInputs"):
        for entry in j[group]:
            need(hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest() == entry["sha256"],
                 "input hash: " + entry["path"])
    need(hashlib.sha256((ROOT / "parity/card-runtime/source.json").read_bytes()).hexdigest()
         == j["sourceCorpusSha256"], "retained corpus hash")
    cases = j["cases"]
    need(len(cases) == 7, "finite seven-case set")
    for c in cases:
        need(not any("diagnosticHits" in a or a["kind"] not in ("step", "span", "grant")
                     for a in c["input"]["actions"]), "no installed hits/status/time/death/phase")
        tape = c["randomTape"]
        for f in c["frames"]:
            need(f["time"] == 50 * f["tick"], "fixed source time")
            prefix = tape[:f["rng"]["total"]]
            need(len(prefix) == f["rng"]["total"], "RNG tape length")
            need(all(f["rng"][stream] == sum(d["stream"] == stream for d in prefix)
                     for stream in ("main", "reward", "quest")), "intermediate RNG offsets")
            need(not prefix or prefix[-1]["tick"] <= f["tick"], "RNG time ordering")
            need(all(a["id"].startswith("p") for a in f["cache"]), "player-only watch owner")

    for c, time, start, amount, holds in zip(cases[:3], [7000, 7050, 7100], [100, 7050, 7100],
                                            [HIGH, HIGH, LOW], [1, 0, 0]):
        f = frame(c, label="action-4")
        need(f["time"] == time, "gap time")
        need(clocks(f) == {"p0": {"start": start, "last": time}}, "gap restart clock")
        need(len(f["landed"]) == 1 and f["landed"][0]["amount"] == amount, "already-paid gap hit")
        need(cache(f)["holds"] == holds, "gap cache after ledger")
    expiry = frame(cases[2], 7050)
    need(clocks(expiry) == {"p0": {"start": 100, "last": 4050}}, "expired clock retained")
    need(cache(expiry)["holds"] == 0, "strict idle expiry")

    mutual = frame(cases[3], 100)
    need([(h["by"], h["victim"]) for h in mutual["landed"]] == [("p0", "p1"), ("p1", "p0")], "two genuine landed entries")
    need(clocks(mutual) == {p: {"start": 100, "last": 100} for p in ("p0", "p1")}, "duplicate by/victim touches")

    training = cases[4]
    first = frame(training, label="action-0")
    need(first["landed"][0]["victim"] == "mob1" and clocks(first) == {}, "unwatched real NPC hit")
    need(next(m for m in first["mobs"] if m["id"] == "mob1")["kind"] == "dummy", "actual born NPC kind")
    grant = frame(training, label="action-1")
    need(grant["fightWatch"] == ["p0"] and clocks(grant) == {}, "helper gain cannot rescan prior landed")
    need(clocks(frame(training, 550)) == {}, "unwatched pre-acquisition hit excluded")
    need(clocks(frame(training, 600)) == {"p0": {"start": 600, "last": 600}}, "first watched NPC hit")
    need(cache(frame(training, 3600))["holds"] == 1, "NPC fight maturation")
    ignored = frame(training, label="action-3")
    need(ignored["fightWatch"] == ["p0"] and clocks(ignored)["p0"]["start"] == 600,
         "Train Card0 is a source no-op for Slow Starter")
    clear = frame(training, label="action-5")
    need(clear["fightWatch"] == [] and clocks(clear) == {} and "holds" not in cache(clear), "real clear removes rows/watch/clock")
    need(clear["landed"][0]["amount"] == 64.32558139534883, "same-pass clear refold before damage")
    need(clocks(frame(training, label="action-7")) == {}, "helper reacquire starts unwitnessed")
    need(clocks(frame(training, 5500)) == {"p0": {"start": 5500, "last": 5500}}, "new watched fight after clear")
    need(cache(frame(training, 8500))["holds"] == 1, "reacquired fight maturation")

    dead = frame(cases[5], 12850)
    need(next(p for p in dead["players"] if p["id"] == "p1")["status"] == "dead", "ordinary lethal hit")
    need(dead["landed"][0]["victim"] == "p1" and clocks(dead).get("p1") == {"start": 100, "last": 12850}, "dead watched victim touched")
    expired_dead = frame(cases[5], 15850)
    need(clocks(expired_dead) == clocks(dead) and cache(expired_dead, "p1")["holds"] == 0, "death does not clear clock")

    teleported = next(f for f in cases[6]["frames"] if f["inColiseum"])
    need(teleported["time"] == 5050 and clocks(teleported) == {"p0": {"start": 100, "last": 5000}}
         and cache(teleported)["holds"] == 1, "ordinary patience teleport preserves clock")
    need(any(x["time"] == 5050 and any(h.get("hook") == "teleported" for h in x["hooks"])
             for x in cases[6]["ordinaryHookOrder"]), "actual teleport hook producer")


def negative_controls(j):
    # Deliberately damaged observations, not source semantic mutants or native tests.
    edits = [
        ("wrong-gap-restart", "gap restart clock", lambda x: frame(x["cases"][1], label="action-4")["fightClocks"][0][1].update(start=100)),
        ("retroactive-low-paid-hit", "already-paid gap hit", lambda x: frame(x["cases"][1], label="action-4")["landed"][0].update(amount=LOW)),
        ("expired-clock-deleted", "expired clock retained", lambda x: frame(x["cases"][2], 7050).update(fightClocks=[])),
        ("victim-touch-excluded", "duplicate by/victim touches", lambda x: frame(x["cases"][3], 100)["fightClocks"].pop()),
        ("old-landed-rescanned-on-grant", "helper gain cannot rescan prior landed", lambda x: frame(x["cases"][4], label="action-1").update(fightClocks=[["p0", {"start": 100, "last": 100}]])),
        ("clear-retains-watch", "real clear removes rows/watch/clock", lambda x: frame(x["cases"][4], label="action-5").update(fightWatch=["p0"])),
        ("death-clock-lost", "dead watched victim touched", lambda x: frame(x["cases"][5], 12850).update(fightClocks=[])),
        ("teleport-clock-lost", "ordinary patience teleport preserves clock", lambda x: next(f for f in x["cases"][6]["frames"] if f["inColiseum"]).update(fightClocks=[])),
    ]
    for name, reason, edit in edits:
        altered = copy.deepcopy(j)
        edit(altered)
        try:
            verify(altered)
        except ValueError as error:
            need(str(error) == reason, f"wrong rejection for {name}: {error}")
            print(f"REJECT damaged observation: {name}: {reason}")
        else:
            raise ValueError("false PASS: " + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--negative-controls", action="store_true")
    args = parser.parse_args()
    observed = json.loads(args.source.read_text())
    verify(observed)
    print("PASS seven source witnesses, input hashes and intermediate RNG offsets")
    if args.negative_controls:
        negative_controls(observed)


if __name__ == "__main__":
    main()
