#!/usr/bin/env python3
"""Record one bounded component check without replacing earlier outcomes."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
TOOLS = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2')
TARGET = TOOLS / 'return-cleanup-2026-11-08/final-target'
STOP_BYTES = 1610612736
SOURCE = [
    'crates/rh-server/src/outbox/scene_candidate.rs',
    'crates/rh-server/src/outbox/scene_candidate/client14_fixture.rs',
    'client-unity/RoguehallaNet/Protocol/SceneCandidateClient14.cs',
    'client-unity/UnityProject/Assets/RoguehallaNet/Protocol/SceneCandidateClient14.cs',
    'client-unity/UnityProject/Assets/RoguehallaNet/Protocol/SceneCandidateClient14.cs.meta',
    'client-unity/RoguehallaNet.Tests/SceneCandidateClient14Tests.cs',
    'tools/scene-candidate/client14.mjs',
    'tools/scene-candidate/check-client14.mjs',
]
TEST = 'outbox::scene_candidate::client14_fixture::client14_fixture_actual_receiver_acceptance_and_rejections'
FILTER = '|'.join('FullyQualifiedName~' + name for name in [
    'SceneCandidateClient14Tests', 'ProtocolVectorTests', 'StateTests',
    'OwnerCombatProtocolTests', 'QuestBridgeProtocolTests',
    'TradeQuest14ProtocolTests', 'GiverActorProtocolTests',
    'TrophyProtocolTests', 'FirstPlayableProtocolTests', 'UnitySyncTests',
])
COMMANDS = {
    'rust-export': [str(TOOLS / 'cargo/bin/cargo'), 'test', '--locked', '-p', 'rh-server', '--lib', TEST, '--', '--exact', '--nocapture'],
    'rust-check': [str(TOOLS / 'cargo/bin/cargo'), 'test', '--locked', '-p', 'rh-server', '--lib', TEST, '--', '--exact', '--nocapture'],
    'dotnet': [str(TOOLS / 'dotnet/dotnet'), 'test', 'client-unity/RoguehallaNet.Tests', '--no-restore', '--nologo', '--filter', FILTER],
    'js': ['node', 'tools/scene-candidate/check-client14.mjs'],
    'js-regression': ['node', 'tools/protocol-js/check-vectors.mjs'],
    'fmt': [str(TOOLS / 'cargo/bin/rustfmt'), '--check', '--edition', '2021', '--config', 'skip_children=true', SOURCE[0], SOURCE[1]],
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def free_bytes():
    stat = os.statvfs(ROOT)
    return stat.f_bavail * stat.f_frsize

kind, tag = sys.argv[1:]
command = COMMANDS[kind]
log, receipt = OUT / (tag + '.log'), OUT / (tag + '.json')
assert Path.cwd().resolve() == ROOT
assert not log.exists() and not receipt.exists()
assert free_bytes() >= STOP_BYTES
env = os.environ.copy()
env.update(CARGO_HOME=str(TOOLS / 'cargo'), RUSTUP_HOME=str(TOOLS / 'rustup'),
           CARGO_TARGET_DIR=str(TARGET), CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='1',
           CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0',
           DOTNET_CLI_TELEMETRY_OPTOUT='1')
env['PATH'] = str(TOOLS / 'cargo/bin') + ':' + str(TOOLS / 'dotnet') + ':' + env['PATH']
env.pop('RH_SCENE_CLIENT14_FIXTURE_OUT', None)
if kind == 'rust-export':
    env['RH_SCENE_CLIENT14_FIXTURE_OUT'] = str(ROOT / 'protocol/fixtures/scene-candidate/client14.json')
before = {path: sha(ROOT / path) for path in SOURCE}
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
minimum = free_bytes()
stopped = False
with log.open('xb') as stream:
    child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream,
                             stderr=subprocess.STDOUT, start_new_session=True)
    while child.poll() is None:
        minimum = min(minimum, free_bytes())
        if minimum < STOP_BYTES:
            stopped = True
            os.killpg(child.pid, signal.SIGTERM)
            break
        time.sleep(0.2)
    status = child.wait()
after = {path: sha(ROOT / path) for path in SOURCE}
record = dict(kind=kind, command=command, cwd=str(ROOT), sourceHead=head,
              startedUtc=started, endedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              exitCode=status, sourceBefore=before, sourceAfter=after,
              sourceUnchanged=before == after, logSha256=sha(log),
              minFreeBytes=minimum, stopBytes=STOP_BYTES, diskStopped=stopped,
              rustTarget=str(TARGET) if kind.startswith('rust-') else None,
              rustEnvironment={key: env[key] for key in ['CARGO_BUILD_JOBS', 'CARGO_INCREMENTAL', 'CARGO_PROFILE_DEV_DEBUG', 'CARGO_PROFILE_TEST_DEBUG']} if kind.startswith('rust-') else None,
              fixtureExport=env.get('RH_SCENE_CLIENT14_FIXTURE_OUT'),
              runnerSha256=sha(Path(__file__)))
receipt.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({key: record[key] for key in ['kind', 'sourceHead', 'exitCode', 'sourceUnchanged', 'minFreeBytes', 'diskStopped', 'logSha256']}))
print(log.read_text()[-6000:])
assert before == after, 'source changed during the check'
assert not stopped, 'owned process stopped at disk threshold'
raise SystemExit(status)
