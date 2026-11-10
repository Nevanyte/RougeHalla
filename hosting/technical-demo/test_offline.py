"""No host, SDK, shell, package, network, or installer execution."""
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from bootstrap import config, unpack, caddy_config, app_unit, shaper_command, isolation_unit
from render import render

NOW = dt.datetime(2026, 11, 9, tzinfo=dt.timezone.utc)
C = dict(bucket='demo-private', key='one.tar', sha256='0'*64, region='ca-west-1', expires_at='2026-11-09T03:00:00Z', domain='rougehalla.com', run_id='demo-1')


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
        for key, value in [('domain', 'other.com'), ('region', 'us-east-1'), ('run_id', 'x;bad'), ('sha256', False), ('key', '../bad')]:
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
        self.assertLess(unit.index('ExecStart=/usr/sbin/nft'), unit.index('bootstrap.py shape'))
        self.assertIn('After=network-online.target rh-demo-expiry.timer', unit)
        self.assertIn('Requires=rh-demo-expiry.timer', unit)
        self.assertIn('Type=oneshot', unit)
        self.assertIn('OnFailure=rh-demo-poweroff.service', unit)
        self.assertIn('WantedBy=multi-user.target', unit)
        self.assertIn('Before=rh-demo-source.service rh-demo-training.service caddy.service', unit)

    def test_templates(self):
        # Render with a fresh absolute expiry, never executes the resulting shell.
        live = dict(C, expires_at=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))
        text = render(json.dumps(live).encode(), b'# reviewed script')
        self.assertLess(text.index('enable --now rh-demo-expiry.timer'), text.index('start --no-block rh-demo-setup.service'))
        self.assertIn('TimeoutStartSec=600', text)
        self.assertIn('Persistent=true', text)
        self.assertNotIn('apt-get', text)
        caddy = caddy_config()
        self.assertIn('/control*', caddy)
        self.assertIn('encode zstd gzip', caddy)
        self.assertIn('header_up X-Forwarded-For {remote_host}', caddy)
        for training in (False, True):
            unit = app_unit(C, training)
            self.assertIn('ExecStartPre=+/usr/bin/python3', unit)
            self.assertIn('Restart=no', unit)
            self.assertIn('127.0.0.1:', unit)
            self.assertNotIn('password', unit)


if __name__ == '__main__':
    unittest.main()
