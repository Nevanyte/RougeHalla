"""No host, SDK, shell, package, network, or installer execution."""
import datetime as dt
import hashlib
import io
import json
import re
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
C = dict(bucket='demo-private', key='one.tar', sha256='0'*64, region='ca-west-1', expires_at='2026-11-09T12:00:00Z', domain='play.rougehalla.com', run_id='demo-1', protocol=14, content_hash='7c6a633f68c2cc72')


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
        for stamp in ('2026-11-09T00:00:00Z', '2026-11-09T12:00:01Z', '2026-11-09T12:00:00+00:00'):
            with self.subTest(stamp=stamp), self.assertRaises(ValueError):
                config(json.dumps(dict(C, expires_at=stamp)), NOW)

    def test_config_boundary(self):
        for key, value in [('domain', 'other.com'), ('domain', 'rougehalla.com'),
                           ('domain', 'roguehalla.com'), ('domain', 'play.roguehalla.com'), ('region', 'us-east-1'), ('run_id', 'x;bad'), ('sha256', False), ('key', '../bad'),
                           ('protocol', True), ('protocol', 0), ('protocol', 65536), ('content_hash', '7C6A633F68C2CC72'), ('content_hash', '7c6a633f68c2cc7')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                config(json.dumps(dict(C, **{key: value})), NOW)
        for key in ('protocol', 'content_hash'):
            missing = dict(C)
            del missing[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                config(json.dumps(missing), NOW)

    def test_ready_requires_both_configured_artifact_identities(self):
        expected = {'protocol': C['protocol'], 'content_hash': C['content_hash']}

        class Response:
            status = 200
            def __init__(self, value): self.value = value
            def read(self, limit):
                self.asserted_limit = limit
                return json.dumps(self.value).encode()

        class Connection:
            def __init__(self, payload): self.payload = payload; self.closed = False; self.route = None
            def request(self, method, route): self.route = route
            def getresponse(self):
                if self.route == '/readyz':
                    return Response({'ok': True, 'state': 'ready', 'storage': 'ok'})
                return Response(self.payload)
            def close(self): self.closed = True

        good = {'protocol': C['protocol'], 'contentHash': C['content_hash']}
        for port in (7777, 7779):
            with self.subTest(port=port), mock.patch.object(bootstrap.http.client, 'HTTPConnection',
                                                            side_effect=lambda host, p, timeout: Connection(good)):
                bootstrap.ready(port, expected)

        malformed_or_stale = (
            (expected, {'protocol': C['protocol'] - 1, 'contentHash': C['content_hash']}),
            (expected, {'protocol': C['protocol'], 'contentHash': '0' * 16}),
            (expected, {'protocol': float(C['protocol']), 'contentHash': C['content_hash']}),
            ({'protocol': 1, 'content_hash': C['content_hash']}, {'protocol': True, 'contentHash': C['content_hash']}),
            (expected, {'protocol': 65536, 'contentHash': C['content_hash']}),
            (expected, {'contentHash': C['content_hash']}),
        )
        for port in (7777, 7779):
            for expected_identity, payload in malformed_or_stale:
                conn = Connection(payload)
                with self.subTest(port=port, expected=expected_identity, payload=payload), \
                        mock.patch.object(bootstrap.http.client, 'HTTPConnection', return_value=conn):
                    with self.assertRaises(ValueError):
                        bootstrap.ready(port, expected_identity)
                    self.assertTrue(conn.closed)

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
        live = dict(C, expires_at=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%SZ'))
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
            # Owner approval 2026-11-11: the learner runs on Source only; rh-server refuses it in training.
            self.assertIn('--bot-learning off ' if training else '--bot-learning single-writer ', unit)


# Today's rendered Source and training units for C (captured before P-HOST-FLAGS-1). The default render must match.
GOLDEN_SOURCE_UNIT = '[Unit]\nRequires=rh-demo-pg.service rh-demo-expiry.timer\nAfter=rh-demo-pg.service rh-demo-expiry.timer\nOnFailure=rh-demo-poweroff.service\n[Service]\nUser=rougehalla\nGroup=rougehalla\nExecStartPre=+/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py guard\nExecStart=/opt/rougehalla-demo/rh-server --runtime source-arena --bind 127.0.0.1:7777 --instance-id demo-1-source-arena --map /opt/rougehalla-demo/source-map.json --result-spool /var/lib/rougehalla-demo/spool --min-players 1 --fill-bots 8 --max-rooms 1 --lobby-seconds 10 --fill-seconds 3 --database-url postgresql://rougehalla@localhost/roguehalla?host=/run/rh-demo-pg --bot-learning single-writer --api-cors-origins https://play.rougehalla.com --client-ip-header x-forwarded-for --trusted-proxies 127.0.0.1\nRestart=no\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=/var/lib/rougehalla-demo /run/rh-demo-pg\nUMask=0077\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=multi-user.target\n'
GOLDEN_TRAINING_UNIT = '[Unit]\nRequires=rh-demo-pg.service rh-demo-expiry.timer\nAfter=rh-demo-pg.service rh-demo-expiry.timer\nOnFailure=rh-demo-poweroff.service\n[Service]\nUser=rougehalla\nGroup=rougehalla\nExecStartPre=+/usr/bin/python3 -I /usr/local/lib/rh-demo/bootstrap.py guard\nExecStart=/opt/rougehalla-demo/rh-server --runtime training --bind 127.0.0.1:7779 --instance-id demo-1-training --min-players 1 --fill-bots 0 --max-rooms 1 --lobby-seconds 0 --fill-seconds 0 --database-url postgresql://rougehalla@localhost/roguehalla?host=/run/rh-demo-pg --bot-learning off --api-cors-origins https://play.rougehalla.com --client-ip-header x-forwarded-for --trusted-proxies 127.0.0.1\nRestart=no\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=/var/lib/rougehalla-demo /run/rh-demo-pg\nUMask=0077\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=multi-user.target\n'
ON = dict(map_pool=True, signature_landmarks=True, lobby_timing='matchmaking')


def exec_line(c, training):
    return next(l for l in app_unit(c, training).splitlines() if l.startswith('ExecStart='))


class LaunchFlags(unittest.TestCase):
    def test_default_render_is_byte_identical_to_today(self):
        self.assertEqual(app_unit(C, False), GOLDEN_SOURCE_UNIT)
        self.assertEqual(app_unit(C, True), GOLDEN_TRAINING_UNIT)
        explicit = dict(C, map_pool=False, signature_landmarks=False, lobby_timing='legacy')
        config(json.dumps(explicit), NOW)
        self.assertEqual(app_unit(explicit, False), GOLDEN_SOURCE_UNIT)
        self.assertEqual(app_unit(explicit, True), GOLDEN_TRAINING_UNIT)

    def test_map_pool_alone(self):
        line = exec_line(dict(C, map_pool=True), False)
        self.assertIn(' --map /opt/rougehalla-demo/source-map.json ', line)
        self.assertIn(' --map-pool ', line)
        self.assertNotIn('--signature-landmarks', line)
        self.assertNotIn('--lobby-timing', line)
        self.assertIn('--lobby-seconds 10 --fill-seconds 3', line)

    def test_map_pool_with_landmarks(self):
        line = exec_line(dict(C, map_pool=True, signature_landmarks=True), False)
        self.assertIn(' --map-pool ', line)
        self.assertIn(' --signature-landmarks ', line)

    def test_matchmaking_alone_drops_explicit_lobby_pair(self):
        line = exec_line(dict(C, lobby_timing='matchmaking'), False)
        self.assertIn(' --lobby-timing matchmaking ', line)
        self.assertNotIn('--lobby-seconds', line)
        self.assertNotIn('--fill-seconds', line)
        self.assertNotIn('--map-pool', line)
        self.assertIn('--min-players 1 --fill-bots 8 --max-rooms 1', line)

    def test_all_three_on_source_only(self):
        c = dict(C, **ON)
        config(json.dumps(c), NOW)
        line = exec_line(c, False)
        for flag in (' --map-pool ', ' --signature-landmarks ', ' --lobby-timing matchmaking '):
            self.assertIn(flag, line)
        self.assertIn('--bot-learning single-writer', line)
        self.assertEqual(app_unit(c, True), GOLDEN_TRAINING_UNIT)

    def test_rendered_flags_are_ones_the_server_accepts(self):
        # The accepted list is the flags rh-server's own parsers define (runtime.rs, main.rs typo-guard test).
        accepted = {'--runtime', '--bind', '--instance-id', '--map', '--result-spool', '--min-players', '--fill-bots',
                    '--max-rooms', '--lobby-seconds', '--fill-seconds', '--database-url', '--bot-learning',
                    '--api-cors-origins', '--client-ip-header', '--trusted-proxies', '--map-pool',
                    '--signature-landmarks', '--lobby-timing'}
        for c in (C, dict(C, **ON)):
            for training in (False, True):
                flags = set(re.findall(r'(?<= )--[a-z-]+', exec_line(c, training)))
                self.assertLessEqual(flags, accepted)
        self.assertTrue({'--map-pool', '--signature-landmarks', '--lobby-timing'} <= set(re.findall(r'--[a-z-]+', exec_line(dict(C, **ON), False))))

    def test_config_validation(self):
        config(json.dumps(dict(C, map_pool=True, signature_landmarks=True)), NOW)
        with self.assertRaisesRegex(ValueError, 'signature_landmarks'):
            config(json.dumps(dict(C, signature_landmarks=True)), NOW)
        with self.assertRaisesRegex(ValueError, 'signature_landmarks'):
            config(json.dumps(dict(C, map_pool=False, signature_landmarks=True)), NOW)
        for key, value in [('lobby_timing', 'fast'), ('lobby_timing', ''), ('lobby_timing', True), ('map_pool', 'yes'), ('map_pool', 1), ('signature_landmarks', None)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                config(json.dumps(dict(C, **{key: value})), NOW)
        with self.assertRaises(ValueError):
            config(json.dumps(dict(C, unknown_flag=True)), NOW)

    def test_config_example_documents_the_settings(self):
        example = json.loads(Path(__file__).with_name('config.example.json').read_text())
        self.assertEqual((example.get('map_pool'), example.get('signature_landmarks'), example.get('lobby_timing')), (False, False, 'legacy'))
        readme = Path(__file__).with_name('README.md').read_text()
        for word in ('map_pool', 'signature_landmarks', 'lobby_timing'):
            self.assertIn(word, readme)


if __name__ == '__main__':
    unittest.main()
