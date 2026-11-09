"""Local synthetic Git/HTTP boundary checks only; never builds Rust or starts PostgreSQL/server."""
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import component as c
import produce as p
from test_component import fixture, synthetic_elf


class Selection(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name).resolve()
        self.command('init', '-b', 'optimization_port')
        (self.repo / 'source.txt').write_text('SYNTHETIC SOURCE\n')
        self.command('add', 'source.txt'); self.commit()
        self.first = self.command('rev-parse', 'HEAD').strip()
        (self.repo / 'source.txt').write_text('SYNTHETIC SOURCE 2\n')
        self.command('add', 'source.txt'); self.commit()
        self.tip = self.command('rev-parse', 'HEAD').strip()
        self.command('update-ref', 'refs/remotes/origin/optimization_port', self.tip)

    def command(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.PIPE).decode()

    def commit(self):
        self.command('-c', 'user.name=Synthetic Test', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'synthetic')

    def test_exact_ancestor_and_tip_bind_actual_git_identity(self):
        selected = p.selection(self.repo, self.first)
        self.assertEqual(selected, {'commit': self.first, 'optimization_port_tip': self.tip, 'harness_commit': self.tip})
        self.assertEqual(p.selection(self.repo, self.tip)['commit'], self.tip)

    def test_unmerged_commit_and_short_or_injected_refs_refuse(self):
        (self.repo / 'source.txt').write_text('UNMERGED\n'); self.command('add', 'source.txt'); self.commit()
        unmerged = self.command('rev-parse', 'HEAD').strip()
        with self.assertRaises(c.Refused): p.selection(self.repo, unmerged)
        for value in ('HEAD', self.first[:7], 'A' * 40, '--help', 'a' * 40 + '\n', '$(false)'):
            with self.subTest(value=value), patch.object(p, 'git') as query:
                with self.assertRaises(c.Refused): p.selection(self.repo, value)
                query.assert_not_called()

    def test_dirty_or_wrong_source_checkout_refuses(self):
        p.clean_source(self.repo, self.tip)
        with self.assertRaises(c.Refused): p.clean_source(self.repo, self.first)
        (self.repo / 'untracked').write_text('NOT SOURCE')
        with self.assertRaises(c.Refused): p.clean_source(self.repo, self.tip)


class Boundaries(unittest.TestCase):
    def exercise_probe(self, info_mutation=None, fresh='0'):
        """Production probe with injected process/network/DB; writes only a private temp log."""
        observed = fixture(synthetic_elf())['readiness']
        if info_mutation: observed['info'].update(info_mutation)
        events = []
        def request(port, path):
            events.append(('GET', path))
            return (observed['healthz'].encode() if path == '/healthz' else
                    c.canonical(observed['readyz'] if path == '/readyz' else observed['info']))
        sql_answers = iter([fresh, c.canonical(observed['db_rows']).decode(), '16.9 (SYNTHETIC)',
                            c.canonical(observed['db_rows']).decode()])
        def query(*_args):
            events.append(('SQL',)); return next(sql_answers)
        process = SimpleNamespace(pid=4242, poll=lambda: None,
                                  wait=lambda **_kwargs: (events.append(('wait',)) or 0))
        with tempfile.TemporaryDirectory() as temp, patch.object(p.socket, 'socket') as sock, \
                patch.object(p.subprocess, 'Popen', return_value=process) as start, \
                patch.object(p.os, 'killpg') as kill, patch.object(p, 'sql', side_effect=query), \
                patch.object(p, 'get_loopback', side_effect=request), \
                patch.object(p.time, 'monotonic', side_effect=[100.0, 100.1]):
            sock.return_value.__enter__.return_value.getsockname.return_value = ('127.0.0.1', 12345)
            try:
                result = p.probe(Path('/SYNTHETIC/server'), '/SYNTHETIC/psql', {}, Path(temp))
            except c.Refused:
                return None, events, start.call_count, kill.call_args
            return result, events, start.call_count, kill.call_args

    def test_probe_observes_http_and_zero_rows_then_stops_before_final_database_check(self):
        result, events, starts, killed = self.exercise_probe()
        self.assertEqual(starts, 1)
        self.assertEqual(result['info']['contentHash'], 'a' * 16)
        self.assertEqual([event for event in events if event[0] == 'GET'],
                         [('GET', '/readyz'), ('GET', '/info'), ('GET', '/healthz')])
        self.assertLess(events.index(('wait',)), len(events) - 1)
        self.assertEqual(events[-1], ('SQL',))
        self.assertEqual(killed.args, (4242, p.signal.SIGTERM))

    def test_probe_refuses_observed_rooms_and_nonfresh_database_without_false_receipt(self):
        result, _events, starts, killed = self.exercise_probe(info_mutation={'rooms': 1})
        self.assertIsNone(result); self.assertEqual(starts, 1)
        self.assertEqual(killed.args, (4242, p.signal.SIGTERM))
        result, events, starts, killed = self.exercise_probe(fresh='1')
        self.assertIsNone(result); self.assertEqual(starts, 0)
        self.assertEqual(events, [('SQL',)]); self.assertIsNone(killed)

    def test_toolchain_requires_exact_source_pin(self):
        self.assertEqual(p.toolchain_channel(b'[toolchain]\nchannel = "1.97.0"\n'), '1.97.0')
        for data in (b'channel = "stable"', b'channel="1.97"', b'channel="1.97.0"\nchannel="1.98.0"'):
            with self.assertRaises(c.Refused): p.toolchain_channel(data)

    def test_no_redirect_proxy_or_post_side_channel_and_bounded_response(self):
        for path in ('/api/profile', '/ws', 'http://elsewhere/info', '/control/session'):
            with self.assertRaises(c.Refused): p.get_loopback(12345, path)
        with self.assertRaises(c.Refused): p.NoRedirect().redirect_request(None, None, None, None, None, None)
        class Response(io.BytesIO): status = 200
        with patch.object(p.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = Response(b'{}')
            self.assertEqual(p.get_loopback(12345, '/info'), b'{}')
            self.assertEqual(build.return_value.open.call_args.args, ('http://127.0.0.1:12345/info',))
            self.assertEqual(build.call_args.args[0].proxies, {})
            build.return_value.open.return_value = Response(b'x' * 16385)
            with self.assertRaises(c.Refused): p.get_loopback(12345, '/info')

    def test_mac_or_unapproved_event_refuses_before_any_native_build_or_database(self):
        with patch.object(p.sys, 'platform', 'darwin'), patch.object(p.subprocess, 'run') as execute:
            with self.assertRaises(c.Refused): p.produce(Path('.'), Path('.'), '1' * 40, Path('/unused.tar'))
            execute.assert_not_called()
        with patch.object(p.sys, 'platform', 'linux'), patch.object(p.platform, 'machine', return_value='x86_64'), \
                patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'push'}, clear=True), \
                patch.object(p.subprocess, 'run') as execute:
            with self.assertRaises(c.Refused): p.produce(Path('.'), Path('.'), '1' * 40, Path('/unused.tar'))
            execute.assert_not_called()


if __name__ == '__main__': unittest.main()
