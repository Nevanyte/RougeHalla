#!/usr/bin/env python3
"""Manual GitHub Linux-only producer. Never imports an expected runtime receipt or a server --version flag."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from component import (Refused, TABLES, TARGET, MAX_BINARY, canonical, elf, hex_string,
                       inspect_archive, read_regular, require, sha, strict_json, validate_info, write_component)

# Public throwaway service credentials, valid only in this isolated CI job; never emitted or packaged.
CI_URL = 'postgresql://rh_native:rh_native_ci_only@127.0.0.1:5432/rh_native_component'
BUILD_ARGS = ['build', '--locked', '--release', '-p', 'rh-server', '--features', 'postgres', '--bin', 'rh-server', '--target', TARGET]


def capture(argv, cwd=None, env=None, timeout=30):
    result = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=True, timeout=timeout)
    require(len(result.stdout) <= 1024 * 1024, 'command output exceeds bound')
    return result.stdout.decode('utf-8')


def git(repo, *args):
    return capture(['git', '-C', str(repo), *args]).strip()


def selection(harness, commit):
    hex_string(commit, 40)
    require(git(harness, 'cat-file', '-t', commit) == 'commit', 'selected SHA must be a commit')
    require(git(harness, 'rev-parse', commit + '^{commit}') == commit, 'exact selected SHA required')
    tip = git(harness, 'rev-parse', 'refs/remotes/origin/optimization_port')
    hex_string(tip, 40)
    result = subprocess.run(['git', '-C', str(harness), 'merge-base', '--is-ancestor', commit, tip],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    require(result.returncode == 0, 'selected commit is not reachable from fetched optimization_port')
    harness_commit = git(harness, 'rev-parse', 'HEAD'); hex_string(harness_commit, 40)
    return {'commit': commit, 'optimization_port_tip': tip, 'harness_commit': harness_commit}


def clean_source(source, commit):
    require(git(source, 'rev-parse', 'HEAD') == commit, 'source checkout is not selected commit')
    require(git(source, 'status', '--porcelain=v1', '--untracked-files=all') == '', 'source checkout must remain clean')


def toolchain_channel(data):
    text = data.decode('utf-8')
    channels = re.findall(r'^channel\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$', text, re.MULTILINE)
    require(len(channels) == 1, 'source must pin one exact stable Rust toolchain')
    return channels[0]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise Refused('loopback readiness redirect refused')


def get_loopback(port, path):
    require(type(port) is int and 1024 <= port <= 65535 and path in ('/readyz', '/info', '/healthz'), 'GET readiness allowlist')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open('http://127.0.0.1:' + str(port) + path, timeout=1) as response:
        require(response.status == 200, 'readiness HTTP status refused')
        data = response.read(16385)
        require(len(data) <= 16384, 'readiness response exceeds bound')
        return data


def sql(psql, statement, env):
    # No credentials/logs are returned on error; arguments are never printed.
    return capture([psql, CI_URL, '--no-psqlrc', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1',
                    '--command', statement], env=env, timeout=10).strip()


def probe(binary, psql, env, scratch):
    require(sql(psql, "SELECT count(*) FROM pg_tables WHERE schemaname='public'", env) == '0', 'CI database is not fresh')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    started = time.monotonic()
    command = [str(binary), '--bind', '127.0.0.1:' + str(port), '--runtime', 'core', '--database-url', CI_URL,
               '--instance-id', 'ci-native-readiness', '--max-rooms', '1', '--fill-bots', '0', '--bot-learning', 'off']
    # Logs stay private in the owned CI temporary directory, never in artifact upload paths.
    with (scratch / 'server-private.log').open('xb') as log:
        process = subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        try:
            deadline = started + 40
            while True:
                require(process.poll() is None, 'native process exited before readiness')
                try:
                    ready = strict_json(get_loopback(port, '/readyz'))
                    if ready == {'ok': True, 'state': 'ready', 'storage': 'ok'}:
                        break
                except (OSError, urllib.error.URLError):
                    pass  # Only bounded startup transport/503 retries; all terminal checks below remain strict.
                require(time.monotonic() < deadline, 'bounded native readiness timed out')
                time.sleep(0.2)
            info = strict_json(get_loopback(port, '/info'))
            health = get_loopback(port, '/healthz').decode('ascii')
            counts = ','.join("'" + table + "',(SELECT count(*) FROM " + table + ')' for table in TABLES)
            rows = strict_json(sql(psql, 'SELECT json_build_object(' + counts + ')', env))
            validate_info(info, ready, rows)
            require(health == 'ok', 'native health refused')
            postgres = sql(psql, 'SHOW server_version', env)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                exit_code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                raise Refused('owned readiness process did not stop within grace') from None
        require(exit_code == 0, 'native readiness process did not stop cleanly')
    final_rows = strict_json(sql(psql, 'SELECT json_build_object(' + counts + ')', env))
    require(final_rows == rows, 'database changed during native shutdown')
    validate_info(info, ready, final_rows)
    elapsed = int((time.monotonic() - started) * 1000)
    require(elapsed <= 60000, 'readiness elapsed bound exceeded')
    return {'profile': 'core-readiness-only', 'info': info, 'readyz': ready, 'healthz': health,
            'db_rows': rows, 'postgres_version': postgres, 'elapsed_ms': elapsed, 'exit_code': exit_code}


def produce(harness, source, commit, output):
    require(sys.platform == 'linux' and platform.machine() == 'x86_64'
            and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch',
            'producer is restricted to manually dispatched Linux x86_64 GitHub jobs')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/optimization_port', 'reviewed canonical workflow ref required')
    selected = selection(harness, commit)
    clean_source(source, commit)
    cargo_lock = read_regular(source / 'Cargo.lock', 1024 * 1024)
    rust_file = read_regular(source / 'rust-toolchain.toml', 8192)
    channel = toolchain_channel(rust_file)
    rustup, psql = shutil.which('rustup'), shutil.which('psql')
    require(rustup is not None and psql is not None, 'runner must already provide rustup and psql; no package install fallback')
    base_env = {key: os.environ[key] for key in ('PATH', 'HOME', 'RUSTUP_HOME') if key in os.environ}
    with tempfile.TemporaryDirectory(prefix='rh-native-component-', dir=os.environ['RUNNER_TEMP']) as temp:
        scratch = Path(temp).resolve(strict=True)
        env = {**base_env, 'LC_ALL': 'C', 'CARGO_HOME': str(scratch / 'cargo-home'),
               'CARGO_TARGET_DIR': str(scratch / 'target'), 'CARGO_PROFILE_RELEASE_DEBUG': '0',
               'CARGO_TERM_COLOR': 'never', 'RH_BUILD': commit}
        subprocess.run([rustup, 'toolchain', 'install', channel, '--profile', 'minimal', '--no-self-update'],
                       env=env, check=True, timeout=600)
        prefix = [rustup, 'run', channel]
        rustc_vv = capture([*prefix, 'rustc', '-vV'], env=env)
        cargo_vv = capture([*prefix, 'cargo', '-vV'], env=env)
        subprocess.run([*prefix, 'cargo', *BUILD_ARGS], cwd=source, env=env, check=True, timeout=2700)
        binary = scratch / 'target' / TARGET / 'release' / 'rh-server'
        data = read_regular(binary, MAX_BINARY, executable=True); elf_info = elf(data)
        readiness = probe(binary, psql, env, scratch)
        require(read_regular(binary, MAX_BINARY, executable=True) == data, 'executed binary bytes changed')
        clean_source(source, commit)
        require(read_regular(source / 'Cargo.lock', 1024 * 1024) == cargo_lock
                and read_regular(source / 'rust-toolchain.toml', 8192) == rust_file, 'source identities changed during build')
        manifest = {'format': 'rh-native-component/1', 'component': 'rh-server-postgres-release', 'deployable': False,
                    'source': {**selected, 'tree': git(source, 'rev-parse', 'HEAD^{tree}'),
                               'cargo_lock_sha256': sha(cargo_lock), 'rust_toolchain_sha256': sha(rust_file)},
                    'build': {'target': TARGET, 'profile': 'release', 'features': ['postgres'], 'locked': True,
                              'rust_toolchain': channel, 'rustc_vv': rustc_vv, 'cargo_vv': cargo_vv,
                              'libc': os.confstr('CS_GNU_LIBC_VERSION'), 'release_debug': '0'},
                    'binary': {'path': 'bin/rh-server', 'bytes': len(data), 'sha256': sha(data), 'elf': elf_info},
                    'readiness': readiness}
        return write_component(binary, manifest, output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['select', 'produce', 'verify'])
    parser.add_argument('--harness', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--commit')
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == 'select':
            require(args.harness is not None, 'harness checkout required')
            result = selection(args.harness, args.commit)
        elif args.command == 'produce':
            require(args.harness is not None and args.source is not None and args.archive is not None, 'source/harness/new output required')
            result = produce(args.harness, args.source, args.commit, args.archive)
        else:
            require(args.archive is not None, 'component archive required')
            data = read_regular(args.archive, MAX_BINARY + 1024 * 1024)
            manifest = inspect_archive(data)
            result = {'sha256': sha(data), 'source_commit': manifest['source']['commit'], 'deployable': False}
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Refused, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('native component refused; no deployable artifact produced (private CI diagnosis required)', file=sys.stderr)
        return 2


if __name__ == '__main__':
    def cancelled(_signal, _frame): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, cancelled)
    raise SystemExit(main())
