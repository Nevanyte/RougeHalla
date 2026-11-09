#!/usr/bin/env python3
"""Compile five temporary native semantic mutants, retaining failures and restoring exact original bytes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
PREFIX = "crates/rh-sim/src/"
SOURCE_TEST = "cards::fight_clock::tests::seven_actual_source_clock_witnesses"
RESET_TEST = "cards::fight_clock::tests::generic_card_reset_preserves_fight_and_row_loss_preserves_wish"


def require(ok, why):
    if not ok:
        raise RuntimeError(why)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New task-owned directory for exact originals and logs")
    args = parser.parse_args()
    require(os.environ.get("CARGO_BUILD_JOBS") == "1", "source final-env then set jobs1")
    require(os.environ.get("CARGO_TARGET_DIR", "").endswith("/return-cleanup-2026-11-08/final-target"), "exclusive final-target lease required")
    args.output.mkdir(mode=0o700)
    mutations = [
        ("constant-false", "modifiers/mod.rs", "WhileCond::FightTime => is_player && crate::cards::fight_clock::holds(fight, now, row.arg),",
         "WhileCond::FightTime => false,", SOURCE_TEST, "holds at 3100"),
        ("exclude-victim", "cards/fight_clock.rs", "touch(w, h.victim, now);", "// mutant: no victim touch", SOURCE_TEST, "clock"),
        ("gap-equality-continues", "cards/fight_clock.rs", "Some(f) if now - f.last < crate::constants::CARD_FIGHT_GAP_MS",
         "Some(f) if now - f.last <= crate::constants::CARD_FIGHT_GAP_MS", SOURCE_TEST, "clock"),
        ("row-loss-retains-clock", "modifiers/mod.rs", "crate::cards::fight_clock::clear(&mut w.players[ix.slot()]);",
         "// mutant: keep the lost row's clock", SOURCE_TEST, "clock"),
        ("generic-reset-loses-clock", "cards/runtime.rs", "p.card_runtime = p.card_runtime.and_then(|r| {\n        r.fight.map(|fight| Runtime {\n            fight: Some(fight),\n            ..Default::default()\n        })\n    });",
         "p.card_runtime = None;", RESET_TEST, "called `Option::unwrap()` on a `None` value"),
    ]
    originals = {path: (ROOT / PREFIX / path).read_bytes() for _, path, *_ in mutations}
    for path, raw in originals.items():
        (args.output / path.replace("/", "_")).write_bytes(raw)
    receipt = []
    try:
        for name, path, before, after, test, reason in mutations:
            original = originals[path]
            require(original.decode().count(before) == 1, "mutation anchor changed: " + name)
            altered = original.decode().replace(before, after).encode()
            file = ROOT / PREFIX / path
            file.write_bytes(altered)
            try:
                command = ["cargo", "test", "--locked", "-p", "rh-sim", "--lib", test,
                           "--", "--exact", "--nocapture", "--test-threads=1"]
                with (args.output / (name + ".log")).open("wb") as log:
                    result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=False)
                log = (args.output / (name + ".log")).read_text()
                require(result.returncode == 101 and "test result: FAILED" in log and "panicked at" in log
                        and reason in log and "error[E" not in log, "mutant did not fail for intended assertion: " + name)
                row = {"name": name, "path": PREFIX + path, "command": command, "exitCode": result.returncode,
                       "intendedAssertion": reason, "originalSha256": hashlib.sha256(original).hexdigest(),
                       "mutantSha256": hashlib.sha256(altered).hexdigest()}
                receipt.append(row)
                print("KILLED " + name + ": " + reason, flush=True)
            finally:
                file.write_bytes(original)
    finally:
        for path, raw in originals.items():
            (ROOT / PREFIX / path).write_bytes(raw)
        (args.output / "receipt.json").write_text(json.dumps({"scope": "Compiled native semantic mutants; no source fixture edits", "mutants": receipt}, indent=2) + "\n")
    require(len(receipt) == 5, "incomplete mutant set")
    for path, raw in originals.items():
        require((ROOT / PREFIX / path).read_bytes() == raw, "failed exact restoration: " + path)
    print("PASS all five mutants rejected, exact original bytes restored", flush=True)


if __name__ == "__main__":
    main()
