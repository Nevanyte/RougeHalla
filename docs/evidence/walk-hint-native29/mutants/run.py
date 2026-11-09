#!/usr/bin/env python3
"""Bounded compiled native regression controls. Run only with an exclusive Cargo-target lease."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

repo = Path(__file__).resolve().parents[4]
out = Path(__file__).resolve().parent

def sha(b):
    return hashlib.sha256(b).hexdigest()

def interrupted(number, _frame):
    raise SystemExit(128 + number)

for number in (signal.SIGINT, signal.SIGTERM):
    signal.signal(number, interrupted)

cases = [
    ("cap-two", "crates/rh-sim/src/systems/walk_hint.rs",
     "    } else {\n        WALK_HINT_MAX_TICKS\n    };",
     "    } else {\n        2\n    };", "actual_source_fourteen_world_frames"),
    ("cleanup-keeps-one", "crates/rh-sim/src/systems/walk_hint.rs",
     "        p.walk_ticks = 0;", "        p.walk_ticks = 1;",
     "actual_teleport_and_run_end_append_hooks_clear_positive_hints_keep_direction"),
    ("lock-ignores-windup-mirror", "crates/rh-sim/src/systems/targeting.rs",
     "        mirrors.windup_mult,", "        1.,", "captured_timing_drives_real_lock_aim_and_actual_weapon_start"),
    ("weapon-ignores-windup-mirror", "crates/rh-sim/src/systems/weapons.rs",
     "                p.modifiers.mirrors().windup_mult,", "                1.,",
     "captured_timing_drives_real_lock_aim_and_actual_weapon_start"),
    ("stagger-uses-as-one", "crates/rh-sim/src/systems/plague.rs",
     "                    mirrors.as_mult,", "                    1.,",
     "actual_sword_stagger_pause_uses_captured_current_mirrors"),
]
originals = {name: (repo / name).read_bytes() for _, name, *_ in cases}
protected = ["parity/walk-hint/repair/source.json", "parity/policy/bot-fight/source.json", "parity/mark-tax-uncapped/source.json"]
pins = {name: sha((repo / name).read_bytes()) for name in protected}
records = []
try:
    for label, name, old, new, test in cases:
        path = repo / name
        before = originals[name]
        text = before.decode()
        if text.count(old) != 1:
            raise RuntimeError(f"SETUP ERROR {label}: exact marker count {text.count(old)}")
        changed = text.replace(old, new, 1).encode()
        path.write_bytes(changed)
        cmd = ["cargo", "test", "--locked", "-p", "rh-sim", "--lib", test, "--", "--nocapture"]
        result = subprocess.run(cmd, cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (out / f"{label}.log").write_bytes(result.stdout)
        log = result.stdout.decode(errors="replace")
        killed = result.returncode != 0 and "test result: FAILED" in log and "panicked at" in log
        setup = "error[E" in log or "could not compile" in log
        verdict = "KILLED_BY_ASSERTION" if killed and not setup else "ERROR_OR_SURVIVED"
        records.append({"name": label, "file": name, "filter": test, "command": cmd,
                        "original_sha256": sha(before), "mutated_sha256": sha(changed),
                        "log_sha256": sha(result.stdout), "returncode": result.returncode, "verdict": verdict})
        path.write_bytes(before)
        print(label, verdict, flush=True)
        if verdict != "KILLED_BY_ASSERTION":
            raise RuntimeError(f"{label}: {verdict}; retained raw log")
finally:
    for name, contents in originals.items():
        (repo / name).write_bytes(contents)
    for name, expected in pins.items():
        if sha((repo / name).read_bytes()) != expected:
            raise RuntimeError(f"protected source changed: {name}")
    manifest = {"format": "rh-native-walk-hint-mutation-controls/1", "git_head_before": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
        "target": os.environ.get("CARGO_TARGET_DIR"), "protected": pins, "cases": records,
        "sources_restored": all((repo / name).read_bytes() == contents for name, contents in originals.items())}
    (out / "results.json").write_text(json.dumps(manifest, indent=2) + "\n")
