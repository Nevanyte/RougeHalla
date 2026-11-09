#!/usr/bin/env python3
"""Sequential leased-Cargo receipt + disk guard. No cleanup or new target selection."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/scene-candidate14-socket/repo')
TARGET = '/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/final-target'
FLOOR = 1610612736  # 1.5 GiB, conservative relative to Root's 1.5 GB stop.
label, *command = sys.argv[1:]
assert re.fullmatch(r'[a-z0-9-]+', label)
assert command[:3] in (['cargo', 'test', '--locked'], ['cargo', 'clippy', '--locked'])
assert Path.cwd() == ROOT and os.environ['CARGO_TARGET_DIR'] == TARGET
for key, value in {'CARGO_BUILD_JOBS': '1', 'CARGO_INCREMENTAL': '0',
                   'CARGO_PROFILE_DEV_DEBUG': '0', 'CARGO_PROFILE_TEST_DEBUG': '0'}.items():
    assert os.environ[key] == value, key
assert 'RH_SCENE_FIXTURE_OUT' not in os.environ, 'do not export/regenerate a fixture'
free = shutil.disk_usage(ROOT).free
assert free >= FLOOR, f'disk stop before launch: {free} bytes; report Root, no cleanup'
logs = ROOT / 'docs/evidence/scene-candidate14-socket/logs'
log = logs / f'{label}.log'
meta = logs / f'{label}-receipt.json'
assert not log.exists() and not meta.exists(), 'preserve prior attempts'
paths = ['crates/rh-server/src/outbox/scene_candidate.rs',
         'crates/rh-server/src/outbox/scene_candidate/socket.rs',
         'crates/rh-server/src/outbox/scene_candidate/socket/tests.rs',
         'crates/rh-server/src/outbox/scene_candidate/socket/tests/ownership.rs',
         'crates/rh-server/src/outbox/scene_candidate/socket/tests/poll_faults.rs']
sha = lambda b: hashlib.sha256(b).hexdigest()
receipt = {'command': command, 'cwd': str(ROOT),
           'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
           'sourceSha256': {p: sha((ROOT / p).read_bytes()) for p in paths},
           'sourceDiffFromHead': subprocess.check_output(['git', 'diff', '--unified=0', 'HEAD', '--', *paths], text=True),
           'lockSha256': sha((ROOT / 'Cargo.lock').read_bytes()),
           'environment': {k: os.environ[k] for k in ['CARGO_HOME', 'RUSTUP_HOME', 'CARGO_TARGET_DIR',
                            'CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL', 'CARGO_PROFILE_DEV_DEBUG', 'CARGO_PROFILE_TEST_DEBUG']},
           'initialFreeBytes': free, 'minimumFreeBytes': free, 'stopBelowFreeBytes': FLOOR,
           'status': 'running'}
meta.write_text(json.dumps(receipt, indent=1) + '\n')
started = time.monotonic()
with log.open('wb') as output:
    child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    stopped = False
    while child.poll() is None:
        free = shutil.disk_usage(ROOT).free
        receipt['minimumFreeBytes'] = min(free, receipt['minimumFreeBytes'])
        if free < FLOOR:
            stopped = True
            try:
                os.killpg(child.pid, signal.SIGTERM)  # Only this owned Cargo/test process group.
            except ProcessLookupError:
                pass
            break
        time.sleep(0.2)
    code = child.wait()
receipt.update(status='disk-stopped' if stopped else 'completed', exitCode=code,
               elapsedSeconds=round(time.monotonic() - started, 3),
               finalFreeBytes=shutil.disk_usage(ROOT).free, logSha256=sha(log.read_bytes()))
meta.write_text(json.dumps(receipt, indent=1) + '\n')
print(json.dumps({k: receipt[k] for k in ['status', 'exitCode', 'elapsedSeconds', 'minimumFreeBytes']}), flush=True)
sys.exit(198 if stopped else code)
