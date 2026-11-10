"""No host, SDK, shell, package, network, or installer execution."""
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock
from contextlib import redirect_stderr
import subprocess
import bootstrap
from bootstrap import config, unpack, caddy_config, app_unit, shaper_command, isolation_unit
from render import render

NOW = dt.datetime(2026, 11, 9, tzinfo=dt.timezone.utc)
C = dict(bucket='demo-private', key='one.tar', sha256='0'*64, region='ca-west-1', expires_at='2026-11-09T03:00:00Z', domain='play.rougehalla.com', run_id='demo-1')


def archive(path, extras=(), edit=None):
    files = {'rh-server': b'\x7fELF\x02\x01' + bytes(12) + b'\x3e\x00', 'source-map.json': b'{}', 'web/index.html': b'web'}
    manifest = {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}
    if edit:
        edit(manifest)
    files['bundle-manifest.json'] = json.dumps(manifest).encode()
    with tarfile.open(path, 'w') as tar:
        for name, data in files.items():
            row = tarfile.TarInfo(name)
            row.size = len(data)
            tar.addfile(row, io.BytesIO(data))
        for row in extras:
            tar.addfile(row, io.BytesIO(b''))


class Offline(unittest.TestCase):
    def test_expiry(self):
        config(json.dumps(C), NOW)
        for stamp in ('2026-11-09T00:00:00Z', '2026-11-09T03:00:01Z', '2026-11-09T03:00:00+00:00'):
            with self.subTest(stamp=stamp), self.assertRaises(ValueError):
                config(json.dumps(dict(C, expires_at=stamp)), NOW)

    def test_config_boundary(self):
        for key, value in [('domain', 'other.com'), ('domain', 'rougehalla.com'),
                           ('domain', 'roguehalla.com'), ('domain', 'play.roguehalla.com'), ('region', 'us-east-1'), ('run_id', 'x;bad'), ('sha256', False), ('key', '../bad')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                config(json.dumps(dict(C, **{key: value})), NOW)

    def test_good_extract_exclusive(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            archive(p/'a.tar')
            unpack(p/'a.tar', p/'out')
            self.assertEqual((p/'out/web/index.html').read_bytes(), b'web')
            with self.assertRaises(FileExistsError):
                unpack(p/'a.tar', p/'out')

    def test_bad_entries(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('web/link', tarfile.SYMTYPE), ('web/pipe', tarfile.FIFOTYPE), ('other', tarfile.REGTYPE), ('web/index.html', tarfile.REGTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as tmp:
                p = Path(tmp)
                row = tarfile.TarInfo(name)
                row.type = kind
                row.linkname = '/etc/passwd' if kind == tarfile.SYMTYPE else ''
                archive(p/'a.tar', [row])
                with self.assertRaises(ValueError):
                    unpack(p/'a.tar', p/'out')
                self.assertFalse((p/'out').exists())

    def test_wrong_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            archive(p/'a.tar', edit=lambda m: m.update({'web/index.html': '0'*64}))
            with self.assertRaises(ValueError):
                unpack(p/'a.tar', p/'out')

    def test_nft_rules_have_real_block_separators_and_exact_rejections(self):
        rules = bootstrap.isolation_rules((997, 111, 999))
        expected = ('table inet rh_demo {\n'
                    '    chain output {\n'
                    '        type filter hook output priority 0; policy accept;\n'
                    '        meta skuid { 997, 111, 999 } ip daddr 169.254.169.254 reject;\n'
                    '        meta skuid { 997, 111, 999 } ip6 daddr fd00:ec2::254 reject;\n'
                    '    }\n}\n')
        self.assertEqual(rules, expected)
        self.assertNotIn('} }', rules)  # Actual failed one-line producer lacked this block separator.
        self.assertEqual(rules.count('reject;'), 2)
        for bad in ((997, 111), (997, 111, '999; accept'), (997, False, 999)):
            with self.subTest(uids=bad), self.assertRaises(ValueError):
                bootstrap.isolation_rules(bad)

    def test_egress_shaper(self):
        v4 = [{'dst': 'default', 'gateway': '10.0.0.1', 'dev': 'ens5'}]
        v6 = [{'dst': 'default', 'gateway': 'fe80::1', 'dev': 'ens5'}]
        expected = ('/usr/sbin/tc', 'qdisc', 'replace', 'dev', 'ens5', 'root', 'handle', '1:',
                    'tbf', 'rate', '8mbit', 'burst', '512kb', 'latency', '500ms')
        self.assertEqual(shaper_command(v4, v6), expected)
        self.assertEqual(shaper_command(v4, []), expected)
        for bad4, bad6 in [([], []), ({}, []), (v4, {}), (v4, [{'dst': 'default', 'dev': 'ens6'}]),
                           ([{'dst': 'default', 'dev': 'ens5;reboot'}], []),
                           ([{'dst': 'default', 'dev': 'lo'}], []),
                           ([{'dst': 'default', 'dev': 'ens5', 'type': 'blackhole'}], []),
                           ([{'dev': 'ens5'}], []), ([{'dst': 'default', 'dev': 5}], [])]:
            with self.subTest(v4=bad4, v6=bad6), self.assertRaises(ValueError):
                shaper_command(bad4, bad6)
        unit = isolation_unit()
        self.assertIn('bootstrap.py isolate', unit)
        self.assertIn('StandardOutput=journal+console', unit)
        self.assertIn('StandardError=journal+console', unit)
        self.assertIn('After=network-online.target rh-demo-expiry.timer', unit)
        self.assertIn('Requires=rh-demo-expiry.timer', unit)
        self.assertIn('Type=oneshot', unit)
        self.assertIn('OnFailure=rh-demo-poweroff.service', unit)
        self.assertIn('WantedBy=multi-user.target', unit)
        self.assertIn('Before=rh-demo-source.service rh-demo-training.service caddy.service', unit)

    def test_isolation_stages_preserve_command_order_without_real_execution(self):
        calls = []
        def fake(args, **kwargs):
            calls.append(args)
            if args[0] == '/usr/sbin/ip':
                data = b'[{"dst":"default","dev":"ens5"}]' if '-4' in args else b'[]'
                return subprocess.CompletedProcess(args, 0, data, b'')
            return subprocess.CompletedProcess(args, 0, b'', b'')
        log = io.StringIO()
        with mock.patch.object(bootstrap, 'guard'), mock.patch.object(bootstrap.subprocess, 'run', side_effect=fake), redirect_stderr(log):
            bootstrap.isolate()
        self.assertEqual(calls, [('/usr/sbin/nft', '-f', '/etc/rh-demo.nft'),
            ('/usr/sbin/ip', '-json', '-4', 'route', 'show', 'default'),
            ('/usr/sbin/ip', '-json', '-6', 'route', 'show', 'default'),
            shaper_command([{'dst': 'default', 'dev': 'ens5'}], []),
            ('/usr/sbin/tc', 'qdisc', 'replace', 'dev', 'ens5', 'parent', '1:1', 'handle', '10:',
             'fq_codel', 'limit', '512', 'target', '5ms', 'interval', '100ms')])
        rows = [json.loads(x.removeprefix('RH_DEMO_ISOLATION ')) for x in log.getvalue().splitlines()]
        self.assertEqual([x['stage'] for x in rows if x['event'] == 'ok'],
                         ['nft-load', 'guard', 'route-v4', 'route-v6', 'guard', 'tbf', 'fq_codel'])
        self.assertTrue(all(x['status'] == 0 for x in rows))

    def test_isolation_first_failure_stops_and_logs_only_bounded_stderr(self):
        log = io.StringIO()
        failed = subprocess.CompletedProcess((), 7, b'NEVER-LOG-STDOUT', b'bad\n\x1b\r' + b'x' * 5000)
        with mock.patch.object(bootstrap.subprocess, 'run', return_value=failed) as run, \
                mock.patch.object(bootstrap, 'guard') as guard, redirect_stderr(log):
            with self.assertRaises(subprocess.CalledProcessError): bootstrap.isolate()
        run.assert_called_once(); guard.assert_not_called()
        rows = [json.loads(x.removeprefix('RH_DEMO_ISOLATION ')) for x in log.getvalue().splitlines()]
        self.assertEqual([(x['stage'], x['event'], x['status']) for x in rows],
                         [('nft-load', 'start', 0), ('nft-load', 'fail', 7)])
        self.assertEqual(len(rows[-1]['stderr']), 2048)
        self.assertTrue(all(32 <= ord(c) <= 126 for c in rows[-1]['stderr']))
        self.assertNotIn('NEVER-LOG-STDOUT', log.getvalue())

    def test_shape_parse_parent_guard_and_timeout_refusals_are_not_bypassed(self):
        for failure in ('route-v4', 'tbf', 'guard'):
            log = io.StringIO(); calls = []
            def fake(args, **kwargs):
                calls.append(args)
                if args[0] == '/usr/sbin/ip':
                    if failure == 'route-v4': return subprocess.CompletedProcess(args, 0, b'NOT-JSON-PRIVATE', b'')
                    data = b'[]' if failure == 'guard' or '-6' in args else b'[{"dst":"default","dev":"ens5"}]'
                    return subprocess.CompletedProcess(args, 0, data, b'')
                return subprocess.CompletedProcess(args, 9, b'', b'parent failed')
            with self.subTest(failure=failure), mock.patch.object(bootstrap, 'guard'), \
                    mock.patch.object(bootstrap.subprocess, 'run', side_effect=fake), redirect_stderr(log):
                with self.assertRaises((ValueError, subprocess.CalledProcessError)): bootstrap.shape()
            rows = [json.loads(x.removeprefix('RH_DEMO_ISOLATION ')) for x in log.getvalue().splitlines()]
            self.assertEqual(rows[-1]['stage'], failure)
            self.assertEqual(rows[-1]['event'], 'fail')
            self.assertFalse(any('fq_codel' in args for args in calls))
            self.assertNotIn('NOT-JSON-PRIVATE', log.getvalue())
        for error, status in ((FileNotFoundError(2, 'PRIVATE-PATH'), 2),
                              (subprocess.TimeoutExpired('PRIVATE-ARGV', 5), 124)):
            log = io.StringIO()
            with mock.patch.object(bootstrap.subprocess, 'run', side_effect=error), redirect_stderr(log):
                with self.assertRaises(type(error)): bootstrap.isolate()
            last = json.loads(log.getvalue().splitlines()[-1].removeprefix('RH_DEMO_ISOLATION '))
            self.assertEqual(last['status'], status)
            self.assertNotIn('PRIVATE-', log.getvalue())
        with mock.patch.object(bootstrap.subprocess, 'run') as run:
            with self.assertRaises(ValueError): bootstrap.isolation_command('nft-load', ('/usr/bin/psql',))
            run.assert_not_called()

    def test_templates(self):
        # Render with a fresh absolute expiry, never executes the resulting shell.
        live = dict(C, expires_at=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))
        text = render(json.dumps(live).encode(), b'# reviewed script')
        self.assertLess(text.index('enable --now rh-demo-expiry.timer'), text.index('start --no-block rh-demo-setup.service'))
        self.assertIn('TimeoutStartSec=600', text)
        self.assertIn('Persistent=true', text)
        self.assertNotIn('apt-get', text)
        caddy = caddy_config()
        self.assertTrue(caddy.startswith('play.rougehalla.com {\n'))
        self.assertNotIn('play.roguehalla.com', caddy)
        self.assertIn('/control*', caddy)
        self.assertIn('encode zstd gzip', caddy)
        self.assertIn('header_up X-Forwarded-For {remote_host}', caddy)
        for training in (False, True):
            unit = app_unit(C, training)
            self.assertIn('ExecStartPre=+/usr/bin/python3', unit)
            self.assertIn('Restart=no', unit)
            self.assertIn('127.0.0.1:', unit)
            self.assertIn('--api-cors-origins https://play.rougehalla.com ', unit)
            self.assertNotIn('--api-cors-origins https://rougehalla.com ', unit)
            self.assertNotIn('play.roguehalla.com', unit)
            self.assertNotIn('password', unit)


if __name__ == '__main__':
    unittest.main()
