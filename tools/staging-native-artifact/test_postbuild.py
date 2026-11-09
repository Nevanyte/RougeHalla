"""Real private file/link operations with synthetic Cargo/probe outputs; no build/server/PG runs."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import component as c
import produce as p
from diagnostics import Diagnostics
from test_component import fixture, synthetic_elf


class Postbuild(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def cargo_file(self, scratch, linked=True):
        release = scratch / 'target' / c.TARGET / 'release'; release.mkdir(parents=True)
        path = release / 'rh-server'; path.write_bytes(synthetic_elf()); path.chmod(0o755)
        if linked:
            deps = release / 'deps'; deps.mkdir()
            os.link(path, deps / 'rh_server-SYNTHETIC')
        return path

    def test_two_link_source_stays_rejected_by_strict_reader_and_exclusive_copy_is_independent(self):
        original = self.cargo_file(self.root)
        self.assertEqual(original.stat().st_nlink, 2)
        with self.assertRaisesRegex(c.Refused, 'single-link'): c.read_regular(original, c.MAX_BINARY, True)
        out = io.StringIO(); diag = Diagnostics(out)
        staged = p.stage_cargo_executable(self.root, diag)
        self.assertEqual(staged.stat().st_nlink, 1)
        self.assertNotEqual(staged.stat().st_ino, original.stat().st_ino)
        self.assertEqual(c.read_regular(staged, c.MAX_BINARY, True), synthetic_elf())
        self.assertEqual(original.stat().st_nlink, 2)
        self.assertEqual(diag.binaries['cargo']['nlink'], 2)
        self.assertEqual(diag.binaries['staged']['nlink'], 1)
        with self.assertRaises(FileExistsError): p.stage_cargo_executable(self.root)
        self.assertEqual(c.read_regular(staged, c.MAX_BINARY, True), synthetic_elf())
        self.assertNotIn(str(self.root), out.getvalue())

    def test_copy_refuses_symlink_source_writable_source_and_symlink_ancestor(self):
        for case in ('source-link', 'writable-source', 'directory-link'):
            with self.subTest(case=case), tempfile.TemporaryDirectory(dir=self.root) as temp:
                scratch = Path(temp); source = self.cargo_file(scratch, linked=False)
                if case == 'source-link':
                    other = source.with_name('other'); source.rename(other); source.symlink_to(other)
                elif case == 'writable-source': source.chmod(0o777)
                else:
                    release = source.parent; moved = release.with_name('other-release'); release.rename(moved); release.symlink_to(moved)
                with self.assertRaises((c.Refused, OSError)): p.stage_cargo_executable(scratch)
                self.assertFalse((scratch / 'executed-component').exists())

    def test_producer_executes_hashes_and_archives_same_single_link_copy_of_two_link_cargo_output(self):
        repo, scratch_parent = self.root / 'repo', self.root / 'work'
        repo.mkdir(); scratch_parent.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.PIPE).decode().strip()
        git('init', '-b', 'optimization_port')
        (repo / 'Cargo.lock').write_text('SYNTHETIC LOCK ONLY\n')
        (repo / 'rust-toolchain.toml').write_text('[toolchain]\nchannel = "1.97.0"\n')
        git('add', 'Cargo.lock', 'rust-toolchain.toml')
        git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'synthetic')
        commit = git('rev-parse', 'HEAD'); git('update-ref', 'refs/remotes/origin/optimization_port', commit)
        observed = fixture(synthetic_elf())
        events, seen = [], {}
        real_run = subprocess.run
        def run(argv, **kwargs):
            if argv[0] == 'git': return real_run(argv, **kwargs)  # Actual private Git identity checks.
            self.assertEqual(argv[0], '/SYNTHETIC/rustup')
            events.append(tuple(argv))
            if 'build' in argv:
                self.assertNotIn('AWS_SECRET_ACCESS_KEY', kwargs['env'])
                scratch = Path(kwargs['env']['CARGO_TARGET_DIR']).parent
                source = self.cargo_file(scratch)
                self.assertEqual(source.stat().st_nlink, 2)
                with self.assertRaisesRegex(c.Refused, 'single-link'): c.read_regular(source, c.MAX_BINARY, True)
                seen['cargo'] = source
                return subprocess.CompletedProcess(argv, 0)
            if 'rustc' in argv: data = observed['build']['rustc_vv'].encode()
            elif 'cargo' in argv: data = observed['build']['cargo_vv'].encode()
            else: data = b''
            return subprocess.CompletedProcess(argv, 0, stdout=data, stderr=b'')
        def readiness(binary, _psql, _env, scratch, **_kwargs):
            self.assertEqual(binary, scratch / 'executed-component' / 'rh-server')
            self.assertNotEqual(binary, seen['cargo'])
            self.assertEqual(binary.stat().st_nlink, 1)
            self.assertEqual(c.read_regular(binary, c.MAX_BINARY, True), synthetic_elf())
            seen['probe'] = binary
            return observed['readiness']  # Explicitly synthetic; never an actual native receipt.
        def git_only_process(argv, *args, **kwargs):
            self.assertEqual(argv[0], 'git', 'no actual native build/server process is permitted in this test')
            return self.real_popen(argv, *args, **kwargs)
        diag_stream = io.StringIO(); diag = Diagnostics(diag_stream)
        archive = self.root / 'native.tar'
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                'GITHUB_REF': 'refs/heads/optimization_port', 'RUNNER_TEMP': str(scratch_parent),
                'AWS_SECRET_ACCESS_KEY': 'SYNTHETIC_DO_NOT_FORWARD'}), \
                patch.object(p.sys, 'platform', 'linux'), patch.object(p.platform, 'machine', return_value='x86_64'), \
                patch.object(p.shutil, 'which', side_effect=lambda name: '/SYNTHETIC/' + name), \
                patch.object(p.subprocess, 'run', side_effect=run), patch.object(p, 'probe', side_effect=readiness), \
                patch.object(p.os, 'confstr', return_value='glibc 2.39'), patch.object(p.subprocess, 'Popen') as native:
            # Real Git uses subprocess.Popen internally; preserve that implementation just for this local Git fixture.
            native.side_effect = git_only_process
            result = p.produce(repo, repo, commit, archive, diagnostics=diag)
        manifest = c.inspect_archive(archive.read_bytes())
        self.assertEqual(manifest['binary']['sha256'], c.sha(synthetic_elf()))
        self.assertEqual(result['sha256'], c.sha(archive.read_bytes()))
        self.assertIn('probe', seen)
        self.assertEqual(diag.binaries['cargo']['nlink'], 2)
        self.assertEqual(diag.binaries['staged']['nlink'], 1)
        self.assertNotIn('SYNTHETIC_DO_NOT_FORWARD', diag_stream.getvalue())
        self.assertTrue(any('build' in command for command in events))

    real_popen = staticmethod(subprocess.Popen)


class SafeDiagnostics(unittest.TestCase):
    def test_first_failure_survives_cleanup_error_without_serializing_sensitive_exceptions(self):
        out = io.StringIO(); diag = Diagnostics(out)
        try:
            try:
                with diag.stage('staged-binary'): raise c.Refused('bounded single-link regular file required')
            finally:
                with diag.stage('server-stop'):
                    raise subprocess.CalledProcessError(2, ['psql', 'postgres://SYNTHETIC_SECRET'],
                                                         output=b'SYNTHETIC_SECRET', stderr=b'SYNTHETIC_SECRET')
        except Exception as error: diag.failure(error)
        event = json.loads(out.getvalue().splitlines()[-1])
        self.assertEqual((event['stage'], event['failure_code']), ('staged-binary', 'strict_regular_file'))
        self.assertNotIn('SYNTHETIC_SECRET', out.getvalue())
        self.assertNotIn('postgres://', out.getvalue())

    def test_known_unknown_and_subprocess_failures_have_only_static_codes(self):
        cases = [(c.Refused('Cargo output changed while copying'), 'cargo_output_changed'),
                 (c.Refused('SYNTHETIC_SECRET https://private.invalid'), 'refused_unclassified'),
                 (subprocess.TimeoutExpired(['psql', 'SYNTHETIC_SECRET'], 10, output=b'SYNTHETIC_SECRET'), 'command_timeout'),
                 (subprocess.CalledProcessError(1, ['SYNTHETIC_SECRET'], stderr=b'SYNTHETIC_SECRET'), 'command_failed')]
        for error, code in cases:
            with self.subTest(code=code):
                out = io.StringIO(); diag = Diagnostics(out)
                try:
                    with diag.stage('database-fresh'): raise error
                except Exception as caught: diag.failure(caught)
                last = json.loads(out.getvalue().splitlines()[-1])
                self.assertEqual(last['failure_code'], code)
                self.assertNotIn('SYNTHETIC_SECRET', out.getvalue())
                self.assertNotIn('https://', out.getvalue())

    def test_cli_reports_safe_json_stage_and_code_instead_of_raw_argument(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = p.main(['SYNTHETIC_SECRET:https://private.invalid'])
        self.assertEqual(result, 2); self.assertEqual(out.getvalue(), '')
        failure = json.loads(err.getvalue().splitlines()[-1])
        self.assertEqual((failure['stage'], failure['failure_code']), ('cli', 'cli_arguments'))
        self.assertNotIn('SYNTHETIC_SECRET', err.getvalue())


if __name__ == '__main__': unittest.main()
