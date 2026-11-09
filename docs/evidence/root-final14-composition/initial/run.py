"""One immutable native wrap-up gate; owns only its disposable loopback PostgreSQL."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

os.umask(0o077)
home = Path(__file__).resolve().parent
repo = home / 'repo'
state = home / 'pg-state'
state.mkdir(mode=0o700)
spec = importlib.util.spec_from_file_location('final_qa_cluster', repo / 'tools/backup-restore-proof/proof.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
pg = Path(os.environ['PGBIN'])

class OwnedCluster(module.Cluster):
    def start(self):
        module.command([
            str(self.pg / 'pg_ctl'), '-D', str(self.data), '-l', str(self.dir / 'postgres.log'), '-w', '-o',
            f"-p {self.port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' "
            '-c fsync=on -c synchronous_commit=on -c full_page_writes=on -c max_connections=300', 'start'
        ], self.dir / 'control.log')
        self.running = True

revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
assert revision == 'e2baadae03dd25cf74979bdfeb3bf35fd696393d'
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo, text=True).strip()
result = {
    'source': revision, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scope': 'Immutable native implementation gate; no later UI/Editor/Web/cloud/performance admission.',
    'target': os.environ['CARGO_TARGET_DIR'], 'cargo_jobs': os.environ['CARGO_BUILD_JOBS'],
    'lock_sha256': hashlib.sha256((repo / 'Cargo.lock').read_bytes()).hexdigest(),
    'commands': [], 'owned_cluster_stopped': False,
}
cluster = OwnedCluster(pg, state, 'final-native-pg')
started = time.monotonic()
commands = [
    ('workspace', ['cargo', 'test', '--locked', '--workspace', '--no-fail-fast']),
    ('server-postgres', ['cargo', 'test', '--locked', '-p', 'rh-server', '--features', 'postgres']),
    ('placement-postgres', ['cargo', 'test', '--locked', '-p', 'rh-placement', '--features', 'postgres,fault-injection']),
    ('clippy-all-features', ['cargo', 'clippy', '--locked', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']),
    ('clippy-default', ['cargo', 'clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings']),
    ('fmt', ['cargo', 'fmt', '--all', '--', '--check']),
    ('parity', ['cargo', 'run', '--locked', '-p', 'rh-parity', '--bin', 'parity-report']),
    ('headless-functional', ['cargo', 'run', '--locked', '-p', 'rh-headless', '--', '--matches', '1', '--players', '8', '--map', 'crates/rh-sim/src/mapdata/fixtures/seed1.map.json', '--max-ticks', '4000']),
]
failure = 0
def save():
    (home / 'result.json').write_text(json.dumps(result, indent=2) + '\n')

try:
    result['postgres'] = cluster.init()
    result['postgres_max_connections'] = module.sql(pg, cluster.url, 'SHOW max_connections')
    assert result['postgres_max_connections'] == '300'
    env = os.environ.copy()
    env['DATABASE_URL'] = cluster.url
    env.pop('RH_SKIP_PG_TESTS', None)
    save()
    for label, command in commands:
        entry = {'label': label, 'command': command, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exit_code': None}
        result['commands'].append(entry)
        save()
        print('Starting:', label, flush=True)
        command_started = time.monotonic()
        log = home / (label + '.log')
        with log.open('w') as stream:
            run = subprocess.run(command, cwd=repo, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=5400, check=False)
        entry.update(exit_code=run.returncode, elapsed_seconds=round(time.monotonic()-command_started, 3), log_sha256=hashlib.sha256(log.read_bytes()).hexdigest(), log_bytes=log.stat().st_size)
        save()
        print('Finished:', label, 'exit', run.returncode, flush=True)
        if run.returncode:
            failure = run.returncode
            break
finally:
    cluster.stop()
    cluster.unavailable()
    result['owned_cluster_stopped'] = True
    result['elapsed_seconds'] = round(time.monotonic()-started, 3)
    result['complete'] = len(result['commands']) == len(commands) and all(x['exit_code'] == 0 for x in result['commands'])
    save()
    print('Owned PostgreSQL stopped; completed gate:', result['complete'], flush=True)
raise SystemExit(failure or (0 if result['complete'] else 1))
