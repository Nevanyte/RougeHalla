#!/usr/bin/env python3
"""Canonical GitHub Linux producer. Never imports an expected runtime receipt or a server --version flag."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from component import (Refused, TABLES, TARGET, MAX_BINARY, canonical, elf, hex_string,
                       inspect_archive, read_regular, require, sha, strict_json, validate_info, write_component)
from diagnostics import Diagnostics

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


def stage_cargo_executable(scratch, diagnostics=None):
    """Copy trusted owned Cargo output (which may be hardlinked) to a new single-link executable.

    This does not relax component.read_regular: validation, execution and archive
    creation all use the exclusive copy through that original strict boundary.
    """
    diag = diagnostics or Diagnostics()
    handles = []
    scratch = Path(scratch)
    def owned_directory(fd):
        info = os.fstat(fd)
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022,
                'owned Cargo directory required')
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink,
                info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    try:
        root = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        handles.append(root); owned_directory(root)
        parent = root
        for name in ('target', TARGET, 'release'):
            parent = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            handles.append(parent); owned_directory(parent)
        diag.binary('cargo', os.stat('rh-server', dir_fd=parent, follow_symlinks=False))
        source = os.open('rh-server', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        handles.append(source)
        before = os.fstat(source)
        diag.binary('cargo', before)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and before.st_nlink >= 1
                and 0 < before.st_size <= MAX_BINARY and before.st_mode & 0o111 and not before.st_mode & 0o022,
                'owned bounded regular Cargo executable required')
        with os.fdopen(os.dup(source), 'rb') as stream:
            data = stream.read(MAX_BINARY + 1)
        require(len(data) == before.st_size and identity(os.fstat(source)) == identity(before)
                and identity(os.stat('rh-server', dir_fd=parent, follow_symlinks=False)) == identity(before),
                'Cargo output changed while copying')
        os.mkdir('executed-component', mode=0o700, dir_fd=root)  # Never reuse/replace an existing stage.
        staged_dir = os.open('executed-component', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root)
        handles.append(staged_dir); owned_directory(staged_dir)
        target = os.open('rh-server', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                         0o700, dir_fd=staged_dir)
        handles.append(target)
        remaining = memoryview(data)
        while remaining:
            count = os.write(target, remaining)
            require(count > 0, 'incomplete staged executable write')
            remaining = remaining[count:]
        os.fsync(target); os.fsync(staged_dir); os.fsync(root)
        staged_info = os.fstat(target)
        diag.binary('staged', staged_info)
        require(staged_info.st_uid == os.geteuid() and staged_info.st_nlink == 1
                and (staged_info.st_dev, staged_info.st_ino) != (before.st_dev, before.st_ino),
                'staged executable identity mismatch')
        require(identity(os.fstat(source)) == identity(before)
                and identity(os.stat('rh-server', dir_fd=parent, follow_symlinks=False)) == identity(before),
                'Cargo output changed while copying')
        staged = scratch / 'executed-component' / 'rh-server'
        require(read_regular(staged, MAX_BINARY, executable=True) == data, 'staged executable identity mismatch')
        return staged
    finally:
        for fd in reversed(handles): os.close(fd)


def probe(binary, psql, env, scratch, diagnostics=None):
    diag = diagnostics or Diagnostics()
    with diag.stage('database-fresh'):
        require(sql(psql, "SELECT count(*) FROM pg_tables WHERE schemaname='public'", env) == '0', 'CI database is not fresh')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    started = time.monotonic()
    command = [str(binary), '--bind', '127.0.0.1:' + str(port), '--runtime', 'core', '--database-url', CI_URL,
               '--instance-id', 'ci-native-readiness', '--max-rooms', '1', '--fill-bots', '0', '--bot-learning', 'off']
    # Logs stay private in the owned CI temporary directory, never in artifact upload paths.
    with (scratch / 'server-private.log').open('xb') as log:
        with diag.stage('server-start'):
            process = subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        try:
            with diag.stage('http-ready'):
                deadline = started + 40
                while True:
                    state = process.poll()
                    if state is not None: diag.process_exit(state)
                    require(state is None, 'native process exited before readiness')
                    try:
                        ready = strict_json(get_loopback(port, '/readyz'))
                        if ready == {'ok': True, 'state': 'ready', 'storage': 'ok'}:
                            break
                    except (OSError, urllib.error.URLError):
                        pass  # Only bounded startup transport/503 retries; all terminal checks below remain strict.
                    require(time.monotonic() < deadline, 'bounded native readiness timed out')
                    time.sleep(0.2)
            with diag.stage('http-info'):
                info = strict_json(get_loopback(port, '/info'))
                health = get_loopback(port, '/healthz').decode('ascii')
            with diag.stage('database-boundary'):
                counts = ','.join("'" + table + "',(SELECT count(*) FROM " + table + ')' for table in TABLES)
                rows = strict_json(sql(psql, 'SELECT json_build_object(' + counts + ')', env))
                validate_info(info, ready, rows)
                require(health == 'ok', 'native health refused')
                postgres = sql(psql, 'SHOW server_version', env)
        finally:
            with diag.stage('server-stop'):
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    exit_code = process.wait(timeout=5)
                    diag.process_exit(exit_code)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
                    raise Refused('owned readiness process did not stop within grace') from None
                require(exit_code == 0, 'native readiness process did not stop cleanly')
    with diag.stage('database-final'):
        final_rows = strict_json(sql(psql, 'SELECT json_build_object(' + counts + ')', env))
        require(final_rows == rows, 'database changed during native shutdown')
        validate_info(info, ready, final_rows)
        elapsed = int((time.monotonic() - started) * 1000)
        require(elapsed <= 60000, 'readiness elapsed bound exceeded')
    return {'profile': 'core-readiness-only', 'info': info, 'readyz': ready, 'healthz': health,
            'db_rows': rows, 'postgres_version': postgres, 'elapsed_ms': elapsed, 'exit_code': exit_code}


def authorize_event(commit):
    hex_string(commit, 40)
    require(os.environ.get('GITHUB_ACTIONS') == 'true', 'actual GitHub Actions context required')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/optimization_port', 'reviewed canonical workflow ref required')
    event_name = os.environ.get('GITHUB_EVENT_NAME')
    require(event_name in ('workflow_dispatch', 'push'), 'only actual manual or push events are allowed')
    if event_name == 'push':
        require(os.environ.get('GITHUB_SHA') == commit, 'push must build the actual full GitHub SHA')
        event_path = os.environ.get('GITHUB_EVENT_PATH')
        require(type(event_path) is str and event_path, 'actual push event payload required')
        event = strict_json(read_regular(event_path, 1024 * 1024))
        require(type(event) is dict and event.get('ref') == 'refs/heads/optimization_port'
                and event.get('after') == commit and event.get('deleted') is False
                and type(event.get('head_commit')) is dict and event['head_commit'].get('id') == commit
                and 'inputs' not in event, 'push payload mismatch; manual event spoof refused')
    return event_name


def produce(harness, source, commit, output, diagnostics=None):
    diag = diagnostics or Diagnostics()
    with diag.stage('ci-context'):
        require(sys.platform == 'linux' and platform.machine() == 'x86_64',
                'producer is restricted to Linux x86_64 GitHub jobs')
        authorize_event(commit)
    with diag.stage('source-selection'):
        selected = selection(harness, commit)
        clean_source(source, commit)
    with diag.stage('source-inputs'):
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
        with diag.stage('toolchain-install'):
            subprocess.run([rustup, 'toolchain', 'install', channel, '--profile', 'minimal', '--no-self-update'],
                           env=env, check=True, timeout=600)
        prefix = [rustup, 'run', channel]
        with diag.stage('toolchain-identity'):
            rustc_vv = capture([*prefix, 'rustc', '-vV'], env=env)
            cargo_vv = capture([*prefix, 'cargo', '-vV'], env=env)
        with diag.stage('cargo-build'):
            subprocess.run([*prefix, 'cargo', *BUILD_ARGS], cwd=source, env=env, check=True, timeout=2700)
        with diag.stage('cargo-output-copy'):
            binary = stage_cargo_executable(scratch, diag)
        with diag.stage('staged-binary'):
            data = read_regular(binary, MAX_BINARY, executable=True); elf_info = elf(data)
        with diag.stage('server-start'):
            readiness = probe(binary, psql, env, scratch, diagnostics=diag)
        with diag.stage('source-recheck'):
            require(read_regular(binary, MAX_BINARY, executable=True) == data, 'executed binary bytes changed')
            clean_source(source, commit)
            require(read_regular(source / 'Cargo.lock', 1024 * 1024) == cargo_lock
                    and read_regular(source / 'rust-toolchain.toml', 8192) == rust_file, 'source identities changed during build')
        with diag.stage('manifest-build'):
            manifest = {'format': 'rh-native-component/1', 'component': 'rh-server-postgres-release', 'deployable': False,
                        'source': {**selected, 'tree': git(source, 'rev-parse', 'HEAD^{tree}'),
                                   'cargo_lock_sha256': sha(cargo_lock), 'rust_toolchain_sha256': sha(rust_file)},
                        'build': {'target': TARGET, 'profile': 'release', 'features': ['postgres'], 'locked': True,
                                  'rust_toolchain': channel, 'rustc_vv': rustc_vv, 'cargo_vv': cargo_vv,
                                  'libc': os.confstr('CS_GNU_LIBC_VERSION'), 'release_debug': '0'},
                        'binary': {'path': 'bin/rh-server', 'bytes': len(data), 'sha256': sha(data), 'elf': elf_info},
                        'readiness': readiness}
        with diag.stage('archive-create'):
            return write_component(binary, manifest, output)


def main(argv=None):
    class SafeParser(argparse.ArgumentParser):
        def error(self, _message): raise Refused('invalid producer CLI')
    parser = SafeParser(description=__doc__)
    parser.add_argument('command', choices=['select', 'produce', 'verify'])
    parser.add_argument('--harness', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--commit')
    parser.add_argument('--archive', type=Path)
    diag = Diagnostics(sys.stderr)
    try:
        with diag.stage('cli'):
            args = parser.parse_args(argv)
        if args.command == 'select':
            with diag.stage('source-selection'):
                require(args.harness is not None, 'harness checkout required')
                result = selection(args.harness, args.commit)
        elif args.command == 'produce':
            require(args.harness is not None and args.source is not None and args.archive is not None, 'source/harness/new output required')
            result = produce(args.harness, args.source, args.commit, args.archive, diagnostics=diag)
        else:
            with diag.stage('archive-verify'):
                require(args.archive is not None, 'component archive required')
                data = read_regular(args.archive, MAX_BINARY + 1024 * 1024)
                manifest = inspect_archive(data)
                result = {'sha256': sha(data), 'source_commit': manifest['source']['commit'], 'deployable': False}
        print(json.dumps(result, sort_keys=True))
        return 0
    except (Exception, KeyboardInterrupt) as error:
        diag.failure(error)
        return 2


if __name__ == '__main__':
    def cancelled(_signal, _frame): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, cancelled)
    raise SystemExit(main())
